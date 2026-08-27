/**
 * Suíte de isolamento entre tenants — marketing-os
 * ================================================
 *
 * O QUE ELA FAZ
 * Semeia DUAS orgs (A e B) com dado paralelo em TODAS as tabelas de tenant,
 * abre uma sessão de banco escopada na org A e roda `SELECT` SEM cláusula WHERE
 * em cada tabela. Se aparecer uma única linha da org B, a tabela vazou e o teste
 * falha dizendo qual é, quantas linhas e por quê.
 *
 * O ponto é medir o isolamento NO BANCO, não na aplicação. Hoje o marketing-os
 * filtra por `where: { orgId }` escrito à mão em cada call site
 * (apps/api/src/prisma/prisma.service.ts é um PrismaClient pelado de 9 linhas,
 * sem middleware e sem $extends). Isso é disciplina, não garantia: uma rota nova
 * que esqueça o orgId, ou um $queryRawUnsafe mal escrito, expõe todos os tenants.
 * Esta suíte só fica verde quando o Postgres — e não o TypeScript — recusa a
 * leitura cruzada.
 *
 * ESTADO ESPERADO HOJE: VERMELHA.
 * Zero tabelas com RLS no banco de produção. Rodar isto agora deve falhar em
 * praticamente todas as tabelas. É o esperado — a suíte é o critério de aceite
 * da ativação de RLS, e vai ficando verde tabela por tabela conforme as policies
 * entram. Não "conserte" a suíte relaxando asserção.
 *
 * COMO RODAR
 *   1) vitest ainda não existe em apps/api. Adicionar:
 *        pnpm --filter @mktos/api add -D vitest
 *      e em apps/api/package.json:
 *        "test:isolamento": "vitest run test/tenant-isolation.test.ts"
 *      (`pg` e `@types/pg` já são devDependencies de @mktos/api.)
 *
 *   2) Variáveis de ambiente:
 *        TEST_DATABASE_URL    conexão ADMIN (dona das tabelas). Semeia e limpa.
 *        TENANT_DATABASE_URL  conexão da APLICAÇÃO (role restrita, sujeita a RLS).
 *                             É ela que faz as leituras. Se faltar, cai na admin
 *                             e a suíte avisa alto que o resultado não vale nada.
 *        TENANT_GUC           nome do parâmetro de sessão. Default: app.org_id
 *        PERMITIR_BANCO_NAO_TESTE=1  destrava rodar fora de um banco de teste.
 *
 *   3) O role de aplicação precisa existir e NÃO ser dono das tabelas. Sem isso
 *      o Postgres ignora as policies em silêncio (dono só obedece com FORCE):
 *
 *        CREATE ROLE mktos_app LOGIN PASSWORD '...' NOBYPASSRLS;
 *        GRANT USAGE ON SCHEMA public TO mktos_app;
 *        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mktos_app;
 *        -- e em cada tabela de tenant:
 *        ALTER TABLE "Lead" ENABLE ROW LEVEL SECURITY;
 *        ALTER TABLE "Lead" FORCE ROW LEVEL SECURITY;
 *
 * AVISO: a suíte ESCREVE no banco. Nunca aponte para produção.
 */

import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Configuração e trava de segurança
// ---------------------------------------------------------------------------

const URL_ADMIN = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
const URL_TENANT = process.env.TENANT_DATABASE_URL ?? URL_ADMIN;
const GUC = process.env.TENANT_GUC ?? 'app.org_id';

if (!URL_ADMIN) {
  throw new Error('TEST_DATABASE_URL (ou DATABASE_URL) não definida. A suíte escreve no banco — aponte para um banco de teste.');
}

