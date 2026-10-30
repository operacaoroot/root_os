import { Injectable, Logger } from '@nestjs/common';
import { ActorType, AgentEstado, Prisma } from '@prisma/client';
import {
  AGENDA_ESPELHO_ATRASO_MAXIMO_MS,
  AGENDA_JANELA_DIAS,
  SOCIOS_DA_AGENDA,
  feriadosDoAno,
  type EstadoDaSincronia,
  type EventoDaAgenda,
  type RespostaDoEspelho,
  type SocioDaAgenda,
} from '@mktos/shared';

import { exigirTenant } from '../../common/contexto-execucao';
import { InterruptoresRegistry } from '../../gateway/interruptores.registry';
import { PortaDoOperador } from '../../gateway/porta-do-operador.service';
import {
  CAPACIDADE_DE_LIVRE_OCUPADO,
  CAPACIDADE_DE_SINCRONIZAR,
  type PaginaDaSincronia,
  type RespostaDoLivreOcupado,
} from '../../google/agenda-espelho.google';
import { RegistroDeConectores } from '../../integrations/conectores.registry';
import { proximaOcorrencia } from '../../pauta/cron';
import { PrismaService } from '../../prisma/prisma.service';
import type { ResultadoDaRotina } from '../../routines/rotina.tipos';
import { TIPO_AGENDA_COPIA, TIPO_AGENDA_SINCRONIZAR } from '../../routines/rotina.tipos';
import { ehEmpresaDaCasa } from '../../tenants/empresa-da-casa';
import {
  AGENDA_DA_CASA,
  eventoDaLeituraDireta,
  eventoDaLinha,
  linhaDoEvento,
  linhaDoIntervalo,
  type LinhaDoEspelho,
} from './espelho-do-google';

/*
 * O ESPELHO DA AGENDA (agenda v2, 29/10/2026, lane G1, decisão 1).
 *
 * Cópia SÓ DE LEITURA da agenda do Google da casa (`AgendaEvento`), atualizada
 * pela rotina `agenda.sincronizar` (a cada 2 min, empresa da casa, leitura R0
 * pela porta). Ninguém a edita: a escrita vai ao Google pela porta e volta por
 * aqui (`refletir` logo depois da escrita, a sincronia em seguida).
 *
 * UMA PASSAGEM (`passagem`):
 *   1. só na empresa da casa, com o Google Agenda ligado em Conexões e o Google
 *      conectado (a mesma pergunta do vigia AG-01: interruptor `gcal`, depois a
 *      sonda do contrato). Não sendo, `pulada` e nada é lido;
 *   2. `comunicacao.agenda.sincronizar` pela porta, como sistema (ator
 *      `espelho-da-agenda`): com `syncToken`, só o que mudou; sem ele (primeira
 *      vez, ou o Google respondeu 410), a janela inteira de -30 a +180 dias;
 *   3. cada evento vira linha por `(orgId, agenda, googleId)`. Cancelado no
 *      Google vira `status: cancelado` — a linha NUNCA é apagada (a tela some com
 *      ele, o histórico fica). Na janela completa, o que o espelho tinha e o
 *      Google não devolveu também vira `cancelado`;
 *   4. `comunicacao.agenda.livre_ocupado` das agendas pessoais com Fechado
 *      ligado em Regras (decisão 3): os intervalos viram linhas `livre_ocupado`
 *      sem título. ESSAS linhas são do OS e são trocadas a cada passagem (as que
 *      saíram são apagadas do espelho, as novas entram); nada é apagado no Google.
 *
 * LEITURA (`periodo`): do espelho, se a última passagem tem menos de 10 min; senão
 * direto do Google pela porta (`comunicacao.agenda.periodo`, a leitura da tela
 * antes da v2), com `fonte: google` e `sincronia.atrasada: true`.
 */

