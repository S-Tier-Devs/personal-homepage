import { describe, expect, it } from "vitest";

import {
  TOKEN_DISPLAY_PREFIX_LENGTH,
  hashApiToken,
  isWellFormedToken,
  mintApiToken,
} from "./tokens";

describe("mintApiToken", () => {
  it("mints pbk_-prefixed base64url tokens of the documented shape", () => {
    const minted = mintApiToken();

    // "pbk_" + 32 random bytes base64url (43 chars, no padding).
    expect(minted.token).toMatch(/^pbk_[A-Za-z0-9_-]{43}$/);
    expect(minted.prefix).toBe(minted.token.slice(0, TOKEN_DISPLAY_PREFIX_LENGTH));
    expect(minted.hash).toBe(hashApiToken(minted.token));
  });

  it("mints distinct tokens", () => {
    expect(mintApiToken().token).not.toBe(mintApiToken().token);
  });
});

describe("hashApiToken", () => {
  it("is deterministic SHA-256 hex", () => {
    const token = "pbk_" + "a".repeat(43);

    expect(hashApiToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiToken(token)).toBe(hashApiToken(token));
  });
});

describe("isWellFormedToken", () => {
  it("accepts the minted shape and rejects everything else", () => {
    expect(isWellFormedToken(mintApiToken().token)).toBe(true);
    expect(isWellFormedToken("pbk_short")).toBe(false);
    expect(isWellFormedToken("abc_" + "a".repeat(43))).toBe(false);
    expect(isWellFormedToken("")).toBe(false);
    // base64url alphabet only — "+" and "/" are the standard-base64 tells.
    expect(isWellFormedToken("pbk_" + "+".repeat(43))).toBe(false);
  });
});