// A suíte cria e apaga linhas. Recusa rodar num banco que não se anuncia como
// de teste, a menos que o operador destrave explicitamente.
const NOME_BANCO = (() => {
  try {
    return new URL(URL_ADMIN).pathname.replace(/^\//, '');
  } catch {
    return '';
  }
})();
const PARECE_TESTE = /test|dev|local|staging|shadow/i.test(NOME_BANCO);
if (!PARECE_TESTE && process.env.PERMITIR_BANCO_NAO_TESTE !== '1') {
  throw new Error(
    `Banco "${NOME_BANCO}" não parece de teste e a suíte ESCREVE nele. ` +
      'Aponte TEST_DATABASE_URL para um banco descartável ou defina PERMITIR_BANCO_NAO_TESTE=1 conscientemente.',
  );
}

const MESMA_CONEXAO = URL_TENANT === URL_ADMIN;

// Marca única da rodada. Todo dado semeado carrega isto, e a limpeza no fim
// remove exatamente estas linhas — nunca um DELETE amplo.
const MARCA = `iso_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const admin = new Pool({ connectionString: URL_ADMIN, max: 4 });
const tenant = new Pool({ connectionString: URL_TENANT, max: 4 });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Abre transação, escopa a sessão na org e desfaz tudo no fim. */
async function comoTenant<T>(orgId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await tenant.connect();
  try {
    await c.query('BEGIN');
    // set_config(..., true) = SET LOCAL parametrizado. `SET LOCAL x = $1` não
    // aceita parâmetro; é exatamente a pegadinha que derruba RLS feito às pressas.
    await c.query('SELECT set_config($1, $2, true)', [GUC, orgId]);
    return await fn(c);
  } finally {
    await c.query('ROLLBACK').catch(() => undefined);
    c.release();
  }
}

/** INSERT genérico. Parâmetros vão sem tipo e o Postgres coage para a coluna. */
async function ins(
  c: PoolClient,
  tabela: string,
  dados: Record<string, unknown>,
  casts: Record<string, string> = {},
): Promise<string> {
  const cols = Object.keys(dados);
  const vals = cols.map((k, i) => (casts[k] ? `$${i + 1}::${casts[k]}` : `$${i + 1}`));
  const sql =
    `INSERT INTO "${tabela}" (${cols.map((k) => `"${k}"`).join(', ')}) ` +
    `VALUES (${vals.join(', ')}) RETURNING "id"`;
  const r = await c.query(sql, Object.values(dados));
  return r.rows[0].id as string;
}

/** Vetor de 1536 dimensões, esparso e determinístico (sem chamar a OpenAI). */
function vetor(posicoes: Record<number, number>): string {
  const v = new Array(1536).fill(0);
  for (const [i, x] of Object.entries(posicoes)) v[Number(i)] = x;
  return `[${v.join(',')}]`;
}

// Vetores desenhados para que a linha da org B seja SEMPRE a vizinha mais
// próxima da consulta. Assim um vazamento não passa por acaso: se a policy
// falhar, o top-1 vem de B e a asserção quebra na hora.
const VEC_A = vetor({ 0: 1, 7: 0.1 });
const VEC_B = vetor({ 1: 1, 7: 0.1 });
const VEC_CONSULTA = vetor({ 0: 0.15, 1: 0.99 }); // muito mais perto de B

// ---------------------------------------------------------------------------
// Registro de alvos — a lista do que precisa estar isolado
// ---------------------------------------------------------------------------

type Escopo = 'tenant' | 'filho' | 'juncao';

interface Alvo {
  tabela: string;
  escopo: Escopo;
  /** Expressão SQL que identifica a linha. Junções não têm id. */
  chaveSql: string;
  /** Por que esta tabela importa — entra na mensagem de falha. */
  nota: string;
}

/**
 * 46 tabelas TENANT (45 modelos com coluna orgId + a própria Org, que se escopa
 * pela PK), 10 modelos FILHO sem orgId e as 3 junções implícitas do Prisma.
 * Fora daqui, de propósito: Permission e BioVisitor (globais por design) e
 * _prisma_migrations (controle do Migrate — ligar RLS nela quebra o boot).
 */
const ALVOS: Alvo[] = [
  // ---- raiz -------------------------------------------------------------
  { tabela: 'Org', escopo: 'tenant', chaveSql: '"id"', nota: 'Raiz do tenant. Sem policy por PK, qualquer org lista todas as outras.' },

  // ---- identidade e acesso ---------------------------------------------
  { tabela: 'User', escopo: 'tenant', chaveSql: '"id"', nota: 'Identidade e passwordHash.' },
  { tabela: 'Role', escopo: 'tenant', chaveSql: '"id"', nota: 'Papéis por org.' },
  { tabela: 'AuditLog', escopo: 'tenant', chaveSql: '"id"', nota: 'Concentra before/after das outras 57 tabelas. A mais sensível do banco.' },

  // ---- integrações ------------------------------------------------------
  { tabela: 'IntegrationAccount', escopo: 'tenant', chaveSql: '"id"', nota: 'config Json carrega credencial de integração em claro.' },
  { tabela: 'IntegrationHealth', escopo: 'filho', chaveSql: '"id"', nota: 'Filha 1:1 de IntegrationAccount, sem orgId.' },

  // ---- leads e campanhas ------------------------------------------------
  { tabela: 'LeadSource', escopo: 'tenant', chaveSql: '"id"', nota: 'Catálogo de canais por org.' },
  { tabela: 'Lead', escopo: 'tenant', chaveSql: '"id"', nota: 'PII de terceiro (nome, e-mail, telefone).' },
  { tabela: 'LeadEvent', escopo: 'filho', chaveSql: '"id"', nota: 'Filha de Lead, sem orgId. payload Json guarda histórico de PII.' },
  { tabela: 'Campaign', escopo: 'tenant', chaveSql: '"id"', nota: 'Orçamento e gasto por campanha.' },
  { tabela: 'PixelEvent', escopo: 'tenant', chaveSql: '"id"', nota: 'Ingestão pública resolve a org por slug root fixo em events.controller.ts:24.' },
  { tabela: 'Task', escopo: 'tenant', chaveSql: '"id"', nota: 'Tarefas espelhadas de ClickUp/Asana.' },

  // ---- contas OAuth de terceiro (tokens em texto puro) ------------------
  { tabela: 'GoogleAccount', escopo: 'tenant', chaveSql: '"id"', nota: 'accessToken/refreshToken em texto puro. Prioridade máxima.' },
  { tabela: 'MetaAccount', escopo: 'tenant', chaveSql: '"id"', nota: 'userToken e pageToken em texto puro. Prioridade máxima.' },

  // ---- metas ------------------------------------------------------------
  { tabela: 'GoalConfig', escopo: 'tenant', chaveSql: '"id"', nota: 'Uma linha por org (metas do desafio).' },
  { tabela: 'GoalWeek', escopo: 'tenant', chaveSql: '"id"', nota: 'Métricas semanais.' },

  // ---- conhecimento e conteúdo -----------------------------------------
  { tabela: 'KnowledgeNote', escopo: 'tenant', chaveSql: '"id"', nota: 'Conteúdo do vault + embedding vector(1536). Vaza também por similaridade.' },
  { tabela: 'ContentItem', escopo: 'tenant', chaveSql: '"id"', nota: 'Espelho do ClickUp.' },
  { tabela: 'Report', escopo: 'tenant', chaveSql: '"id"', nota: 'data Json guarda snapshot das métricas do tenant.' },

  // ---- financeiro -------------------------------------------------------
  { tabela: 'BankConnection', escopo: 'tenant', chaveSql: '"id"', nota: 'Conexão Open Finance (Pluggy): externalId do item e config Json.' },
  { tabela: 'FinanceAccount', escopo: 'tenant', chaveSql: '"id"', nota: 'Contas bancárias e saldo de abertura.' },
  { tabela: 'FinanceCategory', escopo: 'tenant', chaveSql: '"id"', nota: 'Plano de contas simples por org.' },
  { tabela: 'FinanceTransaction', escopo: 'tenant', chaveSql: '"id"', nota: 'Núcleo financeiro. 7 FKs — policy protege leitura, não cruzamento de FK.' },
  { tabela: 'TransactionSplit', escopo: 'tenant', chaveSql: '"id"', nota: 'Tem orgId próprio, mas é filha de FinanceTransaction: os dois precisam bater.' },
  { tabela: 'Partner', escopo: 'tenant', chaveSql: '"id"', nota: 'Fornecedor/cliente com cnpjCpf, e-mail e telefone — PII de terceiro.' },
  { tabela: 'Departamento', escopo: 'tenant', chaveSql: '"id"', nota: 'Dimensão de rateio.' },
  { tabela: 'Projeto', escopo: 'tenant', chaveSql: '"id"', nota: 'Dimensão de rateio.' },
  { tabela: 'Contract', escopo: 'tenant', chaveSql: '"id"', nota: 'Contrato recorrente com valor e vencimento.' },
  { tabela: 'ChartAccount', escopo: 'tenant', chaveSql: '"id"', nota: 'Plano de contas hierárquico (auto-relação parentId dentro da org).' },
  { tabela: 'DreLine', escopo: 'tenant', chaveSql: '"id"', nota: 'Template do DRE por org.' },

  // ---- bio --------------------------------------------------------------
  { tabela: 'BioPage', escopo: 'tenant', chaveSql: '"id"', nota: 'Lida sem auth em bio-public.controller.ts:54 — a policy precisa prever leitura pública de publicada=true.' },
  { tabela: 'BioLink', escopo: 'filho', chaveSql: '"id"', nota: 'Filha de BioPage, sem orgId. Resolve o redirect anônimo em bio-public.controller.ts:87.' },
  { tabela: 'BioChallenge', escopo: 'tenant', chaveSql: '"id"', nota: 'Tem orgId E pageId — duplo caminho até a org.' },
  { tabela: 'BioChallengeAccount', escopo: 'filho', chaveSql: '"id"', nota: 'Sem orgId. Liga desafio a BioConexao — sem policy dá para amarrar OAuth de outra org.' },
  { tabela: 'BioChallengePost', escopo: 'filho', chaveSql: '"id"', nota: 'Neta de BioChallenge: a org só é alcançável com 2 saltos.' },
  { tabela: 'BioChallengeSnapshot', escopo: 'filho', chaveSql: '"id"', nota: 'Append-only, mesma distância de 2 saltos até a org.' },
  { tabela: 'BioConexao', escopo: 'tenant', chaveSql: '"id"', nota: 'tokenCifrado/refreshCifrado (AES-256-GCM).' },
  { tabela: 'BioCredencialApp', escopo: 'tenant', chaveSql: '"id"', nota: 'orgId NULLABLE: null = credencial global. Policy tem que ser orgId = atual OR orgId IS NULL.' },
  { tabela: 'BioOauthState', escopo: 'tenant', chaveSql: '"id"', nota: 'Guarda o state do OAuth justamente para impedir costurar conta de uma org na outra.' },
  { tabela: 'BioVisit', escopo: 'tenant', chaveSql: '"id"', nota: 'Escrita pela rota pública sem auth (bio-public.controller.ts:62).' },
  { tabela: 'BioEvent', escopo: 'tenant', chaveSql: '"id"', nota: 'eventId é @unique global de propósito (dedup com PixelEvent). Escrita pública.' },

  // ---- pauta ------------------------------------------------------------
  { tabela: 'PautaFonte', escopo: 'tenant', chaveSql: '"id"', nota: 'Fontes monitoradas + teto de gasto Apify.' },
  { tabela: 'PautaCaptura', escopo: 'tenant', chaveSql: '"id"', nota: 'Dedup já é por org (@@unique([orgId, urlHash])).' },
  { tabela: 'PautaReferencia', escopo: 'tenant', chaveSql: '"id"', nota: 'Ficha do acervo + embedding vector(1536). Mesmo risco de vazamento por similaridade.' },
  { tabela: 'PautaRotina', escopo: 'tenant', chaveSql: '"id"', nota: 'Cron rodado pelo scheduler FORA do request HTTP — não terá app.org_id setado.' },
  { tabela: 'PautaRodada', escopo: 'tenant', chaveSql: '"id"', nota: 'Mesma ressalva de execução por scheduler.' },
  { tabela: 'PautaPeca', escopo: 'tenant', chaveSql: '"id"', nota: 'orgId precisa bater com o da rodada-mãe.' },

  // ---- trabalho ---------------------------------------------------------
  { tabela: 'WorkFolder', escopo: 'tenant', chaveSql: '"id"', nota: 'Topo da hierarquia pastas → listas → tarefas.' },
  { tabela: 'WorkList', escopo: 'tenant', chaveSql: '"id"', nota: 'Pai de WorkStatus, que não tem orgId.' },
  { tabela: 'WorkStatus', escopo: 'filho', chaveSql: '"id"', nota: 'Sem orgId, mas referenciada por WorkTask.statusId, que TEM orgId.' },
  { tabela: 'WorkTag', escopo: 'tenant', chaveSql: '"id"', nota: 'Etiquetas do espaço.' },
  { tabela: 'WorkField', escopo: 'tenant', chaveSql: '"id"', nota: 'Campo personalizado; listId nulo = vale para o espaço todo.' },
  { tabela: 'WorkFieldOption', escopo: 'filho', chaveSql: '"id"', nota: 'Filha de WorkField, sem orgId.' },
  { tabela: 'WorkTask', escopo: 'tenant', chaveSql: '"id"', nota: 'Auto-relação parentId para subtarefas dentro da org.' },
  { tabela: 'WorkFieldValue', escopo: 'filho', chaveSql: '"id"', nota: 'DOIS pais obrigatórios (WorkTask e WorkField) — os dois têm de ser da mesma org.' },
  { tabela: 'WorkComment', escopo: 'filho', chaveSql: '"id"', nota: 'Texto livre e authorName. Conteúdo de tenant sem barreira nenhuma hoje.' },

  // ---- junções implícitas do Prisma (não têm id) ------------------------
  { tabela: '_UserRoles', escopo: 'juncao', chaveSql: `"A" || '|' || "B"`, nota: 'A=Role.id, B=User.id. Sem policy dá para conceder Role de outra org — escalação cross-tenant.' },
  { tabela: '_RolePermissions', escopo: 'juncao', chaveSql: `"A" || '|' || "B"`, nota: 'A=Permission.id (GLOBAL), B=Role.id (TENANT). A policy vai em B, nunca em A.' },
  { tabela: '_WorkTaskTags', escopo: 'juncao', chaveSql: `"A" || '|' || "B"`, nota: 'A=WorkTag.id, B=WorkTask.id. Os dois pais têm orgId.' },
];

/** Tabelas GLOBAIS por design: ligar RLS nelas QUEBRA o sistema. */
const GLOBAIS = [
  { tabela: 'Permission', quebra: 'PermissionsGuard para de resolver permissão e todo tenant perde acesso.' },
  { tabela: 'BioVisitor', quebra: 'o mesmo browser visita páginas de orgs diferentes; filtrar deixa o visitante órfão no join de BioVisit/BioEvent.' },
];

// ---------------------------------------------------------------------------
// Semeadura
// ---------------------------------------------------------------------------

interface Semente {
  orgId: string;
  slug: string;
  /** tabela -> chaves inseridas por esta org */
  chaves: Record<string, string[]>;
  /** ids nomeados que os testes específicos precisam */
  ref: Record<string, string>;
}

const sementes: Record<'A' | 'B', Semente> = {
  A: { orgId: '', slug: '', chaves: {}, ref: {} },
  B: { orgId: '', slug: '', chaves: {}, ref: {} },
};

/** Ordem de inserção respeitando as FKs. A limpeza percorre isto ao contrário. */
const ORDEM_LIMPEZA: string[] = [];
function registra(s: Semente, tabela: string, chave: string) {
  (s.chaves[tabela] ??= []).push(chave);
  if (!ORDEM_LIMPEZA.includes(tabela)) ORDEM_LIMPEZA.push(tabela);
}

/** Permission é catálogo GLOBAL — uma só, compartilhada pelas duas orgs. */
let permissaoCompartilhadaId = '';

async function semear(c: PoolClient, rotulo: 'A' | 'B', vec: string): Promise<void> {
  const s = sementes[rotulo];
  const suf = `${MARCA}_${rotulo}`;
  const agora = new Date();
  const reg = (t: string, k: string) => registra(s, t, k);

  // --- Org (a raiz: escopo pela própria PK) --------------------------------
  const orgId = await ins(c, 'Org', { id: crypto.randomUUID(), name: `Org ${rotulo} ${MARCA}`, slug: `${suf}-org` });
  s.orgId = orgId;
  s.slug = `${suf}-org`;
  reg('Org', orgId);

  // --- identidade e acesso -------------------------------------------------
  // email é @unique GLOBAL (schema.prisma:79), não @@unique([orgId, email]):
  // por isso o sufixo por org. Ver o teste "namespaces globais" mais abaixo.
  const userId = await ins(c, 'User', {
    id: crypto.randomUUID(), orgId, name: `Usuário ${rotulo}`,
    email: `${suf}@isolamento.local`, passwordHash: 'nao-e-hash-real', updatedAt: agora,
  });
  reg('User', userId);
  s.ref.userId = userId;

  const roleId = await ins(c, 'Role', { id: crypto.randomUUID(), orgId, key: `papel_${suf}`, name: `Papel ${rotulo}` });
  reg('Role', roleId);
  s.ref.roleId = roleId;

  await c.query('INSERT INTO "_UserRoles" ("A", "B") VALUES ($1, $2)', [roleId, userId]);
  reg('_UserRoles', `${roleId}|${userId}`);

  await c.query('INSERT INTO "_RolePermissions" ("A", "B") VALUES ($1, $2)', [permissaoCompartilhadaId, roleId]);
  reg('_RolePermissions', `${permissaoCompartilhadaId}|${roleId}`);

  const auditId = await ins(c, 'AuditLog', {
    id: crypto.randomUUID(), orgId, actorType: 'user', actorId: userId,
    action: `isolamento.semente.${rotulo}`, entityType: 'lead', entityId: crypto.randomUUID(),
    before: JSON.stringify({ segredo: `antes-${suf}` }), after: JSON.stringify({ segredo: `depois-${suf}` }),
  });
  reg('AuditLog', auditId);
  s.ref.auditId = auditId;

  // --- integrações ---------------------------------------------------------
  const integId = await ins(c, 'IntegrationAccount', {
    id: crypto.randomUUID(), orgId, key: `clickup_${suf}`, label: `ClickUp ${rotulo}`,
    status: 'connected', config: JSON.stringify({ token: `token-secreto-${suf}` }),
  });
  reg('IntegrationAccount', integId);

  reg('IntegrationHealth', await ins(c, 'IntegrationHealth', {
    id: crypto.randomUUID(), accountId: integId, status: 'ok', latencyMs: 120,
  }));

  // --- leads e campanhas ---------------------------------------------------
  const sourceId = await ins(c, 'LeadSource', { id: crypto.randomUUID(), orgId, key: `origem_${suf}`, name: 'Instagram', channel: 'social' });
  reg('LeadSource', sourceId);

  const campId = await ins(c, 'Campaign', {
    id: crypto.randomUUID(), orgId, name: `Campanha ${rotulo} ${MARCA}`, objective: 'leads',
    channel: 'meta', budget: '5000.00', spend: '1234.56', status: 'ativa',
  });
  reg('Campaign', campId);

  const leadId = await ins(c, 'Lead', {
    id: crypto.randomUUID(), orgId, name: `Lead ${rotulo} ${MARCA}`,
    email: `lead-${suf}@exemplo.com`, phone: '+5511999990000', sourceId, campaignId: campId,
    status: 'novo', ownerId: userId, updatedAt: agora,
  });
  reg('Lead', leadId);
  s.ref.leadId = leadId;

  reg('LeadEvent', await ins(c, 'LeadEvent', {
    id: crypto.randomUUID(), leadId, type: 'formulario',
    payload: JSON.stringify({ cpf: `000.000.000-${rotulo === 'A' ? '01' : '02'}` }),
  }));

  reg('PixelEvent', await ins(c, 'PixelEvent', {
    id: crypto.randomUUID(), orgId, eventId: `evt_${suf}`, sessionId: `sess_${suf}`,
    anonymousId: `anon_${suf}`, eventName: 'page_view', url: `https://${suf}.exemplo.com/`,
  }));

  reg('Task', await ins(c, 'Task', {
    id: crypto.randomUUID(), orgId, tool: 'clickup', externalId: `tk_${suf}`,
    title: `Tarefa ${rotulo} ${MARCA}`, status: 'aberta', tags: ['isolamento'], updatedAt: agora,
  }, { tags: 'text[]' }));

  // --- contas OAuth (tokens em texto puro) --------------------------------
  reg('GoogleAccount', await ins(c, 'GoogleAccount', {
    id: crypto.randomUUID(), orgId, email: `google-${suf}@exemplo.com`,
    accessToken: `ya29.TOKEN_EM_CLARO_${suf}`, refreshToken: `1//REFRESH_${suf}`,
    expiresAt: new Date(Date.now() + 3600_000), updatedAt: agora,
  }));

  reg('MetaAccount', await ins(c, 'MetaAccount', {
    id: crypto.randomUUID(), orgId, userToken: `EAAG_USER_${suf}`, pageId: `pg_${suf}`,
    pageName: `Página ${rotulo}`, pageToken: `EAAG_PAGE_${suf}`,
    expiresAt: new Date(Date.now() + 86_400_000), updatedAt: agora,
  }));

  // --- metas ---------------------------------------------------------------
  reg('GoalConfig', await ins(c, 'GoalConfig', {
    id: crypto.randomUUID(), orgId, challengeStart: new Date('2026-01-01T00:00:00Z'), updatedAt: agora,
  }));

  reg('GoalWeek', await ins(c, 'GoalWeek', {
    id: crypto.randomUUID(), orgId, weekNumber: 1, posts: 7, views: 10_000, updatedAt: agora,
  }));

  // --- conhecimento (com embedding: alvo da busca vetorial) ---------------
  const notaId = await ins(c, 'KnowledgeNote', {
    id: crypto.randomUUID(), orgId, path: `notas/${suf}.md`, folder: 'notas',
    title: `Estratégia confidencial ${rotulo}`, tags: ['estrategia'],
    content: `Conteúdo secreto da org ${rotulo} (${MARCA}). Nunca deve aparecer para o outro tenant.`,
    links: [], wordCount: 18, fileTime: agora, embedding: vec,
  }, { tags: 'text[]', links: 'text[]' });
  reg('KnowledgeNote', notaId);
  s.ref.notaId = notaId;

  reg('ContentItem', await ins(c, 'ContentItem', {
    id: crypto.randomUUID(), orgId, source: 'clickup', externalId: `ci_${suf}`,
    title: `Pauta ${rotulo} ${MARCA}`, status: 'escrever roteiro', statusType: 'custom',
  }));

  reg('Report', await ins(c, 'Report', {
    id: crypto.randomUUID(), orgId, type: 'daily', title: `Resumo ${rotulo}`,
    summary: `Números fechados da org ${rotulo}.`,
    data: JSON.stringify({ receita: rotulo === 'A' ? 111111 : 222222 }),
    provider: 'anthropic', model: 'claude', periodStart: agora, periodEnd: agora,
  }));

  // --- financeiro ----------------------------------------------------------
  const connId = await ins(c, 'BankConnection', {
    id: crypto.randomUUID(), orgId, provider: 'pluggy', externalId: `item_${suf}`,
    institutionName: 'Banco Teste', status: 'connected',
    config: JSON.stringify({ itemId: `item_${suf}` }), updatedAt: agora,
  });
  reg('BankConnection', connId);
  s.ref.bankConnectionId = connId;

  const contaId = await ins(c, 'FinanceAccount', {
    id: crypto.randomUUID(), orgId, name: `Conta ${rotulo} ${MARCA}`, type: 'corrente',
    institution: 'Banco Teste', openingBalance: '10000.00', provider: 'pluggy',
    connectionId: connId, updatedAt: agora,
  });
  reg('FinanceAccount', contaId);
  s.ref.financeAccountId = contaId;

  const catId = await ins(c, 'FinanceCategory', { id: crypto.randomUUID(), orgId, name: `Serviços ${rotulo}`, kind: 'despesa' });
  reg('FinanceCategory', catId);

  const dreId = await ins(c, 'DreLine', { id: crypto.randomUUID(), orgId, codigo: 'FB', nome: 'Faturamento Bruto', operador: '(+)', tipo: 'origem', ordem: 1 });
  reg('DreLine', dreId);

  const planoId = await ins(c, 'ChartAccount', {
    id: crypto.randomUUID(), orgId, codigo: '3.1.01', nome: `Receita ${rotulo}`, tipo: 'receita',
    nivel: 3, permiteLancamento: true, dreLineId: dreId, updatedAt: agora,
  });
  reg('ChartAccount', planoId);

  const partnerId = await ins(c, 'Partner', {
    id: crypto.randomUUID(), orgId, isCliente: true, razaoSocial: `Cliente ${rotulo} LTDA`,
    cnpjCpf: rotulo === 'A' ? '11.111.111/0001-11' : '22.222.222/0001-22',
    email: `financeiro-${suf}@exemplo.com`, phone: '+5511888880000', updatedAt: agora,
  });
  reg('Partner', partnerId);

  const depId = await ins(c, 'Departamento', { id: crypto.randomUUID(), orgId, nome: `Marketing ${rotulo}` });
  reg('Departamento', depId);

  const projId = await ins(c, 'Projeto', { id: crypto.randomUUID(), orgId, nome: `Projeto ${rotulo}` });
  reg('Projeto', projId);

  const contratoId = await ins(c, 'Contract', {
    id: crypto.randomUUID(), orgId, tipo: 'entrada', partnerId, descricao: `Mensalidade ${rotulo}`,
    valor: '3500.00', diaVencimento: 10, periodicidade: 'mensal', accountId: contaId,
    chartAccountId: planoId, dataInicio: agora, proximoVencimento: agora, status: 'ativo', updatedAt: agora,
  });
  reg('Contract', contratoId);

  const lancId = await ins(c, 'FinanceTransaction', {
    id: crypto.randomUUID(), orgId, accountId: contaId, categoryId: catId, type: 'entrada',
    status: 'realizado', description: `Recebimento ${rotulo} ${MARCA}`, amount: '3500.00',
    date: agora, counterparty: `Cliente ${rotulo}`, chartAccountId: planoId, partnerId,
    contractId: contratoId, departamentoId: depId, projetoId: projId, updatedAt: agora,
  });
  reg('FinanceTransaction', lancId);
  s.ref.lancamentoId = lancId;

  reg('TransactionSplit', await ins(c, 'TransactionSplit', {
    id: crypto.randomUUID(), orgId, transactionId: lancId, chartAccountId: planoId,
    departamentoId: depId, projetoId: projId, percentual: '100.00', valor: '3500.00',
  }));

  // --- bio -----------------------------------------------------------------
  // handle é @unique GLOBAL (schema.prisma:817) — intencional, é a URL pública.
  const bioHandle = `${suf}-bio`;
  const pageId = await ins(c, 'BioPage', {
    id: crypto.randomUUID(), orgId, handle: bioHandle, titulo: `Bio ${rotulo}`,
    subtitulo: 'teste de isolamento', publicada: true, atualizadaEm: agora,
  });
  reg('BioPage', pageId);
  s.ref.bioPageId = pageId;
  s.ref.bioHandle = bioHandle;

  reg('BioLink', await ins(c, 'BioLink', {
    id: crypto.randomUUID(), pageId, ordem: 1, tipo: 'url',
    rotulo: `Link ${rotulo}`, destino: `https://${suf}.exemplo.com`, ativo: true,
  }));

  const conexaoId = await ins(c, 'BioConexao', {
    id: crypto.randomUUID(), orgId, plataforma: 'instagram', externalId: `ig_${suf}`,
    handle: `@${suf}`, tokenCifrado: `CIFRADO_${suf}`, refreshCifrado: `REFRESH_${suf}`,
    status: 'ok', atualizadaEm: agora,
  });
  reg('BioConexao', conexaoId);

  const desafioId = await ins(c, 'BioChallenge', {
    id: crypto.randomUUID(), orgId, pageId, titulo: `Desafio ${rotulo}`,
    inicio: agora, fim: new Date(Date.now() + 86_400_000 * 30), metaPosts: 100,
  });
  reg('BioChallenge', desafioId);

  const contaDesafioId = await ins(c, 'BioChallengeAccount', {
    id: crypto.randomUUID(), challengeId: desafioId, plataforma: 'instagram',
    handle: `@${suf}`, modo: 'conectado', conexaoId, status: 'ok',
  });
  reg('BioChallengeAccount', contaDesafioId);

  reg('BioChallengePost', await ins(c, 'BioChallengePost', {
    id: crypto.randomUUID(), contaId: contaDesafioId, externalId: `post_${suf}`, publicadoEm: agora,
  }));

  reg('BioChallengeSnapshot', await ins(c, 'BioChallengeSnapshot', {
    id: crypto.randomUUID(), contaId: contaDesafioId, totalCount: 42, ok: true,
  }));

  reg('BioCredencialApp', await ins(c, 'BioCredencialApp', {
    id: crypto.randomUUID(), plataforma: 'instagram', orgId, appId: `app_${suf}`,
    segredoCifrado: `SEGREDO_${suf}`, atualizadaEm: agora,
  }));

  reg('BioOauthState', await ins(c, 'BioOauthState', {
    id: crypto.randomUUID(), estado: `state_${suf}`, orgId, plataforma: 'instagram',
    verifier: `pkce_${suf}`, expiraEm: new Date(Date.now() + 600_000),
  }));

  // BioVisitor é GLOBAL por design (identidade de cookie, cross-tenant).
  const visitorId = `visitor_${suf}`;
  await c.query('INSERT INTO "BioVisitor" ("id") VALUES ($1) ON CONFLICT DO NOTHING', [visitorId]);
  reg('BioVisitor', visitorId);

  const visitId = await ins(c, 'BioVisit', {
    id: crypto.randomUUID(), orgId, visitorId, pageId, referrer: 'https://instagram.com',
    device: 'mobile', os: 'iOS', browser: 'Safari',
  });
  reg('BioVisit', visitId);

  reg('BioEvent', await ins(c, 'BioEvent', {
    id: crypto.randomUUID(), eventId: `bioevt_${suf}`, orgId, pageId, visitId,
    visitorId, nome: 'click', url: `https://${suf}.exemplo.com`,
  }));

  // --- pauta (com embedding: segundo alvo da busca vetorial) --------------
  const fonteId = await ins(c, 'PautaFonte', {
    id: crypto.randomUUID(), orgId, tipo: 'rss', nome: `Fonte ${rotulo}`,
    url: `https://${suf}.exemplo.com/feed`, ativo: true,
  });
  reg('PautaFonte', fonteId);

  const capturaId = await ins(c, 'PautaCaptura', {
    id: crypto.randomUUID(), orgId, fonteId, tipo: 'link', url: `https://${suf}.exemplo.com/post`,
    urlHash: `hash_${suf}`, titulo: `Captura ${rotulo}`, imagens: [], status: 'ficha',
  }, { imagens: 'text[]' });
  reg('PautaCaptura', capturaId);

  const refId = await ins(c, 'PautaReferencia', {
    id: crypto.randomUUID(), orgId, capturaId, titulo: `Ficha campeã ${rotulo} ${MARCA}`,
    plataforma: 'instagram', autor: `@${suf}`, familia: 'CUR', objetivo: 'ALC',
    materiaPrima: `Matéria-prima exclusiva da org ${rotulo}`, tensaoCentral: 'tensão',
    emocaoAlvo: 'curiosidade', motorPsicologico: 'lacuna de informação',
    formulaHeadline: 'O que ninguém te conta sobre X', estruturaCorpo: 'gancho > virada > prova',
    prova: 'print de resultado', tags: ['campea'], campea: true, origem: 'teste',
    atualizadaEm: agora, embedding: vec,
  }, { tags: 'text[]' });
  reg('PautaReferencia', refId);
  s.ref.referenciaId = refId;

  const rotinaId = await ins(c, 'PautaRotina', {
    id: crypto.randomUUID(), orgId, slug: `rotina_${suf}`, nome: `Rotina ${rotulo}`,
    cron: '0 8 * * 1', tz: 'America/Sao_Paulo', ativo: true,
  });
  reg('PautaRotina', rotinaId);

  const rodadaId = await ins(c, 'PautaRodada', {
    id: crypto.randomUUID(), orgId, rotinaId, status: 'curada', titulo: `Rodada ${rotulo}`,
    janelaIni: agora, janelaFim: agora, fichasUsadas: [refId], corpo: `Corpo da rodada ${rotulo}`,
  }, { fichasUsadas: 'text[]' });
  reg('PautaRodada', rodadaId);

  reg('PautaPeca', await ins(c, 'PautaPeca', {
    id: crypto.randomUUID(), orgId, rodadaId, canal: 'whatsapp', formato: 'texto',
    titulo: `Peça ${rotulo}`, corpo: `Texto que vai para o grupo da org ${rotulo}`, status: 'rascunho',
  }));

  // --- trabalho ------------------------------------------------------------
  const pastaId = await ins(c, 'WorkFolder', { id: crypto.randomUUID(), orgId, name: `Pasta ${rotulo} ${MARCA}`, updatedAt: agora });
  reg('WorkFolder', pastaId);

  const listaId = await ins(c, 'WorkList', {
    id: crypto.randomUUID(), orgId, folderId: pastaId, name: `Lista ${rotulo} ${MARCA}`, updatedAt: agora,
  });
  reg('WorkList', listaId);

  const statusId = await ins(c, 'WorkStatus', { id: crypto.randomUUID(), listId: listaId, name: 'aberto', type: 'open' });
  reg('WorkStatus', statusId);

  const tagId = await ins(c, 'WorkTag', { id: crypto.randomUUID(), orgId, name: `etiqueta ${rotulo} ${MARCA}` });
  reg('WorkTag', tagId);

  const campoId = await ins(c, 'WorkField', { id: crypto.randomUUID(), orgId, listId: listaId, name: `Eixo ${rotulo}`, type: 'drop_down' });
  reg('WorkField', campoId);

  const opcaoId = await ins(c, 'WorkFieldOption', { id: crypto.randomUUID(), fieldId: campoId, name: `Opção ${rotulo}` });
  reg('WorkFieldOption', opcaoId);

  const tarefaId = await ins(c, 'WorkTask', {
    id: crypto.randomUUID(), orgId, listId: listaId, statusId, title: `Tarefa ${rotulo} ${MARCA}`,
    description: `Descrição interna da org ${rotulo}`, priority: 'normal', externalId: `wt_${suf}`, updatedAt: agora,
  });
  reg('WorkTask', tarefaId);
  s.ref.workTaskId = tarefaId;

  reg('WorkFieldValue', await ins(c, 'WorkFieldValue', {
    id: crypto.randomUUID(), taskId: tarefaId, fieldId: campoId, optionId: opcaoId,
  }));

  reg('WorkComment', await ins(c, 'WorkComment', {
    id: crypto.randomUUID(), taskId: tarefaId, authorId: userId,
    authorName: `Usuário ${rotulo}`, text: `Comentário privado da org ${rotulo}`,
  }));

  await c.query('INSERT INTO "_WorkTaskTags" ("A", "B") VALUES ($1, $2)', [tagId, tarefaId]);
  reg('_WorkTaskTags', `${tagId}|${tarefaId}`);
}

