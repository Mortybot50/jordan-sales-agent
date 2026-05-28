/**
 * Side-effect module that initialises Sentry BEFORE any other app code.
 * Must be imported first in main.tsx — before App and its transitive imports.
 *
 * ESM hoists imports, so any module-init crash (e.g. Supabase env-var guards
 * throwing during evaluation) would happen before initSentry() runs in main.tsx
 * if Sentry init lived at the top of main.tsx as a statement. This file is
 * imported for its side effect — the init call runs at the top of the module
 * evaluation chain.
 *
 * Pattern: same shape Next.js uses (`instrumentation.ts`) and what Sentry's
 * own docs recommend for Vite + React.
 */
import { initSentry } from "./lib/sentry";

initSentry();
