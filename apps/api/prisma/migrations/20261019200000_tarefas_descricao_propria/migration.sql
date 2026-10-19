-- A tarefa passa a ter descrição própria, escrita no OS (19/10/2026).
--
-- A carga do ClickUp de 19/10 gravou na descrição a ORIGEM da tarefa
-- ("ClickUp › <lista>", às vezes seguida de uma anotação nossa). Isso não é
-- descrição: aqui ela fica vazia, e a carga traz a descrição real do ClickUp.
--
-- E, nas 4 tarefas que já existiam na produção (lista "Demandas gerais"), a
-- carga SOBRESCREVEU a descrição que havia. O texto original, tirado do backup
-- de antes da publicação (releases/tarefas-dfa7e35-20261019/banco-antes.dump),
-- volta aqui. Só onde a descrição ainda é a da carga: se alguém já escreveu
-- outra coisa, fica a de quem escreveu.

UPDATE "WorkTask" SET "description" = '_Origem: reunião Semana da Root — 29/09/2026._'
 WHERE "externalId" IN ('17tkhj50ucj', '17tkhj50ubz', '17tkhj50uby') AND "description" LIKE 'ClickUp › %';

UPDATE "WorkTask" SET "description" = E'Verificar a página atual já desenhada pelo Rodrigo como ponto de partida.\n\n_Origem: reunião Semana da Root — 29/09/2026._'
 WHERE "externalId" = '17tkhj50ubx' AND "description" LIKE 'ClickUp › %';

UPDATE "WorkTask" SET "description" = NULL
 WHERE "areaId" IS NOT NULL AND "description" LIKE 'ClickUp › %';
