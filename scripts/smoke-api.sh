#!/usr/bin/env bash
# LeadFlow API smoke v2 — Supabase Management API + PostgREST contract guard.
#
# Two phases:
#   Phase A — Management API metadata check (always runs).
#             GET https://api.supabase.com/v1/projects/{ref}/functions
#             Asserts every function is ACTIVE with the expected verify_jwt
#             flag. Zero HTTP calls to function handlers, no side effects.
#             Closes Codex review v2 residuals on PR #46:
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
# Exit 2 = config gap (no project ref / no PAT) or Phase B login failed.
#
# Phase A auth: SUPABASE_ACCESS_TOKEN (Supabase CLI PAT). Resolved in order:
#   1. Environment variable SUPABASE_ACCESS_TOKEN.
#   2. macOS Keychain — `security find-generic-password -s "Supabase CLI" -a supabase -w`
#   3. macOS Keychain — `security find-generic-password -s supabase -a supabase -w`
# The `go-keyring-base64:<base64>` envelope the Supabase CLI uses is decoded
# automatically. If nothing resolves, the script fails loudly with the
# `security add-generic-password` command needed to provision it.
#
# Truth table source: verified 2026-05-15 against live project bsevgxhnxlkzkcalevbb
# via `mcp__supabase__list_edge_functions`. Update EXPECTED_* arrays when
# functions are added/removed/flipped; the drift check fails first deploy
# after the change.
#
# Reference: ~/.openclaw/roles/dev/ppb-ops-hub/scripts/smoke-api.sh
# Discipline: ~/.claude/rules/dev/frontend-smoke.md §2

set -euo pipefail
export PATH="/usr/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

CURL=/usr/bin/curl
PY=/usr/bin/python3
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Source .env.local if present (gitignored).
if [[ -f "${REPO_DIR}/.env.local" ]]; then
  # shellcheck disable=SC1091
  set -a; . "${REPO_DIR}/.env.local"; set +a
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
echo "Project: ${PROJECT_REF}"
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

# Validate the response shape up-front so the drift check + assertions can
# assume a well-formed array. Codex review v2 round-1 [P2] — JSON-parse error
# handling.
SHAPE_CHECK=$("$PY" - "$RESP_BODY" <<'PYEOF'
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
if [[ "$SHAPE_CHECK" != "OK" ]]; then
  echo "✗ Management API response malformed — ${SHAPE_CHECK#FAIL|}" >&2
  exit 1
fi

# Expected truth table — verified 2026-05-15 against live project
# bsevgxhnxlkzkcalevbb. Update both arrays when the roster changes; the drift
# check will fail first deploy after the change.
EXPECTED_JWT_TRUE=(
  generate-draft
  reopening-radar-poll
  reopening-radar-manual
  geocode-batch
  field-route-optimize
  voice-transcribe
  sequence-tick
  classify-reply-intent
  audit-snapshot
  geocode-venues-batch
  gmail-inbound
)
EXPECTED_JWT_FALSE=(
  create-demo-user
  send-morning-briefing
  generate-learning-digest
  ensure-intent-idx
)

assert_fn() {
  local NAME="$1"
  local EXPECTED_JWT="$2"   # "true" or "false"
  RESULT=$("$PY" - "$NAME" "$EXPECTED_JWT" "$RESP_BODY" <<'PYEOF'
import json, sys
name, expected_jwt, body_path = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    with open(body_path) as f:
        fns = json.load(f)
except Exception as e:
    print(f"FAIL|not JSON: {e}"); sys.exit(0)
if not isinstance(fns, list):
    print(f"FAIL|expected array, got {type(fns).__name__}"); sys.exit(0)
match = next((f for f in fns if f.get("slug") == name or f.get("name") == name), None)
if not match:
    print("FAIL|missing from project"); sys.exit(0)
status = match.get("status", "?")
version = match.get("version", "?")
# verify_jwt MUST be present and MUST be a real bool. Codex review v2 round-1
# [P1] — coercing missing/non-bool to False silently passes EXPECTED_JWT_FALSE
# entries when the API drops or renames the field.
if "verify_jwt" not in match:
    print(f"FAIL|verify_jwt missing from response v{version} status={status}"); sys.exit(0)
verify_jwt = match["verify_jwt"]
if not isinstance(verify_jwt, bool):
    print(f"FAIL|verify_jwt not bool (got {type(verify_jwt).__name__}={verify_jwt!r}) v{version} status={status}"); sys.exit(0)
expected = expected_jwt == "true"
if status != "ACTIVE":
    print(f"FAIL|status={status} (expected ACTIVE) v{version} verify_jwt={verify_jwt}"); sys.exit(0)
if verify_jwt != expected:
    print(f"FAIL|verify_jwt={verify_jwt} (expected {expected}) v{version} status={status}"); sys.exit(0)
print(f"OK|v{version} verify_jwt={verify_jwt} {status}")
PYEOF
)
  case "$RESULT" in
    OK\|*)
      echo "✓ ${NAME} ${RESULT#OK|}"
      PASS=$((PASS + 1))
      ;;
    *)
      echo "✗ ${NAME} — ${RESULT#FAIL|}"
      FAIL=$((FAIL + 1))
      ;;
  esac
}

