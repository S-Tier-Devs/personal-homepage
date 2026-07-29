# Open Document Uploads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Documents section accepts any file type up to 50MB, with downloads forced to `attachment` disposition.

**Architecture:** Delete the extension/MIME allowlists from the shared constraints module and both their enforcement sites (upload route, client validator), leaving auth + size as the only upload checks. Harden the download route so signed URLs always carry `Content-Disposition: attachment`. Raise the storage bucket's `file_size_limit` backstop to 50MB by migration.

**Tech Stack:** Next.js 16 route handlers, Supabase Storage, vitest (`vi.hoisted` + `vi.mock` pattern per `lib/auth/actions.test.ts`).

**Spec:** `docs/superpowers/specs/2026-07-28-document-upload-expansion-design.md`

## Global Constraints

- Every task gates on `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` — run each as its own command and check its own exit code (`cmd | tail -2 && echo OK` is a false green; AGENTS.md).
- Wire format unchanged: failures are `{ error: "MACHINE_CODE", message: "..." }` via `apiError()`; upload success stays `201` with the entity.
- `requireAdminAuth(request)` remains the first statement of every touched handler.
- The new size cap is exactly `50 * 1024 * 1024` = `52428800` bytes, spelled `50MB` in copy.
- Files with no browser-reported MIME store `application/octet-stream`; extensionless names store `""` as `file_extension`.
- Commit messages end with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01QXQkYtVifVCLySwsDD2LVB`
- These are the first route-handler tests in the repo. Follow the mocking idiom in `lib/auth/actions.test.ts`: anything a mock factory references is created inside `vi.hoisted`, and the module under test is loaded with `await import(...)` after the mocks.

---

### Task 1: Remove the type gate and raise the cap to 50MB

One coherent change: the allowlists and both their consumers go together, or `tsc` breaks between commits.

**Files:**
- Modify: `lib/dashboard/files.ts` (delete lines 13–31, change line 33)
- Modify: `app/api/files/upload/route.ts` (remove lines 44–59, normalize MIME)
- Modify: `components/dashboard/documents/documents-view.tsx` (validator lines 92–108, `accept` at line 374, hint copy at line 403, imports at lines 8–11)
- Test (create): `app/api/files/upload/route.test.ts`

**Interfaces:**
- Consumes: `requireAdminAuth` (`lib/auth/admin-guard.ts`) resolving `{ user: { id, email }, supabase }` or `{ error: NextResponse }`; `apiError(code, message, status)` from `lib/dashboard/api`.
- Produces: `lib/dashboard/files.ts` no longer exports `ALLOWED_EXTENSIONS` / `ALLOWED_MIMETYPES`; `MAX_FILE_SIZE_BYTES === 52428800`. Everything else that module exports is unchanged. Task 2 and 3 do not depend on this task.

- [ ] **Step 1: Write the failing route test**

Create `app/api/files/upload/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import { MAX_FILE_SIZE_BYTES } from "@/lib/dashboard/files";

/*
 * vi.mock factories are hoisted above ordinary top-level consts, so every
 * mock they reference must be created inside vi.hoisted — same idiom as
 * lib/auth/actions.test.ts.
 */
const { requireAdminAuth, storageUpload, storageRemove, insertCapture, insertSingle } =
  vi.hoisted(() => ({
    requireAdminAuth: vi.fn(),
    storageUpload: vi.fn(),
    storageRemove: vi.fn(),
    insertCapture: vi.fn(),
    insertSingle: vi.fn(),
  }));

vi.mock("@/lib/auth/admin-guard", () => ({ requireAdminAuth }));

/** The two supabase call chains the route touches, thin enough to assert on. */
function makeSupabase() {
  return {
    storage: {
      from: () => ({ upload: storageUpload, remove: storageRemove }),
    },
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        insertCapture(row);
        return { select: () => ({ single: insertSingle }) };
      },
    }),
  };
}

function uploadRequest(file: File): NextRequest {
  const body = new FormData();
  body.append("file", file);
  // The handler only calls request.formData(), which plain Request provides.
  return new Request("http://localhost/api/files/upload", {
    method: "POST",
    body,
  }) as unknown as NextRequest;
}

