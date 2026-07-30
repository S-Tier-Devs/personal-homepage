CREATE INDEX "contact_submissions_status_idx" ON "contact_submissions" USING btree ("status","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "dashboard_categories_ctx_kind_sort_idx" ON "dashboard_categories" USING btree ("ctx","kind","sort_order");--> statement-breakpoint
CREATE INDEX "dashboard_links_ctx_category_idx" ON "dashboard_links" USING btree ("ctx","category_id");--> statement-breakpoint
CREATE INDEX "dashboard_links_ctx_clicks_idx" ON "dashboard_links" USING btree ("ctx","click_count" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "dashboard_links_ctx_pinned_sort_idx" ON "dashboard_links" USING btree ("ctx","pinned","sort_order");--> statement-breakpoint
CREATE INDEX "dashboard_links_ctx_sort_idx" ON "dashboard_links" USING btree ("ctx","sort_order");--> statement-breakpoint
CREATE INDEX "dashboard_notes_ctx_updated_idx" ON "dashboard_notes" USING btree ("ctx","updated_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "files_metadata_visibility_idx" ON "files_metadata" USING btree ("visibility","created_at" DESC NULLS FIRST);--> statement-breakpoint
ALTER TABLE "dashboard_categories" ADD CONSTRAINT "dashboard_categories_ctx_kind_name_key" UNIQUE("ctx","kind","name");