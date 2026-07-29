# Document upload expansion — design

**Date:** 2026-07-28
**Status:** Approved

## Goal

The dashboard Documents section accepts any file type up to 50MB. Today it
accepts six extensions (`.pdf`, `.docx`, `.txt`, `.md`, `.sql`, `.py`) at 10MB,
and requires the browser-reported MIME type to match an allowlist — which
re-creates the gotcha AGENTS.md documents: Windows registers no content type
for `.sql`/`.md`, Chrome sends `application/octet-stream`, and the route
rejects extensions it explicitly permits.

## Decision

Remove the type gate entirely (approach A of three considered). The server
validates auth and size only; extension and MIME become display metadata.
Rationale:

- The behavioural spec's uploader (`design/patrick-beasley.dc.html:657`) never
  restricted type — the allowlist was an implementation invention.
- Upload is admin-only into a private bucket; a type gate defends against
  nothing when the only uploader is the owner.
- Deleting the MIME check fixes the Windows misreporting bug permanently
  rather than patching around it.
- Any allowlist (approach B) guarantees a future unpredicted-type failure;
  a blocklist (approach C) protects nothing once downloads are forced to
  `attachment` (see hardening below).

## Changes

### 1. Shared constraints — `lib/dashboard/files.ts`

- Delete `ALLOWED_EXTENSIONS` and `ALLOWED_MIMETYPES`.
- `MAX_FILE_SIZE_BYTES` = `50 * 1024 * 1024`; `MAX_FILE_SIZE_LABEL` derives as
  today ("50MB").
- Keep `fileExtension()` — the extension is still recorded and drives the
  list badge.
- Update the module doc comment: the only upload constraint is size.

### 2. Upload route — `app/api/files/upload/route.ts`

- Remove both type checks (extension and MIME); the `INVALID_FILE_TYPE` code
  disappears from this route.
- Auth-first ordering and the size check are unchanged.
- Normalize metadata for files browsers cannot classify:
  - `mime_type` stores `file.type || "application/octet-stream"`.
  - A file with no extension stores `""`, exactly as `fileExtension()`
    returns today (the badge already falls back to `FILE`).
- Pass the same normalized content type to the storage upload.

### 3. Download hardening — `app/api/files/[id]/download/route.ts`

`createSignedUrl(path, 3600, { download: fileData.file_name })` forces
`Content-Disposition: attachment` with the original filename. No uploaded
file is ever rendered by a browser — only saved. This is what makes "no type
gate" safe rather than merely acceptable: HTML/SVG cannot execute even on the
Supabase domain.

### 4. Storage migration

New migration setting `storage.buckets.file_size_limit = 52428800` for the
`files` bucket. Comment mirrors the existing migration's rationale: the bucket
limit is a backstop for the route cap, and `allowed_mime_types` stays unset.

### 5. Client — `components/dashboard/documents/documents-view.tsx`

- Remove the `accept={ALLOWED_EXTENSIONS.join(",")}` attribute on the file
  input (line 374) and the two type checks in the client-side validator
  (lines 95–101).
- Keep the size fast-fail (line 103); it reads the shared 50MB constant.
- Drop-zone hint copy (line 403) becomes size-only (e.g. "Any file up to
  50MB each").

### 6. Error handling

Wire format unchanged. `FILE_TOO_LARGE` stays. A >50MB file that bypasses the
route dies at the bucket backstop and surfaces as the existing
`STORAGE_ERROR`.

## Testing

- Upload route tests: previously-rejected inputs (`.zip`, `.png`,
  extensionless names, `application/octet-stream` MIME) now succeed; oversize
  still fails with `FILE_TOO_LARGE`; delete the `INVALID_FILE_TYPE` tests.
- Download route test: the signed URL request carries the download
  disposition with the original filename.
- Gates per AGENTS.md: `npm run lint`, `npx tsc --noEmit`, `npm test`,
  `npm run build`, with exit codes checked directly.
- **Deferred, not skipped:** live verification on production — upload a real
  `.sql` file from Windows Chrome (the exact case the MIME gotcha bites) and
  a ~40MB file, then download both and confirm the attachment disposition.
  Requires a live session; record in the implementation plan.

## Out of scope

- Streaming/direct-to-storage uploads (only needed for hundreds of MB).
- Preview/rendering of uploaded files in the dashboard.
- Any change to visibility, workspace scoping (Documents is deliberately
  unscoped), or the list/delete routes.
