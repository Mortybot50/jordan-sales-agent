#!/usr/bin/env bash
# LeadFlow API smoke v2 — Supabase Management API + PostgREST contract guard.
#
# Two phases:
#   Phase A — Management API metadata check (always runs).
#             GET https://api.supabase.com/v1/projects/{ref}/functions
#             Loads the canonical roster from scripts/smoke-manifest.yaml and
#             diffs against the live Management API response. Reports per
#             function:
#               OK         — deployed, ACTIVE, verify_jwt matches manifest
#               MISSING    — in manifest but not deployed
#               AUTH_DRIFT — deployed but verify_jwt differs from manifest
#               UNEXPECTED — deployed but not in manifest (drift the other way)
#             Zero HTTP calls to function handlers, no side effects. Closes
#             Codex review v2 residuals on PR #46:
#               [P1] OPTIONS could trigger handlers without a method-guard.
#               [P2] Only one function's verify_jwt was being checked.
#   Phase B — PostgREST + JWT login (skipped if creds not present).
#             Login as DEMO_EMAIL → JWT mint → read-only GETs against the
#             tables the SPA depends on. Catches PostgREST / RLS / response-
#             shape drift before the SPA hits it.
#
# Phase B is gated on VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY + DEMO_EMAIL
# + DEMO_PASSWORD. If any are missing, Phase B is skipped with a clear note;
# Phase A still runs. CI MUST export all four to get full coverage.
#
# Run:   bash scripts/smoke-api.sh
# Alias: npm run smoke
#
# Exit 0 = every check passed (and Phase B either passed or was skipped).
# Exit 1 = at least one assertion failed or the Management API returned non-200.
# Exit 2 = config gap (no project ref / no PAT / no manifest) or Phase B login failed.
#
# Phase A auth: SUPABASE_ACCESS_TOKEN (Supabase CLI PAT). Resolved in order:
#   1. Environment variable SUPABASE_ACCESS_TOKEN.
#   2. macOS Keychain — `security find-generic-password -s "Supabase CLI" -a supabase -w`
#   3. macOS Keychain — `security find-generic-password -s supabase -a supabase -w`
# The `go-keyring-base64:<base64>` envelope the Supabase CLI uses is decoded
# automatically. If nothing resolves, the script fails loudly with the
# `security add-generic-password` command needed to provision it.
#
# Manifest source: scripts/smoke-manifest.yaml — JWT / SVC / PUBLIC groups.
# Effective verify_jwt: jwt+svc → true, public → false.
#
# Reference: ~/.openclaw/roles/dev/ppb-ops-hub/scripts/smoke-api.sh
# Discipline: ~/.claude/rules/dev/frontend-smoke.md §2

set -euo pipefail
export PATH="/usr/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

CURL=/usr/bin/curl
PY=/usr/bin/python3
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MANIFEST="${SCRIPT_DIR}/smoke-manifest.yaml"

# Source .env.local if present (gitignored).
if [[ -f "${REPO_DIR}/.env.local" ]]; then
  # shellcheck disable=SC1091
  set -a; . "${REPO_DIR}/.env.local"; set +a
fi

# ---------- Manifest ----------
if [[ ! -f "$MANIFEST" ]]; then
  echo "✗ manifest missing: ${MANIFEST}" >&2
  exit 2
fi

# ---------- Project ref ----------
PROJECT_REF="${SUPABASE_PROJECT_REF:-}"
if [[ -z "$PROJECT_REF" ]]; then
  if [[ -f "${REPO_DIR}/supabase/.temp/project-ref" ]]; then
    PROJECT_REF="$(tr -d '[:space:]' < "${REPO_DIR}/supabase/.temp/project-ref")"
  fi
fi
if [[ -z "$PROJECT_REF" ]]; then
  echo "✗ project ref not set — export SUPABASE_PROJECT_REF or run 'supabase link --project-ref <ref>'" >&2
  exit 2
fi

# ---------- Access token ----------
SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:-}"
if [[ -z "$SUPABASE_ACCESS_TOKEN" ]]; then
  SUPABASE_ACCESS_TOKEN="$(security find-generic-password -s 'Supabase CLI' -a supabase -w 2>/dev/null || true)"
