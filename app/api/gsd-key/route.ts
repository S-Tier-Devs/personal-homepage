import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminAuth } from "@/lib/auth/admin-guard";
import { apiError, postgresErrorCode, readJsonObject } from "@/lib/dashboard/api";
import type { GsdKeyStatus } from "@/lib/dashboard/types";
import { gsdConfig } from "@/lib/db/schema";
import { testGsdKey } from "@/lib/gsd/client";

/**
 * Write-only management of the Project-GSD API key (spec:
 * 2026-07-23-gsd-key-management-design.md). The key goes in via PUT and never
 * comes back out: GET selects key_last4/updated_at only, and no response,
 * log, or error body here may ever contain api_key.
 */

/** Sanity cap; real GSD keys are far shorter. Verification is the true gate. */
const GSD_KEY_MAX_LENGTH = 200;

/**
 * Only the SQLSTATE and a parameter-free message — never a raw error object,
 * and never a drizzle wrapper's message. drizzle-orm wraps every query
 * failure in `DrizzleQueryError`, whose message embeds the query *params* —
 * for the gsd_config upsert those include the full api_key — so logging
 * `error.message` here leaked the key. The wrapper's `cause` is postgres.js's
 * `PostgresError`, whose message carries no parameter values; log that
 * instead.
 */
function logKeyError(label: string, error: unknown) {
  const cause = error instanceof Error && error.cause !== undefined ? error.cause : error;

  console.error(
    label,
    postgresErrorCode(error),
    cause instanceof Error ? cause.message : String(cause)
  );
}

/**
 * GET /api/gsd-key
 * Status only. `configured` is row-existence; the key column is not read.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAdminAuth(request);
  if (authResult.error) {
    return authResult.error;
  }

  const { db } = authResult;

  let row: { key_last4: string; updated_at: string } | undefined;

  try {
    const rows = await db
      .select({ key_last4: gsdConfig.key_last4, updated_at: gsdConfig.updated_at })
      .from(gsdConfig)
      .limit(1);

    row = rows[0];
  } catch (error) {
    logKeyError("GSD key status read error:", error);
    return apiError("SERVER_ERROR", "Could not read the key status.", 500);
  }

  const status: GsdKeyStatus = {
    configured: row !== undefined,
    last4: row?.key_last4 ?? null,
    updated_at: row?.updated_at ?? null,
  };

  return NextResponse.json(status, { status: 200 });
}

/**
 * PUT /api/gsd-key
 * Verify-on-save: the candidate is sent to GSD (GET /lists) and stored only
 * if GSD accepts it. Nothing is written on any verification failure, so a
 * saved-but-dead key is impossible.
 */
export async function PUT(request: NextRequest) {
  const authResult = await requireAdminAuth(request);
  if (authResult.error) {
    return authResult.error;
  }

  const { db } = authResult;
  const body = await readJsonObject(request);

  if (!body) {
    return apiError("INVALID_BODY", "Request body must be a JSON object.", 400);
  }

  const { api_key: apiKey } = body;

  if (typeof apiKey !== "string" || !apiKey.trim()) {
    return apiError("INVALID_BODY", "api_key is required.", 400);
  }

  const candidate = apiKey.trim();

  if (candidate.length > GSD_KEY_MAX_LENGTH) {
    return apiError("INVALID_BODY", "api_key is implausibly long.", 400);
  }

  const verify = await testGsdKey(candidate);

  if (!verify.ok) {
    // 401 here is GSD rejecting the CANDIDATE — the one case where "the key
    // is wrong" is the caller's fault and a 400, unlike the task routes'
    // 401→502 mapping for the stored key.
    if (verify.error.status === 401) {
      return NextResponse.json(
        { error: "INVALID_KEY", message: "Project-GSD rejected this key. Nothing was saved." },
        { status: 400 }
      );
    }

    if (verify.error.status === 429) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: verify.error.message },
        { status: 429 }
      );
    }

    return NextResponse.json(
      {
        error: "GSD_UNAVAILABLE",
        message: "Could not verify the key — Project-GSD is unreachable. Nothing was saved.",
      },
      { status: 502 }
    );
  }

  try {
    const [row] = await db
      .insert(gsdConfig)
      .values({
        id: 1,
        api_key: candidate,
        key_last4: candidate.slice(-4),
        updated_at: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: gsdConfig.id,
        set: {
          api_key: candidate,
          key_last4: candidate.slice(-4),
          updated_at: new Date().toISOString(),
        },
      })
      .returning({ key_last4: gsdConfig.key_last4, updated_at: gsdConfig.updated_at });

    if (!row) {
      logKeyError("GSD key save error:", new Error("upsert returned no row"));
      return apiError("SERVER_ERROR", "The key verified but could not be saved.", 500);
    }

    const status: GsdKeyStatus = {
      configured: true,
      last4: row.key_last4,
      updated_at: row.updated_at,
    };

    return NextResponse.json(status, { status: 200 });
  } catch (error) {
    logKeyError("GSD key save error:", error);
    return apiError("SERVER_ERROR", "The key verified but could not be saved.", 500);
  }
}

/**
 * DELETE /api/gsd-key
 * Idempotent: deleting when unconfigured still answers { ok: true }.
 */
export async function DELETE(request: NextRequest) {
  const authResult = await requireAdminAuth(request);
  if (authResult.error) {
    return authResult.error;
  }

  const { db } = authResult;

  try {
    await db.delete(gsdConfig).where(eq(gsdConfig.id, 1));
  } catch (error) {
    logKeyError("GSD key delete error:", error);
    return apiError("SERVER_ERROR", "Could not remove the key.", 500);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
