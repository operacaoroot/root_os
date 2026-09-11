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
 * O QUE ELA TAMBÉM FAZ, DESDE A FATIA 1.1 (RF-T-01)
 * Antes do isolamento por linha existe um pré-requisito: TODA tabela de tenant
 * precisa ter em que coluna se apoiar. Dez tabelas filhas só alcançavam a
 * empresa pelo pai; hoje carregam `orgId` redundante. As seções 7 e 8 deste
 * arquivo cobrem essa camada NO BANCO — coluna, chave estrangeira, gatilho e o
 * valor efetivamente gravado.
 *
 * O QUE **NÃO** MORA MAIS AQUI
 * A catraca que só lê o `schema.prisma` ("todo modelo tem orgId ou está
 * declarado global", "orgId anulável só onde foi declarado") mudou para
 * `test/modelos-globais.test.ts`. Motivo: este arquivo fica fora do `pnpm test`
 * padrão e roda com `continue-on-error` na integração contínua enquanto o
 * isolamento por linha não estiver ligado — catraca ali acusa e o check fica
 * verde, que é o mesmo que não ter catraca. Lá ela reprova de verdade.
 * Aqui ficou só o que precisa de banco.
 *
 * ESTADO ESPERADO HOJE: VERMELHA.
 * Zero tabelas com RLS no banco de produção. Rodar isto agora deve falhar em
 * praticamente todas as tabelas. É o esperado — a suíte é o critério de aceite
 * da ativação de RLS, e vai ficando verde tabela por tabela conforme as policies
 * entram. Não "conserte" a suíte relaxando asserção.
 * As seções 7 e 8 são a exceção: elas não dependem de RLS e devem estar VERDES
 * desde a migration `20260910120000_orgid_em_todo_filho`.
 *
 * COMO RODAR
 *   1) `pnpm --filter @mktos/api test:isolamento`. Este arquivo fica FORA do
 *      `pnpm test` padrão (ver apps/api/vitest.config.ts): ele lança no import
 *      quando falta banco, então não daria para pular sozinho.
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

import {
  FILHOS_COM_ORGID_REDUNDANTE,
  MODELOS_ESCOPO_OPCIONAL,
  MODELOS_GLOBAIS,
  paisDoFilho,
} from '../src/common/modelos-globais';
import { exigirBancoDescartavel } from './banco-de-teste';

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
// de teste, a menos que o operador destrave explicitamente. A regra mora em
// `banco-de-teste.ts` porque `contexto-aprovacao.test.ts` precisa da MESMA —
// duas cópias de uma trava de segurança é uma trava que um dia diverge.
exigirBancoDescartavel(URL_ADMIN, 'ESCREVE nele');

const MESMA_CONEXAO = URL_TENANT === URL_ADMIN;

