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
 * DE ONDE VÊM AS DUAS ORGS (mudou na fatia 1.7)
 * A org A é montada linha a linha aqui. A org B vem do PROVISIONAMENTO do
 * produto (`provisionarTenant`, RF-T-07), pela ponte `test/tenant-provisionado.ts`
 * — o enunciado da fatia mandou o segundo tenant virar a fixture desta suíte, e
 * é isso que tira daqui o terceiro caminho de semeadura. Ver "A ORG B NASCE DO
 * PROVISIONAMENTO" no `beforeAll` e o bloco no topo de `semear`.
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
 * `test/modelos-globais.test.ts`. Motivo histórico: este arquivo fica fora do
 * `pnpm test` padrão e rodava com `continue-on-error` na integração contínua
 * enquanto o isolamento por linha não existia — catraca ali acusava e o check
 * ficava verde, que é o mesmo que não ter catraca. Aqui ficou só o que precisa
 * de banco.
 *
 * ESTADO ESPERADO HOJE: VERDE. (mudou na fatia 1.5, 11/09/2026)
 * A migration `20260911050000_isolamento_por_linha` liga `ROW LEVEL SECURITY`
 * com `FORCE` nas 72 tabelas do schema e escreve as policies de cada uma. Esta
 * suíte era o critério de aceite dessa ativação; agora é a prova dela, e o
 * `continue-on-error` do passo correspondente em `.github/workflows/ci.yml` foi
 * apagado no mesmo commit.
 *
 * VERMELHO AQUI PASSOU A SIGNIFICAR VAZAMENTO ENTRE EMPRESAS, não dívida
 * datada. Antes de relaxar qualquer asserção, confira as duas causas que fazem a
 * suíte medir o vazio em vez do produto, e que ela mesma denuncia:
 *   · `TENANT_DATABASE_URL` ausente — a leitura cai na conexão ADMIN, que é DONA
 *     das tabelas e, neste Postgres, SUPERUSUÁRIA: as duas atravessam policy;
 *   · o papel restrito sem senha — mesmo efeito, pelo mesmo caminho.
 *
 * O QUE CONTINUA SEM DEPENDER DE RLS: as seções 7 e 8 (coluna, chave
 * estrangeira e gatilho de derivação), verdes desde
 * `20260910120000_orgid_em_todo_filho`, e a seção 10 (a extensão do Prisma).
 *
 * O QUE MUDOU NA CORREÇÃO DA FATIA 1.5 (11/09/2026) — e por quê
 * A suíte estava VERDE medindo menos do que parecia. Duas correções, as duas na
 * seção 1-bis:
 *
 *  1. O REGISTRO DE ALVOS AGORA É COBRADO PELO CATÁLOGO. Ele tinha 59 entradas
 *     escritas à mão para um banco com 69 tabelas de empresa; as dez de fora
 *     eram o núcleo do produto novo (Agent, Approval, ToolCall, Session,
 *     SessionStep, Sop, PolicyDecision, PolicyVersion, ChannelIdentity,
 *     EventLog). Elas não vazavam: NÃO ERAM MEDIDAS. Medido: uma policy
 *     `USING (true)` em três delas manteve a suíte 224/224 verde; a mesma policy
 *     numa tabela semeada reprovou quatro casos na hora.
 *  2. AS POLÍTICAS DO BANCO SÃO CONFERIDAS UMA A UMA contra o conjunto
 *     declarado. Policy de isolamento é PERMISSIVA e se soma: uma policy
 *     acrescentada ao lado das certas abre a tabela sem apagar nada, e
 *     "a tabela tem policy?" continuava respondendo que sim.
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
 *   3) O papel de aplicação precisa existir, ter senha e NÃO ser dono das
 *      tabelas. Sem isso o Postgres ignora as policies em silêncio (dono só
 *      obedece com FORCE). São dois passos, e nenhum deles é um GRANT à mão:
 *
 *        # cria o papel com as permissões mínimas (e REVOGA o que ele não pode)
 *        pnpm --filter @mktos/api db:deploy
 *
 *        # dá a senha — segredo de operação, por isso fica fora da migration
 *        DB_APP_PASSWORD='...' deploy/papel-app.sh
 *
 *      NÃO repita aqui `GRANT ... ON ALL TABLES IN SCHEMA public`: esse atalho
 *      inclui "EventLog" e "_prisma_migrations" e DESFAZ os dois REVOKE que a
 *      migration 20260911020000_papel_de_aplicacao acabou de aplicar. O papel
 *      volta a poder alterar e apagar o RASTRO, e dois casos desta suíte —
 *      "não altera, não apaga e não trunca o RASTRO" e "não enxerga o histórico
 *      de migration" — ficam vermelhos por causa da receita, não do produto.
 *      (Foi exatamente o que a preparação da integração contínua fazia até
 *      10/09/2026; ver o passo "Dar senha ao papel de aplicação" no ci.yml.)
 *
 *      Fora do compose (banco solto, como o descartável do host), o equivalente
 *      do segundo passo é `ALTER ROLE mktos_app WITH LOGIN PASSWORD '...'`.
 *
 *   4) O isolamento em si vem do `db:deploy` do passo 3: a migration
 *      `20260911050000_isolamento_por_linha` já deixa RLS e FORCE ligados. O
 *      `beforeAll` ainda chama `app_rls_ligar()` por auto-cura, agora só como
 *      rede: a seção de RLS de `rotas-publicas-tenant.test.ts` DESLIGA as 11
 *      tabelas dela para montar policies próprias, e passou a religar tudo no
 *      `afterAll` (11/09/2026) — antes disso ela deixava o banco em 61 de 72 e
 *      esta auto-cura era o que escondia o estrago.
 *      Para inspecionar à mão:
 *        SELECT * FROM app_rls_estado();   -- tabela, rls, force, nº de policies
 *        SELECT app_rls_desligar();        -- rollback
 *        SELECT app_rls_ligar();           -- de volta
 *
 *      A receita local completa, com o banco dedicado:
 *        docker exec mktos-shadow psql -U mkt -d postgres -c 'CREATE DATABASE marketing_os_test_rls'
 *        DATABASE_URL='postgresql://mkt:shadow@localhost:55432/marketing_os_test_rls' \
 *          pnpm --filter @mktos/api db:deploy
 *        docker exec mktos-shadow psql -U mkt -d marketing_os_test_rls \
 *          -c "ALTER ROLE mktos_app WITH LOGIN PASSWORD '<senha local>'"
 *        TEST_DATABASE_URL='postgresql://mkt:shadow@localhost:55432/marketing_os_test_rls' \
 *        TENANT_DATABASE_URL='postgresql://mktos_app:<senha local>@localhost:55432/marketing_os_test_rls' \
 *          pnpm --filter @mktos/api test:isolamento
 *
 * AVISO: a suíte ESCREVE no banco. Nunca aponte para produção.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from '@mktos/shared';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { comContexto, novaCorrelacao } from '../src/common/contexto-execucao';
import {
  FILHOS_COM_ORGID_REDUNDANTE,
  MODELOS_ESCOPO_OPCIONAL,
  MODELOS_GLOBAIS,
  paisDoFilho,
} from '../src/common/modelos-globais';
import { ORG_RESOLUCAO_PUBLICA } from '../src/common/tenant-publico';
import {
  CAMINHOS_DE_PLATAFORMA_EXIGIDOS,
  CHAMADORES_DE_PLATAFORMA,
  ORG_PLATAFORMA,
  caminhosDePlataformaFaltando,
} from '../src/prisma/contexto-de-plataforma';
import {
  CoberturaDePlataformaIncompletaError,
  GUC_TENANT,
  PAPEL_DE_APLICACAO,
  comTenantNaSessao,
  conferirCoberturaDePlataforma,
  esquecerAvisos,
} from '../src/prisma/sessao-de-banco';
import { exigirBancoDescartavel } from './banco-de-teste';
import { provisionarTenantDeTeste, type TenantDeTeste } from './tenant-provisionado';

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
 *
 * ESTA LISTA É ESCRITA À MÃO E COBRADA PELO CATÁLOGO (correção de 11/09/2026).
 * Ela precisa ser à mão — cada entrada carrega uma `nota` que é o que torna a
 * falha legível, e `chaveSql`, que junção não tem como adivinhar. O que não
 * pode é ela ficar MENOR que o banco: por dez meses a suíte teve 59 entradas
 * para 69 tabelas de empresa, e as dez que faltavam eram o núcleo do produto
 * novo (agentes, aprovação, RASTRO, sessões). Elas não vazavam — não eram
 * MEDIDAS, que é diferente e pior, porque parecia prova.
 *
 * Quem cobra agora é o caso "o registro da suíte cobre exatamente as tabelas de
 * empresa do banco", que compara esta lista com `pg_class`. Tabela nova sem
 * entrada aqui reprova a suíte no minuto seguinte ao `migrate deploy`.
 */