fi
if [[ -z "$SUPABASE_ACCESS_TOKEN" ]]; then
  SUPABASE_ACCESS_TOKEN="$(security find-generic-password -s supabase -a supabase -w 2>/dev/null || true)"
fi
if [[ -z "$SUPABASE_ACCESS_TOKEN" ]]; then
  echo "✗ Supabase PAT not found in Keychain — set with:" >&2
  echo "    security add-generic-password -s 'Supabase CLI' -a supabase -w <PAT>" >&2
  exit 2
fi
if [[ "$SUPABASE_ACCESS_TOKEN" == go-keyring-base64:* ]]; then
  SUPABASE_ACCESS_TOKEN="$(printf '%s' "${SUPABASE_ACCESS_TOKEN#go-keyring-base64:}" | base64 -d 2>/dev/null || true)"
fi
if [[ -z "$SUPABASE_ACCESS_TOKEN" ]]; then
  echo "✗ Supabase PAT resolved but empty after decode" >&2
  exit 2
fi

PASS=0
FAIL=0

echo "=== LeadFlow API smoke v2 ==="
echo "Project:  ${PROJECT_REF}"
echo "Manifest: ${MANIFEST}"
echo ""

# ============================================================================
# Phase A — Management API metadata check
# ============================================================================
echo "[Phase A] Edge Function roster (Management API)"

RESP_BODY="$(mktemp)"
trap 'rm -f "$RESP_BODY"' EXIT

HTTP=$("$CURL" -sS -o "$RESP_BODY" -w "%{http_code}" \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/functions" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Accept: application/json")

if [[ "$HTTP" != "200" ]]; then
  BODY_PREVIEW="$(head -c 200 "$RESP_BODY")"
  echo "✗ Management API returned HTTP ${HTTP}: ${BODY_PREVIEW}" >&2
  exit 1
fi

# Hand the whole audit (manifest parse + live response diff + per-function
# assertion) to one Python pass. Easier to reason about than three layered
# shell heredocs, and produces a single line per function for the bash loop.
AUDIT_OUT=$("$PY" - "$MANIFEST" "$RESP_BODY" <<'PYEOF'
import json
import sys

manifest_path, body_path = sys.argv[1], sys.argv[2]

# --- Parse manifest (tiny YAML subset: group: then "  - name  # comment").
groups = {"jwt": [], "svc": [], "public": []}
current = None
try:
    with open(manifest_path) as f:
        for raw in f:
            line = raw.rstrip("\n")
            stripped = line.split("#", 1)[0].rstrip()
            if not stripped.strip():
                continue
            if not line.startswith(" ") and stripped.endswith(":"):
                key = stripped[:-1].strip()
                current = key if key in groups else None
                continue
            if current and stripped.lstrip().startswith("- "):
                name = stripped.lstrip()[2:].strip()
                if name:
                    groups[current].append(name)
except Exception as e:
    print(f"MANIFEST_ERR|{e}")
    sys.exit(0)

# Effective verify_jwt: jwt + svc → True, public → False.
expected = {}
category = {}
for name in groups["jwt"]:
    expected[name] = True
    category[name] = "JWT"
for name in groups["svc"]:
    expected[name] = True
    category[name] = "SVC"
for name in groups["public"]:
    expected[name] = False
    category[name] = "PUBLIC"

# --- Parse live response.
try:
    with open(body_path) as f:
        fns = json.load(f)
except Exception as e:
    print(f"PARSE_ERR|{e}")
    sys.exit(0)
if not isinstance(fns, list):
    print(f"PARSE_ERR|expected array, got {type(fns).__name__}")
    sys.exit(0)

live = {}
for fn in fns:
    key = fn.get("slug") or fn.get("name")
    if key:
        live[key] = fn

# --- Per-manifest-entry checks, in manifest order (jwt, svc, public).
for group_key in ("jwt", "svc", "public"):
    for name in groups[group_key]:
        cat = category[name]
        want = expected[name]
        match = live.get(name)
        if not match:
            print(f"MISSING|{cat}|{name}|expected verify_jwt={want}, not deployed")
            continue
        status = match.get("status", "?")
        version = match.get("version", "?")
        if "verify_jwt" not in match:
            print(f"AUTH_DRIFT|{cat}|{name}|verify_jwt missing from response v{version} status={status}")
            continue
        got = match["verify_jwt"]
        if not isinstance(got, bool):
            print(f"AUTH_DRIFT|{cat}|{name}|verify_jwt not bool (got {type(got).__name__}={got!r}) v{version} status={status}")
            continue
        if status != "ACTIVE":
            print(f"AUTH_DRIFT|{cat}|{name}|status={status} (expected ACTIVE) v{version} verify_jwt={got}")
            continue
        if got != want:
            print(f"AUTH_DRIFT|{cat}|{name}|verify_jwt={got} (expected {want}) v{version} status={status}")
            continue
        print(f"OK|{cat}|{name}|v{version} verify_jwt={got} {status}")

# --- Drift the other way: deployed but not in manifest.
unexpected = sorted(k for k in live.keys() if k not in expected)
for name in unexpected:
    match = live[name]
    got = match.get("verify_jwt")
    version = match.get("version", "?")
    status = match.get("status", "?")
    print(f"UNEXPECTED|?|{name}|deployed v{version} status={status} verify_jwt={got}, not in smoke-manifest.yaml")
PYEOF
)

case "$AUDIT_OUT" in
  MANIFEST_ERR\|*)
    echo "✗ manifest parse failed — ${AUDIT_OUT#MANIFEST_ERR|}" >&2
    exit 1
    ;;
  PARSE_ERR\|*)
    echo "✗ Management API response malformed — ${AUDIT_OUT#PARSE_ERR|}" >&2
    exit 1
    ;;
