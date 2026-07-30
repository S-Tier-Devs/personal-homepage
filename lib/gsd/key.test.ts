import { beforeEach, describe, expect, it, vi } from "vitest";

const limit = vi.fn();

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({
    select: vi.fn(() => ({ from: vi.fn(() => ({ limit })) })),
  })),
}));

import { resolveGsdKey } from "@/lib/gsd/key";

describe("resolveGsdKey", () => {
  beforeEach(() => {
    limit.mockReset();
  });

  it("returns the key when the row exists", async () => {
    limit.mockResolvedValue([{ api_key: "gsd_abc123" }]);

    expect(await resolveGsdKey()).toBe("gsd_abc123");
  });

  it("returns null when no row exists", async () => {
    limit.mockResolvedValue([]);

    expect(await resolveGsdKey()).toBeNull();
  });

  it("returns null on a query error rather than throwing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    limit.mockRejectedValue(new Error("boom"));

    expect(await resolveGsdKey()).toBeNull();
    errorSpy.mockRestore();
  });
});
