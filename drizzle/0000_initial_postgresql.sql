CREATE TABLE "assignments" (
	"task_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "assignments_task_id_user_id_pk" PRIMARY KEY("task_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "audit" (
	"id" text PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"owner" text,
	"action" text NOT NULL,
	"before_json" text,
	"after_json" text,
	"at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"task_id" text,
	"project_id" text,
	"description" text DEFAULT '' NOT NULL,
	"start" bigint NOT NULL,
	"end" bigint,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "entries_period_check" CHECK ("entries"."end" IS NULL OR "entries"."end" >= "entries"."start")
);
--> statement-breakpoint
CREATE TABLE "event_log" (
	"seq" bigint PRIMARY KEY NOT NULL,
	"at" bigint NOT NULL,
	"level" text NOT NULL,
	"category" text NOT NULL,
	"action" text NOT NULL,
	"actor" text,
	"entity" text,
	"entity_id" text,
	"request_id" text,
	"details_json" text NOT NULL,
	"previous_hash" text NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "event_log_level_check" CHECK ("event_log"."level" IN ('info', 'warning', 'error'))
);
--> statement-breakpoint
CREATE TABLE "export_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"client_id" text NOT NULL,
	"color" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"result" jsonb NOT NULL,
	"at" bigint NOT NULL,
	CONSTRAINT "requests_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"csrf" text NOT NULL,
	"expires" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"project_id" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "tasks_status_check" CHECK ("tasks"."status" IN ('todo', 'doing', 'done'))
);
--> statement-breakpoint
CREATE TABLE "user_admins" (
	"user_id" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"role" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"color" text NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "users_role_check" CHECK ("users"."role" IN ('member', 'manager'))
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit" ADD CONSTRAINT "audit_actor_users_id_fk" FOREIGN KEY ("actor") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit" ADD CONSTRAINT "audit_owner_users_id_fk" FOREIGN KEY ("owner") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_templates" ADD CONSTRAINT "export_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_admins" ADD CONSTRAINT "user_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignments_user" ON "assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_entity" ON "audit" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_owner_at" ON "audit" USING btree ("owner","at");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_name_nocase" ON "clients" USING btree (translate("name", 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'));--> statement-breakpoint
CREATE UNIQUE INDEX "one_running_per_user" ON "entries" USING btree ("user_id") WHERE "entries"."end" IS NULL AND "entries"."deleted" = false;--> statement-breakpoint
CREATE INDEX "entries_period" ON "entries" USING btree ("user_id","start","end");--> statement-breakpoint
CREATE INDEX "entries_task" ON "entries" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "entries_project" ON "entries" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "event_log_request" ON "event_log" USING btree ("request_id","seq");--> statement-breakpoint
CREATE INDEX "event_log_level" ON "event_log" USING btree ("level","seq");--> statement-breakpoint
CREATE INDEX "event_log_category" ON "event_log" USING btree ("category","seq");--> statement-breakpoint
CREATE INDEX "export_templates_user" ON "export_templates" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_client_name_nocase" ON "projects" USING btree ("client_id",translate("name", 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'));--> statement-breakpoint
CREATE INDEX "projects_client" ON "projects" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "requests_at" ON "requests" USING btree ("at");--> statement-breakpoint
CREATE INDEX "sessions_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires" ON "sessions" USING btree ("expires");--> statement-breakpoint
CREATE INDEX "tasks_project" ON "tasks" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_nocase" ON "users" USING btree (translate("username", 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'));