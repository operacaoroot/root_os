-- ============================================================================
-- MD2 — DESDE QUANDO O EPISÓDIO ESTÁ NO STATUS ATUAL
--
-- `PautaEpisodio.statusDesde`: o vigia do Mac (`root-midia vigia`) só aceita
-- como bruto do episódio a gravação do OBS com data de modificação POSTERIOR à
-- entrada em Gravação. É a trava contra processar um arquivo que não era o do
-- episódio.
--
-- QUEM CARIMBA É O BANCO, como no `WorkTask.statusDesde` (20260917010000). O
-- status muda por vários caminhos que não passam pelo `EpisodioService`: a
-- mídia (→ Edição) e a transcrição (→ Pacote) no `MidiaService`, o roteiro
-- (→ Gravação) no `RoteiroService`, a semana (→ Derivação) no
-- `DerivacaoService`, todos por `updateMany` condicionado. Uma regra em cada
-- serviço seria esquecida no próximo; o gatilho não. Só a TROCA de status
-- carimba: editar roteiro, título ou mídia não reinicia a data.
--
-- Diferente da esteira, a coluna nasce NOT NULL com `DEFAULT now()`: o
-- episódio que já existe ganha o instante desta migration. Para o vigia isso
-- é o lado seguro — gravação anterior à migration não é aceita sozinha, e o
-- `/root-midia ep-NN` à mão continua valendo.
--
-- Coluna nova numa tabela que já tem RLS com FORCE e policies: o isolamento
-- vale para ela sem mudar nada.
--
-- CAMINHO DE VOLTA
--   DROP TRIGGER "PautaEpisodio_statusDesde" ON "PautaEpisodio";
--   DROP FUNCTION mktos_carimba_status_do_episodio();
--   ALTER TABLE "PautaEpisodio" DROP COLUMN "statusDesde";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260924190735_pauta_episodio_status_desde';
-- ============================================================================

-- AlterTable
ALTER TABLE "PautaEpisodio" ADD COLUMN     "statusDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateFunction + CreateTrigger: o banco carimba a troca de status
CREATE OR REPLACE FUNCTION mktos_carimba_status_do_episodio() RETURNS trigger AS $$
BEGIN
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    NEW."statusDesde" := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp;

COMMENT ON FUNCTION mktos_carimba_status_do_episodio() IS
  'Carimba PautaEpisodio.statusDesde em toda troca de status (migration 20260924190735_pauta_episodio_status_desde).';

CREATE TRIGGER "PautaEpisodio_statusDesde"
  BEFORE UPDATE ON "PautaEpisodio"
  FOR EACH ROW EXECUTE FUNCTION mktos_carimba_status_do_episodio();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'PautaEpisodio_statusDesde' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'PautaEpisodio sem o gatilho que carimba a troca de status.';
  END IF;
END $$;
