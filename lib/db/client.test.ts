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

const { POOL_MAX, TIMESTAMP_TYPE_CONFIG, TIMESTAMP_PARSER_IDS, parseTimestamptz, getDb } = await import(
  "./client"
);

describe("db client configuration", () => {
  it("caps the pool at 4 connections (basic-xxs app + shared 1GB cluster)", () => {
    expect(POOL_MAX).toBe(4);
  });

  it("passes timestamp text through verbatim", () => {
    expect(parseTimestamptz("2026-07-29 12:00:00+00")).toBe("2026-07-29 12:00:00+00");
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

  it("parses a representative value for each type as a verbatim string, not a Date", () => {
    const tstz = TIMESTAMP_TYPE_CONFIG.timestamptz.parse("2026-07-29 12:00:00+00");
    const ts = TIMESTAMP_TYPE_CONFIG.timestamp.parse("2026-07-29 12:00:00");
    const date = TIMESTAMP_TYPE_CONFIG.date.parse("2026-07-29");

    expect(tstz).toBe("2026-07-29 12:00:00+00");
    expect(ts).toBe("2026-07-29 12:00:00");
    expect(date).toBe("2026-07-29");
    expect(tstz).not.toBeInstanceOf(Date);
    expect(ts).not.toBeInstanceOf(Date);
    expect(date).not.toBeInstanceOf(Date);
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