esac

# Emit grouped, with PASS / FAIL counters. AUDIT_OUT has one line per result:
#   STATUS|CATEGORY|name|detail
LAST_CAT=""
while IFS='|' read -r RESULT CAT NAME DETAIL; do
  [[ -z "$RESULT" ]] && continue
  if [[ "$CAT" != "$LAST_CAT" ]]; then
    echo ""
    case "$CAT" in
      JWT)    echo "  JWT (end-user calls, verify_jwt=true):" ;;
      SVC)    echo "  SVC (cron / inter-function, verify_jwt=true + requireServiceRoleAuth):" ;;
      PUBLIC) echo "  PUBLIC (webhooks / tracking / open-by-design, verify_jwt=false):" ;;
      "?")    echo "  Drift — deployed but not in manifest:" ;;
    esac
    LAST_CAT="$CAT"
  fi
  case "$RESULT" in
    OK)
      echo "    ✓ OK         ${NAME} — ${DETAIL}"
      PASS=$((PASS + 1))
      ;;
    MISSING)
      echo "    ✗ MISSING    ${NAME} — ${DETAIL}"
      FAIL=$((FAIL + 1))
      ;;
    AUTH_DRIFT)
      echo "    ✗ AUTH_DRIFT ${NAME} — ${DETAIL}"
      FAIL=$((FAIL + 1))
      ;;
    UNEXPECTED)
      echo "    ✗ UNEXPECTED ${NAME} — ${DETAIL}"
      FAIL=$((FAIL + 1))
      ;;
    *)
      echo "    ✗ UNKNOWN    ${NAME} — ${RESULT} ${DETAIL}"
      FAIL=$((FAIL + 1))
      ;;
  esac
done <<< "$AUDIT_OUT"

# ============================================================================
# Phase B — PostgREST + JWT (skipped if creds absent)
# ============================================================================
echo ""
echo "[Phase B] PostgREST + JWT login"

if [[ -z "${VITE_SUPABASE_URL:-}" || -z "${VITE_SUPABASE_ANON_KEY:-}" || -z "${DEMO_EMAIL:-}" || -z "${DEMO_PASSWORD:-}" ]]; then
  # Codex review v2 round-2 — silent Phase B skip means CI could ship without
  # any PostgREST/RLS coverage. Require an explicit opt-in for local dev.
  if [[ "${SMOKE_ALLOW_PHASE_B_SKIP:-}" =~ ^(1|true|yes)$ ]]; then
    echo "  ⚠ skipped (SMOKE_ALLOW_PHASE_B_SKIP set) — Phase A still ran."
  else
    echo "  ✗ Phase B creds missing — set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY," >&2
    echo "    DEMO_EMAIL, DEMO_PASSWORD (or drop into .env.local). Local dev can" >&2
    echo "    bypass with SMOKE_ALLOW_PHASE_B_SKIP=1; CI MUST export all four." >&2
    exit 2
  fi
