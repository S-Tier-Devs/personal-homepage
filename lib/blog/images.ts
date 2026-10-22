/**
 * Image allowlisting by SNIFFED MAGIC BYTES — browser MIME is unreliable
 * (Windows registers none for some extensions; see the MIME lesson in
 * AGENTS.md) and file names are attacker-chosen. No SVG, deliberately: it is
 * a script vector (spec §Media).
 */

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export interface SniffedImage {
  contentType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  extension: "jpg" | "png" | "gif" | "webp";
}

export function sniffImage(buffer: Buffer): SniffedImage | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer.subarray(1, 4).toString("ascii") === "PNG" &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { contentType: "image/png", extension: "png" };
  }

  const head6 = buffer.subarray(0, 6).toString("ascii");

  if (head6 === "GIF87a" || head6 === "GIF89a") {
    return { contentType: "image/gif", extension: "gif" };
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { contentType: "image/webp", extension: "webp" };
  }

  return null;
}
