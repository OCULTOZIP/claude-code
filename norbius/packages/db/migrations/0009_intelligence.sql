CREATE TABLE "core_state_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"state" text NOT NULL,
	"reasons" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_state_events_state_check" CHECK ("core_state_events"."state" in ('ACTIVE','ANALYZING','STABLE','ATTENTION','OPTIMIZING'))
);
--> statement-breakpoint
ALTER TABLE "core_state_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"period_start" date,
	"period_end" date,
	"status" text DEFAULT 'open' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insights_user_fingerprint_unique" UNIQUE("user_id","fingerprint"),
	CONSTRAINT "insights_severity_check" CHECK ("insights"."severity" in ('info','opportunity','attention','critical')),
	CONSTRAINT "insights_status_check" CHECK ("insights"."status" in ('open','seen','dismissed','resolved','expired')),
	CONSTRAINT "insights_text_check" CHECK (char_length("insights"."title") between 1 and 200 and char_length("insights"."body") between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "insights" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "projection_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"horizon_end" date NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inputs_hash" text NOT NULL,
	"method_version" text NOT NULL,
	"result" jsonb NOT NULL,
	"confidence" text NOT NULL,
	CONSTRAINT "projection_snapshots_confidence_check" CHECK ("projection_snapshots"."confidence" in ('low','medium','high'))
);
--> statement-breakpoint
ALTER TABLE "projection_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core_state_events" ADD CONSTRAINT "core_state_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projection_snapshots" ADD CONSTRAINT "projection_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "core_state_events_user_created_idx" ON "core_state_events" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "insights_user_status_idx" ON "insights" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "projection_snapshots_user_generated_idx" ON "projection_snapshots" USING btree ("user_id","generated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "core_state_events_owner" ON "core_state_events" AS PERMISSIVE FOR ALL TO "norbius_app" USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "insights_owner" ON "insights" AS PERMISSIVE FOR ALL TO "norbius_app" USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "projection_snapshots_owner" ON "projection_snapshots" AS PERMISSIVE FOR ALL TO "norbius_app" USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);