// ---------------------------------------------------------------------------
// Diagnóstico — é o que torna a falha legível
// ---------------------------------------------------------------------------

interface EstadoRls {
  rls: boolean;
  force: boolean;
  dono: string;
}

const estadoRls = new Map<string, EstadoRls>();
let usuarioTenant = '';
let tenantBypassaRls = false;
const vazamentos: Array<{ tabela: string; direcao: string; linhas: number }> = [];

async function carregarDiagnostico(): Promise<void> {
  const r = await admin.query<{ tabela: string; rls: boolean; force: boolean; dono: string }>(
    `SELECT c.relname AS tabela,
            c.relrowsecurity AS rls,
            c.relforcerowsecurity AS force,
            pg_get_userbyid(c.relowner) AS dono
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'`,
  );
  for (const row of r.rows) estadoRls.set(row.tabela, { rls: row.rls, force: row.force, dono: row.dono });

  const c = await tenant.connect();
  try {
    const u = await c.query<{ usuario: string; bypass: boolean }>(
      'SELECT current_user AS usuario, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass',
    );
    usuarioTenant = u.rows[0].usuario;
    tenantBypassaRls = Boolean(u.rows[0].bypass);
  } finally {
    c.release();
  }
}

/** Explica, em uma linha, por que aquela tabela não está protegida. */
function porQue(tabela: string): string {
  const e = estadoRls.get(tabela);
  if (!e) return `tabela "${tabela}" não encontrada em pg_class (nome mudou?)`;
  const causas: string[] = [];
  if (!e.rls) causas.push('RLS DESLIGADA (falta ALTER TABLE ... ENABLE ROW LEVEL SECURITY)');
  if (e.rls && !e.force && e.dono === usuarioTenant) {
    causas.push(`a conexão de leitura ("${usuarioTenant}") é DONA da tabela e o dono ignora policy sem FORCE ROW LEVEL SECURITY`);
  }
  if (tenantBypassaRls) causas.push(`o role "${usuarioTenant}" tem BYPASSRLS — nenhuma policy vale para ele`);
  if (MESMA_CONEXAO) causas.push('TENANT_DATABASE_URL não foi definida: a leitura está usando a conexão ADMIN');
  if (!causas.length) causas.push('RLS ligada e forçada, mas a policy desta tabela não filtra por org (revise a expressão USING)');
  return causas.join('; ');
}

