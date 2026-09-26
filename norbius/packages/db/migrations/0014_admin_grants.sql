-- Painel admin (Fase 7, ADR 0007). O papel norbius_admin é estruturalmente
-- incapaz de ler dados financeiros: não recebe GRANT em transactions,
-- accounts, credit_card_*, goals, recurring_transactions, insights,
-- projection_snapshots, notifications, ai_*. Tudo o que vê passa por
-- tabelas de cadastro/assinatura, views agregadas ou funções auditadas.
GRANT USAGE ON SCHEMA public TO norbius_admin;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON admin_users, admin_sessions TO norbius_admin;--> statement-breakpoint
GRANT SELECT ON support_access_grants, subscriptions, billing_payments TO norbius_admin;--> statement-breakpoint
GRANT INSERT ON audit_logs TO norbius_admin;--> statement-breakpoint
GRANT USAGE ON SEQUENCE audit_logs_id_seq TO norbius_admin;--> statement-breakpoint
-- O usuário cria e revoga as próprias autorizações (RLS por user_id).
GRANT SELECT, INSERT, UPDATE ON support_access_grants TO norbius_app;--> statement-breakpoint

-- Cadastro e assinatura de cada cliente, sem renda nem dados financeiros.
CREATE VIEW admin_customers AS
SELECT u.id, u.name, u.email, u.email_verified, u.status, u.created_at,
       greatest(u.last_seen_at, (SELECT max(s.updated_at) FROM sessions s WHERE s.user_id = u.id)) AS last_seen_at,
       p.onboarding_status, p.timezone,
       sub.status AS subscription_status, sub.cycle, sub.trial_started_at, sub.trial_ends_on, sub.paid_through,
       sub.cancel_at_period_end, sub.canceled_at
FROM users u
LEFT JOIN profiles p ON p.user_id = u.id
LEFT JOIN subscriptions sub ON sub.user_id = u.id;--> statement-breakpoint

-- Métricas agregadas (uma linha). Uso da IA só em contagens.
CREATE VIEW admin_metrics AS
SELECT
  (SELECT count(*) FROM users)::int AS total_users,
  (SELECT count(*) FROM users WHERE email_verified)::int AS verified_users,
  (SELECT count(*) FROM users WHERE created_at >= now() - interval '7 days')::int AS new_7d,
  (SELECT count(*) FROM users WHERE created_at >= now() - interval '30 days')::int AS new_30d,
  (SELECT count(*) FROM admin_customers WHERE last_seen_at >= now() - interval '1 day')::int AS active_1d,
  (SELECT count(*) FROM admin_customers WHERE last_seen_at >= now() - interval '7 days')::int AS active_7d,
  (SELECT count(*) FROM admin_customers WHERE last_seen_at >= now() - interval '30 days')::int AS active_30d,
  (SELECT count(*) FROM users WHERE status = 'suspended')::int AS suspended,
  (SELECT count(*) FROM subscriptions WHERE paid_through >= current_date)::int AS paying,
  (SELECT count(*) FROM subscriptions WHERE trial_ends_on >= current_date AND (paid_through IS NULL OR paid_through < current_date))::int AS trialing,
  (SELECT count(*) FROM subscriptions WHERE trial_started_at IS NOT NULL)::int AS trials_started,
  (SELECT count(*) FROM subscriptions WHERE trial_started_at IS NOT NULL AND paid_through IS NOT NULL)::int AS trials_converted,
  (SELECT count(*) FROM subscriptions WHERE canceled_at >= now() - interval '30 days')::int AS canceled_30d,
  (SELECT coalesce(sum(messages_count), 0) FROM ai_usage WHERE period_month = date_trunc('month', current_date)::date)::int AS ai_messages_month,
  (SELECT coalesce(sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)), 0) FROM ai_messages WHERE created_at >= date_trunc('month', now()))::bigint AS ai_tokens_month;--> statement-breakpoint

-- Registro de atividades: detalhes (metadata) só das ações de admins.
CREATE VIEW admin_audit_logs AS
SELECT id, actor_type, actor_id, subject_user_id, action, entity_type,
       CASE WHEN actor_type = 'admin' THEN metadata ELSE '{}'::jsonb END AS metadata,
       ip, request_id, created_at
FROM audit_logs;--> statement-breakpoint
GRANT SELECT ON admin_customers, admin_metrics, admin_audit_logs TO norbius_admin;--> statement-breakpoint

-- Toda ação sensível confere o admin (ativo + papel) DENTRO do banco.
CREATE OR REPLACE FUNCTION norbius_admin_assert(p_admin uuid, p_roles text[]) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE id = p_admin AND active AND (role = 'superadmin' OR role = ANY (p_roles))) THEN
    RAISE EXCEPTION 'admin sem permissão' USING ERRCODE = '42501';
  END IF;
