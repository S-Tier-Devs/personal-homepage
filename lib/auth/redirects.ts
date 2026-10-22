import type { NextRequest } from "next/server";

export function getRequestOrigin(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";

  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  return request.nextUrl.origin;
}

export function normalizeNextPath(input: string | null, fallback = "/") {
  if (!input || !input.startsWith("/")) {
    return fallback;
  }

  // Validate by resolving against a fixed origin and confirming it stayed
  // there. Prefix checks are not enough: browsers normalise backslashes to
  // forward slashes, so "/\evil.com" resolves to "//evil.com" and lands on
  // another host while passing any startsWith("//") test.
  try {
    const base = "https://validate.invalid";
    const probe = new URL(input, base);

    if (probe.origin !== base) {
      return fallback;
    }

    const value = `${probe.pathname}${probe.search}${probe.hash}`;

    // The parsed object can look safe while its SERIALIZED form is not:
    // "/..//evil.com" resolves to a `probe` whose origin is still `base`,
    // but re-serializing it collapses "/.." and yields the
    // protocol-relative "//evil.com" (same for "/.//evil.com",
    // "/%2e%2e//evil.com", "/..&#47;/evil.com" after decoding). Round-trip
    // the EMITTED value, not the parsed one.
    if (new URL(value, base).origin !== base) {
      return fallback;
    }

    return value;
  } catch {
    return fallback;
  }
}
