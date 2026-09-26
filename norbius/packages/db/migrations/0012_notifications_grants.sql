-- Notificações: a aplicação cria, marca como lida/enviada; não apaga (histórico).
GRANT SELECT, INSERT, UPDATE ON notifications TO norbius_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON notification_preferences, intelligence_runs TO norbius_app;--> statement-breakpoint
-- Jobs agendados rodam sem sessão: estas funções devolvem só ids (quem está
-- devido); todo o resto roda via withUserContext (RLS).
CREATE OR REPLACE FUNCTION norbius_intelligence_due(p_now timestamptz, p_hour int, p_limit int)
RETURNS TABLE (user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id
  FROM users u
  JOIN profiles p ON p.user_id = u.id
  LEFT JOIN intelligence_runs r ON r.user_id = u.id
  WHERE u.email_verified
    AND extract(hour FROM p_now AT TIME ZONE p.timezone) >= p_hour
    AND (r.last_daily_run_on IS NULL OR r.last_daily_run_on < (p_now AT TIME ZONE p.timezone)::date)
  ORDER BY r.last_daily_run_on NULLS FIRST, u.id
  LIMIT p_limit
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION norbius_intelligence_due(timestamptz, int, int) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION norbius_intelligence_due(timestamptz, int, int) TO norbius_app;--> statement-breakpoint
CREATE OR REPLACE FUNCTION norbius_notifications_due(p_now timestamptz, p_limit int)
RETURNS TABLE (id uuid, user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT n.id, n.user_id
  FROM notifications n
  WHERE n.channel = 'email' AND n.status = 'pending' AND n.scheduled_for <= p_now AND n.attempts < 5
  ORDER BY n.scheduled_for
  LIMIT p_limit
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION norbius_notifications_due(timestamptz, int) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION norbius_notifications_due(timestamptz, int) TO norbius_app;
