// Pure HTML-assembly helpers shared by generate-draft, sequence-tick, and
// drain-send-queue. No Deno globals so the module is unit-testable under node.
//
// The text path remains canonical: every email still ships a text/plain body.
// These helpers build the *parallel* text/html body that carries the styled
// signature with image logos. drain-send-queue uses textToHtml as the fallback
// when a queue row has no body_html (older drafts, or text-only paths).

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// Convert plain text to a minimal HTML rendering (one <p> per blank-line block).
// MUST stay byte-identical to drain-send-queue's local textToHtml so a draft
// rendered either way produces the same markup.
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br/>')}</p>`)
    .join('\n')
}

// Replace the {{sending_mailbox_email}} token in a signature template. Mirrors
// the substitution generate-draft/sequence-tick already do on body_text.
// Use this for the text/plain body only.
export function substituteMailbox(template: string, mailboxEmail: string | null | undefined): string {
  return template.replace(/\{\{sending_mailbox_email\}\}/g, mailboxEmail ?? '')
}

// HTML-safe variant: the mailbox value is escaped before it lands inside the
// body_html template, so an address containing <, &, or quotes cannot break or
// inject markup into the rendered signature.
export function substituteMailboxHtml(template: string, mailboxEmail: string | null | undefined): string {
  return template.replace(/\{\{sending_mailbox_email\}\}/g, escapeHtml(mailboxEmail ?? ''))
}

// Plain-text unsubscribe footer. Kept here so the text and HTML footers are
// authored side by side and never drift.
export function unsubFooterText(link: string): string {
  return `\n\n---\nThis email was sent by Jordan Marziale (Premium Water AU). To unsubscribe, click here: ${link}`
}

// HTML unsubscribe footer — same copy, anchored link. The href is fully
// HTML-escaped (not just &) so a malformed app-url config can't break out of
// the attribute. The link carries query params (?c=…&s=…&t=…).
export function unsubFooterHtml(link: string): string {
  const href = escapeHtml(link)
  return `<p style="margin:12px 0 0;font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;line-height:1.3;">This email was sent by Jordan Marziale (Premium Water AU). To unsubscribe, <a href="${href}" style="color:#94a3b8;">click here</a>.</p>`
}

// Assemble the full text/html body: the Claude-written body rendered as
// paragraphs, then the signature HTML (already mailbox-substituted), then the
// unsubscribe footer HTML. Null sections are skipped so the join stays clean.
export function assembleHtmlBody(
  claudeBody: string,
  signatureHtml: string | null,
  footerHtml: string | null,
): string {
  const parts = [textToHtml(claudeBody)]
  if (signatureHtml) parts.push(signatureHtml)
  if (footerHtml) parts.push(footerHtml)
  return parts.join('\n')
}
