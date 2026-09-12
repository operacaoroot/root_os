-- ============================================================================
-- Módulos habilitáveis por empresa — RF-T-06
--
-- `bio`, `pauta`, `financeiro`, `leads` e o resto são produto INTERNO da ROOT.
-- Um tenant cliente não pode ver nem a navegação do que não contratou. Até aqui
-- o `Org` não tinha onde guardar isso: o filtro por módulo existia só no menu
-- do web (`packages/shared/src/nav.ts`), e menu que esconde sem a API recusar é
-- esconderijo com fachada — a rota continua respondendo para quem digitar a URL.
--
-- Esta migration abre a coluna. Quem recusa a rota é o `ModulosInterceptor`
-- (`src/tenants/modulos.interceptor.ts` — interceptor e não guard porque guard
-- global roda ANTES do `JwtAuthGuard`, que é declarado por controller, e veria
-- toda requisição como anônima); quem esconde o item é o `navPorSecao`.
--
-- POR QUE TEXT[] E NÃO ENUM, NEM TABELA DE JUNÇÃO
-- Enum do Postgres viraria uma SEGUNDA lista de módulos, fora do
-- `packages/shared/src/nav.ts` que é a fonte única — e acrescentar módulo
-- passaria a exigir migration de tipo além do código. Tabela de junção só faria
-- sentido se módulo tivesse atributo próprio (data de contratação, limite,
-- preço); hoje não tem, e a junção seria três objetos para guardar um conjunto
-- de no máximo uma dúzia de strings lido a cada requisição.
--
-- VAZIO É "SÓ A ESPINHA", NÃO É "TUDO"
-- Um tenant novo nasce com `{}` e enxerga apenas o que fala do sistema — a
-- central, quem trabalha, o controle, o que existe, a conta. É de propósito:
-- num sistema multiempresa, o default seguro de "o que este cliente pode ver"
-- é NADA, e o provisionamento liga o que foi contratado.
--
-- POR ISSO ESTA MIGRATION PREENCHE QUEM JÁ EXISTIA
-- Se o default valesse também para as linhas atuais, subir esta versão
-- APAGARIA metade do painel de quem já usa o sistema — inclusive o tenant da
-- ROOT, que é onde a operação inteira mora. O `UPDATE` abaixo roda uma vez, no
-- momento em que toda linha de `Org` é, por definição, pré-existente.
--
-- A LISTA ABAIXO É CÓPIA — E É COBRADA COMO CÓPIA
-- SQL não importa TypeScript. Então a lista de módulos aparece aqui uma segunda
-- vez, e a única defesa honesta contra ela divergir é um teste que leia este
-- arquivo: `test/modulos-por-tenant.test.ts` extrai o ARRAY[...] daqui e exige
-- que seja EXATAMENTE o `MODULOS` de `packages/shared/src/nav.ts`. Acrescentou
-- módulo lá e esqueceu aqui? A suíte reprova. (O projeto já pagou por duas
-- listas divergindo: a contagem de ferramentas do MCP dizia 10 quando eram 35.)
--
-- POR QUE NÃO HÁ CHECK CONSTRAINT VALIDANDO AS CHAVES
-- Seria uma TERCEIRA cópia da lista, e a mais cara de mudar: acrescentar módulo
-- passaria a exigir migration. Chave desconhecida gravada aqui não é perigosa —
-- o gate só pergunta "o módulo X está no conjunto?", e um "xyz" sobrando nunca
-- libera rota nenhuma. O que ela seria é LIXO, e é o teste de banco que o acusa
-- ("todo valor gravado em Org.modulos é um módulo conhecido").
-- ============================================================================

-- Fase 1 — a coluna. NOT NULL de propósito: em array, NULL e '{}' significariam
-- a mesma coisa para o Prisma (que lê nulo como lista vazia) e coisas
-- diferentes para qualquer SQL escrito à mão depois — `'bio' = ANY(NULL)` não é
-- falso, é NULL, e um WHERE assim some com a linha em silêncio.
ALTER TABLE "Org"
  ADD COLUMN "modulos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Fase 2 — quem já existia continua vendo tudo o que via ontem.
UPDATE "Org"
SET "modulos" = ARRAY[
  'trabalho',
  'relatorios',
  'leads',
  'campanhas',
  'pixels',
  'conteudo',
  'pauta',
  'instagram',
  'bio',
  'metas',
  'financeiro'
]::TEXT[];
