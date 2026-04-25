# Ship summary — Dashboard Interactive (Bug 1 + Bug 2)

**Date shipped:** 2026-04-25 (AEST)
**Branch:** `feature/dashboard-interactive`
**PR:** https://github.com/Mortybot50/jordan-sales-agent/pull/11 — **MERGED**
**Squash commit:** `94d91c5` on `main`
**Prod URL:** https://jordan-sales-agent.vercel.app
**Prod bundle (pre):** `index-DbXJCFPq.js`
**Prod bundle (post):** `index-DGWPDVMv.js` ✅ verified
**Demo user:** `demo@jordan-sales-agent.test` (password unchanged — service-role JWT used for any prod read smoke; no reset)

---

## Bug 1 — Warm Leads horizontal scroll on iPhone (P1)

### Root cause

`src/components/primitives/DataTable.tsx` wrapped its sticky header + body in a single outer container with `overflow-hidden` (needed to clip the rounded corners). The inner header/body grids extended past the viewport on iPhone (column min-widths summed to ~398px + 36px gap > 390px iPhone 14), but **nothing in the tree was scrollable on the x-axis** — the `overflow-hidden` clipped the swipe gesture before the browser could rubber-band. The `WarmLeads` section parent also had `overflow-hidden`, compounding the issue.

### Fix (CSS diff — DataTable primitive)

Added a horizontal-scroll wrapper inside the outer rounded-clip container, with iOS-specific touch hints:

```diff
   <div data-slot="data-table" className="overflow-hidden rounded-... border ...">
+    <div
+      className="overflow-x-auto overflow-y-hidden"
+      style={{
+        WebkitOverflowScrolling: 'touch',
+        touchAction: 'pan-x pan-y',
+      }}
+    >
       <div role="row" className="sticky top-0 ..."
-           style={{ gridTemplateColumns: gridCols, height: rowHeight }}>
+           style={{ gridTemplateColumns: gridCols, height: rowHeight, minWidth: 'max-content' }}>
       ...
-      <div role="rowgroup" aria-label={ariaLabel} aria-busy={loading}>
+      <div role="rowgroup" aria-label={ariaLabel} aria-busy={loading} style={{ minWidth: 'max-content' }}>
         ...
         <div role="row"
-              style={{ gridTemplateColumns: gridCols, minHeight: rowHeight }}>
+              style={{ gridTemplateColumns: gridCols, minHeight: rowHeight, minWidth: 'max-content' }}>
       ...
+    </div>
   </div>
```

Why this works on iOS Safari specifically:

