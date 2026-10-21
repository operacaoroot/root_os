-- ============================================================================
-- UMA PASTA DO DRIVE, UM CLIENTE (revisão adversarial da rodada dos agentes, 21/10/2026)
-- ============================================================================
--
-- ADITIVA: só um índice. O efeito de `drive.pasta.criar` LIGA a pasta de mesmo
-- nome que já existe na raiz; sem esta trava, dois clientes da mesma empresa
-- podiam apontar para a mesma pasta, e o arquivista mandaria o arquivo de um
-- para a pasta do outro. O efeito já confere antes de gravar o ponteiro; o
-- índice fecha a corrida entre duas confirmações simultâneas.
--
-- Parcial: cliente sem pasta (NULL) não conta. Nenhuma tabela nova, nenhuma
-- policy nova ("Partner" já tem RLS FORCE).
--
-- SE ABORTAR: existe hoje mais de um cliente com a mesma pasta na mesma
-- empresa. A migration não escolhe qual é o dono. Liste os pares com
--   SELECT "orgId", "pastaDriveId", array_agg(id) FROM "Partner"
--    WHERE "pastaDriveId" IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;
-- confira no Drive de quem é cada pasta e, nos clientes que NÃO são o dono,
-- anule o ponteiro (UPDATE "Partner" SET "pastaDriveId" = NULL, "pastaDriveUrl"
-- = NULL WHERE id = '<id>'), depois `prisma migrate resolve --rolled-back
-- 20261021380000_pasta_do_cliente_unica` e suba de novo. Nada é apagado.
--
-- Rollback de imagem: a imagem anterior não conhece o índice; o único efeito
-- nela é que ligar a pasta de outro cliente passa a falhar (P2002) e o motivo
-- fica em "pastaDriveErro". Rollback do banco (só se preciso):
--   DROP INDEX "Partner_orgId_pastaDriveId_unica";
-- ============================================================================

DO $$
DECLARE
  repetidas integer;
BEGIN
  SELECT count(*) INTO repetidas FROM (
    SELECT 1 FROM "Partner"
     WHERE "pastaDriveId" IS NOT NULL
     GROUP BY "orgId", "pastaDriveId"
    HAVING count(*) > 1
  ) d;
  IF repetidas > 0 THEN
    RAISE EXCEPTION
      'Há % pasta(s) do Drive ligada(s) a mais de um cliente na mesma empresa. Nada foi alterado. Veja o cabeçalho desta migration (20261021380000_pasta_do_cliente_unica): confira no Drive o dono de cada pasta, anule o ponteiro dos outros clientes, marque a migration como rolled-back e suba de novo.',
      repetidas;
  END IF;
END $$;

CREATE UNIQUE INDEX "Partner_orgId_pastaDriveId_unica"
  ON "Partner" ("orgId", "pastaDriveId")
  WHERE "pastaDriveId" IS NOT NULL;
