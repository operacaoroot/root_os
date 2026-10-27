-- Leva 5, L1 (27/10/2026): o Trabalho sem o espelho do ClickUp ("o ClickUp não vai mais ser usado").
-- As listas importadas do ClickUp (Gestão de Temas, Copy, Rotina de stories, Design & Gravação)
-- continuam existindo, com as mesmas tarefas e os mesmos status (a Produção do Marketing lê o
-- status de algumas); só deixam de aparecer em Todas, nas contagens e no Dia a dia, e vão para a
-- pasta "Arquivo do ClickUp" dentro de Marketing, recolhida na árvore. A marca é uma coluna, e
-- não o nome, pelo mesmo motivo de `doComercial` (migration 20261022205000): `arquivoDoClickUp`.
--
-- Aditiva: duas colunas booleanas com padrão falso; nenhuma linha muda de sentido. As tabelas já
-- têm RLS FORCE e as políticas valem para as colunas. Quem cria a pasta, move as listas e marca
-- as colunas é o script `deploy/layout/arquivo-do-clickup.js` (simula por padrão, `--valer`
-- grava, `--desfazer` volta), auditado, e não esta migration: a decisão de quais listas vão é da
-- empresa da casa, não do esquema.

ALTER TABLE "WorkFolder" ADD COLUMN IF NOT EXISTS "arquivoDoClickUp" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WorkList" ADD COLUMN IF NOT EXISTS "arquivoDoClickUp" BOOLEAN NOT NULL DEFAULT false;
