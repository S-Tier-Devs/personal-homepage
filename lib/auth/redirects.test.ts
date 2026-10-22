import { describe, expect, it } from "vitest";

import { normalizeNextPath } from "./redirects";

describe("normalizeNextPath", () => {
  it("passes through a plain in-app path", () => {
    expect(normalizeNextPath("/dashboard")).toBe("/dashboard");
  });

  it("preserves query and hash on a nested path", () => {
    expect(normalizeNextPath("/dashboard/notes?a=1#b")).toBe("/dashboard/notes?a=1#b");
  });

  it("falls back for null", () => {
    expect(normalizeNextPath(null, "/fallback")).toBe("/fallback");
  });

  it("falls back for a protocol-relative path", () => {
    expect(normalizeNextPath("//evil.com", "/fallback")).toBe("/fallback");
  });

  // The open-redirect regression: browsers normalise a leading backslash to a
  // forward slash when resolving a URL, so "/\evil.com" behaves exactly like
  // "//evil.com" and lands on another host. A prefix check alone misses this.
  it("falls back for a backslash-prefixed host", () => {
    expect(normalizeNextPath("/\\evil.com", "/fallback")).toBe("/fallback");
  });

  it("falls back for an absolute URL", () => {
    expect(normalizeNextPath("https://evil.com", "/fallback")).toBe("/fallback");
  });

  it("falls back for a bare hostname with no leading slash", () => {
    expect(normalizeNextPath("evil.com", "/fallback")).toBe("/fallback");
  });

  // The normalization regression: the PARSED candidate can resolve to the
  // right origin while its re-SERIALIZED form collapses "/.." or "/." and
  // becomes the protocol-relative "//evil.com", which a second resolution
  // sends off-site. A check on the parsed object alone misses this; only a
  // round-trip over the emitted string catches it.
  it.each(["/..//evil.com", "/.//evil.com", "/%2e%2e//evil.com"])(
    "falls back for the normalization-smuggled host %s",
    (input) => {
      expect(normalizeNextPath(input, "/fallback")).toBe("/fallback");
    }
  );

  // "/..&#47;/evil.com" is the fourth variant from the sanitizeHref regression
  // (lib/sanitize-post.test.ts) — there, HTML attribute values are
  // entity-decoded before validation, so "&#47;" becomes "/" and this reduces
  // to "/..//evil.com" above. normalizeNextPath has no such decoding step
  // (its input is a raw query-string value, never HTML), so "&#47;" stays
  // literal text: harmless, and the path round-trips safely.
  it("passes through the literal '&#47;' variant unchanged (no HTML decoding happens here)", () => {
    expect(normalizeNextPath("/..&#47;/evil.com", "/fallback")).toBe("/..&#47;/evil.com");
  });
});
