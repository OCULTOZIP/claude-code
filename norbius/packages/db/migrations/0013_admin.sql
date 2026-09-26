CREATE TABLE "admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret" text NOT NULL,
	"totp_last_step" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email"),
	CONSTRAINT "admin_users_role_check" CHECK ("admin_users"."role" in ('support','billing','analyst','superadmin')),
	CONSTRAINT "admin_users_email_check" CHECK ("admin_users"."email" = lower("admin_users"."email"))
);
--> statement-breakpoint
CREATE TABLE "support_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" text[] NOT NULL,
	"reason" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "support_access_grants_scope_check" CHECK ("support_access_grants"."scope" <@ array['transactions:read']::text[] and cardinality("support_access_grants"."scope") > 0),
	CONSTRAINT "support_access_grants_reason_check" CHECK (char_length("support_access_grants"."reason") between 5 and 300),
	CONSTRAINT "support_access_grants_expiry_check" CHECK ("support_access_grants"."expires_at" > "support_access_grants"."granted_at" and "support_access_grants"."expires_at" <= "support_access_grants"."granted_at" + interval '7 days')
);
--> statement-breakpoint
ALTER TABLE "support_access_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_sessions_admin_idx" ON "admin_sessions" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "support_access_grants_user_idx" ON "support_access_grants" USING btree ("user_id","granted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "billing_payments_admin_read" ON "billing_payments" AS PERMISSIVE FOR SELECT TO "norbius_admin" USING (true);--> statement-breakpoint
CREATE POLICY "subscriptions_admin_read" ON "subscriptions" AS PERMISSIVE FOR SELECT TO "norbius_admin" USING (true);--> statement-breakpoint
CREATE POLICY "support_access_grants_owner" ON "support_access_grants" AS PERMISSIVE FOR ALL TO "norbius_app" USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "support_access_grants_admin_read" ON "support_access_grants" AS PERMISSIVE FOR SELECT TO "norbius_admin" USING (true);