import { describe, expect, it } from "vitest";

import { POOL_MAX, TIMESTAMP_PARSER_IDS, parseTimestamptz } from "./client";

describe("db client configuration", () => {
  it("caps the pool at 4 connections (basic-xxs app + shared 1GB cluster)", () => {
    expect(POOL_MAX).toBe(4);
  });

  it("registers string parsers for both timestamp OIDs", () => {
    // 1184 = timestamptz, 1114 = timestamp — PostgREST returned strings for
    // both; Date objects here would silently change the wire format and every
    // formatDate call site.
    expect(TIMESTAMP_PARSER_IDS).toEqual([1184, 1114]);
  });

  it("passes timestamp text through verbatim", () => {
    expect(parseTimestamptz("2026-07-29 12:00:00+00")).toBe("2026-07-29 12:00:00+00");
  });
});