echo "  verify_jwt = true (Supabase JWT enforced):"
for fn in "${EXPECTED_JWT_TRUE[@]}"; do
  assert_fn "$fn" "true"
done

echo ""
echo "  verify_jwt = false (external webhook / cron / public):"
for fn in "${EXPECTED_JWT_FALSE[@]}"; do
  assert_fn "$fn" "false"
done

echo ""
echo "  Drift check:"
DRIFT_OUT=$("$PY" - "$RESP_BODY" "${EXPECTED_JWT_TRUE[*]}" "${EXPECTED_JWT_FALSE[*]}" <<'PYEOF'
import json, sys
body_path, t, f = sys.argv[1], sys.argv[2].split(), sys.argv[3].split()
known = set(t) | set(f)
try:
    with open(body_path) as fp:
        fns = json.load(fp)
except Exception as e:
    print(f"PARSE_ERR|{e}"); sys.exit(0)
if not isinstance(fns, list):
    print(f"PARSE_ERR|expected array, got {type(fns).__name__}"); sys.exit(0)
unexpected = sorted(
    (fn.get("slug") or fn.get("name") or "<unnamed>")
    for fn in fns
    if (fn.get("slug") or fn.get("name")) not in known
)
print("UNEXPECTED|" + ",".join(unexpected) if unexpected else "OK")
PYEOF
)
case "$DRIFT_OUT" in
  OK)
    echo "  ✓ no drift — every deployed function is accounted for in the smoke roster"
    PASS=$((PASS + 1))
    ;;
  UNEXPECTED\|*)
    echo "  ✗ unexpected function(s) deployed but not in smoke roster: ${DRIFT_OUT#UNEXPECTED|}"
    echo "    → add to EXPECTED_JWT_TRUE or EXPECTED_JWT_FALSE in scripts/smoke-api.sh"
    FAIL=$((FAIL + 1))
    ;;
  PARSE_ERR\|*)
    echo "  ✗ drift check could not parse Management API response — ${DRIFT_OUT#PARSE_ERR|}"
    FAIL=$((FAIL + 1))
    ;;
esac

# ============================================================================
# Phase B — PostgREST + JWT (skipped if creds absent)
# ============================================================================
echo ""
echo "[Phase B] PostgREST + JWT login"

if [[ -z "${VITE_SUPABASE_URL:-}" || -z "${VITE_SUPABASE_ANON_KEY:-}" || -z "${DEMO_EMAIL:-}" || -z "${DEMO_PASSWORD:-}" ]]; then
  echo "  ⚠ skipped — VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / DEMO_EMAIL / DEMO_PASSWORD not all set."
  echo "    CI MUST export all four for full coverage. Phase A still ran."
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
