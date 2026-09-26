-- Inteligência (Fase 4): insights podem ser dispensados (UPDATE de status), nunca apagados pela aplicação.
GRANT SELECT, INSERT, UPDATE ON insights TO norbius_app;--> statement-breakpoint
-- Projeções são cache: a aplicação poda as antigas.
GRANT SELECT, INSERT, DELETE ON projection_snapshots TO norbius_app;--> statement-breakpoint
GRANT SELECT, INSERT ON core_state_events TO norbius_app;