beforeEach(() => {
  requireAdminAuth.mockReset();
  storageUpload.mockReset();
  storageRemove.mockReset();
  insertCapture.mockReset();
  insertSingle.mockReset();

  requireAdminAuth.mockResolvedValue({
    user: { id: "admin-1", email: "admin@example.com" },
    supabase: makeSupabase(),
  });
  storageUpload.mockResolvedValue({ error: null });
  insertSingle.mockResolvedValue({ data: { id: "row-1" }, error: null });
});

describe("POST /api/files/upload", () => {
  it.each([
    ["archive.zip", "application/zip"],
    ["photo.png", "image/png"],
    ["dump.sql", "application/octet-stream"],
    ["Makefile", ""],
  ])("accepts %s reported as %j", async (name, type) => {
    const { POST } = await import("./route");

    const response = await POST(uploadRequest(new File([new Uint8Array(8)], name, { type })));

    expect(response.status).toBe(201);
  });

  it("stores application/octet-stream when the browser reports no type", async () => {
    const { POST } = await import("./route");

    await POST(uploadRequest(new File([new Uint8Array(8)], "Makefile", { type: "" })));

    expect(insertCapture).toHaveBeenCalledWith(
      expect.objectContaining({ mime_type: "application/octet-stream", file_extension: "" })
    );
  });

  it("passes the normalized content type to storage", async () => {
    const { POST } = await import("./route");

    await POST(uploadRequest(new File([new Uint8Array(8)], "notes", { type: "" })));

    expect(storageUpload).toHaveBeenCalledWith(
      expect.stringMatching(/^uploads\//),
      expect.anything(),
      { contentType: "application/octet-stream" }
    );
  });

  it("rejects a file over 50MB with FILE_TOO_LARGE", async () => {
    const { POST } = await import("./route");

    const oversize = new File([new Uint8Array(MAX_FILE_SIZE_BYTES + 1)], "big.bin", {
      type: "application/zip",
    });
    const response = await POST(uploadRequest(oversize));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("FILE_TOO_LARGE");
    expect(storageUpload).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/api/files/upload/route.test.ts`
Expected: FAIL — the `it.each` cases get 400 `INVALID_FILE_TYPE` (`.zip`/`.png` are not allowlisted; `octet-stream` fails the MIME check), and the octet-stream normalization assertions fail because the route never reaches the insert. The oversize test also fails: `.bin` is rejected by the extension check, so the error code is `INVALID_FILE_TYPE`, not the expected `FILE_TOO_LARGE`.

- [ ] **Step 3: Update `lib/dashboard/files.ts`**

Delete `ALLOWED_EXTENSIONS` and `ALLOWED_MIMETYPES` (lines 13–31 including their doc comments). Change the size constant:

```ts
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
```

Replace the module doc comment's first paragraph so it no longer promises type checks:

```ts
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
```

Everything else in the file (`fileExtension`, `formatBytes`, `formatDate`, `extensionBadge`, `FILE_COLUMNS`, `MAX_FILE_SIZE_LABEL`) is unchanged.

- [ ] **Step 4: Update `app/api/files/upload/route.ts`**

Remove `ALLOWED_EXTENSIONS` and `ALLOWED_MIMETYPES` from the import. Replace the validation block (current lines 40–59) with:

```ts
    const fileName = file.name;
    const extension = fileExtension(fileName);
    // Browsers report no MIME for extensions the OS does not register
    // (.sql/.md on Windows) — store the octet-stream default rather than "".
    const contentType = file.type || "application/octet-stream";
```

Use `contentType` in both places that currently read `file.type`: the storage upload option (`contentType,`) and the metadata insert (`mime_type: contentType,`). Update the route doc comment's first line to "Validates size, writes the bytes to Supabase Storage, then records the metadata row." No other changes — auth-first ordering, size check, cleanup-on-insert-failure all stay.

- [ ] **Step 5: Update `components/dashboard/documents/documents-view.tsx`**

Remove `ALLOWED_EXTENSIONS` and `ALLOWED_MIMETYPES` from the import block (lines 8–11); if `fileExtension` becomes unused as a result, remove it too (lint will flag it). Replace `rejectionReason` (lines 87–108) with:

```ts
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
```

Delete the `accept={ALLOWED_EXTENSIONS.join(",")}` attribute from the file input (line 374) — no `accept` attribute at all. Change the drop-zone hint (line 403) from

```tsx
        — {ALLOWED_EXTENSIONS.join(", ")}, up to {MAX_FILE_SIZE_LABEL} each.
```

to

```tsx
        — any file up to {MAX_FILE_SIZE_LABEL} each.
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run app/api/files/upload/route.test.ts`
Expected: PASS (all cases).

- [ ] **Step 7: Run the full gates**

Run each separately, checking each exit code: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`.
Expected: all pass. `npm test` also proves the existing suite didn't depend on the deleted exports.

- [ ] **Step 8: Commit**

```bash
git add lib/dashboard/files.ts app/api/files/upload/route.ts components/dashboard/documents/documents-view.tsx app/api/files/upload/route.test.ts
git commit -m "Accept any file type up to 50MB in Documents uploads"
```

(with the co-author/session trailer from Global Constraints)

---

### Task 2: Force download disposition on signed URLs

**Files:**
- Modify: `app/api/files/[id]/download/route.ts:48`
- Test (create): `app/api/files/[id]/download/route.test.ts`

**Interfaces:**
- Consumes: `requireAdminAuth` and `apiError` as in Task 1. Independent of Task 1's changes.
- Produces: the signed URL is created with `createSignedUrl(storagePath, 3600, { download: fileName })`, which makes Supabase serve `Content-Disposition: attachment; filename=...`. Response shape unchanged: `{ signedUrl, fileName }`.

- [ ] **Step 1: Write the failing test**

Create `app/api/files/[id]/download/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { requireAdminAuth, maybeSingle, updateEq, createSignedUrl } = vi.hoisted(() => ({
  requireAdminAuth: vi.fn(),
  maybeSingle: vi.fn(),
  updateEq: vi.fn(),
  createSignedUrl: vi.fn(),
}));

vi.mock("@/lib/auth/admin-guard", () => ({ requireAdminAuth }));

function makeSupabase() {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
      update: () => ({ eq: updateEq }),
    }),
    storage: { from: () => ({ createSignedUrl }) },
  };
}

const FILE_ID = "9f8b7c6d-1e2f-4a5b-8c9d-0a1b2c3d4e5f";

function downloadRequest(): NextRequest {
  return new Request(`http://localhost/api/files/${FILE_ID}/download`) as unknown as NextRequest;
}

beforeEach(() => {
  requireAdminAuth.mockReset();
  maybeSingle.mockReset();
  updateEq.mockReset();
  createSignedUrl.mockReset();

  requireAdminAuth.mockResolvedValue({
    user: { id: "admin-1", email: "admin@example.com" },
    supabase: makeSupabase(),
  });
  maybeSingle.mockResolvedValue({
    data: { id: FILE_ID, storage_path: "uploads/abc.pdf", file_name: "report.pdf" },
    error: null,
  });
  updateEq.mockResolvedValue({ error: null });
  createSignedUrl.mockResolvedValue({
    data: { signedUrl: "https://signed.example/abc" },
    error: null,
  });
});

describe("GET /api/files/[id]/download", () => {
  it("requests the signed URL with a forced download disposition", async () => {
    const { GET } = await import("./route");

    const response = await GET(downloadRequest(), {
      params: Promise.resolve({ id: FILE_ID }),
    });

    expect(response.status).toBe(200);
    expect(createSignedUrl).toHaveBeenCalledWith("uploads/abc.pdf", 3600, {
      download: "report.pdf",
    });
    expect(await response.json()).toEqual({
      signedUrl: "https://signed.example/abc",
      fileName: "report.pdf",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run "app/api/files/[id]/download/route.test.ts"`
Expected: FAIL — `createSignedUrl` is called with only two arguments today.

- [ ] **Step 3: Implement**

In `app/api/files/[id]/download/route.ts`, change line 48:

```ts
      .createSignedUrl(fileData.storage_path, 3600, { download: fileData.file_name });
```

Add one line to the route doc comment: "The URL is created with a forced download disposition, so browsers save the file rather than render it — this is what makes accepting arbitrary file types safe."

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run "app/api/files/[id]/download/route.test.ts"`
Expected: PASS.

- [ ] **Step 5: Full gates, then commit**

Run the four gates as in Task 1 Step 7. Then:

```bash
git add "app/api/files/[id]/download/route.ts" "app/api/files/[id]/download/route.test.ts"
git commit -m "Force attachment disposition on document downloads"
```

(with the co-author/session trailer)

---

### Task 3: Raise the storage bucket backstop to 50MB

**Files:**
- Create: `supabase/migrations/202607280001_files_bucket_50mb.sql`

**Interfaces:**
- Consumes: nothing from other tasks (the bucket backstop and the route cap are independent enforcement points; either order works, but both must land before the feature is real).
- Produces: `storage.buckets.file_size_limit = 52428800` for bucket `files`, live in production.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/202607280001_files_bucket_50mb.sql`:

```sql
-- Raise the files bucket size backstop from 10MB to 50MB, mirroring
-- MAX_FILE_SIZE_BYTES in lib/dashboard/files.ts. The route check is the
-- boundary users see; this limit only stops an oversize object landing if
-- the route check is ever bypassed.
--
-- allowed_mime_types stays deliberately unset: as of this migration the
-- application accepts any file type (see
-- docs/superpowers/specs/2026-07-28-document-upload-expansion-design.md).
update storage.buckets
set file_size_limit = 52428800
where id = 'files';

-- Rollback guidance:
-- update storage.buckets set file_size_limit = 10485760 where id = 'files';
```

- [ ] **Step 2: Apply it to the Supabase project**

Use the Supabase MCP tool `mcp__supabase__apply_migration` with name `files_bucket_50mb` and the SQL above (write mode is configured; see the Supabase MCP setup memory). Do NOT paste the service-role key or any secret into the session.

- [ ] **Step 3: Prove the stored value**

Per AGENTS.md ("prefer proving a claim to asserting it"), read back what was stored, not what was sent — use `mcp__supabase__execute_sql`:

```sql
select file_size_limit from storage.buckets where id = 'files';
```

Expected: `52428800`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/202607280001_files_bucket_50mb.sql
git commit -m "Raise files bucket size backstop to 50MB"
```

(with the co-author/session trailer)

---

### Task 4: Final verification and deferral record

**Files:**
- None created; this task is gates + evidence.

**Interfaces:**
- Consumes: all previous tasks merged into the branch.
- Produces: a verified branch and an explicit record of what live verification remains.

- [ ] **Step 1: Run all four gates on the assembled branch**

Run each as its own command, checking each exit code directly: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`. Expected: all pass.

- [ ] **Step 2: Record the deferred live verification**

These need a live authenticated session on production and are **deferred, not skipped** (AGENTS.md). Report them in the final summary to the user, verbatim:

1. Upload a real `.sql` file from Windows Chrome — the exact file the MIME gotcha bites today — and confirm 201.
2. Upload a ~40MB file and confirm it succeeds; confirm a >50MB file is rejected with the 50MB message.
3. Download both and confirm the browser saves (attachment disposition) rather than renders.
4. Confirm the drop-zone hint reads "any file up to 50MB each".

---

## Execution notes

- Per the user's standing model-selection preference: dispatch Tasks 1–3 on the cheapest tier able to follow complete code (the plan contains all code verbatim); reviewers on mid-tier; final whole-branch review on the most capable model.
- Tasks 1 and 2 are independent; Task 3 touches only Supabase. Task 4 must run last.
- Production deploys on merge to `main` (`deploy_on_push: true`); the migration in Task 3 takes effect when applied, not when merged — apply order is harmless either way because the route cap and bucket cap enforce independently.
