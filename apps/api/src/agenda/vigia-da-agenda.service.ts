import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ActorType, AgentEstado, Prisma, type AgendaConferencia } from '@prisma/client';
import {
  FRASE_DO_PROBLEMA,
  conferirEvento,
  convidadosDoEvento,
  responsavelDaAgenda,
  type ForaDoPadraoDaAgenda,
  type ItemForaDoPadrao,
  type OrigemDaProposta,
  type ProblemaDoPadrao,
  type ResponsavelDaAgenda,
} from '@mktos/shared';

import { exigirTenant } from '../common/contexto-execucao';
import { EventLogService } from '../gateway/event-log.service';
import { FILA_DE_APROVACAO } from '../gateway/fila-de-aprovacao';
import { InterruptoresRegistry } from '../gateway/interruptores.registry';
import { PortaDoOperador } from '../gateway/porta-do-operador.service';
import { RegistroDeConectores } from '../integrations/conectores.registry';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';
import { PendenciasService } from '../pendencias/pendencias.service';
import { PendenciasRegistry, type RespostaDaPendencia } from '../pendencias/pendencias.registry';
import { proximaOcorrencia } from '../pauta/cron';
import { PrismaService } from '../prisma/prisma.service';
import { foraDaJanela, minutosNoFuso } from '../policy/limites';
import { PolicyService } from '../policy/policy.service';
import type { ResultadoDaRotina } from '../routines/rotina.tipos';
import { TIPO_AGENDA_VIGIA } from '../routines/rotina.tipos';
import {
  CAPACIDADE_DE_LEITURA,
  CAPACIDADE_DE_PADRONIZAR,
  CONECTOR_DA_AGENDA,
  CONECTOR_DO_CONTRATO,
  DIAS_PARA_FRENTE,
  DIAS_PARA_TRAS,
  FUNCAO_DO_VIGIA,
  OPCAO_NAO_E_REUNIAO,
  SAIDA_DO_VIGIA,
  SLUG_DO_VIGIA,
  TETO_DE_CANDIDATOS,
  TETO_DE_EVENTOS,
  TETO_DE_MODELO_POR_PASSAGEM,
  TETO_DE_PROPOSTAS_POR_PASSAGEM,
  TIPO_DA_PENDENCIA_DA_AGENDA,
  assinaturaDoEvento,
  inicioDoEvento,
  lerRespostaDoVigia,
  opcoesDaPendencia,
  promptDoVigia,
  propostaSegura,
  tituloDaResposta,
  type ContextoDoEvento,
  type DadosDaPendenciaDaAgenda,
  type EventoLido,
} from './vigia-da-agenda';

/* ==========================================================================
 * O VIGIA DA AGENDA (AG-01) — o serviço
 * ==========================================================================
 *
 * Uma passagem (rotina `agenda.vigia`, a cada 15 minutos):
 *
 *   1. pergunta ao INTERRUPTOR se o Google Agenda está ligado nesta empresa e
 *      ao CONTRATO DE CONECTOR se o Google está conectado (a sonda de verdade,
 *      não a variável do processo). Não estando, `pulada` — nada é lido;
 *   2. lê pela PORTA (`comunicacao.agenda.periodo`, R0) os eventos de ontem a
 *      +60 dias, como o sistema (`actorType system`, ator `vigia-da-agenda`);
 *   3. confere cada um (`conferirEvento`, no shared). Reunião no padrão: nada.
 *      Fora do padrão, NOVA ou MUDADA desde a última vez (a assinatura do
 *      evento em `AgendaConferencia`): a gramática conserta sozinha o que dá;
 *      o resto vai ao modelo (AG-01) e passa pela peneira (`propostaSegura`);
 *   4. proposta segura → `agenda.evento.padronizar` pela PORTA, proposta pelo
 *      vigia. É R3: fica RETIDA na fila de `/atendimento` até uma pessoa com
 *      alçada confirmar. Como quem propôs é o vigia, qualquer pessoa com alçada
 *      confirma — não precisa de duas pessoas;
 *   5. sem proposta segura → uma PENDÊNCIA ("qual é o cliente?") com as opções
 *      montadas pela gramática. A resposta manda pela mesma porta, agora em
 *      nome de quem respondeu (aí sim, outra pessoa confirma).
 *
 * O QUE O VIGIA NUNCA FAZ: apagar evento, mudar horário ou convidados. Os
 * argumentos que ele manda são os do catálogo — `{eventoId, tituloAtual,
 * tituloNovo, adicionarMeet}` — e o efeito (no conector do Google) só troca o
 * título, acrescenta o Meet e guarda o título antigo na descrição.
 *
 * DEDUPLICAÇÃO: o mesmo evento com a mesma assinatura não é proposto de novo,
 * nem pago ao modelo de novo; a mesma proposta com aprovação viva não volta à
 * porta; "não é reunião" dito por uma pessoa fica dito. Por passagem, no máximo
 * `TETO_DE_MODELO_POR_PASSAGEM` chamadas de modelo e
 * `TETO_DE_PROPOSTAS_POR_PASSAGEM` propostas à porta.
 */

