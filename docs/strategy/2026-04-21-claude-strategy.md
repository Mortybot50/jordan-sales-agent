# Jordan Sales Agent — Strategy Notes

*Captured: 2026-04-21 (AEST) · Last updated: 2026-04-24*

This is the narrative source-of-truth for why Jordan exists, who it's for, and
how we build it. The roadmap in `weeks.md` tells you *what* ships when; this
document tells you *why* each decision was made.

---

## The target user

Melbourne-based hospitality consultant (single user for now: Morty) selling
into venue operators and GMs. The ICP is narrow on purpose:

- **Cover count**: 50–400/night
- **Suburb**: inner Melbourne — Fitzroy, Collingwood, Richmond, CBD, Carlton,
  South Yarra, Prahran, Windsor, St Kilda
- **Licence**: on-premise, late-trade preferred
- **Spend tier**: $$–$$$ (not fine-dining unicorns, not chain QSR)
- **Decision-maker**: owner-operator or GM — usually one person, not a procurement committee

Hospitality benchmarks that shape every metric in the product:

| Metric | Hospitality band | Notes |
|---|---|---|
| Cold-to-meeting conversion | 3–5% | Benchmark for Australia/NZ hospitality cold outreach |
| Reply rate (sequences) | 8–14% | Lower than SaaS because inboxes are noisier |
| Sales cycle | 60–90 days | Single-DM, but seasonality matters (don't pitch in Melbourne Cup week) |
| Qualified meetings/week | 8–12 | Realistic ceiling for one consultant working one niche |
| Lead score threshold | ≥60 | Daily-focus cut-line on the 0–100 scale |

These aren't placeholder copy — they're the numbers the product is tuned to.
Every tile, tooltip, and meter rail anchors to these bands.

---

## Why Jordan (vs. off-the-shelf CRMs)

HubSpot, Pipedrive, and Apollo are built for SaaS SDR teams. They assume:

1. Multiple reps with visibility/handoff needs
2. Generic B2B benchmarks (20% reply rate is "good" in their world)
3. Venue info doesn't matter — everyone's a generic "company"

Jordan inverts all three:

- **One-operator mode**: no seats, no assignments, no territory. The CRM *is*
  the rep's brain, not a reporting tool for their manager.
- **Hospitality-native metrics**: every benchmark matches the real ceiling in
  this niche. A 12% reply rate is a *win* here, not a red flag.
- **Venue-first data model**: cover count, licence, kitchen style, service
  style, spend tier live on the venue; contacts attach to venues. Matches how
  the user actually thinks about leads.

The wedge is tight: one person, one niche, one city. That's intentional. A
broader product dilutes the hospitality-specific insight.

---

## Architecture decisions

### Stack

- **Frontend**: Vite + React 18 + TypeScript + Tailwind v4 + shadcn/ui
- **Backend**: Supabase (Sydney region — `bsevgxhnxlkzkcalevbb`)
- **Hosting**: Vercel (prod: https://jordan-sales-agent.vercel.app)
- **Scheduled work**: pg_cron + pg_net (no external scheduler)

### Why Supabase in Sydney

Latency for a Melbourne user + Aussie data residency for venue contact info.
RLS is aggressive — every table filters on `auth.uid()` — because this is a
single-tenant-per-row app and mistakes get personal data leaked.

### Why no background workers yet

Every async job (briefing generation, learning loop, score recompute) runs as a
`pg_cron` SQL function or an Edge Function triggered by cron. Adding a worker
tier would double infra cost for zero user-visible benefit at current scale.

---

## Design DNA — "Dark Anchor"

The visual identity is deliberately different from typical CRM tooling:

- **Dark anchor KPI cards** (near-black `--jordan-ink`) contrasted against a
  warm off-white surface. The eye lands on the KPIs first, then the pipeline.
- **Segmented meter rails** (not progress bars) for counted-towards-target
  metrics. Reads as "how many out of the target band" not "percent done".
- **Mint/amber/danger tones** for meter states. Mint = in target band, amber
  = mid, danger = below. Never uses raw colour without a semantic meaning.
- **Tracked ALL-CAPS labels** (letter-spacing 0.08–0.12em) for KPI headings.
  Gives the dashboard a "trading terminal" feel that matches the "each number
  means something" promise.
- **No decorative gradients, no glassmorphism, no emoji KPIs.** Every element
  has to earn its pixels.

Design tokens live in `src/index.css` under `--jordan-*`. Don't introduce new
colours without updating the token sheet first.

---

## Commercial context (Week 4 → 6 runway)

### Why we're pre-building Sending Infrastructure now

Morty's work Gmail is filtered through Purezza IT, which blocks cold-outreach
volume at the gateway. The only path forward is:

1. Buy a dedicated domain (~$15/yr) — e.g. `pithhospitality.co`
2. Add Google Workspace (~$19/mo)
3. Wire it to a warming service (Instantly.ai or similar)
4. Warm for 21 days before touching cold volume

The Settings → Sending Infrastructure card (Week 4) captures state so Jordan
can reason about it (e.g. "your warmup is on day 6 of 21 — hold cold sequences
until day 14"). The actual outbound-sending integration lands Week 6.

### Why CSV hygiene now (before sending)

Dirty lists kill sender reputation. Even before we send anything, we want
Jordan to be the thing that *refuses* to import a list of `info@` addresses or
obvious typos. Week 4 ships regex + MX DNS + role/freemail detection;
NeverBounce-grade verification ships Week 6 with the paid tier.

### Why swap "Meeting Rate %" → "Qualified Meetings · this week"

Morty doesn't optimise a percentage. He optimises "did I book enough this
week to hit the target band". The weekly count with an 8–12 target is a
direct, actionable ritual. The Jordan Score still uses the monthly count for
composite scoring — that metric hasn't changed.

---

## Non-negotiables

- **One decision-maker per venue.** Don't add multi-contact deal support —
  that would force the user to choose who to follow up with, which defeats
  the focus of the product.
- **No lead-gen marketplace.** Morty sources leads via existing hospitality
  relationships + his own scraping. Jordan doesn't need to be a data provider.
- **No AI-generated first-drafts in prod copy.** Every tooltip, empty-state,
  and banner string has to sound like a hospitality consultant wrote it.
  Generic B2B SaaS voice is banned.
- **Commits authored by `mortybot50@gmail.com`.** Non-negotiable. No AI
  co-author lines on main-branch commits unless explicitly requested.

---

## What success looks like (Week 8 review)

- Morty trusts Jordan enough to open it first thing every morning, no fallback
  to a spreadsheet
- 8–12 qualified meetings/week sustained for 3 weeks running
- Sending infrastructure warmed, DNS green, zero inbox-placement issues
- CSV hygiene catches ≥80% of bad addresses before they hit the suppression list
- Voice rules encode enough of Morty's style that drafts rarely need editing

If we're not there by Week 8, the wedge is wrong and we revisit ICP, not features.