const DIA = 24 * 60 * 60 * 1000;
/** O ator da porta e o slug da rotina. */
export const SLUG_DO_ESPELHO = 'espelho-da-agenda';
export const SLUG_DA_COPIA = 'copia-da-agenda';
export const CRON_DO_ESPELHO = '*/2 * * * *';
export const CRON_DA_COPIA = '0 3 * * *';
export const FUSO_DO_ESPELHO = 'America/Sao_Paulo';
export const CONECTOR_DA_AGENDA = 'gcal';
export const CONECTOR_DO_CONTRATO = 'google';
export const CAPACIDADE_DA_LEITURA_DIRETA = 'comunicacao.agenda.periodo';
/** Páginas de 250 por passagem: 40 = 10 mil eventos, folga larga para 210 dias de agenda. */
export const TETO_DE_PAGINAS = 40;
/** O livre/ocupado olha de uma semana atrás a 90 dias à frente, em pedaços de até 60 dias. */
export const LIVRE_OCUPADO_DIAS = { antes: 7, depois: 90, pedaco: 60 } as const;
/** O argsSchema da capacidade aceita até 10 agendas por chamada. */
const AGENDAS_POR_CHAMADA = 10;
const TETO_DA_LEITURA_DIRETA = 2500;
const LIVRE = new Date(0);

export const RESUMO_FORA_DA_CASA = 'O espelho da agenda só roda na empresa da casa: nada foi lido.';

const ehRetida = (r: unknown): boolean =>
  !!r && typeof r === 'object' && (r as { status?: unknown }).status === 'aguardando_aprovacao';

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export interface OpcoesDoPeriodo {
  incluirCancelados?: boolean;
  /** Quem lê, na leitura direta (o RASTRO diz quem). Sem ele, o sistema (`espelho-da-agenda`). */
  actorId?: string;
  /** Leva a descrição de cada evento (o vigia AG-01 e o detalhe). */
  comDescricao?: boolean;
  /** O relógio, trocável no teste. */
  agora?: Date;
}

/** O que a passagem contou (o resumo da rotina leva só números). */
interface ContaDaPassagem {
  modo: 'incremental' | 'completa';
  lidos: number;
  gravados: number;
  cancelados: number;
  fechadoNovos: number;
  fechadoSaidos: number;
  agendasComErro: number;
}

