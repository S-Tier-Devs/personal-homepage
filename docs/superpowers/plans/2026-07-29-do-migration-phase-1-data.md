# Supabase → DO Migration, Phase 1 (Data) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All app data lives in the `homepage` database on the DO `apps-pg` cluster, accessed through Drizzle; Supabase remains only for auth (session verification) and storage bytes.

**Architecture:** Provision `homepage` DB + user on the existing cluster. Define the six carried tables in Drizzle (`lib/db/schema.ts`), generate plain-SQL migrations, and apply them. Add a Drizzle handle to `requireAdminAuth`'s return alongside the existing Supabase client, rewrite each route vertical from PostgREST to Drizzle one task at a time (gates stay green throughout), then remove the Supabase client from the guard's return. A one-time script copies the ~55 rows; the cutover runbook wraps the copy and deploy in an App Platform maintenance window.

**Tech Stack:** Next.js 16 route handlers, Drizzle ORM + `postgres` (postgres.js) driver, drizzle-kit for migrations, DO Managed Postgres 17, vitest.

**Spec:** `docs/superpowers/specs/2026-07-29-supabase-to-digitalocean-phase-1-data-design.md`

## Global Constraints

- Every task gates on `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` — each as its own command, checking its own exit code (`cmd | tail -2 && echo OK` is a false green; AGENTS.md).
- Wire format unchanged, byte-for-byte where observable: failures are `{ error: "MACHINE_CODE", message: "..." }` via `apiError()`; create → 201 bare entity; update → 200 bare entity; delete → `{ ok: true }` (files routes keep their existing `{ message, file }` deviation — normalizing it is a separate deferred branch, NOT this one); lists → one named collection key.
- `requireAdminAuth(request)` stays the first statement of every touched handler. Its session verification (JWKS local verify via `@supabase/ssr`) is untouched this phase.
- **Timestamps stay strings.** The `postgres` driver must be configured with type parsers that return `timestamptz`/`timestamp`/`date` columns as ISO strings, not `Date` objects (Task 2 does this once, in `lib/db/client.ts`). Never `new Date(...)` a row value in a route to compensate.
- Connection pool: `max: 4`, never the driver default (basic-xxs app + shared 1GB cluster).
- Drizzle schema column names use the exact snake_case DB names via explicit mapping; TS property names are the same snake_case strings the wire format already uses (`category_id`, `content_html`, ...), so route/view code and `lib/dashboard/types.ts` keep working unchanged.
- Workspace scoping rules unchanged: Links/Notes filter by workspace, Documents/Settings do NOT.
- Never print a database password, connection string, or any secret into command output, logs, or committed files. `.env.local` is gitignored — verify before writing to it.
- The committed `.do/app.yaml` gets `DATABASE_URL` as a blank `type: SECRET` env; the real value goes only into the **live** spec (`doctl apps spec get` → edit → `update`), per AGENTS.md.
- Commit messages end with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01E1ZZ4kMwmryJgfnz9zCfxQ`

## Model selection (per the owner's standing policy)

- Task 2 schema/client code is verbatim in this plan but has toolchain integration risk → mid-tier implementer.
- Tasks 3–8: integration work → mid-tier implementers. Reviewers mid-tier.
- Task 9 (copy script) is verbatim → cheapest tier.
- Task 10 is an operator runbook executed by the controller with the owner, not a dispatched implementation task.
- Final whole-branch review: most capable model.

---

### Task 1: Provision the `homepage` database and user on `apps-pg`

Operational task (no app code). Cluster ID `e7e891cb-e694-4357-af84-b12755bd4d0b`, region nyc3, engine pg 17.

**Files:**
- Modify: `.env.local` (gitignored — add `DATABASE_URL`; verify gitignore first)

**Interfaces:**
- Produces: database `homepage`, user `homepage` with rights on that database only; `DATABASE_URL` in `.env.local` (public hostname for local dev; the live app uses the private hostname, set in Task 10). Tasks 2 and 9 consume `DATABASE_URL`.

- [ ] **Step 1: Create database and user**

```bash
doctl databases db create e7e891cb-e694-4357-af84-b12755bd4d0b homepage
doctl databases user create e7e891cb-e694-4357-af84-b12755bd4d0b homepage
```

- [ ] **Step 2: Scope privileges**

DO managed PG grants new users broad rights via the `doadmin` role model; lock the new user to its own database. Connect as `doadmin` to the cluster (host/port from `doctl databases connection e7e891cb-e694-4357-af84-b12755bd4d0b --format Host,Port`) and run the SQL below. Use `psql` if installed; otherwise make a throwaway driver in the scratchpad — `mkdir grant-tmp && cd grant-tmp && npm init -y && npm install postgres`, then a five-line `grant.mjs` that reads the admin URL from an env var and executes the statements. Either way the repo is untouched and no password is printed:

```sql
revoke connect on database homepage from public;
grant connect on database homepage to homepage;
grant connect on database homepage to doadmin;
-- inside the homepage database:
grant all on schema public to homepage;
alter default privileges in schema public grant all on tables to homepage;
alter default privileges in schema public grant all on sequences to homepage;
```

Note: migrations (Task 2) run as `doadmin` or as `homepage` — run them as `homepage` so created objects are owned by the app user and no ownership fixups are needed.

- [ ] **Step 3: Verify isolation both ways**

Prove, don't assert (AGENTS.md): connecting as `homepage` to database `gsd` must FAIL; connecting as `gsd` to database `homepage` must FAIL; connecting as `homepage` to database `homepage` must SUCCEED. Record the three observed results in the task report.

- [ ] **Step 4: Write `DATABASE_URL` to `.env.local` without echoing it**

Confirm `.env.local` is gitignored (`git check-ignore .env.local` exits 0). Then build the URL from `doctl databases user get e7e891cb-e694-4357-af84-b12755bd4d0b homepage --output json` and the cluster's public host/port, writing directly to the file from a script — never printing the password to stdout. Shape:

`DATABASE_URL=postgresql://homepage:<password>@<public-host>:25060/homepage?sslmode=require`

