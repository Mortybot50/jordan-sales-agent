import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import path from 'path'

// Sentry source-map upload only runs in CI / production builds where the
// three SENTRY_* env vars are present. Local dev builds skip the plugin —
// the runtime @sentry/react SDK still captures errors, just with minified
// stack traces. See SENTRY-SETUP.md for the operator-side Vercel env vars.
const sentryEnabled = Boolean(
  process.env.SENTRY_AUTH_TOKEN &&
  process.env.SENTRY_ORG &&
  process.env.SENTRY_PROJECT,
)

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(sentryEnabled
      ? [
          sentryVitePlugin({
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            authToken: process.env.SENTRY_AUTH_TOKEN,
            sourcemaps: {
              assets: './dist/**',
              // Delete *.map files from the build artefact AFTER upload so
              // they live only in Sentry, not on the public CDN. Without
              // this, Vercel serves /assets/index-*.js.map at 200 and
              // anyone can deminify the bundle.
              filesToDeleteAfterUpload: ['./dist/**/*.map'],
            },
            telemetry: false,
          }),
        ]
      : []),
  ],
  build: {
    sourcemap: sentryEnabled,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
