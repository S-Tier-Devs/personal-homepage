function getRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function assertPresent(name: string, value: string | undefined) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

/**
 * These MUST be written as static `process.env.NEXT_PUBLIC_*` references.
 *
 * Next inlines public env vars into the client bundle by literal text
 * replacement at build time, so a computed `process.env[name]` lookup is left
 * untouched and resolves to `undefined` in the browser. No client code reads
 * these any more — the browser Supabase client was removed — but the rule
 * still applies to any future client use, so the static form is kept. Server
 * code is unaffected because it reads a real `process.env` at runtime.
 *
 * See node_modules/next/dist/docs/01-app/02-guides/environment-variables.md
 * ("dynamic lookups will not be inlined"). Do not refactor these back into a
 * helper that takes the variable name as an argument.
 */
export function getSupabasePublicEnv() {
  return {
    url: assertPresent("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    anonKey: assertPresent(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
  };
}

export function getSupabaseServiceRoleKey() {
  return getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
}

export function getAdminEmail() {
  return getRequiredEnv("ADMIN_EMAIL");
}

/**
 * The canonical public origin, for anything that must not trust request
 * headers. Magic-link redirect targets in particular: deriving an origin from
 * `Host` or `x-forwarded-host` is how link poisoning happens.
 *
 * Defaults to the www host because that is canonical — the apex 307-redirects
 * to it. (Note `app/layout.tsx`, `app/robots.ts` and `app/sitemap.ts` still
 * default to the apex. Harmless, since the redirect resolves it, but worth
 * unifying separately.)
 */
export function getSiteUrl() {
  const raw = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.patrickbeasley.com";
  return raw.replace(/\/+$/, "");
}

/**
 * Public CDN origin for the pb-public-media Spaces bucket. Optional: when
 * unset (local dev without Spaces), sanitizePostHtml drops every <img> and
 * the media route answers 500 — honest failures, not silent fallbacks.
 * Must be RUN_AND_BUILD_TIME in the app spec: next.config.ts reads it for CSP.
 */
export function getSpacesMediaCdnUrl(): string | null {
  return process.env.SPACES_MEDIA_CDN_URL ?? null;
}

/** Spaces credentials + region. Server-only; secrets added via the LIVE spec
 *  procedure, never by applying .do/app.yaml (docs/ARCHITECTURE.md). */
export function getSpacesCredentials() {
  return {
    key: getRequiredEnv("SPACES_KEY"),
    secret: getRequiredEnv("SPACES_SECRET"),
    region: getRequiredEnv("SPACES_REGION"),
  };
}

export function getSpacesMediaBucket() {
  return getRequiredEnv("SPACES_MEDIA_BUCKET");
}