function mensagemDeVazamento(alvo: Alvo, direcao: string, invasoras: string[]): string {
  return [
    '',
    `VAZAMENTO CROSS-TENANT em "${alvo.tabela}" (${alvo.escopo})`,
    `  Direção .....: ${direcao}`,
    `  Linhas vazadas: ${invasoras.length}`,
    `  Chaves ......: ${invasoras.slice(0, 3).join(', ')}${invasoras.length > 3 ? ` (+${invasoras.length - 3})` : ''}`,
    `  Por quê .....: ${porQue(alvo.tabela)}`,
    `  Contexto ....: ${alvo.nota}`,
    `  GUC de sessão: ${GUC}`,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await carregarDiagnostico();

  if (MESMA_CONEXAO) {
    console.warn(
      '\n[isolamento] TENANT_DATABASE_URL não definida: a leitura vai usar a MESMA conexão da semeadura.\n' +
        '            Se essa conexão for dona das tabelas, o Postgres ignora as policies e a suíte\n' +
        '            não mede nada. Crie um role de aplicação restrito antes de confiar no verde.\n',
    );
  }
  if (tenantBypassaRls) {
    console.warn(`\n[isolamento] O role "${usuarioTenant}" tem BYPASSRLS. Nenhuma policy se aplica a ele.\n`);
  }

  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    // Permission é catálogo GLOBAL: uma única linha serve às duas orgs. É o que
    // permite testar _RolePermissions pela coluna B (Role) e não pela A.
    permissaoCompartilhadaId = await ins(c, 'Permission', { id: crypto.randomUUID(), key: `iso.${MARCA}` });
    ORDEM_LIMPEZA.push('Permission');

    await semear(c, 'A', VEC_A);
    await semear(c, 'B', VEC_B);

    // Credencial GLOBAL (orgId NULL) — exceção consciente do schema:949-950.
    // Precisa continuar visível para os DOIS tenants depois da RLS.
    const credGlobalId = await ins(c, 'BioCredencialApp', {
      id: crypto.randomUUID(), plataforma: 'tiktok', orgId: null,
      appId: `app_global_${MARCA}`, segredoCifrado: `SEGREDO_GLOBAL_${MARCA}`, atualizadaEm: new Date(),
    });
    sementes.A.ref.credencialGlobalId = credGlobalId;
    sementes.B.ref.credencialGlobalId = credGlobalId;
    registra(sementes.A, 'BioCredencialApp', credGlobalId);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}, 120_000);

