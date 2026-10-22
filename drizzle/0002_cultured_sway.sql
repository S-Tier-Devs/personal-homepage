CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "blog_post_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid,
	"post_title" text NOT NULL,
	"actor" text NOT NULL,
	"token_id" uuid,
	"action" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
	CONSTRAINT "blog_post_events_actor_check" CHECK ("blog_post_events"."actor" in ('admin', 'agent')),
	CONSTRAINT "blog_post_events_action_check" CHECK ("blog_post_events"."action" in ('created', 'updated', 'published', 'unpublished', 'deleted'))
);
--> statement-breakpoint
CREATE TABLE "blog_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text DEFAULT '' NOT NULL,
	"content_html" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"reading_minutes" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_by_token_id" uuid,
	"updated_by_token_id" uuid,
	"created_at" timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
	CONSTRAINT "blog_posts_slug_unique" UNIQUE("slug"),
	CONSTRAINT "blog_posts_status_check" CHECK ("blog_posts"."status" in ('draft', 'published')),
	CONSTRAINT "blog_posts_published_at_check" CHECK ("blog_posts"."status" <> 'published' or "blog_posts"."published_at" is not null),
	CONSTRAINT "blog_posts_created_by_check" CHECK ("blog_posts"."created_by" in ('admin', 'agent')),
	CONSTRAINT "blog_posts_updated_by_check" CHECK ("blog_posts"."updated_by" in ('admin', 'agent'))
);
--> statement-breakpoint
ALTER TABLE "blog_post_events" ADD CONSTRAINT "blog_post_events_post_id_blog_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."blog_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_post_events" ADD CONSTRAINT "blog_post_events_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_created_by_token_id_api_tokens_id_fk" FOREIGN KEY ("created_by_token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_updated_by_token_id_api_tokens_id_fk" FOREIGN KEY ("updated_by_token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blog_post_events_post_idx" ON "blog_post_events" USING btree ("post_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "blog_posts_status_published_idx" ON "blog_posts" USING btree ("status","published_at" DESC NULLS FIRST);