END $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION norbius_admin_set_user_status(p_admin uuid, p_user uuid, p_status text, p_reason text, p_request text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM norbius_admin_assert(p_admin, ARRAY['support']);
  IF p_status NOT IN ('active', 'suspended') THEN RAISE EXCEPTION 'status inválido' USING ERRCODE = '22023'; END IF;
  IF char_length(coalesce(trim(p_reason), '')) < 5 THEN RAISE EXCEPTION 'motivo obrigatório' USING ERRCODE = '22023'; END IF;
  UPDATE users SET status = p_status, updated_at = now() WHERE id = p_user AND status IN ('active', 'suspended');
  IF NOT FOUND THEN RAISE EXCEPTION 'usuário não encontrado' USING ERRCODE = 'P0002'; END IF;
  -- Suspender encerra todas as sessões; o login já recusa quem não está ativo.
  IF p_status = 'suspended' THEN DELETE FROM sessions WHERE user_id = p_user; END IF;
  INSERT INTO audit_logs (actor_type, actor_id, subject_user_id, action, entity_type, entity_id, metadata, request_id)
  VALUES ('admin', p_admin, p_user, CASE p_status WHEN 'suspended' THEN 'admin.user.suspend' ELSE 'admin.user.reactivate' END,
          'user', p_user::text, jsonb_build_object('reason', p_reason), p_request);
END $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION norbius_admin_grant_trial(p_admin uuid, p_user uuid, p_days int, p_reason text, p_request text)
RETURNS date LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_end date;
BEGIN
  PERFORM norbius_admin_assert(p_admin, ARRAY['billing']);
  IF p_days NOT BETWEEN 1 AND 90 THEN RAISE EXCEPTION 'dias inválidos' USING ERRCODE = '22023'; END IF;
  IF char_length(coalesce(trim(p_reason), '')) < 5 THEN RAISE EXCEPTION 'motivo obrigatório' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user) THEN RAISE EXCEPTION 'usuário não encontrado' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO subscriptions (user_id, status, trial_started_at, trial_ends_on)
  VALUES (p_user, 'trialing', now(), current_date + p_days - 1)
  ON CONFLICT (user_id) DO UPDATE SET
    trial_ends_on = greatest(coalesce(subscriptions.trial_ends_on, current_date - 1), current_date - 1) + p_days,
    trial_started_at = coalesce(subscriptions.trial_started_at, now()),
    status = CASE WHEN subscriptions.status IN ('none', 'canceled') THEN 'trialing' ELSE subscriptions.status END,
    updated_at = now()
  RETURNING trial_ends_on INTO v_end;
  INSERT INTO audit_logs (actor_type, actor_id, subject_user_id, action, entity_type, entity_id, metadata, request_id)
  VALUES ('admin', p_admin, p_user, 'admin.subscription.grant_trial', 'subscription', p_user::text,
          jsonb_build_object('days', p_days, 'reason', p_reason, 'trialEndsOn', v_end), p_request);
  RETURN v_end;
END $$;--> statement-breakpoint

-- Acesso excepcional: só com autorização válida criada pelo usuário; cada
-- leitura é auditada e o usuário é avisado (no máximo um aviso por hora).
CREATE OR REPLACE FUNCTION norbius_support_transactions(p_admin uuid, p_grant uuid, p_limit int, p_request text)
RETURNS TABLE (tx_date date, tx_description text, tx_type text, amount_cents bigint, category_name text, account_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g support_access_grants%ROWTYPE;
BEGIN
  PERFORM norbius_admin_assert(p_admin, ARRAY['support']);
  SELECT * INTO g FROM support_access_grants WHERE id = p_grant;
  IF NOT FOUND OR g.revoked_at IS NOT NULL OR g.expires_at <= now() OR NOT ('transactions:read' = ANY (g.scope)) THEN
    RAISE EXCEPTION 'autorização inválida ou expirada' USING ERRCODE = '42501';
  END IF;
  INSERT INTO audit_logs (actor_type, actor_id, subject_user_id, action, entity_type, entity_id, metadata, request_id)
  VALUES ('admin', p_admin, g.user_id, 'support.transactions.read', 'support_access_grant', p_grant::text,
          jsonb_build_object('limit', p_limit), p_request);
  INSERT INTO notifications (user_id, type, title, body, data, channel, status, sent_at, dedup_key)
  VALUES (g.user_id, 'insight', 'O suporte acessou suas transações',
          'Acesso feito com a autorização que você concedeu. Você pode revogá-la a qualquer momento em Configurações → Suporte.',
          jsonb_build_object('grantId', p_grant), 'in_app', 'sent', now(),
          'support_read:' || p_grant::text || ':' || to_char(now(), 'YYYYMMDDHH24'))
  ON CONFLICT (user_id, dedup_key) DO NOTHING;
  RETURN QUERY
    SELECT t.date, t.description, t.type, t.amount_cents, c.name, a.name
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN accounts a ON a.id = t.account_id
    WHERE t.user_id = g.user_id AND t.deleted_at IS NULL
    ORDER BY t.date DESC, t.created_at DESC
    LIMIT least(greatest(coalesce(p_limit, 50), 1), 200);
END $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION norbius_admin_assert(uuid, text[]) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION norbius_admin_set_user_status(uuid, uuid, text, text, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION norbius_admin_grant_trial(uuid, uuid, int, text, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION norbius_support_transactions(uuid, uuid, int, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION norbius_admin_set_user_status(uuid, uuid, text, text, text) TO norbius_admin;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION norbius_admin_grant_trial(uuid, uuid, int, text, text) TO norbius_admin;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION norbius_support_transactions(uuid, uuid, int, text) TO norbius_admin;
