-- ============================================================================
-- A VITRINE DO TOTEM (12/10/2026)
--
-- Três mudanças pedidas depois que o teste subiu:
--
-- 1. O catálogo antigo do Sr. aGranel tem "sugestões de consumo", que a ficha
--    passa a mostrar (`TotemProduto.sugestoes`).
-- 2. O aviso de alergênicos que o sistema antigo punha em toda ficha vira uma
--    configuração da empresa (`TotemConfig.alergenicosPadrao`), usada quando o
--    produto não tem aviso próprio.
-- 3. A campanha vira banner: imagem, texto de apoio, botão e uma ação. Só a
--    ação `cadastro` emite cupom, então benefício e validade deixam de ser
--    obrigatórios no banco; o serviço continua exigindo os dois nessa ação.
--    As campanhas que já existem ficam com `acao = 'cadastro'` e não mudam de
--    comportamento.
--
-- Nenhuma tabela nova: as policies de RLS da migration do totem continuam
-- valendo para as colunas novas.
--
-- CAMINHO DE VOLTA
--   ALTER TABLE "TotemCampanha" DROP COLUMN "acao", DROP COLUMN "textoApoio",
--     DROP COLUMN "textoBotao", DROP COLUMN "imagemUrl", DROP COLUMN "produtoIds",
--     DROP COLUMN "ordem";
--   (benefício e validade só voltam a NOT NULL depois de apagar as campanhas
--   que não são de cadastro)
--   ALTER TABLE "TotemConfig" DROP COLUMN "alergenicosPadrao";
--   ALTER TABLE "TotemProduto" DROP COLUMN "sugestoes";
-- ============================================================================

ALTER TABLE "TotemProduto" ADD COLUMN "sugestoes" TEXT;

ALTER TABLE "TotemConfig" ADD COLUMN "alergenicosPadrao" TEXT;

ALTER TABLE "TotemCampanha"
  ADD COLUMN "acao" TEXT NOT NULL DEFAULT 'cadastro',
  ADD COLUMN "textoApoio" TEXT,
  ADD COLUMN "textoBotao" TEXT,
  ADD COLUMN "imagemUrl" TEXT,
  ADD COLUMN "produtoIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "ordem" INTEGER NOT NULL DEFAULT 0,
  ALTER COLUMN "tipoBeneficio" DROP NOT NULL,
  ALTER COLUMN "validadeDias" DROP NOT NULL;
