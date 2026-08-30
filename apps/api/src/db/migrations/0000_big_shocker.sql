CREATE TYPE "public"."collection_status" AS ENUM('ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."collection_structure" AS ENUM('FLAT', 'PHASED');--> statement-breakpoint
CREATE TYPE "public"."urgency" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TABLE "phases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"position" integer NOT NULL,
	"start_date" date,
	"target_end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phase_id_collection_unique" UNIQUE("id","collection_id"),
	CONSTRAINT "phase_collection_position_unique" UNIQUE("collection_id","position"),
	CONSTRAINT "phase_name_not_blank" CHECK (length(trim("phases"."name")) > 0),
	CONSTRAINT "phase_dates_valid" CHECK ("phases"."start_date" IS NULL OR "phases"."target_end_date" IS NULL OR "phases"."target_end_date" >= "phases"."start_date")
);
--> statement-breakpoint
CREATE TABLE "task_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"structure" "collection_structure" NOT NULL,
	"status" "collection_status" DEFAULT 'ACTIVE' NOT NULL,
	"start_date" date,
	"target_end_date" date,
	"completed_at" timestamp with time zone,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_name_not_blank" CHECK (length(trim("task_collections"."name")) > 0),
	CONSTRAINT "collection_dates_valid" CHECK ("task_collections"."start_date" IS NULL OR "task_collections"."target_end_date" IS NULL OR "task_collections"."target_end_date" >= "task_collections"."start_date")
);
--> statement-breakpoint
CREATE TABLE "task_dependencies" (
	"task_id" uuid NOT NULL,
	"depends_on_task_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_dependencies_task_id_depends_on_task_id_pk" PRIMARY KEY("task_id","depends_on_task_id"),
	CONSTRAINT "dependency_not_self" CHECK ("task_dependencies"."task_id" <> "task_dependencies"."depends_on_task_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"phase_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"urgency" "urgency" DEFAULT 'MEDIUM' NOT NULL,
	"due_date" date,
	"completed_at" timestamp with time zone,
	"position" integer NOT NULL,
	"waiting_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "task_phase_collection_unique" UNIQUE("id","collection_id"),
	CONSTRAINT "task_name_not_blank" CHECK (length(trim("tasks"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "phases" ADD CONSTRAINT "phases_collection_id_task_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."task_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_task_id_tasks_id_fk" FOREIGN KEY ("depends_on_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_collection_id_task_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."task_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "active_collection_position_unique" ON "task_collections" USING btree ("position") WHERE "task_collections"."status" <> 'ARCHIVED';--> statement-breakpoint
CREATE UNIQUE INDEX "task_phase_position_unique" ON "tasks" USING btree ("phase_id","position") WHERE "tasks"."phase_id" IS NOT NULL AND "tasks"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "task_unphased_position_unique" ON "tasks" USING btree ("collection_id","position") WHERE "tasks"."phase_id" IS NULL AND "tasks"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "task_collection_idx" ON "tasks" USING btree ("collection_id");