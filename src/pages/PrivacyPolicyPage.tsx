import { Link } from 'react-router-dom'

export function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-hairline">
        <div className="mx-auto max-w-3xl px-4 py-5 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-primary text-primary-foreground text-sm font-bold">
              L
            </div>
            <span className="text-base font-bold tracking-tight">LeadFlow</span>
          </Link>
          <Link
            to="/login"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground">
            Last updated: 27 April 2026 · Effective date: 27 April 2026
          </p>
        </div>

        <Section title="1. Who we are">
          <p>
            LeadFlow is operated by <strong>Jordan Marziale</strong>, a sole trader registered in Australia
            (<abbr title="Australian Business Number">ABN</abbr> 78&nbsp;180&nbsp;361&nbsp;897).
            For the purpose of this policy, Jordan Marziale is the &ldquo;<strong>data controller</strong>&rdquo;
            (or, under the Australian Privacy Act 1988, the &ldquo;APP entity&rdquo;) of personal information processed by LeadFlow.
          </p>
          <p>
            Contact: <a className="underline" href="mailto:mortybot50@gmail.com">mortybot50@gmail.com</a>
            {' '}(operational contact during build phase; will be updated to a Jordan-owned address once domains are live).
          </p>
        </Section>

        <Section title="2. What LeadFlow does">
          <p>
            LeadFlow is a customer relationship management (CRM) tool used by Jordan Marziale to manage
            his commercial sales pipeline (water filtration, hospitality industry, Victoria, Australia).
            It helps the operator source leads, draft outbound emails, track replies, schedule meetings,
            and report on pipeline performance.
          </p>
          <p>
            Today, LeadFlow has a single end-user (Jordan Marziale himself).
            The schema supports multiple tenants for future expansion, but no second user is currently onboarded.
          </p>
        </Section>

        <Section title="3. What information we collect">
          <h3 className="font-semibold mt-4">3.1 Account information</h3>
          <p>
            When you sign in to LeadFlow, we collect your email address and a hashed authentication credential
            (managed by our auth provider, Supabase). We do not store your password in plain text.
          </p>

          <h3 className="font-semibold mt-4">3.2 Contact &amp; venue information</h3>
          <p>
            LeadFlow stores business contact records (name, role, business email, business phone, venue name,
            suburb, licence type, and similar commercial attributes). This information is entered by the operator,
            imported from CSV files the operator has lawfully obtained, or sourced via the public Google Places API.
          </p>

          <h3 className="font-semibold mt-4">3.3 Email content (Gmail integration)</h3>
          <p>
            If you connect a Gmail account to LeadFlow via Google OAuth, LeadFlow will:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Receive notifications when new emails arrive in your inbox (via Google Pub/Sub).</li>
            <li>Read message metadata (sender, recipient, subject, date, message ID, thread ID) and message body
              content for messages that match contacts in your LeadFlow database.</li>
            <li>Store an encrypted refresh token so it can renew Gmail API access without re-prompting you each session.</li>
          </ul>
          <p>
            LeadFlow does <strong>not</strong> read messages that are not relevant to LeadFlow contacts, and does not
            scan attachments. Gmail message bodies are stored only for the duration needed to classify, log, and surface
            the reply in the pipeline. See section&nbsp;6 for our Google API Limited Use commitment.
          </p>

          <h3 className="font-semibold mt-4">3.4 AI-generated drafts</h3>
          <p>
            LeadFlow uses Anthropic Claude to draft outbound emails on the operator's behalf. Drafts are based on
            contact metadata (name, role, venue, recent activity) and the operator's voice rules. Generated text is
            stored in LeadFlow until the operator approves, edits, or rejects the draft.
          </p>

          <h3 className="font-semibold mt-4">3.5 Voice notes (optional)</h3>
          <p>
            If the operator uses Field Mode to capture voice notes, audio is sent to OpenAI's Whisper API for
            transcription. The audio file is not retained by OpenAI beyond the transcription call. The transcript is
            stored in LeadFlow as a contact note.
          </p>

          <h3 className="font-semibold mt-4">3.6 Operational logs</h3>
          <p>
            We log application errors, API call timings, and security events (sign-ins, OAuth exchanges, webhook
            verifications) for debugging and intrusion detection. Logs are retained for up to 90 days.
          </p>
        </Section>

        <Section title="4. How we use the information">
          <ul className="list-disc pl-6 space-y-1">
            <li>To authenticate the operator and authorise access to their tenant data.</li>
            <li>To display contacts, deals, and activity history in the LeadFlow user interface.</li>
            <li>To generate AI-drafted outbound emails for operator review.</li>
            <li>To match inbound email replies to existing deals and contacts.</li>
            <li>To send the operator a daily 7 a.m. AEST briefing email summarising pipeline state.</li>
            <li>To classify the intent of inbound replies (positive, objection, out of office, unsubscribe).</li>
            <li>To detect and respond to security incidents, abuse, and service errors.</li>
          </ul>
          <p>
            We do <strong>not</strong> use any data to serve advertising, train third-party machine-learning models
            (other than the prompt-time use of Anthropic Claude and OpenAI Whisper as described), or sell to data
            brokers.
          </p>
        </Section>

        <Section title="5. Sub-processors and third parties">
          <p>LeadFlow uses the following sub-processors. Each handles personal data only to provide their service to LeadFlow.</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Supabase</strong> (database, authentication, file storage) — Sydney, AU region.</li>
            <li><strong>Vercel</strong> (web application hosting).</li>
            <li><strong>Google LLC</strong> (Gmail API for inbound mail, Google Places API for venue lookups).</li>
            <li><strong>Anthropic</strong> (Claude API for AI draft generation).</li>
            <li><strong>OpenAI</strong> (Whisper API for voice-note transcription).</li>
            <li><strong>Resend</strong> (transactional email delivery — morning briefing, learning digest).</li>
            <li><strong>Instantly.ai</strong> (cold email sending and warmup) — once configured.</li>
            <li><strong>Proxycurl</strong> (LinkedIn data enrichment) — only when the operator requests enrichment for a specific contact.</li>
          </ul>
          <p>
            We do not sell personal information to any third party. We do not transfer personal information overseas
            other than through the sub-processors listed above.
          </p>
        </Section>

        <Section title="6. Google API Services — Limited Use disclosure">
          <p>
            LeadFlow's use and transfer to any other app of information received from Google APIs will adhere to the{' '}
            <a
              className="underline"
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noreferrer noopener"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
          <p>Specifically:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              We use Google user data only to provide and improve the user-facing features that are prominent in the
              LeadFlow user interface (matching replies to deals, intent classification, activity logging,
              pipeline-stage advancement).
            </li>
            <li>
              We do not transfer Google user data to third parties except as necessary to provide or improve
              user-facing features, to comply with applicable law, or as part of a merger, acquisition, or sale of
              assets — and in that case only with continued protection in this policy.
            </li>
            <li>We do not use Google user data for serving advertisements, including retargeting, personalised, or interest-based advertising.</li>
            <li>
              We do not allow humans to read Google user data unless: (a) we have your affirmative agreement to view
              specific messages, (b) it is necessary for security purposes (such as investigating abuse), (c) it is
              required to comply with applicable law, or (d) our use is for internal operations and the data has been
              aggregated and anonymised.
            </li>
          </ul>
        </Section>

        <Section title="7. Data retention">
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Contact records and activity logs:</strong> retained for the life of the LeadFlow account, until the operator deletes them.</li>
            <li><strong>Gmail message bodies:</strong> retained for up to 12 months after the last related deal activity, then automatically purged from our database. Message metadata (sender, subject, thread ID) may be retained longer for pipeline reporting.</li>
            <li><strong>Encrypted Gmail refresh tokens:</strong> retained for as long as the connection is active. Deleted within 24 hours of the operator revoking the connection.</li>
            <li><strong>Operational logs:</strong> retained for up to 90 days.</li>
          </ul>
          <p>
            On account closure, the operator may request a full export of their data and deletion of their tenant.
            Data is deleted within 30 days of a verified deletion request. Backups are purged within a further 60 days.
          </p>
        </Section>

        <Section title="8. Security">
          <p>
            LeadFlow follows industry standards to protect personal information:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>All network traffic is encrypted in transit (HTTPS / TLS).</li>
            <li>Database access is protected by per-tenant row-level security (PostgreSQL RLS).</li>
            <li>Gmail OAuth refresh tokens are encrypted at rest using AES-256-GCM with a key held in our secrets manager (not in the database).</li>
            <li>Webhook endpoints verify cryptographic signatures (Instantly HMAC, Google Pub/Sub OIDC JWT).</li>
            <li>OAuth state parameters are HMAC-signed and time-bound to prevent CSRF and account-binding attacks.</li>
          </ul>
          <p>
            No system is perfectly secure. If we become aware of a breach affecting personal information, we will notify
            affected users without undue delay, in accordance with the Notifiable Data Breaches scheme under the
            Australian Privacy Act 1988.
          </p>
        </Section>

        <Section title="9. Your rights">
          <p>
            Under the Australian Privacy Act 1988 and the EU GDPR (where it applies), you may:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Request access to the personal information we hold about you.</li>
            <li>Request correction of inaccurate data.</li>
            <li>Request deletion of your data, subject to our legal retention obligations.</li>
            <li>Withdraw your consent to our processing of your Gmail data at any time, by revoking access in your{' '}
              <a className="underline" href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer noopener">
                Google Account permissions
              </a>.
            </li>
            <li>Lodge a complaint with the{' '}
              <a className="underline" href="https://www.oaic.gov.au/" target="_blank" rel="noreferrer noopener">
                Office of the Australian Information Commissioner (OAIC)
              </a>.
            </li>
          </ul>
          <p>
            To exercise any of these rights, contact <a className="underline" href="mailto:mortybot50@gmail.com">mortybot50@gmail.com</a>.
            We will respond within 30 days.
          </p>
        </Section>

        <Section title="10. Cookies and tracking">
          <p>
            LeadFlow uses only essential cookies (session authentication tokens). We do not use third-party advertising
            cookies, do not run cross-site trackers, and do not include analytics tools that profile individual visitors.
          </p>
        </Section>

        <Section title="11. Children">
          <p>LeadFlow is a business-to-business sales tool. It is not directed at children under 16 and we do not knowingly collect personal information from children.</p>
        </Section>

        <Section title="12. Changes to this policy">
          <p>
            We may update this policy from time to time. The &ldquo;Last updated&rdquo; date at the top will reflect the
            most recent revision. Material changes will be communicated to active users by email at least 14 days before
            taking effect.
          </p>
        </Section>

        <Section title="13. Contact">
          <p>
            For privacy enquiries, data access requests, or to revoke any consent given to LeadFlow, please contact:
          </p>
          <p>
            Jordan Marziale (sole trader, ABN 78 180 361 897)<br />
            via operational contact: <a className="underline" href="mailto:mortybot50@gmail.com">mortybot50@gmail.com</a>
          </p>
        </Section>

        <footer className="pt-8 mt-8 border-t border-hairline text-xs text-muted-foreground">
          <p>© 2026 Jordan Marziale. LeadFlow is a privately operated sales-enablement tool, not a publicly available product.</p>
        </footer>
      </main>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 leading-relaxed text-sm">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="space-y-3 text-muted-foreground [&_strong]:text-foreground [&_a]:text-foreground">{children}</div>
    </section>
  )
}
