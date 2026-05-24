# jordan-sales-agent — Codex follow-ups (P2 findings filed during Pattern B gates)

## useauth-timeout-no-clear — 25/05/2026

### soft-timeout-detaches-sessionpromise (Codex P2)

**Source:** Codex review round 3 on PR #71, finding triaged P2 at gate close.

**Finding (verbatim):**
> [P2] Keep handling getSession after the soft timeout — src/hooks/useAuth.ts:158
> When `getSession()` exceeds the 5s soft timeout, this `return` drops the original promise outcome because `Promise.race` has already settled. If `getSession()` then rejects or resolves before the 25s hard cap, the `.catch()`/success path here will not run; users either wait for the full hard cap on failures or depend entirely on a separate auth event for successful restores. Attach handlers to `sessionPromise` after the soft timeout or otherwise continue observing it.

**Why P2:** Defensive observability. In practice:
- Slow success path → `onAuthStateChange.INITIAL_SESSION` fires when the same internal `_initialize()` completes, populating state and clearing loading. Covered.
- Slow rejection path → no `INITIAL_SESSION` arrives with a session; the 25s hard cap eventually wipes storage and redirects. Recovery happens, just later than if we'd kept a `.catch()` on the in-flight promise.

Net: no correctness gap, just slower recovery in one specific failure pattern. Not user-visible on first day of cold-send (Jordan won't hit a 5s-to-25s window of getSession rejection in the morning-briefing deep-link flow this is meant to unblock).

**Action:** revisit if telemetry shows real users sitting on Loading… between 5s and 25s after a getSession rejection. Otherwise leave open. Trivial follow-up: attach `.then(handleSuccess).catch(handleFailure)` to `sessionPromise` directly so both soft-timeout success and rejection paths get the fast handlers instead of waiting on listener/hard cap.

---

## platform-hardening-pre-coldsend — 21/05/2026

### overlay-bundle-load-fallback (Codex P2)

**Source:** Codex review round 1 on PR `platform-hardening-pre-coldsend`, finding triaged P2 at gate close.

**Finding (verbatim):**
> [P2] Restore bundle-load fallback outside the bundle — src/main.tsx:51
> When the module script never executes, such as a stale cached HTML page pointing at a missing JS asset or a script resource load failure, this timer is never registered because it now lives inside `src/main.tsx`. The previous `index.html` timer was the only fallback for that class of blank-page failure, and the existing non-capturing `window` error listener is not a reliable substitute for script resource load errors.

**Why P2:**
The build plan explicitly required moving the timer into `main.tsx` to eliminate
false-positive overlays on slow networks. The bundle-never-loads case is rare
(stale HTML pointing at a deleted JS asset, typically only after a Vercel
deploy with cached HTML in CDN). Moving the timer was the user's directed
tradeoff. Adding a defensive long-window (15-20s) HTML-side fallback timer for
the bundle-never-executes case is a reasonable future enhancement but is
scope creep on this PR.

**Action:** revisit if Jordan or another user reports a blank-screen incident
where the bundle script element never executed. Otherwise leave open.

---

### gmail-inbound-verify-jwt-investigation (Codex P2)

**Source:** Codex review round 1 on PR `platform-hardening-pre-coldsend`, finding triaged P2 at gate close.

**Finding (verbatim):**
> [P2] Keep Gmail webhook off gateway JWT enforcement — scripts/smoke-api.sh:158
> For the Gmail Pub/Sub push path, expecting `gmail-inbound` to have `verify_jwt=true` makes the smoke test enforce a gateway setting that rejects Pub/Sub before the handler can run its `x-pubsub-token` check. Pub/Sub push requests do not carry a Supabase JWT, so this should stay in the unauthenticated-at-gateway set unless the webhook is redesigned to receive a valid Supabase bearer.

**Why P2:**
The smoke test was updated to MATCH the deployed reality, not to dictate it.
The deployed function is at v8 ACTIVE with `verify_jwt=true`. If that is wrong
in production, the smoke flagging the drift is the smoke doing its job —
forcing a human to look. Investigating whether `gmail-inbound` is actually
working in prod (e.g. Pub/Sub configured with OIDC bearer tokens, which
Supabase Edge would still parse as a JWT) is a separate task that requires
testing the inbound-reply path end-to-end. Item #6 in this BUILD (reply
classifier dry run) tests `classify-reply-intent` directly via curl — it
does NOT exercise the Pub/Sub → gmail-inbound path.

