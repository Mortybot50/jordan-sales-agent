# jordan-sales-agent — Codex follow-ups (P2 findings filed during Pattern B gates)

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
