/**
 * Shared constraints and formatting for the Documents section.
 *
 * The only upload constraint is size — any file type is accepted; extension
 * and MIME type are recorded as display metadata, never validated. The size
 * limit lives here rather than inside the upload route so the client view can
 * mirror it and fail fast with a useful message. The mirror is a courtesy
 * only — `app/api/files/upload/route.ts` re-checks it, and that server check
 * (plus the storage bucket's file_size_limit backstop) is the actual boundary.
 *
 * Deliberately free of `next/server` imports so a `"use client"` component can
 * pull from the same source as the route handler.
 */

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/** Human form of `MAX_FILE_SIZE_BYTES`, for error copy and the drop-zone hint. */
export const MAX_FILE_SIZE_LABEL = `${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB`;

/**
 * Columns of `files_metadata` that the list contract exposes.
 *
 * `storage_path` and `uploaded_by` are deliberately excluded: nothing in the UI
 * needs them, and the storage path is the one field worth not handing out.
 */
export const FILE_COLUMNS =
  "id, file_name, file_size_bytes, visibility, created_at, description, mime_type, file_extension";

/**
 * `.pdf` from `report.final.pdf`; empty string when the name has no extension.
 *
 * The naive `slice(lastIndexOf("."))` returns the *last character* for a name
 * with no dot at all (`slice(-1)`), so the -1 case is handled explicitly.
 */
export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");

  return dot === -1 ? "" : fileName.slice(dot).toLowerCase();
}

/** The design's `fmtBytes` (design/patrick-beasley.dc.html:662). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "—";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1048576) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }

  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/**
 * The design's `fmtDate` (line 663), but pinned to `en-US` and UTC.
 *
 * The design passes `undefined` for the locale and lets the runtime pick the
 * time zone. Both are ambient, and this string is rendered during SSR and again
 * at hydration — a server in UTC and a browser in UTC-5 would disagree about
 * the day and React would report a hydration mismatch. Pinning both makes the
 * output a pure function of the stored timestamp.
 */
export function formatDate(iso: string): string {
  const parsed = new Date(iso);

  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The extension badge from the design (line 690): last dot-segment of the file
 * name, first four characters, upper-cased, falling back to `FILE`.
 *
 * The stored `file_extension` is preferred where present — it is what the
 * server actually recorded — with the file name as the fallback. The stored
 * value carries its leading dot, which the badge does not want.
 */
export function extensionBadge(fileName: string, storedExtension?: string | null): string {
  const stored = (storedExtension ?? "").replace(/^\./, "");
  const source = stored || fileName.split(".").pop() || "";

  return (source.slice(0, 4) || "FILE").toUpperCase();
}
