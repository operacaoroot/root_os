-- Produção 22B, I3 (22/10/2026): a pasta Clientes sai do Trabalho ("a pasta cliente sai sim").
-- A pasta e as listas dela (Esteira de clientes, Onboarding de cliente, Execução) continuam
-- existindo e continuam sendo a fonte de Comercial > Implantação; só deixam de aparecer na
-- árvore do Trabalho, em Todas, nos contadores e no Dia a dia. A marca é uma coluna, e não o
-- nome, para a regra não depender de ninguém renomear nada: `doComercial`.
--
-- Aditiva: duas colunas booleanas com padrão falso (nenhuma linha muda de sentido) e dois
-- UPDATE idempotentes. As tabelas já têm RLS FORCE e as políticas valem para as colunas.

ALTER TABLE "WorkFolder" ADD COLUMN IF NOT EXISTS "doComercial" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WorkList" ADD COLUMN IF NOT EXISTS "doComercial" BOOLEAN NOT NULL DEFAULT false;

-- A pasta de topo chamada Clientes, sem diferença de maiúscula, acento nem espaço sobrando
-- (a mesma régua de `chaveDoNomeDoTrabalho`), QUE GUARDA a lista da implantação ("Onboarding
-- de cliente", a mesma régua). Revisão M2: só o nome pegaria a pasta Clientes que uma empresa
-- cliente criou à mão para o trabalho dela, e as tarefas sumiriam do Dia a dia e de Todas.
-- Arquivada ou não: se um dia for desarquivada, volta como do Comercial.
UPDATE "WorkFolder" AS f
   SET "doComercial" = true
 WHERE f."parentId" IS NULL
   AND f."doComercial" = false
   AND translate(lower(regexp_replace(btrim(f."name"), '\s+', ' ', 'g')),
                 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') = 'clientes'
   AND EXISTS (
     SELECT 1 FROM "WorkList" AS l
      WHERE l."folderId" = f."id"
        AND l."orgId" = f."orgId"
        AND translate(lower(regexp_replace(btrim(l."name"), '\s+', ' ', 'g')),
                      'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') = 'onboarding de cliente'
   );

-- As listas que estão dentro dela (vivas ou arquivadas), da mesma empresa.
UPDATE "WorkList" AS l
   SET "doComercial" = true
  FROM "WorkFolder" AS f
 WHERE l."folderId" = f."id"
   AND l."orgId" = f."orgId"
   AND f."doComercial" = true
   AND l."doComercial" = false;
