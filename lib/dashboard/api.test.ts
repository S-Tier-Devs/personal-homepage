import { describe, expect, it, vi } from "vitest";

import { logQueryError } from "./api";

/**
 * The shape drizzle-orm actually throws (node_modules/drizzle-orm/errors.js):
 * every query failure is wrapped in an `Error` whose message embeds the query
 * text and the literal parameter VALUES, and which carries no SQLSTATE of its
 * own — the postgres.js `PostgresError`, with the string `code`, rides on
 * `cause`. Built by shape rather than importing drizzle internals, matching
 * app/api/categories/route.test.ts's `drizzleWrappedError` and keeping
 * `postgresErrorCode`/`logQueryError` shape-agnostic.
 */
function drizzleWrappedError(secret: string): Error {
  const cause = Object.assign(
    new Error('duplicate key value violates unique constraint "gsd_config_pkey"'),
    { code: "23505" }
  );

  return new Error(
    `Failed query: insert into "gsd_config" ("api_key") values ($1)\nparams: ${secret}`,
    { cause }
  );
}

describe("logQueryError", () => {
  it("logs the SQLSTATE and the cause's message, but never the wrapper message that embeds the leaked parameter value", () => {
    const FAKE_SECRET = "gsd_sk_test_fakeSECRET12345";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logQueryError("GSD key save error:", drizzleWrappedError(FAKE_SECRET));

    expect(errorSpy).toHaveBeenCalledTimes(1);

    const loggedArgs = errorSpy.mock.calls[0] ?? [];

    // No argument passed to console.error — logged individually, not as one
    // interpolated string — may contain the fake secret.
    for (const arg of loggedArgs) {
      expect(String(arg)).not.toContain(FAKE_SECRET);
    }

    // The SQLSTATE must still make it through the unwrap, or the 23505/23503
    // -> 409 nets in the category routes (and any future caller) lose their
    // signal.
    expect(loggedArgs).toContain("23505");

    errorSpy.mockRestore();
  });

  it("falls back to the error's own message when there is no cause (e.g. a route-constructed Error)", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logQueryError("GSD key save error:", new Error("upsert returned no row"));

    expect(errorSpy).toHaveBeenCalledWith("GSD key save error:", null, "upsert returned no row");

    errorSpy.mockRestore();
  });
});
