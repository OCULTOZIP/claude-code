-- Assinaturas e pagamentos: sem DELETE para a aplicação (histórico financeiro).
GRANT SELECT, INSERT, UPDATE ON subscriptions, billing_payments TO norbius_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON billing_events TO norbius_app;--> statement-breakpoint
-- Webhooks chegam sem sessão: resolvem o dono pelo id do cliente no provedor e
-- só então operam via withUserContext (RLS). Devolve apenas o user_id.
CREATE OR REPLACE FUNCTION norbius_billing_user(p_customer text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT user_id FROM subscriptions WHERE provider_customer_id = p_customer
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION norbius_billing_user(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION norbius_billing_user(text) TO norbius_app;
