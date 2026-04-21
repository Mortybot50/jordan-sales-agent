# LeadFlow — Jordan's AI Sales Agent + CRM

AI-powered sales agent and CRM for Jordan, Purezza commercial water filtration rep (VIC hospitality market). Replaces Salesforce + mastersheet with a single tool that auto-sources venue leads, drafts cold emails in Jordan's voice, runs 3-stage follow-up sequences, and delivers a daily morning briefing.

**Status:** Week 1 scaffold — schema applied, auth skeleton live, UI stubs in place.

---

## Quick links

| Resource | URL |
|----------|-----|
| **GitHub** | https://github.com/Mortybot50/jordan-sales-agent |
| **Vercel (prod)** | https://jordan-sales-agent.vercel.app |
| **Supabase project ref** | _TBD — pending Supabase MCP approval_ |
| **Plan doc** | `~/.openclaw/roles/dev/plans/jordan-sales-agent-plan.md` |

---

## Architecture Decisions

### GATE-1 resolved (2026-04-21): Jordan's personal Gmail for outreach

Jordan's email outreach uses his **personal Gmail account** as the send-from address, not `outreach.purezza.com.au`.

**Decision context:** Pre-build gate GATE-1 was resolved on 2026-04-21. Jordan is not restricted to Purezza domain/tooling. Using his personal email avoids Purezza corporate politics (domain DNS access, IT approval, potential ownership claims on pipeline data).

**Impact on architecture:**
- Outbound cold email: Instantly.ai (GATE-4 pending Morty setup), sending via Jordan's personal domain/Gmail SMTP
- Inbound reply watching: Gmail OAuth on Jordan's personal account (GATE-6 pending Google OAuth verification, 4-6 week lead time)
- Transactional email (briefing digest, notifications): SendGrid with a simple sender identity
- Plan references to `outreach.purezza.com.au` are superseded by this decision for v1

### Multi-tenant schema from day 1

All tables include `org_id uuid references orgs(id)`. RLS policies enforce `org_id = (auth.jwt() ->> 'org_id')::uuid` on every user-facing query. Jordan is sole user in v1, but schema supports LeadFlow SaaS multi-tenancy for future reps without migration.

### Email sending split

| Channel | Tool | Purpose |
|---------|------|---------|
| Cold outbound | Instantly.ai | Sales sequences — GATE-4 pending |
| Inbound watching | Gmail OAuth + Pub/Sub | Reply detection — GATE-6 pending |
| Transactional | SendGrid | Briefing digest, notifications |

SendGrid is not used for cold outbound (AUP violation for purchased lists). Instantly.ai handles cold sequences with proper warmup and deliverability management.

### Vercel Serverless (not Edge) for Claude API calls

Claude API calls can take 8-20s. Vercel Edge Functions have a 25-30s hard limit. All Claude-calling endpoints use `export const config = { runtime: 'nodejs' }` with `maxDuration: 60` in `vercel.json`.

### Reply-to-deal matching

SendGrid/Instantly bypass Gmail's standard thread IDs. Every outbound email stores `(sendgrid_message_id, to_email)` in `activities.metadata`. Gmail webhook extracts `In-Reply-To` header and matches against stored message IDs to link replies to deals.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui |
| Backend/DB | Supabase (PostgreSQL + Auth + RLS + Realtime + Storage) |
| Hosting | Vercel (frontend + serverless API routes) |
| AI | Claude Sonnet 4.6 (claude-sonnet-4-6) |
| Cold email | Instantly.ai (GATE-4 pending) |
| Transactional email | SendGrid |
| LinkedIn enrichment | Proxycurl (~$0.01/profile) |
| Venue sourcing | Google Places API |
| Meeting booking | Calendly embed + webhooks |

---

## Local Development Setup

### Prerequisites

- Node.js v22+
- Supabase CLI (`npm install -g supabase`)
- A Supabase project (see setup below)

### 1. Clone and install

```bash
git clone https://github.com/mortybot/jordan-sales-agent.git
cd jordan-sales-agent
npm install
```

### 2. Environment variables

