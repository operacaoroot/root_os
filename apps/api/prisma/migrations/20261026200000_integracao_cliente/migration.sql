-- INTEGRAÇÃO DO CLIENTE (26/10/2026). Só acrescenta: duas colunas opcionais e os
-- índices. O código anterior não lê estas colunas, então voltar a imagem não perde nada.

-- O cadastro duplicado aponta para o principal (nada é apagado nem fundido).
ALTER TABLE "Partner" ADD COLUMN "principalId" TEXT;
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Partner_principalId_idx" ON "Partner"("principalId");

-- O acordo comercial aponta para o cliente do Financeiro.
ALTER TABLE "AcordoComercial" ADD COLUMN "partnerId" TEXT;
ALTER TABLE "AcordoComercial" ADD CONSTRAINT "AcordoComercial_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "AcordoComercial_partnerId_idx" ON "AcordoComercial"("partnerId");
