import { AgentEstado, type Prisma, type PrismaClient, type Rotina } from '@prisma/client';
import { CADASTRO_DE_FUNCOES } from '@mktos/shared';

import { contextoAtual } from '../common/contexto-execucao';
import { ARRENDAMENTO_MS, LIVRE, estadoDispara, type ResultadoDaRotina } from './rotina.tipos';

/*
 * ============================================================================
 * AS ROTINAS DA CASA E A PASSAGEM DE TAREFA DE FUNDO (rodada dos agentes, 21/10/2026, A1)
 * ============================================================================
 *
 * Cinco trabalhos rodavam como `setInterval` dentro dos serviços e se
 * cadastravam como `Agent` (tipo `conector`) só para ter dono na tela: o
 * sincronizador do ClickUp, o indexador do vault, o conciliador bancário, o
 * coletor da bio e a ponte das metas. Eles não decidem nada com modelo: são
 * ROTINAS (cadastro único, campo `rotina`: `casa.clickup`, `casa.vault`,
 * `casa.conciliacao`, `casa.bio`, `casa.metas`). Até aqui, nenhuma passagem
 * deles deixava rastro na tela `/rotinas`: só o log do processo sabia.
 *
 * O QUE ESTE ARQUIVO FAZ, sem mudar quem dá o relógio:
 *
 *   · `registrarPassagemDeFundo` envolve UMA passagem do trabalho, numa empresa:
 *     garante a `Rotina` dela (estado declarado, nasce `rodando`), respeita o
 *     interruptor da tela (rotina pausada ou desligada em `/rotinas` NÃO roda),
 *     toma o arrendamento (a passagem do relógio e o "Rodar agora" nunca rodam
 *     juntos), mede a duração e grava `RotinaExecucao` com `ok`/`erro`/`pulada`;
 *   · `inscreverTarefaDaCasa` deixa o serviço dizer qual é o trabalho, para o
 *     executor `casa.*` (em `executores/casa.executor.ts`) rodá-lo quando alguém
 *     clica em "Rodar agora".
 *
 * QUEM DÁ O RELÓGIO CONTINUA SENDO O SERVIÇO (as variáveis `*_INTERVAL_MIN` de
 * sempre). O agendador de rotinas PULA os tipos `casa.*` no tique (ver
 * `rotinas.scheduler.ts`): disparar pelos dois lados faria a passagem em dobro.
 * O `cron` da linha é a mesma cadência, escrita para a tela.
 *
 * O RESUMO NUNCA LEVA DADO DE CLIENTE: contagens e motivos genéricos, como
 * `RotinaExecucao.resumo` exige.
 *
 * `pulada` VIRA LINHA AQUI, ao contrário das rotinas do agendador, porque a
 * rodada pediu o histórico com os três desfechos — mas a pulada REPETIDA (mesmo
 * motivo da última linha) não vira linha nova: "nada a fazer" de meia em meia
 * hora afogaria o que aconteceu de verdade. Pulada não mexe em contador.
 */

export const TIPO_CASA_CLICKUP = 'casa.clickup';
export const TIPO_CASA_VAULT = 'casa.vault';
export const TIPO_CASA_CONCILIACAO = 'casa.conciliacao';
export const TIPO_CASA_BIO = 'casa.bio';
export const TIPO_CASA_METAS = 'casa.metas';

export interface RotinaDaCasa {
  tipo: string;
  /** O id no cadastro único (`RO-01`, `CE-05`...). */
  funcao: string;
  slug: string;
  nome: string;
  /** A cadência padrão, escrita para a tela (o relógio de verdade é o do serviço). */
  cron: string;
  /** O intervalo padrão, em minutos, e a variável que o muda. */
  intervaloMin: number;
  variavel: string;
}

/** A cadência de cada uma: a mesma dos `setInterval` de sempre. */
const CADENCIA: Readonly<Record<string, { cron: string; intervaloMin: number; variavel: string }>> = {
  [TIPO_CASA_CLICKUP]: { cron: '0 * * * *', intervaloMin: 60, variavel: 'CLICKUP_SYNC_INTERVAL_MIN' },
  [TIPO_CASA_VAULT]: { cron: '*/30 * * * *', intervaloMin: 30, variavel: 'OBSIDIAN_REINDEX_MIN' },
  [TIPO_CASA_CONCILIACAO]: { cron: '0 */6 * * *', intervaloMin: 360, variavel: 'PLUGGY_SYNC_INTERVAL_MIN' },
  [TIPO_CASA_BIO]: { cron: '0 */6 * * *', intervaloMin: 360, variavel: 'BIO_SYNC_INTERVAL_MIN' },
  [TIPO_CASA_METAS]: { cron: '0 */12 * * *', intervaloMin: 720, variavel: 'BIO_BRIDGE_INTERVAL_MIN' },
};

/**
 * As rotinas da casa, lidas do CADASTRO ÚNICO (a linha com `rotina: 'casa.*'`):
 * o slug, o nome e a função vêm de lá; a cadência mora aqui.
 */
