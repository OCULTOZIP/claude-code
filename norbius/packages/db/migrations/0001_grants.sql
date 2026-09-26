-- Privilégios mínimos do papel da aplicação.
-- Regra: cada nova tabela concede privilégios explicitamente em sua migração
-- (não usamos ALTER DEFAULT PRIVILEGES para não expor tabelas por acidente).
GRANT USAGE ON SCHEMA public TO norbius_app;--> statement-breakpoint

-- Autenticação (sem RLS; acessadas apenas pela camada de auth).
GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions, auth_accounts, verifications, rate_limits TO norbius_app;--> statement-breakpoint

-- Dados do usuário (RLS aplicada: norbius_app não é dono das tabelas, então
-- as políticas sempre valem para ele; o dono é usado só em migrações).
GRANT SELECT, INSERT, UPDATE, DELETE ON profiles, consents TO norbius_app;--> statement-breakpoint

-- Auditoria: somente inserção (append-only para a aplicação).
GRANT INSERT ON audit_logs TO norbius_app;--> statement-breakpoint
GRANT USAGE ON SEQUENCE audit_logs_id_seq TO norbius_app;
