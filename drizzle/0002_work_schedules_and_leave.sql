CREATE TABLE "holidays" (
	"id" text PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "holidays_date_unique" UNIQUE("date"),
	CONSTRAINT "holidays_kind_check" CHECK ("holidays"."kind" IN ('holiday', 'closure'))
);
--> statement-breakpoint
CREATE TABLE "leaves" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"start_part" text NOT NULL,
	"end_part" text NOT NULL,
	"exclusions" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "leaves_period_check" CHECK ("leaves"."end_date" >= "leaves"."start_date"),
	CONSTRAINT "leaves_start_part_check" CHECK ("leaves"."start_part" IN ('full', 'am', 'pm')),
	CONSTRAINT "leaves_end_part_check" CHECK ("leaves"."end_part" IN ('full', 'am'))
);
--> statement-breakpoint
CREATE TABLE "work_schedules" (
	"user_id" text NOT NULL,
	"start_date" text NOT NULL,
	"schedule" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "work_schedules_user_id_start_date_pk" PRIMARY KEY("user_id","start_date")
);
--> statement-breakpoint
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leaves_user_period" ON "leaves" USING btree ("user_id","start_date","end_date");