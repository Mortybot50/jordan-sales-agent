#!/usr/bin/env bash
# smoke-vcglr.sh — end-to-end smoke for the vcglr-sync Edge Function.
#
# 1. Invokes the function with a service-role JWT.
# 2. Asserts response shape (status, snapshot_date, rows_inserted, duration_ms).
# 3. Asserts at least one row in vcglr_licences with council='MELBOURNE CITY COUNCIL'
#    so we know ICP councils are populated.
# 4. Asserts idempotency — a second invocation returns status=already_current
#    with rows_inserted=0.
#
# Usage: bash scripts/smoke-vcglr.sh
# Exit 0 = PASS, 1 = FAIL.

set -uo pipefail

PROJECT_REF="bsevgxhnxlkzkcalevbb"
SUPABASE_URL="https://${PROJECT_REF}.supabase.co"

SR=$(supabase projects api-keys --project-ref "$PROJECT_REF" 2>/dev/null \
  | grep service_role \
  | awk -F'|' '{print $2}' \
  | tr -d ' ')
if [ -z "$SR" ]; then
  echo "FAIL: could not load service-role key. Run 'supabase login' first."
  exit 1
fi

fire() {
  curl -s -X POST \
    -H "Authorization: Bearer $SR" \
    -H "Content-Type: application/json" \
    -d '{}' --max-time 120 \
    "$SUPABASE_URL/functions/v1/vcglr-sync"
}

count_melb() {
  curl -s \
    -H "apikey: $SR" \
    -H "Authorization: Bearer $SR" \
    "$SUPABASE_URL/rest/v1/vcglr_licences?council=eq.MELBOURNE%20CITY%20COUNCIL&status=eq.current&select=licence_number" \
    | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null \
    || echo "0"
}

echo "[1/4] First invocation..."
R1=$(fire)
echo "      $R1"

STATUS1=$(echo "$R1" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
if [ "$STATUS1" != "ok" ] && [ "$STATUS1" != "already_current" ]; then
  echo "FAIL: first invocation status='${STATUS1}' (expected ok or already_current)"
  exit 1
fi

SNAP=$(echo "$R1" | python3 -c "import sys,json; print(json.load(sys.stdin).get('snapshot_date',''))" 2>/dev/null)
if [ -z "$SNAP" ]; then
  echo "FAIL: response missing snapshot_date"
  exit 1
fi
echo "      snapshot_date=$SNAP status=$STATUS1"

DUR=$(echo "$R1" | python3 -c "import sys,json; print(json.load(sys.stdin).get('duration_ms',0))" 2>/dev/null)
if [ "$DUR" -gt 90000 ]; then
  echo "FAIL: duration_ms=$DUR > 90000"
  exit 1
fi

echo "[2/4] Counting City of Melbourne current licences..."
N_MELB=$(count_melb)
echo "      melb_current=$N_MELB"
# 50 = "first page underflow tolerance" — Melbourne CBD has ~2155 current
# licences per the 31-Oct-2025 snapshot. Anything < 50 would mean the
# council column failed to bind or the filter is mis-encoded.
if [ "$N_MELB" -lt 50 ]; then
  echo "FAIL: only ${N_MELB} current licences for MELBOURNE CITY COUNCIL — ICP join broken (expected >50)"
  exit 1
fi

echo "[3/4] Second invocation (idempotency check)..."
R2=$(fire)
echo "      $R2"
STATUS2=$(echo "$R2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
ROWS2=$(echo "$R2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('rows_inserted',-1))" 2>/dev/null)
if [ "$STATUS2" != "already_current" ]; then
  echo "FAIL: second invocation status='${STATUS2}' (expected already_current)"
  exit 1
fi
if [ "$ROWS2" != "0" ]; then
  echo "FAIL: second invocation rows_inserted=$ROWS2 (expected 0)"
  exit 1
fi

echo "[4/4] Confirming no duplicate rows on rerun..."
N_MELB_AFTER=$(count_melb)
echo "      melb_current=$N_MELB_AFTER"
if [ "$N_MELB_AFTER" != "$N_MELB" ]; then
  echo "FAIL: melb count drifted across rerun ($N_MELB → $N_MELB_AFTER)"
  exit 1
fi

echo "PASS: vcglr-sync smoke green (snapshot=$SNAP, ${N_MELB} CoM rows, idempotent)"
exit 0