// Marca única da rodada. Todo dado semeado carrega isto, e a limpeza no fim
// remove exatamente estas linhas — nunca um DELETE amplo.
const MARCA = `iso_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/** Um único id de cookie, usado pelas DUAS orgs — a premissa de BioVisitor global. */
const VISITANTE_COMPARTILHADO = `visitor_compartilhado_${MARCA}`;

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
 * Tabelas TENANT (modelos com coluna orgId + a própria Org, que se escopa pela
 * PK), as 10 FILHAS e as 3 junções implícitas do Prisma.
 *
 * `escopo: 'filho'` não quer mais dizer "sem orgId": desde a fatia 1.1 as dez
 * carregam a coluna. Quer dizer que a empresa delas é DERIVADA de um pai — e é
 * por isso que continuam listadas em separado: nelas o isolamento tem duas
 * perguntas, "a política filtra?" e "o orgId gravado é mesmo o do pai?".
 *
 * Fora daqui, de propósito: os modelos declarados em
 * `src/common/modelos-globais.ts` (Org entra, por causa da PK; Permission,
 * BioVisitor e Capability não) e _prisma_migrations (controle do Migrate —
 * ligar RLS nela quebra o boot).
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
  { tabela: 'IntegrationHealth', escopo: 'filho', chaveSql: '"id"', nota: 'Filha 1:1 de IntegrationAccount; orgId derivado dela.' },

  // ---- leads e campanhas ------------------------------------------------
  { tabela: 'LeadSource', escopo: 'tenant', chaveSql: '"id"', nota: 'Catálogo de canais por org.' },
  { tabela: 'Lead', escopo: 'tenant', chaveSql: '"id"', nota: 'PII de terceiro (nome, e-mail, telefone).' },
  { tabela: 'LeadEvent', escopo: 'filho', chaveSql: '"id"', nota: 'Filha de Lead; payload Json guarda histórico de PII.' },
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
  { tabela: 'BioLink', escopo: 'filho', chaveSql: '"id"', nota: 'Filha de BioPage. Resolve o redirect anônimo em bio-public.controller.ts:87.' },
  { tabela: 'BioChallenge', escopo: 'tenant', chaveSql: '"id"', nota: 'Tem orgId E pageId — duplo caminho até a org.' },
  { tabela: 'BioChallengeAccount', escopo: 'filho', chaveSql: '"id"', nota: 'Liga desafio a BioConexao — sem policy dá para amarrar OAuth de outra org.' },
  { tabela: 'BioChallengePost', escopo: 'filho', chaveSql: '"id"', nota: 'Neta de BioChallenge: sem a coluna própria, a org custava 2 saltos de join.' },
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
  { tabela: 'WorkStatus', escopo: 'filho', chaveSql: '"id"', nota: 'Referenciada por WorkTask.statusId: as duas empresas têm de bater.' },
  { tabela: 'WorkTag', escopo: 'tenant', chaveSql: '"id"', nota: 'Etiquetas do espaço.' },
  { tabela: 'WorkField', escopo: 'tenant', chaveSql: '"id"', nota: 'Campo personalizado; listId nulo = vale para o espaço todo.' },
  { tabela: 'WorkFieldOption', escopo: 'filho', chaveSql: '"id"', nota: 'Filha de WorkField; orgId derivado dele.' },
  { tabela: 'WorkTask', escopo: 'tenant', chaveSql: '"id"', nota: 'Auto-relação parentId para subtarefas dentro da org.' },
  { tabela: 'WorkFieldValue', escopo: 'filho', chaveSql: '"id"', nota: 'DOIS pais obrigatórios (WorkTask e WorkField) — os dois têm de ser da mesma org.' },
  { tabela: 'WorkComment', escopo: 'filho', chaveSql: '"id"', nota: 'Texto livre e authorName. Conteúdo de tenant que só a política de linha separa.' },

  // ---- junções implícitas do Prisma (não têm id) ------------------------
  { tabela: '_UserRoles', escopo: 'juncao', chaveSql: `"A" || '|' || "B"`, nota: 'A=Role.id, B=User.id. Sem policy dá para conceder Role de outra org — escalação cross-tenant.' },
  { tabela: '_RolePermissions', escopo: 'juncao', chaveSql: `"A" || '|' || "B"`, nota: 'A=Permission.id (GLOBAL), B=Role.id (TENANT). A policy vai em B, nunca em A.' },
  { tabela: '_WorkTaskTags', escopo: 'juncao', chaveSql: `"A" || '|' || "B"`, nota: 'A=WorkTag.id, B=WorkTask.id. Os dois pais têm orgId.' },
];

/**
 * Tabelas GLOBAIS por design: ligar RLS nelas QUEBRA o sistema.
 *
 * A lista NÃO é escrita aqui: vem de `src/common/modelos-globais.ts`, que é o
 * arquivo versionado onde ser global é declaração. Org fica de fora desta
 * conferência porque ela é a raiz do tenant — legível pelos dois seria
 * exatamente o vazamento, e o isolamento dela (por PK) já está em ALVOS.
 */
const GLOBAIS = MODELOS_GLOBAIS.filter((m) => m.modelo !== 'Org').map((m) => ({
  tabela: m.modelo,
  quebra: m.quebraSe,
}));

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
/** Capability idem: catálogo da escada, um para todas as empresas. */
let capacidadeCompartilhadaId = '';

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
  s.ref.integrationAccountId = integId;

  // Os dez filhos abaixo informam orgId EXPLICITAMENTE. É o caminho que a
  // aplicação deve seguir: o gatilho do banco vira conferência, não muleta.
  // O outro caminho (omitir e deixar o gatilho derivar) tem teste próprio na
  // seção 7.
  reg('IntegrationHealth', await ins(c, 'IntegrationHealth', {
    id: crypto.randomUUID(), orgId, accountId: integId, status: 'ok', latencyMs: 120,
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
    id: crypto.randomUUID(), orgId, leadId, type: 'formulario',
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
    id: crypto.randomUUID(), orgId, pageId, ordem: 1, tipo: 'url',
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
  s.ref.bioChallengeId = desafioId;

  const contaDesafioId = await ins(c, 'BioChallengeAccount', {
    id: crypto.randomUUID(), orgId, challengeId: desafioId, plataforma: 'instagram',
    handle: `@${suf}`, modo: 'conectado', conexaoId, status: 'ok',
  });
  reg('BioChallengeAccount', contaDesafioId);
  s.ref.bioChallengeAccountId = contaDesafioId;

  reg('BioChallengePost', await ins(c, 'BioChallengePost', {
    id: crypto.randomUUID(), orgId, contaId: contaDesafioId, externalId: `post_${suf}`, publicadoEm: agora,
  }));

  reg('BioChallengeSnapshot', await ins(c, 'BioChallengeSnapshot', {
    id: crypto.randomUUID(), orgId, contaId: contaDesafioId, totalCount: 42, ok: true,
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

  // E aqui a premissa em si, materializada: UM visitante, o MESMO id de cookie,
  // com visita nas duas empresas. É o que a fatia 1.1 mandou conferir antes de
  // declarar BioVisitor global — se um dia a tabela ganhar orgId, esta linha
  // deixa de caber e a seção 8 explica por quê.
  await c.query('INSERT INTO "BioVisitor" ("id") VALUES ($1) ON CONFLICT DO NOTHING', [VISITANTE_COMPARTILHADO]);
  if (rotulo === 'A') reg('BioVisitor', VISITANTE_COMPARTILHADO);

  const visitId = await ins(c, 'BioVisit', {
    id: crypto.randomUUID(), orgId, visitorId, pageId, referrer: 'https://instagram.com',
    device: 'mobile', os: 'iOS', browser: 'Safari',
  });
  reg('BioVisit', visitId);

  s.ref.visitaCompartilhadaId = await ins(c, 'BioVisit', {
    id: crypto.randomUUID(), orgId, visitorId: VISITANTE_COMPARTILHADO, pageId,
    referrer: 'https://tiktok.com', device: 'mobile',
  });
  reg('BioVisit', s.ref.visitaCompartilhadaId);

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
  s.ref.workListId = listaId;

  const statusId = await ins(c, 'WorkStatus', { id: crypto.randomUUID(), orgId, listId: listaId, name: 'aberto', type: 'open' });
  reg('WorkStatus', statusId);

  const tagId = await ins(c, 'WorkTag', { id: crypto.randomUUID(), orgId, name: `etiqueta ${rotulo} ${MARCA}` });
  reg('WorkTag', tagId);

  const campoId = await ins(c, 'WorkField', { id: crypto.randomUUID(), orgId, listId: listaId, name: `Eixo ${rotulo}`, type: 'drop_down' });
  reg('WorkField', campoId);
  s.ref.workFieldId = campoId;

  const opcaoId = await ins(c, 'WorkFieldOption', { id: crypto.randomUUID(), orgId, fieldId: campoId, name: `Opção ${rotulo}` });
  reg('WorkFieldOption', opcaoId);
  s.ref.workFieldOptionId = opcaoId;

  const tarefaId = await ins(c, 'WorkTask', {
    id: crypto.randomUUID(), orgId, listId: listaId, statusId, title: `Tarefa ${rotulo} ${MARCA}`,
    description: `Descrição interna da org ${rotulo}`, priority: 'normal', externalId: `wt_${suf}`, updatedAt: agora,
  });
  reg('WorkTask', tarefaId);
  s.ref.workTaskId = tarefaId;

  reg('WorkFieldValue', await ins(c, 'WorkFieldValue', {
    id: crypto.randomUUID(), orgId, taskId: tarefaId, fieldId: campoId, optionId: opcaoId,
  }));

  reg('WorkComment', await ins(c, 'WorkComment', {
    id: crypto.randomUUID(), orgId, taskId: tarefaId, authorId: userId,
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

    // Capability é o outro catálogo GLOBAL (src/common/modelos-globais.ts). Sem
    // uma linha semeada, o teste "continua legível pelos dois tenants" passaria
    // à toa num banco de teste vazio — que é justamente o fracasso silencioso
    // que esta suíte existe para não ter.
    capacidadeCompartilhadaId = await ins(
      c,
      'Capability',
      {
        id: `iso.capacidade.${MARCA}`,
        descricao: 'Capacidade de teste da suíte de isolamento.',
        level: 'R0',
        efeito: JSON.stringify({ tipo: 'leitura' }),
        hashKeys: [],
        atualizadoEm: new Date(),
      },
      // `level` é enum: sem cast, o Postgres deduz o tipo pela coluna de destino.
      // Um `::RiskLevel` sem aspas viraria `risklevel` e o tipo não existe.
      { hashKeys: 'text[]' },
    );
    ORDEM_LIMPEZA.push('Capability');

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
      if (tabela === 'Capability') {
        await c.query('DELETE FROM "Capability" WHERE "id" = $1', [capacidadeCompartilhadaId]);
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

// ---------------------------------------------------------------------------
// 7. orgId em todo filho de tenant — RF-T-01
//
// Esta seção NÃO depende de RLS: ela cobra a camada de baixo, sem a qual RLS
// não tem em que se apoiar. São três perguntas por tabela filha:
//   (a) a coluna existe, é obrigatória, aponta para Org e tem quem a derive?
//   (b) o valor gravado é MESMO o do pai — na semente e no banco inteiro?
//   (c) dá para pendurar filho de uma empresa em pai de outra?
// A (c) é a que a chave estrangeira sozinha não responde: ela confere o id, não
// a empresa.
// ---------------------------------------------------------------------------

/** Roda escritas como ADMIN e desfaz tudo. Aqui o alvo é o gatilho, não a RLS. */
async function emTransacaoDesfeita<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    return await fn(c);
  } finally {
    await c.query('ROLLBACK').catch(() => undefined);
    c.release();
  }
}

/**
 * Uma linha mínima e válida de cada filho, pendurada num pai da org A e SEM
 * informar orgId. Algumas precisam de um pai novo (chave única do modelo não
 * deixa repetir a linha semeada) — daí receberem o client: criam o pai dentro
 * da mesma transação, que é desfeita no fim.
 */
const LINHA_DE_FILHO: Record<string, (c: PoolClient) => Promise<Record<string, unknown>>> = {
  IntegrationHealth: async (c) => {
    // accountId é @unique: precisa de uma conta nova, senão colide com a semente.
    const conta = await ins(c, 'IntegrationAccount', {
      id: crypto.randomUUID(), orgId: sementes.A.orgId, key: `gatilho_${MARCA}`, label: 'Conta do teste de gatilho',
    });
    return { id: crypto.randomUUID(), accountId: conta, status: 'ok' };
  },
  LeadEvent: async () => ({ id: crypto.randomUUID(), leadId: sementes.A.ref.leadId, type: 'gatilho' }),
  BioLink: async () => ({
    id: crypto.randomUUID(), pageId: sementes.A.ref.bioPageId, ordem: 99,
    rotulo: 'Link do gatilho', destino: 'https://gatilho.exemplo.com',
  }),
  BioChallengeAccount: async () => ({
    id: crypto.randomUUID(), challengeId: sementes.A.ref.bioChallengeId,
    plataforma: 'tiktok', handle: `@gatilho_${MARCA}`,
  }),
  BioChallengePost: async () => ({
    id: crypto.randomUUID(), contaId: sementes.A.ref.bioChallengeAccountId,
    externalId: `post_gatilho_${MARCA}`, publicadoEm: new Date(),
  }),
  BioChallengeSnapshot: async () => ({
    id: crypto.randomUUID(), contaId: sementes.A.ref.bioChallengeAccountId, totalCount: 7,
  }),
  WorkStatus: async () => ({
    id: crypto.randomUUID(), listId: sementes.A.ref.workListId, name: `status_${MARCA}`, type: 'open',
  }),
  WorkFieldOption: async () => ({
    id: crypto.randomUUID(), fieldId: sementes.A.ref.workFieldId, name: `opcao_${MARCA}`,
  }),
  WorkFieldValue: async (c) => {
    // @@unique([taskId, fieldId]): um campo novo para não colidir com a semente.
    const campo = await ins(c, 'WorkField', {
      id: crypto.randomUUID(), orgId: sementes.A.orgId, listId: sementes.A.ref.workListId,
      name: `campo_gatilho_${MARCA}`, type: 'texto',
    });
    return { id: crypto.randomUUID(), taskId: sementes.A.ref.workTaskId, fieldId: campo, value: 'x' };
  },
  WorkComment: async () => ({
    id: crypto.randomUUID(), taskId: sementes.A.ref.workTaskId,
    authorName: 'Gatilho', text: 'comentário do teste de derivação',
  }),
};

/**
 * Modelo pai -> a chave dele em `sementes.<org>.ref`.
 *
 * É o que permite montar o cruzamento genericamente: pega a linha válida da org
 * A e troca UM pai pelo equivalente da org B.
 */
const REF_DA_SEMENTE: Record<string, string> = {
  WorkTask: 'workTaskId',
  WorkField: 'workFieldId',
  WorkFieldOption: 'workFieldOptionId',
};

describe('orgId em todo filho de tenant (RF-T-01)', () => {
  it('a lista de filhos do código cobre exatamente os filhos com prova montada', () => {
    // Guarda contra o pior fracasso desta seção: filho novo entra em
    // modelos-globais.ts, ninguém escreve a linha de prova, e os it.each abaixo
    // passam a rodar um caso a menos — em silêncio.
    const declarados = FILHOS_COM_ORGID_REDUNDANTE.map((f) => f.modelo).sort();
    const comProva = Object.keys(LINHA_DE_FILHO).sort();
    expect(comProva, 'FILHOS_COM_ORGID_REDUNDANTE e LINHA_DE_FILHO divergiram.').toEqual(declarados);
    expect(declarados.length).toBe(10);
  });

  it.each(FILHOS_COM_ORGID_REDUNDANTE.map((f) => [f.modelo, f] as const))(
    '%s tem orgId obrigatório, apontando para Org e com gatilho de derivação',
    async (_nome, filho) => {
      const coluna = await admin.query<{ is_nullable: string; column_default: string | null }>(
        `SELECT is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'orgId'`,
        [filho.modelo],
      );
      expect(
        coluna.rows.length,
        `\n"${filho.modelo}" não tem coluna orgId.\n` +
          `  Ela deveria ser derivada de ${filho.pai} por ${filho.fk}.\n` +
          '  Ver a migration 20260910120000_orgid_em_todo_filho.\n',
      ).toBe(1);
      expect(
        coluna.rows[0].is_nullable,
        `\n"${filho.modelo}"."orgId" é ANULÁVEL. Linha sem empresa é linha fora de qualquer política.\n`,
      ).toBe('NO');

      const fk = await admin.query<{ def: string }>(
        `SELECT pg_get_constraintdef(c.oid) AS def
           FROM pg_constraint c
          WHERE c.conrelid = format('%I', $1::text)::regclass AND c.contype = 'f'`,
        [filho.modelo],
      );
      expect(
        fk.rows.some((r) => r.def.includes('("orgId")') && r.def.includes('REFERENCES "Org"')),
        `\n"${filho.modelo}"."orgId" não tem chave estrangeira para Org.\n` +
          '  Sem ela, a sentinela do default (string vazia) sobrevive a um gatilho removido e vira tenant fantasma.\n',
      ).toBe(true);

      const gatilhos = await admin.query<{ tgname: string; args: string }>(
        `SELECT t.tgname, pg_get_triggerdef(t.oid) AS args
           FROM pg_trigger t
          WHERE t.tgrelid = format('%I', $1::text)::regclass AND NOT t.tgisinternal`,
        [filho.modelo],
      );
      const deOrgId = gatilhos.rows.filter((r) => r.tgname.includes('orgId'));
      expect(
        deOrgId.map((r) => r.tgname),
        `\n"${filho.modelo}" não tem gatilho de derivação de orgId.\n` +
          `  Sem ele, uma escrita que não informe orgId grava a sentinela e a FK derruba a operação;\n` +
          `  e pendurar filho de uma empresa num ${filho.pai} de outra volta a ser possível.\n`,
      ).not.toEqual([]);

      // UM GATILHO POR PAI CONFERIDO. WorkFieldValue tem três pais; um gatilho
      // só derivaria da tarefa e deixaria campo e opção sem conferência nenhuma
      // — foi assim que a opção de outra empresa entrava sem reclamação.
      for (const pai of paisDoFilho(filho)) {
        expect(
          deOrgId.some((r) => r.args.includes(`'${pai.modelo}'`) && r.args.includes(`'${pai.fk}'`)),
          `\n"${filho.modelo}" não tem gatilho conferindo o pai "${pai.modelo}" por "${pai.fk}".\n` +
            `  Gatilhos de orgId encontrados: ${deOrgId.map((r) => r.tgname).join(', ') || '(nenhum)'}\n` +
            '  Pai declarado em modelos-globais.ts sem gatilho no banco é conferência que só existe no papel.\n',
        ).toBe(true);
      }
    },
    30_000,
  );

  it.each(FILHOS_COM_ORGID_REDUNDANTE.map((f) => [f.modelo, f] as const))(
    'o orgId de %s bate com o do pai em TODAS as linhas da tabela',
    async (_nome, filho) => {
      // paisDoFilho e não `filho.pai` sozinho: WorkFieldValue tem TRÊS pais, e
      // conferir só o derivante foi exatamente o que deixou a opção escolhida
      // (optionId) sem cobertura nenhuma.
      for (const pai of paisDoFilho(filho)) {
        const r = await admin.query<{ n: string; exemplo: string | null }>(
          `SELECT count(*)::text AS n, min(f."id") AS exemplo
             FROM "${filho.modelo}" f
             JOIN "${pai.modelo}" p ON p."id" = f."${pai.fk}"
            WHERE f."orgId" <> p."orgId"`,
        );
        const divergentes = Number(r.rows[0].n);
        expect(
          divergentes,
          `\n${divergentes} linha(s) de "${filho.modelo}" com orgId diferente do pai "${pai.modelo}".\n` +
            `  Exemplo: ${r.rows[0].exemplo}\n` +
            '  Ou o backfill da migration errou, ou alguém gravou orgId à mão sem conferir o pai.\n' +
            '  Não é caso de borda: é filho de uma empresa pendurado em pai de outra.\n',
        ).toBe(0);
      }

      // E o caso concreto da semente, que informou orgId explicitamente.
      const semeadas = sementes.A.chaves[filho.modelo] ?? [];
      expect(semeadas.length, `A semente da org A não criou linha em ${filho.modelo}.`).toBeGreaterThan(0);
      const r = await admin.query<{ orgId: string }>(
        `SELECT "orgId" FROM "${filho.modelo}" WHERE "id" = ANY($1::text[])`,
        [semeadas],
      );
      for (const linha of r.rows) expect(linha.orgId).toBe(sementes.A.orgId);
    },
    30_000,
  );

  it.each(FILHOS_COM_ORGID_REDUNDANTE.map((f) => [f.modelo, f] as const))(
    '%s criado SEM informar orgId herda o da empresa do pai',
    async (_nome, filho) => {
      const gravado = await emTransacaoDesfeita(async (c) => {
        const dados = await LINHA_DE_FILHO[filho.modelo](c);
        const id = await ins(c, filho.modelo, dados);
        const r = await c.query<{ orgId: string }>(`SELECT "orgId" FROM "${filho.modelo}" WHERE "id" = $1`, [id]);
        return r.rows[0].orgId;
      });
      expect(
        gravado,
        `\nUm ${filho.modelo} criado sem orgId ficou com "${gravado}" em vez da empresa do pai.\n` +
          '  É o caminho das ~20 chamadas que ainda não informam orgId: elas não podem gravar linha sem empresa.\n',
      ).toBe(sementes.A.orgId);
    },
    30_000,
  );

  it.each(FILHOS_COM_ORGID_REDUNDANTE.map((f) => [f.modelo, f] as const))(
    '%s recusa nascer com o orgId de OUTRA empresa',
    async (_nome, filho) => {
      const { aceitou, erro } = await emTransacaoDesfeita(async (c) => {
        const dados = await LINHA_DE_FILHO[filho.modelo](c);
        try {
          // Pai da org A, carimbo da org B: exatamente o que a FK não vê.
          await ins(c, filho.modelo, { ...dados, orgId: sementes.B.orgId });
          return { aceitou: true, erro: '' };
        } catch (e) {
          return { aceitou: false, erro: (e as Error).message };
        }
      });
      expect(
        aceitou,
        `\nEMPRESA CRUZADA: um ${filho.modelo} da org B foi pendurado num ${filho.pai} da org A.\n` +
          '  A FK confere o id do pai, nunca a empresa dele. Quem tem de recusar é o gatilho\n' +
          `  "${filho.modelo}_orgId_do_pai" (migration 20260910120000_orgid_em_todo_filho).\n`,
      ).toBe(false);
      expect(erro, 'A recusa veio, mas por outro motivo — confira se não é violação de chave única.').toContain(
        'empresa cruzada',
      );
    },
    30_000,
  );

  // Cada pai CONFERIDO (o segundo em diante) precisa da sua própria prova. Sem
  // isto o teste percorria só o pai derivante e o terceiro pai de WorkFieldValue
  // — a opção escolhida — não era exercitado por caso nenhum.
  const PARES_CONFERIDOS = FILHOS_COM_ORGID_REDUNDANTE.flatMap((filho) =>
    (filho.paisConferidos ?? []).map((pai) => [`${filho.modelo} x ${pai.modelo}`, filho, pai] as const),
  );

  it.each(PARES_CONFERIDOS)(
    '%s: recusa pai conferido de OUTRA empresa',
    async (_nome, filho, pai) => {
      const chaveDaSemente = REF_DA_SEMENTE[pai.modelo];
      expect(
        chaveDaSemente,
        `Falta mapear "${pai.modelo}" em REF_DA_SEMENTE para provar o cruzamento de ${filho.modelo}.`,
      ).toBeDefined();

      const { aceitou, erro } = await emTransacaoDesfeita(async (c) => {
        const dados = await LINHA_DE_FILHO[filho.modelo](c);
        try {
          // Tudo da org A, menos ESTE pai, que vem da org B. A FK fica satisfeita
          // (o id existe), e é só o gatilho que pode perceber a empresa errada.
          await ins(c, filho.modelo, { ...dados, [pai.fk]: sementes.B.ref[chaveDaSemente] });
          return { aceitou: true, erro: '' };
        } catch (e) {
          return { aceitou: false, erro: (e as Error).message };
        }
      });

      expect(
        aceitou,
        `\nEMPRESA CRUZADA: um ${filho.modelo} da org A apontou "${pai.fk}" para um ${pai.modelo} da org B.\n` +
          '  A chave estrangeira confere o id do pai, nunca a empresa dele. Quem tem de recusar é o\n' +
          `  gatilho que confere ${pai.modelo} (migration 20260910120000_orgid_em_todo_filho).\n` +
          `  Concretamente em WorkFieldValue x WorkFieldOption: a consulta que junta valor e opção passa\n` +
          '  a devolver o rótulo da OUTRA empresa.\n',
      ).toBe(false);
      expect(erro, 'A recusa veio, mas por outro motivo — confira se não é violação de chave única.').toContain(
        'empresa cruzada',
      );
    },
    30_000,
  );

  it('o gatilho não se deixa enganar por search_path (pai de mentira em schema paralelo)', async () => {
    // O gatilho resolve o pai por um identificador que chega como TEXTO. Se esse
    // identificador for interpolado sem schema e a função não fixar search_path,
    // quem controla o search_path da sessão escolhe qual tabela vale como pai —
    // e o filho nasce carimbado com a empresa que o atacante quiser.
    //
    // Hoje isso exige SQL arbitrário e a aplicação conecta como dona do banco,
    // então já se perderia por outro caminho. Depois da fatia 1.3, com papel
    // restrito e RLS, este gatilho é a ÚNICA barreira: aí vira escalada.
    const schemaFalso = `falso_${MARCA}`;
    const idDoEvento = crypto.randomUUID();

    const gravado = await emTransacaoDesfeita(async (c) => {
      await c.query(`CREATE SCHEMA "${schemaFalso}"`);
      await c.query(`CREATE TABLE "${schemaFalso}"."Lead" (id text primary key, "orgId" text)`);
      // id do lead REAL da org A; empresa declarada, a org B.
      await c.query(`INSERT INTO "${schemaFalso}"."Lead" VALUES ($1, $2)`, [
        sementes.A.ref.leadId,
        sementes.B.orgId,
      ]);

      await c.query(`SET LOCAL search_path TO "${schemaFalso}", public`);
      await c.query(
        `INSERT INTO public."LeadEvent" (id, "leadId", type) VALUES ($1, $2, 'ataque_search_path')`,
        [idDoEvento, sementes.A.ref.leadId],
      );
      await c.query('SET LOCAL search_path TO public');

      const r = await c.query<{ orgId: string }>('SELECT "orgId" FROM public."LeadEvent" WHERE id = $1', [
        idDoEvento,
      ]);
      return r.rows[0].orgId;
    });

    expect(
      gravado,
      '\nSEQUESTRO DE search_path: o gatilho leu o pai de um schema plantado pelo chamador.\n' +
        `  O evento nasceu com a empresa "${gravado}" e o lead é da empresa "${sementes.A.orgId}".\n` +
        '  Conserto: a função mktos_orgid_do_pai precisa de `SET search_path` e o pai precisa ir\n' +
        '  qualificado por TG_TABLE_SCHEMA (migration 20260910120000_orgid_em_todo_filho).\n',
    ).toBe(sementes.A.orgId);
  }, 30_000);

  it('nenhuma coluna com a sentinela do padrão ficou sem gatilho e sem entrada na lista', async () => {
    // A catraca contra quem copia o padrão pela metade. `@default('')` no orgId é
    // a marca da sentinela: sozinha, ela só garante que a escrita grave string
    // vazia e a chave estrangeira contra Org derrube a operação — em produção, a
    // cada escrita. A varredura vem do CATÁLOGO do banco, não do schema.prisma:
    // é o estado real que importa aqui.
    const comSentinela = await admin.query<{ tabela: string }>(
      `SELECT table_name AS tabela
         FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'orgId' AND column_default = $1
        ORDER BY 1`,
      ["''::text"],
    );
    const declarados = FILHOS_COM_ORGID_REDUNDANTE.map((f) => f.modelo).sort();
    const encontrados = comSentinela.rows.map((r) => r.tabela).sort();

    expect(
      encontrados,
      '\nA sentinela de orgId no banco e a lista de filhos divergiram.\n' +
        `  No banco: ${encontrados.join(', ') || '(nenhuma)'}\n` +
        `  Na lista: ${declarados.join(', ')}\n` +
        '  Tabela com a sentinela e sem entrada em FILHOS_COM_ORGID_REDUNDANTE não ganha gatilho, não\n' +
        '  ganha teste e só dá as caras em produção. Entrada na lista sem tabela no banco é o inverso:\n' +
        '  declaração que promete uma proteção que a migration não criou.\n',
    ).toEqual(declarados);

    const semGatilho: string[] = [];
    for (const tabela of encontrados) {
      const g = await admin.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM pg_trigger t
          WHERE t.tgrelid = format('%I', $1::text)::regclass
            AND NOT t.tgisinternal AND t.tgname LIKE '%orgId%'`,
        [tabela],
      );
      if (Number(g.rows[0].n) === 0) semGatilho.push(tabela);
    }
    expect(
      semGatilho,
      '\nSENTINELA SEM GATILHO: ' + semGatilho.join(', ') + '\n' +
        '  A coluna tem DEFAULT \'\' e ninguém troca a sentinela pelo orgId do pai. Toda escrita que não\n' +
        '  informar orgId explicitamente vai violar a chave estrangeira contra Org.\n',
    ).toEqual([]);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// 8. A lista versionada de modelos globais — o lado BANCO