else
  SUPA_URL="${VITE_SUPABASE_URL%/}"
  ANON="${VITE_SUPABASE_ANON_KEY}"
  REST="${SUPA_URL}/rest/v1"
  AUTH="${SUPA_URL}/auth/v1"

  LOGIN_BODY="$(mktemp)"
  HTTP=$("$CURL" -sS -o "$LOGIN_BODY" -w "%{http_code}" \
    -X POST "${AUTH}/token?grant_type=password" \
    -H "apikey: ${ANON}" \
    -H "Content-Type: application/json" \
    --data-binary "$("$PY" -c 'import json, os; print(json.dumps({"email": os.environ["DEMO_EMAIL"], "password": os.environ["DEMO_PASSWORD"]}))')")
  if [[ "$HTTP" != "200" ]]; then
    BODY_PREVIEW="$(head -c 200 "$LOGIN_BODY")"
    rm -f "$LOGIN_BODY"
    echo "  ✗ login failed for ${DEMO_EMAIL}: HTTP ${HTTP} ${BODY_PREVIEW}" >&2
    exit 2
  fi
  JWT=$("$PY" -c 'import sys, json; d=json.load(open(sys.argv[1])); print(d.get("access_token",""))' "$LOGIN_BODY")
  rm -f "$LOGIN_BODY"
  if [[ -z "$JWT" ]]; then
    echo "  ✗ login returned 200 but no access_token" >&2
    exit 2
  fi
  echo "  ✓ login (${DEMO_EMAIL}) → JWT minted"
  PASS=$((PASS + 1))

  AUTH_HDR=(-H "Authorization: Bearer ${JWT}" -H "apikey: ${ANON}")

  # Each row: name|path
  REST_TESTS=(
    "worker_runs (latest 5)|worker_runs?select=id,worker_name,status,started_at&order=started_at.desc&limit=5"
    "briefing_sends (latest 5)|briefing_sends?select=id,user_id,sent_at,item_count&order=sent_at.desc&limit=5"
    "route_days (sample)|route_days?select=id,day_of_week,anchor_venue_id&limit=5"
    "deals (sample)|deals?select=id,title,stage_id&limit=5"
    "contacts (sample)|contacts?select=id,full_name,email&limit=5"
    "email_drafts (latest 5)|email_drafts?select=id,subject,status,generated_at&order=generated_at.desc&limit=5"
    "suppression_list (sample)|suppression_list?select=id,email,reason&limit=5"
  )

  REST_TMP="$(mktemp)"
  for t in "${REST_TESTS[@]}"; do
    IFS='|' read -r NAME PATHQ <<< "$t"
    HTTP=$("$CURL" -sS -o "$REST_TMP" -w "%{http_code}" \
      -X GET "${REST}/${PATHQ}" "${AUTH_HDR[@]}")
    if [[ "$HTTP" != "200" ]]; then
      BODY_PREVIEW="$(head -c 160 "$REST_TMP")"
      echo "  ✗ ${NAME} — HTTP ${HTTP}: ${BODY_PREVIEW}"
      FAIL=$((FAIL + 1))
      continue
    fi
    RESULT=$("$PY" - "$REST_TMP" <<'PYEOF'
import json, sys
try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
except Exception as e:
    print(f"FAIL|not JSON: {e}"); sys.exit(0)
if not isinstance(data, list):
    print(f"FAIL|expected array, got {type(data).__name__}"); sys.exit(0)
print("OK")
PYEOF
)
    if [[ "$RESULT" == "OK" ]]; then
      echo "  ✓ ${NAME}"
      PASS=$((PASS + 1))
    else
      echo "  ✗ ${NAME} — ${RESULT#FAIL|}"
      FAIL=$((FAIL + 1))
    fi
  done
  rm -f "$REST_TMP"
fi

echo ""
echo "=== ${PASS} passed, ${FAIL} failed ==="

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
