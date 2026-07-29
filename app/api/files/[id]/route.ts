import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { requireAdminAuth } from "@/lib/auth/admin-guard";
import { apiError, isUuid, readJsonObject } from "@/lib/dashboard/api";
import { filesMetadata } from "@/lib/db/schema";

/**
 * PATCH /api/files/[id]
 * Update file metadata (visibility, description).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAdminAuth(request);
  if (authResult.error) {
    return authResult.error;
  }

  const { db } = authResult;
  const { id } = await params;

  // A non-uuid id would make Postgres raise 22P02 and surface as a 500, when
  // the honest answer is that no such row exists.
  if (!isUuid(id)) {
    return apiError("NOT_FOUND", "No such document.", 404);
  }

  try {
    const body = await readJsonObject(request);

    if (!body) {
      return apiError("INVALID_BODY", "Expected a JSON object.", 400);
    }

    const { visibility, description } = body;

    // Validate visibility if provided
    if (visibility !== undefined && visibility !== "private" && visibility !== "public") {
      return apiError("INVALID_BODY", "Visibility must be 'private' or 'public'.", 400);
    }

    if (description !== undefined && description !== null && typeof description !== "string") {
      return apiError("INVALID_BODY", "Description must be a string or null.", 400);
    }

    // Update file metadata
    const updateData: Record<string, unknown> = {};
    if (visibility !== undefined) updateData.visibility = visibility;
    if (description !== undefined) updateData.description = description;

    if (Object.keys(updateData).length === 0) {
      return apiError("INVALID_BODY", "No fields to update.", 400);
    }

    let file: Record<string, unknown> | undefined;

    try {
      // No explicit column list: the Supabase-era route selected "*" back on
      // update, so `.returning()` (every column) keeps the response shape
      // identical, unlike the deliberately narrow FILE_FIELDS in the list route.
      const rows = await db
        .update(filesMetadata)
        .set(updateData)
        .where(eq(filesMetadata.id, id))
        .returning();

      file = rows[0];
    } catch (error) {
      console.error("File update error:", error);
      return apiError("SERVER_ERROR", "Could not update the document.", 500);
    }

    if (!file) {
      return apiError("NOT_FOUND", "No such document.", 404);
    }

    return NextResponse.json(
      { message: "File updated successfully", file },
      { status: 200 }
    );
  } catch (error) {
    console.error("File update error:", error);
    return apiError("SERVER_ERROR", "Internal server error.", 500);
  }
}

/**
 * DELETE /api/files/[id]
 * Delete a file from storage and remove metadata.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAdminAuth(request);
  if (authResult.error) {
    return authResult.error;
  }

  const { supabase, db } = authResult;
  const { id } = await params;

  if (!isUuid(id)) {
    return apiError("NOT_FOUND", "No such document.", 404);
  }

  try {
    // Get file metadata
    let fileData: { id: string; storage_path: string } | undefined;

    try {
      const rows = await db
        .select({ id: filesMetadata.id, storage_path: filesMetadata.storage_path })
        .from(filesMetadata)
        .where(eq(filesMetadata.id, id))
        .limit(1);

      fileData = rows[0];
    } catch (error) {
      console.error("File lookup error:", error);
      return apiError("SERVER_ERROR", "Could not delete the document.", 500);
    }

    if (!fileData) {
      return apiError("NOT_FOUND", "No such document.", 404);
    }

    // Delete from storage
    const { error: storageError } = await supabase.storage
      .from("files")
      .remove([fileData.storage_path]);

    if (storageError) {
      console.error("Storage deletion error:", storageError);
      return apiError("STORAGE_ERROR", "Could not remove the stored file.", 500);
    }

    // Delete metadata from database
    try {
      await db.delete(filesMetadata).where(eq(filesMetadata.id, id));
    } catch (error) {
      console.error("Database deletion error:", error);
      return apiError("SERVER_ERROR", "Could not delete the document.", 500);
    }

    return NextResponse.json(
      { message: "File deleted successfully" },
      { status: 200 }
    );
  } catch (error) {
    console.error("File deletion error:", error);
    return apiError("SERVER_ERROR", "Internal server error.", 500);
  }
}
