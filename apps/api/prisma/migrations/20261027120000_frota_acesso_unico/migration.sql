-- Frota · um acesso por chave em cada casa.
-- Em 27/10/2026 a casa affari mandou dois relatos a 21 ms (o primeiro à mão pela etapa 09 e o
-- do timer, que dispara na ativação), os dois leram a casa sem acessos e cada chave foi gravada
-- duas vezes. O serviço passou a serializar o relato por casa; este índice é a segunda tranca.
-- Antes do índice, as duplicatas saem: fica a linha mais antiga de cada (casa, impressão digital).
-- Nenhuma ordem de revogação apontava para linha nenhuma quando isto foi escrito.
DELETE FROM "FrotaAcesso" a
 USING "FrotaAcesso" b
 WHERE a."orgId" = b."orgId" AND a."casaId" = b."casaId" AND a."fingerprint" = b."fingerprint"
   AND a."fingerprint" IS NOT NULL
   AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."id" > b."id"));

DROP INDEX IF EXISTS "FrotaAcesso_orgId_casaId_fingerprint_idx";
CREATE UNIQUE INDEX "FrotaAcesso_orgId_casaId_fingerprint_key" ON "FrotaAcesso"("orgId", "casaId", "fingerprint");
