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
