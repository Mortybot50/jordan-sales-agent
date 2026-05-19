# LeadFlow Native Sender — Cutover Runbook

*Plain-English day-by-day playbook for moving Jordan off Instantly and onto LeadFlow's own sender. Print this. Tick the boxes as you go.*

**Goal:** stop paying Instantly, keep deliverability the same or better, no surprise drop in replies. We do this slowly on purpose — 15 days, not overnight.

**Rule of thumb:** if any pause/rollback trigger fires (see bottom of doc), STOP, don't keep ramping. Better to spend an extra week than to torch a sending domain.

---

## What we're doing in one paragraph

Right now, Jordan's cold email goes through Instantly. We've built a like-for-like replacement inside LeadFlow itself — same warmup, same suppression, same RFC-compliant unsubscribe, same bounce handling, plus extra safety (per-inbox pacing, working-hours clamp, domain anti-clustering, Postmaster Tools tracking). Over the next two weeks we slowly tip volume from Instantly to LeadFlow, watching the reputation gauges every day. By Day 15, LeadFlow handles everything and Instantly's subscription can be cancelled.

---

## Before Day 0 — pre-flight (do this once)

Do these BEFORE the cutover begins. None of them are reversible later without effort.

- [ ] **DNS already set.** SPF, DKIM, DMARC on every sending domain (you've had these from Week 1). Confirm with `dig TXT <domain>` for each.
- [ ] **Postmaster verification TXT added** for each sending domain. Settings → Postmaster Tools → follow the steps. Wait 30 min, click Verify in postmaster.google.com. Data takes 48h to start showing.
- [ ] **Seed addresses set up.** Settings → Daily seed test. Add at least one of: Hotmail, Outlook, Gmail-personal, Proton, Yahoo. Five is the minimum. These are throwaway addresses you control.
- [ ] **Connect inboxes.** Settings → Email accounts. All sending inboxes connected. Each has `status='warming'` or `status='active'`. Daily cap set realistically (start 30, ramp to 50 over the warmup).
- [ ] **Spam Act sender block filled in.** Settings → Profile → "Spam Act sender block". This is the legally required physical address / ABN footer. Anything sent without it is illegal under Australian Spam Act 2003 s17.
- [ ] **Export Instantly data.** Run `npx tsx scripts/instantly-export.ts` (dry-run). Inspect the export dir under `/tmp/instantly-export-<timestamp>/`. Confirm suppression count matches what you see in Instantly's UI.
- [ ] **Import Instantly suppressions.** Re-run with `--confirm`. Verify count in Settings → Suppression list. This MUST happen before Day 0 — Day 0 starts re-emailing contacts that Instantly already had blocked, which kills deliverability instantly.
- [ ] **Backup access to Instantly.** Don't cancel the subscription yet. You'll need it as a fallback through Day 14.

---

## The 15-day cutover

Each day has a morning check (5 min) and an evening check (5 min). The traffic split is the one knob you turn. Everything else is automatic.

### Day 0 — go-live with 0% LeadFlow traffic

Goal: prove the system runs end-to-end with one or two real sends. No volume yet.

- [ ] Morning: log into Instantly, pause all running campaigns. (Sequences in Instantly stop. Contacts stay enrolled — they just don't tick forward.)
- [ ] In LeadFlow, send ONE manual draft from each connected inbox to your own personal email. Confirm it arrives. Open it. Click the unsubscribe link. Confirm you land on the LeadFlow unsubscribe page and that re-sending fails with "suppressed".
- [ ] Run today's seed batch. Settings → Daily seed test → "Run today's seed batch". Manually send the actual emails from each inbox to each seed address (you do this part — the system just tracks placement).
- [ ] Evening: open each seed mailbox. Record placement (inbox / promotions / spam / unknown) for each row.
- [ ] **Pass criteria for Day 1 ramp:** ≥80% of today's seeds landed inbox.

### Day 1 — 10% LeadFlow

Start moving a small slice across. Pick the 10% of contacts who matter LEAST (re-engagement / cold lists / old leads). Save the warmest contacts for Day 7+.

- [ ] Morning: bulk-update 10% of `active` Instantly campaign contacts to LeadFlow sequences. (Manual at this stage — pick the colder list.)
- [ ] Approve the queued drafts. (LeadFlow's existing approval flow — nothing new.)
- [ ] Evening: Analytics → Sending. Check:
  - Per-inbox reputation score ≥80 on every inbox.
  - 24h bounce rate <2%.
  - 0 spam complaints.
  - No "At risk" banner showing.
- [ ] Run seed batch. Record placement.

### Day 2 — hold at 10%, watch

Don't ramp yet. Let yesterday's sends generate replies and bounces. We need 48h of signal before we trust the numbers.

- [ ] Same morning + evening checks as Day 1.
- [ ] **Pass criteria for Day 3 ramp:** reputation ≥80 on every inbox, bounce <2%, ≥80% seed inbox placement.
- [ ] If FAIL: stay at 10% another day, investigate the worst inbox in Analytics → Sending, click the per-inbox card to see the breakdown.

### Day 3 — 20% LeadFlow

- [ ] Morning: bulk-move another 10% slice. Still cold-end of the list.
- [ ] Same checks as before.
- [ ] Evening seed batch.

### Day 4 — hold at 20%

- [ ] Pass criteria same as Day 2.
- [ ] If a single inbox has dropped below 75 reputation, pause it (Analytics → Sending → "Pause inbox" on the at-risk card). The other inboxes carry on.

### Day 5 — 30% LeadFlow

- [ ] By now Postmaster Tools should have 48h of data per domain. Record the grade. Should be High or Medium. If Low or Bad, STOP — see pause triggers below.

### Day 6 — hold at 30%

- [ ] Standard checks.

### Day 7 — 50% LeadFlow

Halfway. From here on you're moving warmer contacts. Be more careful.

- [ ] Morning: now move 20% of mid-temperature contacts.
- [ ] Reply rate matters here — your warm contacts should still reply at the rate they did on Instantly. A drop >20% vs the previous week is a deliverability red flag (even if seed test looks fine).

### Day 8 — hold at 50%

- [ ] Compare reply rate this week vs last week. Should be within 20%. If worse, investigate before ramping further.

### Day 9 — 70% LeadFlow

- [ ] Move another batch.

### Day 10 — hold at 70%

- [ ] Standard checks. Postmaster grade still High or Medium on every domain?

### Day 11 — 85% LeadFlow

- [ ] Move the next batch. Only the warmest contacts left on Instantly.

### Day 12 — hold at 85%

### Day 13 — 100% LeadFlow

- [ ] Move the final batch. Instantly campaigns should now have 0 active contacts.
- [ ] Re-run `scripts/instantly-export.ts --confirm` to capture any new suppressions Instantly recorded during the cutover (people who unsubscribed via Instantly's links in the last 14 days).
- [ ] Confirm the new rows landed in LeadFlow Settings → Suppression list.

### Day 14 — 100% LeadFlow, Instantly still on standby

Don't cancel yet. If something silently broke during the ramp, today is when you'd notice — a Day 7 contact replying, a forgotten campaign, a stuck sequence.

- [ ] Full audit. Read every "at risk" banner. Read Postmaster Tools history for the past week.
- [ ] Confirm: zero traffic going through Instantly today.

### Day 15 — cancel Instantly

- [ ] Export anything you want to keep from Instantly UI (campaign stats, A/B test history) — LeadFlow's history starts at cutover, you can't backfill the pre-cutover analytics.
- [ ] Cancel the Instantly subscription.
- [ ] Update Settings → Profile → remove the `VITE_INSTANTLY_API_KEY` env var from Vercel (it's only used by the export script; no live runtime dependency).
- [ ] Done. The native sender is now the only path out.

---

## Daily checks (5 min, morning + evening)

Open Analytics → Sending. Look for, in order:

1. **At-risk banner.** Red banner at top. If shown, click "Pause inbox" on the offending inbox immediately. Don't ramp today.
2. **Per-inbox reputation score.** Every inbox should be ≥80. If any inbox dips below 80, hold the daily cap on that inbox. Below 70 — pause it.
3. **Per-domain rollup table.** Bounce rate column should be <2% on every domain. Above 2% = problem domain — check which inbox is the worst contributor, pause it.
4. **Postmaster grade column.** High = great. Medium = fine but watch. Low = stop ramping, investigate. Bad = pause all sending on that domain immediately.
5. **Today's seeds.** Settings → Daily seed test. After morning send, check each seed mailbox. Inbox placement <80% = warning.
6. **Cron health widget.** Bottom of analytics page. Each cron should show `last_run_at` within the last hour and `last_http_status=200`. If any cron is red, ping DEV — sends will silently queue forever.

---

## Pause / rollback triggers

If ANY of these happen, STOP the ramp and pause sends on the affected inbox or domain.

### Hold-the-ramp triggers (don't make it worse)

- Per-inbox reputation score drops below 80 on any single inbox.
- 24h bounce rate >2% on any single domain.
- Daily seed inbox placement <80%.
- One single spam complaint event in the last 24h. (Spam complaints are catastrophic — even one is a signal something's off.)
- Postmaster Tools grade drops from High → Medium on any domain.
- Reply rate this week <80% of last week on warm contacts.

Stay at the current % for an extra day. Investigate. Don't ramp until 24h of clean signal.

### Pause-the-inbox triggers (something is wrong)

- Reputation <70 on an inbox → click "Pause inbox" in Analytics → Sending. Sends from that inbox stop. The others continue.
- Bounce rate >5% on an inbox in 24h → pause that inbox.
- ≥2 spam complaints in 24h on an inbox → pause that inbox. (One complaint is a warning; two is a pattern.)
- Postmaster grade = Low on a domain → pause ALL inboxes on that domain.

### Full-rollback triggers (turn it all off)

- Postmaster grade = Bad on any sending domain. Every inbox on that domain pauses immediately.
- A sending domain ends up on Spamhaus / Barracuda / Cisco Talos. Check via mxtoolbox.com.
- Reply rate drops >50% week-on-week with no other obvious explanation. Something's silently broken — either deliverability has tanked or the rendering is wrong.

If you full-rollback, the path back is:
1. Pause every LeadFlow inbox (Analytics → Sending → pause each one).
2. Un-pause Instantly campaigns. Move the affected contacts back to Instantly.
3. DM Morty / DEV with: what triggered the rollback, which domains/inboxes are affected, screenshots of the Postmaster grade history + reputation chart.
4. Don't try to fix it yourself live. Postmaster reputation takes 1-2 weeks to repair; rushing makes it worse.

---

## How LeadFlow keeps you safe (so you can sleep)

These run automatically — you don't need to remember them, just know what to look for in Analytics:

- **Per-inbox pacing.** No two sends from the same inbox within 90 seconds. Jittered with Poisson distribution so it doesn't look robotic.
- **Working-hours clamp.** Sends only fire 08:00-18:00 in your timezone. Anything queued outside that window gets pushed to the next 08:00.
- **Domain anti-clustering.** The system won't send two emails back-to-back from the same sending domain to the same recipient domain inside one tick — rotates accounts when there are alternatives.
- **Suppression guard.** Every approved draft is checked against the suppression list before enqueue. Suppressed drafts get marked `suppressed` and never reach the send queue. The +alias normalisation trigger means `user+anything@x.com` matches `user@x.com`.
- **Email verification gate.** Before enqueue, the address is checked via NeverBounce (or ZeroBounce if configured). `invalid` results in immediate suppression.
- **RFC 8058 one-click unsubscribe.** Every send carries the `List-Unsubscribe` and `List-Unsubscribe-Post` headers signed with HMAC. The body link also works. Confirmation page on GET, suppression on POST (which is what Gmail's one-click button does).
- **Bounce scanning.** `process-bounces` cron pulls Gmail IMAP every 30 min, parses DSN format, hard bounces auto-suppress, queue marked `failed`.
- **Reputation refresh.** Hourly cron recomputes every inbox's reputation score from the last 14 days of send events. Anything <50 surfaces in the "at risk" banner.

---

## Where to look when something feels off

| Symptom | First place to look |
|---|---|
| Sends not going out | Settings → Email accounts (inbox paused?) → Analytics → Sending (cron health widget) |
| Replies dropped | Postmaster Tools history (grade drift?) → Seed test placement (spam folder?) |
| Bounce alert fired | Analytics → Sending → per-inbox card with the spike → click to drill down to send events |
| Unsubscribe complaint from a contact | Suppression list — is the email present? If yes, system is doing its job. If no, something's wrong, escalate. |
| Postmaster grade = Bad | Stop sending on the domain. DM DEV. Don't try to recover live. |
| Cron widget shows red | Check `worker_runs` table via Admin → Workers page. DM DEV if the cron hasn't run in >2h. |

---

## Out of scope for this runbook

- Re-creating Instantly sequence templates 1-to-1. The shapes are different (Instantly: per-step delays with variants; LeadFlow: sequence steps with delays). You re-draft them by hand during the ramp.
- Backfilling old Instantly open/click stats. They stay readable in Instantly UI until you cancel; LeadFlow's stats start fresh at cutover.
- Migrating Instantly's "warmup network" reputation. Each LeadFlow inbox starts at score=50 and earns its way up via the actual send/reply/bounce history.

---

*Questions during the ramp: DM Morty in WhatsApp. Don't post in client groups — keep operational chatter out of sales channels.*
