-- Leva 5 (L4, 27/10/2026): a aba Geral do painel do lead. Três colunas novas e nulas na ficha
-- (tipo de pessoa PJ/PF, preferências de atendimento e o link da proposta escrito à mão);
-- o código antigo as ignora e nada é apagado. A tabela já tem RLS FORCE: coluna nova não pede policy.
ALTER TABLE "ComercialFicha" ADD COLUMN "tipoDePessoa" TEXT;
ALTER TABLE "ComercialFicha" ADD COLUMN "preferenciasDeAtendimento" TEXT;
ALTER TABLE "ComercialFicha" ADD COLUMN "linkDaProposta" TEXT;
