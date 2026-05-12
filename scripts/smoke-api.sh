#!/usr/bin/env bash
# LeadFlow API smoke test — verifies the deployed Supabase REST + Edge Function
# surface returns the response shapes the SPA depends on. Catches the
# field-name-drift class of bug (e.g. PPB suggestions vs suppliers) BEFORE
# deploy. Run as part of every deploy pre-flight + post-deploy verification.
#
# Run:   bash scripts/smoke-api.sh
# Alias: npm run smoke
#
# Exit 0 = all checks passed. Non-zero = at least one endpoint has a wrong
# shape, an unexpected status code, or is unreachable.
#
# Environment (one of):
#   1. Export VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, DEMO_EMAIL, DEMO_PASSWORD
#   2. Drop them into .env.local (gitignored) — auto-sourced if present
#
# Required:
#   VITE_SUPABASE_URL        e.g. https://bsevgxhnxlkzkcalevbb.supabase.co
#   VITE_SUPABASE_ANON_KEY   anon JWT from Supabase dashboard
#   DEMO_EMAIL               demo user email (PostgREST + JWT login)
#   DEMO_PASSWORD            demo user password
#
# Reference: ~/.openclaw/roles/dev/ppb-ops-hub/scripts/smoke-api.sh
# Discipline: ~/.claude/rules/dev/frontend-smoke.md §2

set -euo pipefail
export PATH="/usr/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

CURL=/usr/bin/curl
PY=/usr/bin/python3
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Source .env.local if present (gitignored)
if [[ -f "${REPO_DIR}/.env.local" ]]; then
  # shellcheck disable=SC1091
  set -a; . "${REPO_DIR}/.env.local"; set +a
fi

: "${VITE_SUPABASE_URL:?missing — export it or set in .env.local}"
: "${VITE_SUPABASE_ANON_KEY:?missing — export it or set in .env.local}"
: "${DEMO_EMAIL:?missing — export it or set in .env.local}"
: "${DEMO_PASSWORD:?missing — export it or set in .env.local}"

SUPA_URL="${VITE_SUPABASE_URL%/}"
ANON="${VITE_SUPABASE_ANON_KEY}"
REST="${SUPA_URL}/rest/v1"
FUNCS="${SUPA_URL}/functions/v1"
AUTH="${SUPA_URL}/auth/v1"

PASS=0
FAIL=0

echo "=== LeadFlow API smoke ==="
echo "Target: ${SUPA_URL}"
echo ""

# ---------- Step 1: login → JWT ----------
LOGIN_RESP=$($CURL -s -X POST "${AUTH}/token?grant_type=password" \
  -H "apikey: ${ANON}" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"email":"%s","password":"%s"}' "${DEMO_EMAIL}" "${DEMO_PASSWORD}")")

JWT=$(echo "$LOGIN_RESP" | $PY -c "import sys,json;d=json.load(sys.stdin);print(d.get('access_token',''))" 2>/dev/null || echo "")

if [[ -z "$JWT" ]]; then
  echo "✗ login failed for ${DEMO_EMAIL}: ${LOGIN_RESP:0:200}" >&2
  exit 2
fi
echo "✓ login (${DEMO_EMAIL}) → JWT minted"

AUTH_HDR=(-H "Authorization: Bearer ${JWT}" -H "apikey: ${ANON}")

# ---------- Step 2: PostgREST GETs ----------
# Each row: name|path|expected_array (the response must be a JSON array)
REST_TESTS=(
  "worker_runs (latest 5)|worker_runs?select=id,worker_name,status,started_at&order=started_at.desc&limit=5|yes"
  "briefing_sends (latest 5)|briefing_sends?select=id,user_id,sent_at,item_count&order=sent_at.desc&limit=5|yes"
  "route_days (sample)|route_days?select=id,day_of_week,anchor_venue_id&limit=5|yes"
  "deals (sample)|deals?select=id,title,stage_id&limit=5|yes"
  "contacts (sample)|contacts?select=id,full_name,email&limit=5|yes"
  "email_drafts (latest 5)|email_drafts?select=id,subject,status,generated_at&order=generated_at.desc&limit=5|yes"
  "suppression_list (sample)|suppression_list?select=id,email,reason&limit=5|yes"
)

