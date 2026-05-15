#!/usr/bin/env bash
# LeadFlow API smoke v2 — Supabase Management API rewrite (Wave 3A-A).
#
# Zero HTTP calls to function handlers. Pure metadata read against
#   GET https://api.supabase.com/v1/projects/{ref}/functions
# Returns per-function status + version + verify_jwt flag. No side effects.
#
# Closes Codex review v2 residuals on PR #46 (12/05/2026):
#   [P1] OPTIONS could trigger handlers without a method-guard.
#   [P2] Only one function's verify_jwt was being checked.
#
# Run:   bash scripts/smoke-api.sh
# Alias: npm run smoke
#
# Exit 0 = every function in the expected roster is ACTIVE and the verify_jwt
# truth table matches. Non-zero = at least one mismatch, missing function, or
# Management API failure.
#
# Auth: SUPABASE_ACCESS_TOKEN (Supabase CLI Personal Access Token). Resolved
# in order:
#   1. Environment variable SUPABASE_ACCESS_TOKEN (CI-friendly).
#   2. macOS Keychain — `security find-generic-password -s "Supabase CLI" -a supabase -w`
#   3. macOS Keychain — `security find-generic-password -s supabase -a supabase -w`
# If none resolve, the script fails loudly with the `security add-generic-password`
# command needed to provision it.
#
# Truth table source: verified 2026-05-15 against live project bsevgxhnxlkzkcalevbb
# via `mcp__supabase__list_edge_functions`. Update EXPECTED_* arrays when
# functions are added/removed/flipped; the script will FAIL on first drift.
#
# Reference: ~/.openclaw/roles/dev/ppb-ops-hub/scripts/smoke-api.sh
# Discipline: ~/.claude/rules/dev/frontend-smoke.md §2

set -euo pipefail
export PATH="/usr/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

CURL=/usr/bin/curl
PY=/usr/bin/python3
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Source .env.local if present (gitignored). Optional for the v2 smoke — the
# Management API path doesn't need anon/JWT/demo creds — but kept for the
# script's previous callers who may export SUPABASE_PROJECT_REF here.
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
# Resolution order:
#   1. SUPABASE_ACCESS_TOKEN env var (CI-friendly).
#   2. Keychain entry written by the Supabase CLI. The CLI uses go-keyring,
#      which wraps the secret as `go-keyring-base64:<base64>`. We detect that
#      envelope and decode it.
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

echo "=== LeadFlow API smoke v2 (Management API) ==="
echo "Project: ${PROJECT_REF}"
echo ""

# ---------- Fetch function metadata ----------
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

# ---------- Expected truth table ----------
# verified 2026-05-15 against live project bsevgxhnxlkzkcalevbb.
# Update both arrays when the roster changes.
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

# ---------- Assert ----------
PASS=0
FAIL=0

assert_fn() {
  local NAME="$1"
  local EXPECTED_JWT="$2"   # "true" or "false"
  RESULT=$("$PY" - "$NAME" "$EXPECTED_JWT" "$RESP_BODY" <<'PYEOF'
import json, sys
name, expected_jwt, body_path = sys.argv[1], sys.argv[2], sys.argv[3]
with open(body_path) as f:
    try:
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
verify_jwt = bool(match.get("verify_jwt", False))
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

echo "--- verify_jwt = true (Supabase JWT enforced) ---"
for fn in "${EXPECTED_JWT_TRUE[@]}"; do
  assert_fn "$fn" "true"
done

echo ""
echo "--- verify_jwt = false (external webhook / cron / public) ---"
for fn in "${EXPECTED_JWT_FALSE[@]}"; do
  assert_fn "$fn" "false"
done

# ---------- Drift detection: unexpected functions in project ----------
echo ""
echo "--- Drift check ---"
UNEXPECTED=$("$PY" - "$RESP_BODY" "${EXPECTED_JWT_TRUE[*]}" "${EXPECTED_JWT_FALSE[*]}" <<'PYEOF'
import json, sys
body_path, t, f = sys.argv[1], sys.argv[2].split(), sys.argv[3].split()
known = set(t) | set(f)
with open(body_path) as fp:
    fns = json.load(fp)
unexpected = sorted(fn.get("slug") or fn.get("name") for fn in fns if (fn.get("slug") or fn.get("name")) not in known)
print(",".join(unexpected))
PYEOF
)
if [[ -n "$UNEXPECTED" ]]; then
  echo "✗ unexpected function(s) deployed but not in smoke roster: ${UNEXPECTED}"
  echo "  → add to EXPECTED_JWT_TRUE or EXPECTED_JWT_FALSE in scripts/smoke-api.sh"
  FAIL=$((FAIL + 1))
else
  echo "✓ no drift — every deployed function is accounted for in the smoke roster"
  PASS=$((PASS + 1))
fi

echo ""
echo "=== ${PASS} passed, ${FAIL} failed ==="

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