const ALVOS: Alvo[] = [
  // ---- raiz -------------------------------------------------------------
  { tabela: 'Org', escopo: 'tenant', chaveSql: '"id"', nota: 'Raiz do tenant. Sem policy por PK, qualquer org lista todas as outras.' },

  // ---- identidade e acesso ---------------------------------------------
  { tabela: 'User', escopo: 'tenant', chaveSql: '"id"', nota: 'Identidade e passwordHash.' },
  { tabela: 'Role', escopo: 'tenant', chaveSql: '"id"', nota: 'Papéis por org.' },
  { tabela: 'AuditLog', escopo: 'tenant', chaveSql: '"id"', nota: 'Concentra before/after das outras 57 tabelas. A mais sensível do banco.' },
  { tabela: 'ChannelIdentity', escopo: 'tenant', chaveSql: '"id"', nota: 'Amarra um número de WhatsApp/Telegram a um usuário: é caminho de AUTENTICAÇÃO, não só de dado.' },

  // ---- tripulação: agentes, sessões, rastro de ferramenta --------------
  // Entraram no registro em 11/09/2026. Antes disso o núcleo do produto novo
  // tinha policy no banco e NENHUMA medição na suíte.
  { tabela: 'Agent', escopo: 'tenant', chaveSql: '"id"', nota: 'Missão, capacidades e autonomia do agente. Quem lê isto sabe o que o agente da outra empresa pode fazer.' },
  { tabela: 'Sop', escopo: 'tenant', chaveSql: '"id"', nota: 'Procedimento do agente — o método de operação da outra empresa, em texto.' },
  { tabela: 'Session', escopo: 'tenant', chaveSql: '"id"', nota: 'Pedido e resposta em texto livre. É a conversa inteira do cliente com o agente.' },
  { tabela: 'SessionStep', escopo: 'tenant', chaveSql: '"id"', nota: 'Passo a passo da sessão: args da ferramenta, texto do modelo, erro. Vaza o conteúdo, não só o resumo.' },
  { tabela: 'ToolCall', escopo: 'tenant', chaveSql: '"id"', nota: 'Rastro de ferramenta: args e resultado em Json. É o que a ação DE FATO fez.' },
  { tabela: 'EventLog', escopo: 'tenant', chaveSql: '"id"', nota: 'O RASTRO (append-only). Encadeado por hash e por empresa; ler o da outra é ler a operação dela.' },
  { tabela: 'RastroRetencao', escopo: 'tenant', chaveSql: '"id"', nota: 'Por quantos dias o rastro da empresa fica (fatia 3.5). Escrever na da outra decide quando a PROVA dela some.' },

  // ---- política e aprovação --------------------------------------------
  { tabela: 'PolicyVersion', escopo: 'tenant', chaveSql: '"id"', nota: 'orgId NULLABLE: null = política base de todas. Leitura tem de ser orgId = atual OR IS NULL, e escrita só a própria.' },
  { tabela: 'PolicyDecision', escopo: 'tenant', chaveSql: '"id"', nota: 'Cada decisão da escada R0–R5, com motivo e sinais. Diz o que a outra empresa deixa passar.' },
  { tabela: 'Approval', escopo: 'tenant', chaveSql: '"id"', nota: 'Fila de aprovação: resumo do conteúdo a publicar e tokenHash. Ler é ver o que a outra empresa vai postar.' },
  { tabela: 'AprovacaoDeLote', escopo: 'tenant', chaveSql: '"id"', nota: 'O lote assinado (MD7): o hash da semana, quem assinou e até quando vale. Escrever `estado` na da outra é ATIVAR a semana dela sem assinatura, ou derrubá-la.' },
  { tabela: 'ItemDoLote', escopo: 'filho', chaveSql: '"id"', nota: 'Cada uso contado do lote (MD7): a janela, o hash do conteúdo e os usos. Escrever `usos` na da outra é gastar ou devolver a publicação dela. Filho do lote, com a empresa conferida pelo gatilho.' },

  // ---- teto de custo de IA (fatia 3.6) ----------------------------------
  { tabela: 'TetoDeCustoIa', escopo: 'tenant', chaveSql: '"id"', nota: 'Quanto a empresa pode gastar com modelo por dia. Ler é saber o orçamento dela; escrever é desligar o freio de gasto da outra.' },
  { tabela: 'GastoDeIaNoDia', escopo: 'tenant', chaveSql: '"id"', nota: 'O livro-caixa do dia. Ler é saber quanto a outra empresa opera; escrever é gastar o teto dela até o corte.' },

  // ---- integrações ------------------------------------------------------
  { tabela: 'IntegrationAccount', escopo: 'tenant', chaveSql: '"id"', nota: 'config Json carrega credencial de integração em claro.' },
  { tabela: 'IntegrationHealth', escopo: 'filho', chaveSql: '"id"', nota: 'Filha 1:1 de IntegrationAccount; orgId derivado dela.' },
  { tabela: 'ConectorDesligado', escopo: 'tenant', chaveSql: '"id"', nota: 'Desligamento de conector por empresa (RF-G-06). Ler o da outra revela que ela suspendeu um conector e por quê; ESCREVER nele é pior — apagar a linha RELIGA o conector da outra empresa por fora do painel dela.' },
  { tabela: 'SegredoDeConector', escopo: 'tenant', chaveSql: '"id"', nota: 'O COFRE (fatia 5.3, RF-C-01). É a pior linha do banco para vazar: cada uma é a credencial de uma empresa num fornecedor. O valor é cifrado E amarrado a (orgId, conector, nome) pelo dado associado do GCM, então copiar a linha não basta para abrir — mas ler já entrega o mapa de que conectores a outra empresa usa, com que escopo e desde quando, e APAGAR é revogar o acesso dela por fora do painel.' },

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
  { tabela: 'ContextItem', escopo: 'tenant', chaveSql: '"id"', nota: 'A MEMÓRIA (fatia 4.1+4.2, RF-M-01): as regras da casa, o dicionário de dados e as decisões desta empresa, em texto, MAIS embedding vector(1536). Vaza pela leitura E por similaridade — um KNN sem filtro entrega o conteúdo do vizinho sem nem precisar ler a linha. Escrever nela é pior: é ditar a "verdade da casa" que o agente da outra empresa vai usar como contexto.' },
  { tabela: 'ContextItemVersion', escopo: 'tenant', chaveSql: '"id"', nota: 'O histórico da MEMÓRIA — a projeção de cada mudança, com o corpo daquela versão e o motivo. Tem orgId próprio (não deriva do pai) porque a consulta de histórico é quente. Ler o da outra empresa é ler o que ela DECIDIU e por quê, inclusive o que ela já revogou.' },
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
  { tabela: 'PautaIdeia', escopo: 'tenant', chaveSql: '"id"', nota: 'O banco de ideias (MK3): título, gancho de fala e de tela, roteiro, legenda e o porquê do que a casa ainda NÃO publicou. Ler a da outra empresa é ler a pauta dela antes de ela ir ao ar — e o gancho é justamente a parte que se copia. É raiz da empresa, não filha: a ideia não pende de rodada nem de episódio, e o orgId dela vem do insert.' },
  { tabela: 'PautaPublicacao', escopo: 'filho', chaveSql: '"id"', nota: 'A publicação da peça no Instagram pelo OS (MD6): o estado, os containers na Meta, o id e o permalink do post. Ler a da outra é saber o que ela vai postar e quando; escrever `estado` é destravar ou derrubar a publicação alheia. Filha da peça, com a empresa conferida pelo gatilho.' },
  { tabela: 'ComentarioComPalavra', escopo: 'filho', chaveSql: '"id"', nota: 'Quem comentou a palavra-chave num post da semana (MD9): o @ por 7 dias, o HMAC da pessoa e se a DM já foi respondida. Ler a da outra é saber quem pediu o link a ela; escrever `respondidoEm` é sumir com a fila alheia. Filha da peça, com a empresa conferida pelo gatilho.' },
  { tabela: 'EnvioAoYoutube', escopo: 'filho', chaveSql: '"id"', nota: 'O vídeo do episódio a caminho do YouTube (MD10): o sha256 do vídeo final, a URI da sessão de envio cifrada e o id do vídeo privado. Ler a da outra é saber o que ela vai publicar e onde está o vídeo privado dela; escrever `videoId` ou `estado` é levar o agendamento da outra a um vídeo que não é dela. Filha do episódio, com a empresa conferida pelo gatilho.' },
  { tabela: 'EnvioDeResposta', escopo: 'filho', chaveSql: '"id"', nota: 'A DM automática de um comentário da fila (MD11): o HMAC da pessoa, o item de lote da regra, se saiu e o id da mensagem na Meta. Ler a da outra é saber a quem ela respondeu e quando; escrever `travaDaPessoa` ou `estado` é fazer a outra mandar de novo, ou nunca mandar, a quem pediu o link. Filha do comentário, com a empresa conferida pelo gatilho.' },
  { tabela: 'PautaEpisodio', escopo: 'filho', chaveSql: '"id"', nota: 'O episódio da semana (MC7): roteiro, mídia do Mac, transcrição, títulos e a página de links. Ler o da outra é ler o que ela vai publicar antes de publicar; escrever `status` é mover o episódio alheio de etapa. Filho 1:1 da rodada, com a empresa conferida pelo gatilho — e a página de links também.' },

  // ---- rotinas (fatia 5.1) ----------------------------------------------
  { tabela: 'Rotina', escopo: 'tenant', chaveSql: '"id"', nota: 'O trabalho que roda sozinho na empresa (RF-N-04). O agendador dispara FORA de requisição e por isso abre o contexto de CADA empresa antes de ler — ver src/routines/rotinas.scheduler.ts. Ler a da outra revela o que ela automatizou e quando; ESCREVER é pior: mudar `estado` para `rodando` liga trabalho na empresa alheia, e mudar o `cron` muda a hora em que o modelo dela é chamado.' },
  { tabela: 'RotinaExecucao', escopo: 'tenant', chaveSql: '"id"', nota: 'O diário de bordo de cada passagem. Tem orgId PRÓPRIO (e não só o pai) porque a consulta da tela filtra por empresa direto, sem join — e porque uma policy que dependesse do pai deixaria a linha órfã de um DELETE em corrida sem dono por um instante.' },

  // ---- mapa público (fatia 6.5) -----------------------------------------
  { tabela: 'MapaPublicoItem', escopo: 'tenant', chaveSql: '"id"', nota: 'O que a empresa escolheu MOSTRAR na entrada pública do domínio (fatia 6.5). Ler a linha da outra é ler a vitrine dela antes de ela publicar — inclusive os RASCUNHOS, que é o caso que mais dói, porque rascunho é texto escrito para sair um dia e ainda não revisado. ESCREVER é pior por dois lados: preencher `publicadoEm` numa linha alheia PUBLICA na internet o rascunho da outra empresa, e apagar a linha derruba o que ela já publicou. A policy é a padrão, SEM cláusula de sentinela: a rota pública resolve a empresa por `Org.slug` (sob a sentinela, que só alcança `Org`) e lê esta tabela já DENTRO do contexto daquela empresa.' },

  // ---- assinatura e cobrança (fatia 6.2) --------------------------------
  { tabela: 'Assinatura', escopo: 'tenant', chaveSql: '"id"', nota: 'O contrato da empresa com a ROOT: plano, preço, ciclo, estado e — o que mais dói — `suspensaEm`, `perdoadasAte` e os identificadores no provedor de cobrança. LER a da outra é ler quanto o vizinho paga e em que condições, que é o dado que nenhuma carteira de clientes pode vazar. ESCREVER é pior de três jeitos, e todos são ação de negócio disfarçada de linha de banco: mudar `status` para `suspensa` DESLIGA a empresa alheia (o agendador de rotinas confere suspensão antes de disparar); mexer em `perdoadasAte` dá crédito de graça; e trocar `provedorAssinaturaId` aponta a cobrança de uma empresa para a conta de outra no provedor.' },
  { tabela: 'CobrancaDeAssinatura', escopo: 'tenant', chaveSql: '"id"', nota: 'Cada fatura, com vencimento, valor e `pagoEm`. Tem `orgId` PRÓPRIO e não só a assinatura-mãe, porque a tela e a conferência com o provedor filtram por empresa direto. LER a da outra é o extrato de pagamento dela; ESCREVER `pagoEm` numa linha alheia faz o sistema tratar como quitada uma fatura que ninguém pagou — e como é essa coluna que a reativação lê, é o caminho mais curto para ressuscitar uma empresa suspensa sem passar por dinheiro nenhum.' },

  // ---- console da plataforma (fatia 6.3) --------------------------------
  { tabela: 'EmpresaNaPlataforma', escopo: 'tenant', chaveSql: '"id"', nota: 'O registro COMERCIAL que a plataforma mantém sobre cada cliente (fatia 6.3): plano, estado, saúde, número de usuários, gasto de IA e mensalidade. A linha FALA de um cliente (`empresaId`) mas PERTENCE à empresa da plataforma (`orgId`) — e é por isso que ela entra aqui como qualquer outra: se a policy falhar, uma empresa cliente lê a carteira inteira da ROOT, com o que cada concorrente dela paga. ESCREVER é o outro lado: mudar `estado` para `encerrada` ou `cobrancaEmDia` para falso no registro alheio é mexer na relação comercial de outra pessoa.' },
  { tabela: 'AcessoDeSuporte', escopo: 'tenant', chaveSql: '"id"', nota: 'A autorização de suporte (fatia 6.3): a linha é da empresa CLIENTE, que é quem autoriza, vê e revoga. É a tabela que decide se um operador da plataforma entra na casa de alguém — ler a da outra empresa revela quem a ROOT está atendendo e por quê (o `motivo` é texto escrito pelo cliente); ESCREVER é conceder a si mesmo acesso à casa alheia, que é a fatia inteira ao contrário. Sem semente, o caso "A não lê linha de B" rodaria contra tabela vazia e passaria com qualquer policy — foi exatamente por não estar aqui que a primeira versão da fatia deixou a catraca VERMELHA.' },

  // ---- o cockpit do lead (módulo comercial, 13/10/2026) ------------------
  { tabela: 'ComercialFicha', escopo: 'filho', chaveSql: '"id"', nota: 'A ficha 1:1 do lead no funil comercial: etapa, perfil, pontuação, sistema, produto, valor, parcelas, CNPJ e o cadastro de quem assina. É a carteira comercial de uma empresa, campo a campo — LER a da outra é ler quem ela está fechando, por quanto e em que pé; ESCREVER etapa é mover o lead alheio de etapa por fora do portão.' },
  { tabela: 'ComercialConfig', escopo: 'tenant', chaveSql: '"id"', nota: 'Os interruptores do cockpit por empresa (envio automático, fechamento automático, silêncio aprova) e os números da régua de follow-up. ESCREVER envioAutomatico na empresa alheia liga o WhatsApp automático de outra casa; é decisão da mesa dela, não de quem alcançou a linha.' },
  { tabela: 'ComercialDecisao', escopo: 'filho', chaveSql: '"id"', nota: 'A fila de decisões: o que saiu da regra e espera gente, com padrão e prazo. LER a da outra expõe o desconto pedido e o contexto da negociação alheia; ESCREVER escolha é decidir pela mesa de outra empresa.' },
  { tabela: 'SalaDoCliente', escopo: 'filho', chaveSql: '"id"', nota: 'O link do cliente, com só o HASH do token. É achada pela sentinela pública (a rota anônima /api/sala/:token não tem empresa até achá-la), e por isso a LEITURA aceita a resolução pública — a escrita não. Vazamento aqui entrega o tokenCifrado e o dados da sala alheia.' },
  { tabela: 'ComercialMensagem', escopo: 'filho', chaveSql: '"id"', nota: 'Toda mensagem do WhatsApp do comercial, recebida ou a enviar: no provedor simulado esta tabela É o celular do lead e da mesa. LER a da outra é ler a conversa de venda alheia inteira; ESCREVER estado para enviada sem aprovação seria pular a fila R3.' },
  { tabela: 'ComercialReacao', escopo: 'filho', chaveSql: '"id"', nota: 'A trava de idempotência das reações por (eventoId, reacao). Linha de outra empresa visível faria a reação alheia parecer já executada; apagar a daqui faria a reação rodar duas vezes.' },
  { tabela: 'ComercialFechamento', escopo: 'filho', chaveSql: '"id"', nota: 'O fechamento com chave fech-<lead>-v<n> e as cinco escritas. ESCREVER estado para concluido na linha alheia faz a conta do mês da outra empresa contar um cliente que não existe.' },
  { tabela: 'ComercialCobranca', escopo: 'filho', chaveSql: '"id"', nota: 'Espelho das parcelas no provedor de cobrança: valor, vencimento, estado, link de pagamento e Pix copia-e-cola. LER a da outra é o extrato a receber dela; ESCREVER estado para paga quita uma parcela que ninguém pagou.' },
  { tabela: 'ComercialDocumento', escopo: 'filho', chaveSql: '"id"', nota: 'Espelho do contrato no provedor de assinatura, com os links de assinar. LER a da outra entrega o link que assina o contrato alheio.' },
  { tabela: 'LeadReacao', escopo: 'filho', chaveSql: '"id"', nota: 'O que o cliente leu na proposta e o que anotou nela (rodada da implantação I4): seção, tempo por visita, "faz sentido", dúvida e ideia com o texto dele. LER a da outra é ler como o cliente alheio reagiu à proposta e o que ele pensa dela; ESCREVER é pôr palavra na boca do cliente de outra casa ou apagar o termômetro dela. A rota anônima escreve aqui só DEPOIS de achar a empresa pelo hash na sala, então a leitura NÃO aceita a sentinela pública.' },

  // ---- trabalho ---------------------------------------------------------
  { tabela: 'WorkSpace', escopo: 'tenant', chaveSql: '"id"', nota: 'Topo da árvore espaço → pastas → listas (ROOT-16). O nome do espaço diz como a outra empresa organiza o trabalho dela; escrever nele é renomear ou esvaziar a árvore alheia. É raiz da empresa: o orgId vem do insert, e as pastas e listas penduradas nele conferem a empresa pela chave composta.' },
  { tabela: 'WorkFolder', escopo: 'tenant', chaveSql: '"id"', nota: 'Pasta de topo de um espaço ou pasta dentro de pasta; o pai é conferido pela chave composta com orgId.' },
  { tabela: 'WorkList', escopo: 'tenant', chaveSql: '"id"', nota: 'Pai de WorkStatus, que não tem orgId.' },
  { tabela: 'WorkStatus', escopo: 'filho', chaveSql: '"id"', nota: 'Referenciada por WorkTask.statusId: as duas empresas têm de bater.' },
  { tabela: 'WorkTag', escopo: 'tenant', chaveSql: '"id"', nota: 'Etiquetas do espaço.' },
  { tabela: 'WorkField', escopo: 'tenant', chaveSql: '"id"', nota: 'Campo personalizado; listId nulo = vale para o espaço todo.' },
  { tabela: 'WorkFieldOption', escopo: 'filho', chaveSql: '"id"', nota: 'Filha de WorkField; orgId derivado dele.' },
  { tabela: 'WorkTask', escopo: 'tenant', chaveSql: '"id"', nota: 'Auto-relação parentId para subtarefas dentro da org.' },
  { tabela: 'WorkFieldValue', escopo: 'filho', chaveSql: '"id"', nota: 'DOIS pais obrigatórios (WorkTask e WorkField) — os dois têm de ser da mesma org.' },
  { tabela: 'WorkComment', escopo: 'filho', chaveSql: '"id"', nota: 'Texto livre e authorName. Conteúdo de tenant que só a política de linha separa.' },
  { tabela: 'WorkApontamento', escopo: 'filho', chaveSql: '"id"', nota: 'Horas de gente por cliente e por etapa: diz quanto a empresa cobra e quanto gasta. Número comercial que a vizinha não pode ver.' },
  { tabela: 'AtaSugestao', escopo: 'tenant', chaveSql: '"id"', nota: 'A sugestão de tarefa lida de uma ata do Trabalho (rodada do painel P3): o título, o dono sugerido, o prazo e o TRECHO da reunião de onde saiu. Ler a da outra empresa é ler o que ela combinou em reunião e com quem; ESCREVER é pôr tarefa na fila de aceite dela, ou aceitar por ela. Raiz da empresa, não filha: a ata vive em duas tabelas e o orgId vem do insert.' },
  { tabela: 'CaixaVisto', escopo: 'tenant', chaveSql: '"id"', nota: 'O "limpei isto" da caixa de entrada (rodada do painel P1): quem leu qual evento de qual tarefa, e até quando limpou tudo. Ler a da outra empresa é saber o que cada pessoa dela já viu; ESCREVER é sumir com recado da caixa de alguém de outra casa. Raiz da empresa, não filha: o evento vive em duas tabelas e o orgId vem do insert.' },

  // ---- onboarding do cliente (23/09/2026) -------------------------------
  { tabela: 'OnboardingTrilho', escopo: 'tenant', chaveSql: '"id"', nota: 'O cliente na esteira de entrega da empresa que o entrega: fase, perfil, nível, receita, contato, portões (entrada compensada, linha de base, dupla). É a carteira comercial em andamento — ler a da outra é ler quem ela está fechando e em que pé; ESCREVER `fase` é mover o cliente alheio de fase sem portão.' },
  { tabela: 'OnboardingItem', escopo: 'filho', chaveSql: '"id"', nota: 'A proposta do agente e a resposta do cliente por tema (o que a empresa vende, as regras da casa, o número de partida). É o contexto confidencial do cliente de OUTRA empresa, dito numa reunião gravada.' },
  { tabela: 'OnboardingConvite', escopo: 'filho', chaveSql: '"id"', nota: 'O link público: hash do token e o token cifrado. Ler a linha alheia com a chave do ambiente na mão é montar o link do cliente de outra empresa e responder por ele. A LEITURA aceita a sentinela pública (é por ela que o link acha a empresa); a escrita não.' },
  { tabela: 'OnboardingAta', escopo: 'filho', chaveSql: '"id"', nota: 'O registro da leitura da ata: hash, tamanho, quantos segredos foram mascarados, custo. Não guarda a transcrição — mas diz que houve reunião, quando e quanto custou.' },
  { tabela: 'OnboardingMarco', escopo: 'filho', chaveSql: '"id"', nota: 'A linha do tempo do trilho, com as mensagens prontas de lembrete (o link dentro). Ler a alheia é ler o link do cliente da outra.' },

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

/**
 * Chaves que estão no registro de UMA org só para serem APAGADAS por ela, mas
 * que não pertencem a ela — hoje, a credencial de app com `orgId` NULL.
 *
 * Sem esta lista, a linha global entra como "chave da org A" e o caso
 * "B não lê linha de A em BioCredencialApp" acusa vazamento quando a policy está
 * CERTA: a regra declarada em `src/common/modelos-globais.ts` é justamente
 * `orgId = atual OR orgId IS NULL` na leitura, e a linha global TEM de aparecer
 * para as duas. Descoberto ligando o isolamento (11/09/2026) — antes disso a
 * tabela vazava por não ter policy nenhuma e o caso falhava pelo motivo certo.
 *
 * A assimetria que importa continua cobrada, e em caso próprio: "um tenant não
 * sobrescreve a credencial GLOBAL de todos" (seção 5).
 */
const CHAVES_SEM_DONO = new Set<string>();

/** Permission é catálogo GLOBAL — uma só, compartilhada pelas duas orgs. */
let permissaoCompartilhadaId = '';
/** Capability idem: catálogo da escada, um para todas as empresas. */
let capacidadeCompartilhadaId = '';

/**
 * A empresa B, já criada pelo PROVISIONAMENTO de verdade (RF-T-07).
 *
 * Preenchida no `beforeAll`, antes da transação de semeadura. Ver
 * "A org B nasce do provisionamento" logo abaixo.
 */
let tenantProvisionado: TenantDeTeste | null = null;

async function semear(c: PoolClient, rotulo: 'A' | 'B', vec: string): Promise<void> {
  const s = sementes[rotulo];
  const suf = `${MARCA}_${rotulo}`;
  const agora = new Date();
  const reg = (t: string, k: string) => registra(s, t, k);

  /*
   * AS DUAS ORGS NASCEM DE JEITOS DIFERENTES, E ISSO É O DESENHO.
   *
   * A org A é montada linha a linha aqui: uma empresa mínima, com UM papel e UM
   * usuário, moldada para o teste. A org B vem do `provisionarTenant` do
   * produto — nove papéis, catálogo de permissões, papel inicial, administrador
   * sem senha utilizável. Duas formas de empresa existir, o mesmo isolamento
   * cobrado das duas: se a policy só funcionasse na empresa que o teste desenhou,
   * a suíte estaria provando o próprio desenho.
   *
   * Era esse o buraco: a fatia 1.7 mandou o segundo tenant virar a fixture desta
   * suíte, e por um tempo houve TRÊS caminhos de semeadura (o produto, o ajudante
   * de teste e este arquivo). Agora são dois, e o ajudante é a ponte.
   */
  const doProvisionamento = rotulo === 'B' ? tenantProvisionado : null;

  // --- Org (a raiz: escopo pela própria PK) --------------------------------
  const orgId =
    doProvisionamento?.orgId ??
    (await ins(c, 'Org', { id: crypto.randomUUID(), name: `Org ${rotulo} ${MARCA}`, slug: `${suf}-org` }));
  s.orgId = orgId;
  s.slug = doProvisionamento?.provisionamento.slug ?? `${suf}-org`;
  reg('Org', orgId);

  // --- identidade e acesso -------------------------------------------------
  // email é @unique GLOBAL (schema.prisma:79), não @@unique([orgId, email]):
  // por isso o sufixo por org. Ver o teste "namespaces globais" mais abaixo.
  const userId =
    doProvisionamento?.adminUserId ??
    (await ins(c, 'User', {
      id: crypto.randomUUID(), orgId, name: `Usuário ${rotulo}`,
      email: `${suf}@isolamento.local`, passwordHash: 'nao-e-hash-real', updatedAt: agora,
    }));
  s.ref.userId = userId;

  const roleId =
    doProvisionamento?.papelInicialId ??
    (await ins(c, 'Role', { id: crypto.randomUUID(), orgId, key: `papel_${suf}`, name: `Papel ${rotulo}` }));
  s.ref.roleId = roleId;

  if (doProvisionamento) {
    // Tudo que o provisionamento criou (os nove papéis e o administrador) entra
    // na limpeza cirúrgica pelas chaves que ele devolveu. A Org já foi
    // registrada acima; o vínculo usuário-papel também já existe no banco.
    for (const [tabela, chavesDaTabela] of Object.entries(doProvisionamento.chaves)) {
      for (const chave of chavesDaTabela) if (chave !== orgId) reg(tabela, chave);
    }
  } else {
    reg('User', userId);
    reg('Role', roleId);
    await c.query('INSERT INTO "_UserRoles" ("A", "B") VALUES ($1, $2)', [roleId, userId]);
  }
  reg('_UserRoles', `${roleId}|${userId}`);

  // A permissão COMPARTILHADA é o que faz `_RolePermissions` ser testável pela
  // coluna B (Role) e não pela A (Permission, global). Vale para as duas orgs,
  // inclusive a que já veio com os vínculos do catálogo.
  await c.query(
    'INSERT INTO "_RolePermissions" ("A", "B") VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [permissaoCompartilhadaId, roleId],
  );
  reg('_RolePermissions', `${permissaoCompartilhadaId}|${roleId}`);

  const auditId = await ins(c, 'AuditLog', {
    id: crypto.randomUUID(), orgId, actorType: 'user', actorId: userId,
    action: `isolamento.semente.${rotulo}`, entityType: 'lead', entityId: crypto.randomUUID(),
    before: JSON.stringify({ segredo: `antes-${suf}` }), after: JSON.stringify({ segredo: `depois-${suf}` }),
  });
  reg('AuditLog', auditId);
  s.ref.auditId = auditId;

  reg('ChannelIdentity', await ins(c, 'ChannelIdentity', {
    id: crypto.randomUUID(), orgId, canal: 'whatsapp',
    externalId: `55119${rotulo === 'A' ? '1111111' : '2222222'}_${MARCA}`,
    userId, rotulo: `WhatsApp ${rotulo}`,
  }));

  /*
   * --- tripulação: agente, procedimento, sessão, passos e rastro ----------
   *
   * Entrou na semeadura em 11/09/2026, junto com as entradas correspondentes em
   * ALVOS. Sem dado destas seis tabelas, os casos "A não lê linha de B" nelas
   * passavam vazios: um `SELECT` sem WHERE em tabela vazia devolve zero linha
   * com policy certa, com policy errada e sem policy nenhuma.
   *
   * O conteúdo é de propósito o que DÓI vazar: missão do agente, pedido e
   * resposta da sessão, args da ferramenta, resumo do que está na fila de
   * aprovação. Se a policy cair, a mensagem de falha mostra o que saiu.
   */
  const agentId = await ins(c, 'Agent', {
    id: crypto.randomUUID(), orgId, slug: `agente_${suf}`, nome: `Agente ${rotulo}`,
    missao: `Missão interna e confidencial da org ${rotulo} (${MARCA}).`,
    capacidades: ['mcp.executar'], contextoFixo: [], atualizadoEm: agora,
  }, { capacidades: 'text[]', contextoFixo: 'text[]' });
  reg('Agent', agentId);
  s.ref.agentId = agentId;

  reg('Sop', await ins(c, 'Sop', {
    id: crypto.randomUUID(), orgId, agentId,
    proposito: `Procedimento operacional da org ${rotulo}`, gatilho: 'manual',
    passos: [`passo exclusivo da org ${rotulo}`], definicaoDePronto: 'entregue ao cliente',
    atualizadoEm: agora,
  }, { passos: 'text[]' }));

  const sessionId = await ins(c, 'Session', {
    id: crypto.randomUUID(), orgId, agentId, canal: 'web',
    solicitanteId: userId, solicitanteRotulo: `Usuário ${rotulo}`,
    pedido: `Pergunta confidencial da org ${rotulo} (${MARCA}).`,
    resposta: `Resposta com número interno da org ${rotulo}.`,
  });
  reg('Session', sessionId);
  s.ref.sessionId = sessionId;

  reg('SessionStep', await ins(c, 'SessionStep', {
    id: crypto.randomUUID(), orgId, sessionId, ordem: 1, tipo: 'pedido',
    texto: `Texto integral do passo da org ${rotulo}`,
    args: JSON.stringify({ segredo: `args-${suf}` }),
  }));

  reg('ToolCall', await ins(c, 'ToolCall', {
    id: crypto.randomUUID(), orgId, capabilityId: capacidadeCompartilhadaId, sessionId,
    agentSlug: `agente_${suf}`, actorType: 'ai', actorId: agentId, status: 'executado',
    args: JSON.stringify({ destino: `+5511${suf}` }),
    resultado: JSON.stringify({ enviado: true }),
  }));

  // O RASTRO. `seq` é único POR EMPRESA (@@unique([orgId, seq])), então 1 serve
  // às duas. A limpeza dele é o único lugar da suíte que suspende a RULE de
  // append-only — ver o `afterAll`.
  reg('EventLog', await ins(c, 'EventLog', {
    id: crypto.randomUUID(), orgId, seq: 1, tipo: 'isolamento.semente',
    actorType: 'system', agentSlug: `agente_${suf}`,
    payload: JSON.stringify({ marca: MARCA, org: rotulo }),
    hash: `hash_${suf}`, retencaoAte: new Date(Date.now() + 86_400_000),
  }));

  // Quanto tempo o rastro desta empresa fica (fatia 3.5). Diferente nas duas de
  // propósito: se a policy falhar, a linha que aparece é a da vizinha e o valor
  // denuncia de quem ela é.
  reg('RastroRetencao', await ins(c, 'RastroRetencao', {
    id: crypto.randomUUID(), orgId,
    dias: rotulo === 'A' ? 90 : 3650,
    motivo: `retenção combinada com o cliente da org ${rotulo}`,
    definidoPor: `pessoa_${suf}`,
    atualizadoEm: new Date(),
  }));

  // --- política e aprovação -----------------------------------------------
  // `PolicyVersion` tem orgId ANULÁVEL (nulo = a base de todas). Aqui vai a
  // versão POR EMPRESA; a base não é semeada porque ela já existe em banco com
  // `db:seed:politica` e não pertence a nenhuma das duas orgs.
  const policyVersionId = await ins(c, 'PolicyVersion', {
    id: crypto.randomUUID(), orgId, versao: 1,
    documento: JSON.stringify({ empresa: rotulo, teto: rotulo === 'A' ? 'R2' : 'R4' }),
    motivo: `Sobrescrita de política da org ${rotulo}`,
  });
  reg('PolicyVersion', policyVersionId);
  s.ref.policyVersionId = policyVersionId;

  reg('PolicyDecision', await ins(c, 'PolicyDecision', {
    id: crypto.randomUUID(), orgId, capabilityId: capacidadeCompartilhadaId, policyVersionId,
    nivelBase: 'R0', nivel: 'R0', permitido: true, exigeAprovacao: false,
    sinais: [`sinal_${suf}`], motivo: `Decisão registrada da org ${rotulo}`,
  }, { sinais: 'text[]' }));

  reg('Approval', await ins(c, 'Approval', {
    id: crypto.randomUUID(), orgId, capabilityId: capacidadeCompartilhadaId,
    propostoPorId: agentId, propostoPorTipo: 'ai',
    resourceType: 'pauta_peca', resourceId: crypto.randomUUID(),
    contentHash: `conteudo_${suf}`,
    resumo: `Texto que a org ${rotulo} vai publicar (${MARCA}).`,
    tokenHash: `token_${suf}`, expiraEm: new Date(Date.now() + 3600_000),
  }));

  // O lote de aprovação (MD7) e um item dele — o item sem orgId: a empresa
  // vem do lote, pelo gatilho.
  const loteId = await ins(c, 'AprovacaoDeLote', {
    id: crypto.randomUUID(), orgId, capabilityId: 'pauta.semana.aprovar', recursoTipo: 'pauta_episodio',
    recursoId: crypto.randomUUID(), hashConteudo: `lote_${suf}`, estado: 'ativo',
    validaAte: new Date(Date.now() + 86_400_000), propostoPorId: `pessoa_${suf}`,
    resumo: `A semana da org ${rotulo} (${MARCA})`, atualizadoEm: new Date(),
  });
  reg('AprovacaoDeLote', loteId);
  s.ref.aprovacaoDeLoteId = loteId;
  reg('ItemDoLote', await ins(c, 'ItemDoLote', {
    id: crypto.randomUUID(), loteId, capabilityId: 'instagram.post.publicar', recursoId: crypto.randomUUID(),
    hashItem: `item_${suf}`, janelaDe: new Date(), janelaAte: new Date(Date.now() + 7_200_000),
  }));

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

  // Fatia 3.7 — o desligamento de conector por empresa (RF-G-06).
  reg('ConectorDesligado', await ins(c, 'ConectorDesligado', {
    id: crypto.randomUUID(), orgId, conector: 'gmail',
    motivo: `Suspensão da org ${rotulo} (${MARCA})`, desligadoPor: userId,
  }));

  // Fatia 5.3 — o COFRE (RF-C-01). O `valorCifrado` aqui é texto de mentira com
  // a MARCA dentro, e é de propósito: o que esta suíte mede é se a LINHA
  // aparece para a outra empresa, e um criptograma de verdade tornaria a falha
  // ilegível no diagnóstico. A prova de que o valor não abre na empresa errada
  // (o dado associado do GCM) é outra, e mora em `test/cofre.test.ts`.
  reg('SegredoDeConector', await ins(c, 'SegredoDeConector', {
    id: crypto.randomUUID(), orgId, conector: 'google', nome: 'access_token',
    valorCifrado: `c2.env.NAO-E-CRIPTOGRAMA.${rotulo}.${MARCA}`, chaveId: 'env',
    escopo: ['gmail.send'], origem: 'teste-isolamento',
    criadoEm: agora, atualizadoEm: agora,
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

  // --- a MEMÓRIA (fatia 4.1+4.2): nota de contexto + o histórico dela --------
  //
  // A ORDEM IMPORTA: `ContextItem` antes de `ContextItemVersion`, porque a
  // limpeza percorre `ORDEM_LIMPEZA` ao contrário e a filha tem de sair antes.
  // (A cascata da chave estrangeira daria conta, mas a limpeza é cirúrgica por
  // chave e não por tabela — depender da cascata deixaria linha para trás no dia
  // em que alguém mudar o `onDelete`.)
  //
  // MESMO VETOR do `KnowledgeNote` desta org, de propósito: o caso de busca
  // vetorial cruzada exige que a linha de B seja a vizinha MAIS PRÓXIMA da
  // consulta, e é o que faz um vazamento ser determinístico em vez de sorte.
  const contextoId = await ins(c, 'ContextItem', {
    id: crypto.randomUUID(), orgId, chave: `vault:regras/${suf}.md`, kind: 'regra',
    title: `Regra da casa ${rotulo}`,
    body: `Regra secreta da org ${rotulo} (${MARCA}): desconto máximo, alçada e exceções.`,
    tags: ['regra'], sourceType: 'vault', sourceRef: `regras/${suf}.md`,
    confidence: 1, embedding: vec, contentHash: `hash_${suf}`, versao: 1,
    criadoEm: agora, atualizadoEm: agora,
  }, { tags: 'text[]', embedding: 'vector' });
  reg('ContextItem', contextoId);
  s.ref.contextoId = contextoId;

  reg('ContextItemVersion', await ins(c, 'ContextItemVersion', {
    id: crypto.randomUUID(), orgId, itemId: contextoId, versao: 1, mudanca: 'criacao',
    kind: 'regra', title: `Regra da casa ${rotulo}`,
    body: `Regra secreta da org ${rotulo} (${MARCA}): desconto máximo, alçada e exceções.`,
    sourceType: 'vault', sourceRef: `regras/${suf}.md`, contentHash: `hash_${suf}`,
    motivo: `semente de isolamento ${rotulo}`, autorTipo: 'user', autorId: userId,
  }));

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
    // MD5: cada empresa com a SUA conta de publicação — o índice parcial é por empresa.
    status: 'ok', atualizadaEm: agora, finalidade: 'publicacao', escopos: 'instagram_business_basic,instagram_business_content_publish',
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
    id: crypto.randomUUID(), estado: `state_${suf}`, orgId, plataforma: 'instagram', finalidade: 'publicacao',
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

  const pecaId = await ins(c, 'PautaPeca', {
    id: crypto.randomUUID(), orgId, rodadaId, canal: 'whatsapp', formato: 'texto',
    titulo: `Peça ${rotulo}`, corpo: `Texto que vai para o grupo da org ${rotulo}`, status: 'rascunho',
  });
  reg('PautaPeca', pecaId);
  s.ref.pautaPecaId = pecaId;

  // O banco de ideias (MK3): raiz da empresa, sem rodada e sem episódio.
  reg('PautaIdeia', await ins(c, 'PautaIdeia', {
    id: crypto.randomUUID(), orgId, pilar: 'bastidores', titulo: `Ideia ${rotulo}`,
    ganchoFala: `Gancho falado da org ${rotulo} ${MARCA}`, formato: 'carrossel',
    porque: `Por que a org ${rotulo} quer dizer isto ${MARCA}`, atualizadaEm: agora,
  }));

  // A publicação no Instagram (MD6): filha da peça, a empresa pelo gatilho.
  reg('PautaPublicacao', await ins(c, 'PautaPublicacao', {
    id: crypto.randomUUID(), pecaId, rede: 'instagram', estado: 'erro',
    erro: `Motivo privado da org ${rotulo} ${MARCA}`, atualizadaEm: agora,
  }));

  // A fila da DM à mão (MD9): filha da peça, a empresa pelo gatilho.
  const comentarioId = await ins(c, 'ComentarioComPalavra', {
    id: crypto.randomUUID(), pecaId, commentId: `comentario_${suf}`, midiaId: `midia_${suf}`, palavra: 'AGENTES',
    pessoaHmac: `hmac_${suf}`, usuario: `pessoa_privada_${suf}`, comentadoEm: agora, expiraEm: new Date(agora.getTime() + 7 * 86_400_000),
  });
  reg('ComentarioComPalavra', comentarioId);
  s.ref.comentarioComPalavraId = comentarioId;

  // A DM automática do comentário (MD11): filha do comentário, a empresa pelo gatilho.
  reg('EnvioDeResposta', await ins(c, 'EnvioDeResposta', {
    id: crypto.randomUUID(), comentarioId, loteItemId: `item_${suf}`, pessoaHmac: `hmac_${suf}`,
    travaDaPessoa: `item_${suf}:hmac_${suf}`, estado: 'enviado', mensagemId: `mensagem_privada_${suf}`,
    expiraEm: new Date(agora.getTime() + 90 * 86_400_000), atualizadoEm: agora,
  }));

  // O episódio (MC7): filho 1:1 da rodada, com a página de links da mesma empresa.
  const episodioId = await ins(c, 'PautaEpisodio', {
    id: crypto.randomUUID(), orgId, rodadaId, numero: 1, titulo: `Episódio ${rotulo} ${MARCA}`,
    roteiro: `Roteiro privado da org ${rotulo}`, bioPageId: s.ref.bioPageId, atualizadoEm: agora,
  });
  reg('PautaEpisodio', episodioId);

  // O vídeo a caminho do YouTube (MD10): filho do episódio, a empresa pelo gatilho.
  reg('EnvioAoYoutube', await ins(c, 'EnvioAoYoutube', {
    id: crypto.randomUUID(), episodioId, sha256: 'a'.repeat(64), bytes: 1024, estado: 'sessao_aberta',
    sessaoCifrada: `sessao_privada_${suf}`, videoId: `video_privado_${suf}`, atualizadoEm: agora,
  }));

  // --- rotinas (fatia 5.1) -------------------------------------------------
  // A `Rotina` aqui é `manual` de propósito, e não o espelho da `PautaRotina`
  // acima: o espelho é criado pela reconciliação, dentro do contexto da empresa,
  // e semeá-lo à mão faria esta suíte depender de um detalhe do agendador para
  // medir uma coisa que é do banco.
  const rotinaOsId = await ins(c, 'Rotina', {
    id: crypto.randomUUID(), orgId, slug: `rotina_os_${suf}`, nome: `Rotina do OS ${rotulo} ${MARCA}`,
    tipo: 'pauta.rodada', cron: '0 9 * * *', tz: 'America/Sao_Paulo', ativo: true,
    // `estado` é enum e vai SEM cast: o Postgres deduz o tipo pela coluna de
    // destino, e um `::AgentEstado` sem aspas viraria `agentestado`.
    estado: 'rodando', origem: 'manual', atualizadaEm: agora,
  });
  reg('Rotina', rotinaOsId);

  reg('RotinaExecucao', await ins(c, 'RotinaExecucao', {
    id: crypto.randomUUID(), orgId, rotinaId: rotinaOsId, status: 'ok', origem: 'cron',
    inicioEm: agora, fimEm: agora, duracaoMs: 42, resumo: `Passagem da org ${rotulo} ${MARCA}`,
  }));

  // --- mapa público (fatia 6.5) --------------------------------------------
  // PUBLICADA de propósito: o que esta suíte mede é o isolamento POR EMPRESA, e
  // linha não publicada seria indistinguível de linha ausente para metade dos
  // casos. Quem mede a marca de publicação é `test/mapa-publico.test.ts`, que
  // semeia as duas formas na mesma empresa.
  reg('MapaPublicoItem', await ins(c, 'MapaPublicoItem', {
    id: crypto.randomUUID(), orgId, eixo: 'nucleo', chave: 'nucleo', ordem: 0,
    rotulo: `Vitrine ${rotulo} ${MARCA}`, detalhe: `Texto público da org ${rotulo}`,
    tom: 'brand', publicadoEm: agora, publicadoPor: 'suite', atualizadoEm: agora,
  }));

  // --- console da plataforma (fatia 6.3) -----------------------------------
  /*
   * As duas tabelas do console entram na semente porque o isolamento delas só é
   * MEDIDO se houver linha. A primeira versão da fatia 6.3 as deixou fora do
   * registro: a catraca "o registro da suíte cobre exatamente as tabelas de
   * empresa do banco" ficou vermelha, e — pior — o isolamento das duas nunca era
   * medido pela suíte permanente, só pela seção condicional da própria fatia,
   * que exige duas variáveis de ambiente para existir.
   *
   * `EmpresaNaPlataforma` é semeada com `orgId` = a PRÓPRIA org e `empresaId`
   * apontando para a outra. É o desenho de produção invertido de propósito: as
   * duas orgs viram "plataforma" uma da outra, e aí o caso "A não lê linha de B"
   * mede exatamente o que interessa — que o registro comercial de uma não
   * aparece para a outra. Semear as duas linhas na mesma org faria a metade do
   * par ficar sem dono e o caso passaria por ausência.
   */
  reg('EmpresaNaPlataforma', await ins(c, 'EmpresaNaPlataforma', {
    id: crypto.randomUUID(), orgId, empresaId: `cliente_de_${suf}`,
    nome: `Cliente de ${rotulo} ${MARCA}`, slug: `cliente-de-${rotulo.toLowerCase()}`,
    plano: 'piloto', estado: 'ativa', saude: 'ok',
    usuarios: rotulo === 'A' ? 3 : 9, mensalidadeBrl: rotulo === 'A' ? 1500 : 9900,
    atualizadoEm: agora,
  }));

  reg('AcessoDeSuporte', await ins(c, 'AcessoDeSuporte', {
    id: crypto.randomUUID(), orgId, operadorEmail: `op.${rotulo.toLowerCase()}@operacaoroot.com`,
    escopo: 'diagnostico', motivo: `motivo escrito pela org ${rotulo} ${MARCA}`,
    autorizadoPorId: userId, autorizadoPorNome: `Titular ${rotulo}`,
    autorizadoEm: agora, expiraEm: new Date(agora.getTime() + 3_600_000),
  }));

  // --- assinatura e cobrança (fatia 6.2) -----------------------------------
  /*
   * A assinatura nasce ATIVA nas duas orgs, e não uma ativa e outra suspensa.
   * Tentador fazer diferente — pareceria medir mais —, e seria um erro: o
   * agendador de rotinas RECUSA disparar empresa suspensa, e metade dos casos
   * desta suíte roda dentro do contexto de uma empresa e da outra. Uma semente
   * suspensa apagaria comportamento que nada aqui pretende medir, e a queda
   * apareceria longe daqui, como "a rotina da org B não roda", sem pista.
   *
   * Quem mede suspensão, carência e reativação é `test/assinatura.test.ts`, na
   * mesma empresa. Aqui a pergunta é só uma: a linha de A aparece para B?
   */
  const assinaturaId = await ins(c, 'Assinatura', {
    id: crypto.randomUUID(), orgId, plano: `plano-${rotulo.toLowerCase()} ${MARCA}`,
    valorCentavos: rotulo === 'A' ? 150_000 : 990_000, ciclo: 'mensal', status: 'ativa',
    provedor: 'asaas', provedorClienteId: `cus_${suf}`, provedorAssinaturaId: `sub_${suf}`,
    atualizadoEm: agora,
  });
  reg('Assinatura', assinaturaId);

  reg('CobrancaDeAssinatura', await ins(c, 'CobrancaDeAssinatura', {
    id: crypto.randomUUID(), orgId, assinaturaId,
    // `referencia` é única POR EMPRESA (@@unique([orgId, referencia])): o mesmo
    // texto nas duas orgs é de propósito — se a policy falhar no INSERT, a
    // colisão aparece como erro de chave em vez de passar despercebida.
    referencia: '2026-09', valorCentavos: rotulo === 'A' ? 150_000 : 990_000,
    // `aberta` — o vocabulário é fechado por CHECK no banco ('aberta' | 'paga' |
    // 'vencida' | 'cancelada'). "pendente" parece o mesmo e é recusado no INSERT.
    vencimento: new Date(agora.getTime() + 5 * 86_400_000), status: 'aberta',
  }));

  // --- trabalho ------------------------------------------------------------
  const espacoId = await ins(c, 'WorkSpace', { id: crypto.randomUUID(), orgId, name: `Espaço ${rotulo} ${MARCA}`, updatedAt: agora });
  reg('WorkSpace', espacoId);

  const pastaId = await ins(c, 'WorkFolder', { id: crypto.randomUUID(), orgId, spaceId: espacoId, name: `Pasta ${rotulo} ${MARCA}`, updatedAt: agora });
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

  reg('WorkApontamento', await ins(c, 'WorkApontamento', {
    id: crypto.randomUUID(), orgId, taskId: tarefaId, autorId: userId,
    autorNome: `Usuário ${rotulo}`, minutos: rotulo === 'A' ? 90 : 45, dia: '2026-09-15',
    etapa: 'Implantação', nota: `Horas privadas da org ${rotulo}`,
  }));
  // A caixa de entrada (rodada do painel P1): a marca pessoal de "limpei".
  reg('CaixaVisto', await ins(c, 'CaixaVisto', {
    id: crypto.randomUUID(), orgId, userId, origem: 'comentario',
    eventoId: `comentario_${rotulo}_${MARCA}`,
  }));

  // O banco de atas do Trabalho (rodada do painel P3): a sugestão de tarefa.
  reg('AtaSugestao', await ins(c, 'AtaSugestao', {
    id: crypto.randomUUID(), orgId, ataRef: `memoria:ata_${rotulo}_${MARCA}`,
    titulo: `Tarefa combinada na reunião da org ${rotulo}`, trecho: `Trecho privado da ata da org ${rotulo}`,
    estado: 'rascunho', atualizadaEm: new Date(),
  }));

  // Onboarding do cliente (23/09/2026): o trilho e os quatro filhos.
  const trilhoId = await ins(c, 'OnboardingTrilho', {
    id: crypto.randomUUID(), orgId, cliente: `Cliente ${rotulo} ${MARCA}`, slug: `cliente-${rotulo.toLowerCase()}-${suf}`,
    fase: 'contrato', perfil: 'P2', nivel: 'entregar-pronto', contatoNome: `Contato ${rotulo}`,
    portoes: JSON.stringify({ entradaCompensadaEm: '2026-09-20' }), atualizadoEm: agora,
  }, { fase: '"OnboardingFase"', portoes: 'jsonb' });
  reg('OnboardingTrilho', trilhoId);
  s.ref.onboardingTrilhoId = trilhoId;

  reg('OnboardingItem', await ins(c, 'OnboardingItem', {
    id: crypto.randomUUID(), orgId, trilhoId, temaId: 'negocio', bloco: 'B', origem: 'ata', tipo: 'literal',
    proposta: `Proposta privada da org ${rotulo}`, fonteTrecho: 'trecho', status: 'aprovado', atualizadoEm: agora,
  }));
  reg('OnboardingConvite', await ins(c, 'OnboardingConvite', {
    id: crypto.randomUUID(), orgId, trilhoId, blocos: 'BCD', tokenHash: `hash_${rotulo}_${suf}`,
    validoAte: new Date(agora.getTime() + 14 * 86_400_000),
  }));
  reg('OnboardingAta', await ins(c, 'OnboardingAta', {
    id: crypto.randomUUID(), orgId, trilhoId, fonte: 'texto', caracteres: 1000, hash: `ata_${rotulo}_${suf}`,
  }));
  reg('OnboardingMarco', await ins(c, 'OnboardingMarco', {
    id: crypto.randomUUID(), orgId, trilhoId, tipo: 'trilho.criado', texto: `Marco privado da org ${rotulo}`,
    dados: JSON.stringify({}),
  }, { dados: 'jsonb' }));

  // O cockpit do lead (13/10/2026): a ficha 1:1, a configuração e os sete filhos do fio.
  reg('ComercialFicha', await ins(c, 'ComercialFicha', {
    id: crypto.randomUUID(), orgId, leadId, etapa: 'proposta', etapaDesde: agora, empresa: `Empresa ${rotulo} ${MARCA}`,
    cnpj: rotulo === 'A' ? '11111111000191' : '22222222000191', perfil: 'P2', pontuacao: 82, produto: 'operacao',
    valorCentavos: 1199700, parcelas: 3, parcelaCentavos: 399900, propostaVersao: 1, atualizadoEm: agora,
  }, { etapa: '"ComercialEtapa"' }));
  reg('ComercialConfig', await ins(c, 'ComercialConfig', {
    id: crypto.randomUUID(), orgId, envioAutomatico: rotulo === 'A', janelaDeVetoMinutos: 30,
    autonomia: JSON.stringify({ qualificador: 'A3' }), atualizadoEm: agora,
  }, { autonomia: 'jsonb' }));
  reg('ComercialDecisao', await ins(c, 'ComercialDecisao', {
    id: crypto.randomUUID(), orgId, leadId, tipo: 'proposta_fora_da_tabela', titulo: `Decisão privada da org ${rotulo}`,
    contexto: 'pediu 8% de desconto', opcoes: JSON.stringify([{ chave: 'manter', rotulo: 'manter o preço' }]), padrao: 'manter',
    expiraEm: new Date(agora.getTime() + 3_600_000),
  }, { opcoes: 'jsonb' }));
  reg('SalaDoCliente', await ins(c, 'SalaDoCliente', {
    id: crypto.randomUUID(), orgId, leadId, slug: `sala-${rotulo.toLowerCase()}-${suf}`, tokenHash: `sala_${rotulo}_${suf}`,
    validoAte: new Date(agora.getTime() + 86_400_000), dados: JSON.stringify({ horariosOferecidos: [] }), atualizadoEm: agora,
  }, { dados: 'jsonb' }));
  reg('ComercialMensagem', await ins(c, 'ComercialMensagem', {
    id: crypto.randomUUID(), orgId, leadId, direcao: 'saida', provedor: 'simulado', template: 'M1',
    texto: `Mensagem privada da org ${rotulo}`, estado: 'rascunho',
  }));
  reg('ComercialReacao', await ins(c, 'ComercialReacao', {
    id: crypto.randomUUID(), orgId, leadId, eventoId: crypto.randomUUID(), reacao: 'abrir-sala', estado: 'ok',
  }));
  reg('ComercialFechamento', await ins(c, 'ComercialFechamento', {
    id: crypto.randomUUID(), orgId, leadId, chave: `fech-${leadId}-v1`, versao: 1, estado: 'pendente',
    escritas: JSON.stringify([]), atualizadoEm: agora,
  }, { escritas: 'jsonb' }));
  reg('ComercialCobranca', await ins(c, 'ComercialCobranca', {
    id: crypto.randomUUID(), orgId, leadId, provedor: 'asaas', externoId: `pay_${rotulo}_${suf}`, parcela: 1, parcelas: 3,
    valorCentavos: 399900, forma: 'pix', vence: agora, estado: 'pendente', atualizadoEm: agora,
  }));
  reg('ComercialDocumento', await ins(c, 'ComercialDocumento', {
    id: crypto.randomUUID(), orgId, leadId, provedor: 'zapsign', externoId: `doc_${rotulo}_${suf}`, estado: 'criado',
    hashConteudo: `h_${rotulo}_${suf}`, atualizadoEm: agora,
  }));
  // A reação na página da proposta (I4): uma ideia com texto, que é o que não pode vazar.
  reg('LeadReacao', await ins(c, 'LeadReacao', {
    id: crypto.randomUUID(), orgId, leadId, versao: 1, secao: 'investimento', tipo: 'ideia',
    texto: `Ideia privada do cliente da org ${rotulo}`, acesso: 1, atualizadoEm: agora,
  }));

  await c.query('INSERT INTO "_WorkTaskTags" ("A", "B") VALUES ($1, $2)', [tagId, tarefaId]);
  reg('_WorkTaskTags', `${tagId}|${tarefaId}`);

  // --- teto de custo de IA (fatia 3.6) -------------------------------------
  // Duas linhas por empresa, com valores DIFERENTES entre A e B: o caso "A não
  // lê linha de B" precisa que a linha vizinha exista, e o teto é justamente o
  // tipo de número que uma empresa não pode ver nem mexer na outra.
  reg('TetoDeCustoIa', await ins(c, 'TetoDeCustoIa', {
    id: crypto.randomUUID(), orgId,
    tetoDiarioUsd: rotulo === 'A' ? 12.5 : 99.75,
    fusoHorario: 'America/Sao_Paulo', ativo: true,
    motivo: `Teto combinado com a org ${rotulo}`,
    definidoEm: agora, criadoEm: agora, atualizadoEm: agora,
  }));

  reg('GastoDeIaNoDia', await ins(c, 'GastoDeIaNoDia', {
    id: crypto.randomUUID(), orgId, dia: '2026-09-11',
    gastoUsd: rotulo === 'A' ? 1.25 : 7.5,
    gastoEstimadoUsd: 0, reservadoUsd: 0,
    chamadas: rotulo === 'A' ? 3 : 40, chamadasSemPreco: 0, cortes: 0,
    criadoEm: agora, atualizadoEm: agora,
  }));
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

/*
 * O estado do PAPEL DE APLICAÇÃO (fatia 1.3).
 *
 * A pergunta que este bloco responde é anterior a qualquer policy: existe no
 * banco um papel que NÃO seja dono das tabelas e que NÃO atravesse RLS? Sem ele,
 * ligar isolamento por linha não muda nada — o Postgres só cobra policy do dono
 * com FORCE ROW LEVEL SECURITY —, e esta suíte inteira mediria o vazio.
 */
interface EstadoDoPapel {
  existe: boolean;
  entra: boolean;
  superusuario: boolean;
  atravessaRls: boolean;
  criaNoSchema: boolean;
  veMigrations: boolean;
  alteraRastro: boolean;
  apagaRastro: boolean;
  truncaRastro: boolean;
  padraoParaTabelaNova: string;
}
let papel: EstadoDoPapel = {
  existe: false, entra: false, superusuario: false, atravessaRls: false,
  criaNoSchema: false, veMigrations: false, alteraRastro: false,
  apagaRastro: false, truncaRastro: false, padraoParaTabelaNova: '',
};

async function carregarEstadoDoPapel(): Promise<void> {
  const existe = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [PAPEL_DE_APLICACAO]);
  if (!existe.rowCount) return;

  // `has_*_privilege` responde pelo papel mesmo sem conectar com ele — é o que
  // permite conferir permissão num banco onde ele ainda nem tem senha.
  const r = await admin.query<EstadoDoPapel>(
    `SELECT true                                                          AS existe,
            r.rolcanlogin                                                 AS entra,
            r.rolsuper                                                    AS superusuario,
            r.rolbypassrls                                                AS "atravessaRls",
            has_schema_privilege($1, 'public', 'CREATE')                  AS "criaNoSchema",
            has_table_privilege($1, '_prisma_migrations', 'SELECT')       AS "veMigrations",
            has_table_privilege($1, '"EventLog"', 'UPDATE')               AS "alteraRastro",
            has_table_privilege($1, '"EventLog"', 'DELETE')               AS "apagaRastro",
            has_table_privilege($1, '"EventLog"', 'TRUNCATE')             AS "truncaRastro",
            -- ALTER DEFAULT PRIVILEGES é POR PAPEL CRIADOR: cada linha de
            -- pg_default_acl diz "o que <defaclrole> criar nasce com esta ACL".
            -- Sem o filtro abaixo (e com um LIMIT 1 no lugar dele) a consulta
            -- pegava uma linha QUALQUER — medido num banco com dois papéis
            -- tendo padrão em public, ela devolveu a do outro papel e o caso
            -- reprovaria com o padrão do mktos_app intacto. O que interessa é
            -- o padrão de quem RODA AS MIGRATIONS, que é esta conexão: é ela
            -- que vai criar a tabela da próxima migration.
            -- (defaclrole, defaclnamespace, defaclobjtype) é único, então a
            -- subconsulta filtrada devolve no máximo uma linha — sem LIMIT.
            COALESCE((SELECT array_to_string(d.defaclacl, ',')
                        FROM pg_default_acl d
                        JOIN pg_namespace n ON n.oid = d.defaclnamespace
                       WHERE n.nspname = 'public'
                         AND d.defaclobjtype = 'r'
                         AND d.defaclrole = current_user::regrole), '')    AS "padraoParaTabelaNova"
       FROM pg_roles r
      WHERE r.rolname = $1`,
    [PAPEL_DE_APLICACAO],
  );
  if (r.rows[0]) papel = r.rows[0];
}

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

  await carregarEstadoDoPapel();
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

/**
 * Liga o isolamento antes de medir — e por que isso não é "o teste se dando o
 * verde de presente".
 *
 * A migration `20260911050000_isolamento_por_linha` já deixa RLS e FORCE ligados
 * em toda tabela. Esta chamada é AUTO-CURA: a seção de RLS de
 * `rotas-publicas-tenant.test.ts` desliga as 11 tabelas dela no fim (ela cria
 * policies próprias, com outro nome, para provar a fatia 1.4), e um banco local
 * onde aquela suíte rodou por último chegaria aqui com parte do isolamento
 * desligado. Vermelho por causa de um restinho de outra suíte é o pior tipo de
 * vermelho: some quando você olha.
 *
 * O que ela NÃO faz é criar policy. `app_rls_ligar()` só ENABLE/FORCE nas
 * tabelas que JÁ têm policy `tenant_%` — se a migration não tiver rodado, não há
 * o que ligar e a suíte reprova como deve.
 */
async function ligarIsolamento(): Promise<void> {
  try {
    const r = await admin.query<{ n: number }>('SELECT app_rls_ligar() AS n');
    console.info(`[isolamento] app_rls_ligar(): ${r.rows[0]?.n ?? 0} tabela(s) com RLS e FORCE.`);
  } catch (e) {
    console.error(
      `\n[isolamento] não deu para ligar o isolamento: ${(e as Error).message}\n` +
        '            A migration 20260911050000_isolamento_por_linha aplicou neste banco?\n' +
        '            `pnpm --filter @mktos/api db:deploy` com a DATABASE_URL deste banco.\n',
    );
  }
}

beforeAll(async () => {
  await ligarIsolamento();
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

  /*
   * A ORG B NASCE DO PROVISIONAMENTO — RF-T-07, fatia 1.7.
   *
   * Fora da transação de semeadura de propósito: `provisionarTenant` abre e
   * fecha a transação DELE (é o que garante que empresa nunca fique pela
   * metade), e uma transação do Prisma não tem como correr por dentro de um
   * `BEGIN` aberto noutra conexão. Quando esta chamada devolve, a empresa já
   * está commitada — e é por isso que o `BEGIN` logo abaixo pode referenciá-la
   * sem esperar por lock nenhum.
   *
   * A limpeza continua cirúrgica: as chaves vêm em `chaves` e entram no registro
   * de limpeza dentro de `semear`, junto com o resto do dado da org B. Se esta
   * chamada passar e a transação seguinte falhar, o `afterAll` ainda apaga o que
   * ela criou (os hooks de fim rodam mesmo com `beforeAll` vermelho).
   */
  const prismaProvisionamento = new PrismaClient({ datasourceUrl: URL_ADMIN });
  try {
    tenantProvisionado = await provisionarTenantDeTeste(prismaProvisionamento, {
      // Slug tem gramática própria (minúsculas, dígitos e hífen): a MARCA usa
      // sublinhado e não serve. O par continua único por rodada.
      slug: `iso-b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      nome: `Org B ${MARCA}`,
      admin: { email: `${MARCA}_B@isolamento.local`, nome: 'Usuário B' },
    });
  } finally {
    await prismaProvisionamento.$disconnect();
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
    // Fica no registro da A só para a limpeza alcançá-la; não é dela (ver
    // `CHAVES_SEM_DONO`).
    registra(sementes.A, 'BioCredencialApp', credGlobalId);
    CHAVES_SEM_DONO.add(credGlobalId);

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
      if (tabela === 'EventLog') {
        /*
         * O RASTRO não se apaga — nem pelo DONO. As RULEs `eventlog_sem_delete`
         * e `eventlog_sem_update` são `DO INSTEAD NOTHING`, então um DELETE aqui
         * não erraria: ele sairia com "DELETE 0" e a remoção da `Org` logo
         * abaixo quebraria com violação de chave estrangeira, que é um jeito
         * ruim de descobrir isso.
         *
         * Este é o ÚNICO lugar do repositório que suspende a RULE, e ele é
         * limpeza de suíte num banco descartável. Suspender exige ser DONO da
         * tabela (`ALTER TABLE` é DDL), que é exatamente o que a aplicação NUNCA
         * é depois da virada — o caso "não altera, não apaga e não trunca o
         * RASTRO" continua medindo isso pelo lado do papel restrito.
         *
         * Dentro da transação de limpeza de propósito: DDL é transacional no
         * Postgres, então uma falha no meio devolve a RULE sozinha.
         */
        await c.query('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete');
        try {
          await c.query('DELETE FROM "EventLog" WHERE "id" = ANY($1::text[])', [chaves]);
        } finally {
          await c.query('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete');
        }
        continue;
      }
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
// 1-bis. A CATRACA DO CATÁLOGO — o que segura a TABELA DE AMANHÃ
//
// A seção 2 mede o isolamento com dado semeado, e por isso só alcança o que está
// em ALVOS. Tabela nova entra no schema sem passar por lá, e passaria por aqui
// sem policy, sem RLS e sem ninguém notar — até vazar.
//
// Esta seção não semeia nada: pergunta ao CATÁLOGO do Postgres se toda tabela do
// banco está sob isolamento, e cobra que as exceções sejam DECLARADAS. É a única
// parte da suíte que continua valendo quando alguém acrescentar a 74ª tabela.
// ---------------------------------------------------------------------------

/**
 * As tabelas que NÃO recebem isolamento por linha, e por quê.
 *
 * "Lista de exceções com motivo, nunca silêncio" — é o enunciado da fatia. Hoje
 * tem uma entrada só, e é bom que continue difícil acrescentar outra: cada linha
 * daqui é uma tabela que o banco deixa de proteger.
 */
const SEM_ISOLAMENTO: ReadonlyArray<{ tabela: string; porQue: string }> = [
  {
    tabela: '_prisma_migrations',
    porQue:
      'controle do Prisma Migrate, não dado de aplicação. Ligar RLS nela quebra o arranque do ' +
      'próprio Migrate, e o papel restrito já não tem permissão nenhuma ali (REVOKE ALL na ' +
      'migration 20260911020000_papel_de_aplicacao).',
  },
];

/**
 * A raiz de `apps/api`, achada por um marco em vez de por caminho relativo.
 *
 * Mesma técnica de `test/arquitetura.test.ts`, e pelo mesmo motivo: o diretório
 * de trabalho do vitest muda conforme de onde o comando foi disparado (da raiz
 * do monorepo, do pacote, pelo turbo), e caminho relativo a `process.cwd()`
 * acerta em uma dessas e erra nas outras.
 */
function acharRaizDaApi(): string {
  const marco = path.join('src', 'prisma', 'sessao-de-banco.ts');
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, marco))) return dir;
    if (existsSync(path.join(dir, 'apps', 'api', marco))) return path.join(dir, 'apps', 'api');
    dir = path.dirname(dir);
  }
  throw new Error(`não achei a raiz de apps/api a partir de ${process.cwd()}`);
}

describe('o catálogo do banco (a catraca que alcança tabela nova)', () => {
  it('toda tabela está sob isolamento por linha, ou está na lista de exceções', async () => {
    const r = await admin.query<{ tabela: string; rls: boolean; force: boolean; policies: string }>(
      'SELECT tabela, rls, force, policies::text FROM app_rls_estado()',
    );
    const declaradas = new Set(SEM_ISOLAMENTO.map((e) => e.tabela));

    const desprotegidas = r.rows
      .filter((t) => !declaradas.has(t.tabela))
      .filter((t) => !t.rls || !t.force || Number(t.policies) === 0)
      .map((t) => `${t.tabela} (rls=${t.rls} force=${t.force} policies=${t.policies})`);

    expect(
      desprotegidas,
      '\nTABELA SEM ISOLAMENTO POR LINHA:\n' +
        desprotegidas.map((t) => `  - ${t}`).join('\n') +
        '\n\n  Tabela de empresa sem policy é vazamento esperando consulta distraída.\n' +
        '  Conserto: uma migration nova chamando\n' +
        "    SELECT app_rls_aplicar_policies('<Tabela>', '<leitura>', '<escrita>');\n" +
        '  Se ela REALMENTE não pode receber, acrescente em `SEM_ISOLAMENTO` (neste arquivo)\n' +
        '  com o motivo escrito — a lista é o contrato, o silêncio não é.\n',
    ).toEqual([]);
  }, 30_000);

  it('a lista de exceções não tem entrada morta', async () => {
    const r = await admin.query<{ tabela: string }>('SELECT tabela FROM app_rls_estado()');
    const existentes = new Set(r.rows.map((x) => x.tabela));
    const fantasmas = SEM_ISOLAMENTO.filter((e) => !existentes.has(e.tabela)).map((e) => e.tabela);
    expect(
      fantasmas,
      `\nExceção declarada para tabela que não existe mais: ${fantasmas.join(', ')}.\n` +
        '  Lista de exceções que envelhece vira permissão esquecida.\n',
    ).toEqual([]);
  }, 30_000);

  it('o registro da suíte cobre exatamente as tabelas de empresa do banco', async () => {
    /*
     * A CATRACA QUE FALTAVA (11/09/2026).
     *
     * O caso acima pergunta ao catálogo se toda tabela TEM policy. Este pergunta
     * se toda tabela de empresa está no REGISTRO da suíte — que é o que decide o
     * que vai ser semeado e medido tabela a tabela.
     *
     * Sem ele, as duas perguntas ficavam em universos diferentes: o banco tinha
     * 69 tabelas de empresa, `ALVOS` tinha 59, e as 10 de fora (Agent, Approval,
     * ToolCall, Session, SessionStep, Sop, PolicyDecision, PolicyVersion,
     * ChannelIdentity, EventLog) passavam pela suíte inteira sem uma linha
     * semeada. Medido na revisão: uma policy `USING (true)` em três delas manteve
     * a suíte 224/224 VERDE; a mesma policy numa tabela semeada reprovou quatro
     * casos na hora. A proteção existia só onde havia dado.
     *
     * A fonte é o catálogo, não uma segunda lista à mão: tabela nova nasce aqui
     * no primeiro `migrate deploy` e cobra a entrada correspondente.
     */
    const r = await admin.query<{ tabela: string; temOrgId: boolean }>(
      `SELECT c.relname AS tabela,
              EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = c.oid AND a.attname = 'orgId'
                         AND a.attnum > 0 AND NOT a.attisdropped) AS "temOrgId"
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relname <> '_prisma_migrations'
        ORDER BY 1`,
    );

    // Global declarado em `src/common/modelos-globais.ts` fica fora — menos Org,
    // que é raiz de tenant e se escopa pela PK. Junção implícita do Prisma não
    // tem `orgId` e entra pelo nome (a empresa dela está nos pais).
    const globais = new Set(MODELOS_GLOBAIS.filter((m) => m.modelo !== 'Org').map((m) => m.modelo));
    const doBanco = r.rows.filter((t) => !globais.has(t.tabela));
    const registrados = new Set(ALVOS.map((a) => a.tabela));

    const semEntrada = doBanco.filter((t) => !registrados.has(t.tabela));
    expect(
      semEntrada.map((t) => `${t.tabela}${t.temOrgId ? ' (tem orgId)' : ' (junção)'}`),
      '\nTABELA DE EMPRESA SEM ENTRADA NO REGISTRO DA SUÍTE.\n' +
        '  Ela pode até ter policy: o que ela NÃO tem é semente, e sem semente o caso\n' +
        '  "A não lê linha de B" roda contra tabela vazia e passa com qualquer policy —\n' +
        '  inclusive com `USING (true)`. Foi assim que dez tabelas ficaram sem prova.\n\n' +
        '  Conserto, nesta ordem:\n' +
        '   1. acrescente a tabela em `ALVOS` (neste arquivo), com a `nota` dizendo o que\n' +
        '      dói vazar nela — a nota é o que torna a falha legível;\n' +
        '   2. semeie uma linha dela nas DUAS orgs, dentro de `semear`;\n' +
        '   3. se ela for global por desenho, declare em `src/common/modelos-globais.ts`\n' +
        '      e ela sai desta conferência pela porta da frente.\n',
    ).toEqual([]);

    const fantasmas = [...registrados].filter((t) => !doBanco.some((x) => x.tabela === t));
    expect(
      fantasmas,
      `\nEntrada no registro para tabela que não existe mais no banco: ${fantasmas.join(', ')}.\n` +
        '  Registro que envelhece mede o passado.\n',
    ).toEqual([]);
  }, 30_000);

  it('toda policy de INSERT tem WITH CHECK — o furo que reprovou a fatia 1.4', async () => {
    // Policy `FOR ALL` sem `WITH CHECK` faz o Postgres REUSAR a cláusula de
    // leitura como verificação de escrita. Com uma sentinela na leitura, isso
    // libera gravação em empresa alheia. Aqui a pergunta é direta ao catálogo:
    // existe policy de inserção sem verificação?
    const r = await admin.query<{ tabela: string; policy: string }>(
      `SELECT c.relname AS tabela, p.polname AS policy
         FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND p.polcmd IN ('a', '*')      -- 'a' = INSERT, '*' = ALL
          AND p.polwithcheck IS NULL
        ORDER BY 1, 2`,
    );
    expect(
      r.rows.map((x) => `${x.tabela}.${x.policy}`),
      '\nPolicy que ESCREVE sem WITH CHECK.\n' +
        '  Sem verificação explícita o Postgres reusa a cláusula de leitura — e leitura\n' +
        '  carrega sentinela. Foi assim que a primeira versão da fatia 1.4 deixou escrever\n' +
        '  em empresa alheia, `Org.modulos` inclusive.\n',
    ).toEqual([]);
  }, 30_000);

  /*
   * -------------------------------------------------------------------------
   * AS EXPRESSÕES QUE PODEM EXISTIR — a catraca da POLICY ERRADA
   *
   * O que faltava: as conferências acima pegam tabela SEM policy. Nenhuma pegava
   * tabela COM policy errada. E policy de isolamento é PERMISSIVA e SOMÁVEL —
   * duas policies de SELECT na mesma tabela são um OR, então uma única
   * `USING (true)` acrescentada ao lado das certas abre a tabela inteira sem
   * apagar nada. Medido na revisão: `CREATE POLICY ... USING (true)` em três
   * tabelas e a suíte seguiu 224/224 verde.
   *
   * Estas expressões são as MESMAS da migration
   * `20260911050000_isolamento_por_linha`, na forma que o Postgres devolve em
   * `pg_get_expr` (que normaliza parênteses e qualificação). Divergiu, reprova:
   * ou a migration mudou de propósito — e aí esta lista muda no mesmo commit,
   * em diff, sob revisão — ou alguém criou policy por fora.
   *
   * O `public.` some da forma devolvida porque `pg_get_expr` imprime com o
   * `search_path` de quem pergunta, e `public` está nele. Não quer dizer que a
   * referência guardada seja frouxa: ela é por OID (ver a correção no cabeçalho
   * da migration).
   * -------------------------------------------------------------------------
   */
  const um = (s: string) => s.replace(/\s+/g, ' ').trim();

  /** `orgId` da sessão, e nada mais. O grosso das 69 tabelas. */
  const E_PADRAO = '(app_org_resolvida() AND ("orgId" = app_org_atual()))';
  /** Org, que se escopa pela própria chave primária. */
  const E_POR_PK = '(app_org_resolvida() AND (id = app_org_atual()))';
  /** Linha global (orgId nulo) serve a todas — só na LEITURA. */
  const E_GLOBAL_OPCIONAL =
    '(app_org_resolvida() AND (("orgId" = app_org_atual()) OR ("orgId" IS NULL)))';
  const E_USER_ROLES = um(`(app_org_resolvida()
    AND (EXISTS ( SELECT 1 FROM "Role" r WHERE ((r.id = "_UserRoles"."A") AND (r."orgId" = app_org_atual()))))
    AND (EXISTS ( SELECT 1 FROM "User" u WHERE ((u.id = "_UserRoles"."B") AND (u."orgId" = app_org_atual())))))`);
  const E_ROLE_PERMISSIONS = um(`(app_org_resolvida()
    AND (EXISTS ( SELECT 1 FROM "Role" r WHERE ((r.id = "_RolePermissions"."B") AND (r."orgId" = app_org_atual())))))`);
  const E_WORKTASK_TAGS = um(`(app_org_resolvida()
    AND (EXISTS ( SELECT 1 FROM "WorkTag" t WHERE ((t.id = "_WorkTaskTags"."A") AND (t."orgId" = app_org_atual()))))
    AND (EXISTS ( SELECT 1 FROM "WorkTask" k WHERE ((k.id = "_WorkTaskTags"."B") AND (k."orgId" = app_org_atual())))))`);

  /** Sufixos de sentinela. Só entram em LEITURA, nunca em WITH CHECK. */
  const comPlataforma = (e: string) => `(${e} OR app_plataforma())`;
  const comPublica = (e: string) => `(${e} OR app_resolucao_publica())`;

  const EXPRESSOES_DECLARADAS: ReadonlyArray<{ expressao: string; onde: string }> = [
    { expressao: E_PADRAO, onde: 'o padrão: leitura e escrita das tabelas de empresa' },
    { expressao: E_POR_PK, onde: 'Org, escopada pela chave primária' },
    {
      expressao: `(${E_POR_PK} OR app_resolucao_publica() OR app_plataforma())`,
      onde: 'Org, leitura, com as duas sentinelas (é ela que resolve a empresa do pedido)',
    },
    { expressao: comPlataforma(E_PADRAO), onde: 'User e Role — leitura sob a sentinela de plataforma (o login)' },
    { expressao: comPublica(E_PADRAO), onde: 'BioPage e BioLink — leitura sob a sentinela pública (o contrato da fatia 1.4)' },
    { expressao: E_GLOBAL_OPCIONAL, onde: 'BioCredencialApp — leitura, com a linha global' },
    { expressao: comPlataforma(E_GLOBAL_OPCIONAL), onde: 'PolicyVersion — leitura, com a base no arranque' },
    { expressao: E_USER_ROLES, onde: '_UserRoles — escrita (os dois pais na empresa)' },
    { expressao: comPlataforma(E_USER_ROLES), onde: '_UserRoles — leitura (o login monta as permissões do token)' },
    { expressao: E_ROLE_PERMISSIONS, onde: '_RolePermissions — escrita (o pai que importa é o Role)' },
    { expressao: comPlataforma(E_ROLE_PERMISSIONS), onde: '_RolePermissions — leitura sob a sentinela' },
    { expressao: E_WORKTASK_TAGS, onde: '_WorkTaskTags — os dois pais na empresa' },
    { expressao: 'app_org_resolvida()', onde: 'BioVisitor e a inserção no catálogo: exige empresa, não escopa por ela' },
    {
      expressao: um(
        `(app_org_resolvida() AND (key ~ '^[a-z][a-z0-9_]{0,39}\\.[a-z][a-z0-9_]{0,39}$'::text))`,
      ),
      onde: 'Permission — a inserção no catálogo global, presa ao formato de chave',
    },
    { expressao: 'true', onde: 'a LEITURA dos dois catálogos globais, e só deles (ver o caso abaixo)' },
    {
      expressao: um(
        `(app_org_resolvida() AND ("orgId" = app_org_atual()) AND ("retencaoAte" < now())
          AND (tipo <> 'rastro.expurgo'::text))`,
      ),
      onde:
        'EventLog — o DELETE do expurgo por retenção (fatia 3.5). É a retenção virada regra do ' +
        'banco: linha VENCIDA, da própria empresa, e nunca o evento que registra um expurgo — ' +
        'senão o rastro perderia a memória de ter esquecido.',
    },
  ];

  /** As únicas tabelas em que ler tudo é a regra, não o furo. */
  const LEITURA_ESCANCARADA_DECLARADA = ['Capability', 'Permission'];

  /**
   * Os quatro nomes que `app_rls_aplicar_policies` cria — mais UM, escrito à mão
   * e com nome próprio.
   *
   * `tenant_expurgo_retencao` (migration `20260911060000_rastro_retencao_e_expurgo`)
   * é a policy de DELETE do `EventLog`, e ela existe para que o expurgo por
   * retenção se comporte igual num Postgres cujo dono NÃO seja superusuário —
   * sem ela, o DELETE do expurgo devolve zero linha em SILÊNCIO nesse ambiente
   * (medido). Ela não afrouxa o append-only: alcança só linha VENCIDA, da
   * própria empresa, que não seja o registro de um expurgo, e o papel da
   * aplicação esbarra antes no REVOKE de privilégio.
   *
   * Nome PRÓPRIO e não `tenant_exclusao` de propósito: `app_rls_aplicar_policies`
   * derruba os quatro nomes dela antes de criar, e `EventLog` entra lá com
   * `p_apaga => false` — a policy sumiria em silêncio numa reaplicação.
   */
  const NOMES_DE_POLICY = [
    'tenant_alteracao',
    'tenant_exclusao',
    'tenant_insercao',
    'tenant_leitura',
    'tenant_expurgo_retencao',
  ];

  interface PolicyDoBanco {
    tabela: string;
    policy: string;
    comando: string;
    papeis: string;
    usando: string | null;
    verificando: string | null;
  }

  async function policiesDoBanco(): Promise<PolicyDoBanco[]> {
    const r = await admin.query<PolicyDoBanco>(
      `SELECT c.relname AS tabela,
              p.polname AS policy,
              p.polcmd::text AS comando,
              p.polroles::text AS papeis,
              pg_get_expr(p.polqual, p.polrelid)      AS usando,
              pg_get_expr(p.polwithcheck, p.polrelid) AS verificando
         FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
        ORDER BY 1, 2`,
    );
    return r.rows;
  }

  it('nenhuma policy fora do prefixo `tenant_` — policy avulsa se SOMA às certas', async () => {
    const intrusas = (await policiesDoBanco())
      .filter((p) => !NOMES_DE_POLICY.includes(p.policy))
      .map((p) => `${p.tabela}.${p.policy} [${p.comando}] USING ${p.usando ?? '(sem)'}`);

    expect(
      intrusas,
      '\nPOLICY FORA DO CONJUNTO DA MIGRATION.\n' +
        intrusas.map((t) => `  - ${t}\n`).join('') +
        '\n  Policy de isolamento é PERMISSIVA: duas na mesma tabela viram um OR. Uma\n' +
        '  `USING (true)` acrescentada ao lado das certas abre a tabela inteira sem apagar\n' +
        '  nada, e nenhuma conferência de "tem policy?" percebe.\n' +
        '  Toda policy deste banco tem de sair de `app_rls_aplicar_policies`, que cria\n' +
        `  exatamente: ${NOMES_DE_POLICY.join(', ')}.\n` +
        '  Se você criou a policy à mão numa migration, passe a criá-la por aquela função.\n',
    ).toEqual([]);
  }, 30_000);

  it('toda expressão de policy está no conjunto declarado', async () => {
    const declaradas = new Set(EXPRESSOES_DECLARADAS.map((e) => um(e.expressao)));
    const desconhecidas: string[] = [];

    for (const p of await policiesDoBanco()) {
      for (const [lado, expressao] of [
        ['USING', p.usando],
        ['WITH CHECK', p.verificando],
      ] as const) {
        if (expressao === null) continue;
        if (!declaradas.has(um(expressao))) {
          desconhecidas.push(`${p.tabela}.${p.policy} ${lado}: ${um(expressao)}`);
        }
      }
    }

    expect(
      desconhecidas,
      '\nEXPRESSÃO DE POLICY QUE NINGUÉM DECLAROU.\n' +
        desconhecidas.map((t) => `  - ${t}\n`).join('') +
        '\n  O conjunto declarado está logo acima deste caso, e é o mesmo da migration\n' +
        '  `20260911050000_isolamento_por_linha`. Duas leituras possíveis:\n' +
        '   · a migration mudou de propósito → acrescente a expressão aqui, no mesmo\n' +
        '     commit, com o `onde` dizendo que tabela ganha isso e por quê;\n' +
        '   · alguém escreveu policy por fora → é isso que este caso existe para pegar.\n',
    ).toEqual([]);

    /*
     * O QUE ESTE CASO **NÃO** PEGA, e quem pega no lugar dele.
     *
     * A lista é de expressões, não de pares tabela-expressão: uma expressão
     * legítima aplicada à TABELA ERRADA passa por aqui. Medido: trocar a leitura
     * de `Session` por `app_org_resolvida()` (a de `BioVisitor`, que é legítima
     * lá) não acusa nada neste caso — e reprova na hora os dois casos "A não lê
     * linha de B em Session", porque agora existe semente nas duas empresas.
     *
     * Declarar par a par seria reescrever a migration inteira em TypeScript, com
     * duas fontes de verdade para a mesma coisa. A divisão é de propósito: a
     * medição com dado semeado responde "esta policy isola?"; este caso responde
     * "apareceu expressão que ninguém escreveu?", que é o que a medição não vê
     * quando a tabela está vazia.
     */
  }, 30_000);

  it('só os catálogos globais têm leitura escancarada', async () => {
    // `true` está no conjunto declarado porque `Permission` e `Capability`
    // realmente são lidos por qualquer sessão. Sem este segundo caso, a lista de
    // expressões absolveria um `USING (true)` em QUALQUER tabela — que é
    // exatamente o ataque. Aqui a pergunta é OUTRA: em que tabelas ele aparece.
    const escancaradas = (await policiesDoBanco())
      .filter((p) => p.usando !== null && um(p.usando) === 'true')
      .map((p) => p.tabela)
      .filter((t, i, todas) => todas.indexOf(t) === i)
      .sort();

    expect(
      escancaradas,
      '\nLEITURA ESCANCARADA (`USING (true)`) EM TABELA QUE NÃO É CATÁLOGO GLOBAL.\n' +
        `  encontrado: ${escancaradas.join(', ') || '(nenhuma)'}\n` +
        `  declarado .: ${LEITURA_ESCANCARADA_DECLARADA.join(', ')}\n\n` +
        '  Ler tudo é a regra em `Permission` e `Capability` (catálogos que o guarda de\n' +
        '  permissões e a porta precisam a todo momento) e é vazamento em qualquer outra.\n',
    ).toEqual(LEITURA_ESCANCARADA_DECLARADA);
  }, 30_000);

  it('nenhuma policy é concedida a papel nominal — todas valem para PUBLIC', async () => {
    // `CREATE POLICY ... TO mktos_app USING (true)` seria a mesma abertura com
    // outra roupa, e passaria pelo caso do prefixo se o nome fosse `tenant_*`.
    // `{0}` é o OID de PUBLIC.
    const nominais = (await policiesDoBanco())
      .filter((p) => p.papeis !== '{0}')
      .map((p) => `${p.tabela}.${p.policy} TO ${p.papeis}`);
    expect(
      nominais,
      '\nPOLICY PRESA A UM PAPEL ESPECÍFICO.\n' +
        nominais.map((t) => `  - ${t}\n`).join('') +
        '\n  Todas as policies desta migration valem para PUBLIC, e é o que faz a conferência\n' +
        '  de expressão acima significar alguma coisa: uma policy `TO <papel>` cria uma\n' +
        '  regra que só aparece para aquele papel — e some da leitura de quem audita.\n',
    ).toEqual([]);
  }, 30_000);

  it('o isolamento desliga e religa — o caminho de rollback existe de verdade', async () => {
    // "A migration precisa ter caminho de rollback claro" é o enunciado da fatia.
    // Caminho de rollback que ninguém executou é caminho que não existe: aqui ele
    // é executado, medido e desfeito.
    const ligadas = async () => {
      const r = await admin.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM app_rls_estado() WHERE rls AND force',
      );
      return Number(r.rows[0].n);
    };

    const antes = await ligadas();
    expect(antes, 'o isolamento precisa estar ligado antes de testar o desligamento').toBeGreaterThan(0);

    await admin.query('SELECT app_rls_desligar()');
    const depoisDeDesligar = await ligadas();

    // Religa SEMPRE, mesmo se a asserção acima quebrar: deixar o banco desligado
    // envenenaria todos os casos seguintes.
    await admin.query('SELECT app_rls_ligar()');
    const depoisDeReligar = await ligadas();

    expect(depoisDeDesligar, 'app_rls_desligar() não desligou nada').toBe(0);
    expect(
      depoisDeReligar,
      'app_rls_ligar() não devolveu o banco ao estado anterior — o rollback é de mão única.',
    ).toBe(antes);
  }, 60_000);

  it('o papel restrito NÃO consegue desligar o próprio isolamento', async () => {
    exigirPapelRestrito();
    const c = await tenant.connect();
    let erro = '';
    try {
      await c.query('SELECT app_rls_desligar()');
    } catch (e) {
      erro = (e as Error).message;
    } finally {
      c.release();
    }
    expect(
      erro,
      '\nO papel da aplicação desligou o isolamento por linha com uma chamada de função.\n' +
        '  `app_rls_ligar`/`app_rls_desligar` NÃO podem ser SECURITY DEFINER, e o EXECUTE\n' +
        '  precisa estar revogado do papel (a migration do papel deixa um ALTER DEFAULT\n' +
        '  PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS, então função nova nasce executável).\n',
    ).not.toBe('');
  }, 30_000);

  /*
   * -------------------------------------------------------------------------
   * A SENTINELA DE PLATAFORMA — quem pode abrir, cobrado pelo IMPORT
   *
   * A primeira versão desta catraca procurava o TEXTO `comContextoDePlataforma(`
   * em cada arquivo. Três jeitos de escapar dela, todos legítimos em TypeScript
   * e nenhum mal-intencionado por natureza — o que torna o buraco pior, porque
   * ele fecha sozinho por acidente:
   *
   *   import { comContextoDePlataforma as plataforma } from '...';  // outro nome
   *   import * as ctx from '...'; ctx.comContextoDePlataforma(...);  // namespace
   *   export { comContextoDePlataforma } from '...';                 // reexporta
   *
   * O terceiro é o pior: um arquivo qualquer vira uma segunda porta para a
   * sentinela, e a partir dali ninguém mais importa o módulo original.
   *
   * A pergunta mudou, então, de "quem escreve este nome?" para "quem IMPORTA
   * este módulo?" — que é por CAMINHO, e caminho não se renomeia. É a mesma
   * troca que a fatia 1.4 fez para a sentinela pública, com a diferença de que
   * aquela não é exportada e esta precisa ser.
   * -------------------------------------------------------------------------
   */

  /** Todo `.ts` de `src/`, com o caminho relativo à raiz da api. */
  function arquivosDaApi(raizDaApi: string): string[] {
    const arquivos: string[] = [];
    const andar = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const caminho = path.join(dir, e.name);
        if (e.isDirectory()) andar(caminho);
        else if (e.name.endsWith('.ts')) arquivos.push(caminho);
      }
    };
    andar(path.join(raizDaApi, 'src'));
    return arquivos.map((f) => path.relative(raizDaApi, f).split(path.sep).join('/')).sort();
  }

  /** O próprio módulo da sentinela, e quem pode tocá-lo sem ser chamador. */
  const MODULO_DA_SENTINELA = 'src/prisma/contexto-de-plataforma.ts';
  const PODE_IMPORTAR_SEM_CHAMAR: ReadonlyArray<{ arquivo: string; porQue: string }> = [
    {
      arquivo: 'src/prisma/sessao-de-banco.ts',
      porQue:
        'importa `ORG_PLATAFORMA` (para reconhecer a sentinela no inventário) e ' +
        '`caminhosDePlataformaFaltando` (para a trava do arranque). Não abre contexto nenhum.',
    },
  ];

  /** Trecho de `import`/`export ... from '<módulo da sentinela>'` num arquivo. */
  function referenciasAoModulo(fonte: string): Array<{ clausula: string; reexporta: boolean }> {
    const achados: Array<{ clausula: string; reexporta: boolean }> = [];
    // Casa `import … from '…contexto-de-plataforma'` e a forma `export … from`,
    // com ou sem `type`, aspas simples ou duplas, em uma linha ou em várias. O
    // caminho é relativo e muda de profundidade conforme o módulo (`./` dentro
    // de `src/prisma/`, `../prisma/` fora dele); o que não muda é o fim dele.
    //
    // `^[ \t]*` com a flag `m` ancora no começo da instrução e `[^;]*?` a impede
    // de atravessar para a instrução seguinte — sem isso um `import` anterior
    // poderia ser confundido com o `export` que interessa, e a detecção de
    // reexportação apontaria para a palavra errada.
    const re = /^[ \t]*(import|export)\b([^;]*?)\bfrom\s*['"]([^'"]*contexto-de-plataforma)(?:\.[jt]s)?['"]/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(fonte)) !== null) {
      achados.push({ clausula: m[2], reexporta: m[1] === 'export' });
    }
    return achados;
  }

  it('ninguém REEXPORTA a sentinela de plataforma', () => {
    const raizDaApi = acharRaizDaApi();
    const reexportam = arquivosDaApi(raizDaApi)
      .filter((f) => f !== MODULO_DA_SENTINELA)
      .filter((f) =>
        referenciasAoModulo(readFileSync(path.join(raizDaApi, f), 'utf8')).some((r) => r.reexporta),
      );

    expect(
      reexportam,
      '\nUM ARQUIVO REEXPORTA O MÓDULO DA SENTINELA DE PLATAFORMA.\n' +
        reexportam.map((f) => `  - ${f}\n`).join('') +
        '\n  Reexportar cria uma SEGUNDA porta para a sentinela: daí em diante o código novo\n' +
        '  importa a porta nova, o módulo original deixa de aparecer nos imports, e a\n' +
        '  conferência de quem pode abrir o contexto passa a medir o lugar errado.\n' +
        '  Importe sempre de `src/prisma/contexto-de-plataforma.ts`.\n',
    ).toEqual([]);
  });

  it('só os caminhos declarados abrem o contexto de plataforma', () => {
    const raizDaApi = acharRaizDaApi();
    const isentos = new Set(PODE_IMPORTAR_SEM_CHAMAR.map((e) => e.arquivo));

    const chamam = arquivosDaApi(raizDaApi)
      .filter((f) => f !== MODULO_DA_SENTINELA && !isentos.has(f))
      .filter((f) => {
        const fonte = readFileSync(path.join(raizDaApi, f), 'utf8');
        const refs = referenciasAoModulo(fonte);
        if (!refs.length) return false;
        // Importou o módulo e não está na lista de isentos: é chamador. Importa
        // pouco QUE nome local ele deu, ou se pegou o namespace inteiro — o
        // alcance da sentinela aumentou do mesmo jeito e a decisão é de revisão.
        return true;
      })
      .sort();

    const declarados = [...CHAMADORES_DE_PLATAFORMA.map((c) => c.arquivo)].sort();

    expect(
      chamam,
      '\nO conjunto de quem abre o contexto de PLATAFORMA mudou.\n' +
        `  declarado em CHAMADORES_DE_PLATAFORMA: ${declarados.join(', ') || '(nenhum)'}\n` +
        `  encontrado no código .............: ${chamam.join(', ') || '(nenhum)'}\n\n` +
        '  A conferência é por IMPORT do módulo, não pelo nome da função: importar com\n' +
        '  outro nome (`as plataforma`) ou pelo namespace (`import * as ctx`) conta igual,\n' +
        '  porque o alcance da sentinela aumentou igual.\n\n' +
        '  Ampliar esse alcance é decisão de revisão, não efeito colateral de um commit\n' +
        '  sobre outro assunto. Se a chamada nova é legítima, declare-a em\n' +
        '  `src/prisma/contexto-de-plataforma.ts` com o motivo — e lembre que lá só há\n' +
        '  LEITURA, em cinco lugares: Org, User, Role, as duas junções e PolicyVersion.\n' +
        '  Se o arquivo só importa a CONSTANTE (e não abre contexto), a isenção vai em\n' +
        '  `PODE_IMPORTAR_SEM_CHAMAR`, neste arquivo, também com o motivo.\n',
    ).toEqual(declarados);
  });

  it('a isenção de import não tem entrada morta', () => {
    const raizDaApi = acharRaizDaApi();
    const existentes = new Set(arquivosDaApi(raizDaApi));
    const mortas = PODE_IMPORTAR_SEM_CHAMAR.filter(
      (e) =>
        !existentes.has(e.arquivo) ||
        !referenciasAoModulo(readFileSync(path.join(raizDaApi, e.arquivo), 'utf8')).length,
    ).map((e) => e.arquivo);
    expect(
      mortas,
      `\nIsenção declarada para arquivo que não importa mais a sentinela: ${mortas.join(', ')}.\n` +
        '  Isenção que envelhece vira permissão esquecida.\n',
    ).toEqual([]);
  });

  /*
   * -------------------------------------------------------------------------
   * A TRAVA DA VIRADA — o arranque recusa subir com caminho em aberto
   *
   * A afirmação "ligar isto não derruba produção" continua certa: a aplicação
   * conecta como DONA e o dono atravessa policy. A metade que FALTAVA é a
   * seguinte: dos oito caminhos de plataforma, só um declara o contexto. Sob o
   * papel restrito, os outros sete devolvem ZERO LINHA — e o primeiro deles é a
   * busca de usuário por e-mail, ou seja, todo login vira "credenciais
   * inválidas", sem erro no log.
   *
   * Medido na revisão, neste mesmo banco: `SELECT ... FROM "User" WHERE email=…`
   * como `mktos_app` sem sentinela devolveu 0 linha; com `app.org_id` =
   * `__plataforma__`, devolveu 1.
   *
   * A virada é DUAS VARIÁVEIS DE AMBIENTE. Quem as preenche está tentando fazer
   * a coisa segura. Por isso a conferência é no ARRANQUE e é recusa, não aviso.
   * -------------------------------------------------------------------------
   */
  describe('a trava do arranque (RF-T-02)', () => {
    const exigidos = [...CAMINHOS_DE_PLATAFORMA_EXIGIDOS];
    const declarados = [...CHAMADORES_DE_PLATAFORMA];

    it('o que a lista EXIGE cobre os caminhos do cabeçalho da migration e os da bio', () => {
      // A lista de exigidos é o contrato. Encurtá-la é afrouxar a trava sem
      // mexer em nenhuma policy — por isso ela é cobrada aqui, nominalmente.
      expect(exigidos.map((c) => c.arquivo).sort()).toEqual(
        [
          'src/auth/auth.service.ts',
          'src/auth/google-login.service.ts',
          // MD5: o cron e o callback da bio atravessam empresas sem contexto.
          'src/bio/bio-oauth.controller.ts',
          'src/bio/bio-sync.service.ts',
          'src/finance/finance.service.ts',
          'src/health/health.controller.ts',
          'src/integrations/clickup.service.ts',
          'src/obsidian/obsidian.service.ts',
          'src/policy/policy.service.ts',
          'src/tenants/provisionar.ts',
        ].sort(),
      );
      // Motivo escrito em toda entrada: lista sem motivo envelhece sem ninguém
      // conseguir revisar.
      expect(exigidos.filter((c) => c.porQue.trim().length < 20)).toEqual([]);
    });

    it('conexão RESTRITA com caminho em aberto NÃO sobe', () => {
      const { faltando, recusar } = conferirCoberturaDePlataforma(false);
      // Enquanto os sete não estiverem ligados, isto é verdade — e é o ponto.
      // Quando o último for ligado, este caso vira "não falta nada, não recusa",
      // e a asserção de baixo continua valendo nos dois mundos.
      expect(recusar).toBe(faltando.length > 0);
      if (faltando.length > 0) {
        const erro = new CoberturaDePlataformaIncompletaError(faltando);
        expect(erro.message).toContain('a API não sobe');
        // A mensagem nomeia o que falta: erro de arranque que não diz o que
        // consertar é erro que vira "tenta de novo".
        for (const c of faltando) expect(erro.message).toContain(c.arquivo);
      }
    });

    it('conexão INERTE (dona das tabelas) sobe mesmo com caminho em aberto', () => {
      // É o estado de produção HOJE. Derrubar a API por uma dívida que ainda não
      // tem efeito seria trocar um risco futuro por uma queda presente.
      expect(conferirCoberturaDePlataforma(true).recusar).toBe(false);
    });

    it('quem já declarou sai da lista do que falta', () => {
      const faltando = caminhosDePlataformaFaltando(declarados, exigidos).map((c) => c.arquivo);
      for (const d of declarados) expect(faltando).not.toContain(d.arquivo);
      // E o inverso: declarar TUDO zera a pendência (é o estado que libera a
      // virada). Sem este caso, um erro de comparação que devolvesse sempre a
      // lista cheia passaria despercebido — a trava ficaria presa em fechado.
      expect(caminhosDePlataformaFaltando(exigidos, exigidos)).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Isolamento tabela a tabela — o coração da suíte
// ---------------------------------------------------------------------------

describe('isolamento de leitura por tabela', () => {
  it.each(ALVOS.map((a) => [a.tabela, a] as const))(
    'A não lê linha de B em %s',
    async (_nome, alvo) => {
      const chavesDeB = new Set(
        (sementes.B.chaves[alvo.tabela] ?? []).filter((k) => !CHAVES_SEM_DONO.has(k)),
      );
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
      const chavesDeA = new Set(
        (sementes.A.chaves[alvo.tabela] ?? []).filter((k) => !CHAVES_SEM_DONO.has(k)),
      );
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
  // As TRÊS colunas vector(1536) do sistema. `ContextItem.embedding` entrou na
  // fatia 4.1+4.2 (a MEMÓRIA) e é a mais sensível das três: o que ela indexa é o
  // contexto do negócio — as regras da casa, o dicionário, as decisões.
  const TABELAS_VETORIAIS = [
    { tabela: 'KnowledgeNote', ref: 'notaId', origem: 'apps/api/src/obsidian/obsidian.service.ts:191-199' },
    { tabela: 'PautaReferencia', ref: 'referenciaId', origem: 'apps/api/src/pauta/pauta.service.ts:531-539' },
    { tabela: 'ContextItem', ref: 'contextoId', origem: 'apps/api/src/memory/memoria.service.ts (MemoriaService.buscar)' },
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

  /*
   * O CATÁLOGO DE PERMISSÕES É ESTADO GLOBAL DURÁVEL — e por isso a escrita nele
   * tem formato.
   *
   * `Permission` é lida por `USING (true)`: uma linha plantada por uma empresa
   * aparece na tela das OUTRAS e sob as duas sentinelas. E não há policy de
   * UPDATE nem de DELETE — de propósito, porque apagar chave de catálogo
   * cascateia em `_RolePermissions` e revogaria a permissão em TODAS as
   * empresas. O efeito colateral é que a aplicação NÃO consegue limpar o que
   * entrou: só o dono, à mão.
   *
   * Medido na revisão, antes da correção: um tenant inseriu a chave
   * `<script>alert(1)</script>`, ela ficou legível para todos, e o `DELETE` do
   * próprio autor não removeu nada.
   *
   * O `WITH CHECK` agora exige a gramática de `packages/shared/src/
   * permissions.ts` (`area.acao`). Os dois casos abaixo prendem os dois lados:
   * o formato não pode recusar chave de verdade (senão o provisionamento quebra
   * depois da virada), e não pode aceitar texto arbitrário.
   */
  it('o catálogo de permissões aceita as chaves REAIS do produto', async () => {
    // Sem este caso, apertar o formato quebraria `garantirPermissoes`
    // (`src/tenants/provisionar.ts`) só no dia da virada, e só em produção.
    const recusadas: string[] = [];
    await comoTenant(sementes.A.orgId, async (c) => {
      for (const key of PERMISSIONS) {
        try {
          await c.query('SAVEPOINT p');
          await c.query('INSERT INTO "Permission" ("id", "key") VALUES ($1, $2)', [
            `perm_${MARCA}_${key}`,
            `${key}_${MARCA}`,
          ]);
        } catch {
          recusadas.push(key);
        } finally {
          await c.query('ROLLBACK TO SAVEPOINT p');
        }
      }
    });
    expect(
      recusadas,
      '\nO formato de chave do catálogo recusou permissão REAL do produto:\n' +
        recusadas.map((k) => `  - ${k}\n`).join('') +
        '\n  A expressão está na migration do isolamento (seção 3.7) e a lista em\n' +
        '  `packages/shared/src/permissions.ts`. Divergiram: o provisionamento de empresa\n' +
        '  para de completar o catálogo depois da virada para o papel restrito.\n',
    ).toEqual([]);
  }, 60_000);

  it('o catálogo de permissões RECUSA chave fora do formato', async () => {
    const lixo = [
      '<script>alert(1)</script>',
      'Admin.Permissoes',
      'sem_ponto',
      'a.'.padEnd(120, 'x'),
      '../../etc/passwd',
    ];
    const aceitas: string[] = [];
    await comoTenant(sementes.A.orgId, async (c) => {
      for (const key of lixo) {
        try {
          await c.query('SAVEPOINT p');
          await c.query('INSERT INTO "Permission" ("id", "key") VALUES ($1, $2)', [
            `perm_lixo_${MARCA}_${aceitas.length}_${key.length}`,
            key,
          ]);
          aceitas.push(key);
        } catch {
          /* recusado: é o esperado */
        } finally {
          await c.query('ROLLBACK TO SAVEPOINT p');
        }
      }
    });
    expect(
      aceitas,
      '\nO catálogo GLOBAL de permissões aceitou chave fora do formato:\n' +
        aceitas.map((k) => `  - ${JSON.stringify(k)}\n`).join('') +
        '\n  Ele é lido por `USING (true)`: o que entra aqui aparece na tela de TODAS as\n' +
        '  empresas e sob as duas sentinelas. E não há policy de UPDATE nem de DELETE — a\n' +
        '  aplicação não consegue limpar; só o dono, à mão, no banco.\n',
    ).toEqual([]);
  }, 30_000);

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

  /*
   * A BIO PÚBLICA — o caso mudou de pergunta na fatia 1.5, e a mudança é o
   * assunto, não um detalhe.
   *
   * A versão anterior cobrava que a `BioPage` publicada fosse legível com
   * `app.org_id` VAZIO, e a saída sugerida era "policy própria para
   * publicada=true, ou role com BYPASSRLS para a rota pública". A fatia 1.4
   * recusou as duas, e com razão:
   *
   *   · abrir a policy para o VAZIO é abrir para o valor padrão de tudo que
   *     ninguém resolveu no sistema inteiro — não para as quatro rotas públicas;
   *   · um papel com BYPASSRLS atravessa TODAS as policies, não só a da bio.
   *
   * O que existe no lugar é a SENTINELA: "estou descobrindo de quem é este
   * pedido" virou um estado declarado (`src/common/tenant-publico.ts`), e a rota
   * pública resolve a empresa ANTES de responder qualquer coisa. Então a
   * pergunta certa é esta, em três partes.
   */
  it('a bio pública resolve pela SENTINELA — e o vazio continua não vendo nada', async () => {
    const c = await tenant.connect();
    try {
      // (a) SOB A SENTINELA a resolução enxerga: é o contrato com a fatia 1.4.
      await c.query('BEGIN');
      await c.query('SELECT set_config($1, $2, true)', [GUC, ORG_RESOLUCAO_PUBLICA]);
      const sobSentinela = await c.query<{ id: string; orgId: string }>(
        'SELECT id, "orgId" FROM "BioPage" WHERE "handle" = $1 AND "publicada" = true',
        [sementes.A.ref.bioHandle],
      );
      expect(
        sobSentinela.rows.length,
        '\nA bio pública quebrou: sob a SENTINELA a policy escondeu a BioPage publicada.\n' +
          '  Rotas afetadas: bio-public.controller.ts (página, avatar, redirect) e o pixel.\n' +
          `  A policy de leitura de BioPage precisa aceitar ${GUC} = "${ORG_RESOLUCAO_PUBLICA}".\n`,
      ).toBe(1);
      expect(sobSentinela.rows[0].orgId).toBe(sementes.A.orgId);
      await c.query('ROLLBACK');

      // (b) SEM EMPRESA não se enxerga nada. É o RF-T-04 no banco: ausência de
      //     empresa é erro, nunca "todos". Se isto voltar a devolver linha, a
      //     policy abriu para o vazio e o furo é do tamanho do sistema.
      await c.query('BEGIN');
      await c.query('SELECT set_config($1, $2, true)', [GUC, '']);
      const semEmpresa = await c.query('SELECT id FROM "BioPage"');
      expect(
        semEmpresa.rows.length,
        '\nA policy de BioPage abriu para a sessão SEM empresa.\n' +
          '  Vazio é o valor padrão de toda consulta que ninguém resolveu: isto não libera\n' +
          '  as quatro rotas públicas, libera o sistema inteiro.\n',
      ).toBe(0);
      await c.query('ROLLBACK');

      // (c) SOB A SENTINELA NÃO SE ESCREVE. É o furo que reprovou a primeira
      //     versão da 1.4: policy `FOR ALL` sem `WITH CHECK` reusa a cláusula de
      //     leitura como verificação de escrita, e a sentinela virava chave de
      //     gravação em empresa alheia — `Org.modulos` inclusive.
      await c.query('BEGIN');
      await c.query('SELECT set_config($1, $2, true)', [GUC, ORG_RESOLUCAO_PUBLICA]);
      const publicou = await c.query('UPDATE "BioPage" SET "publicada" = true WHERE "orgId" = $1', [
        sementes.B.orgId,
      ]);
      expect(
        publicou.rowCount ?? 0,
        '\nSob a sentinela deu para ESCREVER em BioPage de outra empresa.\n' +
          '  A policy precisa ser DUAS: leitura com a sentinela, escrita com WITH CHECK\n' +
          '  explícito e SEM sentinela nenhuma.\n',
      ).toBe(0);
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
    }
  }, 30_000);

  /*
   * A SEGUNDA SENTINELA — os caminhos de PLATAFORMA (fatia 1.5).
   *
   * Login, provisionamento, conector do ClickUp, financeiro e o carregamento da
   * política no arranque consultam antes de existir empresa, porque é a consulta
   * deles que DESCOBRE a empresa. Sem um estado declarado para isso, ligar o
   * isolamento derruba o login — que é o jeito mais fácil de derrubar produção
   * inteira. Ver `src/prisma/contexto-de-plataforma.ts`.
   *
   * O contrato tem dois lados, e os dois estão cobrados aqui: o que ela ALCANÇA
   * (cinco lugares, só leitura) e o que ela NÃO alcança (o resto do banco, e
   * escrita em lugar nenhum).
   */
  describe('a sentinela de PLATAFORMA', () => {
    async function comoPlataforma<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
      const c = await tenant.connect();
      try {
        await c.query('BEGIN');
        await c.query('SELECT set_config($1, $2, true)', [GUC, ORG_PLATAFORMA]);
        return await fn(c);
      } finally {
        await c.query('ROLLBACK').catch(() => undefined);
        c.release();
      }
    }

    it('acha o usuário pelo e-mail e a empresa pelo slug — é o LOGIN', async () => {
      const achado = await comoPlataforma(async (c) => {
        const u = await c.query<{ orgId: string }>('SELECT "orgId" FROM "User" WHERE id = $1', [
          sementes.A.ref.userId,
        ]);
        const o = await c.query<{ id: string }>('SELECT id FROM "Org" WHERE slug = $1', [
          sementes.A.slug,
        ]);
        return { user: u.rows[0]?.orgId ?? '', org: o.rows[0]?.id ?? '' };
      });
      expect(
        achado,
        '\nO login não acha o usuário sob a sentinela de plataforma.\n' +
          '  Sem isto, a virada para o papel restrito tira o login do ar: a consulta que\n' +
          '  DESCOBRE a empresa não tem como ter empresa.\n',
      ).toEqual({ user: sementes.A.orgId, org: sementes.A.orgId });
    }, 30_000);

    it('monta a lista de permissões do token (Role e as duas junções)', async () => {
      const visto = await comoPlataforma(async (c) => {
        const r = await c.query('SELECT id FROM "Role" WHERE id = $1', [sementes.A.ref.roleId]);
        const ur = await c.query('SELECT "A" FROM "_UserRoles" WHERE "B" = $1', [
          sementes.A.ref.userId,
        ]);
        const rp = await c.query('SELECT "A" FROM "_RolePermissions" WHERE "B" = $1', [
          sementes.A.ref.roleId,
        ]);
        return { role: r.rows.length, userRoles: ur.rows.length, rolePerms: rp.rows.length };
      });
      expect(visto.role, 'Role invisível sob a sentinela: o token sairia sem papéis.').toBe(1);
      expect(visto.userRoles, '_UserRoles invisível: o token sairia sem papéis.').toBeGreaterThan(0);
      expect(
        visto.rolePerms,
        '_RolePermissions invisível: o token sairia sem permissão nenhuma e toda rota daria 403.',
      ).toBeGreaterThan(0);
    }, 30_000);

    it('lê a PolicyVersion base — é o arranque do serviço de política', async () => {
      // `PolicyService.onModuleInit` carrega a versão de `orgId` NULO antes de
      // existir requisição. Sem isso ele cai na base EMPACOTADA e a política POR
      // EMPRESA deixa de valer — em silêncio, porque ele trata a falha e segue.
      const leu = await comoPlataforma(async (c) => {
        const r = await c.query('SELECT 1 FROM "PolicyVersion" WHERE "orgId" IS NULL LIMIT 1');
        return r.rows.length >= 0; // a consulta não pode ESTOURAR; vazio é legítimo
      });
      expect(leu).toBe(true);
    }, 30_000);

    it('NÃO alcança dado de tenant — nem lead, nem financeiro, nem RASTRO', async () => {
      const vistas = await comoPlataforma(async (c) => {
        const saida: Record<string, number> = {};
        for (const t of ['Lead', 'FinanceTransaction', 'KnowledgeNote', 'EventLog', 'BioPage']) {
          const r = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM "${t}"`);
          saida[t] = Number(r.rows[0].n);
        }
        return saida;
      });
      expect(
        vistas,
        '\nA sentinela de PLATAFORMA enxergou dado de empresa.\n' +
          '  Ela existe para DESCOBRIR a empresa, não para atravessá-las: o contrato são\n' +
          '  cinco lugares (Org, User, Role, as duas junções e PolicyVersion), só leitura.\n' +
          '  Se ela vê lead, ela é modo administrador — e aí não é sentinela, é buraco.\n',
      ).toEqual({ Lead: 0, FinanceTransaction: 0, KnowledgeNote: 0, EventLog: 0, BioPage: 0 });
    }, 30_000);

    it('NÃO escreve em lugar nenhum — nem no que ela lê', async () => {
      const escritas = await comoPlataforma(async (c) => {
        const saida: Record<string, number | string> = {};
        // desativar um usuário de outra empresa
        const u = await c.query('UPDATE "User" SET "isActive" = false WHERE id = $1', [
          sementes.B.ref.userId,
        ]);
        saida.user = u.rowCount ?? 0;
        // mudar a lista de módulos — o gate de módulos inteiro (RF-T-06)
        const o = await c.query(`UPDATE "Org" SET "modulos" = ARRAY['financeiro'] WHERE id = $1`, [
          sementes.B.orgId,
        ]);
        saida.org = o.rowCount ?? 0;
        // conceder a si mesmo um papel alheio
        try {
          await c.query('INSERT INTO "_UserRoles" ("A", "B") VALUES ($1, $2)', [
            sementes.B.ref.roleId,
            sementes.A.ref.userId,
          ]);
          saida.userRoles = 'ACEITOU';
        } catch {
          saida.userRoles = 0;
        }
        return saida;
      });
      expect(
        escritas,
        '\nA sentinela de PLATAFORMA ESCREVEU.\n' +
          '  Ela é de leitura, e só. Escrita sob sentinela é o furo que reprovou a primeira\n' +
          '  versão da fatia 1.4: policy FOR ALL sem WITH CHECK reusa a cláusula de leitura\n' +
          '  como verificação de escrita.\n',
      ).toEqual({ user: 0, org: 0, userRoles: 0 });
    }, 30_000);
  });
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
/** Um lead novo da org A, para os filhos 1:1 do cockpit (a ficha e a sala têm leadId único). */
async function leadNovoDaOrgA(c: PoolClient): Promise<string> {
  return ins(c, 'Lead', { id: crypto.randomUUID(), orgId: sementes.A.orgId, name: `Lead do gatilho ${MARCA}`, status: 'novo', updatedAt: new Date() });
}

const LINHA_DE_FILHO: Record<string, (c: PoolClient) => Promise<Record<string, unknown>>> = {
  // O cockpit do lead (13/10/2026): oito filhos de Lead. A ficha e a sala são 1:1
  // com o lead (leadId único), então a linha da prova nasce num lead NOVO da org A.
  ComercialFicha: async (c) => ({ id: crypto.randomUUID(), leadId: await leadNovoDaOrgA(c), atualizadoEm: new Date() }),
  SalaDoCliente: async (c) => ({
    id: crypto.randomUUID(), leadId: await leadNovoDaOrgA(c), slug: `sala-gatilho-${MARCA}`,
    tokenHash: `gatilho_${crypto.randomUUID()}`, validoAte: new Date(Date.now() + 86_400_000), atualizadoEm: new Date(),
  }),
  ComercialDecisao: async () => ({
    id: crypto.randomUUID(), leadId: sementes.A.ref.leadId, tipo: 'lead_parado', titulo: 'Decisão do gatilho',
    contexto: 'gatilho', opcoes: JSON.stringify([]), padrao: 'manter', expiraEm: new Date(Date.now() + 3_600_000),
  }),
  ComercialMensagem: async () => ({
    id: crypto.randomUUID(), leadId: sementes.A.ref.leadId, direcao: 'entrada', provedor: 'simulado', texto: 'gatilho',
  }),
  ComercialReacao: async () => ({
    id: crypto.randomUUID(), leadId: sementes.A.ref.leadId, eventoId: crypto.randomUUID(), reacao: 'gatilho',
  }),
  ComercialFechamento: async () => ({
    id: crypto.randomUUID(), leadId: sementes.A.ref.leadId, chave: `fech-gatilho-${crypto.randomUUID()}`, atualizadoEm: new Date(),
  }),
  ComercialCobranca: async () => ({
    id: crypto.randomUUID(), leadId: sementes.A.ref.leadId, provedor: 'asaas', externoId: `pay_gatilho_${crypto.randomUUID()}`,
    parcela: 1, parcelas: 1, valorCentavos: 100, forma: 'pix', vence: new Date(), atualizadoEm: new Date(),
  }),
  ComercialDocumento: async () => ({
    id: crypto.randomUUID(), leadId: sementes.A.ref.leadId, provedor: 'zapsign', externoId: `doc_gatilho_${crypto.randomUUID()}`,
    hashConteudo: 'gatilho', atualizadoEm: new Date(),
  }),
  LeadReacao: async () => ({
    id: crypto.randomUUID(), leadId: sementes.A.ref.leadId, versao: 1, secao: 'montar', tipo: 'faz_sentido', acesso: 1, atualizadoEm: new Date(),
  }),
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
  WorkApontamento: async () => ({
    id: crypto.randomUUID(), taskId: sementes.A.ref.workTaskId,
    autorNome: 'Gatilho', minutos: 30, dia: '2026-09-15', etapa: 'Diagnóstico',
  }),
  OnboardingItem: async () => ({
    id: crypto.randomUUID(), trilhoId: sementes.A.ref.onboardingTrilhoId, temaId: `gatilho_${MARCA}`, bloco: 'D',
    atualizadoEm: new Date(),
  }),
  OnboardingConvite: async () => ({
    id: crypto.randomUUID(), trilhoId: sementes.A.ref.onboardingTrilhoId, blocos: 'A',
    tokenHash: `gatilho_${MARCA}_${crypto.randomUUID()}`, validoAte: new Date(Date.now() + 86_400_000),
  }),
  OnboardingAta: async () => ({
    id: crypto.randomUUID(), trilhoId: sementes.A.ref.onboardingTrilhoId, fonte: 'texto', caracteres: 10, hash: `g_${MARCA}`,
  }),
  OnboardingMarco: async () => ({
    id: crypto.randomUUID(), trilhoId: sementes.A.ref.onboardingTrilhoId, tipo: 'gatilho', texto: 'marco do teste de derivação',
  }),
  ItemDoLote: async () => ({
    id: crypto.randomUUID(), loteId: sementes.A.ref.aprovacaoDeLoteId, capabilityId: 'instagram.post.publicar',
    recursoId: crypto.randomUUID(), hashItem: `gatilho_${MARCA}`, janelaDe: new Date(), janelaAte: new Date(Date.now() + 60_000),
  }),
  PautaPublicacao: async () => ({
    // (pecaId, rede) é único: a semente já usou `instagram` nesta peça.
    id: crypto.randomUUID(), pecaId: sementes.A.ref.pautaPecaId, rede: 'youtube', atualizadaEm: new Date(),
  }),
  ComentarioComPalavra: async () => ({
    id: crypto.randomUUID(), pecaId: sementes.A.ref.pautaPecaId, commentId: `gatilho_${MARCA}_${crypto.randomUUID()}`, midiaId: 'm',
    palavra: 'AGENTES', pessoaHmac: 'h', comentadoEm: new Date(), expiraEm: new Date(Date.now() + 86_400_000),
  }),
  EnvioDeResposta: async (c) => {
    // comentarioId é @unique: a semente já usou o comentário de A. Um comentário novo de A.
    const agora = new Date();
    const comentario = await ins(c, 'ComentarioComPalavra', {
      id: crypto.randomUUID(), pecaId: sementes.A.ref.pautaPecaId, commentId: `gatilho_envio_${MARCA}_${crypto.randomUUID()}`, midiaId: 'm',
      palavra: 'AGENTES', pessoaHmac: 'h', comentadoEm: agora, expiraEm: new Date(agora.getTime() + 86_400_000),
    });
    return {
      id: crypto.randomUUID(), comentarioId: comentario, loteItemId: 'i', pessoaHmac: 'h', estado: 'recusado',
      expiraEm: new Date(agora.getTime() + 86_400_000), atualizadoEm: agora,
    };
  },
  EnvioAoYoutube: async (c) => {
    // episodioId é @unique: a semente já usou o episódio de A. Um episódio novo de A.
    const agora = new Date();
    const rodada = await ins(c, 'PautaRodada', {
      id: crypto.randomUUID(), orgId: sementes.A.orgId, status: 'curada', titulo: `Rodada do envio ${MARCA}`,
      janelaIni: agora, janelaFim: agora,
    });
    const episodio = await ins(c, 'PautaEpisodio', {
      id: crypto.randomUUID(), rodadaId: rodada, numero: 901, titulo: 'Episódio do envio', atualizadoEm: agora,
    });
    return { id: crypto.randomUUID(), episodioId: episodio, sha256: 'b'.repeat(64), bytes: 1, atualizadoEm: agora };
  },
  PautaEpisodio: async (c) => {
    // rodadaId é @unique (uma rodada, um episódio): precisa de uma rodada nova.
    const agora = new Date();
    const rodada = await ins(c, 'PautaRodada', {
      id: crypto.randomUUID(), orgId: sementes.A.orgId, status: 'curada', titulo: `Rodada do gatilho ${MARCA}`,
      janelaIni: agora, janelaFim: agora,
    });
    return {
      id: crypto.randomUUID(), rodadaId: rodada, numero: 900, titulo: 'Episódio do gatilho',
      bioPageId: sementes.A.ref.bioPageId, atualizadoEm: agora,
    };
  },
};

/**
 * Modelo pai -> a chave dele em `sementes.<org>.ref`.
 *
 * É o que permite montar o cruzamento genericamente: pega a linha válida da org
 * A e troca UM pai pelo equivalente da org B.
 */
const REF_DA_SEMENTE: Record<string, string> = {
  Lead: 'leadId',
  WorkTask: 'workTaskId',
  WorkField: 'workFieldId',
  WorkFieldOption: 'workFieldOptionId',
  OnboardingTrilho: 'onboardingTrilhoId',
  BioPage: 'bioPageId',
  PautaPeca: 'pautaPecaId',
  AprovacaoDeLote: 'aprovacaoDeLoteId',
  ComentarioComPalavra: 'comentarioComPalavraId',
};

describe('orgId em todo filho de tenant (RF-T-01)', () => {
  it('a lista de filhos do código cobre exatamente os filhos com prova montada', () => {
    // Guarda contra o pior fracasso desta seção: filho novo entra em
    // modelos-globais.ts, ninguém escreve a linha de prova, e os it.each abaixo
    // passam a rodar um caso a menos — em silêncio.
    const declarados = FILHOS_COM_ORGID_REDUNDANTE.map((f) => f.modelo).sort();
    const comProva = Object.keys(LINHA_DE_FILHO).sort();
    expect(comProva, 'FILHOS_COM_ORGID_REDUNDANTE e LINHA_DE_FILHO divergiram.').toEqual(declarados);
    // 10 da migration `orgid_em_todo_filho` + `WorkApontamento` (esteira de
    // clientes, 17/09/2026) + os 4 filhos do trilho de onboarding (23/09/2026)
    // + `PautaEpisodio` (MC7, 23/09/2026) + `PautaPublicacao` (MD6, 24/09/2026)
    // + `ItemDoLote` (MD7, 24/09/2026) + `ComentarioComPalavra` (MD9, 25/09/2026)
    // + `EnvioAoYoutube` (MD10, 25/09/2026) + `EnvioDeResposta` (MD11, 25/09/2026)
    // + os 8 filhos de Lead do cockpit comercial (13/10/2026)
    // + `LeadReacao` (rodada da implantação I4, 18/10/2026).
    // Filho novo sobe este número no mesmo commit.
    expect(declarados.length).toBe(30);
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

// ---------------------------------------------------------------------------
// 9. O papel de aplicação e a sessão com tenant — RF-T-02, RF-R-01 (fatia 1.3)
//
// Esta seção NÃO depende de RLS estar ligada: ela cobra o que precisa existir
// ANTES. São três perguntas:
//   (a) existe um papel que não é dono das tabelas e não atravessa policy?
//   (b) a empresa da requisição chega até a CONEXÃO, e some quando a transação
//       acaba (senão a fila de conexões vaza a empresa de um pedido no outro)?
//   (c) uma consulta sem empresa resolvida FALHA — nunca devolve "todos"?
//
// Como a seção 7, ela deve estar VERDE desde a migration
// 20260911020000_papel_de_aplicacao. Vermelho aqui não é "a RLS ainda não
// chegou": é a infraestrutura dela faltando.
// ---------------------------------------------------------------------------

describe('papel de aplicação (RF-T-02)', () => {
  it(`o papel "${PAPEL_DE_APLICACAO}" existe`, () => {
    expect(
      papel.existe,
      `\nO papel "${PAPEL_DE_APLICACAO}" não existe neste banco.\n` +
        '  Ele é criado pela migration 20260911020000_papel_de_aplicacao — que AVISA e segue\n' +
        '  quando o usuário das migrations não tem SUPERUSER nem CREATEROLE, para não derrubar\n' +
        '  o deploy. Confira o log da migration; sem este papel a aplicação continua conectando\n' +
        '  como DONA das tabelas, e dono ignora policy de linha.\n',
    ).toBe(true);
  });

  it('não é superusuário e não atravessa a RLS', () => {
    expect(
      papel.superusuario,
      `"${PAPEL_DE_APLICACAO}" é SUPERUSER — nenhuma policy de linha vale para ele.`,
    ).toBe(false);
    expect(
      papel.atravessaRls,
      `\n"${PAPEL_DE_APLICACAO}" tem BYPASSRLS.\n` +
        '  É o atributo que desfaz o isolamento inteiro sem erro, sem log e sem ninguém notar.\n' +
        '  Conserto: ALTER ROLE ' + PAPEL_DE_APLICACAO + ' NOBYPASSRLS (exige superusuário).\n',
    ).toBe(false);
  });

  it('não é dono de nenhuma tabela de tenant (dono ignora policy sem FORCE)', () => {
    const dele = ALVOS.filter((a) => estadoRls.get(a.tabela)?.dono === PAPEL_DE_APLICACAO).map((a) => a.tabela);
    expect(
      dele,
      `\nO papel de aplicação é DONO de ${dele.length} tabela(s): ${dele.join(', ')}.\n` +
        '  Dono só obedece policy com FORCE ROW LEVEL SECURITY. Migration e seed é que rodam\n' +
        '  com o papel dono; a aplicação, não.\n',
    ).toEqual([]);
  });

  it('não cria estrutura no schema public', () => {
    // NÃO é esta permissão que fecha o ataque de search_path da seção 7 — e
    // dizer que era seria autorizar alguém a remover, um dia, a proteção que
    // realmente fecha.
    //
    // Medido em Postgres limpo (10/09/2026), conectado como `mktos_app`:
    //   has_schema_privilege('mktos_app','public','CREATE') = false
    //   CREATE TEMP TABLE "Lead" (...)                      → CREATE TABLE (!)
    //   to_regclass('"Lead"')                               → pg_temp_3."Lead"
    //   SELECT "orgId" FROM "Lead"        (SQL ingênuo)     → a empresa do ATACANTE
    //   SELECT "orgId" FROM public."Lead" (o que a função faz) → a empresa real
    // Todo papel recebe TEMP no banco por padrão (é permissão de PUBLIC, não do
    // schema), e o esquema temporário é pesquisado ANTES de `public`. Ou seja: o
    // pai de mentira não precisa de CREATE em public nenhum.
    //
    // Quem fecha o ataque é `mktos_orgid_do_pai` (onda 2): ela declara
    // `SET search_path TO pg_catalog, pg_temp` e monta o SELECT com
    // `format('... FROM %I.%I ...', TG_TABLE_SCHEMA, tabela_pai)` — schema
    // qualificado, vindo do gatilho e não do chamador. Medido acima: a linha
    // gravada levou a empresa do pai REAL. Se alguém tirar o `SET search_path`
    // ou a qualificação, o ataque volta mesmo com este caso aqui verde.
    //
    // Então por que manter a asserção? CREATE em public é permissão de
    // ESTRUTURA num papel que só deveria mexer em DADO: com ela o papel cria
    // índice, apaga tabela, instala extensão — e planta um pai de mentira
    // PERMANENTE, que sobrevive à sessão e atinge os outros. É mínimo
    // privilégio, não é a trava do search_path.
    expect(
      papel.criaNoSchema,
      `\n"${PAPEL_DE_APLICACAO}" tem CREATE no schema public.\n` +
        '  Ele passa a criar e apagar estrutura — um papel que deveria só ler e escrever dado.\n' +
        '  (A proteção contra sequestro de search_path é outra: o SET search_path e o schema\n' +
        '   qualificado dentro de mktos_orgid_do_pai. Ver o teste de sequestro na seção 7.)\n',
    ).toBe(false);
  });

  it('não altera, não apaga e não trunca o RASTRO', () => {
    // O REVOKE da migration 20260829161052_regua_porta_rastro estava dentro de um
    // `IF EXISTS (role mktos_app)` — e em banco novo aquele bloco roda antes de o
    // papel existir, sem efeito nenhum. A migration do papel repete o REVOKE; é
    // este teste que prova que a repetição não foi esquecida.
    const podeMexer = [
      papel.alteraRastro && 'UPDATE',
      papel.apagaRastro && 'DELETE',
      papel.truncaRastro && 'TRUNCATE',
    ].filter(Boolean);
    expect(
      podeMexer,
      `\nO papel de aplicação pode ${podeMexer.join('/')} no EventLog.\n` +
        '  O RASTRO é append-only (02-CONSTRAINTS: nunca apagar evento). As RULEs\n' +
        '  eventlog_sem_update/eventlog_sem_delete são a segunda barreira; a primeira é este REVOKE.\n',
    ).toEqual([]);
    expect(papel.existe && !papel.alteraRastro, 'sanidade: o papel existe e o REVOKE valeu').toBe(true);
  });

  it('não enxerga o histórico de migration', () => {
    expect(
      papel.veMigrations,
      '\nO papel de aplicação lê _prisma_migrations.\n' +
        '  Quem alcança essa tabela faz uma migration já aplicada rodar de novo no próximo deploy.\n',
    ).toBe(false);
  });

  it('tabela criada por migration futura já nasce com permissão', () => {
    // Sem ALTER DEFAULT PRIVILEGES, a PRIMEIRA migration que criar tabela derruba
    // a produção com "permission denied" — e o erro apareceria longe da causa.
    expect(
      papel.padraoParaTabelaNova,
      '\nNão há ALTER DEFAULT PRIVILEGES para o papel de aplicação no schema public.\n' +
        '  A próxima migration que criar tabela deixa a aplicação sem permissão nela.\n',
    ).toContain(PAPEL_DE_APLICACAO);
  });

  it('a conexão de leitura desta suíte é o papel restrito (quando ele pode entrar)', () => {
    // A versão anterior deste caso só conferia que `usuarioTenant` não era
    // string vazia — o que passa lendo como DONA das tabelas. Medido: sem
    // TENANT_DATABASE_URL, os 17 casos desta seção e das duas seguintes ficavam
    // VERDES lendo como dona, inclusive os que dizem "sob o papel restrito".
    // Verde frouxo exatamente na configuração em que ninguém configurou nada.
    console.info(
      `\n[isolamento] papel de aplicação: existe=${papel.existe} entra=${papel.entra} ` +
        `bypassrls=${papel.atravessaRls} | conexão de leitura: "${usuarioTenant}"\n`,
    );

    // Quando o papel EXISTE e PODE ENTRAR, não há desculpa: ler como outro
    // usuário é erro de configuração da rodada, e o resultado das seções de
    // isolamento não vale nada. Vira catraca.
    if (papel.existe && papel.entra) {
      expect(
        usuarioTenant,
        `\nA suíte está lendo como "${usuarioTenant}", e o papel "${PAPEL_DE_APLICACAO}" existe e tem senha.\n` +
          '  Dono de tabela ignora policy de linha sem FORCE: medido assim, o isolamento sai verde\n' +
          '  sem existir. Aponte a leitura para o papel restrito:\n' +
          `    TENANT_DATABASE_URL='postgresql://${PAPEL_DE_APLICACAO}:...@host:porta/banco'\n`,
      ).toBe(PAPEL_DE_APLICACAO);
      return;
    }

    // Papel sem senha (o estado logo depois da migration, e o padrão numa
    // máquina de desenvolvimento): aqui continua sendo diagnóstico, porque não
    // há como conectar com ele. O aviso diz o que fazer.
    console.warn(
      `[isolamento] lendo como "${usuarioTenant}" — NÃO é o papel restrito, e o resultado das\n` +
        '  seções de isolamento por linha não vale como medição. Para medir de verdade:\n' +
        `  DB_APP_PASSWORD='...' deploy/papel-app.sh   (ou ALTER ROLE ${PAPEL_DE_APLICACAO} WITH LOGIN PASSWORD '...')\n` +
        `  TENANT_DATABASE_URL='postgresql://${PAPEL_DE_APLICACAO}:...@host:porta/banco'\n`,
    );
    expect(usuarioTenant).not.toBe('');
  });
});

/**
 * Guarda dos casos que AFIRMAM estar medindo sob o papel restrito.
 *
 * Sem ela o título mente na configuração padrão: a leitura cai na conexão
 * ADMIN, o caso passa, e o que ficou provado foi o comportamento da DONA das
 * tabelas — que é justamente o papel que ignora policy de linha.
 */
function exigirPapelRestrito(): void {
  if (papel.existe && papel.entra && usuarioTenant !== PAPEL_DE_APLICACAO) {
    throw new Error(
      `\nEste caso afirma medir sob o papel restrito, mas a conexão de leitura é "${usuarioTenant}".\n` +
        `  O papel "${PAPEL_DE_APLICACAO}" existe e tem senha — falta apontar TENANT_DATABASE_URL para ele.\n`,
    );
  }
}

describe('a empresa chega até a conexão (RF-T-02)', () => {
  it(`${GUC_TENANT} vale dentro da transação e MORRE no fim dela`, async () => {
    // É a razão de cada consulta virar uma transação. `SET` (sem LOCAL) fica na
    // SESSÃO: a conexão volta para a fila carimbada com a empresa do último
    // pedido, e a consulta seguinte — de outro usuário, de outra empresa —
    // herdaria o carimbo. O isolamento viraria o vazamento.
    const dentro = await comoTenant(sementes.A.orgId, async (c) => {
      const r = await c.query<{ org: string }>(`SELECT current_setting($1, true) AS org`, [GUC_TENANT]);
      return r.rows[0].org;
    });
    expect(dentro, 'o SET LOCAL não chegou à sessão').toBe(sementes.A.orgId);

    const c = await tenant.connect();
    try {
      const r = await c.query<{ org: string | null }>(`SELECT current_setting($1, true) AS org`, [GUC_TENANT]);
      expect(
        r.rows[0].org ?? '',
        `\n${GUC_TENANT} sobreviveu à transação.\n` +
          '  Com fila de conexões isso vaza a empresa de um pedido para o seguinte.\n' +
          '  Use set_config(..., true) — o terceiro argumento é o que faz o valor ser LOCAL.\n',
      ).toBe('');
    } finally {
      c.release();
    }
  }, 30_000);

  it('o gatilho de derivação continua funcionando na conexão da aplicação', async () => {
    // O gatilho da onda 2 não é SECURITY DEFINER: ele roda com o papel de quem
    // escreveu, e precisa LER o pai. Um papel restrito sem SELECT no pai
    // transformaria toda escrita de filho num erro — em produção, na primeira
    // gravação. E é ele que, depois da RLS, vira a única barreira contra
    // empresa cruzada.
    //
    // O título diz "conexão da aplicação", e não "papel restrito", porque num
    // banco onde o papel ainda não tem senha a leitura cai na conexão ADMIN —
    // aí este caso mede a DONA das tabelas, não o papel. A guarda abaixo
    // recusa a única variante que seria mentira: papel com senha e leitura
    // apontada para outro usuário.
    exigirPapelRestrito();
    const derivado = await comoTenant(sementes.A.orgId, async (c) => {
      const id = crypto.randomUUID();
      await c.query(`INSERT INTO "LeadEvent" (id, "leadId", type) VALUES ($1, $2, 'gatilho_papel')`, [
        id,
        sementes.A.ref.leadId,
      ]);
      const r = await c.query<{ orgId: string }>('SELECT "orgId" FROM "LeadEvent" WHERE id = $1', [id]);
      return r.rows[0]?.orgId;
      // `comoTenant` desfaz tudo no ROLLBACK.
    });
    expect(
      derivado,
      `\nO gatilho mktos_orgid_do_pai não derivou a empresa com a conexão "${usuarioTenant}".\n` +
        '  Falta SELECT no pai para o papel de aplicação, ou o gatilho sumiu.\n',
    ).toBe(sementes.A.orgId);
  }, 30_000);

  it('o gatilho continua RECUSANDO empresa cruzada na conexão da aplicação', async () => {
    exigirPapelRestrito();
    const erro = await comoTenant(sementes.A.orgId, async (c) => {
      try {
        await c.query(
          `INSERT INTO "LeadEvent" (id, "leadId", "orgId", type) VALUES ($1, $2, $3, 'cruzado_papel')`,
          [crypto.randomUUID(), sementes.A.ref.leadId, sementes.B.orgId],
        );
        return '';
      } catch (e) {
        return (e as Error).message;
      }
    });
    expect(
      erro,
      `\nFilho da empresa A aceitou ser carimbado com a empresa B na conexão "${usuarioTenant}".\n` +
        '  Depois da RLS este gatilho é a ÚNICA barreira contra cruzamento na escrita.\n',
    ).toContain('empresa cruzada');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// 10. A extensão do Prisma: consulta sem tenant FALHA, nunca vaza
//
// As seções acima medem o BANCO. Esta mede o cliente: é ele quem declara a
// empresa a cada transação (apps/api/src/prisma/sessao-de-banco.ts). Sem esta
// camada o `app.org_id` nunca é preenchido e a policy, quando chegar, recusaria
// 100% das consultas.
// ---------------------------------------------------------------------------

describe('a extensão do Prisma declara a empresa em toda transação', () => {
  /** SQL que o cliente mandou ao banco na rodada — é assim que se conta BEGIN. */
  let sql: string[] = [];
  let cru: PrismaClient;
  let comTenant: PrismaClient;
  let rigoroso: PrismaClient;

  const LER_GUC = `SELECT current_setting('${GUC_TENANT}', true) AS org`;

  /** Roda dentro do contexto de execução — e ESPERA lá dentro. */
  function comEmpresa<T>(orgId: string | null, fn: () => Promise<T>): Promise<T> {
    // O `await` tem de acontecer DENTRO do escopo: a PrismaPromise é preguiçosa e
    // o gancho só roda na espera. Devolver a promessa e esperar fora fecharia o
    // contexto antes da hora — é exatamente o que o ContextoInterceptor evita ao
    // assinar o observable dentro do `comContexto`.
    return comContexto({ orgId, correlationId: novaCorrelacao('isolamento') }, async () => await fn());
  }

  beforeAll(() => {
    cru = new PrismaClient({
      datasourceUrl: URL_TENANT,
      log: [{ emit: 'event', level: 'query' }],
    });
    (cru as unknown as { $on: (e: 'query', cb: (ev: { query: string }) => void) => void }).$on(
      'query',
      (ev) => sql.push(ev.query),
    );
    comTenant = comTenantNaSessao(cru, { modo: 'observar', avisar: () => undefined });
    rigoroso = comTenantNaSessao(cru, { modo: 'impor', avisar: () => undefined });
    esquecerAvisos();
  });

  afterAll(async () => {
    await cru.$disconnect();
  });

  it('operação de modelo declara a empresa na mesma transação da consulta', async () => {
    sql = [];
    await comEmpresa(sementes.A.orgId, () => comTenant.lead.findMany({ select: { id: true }, take: 1 }));
    expect(sql.filter((s) => s === 'BEGIN').length, `uma transação, não mais: ${sql.join(' | ')}`).toBe(1);
    // A ORDEM importa: o SET LOCAL tem de ser a primeira coisa DEPOIS do BEGIN.
    // Declarado depois da consulta, ele não valeria para ela.
    expect(sql[0], `esperava BEGIN primeiro, veio: ${sql.join(' | ')}`).toBe('BEGIN');
    expect(sql[1] ?? '', `esperava o SET LOCAL logo após o BEGIN, veio: ${sql.join(' | ')}`).toContain(
      'set_config',
    );
  }, 30_000);

  it('consulta crua também recebe a empresa (é assim que a busca vetorial roda)', async () => {
    const r = await comEmpresa(sementes.B.orgId, () =>
      comTenant.$queryRawUnsafe<Array<{ org: string }>>(LER_GUC),
    );
    expect(
      r[0]?.org,
      '\n$queryRawUnsafe saiu SEM empresa na sessão.\n' +
        '  obsidian.service.ts e pauta.service.ts fazem busca vetorial só nessa forma — se ela\n' +
        '  escapar do gancho, a policy recusa a busca inteira quando a RLS entrar.\n',
    ).toBe(sementes.B.orgId);
  }, 30_000);

  it('$transaction interativa abre UMA transação e declara a empresa nela', async () => {
    // É o caminho do RASTRO: `pg_advisory_xact_lock` + leitura da cauda + insert,
    // tudo na MESMA transação. Se o gancho abrisse uma transação por operação, o
    // lock soltaria no commit de dentro e a cadeia de hashes bifurcaria com dois
    // escritores simultâneos — que é o único motivo daquele lock existir.
    sql = [];
    const dentro = await comEmpresa(sementes.A.orgId, () =>
      comTenant.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sementes.A.orgId}))`;
        const r = await tx.$queryRawUnsafe<Array<{ org: string }>>(LER_GUC);
        await tx.lead.findMany({ select: { id: true }, take: 1 });
        return r[0]?.org;
      }),
    );
    expect(dentro, 'a transação interativa correu sem empresa').toBe(sementes.A.orgId);
    expect(
      sql.filter((s) => s === 'BEGIN').length,
      `\nTransações aninhadas: ${sql.filter((s) => s === 'BEGIN').length} BEGIN.\n` +
        '  O `tx` entregue ao corpo precisa ser o do cliente CRU; o estendido faria cada\n' +
        '  operação de dentro abrir transação própria, em outra conexão.\n',
    ).toBe(1);
    expect(sql.filter((s) => s.includes('set_config')).length, 'um SET LOCAL por transação').toBe(1);
  }, 30_000);

  it('$transaction em lote continua atômica e com a empresa declarada', async () => {
    sql = [];
    const r = await comEmpresa(sementes.A.orgId, () =>
      comTenant.$transaction([
        comTenant.lead.findMany({ select: { id: true }, take: 1 }),
        comTenant.$queryRawUnsafe<Array<{ org: string }>>(LER_GUC),
      ]),
    );
    expect(
      sql.filter((s) => s === 'BEGIN').length,
      '\nO lote se partiu em várias transações — a atomicidade que bio/clickup/conciliação\n' +
        '  esperam dele desapareceu em silêncio.\n',
    ).toBe(1);
    expect(r, 'o lote devolveu itens a mais ou a menos que o chamador pediu').toHaveLength(2);
    expect((r[1] as Array<{ org: string }>)[0]?.org).toBe(sementes.A.orgId);
  }, 30_000);

  it('sem empresa em modo impor: LANÇA e nenhuma consulta chega ao banco', async () => {
    // O critério da fatia: consulta sem tenant resolvido FALHA — nunca devolve a
    // linha de outra empresa, e nunca devolve "todos" (RF-T-04).
    sql = [];
    await expect(
      comEmpresa(null, () => rigoroso.lead.findMany({ select: { id: true } })),
    ).rejects.toThrow(/tenant não resolvido/);
    expect(
      sql,
      `\nUma consulta sem empresa chegou ao banco: ${sql.join(' | ')}\n` +
        '  A recusa tem de acontecer ANTES da viagem — senão a proteção depende de a policy\n' +
        '  existir, e ela ainda não existe.\n',
    ).toEqual([]);

    await expect(comEmpresa(null, () => rigoroso.$transaction([rigoroso.lead.count()]))).rejects.toThrow(
      /tenant não resolvido/,
    );
    await expect(comEmpresa(null, () => rigoroso.$transaction(async () => 1))).rejects.toThrow(
      /tenant não resolvido/,
    );
    expect(sql, 'lote e transação interativa sem empresa também não podem viajar').toEqual([]);
  }, 30_000);

  it('sem empresa em modo observar: roda com a empresa VAZIA, nunca com "todos"', async () => {
    // O modo de produção hoje. A consulta não quebra — e é de propósito, senão o
    // deploy desta fatia derrubaria cron, rota pública e script de linha de
    // comando de uma vez. O que ela NÃO faz é sair sem declarar nada: com a
    // policy no lugar, `app.org_id` vazio não casa com linha nenhuma.
    const r = await comEmpresa(null, () => comTenant.$queryRawUnsafe<Array<{ org: string }>>(LER_GUC));
    expect(
      r[0]?.org,
      'consulta sem empresa saiu com app.org_id preenchido — de onde veio esse valor?',
    ).toBe('');
  }, 30_000);

  it('o inventário também levanta FILTRO DE EMPRESA DIVERGENTE (o desvio que some em silêncio)', async () => {
    /*
     * O outro jeito de o isolamento quebrar, e o que a fatia 1.5 acrescentou ao
     * inventário. Consulta COM empresa na sessão e um `where: { orgId }` escrito
     * à mão apontando para OUTRA:
     *
     *   hoje  — devolve o dado da empresa do argumento (é só um filtro);
     *   depois — devolve VAZIO, sem erro, porque a policy recorta pela empresa
     *            da SESSÃO e o filtro nunca casa.
     *
     * "Tela que some, sem log, em produção" é o pior sintoma possível. Este
     * aviso é o que permite levantar a lista ANTES da virada, com o sistema no
     * ar, em vez de por leitura de código.
     */
    esquecerAvisos();
    const avisos: string[] = [];
    const inventariante = comTenantNaSessao(cru, {
      modo: 'observar',
      avisar: (m) => avisos.push(m),
    });

    // sessão na empresa A, filtro escrito à mão na empresa B
    await comEmpresa(sementes.A.orgId, () =>
      inventariante.lead.findMany({ where: { orgId: sementes.B.orgId }, select: { id: true }, take: 1 }),
    );
    expect(
      avisos.filter((m) => m.includes('DIFERENTE da sessão')),
      '\nConsulta filtrando por empresa diferente da sessão passou sem entrar no inventário.\n' +
        '  É o desvio que, depois da virada, vira tela vazia sem erro e sem log.\n',
    ).toHaveLength(1);

    // e o caminho normal — filtro redundante, mas da MESMA empresa — não avisa
    avisos.length = 0;
    esquecerAvisos();
    await comEmpresa(sementes.A.orgId, () =>
      inventariante.lead.findMany({ where: { orgId: sementes.A.orgId }, select: { id: true }, take: 1 }),
    );
    expect(
      avisos,
      'filtro redundante pela PRÓPRIA empresa não é desvio: avisar aqui afogaria o inventário.',
    ).toEqual([]);
  }, 30_000);

  it('os literais das sentinelas são os MESMOS no código e no banco', async () => {
    /*
     * Três lugares carregam os dois valores: `src/common/tenant-publico.ts`,
     * `src/prisma/contexto-de-plataforma.ts` e as funções da migration do
     * isolamento. Eles não podem ser importados um do outro (SQL não importa
     * TypeScript, e importar `tenant-publico` de dentro de `sessao-de-banco`
     * fecharia um ciclo), então o que os mantém juntos é este caso.
     *
     * Divergir aqui não quebra teste nenhum por si: o banco simplesmente deixa
     * de reconhecer a sentinela, e as quatro rotas públicas viram 404 — ou o
     * login para, se for a de plataforma.
     */
    const r = await admin.query<{ nome: string; corpo: string }>(
      `SELECT p.proname AS nome, p.prosrc AS corpo
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('app_resolucao_publica', 'app_plataforma', 'app_org_resolvida')`,
    );
    const corpo = (nome: string) => r.rows.find((x) => x.nome === nome)?.corpo ?? '';

    expect(
      corpo('app_resolucao_publica'),
      `a função do banco não conhece ORG_RESOLUCAO_PUBLICA ("${ORG_RESOLUCAO_PUBLICA}")`,
    ).toContain(`'${ORG_RESOLUCAO_PUBLICA}'`);
    expect(
      corpo('app_plataforma'),
      `a função do banco não conhece ORG_PLATAFORMA ("${ORG_PLATAFORMA}")`,
    ).toContain(`'${ORG_PLATAFORMA}'`);
    // "empresa resolvida" é o complemento das duas: se uma sentinela nova nascer
    // e não entrar aqui, ela passa a contar como empresa de verdade e escreve.
    for (const sentinela of [ORG_RESOLUCAO_PUBLICA, ORG_PLATAFORMA]) {
      expect(
        corpo('app_org_resolvida'),
        `app_org_resolvida() não exclui "${sentinela}" — sob ela a escrita seria liberada.`,
      ).toContain(`'${sentinela}'`);
    }
  }, 30_000);
});
