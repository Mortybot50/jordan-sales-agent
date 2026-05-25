#!/usr/bin/env bash
# smoke-poll-replies.sh
#
# Smoke for the poll-replies Edge Function. Two parts:
#
#   PART A (automated): probes the function's auth gate and 200-response shape
#     with a service-role JWT. Exit 0 if function HTTP-200s without crashing.
#     Run this in CI after every deploy.
#
#   PART B (manual, documented only): end-to-end IMAP reply match. Pure-shell
#     can't synthesise an IMAP message — see the comments below for the
#     manual steps Jordan should run post-deploy to verify the full pipeline
#     (event row + activity row + sequence_enrollment update + auto-suppress
#     when intent='unsubscribe').
#
# Usage: bash scripts/smoke-poll-replies.sh
# Exit 0 on PASS, 1 on FAIL.

set -uo pipefail

PROJECT_REF="bsevgxhnxlkzkcalevbb"
SUPABASE_URL="https://${PROJECT_REF}.supabase.co"

SR=$(supabase projects api-keys --project-ref "$PROJECT_REF" 2>/dev/null | grep service_role | awk -F'|' '{print $2}' | tr -d ' ')
ANON=$(supabase projects api-keys --project-ref "$PROJECT_REF" 2>/dev/null | grep " anon " | awk -F'|' '{print $2}' | tr -d ' ')

if [ -z "$SR" ] || [ -z "$ANON" ]; then
  echo "FAIL: Could not load Supabase API keys for $PROJECT_REF."
  echo "      Run 'supabase login' first."
  exit 1
fi

echo "=== PART A: function auth gate + 200 response ==="

# Anonymous (no JWT) must be rejected by the gateway (verify_jwt=true).
ANON_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  --max-time 15 \
  "$SUPABASE_URL/functions/v1/poll-replies")
if [ "$ANON_STATUS" != "401" ]; then
  echo "FAIL: expected 401 from anonymous POST, got $ANON_STATUS"
  exit 1
fi
echo "PASS: anonymous POST -> 401"

# Anon-key JWT should also fail (role != service_role).
ANON_KEY_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Authorization: Bearer $ANON" \
  -H "apikey: $ANON" \
  -H "Content-Type: application/json" \
  --max-time 15 \
  "$SUPABASE_URL/functions/v1/poll-replies")
if [ "$ANON_KEY_STATUS" != "401" ]; then
  echo "FAIL: expected 401 from anon-key POST, got $ANON_KEY_STATUS"
  exit 1
fi
echo "PASS: anon-key POST -> 401"

# Service-role JWT should succeed (200 with success:true).
RESP=$(curl -s -X POST \
  -H "Authorization: Bearer $SR" \
  -H "apikey: $SR" \
  -H "Content-Type: application/json" \
  --max-time 30 \
  "$SUPABASE_URL/functions/v1/poll-replies")
echo "Service-role response: $RESP"

OK=$(echo "$RESP" | python3 -c "import sys,json
try:
  d = json.load(sys.stdin)
  print('1' if d.get('success') is True else '0')
except Exception:
  print('0')
" 2>/dev/null)

if [ "$OK" != "1" ]; then
  echo "FAIL: service-role POST did not return success:true"
  exit 1
fi
echo "PASS: service-role POST -> success:true"

echo
echo "=== PART B: manual end-to-end verification (documented only) ==="
cat <<'MANUAL'

To prove the IMAP match pipeline end-to-end, Jordan needs to:

1. Find a recent outbound send from his own connected Gmail account, e.g.:

     select id, to_email, subject, smtp_message_id
       from email_send_queue
      where status = 'sent'
        and email_account_id = '<jordan-account-id>'
      order by sent_at desc
      limit 5;

2. From a DIFFERENT inbox (e.g. a personal Gmail), open the original cold
   email Jordan sent and click Reply. Send a one-line reply. Critically, the
   reply MUST preserve the original In-Reply-To header (which any normal
   mail client does automatically).

3. Wait up to 5 min for the next poll-replies cron tick.

4. Verify the event row landed:

     select event_type, metadata->>'reply_subject', metadata->>'in_reply_to'
       from email_send_events
      where send_queue_id = '<the-id-from-step-1>'
      order by event_at desc;

   Expect a row with event_type='replied' and matching in_reply_to.

5. Verify the activity row + classifier ran:

     select activity_type, metadata->>'intent', metadata->>'intent_confidence'
       from activities
      where contact_id = '<contact-from-the-original-send>'
      order by occurred_at desc
      limit 1;

   Expect activity_type='reply_received' and an intent value
   (positive/objection/etc).

6. If the active sequence_enrollment exists for that contact, verify:

     select status, completed_at, last_status_message
       from sequence_enrollments
      where contact_id = '<contact-id>'
      order by enrolled_at desc
      limit 1;

   Expect status='reply_received' with a completed_at timestamp.

7. Verify reply_scan_runs has logged the tick:

     select status, scanned_messages, matched_replies, classified_replies, errors
       from reply_scan_runs
      where email_account_id = '<jordan-account-id>'
      order by started_at desc
      limit 3;

   Expect status='success' or 'partial' with matched_replies >= 1.

If you reply with "unsubscribe me" specifically, the classifier should fire
suppression — verify the contact's email now appears in suppression_list with
reason='unsubscribe'.

MANUAL

echo "=== PART A complete. PART B requires manual reply. ==="
exit 0
