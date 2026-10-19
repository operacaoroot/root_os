-- Esteira de clientes é cadastro (cada card é um cliente numa etapa), não lista
-- de tarefas. A migration anterior reconhecia a esteira só pelo nome "Esteira de
-- clientes"; uma esteira criada com outro nome (ex.: "Teste teste", na produção)
-- passaria a mostrar os clientes como tarefas. Aqui ela é reconhecida pelas
-- ETAPAS do modelo (MODELOS_DE_LISTA['esteira-de-clientes']): tem "Qualificação"
-- e "Implantação" — nenhuma lista de tarefas usa as duas.
UPDATE "WorkList" l SET "natureza" = 'cadastro'
 WHERE l."natureza" = 'tarefas'
   AND EXISTS (SELECT 1 FROM "WorkStatus" s WHERE s."listId" = l."id" AND s."name" = 'Qualificação')
   AND EXISTS (SELECT 1 FROM "WorkStatus" s WHERE s."listId" = l."id" AND s."name" = 'Implantação');
