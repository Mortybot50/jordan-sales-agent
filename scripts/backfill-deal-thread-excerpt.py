#!/usr/bin/env python3
"""
Backfill deals.thread_excerpt + win_probability + win_probability_breakdown
for the 317 PST-promoted deals from 02/06 mailbox import.

What it does:
  1. Loads ALL PST-promoted deals (notes ILIKE '%[purezza-pst-promote]%')
     + their contact email, via Supabase REST.
  2. Opens the inbox and sent PSTs, walks every message ONCE, building a
     per-email thread map: { subject, last_inbound, recent_messages,
     msg_count_in, msg_count_out }.
  3. Computes an explainable win_probability per deal from a fixed rule set
     (base 50; +/- weighted by signal). Each rule that fires is recorded
     in win_probability_breakdown so the UI can render an explanation.
  4. Updates the deal via Supabase REST (PATCH /deals?id=eq.<id>).

Idempotent — re-running overwrites thread_excerpt + score; old values lost,
no dupes. Safe to re-run after a PST refresh.

Usage:
  # A) Direct REST PATCH (requires service role key in env)
  SUPABASE_URL=https://bsevgxhnxlkzkcalevbb.supabase.co \\
  SUPABASE_SERVICE_ROLE_KEY=<key> \\
  python3 scripts/backfill-deal-thread-excerpt.py

  # B) Offline SQL emit (no creds needed for the PATCH leg; the SQL file is
  #     then applied separately via Supabase MCP `execute_sql`, the CLI's
  #     `psql --linked`, or any equivalent path)
  python3 scripts/backfill-deal-thread-excerpt.py \\
       --deals-json /tmp/deals.json --sql-out /tmp/deal-backfill.sql

  Flags:
    --dry-run        Compute everything but skip PATCH calls.
    --limit N        Only process the first N deals (for testing).
    --skip-bodies    Don't extract message bodies (much faster, but the
                     thread_excerpt will only carry metadata).
    --sql-out FILE   Emit UPDATE statements to FILE instead of PATCHing.
    --deals-json F   Use this pre-fetched deals JSON (array of {id,
                     contact_id, contacts: {email}}) rather than fetching
                     from Supabase.
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from typing import Optional
from urllib import request as urlrequest
from urllib.parse import urlencode

import pypff
import email as email_lib
import email.utils

# -----------------------------------------------------------------------------
# Config
# -----------------------------------------------------------------------------

IMPORT_DIR = "/Users/mortybot/.openclaw/roles/dev/clients/jordan/imports/purezza-mailbox-2026-06-01"
INBOX_PST = f"{IMPORT_DIR}/inbox/jordan.marziale@purezza.com.au.pst"
SENT_PST = f"{IMPORT_DIR}/sent/jordan.marziale@purezza.com.au.pst"

PST_PROMOTE_MARK = "[purezza-pst-promote]"

# Cap body excerpt sizes to keep JSONB rows reasonable.
BODY_EXCERPT_CHARS = 280
RECENT_MSG_LIMIT = 3

# Subject keywords that signal active buying interest.
INTEREST_KEYWORDS = (
    "pricing", "price", "demo", "proposal", "interested", "interest",
    "when can", "available", "book", "schedule", "quote", "trial",
)

# Generic personal mail domains — when a contact uses one of these we knock
# 20 points off because they're likely not the decision-maker mailbox.
GENERIC_DOMAINS = {
    "gmail.com", "googlemail.com", "yahoo.com", "yahoo.com.au",
    "hotmail.com", "hotmail.com.au", "outlook.com", "outlook.com.au",
    "live.com", "live.com.au", "icloud.com", "me.com", "bigpond.com",
    "optusnet.com.au",
}

# Decision-maker mailbox local-parts at hospitality domains.
HOSPO_LOCALPART_RE = re.compile(
    r"^(info|hello|owner|manager|chef|bar|kitchen|venue|bookings)\b",
    re.IGNORECASE,
)

JORDAN_LOCAL_RE = re.compile(
    r"^(jordan\.marziale|jordan|jordancrm26)@(purezza|premiumwaterau|jordanmarziale|gmail)\.",
    re.IGNORECASE,
)

# Email-noise prefixes injected by mail security gateways.
NOISE_PREFIX_RE = re.compile(
    r"^\s*(\[?CAUTION[^\]]*?\]?\s*[-–—:]*\s*EMAIL FROM EXTERNAL SENDER[^.\n]*\.?\s*)+",
    re.IGNORECASE,
)


# -----------------------------------------------------------------------------
# PST helpers
# -----------------------------------------------------------------------------

def safe_str(val) -> str:
    if val is None:
        return ""
    try:
        if isinstance(val, bytes):
            return val.decode("utf-8", errors="replace")
        return str(val)
    except Exception:
        return ""


def safe_time(msg) -> Optional[str]:
    """Returns ISO date (YYYY-MM-DD) or None."""
    for attr in ("delivery_time", "client_submit_time", "creation_time"):
        try:
            t = getattr(msg, attr, None)
            if t is not None:
                return str(t)[:10]
        except Exception:
            pass
    return None


def safe_body(msg) -> str:
    for attr in ("plain_text_body", "html_body"):
        try:
            body = getattr(msg, attr, None)
            if body:
                return safe_str(body)
        except Exception:
            pass
    return ""


def parse_transport_headers(raw: str) -> dict:
    result = {}
    if not raw:
        return result
    try:
        m = email_lib.message_from_string(raw)
        for k in ("From", "To", "Cc", "Bcc", "Subject", "Date"):
            v = m.get(k, "")
            if v:
                result[k.lower()] = v
    except Exception:
        pass
    return result


def parse_addresses(header_value: str) -> list:
    if not header_value:
        return []
    try:
        parsed = email.utils.getaddresses([header_value])
        return [a.lower().strip() for _, a in parsed if a and "@" in a]
    except Exception:
        return re.findall(r"[\w.+\-]+@[\w.\-]+\.[a-z]{2,}", header_value, re.I)


def html_to_text(html: str) -> str:
    """Quick-and-dirty HTML → plain text."""
    if not html:
        return ""
    html = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.I | re.S)
    text = re.sub(r"<[^>]+>", " ", html)
    text = (
        text.replace("&nbsp;", " ")
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", '"')
            .replace("&#39;", "'")
    )
    return re.sub(r"\s+", " ", text).strip()


def clean_body(raw: str) -> str:
    """Strip HTML, mail-security gateway noise prefixes, normalise whitespace."""
    if not raw:
        return ""
    text = raw if not raw.lstrip().startswith("<") else html_to_text(raw)
    text = NOISE_PREFIX_RE.sub("", text)
    return text.strip()


def walk_messages(folder, callback, depth=0):
    try:
        n = folder.number_of_sub_messages
        for i in range(n):
            try:
                callback(folder.get_sub_message(i))
            except Exception:
                pass
    except Exception:
        pass
    try:
        n_sub = folder.number_of_sub_folders
        for i in range(n_sub):
            try:
                walk_messages(folder.get_sub_folder(i), callback, depth + 1)
            except Exception:
                pass
    except Exception:
        pass


# -----------------------------------------------------------------------------
# Build per-email thread map from both PSTs
# -----------------------------------------------------------------------------

def build_thread_map(target_emails: set, *, skip_bodies: bool) -> dict:
    out: dict = {}

    def ensure(email_addr):
        if email_addr not in out:
            out[email_addr] = {
                "msg_count_inbound": 0,
                "msg_count_outbound": 0,
                "last_inbound": None,
                "last_outbound_date": None,
                "last_date_any": None,
                "recent_messages": [],
            }
        return out[email_addr]

    def push_recent(rec, item):
        rec["recent_messages"].append(item)
        rec["recent_messages"].sort(
            key=lambda x: x.get("date") or "", reverse=True,
        )
        rec["recent_messages"] = rec["recent_messages"][:RECENT_MSG_LIMIT]

    def bump_last_date(rec, date_str):
        if not date_str:
            return
        if not rec["last_date_any"] or date_str > rec["last_date_any"]:
            rec["last_date_any"] = date_str

    print(f"[backfill] opening inbox PST: {INBOX_PST}", flush=True)
    pst = pypff.file()
    pst.open(INBOX_PST)
    root = pst.get_root_folder()
    inbox_count = [0]
    inbox_match = [0]

    def handle_inbox(msg):
        inbox_count[0] += 1
        if inbox_count[0] % 2000 == 0:
            print(f"  [inbox] {inbox_count[0]} msgs, {inbox_match[0]} matches", flush=True)
        try:
            raw_headers = safe_str(msg.transport_headers)
            headers = parse_transport_headers(raw_headers)
            from_header = headers.get("from", "")
            froms = parse_addresses(from_header)
            if not froms:
                try:
                    ea = safe_str(msg.sender_email_address)
                    if ea and "@" in ea:
                        froms = [ea.lower().strip()]
                except Exception:
                    pass

            subject = safe_str(msg.subject) if msg.subject else headers.get("subject", "")
            date_str = safe_time(msg)
            body_excerpt = None

            for addr in froms:
                addr = addr.lower().strip()
                if addr not in target_emails:
                    continue
                if JORDAN_LOCAL_RE.match(addr):
                    continue
                inbox_match[0] += 1
                rec = ensure(addr)
                rec["msg_count_inbound"] += 1
                bump_last_date(rec, date_str)

                current = rec["last_inbound"]
                if not current or (date_str and (current.get("date") or "") < date_str):
                    if body_excerpt is None and not skip_bodies:
                        body_excerpt = clean_body(safe_body(msg))[:BODY_EXCERPT_CHARS]
                    rec["last_inbound"] = {
                        "subject": (subject or "").strip()[:200],
                        "body": body_excerpt or "",
                        "date": date_str,
                    }

                push_recent(rec, {
                    "direction": "inbound",
                    "subject": (subject or "").strip()[:200],
                    "date": date_str,
                })
        except Exception:
            pass

    walk_messages(root, handle_inbox)
    pst.close()
    print(f"[backfill] inbox done — {inbox_count[0]} msgs, {inbox_match[0]} matched", flush=True)

    print(f"[backfill] opening sent PST: {SENT_PST}", flush=True)
    pst = pypff.file()
    pst.open(SENT_PST)
    root = pst.get_root_folder()
    sent_count = [0]
    sent_match = [0]

    def handle_sent(msg):
        sent_count[0] += 1
        if sent_count[0] % 2000 == 0:
            print(f"  [sent] {sent_count[0]} msgs, {sent_match[0]} matches", flush=True)
        try:
            raw_headers = safe_str(msg.transport_headers)
            headers = parse_transport_headers(raw_headers)
            subject = safe_str(msg.subject) if msg.subject else headers.get("subject", "")
            date_str = safe_time(msg)

            recipients = []
            for h in ("to", "cc", "bcc"):
                recipients.extend(parse_addresses(headers.get(h, "")))

            seen = set()
            for addr in recipients:
                addr = addr.lower().strip()
                if addr in seen:
                    continue
                seen.add(addr)
                if addr not in target_emails:
                    continue
                if JORDAN_LOCAL_RE.match(addr):
                    continue
                sent_match[0] += 1
                rec = ensure(addr)
                rec["msg_count_outbound"] += 1
                bump_last_date(rec, date_str)

                if not rec["last_outbound_date"] or (
                    date_str and rec["last_outbound_date"] < date_str
                ):
                    rec["last_outbound_date"] = date_str

                push_recent(rec, {
                    "direction": "outbound",
                    "subject": (subject or "").strip()[:200],
                    "date": date_str,
                })
        except Exception:
            pass

    walk_messages(root, handle_sent)
    pst.close()
    print(f"[backfill] sent done — {sent_count[0]} msgs, {sent_match[0]} matched", flush=True)

    return out


# -----------------------------------------------------------------------------
# Scoring
# -----------------------------------------------------------------------------

def days_since(date_str: Optional[str]) -> Optional[int]:
    if not date_str:
        return None
    try:
        d = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        return (now - d).days
    except Exception:
        return None


def compute_score(email_addr: str, thread: dict) -> tuple[int, list]:
    """
    Returns (score 0-100, breakdown list).
    Each breakdown item: { rule, weight, applied: bool, detail? }.
    `detail` carries only data-derived strings (counts, domain, days) — UI
    renders the rule label statically (RULE_LABELS in src/lib/leadScoring.ts).
    """
    base = 50
    breakdown = [
        {"rule": "base", "weight": 50, "applied": True},
    ]

    in_count = thread.get("msg_count_inbound", 0)
    out_count = thread.get("msg_count_outbound", 0)
    last_date = thread.get("last_date_any")
    days = days_since(last_date)

    score = base

    if in_count > out_count and in_count > 0:
        score += 25
        breakdown.append({
            "rule": "engaged_inbound_majority",
            "weight": 25,
            "applied": True,
            "detail": {"in": in_count, "out": out_count},
        })
    else:
        breakdown.append({
            "rule": "engaged_inbound_majority",
            "weight": 25,
            "applied": False,
            "detail": {"in": in_count, "out": out_count},
        })

    if days is not None and days <= 7:
        score += 15
        breakdown.append({
            "rule": "recent_contact",
            "weight": 15,
            "applied": True,
            "detail": {"days": days},
        })
    else:
        breakdown.append({
            "rule": "recent_contact",
            "weight": 15,
            "applied": False,
            "detail": {"days": days},
        })

    subject = (thread.get("last_inbound") or {}).get("subject", "").lower()
    matched_keyword = next((k for k in INTEREST_KEYWORDS if k in subject), None)
    if matched_keyword:
        score += 10
        breakdown.append({
            "rule": "interest_keyword_in_subject",
            "weight": 10,
            "applied": True,
            "detail": {"kw": matched_keyword},
        })
    else:
        breakdown.append({
            "rule": "interest_keyword_in_subject",
            "weight": 10,
            "applied": False,
        })

    domain = email_addr.split("@", 1)[1] if "@" in email_addr else ""
    local = email_addr.split("@", 1)[0] if "@" in email_addr else email_addr
    is_generic = domain in GENERIC_DOMAINS
    is_hospo_dm = (
        domain.endswith(".com.au")
        and not is_generic
        and bool(HOSPO_LOCALPART_RE.match(local))
    )

    if is_hospo_dm:
        score += 10
        breakdown.append({
            "rule": "hospitality_decision_maker_mailbox",
            "weight": 10,
            "applied": True,
            "detail": {"local": local, "domain": domain},
        })
    else:
        breakdown.append({
            "rule": "hospitality_decision_maker_mailbox",
            "weight": 10,
            "applied": False,
        })

    if days is not None and days > 60:
        score -= 15
        breakdown.append({
            "rule": "stale_contact",
            "weight": -15,
            "applied": True,
            "detail": {"days": days},
        })
    else:
        breakdown.append({
            "rule": "stale_contact",
            "weight": -15,
            "applied": False,
        })

    if is_generic:
        score -= 20
        breakdown.append({
            "rule": "generic_personal_domain",
            "weight": -20,
            "applied": True,
            "detail": {"domain": domain},
        })
    else:
        breakdown.append({
            "rule": "generic_personal_domain",
            "weight": -20,
            "applied": False,
        })

    score = max(0, min(100, score))
    return score, breakdown


# -----------------------------------------------------------------------------
# Supabase REST helpers
# -----------------------------------------------------------------------------

def supabase_get(url: str, key: str, path: str, params: dict) -> list:
    qs = urlencode(params)
    full = f"{url}{path}?{qs}"
    req = urlrequest.Request(full, headers={
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    })
    with urlrequest.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def supabase_patch(url: str, key: str, path: str, params: dict, body: dict) -> None:
    qs = urlencode(params)
    full = f"{url}{path}?{qs}"
    req = urlrequest.Request(
        full,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        method="PATCH",
    )
    with urlrequest.urlopen(req, timeout=60):
        pass


def sql_quote_literal(text: str) -> str:
    return text.replace("'", "''")


def sql_jsonb_literal(payload) -> str:
    if payload is None:
        return "NULL"
    return "'" + sql_quote_literal(json.dumps(payload, default=str)) + "'::jsonb"


# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--skip-bodies", action="store_true")
    parser.add_argument("--sql-out", default=None,
                        help="Emit UPDATE statements to this file instead of "
                             "PATCHing REST directly.")
    parser.add_argument("--deals-json", default=None,
                        help="Pre-fetched deals JSON path. Skips the REST "
                             "fetch step (useful when service role key isn't "
                             "available locally).")
    args = parser.parse_args()

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if args.deals_json:
        with open(args.deals_json, "r") as f:
            deals = json.load(f)
        print(f"[backfill] loaded {len(deals)} deals from {args.deals_json}",
              flush=True)
    else:
        if not url or not key:
            print("FAIL: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required when "
                  "--deals-json not provided", file=sys.stderr)
            sys.exit(1)
        print("[backfill] fetching PST-promoted deals…", flush=True)
        deals = []
        offset = 0
        page_size = 200
        while True:
            page = supabase_get(url, key, "/rest/v1/deals", {
                "select": "id,contact_id,notes,contacts(email)",
                "notes": f"ilike.*{PST_PROMOTE_MARK}*",
                "limit": str(page_size),
                "offset": str(offset),
                "order": "created_at.desc",
            })
            if not page:
                break
            deals.extend(page)
            offset += len(page)
            if len(page) < page_size:
                break
        print(f"[backfill] {len(deals)} PST-promoted deals loaded", flush=True)

    if args.limit > 0:
        deals = deals[:args.limit]
        print(f"[backfill] limit={args.limit} — processing {len(deals)} deals", flush=True)

    email_to_deals: dict = {}
    no_email_deals = []
    for d in deals:
        contact = d.get("contacts") or {}
        contact_email = (contact.get("email") or "").strip().lower()
        if not contact_email:
            no_email_deals.append(d["id"])
            continue
        email_to_deals.setdefault(contact_email, []).append(d["id"])

    target_emails = set(email_to_deals.keys())
    print(f"[backfill] {len(target_emails)} unique target emails; "
          f"{len(no_email_deals)} deals had no contact email (will be skipped)",
          flush=True)

    t0 = time.time()
    thread_map = build_thread_map(target_emails, skip_bodies=args.skip_bodies)
    print(f"[backfill] PST walk took {time.time() - t0:.1f}s; "
          f"{len(thread_map)} emails matched", flush=True)

    updates_done = 0
    updates_skipped = 0
    score_dist: dict = {"hot": 0, "warm": 0, "cold": 0}
    sql_lines: list = []

    for email_addr, deal_ids in email_to_deals.items():
        thread = thread_map.get(email_addr)
        score, breakdown = compute_score(email_addr, thread or {})

        if thread:
            excerpt = {
                "subject": (thread.get("last_inbound") or {}).get("subject"),
                "last_from": email_addr,
                "last_body": (thread.get("last_inbound") or {}).get("body"),
                "last_date": (thread.get("last_inbound") or {}).get("date")
                              or thread.get("last_date_any"),
                "msg_count_inbound": thread.get("msg_count_inbound", 0),
                "msg_count_outbound": thread.get("msg_count_outbound", 0),
                "full_recent": thread.get("recent_messages", []),
            }
        else:
            excerpt = None

        if score >= 61:
            score_dist["hot"] += 1
        elif score >= 31:
            score_dist["warm"] += 1
        else:
            score_dist["cold"] += 1

        body = {
            "thread_excerpt": excerpt,
            "win_probability": score,
            "win_probability_breakdown": breakdown,
        }

        for deal_id in deal_ids:
            if args.dry_run:
                updates_skipped += 1
                continue
            if args.sql_out:
                sql_lines.append(
                    "UPDATE public.deals SET"
                    f" thread_excerpt = {sql_jsonb_literal(excerpt)},"
                    f" win_probability = {score},"
                    f" win_probability_breakdown = {sql_jsonb_literal(breakdown)}"
                    f" WHERE id = '{deal_id}';"
                )
                updates_done += 1
                continue
            try:
                supabase_patch(url, key, "/rest/v1/deals", {
                    "id": f"eq.{deal_id}",
                }, body)
                updates_done += 1
            except Exception as e:
                print(f"  [warn] PATCH failed for {deal_id} ({email_addr}): {e}",
                      file=sys.stderr, flush=True)

    if args.sql_out and not args.dry_run:
        with open(args.sql_out, "w") as f:
            f.write("-- Generated by scripts/backfill-deal-thread-excerpt.py\n")
            f.write(f"-- Generated at: {datetime.now(timezone.utc).isoformat()}\n")
            f.write(f"-- {len(sql_lines)} UPDATE statements\n\n")
            f.write("BEGIN;\n")
            f.write("\n".join(sql_lines))
            f.write("\nCOMMIT;\n")
        print(f"[backfill] wrote {len(sql_lines)} UPDATE statements to {args.sql_out}",
              flush=True)

    print("\n=== Backfill summary ===", flush=True)
    print(f"  deals processed   : {len(deals)}", flush=True)
    print(f"  deals updated     : {updates_done}", flush=True)
    print(f"  deals dry-skipped : {updates_skipped}", flush=True)
    print(f"  deals no email    : {len(no_email_deals)}", flush=True)
    print(f"  score distribution: {score_dist}", flush=True)
    print(f"  thread matches    : {len(thread_map)}", flush=True)


if __name__ == "__main__":
    main()