- [ ] **Step 5: Confirm the app's DB firewall path**

`doctl databases firewalls list e7e891cb-e694-4357-af84-b12755bd4d0b` — the `personal-homepage` app (`12e4f4c4-34cc-4ee8-abff-b5616a90a95d`) must be a trusted source (type `app`). If the `gsd` app is trusted but ours is not, add it:

```bash
doctl databases firewalls append e7e891cb-e694-4357-af84-b12755bd4d0b --rule app:12e4f4c4-34cc-4ee8-abff-b5616a90a95d
```

Local dev also needs your workstation IP trusted (or it will time out); check whether an `ip_addr` rule already exists for the gsd work and append one if not.

No commit (only gitignored/remote state changed).

---

### Task 2: Drizzle toolchain, schema, client, first migration

**Files:**
- Create: `drizzle.config.ts`, `lib/db/schema.ts`, `lib/db/client.ts`, `lib/db/client.test.ts`
- Create (generated): `drizzle/0000_*.sql` + `drizzle/meta/*`
- Modify: `package.json` (deps + scripts)

**Interfaces:**
- Produces: `db` (typed Drizzle handle) exported from `lib/db/client.ts` as `getDb(): DrizzleDb`; table objects `dashboardCategories`, `dashboardLinks`, `dashboardNotes`, `filesMetadata`, `gsdConfig`, `contactSubmissions` from `lib/db/schema.ts`; `export type DrizzleDb = ReturnType<typeof buildDb>`. All later tasks consume these exact names.

- [ ] **Step 1: Install dependencies**

```bash
npm install drizzle-orm postgres
npm install -D drizzle-kit dotenv
```

Record the resolved versions in the task report.

- [ ] **Step 2: Write `drizzle.config.ts`**

```ts
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // drizzle-kit runs locally only; .env.local is loaded via the db:* scripts.
    url: process.env.DATABASE_URL!,
  },
});
```

Add scripts to `package.json` (drizzle-kit does not read `.env.local` on its own; `dotenv -e` isn't installed — use Node's built-in flag):

```json
"db:generate": "node --env-file=.env.local node_modules/drizzle-kit/bin.cjs generate",
"db:migrate": "node --env-file=.env.local node_modules/drizzle-kit/bin.cjs migrate"
```

If `drizzle-kit`'s bin path differs in the installed version, use `npx drizzle-kit` with `--env-file` via `node --env-file=.env.local $(npx which drizzle-kit)` equivalents — what matters is: the scripts run with `.env.local` loaded, and CI/build never needs them.

- [ ] **Step 3: Write `lib/db/schema.ts`**

Column shapes below are transcribed from the live Supabase schema (verified 2026-07-29). Defaults use `sql` fragments so generated DDL matches; check constraints carry over via `check()`.

