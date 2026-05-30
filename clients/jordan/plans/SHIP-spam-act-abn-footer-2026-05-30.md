# SHIP — Spam Act sender block: ABN-only footer (30/05/2026)

**Slug:** `spam-act-abn-only-footer`
**Branch:** `fix/spam-act-abn-only-footer`
**Dispatched:** 30/05/2026 ~12:20 AEST
**Authorised by:** Jordan Marziale via WhatsApp — "Ship it"
**Decision path:** Path 1 from the morning thread — ABN-only footer, no street address.
**Project ref:** `bsevgxhnxlkzkcalevbb` (live Jordan Supabase, NOT orphan `gzpmocpczhsqxidfcwrn`)

---

## What changed

| # | Surface | Change |
|---|---|---|
| 1 | Production data | `public.users.spam_act_sender_block` patched on 1 row (`demo@jordan-sales-agent.test`) via `mcp__supabase__execute_sql`. New value verbatim: `Jordan Marziale - ABN 78 180 361 897 - Reply STOP or click the unsubscribe link above.` |
| 2 | Migration tree | New file `supabase/migrations/20260530020000_spam_act_sender_block_jordan_real_abn.sql`. Idempotent UPDATE matching the same WHERE predicate as the prod patch, with header comments explaining supersession, authorisation, and the deliberate ABN-only trade-off. Captured for fresh-clone replays. |
| 3 | Canonical docs | `clients/jordan/IDENTITY.md` — new `## Cold-send decisions` section between `## Hard constraints` and `## Operating model`. Records the date, footer text verbatim, authorisation source, residual s.17 risk, and migration pointer. |

---

## Probes

### Probe BEFORE (production)
```sql
SELECT id, email, spam_act_sender_block
FROM public.users
WHERE spam_act_sender_block ILIKE '%12 345 678 901%'
   OR spam_act_sender_block ILIKE '%PO Box 123%';
```
Result: **1 row** —
```
id    : 3b31e455-92c7-4507-8b4b-0e274c27009c
email : demo@jordan-sales-agent.test
value : Jordan Marziale - Premium Water AU - ABN 12 345 678 901 - PO Box 123, Melbourne VIC 3000 - Reply STOP or click the unsubscribe link above.
```

### UPDATE applied
```sql
UPDATE public.users
   SET spam_act_sender_block = 'Jordan Marziale - ABN 78 180 361 897 - Reply STOP or click the unsubscribe link above.'
 WHERE spam_act_sender_block ILIKE '%12 345 678 901%'
    OR spam_act_sender_block ILIKE '%PO Box 123%'
RETURNING id, email, spam_act_sender_block;
```
Result: **1 row updated** —
```
id    : 3b31e455-92c7-4507-8b4b-0e274c27009c
email : demo@jordan-sales-agent.test
value : Jordan Marziale - ABN 78 180 361 897 - Reply STOP or click the unsubscribe link above.
```

### Probe AFTER (production)
- Placeholder/PO Box query → **0 rows** ✅
- `ILIKE '%78 180 361 897%'` → **1 row** with the new value verbatim ✅

---

## Smoke — Spam Act footer chain

**Architectural note.** `spam_act_sender_block` is not rendered by `generate-draft`; it's welded onto the body by `send-via-smtp` (and `drain-send-queue`) at the SMTP boundary. So the smoke is on that code path, not the draft generator.

### Query replay (the exact lookup `send-via-smtp` runs)
`supabase/functions/send-via-smtp/index.ts:182-186`:
```sql
SELECT spam_act_sender_block, send_timezone
FROM users
WHERE id = <user_id>
```
Replayed against the demo user id `3b31e455-92c7-4507-8b4b-0e274c27009c`:
```
spam_act_sender_block : "Jordan Marziale - ABN 78 180 361 897 - Reply STOP or click the unsubscribe link above."
send_timezone         : "Australia/Melbourne"
```
- `'78 180 361 897'` present ✅
- `'12 345 678 901'` absent ✅
- `'PO Box 123'` absent ✅

### Append logic (the same file, lines 251-254)
```ts
const blockText = spamActBlock.trim()
const finalText = `${rawText}\n\n---\n${blockText}`
const blockHtml = `<hr ... />
<p ...>${escapeHtml(blockText).replace(/\n/g, '<br/>')}</p>`
```
The block is appended verbatim after a `\n\n---\n` separator (text) and an `<hr/>` + `<p>` (HTML). No transformation, no fallback. The next real send will carry the new ABN-only footer.

### Gate
`send-via-smtp:192-198` returns 503 if `spam_act_sender_block` is NULL or `< 20 chars`. New value is 88 chars — comfortably past the gate.

---

## Residual risk (accepted)

**Spam Act 2003 (Cth) s.17.** Requires commercial electronic messages to include "accurate information about the individual or organisation that authorised the sending of the message". ACMA guidance commonly reads this as name + identifying contact (ABN / business address). The new footer has Jordan's name and a uniquely-identifying ABN (publicly resolvable via the ABR) but no street address.

Trade-offs weighed and accepted in writing on WhatsApp by Jordan:
- Jordan declined to put his home address on bulk commercial send.
- No business PO Box currently stood up.
- ABN gives a uniquely-resolvable identification path via `abr.business.gov.au`.

Revisit if:
- ACMA publishes guidance / a determination that pushes harder on "physical address required".
- Jordan establishes a business PO Box (preferred long-term).
- A complaint lands and the response position needs reconsidering.

The trade-off is captured in:
- `clients/jordan/IDENTITY.md` § Cold-send decisions
- Header comments of the new migration

---

## PR

- Branch: `fix/spam-act-abn-only-footer`
- Commit: `fix(spam-act): real ABN, drop placeholder address per Jordan 30/05`
- PR title: `fix(spam-act): patch sender block with real ABN, ABN-only (no address)`
- **NOT merged** — left open for Codex Pattern B review per Morty's CTO rules.
- PR URL: see bottom of this file / dispatch return line.

---

## Files touched

| File | Type | Lines |
|---|---|---|
| `supabase/migrations/20260530020000_spam_act_sender_block_jordan_real_abn.sql` | new | ~40 |
| `clients/jordan/IDENTITY.md` | edit | +3 |
| `clients/jordan/plans/SHIP-spam-act-abn-footer-2026-05-30.md` | new | this file |

---

## Status

| Phase | Artefact | Probe | Status |
|---|---|---|---|
| Prod patch | UPDATE on `users.spam_act_sender_block` | 1 row before / 0 placeholder after / 1 with real ABN | ✅ |
| Migration file | `20260530020000_spam_act_sender_block_jordan_real_abn.sql` | idempotent, header comments document the trade-off | ✅ |
| IDENTITY doc | Cold-send decisions section in `clients/jordan/IDENTITY.md` | bullet with verbatim footer + migration pointer | ✅ |
| Smoke | SELECT replay + code-chain inspection | new value reaches `send-via-smtp` verbatim, no placeholder reachable | ✅ |
| PR | open on `fix/spam-act-abn-only-footer` | awaiting Codex review | ⏳ |