**Action:** as part of the cold-send Day 0 sweep, verify Pub/Sub push to
`gmail-inbound` actually fires and the inbound path classifies+stores
correctly. If broken, either (a) flip the function to `verify_jwt=false` and
re-enable the function-side `x-pubsub-token` guard, or (b) keep verify_jwt=true
and configure Pub/Sub OIDC bearer tokens. Update the smoke roster accordingly.

---

## broadsheet-sitemap-migration — 24/05/2026

### broadsheet-sitemap-failure-observability (Codex P2)

**Source:** Codex review round 2 on PR `fix/broadsheet-sitemap`, finding triaged P2 at gate close.

**Finding (verbatim):**
> [P2] Propagate sitemap fetch failures — supabase/functions/publication-poll/index.ts:249-250
> When the Broadsheet sitemap request times out or returns a non-2xx status, this returns `[]`, so the handler reports `articles: 0` with no `summary[source].errors`. Because this replaces the previous RSS path where fetch failures threw and were surfaced by the per-source catch, a broken or blocked Broadsheet sitemap would now look like a successful poll with no new articles; the top-level sitemap failure should be propagated while still skipping individual bad articles.

**Why P2:**
The BUILD spec explicitly required: *"On total sitemap fetch failure (network
error or non-200), return `[]`."* The current implementation matches the spec
literally — a sitemap failure produces an empty result rather than throwing.
A `console.warn(...)` is emitted with the upstream status code, so the failure
is visible in function logs, just not in the per-source error summary.

Codex itself classified the finding P2. The observability regression vs. the
old RSS path is real but mitigated by the warn-level log line. The fix
(threading the sitemap failure into `summary[source].errors`) is small but
deviates from the literal spec contract and would best be paired with the
same observability treatment for the other 6 sources (Timeout, Good Food,
etc. all currently swallow failures the same way).

**Action:** revisit when consolidating Phase 2 sourcing observability — at
that point, refactor all 7 source fetchers to return a typed
`{ articles, fetch_error? }` shape and have the main handler propagate the
fetch_error into `summary[source].errors`. Until then, function logs are the
source of truth for sitemap-level outages.

---

## crawl-venue-contacts — 25/05/2026

### crawler-retry-on-contact-insertion-failure (Codex P2)

**Source:** Codex review round 2 on PR `feat/crawl-venue-contacts`, finding
triaged P2 at gate close.

**Finding (verbatim):**
> [P2] Retry venues when contact insertion fails — supabase/functions/crawl-venue-contacts/index.ts:379-382
> If the contact upsert returns `insErr` for any reason, this only logs the
> error and then continues to set the venue status from `crawl.emails.size`,
> usually `crawled_found`. For crawls that found emails but failed to write
> them, the venue leaves the pending queue with zero new contacts and will
> not be retried by the cron drainer.

**Why P2:**
Live smoke confirmed the upsert path works end-to-end for both test venues
(Brunetti + Humble Rays), and Pattern B round 2 resolved the only path that
could plausibly hit `insErr` mid-build (the partial-index incompatibility).
Remaining `insErr` triggers would be transient PG outages or schema drift —
both of which need broader sourcing-pipeline retry semantics, not a one-off
band-aid in the crawler.

**Action:** revisit when the sourcing pipeline gets a generalised retry
shape (Phase 3 — exponential backoff + dead-letter queue across all 3
discovery engines). At that point, distinguish `failed_transient`
(reschedule) from `failed_permanent` (manual review) and move both venues +
contacts into that pattern. Until then, accept that a rare transient
upsert error will leave a venue at `crawled_found` with zero contacts and
require manual re-trigger via the `leadflow_drain_crawl_queue()` SQL probe.

### crawler-preserve-nested-hrefs (Codex P2)

**Source:** Codex review round 3 on PR `feat/crawl-venue-contacts`, finding
triaged P2 at gate close.

