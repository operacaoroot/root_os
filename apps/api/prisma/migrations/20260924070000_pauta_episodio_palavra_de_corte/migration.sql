-- ============================================================================
-- MC8 — A PALAVRA DE CORTE DO EPISÓDIO (D-MC2)
--
-- A palavra que o apresentador diz a cada erro na gravação, e que a edição
-- (MC9) corta dali para trás. Coluna nula = o episódio segue a da empresa
-- (nota `pauta.palavra-de-corte` da memória) ou o padrão "root, corta".
--
-- Coluna nova numa tabela que já tem RLS com FORCE e policies (migration
-- 20260924060000_pauta_episodio): a proteção por linha vale para ela sem mudar
-- nada, e o gatilho da empresa não olha esta coluna.
-- ============================================================================

ALTER TABLE "PautaEpisodio" ADD COLUMN     "palavraDeCorte" TEXT;
