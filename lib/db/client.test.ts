import { describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above imports; postgresMock must be created via
// vi.hoisted so the factory below can close over it without a TDZ error.
const { postgresMock } = vi.hoisted(() => ({ postgresMock: vi.fn() }));

vi.mock("postgres", () => ({
  default: (...args: unknown[]) => {
    postgresMock(...args);
    // Minimal shape drizzle-orm's postgres-js driver touches at construction
    // time (it patches client.options.parsers/serializers); no query is ever
    // run against this mock.
    return { options: { parsers: {}, serializers: {} }, end: vi.fn() };
  },
}));

const {
  POOL_MAX,
  TIMESTAMP_TYPE_CONFIG,
  TIMESTAMP_PARSER_IDS,
  normalizeTemporalText,
  getDb,
} = await import("./client");

describe("db client configuration", () => {
  it("caps the pool at 4 connections (basic-xxs app + shared 1GB cluster)", () => {
    expect(POOL_MAX).toBe(4);
  });

  it("carries an entry for each of timestamptz (1184), timestamp (1114), and date (1082)", () => {
    expect(TIMESTAMP_TYPE_CONFIG.timestamptz.to).toBe(1184);
    expect(TIMESTAMP_TYPE_CONFIG.timestamp.to).toBe(1114);
    expect(TIMESTAMP_TYPE_CONFIG.date.to).toBe(1082);
    expect(TIMESTAMP_PARSER_IDS).toEqual([1184, 1114, 1082]);
  });

  it("registers each entry's `from` array against its own OID", () => {
    expect(TIMESTAMP_TYPE_CONFIG.timestamptz.from).toContain(1184);
    expect(TIMESTAMP_TYPE_CONFIG.timestamp.from).toContain(1114);
    expect(TIMESTAMP_TYPE_CONFIG.date.from).toContain(1082);
  });

  describe("normalizeTemporalText — postgres.js wire form -> ISO 8601 shape", () => {
    it("expands a bare +00 offset and swaps the space for T, keeping microsecond precision", () => {
      expect(normalizeTemporalText("2026-07-29 13:26:14.684465+00")).toBe(
        "2026-07-29T13:26:14.684465+00:00"
      );
    });

    it("expands a negative non-zero offset the same way", () => {
      expect(normalizeTemporalText("2026-07-29 13:26:14.684465-05")).toBe(
        "2026-07-29T13:26:14.684465-05:00"
      );
    });

    it("leaves an offset that already carries minutes untouched", () => {
      expect(normalizeTemporalText("2026-07-29 13:26:14.684465+05:30")).toBe(
        "2026-07-29T13:26:14.684465+05:30"
      );
    });

    it("swaps the space for T on a plain timestamp with no offset, and adds nothing", () => {
      expect(normalizeTemporalText("2026-07-29 12:00:00")).toBe("2026-07-29T12:00:00");
    });

    it("leaves a bare date (no time component) unchanged", () => {
      expect(normalizeTemporalText("2026-07-29")).toBe("2026-07-29");
    });

    it("produces a timestamptz string that Date can parse without NaN", () => {
      const normalized = normalizeTemporalText("2026-07-29 13:26:14.684465+00");
      expect(Number.isNaN(new Date(normalized).getTime())).toBe(false);
    });

    it("does not truncate microsecond precision", () => {
      expect(normalizeTemporalText("2026-07-29 13:26:14.684465+00")).toContain(".684465");
    });
  });

  it("hands TIMESTAMP_TYPE_CONFIG to postgres() by reference — deleting or replacing `types` in buildDb() must fail this test", () => {
    const previousUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://mock:mock@localhost:5432/mock";
    postgresMock.mockClear();

    try {
      getDb();
    } finally {
      process.env.DATABASE_URL = previousUrl;
    }

    expect(postgresMock).toHaveBeenCalledTimes(1);
    const [, options] = postgresMock.mock.calls[0] as [string, { max: number; types: unknown }];
    expect(options.types).toBe(TIMESTAMP_TYPE_CONFIG);
    expect(options.max).toBe(POOL_MAX);
  });
});
