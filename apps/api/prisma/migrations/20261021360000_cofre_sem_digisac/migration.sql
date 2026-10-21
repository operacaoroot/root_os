-- ============================================================================
-- O COFRE SEM O DIGISAC · Rodada dos agentes, lane A6 (21/10/2026)
--
-- O conector do DigiSac foi EXCLUÍDO do código nesta rodada (o WhatsApp do
-- comercial é a Evolution). As credenciais que ele guardava no cofre
-- (`SegredoDeConector` com `conector = 'digisac'`: nomes `url`, `token`,
-- `servico` e `webhook_segredo`) não têm mais quem as leia. Esta migration
-- apaga SÓ essas linhas. Nenhuma outra tabela e nenhum outro conector é tocado.
--
-- ISOLAMENTO POR LINHA. `SegredoDeConector` tem RLS com FORCE, e FORCE vale
-- também para o dono da tabela: quem não é superusuário nem tem BYPASSRLS veria
-- a tabela vazia e o DELETE apagaria zero linhas. Nesse caso a migration NÃO
-- falha (migration que falha derruba a API, porque `migrate deploy` roda no
-- `command` do container): ela avisa no log e segue, e as linhas ficam no banco,
-- cifradas e sem leitor. Para apagá-las depois, rode o mesmo DELETE como dono
-- superusuário.
--
-- CAMINHO DE VOLTA. Não há como restaurar o valor pela migration (a linha
-- apagada levou o texto cifrado). Para a imagem anterior isso não muda nada que
-- funcionava: a Root nunca ligou uma conta do DigiSac (o provedor ficou
-- `simulado`), e sem as linhas a imagem anterior mostraria o DigiSac como
-- "não configurado". Quem precisar da credencial de volta salva de novo em
-- Conexões da imagem anterior. Para desfazer só o registro da migration:
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261021360000_cofre_sem_digisac';
-- ============================================================================

DO $$
DECLARE
  atravessa boolean;
  apagadas  integer := 0;
BEGIN
  SELECT r.rolsuper OR r.rolbypassrls INTO atravessa FROM pg_roles r WHERE r.rolname = current_user;
  IF NOT coalesce(atravessa, false) THEN
    RAISE WARNING 'cofre sem o DigiSac: % nao atravessa o isolamento por linha; nenhuma linha foi apagada (rode o DELETE como superusuario)', current_user;
    RETURN;
  END IF;
  DELETE FROM "SegredoDeConector" WHERE "conector" = 'digisac';
  GET DIAGNOSTICS apagadas = ROW_COUNT;
  RAISE NOTICE 'cofre sem o DigiSac: % linha(s) de credencial apagada(s)', apagadas;
END $$;
