import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
// Extract hostname for CSP connect-src (e.g. "abc123.supabase.co")
const supabaseHost = supabaseUrl ? new URL(supabaseUrl).hostname : "*.supabase.co";

// React uses eval() in development to reconstruct server-side error stacks in the
// browser. Neither React nor Next.js use eval() in production, so 'unsafe-eval' is
// scoped to dev only and never weakens the deployed policy. Next's own CSP guide
// (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md) uses
// exactly this pattern for a nonce-free CSP.
const isDev = process.env.NODE_ENV === "development";

// Blog media CDN for CSP img-src. headers() is evaluated at BUILD time, so
// SPACES_MEDIA_CDN_URL must be RUN_AND_BUILD_TIME in the app spec (it is a
// plain value, not a secret). Unset locally → simply absent from the policy.
const mediaCdnRaw = process.env.SPACES_MEDIA_CDN_URL ?? "";
let mediaCdnOrigin = "";

try {
  mediaCdnOrigin = mediaCdnRaw ? new URL(mediaCdnRaw).origin : "";
} catch {
  mediaCdnOrigin = "";
}

const securityHeaders = [
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js App Router requires unsafe-inline for hydration scripts
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      // Tailwind and CSS-in-JS requires unsafe-inline for styles
      "style-src 'self' 'unsafe-inline'",
      // next/font self-hosts fonts; data: for inline fonts
      "font-src 'self' data:",
      // Supabase API calls + self
      `connect-src 'self' https://${supabaseHost} wss://${supabaseHost}`,
      // Allow images from self, data URIs, and blob (for file previews)
      `img-src 'self' data: blob:${mediaCdnOrigin ? ` ${mediaCdnOrigin}` : ""}`,
      // Prevent embedding in frames
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
