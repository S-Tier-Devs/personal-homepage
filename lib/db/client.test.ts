import { describe, expect, it, vi } from "vitest";

type MockClient = {
  options: {
    parsers: Record<number, (value: string) => unknown>;
    serializers: Record<number, unknown>;
  };
  end: ReturnType<typeof vi.fn>;
};

// vi.mock is hoisted above imports; postgresMock must be created via
// vi.hoisted so the factory below can close over it without a TDZ error.
const { postgresMock, clients } = vi.hoisted(() => ({
  postgresMock: vi.fn(),
  clients: [] as MockClient[],
}));

vi.mock("postgres", () => ({
  default: (...args: unknown[]) => {
    postgresMock(...args);
    // Minimal shape drizzle-orm's postgres-js driver touches at construction
    // time (it patches client.options.parsers/serializers with transparent
    // (val) => val functions — the exact behavior under test below); no query
    // is ever run against this mock. Kept in `clients` so tests can inspect
    // the parsers that survive construction.
    const client: MockClient = { options: { parsers: {}, serializers: {} }, end: vi.fn() };
    clients.push(client);
    return client;
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

  describe("getDb() — effective driver configuration", () => {
    /**
     * Constructs the real handle once (getDb caches on globalThis; repeat
     * calls are cache hits) and returns the postgres.js client it was built
     * on. client.ts imports the REAL drizzle(), so this client has been
     * through the driver's construct() step that overwrites temporal parsers.
     */
    function constructedClient(): MockClient {
      const previousUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = "postgresql://mock:mock@localhost:5432/mock";

      try {
        getDb();
      } finally {
        process.env.DATABASE_URL = previousUrl;
      }

      const client = clients[0];
      expect(client).toBeDefined();
      return client;
    }

    it("hands TIMESTAMP_TYPE_CONFIG and POOL_MAX to postgres()", () => {
      constructedClient();

      const [, options] = postgresMock.mock.calls[0] as [string, { max: number; types: unknown }];
      expect(options.types).toBe(TIMESTAMP_TYPE_CONFIG);
      expect(options.max).toBe(POOL_MAX);
    });

    it("keeps normalizeTemporalText as the EFFECTIVE parser for every temporal OID after drizzle() — drizzle's postgres-js driver overwrites these at construction, so deleting the re-assertion loop in buildDb() must fail this test", () => {
      const client = constructedClient();

      // The `types` option alone is NOT enough: drizzle-orm/postgres-js
      // construct() replaces client.options.parsers[1184|1114|1082] with a
      // transparent (val) => val. This asserts on what a query would actually
      // run — the parser installed on the client — not on the option object
      // handed to postgres(), which stayed green while production returned
      // non-ISO timestamps.
      for (const oid of TIMESTAMP_PARSER_IDS) {
        const parser = client.options.parsers[oid];
        expect(parser, `parser for OID ${oid}`).toBeTypeOf("function");
        expect(parser("2026-07-29 13:26:14.684465+00")).toBe("2026-07-29T13:26:14.684465+00:00");
      }
    });
  });
});
