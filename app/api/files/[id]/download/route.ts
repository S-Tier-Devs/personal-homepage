import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { requireAdminAuth } from "@/lib/auth/admin-guard";
import { apiError, isUuid, logQueryError } from "@/lib/dashboard/api";
import { filesMetadata } from "@/lib/db/schema";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * GET /api/files/[id]/download
 *
 * Returns a 1-hour signed storage URL as JSON — it does not redirect, so the
 * caller is expected to fetch the URL itself. The URL is created with a forced
 * download disposition, so browsers save the file rather than render it — this
 * is what makes accepting arbitrary file types safe.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAdminAuth(request);
  if (authResult.error) {
    return authResult.error;
  }

  const { db } = authResult;
  const supabase = await createServerSupabaseClient();
  const { id } = await params;

  if (!isUuid(id)) {
    return apiError("NOT_FOUND", "No such document.", 404);
  }

  try {
    // Get file metadata
    let fileData: { id: string; storage_path: string; file_name: string } | undefined;

    try {
      const rows = await db
        .select({
          id: filesMetadata.id,
          storage_path: filesMetadata.storage_path,
          file_name: filesMetadata.file_name,
        })
        .from(filesMetadata)
        .where(eq(filesMetadata.id, id))
        .limit(1);

      fileData = rows[0];
    } catch (error) {
      logQueryError("File lookup error:", error);
      return apiError("SERVER_ERROR", "Could not prepare the download.", 500);
    }

    if (!fileData) {
      return apiError("NOT_FOUND", "No such document.", 404);
    }

    // Generate signed URL (valid for 1 hour)
    const { data, error: urlError } = await supabase.storage
      .from("files")
      .createSignedUrl(fileData.storage_path, 3600, { download: fileData.file_name });

    if (urlError || !data) {
      console.error("Signed URL generation error:", urlError);
      return apiError("STORAGE_ERROR", "Could not prepare the download.", 500);
    }

    // Update last_downloaded_at. The Supabase-era call never checked this
    // write's result either, so a failure here is swallowed the same way —
    // it must not turn a successful signed URL into a 500.
    try {
      await db
        .update(filesMetadata)
        .set({ last_downloaded_at: new Date().toISOString() })
        .where(eq(filesMetadata.id, id));
    } catch (error) {
      logQueryError("Last-downloaded update error:", error);
    }

    return NextResponse.json(
      {
        signedUrl: data.signedUrl,
        fileName: fileData.file_name,
      },
      { status: 200 }
    );
  } catch (error) {
    logQueryError("Download URL generation error:", error);
    return apiError("SERVER_ERROR", "Internal server error.", 500);
  }
}