export const ROTINAS_DA_CASA: readonly RotinaDaCasa[] = CADASTRO_DE_FUNCOES.filter(
  (f) => f.rotina && CADENCIA[f.rotina],
).map((f) => ({
  tipo: f.rotina!,
  funcao: f.id,
  slug: f.slug,
  nome: f.nome,
  ...CADENCIA[f.rotina!],
}));

export const TIPOS_DA_CASA: readonly string[] = Object.keys(CADENCIA);

export function ehTipoDaCasa(tipo: string): boolean {
  return TIPOS_DA_CASA.includes(tipo);
}

export function rotinaDaCasa(tipo: string): RotinaDaCasa {
  const r = ROTINAS_DA_CASA.find((x) => x.tipo === tipo);
  if (!r) throw new Error(`rotina da casa desconhecida: "${tipo}" (o cadastro único não tem linha com esse tipo)`);
  return r;
}

// ---------------------------------------------------------------------------
// O TRABALHO DE CADA TIPO, para o "Rodar agora"
// ---------------------------------------------------------------------------

export type TarefaDaCasa = (orgId: string, agora: Date) => Promise<ResultadoDaRotina>;

/*
 * Um mapa do processo, e não um provider: os serviços que inscrevem (ClickUp,
 * Obsidian, Financeiro, Bio) estão em módulos que o `RoutinesModule` não importa
 * (e importar formaria ciclo). A inscrição REPETIDA substitui a anterior em vez
 * de lançar, porque a suíte monta a aplicação mais de uma vez no mesmo processo.
 */
const TAREFAS = new Map<string, { fn: TarefaDaCasa; quem: string }>();

export function inscreverTarefaDaCasa(tipo: string, fn: TarefaDaCasa, quem: string): void {
  if (!ehTipoDaCasa(tipo)) throw new Error(`"${tipo}" não é uma rotina da casa (inscrita por ${quem})`);
  TAREFAS.set(tipo, { fn, quem });
}

export function tarefaDaCasa(tipo: string): TarefaDaCasa | null {
  return TAREFAS.get(tipo)?.fn ?? null;
}

// ---------------------------------------------------------------------------
// A PASSAGEM
// ---------------------------------------------------------------------------

type PrismaDeRotinas = Pick<PrismaClient, 'rotina' | 'rotinaExecucao'>;

export interface OpcoesDaPassagem {
  agora?: Date;
  /**
   * `sempre` cria a `Rotina` na primeira passagem, qualquer que seja o desfecho;
   * `se-houver-trabalho` (padrão) só cria quando a passagem não foi `pulada` —
   * a empresa que nunca teve banco conectado não ganha uma rotina de conciliação
   * vazia na tela.
   */
  criar?: 'sempre' | 'se-houver-trabalho';
  /** O intervalo efetivo (a variável do serviço), para a próxima passagem na tela. */
  intervaloMin?: number;
}

/**
 * Garante a `Rotina` da casa nesta empresa. Idempotente (`orgId`+`slug` é único).
 * `criada` diz se ESTA chamada a criou: é o gancho do "nasce desligado" do ClickUp.
 */
export async function garantirRotinaDaCasa(
  prisma: PrismaDeRotinas,
  orgId: string,
  tipo: string,
  agora: Date = new Date(),
  intervaloMin?: number,
): Promise<{ rotina: Rotina; criada: boolean }> {
  const def = rotinaDaCasa(tipo);
  const existente = await prisma.rotina.findUnique({ where: { orgId_slug: { orgId, slug: def.slug } } });
  if (existente) return { rotina: existente, criada: false };
  try {
    const rotina = await prisma.rotina.create({
      data: {
        orgId,
        slug: def.slug,
        nome: def.nome,
        tipo: def.tipo,
        config: {} as Prisma.InputJsonValue,
        cron: def.cron,
        tz: 'America/Sao_Paulo',
        ativo: true,
        // Já rodava antes de ter linha: o estado declarado é o de produção.
        estado: AgentEstado.rodando,
        origem: 'casa',
        refExterna: def.tipo,
        agenteSlug: def.slug,
        reservadoEm: LIVRE,
        reservadoAte: LIVRE,
        proximaExecucaoEm: new Date(agora.getTime() + (intervaloMin ?? def.intervaloMin) * 60_000),
      },
    });
    return { rotina, criada: true };
  } catch (e) {
    // Corrida com outra réplica (índice único): quem chegou primeiro criou.
    const depois = await prisma.rotina.findUnique({ where: { orgId_slug: { orgId, slug: def.slug } } });
    if (depois) return { rotina: depois, criada: false };
    throw e;
  }
}

/**
 * UMA passagem de tarefa de fundo, registrada no histórico de rotinas.
 *
 * Nunca lança por causa do registro: o trabalho é o que importa, e uma falha ao
 * ler ou gravar a rotina e o histórico só vai ao log (o trabalho roda assim
 * mesmo, como rodava antes de existir histórico). O erro do PRÓPRIO trabalho
 * vira `erro` no histórico e é devolvido como resultado (quem chama decide se loga).
 */
