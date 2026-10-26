-- Layout 26/10/2026: na ficha, o tipo do negócio, o valor negociado e o vendedor (diferente do dono). Colunas novas e nulas: o código antigo as ignora.
ALTER TABLE "ComercialFicha" ADD COLUMN "tipoNegocio" TEXT;
ALTER TABLE "ComercialFicha" ADD COLUMN "valorNegociadoCentavos" INTEGER;
ALTER TABLE "ComercialFicha" ADD COLUMN "vendedorId" TEXT;
ALTER TABLE "AcordoComercial" ADD COLUMN "fechadoEm" DATE;