afterAll(async () => {
  // Limpeza cirúrgica: só as chaves que esta rodada criou, na ordem inversa da
  // inserção. Nunca um DELETE por prefixo, nunca um TRUNCATE.
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    for (const tabela of [...ORDEM_LIMPEZA].reverse()) {
      const chaves = [...(sementes.A.chaves[tabela] ?? []), ...(sementes.B.chaves[tabela] ?? [])];
      if (tabela === 'Permission') {
        await c.query('DELETE FROM "Permission" WHERE "id" = $1', [permissaoCompartilhadaId]);
        continue;
      }
      if (!chaves.length) continue;
      if (tabela.startsWith('_')) {
        for (const k of chaves) {
          const [a, b] = k.split('|');
          await c.query(`DELETE FROM "${tabela}" WHERE "A" = $1 AND "B" = $2`, [a, b]);
        }
      } else {
        await c.query(`DELETE FROM "${tabela}" WHERE "id" = ANY($1::text[])`, [chaves]);
      }
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    console.error(`[isolamento] LIMPEZA FALHOU. Rastreie e remova à mão pela marca "${MARCA}".`, e);
    throw e;
  } finally {
    c.release();
  }

  if (vazamentos.length) {
    console.error(
      `\n[isolamento] RESUMO — ${vazamentos.length} vazamento(s):\n` +
        vazamentos.map((v) => `  - ${v.tabela.padEnd(24)} ${v.direcao}  ${v.linhas} linha(s)`).join('\n') +
        '\n',
    );
  }

  await admin.end();
  await tenant.end();
}, 120_000);

