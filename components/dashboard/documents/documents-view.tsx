"use client";

import { useMemo, useRef, useState } from "react";

import { DocIcon, DownloadIcon, TrashIcon } from "@/components/dashboard/icons";
import { useToast } from "@/components/dashboard/toast";
import {
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
  extensionBadge,
  fileExtension,
  formatBytes,
  formatDate,
} from "@/lib/dashboard/files";
import type { DocumentItem } from "@/lib/dashboard/types";

/**
 * Marks a row that exists only in local state while its upload is in flight.
 * Such a row has no server id yet, so it can be neither downloaded nor deleted.
 */
const OPTIMISTIC_PREFIX = "optimistic-";

/**
 * Pulls a human-readable message off a failed API response. Dashboard routes
 * answer with `{ error, message }`, but a proxy or a crash can produce
 * something else entirely, so every branch falls back.
 *
 * Deliberately duplicated from `links-view.tsx` rather than hoisted into a
 * shared module: Notes is being written concurrently and a new shared file
 * touched by two branches is the one thing guaranteed to conflict. Worth
 * collapsing into one helper once both have landed.
 */
async function readApiError(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json();

    if (typeof body === "object" && body !== null) {
      const { message, error } = body as { message?: unknown; error?: unknown };

      if (typeof message === "string" && message) {
        return message;
      }

      if (typeof error === "string" && error) {
        return error;
      }
    }
  } catch {
    // Non-JSON error responses fall through to the generic message.
  }

  return fallback;
}

/**
 * Narrows the row the upload route echoes back. It returns `select("*")`, a
 * superset of the list contract, so the extra columns are dropped here rather
 * than carried around in client state.
 */
function toDocumentItem(value: unknown): DocumentItem | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const row = value as Record<string, unknown>;

  if (typeof row.id !== "string" || typeof row.file_name !== "string") {
    return null;
  }

  const size = Number(row.file_size_bytes);

  return {
    id: row.id,
    file_name: row.file_name,
    file_extension: typeof row.file_extension === "string" ? row.file_extension : null,
    mime_type: typeof row.mime_type === "string" ? row.mime_type : null,
    file_size_bytes: Number.isFinite(size) ? size : 0,
    description: typeof row.description === "string" ? row.description : null,
    visibility: row.visibility === "public" ? "public" : "private",
    created_at: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
  };
}

/**
 * Mirrors the upload route's size check so a doomed file is rejected before
 * 50MB go over the wire. Returns the reason, or null when the file is fine.
 * The server re-checks this regardless.
 */
function rejectionReason(file: File): string | null {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `${file.name} is larger than ${MAX_FILE_SIZE_LABEL}.`;
  }

  return null;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

const ICON_BUTTON_CLASS =
  "grid h-8 w-8 flex-none place-items-center rounded-lg border border-border bg-transparent disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The Documents widget.
 *
 * Note what this component does *not* do: it never calls `useWorkspace()`.
 * `files_metadata` has no `ctx` column, so documents are not workspace-scoped —
 * the same flat list is correct in both Work and Home. The accent colour still
 * follows the workspace, but through `data-ctx` on the dashboard shell, which
 * means there is no code path here that could accidentally start filtering.
 */
