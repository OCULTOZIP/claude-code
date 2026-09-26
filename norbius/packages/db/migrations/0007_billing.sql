CREATE TABLE "billing_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"type" text NOT NULL,
	"outcome" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_payment_id" text NOT NULL,
	"provider_subscription_id" text,
	"amount_cents" bigint NOT NULL,
	"status" text NOT NULL,
	"billing_type" text,
	"due_date" date NOT NULL,
	"paid_at" timestamp with time zone,
	"invoice_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_payments_provider_payment_id_unique" UNIQUE("provider_payment_id"),
	CONSTRAINT "billing_payments_amount_check" CHECK ("billing_payments"."amount_cents" >= 0),
	CONSTRAINT "billing_payments_status_check" CHECK ("billing_payments"."status" in ('pending','paid','overdue','refunded','canceled'))
);
--> statement-breakpoint
ALTER TABLE "billing_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'none' NOT NULL,
	"cycle" text,
	"provider" text,
	"provider_customer_id" text,
	"provider_subscription_id" text,
	"trial_started_at" timestamp with time zone,
	"trial_ends_on" date,
	"paid_through" date,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_provider_customer_id_unique" UNIQUE("provider_customer_id"),
	CONSTRAINT "subscriptions_provider_subscription_id_unique" UNIQUE("provider_subscription_id"),
	CONSTRAINT "subscriptions_status_check" CHECK ("subscriptions"."status" in ('none','trialing','pending','active','past_due','canceled')),
	CONSTRAINT "subscriptions_cycle_check" CHECK ("subscriptions"."cycle" is null or "subscriptions"."cycle" in ('monthly','yearly')),
	CONSTRAINT "subscriptions_provider_check" CHECK ("subscriptions"."provider" is null or "subscriptions"."provider" in ('asaas','fake'))
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_payments_user_due_idx" ON "billing_payments" USING btree ("user_id","due_date" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "billing_payments_owner" ON "billing_payments" AS PERMISSIVE FOR ALL TO "norbius_app" USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "subscriptions_owner" ON "subscriptions" AS PERMISSIVE FOR ALL TO "norbius_app" USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);