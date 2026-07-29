import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/*
 * vi.mock factories are hoisted above ordinary top-level consts, so every
 * mock they reference must be created inside vi.hoisted — same idiom as
 * app/api/files/upload/route.test.ts.
 */
const { requireAdminAuth, selectWhere, insertReturning } = vi.hoisted(() => ({
  requireAdminAuth: vi.fn(),
  selectWhere: vi.fn(),
  insertReturning: vi.fn(),
}));

vi.mock("@/lib/auth/admin-guard", () => ({ requireAdminAuth }));

/**
 * The two Drizzle chains POST touches: listCategorySiblings' awaited
 * select().from().where(), and the insert().values().returning() write.
 */
function makeDb() {
  return {
    select: () => ({ from: () => ({ where: selectWhere }) }),
    insert: () => ({ values: () => ({ returning: insertReturning }) }),
  };
}

function postRequest(body: unknown): NextRequest {
  return new Request("http://localhost/api/categories", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

/**
 * The shape drizzle-orm actually throws (node_modules/drizzle-orm/errors.js):
 * every query failure is wrapped in a DrizzleQueryError whose message embeds
 * the query text and params and which carries NO SQLSTATE of its own — the
 * postgres.js PostgresError, with the string `code`, rides on `cause`.
 * Built by shape rather than importing drizzle internals, matching how
 * postgresErrorCode must stay shape-agnostic.
 */
function drizzleWrappedError(code: string): Error {
  const cause = Object.assign(
    new Error('duplicate key value violates unique constraint "dashboard_categories_ctx_kind_name_key"'),
    { code }
  );

  return new Error(
    'Failed query: insert into "dashboard_categories" ("id", "ctx", "kind", "name", "sort_order", "created_at") values (default, $1, $2, $3, $4, default)\nparams: work,link,Tools,0',
    { cause }
  );
}

beforeEach(() => {
  requireAdminAuth.mockReset();
  selectWhere.mockReset();
  insertReturning.mockReset();

  requireAdminAuth.mockResolvedValue({
    user: { id: "admin-1", email: "admin@example.com" },
    db: makeDb(),
  });
  // No pre-existing siblings: the in-route case-insensitive check passes and
  // the write is reached, so the only duplicate defense left is the 23505 net.
  selectWhere.mockResolvedValue([]);
});

describe("POST /api/categories", () => {
  it("returns 409 CONFLICT when the insert loses the unique race — a drizzle-wrapped 23505 must be unwrapped, not surfaced as a 500", async () => {
    const { POST } = await import("./route");

    insertReturning.mockRejectedValue(drizzleWrappedError("23505"));

    const response = await POST(postRequest({ ctx: "work", kind: "link", name: "Tools" }));
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(payload.error).toBe("CONFLICT");
  });

  it("still returns 500 SERVER_ERROR for a wrapped non-unique failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("./route");

    insertReturning.mockRejectedValue(drizzleWrappedError("57014")); // query_canceled

    const response = await POST(postRequest({ ctx: "work", kind: "link", name: "Tools" }));
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(500);
    expect(payload.error).toBe("SERVER_ERROR");
    errorSpy.mockRestore();
  });
});