```ts
import { sql } from "drizzle-orm";
import {
  boolean,
  bigint,
  check,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Phase 1 schema — six tables carried from Supabase, byte-compatible shapes.
 * timestamptz columns are read back as ISO strings (driver parser in
 * client.ts), matching what PostgREST returned, so the wire format and every
 * formatDate call site are unchanged.
 *
 * updated_at is maintained by $onUpdate (app-level), replacing the old
 * set_updated_at trigger.
 */

const utcNow = sql`timezone('utc'::text, now())`;

export const dashboardCategories = pgTable(
  "dashboard_categories",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    ctx: text("ctx").notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    sort_order: integer("sort_order").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(utcNow),
  },
  (t) => [
    check("dashboard_categories_ctx_check", sql`${t.ctx} in ('work', 'home')`),
    check("dashboard_categories_kind_check", sql`${t.kind} in ('link', 'note')`),
  ]
);

export const dashboardLinks = pgTable(
  "dashboard_links",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    ctx: text("ctx").notNull(),
    category_id: uuid("category_id")
      .notNull()
      .references(() => dashboardCategories.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    url: text("url").notNull(),
    description: text("description"),
    sort_order: integer("sort_order").notNull().default(0),
    pinned: boolean("pinned").notNull().default(false),
    click_count: integer("click_count").notNull().default(0),
    last_clicked_at: timestamp("last_clicked_at", { withTimezone: true, mode: "string" }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(utcNow),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(utcNow)
      .$onUpdate(() => sql`timezone('utc'::text, now())`),
  },
  (t) => [check("dashboard_links_ctx_check", sql`${t.ctx} in ('work', 'home')`)]
);

export const dashboardNotes = pgTable(
  "dashboard_notes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    ctx: text("ctx").notNull(),
    category_id: uuid("category_id")
      .notNull()
      .references(() => dashboardCategories.id, { onDelete: "restrict" }),
    title: text("title").notNull().default(""),
    content_html: text("content_html").notNull().default(""),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(utcNow),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(utcNow)
      .$onUpdate(() => sql`timezone('utc'::text, now())`),
  },
  (t) => [check("dashboard_notes_ctx_check", sql`${t.ctx} in ('work', 'home')`)]
);

export const filesMetadata = pgTable(
  "files_metadata",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    storage_path: text("storage_path").notNull().unique(),
    file_name: text("file_name").notNull(),
    mime_type: text("mime_type").notNull(),
    file_extension: text("file_extension").notNull(),
    file_size_bytes: bigint("file_size_bytes", { mode: "number" }).notNull(),
    description: text("description"),
    visibility: text("visibility").notNull().default("private"),
    // Kept as a bare uuid: the auth.users FK cannot exist here (auth stays in
    // Supabase until Phase 3). Stores the Supabase auth user id this phase.
    uploaded_by: uuid("uploaded_by"),
    last_downloaded_at: timestamp("last_downloaded_at", { withTimezone: true, mode: "string" }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(utcNow),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(utcNow)
      .$onUpdate(() => sql`timezone('utc'::text, now())`),
  },
  (t) => [check("files_metadata_visibility_check", sql`${t.visibility} in ('private', 'public')`)]
);

export const gsdConfig = pgTable(
  "gsd_config",
  {
    id: smallint("id").primaryKey().default(1),
    api_key: text("api_key").notNull(),
    key_last4: text("key_last4").notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [check("gsd_config_id_check", sql`${t.id} = 1`)]
);

/** Carried for the 12-month retention policy only; no code reads it. */
export const contactSubmissions = pgTable(
  "contact_submissions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    email: text("email").notNull(),
    subject: text("subject"),
    message: text("message").notNull(),
    status: text("status").notNull().default("unread"),
    handled_by: uuid("handled_by"),
    handled_at: timestamp("handled_at", { withTimezone: true, mode: "string" }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(utcNow),
  },
  (t) => [
    check(
      "contact_submissions_status_check",
      sql`${t.status} in ('unread', 'in_progress', 'resolved', 'archived')`
    ),
  ]
);
```

Note the deliberate omissions vs. Supabase: no `admin_users`, no FK to `auth.users` anywhere, no RLS (enforcement is `requireAdminAuth` — spec's authorization-posture decision).

- [ ] **Step 4: Write the failing client test (`lib/db/client.test.ts`)**

```ts
import { describe, expect, it } from "vitest";

import { POOL_MAX, TIMESTAMP_PARSER_IDS, parseTimestamptz } from "./client";

describe("db client configuration", () => {
  it("caps the pool at 4 connections (basic-xxs app + shared 1GB cluster)", () => {
    expect(POOL_MAX).toBe(4);
  });

  it("registers string parsers for both timestamp OIDs", () => {
    // 1184 = timestamptz, 1114 = timestamp — PostgREST returned strings for
    // both; Date objects here would silently change the wire format and every
    // formatDate call site.
    expect(TIMESTAMP_PARSER_IDS).toEqual([1184, 1114]);
  });

  it("passes timestamp text through verbatim", () => {
    expect(parseTimestamptz("2026-07-29 12:00:00+00")).toBe("2026-07-29 12:00:00+00");
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npx vitest run lib/db/client.test.ts`
Expected: FAIL — `lib/db/client.ts` does not exist.

- [ ] **Step 6: Write `lib/db/client.ts`**

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

/**
 * Single process-wide pool. basic-xxs (1 instance) against the shared 1GB
 * apps-pg cluster: 4 connections is plenty for a single-admin dashboard and
 * leaves headroom for gsd. Never raise this without checking the cluster's
 * connection limit and gsd's pool size.
 */
export const POOL_MAX = 4;

/** postgres.js type OIDs overridden to return strings: timestamptz, timestamp. */
export const TIMESTAMP_PARSER_IDS = [1184, 1114] as const;

export function parseTimestamptz(value: string): string {
  return value;
}

function buildDb() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error("DATABASE_URL is not set.");
  }

  const client = postgres(url, {
    max: POOL_MAX,
    // PostgREST served timestamps as ISO strings; keep that contract so the
    // wire format and formatDate call sites are unchanged (plan Global
    // Constraints). mode:"string" on the Drizzle columns handles typing;
    // these parsers handle the runtime values.
    types: {
      timestamptz: { to: 1184, from: [1184], serialize: (v: string) => v, parse: parseTimestamptz },
      timestamp: { to: 1114, from: [1114], serialize: (v: string) => v, parse: parseTimestamptz },
    },
  });

  return drizzle(client, { schema });
}