echo ""
echo "--- PostgREST reads ---"
for t in "${REST_TESTS[@]}"; do
  IFS='|' read -r NAME PATHQ EXPECT_ARRAY <<< "$t"
  HTTP=$($CURL -s -o /tmp/leadflow-smoke-body.txt -w "%{http_code}" \
    -X GET "${REST}/${PATHQ}" "${AUTH_HDR[@]}")
  BODY=$(cat /tmp/leadflow-smoke-body.txt)
  if [[ "$HTTP" != "200" ]]; then
    echo "✗ ${NAME} — HTTP ${HTTP}: ${BODY:0:160}"
    FAIL=$((FAIL + 1))
    continue
  fi
  RESULT=$($PY - "$BODY" "$EXPECT_ARRAY" <<'PYEOF'
import json, sys
body, expect_array = sys.argv[1], sys.argv[2]
try:
    data = json.loads(body)
except Exception as e:
    print(f"FAIL|not JSON: {e}"); sys.exit(0)
if expect_array == "yes" and not isinstance(data, list):
    print(f"FAIL|expected array, got {type(data).__name__}"); sys.exit(0)
print("OK")
PYEOF
)
  if [[ "$RESULT" == "OK" ]]; then
    echo "✓ ${NAME}"
    PASS=$((PASS + 1))
  else
    echo "✗ ${NAME} — ${RESULT#FAIL|}"
    FAIL=$((FAIL + 1))
  fi
done

# ---------- Step 3: Edge Function negative tests ----------
# Verify each function is deployed + reachable + auth-gated, without firing
# real side effects (no emails sent, no drafts created, no routes mutated).
#
# Each row: name|method|path|body|expected_http (regex)
#
# 401 = verify_jwt rejected unauth or auth missing
# 400 = function reachable, validates input, rejected our minimal body
# 200 = function reachable + accepted (for read-only health-style calls)
# 409 = function reachable, business-rule guard fired (acceptable for generate-draft)
# 503 = function reachable, env-config gap (e.g. BE-P0-03 hard-fail)

echo ""
echo "--- Edge Functions (negative / probe) ---"

# A) Unauthed call must 401 — confirms verify_jwt is on
for fn in generate-draft send-morning-briefing classify-reply-intent field-route-optimize sequence-tick generate-learning-digest voice-transcribe geocode-batch geocode-venues-batch reopening-radar-manual reopening-radar-poll; do
  HTTP=$($CURL -s -o /dev/null -w "%{http_code}" \
    -X POST "${FUNCS}/${fn}" \
    -H "Content-Type: application/json" \
    -d '{}')
  case "$HTTP" in
    401|403)
      echo "✓ ${fn} (unauthed) → ${HTTP}"
      PASS=$((PASS + 1))
      ;;
    *)
      echo "✗ ${fn} (unauthed) → ${HTTP} (expected 401/403)"
      FAIL=$((FAIL + 1))
      ;;
  esac
done

# B) Authed generate-draft with missing body → 400 (validates input without
#    firing the model). Also tolerates 503 (BE-P0-03 hard-fail when
#    UNSUBSCRIBE_SIGNING_KEY absent) and 404 (caller has no profile).
HTTP=$($CURL -s -o /tmp/leadflow-smoke-gd.txt -w "%{http_code}" \
  -X POST "${FUNCS}/generate-draft" \
  "${AUTH_HDR[@]}" \
  -H "Content-Type: application/json" \
  -d '{}')
case "$HTTP" in
  400|404|503)
    echo "✓ generate-draft (authed, empty body) → ${HTTP}"
    PASS=$((PASS + 1))
    ;;
  *)
    echo "✗ generate-draft (authed, empty body) → ${HTTP} (expected 400/404/503): $(cat /tmp/leadflow-smoke-gd.txt | head -c 160)"
    FAIL=$((FAIL + 1))
    ;;
esac

rm -f /tmp/leadflow-smoke-body.txt /tmp/leadflow-smoke-gd.txt

echo ""
echo "=== ${PASS} passed, ${FAIL} failed ==="

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
