import type { PostAction, PostActor } from "@/lib/blog/types";
import type { DrizzleDb } from "@/lib/db/client";
import { blogPostEvents } from "@/lib/db/schema";

/** A Drizzle transaction handle — what db.transaction hands its callback. */
export type DbTx = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];

export interface PostEventInput {
  postId: string | null;
  postTitle: string;
  actor: PostActor;
  tokenId: string | null;
  action: PostAction;
  /** Changed FIELD NAMES only — never values. */
  summary?: string;
}

/**
 * Writes an activity-log row. Always called inside the same transaction as
 * the post change it describes, so the log can never disagree with the data.
 */
export async function recordPostEvent(
  tx: DbTx | DrizzleDb,
  event: PostEventInput
): Promise<void> {
  await tx.insert(blogPostEvents).values({
    post_id: event.postId,
    post_title: event.postTitle,
    actor: event.actor,
    token_id: event.tokenId,
    action: event.action,
    summary: event.summary ?? "",
  });
}
