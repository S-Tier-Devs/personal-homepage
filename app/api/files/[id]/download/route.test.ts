import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { requireAdminAuth, selectLimit, updateWhere, createSignedUrl } = vi.hoisted(() => ({
  requireAdminAuth: vi.fn(),
  selectLimit: vi.fn(),
  updateWhere: vi.fn(),
  createSignedUrl: vi.fn(),
}));

vi.mock("@/lib/auth/admin-guard", () => ({ requireAdminAuth }));

/** The storage call chain the route still touches directly. */
function makeSupabase() {
  return {
    storage: { from: () => ({ createSignedUrl }) },
  };
}

/** The Drizzle select/update chains the route touches for the metadata row. */
function makeDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({ limit: selectLimit }),
      }),
    }),
    update: () => ({
      set: () => ({ where: updateWhere }),
    }),
  };
}

const FILE_ID = "9f8b7c6d-1e2f-4a5b-8c9d-0a1b2c3d4e5f";

function downloadRequest(): NextRequest {
  return new Request(`http://localhost/api/files/${FILE_ID}/download`) as unknown as NextRequest;
}

beforeEach(() => {
  requireAdminAuth.mockReset();
  selectLimit.mockReset();
  updateWhere.mockReset();
  createSignedUrl.mockReset();

  requireAdminAuth.mockResolvedValue({
    user: { id: "admin-1", email: "admin@example.com" },
    supabase: makeSupabase(),
    db: makeDb(),
  });
  selectLimit.mockResolvedValue([
    { id: FILE_ID, storage_path: "uploads/abc.pdf", file_name: "report.pdf" },
  ]);
  updateWhere.mockResolvedValue(undefined);
  createSignedUrl.mockResolvedValue({
    data: { signedUrl: "https://signed.example/abc" },
    error: null,
  });
});

describe("GET /api/files/[id]/download", () => {
  it("requests the signed URL with a forced download disposition", async () => {
    const { GET } = await import("./route");

    const response = await GET(downloadRequest(), {
      params: Promise.resolve({ id: FILE_ID }),
    });

    expect(response.status).toBe(200);
    expect(createSignedUrl).toHaveBeenCalledWith("uploads/abc.pdf", 3600, {
      download: "report.pdf",
    });
    expect(await response.json()).toEqual({
      signedUrl: "https://signed.example/abc",
      fileName: "report.pdf",
    });
  });
});
