import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import { MAX_FILE_SIZE_BYTES } from "@/lib/dashboard/files";

/*
 * vi.mock factories are hoisted above ordinary top-level consts, so every
 * mock they reference must be created inside vi.hoisted — same idiom as
 * lib/auth/actions.test.ts.
 */
const { requireAdminAuth, storageUpload, storageRemove, insertCapture, insertReturning } =
  vi.hoisted(() => ({
    requireAdminAuth: vi.fn(),
    storageUpload: vi.fn(),
    storageRemove: vi.fn(),
    insertCapture: vi.fn(),
    insertReturning: vi.fn(),
  }));

vi.mock("@/lib/auth/admin-guard", () => ({ requireAdminAuth }));

/** The storage call chain the route still touches directly. */
function makeSupabase() {
  return {
    storage: {
      from: () => ({ upload: storageUpload, remove: storageRemove }),
    },
  };
}

/** The Drizzle insert chain the route touches for the metadata row. */
function makeDb() {
  return {
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        insertCapture(row);
        return { returning: insertReturning };
      },
    }),
  };
}

function uploadRequest(file: File): NextRequest {
  const body = new FormData();
  body.append("file", file);
  // The handler only calls request.formData(), which plain Request provides.
  return new Request("http://localhost/api/files/upload", {
    method: "POST",
    body,
  }) as unknown as NextRequest;
}

beforeEach(() => {
  requireAdminAuth.mockReset();
  storageUpload.mockReset();
  storageRemove.mockReset();
  insertCapture.mockReset();
  insertReturning.mockReset();

  requireAdminAuth.mockResolvedValue({
    user: { id: "admin-1", email: "admin@example.com" },
    supabase: makeSupabase(),
    db: makeDb(),
  });
  storageUpload.mockResolvedValue({ error: null });
  insertReturning.mockResolvedValue([{ id: "row-1" }]);
});

describe("POST /api/files/upload", () => {
  it.each([
    ["archive.zip", "application/zip"],
    ["photo.png", "image/png"],
    ["dump.sql", "application/octet-stream"],
    ["Makefile", ""],
  ])("accepts %s reported as %j", async (name, type) => {
    const { POST } = await import("./route");

    const response = await POST(uploadRequest(new File([new Uint8Array(8)], name, { type })));

    expect(response.status).toBe(201);
  });

  it("stores application/octet-stream when the browser reports no type", async () => {
    const { POST } = await import("./route");

    await POST(uploadRequest(new File([new Uint8Array(8)], "Makefile", { type: "" })));

    expect(insertCapture).toHaveBeenCalledWith(
      expect.objectContaining({ mime_type: "application/octet-stream", file_extension: "" })
    );
  });

  it("passes the normalized content type to storage", async () => {
    const { POST } = await import("./route");

    await POST(uploadRequest(new File([new Uint8Array(8)], "notes", { type: "" })));

    expect(storageUpload).toHaveBeenCalledWith(
      expect.stringMatching(/^uploads\//),
      expect.anything(),
      { contentType: "application/octet-stream" }
    );
  });

  it("rejects a file over 50MB with FILE_TOO_LARGE", async () => {
    const { POST } = await import("./route");

    const oversize = new File([new Uint8Array(MAX_FILE_SIZE_BYTES + 1)], "big.bin", {
      type: "application/zip",
    });
    const response = await POST(uploadRequest(oversize));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("FILE_TOO_LARGE");
    expect(storageUpload).not.toHaveBeenCalled();
  });
});
