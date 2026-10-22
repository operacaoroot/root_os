-- Produção 22B, I1 (22/10/2026): ícone e cor na frente da lista e da pasta do Trabalho.
-- Aditiva: quatro colunas de texto nulas. Nulo = sem ícone, sem cor (a tela fica como antes).
-- A regra do que vale (um emoji curto ou um nome do catálogo de ícones do app; a cor é um
-- dos tokens do tema, lista fechada) mora em `packages/shared/src/aparencia-do-trabalho.ts`;
-- o banco só segura o tamanho. As duas tabelas já têm RLS FORCE (migration do isolamento
-- por linha) e as políticas delas valem para as colunas novas.
ALTER TABLE "WorkFolder" ADD COLUMN IF NOT EXISTS "icone" TEXT;
ALTER TABLE "WorkFolder" ADD COLUMN IF NOT EXISTS "cor" TEXT;
ALTER TABLE "WorkList" ADD COLUMN IF NOT EXISTS "icone" TEXT;
ALTER TABLE "WorkList" ADD COLUMN IF NOT EXISTS "cor" TEXT;

ALTER TABLE "WorkFolder" ADD CONSTRAINT "WorkFolder_icone_tamanho" CHECK ("icone" IS NULL OR char_length("icone") BETWEEN 1 AND 32);
ALTER TABLE "WorkFolder" ADD CONSTRAINT "WorkFolder_cor_tamanho" CHECK ("cor" IS NULL OR char_length("cor") BETWEEN 1 AND 16);
ALTER TABLE "WorkList" ADD CONSTRAINT "WorkList_icone_tamanho" CHECK ("icone" IS NULL OR char_length("icone") BETWEEN 1 AND 32);
ALTER TABLE "WorkList" ADD CONSTRAINT "WorkList_cor_tamanho" CHECK ("cor" IS NULL OR char_length("cor") BETWEEN 1 AND 16);
