# Sentry — source-map upload setup

PR #91 wired `@sentry/react` for runtime error capture in the SPA. This file
documents the **operator-side** step to enable readable (symbolicated) stack
traces in the Sentry dashboard.

Without this, every error in production surfaces as minified gibberish like
`aB.xY:1234`. Useless for debugging real prospect-side issues.

## Vercel build-time env vars

Set the following three env vars on the `jordan-sales-agent` Vercel project,
`production` environment, **before** the next production deploy:

| Name | Value | Where to obtain |
|---|---|---|
| `SENTRY_AUTH_TOKEN` | Organisation-scoped auth token | Sentry → User settings → Auth Tokens → "Create New Token" with `project:releases` + `org:read` scopes |
| `SENTRY_ORG` | Sentry org slug | Sentry → Settings → Organisation Settings → "Slug" |
| `SENTRY_PROJECT` | Sentry project slug | Sentry → Projects → jordan-sales-agent (or your project's slug) |

CLI flow (canonical — leaves audit trail in shell history):

```bash
echo -n "<auth-token>" | vercel env add SENTRY_AUTH_TOKEN production
echo -n "<org-slug>"   | vercel env add SENTRY_ORG       production
echo -n "<proj-slug>"  | vercel env add SENTRY_PROJECT   production
vercel --prod   # rebuild so the next bundle includes sourcemaps
```

## How the wiring works

`vite.config.ts` detects the three env vars at build time. If any is missing,
the `@sentry/vite-plugin` is skipped — local `vite build` still works, just
without source-map upload. When all three are present:

1. Vite emits `*.map` files alongside the JS bundle (`build.sourcemap = true`).
2. The Sentry plugin uploads the maps to the Sentry org, tagged with the
   commit SHA.
3. The build artefact ships **without** the maps — they live only in Sentry,
   not in the public bundle.

## Verification

After the first production deploy with all three env vars set:

1. Visit `https://jordan-sales-agent.vercel.app/__sentry_test`
   (or trigger any runtime error from the deployed app — `throw new Error('test')` in the console works).
2. In Sentry, the event should show a fully-resolved stack with `src/...`
   filenames and line numbers — not `assets/index-abc.js:1`.
3. If the stack is still minified, check that the upload succeeded by
   looking for the commit-SHA tag in Sentry → Releases.

## Rollback

If something goes wrong with source-map upload (e.g. Sentry rate-limits, auth
token expires), the runtime SDK keeps working. To temporarily disable upload
without re-deploying:

```bash
vercel env rm SENTRY_AUTH_TOKEN production
vercel --prod
```

The next bundle will skip the upload step and ship without maps — errors
still get captured, just with minified frames until the token is restored.
