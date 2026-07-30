import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

import { requireAdminAuth } from "@/lib/auth/admin-guard";
import { apiError, logQueryError } from "@/lib/dashboard/api";
import {
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
  fileExtension,
} from "@/lib/dashboard/files";
import { filesMetadata } from "@/lib/db/schema";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * POST /api/files/upload
 *
 * Validates size, writes the bytes to Supabase Storage, then records the metadata row.
 */
export async function POST(request: NextRequest) {
  // Verify admin authentication
  const authResult = await requireAdminAuth(request);
  if (authResult.error) {
    return authResult.error;
  }

  const { user, db } = authResult;
  const supabase = await createServerSupabaseClient();

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const description = formData.get("description") as string | null;

    if (!file) {
      return apiError("INVALID_BODY", "No file was provided.", 400);
    }

    const fileName = file.name;
    const extension = fileExtension(fileName);
    // Browsers report no MIME for extensions the OS does not register
    // (.sql/.md on Windows) — store the octet-stream default rather than "".
    const contentType = file.type || "application/octet-stream";

    // Validate file size
    const fileBuffer = await file.arrayBuffer();
    if (fileBuffer.byteLength > MAX_FILE_SIZE_BYTES) {
      return apiError("FILE_TOO_LARGE", `File too large. Max size: ${MAX_FILE_SIZE_LABEL}`, 400);
    }

    // Generate unique storage path
    const fileId = crypto.randomUUID();
    const storagePath = `uploads/${fileId}${extension}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("files")
      .upload(storagePath, fileBuffer, {
        contentType,
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      return apiError("STORAGE_ERROR", "Could not store the file.", 500);
    }

    // Store metadata in Postgres
    let insertedFile: Record<string, unknown> | undefined;

    try {
      const rows = await db
        .insert(filesMetadata)
        .values({
          storage_path: storagePath,
          file_name: fileName,
          mime_type: contentType,
          file_extension: extension,
          file_size_bytes: fileBuffer.byteLength,
          description: description || null,
          visibility: "private",
          uploaded_by: user.id,
        })
        .returning();

      insertedFile = rows[0];
    } catch (dbError) {
      logQueryError("Database insert error:", dbError);
      // Clean up storage if metadata insert fails
      await supabase.storage.from("files").remove([storagePath]);
      return apiError("SERVER_ERROR", "Could not save the file details.", 500);
    }

    return NextResponse.json(
      { message: "File uploaded successfully", file: insertedFile },
      { status: 201 }
    );
  } catch (error) {
    logQueryError("File upload error:", error);
    return apiError("SERVER_ERROR", "Internal server error.", 500);
  }
}
