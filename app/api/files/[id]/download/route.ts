import { NextRequest, NextResponse } from "next/server";

import { requireAdminAuth } from "@/lib/auth/admin-guard";
import { apiError, isUuid } from "@/lib/dashboard/api";

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

  const { supabase } = authResult;
  const { id } = await params;

  if (!isUuid(id)) {
    return apiError("NOT_FOUND", "No such document.", 404);
  }

  try {
    // Get file metadata
    const { data: fileData, error: fileError } = await supabase
      .from("files_metadata")
      .select("id, storage_path, file_name")
      .eq("id", id)
      .maybeSingle();

    if (fileError) {
      console.error("File lookup error:", fileError);
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

    // Update last_downloaded_at
    await supabase
      .from("files_metadata")
      .update({ last_downloaded_at: new Date().toISOString() })
      .eq("id", id);

    return NextResponse.json(
      {
        signedUrl: data.signedUrl,
        fileName: fileData.file_name,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Download URL generation error:", error);
    return apiError("SERVER_ERROR", "Internal server error.", 500);
  }
}
