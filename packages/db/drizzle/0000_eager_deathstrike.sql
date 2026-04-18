CREATE TYPE "public"."canvas_block_created_by" AS ENUM('user', 'agent');--> statement-breakpoint
CREATE TYPE "public"."canvas_block_kind" AS ENUM('text', 'image', 'file');--> statement-breakpoint
CREATE TYPE "public"."canvas_event_actor" AS ENUM('user', 'agent');--> statement-breakpoint
CREATE TYPE "public"."canvas_event_op" AS ENUM('add_block', 'update_block', 'remove_block', 'restore_block', 'pin', 'unpin');--> statement-breakpoint
CREATE TYPE "public"."guideline_section_created_by" AS ENUM('user', 'agent');--> statement-breakpoint
CREATE TYPE "public"."project_kind" AS ENUM('freeform', 'standardized');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "canvas_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canvas_id" uuid NOT NULL,
	"kind" "canvas_block_kind" NOT NULL,
	"position" integer NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"pinned_at" timestamp with time zone,
	"created_by" "canvas_block_created_by" NOT NULL,
	"deleted_at" timestamp with time zone,
	"body" jsonb,
	"blob_key" text,
	"alt" text,
	"width" integer,
	"height" integer,
	"filename" text,
	"mime" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "canvas_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canvas_id" uuid NOT NULL,
	"block_id" uuid,
	"op" "canvas_event_op" NOT NULL,
	"actor" "canvas_event_actor" NOT NULL,
	"user_id" uuid,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "canvases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canvases_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "guideline_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"label" text NOT NULL,
	"body" jsonb NOT NULL,
	"priority" integer NOT NULL,
	"created_by" "guideline_section_created_by" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"kind" "project_kind" NOT NULL,
	"template_id" text,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "brands" ADD CONSTRAINT "brands_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvas_blocks" ADD CONSTRAINT "canvas_blocks_canvas_id_canvases_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."canvases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvas_events" ADD CONSTRAINT "canvas_events_canvas_id_canvases_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."canvases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvas_events" ADD CONSTRAINT "canvas_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvases" ADD CONSTRAINT "canvases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "guideline_sections" ADD CONSTRAINT "guideline_sections_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brands_workspace_id_idx" ON "brands" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canvas_blocks_canvas_position_active_idx" ON "canvas_blocks" USING btree ("canvas_id","position") WHERE "canvas_blocks"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canvas_blocks_canvas_pinned_active_idx" ON "canvas_blocks" USING btree ("canvas_id") WHERE "canvas_blocks"."deleted_at" IS NULL AND "canvas_blocks"."is_pinned" = true;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canvas_blocks_canvas_deleted_idx" ON "canvas_blocks" USING btree ("canvas_id","deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canvas_events_canvas_timeline_idx" ON "canvas_events" USING btree ("canvas_id","created_at" desc);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canvas_events_block_timeline_idx" ON "canvas_events" USING btree ("block_id","created_at" desc) WHERE "canvas_events"."block_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "guideline_sections_brand_id_priority_idx" ON "guideline_sections" USING btree ("brand_id","priority");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspaces_owner_user_id_idx" ON "workspaces" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_brand_id_idx" ON "projects" USING btree ("brand_id");