**Finding (verbatim):**
> [P2] Preserve discovered contact hrefs — supabase/functions/crawl-venue-contacts/index.ts:256-259
> When a homepage links to a contact page below a nested path, such as
> `/locations/carlton/contact-us` or `/venues/foo/team`, this code collapses
> the link to only the matched slug and then fetches `${base}/${path}`.
> Those venues will have their real contact page skipped and can be marked
> `crawled_empty` even though the email is on the linked page; keep and
> resolve the actual href instead of rebuilding a root-level URL.

**Why P2:**
The POC + first-cohort smoke (Carlton venues) consistently published
contact pages at root-level slugs (`/contact-us`, `/about`, etc.). The
nested-href case Codex describes is a real but rarer pattern — typically
multi-location franchises (`/melbourne/contact`, `/locations/<x>/contact`).
None of the current discovery-engine inputs (Outscraper / Google Places /
VCGLR) bias toward franchise sites, so the hit rate is bounded.

**Action:** revisit when the crawler hit rate for franchise venues
specifically drops below 30% (currently unmeasured; baseline metric to
collect during the Phase 3 sourcing observability rework). Fix shape:
preserve the full `href` from the `findLinkedPaths` match alongside the
slug, resolve it via `new URL(href, base).toString()`, and dedup against
already-visited URLs before fetching. Until then, root-level fallbacks
(`/contact`, `/contact-us`) still hit for franchise sites whose corporate
brand publishes a parallel root contact page.

---

## calendly-rip — 25/05/2026

### book-slug-fallback-route (Codex P2)

**Source:** Codex review round 1 on PR #70 (chore/rip-calendly), finding triaged P2 at gate close.

**Finding (verbatim):**
> [P2] Preserve old booking URLs with a fallback — src/App.tsx:63
> If any prospects follow `/book/:slug` URLs that were already sent by previous drafts or copied from Settings, removing this public route makes React Router fall through to `*`, redirect to `/dashboard`, then send unauthenticated users to login. If booking is being retired, keep a public fallback route that explains meetings are booked manually or asks them to reply, otherwise existing CTAs become broken login links.

**Why P2:**
Theoretical legacy scenario. The Calendly card and booking page were
never promoted to Jordan's day-to-day workflow — voice rules explicitly
told the AI NOT to include booking links, so the universe of already-
sent `/book/:slug` URLs in the wild is near zero. Recipients clicking
the rare stray link land on `/login` (after the `*` redirect), which is
mildly confusing but not a customer-visible failure path. Adding a
public fallback page is reasonable polish but expands the scope beyond
"rip Calendly".

**Action:** revisit if Jordan reports any prospect emailing back asking
"why is your booking page broken". Otherwise leave open.

---

### legacy-voice-rules-public-booking-url (Codex P2)

**Source:** Codex review round 1 on PR #70 (chore/rip-calendly), finding triaged P2 at gate close.

**Finding (verbatim):**
> [P2] Block legacy voice rules from emitting booking links — supabase/functions/generate-draft/index.ts:269
> For users who already saved voice rules based on the previous placeholder, such as `Always reference {{public_booking_url}}`, this new no-booking instruction can still be overridden by the user-configured rules appended below while `public_booking_url` is no longer supplied. In that scenario drafts can emit a literal or dead booking token/link, so scrub or ignore legacy booking rules, or make the no-booking rule non-overridable.

**Why P2:**
Jordan is the only operator on this tenant. His current `voice_rules`
do not reference `{{public_booking_url}}` (placeholder text in
SettingsPage was the only place that token appeared, and it was just
example placeholder copy, not Jordan's actual saved value). The new
system-prompt sentence ("Do not include any external booking,
scheduling, or calendar links. Jordan books meetings manually…") gives
Claude an unambiguous directive even if a stale rule slipped through.
Auditing every tenant's voice_rules for the literal `{{public_booking_url}}`
token is reasonable hygiene but defensive.

**Action:** revisit if Jordan reports an outbound draft containing a
literal `{{public_booking_url}}` token or a dead `/book/...` URL.
Mitigation if it happens: edit Jordan's saved voice rules in Settings
to remove the offending instruction. Otherwise leave open.