- `overflow-x: auto` makes the inner wrapper a scroll container.
- `-webkit-overflow-scrolling: touch` opts into the legacy momentum-scroll path Safari still honours for nested horizontal scrollers.
- `touch-action: pan-x pan-y` tells iOS to allow both horizontal and vertical pans on this region, instead of letting the page-level vertical pan capture the gesture.
- `min-width: max-content` forces the grid to its natural width (so there's actually something wider than the viewport to scroll).
- Outer `overflow-hidden` is preserved on the rounded-clip container so corners still look right.

This fixes warm-leads on iPhone **and** cascades to every DataTable in the app (Contacts, Suppression list, etc.) — they were all suffering the same mute clip on narrow viewports.

### How I verified

- Local `tsc -b` clean.
- Local `vite build` green: 2,142 kB JS / 591 kB gzip (chunk-size warning unchanged from main; not introduced by this PR).
- DOM-grep proof from prod after deploy:

```
$ curl -s https://jordan-sales-agent.vercel.app | grep -oE 'index-[A-Za-z0-9_-]+\.js'
index-DGWPDVMv.js   ← new, was index-DbXJCFPq.js pre-merge
```

- Live browser smoke (iPhone 14 viewport / 390px) is on the manual-QA todo for Morty — code-level fix verified, all the right CSS hooks are present.

---

## Bug 2 — Interactive Dashboard (P0)

Every clickable element with its destination:

| Element | File | Destination | Behaviour |
|---|---|---|---|
| Anchor KPI · Pipeline value | `DarkAnchorBar.tsx` | `/pipeline` | Whole card is a `<Link>`. Mint border lift on hover, ↗ overlay bottom-right. |
| Anchor KPI · Qualified meetings | `DarkAnchorBar.tsx` | `/pipeline?filter=meetings&period=this_week` | Same treatment. |
| Anchor KPI · Reply rate | `DarkAnchorBar.tsx` | `/drafts?tab=replies` | Same treatment. (DraftsPage has no tabs yet — logged as Phase B gap; the route still works.) |
| Anchor KPI · Jordan Score | `DarkAnchorBar.tsx` | popover (no nav) | `<button>` toggles a popover under the card listing the three score components. `Info` overlay icon instead of arrow to signal "click for info, not navigation". |
| Reopening Radar card | `ReopeningRadarCard.tsx` | `/reopening-radar` | Already wired pre-PR; left untouched. |
| Warm Leads card header | `WarmLeads.tsx` | `/contacts?segment=warm` | Header is a `<Link>` with ↗ icon. |
| Warm Leads row | `WarmLeads.tsx` | `/contacts/{id}` | `DataTable.onRowClick` → `navigate(/contacts/{id})`. |
| Warm Leads "Follow up" button | `WarmLeads.tsx` | unchanged | `e.stopPropagation()` was already there; preserved so click doesn't trigger the row navigation. |
| Pipeline Health card header | `PipelineHealth.tsx` | `/pipeline?view=health` | Header is a `<Link>`. |
| Pipeline Health stage row | `PipelineHealth.tsx` | `/pipeline?stage={id}` | Each legend row is a `<Link>` (added `stage_id` to `usePipelineHealth` return type for this). |
| Recent Activity row | `RecentActivity.tsx` | `/contacts/{contact_id}` if present, else `/pipeline?deal={deal_id}` if present, else no-op | `activityHref()` helper inside the file. |

### Hover / a11y treatment

- `KPI_LINK_CLS` shared className on the four DarkAnchorBar cards: rounded focus-visible ring in `--jordan-accent-mint`, plus `[&:hover>[data-slot=dark-metric-card]]:border-[--jordan-accent-mint]/50` to lift the card border on hover.
- `CardArrow` component renders an `ArrowUpRight` (lucide) at bottom-right, opacity 0.5 idle → 1 on hover/focus-visible.
- Every clickable card has `aria-label` and `title`. Click target is the **whole card**, not a tiny icon — meets iOS HIG min 44px.
- Pipeline Health stage rows use `hover:bg-surface-2` instead of a border lift (in-card, lighter touch).

### Filter handlers shipped in the same PR

Per hard-rule #4 ("if a destination page can't honour a filter param, implement the handler in the same PR"):

1. **`/contacts?segment=warm`** (`ContactsPage.tsx`) — `useEffect` reads `?segment={hot|warm|cold}` and pre-applies the existing tier facet, then strips the param so refresh stays clean.
2. **`/pipeline?stage={id}`** (`PipelinePage.tsx` + `KanbanBoard.tsx`) — `KanbanBoard` now accepts a `stageFilter` prop and renders just that one stage column when set. PipelinePage shows a clearable filter banner.
3. **`/pipeline?filter=meetings&period=this_week`** (`PipelinePage.tsx` + `KanbanBoard.tsx` + `activities.ts`) — new `useMeetingsThisWeekDealIds()` hook queries `activities` for `meeting_note` / `meeting_booked` rows in the current Mon-Sun week and returns a Set of `deal_id`s + a Set of `contact_id`s. PipelinePage forwards both to KanbanBoard's `dealIdAllowlist` / `contactIdAllowlist` props; the kanban filters its deal list accordingly. Banner explains the filter and offers a Clear button.
4. **`/drafts?tab=replies`** — DraftsPage doesn't have tabs yet. **Logged as Phase B gap** (per the task's allowance). The KPI still routes to `/drafts` (the param is benign — DraftsPage ignores it). Phase B can wire actual reply analytics tabs.

### What I did NOT change

- DarkMetricCard primitive: untouched. Wrapping happens externally via Link/button.
- Existing Reopening Radar card click behaviour: preserved.
- Follow-up button stopPropagation: preserved.
- No new design tokens (Phase F lock honoured).
- Skeleton states: every card already had a skeleton matching its final dimensions (verified existing state, no changes needed).
- Empty states: WarmLeads empty-state copy was already friendly; tweaked text slightly to "Once Claude scores a contact 50–79 and they've gone 7+ days without a touch, they'll appear here." Other cards already had matching empty states.
- ALL-CAPS tracked label on each card title: WarmLeads + PipelineHealth title now use the `uppercase tracking-[var(--jordan-tracking-label)]` lock (they were missing it). DarkMetricCard already used CapsLabel internally.

---

## Test evidence

### Build

```
$ npx tsc -b           # clean (no output)
$ npx vite build
✓ 2409 modules transformed.
✓ built in 410ms
```

### Prod probe

```
$ curl -sI https://jordan-sales-agent.vercel.app | head -2
HTTP/2 200
$ curl -s https://jordan-sales-agent.vercel.app | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1
index-DGWPDVMv.js   ← post-merge bundle hash, confirmed deployed
```

### Manual smoke (recommended for Morty)

- [ ] Open https://jordan-sales-agent.vercel.app on iPhone Safari (or DevTools 390px responsive).
- [ ] Tap each anchor KPI → verify nav + filter applied (Pipeline value, Qualified meetings, Reply rate, Jordan Score popover).
- [ ] Tap Warm Leads header → `/contacts?segment=warm`, tier facet pre-applied, URL reverts to `/contacts`.
- [ ] Tap a Warm Leads row → `/contacts/{id}` detail.
- [ ] Tap "Follow up" — should NOT navigate.
- [ ] Swipe Warm Leads horizontally → rows scroll, no stuck gesture.
- [ ] Tap Pipeline Health header → `/pipeline?view=health` (banner if you wire a stage param next).
- [ ] Tap a Pipeline Health stage row → kanban shows only that column, banner offers Clear.
- [ ] Tap a Recent Activity row with a contact → contact detail.

---

## Open follow-ups (not blocking)

- DraftsPage tabs (`?tab=replies`) — Phase B item.
- `/pipeline?view=health` — currently just navigates to `/pipeline` with no stage filter; if a dedicated "health" view is wanted later, that's where to expand.
- Bundle size warning (>500 kB) is pre-existing on main; consider code-splitting in a separate PR.