export async function registrarPassagemDeFundo(
  prisma: PrismaDeRotinas,
  p: { orgId: string; tipo: string },
  trabalho: () => Promise<ResultadoDaRotina>,
  opcoes: OpcoesDaPassagem = {},
): Promise<ResultadoDaRotina> {
  const agora = opcoes.agora ?? new Date();
  const def = rotinaDaCasa(p.tipo);
  const intervaloMin = opcoes.intervaloMin && opcoes.intervaloMin > 0 ? opcoes.intervaloMin : def.intervaloMin;

  let rotina: Rotina | null = null;
  let semRegistro = false;
  try {
    rotina = await prisma.rotina.findUnique({ where: { orgId_slug: { orgId: p.orgId, slug: def.slug } } });
    if (!rotina && opcoes.criar === 'sempre') {
      rotina = (await garantirRotinaDaCasa(prisma, p.orgId, p.tipo, agora, intervaloMin)).rotina;
    }

    // O INTERRUPTOR DA TELA: pausada ou desligada em /rotinas, não roda.
    if (rotina && !(rotina.ativo && estadoDispara(rotina.estado))) {
      const r: ResultadoDaRotina = { status: 'pulada', resumo: 'rotina pausada ou desligada em /rotinas' };
      await gravar(prisma, rotina, r, { agora, duracaoMs: 0, intervaloMin, erro: null });
      return r;
    }

    // O ARRENDAMENTO: a passagem do relógio e o "Rodar agora" nunca rodam juntas.
    if (rotina) {
      const tomado = await prisma.rotina.updateMany({
        where: { id: rotina.id, reservadoAte: { lt: agora } },
        data: { reservadoAte: new Date(agora.getTime() + ARRENDAMENTO_MS) },
      });
      if (tomado.count === 0) return { status: 'pulada', resumo: 'outra passagem desta rotina está em curso' };
    }
  } catch (e) {
    semRegistro = true;
    rotina = null;
    console.error(
      `[rotinas-da-casa] "${def.slug}" (${p.orgId}): a rotina não pôde ser lida (${(e as Error).message}). ` +
        'O trabalho roda assim mesmo, sem histórico desta passagem.',
    );
  }

  const t0 = Date.now();
  let r: ResultadoDaRotina;
  let erro: string | null = null;
  try {
    r = await trabalho();
  } catch (e) {
    erro = String((e as Error)?.message ?? e).slice(0, 500);
    r = { status: 'erro', resumo: erro };
  }
  const duracaoMs = Date.now() - t0;

  if (!rotina) {
    if (r.status === 'pulada' || semRegistro) return r;
    try {
      rotina = (await garantirRotinaDaCasa(prisma, p.orgId, p.tipo, agora, intervaloMin)).rotina;
    } catch {
      return r;
    }
  }
  await gravar(prisma, rotina, r, { agora, duracaoMs, intervaloMin, erro, inicio: new Date(t0) });
  return r;
}

async function gravar(
  prisma: PrismaDeRotinas,
  rotina: Rotina,
  r: ResultadoDaRotina,
  p: { agora: Date; duracaoMs: number; intervaloMin: number; erro: string | null; inicio?: Date },
): Promise<void> {
  const resumo = (r.resumo ?? '').slice(0, 500);
  try {
    let gravarLinha = true;
    if (r.status === 'pulada') {
      const ultima = await prisma.rotinaExecucao.findFirst({
        where: { orgId: rotina.orgId, rotinaId: rotina.id },
        orderBy: { inicioEm: 'desc' },
        select: { status: true, resumo: true },
      });
      gravarLinha = !(ultima && ultima.status === 'pulada' && ultima.resumo === resumo);
    }
    if (gravarLinha) {
      await prisma.rotinaExecucao.create({
        data: {
          orgId: rotina.orgId,
          rotinaId: rotina.id,
          status: r.status,
          origem: 'cron',
          inicioEm: p.inicio ?? p.agora,
          fimEm: new Date(),
          duracaoMs: p.duracaoMs,
          resumo: p.erro ? null : resumo,
          erro: p.erro,
          correlationId: contextoAtual()?.correlationId ?? null,
        },
      });
    }
    await prisma.rotina.update({
      where: { id: rotina.id },
      data: {
        ...(r.status === 'pulada'
          ? {}
          : {
              execucoes: { increment: 1 },
              ...(r.status === 'erro' ? { falhas: { increment: 1 } } : {}),
              ultimaExecucaoEm: p.agora,
              ultimoStatus: `${r.status}: ${resumo}`.slice(0, 300),
            }),
        proximaExecucaoEm: new Date(p.agora.getTime() + p.intervaloMin * 60_000),
        reservadoAte: LIVRE,
      },
    });
  } catch (e) {
    // O trabalho aconteceu; só o diário de bordo falhou. Não derruba quem chamou.
    console.error(
      `[rotinas-da-casa] "${rotina.slug}" (${rotina.orgId}) rodou (${r.status}) e o histórico não foi gravado: ` +
        `${(e as Error).message}`,
    );
  }
}
