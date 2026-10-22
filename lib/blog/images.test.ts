import { describe, expect, it } from "vitest";

import { MAX_IMAGE_BYTES, sniffImage } from "./images";

function bytes(...values: (number | string)[]): Buffer {
  const parts = values.map((v) => (typeof v === "string" ? Buffer.from(v, "ascii") : Buffer.from([v])));

  return Buffer.concat([...parts, Buffer.alloc(32)]);
}

describe("sniffImage", () => {
  it("recognises JPEG, PNG, GIF, WebP by magic bytes", () => {
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toEqual({ contentType: "image/jpeg", extension: "jpg" });
    expect(sniffImage(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a))).toEqual({ contentType: "image/png", extension: "png" });
    expect(sniffImage(bytes("GIF89a"))).toEqual({ contentType: "image/gif", extension: "gif" });
    expect(sniffImage(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(24)]))).toEqual({ contentType: "image/webp", extension: "webp" });
  });

  it("rejects SVG, HTML-named-as-PNG, and junk — bytes decide, never names", () => {
    expect(sniffImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImage(Buffer.from("<html><script>x</script></html>"))).toBeNull();
    expect(sniffImage(Buffer.alloc(8))).toBeNull();
  });

  it("exports the 10MB cap", () => {
    expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024);
  });
});
