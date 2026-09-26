CREATE TABLE "intelligence_runs" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"last_daily_run_on" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intelligence_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"in_app" boolean NOT NULL,
	"email" boolean NOT NULL,
	"push" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_pk" PRIMARY KEY("user_id","type"),
	CONSTRAINT "notification_preferences_type_check" CHECK ("notification_preferences"."type" in ('bill_due','goal_reached','unusual_spending','card_limit','financial_summary','insight'))
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"dedup_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_user_dedup_unique" UNIQUE("user_id","dedup_key"),
	CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('bill_due','goal_reached','unusual_spending','card_limit','financial_summary','insight')),
	CONSTRAINT "notifications_channel_check" CHECK ("notifications"."channel" in ('in_app','email','push')),
	CONSTRAINT "notifications_status_check" CHECK ("notifications"."status" in ('pending','sent','read','failed','skipped')),
	CONSTRAINT "notifications_text_check" CHECK (char_length("notifications"."title") between 1 and 200 and char_length("notifications"."body") between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "intelligence_runs" ADD CONSTRAINT "intelligence_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_channel_created_idx" ON "notifications" USING btree ("user_id","channel","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_due_idx" ON "notifications" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE POLICY "intelligence_runs_owner" ON "intelligence_runs" AS PERMISSIVE FOR ALL TO "norbius_app" USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "notification_preferences_owner" ON "notification_preferences" AS PERMISSIVE FOR ALL TO "norbius_app" USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "notifications_owner" ON "notifications" AS PERMISSIVE FOR ALL TO "norbius_app" USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);