# PLAN — Route no-email venues into the Call Cycle (physical prospecting)

**Requested by Jordan, 14/07/2026 (voice note).** Idea: venues we can't find an email for shouldn't be dead weight — feed them into the existing Call Cycle so Jordan can cold-call / physically visit them, building an area-based route over successive weeks.

**Status: QUEUED — dispatch AFTER `feat/inhouse-email-enrichment` (PID 3405) lands and merges.** Do not run concurrently: both touch venues + crawler/enrichment classification and share the same repo working tree (git working-tree concurrency lesson).

## Why this is the right shape
Enrichment (Places → crawl → pattern-guess → verify) will resolve a large share of name-only venues to a real email (dry pass found ~317 resolvable). But a residual set will be TRUE dead-ends: no website Places can find, no published email, no guessable domain. Those still have a NAME + SUBURB (+ often a phone from Places). That's enough to cold-call or walk in. Rather than discard them, they become the physical-prospecting funnel.

## Existing infra to REUSE (do not rebuild)
- `src/pages/RoutePage.tsx` — Call Cycle Planner (weekly diary; anchor + radius suggests stops; opens Maps; mark-visited writes field log + bumps deal). StopKind = prospect | follow_up | anchor.
- `src/lib/queries/route.ts` — route_days / route_stops model, `useRouteWeek`, `useMarkRouteStopVisited`, radius_km, anchor_venue.
- `src/lib/queries/field.ts` + `field_visits` table, `FieldOutcome` enum (`src/lib/fieldOutcomes.ts`).
- venues.lat/lng already geocoded (geocode-venues-batch). venues.phone / formatted_phone (Places populates on resolve).

## Scope
1. **Classify the residual.** After enrichment runs, a venue is a "call-cycle candidate" when: no deliverable email AND not archived/excluded, but HAS a suburb and ideally lat/lng and/or a phone. Add a derived flag/view (additive) — e.g. `venues.outreach_channel` = 'email' | 'phone_only' | 'visit_only' | 'none', computed from what enrichment found (email vs phone-only vs name+suburb only). Additive migration only.
2. **Feed them into the call cycle.** Extend the route-stop suggestion query so phone_only / visit_only venues in the chosen anchor+radius are offered as `prospect` stops. Show phone number on the stop card when present (tap-to-call). Distinguish "call first" (has phone) from "walk-in" (no phone, address only).
3. **Area-based multi-week build.** Let Jordan build a call cycle for an AREA that persists/accumulates over weeks: group candidates by suburb/cluster, track which have been visited/called (field_visits already does this), and surface "not yet contacted in this area" so the cycle works through a region over successive weeks without repeating done ones. A simple per-area coverage view (X of Y venues in <suburb> contacted).
4. **Outcomes loop back.** A call/visit outcome (interested / not interested / callback / got-email-on-visit) writes to field_visits (exists). If Jordan collects an email on a visit, it flows back into the normal verify→draft pipeline. Reuse FieldOutcome; add a 'collected_email' path if not present (additive).
5. **Human gate unchanged.** This is a physical/manual channel — no automated sending involved. No permission/sharing changes, no deletions, additive migrations only, org-scoped, RLS preserved.

## Report on completion
- how many venues classified phone_only vs visit_only vs still-none
- call-cycle candidate count by suburb (top areas)
- PR number + preview URL
- confirm no regression to email enrichment or the send gate

## Process
- Branch `feat/no-email-to-callcycle` off main (AFTER enrichment merges).
- Codex Pattern B gate: `codex review --base main` (this codex version rejects a prompt arg with --base — run bare). Iterate to CLEAN.
- Build green + tsc clean. Open PR, report to LeadFlow group.
