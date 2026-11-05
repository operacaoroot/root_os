-- Diários de manutenção e histórico de migrations são exclusivos da operação.
-- A concessão padrão de tabelas novas podia torná-los legíveis pelo runtime.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND (c.relname LIKE '\_diario\_%' ESCAPE '\' OR c.relname='_prisma_migrations')
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM mktos_app', t.relname);
    IF has_table_privilege('mktos_app',format('public.%I',t.relname),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') THEN
      RAISE EXCEPTION 'Acesso indireto do runtime à tabela operacional %: revisar grants/memberships',t.relname;
    END IF;
  END LOOP;
END $$;
