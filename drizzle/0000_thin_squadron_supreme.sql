CREATE TABLE "contact_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"subject" text,
	"message" text NOT NULL,
	"status" text DEFAULT 'unread' NOT NULL,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
	CONSTRAINT "contact_submissions_status_check" CHECK ("contact_submissions"."status" in ('unread', 'in_progress', 'resolved', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "dashboard_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ctx" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
	CONSTRAINT "dashboard_categories_ctx_check" CHECK ("dashboard_categories"."ctx" in ('work', 'home')),
	CONSTRAINT "dashboard_categories_kind_check" CHECK ("dashboard_categories"."kind" in ('link', 'note'))
);
--> statement-breakpoint
CREATE TABLE "dashboard_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ctx" text NOT NULL,
	"category_id" uuid NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"click_count" integer DEFAULT 0 NOT NULL,
	"last_clicked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
	CONSTRAINT "dashboard_links_ctx_check" CHECK ("dashboard_links"."ctx" in ('work', 'home'))
);
--> statement-breakpoint
CREATE TABLE "dashboard_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ctx" text NOT NULL,
	"category_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"content_html" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
	CONSTRAINT "dashboard_notes_ctx_check" CHECK ("dashboard_notes"."ctx" in ('work', 'home'))
);
--> statement-breakpoint
CREATE TABLE "files_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_path" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_extension" text NOT NULL,
	"file_size_bytes" bigint NOT NULL,
	"description" text,
	"visibility" text DEFAULT 'private' NOT NULL,
	"uploaded_by" uuid,
	"last_downloaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
	CONSTRAINT "files_metadata_storage_path_unique" UNIQUE("storage_path"),
	CONSTRAINT "files_metadata_visibility_check" CHECK ("files_metadata"."visibility" in ('private', 'public'))
);
--> statement-breakpoint
CREATE TABLE "gsd_config" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"api_key" text NOT NULL,
	"key_last4" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gsd_config_id_check" CHECK ("gsd_config"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "dashboard_links" ADD CONSTRAINT "dashboard_links_category_id_dashboard_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."dashboard_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_notes" ADD CONSTRAINT "dashboard_notes_category_id_dashboard_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."dashboard_categories"("id") ON DELETE restrict ON UPDATE no action;