//
// "Global por desenho" e "nasceu sem orgId e ninguém viu" são indistinguíveis
// olhando só o schema. O que separa os dois é a declaração em
// src/common/modelos-globais.ts.
//
// A cobrança da declaração contra o `schema.prisma` mudou para
// `test/modelos-globais.test.ts`, que entra no `pnpm test` padrão e reprova de
// verdade — aqui ela acusaria com o check verde, porque este arquivo roda com
// `continue-on-error` enquanto o isolamento por linha não estiver ligado.
// O que sobrou é o que só o banco responde: a coluna existe mesmo? é anulável
// mesmo? o visitante compartilhado existe de fato nas duas empresas?
// ---------------------------------------------------------------------------

describe('modelos globais por desenho (estado do banco)', () => {
  it.each(MODELOS_GLOBAIS.map((g) => [g.modelo, g] as const))(
    '%s: sem coluna orgId no banco',
    async (_nome, global) => {
      const r = await admin.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'orgId'`,
        [global.modelo],
      );
      expect(
        Number(r.rows[0].n),
        `\n"${global.modelo}" está declarado GLOBAL mas TEM coluna orgId no banco.\n` +
          `  Motivo declarado: ${global.porQue}\n` +
          '  Schema e declaração precisam contar a mesma história.\n',
      ).toBe(0);
    },
    30_000,
  );

  it.each(MODELOS_ESCOPO_OPCIONAL.map((m) => [m.modelo, m] as const))(
    '%s tem orgId ANULÁVEL — escopo opcional, não global',
    async (_nome, modelo) => {
      const r = await admin.query<{ is_nullable: string }>(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'orgId'`,
        [modelo.modelo],
      );
      expect(r.rows.length, `"${modelo.modelo}" perdeu a coluna orgId.`).toBe(1);
      expect(
        r.rows[0].is_nullable,
        `\n"${modelo.modelo}"."orgId" deixou de ser anulável.\n` +
          `  O nulo ali significa: ${modelo.nuloSignifica}\n` +
          '  Se a mudança foi de propósito, tire o modelo de MODELOS_ESCOPO_OPCIONAL e reveja a política de linha.\n',
      ).toBe('YES');
    },
    30_000,
  );

  it('BioVisitor ser global NÃO deixa filho sem empresa', async () => {
    // A ressalva da fatia 1.1: BioVisit e BioEvent penduram em BioVisitor, que é
    // global. Se dependessem do pai para achar a empresa, ficariam órfãos — não
    // dependem: carregam orgId próprio, vindo da BioPage.
    for (const tabela of ['BioVisit', 'BioEvent']) {
      const r = await admin.query<{ is_nullable: string }>(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'orgId'`,
        [tabela],
      );
      expect(r.rows.length, `"${tabela}" pendura em BioVisitor (global) e não tem orgId próprio.`).toBe(1);
      expect(r.rows[0].is_nullable, `"${tabela}"."orgId" é anulável — filho de global sem empresa.`).toBe('NO');
    }
  }, 30_000);

  it('o MESMO visitante tem visita nas duas empresas (a premissa de BioVisitor global)', async () => {
    // É a premissa que a fatia 1.1 mandou conferir antes de declarar a tabela
    // global. Sem uma linha assim no banco, "o mesmo browser visita páginas de
    // orgs diferentes" seria só uma frase no comentário do schema.
    const r = await admin.query<{ orgId: string }>(
      'SELECT DISTINCT "orgId" FROM "BioVisit" WHERE "visitorId" = $1',
      [VISITANTE_COMPARTILHADO],
    );
    const orgs = r.rows.map((x) => x.orgId).sort();
    expect(
      orgs,
      '\nO visitante compartilhado não apareceu nas duas empresas.\n' +
        '  Se BioVisitor ganhasse orgId, este cookie viraria dois visitantes e a sessionização da bio se partiria.\n',
    ).toEqual([sementes.A.orgId, sementes.B.orgId].sort());
  }, 30_000);
});
