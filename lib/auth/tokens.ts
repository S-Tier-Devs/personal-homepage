import crypto from "crypto";

/**
 * Blog API tokens (F-013). Format: "pbk_" + 32 random bytes base64url.
 *
 * Stored as SHA-256 hex, looked up by hash. SHA-256 (not argon2) is correct
 * here: the token carries 256 bits of entropy, so a slow hash adds nothing,
 * and lookup must be by deterministic hash. The full value is shown once at
 * creation and never again; everywhere else only the prefix may appear.
 */

const TOKEN_PREFIX = "pbk_";
/** "pbk_" + 8 — safe to display and to log. */
export const TOKEN_DISPLAY_PREFIX_LENGTH = 12;

/** 32 bytes → 43 base64url chars, no padding. */
const TOKEN_PATTERN = /^pbk_[A-Za-z0-9_-]{43}$/;

export function mintApiToken(): { token: string; hash: string; prefix: string } {
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString("base64url");

  return {
    token,
    hash: hashApiToken(token),
    prefix: token.slice(0, TOKEN_DISPLAY_PREFIX_LENGTH),
  };
}

export function hashApiToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Cheap shape check run before any DB lookup, so garbage never costs a query
 * and a malformed header can be rejected as 401 without touching Postgres.
 */
export function isWellFormedToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}