```bash
cp .env.local.example .env.local
# Fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (minimum to boot)
```

### 3. Apply database migrations

```bash
# Via Supabase CLI (connects to remote project)
export SUPABASE_PROJECT_REF=<ref>
supabase db push

# Or via the Supabase dashboard SQL editor — paste files from supabase/migrations/ in order
```

### 4. Start dev server

```bash
npm run dev
# Opens http://localhost:5173
```

### 5. Local Supabase (optional)

```bash
supabase start          # Starts local Postgres + Studio
supabase db reset       # Apply all migrations fresh
```

---

## Database Schema

19 tables, all multi-tenant with RLS:

| Table | Purpose |
|-------|---------|
| `orgs` | Tenant root |
| `users` | Users within an org |
| `venues` | Hospitality venues (company-level) |
| `contacts` | Decision-makers at venues |
| `pipeline_stages` | Configurable pipeline stages per org |
| `deals` | Pipeline opportunities |
| `activities` | Unified activity timeline |
| `sequences` | Email campaign templates |
| `sequence_steps` | Steps within a sequence |
| `sequence_enrollments` | Deal ↔ sequence enrolment tracking |
| `tasks` | Reminders and follow-ups |
| `lead_scores` | Hot/warm/cold score history |
| `signals` | Timing signals (new venue openings, leadership changes) |
| `auto_sourced_candidates` | Google Places candidates awaiting review |
| `email_drafts` | AI-generated drafts awaiting Jordan's approval |
| `draft_edits` | Jordan's edits (learning loop) |
| `suppression_list` | Spam Act 2003 compliance |
| `worker_runs` | Background worker observability log |
| `calendly_events` | Meeting booking webhook events |

Full schema: `supabase/migrations/`

---

## Migrations

```
supabase/migrations/
  20260421000001_initial_schema.sql   — all tables, triggers, indexes
  20260421000002_rls_policies.sql     — RLS policies for all tables
```

Applied: 2 migrations, 19 tables, 60+ RLS policies

---

## Pending Gates (Morty handling in parallel)

| Gate | Status | Description |
|------|--------|-------------|
| GATE-4 | Pending | Instantly.ai / Smartlead account setup — cold email sender |
| GATE-5 | Pending | VCGLR scrape validation — can we extract licence_number reliably? |
| GATE-6 | Pending | Google OAuth app verification — 4-6 week lead time. **Start immediately.** |

---

## Week-by-Week Roadmap

| Week | Deliverable |
|------|-------------|
| **1** done | Scaffold, schema, auth, Vercel, GitHub |
| 2 | CRM core: pipeline Kanban + list, venue/contact detail pages, onboarding flow |
| 3 | Claude API integration, Draft Review Queue UI (mobile swipe + keyboard nav) |
| 4 | Gmail OAuth + Pub/Sub webhook, reply-to-deal matching, gmail-watch-renew worker |
| 5 | Sequence engine: builder UI, enrollments, sequence-trigger worker with concurrency control |
| 6 | Auto-sourcing: Google Places worker, ICP scoring, candidate review queue |
| 7 | Timing signals: VCGLR scrape worker + Proxycurl LinkedIn enrichment |
| 8 | Morning briefing: 5-section in-app + 7am email digest, Calendly embed + webhook, CSV import |
| 9 | Spam Act hardening, circuit breakers, /admin/workers health page, end-to-end QA, go-live |

---

## Deployment

**Vercel** — connected to GitHub `main` branch. Automatic deploys on push.

```bash
# Manual deploy (if needed)
vercel --prod
```

Environment variables required in Vercel dashboard — see `.env.local.example`.

---

## Infra Cost (Morty covers)

| Service | Cost |
|---------|------|
| Supabase Pro | ~$25/mo |
| Vercel Hobby | Free (upgrade to Pro at $20/mo if needed) |
| SendGrid | ~$15/mo (50K emails) |
| Instantly.ai | TBD (GATE-4) |
| Proxycurl | ~$60/mo (~200 contacts x $0.01) |
| Google Places | ~$20/mo |
| **Total** | ~$120-140/mo |