const DIA = 24 * 60 * 60 * 1000;
export const SLUG_DA_ROTINA_DO_VIGIA = 'vigia-da-agenda';
export const CRON_DO_VIGIA = '*/15 * * * *';
export const FUSO_DO_VIGIA = 'America/Sao_Paulo';
const LIVRE = new Date(0);
const ABERTOS = ['proposta', 'pendencia'] as const;

/** Provedores de e-mail de pessoa: domínio deles não liga convidado a cliente nenhum. */
const DOMINIOS_PUBLICOS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'outlook.com', 'live.com', 'yahoo.com', 'yahoo.com.br',
  'icloud.com', 'me.com', 'uol.com.br', 'bol.com.br', 'terra.com.br', 'ig.com.br', 'msn.com', 'proton.me', 'protonmail.com',
]);

const ehRetida = (r: unknown): r is { status: 'aguardando_aprovacao'; approvalId: string } =>
  !!r && typeof r === 'object' && (r as { status?: unknown }).status === 'aguardando_aprovacao';

/** A proposta pronta para a porta. */
interface Proposta {
  titulo: string;
  adicionarMeet: boolean;
  origem: OrigemDaProposta;
}

/** Quem manda à porta: o vigia (sistema) ou a pessoa que clicou/respondeu. */
interface Proponente {
  id: string;
  tipo: ActorType;
}

const VIGIA: Proponente = { id: SLUG_DO_VIGIA, tipo: ActorType.system };

