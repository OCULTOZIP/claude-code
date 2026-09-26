CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"institution_name" text,
	"initial_balance_cents" bigint DEFAULT 0 NOT NULL,
	"initial_balance_date" date NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"include_in_available_balance" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"source" text DEFAULT 'manual' NOT NULL,
	"external_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "accounts_type_check" CHECK ("accounts"."type" in ('checking','savings','wallet','investment','other')),
	CONSTRAINT "accounts_name_check" CHECK (char_length("accounts"."name") between 1 and 60),
	CONSTRAINT "accounts_currency_check" CHECK ("accounts"."currency" = 'BRL'),
	CONSTRAINT "accounts_initial_balance_check" CHECK (abs("accounts"."initial_balance_cents") <= 100000000000),
	CONSTRAINT "accounts_source_check" CHECK ("accounts"."source" in ('manual','ai','onboarding','import','open_finance','system'))
);
--> statement-breakpoint
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"system_key" text,
	"icon" text,
	"color" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_kind_check" CHECK ("categories"."kind" in ('income','expense')),
	CONSTRAINT "categories_name_check" CHECK (char_length("categories"."name") between 1 and 40),
	CONSTRAINT "categories_system_check" CHECK (("categories"."user_id" is null) = ("categories"."system_key" is not null))
);
--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "credit_card_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credit_card_id" uuid NOT NULL,
	"reference_month" date NOT NULL,
	"closing_date" date NOT NULL,
	"due_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_card_invoices_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "credit_card_invoices_card_month_unique" UNIQUE("credit_card_id","reference_month"),
	CONSTRAINT "credit_card_invoices_month_check" CHECK (extract(day from "credit_card_invoices"."reference_month") = 1),
	CONSTRAINT "credit_card_invoices_dates_check" CHECK ("credit_card_invoices"."due_date" >= "credit_card_invoices"."closing_date")
);
--> statement-breakpoint
ALTER TABLE "credit_card_invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "credit_card_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credit_card_id" uuid NOT NULL,
	"description" text NOT NULL,
	"total_amount_cents" bigint NOT NULL,
	"installment_count" smallint DEFAULT 1 NOT NULL,
	"purchase_date" date NOT NULL,
	"category_id" uuid NOT NULL,
	"recurring_transaction_id" uuid,
	"notes" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"external_provider" text,
	"external_id" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_card_purchases_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "credit_card_purchases_amount_check" CHECK ("credit_card_purchases"."total_amount_cents" between 1 and 100000000000),
	CONSTRAINT "credit_card_purchases_installments_check" CHECK ("credit_card_purchases"."installment_count" between 1 and 48),
	CONSTRAINT "credit_card_purchases_installments_amount_check" CHECK ("credit_card_purchases"."installment_count" <= "credit_card_purchases"."total_amount_cents"),
	CONSTRAINT "credit_card_purchases_description_check" CHECK (char_length("credit_card_purchases"."description") between 1 and 140),
	CONSTRAINT "credit_card_purchases_notes_check" CHECK ("credit_card_purchases"."notes" is null or char_length("credit_card_purchases"."notes") <= 1000),
	CONSTRAINT "credit_card_purchases_source_check" CHECK ("credit_card_purchases"."source" in ('manual','ai','onboarding','import','open_finance','system'))
);
--> statement-breakpoint
ALTER TABLE "credit_card_purchases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "credit_card_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"credit_card_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"installment_number" smallint NOT NULL,
	"amount_cents" bigint NOT NULL,
	"category_id" uuid NOT NULL,
	"competence_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_card_transactions_installment_unique" UNIQUE("purchase_id","installment_number"),
	CONSTRAINT "credit_card_transactions_amount_check" CHECK ("credit_card_transactions"."amount_cents" > 0),
	CONSTRAINT "credit_card_transactions_installment_check" CHECK ("credit_card_transactions"."installment_number" between 1 and 48)
);
--> statement-breakpoint
ALTER TABLE "credit_card_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "credit_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"last_four" text,
	"limit_cents" bigint NOT NULL,
	"closing_day" smallint NOT NULL,
	"due_day" smallint NOT NULL,
	"default_payment_account_id" uuid,
	"archived_at" timestamp with time zone,
	"source" text DEFAULT 'manual' NOT NULL,
	"external_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_cards_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "credit_cards_name_check" CHECK (char_length("credit_cards"."name") between 1 and 60),
	CONSTRAINT "credit_cards_limit_check" CHECK ("credit_cards"."limit_cents" between 0 and 100000000000),
	CONSTRAINT "credit_cards_closing_day_check" CHECK ("credit_cards"."closing_day" between 1 and 31),
	CONSTRAINT "credit_cards_due_day_check" CHECK ("credit_cards"."due_day" between 1 and 31),
	CONSTRAINT "credit_cards_last_four_check" CHECK ("credit_cards"."last_four" is null or "credit_cards"."last_four" ~ '^[0-9]{4}$'),
	CONSTRAINT "credit_cards_source_check" CHECK ("credit_cards"."source" in ('manual','ai','onboarding','import','open_finance','system'))
);
--> statement-breakpoint
ALTER TABLE "credit_cards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "goal_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"date" date NOT NULL,
	"note" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_contributions_amount_check" CHECK ("goal_contributions"."amount_cents" <> 0 and abs("goal_contributions"."amount_cents") <= 100000000000),
	CONSTRAINT "goal_contributions_note_check" CHECK ("goal_contributions"."note" is null or char_length("goal_contributions"."note") <= 200),
	CONSTRAINT "goal_contributions_source_check" CHECK ("goal_contributions"."source" in ('manual','ai','onboarding','import','open_finance','system'))
);
--> statement-breakpoint
ALTER TABLE "goal_contributions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"target_amount_cents" bigint NOT NULL,
	"target_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"completed_at" timestamp with time zone,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "goals_name_check" CHECK (char_length("goals"."name") between 1 and 60),
	CONSTRAINT "goals_target_check" CHECK ("goals"."target_amount_cents" between 1 and 100000000000),
	CONSTRAINT "goals_status_check" CHECK ("goals"."status" in ('active','completed','archived')),
	CONSTRAINT "goals_source_check" CHECK ("goals"."source" in ('manual','ai','onboarding','import','open_finance','system'))
);
--> statement-breakpoint
ALTER TABLE "goals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recurring_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid,
	"credit_card_id" uuid,
	"type" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"amount_is_estimate" boolean DEFAULT false NOT NULL,
	"category_id" uuid NOT NULL,
	"description" text NOT NULL,
	"frequency" text NOT NULL,
	"day_of_month" smallint,
	"start_date" date NOT NULL,
	"end_date" date,
	"last_handled_date" date,
	"active" boolean DEFAULT true NOT NULL,
	"detected_by" text DEFAULT 'user' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_transactions_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "recurring_transactions_type_check" CHECK ("recurring_transactions"."type" in ('income','expense')),
	CONSTRAINT "recurring_transactions_amount_check" CHECK ("recurring_transactions"."amount_cents" between 1 and 100000000000),
	CONSTRAINT "recurring_transactions_target_check" CHECK (num_nonnulls("recurring_transactions"."account_id", "recurring_transactions"."credit_card_id") = 1),
	CONSTRAINT "recurring_transactions_card_expense_check" CHECK ("recurring_transactions"."credit_card_id" is null or "recurring_transactions"."type" = 'expense'),
	CONSTRAINT "recurring_transactions_frequency_check" CHECK ("recurring_transactions"."frequency" in ('weekly','biweekly','monthly','yearly')),
	CONSTRAINT "recurring_transactions_day_check" CHECK ("recurring_transactions"."day_of_month" is null or "recurring_transactions"."day_of_month" between 1 and 31),
	CONSTRAINT "recurring_transactions_end_check" CHECK ("recurring_transactions"."end_date" is null or "recurring_transactions"."end_date" >= "recurring_transactions"."start_date"),
	CONSTRAINT "recurring_transactions_description_check" CHECK (char_length("recurring_transactions"."description") between 1 and 140),
	CONSTRAINT "recurring_transactions_detected_by_check" CHECK ("recurring_transactions"."detected_by" in ('user','intelligence')),
	CONSTRAINT "recurring_transactions_source_check" CHECK ("recurring_transactions"."source" in ('manual','ai','onboarding','import','open_finance','system'))
);
--> statement-breakpoint
ALTER TABLE "recurring_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"type" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"category_id" uuid,
	"description" text NOT NULL,
	"date" date NOT NULL,
	"payment_method" text,
	"recurring" boolean DEFAULT false NOT NULL,
	"recurring_transaction_id" uuid,
	"transfer_account_id" uuid,
	"credit_card_invoice_id" uuid,
	"notes" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"external_provider" text,
	"external_id" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_type_check" CHECK ("transactions"."type" in ('income','expense','transfer')),
	CONSTRAINT "transactions_amount_check" CHECK ("transactions"."amount_cents" between 1 and 100000000000),
	CONSTRAINT "transactions_currency_check" CHECK ("transactions"."currency" = 'BRL'),
	CONSTRAINT "transactions_description_check" CHECK (char_length("transactions"."description") between 1 and 140),
	CONSTRAINT "transactions_notes_check" CHECK ("transactions"."notes" is null or char_length("transactions"."notes") <= 1000),
	CONSTRAINT "transactions_category_check" CHECK (("transactions"."type" = 'transfer') = ("transactions"."category_id" is null)),
	CONSTRAINT "transactions_transfer_target_check" CHECK (case when "transactions"."type" = 'transfer'
        then num_nonnulls("transactions"."transfer_account_id", "transactions"."credit_card_invoice_id") = 1
        else "transactions"."transfer_account_id" is null and "transactions"."credit_card_invoice_id" is null end),
	CONSTRAINT "transactions_self_transfer_check" CHECK ("transactions"."transfer_account_id" is null or "transactions"."transfer_account_id" <> "transactions"."account_id"),
	CONSTRAINT "transactions_payment_method_check" CHECK ("transactions"."payment_method" is null or "transactions"."payment_method" in ('pix','debit','cash','boleto','transfer','credit_card_invoice','other')),
	CONSTRAINT "transactions_source_check" CHECK ("transactions"."source" in ('manual','ai','onboarding','import','open_finance','system'))
);
--> statement-breakpoint
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "onboarding_draft" jsonb;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card_invoices" ADD CONSTRAINT "credit_card_invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card_invoices" ADD CONSTRAINT "credit_card_invoices_card_fk" FOREIGN KEY ("user_id","credit_card_id") REFERENCES "public"."credit_cards"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card_purchases" ADD CONSTRAINT "credit_card_purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card_purchases" ADD CONSTRAINT "credit_card_purchases_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card_purchases" ADD CONSTRAINT "credit_card_purchases_card_fk" FOREIGN KEY ("user_id","credit_card_id") REFERENCES "public"."credit_cards"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card_purchases" ADD CONSTRAINT "credit_card_purchases_recurring_fk" FOREIGN KEY ("user_id","recurring_transaction_id") REFERENCES "public"."recurring_transactions"("user_id","id") ON DELETE SET NULL ("recurring_transaction_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card_transactions" ADD CONSTRAINT "credit_card_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card_transactions" ADD CONSTRAINT "credit_card_transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card_transactions" ADD CONSTRAINT "credit_card_transactions_purchase_fk" FOREIGN KEY ("user_id","purchase_id") REFERENCES "public"."credit_card_purchases"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card_transactions" ADD CONSTRAINT "credit_card_transactions_card_fk" FOREIGN KEY ("user_id","credit_card_id") REFERENCES "public"."credit_cards"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card_transactions" ADD CONSTRAINT "credit_card_transactions_invoice_fk" FOREIGN KEY ("user_id","invoice_id") REFERENCES "public"."credit_card_invoices"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_payment_account_fk" FOREIGN KEY ("user_id","default_payment_account_id") REFERENCES "public"."accounts"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_goal_fk" FOREIGN KEY ("user_id","goal_id") REFERENCES "public"."goals"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."accounts"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_card_fk" FOREIGN KEY ("user_id","credit_card_id") REFERENCES "public"."credit_cards"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."accounts"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_account_fk" FOREIGN KEY ("user_id","transfer_account_id") REFERENCES "public"."accounts"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_invoice_fk" FOREIGN KEY ("user_id","credit_card_invoice_id") REFERENCES "public"."credit_card_invoices"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_fk" FOREIGN KEY ("user_id","recurring_transaction_id") REFERENCES "public"."recurring_transactions"("user_id","id") ON DELETE SET NULL ("recurring_transaction_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_system_key_unique" ON "categories" USING btree ("system_key","kind") WHERE "categories"."user_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_name_unique" ON "categories" USING btree ("user_id",lower("name"),"kind") WHERE "categories"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "credit_card_purchases_user_date_idx" ON "credit_card_purchases" USING btree ("user_id","purchase_date" DESC NULLS LAST) WHERE "credit_card_purchases"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_card_purchases_external_unique" ON "credit_card_purchases" USING btree ("user_id","external_provider","external_id") WHERE "credit_card_purchases"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "credit_card_transactions_invoice_idx" ON "credit_card_transactions" USING btree ("user_id","invoice_id");--> statement-breakpoint
CREATE INDEX "credit_card_transactions_competence_idx" ON "credit_card_transactions" USING btree ("user_id","competence_date");--> statement-breakpoint
CREATE INDEX "credit_cards_user_idx" ON "credit_cards" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "goal_contributions_goal_idx" ON "goal_contributions" USING btree ("user_id","goal_id","date");--> statement-breakpoint
CREATE INDEX "goals_user_idx" ON "goals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recurring_transactions_user_idx" ON "recurring_transactions" USING btree ("user_id") WHERE "recurring_transactions"."active";--> statement-breakpoint
CREATE INDEX "transactions_user_date_idx" ON "transactions" USING btree ("user_id","date" DESC NULLS LAST) WHERE "transactions"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "transactions_user_account_idx" ON "transactions" USING btree ("user_id","account_id");--> statement-breakpoint
CREATE INDEX "transactions_transfer_account_idx" ON "transactions" USING btree ("user_id","transfer_account_id") WHERE "transactions"."transfer_account_id" is not null;--> statement-breakpoint
CREATE INDEX "transactions_invoice_idx" ON "transactions" USING btree ("credit_card_invoice_id") WHERE "transactions"."credit_card_invoice_id" is not null;--> statement-breakpoint
CREATE INDEX "transactions_user_category_idx" ON "transactions" USING btree ("user_id","category_id","date");--> statement-breakpoint
CREATE INDEX "transactions_description_trgm_idx" ON "transactions" USING gin ("description" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_external_unique" ON "transactions" USING btree ("user_id","external_provider","external_id") WHERE "transactions"."external_id" is not null;--> statement-breakpoint
CREATE POLICY "accounts_owner" ON "accounts" AS PERMISSIVE FOR ALL TO "norbius_app" USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "categories_read" ON "categories" AS PERMISSIVE FOR SELECT TO "norbius_app" USING (user_id is null or user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "categories_insert" ON "categories" AS PERMISSIVE FOR INSERT TO "norbius_app" WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "categories_update" ON "categories" AS PERMISSIVE FOR UPDATE TO "norbius_app" USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "categories_delete" ON "categories" AS PERMISSIVE FOR DELETE TO "norbius_app" USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "credit_card_invoices_owner" ON "credit_card_invoices" AS PERMISSIVE FOR ALL TO "norbius_app" USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "credit_card_purchases_owner" ON "credit_card_purchases" AS PERMISSIVE FOR ALL TO "norbius_app" USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "credit_card_transactions_owner" ON "credit_card_transactions" AS PERMISSIVE FOR ALL TO "norbius_app" USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "credit_cards_owner" ON "credit_cards" AS PERMISSIVE FOR ALL TO "norbius_app" USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "goal_contributions_owner" ON "goal_contributions" AS PERMISSIVE FOR ALL TO "norbius_app" USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "goals_owner" ON "goals" AS PERMISSIVE FOR ALL TO "norbius_app" USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "recurring_transactions_owner" ON "recurring_transactions" AS PERMISSIVE FOR ALL TO "norbius_app" USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "transactions_owner" ON "transactions" AS PERMISSIVE FOR ALL TO "norbius_app" USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);