export default function DocumentsView({
  initialDocuments,
}: {
  initialDocuments: DocumentItem[];
}) {
  const showToast = useToast();

  const [documents, setDocuments] = useState<DocumentItem[]>(initialDocuments);
  const [dragging, setDragging] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sorted at render, so a rolled-back delete lands back where it came from
  // and an in-flight upload sits at the top where the user expects it.
  const visibleDocuments = useMemo(
    () => [...documents].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [documents]
  );

  // Derived, not tracked in its own state: an in-flight row is exactly a row
  // whose id is still local.
  const uploadingCount = documents.filter((doc) => doc.id.startsWith(OPTIMISTIC_PREFIX)).length;

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  /**
   * Uploads a batch. Each file is independent: one rejection or one failed
   * request never stops the files behind it.
   */
  async function ingest(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);

    if (files.length === 0) {
      return;
    }

    const accepted: File[] = [];
    const rejections: string[] = [];

    for (const file of files) {
      const reason = rejectionReason(file);

      if (reason) {
        rejections.push(reason);
      } else {
        accepted.push(file);
      }
    }

    if (rejections.length > 0) {
      // One toast at a time, so extra rejections are counted rather than
      // silently overwriting each other.
      showToast(
        rejections.length === 1
          ? rejections[0]
          : `${rejections[0]} (+${rejections.length - 1} more skipped)`
      );
    }

    if (accepted.length === 0) {
      return;
    }

    let uploaded = 0;
    let lastFailure: string | null = null;

    // Sequential on purpose: several 10MB uploads fired at once compete for the
    // same connection and make every one of them look stalled.
    for (const file of accepted) {
      const temporaryId = `${OPTIMISTIC_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const optimistic: DocumentItem = {
        id: temporaryId,
        file_name: file.name,
        file_extension: fileExtension(file.name) || null,
        mime_type: file.type || null,
        file_size_bytes: file.size,
        description: null,
        visibility: "private",
        created_at: new Date().toISOString(),
      };

      setDocuments((previous) => [optimistic, ...previous]);

      try {
        const form = new FormData();
        form.append("file", file);

        const response = await fetch("/api/files/upload", { method: "POST", body: form });

        if (!response.ok) {
          throw new Error(await readApiError(response, `Could not upload ${file.name}.`));
        }

        const body: unknown = await response.json();
        const saved = toDocumentItem((body as { file?: unknown } | null)?.file);

        if (!saved) {
          throw new Error(`${file.name} uploaded but the server sent back an unreadable row.`);
        }

        setDocuments((previous) =>
          previous.map((doc) => (doc.id === temporaryId ? saved : doc))
        );
        uploaded += 1;
      } catch (error) {
        setDocuments((previous) => previous.filter((doc) => doc.id !== temporaryId));
        lastFailure =
          error instanceof Error ? error.message : `Could not upload ${file.name}.`;
      }
    }

    if (lastFailure) {
      showToast(lastFailure);
    } else if (uploaded > 0) {
      showToast(`${plural(uploaded, "file")} uploaded`);
    }
  }

  function handleDragOver(event: React.DragEvent) {
    event.preventDefault();
    setDragging(true);
  }

  function handleDragLeave(event: React.DragEvent) {
    // Moving onto a child still fires dragleave on the parent; ignoring those
    // keeps the highlight from flickering over the "browse" button.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }

    setDragging(false);
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    void ingest(event.dataTransfer.files);
  }

  /**
   * The download route hands back a signed storage URL as JSON rather than
   * redirecting, so the bytes are fetched here and handed to an anchor as a
   * blob. Pointing the anchor straight at the signed URL would not work: it is
   * cross-origin, so the `download` attribute is ignored and the browser
   * navigates the tab away from the dashboard instead of saving the file.
   */
  async function handleDownload(doc: DocumentItem) {
    if (downloadingId) {
      return;
    }

    setDownloadingId(doc.id);

    try {
      const response = await fetch(`/api/files/${doc.id}/download`);

      if (!response.ok) {
        throw new Error(await readApiError(response, "Could not prepare the download."));
      }

      const body: unknown = await response.json();
      const { signedUrl, fileName } = (body ?? {}) as {
        signedUrl?: unknown;
        fileName?: unknown;
      };

      if (typeof signedUrl !== "string" || !signedUrl) {
        throw new Error("Could not prepare the download.");
      }

      const fileResponse = await fetch(signedUrl);

      if (!fileResponse.ok) {
        throw new Error("The storage link was rejected before the download started.");
      }

      const objectUrl = URL.createObjectURL(await fileResponse.blob());
      const anchor = document.createElement("a");

      anchor.href = objectUrl;
      anchor.download = typeof fileName === "string" && fileName ? fileName : doc.file_name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      // Revoking in the same tick can cancel the save in some browsers; the
      // click has already handed the blob over by the time this fires.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not prepare the download.");
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleDelete(target: DocumentItem) {
    setDocuments((previous) => previous.filter((doc) => doc.id !== target.id));

    try {
      const response = await fetch(`/api/files/${target.id}`, { method: "DELETE" });

      if (!response.ok) {
        throw new Error(await readApiError(response, "Could not delete the document."));
      }

      showToast("Document deleted");
    } catch (error) {
      // Order is derived at render time, so re-appending restores the row to
      // exactly the position it came from.
      setDocuments((previous) =>
        previous.some((doc) => doc.id === target.id) ? previous : [...previous, target]
      );
      showToast(error instanceof Error ? error.message : "Could not delete the document.");
    }
  }

  return (
    <section
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-[18px]">
        <div className="flex min-w-[160px] flex-1 items-center gap-[10px]">
          <span className="flex text-accent">
            <DocIcon />
          </span>
          <h2 className="font-heading text-[17px] font-semibold">Documents</h2>
          {/* "shared" is the design's own word for it: this list is not
              workspace-scoped, and the header says so. */}
          <span className="font-mono text-xs text-muted">{documents.length} · shared</span>
        </div>

        <button
          type="button"
          onClick={openFilePicker}
          className="inline-flex h-[34px] cursor-pointer items-center gap-1.5 rounded-[9px] px-[14px] text-[13px] font-semibold text-white bg-accent"
        >
          ↑ Upload
        </button>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          aria-label="Choose documents to upload"
          onChange={(event) => {
            void ingest(event.target.files);
            // Lets the same file be picked twice in a row — without this a
            // retry after a failure would not fire a change event.
            event.target.value = "";
          }}
          className="hidden"
        />
      </div>

      <div
        aria-hidden={false}
        className={[
          "mx-5 my-4 rounded-xl border-[1.5px] border-dashed px-5 py-[22px] text-center text-[13px]",
          dragging
            ? "border-accent bg-accent-soft text-text-2"
            : "border-border-2 bg-surface-2 text-muted",
        ].join(" ")}
      >
        Drag files here, or{" "}
        <button
          type="button"
          onClick={openFilePicker}
          className="cursor-pointer border-none bg-transparent p-0 text-[13px] font-semibold text-accent"
        >
          browse
        </button>{" "}
        — any file up to {MAX_FILE_SIZE_LABEL} each.
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {visibleDocuments.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">No documents yet.</p>
        ) : (
          <ul className="list-none">
            {visibleDocuments.map((doc) => {
              const uploading = doc.id.startsWith(OPTIMISTIC_PREFIX);
              const downloading = downloadingId === doc.id;

              return (
                <li
                  key={doc.id}
                  className={[
                    "flex items-center gap-3 border-b border-border px-5 py-3 hover:bg-surface-2",
                    uploading ? "opacity-60" : "",
                  ].join(" ")}
                >
                  <span
                    aria-hidden="true"
                    className="grid h-[38px] w-[38px] flex-none place-items-center rounded-[9px] bg-accent-soft font-mono text-[10px] font-semibold text-accent"
                  >
                    {extensionBadge(doc.file_name, doc.file_extension)}
                  </span>

                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-text">
                      {doc.file_name}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-muted">
                      {uploading
                        ? "Uploading…"
                        : `${formatBytes(doc.file_size_bytes)} · ${formatDate(doc.created_at)}`}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDownload(doc)}
                    disabled={uploading || downloadingId !== null}
                    aria-label={`Download ${doc.file_name}`}
                    title="Download"
                    className={`${ICON_BUTTON_CLASS} cursor-pointer text-text-2 hover:text-text`}
                  >
                    {downloading ? (
                      <span aria-hidden="true" className="font-mono text-[10px]">
                        …
                      </span>
                    ) : (
                      <DownloadIcon />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDelete(doc)}
                    disabled={uploading}
                    aria-label={`Delete ${doc.file_name}`}
                    title="Delete"
                    className={`${ICON_BUTTON_CLASS} cursor-pointer text-muted hover:text-text`}
                  >
                    <TrashIcon />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Announced rather than merely dimmed, so a screen-reader user knows a
          drop was accepted and how many files are still going up. */}
      <p role="status" aria-live="polite" className="sr-only">
        {uploadingCount > 0 ? `Uploading ${plural(uploadingCount, "file")}…` : ""}
      </p>
    </section>
  );
}
