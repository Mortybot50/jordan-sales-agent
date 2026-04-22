# Jordan Sales Agent — Design Shotgun

Four visual directions for the UX/UI makeover. Each direction is a standalone HTML prototype using Tailwind CDN — open any `index.html` in a browser, no build step.

Same sample data across all four (Sarah Chen / Canva / Oak Room EOFY as the focal lead) so you're comparing aesthetics, not content.

**Generated:** 22 Apr 2026
**Scope:** Dashboard + Pipeline (Kanban) + Lead Detail per direction. 12 screens + 4 direction landing pages.

---

## TL;DR — pick one to start

| # | Direction | One-line personality | Best if you want to… |
|---|-----------|----------------------|----------------------|
| 01 | **Obsidian** | Bloomberg terminal × Linear. Black, monospace, ticker-dense. | …feel like an operator. Speed above all. |
| 02 | **Atelier** | Editorial hospitality magazine × Notion. Cream, serif, venue photography. | …lean into the hospitality brand. Feel premium, not "SaaSy". |
| 03 | **Concierge** | Superhuman-calm × Arc. White, large type, one-thing-at-a-time. | …assert power through restraint. Calm, focused, beautiful. |
| 04 | **Atlas** | Attio × Airtable. Dense grids, inline edits, faceted filters. | …give power-users every lever. Spreadsheet soul, CRM shape. |

They genuinely disagree. No two could have come from the same team.

---

## 01 — Obsidian

**Path:** [`obsidian/index.html`](./obsidian/index.html)
**Screens:** [dashboard](./obsidian/dashboard.html) · [pipeline](./obsidian/pipeline.html) · [lead detail](./obsidian/lead-detail.html)

- Pure black `#0a0a0a`, panels `#141414`, amber/green/red/cyan accents
- JetBrains Mono everywhere, tabular numbers, unicode sparklines (▁▂▃▄▅▆▇█)
- Persistent top status bar + bottom keyboard hint strip (`[N] new lead  [/] search  [⌘K] command`)
- No rounded corners beyond 2px, zero soft shadows, hard edges

| Pro | Con |
|-----|-----|
| Ruthlessly fast for power users | Hostile to anyone who hasn't used Bloomberg/Linear |
| Feels like a professional operator tool, not a website | Less shareable — prospects/partners won't instantly love it |
| Dense information density — every pixel earns keep | Dark mode commitment — night-only aesthetic |

---

## 02 — Atelier

**Path:** [`atelier/index.html`](./atelier/index.html)
**Screens:** [dashboard](./atelier/dashboard.html) · [pipeline](./atelier/pipeline.html) · [lead detail](./atelier/lead-detail.html)

- Cream `#f5f1ea` background, burgundy + forest + antique gold accents
- Fraunces (serif display) + Inter (body), generous 64px padding
- Unsplash venue photography is a first-class component
- Lead detail has a 16:6 photo hero with dark gradient — magazine feature vibe

| Pro | Con |
|-----|-----|
| Hospitality-native — feels like YOUR industry | Photography dependency — images must be curated, not decorative |
| Will make Morty's brand look world-class | Lower data density per screen |
| Opposite of shadcn starter — zero SaaS-cliché | Slower for pure-data power-user work |

---

## 03 — Concierge

**Path:** [`concierge/index.html`](./concierge/index.html)
**Screens:** [dashboard](./concierge/dashboard.html) · [pipeline](./concierge/pipeline.html) · [lead detail](./concierge/lead-detail.html)

- Pure white, `#0a6e5f` deep teal as the only accent (amber only for "Hot")
- Inter + Instrument Serif italic for display moments
- Narrow 60px letter-rail navigation
- **The core move:** dashboard shows ONE thing that matters right now; pipeline dims all but the focused column; lead detail centers the draft to approve, nothing else
- Intentional 200px+ trailing whitespace on every screen

| Pro | Con |
|-----|-----|
| Beautiful, calm, modern — feels like a 2025 Superhuman-tier product | Hides density some operators want |
| Focus by default — draft-first workflow matches Jordan's actual job | Wasteful on big monitors; unused real estate may frustrate |
| Defendable design language — hard for competitors to copy | Slower for bulk data-entry work |

---

## 04 — Atlas

**Path:** [`atlas/index.html`](./atlas/index.html)
**Screens:** [dashboard](./atlas/dashboard.html) · [pipeline](./atlas/pipeline.html) · [lead detail](./atlas/lead-detail.html)

- White/`#fafbfc` surfaces, hairline borders, electric blue `#2563eb`
- Inter 13px body, JetBrains Mono tabular numbers
- Faceted filter chip bar, bulk-select checkboxes, sticky table headers, Lucide icons
- Nested sidebar with Overview / Sales / Automation / Insights / Settings sections
- Lead detail is a full Attio-style entity page: left field grid with inline-edit, center activity table with filters, right deal + AI draft + score bars + linked records

| Pro | Con |
|-----|-----|
| Power-user heaven — every lever visible | Higher cognitive load for new users |
| Most familiar to anyone coming from Salesforce/HubSpot/Attio | Feels "professional" but less distinctive |
| Scales well as the CRM grows in complexity | Risks shadcn-adjacent if not differentiated hard |

---

## Quick compare at a glance

| Axis | Obsidian | Atelier | Concierge | Atlas |
|------|----------|---------|-----------|-------|
| **Background** | Black | Cream | White | Off-white |
| **Accent** | Amber/green/red | Burgundy/gold | Deep teal | Electric blue |
| **Font** | JetBrains Mono | Fraunces + Inter | Inter + Instrument Serif | Inter + JB Mono |
| **Density** | Very high | Low–med | Very low | Very high |
| **Personality** | Operator | Editorial | Calm | Power-user |
| **Body text size** | 13px mono | 15-16px | 17-18px | 13px |
| **Photos** | None | Venue photography | None | None |
| **Icons** | Unicode only | Minimal ornamental | Minimal | Lucide SVG |
| **Keyboard-first?** | Yes, aggressive | No | Yes, gentle | Yes, standard |
| **Best for** | Speed & density | Brand & polish | Focus & clarity | Data ops |
| **Risk** | Too harsh for non-operators | Slow for bulk work | Hides too much | Familiar = forgettable |

---

## Recommendation

My gut: **Atelier or Concierge** — both escape the shadcn starter cage by committing hard to a specific personality. Atlas is safest but reads as "competent SaaS CRM" rather than "this is special". Obsidian is the most technically impressive but narrowest market.

If Morty's pitch is "premium hospitality sales copilot" → **Atelier**. If it's "calm, intelligent, Superhuman-for-events" → **Concierge**. Can also combine: Atelier brand/marketing surfaces + Concierge focus discipline inside the app.

---

## Next steps

1. Open all four `index.html` in separate tabs, click through each screen
2. Pick a direction (or a 60/40 blend)
3. Run `/plan-eng-review` to translate the chosen direction into a rollout plan
4. Or `/design-consultation` to formalise it into a DESIGN.md the whole app can be refactored against

Nothing in the live app source was modified. These are throwaway prototypes — decide freely.
