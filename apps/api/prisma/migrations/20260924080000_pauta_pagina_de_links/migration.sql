-- ============================================================================
-- MC12 — A PÁGINA DE LINKS DO EPISÓDIO
--
-- Cada episódio ganha uma BioPage com os links citados. Montar a página de novo
-- (roteiro mudou, links da casa mudaram) tem de ATUALIZAR os links que ela já
-- tem, não empilhar outra cópia: a chave diz quem montou o link e para quê
-- (`pauta:item:<hash>`, `pauta:casa:<hash>`), e o índice único por página é a
-- tranca contra duas montagens simultâneas.
--
-- Nula para os botões do painel e os links de campanha das peças: o Postgres
-- não compara NULL com NULL no índice único, então eles seguem como antes.
--
-- Coluna nova numa tabela que já tem RLS com FORCE e o gatilho
-- `BioLink_orgId_do_pai` (migration 20260911050000_isolamento_por_linha): a
-- proteção por linha vale para ela sem mudar nada.
-- ============================================================================

ALTER TABLE "BioLink" ADD COLUMN     "chave" TEXT;

CREATE UNIQUE INDEX "BioLink_pageId_chave_key" ON "BioLink"("pageId", "chave");