export type DrizzleDb = ReturnType<typeof buildDb>;

/**
 * Next.js dev/HMR re-evaluates modules; cache the pool on globalThis so dev
 * doesn't leak connections. In production this is one module instance anyway.
 */
const globalForDb = globalThis as unknown as { __homepageDb?: DrizzleDb };

export function getDb(): DrizzleDb {
  if (!globalForDb.__homepageDb) {
    globalForDb.__homepageDb = buildDb();
  }

  return globalForDb.__homepageDb;
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run lib/db/client.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Generate and apply the initial migration**

```bash
npm run db:generate
npm run db:migrate
```

Inspect the generated `drizzle/0000_*.sql` before applying: it must create exactly the six tables, with the check constraints and the `files_metadata.storage_path` unique constraint, and nothing else. Then prove the applied state — run a node one-liner (scratchpad) selecting `table_name from information_schema.tables where table_schema='public'` against `DATABASE_URL` and paste the six names into the task report.

- [ ] **Step 9: Full gates**

Run each separately: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`.
Note: `npm run build` must succeed WITHOUT `DATABASE_URL` in the build environment — `getDb()` is lazy precisely so nothing connects at build/import time. If the build fails on a missing env var, something is calling `getDb()` at module scope; fix that, don't add the env var to the build.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json drizzle.config.ts lib/db/ drizzle/
git commit -m "Add Drizzle toolchain, schema, and homepage DB client"
```

(with the co-author/session trailer from Global Constraints)

---

### Task 3: Guard returns a Drizzle handle; api.ts gains Drizzle helpers

Transitional, additive-only: nothing existing breaks, later tasks migrate verticals one at a time.

**Files:**
- Modify: `lib/auth/admin-guard.ts` (return `{ user, supabase, db }`)
- Modify: `lib/dashboard/api.ts` (add `findMatchingCategoryDb`, `listCategorySiblingsDb`; keep the Supabase versions until Task 8)

**Interfaces:**
- Consumes: `getDb`, `DrizzleDb`, `dashboardCategories` from Task 2.
- Produces: `requireAdminAuth` success shape `{ user: { id, email }, supabase, db: DrizzleDb }` (Tasks 4–7 destructure `db`; existing routes keep destructuring `supabase` untouched). `findMatchingCategoryDb(db, categoryId, ctx, kind): Promise<Category | null>` and `listCategorySiblingsDb(db, ctx, kind): Promise<Category[] | null>` with semantics identical to the Supabase versions (including the null-on-read-error contract).

- [ ] **Step 1: Modify `lib/auth/admin-guard.ts`**

Add to the imports: `import { getDb } from "@/lib/db/client";` — and change the success return to:

```ts
    return { user: { id: claims.id, email: claims.email }, supabase, db: getDb() };
```

Update the doc comment's return description to `{ user, supabase, db }` and note: "`db` is the Drizzle handle for `apps-pg`; `supabase` remains for session cookies and (until Phase 2) storage. Routes should consume `db` for all data queries."

- [ ] **Step 2: Add the Drizzle helpers to `lib/dashboard/api.ts`**

Append (imports go at the top of the file: `import { and, eq } from "drizzle-orm";`, `import type { DrizzleDb } from "@/lib/db/client";`, `import { dashboardCategories } from "@/lib/db/schema";`):

```ts
/**
 * Drizzle twins of listCategorySiblings/findMatchingCategory. The Supabase
 * versions remain until every route vertical has migrated (they die in the
 * cleanup task). Contracts are identical, including null-on-error.
 */
export async function listCategorySiblingsDb(
  db: DrizzleDb,
  ctx: Ctx,
  kind: CategoryKind
): Promise<Category[] | null> {
  try {
    return await db
      .select()
      .from(dashboardCategories)
      .where(and(eq(dashboardCategories.ctx, ctx), eq(dashboardCategories.kind, kind)));
  } catch (error) {
    console.error("Category siblings read error:", error);
    return null;
  }
}

export async function findMatchingCategoryDb(
  db: DrizzleDb,
  categoryId: string,
  ctx: Ctx,
  kind: CategoryKind
): Promise<Category | null> {
  if (!isUuid(categoryId)) {
    return null;
  }

  try {
    const rows = await db
      .select()
      .from(dashboardCategories)
      .where(eq(dashboardCategories.id, categoryId))
      .limit(1);

    const category = rows[0];

    if (!category) {
      return null;
    }

    return category.ctx === ctx && category.kind === kind ? (category as Category) : null;
  } catch {
    return null;
  }
}
```

Also update `postgresErrorCode`'s doc comment: postgres.js errors carry the same string `code` SQLSTATE property PostgREST errors did, so the function body is unchanged — state that in the comment ("Reads the SQLSTATE off a PostgREST *or postgres.js* error...").

- [ ] **Step 3: Full gates**

All four, separately. `npm test` proves the guard's existing consumers (every route test mocking `requireAdminAuth`) are unaffected — mocks that return `{ user, supabase }` still type-check because tests cast through the mock boundary.

- [ ] **Step 4: Commit**

```bash
git add lib/auth/admin-guard.ts lib/dashboard/api.ts
git commit -m "Return Drizzle handle from admin guard alongside Supabase client"
```

---

### Task 4: Links vertical onto Drizzle (reference implementation)

**Files:**
- Modify: `app/api/links/route.ts`, `app/api/links/[id]/route.ts`, `app/api/links/reorder/route.ts`, `app/api/links/[id]/click/route.ts`, `app/dashboard/links/page.tsx`

**Interfaces:**
- Consumes: `db` from the guard (Task 3), `dashboardLinks`, `findMatchingCategoryDb`.
- Produces: the migrated-route pattern every later vertical mirrors. Response shapes byte-identical to today (assert against the current files before changing them).

- [ ] **Step 1: Rewrite `app/api/links/route.ts`**

Full replacement for the two handlers' data access (validation blocks stay verbatim). GET becomes:

```ts
  const { db } = authResult;
  const ctxParam = request.nextUrl.searchParams.get("ctx");

  if (ctxParam !== null && !isCtx(ctxParam)) {
    return apiError("INVALID_CTX", "ctx must be either \"work\" or \"home\".", 400);
  }

  try {
    const links: LinkItem[] = await db
      .select()
      .from(dashboardLinks)
      .where(ctxParam !== null ? eq(dashboardLinks.ctx, ctxParam) : undefined)
      .orderBy(desc(dashboardLinks.created_at));

    return NextResponse.json({ links }, { status: 200 });
  } catch (error) {
    console.error("Links list error:", error);
    return apiError("SERVER_ERROR", "Could not load links.", 500);
  }
```

POST keeps its validation chain verbatim, swaps `findMatchingCategory(supabase, ...)` for `findMatchingCategoryDb(db, ...)`, and the insert becomes:

```ts
  try {
    const [link] = await db
      .insert(dashboardLinks)
      .values({
        ctx,
        category_id: categoryId,
        title: title.trim(),
        url: normalizedUrl,
        description: typeof description === "string" ? description.trim() || null : null,
      })
      .returning();

    return NextResponse.json(link satisfies LinkItem, { status: 201 });
  } catch (error) {
    console.error("Link create error:", error);
    return apiError("SERVER_ERROR", "Could not save the link.", 500);
  }
```

Imports: drop `LINK_COLUMNS` (Drizzle selects all columns, which for this table IS the column list — `.returning()` likewise); add `eq, desc` from `drizzle-orm` and `dashboardLinks` from `@/lib/db/schema`.

- [ ] **Step 2: Migrate `[id]/route.ts`, `reorder/route.ts`, `[id]/click/route.ts` with the same moves**

Read each file first; the validation and response code stays, only query lines change. Specifics:

- `[id]` PATCH/DELETE: `.update(dashboardLinks).set(fields).where(eq(dashboardLinks.id, id)).returning()` — empty `returning()` array = the old `maybeSingle()` null = 404 `NOT_FOUND`. DELETE returns `{ ok: true }` exactly as today.
- `reorder`: today it issues N sequential PATCH-equivalent updates (deliberately non-atomic, owner-accepted). Preserve exactly that: a plain `for` loop of `db.update(...).set({ sort_order }).where(eq(id))`, NOT a transaction — matching documented behavior is the requirement, improving it is not this branch.
- `click`: replace the `increment_link_click` RPC call with:

```ts
    const [updated] = await db
      .update(dashboardLinks)
      .set({
        click_count: sql`${dashboardLinks.click_count} + 1`,
        last_clicked_at: sql`timezone('utc'::text, now())`,
      })
      .where(eq(dashboardLinks.id, id))
      .returning();
```

(import `sql` from `drizzle-orm`). Preserve the route's current response shape and error mapping verbatim.

- [ ] **Step 3: Migrate `app/dashboard/links/page.tsx`**

The server page fetch swaps `createServerSupabaseClient()` + PostgREST reads for `getDb()` + the same two Drizzle selects (links ordered `desc(created_at)`, categories for the workspace picker). Props passed to the client view keep the same shapes — timestamps are already strings via the driver parser.

- [ ] **Step 4: Full gates**

All four, separately. There are no existing links route tests; the 131 existing tests must stay green (they cover shared helpers whose Supabase versions still exist).

- [ ] **Step 5: Commit**

```bash
git add app/api/links/ app/dashboard/links/page.tsx
git commit -m "Move Links vertical to Drizzle"
```

---

### Task 5: Categories vertical onto Drizzle

**Files:**
- Modify: `app/api/categories/route.ts`, `app/api/categories/[id]/route.ts`, `app/dashboard/settings/page.tsx` (category list fetch only — the GSD card is Task 7)

**Interfaces:**
- Consumes: `db`, `dashboardCategories`, `dashboardLinks`, `dashboardNotes`, `listCategorySiblingsDb`, `UNIQUE_VIOLATION`, `FOREIGN_KEY_VIOLATION`, `postgresErrorCode`.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Migrate both route files, preserving every error mapping**

Read the files first and enumerate the mappings before changing anything (the grep inventory: `INVALID_BODY`, `INVALID_CTX`, `CONFLICT`, `LAST_CATEGORY`, `CATEGORY_IN_USE`, `NOT_FOUND`, `SERVER_ERROR`). The load-bearing details:

- The case-insensitive duplicate check via `listCategorySiblingsDb` runs BEFORE writes, exactly as today.
- The race-condition net: wrap insert/update/delete in try/catch; `postgresErrorCode(error)` reads the SQLSTATE off postgres.js errors identically (same `code` property). `23505` → the route's existing `CONFLICT` 409; `23503` on delete → `CATEGORY_IN_USE` 409. "Never a 500" holds either way.
- `LAST_CATEGORY` logic (refusing to delete the final category of a ctx+kind) keeps its current shape, driven by `listCategorySiblingsDb`.
- In-use counting for delete: `db.select({ n: count() }).from(dashboardLinks).where(eq(dashboardLinks.category_id, id))` (import `count` from `drizzle-orm`), same for notes.

- [ ] **Step 2: Migrate the settings page's category fetch**

Same page-fetch move as Task 4 Step 3. Do not touch the GSD key card's data path in this task.

- [ ] **Step 3: Full gates, then commit**

```bash
git add app/api/categories/ app/dashboard/settings/page.tsx
git commit -m "Move Categories vertical to Drizzle"
```

---

### Task 6: Notes vertical + dashboard overview onto Drizzle

**Files:**
- Modify: `app/api/notes/route.ts`, `app/api/notes/[id]/route.ts`, `app/dashboard/notes/page.tsx`, `app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `db`, `dashboardNotes`, `findMatchingCategoryDb`.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Migrate the two note routes**

Same moves as Task 4. Notes-specific requirements to preserve verbatim: `INVALID_TITLE` / `INVALID_CONTENT` size caps and their distinct codes; `content_html` passes through unchanged (sanitization lives client-side by design — do not add any here); PATCH partial-update semantics (only provided fields in `.set()`).

- [ ] **Step 2: Migrate the notes page and overview page fetches**

`app/dashboard/page.tsx` (overview) reads several aggregates — read the file, reproduce each query in Drizzle (`count()` where it counts, same orderings where it lists). Keep props to client views shape-identical.

- [ ] **Step 3: Full gates, then commit**

```bash
git add app/api/notes/ app/dashboard/notes/page.tsx app/dashboard/page.tsx
git commit -m "Move Notes vertical and dashboard overview to Drizzle"
```

---

### Task 7: Files metadata, GSD key, and Tasks pages onto Drizzle

**Files:**
- Modify: `app/api/files/route.ts`, `app/api/files/[id]/route.ts`, `app/api/files/upload/route.ts`, `app/api/files/[id]/download/route.ts`, `app/dashboard/documents/page.tsx`
- Modify: `lib/gsd/key.ts`, `app/api/gsd-key/route.ts`, the settings page's GSD card fetch, `app/dashboard/tasks` page fetch if it resolves the key server-side (read `lib/gsd/key.ts` consumers first: `grep -r resolveGsdKey`)
- Modify: `app/api/files/upload/route.test.ts`, `app/api/files/[id]/download/route.test.ts` (mock `db` instead of metadata-table Supabase chains)

**Interfaces:**
- Consumes: `db`, `filesMetadata`, `gsdConfig`.
- Produces: the dual-client files pattern (Drizzle for metadata, `supabase` from the guard for storage bytes) that Phase 2 will dismantle.

- [ ] **Step 1: Migrate the files routes — dual-client**

Per route: `const { user, supabase, db } = authResult;` — `supabase.storage.from("files")` calls stay EXACTLY as they are (upload/remove/createSignedUrl, including `{ download: file_name }` on signed URLs); every `files_metadata` read/write moves to Drizzle. Upload's cleanup-on-insert-failure ordering is unchanged: storage upload → metadata insert → on insert error, `storage.remove` then 500. `uploaded_by: user.id` still stores the Supabase auth id (spec decision). The existing `{ message, file }` response deviations stay (Global Constraints).

- [ ] **Step 2: Update the two route test files**

The mocks currently build a Supabase `from()` chain for metadata plus `storage.from()`. Keep the storage mock; replace the metadata chain with a Drizzle-shaped mock. Pattern for upload (insert):

```ts
const { requireAdminAuth, storageUpload, storageRemove, insertCapture, insertReturning } =
  vi.hoisted(() => ({
    requireAdminAuth: vi.fn(),
    storageUpload: vi.fn(),
    storageRemove: vi.fn(),
    insertCapture: vi.fn(),
    insertReturning: vi.fn(),
  }));

function makeDb() {
  return {
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        insertCapture(row);
        return { returning: insertReturning };
      },
    }),
  };
}
```

with `requireAdminAuth.mockResolvedValue({ user: {...}, supabase: makeSupabase(), db: makeDb() })` and `insertReturning.mockResolvedValue([{ id: "row-1" }])`. Download's test mocks `db.select()...limit()` returning `[row]` and `db.update()...where()` resolving; assertions on `createSignedUrl` args are unchanged. Every existing assertion (MIME normalization, `FILE_TOO_LARGE` ordering, disposition) must survive with the same expected values.

- [ ] **Step 3: Migrate `lib/gsd/key.ts` and `app/api/gsd-key/route.ts`**

`resolveGsdKey` reads `gsd_config` row 1 via Drizzle (`db.select().from(gsdConfig).limit(1)`); no caching, same as today. The PUT route's verify-before-store flow (`testGsdKey` against GSD `GET /lists`, 401→400 `INVALID_KEY`) is untouched; only the reads/writes of `gsd_config` change. `key.test.ts` mocks swap accordingly. The hardening rule survives: log only `error.code`/`error.message`, never a raw error object that could carry the key.

- [ ] **Step 4: Migrate the documents page and settings GSD card fetches; check tasks pages**

Same page-fetch move. Documents is NOT workspace-scoped — do not add `useWorkspace` filtering (AGENTS.md's most-common-mistake warning).

- [ ] **Step 5: Full gates, then commit**

```bash
git add app/api/files/ app/api/gsd-key/ app/dashboard/documents/page.tsx app/dashboard/settings/page.tsx lib/gsd/
git commit -m "Move files metadata and GSD key storage to Drizzle"
```

---

### Task 8: Cleanup — guard drops the Supabase client from its return

**Files:**
- Modify: `lib/auth/admin-guard.ts` (return `{ user, db }`; keep creating the Supabase client internally — `verifyClaims` needs it)
- Modify: `app/api/files/*` routes (create their own storage client: `const supabase = await createServerSupabaseClient();` after the guard)
- Modify: `lib/dashboard/api.ts` (delete `listCategorySiblings`, `findMatchingCategory`, `LINK_COLUMNS`, `NOTE_COLUMNS`, `CATEGORY_COLUMNS`, `DashboardSupabaseClient`; rename the `*Db` helpers to the plain names AND update the three verticals' imports/call sites in this same task — grep to confirm zero remaining references)
- Delete: `lib/supabase/admin.ts`
- Modify: the files route tests (guard mock returns `{ user, db }`; storage client comes from a `vi.mock` of `@/lib/supabase/server`)

**Interfaces:**
- Consumes: everything previous tasks produced.
- Produces: final Phase 1 shape — guard `{ user, db }`, helpers under their original names taking `DrizzleDb`.

- [ ] **Step 1: Make all the removals/renames in one sweep**

Order that keeps tsc green at the end (it will be broken mid-edit; that's fine within a task): guard return → files routes' own client → api.ts deletions+renames → vertical import updates → delete `lib/supabase/admin.ts` → test updates. Then:

```bash
grep -rn "findMatchingCategoryDb\|listCategorySiblingsDb\|DashboardSupabaseClient\|LINK_COLUMNS\|createAdminSupabaseClient" app lib components --include="*.ts" --include="*.tsx"
```

Expected: zero hits.

- [ ] **Step 2: Full gates, then commit**

```bash
git add -A
git commit -m "Drop Supabase client from admin guard; finish Drizzle cutover in code"
```

---

### Task 9: Data copy script (idempotent, dry-run first)

**Files:**
- Create: `<scratchpad>/copy-supabase-to-do.mjs` (NOT committed — the scratchpad path is in the dispatch; the script is disposable by design)

**Interfaces:**
- Consumes: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` env (service role bypasses RLS for the read; the key is never printed), `DATABASE_URL` env.
- Produces: all rows copied; verification output (counts per table, both sides).

- [ ] **Step 1: Write the script**

```js
// copy-supabase-to-do.mjs — one-time Supabase -> apps-pg data copy.
// Run: node --env-file=.env.local copy-supabase-to-do.mjs
// Idempotent: truncates target tables first (safe: target is not live until cutover).
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const TABLES = [
  "dashboard_categories", // first: links/notes FK-reference it
  "dashboard_links",
  "dashboard_notes",
  "files_metadata",
  "gsd_config",
  "contact_submissions",
];

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

for (const table of TABLES.slice().reverse()) {
  await sql`delete from ${sql(table)}`; // children first
}

for (const table of TABLES) {
  const { data, error } = await supabase.from(table).select("*");
  if (error) throw new Error(`${table} read failed: ${error.code} ${error.message}`);

  for (const row of data) {
    await sql`insert into ${sql(table)} ${sql(row)}`;
  }

  const [{ count: target }] = await sql`select count(*)::int as count from ${sql(table)}`;
  console.log(`${table}: supabase=${data.length} apps-pg=${target} ${data.length === Number(target) ? "OK" : "MISMATCH"}`);
  if (data.length !== Number(target)) process.exit(1);
}

await sql.end();
console.log("copy complete");
```

Requires `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` — if absent, the operator (owner) adds it there from their records; the implementer must NOT retrieve or print it.

- [ ] **Step 2: Dry-run now (pre-cutover)**

Run it. Expected: six `OK` lines (`dashboard_categories: supabase=25 apps-pg=25 OK`, links 16, notes 10, files_metadata 0, gsd_config 1, contact_submissions 3). Then spot-check one row per non-empty table field-by-field (scratchpad node one-liner comparing JSON from both sides) and paste the diff-free result into the report. This validates the script; the authoritative copy re-runs during the cutover window.

No commit (nothing in the repo changed).

---

### Task 10: Cutover runbook (operator task — controller + owner, not a dispatched subagent)

Prereqs: Tasks 1–9 complete, branch merged readiness confirmed (final review done), owner present.

- [ ] **Step 1: Add `DATABASE_URL` to the live app spec** — `doctl apps spec get 12e4f4c4-34cc-4ee8-abff-b5616a90a95d > /tmp/live.yaml`; add under the web service's `envs`: `key: DATABASE_URL`, `scope: RUN_TIME`, `type: SECRET`, `value:` the **private** connection string (`private-apps-pg-...:25060/homepage?sslmode=require`); `doctl apps propose --app <id> --spec /tmp/live.yaml --output json` (check the env list shows all five vars, existing EV[...] values intact); `doctl apps update <id> --spec /tmp/live.yaml`. This deploys once with an unused env var — harmless.
- [ ] **Step 2: Mirror into the committed spec** — add `DATABASE_URL` to `.do/app.yaml` with blank value, `type: SECRET`, commit on the branch.
- [ ] **Step 3: Enable maintenance mode** — in `/tmp/live.yaml` add top-level `maintenance:\n  enabled: true` (field verified against the app-spec reference 2026-07-29), `doctl apps update`. Verify: `curl -s -o /dev/null -w '%{http_code}' https://www.patrickbeasley.com/` returns non-200 (DO serves its maintenance page).
- [ ] **Step 4: Authoritative data copy** — re-run Task 9's script. Six OK lines required.
- [ ] **Step 5: Merge and push** — finishing-a-development-branch flow; push to `main` triggers the deploy; watch it to ACTIVE (deploys proceed under maintenance mode).
- [ ] **Step 6: Canary while still offline** — with an authenticated session (owner) or via SQL: create a link through `POST /api/links` (the maintenance page may block external requests — if so, verify immediately after Step 7 instead and accept the seconds-long exposure as the single-user risk it is), then `select title from dashboard_links order by created_at desc limit 1` on **apps-pg** shows it, and the same query via the Supabase MCP does NOT. Delete the canary.
- [ ] **Step 7: Disable maintenance mode** — `maintenance.enabled: false`, `doctl apps update`, confirm 200 on `/`.
- [ ] **Step 8: Post-cutover checks** — owner logs in, touches every section (Links, Notes, Documents, Settings, Tasks, Overview); cluster health: `doctl databases get e7e891cb-... --format Status` and eyeball CPU/memory in the DO panel (gsd unaffected); next day, Supabase dashboard query stats show zero PostgREST traffic.
- [ ] **Step 9: Record** — append the cutover date and canary evidence to the ledger; Supabase project stays alive as rollback target until Phase 3 + soak (spec).

---

## Execution notes

- Tasks must run in order 1→8 (each vertical depends on the guard's transitional shape); 9 after 2 (needs schema applied); 10 last, owner present.
- Dispatch models per the Model selection section above.
- Rollback at any point before Task 10 Step 5: revert the branch; production never saw it. After: `git revert` the merge + push (app returns to Supabase, frozen at copy time), then reconcile any canary/test rows visible in apps-pg.
