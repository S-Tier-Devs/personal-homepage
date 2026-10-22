import crypto from "crypto";
import { imageSize } from "image-size";
import { NextResponse, type NextRequest } from "next/server";

import { requireBlogAuth } from "@/lib/auth/blog-guard";
import { MAX_IMAGE_BYTES, sniffImage } from "@/lib/blog/images";
import { apiError, logQueryError } from "@/lib/dashboard/api";
import { getSpacesMediaBucket, getSpacesMediaCdnUrl } from "@/lib/env";
import { publicUrl, putPublicObject } from "@/lib/storage/spaces";

/**
 * POST /api/blog/media — multipart `file` (+ optional `alt`).
 * Images only in v1; the general name and response shape are deliberate so
 * future media types (videos → presigned uploads; see backlog) are additive.
 * Returns dimensions so <img width/height> can prevent layout shift.
 */
export async function POST(request: NextRequest) {
  const authResult = await requireBlogAuth(request);
  if (authResult.error) {
    return authResult.error;
  }

  const cdnUrl = getSpacesMediaCdnUrl();

  if (!cdnUrl) {
    return apiError("SERVER_ERROR", "Media storage is not configured.", 500);
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    // Malformed multipart (bad boundary, truncated body, wrong content
    // type) must read as a client error, not fall through to the generic
    // STORAGE_ERROR 500 below — nothing was ever sent to storage.
    return apiError("INVALID_BODY", "Request body must be multipart form data.", 400);
  }

  try {
    const file = formData.get("file");
    const altRaw = formData.get("alt");

    if (!(file instanceof File)) {
      return apiError("INVALID_BODY", "No file was provided.", 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return apiError("IMAGE_TOO_LARGE", "Images must be 10 MB or smaller.", 400);
    }

    // Bytes decide the type — the browser-reported MIME is never consulted.
    const sniffed = sniffImage(buffer);

    if (!sniffed) {
      return apiError(
        "INVALID_IMAGE_TYPE",
        "Only JPEG, PNG, WebP, and GIF are accepted (sniffed, not by extension).",
        400
      );
    }

    let width: number | undefined;
    let height: number | undefined;

    try {
      const dims = imageSize(buffer);

      width = dims.width;
      height = dims.height;
    } catch {
      // Dimensions are a nicety; an undecodable-but-valid-magic file still uploads.
    }

    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const key = `blog/${yyyy}/${mm}/${crypto.randomUUID()}.${sniffed.extension}`;

    await putPublicObject({
      bucket: getSpacesMediaBucket(),
      key,
      body: buffer,
      contentType: sniffed.contentType,
    });

    return NextResponse.json(
      {
        url: publicUrl(cdnUrl, key),
        contentType: sniffed.contentType,
        width,
        height,
        alt: typeof altRaw === "string" && altRaw.trim() ? altRaw.trim() : null,
      },
      { status: 201 }
    );
  } catch (error) {
    logQueryError("Media upload error:", error);
    return apiError("STORAGE_ERROR", "Could not store the image.", 500);
  }
}
