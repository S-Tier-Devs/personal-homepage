import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { isAdminEmail } from "@/lib/auth/admin";
import { verifyClaims } from "@/lib/auth/claims";
import { mintApiToken } from "@/lib/auth/tokens";
import { getDb } from "@/lib/db/client";

import { requireBlogAuth } from "./blog-guard";

vi.mock("@/lib/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth/claims", () => ({ verifyClaims: vi.fn() }));
vi.mock("@/lib/auth/admin", () => ({ isAdminEmail: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({}),
}));

const mockedGetDb = vi.mocked(getDb);
const mockedVerifyClaims = vi.mocked(verifyClaims);
const mockedIsAdminEmail = vi.mocked(isAdminEmail);

/** Fake Drizzle handle covering select().from().where().limit() and update(). */
function fakeDb(rows: unknown[]) {
  const updateWhere = vi.fn().mockResolvedValue([]);

  return {
    db: {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }),
      update: () => ({ set: () => ({ where: updateWhere }) }),
    },
    updateWhere,
  };
}

function requestWith(authorization?: string) {
  return new NextRequest("http://test.local/api/blog/posts", {
    headers: authorization !== undefined ? { authorization } : undefined,
  });
}

const VALID = mintApiToken();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireBlogAuth — token path", () => {
  it("accepts a valid, unrevoked, blog-scoped token", async () => {
    const { db } = fakeDb([
      { id: "tok-1", scopes: ["blog"], revoked_at: null, last_used_at: null },
    ]);
    mockedGetDb.mockReturnValue(db as never);

    const result = await requireBlogAuth(requestWith(`Bearer ${VALID.token}`));

    expect(result.actor).toEqual({ kind: "agent", tokenId: "tok-1" });
  });

  it("401s an unknown token", async () => {
    const { db } = fakeDb([]);
    mockedGetDb.mockReturnValue(db as never);

    const result = await requireBlogAuth(requestWith(`Bearer ${VALID.token}`));

    expect(result.error?.status).toBe(401);
  });

  it("401s a malformed bearer value WITHOUT falling back to the session", async () => {
    const result = await requireBlogAuth(requestWith("Bearer not-a-token"));

    expect(result.error?.status).toBe(401);
    // The downgrade hole: a broken token must never ride the admin cookie.
    expect(mockedVerifyClaims).not.toHaveBeenCalled();
  });

  it("401s a non-Bearer Authorization header without session fallback", async () => {
    const result = await requireBlogAuth(requestWith("Basic abc"));

    expect(result.error?.status).toBe(401);
    expect(mockedVerifyClaims).not.toHaveBeenCalled();
  });

  it("throttles last_used_at to once per minute", async () => {
    const recent = new Date(Date.now() - 10_000).toISOString();
    const { db, updateWhere } = fakeDb([
      { id: "tok-1", scopes: ["blog"], revoked_at: null, last_used_at: recent },
    ]);
    mockedGetDb.mockReturnValue(db as never);

    await requireBlogAuth(requestWith(`Bearer ${VALID.token}`));

    expect(updateWhere).not.toHaveBeenCalled();
  });

  it("stamps last_used_at when stale", async () => {
    const stale = new Date(Date.now() - 120_000).toISOString();
    const { db, updateWhere } = fakeDb([
      { id: "tok-1", scopes: ["blog"], revoked_at: null, last_used_at: stale },
    ]);
    mockedGetDb.mockReturnValue(db as never);

    await requireBlogAuth(requestWith(`Bearer ${VALID.token}`));

    expect(updateWhere).toHaveBeenCalledTimes(1);
  });
});

describe("requireBlogAuth — session path", () => {
  it("accepts the admin session when no Authorization header is present", async () => {
    mockedGetDb.mockReturnValue(fakeDb([]).db as never);
    mockedVerifyClaims.mockResolvedValue({ id: "user-1", email: "a@b.c" });
    mockedIsAdminEmail.mockReturnValue(true);

    const result = await requireBlogAuth(requestWith());

    expect(result.actor).toEqual({ kind: "admin", userId: "user-1" });
  });

  it("401s with no session and no header", async () => {
    mockedVerifyClaims.mockResolvedValue(null);

    const result = await requireBlogAuth(requestWith());

    expect(result.error?.status).toBe(401);
  });

  it("403s a non-admin session", async () => {
    mockedVerifyClaims.mockResolvedValue({ id: "user-2", email: "x@y.z" });
    mockedIsAdminEmail.mockReturnValue(false);

    const result = await requireBlogAuth(requestWith());

    expect(result.error?.status).toBe(403);
  });
});
