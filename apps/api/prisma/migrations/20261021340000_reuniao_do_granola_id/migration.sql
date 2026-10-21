-- ============================================================================
-- UMA ENTRADA SÓ PARA A REUNIÃO DO GRANOLA (rodada dos agentes, 21/10/2026, TR-02/TR-03)
-- ============================================================================
--
-- ADITIVA: uma coluna nula e um índice único em "ReuniaoDoCartao". Nada é apagado.
--
-- O webhook do Zap (ficha/granola.service.ts) e o modo direto (work/atas/
-- atas-do-granola.service.ts) gravavam a reunião procurando a outra por texto (o
-- link que contém o id, ou a marca "granola:<id>" no corpo). Duas chegadas ao
-- mesmo tempo passavam as duas pela procura e gravavam duas linhas. Agora as duas
-- portas gravam o id da reunião no Granola em "granolaId", e o índice único
-- (orgId, granolaId) faz a segunda virar a mesma reunião.
--
-- O PREENCHIMENTO das linhas antigas tira o id do link da nota (o que o Zap manda)
-- ou da marca "granola:<id>" do corpo (a ata do modo direto), e só na linha MAIS
-- ANTIGA de cada id: se já houver duas linhas da mesma reunião, a segunda fica com
-- "granolaId" nulo (continua na ficha, como estava) e o índice nasce sem conflito.
--
-- Rollback só de imagem: a imagem anterior não lê a coluna e não grava nela; o
-- índice único só vale para linhas com "granolaId" preenchido, que a imagem
-- anterior nunca escreve. Para desfazer de vez:
--   DROP INDEX "ReuniaoDoCartao_orgId_granolaId_key";
--   ALTER TABLE "ReuniaoDoCartao" DROP COLUMN "granolaId";
-- ============================================================================

ALTER TABLE "ReuniaoDoCartao" ADD COLUMN "granolaId" TEXT;

WITH candidatos AS (
  SELECT
    r."id",
    r."orgId",
    r."createdAt",
    COALESCE(
      substring(r."link" from '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|not_[A-Za-z0-9]{14})'),
      substring(r."transcricao" from 'granola:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|not_[A-Za-z0-9]{14})')
    ) AS gid
  FROM "ReuniaoDoCartao" r
  WHERE r."fonte" = 'granola'
),
primeiros AS (
  SELECT DISTINCT ON ("orgId", gid) "id", gid
  FROM candidatos
  WHERE gid IS NOT NULL
  ORDER BY "orgId", gid, "createdAt" ASC, "id" ASC
)
UPDATE "ReuniaoDoCartao" r
   SET "granolaId" = p.gid
  FROM primeiros p
 WHERE r."id" = p."id";

CREATE UNIQUE INDEX "ReuniaoDoCartao_orgId_granolaId_key" ON "ReuniaoDoCartao"("orgId", "granolaId");
