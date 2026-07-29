import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { requireAdminAuth, maybeSingle, updateEq, createSignedUrl } = vi.hoisted(() => ({
  requireAdminAuth: vi.fn(),
  maybeSingle: vi.fn(),
  updateEq: vi.fn(),
  createSignedUrl: vi.fn(),
}));

vi.mock("@/lib/auth/admin-guard", () => ({ requireAdminAuth }));

function makeSupabase() {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
      update: () => ({ eq: updateEq }),
    }),
    storage: { from: () => ({ createSignedUrl }) },
  };
}

const FILE_ID = "9f8b7c6d-1e2f-4a5b-8c9d-0a1b2c3d4e5f";

function downloadRequest(): NextRequest {
  return new Request(`http://localhost/api/files/${FILE_ID}/download`) as unknown as NextRequest;
}

beforeEach(() => {
  requireAdminAuth.mockReset();
  maybeSingle.mockReset();
  updateEq.mockReset();
  createSignedUrl.mockReset();

  requireAdminAuth.mockResolvedValue({
    user: { id: "admin-1", email: "admin@example.com" },
    supabase: makeSupabase(),
  });
  maybeSingle.mockResolvedValue({
    data: { id: FILE_ID, storage_path: "uploads/abc.pdf", file_name: "report.pdf" },
    error: null,
  });
  updateEq.mockResolvedValue({ error: null });
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