@Injectable()
export class EspelhoService {
  private readonly log = new Logger('EspelhoDaAgenda');
  private readonly semeadas = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly porta: PortaDoOperador,
    private readonly interruptores: InterruptoresRegistry,
    private readonly conectores: RegistroDeConectores,
  ) {}

  // ------------------------------------------------------------------ perguntas

  /** A empresa é a da casa? (`tenants/empresa-da-casa.ts`, a mesma do vigia.) */
  protected ehDaCasa(orgId: string): Promise<boolean> {
    return ehEmpresaDaCasa(this.prisma, orgId);
  }

  /**
   * Por que NÃO ler o Google agora: o interruptor do Google Agenda desligado, ou
   * o Google não conectado nesta empresa (a sonda do contrato, não a variável).
   * Nulo = pode ler.
   */
  async motivoParaNaoLer(orgId: string, capabilityId: string = CAPACIDADE_DE_SINCRONIZAR): Promise<string | null> {
    const recusa = await this.interruptores.consultar({
      orgId,
      capabilityId,
      conector: CONECTOR_DA_AGENDA,
      actorType: ActorType.system,
      actorId: SLUG_DO_ESPELHO,
      agentSlug: SLUG_DO_ESPELHO,
    });
    if (recusa) return 'Google Agenda desligado em Conexões nesta empresa.';
    const saude = await this.conectores.sondar({ orgId, chave: CONECTOR_DO_CONTRATO });
    if (saude.estado !== 'conectado') return `Google não conectado nesta empresa (${saude.estado}).`;
    return null;
  }

  /** Os nomes que a gramática reconhece como feriado: a tabela da empresa, ou os nacionais do ano. */
  async feriados(orgId: string, agora: Date = new Date()): Promise<string[]> {
    const daEmpresa = await this.prisma.feriado.findMany({ where: { orgId }, select: { nome: true } });
    if (daEmpresa.length > 0) return [...new Set(daEmpresa.map((f) => f.nome))];
    const ano = agora.getUTCFullYear();
    return [...new Set([ano - 1, ano, ano + 1].flatMap((a) => feriadosDoAno(a).map((f) => f.nome)))];
  }

  // ------------------------------------------------------------------ rotinas

  /**
   * Semeia as rotinas `agenda.sincronizar` (a cada 2 min) e `agenda.copia`
   * (03:00), as duas em São Paulo. Idempotente (uma vez por processo e empresa;
   * rotina que já existe não é tocada: se alguém a pausou em /rotinas, fica
   * pausada); nunca lança. SÓ NA EMPRESA DA CASA, e nascem LIGADAS só se o
   * Google Agenda estiver conectado (senão desligadas, `planejado`).
   */
  async garantirRotinas(orgId: string, agora: Date = new Date()): Promise<void> {
    if (!orgId || this.semeadas.has(orgId)) return;
    try {
      if (!(await this.ehDaCasa(orgId))) return;
      const ligada = (await this.motivoParaNaoLer(orgId).catch(() => 'sem resposta')) === null;
      const semear = async (slug: string, nome: string, tipo: string, cron: string) => {
        await this.prisma.rotina.upsert({
          where: { orgId_slug: { orgId, slug } },
          create: {
            orgId,
            slug,
            nome,
            tipo,
            config: {} as Prisma.InputJsonValue,
            cron,
            tz: FUSO_DO_ESPELHO,
            ativo: ligada,
            estado: ligada ? AgentEstado.rodando : AgentEstado.planejado,
            origem: 'manual',
            refExterna: null,
            agenteSlug: null,
            reservadoEm: LIVRE,
            reservadoAte: LIVRE,
            proximaExecucaoEm: proximaOcorrencia(cron, FUSO_DO_ESPELHO, agora),
          },
          update: {},
        });
      };
      await semear(SLUG_DO_ESPELHO, 'Espelho da agenda (sincronia)', TIPO_AGENDA_SINCRONIZAR, CRON_DO_ESPELHO);
      await semear(SLUG_DA_COPIA, 'Cópia diária da agenda', TIPO_AGENDA_COPIA, CRON_DA_COPIA);
      this.semeadas.add(orgId);
    } catch (e) {
      this.log.warn(`empresa ${orgId}: não semeei as rotinas do espelho da agenda: ${(e as Error).message}`);
    }
  }

  // ------------------------------------------------------------------ passagem

  /** Uma passagem da sincronia. Ver o cabeçalho. */
  async passagem(orgIdBruto: string, agora: Date = new Date()): Promise<ResultadoDaRotina> {
    const orgId = exigirTenant(orgIdBruto, 'EspelhoService.passagem');
    if (!(await this.ehDaCasa(orgId))) return { status: 'pulada', resumo: RESUMO_FORA_DA_CASA };
    const motivo = await this.motivoParaNaoLer(orgId);
    if (motivo) return { status: 'pulada', resumo: `${motivo} Nada foi lido.` };

    const sinc = await this.prisma.agendaSincronia.upsert({
      where: { orgId_agenda: { orgId, agenda: AGENDA_DA_CASA } },
      create: { orgId, agenda: AGENDA_DA_CASA },
      update: {},
    });

    let conta: ContaDaPassagem;
    try {
      conta = await this.sincronizarACasa(orgId, sinc.syncToken, agora);
    } catch (e) {
      const erro = (e as Error).message.slice(0, 500);
      await this.prisma.agendaSincronia.update({
        where: { orgId_agenda: { orgId, agenda: AGENDA_DA_CASA } },
        data: { erro },
      });
      throw e;
    }
    const fechado = await this.sincronizarLivreOcupado(orgId, agora);
    conta = { ...conta, ...fechado };

    const mudou = conta.lidos + conta.cancelados + conta.fechadoNovos + conta.fechadoSaidos > 0;
    const resumo =
      `Espelho (${conta.modo === 'completa' ? 'janela completa' : 'incremental'}): ${conta.lidos} evento(s) lido(s), ` +
      `${conta.cancelados} dado(s) por cancelado(s); Fechado: ${conta.fechadoNovos} novo(s), ${conta.fechadoSaidos} saído(s)` +
      (conta.agendasComErro ? `, ${conta.agendasComErro} agenda(s) pessoal(is) com erro.` : '.');
    // A agenda pessoal que segue sem compartilhar não faz de cada passagem uma linha de histórico:
    // o erro dela fica na `AgendaSincronia` daquela agenda.
    if (!mudou) {
      return {
        status: 'pulada',
        resumo: 'Nada mudou na agenda desde a última passagem' +
          (conta.agendasComErro ? ` (${conta.agendasComErro} agenda(s) pessoal(is) com erro).` : '.'),
      };
    }
    return { status: 'ok', resumo };
  }

  /** A janela da sincronia completa. */
  janela(agora: Date): { de: Date; ate: Date } {
    return {
      de: new Date(agora.getTime() - AGENDA_JANELA_DIAS.antes * DIA),
      ate: new Date(agora.getTime() + AGENDA_JANELA_DIAS.depois * DIA),
    };
  }

  private async lerPagina(orgId: string, args: Record<string, unknown>): Promise<PaginaDaSincronia> {
    try {
      const r = await this.porta.executar<PaginaDaSincronia>({
        orgId,
        actorId: SLUG_DO_ESPELHO,
        actorType: ActorType.system,
        capabilityId: CAPACIDADE_DE_SINCRONIZAR,
        args,
        resource: { type: CAPACIDADE_DE_SINCRONIZAR, id: 'agenda-da-root' },
      });
      if (ehRetida(r)) {
        throw new Error('A porta reteve a LEITURA da agenda para aprovação: nada foi lido. Confira o nível de comunicacao.agenda.sincronizar.');
      }
      const p = r as PaginaDaSincronia;
      return {
        itens: Array.isArray(p?.itens) ? p.itens : [],
        nextSyncToken: p?.nextSyncToken ?? null,
        nextPageToken: p?.nextPageToken ?? null,
        ...(p?.tokenVencido ? { tokenVencido: true } : {}),
      };
    } catch (e) {
      // A porta transforma erro de efeito em 400 com a mensagem do `ErroDoGoogle`.
      if (args.syncToken && /HTTP 410\b/.test((e as Error).message)) {
        return { itens: [], nextSyncToken: null, nextPageToken: null, tokenVencido: true };
      }
      throw e;
    }
  }

  private async sincronizarACasa(orgId: string, tokenGuardado: string | null, agora: Date): Promise<ContaDaPassagem> {
    const feriados = await this.feriados(orgId, agora);
    const { de, ate } = this.janela(agora);
    let token = tokenGuardado;
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const completa = !token;
      const conta: ContaDaPassagem = {
        modo: completa ? 'completa' : 'incremental', lidos: 0, gravados: 0, cancelados: 0, fechadoNovos: 0, fechadoSaidos: 0, agendasComErro: 0,
      };
      const vistos = new Set<string>();
      let pagina: string | null = null;
      let proximoToken: string | null = null;
      let vencido = false;
      for (let n = 0; n < TETO_DE_PAGINAS; n++) {
        const args: Record<string, unknown> = completa
          ? { de: de.toISOString(), ate: ate.toISOString() }
          : { syncToken: token };
        if (pagina) args.pagina = pagina;
        const p = await this.lerPagina(orgId, args);
        if (p.tokenVencido) {
          vencido = true;
          break;
        }
        for (const cru of p.itens) {
          conta.lidos++;
          const r = await this.gravarDoGoogle(orgId, cru, feriados);
          if (r.googleId) vistos.add(r.googleId);
          if (r.efeito === 'gravado') conta.gravados++;
          if (r.efeito === 'cancelado') conta.cancelados++;
        }
        if (p.nextPageToken) {
          pagina = p.nextPageToken;
          continue;
        }
        proximoToken = p.nextSyncToken;
        pagina = null;
        break;
      }
      if (vencido) {
        // 410: o token venceu. Zera e refaz a janela inteira, uma vez.
        this.log.log(`empresa ${orgId}: o syncToken da agenda venceu (410); refazendo a janela de -${AGENDA_JANELA_DIAS.antes} a +${AGENDA_JANELA_DIAS.depois} dias`);
        await this.prisma.agendaSincronia.update({
          where: { orgId_agenda: { orgId, agenda: AGENDA_DA_CASA } },
          data: { syncToken: null },
        });
        token = null;
        continue;
      }
      if (pagina) throw new Error(`A agenda passou de ${TETO_DE_PAGINAS} páginas numa passagem: o espelho não foi fechado. Nada foi dado por cancelado.`);

      if (completa) {
        // O que o espelho tinha na janela e o Google não devolveu: cancelado (nunca apagado).
        const sumidos = await this.prisma.agendaEvento.updateMany({
          where: {
            orgId,
            agenda: AGENDA_DA_CASA,
            origem: 'google',
            status: { not: 'cancelado' },
            inicio: { lt: ate },
            fim: { gt: de },
            ...(vistos.size ? { googleId: { notIn: [...vistos] } } : {}),
          },
          data: { status: 'cancelado', sincronizadoEm: agora },
        });
        conta.cancelados += sumidos.count;
      }
      await this.prisma.agendaSincronia.update({
        where: { orgId_agenda: { orgId, agenda: AGENDA_DA_CASA } },
        data: {
          syncToken: proximoToken,
          ultimaPassagem: agora,
          erro: null,
          ...(completa ? { ultimaCompleta: agora, janelaDe: de, janelaAte: ate } : {}),
        },
      });
      return conta;
    }
    throw new Error('O Google recusou o syncToken duas vezes seguidas (410): o espelho não foi atualizado.');
  }

  /** Grava (ou dá por cancelado) um evento cru do Google. */
  private async gravarDoGoogle(
    orgId: string,
    cru: unknown,
    feriados: readonly string[],
  ): Promise<{ googleId: string | null; efeito: 'gravado' | 'cancelado' | 'nada'; linha?: LinhaDoEspelho }> {
    const d = linhaDoEvento(cru, feriados, AGENDA_DA_CASA);
    if (d.tipo === 'invalido') return { googleId: null, efeito: 'nada' };
    if (d.tipo === 'cancelado') {
      const r = await this.prisma.agendaEvento.updateMany({
        where: { orgId, agenda: AGENDA_DA_CASA, googleId: d.googleId, status: { not: 'cancelado' } },
        data: { status: 'cancelado', sincronizadoEm: new Date() },
      });
      return { googleId: d.googleId, efeito: r.count ? 'cancelado' : 'nada' };
    }
    const l = d.linha;
    if (l.status === 'cancelado') {
      // Cancelado que o espelho nunca teve não entra; o que tinha muda de estado (e de dados).
      const r = await this.prisma.agendaEvento.updateMany({
        where: { orgId, agenda: AGENDA_DA_CASA, googleId: l.googleId },
        data: { ...this.dados(l), sincronizadoEm: new Date() },
      });
      return { googleId: l.googleId, efeito: r.count ? 'cancelado' : 'nada', linha: l };
    }
    await this.prisma.agendaEvento.upsert({
      where: { orgId_agenda_googleId: { orgId, agenda: l.agenda, googleId: l.googleId } },
      create: { orgId, ...this.dados(l) },
      update: { ...this.dados(l), sincronizadoEm: new Date() },
    });
    return { googleId: l.googleId, efeito: 'gravado', linha: l };
  }

  private dados(l: LinhaDoEspelho) {
    return {
      agenda: l.agenda,
      origem: l.origem,
      googleId: l.googleId,
      titulo: l.titulo,
      descricao: l.descricao,
      inicio: l.inicio,
      fim: l.fim,
      diaInteiro: l.diaInteiro,
      local: l.local,
      meet: l.meet,
      convidados: l.convidados as unknown as Prisma.InputJsonValue,
      organizador: l.organizador,
      organizadorEhAgenda: l.organizadorEhAgenda,
      status: l.status,
      atualizadoNoGoogle: l.atualizadoNoGoogle,
      serieId: l.serieId,
      criadoPeloOs: l.criadoPeloOs,
      link: l.link,
      leituraTipo: l.leituraTipo,
      leituraCliente: l.leituraCliente,
      leituraResponsaveis: l.leituraResponsaveis,
      leituraModalidade: l.leituraModalidade,
      leituraMotivo: l.leituraMotivo,
      propriedades: l.propriedades as Prisma.InputJsonValue,
    };
  }

  /** As agendas pessoais com Fechado ligado: e-mail (minúsculo) → sócio. */
  async agendasPessoais(orgId: string): Promise<Map<string, SocioDaAgenda>> {
    const regras = await this.prisma.agendaRegraPessoa.findMany({
      where: { orgId, fechadoLigado: true, emailPessoal: { not: null } },
      select: { nome: true, emailPessoal: true },
      orderBy: { ordem: 'asc' },
    });
    const mapa = new Map<string, SocioDaAgenda>();
    for (const r of regras) {
      const email = (r.emailPessoal ?? '').trim().toLowerCase();
      const nome = SOCIOS_DA_AGENDA.find((s) => s === r.nome);
      if (nome && email.length <= 254 && EMAIL.test(email) && !mapa.has(email)) mapa.set(email, nome);
    }
    return mapa;
  }

  /** O livre/ocupado pela porta, em pedaços de até 60 dias e de até 10 agendas. */
  async lerLivreOcupado(
    orgId: string,
    agendas: string[],
    de: Date,
    ate: Date,
    actorId: string = SLUG_DO_ESPELHO,
    actorType: ActorType = ActorType.system,
  ): Promise<RespostaDoLivreOcupado> {
    const saida: RespostaDoLivreOcupado = { intervalos: [], erros: [] };
    const comErro = new Set<string>();
    for (let i = 0; i < agendas.length; i += AGENDAS_POR_CHAMADA) {
      const grupo = agendas.slice(i, i + AGENDAS_POR_CHAMADA);
      for (let ini = de.getTime(); ini < ate.getTime(); ini += LIVRE_OCUPADO_DIAS.pedaco * DIA) {
        const fim = Math.min(ini + LIVRE_OCUPADO_DIAS.pedaco * DIA, ate.getTime());
        const r = await this.porta.executar<RespostaDoLivreOcupado>({
          orgId,
          actorId,
          actorType,
          capabilityId: CAPACIDADE_DE_LIVRE_OCUPADO,
          args: { agendas: grupo, de: new Date(ini).toISOString(), ate: new Date(fim).toISOString() },
          resource: { type: CAPACIDADE_DE_LIVRE_OCUPADO, id: 'agendas-pessoais' },
        });
        if (ehRetida(r)) throw new Error('A porta reteve a leitura do livre/ocupado para aprovação: nada foi lido.');
        const resp = r as RespostaDoLivreOcupado;
        for (const iv of resp?.intervalos ?? []) saida.intervalos.push({ ...iv, agenda: iv.agenda.toLowerCase() });
        for (const er of resp?.erros ?? []) {
          const ag = er.agenda.toLowerCase();
          if (!comErro.has(ag)) {
            comErro.add(ag);
            saida.erros.push({ agenda: ag, motivo: er.motivo });
          }
        }
      }
    }
    // Agenda com erro em qualquer pedaço: nenhum intervalo dela vale (o retrato ficaria pela metade).
    saida.intervalos = saida.intervalos.filter((iv) => !comErro.has(iv.agenda));
    return saida;
  }

  /**
   * Troca, na janela do livre/ocupado, as linhas `livre_ocupado` de cada agenda
   * pessoal pelas que o Google devolveu agora. Agenda que respondeu com erro
   * fica como estava (o erro vai à `AgendaSincronia` dela); agenda que saiu de
   * Regras (Fechado desligado, e-mail trocado) perde as linhas dela no espelho.
   */
  private async sincronizarLivreOcupado(
    orgId: string,
    agora: Date,
  ): Promise<Pick<ContaDaPassagem, 'fechadoNovos' | 'fechadoSaidos' | 'agendasComErro'>> {
    const conta = { fechadoNovos: 0, fechadoSaidos: 0, agendasComErro: 0 };
    const pessoais = await this.agendasPessoais(orgId);

    // As agendas que saíram de Regras: as linhas do OS delas saem do espelho.
    const saidas = await this.prisma.agendaEvento.deleteMany({
      where: { orgId, origem: 'livre_ocupado', agenda: { notIn: [...pessoais.keys()] } },
    });
    conta.fechadoSaidos += saidas.count;
    if (pessoais.size === 0) return conta;
    if (await this.motivoParaNaoLer(orgId, CAPACIDADE_DE_LIVRE_OCUPADO)) return conta;

    const de = new Date(agora.getTime() - LIVRE_OCUPADO_DIAS.antes * DIA);
    const ate = new Date(agora.getTime() + LIVRE_OCUPADO_DIAS.depois * DIA);
    let resp: RespostaDoLivreOcupado;
    try {
      resp = await this.lerLivreOcupado(orgId, [...pessoais.keys()], de, ate);
    } catch (e) {
      // O livre/ocupado fora do ar não derruba a sincronia da casa: as linhas ficam como estavam.
      const erro = (e as Error).message.slice(0, 500);
      for (const agenda of pessoais.keys()) await this.anotarAgenda(orgId, agenda, { erro });
      conta.agendasComErro = pessoais.size;
      return conta;
    }
    const erros = new Map(resp.erros.map((e) => [e.agenda, e.motivo]));

    for (const [agenda, nome] of pessoais) {
      const erro = erros.get(agenda);
      if (erro) {
        conta.agendasComErro++;
        await this.anotarAgenda(orgId, agenda, { erro });
        continue;
      }
      const novas = new Map<string, LinhaDoEspelho>();
      for (const iv of resp.intervalos.filter((i) => i.agenda === agenda)) {
        const l = linhaDoIntervalo(agenda, nome, iv.inicio, iv.fim);
        novas.set(l.googleId, l);
      }
      const daJanela = { orgId, agenda, origem: 'livre_ocupado', inicio: { lt: ate }, fim: { gt: de } };
      const existentes = await this.prisma.agendaEvento.findMany({ where: daJanela, select: { googleId: true, leituraResponsaveis: true } });
      // A linha de outro sócio (o e-mail mudou de dono em Regras) sai e volta com o nome certo.
      const ficam = new Set(existentes.filter((x) => novas.has(x.googleId) && x.leituraResponsaveis[0] === nome).map((x) => x.googleId));
      const sair = existentes.filter((x) => !ficam.has(x.googleId)).map((x) => x.googleId);
      if (sair.length) {
        const r = await this.prisma.agendaEvento.deleteMany({ where: { ...daJanela, googleId: { in: sair } } });
        conta.fechadoSaidos += r.count;
      }
      const entrar = [...novas.values()].filter((l) => !ficam.has(l.googleId));
      if (entrar.length) {
        const r = await this.prisma.agendaEvento.createMany({
          data: entrar.map((l) => ({ orgId, ...this.dados(l), sincronizadoEm: agora })),
          skipDuplicates: true,
        });
        conta.fechadoNovos += r.count;
      }
      await this.anotarAgenda(orgId, agenda, { erro: null, ultimaPassagem: agora, janelaDe: de, janelaAte: ate });
    }
    return conta;
  }

  private async anotarAgenda(orgId: string, agenda: string, dados: Prisma.AgendaSincroniaUpdateInput): Promise<void> {
    await this.prisma.agendaSincronia.upsert({
      where: { orgId_agenda: { orgId, agenda } },
      create: { orgId, agenda, ...(dados as Record<string, unknown>) } as Prisma.AgendaSincroniaUncheckedCreateInput,
      update: dados,
    });
  }

  // ------------------------------------------------------------------ leitura

  async estado(orgId: string, agora: Date = new Date()): Promise<EstadoDaSincronia> {
    const s = await this.prisma.agendaSincronia.findUnique({
      where: { orgId_agenda: { orgId, agenda: AGENDA_DA_CASA } },
      select: { ultimaPassagem: true, erro: true },
    });
    const ultima = s?.ultimaPassagem ?? null;
    return {
      ultimaPassagem: ultima ? ultima.toISOString() : null,
      erro: s?.erro ?? null,
      atrasada: !ultima || agora.getTime() - ultima.getTime() > AGENDA_ESPELHO_ATRASO_MAXIMO_MS,
    };
  }

  /** As linhas do espelho que cruzam o intervalo, já no formato da tela. */
  async doEspelho(
    orgId: string,
    de: Date,
    ate: Date,
    opcoes: { incluirCancelados?: boolean; comDescricao?: boolean; soLivreOcupado?: boolean } = {},
  ): Promise<EventoDaAgenda[]> {
    const linhas = await this.prisma.agendaEvento.findMany({
      where: {
        orgId,
        inicio: { lt: ate },
        // Evento de duração zero que começa no início do intervalo também conta.
        OR: [{ fim: { gt: de } }, { inicio: { gte: de } }],
        ...(opcoes.incluirCancelados ? {} : { status: { not: 'cancelado' } }),
        ...(opcoes.soLivreOcupado ? { origem: 'livre_ocupado' } : {}),
      },
      orderBy: [{ inicio: 'asc' }, { googleId: 'asc' }],
    });
    return linhas.map((l) => eventoDaLinha(l, { comDescricao: opcoes.comDescricao }));
  }

  /**
   * O espelho, SÓ se ele está em dia (última passagem há menos de 10 min). Nulo
   * = atrasado: quem chama lê como lia antes (o vigia AG-01, o cartão da
   * implantação).
   */
  async lerSeEmDia(
    orgId: string,
    de: Date,
    ate: Date,
    agora: Date = new Date(),
    opcoes: { comDescricao?: boolean } = {},
  ): Promise<EventoDaAgenda[] | null> {
    const e = await this.estado(orgId, agora);
    if (e.atrasada) return null;
    return this.doEspelho(orgId, de, ate, { comDescricao: opcoes.comDescricao });
  }

  /** Os eventos do intervalo. Espelho atrasado (> 10 min) = leitura direta do Google, com `fonte: google`. */
  async periodo(orgId: string, de: Date, ate: Date, opcoes: OpcoesDoPeriodo = {}): Promise<RespostaDoEspelho> {
    const agora = opcoes.agora ?? new Date();
    const sincronia = await this.estado(orgId, agora);
    if (!sincronia.atrasada) {
      return { eventos: await this.doEspelho(orgId, de, ate, opcoes), sincronia, fonte: 'espelho' };
    }
    const motivo = await this.motivoParaNaoLer(orgId, CAPACIDADE_DA_LEITURA_DIRETA).catch((e: Error) => e.message);
    // Sem Google (desligado, desconectado, sonda em erro): o espelho velho, marcado atrasado, e
    // nunca a lista vazia (M1): vazia deixaria a régua e o link público toda verde.
    if (motivo) {
      return {
        eventos: await this.doEspelho(orgId, de, ate, opcoes),
        sincronia: { ...sincronia, atrasada: true, erro: String(motivo).slice(0, 300) },
        fonte: 'espelho',
      };
    }
    try {
      const r = await this.porta.executar({
        orgId,
        actorId: opcoes.actorId ?? SLUG_DO_ESPELHO,
        actorType: opcoes.actorId ? ActorType.user : ActorType.system,
        capabilityId: CAPACIDADE_DA_LEITURA_DIRETA,
        args: { de: de.toISOString(), ate: ate.toISOString(), limite: TETO_DA_LEITURA_DIRETA },
        resource: { type: CAPACIDADE_DA_LEITURA_DIRETA, id: 'agenda-da-root' },
      });
      if (ehRetida(r)) throw new Error('A porta reteve a leitura da agenda para aprovação.');
      if (!Array.isArray(r)) throw new Error('A leitura da agenda não devolveu uma lista.');
      const feriados = await this.feriados(orgId, agora);
      const direto = r
        .map((x) => eventoDaLeituraDireta(x, feriados))
        .filter((x): x is EventoDaAgenda => !!x && (opcoes.incluirCancelados || x.status !== 'cancelado'))
        .map((x) => (opcoes.comDescricao ? x : { ...x, descricao: undefined }));
      // O Fechado das agendas pessoais só existe no espelho: entra como está (pode estar atrasado também).
      const fechados = await this.doEspelho(orgId, de, ate, { soLivreOcupado: true });
      const eventos = [...direto.map(semDescricaoVazia), ...fechados].sort((a, b) => a.inicio.localeCompare(b.inicio));
      return { eventos, sincronia, fonte: 'google' };
    } catch (e) {
      this.log.warn(`empresa ${orgId}: leitura direta da agenda falhou com o espelho atrasado (${(e as Error).message})`);
      return {
        eventos: await this.doEspelho(orgId, de, ate, opcoes),
        sincronia: { ...sincronia, erro: (e as Error).message.slice(0, 300) },
        fonte: 'espelho',
      };
    }
  }

  /** Grava no espelho o evento como o Google o devolveu (o corpo cru de `events.insert/patch/get`). */
  async refletir(orgId: string, eventoDoGoogle: unknown): Promise<EventoDaAgenda | null> {
    exigirTenant(orgId, 'EspelhoService.refletir');
    const feriados = await this.feriados(orgId);
    const r = await this.gravarDoGoogle(orgId, eventoDoGoogle, feriados);
    if (!r.googleId) return null;
    const linha = await this.prisma.agendaEvento.findUnique({
      where: { orgId_agenda_googleId: { orgId, agenda: AGENDA_DA_CASA, googleId: r.googleId } },
    });
    return linha ? eventoDaLinha(linha, { comDescricao: true }) : null;
  }
}

/** Tira o `descricao: undefined` que o mapa deixou (o JSON não muda; o objeto fica limpo para o teste). */
function semDescricaoVazia(e: EventoDaAgenda): EventoDaAgenda {
  if (e.descricao !== undefined) return e;
  const { descricao: _fora, ...resto } = e;
  void _fora;
  return resto;
}
