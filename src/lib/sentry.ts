/**
 * Sentry initialization for error tracking.
 * DSN is loaded from VITE_SENTRY_DSN env var.
 * If no DSN is configured, Sentry is disabled (no-op).
 *
 * Phase 4b rollout — mirrors the SuperSolt pattern + Codex P1 URL scrubbing
 * (28/05/2026 round 1: unsubscribe links + OAuth callbacks carry tokens in
 * query strings; sendDefaultPii does not strip them; beforeSend + beforeBreadcrumb
 * + beforeSendTransaction hooks redact them before leaving the browser).
 */
import * as Sentry from "@sentry/react";

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN || "";

/**
 * Known-sensitive query parameter names — any URL with one of these gets the
 * value redacted before Sentry sees it. Conservative list: anything that
 * looks like a credential, token, identifier, or email. Add to this list
 * whenever a new tokenised route ships.
 */
const SENSITIVE_QUERY_PARAMS = [
  "token",
  "email",
  "access_token",
  "refresh_token",
  "id_token",
  "code",          // OAuth authorisation code
  "state",         // OAuth state
  "api_key",
  "apikey",
  "key",
  "secret",
  "password",
  "pin",
  "auth",
  "session",
  "sig",
  "signature",
  "hash",
];

/** Replace sensitive query params in a URL with [scrubbed]. Bombproof — returns input on parse failure. */
function scrubUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    // Use a placeholder origin so relative URLs parse too.
    const u = new URL(url, "http://placeholder.local");
    let touched = false;
    SENSITIVE_QUERY_PARAMS.forEach((p) => {
      if (u.searchParams.has(p)) {
        u.searchParams.set(p, "[scrubbed]");
        touched = true;
      }
    });
    if (!touched) return url;
    // Preserve relative vs absolute shape.
    if (url.startsWith("/")) {
      return u.pathname + u.search + u.hash;
    }
    return u.toString();
  } catch {
    return url;
  }
}

export function initSentry(): void {
  if (!SENTRY_DSN) {
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE || "development",
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
    enabled: import.meta.env.PROD || !!import.meta.env.VITE_SENTRY_DSN,
    sendDefaultPii: false,
    ignoreErrors: [
      "ResizeObserver loop",
      "Non-Error promise rejection",
      "Network request failed",
      "Load failed",
    ],

    // P1 scrubbing — drop sensitive query params before the event leaves the browser.
    beforeSend(event) {
      if (event.request?.url) {
        event.request.url = scrubUrl(event.request.url);
      }
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((b) => {
          if (b.data && typeof b.data === "object") {
            if (typeof b.data.url === "string") {
              b.data.url = scrubUrl(b.data.url);
            }
            if (typeof b.data.to === "string") {
              b.data.to = scrubUrl(b.data.to);
            }
            if (typeof b.data.from === "string") {
              b.data.from = scrubUrl(b.data.from);
            }
          }
          return b;
        });
      }
      return event;
    },

    beforeSendTransaction(event) {
      if (event.request?.url) {
        event.request.url = scrubUrl(event.request.url);
      }
      // Sentry uses the URL pathname as the transaction name for browserTracing;
      // if a tokenised value ended up in the route param, it shows up here too.
      // Conservative — if the transaction name contains an @-sign or what looks
      // like a long hex/base64 string, the route may have leaked an identifier.
      if (event.transaction && /[a-f0-9]{20,}|@/i.test(event.transaction)) {
        event.transaction = event.transaction.replace(/[a-f0-9]{20,}/gi, "[scrubbed]");
        event.transaction = event.transaction.replace(/[^/]+@[^/]+/g, "[scrubbed]");
      }
      return event;
    },

    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.data && typeof breadcrumb.data === "object") {
        if (typeof breadcrumb.data.url === "string") {
          breadcrumb.data.url = scrubUrl(breadcrumb.data.url);
        }
      }
      return breadcrumb;
    },
  });
}

export { Sentry };
