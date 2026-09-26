-- Composite FKs com ON DELETE SET NULL precisam anular só a coluna de
-- referência (user_id é NOT NULL); ajustado manualmente na 0002.

-- Privilégios do papel da aplicação nas tabelas financeiras (RLS aplicada).
GRANT SELECT, INSERT, UPDATE, DELETE ON
  accounts, categories, credit_cards, credit_card_invoices, recurring_transactions,
  transactions, credit_card_purchases, credit_card_transactions, goals, goal_contributions
TO norbius_app;--> statement-breakpoint

-- Categoria usada precisa ser do sistema ou do próprio usuário, e do tipo certo
-- (receita/despesa). Defesa em profundidade além da validação na API.
-- SECURITY DEFINER para enxergar categorias independentemente do contexto RLS.
CREATE OR REPLACE FUNCTION norbius_check_category() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  row_json jsonb := to_jsonb(NEW);
  cat_id uuid := (row_json->>'category_id')::uuid;
  expected_kind text := CASE WHEN TG_ARGV[0] = 'from_type' THEN row_json->>'type' ELSE TG_ARGV[0] END;
  cat record;
BEGIN
  IF cat_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT user_id, kind INTO cat FROM categories WHERE id = cat_id;
  IF NOT FOUND OR (cat.user_id IS NOT NULL AND cat.user_id <> (row_json->>'user_id')::uuid) THEN
    RAISE EXCEPTION 'categoria inacessível' USING ERRCODE = '23503';
  END IF;
  IF expected_kind IN ('income', 'expense') AND cat.kind <> expected_kind THEN
    RAISE EXCEPTION 'categoria incompatível com o tipo' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION norbius_check_category() FROM PUBLIC;--> statement-breakpoint

CREATE TRIGGER transactions_category_check BEFORE INSERT OR UPDATE OF category_id, type, user_id ON transactions
  FOR EACH ROW EXECUTE FUNCTION norbius_check_category('from_type');--> statement-breakpoint
CREATE TRIGGER recurring_transactions_category_check BEFORE INSERT OR UPDATE OF category_id, type, user_id ON recurring_transactions
  FOR EACH ROW EXECUTE FUNCTION norbius_check_category('from_type');--> statement-breakpoint
CREATE TRIGGER credit_card_purchases_category_check BEFORE INSERT OR UPDATE OF category_id, user_id ON credit_card_purchases
  FOR EACH ROW EXECUTE FUNCTION norbius_check_category('expense');--> statement-breakpoint
CREATE TRIGGER credit_card_transactions_category_check BEFORE INSERT OR UPDATE OF category_id, user_id ON credit_card_transactions
  FOR EACH ROW EXECUTE FUNCTION norbius_check_category('expense');--> statement-breakpoint

-- Categorias do sistema (somente leitura para os usuários).
INSERT INTO categories (user_id, name, kind, system_key, icon) VALUES
  (NULL, 'Alimentação',   'expense', 'alimentacao',   'utensils'),
  (NULL, 'Moradia',       'expense', 'moradia',       'home'),
  (NULL, 'Transporte',    'expense', 'transporte',    'car'),
  (NULL, 'Saúde',         'expense', 'saude',         'heart-pulse'),
  (NULL, 'Educação',      'expense', 'educacao',      'graduation-cap'),
  (NULL, 'Lazer',         'expense', 'lazer',         'party-popper'),
  (NULL, 'Compras',       'expense', 'compras',       'shopping-bag'),
  (NULL, 'Assinaturas',   'expense', 'assinaturas',   'repeat'),
  (NULL, 'Contas',        'expense', 'contas',        'receipt'),
  (NULL, 'Investimentos', 'expense', 'investimentos', 'trending-up'),
  (NULL, 'Outros',        'expense', 'outros',        'circle'),
  (NULL, 'Salário',       'income',  'salario',       'briefcase'),
  (NULL, 'Investimentos', 'income',  'investimentos', 'trending-up'),
  (NULL, 'Outros',        'income',  'outros',        'circle')
ON CONFLICT DO NOTHING;