// ---------------------------------------------------------------------------
// 1. Diagnóstico do banco (não falha: contextualiza as falhas seguintes)
// ---------------------------------------------------------------------------

describe('diagnóstico do banco', () => {
  it('reporta o estado de RLS das tabelas de tenant', () => {
    const semRls = ALVOS.filter((a) => !estadoRls.get(a.tabela)?.rls).map((a) => a.tabela);
    const semForce = ALVOS.filter((a) => estadoRls.get(a.tabela)?.rls && !estadoRls.get(a.tabela)?.force).map((a) => a.tabela);

    console.info(
      `\n[isolamento] conexão de leitura: "${usuarioTenant}" (bypassrls=${tenantBypassaRls})\n` +
        `[isolamento] alvos: ${ALVOS.length} | sem RLS: ${semRls.length} | com RLS sem FORCE: ${semForce.length}\n` +
        (semRls.length ? `[isolamento] sem RLS: ${semRls.join(', ')}\n` : ''),
    );
    expect(ALVOS.length).toBeGreaterThan(0);
  });

  it('a org A e a org B foram semeadas com dado paralelo', () => {
    expect(sementes.A.orgId).not.toBe('');
    expect(sementes.B.orgId).not.toBe('');
    expect(sementes.A.orgId).not.toBe(sementes.B.orgId);
    // Mesma forma dos dois lados: se uma tabela ficou de fora de uma das orgs,
    // o teste de isolamento dela seria vácuo e passaria à toa.
    const tabelasA = Object.keys(sementes.A.chaves).sort();
    const tabelasB = Object.keys(sementes.B.chaves).sort();
    expect(tabelasA.filter((t) => t !== 'BioCredencialApp')).toEqual(tabelasB.filter((t) => t !== 'BioCredencialApp'));
  });

  it('todo alvo do registro recebeu semente nas duas orgs', () => {
    const orfaos = ALVOS.filter((a) => !(sementes.A.chaves[a.tabela]?.length && sementes.B.chaves[a.tabela]?.length))
      .map((a) => a.tabela);
    expect(orfaos, `Alvos sem semente nas duas orgs (o teste passaria vazio): ${orfaos.join(', ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Isolamento tabela a tabela — o coração da suíte
// ---------------------------------------------------------------------------

describe('isolamento de leitura por tabela', () => {
  it.each(ALVOS.map((a) => [a.tabela, a] as const))(
    'A não lê linha de B em %s',
    async (_nome, alvo) => {
      const chavesDeB = new Set(sementes.B.chaves[alvo.tabela] ?? []);
      // SELECT deliberadamente SEM WHERE: quem tem de filtrar é o banco.
      const visiveis = await comoTenant(sementes.A.orgId, async (c) => {
        const r = await c.query<{ chave: string }>(`SELECT ${alvo.chaveSql} AS chave FROM "${alvo.tabela}"`);
        return r.rows.map((x) => x.chave);
      });
      const invasoras = visiveis.filter((k) => chavesDeB.has(k));
      if (invasoras.length) vazamentos.push({ tabela: alvo.tabela, direcao: 'A ve B', linhas: invasoras.length });
      expect(invasoras, mensagemDeVazamento(alvo, 'org A enxergando linhas da org B', invasoras)).toEqual([]);
    },
    30_000,
  );

  it.each(ALVOS.map((a) => [a.tabela, a] as const))(
    'B não lê linha de A em %s',
    async (_nome, alvo) => {
      const chavesDeA = new Set(sementes.A.chaves[alvo.tabela] ?? []);
      const visiveis = await comoTenant(sementes.B.orgId, async (c) => {
        const r = await c.query<{ chave: string }>(`SELECT ${alvo.chaveSql} AS chave FROM "${alvo.tabela}"`);
        return r.rows.map((x) => x.chave);
      });
      const invasoras = visiveis.filter((k) => chavesDeA.has(k));
      if (invasoras.length) vazamentos.push({ tabela: alvo.tabela, direcao: 'B ve A', linhas: invasoras.length });
      expect(invasoras, mensagemDeVazamento(alvo, 'org B enxergando linhas da org A', invasoras)).toEqual([]);
    },
    30_000,
  );

  it('a org A continua enxergando o PRÓPRIO dado (a policy não pode zerar o tenant)', async () => {
    // Contrapeso: uma policy mal escrita que devolve zero linhas para todo mundo
    // "passaria" nos testes acima. Aqui a suíte cobra o outro lado.
    const cegas: string[] = [];
    for (const alvo of ALVOS) {
      const minhas = new Set(sementes.A.chaves[alvo.tabela] ?? []);
      if (!minhas.size) continue;
      const visiveis = await comoTenant(sementes.A.orgId, async (c) => {
        const r = await c.query<{ chave: string }>(`SELECT ${alvo.chaveSql} AS chave FROM "${alvo.tabela}"`);
        return r.rows.map((x) => x.chave);
      });
      if (!visiveis.some((k) => minhas.has(k))) cegas.push(alvo.tabela);
    }
    expect(
      cegas,
      `\nA org A ficou CEGA para o próprio dado em: ${cegas.join(', ')}\n` +
        'A policy está negando demais (USING restritiva ou app.org_id não chegou na sessão).\n',
    ).toEqual([]);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// 3. Busca vetorial cruzada
// ---------------------------------------------------------------------------

describe('busca vetorial cruzada (pgvector)', () => {
  // As duas únicas colunas vector(1536) do sistema:
  // KnowledgeNote.embedding (schema.prisma:410) e PautaReferencia.embedding (:1187).
  const TABELAS_VETORIAIS = [
    { tabela: 'KnowledgeNote', ref: 'notaId', origem: 'apps/api/src/obsidian/obsidian.service.ts:191-199' },
    { tabela: 'PautaReferencia', ref: 'referenciaId', origem: 'apps/api/src/pauta/pauta.service.ts:531-539' },
  ] as const;

  it.each(TABELAS_VETORIAIS.map((v) => [v.tabela, v] as const))(
    'o KNN sem filtro de org não devolve vizinho de outro tenant em %s',
    async (_nome, alvo) => {
      const idDeB = sementes.B.ref[alvo.ref];
      const idDeA = sementes.A.ref[alvo.ref];

      // Consulta desenhada para que a linha de B seja a vizinha MAIS PRÓXIMA.
      // Sem RLS, o top-1 vem de B: o vazamento é determinístico, não sorte.
      const vizinhos = await comoTenant(sementes.A.orgId, async (c) => {
        const r = await c.query<{ id: string; score: number }>(
          `SELECT id, 1 - (embedding <=> $1::vector) AS score
             FROM "${alvo.tabela}"
            WHERE embedding IS NOT NULL
            ORDER BY embedding <=> $1::vector
            LIMIT 10`,
          [VEC_CONSULTA],
        );
        return r.rows;
      });

      const vazou = vizinhos.some((v) => v.id === idDeB);
      expect(
        vazou,
        '\nVAZAMENTO VETORIAL em ' + alvo.tabela + '\n' +
          `  A org A recebeu a ficha da org B (${idDeB}) como vizinha semântica.\n` +
          `  Top-1 retornado: ${vizinhos[0]?.id ?? '(nada)'} (esperado: ${idDeA})\n` +
          `  Por quê ......: ${porQue(alvo.tabela)}\n` +
          `  Forma da query: mesma de ${alvo.origem}, porém SEM o "orgId" = $2 —\n` +
          '                  é assim que a proteção precisa funcionar quando o filtro\n' +
          '                  não for escrito à mão no SQL.\n',
      ).toBe(false);
    },
    30_000,
  );

  it.each(TABELAS_VETORIAIS.map((v) => [v.tabela, v] as const))(
    'a query real da aplicação (com orgId no WHERE) devolve só o tenant em %s',
    async (_nome, alvo) => {
      // Réplica exata da forma usada hoje em produção. Deve passar ANTES da RLS
      // também — se falhar aqui, o filtro manual quebrou e é incidente imediato.
      const rows = await comoTenant(sementes.A.orgId, async (c) => {
        const r = await c.query<{ id: string }>(
          `SELECT id, 1 - (embedding <=> $1::vector) AS score
             FROM "${alvo.tabela}"
            WHERE "orgId" = $2 AND embedding IS NOT NULL
            ORDER BY embedding <=> $1::vector
            LIMIT 10`,
          [VEC_CONSULTA, sementes.A.orgId],
        );
        return r.rows.map((x) => x.id);
      });
      expect(rows).toContain(sementes.A.ref[alvo.ref]);
      expect(
        rows,
        `O filtro manual "orgId = $2" de ${alvo.origem} parou de isolar. Isto vaza HOJE, em produção.`,
      ).not.toContain(sementes.B.ref[alvo.ref]);
    },
    30_000,
  );

  it('a contagem de indexados não conta embedding de outro tenant', async () => {
    // Espelha obsidian.service.ts:159-162, mas sem o orgId: com RLS, o count
    // tem de cair sozinho para o que é da org.
    // O LIKE recorta só as notas DESTA rodada — o que sobra é o efeito da RLS,
    // não dado preexistente do banco.
    const n = await comoTenant(sementes.A.orgId, async (c) => {
      const r = await c.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM "KnowledgeNote" WHERE embedding IS NOT NULL AND "path" LIKE $1',
        [`notas/${MARCA}%`],
      );
      return Number(r.rows[0].n);
    });
    expect(
      n,
      `\nO count sem filtro de org viu ${n} nota(s) com embedding; só 1 é da org A.\n` +
        `  Por quê: ${porQue('KnowledgeNote')}\n`,
    ).toBe(1);
  }, 30_000);

  it('a fila de reindexação não enxerga ficha pendente de outro tenant', async () => {
    // Espelha pauta.service.ts:680-683. Sem isolamento, o reindex de uma org
    // gera embedding (e custo de OpenAI) para fichas de outra.
    await admin.query('UPDATE "PautaReferencia" SET embedding = NULL WHERE id = $1', [sementes.B.ref.referenciaId]);
    try {
      const pendentes = await comoTenant(sementes.A.orgId, async (c) => {
        const r = await c.query<{ id: string }>('SELECT id FROM "PautaReferencia" WHERE embedding IS NULL LIMIT 500');
        return r.rows.map((x) => x.id);
      });
      expect(
        pendentes,
        `\nA fila de reindexação da org A listou ficha da org B.\n  Por quê: ${porQue('PautaReferencia')}\n`,
      ).not.toContain(sementes.B.ref.referenciaId);
    } finally {
      // Restaura: os testes de KNN acima dependem deste embedding e a suíte não
      // pode depender da ordem de execução.
      await admin.query('UPDATE "PautaReferencia" SET embedding = $1::vector WHERE id = $2', [
        VEC_B,
        sementes.B.ref.referenciaId,
      ]);
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// 4. Escrita cruzada — RLS também precisa barrar UPDATE, DELETE e INSERT
// ---------------------------------------------------------------------------

describe('isolamento de escrita', () => {
  it('A não atualiza lead de B', async () => {
    const afetadas = await comoTenant(sementes.A.orgId, async (c) => {
      const r = await c.query('UPDATE "Lead" SET "name" = $1 WHERE id = $2', [`invadido-${MARCA}`, sementes.B.ref.leadId]);
      return r.rowCount ?? 0;
    });
    expect(
      afetadas,
      `\nA org A alterou ${afetadas} lead(s) da org B.\n  Por quê: ${porQue('Lead')}\n  Falta a policy de UPDATE (USING + WITH CHECK).\n`,
    ).toBe(0);
  }, 30_000);

  it('A não apaga registro de auditoria de B', async () => {
    const afetadas = await comoTenant(sementes.A.orgId, async (c) => {
      const r = await c.query('DELETE FROM "AuditLog" WHERE id = $1', [sementes.B.ref.auditId]);
      return r.rowCount ?? 0;
    });
    expect(
      afetadas,
      `\nA org A apagou ${afetadas} linha(s) do AuditLog da org B.\n  Por quê: ${porQue('AuditLog')}\n` +
        '  O AuditLog deveria ser append-only: policy só de SELECT/INSERT, sem UPDATE/DELETE.\n',
    ).toBe(0);
  }, 30_000);

  it('A não insere linha carimbada com o orgId de B', async () => {
    // WITH CHECK. Sem isso, um tenant grava dentro do outro.
    let aceitou = false;
    await comoTenant(sementes.A.orgId, async (c) => {
      try {
        await c.query(
          'INSERT INTO "Campaign" ("id", "orgId", "name", "status") VALUES ($1, $2, $3, $4)',
          [crypto.randomUUID(), sementes.B.orgId, `plantada-${MARCA}`, 'ativa'],
        );
        aceitou = true;
      } catch {
        aceitou = false;
      }
    }); // o ROLLBACK do helper desfaz caso tenha passado
    expect(
      aceitou,
      `\nA org A conseguiu INSERIR uma campanha dentro da org B.\n  Por quê: ${porQue('Campaign')}\n` +
        '  Falta WITH CHECK ("orgId" = current_setting(...)) na policy de INSERT.\n',
    ).toBe(false);
  }, 30_000);

  it('A não conecta a própria conta financeira a uma conexão bancária de B', async () => {
    // O caso que RLS sozinha NÃO resolve: a FK só valida o id, não a org.
    // Precisa de FK composta (orgId, id) ou trigger de consistência.
    let aceitou = false;
    await comoTenant(sementes.A.orgId, async (c) => {
      try {
        const r = await c.query('UPDATE "FinanceAccount" SET "connectionId" = $1 WHERE id = $2', [
          sementes.B.ref.bankConnectionId,
          sementes.A.ref.financeAccountId,
        ]);
        aceitou = (r.rowCount ?? 0) > 0;
      } catch {
        aceitou = false;
      }
    });
    expect(
      aceitou,
      '\nFK CRUZADA ENTRE ORGS: a conta financeira da org A foi religada a uma BankConnection da org B.\n' +
        '  RLS não cobre isto — a FK valida só o id. Resolver com FK composta ("orgId","id") ou trigger.\n' +
        '  Referência: schema.prisma:534 (FinanceAccount.connectionId).\n',
    ).toBe(false);
  }, 30_000);

  it('A não concede a um usuário próprio um Role da org B', async () => {
    // Escalação de privilégio pela junção implícita _UserRoles.
    let aceitou = false;
    await comoTenant(sementes.A.orgId, async (c) => {
      try {
        await c.query('INSERT INTO "_UserRoles" ("A", "B") VALUES ($1, $2)', [
          sementes.B.ref.roleId,
          sementes.A.ref.userId,
        ]);
        aceitou = true;
      } catch {
        aceitou = false;
      }
    });
    expect(
      aceitou,
      '\nESCALAÇÃO CROSS-TENANT: um usuário da org A recebeu um Role da org B via _UserRoles.\n' +
        '  A junção é implícita (Prisma não aceita orgId nela): ou vira modelo explícito,\n' +
        '  ou a policy usa EXISTS em Role sobre a coluna A.\n',
    ).toBe(false);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// 5. Exceções conscientes — a policy não pode ser restritiva DEMAIS
// ---------------------------------------------------------------------------

describe('exceções que precisam continuar funcionando', () => {
  it.each(GLOBAIS.map((g) => [g.tabela, g] as const))(
    '%s continua legível pelos dois tenants (tabela GLOBAL)',
    async (_nome, g) => {
      const vistoPorA = await comoTenant(sementes.A.orgId, async (c) => {
        const r = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM "${g.tabela}"`);
        return Number(r.rows[0].n);
      });
      expect(
        vistoPorA,
        `\n"${g.tabela}" é GLOBAL por design e ficou invisível para o tenant.\n` +
          `  Consequência: ${g.quebra}\n  Não ligar RLS nesta tabela.\n`,
      ).toBeGreaterThan(0);
    },
    30_000,
  );

  it('BioCredencialApp com orgId NULL (credencial global) fica visível para os dois', async () => {
    // schema.prisma:949-950 documenta a exceção. A policy correta é
    // `orgId = current_org OR orgId IS NULL` no SELECT — e só `orgId = current_org`
    // no INSERT/UPDATE, senão um tenant sobrescreve a credencial de todos.
    const idGlobal = sementes.A.ref.credencialGlobalId;
    for (const rotulo of ['A', 'B'] as const) {
      const visivel = await comoTenant(sementes[rotulo].orgId, async (c) => {
        const r = await c.query<{ id: string }>('SELECT id FROM "BioCredencialApp" WHERE id = $1', [idGlobal]);
        return r.rows.length > 0;
      });
      expect(
        visivel,
        `\nA credencial GLOBAL (orgId NULL) sumiu para a org ${rotulo}.\n` +
          '  A policy de SELECT precisa ser: "orgId" = current_setting(...) OR "orgId" IS NULL\n',
      ).toBe(true);
    }
  }, 30_000);

  it('um tenant não sobrescreve a credencial GLOBAL de todos', async () => {
    const idGlobal = sementes.A.ref.credencialGlobalId;
    const afetadas = await comoTenant(sementes.A.orgId, async (c) => {
      const r = await c.query('UPDATE "BioCredencialApp" SET "segredoCifrado" = $1 WHERE id = $2', [
        `sequestrado-${MARCA}`,
        idGlobal,
      ]);
      return r.rowCount ?? 0;
    });
    expect(
      afetadas,
      '\nA org A sobrescreveu a credencial GLOBAL (orgId NULL) — que serve todos os tenants.\n' +
        '  O WITH CHECK de UPDATE tem de exigir "orgId" = current_setting(...), sem o OR IS NULL.\n',
    ).toBe(0);
  }, 30_000);

  it('a página pública da bio continua legível SEM contexto de org', async () => {
    // bio-public.controller.ts:54 lê BioPage por handle sem auth nenhuma.
    // Se a policy exigir app.org_id, a bio pública morre em produção.
    const c = await tenant.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT set_config($1, $2, true)', [GUC, '']); // sessão anônima
      let achadas = -1;
      let erro = '';
      try {
        const r = await c.query<{ id: string }>(
          'SELECT id FROM "BioPage" WHERE "handle" = $1 AND "publicada" = true',
          [sementes.A.ref.bioHandle],
        );
        achadas = r.rows.length;
      } catch (e) {
        // Caso clássico: a policy faz current_setting('app.org_id')::uuid e o
        // cast de string vazia estoura. A rota pública vira erro 500, não 404.
        erro = (e as Error).message;
      }
      expect(
        erro === '' ? achadas : `ERRO: ${erro}`,
        '\nA bio pública quebrou: sem app.org_id a policy escondeu a BioPage publicada.\n' +
          '  Rotas afetadas: bio-public.controller.ts:54 (página), :62 (tracking), :87 (redirect).\n' +
          '  Saída: policy própria para publicada=true, ou role dedicado com BYPASSRLS para a rota pública.\n',
      ).toBe(1);
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// 6. Namespaces globais — limitações conhecidas do schema
// ---------------------------------------------------------------------------

describe('namespaces únicos compartilhados entre tenants (limitações conhecidas)', () => {
  // Não são bugs de RLS: são @unique globais no schema. Ficam aqui documentados
  // e travados, para que uma mudança de schema apareça como falha e não como
  // surpresa no dia do segundo tenant.
  it.each([
    ['User.email', 'User', 'email', 'schema.prisma:79 — deveria ser @@unique([orgId, email])'],
    ['BioPage.handle', 'BioPage', 'handle', 'schema.prisma:817 — intencional (URL pública), mas o namespace é disputado'],
  ] as const)('%s ainda é único GLOBAL', async (_nome, tabela, coluna, obs) => {
    const valorDeA = await admin.query<Record<string, string>>(
      `SELECT "${coluna}" AS v FROM "${tabela}" WHERE "orgId" = $1 LIMIT 1`,
      [sementes.A.orgId],
    );
    const valor = valorDeA.rows[0].v;

    let rejeitou = false;
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      const base: Record<string, unknown> =
        tabela === 'User'
          ? { id: crypto.randomUUID(), orgId: sementes.B.orgId, name: 'colisao', email: valor, passwordHash: 'x', updatedAt: new Date() }
          : { id: crypto.randomUUID(), orgId: sementes.B.orgId, handle: valor, titulo: 'colisao', atualizadaEm: new Date() };
      await ins(c, tabela, base);
    } catch {
      rejeitou = true;
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
    }

    expect(
      rejeitou,
      `\n${_nome} deixou de ser único global.\n  ${obs}\n` +
        '  Se isso foi intencional, remova este teste. Se não, o schema mudou sem querer.\n',
    ).toBe(true);
  }, 30_000);
});