@Injectable()
export class VigiaDaAgendaService implements OnModuleInit {
  private readonly log = new Logger('VigiaDaAgenda');
  private readonly semeadas = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly porta: PortaDoOperador,
    private readonly interruptores: InterruptoresRegistry,
    private readonly conectores: RegistroDeConectores,
    private readonly pendencias: PendenciasService,
    private readonly registroDePendencias: PendenciasRegistry,
    @Optional() @Inject(LLM_PROVIDER) private readonly llm?: LlmProvider,
    @Optional() private readonly eventos?: EventLogService,
    @Optional() private readonly politica?: PolicyService,
  ) {}

  /**
   * A JANELA DA POLÍTICA (08h–20h de São Paulo, `limitesPadrao.janelaHoraria`).
   * Fora dela a porta acende `fora_da_janela` e a correção, que é R3, sobe para
   * R4 (titular, reautenticação, motivo escrito). O vigia não força isso: fora
   * da janela ele confere, grava a proposta e só a manda à porta na primeira
   * passagem dentro da janela (o ramo "proposta sem aprovação" logo abaixo).
   */
  private naJanela(orgId: string, agora: Date): boolean {
    if (!this.politica) return true;
    try {
      return !foraDaJanela(minutosNoFuso(agora), this.politica.limites(orgId).janelaHoraria);
    } catch {
      return false;
    }
  }

  onModuleInit(): void {
    this.registroDePendencias.aoResponder(TIPO_DA_PENDENCIA_DA_AGENDA, (r) => this.aoResponder(r), 'VigiaDaAgendaService');
  }

  // ------------------------------------------------------------------ rotina

  /**
   * Semeia a rotina do vigia nesta empresa (idempotente; uma vez por processo e
   * empresa; nunca lança). Nasce LIGADA, em `aprendendo` — ver docs/AGENDA.md,
   * "O vigia": ela só lê e propõe, toda escrita fica retida pela régua, a
   * deduplicação e os tetos por passagem impedem a fila de encher, e a empresa
   * sem Google conectado só registra `pulada` (que nem vira linha de histórico).
   */
  async garantirRotina(orgId: string): Promise<void> {
    if (!orgId || this.semeadas.has(orgId)) return;
    try {
      await this.prisma.rotina.upsert({
        where: { orgId_slug: { orgId, slug: SLUG_DA_ROTINA_DO_VIGIA } },
        create: {
          orgId,
          slug: SLUG_DA_ROTINA_DO_VIGIA,
          nome: 'Vigia da agenda (AG-01)',
          tipo: TIPO_AGENDA_VIGIA,
          config: {} as Prisma.InputJsonValue,
          cron: CRON_DO_VIGIA,
          tz: FUSO_DO_VIGIA,
          ativo: true,
          estado: AgentEstado.aprendendo,
          origem: 'manual',
          refExterna: null,
          agenteSlug: null,
          reservadoEm: LIVRE,
          reservadoAte: LIVRE,
          proximaExecucaoEm: proximaOcorrencia(CRON_DO_VIGIA, FUSO_DO_VIGIA, new Date()),
        },
        update: {},
      });
      this.semeadas.add(orgId);
    } catch (e) {
      this.log.warn(`empresa ${orgId}: não semeei a rotina do vigia da agenda: ${(e as Error).message}`);
    }
  }

  /** Uma passagem do vigia. Ver o cabeçalho. */
  async passagem(orgIdBruto: string, agora: Date = new Date()): Promise<ResultadoDaRotina> {
    const orgId = exigirTenant(orgIdBruto, 'VigiaDaAgendaService.passagem');

    const recusa = await this.interruptores.consultar({
      orgId,
      capabilityId: CAPACIDADE_DE_LEITURA,
      conector: CONECTOR_DA_AGENDA,
      actorType: ActorType.system,
      actorId: SLUG_DO_VIGIA,
      agentSlug: SLUG_DO_VIGIA,
    });
    if (recusa) return { status: 'pulada', resumo: 'Google Agenda desligado em Conexões nesta empresa: nada foi lido.' };

    const saude = await this.conectores.sondar({ orgId, chave: CONECTOR_DO_CONTRATO });
    if (saude.estado !== 'conectado') {
      return { status: 'pulada', resumo: `Google não conectado nesta empresa (${saude.estado}): nada foi lido.` };
    }

    const de = new Date(agora.getTime() - DIAS_PARA_TRAS * DIA);
    const ate = new Date(agora.getTime() + DIAS_PARA_FRENTE * DIA);
    const lidos = await this.porta.executar({
      orgId,
      actorId: SLUG_DO_VIGIA,
      actorType: ActorType.system,
      capabilityId: CAPACIDADE_DE_LEITURA,
      args: { de: de.toISOString(), ate: ate.toISOString(), limite: TETO_DE_EVENTOS },
      resource: { type: CAPACIDADE_DE_LEITURA, id: 'agenda-da-root' },
    });
    if (ehRetida(lidos)) {
      throw new Error('A porta reteve a LEITURA da agenda para aprovação: nada foi lido. Confira o nível de comunicacao.agenda.periodo.');
    }
    const eventos = (Array.isArray(lidos) ? lidos : []) as EventoLido[];

    const casa = await this.casa(orgId);
    const linhas = new Map(
      (
        await this.prisma.agendaConferencia.findMany({ where: { orgId, eventoId: { in: eventos.map((e) => e.id) } } })
      ).map((l) => [l.eventoId, l]),
    );

    const conta = {
      reunioes: 0, foraDoPadrao: 0, propostas: 0, pendencias: 0, resolvidos: 0, repetidos: 0, adiados: 0, falhas: 0, naoEReuniao: 0, esperamJanela: 0,
    };
    let chamadasDeModelo = 0;
    let propostasNaPorta = 0;
    const janela = this.naJanela(orgId, agora);
    /** Pode mandar mais uma proposta do vigia à porta nesta passagem? */
    const podeMandar = (): boolean => {
      if (!janela) {
        conta.esperamJanela++;
        return false;
      }
      if (propostasNaPorta >= TETO_DE_PROPOSTAS_POR_PASSAGEM) return false;
      propostasNaPorta++;
      return true;
    };

    for (const e of eventos) {
      if (!e?.id) continue;
      const conf = conferirEvento({
        titulo: e.title,
        convidados: e.attendees ?? [],
        organizador: e.organizador,
        meet: e.meet,
        local: e.location,
        descricao: e.description,
        status: e.status,
      });
      const linha = linhas.get(e.id);

      if (!conf.reuniao || conf.noPadrao) {
        if (conf.reuniao) conta.reunioes++;
        if (linha && (ABERTOS as readonly string[]).includes(linha.estado)) {
          await this.resolver(orgId, linha, conf.reuniao ? 'o evento está no padrão' : 'o evento deixou de ser reunião');
          conta.resolvidos++;
        }
        continue;
      }
      conta.reunioes++;
      conta.foraDoPadrao++;
      if (linha?.estado === 'nao_e_reuniao') {
        conta.naoEReuniao++;
        continue;
      }

      const assinatura = assinaturaDoEvento(e);
      const problemas = conf.problemas;

      // O MESMO EVENTO, SEM MUDANÇA: não paga o modelo de novo, não pergunta de
      // novo. A única coisa que anda é a proposta DO VIGIA que ainda não foi à
      // porta (o teto da passagem anterior, ou a janela fechada). A proposta de
      // uma pessoa é dela: o vigia nunca a reenvia em nome próprio.
      if (linha && linha.assinatura === assinatura && (ABERTOS as readonly string[]).includes(linha.estado)) {
        const pendenteDoVigia = linha.estado === 'proposta' && !linha.approvalId && !!linha.tituloProposto && linha.origem !== 'pessoa';
        if (pendenteDoVigia && podeMandar()) {
          await this.mandar(orgId, e.id, linha.tituloLido, { titulo: linha.tituloProposto!, adicionarMeet: linha.adicionarMeet, origem: (linha.origem as OrigemDaProposta) ?? 'modelo' }, VIGIA)
            .catch((err) => this.anotarFalha(orgId, e.id, err));
          conta.propostas++;
        } else {
          conta.repetidos++;
        }
        continue;
      }

      // NOVO OU MUDADO.
      let proposta: Proposta | null = null;
      let motivo = '';
      let ctx: ContextoDoEvento | null = null;
      if (conf.conserto) {
        proposta = { ...conf.conserto, origem: 'gramatica' };
      } else {
        if (chamadasDeModelo >= TETO_DE_MODELO_POR_PASSAGEM) {
          conta.adiados++;
          continue;
        }
        ctx = await this.contexto(orgId, e, casa);
        chamadasDeModelo++;
        const pergunta = await this.perguntar(orgId, ctx);
        if (pergunta.falhou) {
          // Modelo fora do ar ou teto do dia: não é "sem proposta segura". O
          // evento fica sem linha nova e volta na passagem seguinte.
          conta.falhas++;
          continue;
        }
        if (pergunta.resposta) {
          const s = propostaSegura(pergunta.resposta, ctx);
          if (s.ok) proposta = { titulo: s.titulo, adicionarMeet: s.adicionarMeet, origem: 'modelo' };
          else motivo = s.motivo;
        } else {
          motivo = pergunta.motivo;
        }
      }

      if (proposta) {
        const mesma =
          !!linha && linha.estado === 'proposta' && linha.tituloProposto === proposta.titulo && linha.adicionarMeet === proposta.adicionarMeet;
        const salva = await this.gravar(orgId, e, {
          assinatura,
          problemas,
          estado: 'proposta',
          tituloProposto: proposta.titulo,
          adicionarMeet: proposta.adicionarMeet,
          origem: proposta.origem,
          motivo: null,
          approvalId: mesma ? linha!.approvalId : null,
          pendenciaId: null,
        });
        if (linha?.pendenciaId) await this.fecharPendencia(orgId, linha.pendenciaId, 'o vigia achou proposta segura depois que o evento mudou');
        const viva = mesma && (await this.aprovacaoViva(orgId, salva.approvalId));
        if (!viva && podeMandar()) {
          await this.mandar(orgId, e.id, e.title, proposta, VIGIA).catch((err) => this.anotarFalha(orgId, e.id, err));
        }
        conta.propostas++;
        continue;
      }

      // SEM PROPOSTA SEGURA: uma pessoa escolhe.
      ctx ??= await this.contexto(orgId, e, casa);
      await this.abrirPendencia(orgId, e, ctx, assinatura, problemas, motivo || 'o título não diz o cliente nem o responsável', linha);
      conta.pendencias++;
    }

    // Evento que SUMIU da janela (apagado, ou movido para fora dela) com a
    // conferência ainda aberta: não há mais o que propor.
    const vistos = new Set(eventos.map((e) => e.id));
    const orfas = await this.prisma.agendaConferencia.findMany({
      where: { orgId, estado: { in: [...ABERTOS] }, inicio: { gte: de, lte: ate } },
    });
    for (const l of orfas) {
      if (vistos.has(l.eventoId)) continue;
      await this.resolver(orgId, l, 'o evento saiu da agenda ou da janela do vigia');
      conta.resolvidos++;
    }

    const algo = conta.propostas + conta.pendencias + conta.resolvidos + conta.falhas;
    const resumo =
      `${eventos.length} evento(s) lido(s), ${conta.reunioes} reunião(ões), ${conta.foraDoPadrao} fora do padrão: ` +
      `${conta.propostas} proposta(s), ${conta.pendencias} pendência(s), ${conta.resolvidos} resolvida(s), ` +
      `${conta.repetidos} já vista(s)` +
      (conta.naoEReuniao ? `, ${conta.naoEReuniao} marcada(s) como "não é reunião"` : '') +
      (conta.adiados ? `, ${conta.adiados} para a próxima passagem (teto do modelo)` : '') +
      (conta.falhas ? `, ${conta.falhas} sem resposta do modelo` : '') +
      (conta.esperamJanela ? `, ${conta.esperamJanela} esperando a janela da política para ir à fila` : '') +
      `. ${chamadasDeModelo} chamada(s) de modelo.`;
    return { status: algo ? 'ok' : 'pulada', resumo: resumo.slice(0, 500) };
  }

  // ------------------------------------------------------------------ tela

  /** O selo e a lista da tela `/agenda`. Semeia a rotina do vigia na primeira leitura. */
  async listar(orgIdBruto: string, agora: Date = new Date()): Promise<ForaDoPadraoDaAgenda> {
    const orgId = exigirTenant(orgIdBruto, 'VigiaDaAgendaService.listar');
    await this.garantirRotina(orgId);
    const desde = new Date(agora.getTime() - DIAS_PARA_TRAS * DIA);
    const linhas = await this.prisma.agendaConferencia.findMany({
      where: { orgId, estado: { in: [...ABERTOS] }, OR: [{ inicio: null }, { inicio: { gte: desde } }] },
      orderBy: [{ inicio: 'asc' }, { criadoEm: 'asc' }],
      take: 200,
    });
    const aprovacoes = new Map(
      (
        await this.prisma.approval.findMany({
          where: { orgId, id: { in: linhas.map((l) => l.approvalId).filter((x): x is string => !!x) } },
          select: { id: true, status: true, expiraEm: true, propostoPorTipo: true },
        })
      ).map((a) => [a.id, a]),
    );
    const pendencias = new Map(
      (
        await this.prisma.pendencia.findMany({
          where: { orgId, id: { in: linhas.map((l) => l.pendenciaId).filter((x): x is string => !!x) }, estado: 'aberta' },
          select: { id: true, opcoes: true },
        })
      ).map((p) => [p.id, p]),
    );
    const rotina = await this.prisma.rotina.findUnique({
      where: { orgId_slug: { orgId, slug: SLUG_DA_ROTINA_DO_VIGIA } },
      select: { ativo: true, estado: true, ultimaExecucaoEm: true },
    });

    const itens: ItemForaDoPadrao[] = linhas.map((l) => {
      const a = l.approvalId ? aprovacoes.get(l.approvalId) : undefined;
      const p = l.pendenciaId ? pendencias.get(l.pendenciaId) : undefined;
      const vencida = a && a.status === 'pendente' && a.expiraEm.getTime() <= agora.getTime();
      return {
        eventoId: l.eventoId,
        tituloAtual: l.tituloLido,
        inicio: l.inicio?.toISOString() ?? null,
        estado: l.estado as ItemForaDoPadrao['estado'],
        problemas: lerProblemas(l.problemas),
        tituloProposto: l.tituloProposto,
        adicionarMeet: l.adicionarMeet,
        origem: (l.origem as OrigemDaProposta | null) ?? null,
        aprovacao: a
          ? {
              id: a.id,
              status: vencida ? 'expirada' : a.status,
              expiraEm: a.expiraEm.toISOString(),
              propostaPor: a.propostoPorTipo === ActorType.user ? 'pessoa' : 'vigia',
            }
          : null,
        pendencia: p ? { id: p.id, opcoes: Array.isArray(p.opcoes) ? (p.opcoes as Array<{ chave: string; rotulo: string }>) : [] } : null,
        atualizadoEm: l.atualizadoEm.toISOString(),
      };
    });

    return {
      itens,
      total: itens.length,
      ultimaPassagemEm: rotina?.ultimaExecucaoEm?.toISOString() ?? null,
      rotina: rotina
        ? { ativa: rotina.ativo, estado: rotina.estado, dispara: rotina.ativo && (rotina.estado === AgentEstado.rodando || rotina.estado === AgentEstado.aprendendo) }
        : null,
    };
  }

  /**
   * "APROVAR AQUI", na tela `/agenda`. Leva à MESMA porta:
   *  · a proposta já tem aprovação viva na fila → devolve a mesma, sem criar outra;
   *  · não tem (ou a anterior venceu) → a pessoa que clicou PROPÕE pela porta, e
   *    a régua retém (R3): quem confirma é OUTRA pessoa com alçada, em `/atendimento`.
   */
  async pedirAprovacao(
    orgIdBruto: string,
    eventoId: string,
    pessoa: { id: string },
    approvalToken?: string,
  ): Promise<Record<string, unknown>> {
    const orgId = exigirTenant(orgIdBruto, 'VigiaDaAgendaService.pedirAprovacao');
    const linha = await this.prisma.agendaConferencia.findUnique({ where: { orgId_eventoId: { orgId, eventoId } } });
    if (!linha) throw new NotFoundException('O vigia não tem proposta para este evento.');
    if (linha.estado !== 'proposta' || !linha.tituloProposto) {
      throw new ConflictException(
        linha.estado === 'pendencia'
          ? 'Este evento não tem proposta segura: responda a pendência ("qual é o cliente?").'
          : 'Este evento não está mais fora do padrão.',
      );
    }

    if (linha.approvalId && !approvalToken) {
      const a = await this.prisma.approval.findFirst({
        where: { orgId, id: linha.approvalId },
        select: { id: true, status: true, expiraEm: true, propostoPorId: true, nivelExigido: true },
      });
      if (a && a.status === 'pendente' && a.expiraEm.getTime() > Date.now()) {
        const sua = a.propostoPorId === pessoa.id;
        return {
          status: 'aguardando_aprovacao',
          approvalId: a.id,
          expiraEm: a.expiraEm.toISOString(),
          nivel: a.nivelExigido,
          jaNaFila: true,
          precisaDeOutraPessoa: sua,
          fila: FILA_DE_APROVACAO,
          mensagem: sua
            ? 'Você já pediu esta correção: ela espera a confirmação de OUTRA pessoa com alçada na fila de aprovações.'
            : 'O vigia já pôs esta correção na fila de aprovações: confirme lá (quem propôs foi o vigia, então você pode confirmar).',
        };
      }
    }

    const r = await this.mandar(
      orgId,
      eventoId,
      linha.tituloLido,
      { titulo: linha.tituloProposto, adicionarMeet: linha.adicionarMeet, origem: (linha.origem as OrigemDaProposta) ?? 'modelo' },
      { id: pessoa.id, tipo: ActorType.user },
      approvalToken,
    );
    return { ...(r as Record<string, unknown>), jaNaFila: false };
  }

  // ------------------------------------------------------------------ pendência

  /**
   * A RESPOSTA DA PENDÊNCIA "qual é o cliente?". "Não é reunião" marca o evento
   * para o vigia não perguntar de novo. Qualquer outra opção monta o título pela
   * gramática e manda pela MESMA porta, em nome de quem respondeu: R3, retida,
   * outra pessoa confirma. Falhar aqui devolve a pendência a "aberta".
   */
  private async aoResponder(r: RespostaDaPendencia): Promise<void> {
    const dados = (r.dados ?? {}) as Partial<DadosDaPendenciaDaAgenda>;
    if (!dados.eventoId || !Array.isArray(dados.opcoes)) throw new BadRequestException('Pendência da agenda sem os dados do evento.');
    const eventoId = dados.eventoId;

    if (r.escolha === OPCAO_NAO_E_REUNIAO) {
      await this.prisma.agendaConferencia.upsert({
        where: { orgId_eventoId: { orgId: r.orgId, eventoId } },
        create: {
          orgId: r.orgId,
          eventoId,
          tituloLido: dados.tituloAtual ?? '',
          assinatura: dados.assinatura ?? '',
          estado: 'nao_e_reuniao',
          motivo: 'uma pessoa disse que não é reunião',
          pendenciaId: r.pendenciaId,
        },
        update: { estado: 'nao_e_reuniao', motivo: 'uma pessoa disse que não é reunião', tituloProposto: null, approvalId: null, origem: null },
      });
      await this.eventos
        ?.registrar({
          orgId: r.orgId,
          tipo: 'agenda.evento.nao_e_reuniao',
          actorType: ActorType.user,
          actorId: r.usuarioId,
          agentSlug: SLUG_DO_VIGIA,
          conteudo: { argumentos: { eventoId, pendenciaId: r.pendenciaId } },
          sensibilidade: 'interna',
        })
        .catch((e) => this.log.warn(`RASTRO do "não é reunião" não gravado: ${(e as Error).message}`));
      return;
    }

    const opcao = dados.opcoes.find((o) => o.chave === r.escolha);
    if (!opcao) throw new BadRequestException('Esta opção não existe nesta pendência.');
    const t = tituloDaResposta(opcao, r.complemento);
    if (!t.ok) throw new BadRequestException(t.motivo);
    const adicionarMeet = t.reuniao.tipo === 'cliente' && t.reuniao.modalidade === 'online' && !dados.temMeet;

    const antes = await this.prisma.agendaConferencia.findUnique({ where: { orgId_eventoId: { orgId: r.orgId, eventoId } } });
    await this.prisma.agendaConferencia.upsert({
      where: { orgId_eventoId: { orgId: r.orgId, eventoId } },
      create: {
        orgId: r.orgId,
        eventoId,
        tituloLido: dados.tituloAtual ?? '',
        assinatura: dados.assinatura ?? '',
        estado: 'proposta',
        tituloProposto: t.titulo,
        adicionarMeet,
        origem: 'pessoa',
        pendenciaId: r.pendenciaId,
      },
      update: { estado: 'proposta', tituloProposto: t.titulo, adicionarMeet, origem: 'pessoa', approvalId: null, motivo: null },
    });
    try {
      await this.mandar(
        r.orgId,
        eventoId,
        dados.tituloAtual ?? '',
        { titulo: t.titulo, adicionarMeet, origem: 'pessoa' },
        { id: r.usuarioId, tipo: ActorType.user },
      );
    } catch (e) {
      // A porta recusou: a pendência volta a "aberta" (quem chamou desfaz) e a
      // conferência volta ao que era — senão o vigia veria uma "proposta" que
      // ninguém conseguiu mandar.
      await this.prisma.agendaConferencia.updateMany({
        where: { orgId: r.orgId, eventoId },
        data: {
          estado: antes?.estado === 'proposta' || antes?.estado === 'pendencia' ? antes.estado : 'pendencia',
          tituloProposto: antes?.tituloProposto ?? null,
          adicionarMeet: antes?.adicionarMeet ?? false,
          origem: antes?.origem ?? null,
          approvalId: antes?.approvalId ?? null,
          motivo: antes?.motivo ?? null,
        },
      });
      throw e;
    }
  }

  // ------------------------------------------------------------------ miúdos

  /**
   * MANDA PELA PORTA. Os argumentos são EXATAMENTE os do catálogo — nada de
   * horário, convidados, exclusão: é o que o argsSchema aceita
   * (`additionalProperties: false`) e é o que a aprovação assina.
   */
  private async mandar(
    orgId: string,
    eventoId: string,
    tituloAtual: string,
    proposta: Proposta,
    quem: Proponente,
    approvalToken?: string,
  ): Promise<unknown> {
    const r = await this.porta.executar({
      orgId,
      actorId: quem.id,
      actorType: quem.tipo,
      capabilityId: CAPACIDADE_DE_PADRONIZAR,
      args: {
        eventoId,
        tituloAtual: String(tituloAtual ?? '').slice(0, 500),
        tituloNovo: proposta.titulo,
        adicionarMeet: proposta.adicionarMeet,
      },
      resource: { type: CAPACIDADE_DE_PADRONIZAR, id: eventoId },
      ...(approvalToken ? { approvalToken } : {}),
    });
    if (ehRetida(r)) {
      await this.prisma.agendaConferencia.updateMany({
        where: { orgId, eventoId },
        data: { approvalId: r.approvalId, propostoEm: new Date(), motivo: null },
      });
    } else {
      // Saiu na hora (só acontece com aprovação dada): o evento está no padrão.
      await this.prisma.agendaConferencia.updateMany({
        where: { orgId, eventoId },
        data: { estado: 'resolvido', motivo: 'padronizado pela porta', propostoEm: new Date() },
      });
    }
    return r;
  }

  private async anotarFalha(orgId: string, eventoId: string, err: unknown): Promise<void> {
    const motivo = `a porta não aceitou a proposta: ${(err as Error)?.message ?? String(err)}`.slice(0, 500);
    this.log.warn(`empresa ${orgId}, evento ${eventoId}: ${motivo}`);
    await this.prisma.agendaConferencia.updateMany({ where: { orgId, eventoId }, data: { motivo } });
  }

  private async aprovacaoViva(orgId: string, approvalId: string | null): Promise<boolean> {
    if (!approvalId) return false;
    const a = await this.prisma.approval.findFirst({ where: { orgId, id: approvalId }, select: { status: true, expiraEm: true } });
    return !!a && a.status === 'pendente' && a.expiraEm.getTime() > Date.now();
  }

  private async gravar(
    orgId: string,
    e: EventoLido,
    dados: {
      assinatura: string;
      problemas: ProblemaDoPadrao[];
      estado: 'proposta' | 'pendencia';
      tituloProposto: string | null;
      adicionarMeet: boolean;
      origem: OrigemDaProposta | null;
      motivo: string | null;
      approvalId: string | null;
      pendenciaId: string | null;
    },
  ): Promise<AgendaConferencia> {
    const campos = {
      tituloLido: String(e.title ?? ''),
      assinatura: dados.assinatura,
      inicio: inicioDoEvento(e),
      estado: dados.estado,
      problemas: dados.problemas as unknown as Prisma.InputJsonValue,
      tituloProposto: dados.tituloProposto,
      adicionarMeet: dados.adicionarMeet,
      origem: dados.origem,
      motivo: dados.motivo,
      approvalId: dados.approvalId,
      pendenciaId: dados.pendenciaId,
    };
    return this.prisma.agendaConferencia.upsert({
      where: { orgId_eventoId: { orgId, eventoId: e.id } },
      create: { orgId, eventoId: e.id, ...campos },
      update: campos,
    });
  }

  private async resolver(orgId: string, linha: AgendaConferencia, motivo: string): Promise<void> {
    await this.prisma.agendaConferencia.updateMany({
      where: { orgId, id: linha.id, estado: { in: [...ABERTOS] } },
      data: { estado: 'resolvido', motivo },
    });
    if (linha.pendenciaId) await this.fecharPendencia(orgId, linha.pendenciaId, motivo);
  }

  /**
   * A pendência que perdeu o objeto (o evento voltou ao padrão, mudou, ou saiu
   * da agenda) é DESCARTADA pelo vigia, com o motivo no contexto. Só a aberta:
   * a decisão de gente nunca é desfeita por uma rotina.
   */
  private async fecharPendencia(orgId: string, pendenciaId: string, motivo: string): Promise<void> {
    await this.prisma.pendencia
      .updateMany({
        where: { orgId, id: pendenciaId, estado: 'aberta' },
        data: { estado: 'descartada', decididaPor: SLUG_DO_VIGIA, decididaEm: new Date(), contexto: `Fechada pelo vigia: ${motivo}.` },
      })
      .catch((e) => this.log.warn(`pendência ${pendenciaId} não fechada: ${(e as Error).message}`));
  }

  private async abrirPendencia(
    orgId: string,
    e: EventoLido,
    ctx: ContextoDoEvento,
    assinatura: string,
    problemas: ProblemaDoPadrao[],
    motivo: string,
    linha: AgendaConferencia | undefined,
  ): Promise<void> {
    const opcoes = opcoesDaPendencia(ctx);
    const quando = inicioDoEvento(e);
    const data = quando
      ? quando.toLocaleString('pt-BR', { timeZone: FUSO_DO_VIGIA, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      : 'sem data';
    const dados: DadosDaPendenciaDaAgenda = {
      eventoId: e.id,
      tituloAtual: String(e.title ?? ''),
      assinatura,
      temMeet: !!String(e.meet ?? '').trim(),
      opcoes,
    };
    const p = await this.pendencias.abrir(orgId, {
      funcao: FUNCAO_DO_VIGIA,
      tipo: TIPO_DA_PENDENCIA_DA_AGENDA,
      chave: `agenda.padrao:${e.id}:${assinatura.slice(0, 16)}`,
      titulo: 'Esta reunião está fora do padrão: qual é o cliente?',
      contexto: `"${String(e.title ?? '').slice(0, 200)}" (${data}). ${motivo}.`.slice(0, 1000),
      opcoes: [...opcoes.map((o) => ({ chave: o.chave, rotulo: o.rotulo })), { chave: OPCAO_NAO_E_REUNIAO, rotulo: 'Não é reunião' }],
      refTipo: 'agenda.evento',
      refId: e.id,
      dados: dados as unknown as Prisma.InputJsonValue,
    });
    if (linha?.pendenciaId && linha.pendenciaId !== p.id) {
      await this.fecharPendencia(orgId, linha.pendenciaId, 'o evento mudou e o vigia perguntou de novo');
    }
    await this.gravar(orgId, e, {
      assinatura,
      problemas,
      estado: 'pendencia',
      tituloProposto: null,
      adicionarMeet: false,
      origem: null,
      motivo: motivo.slice(0, 500),
      approvalId: null,
      pendenciaId: p.id,
    });
  }

  /** O modelo (AG-01). `falhou` = não houve resposta; `resposta: null` = respondeu algo ilegível. */
  private async perguntar(
    orgId: string,
    ctx: ContextoDoEvento,
  ): Promise<{ falhou: true } | { falhou: false; resposta: ReturnType<typeof lerRespostaDoVigia> | null; motivo: string }> {
    if (!this.llm) return { falhou: false, resposta: null, motivo: 'sem modelo de linguagem neste processo' };
    const { system, user } = promptDoVigia(ctx);
    let texto: string;
    try {
      texto = await this.llm.complete({ funcao: FUNCAO_DO_VIGIA, agentSlug: SLUG_DO_VIGIA, system, user, orgId, maxTokens: SAIDA_DO_VIGIA });
    } catch (e) {
      this.log.warn(`empresa ${orgId}: o modelo do vigia não respondeu: ${(e as Error).message}`);
      return { falhou: true };
    }
    try {
      return { falhou: false, resposta: lerRespostaDoVigia(texto), motivo: '' };
    } catch (e) {
      return { falhou: false, resposta: null, motivo: (e as Error).message };
    }
  }

  /** As pessoas da casa: e-mail → responsável (só os três sócios), e todos os e-mails de gente ativa. */
  private async casa(orgId: string): Promise<{ responsavelPorEmail: Map<string, ResponsavelDaAgenda>; emails: Set<string> }> {
    const usuarios = await this.prisma.user.findMany({ where: { orgId, isActive: true }, select: { email: true, name: true } });
    const responsavelPorEmail = new Map<string, ResponsavelDaAgenda>();
    const emails = new Set<string>();
    for (const u of usuarios) {
      const email = u.email.trim().toLowerCase();
      emails.add(email);
      const primeiro = String(u.name ?? '').trim().split(/\s+/)[0];
      const r = responsavelDaAgenda(primeiro);
      if (r && r !== 'Todos') responsavelPorEmail.set(email, r);
    }
    return { responsavelPorEmail, emails };
  }

  /** O contexto de UM evento: quem da casa está, quem é de fora e que clientes/leads os e-mails de fora apontam. */
  private async contexto(
    orgId: string,
    e: EventoLido,
    casa: { responsavelPorEmail: Map<string, ResponsavelDaAgenda>; emails: Set<string> },
  ): Promise<ContextoDoEvento> {
    const convidados = convidadosDoEvento({ convidados: e.attendees ?? [], organizador: e.organizador });
    const presentes = new Set<ResponsavelDaAgenda>();
    for (const email of [...convidados, String(e.organizador ?? '').trim().toLowerCase()]) {
      const r = casa.responsavelPorEmail.get(email);
      if (r) presentes.add(r);
    }
    const externos = convidados.filter((x) => !casa.emails.has(x));
    return { evento: e, convidados, casaPresente: [...presentes], externos, candidatos: await this.candidatos(orgId, externos) };
  }

  /**
   * E-MAIL → CLIENTE: primeiro o e-mail exato (Partner e lead), depois o domínio
   * da empresa (nunca o de provedor de e-mail de pessoa). Nome do Partner: o
   * fantasia, senão a razão social; do lead: a empresa da ficha, senão o nome.
   */
  private async candidatos(orgId: string, externos: string[]): Promise<string[]> {
    const emails = externos.slice(0, 20);
    if (!emails.length) return [];
    const dominios = [...new Set(emails.map((x) => x.split('@')[1] ?? '').filter((d) => d && !DOMINIOS_PUBLICOS.has(d)))];
    const filtroExato = emails.map((x) => ({ email: { equals: x, mode: 'insensitive' as const } }));
    const filtroDominio = dominios.map((d) => ({ email: { endsWith: `@${d}`, mode: 'insensitive' as const } }));

    const nomes: string[] = [];
    const juntar = (n: string | null | undefined) => {
      const v = String(n ?? '').replace(/\s+/g, ' ').trim();
      if (v && !nomes.some((x) => x.toLowerCase() === v.toLowerCase())) nomes.push(v);
    };
    for (const filtro of [filtroExato, filtroDominio]) {
      if (!filtro.length) continue;
      const parceiros = await this.prisma.partner.findMany({
        where: { orgId, ativo: true, interno: false, OR: filtro },
        select: { nomeFantasia: true, razaoSocial: true },
        take: 20,
      });
      for (const p of parceiros) juntar(p.nomeFantasia || p.razaoSocial);
      const leads = await this.prisma.lead.findMany({
        where: { orgId, OR: filtro },
        select: { name: true, ficha: { select: { empresa: true } } },
        take: 20,
      });
      for (const l of leads) juntar(l.ficha?.empresa || l.name);
      if (nomes.length >= TETO_DE_CANDIDATOS) break;
    }
    return nomes.slice(0, TETO_DE_CANDIDATOS);
  }
}

/** Os problemas gravados, em frase. */
function lerProblemas(bruto: Prisma.JsonValue): string[] {
  if (!Array.isArray(bruto)) return [];
  return bruto
    .map((p) => (typeof p === 'string' && p in FRASE_DO_PROBLEMA ? FRASE_DO_PROBLEMA[p as ProblemaDoPadrao] : null))
    .filter((x): x is string => !!x);
}
