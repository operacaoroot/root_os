import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ContextKind, ContextSource, type Prisma } from '@prisma/client';
import {
  PAUTA_CHAVE_DA_GRADE,
  PAUTA_FORMATOS_DA_SEMANA,
  PAUTA_FORMATO_DA_SEMANA_ROTULO,
  PAUTA_FUSO_DA_AGENDA,
  PAUTA_GRADE_PADRAO,
  PAUTA_HORIZONTE_DA_AGENDA_DIAS,
  PAUTA_TETO_DO_A_PARTIR_DE_DIAS,
  PAUTA_TETO_DO_REAGENDAR_DIAS,
  apelidoDoEpisodio,
  diaDaSemanaDe,
  diaNoFuso,
  feriadoDoDia,
  horaNoFuso,
  instanteNoFuso,
  lerGradeDoTexto,
  motivoParaNaoAgendar,
  segundaDaSemana,
  somarDias,
  textoDaGrade,
  type PautaAgendaDaSemana,
  type PautaDiaDaAgenda,
  type PautaDistribuicao,
  type PautaDistribuirInput,
  type PautaEpisodioParaDistribuir,
  type PautaEpisodioStatus,
  type PautaFormatoDaSemana,
  type PautaGradePainel,
  type PautaGradeSalvarInput,
  type PautaLinhaDoDia,
  type PautaMarcarPostadaInput,
  type PautaPecaNaAgenda,
  type PautaPublicacaoDaPeca,
  type PautaPecaStatus,
  type PautaReagendarInput,
  PAUTA_CHAVE_DA_PUBLICACAO_AUTOMATICA,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MemoriaService, type NotaDeContexto } from '../memory/memoria.service';
import { EpisodioService } from './episodio.service';
import { itensMantidos } from './episodio';
import { candidatosParaATela, ehPecaDaSemana, lerMetaDaSemana } from './derivacao-do-episodio';
import { chaveDoSlot, distribuir, gradeDaNota, midiaDaPeca, postagemDaPeca, slotsDoPeriodo, type Distribuida } from './agenda-da-semana';
import { publicacoesParaATela } from './publicacao-instagram.service';
import { LotesService, type ItemVivo } from '../approvals/lotes.service';
import { CAPACIDADE_DO_ITEM, revogarItemDaPeca } from './lote-da-semana';
import { notaDaAutomaticaLigada } from './publicacao-instagram';
import { ondeEsperaResposta } from './dm-por-comentario';

const TITULO_DA_GRADE = 'Grade da semana de posts (pauta)';
const MINUTO = 60_000;
const DIA = 24 * 3600_000;

/** O que a agenda lê de cada peça. */
const DA_PECA = {
  id: true,
  formato: true,
  status: true,
  titulo: true,
  corpo: true,
  meta: true,
  agendadaPara: true,
  slotProposto: true,
  publicadaEm: true,
  externalId: true,
  urlPublicada: true,
} as const;

interface LinhaDaPeca {
  id: string;
  formato: string;
  status: PautaPecaStatus;
  titulo: string;
  corpo: string;
  meta: unknown;
  agendadaPara: Date | null;
  slotProposto: Date | null;
  publicadaEm: Date | null;
  externalId: string | null;
  urlPublicada: string | null;
}

interface EpisodioDaAgenda {
  id: string;
  numero: number;
  titulo: string;
  status: PautaEpisodioStatus;
  rodada: { itens: unknown } | null;
}

const minuto = (d: Date) => new Date(Math.floor(d.getTime() / MINUTO) * MINUTO);
const daSemana = { canal: 'instagram' as const, formato: { in: [...PAUTA_FORMATOS_DA_SEMANA] } };

/*
 * O CALENDÁRIO DA SEMANA (MC16): as peças APROVADAS da semana de posts ganham
 * um slot na grade da empresa e cada slot entrega a legenda e a mídia para
 * postar à mão. Nada aqui sai do OS — marcar postada é registro interno, e
 * postar pelo OS no Instagram/TikTok é a MC17 (D-MC8).
 *
 * A grade é nota da memória (`pauta.semana.grade`), lida por `porChave` e
 * escrita só por `MemoriaService` (ADR-011), como a voz do autor (MC10).
 * Distribuir e reagendar tomam o cadeado da EMPRESA: a colisão é entre peças
 * de qualquer episódio. As escritas são condicionadas ao status `aprovada`
 * relido — a peça que voltou ao rascunho no meio não ganha slot.
 */
@Injectable()
export class AgendaService {
  private readonly log = new Logger('AgendaService');
  /** O relógio, trocável no teste. */
  agora: () => Date = () => new Date();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly memoria: MemoriaService,
    private readonly episodios: EpisodioService,
    /** MD8: o item vivo do lote da semana de cada peça, e a revogação ao reagendar. Global; opcional nas suítes. */
    @Optional() private readonly lotes?: LotesService,
  ) {}

  // ---------------------------------------------------------------- a grade

  private async notaDaGrade(orgId: string): Promise<NotaDeContexto | null> {
    return this.memoria.porChave(orgId, PAUTA_CHAVE_DA_GRADE);
  }

  /**
   * A grade que vale para LER a semana. Memória fora do ar não para a tela:
   * vale o padrão, com o aviso. Quem grava slot (o distribuir) não usa isto.
   */
  private async gradeVigente(orgId: string): Promise<ReturnType<typeof gradeDaNota>> {
    try {
      return gradeDaNota(await this.notaDaGrade(orgId));
    } catch (e) {
      this.log.warn(`grade da semana de ${orgId}: memória indisponível (${(e as Error).message})`);
      return { grade: PAUTA_GRADE_PADRAO, origem: 'padrao', versao: null, avisos: ['A memória não respondeu: vale a grade padrão.'] };
    }
  }

  async grade(orgId: string): Promise<PautaGradePainel> {
    const nota = await this.notaDaGrade(orgId);
    const g = gradeDaNota(nota);
    const valeANota = !!nota && !nota.arquivadoEm && !!nota.body.trim();
    return { grade: g.grade, texto: valeANota ? nota!.body : textoDaGrade(g.grade), origem: g.origem, versao: g.versao, avisos: g.avisos };
  }

  /**
   * Grava a grade como versão nova da nota (ou cria a nota), sempre por
   * `MemoriaService`. Linha que não fecha é 400 com o porquê: a grade que vale
   * nunca é metade do que foi escrito.
   */
  async salvarGrade(orgId: string, actorId: string, entrada: PautaGradeSalvarInput): Promise<PautaGradePainel> {
    const { grade, avisos } = lerGradeDoTexto(entrada.texto);
    if (avisos.length) throw new BadRequestException(avisos.join(' '));
    if (!grade.slots.length) throw new BadRequestException('A grade precisa de pelo menos um slot (ex.: carrossel: seg, qua, sex 12:00).');
    const corpo = textoDaGrade(grade);
    const existente = await this.notaDaGrade(orgId);
    let nota: NotaDeContexto;
    if (!existente) {
      nota = await this.memoria.criar(orgId, {
        chave: PAUTA_CHAVE_DA_GRADE,
        kind: ContextKind.definicao,
        title: TITULO_DA_GRADE,
        body: corpo,
        tags: ['pauta', 'agenda'],
        sourceType: ContextSource.operador,
        sourceRef: 'pauta.agenda · grade',
        motivo: 'grade da semana de posts definida na aba Semana (MC16)',
      });
    } else {
      nota = await this.memoria.alterar(orgId, existente.id, {
        kind: ContextKind.definicao,
        title: TITULO_DA_GRADE,
        body: corpo,
        sourceType: ContextSource.operador,
        sourceRef: 'pauta.agenda · grade',
        motivo: 'grade da semana de posts editada na aba Semana (MC16)',
        versaoEsperada: entrada.versao,
      });
      if (nota.arquivadoEm) nota = await this.memoria.restaurar(orgId, nota.id, 'a grade voltou a valer com a versão nova');
    }
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.agenda_grade',
      entityType: 'context_item',
      entityId: nota.id,
      after: { versao: nota.versao, slots: grade.slots.length, feriados: grade.feriados.length },
    });
    return this.grade(orgId);
  }

  // ---------------------------------------------------------------- a semana

  private async episodiosDe(orgId: string, ids: string[]): Promise<Map<string, EpisodioDaAgenda>> {
    if (!ids.length) return new Map();
    const linhas = (await this.prisma.pautaEpisodio.findMany({
      where: { orgId, id: { in: ids } },
      select: { id: true, numero: true, titulo: true, status: true, rodada: { select: { itens: true } } },
    })) as EpisodioDaAgenda[];
    return new Map(linhas.map((e) => [e.id, e]));
  }

  private naAgenda(
    p: LinhaDaPeca,
    e: EpisodioDaAgenda | undefined,
    publicacao: PautaPublicacaoDaPeca | null = null,
    lote: ItemVivo | null = null,
  ): PautaPecaNaAgenda {
    const m = lerMetaDaSemana(p.meta);
    const formato = p.formato as PautaFormatoDaSemana;
    const apelido = e ? apelidoDoEpisodio(e.numero) : 'ep-??';
    const itens = e ? itensMantidos(e.rodada?.itens) : [];
    const em = p.agendadaPara ?? p.publicadaEm ?? p.slotProposto ?? new Date(0);
    return {
      id: p.id,
      formato,
      status: p.status,
      titulo: p.titulo,
      legenda: p.corpo,
      palavraChave: m.palavraChave ?? null,
      episodioId: m.episodioId,
      apelido,
      itemN: m.itemN,
      materia: itens[m.itemN - 1]?.titulo ?? `Matéria ${m.itemN}`,
      em: em.toISOString(),
      agendadaPara: p.agendadaPara?.toISOString() ?? null,
      midia: midiaDaPeca(formato, p.meta, apelido),
      postada: postagemDaPeca(p, publicacao?.estado === 'publicada'),
      motivoParaNaoAgendar: e ? motivoParaNaoAgendar(e.status) : 'O episódio desta peça não foi achado.',
      slotProposto: p.slotProposto?.toISOString() ?? null,
      publicacao,
      lote: lote
        ? { loteId: lote.loteId, itemId: lote.itemId, estadoDoLote: lote.estadoDoLote, estadoDoItem: lote.estadoDoItem, janelaAte: lote.janelaAte.toISOString() }
        : null,
      ...(formato === 'corte' ? { candidatos: candidatosParaATela(m) } : {}),
    };
  }

  /**
   * Os sete dias a partir de `de` (segunda desta semana, sem ele): os slots da
   * grade em cada dia — vazios ou com a peça — e as peças postas fora da grade.
   * Feriado não abre slot; a peça que alguém pôs nele aparece mesmo assim.
   */
  async semana(orgId: string, de?: string): Promise<PautaAgendaDaSemana> {
    const agora = this.agora();
    const hoje = diaNoFuso(agora, PAUTA_FUSO_DA_AGENDA);
    const inicio = de ?? segundaDaSemana(hoje);
    const ate = somarDias(inicio, 6);
    const ini = instanteNoFuso(inicio, '00:00');
    const fim = instanteNoFuso(somarDias(inicio, 7), '00:00');
    const { grade, origem } = await this.gradeVigente(orgId);

    const pecas = ((await this.prisma.pautaPeca.findMany({
      where: {
        orgId,
        ...daSemana,
        OR: [
          { agendadaPara: { gte: ini, lt: fim } },
          { agendadaPara: null, status: 'publicada', publicadaEm: { gte: ini, lt: fim } },
          // MD1: o slot proposto aparece em cinza até a peça ganhar agenda de verdade.
          { agendadaPara: null, status: { in: ['rascunho', 'aprovada'] }, slotProposto: { gte: ini, lt: fim } },
        ],
      },
      select: DA_PECA,
    })) as LinhaDaPeca[]).filter((p) => ehPecaDaSemana(p.meta) && p.status !== 'descartada');
    const pendentes = ((await this.prisma.pautaPeca.findMany({
      where: { orgId, ...daSemana, status: 'aprovada', agendadaPara: null },
      select: { id: true, meta: true },
    })) as Array<{ id: string; meta: unknown }>).filter((p) => ehPecaDaSemana(p.meta));

    const ids = [...new Set([...pecas, ...pendentes].map((p) => lerMetaDaSemana(p.meta).episodioId))];
    const eps = await this.episodiosDe(orgId, ids);
    // MD6: a publicação pelo OS de cada peça, quando alguém pediu (o pedido morto chega como erro).
    const publicacoes = await publicacoesParaATela(this.prisma, orgId, pecas.map((p) => p.id));
    // MD8: o item vivo do lote da semana (montado, na fila ou ativo) de cada peça.
    const vivos = this.lotes ? await this.lotes.itensVivos(orgId, CAPACIDADE_DO_ITEM, pecas.map((p) => p.id), agora) : new Map<string, ItemVivo>();
    const naTela = pecas.map((p) =>
      this.naAgenda(p, eps.get(lerMetaDaSemana(p.meta).episodioId), publicacoes.get(p.id) ?? null, vivos.get(p.id) ?? null),
    );

    const dias: PautaDiaDaAgenda[] = [];
    for (let i = 0; i < 7; i++) {
      const dia = somarDias(inicio, i);
      const diaDaSemana = diaDaSemanaDe(dia);
      const feriado = feriadoDoDia(dia, grade.feriados);
      const linhas: PautaLinhaDoDia[] = feriado
        ? []
        : grade.slots
            .filter((s) => s.dia === diaDaSemana)
            .map((s) => ({ hora: s.hora, formato: s.formato, em: instanteNoFuso(dia, s.hora).toISOString(), daGrade: true, peca: null }));
      for (const p of naTela.filter((x) => diaNoFuso(new Date(x.em)) === dia).sort((a, b) => a.em.localeCompare(b.em) || a.id.localeCompare(b.id))) {
        const chave = chaveDoSlot(p.formato, new Date(p.em));
        const slot = linhas.find((l) => l.daGrade && !l.peca && chaveDoSlot(l.formato, new Date(l.em)) === chave);
        if (slot) slot.peca = p;
        else linhas.push({ hora: horaNoFuso(new Date(p.em)), formato: p.formato, em: p.em, daGrade: false, peca: p });
      }
      const ordem = (f: PautaFormatoDaSemana) => PAUTA_FORMATOS_DA_SEMANA.indexOf(f);
      linhas.sort((a, b) => a.em.localeCompare(b.em) || ordem(a.formato) - ordem(b.formato));
      dias.push({ dia, diaDaSemana, feriado, linhas });
    }

    const porEpisodio = new Map<string, number>();
    for (const p of pendentes) {
      const id = lerMetaDaSemana(p.meta).episodioId;
      porEpisodio.set(id, (porEpisodio.get(id) ?? 0) + 1);
    }
    const paraDistribuir: PautaEpisodioParaDistribuir[] = [...porEpisodio]
      .map(([id, n]) => ({ id, n, e: eps.get(id) }))
      .filter((x): x is { id: string; n: number; e: EpisodioDaAgenda } => !!x.e)
      .sort((a, b) => b.e.numero - a.e.numero)
      .map(({ id, n, e }) => ({
        episodioId: id,
        apelido: apelidoDoEpisodio(e.numero),
        titulo: e.titulo,
        status: e.status,
        aprovadasSemData: n,
        motivo: motivoParaNaoAgendar(e.status),
      }));

    return {
      de: inicio,
      ate,
      fuso: PAUTA_FUSO_DA_AGENDA,
      hoje,
      grade,
      origemDaGrade: origem,
      dias,
      paraDistribuir,
      publicacaoAutomatica: await this.publicacaoAutomatica(orgId),
      comentariosPendentes: await this.comentariosPendentes(orgId, agora),
    };
  }

  /** MD9: quantos comentários com a palavra esperam a DM à mão, dentro dos 7 dias. Falhar aqui não derruba a semana. */
  private async comentariosPendentes(orgId: string, agora: Date): Promise<number | undefined> {
    try {
      return await this.prisma.comentarioComPalavra.count({ where: ondeEsperaResposta(orgId, agora) });
    } catch {
      return undefined;
    }
  }

  /** MD8: a nota `pauta.publicacao.automatica`, para a tela dizer ao lado do "Aprovar a semana". Memória fora = desligada. */
  private async publicacaoAutomatica(orgId: string): Promise<boolean> {
    try {
      return notaDaAutomaticaLigada(await this.memoria.porChave(orgId, PAUTA_CHAVE_DA_PUBLICACAO_AUTOMATICA));
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------- escrever

  private async comAAgendaTravada<T>(orgId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pauta-agenda:${orgId}`}))`;
      return fn(tx);
    });
  }

  /**
   * Aloca as peças APROVADAS e ainda sem data do episódio nos próximos slots
   * livres da grade, a partir de agora (ou do dia pedido, se for depois). A
   * peça já agendada fica onde está; o que não cabe no horizonte volta como
   * aviso, sem data. O status do episódio não muda: andar para Agendado segue
   * sendo o passo do operador.
   */
  async distribuir(orgId: string, episodioId: string, actorId: string, input: PautaDistribuirInput): Promise<PautaDistribuicao> {
    const e = await this.episodios.obter(orgId, episodioId);
    const motivo = motivoParaNaoAgendar(e.status);
    if (motivo) throw new BadRequestException(motivo);
    const agora = minuto(this.agora());
    if (input.aPartirDe) {
      const teto = somarDias(diaNoFuso(agora, PAUTA_FUSO_DA_AGENDA), PAUTA_TETO_DO_A_PARTIR_DE_DIAS);
      if (input.aPartirDe > teto) {
        throw new BadRequestException(
          `O "a partir de" vai até ${teto.slice(8, 10)}/${teto.slice(5, 7)}/${teto.slice(0, 4)}: a agenda não passa de ${PAUTA_TETO_DO_REAGENDAR_DIAS} dias à frente.`,
        );
      }
    }
    const pedido = input.aPartirDe ? instanteNoFuso(input.aPartirDe, '00:00') : agora;
    const desde = pedido.getTime() > agora.getTime() ? pedido : agora;
    // Aqui a grade grava slot: sem a da empresa, não se inventa o padrão.
    let lida: ReturnType<typeof gradeDaNota>;
    try {
      lida = gradeDaNota(await this.notaDaGrade(orgId));
    } catch (erro) {
      this.log.warn(`distribuir de ${orgId}: memória indisponível (${(erro as Error).message})`);
      throw new ServiceUnavailableException('A grade da empresa não pôde ser lida agora: nada foi agendado. Tente de novo.');
    }
    const { grade, avisos: avisosDaGrade } = lida;

    const feito = await this.comAAgendaTravada(orgId, async (tx) => {
      const doEpisodio = ((await tx.pautaPeca.findMany({
        where: { orgId, rodadaId: e.rodadaId, ...daSemana, status: 'aprovada' },
        select: { id: true, formato: true, meta: true, agendadaPara: true, slotProposto: true },
      })) as Array<{ id: string; formato: string; meta: unknown; agendadaPara: Date | null; slotProposto: Date | null }>).filter((p) =>
        ehPecaDaSemana(p.meta, e.id),
      );
      if (!doEpisodio.length) {
        throw new BadRequestException('Nenhuma peça aprovada neste episódio: aprove na seção Semana de posts antes de distribuir.');
      }
      const semData = doEpisodio.filter((p) => !p.agendadaPara);
      // O proposto às irmãs ainda em rascunho também está tomado: a aprovada
      // sem proposta não cai em cima do slot que a pessoa vai ver na irmã.
      const irmas = await this.propostosDoEpisodio(tx, orgId, e, new Set(semData.map((p) => p.id)));
      const ocupados = [...(await this.slotsOcupados(tx, orgId, desde, e.id)), ...irmas];
      // MD1: a peça que o encadeamento propôs num slot ainda livre fica nele —
      // o que a pessoa aprovou olhando a semana é o que vai para a agenda. Só
      // se o slot ainda está na grade vigente (grade editada ou feriado novo
      // depois da proposta = vai para o próximo livre).
      const daGrade = new Set(slotsDoPeriodo(grade, desde, PAUTA_HORIZONTE_DA_AGENDA_DIAS).map((s) => chaveDoSlot(s.formato, s.em)));
      const tomados = new Set(ocupados.map((x) => chaveDoSlot(x.formato, x.em)));
      const noProposto: Distribuida['alocacoes'] = [];
      const resto: typeof semData = [];
      for (const p of semData) {
        const chave = p.slotProposto ? chaveDoSlot(p.formato, p.slotProposto) : null;
        if (p.slotProposto && chave && daGrade.has(chave) && !tomados.has(chave)) {
          tomados.add(chave);
          noProposto.push({ id: p.id, formato: p.formato as PautaFormatoDaSemana, itemN: lerMetaDaSemana(p.meta).itemN, em: p.slotProposto });
        } else resto.push(p);
      }
      const distribuida = distribuir({
        pecas: resto.map((p) => ({ id: p.id, formato: p.formato as PautaFormatoDaSemana, itemN: lerMetaDaSemana(p.meta).itemN })),
        ocupados: [...ocupados, ...noProposto.map((a) => ({ formato: a.formato, em: a.em }))],
        grade,
        desde,
      });
      const r: Distribuida = { alocacoes: [...noProposto, ...distribuida.alocacoes], semVaga: distribuida.semVaga };
      const gravadas: PautaDistribuicao['pecas'] = [];
      const avisos: string[] = [];
      for (const a of r.alocacoes) {
        const u = await tx.pautaPeca.updateMany({
          where: { id: a.id, orgId, status: 'aprovada', agendadaPara: null },
          data: { agendadaPara: a.em },
        });
        if (u.count === 0) avisos.push(`A peça ${a.id} mudou enquanto isso e ficou sem data.`);
        else gravadas.push({ id: a.id, formato: a.formato, itemN: a.itemN, em: a.em.toISOString() });
      }
      for (const s of r.semVaga) {
        avisos.push(`${PAUTA_FORMATO_DA_SEMANA_ROTULO[s.formato]} da matéria ${s.itemN}: sem slot livre nas próximas 4 semanas da grade — distribua de novo com um "a partir de" mais adiante ou abra mais slots na grade.`);
      }
      return { gravadas, avisos, jaAgendadas: doEpisodio.length - semData.length, semVaga: r.semVaga.length };
    });

    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.semana_distribuida',
      entityType: 'pauta_episodio',
      entityId: episodioId,
      after: {
        desde: desde.toISOString(),
        alocadas: feito.gravadas.map((p) => ({ id: p.id, em: p.em })),
        jaAgendadas: feito.jaAgendadas,
        semVaga: feito.semVaga,
      },
    });
    return {
      conta: { alocadas: feito.gravadas.length, jaAgendadas: feito.jaAgendadas, semVaga: feito.semVaga },
      pecas: feito.gravadas,
      avisos: [...avisosDaGrade, ...feito.avisos],
    };
  }

  /**
   * Os slots já tomados a partir de `desde`: a agenda de verdade (aprovada ou
   * publicada, de qualquer episódio) e os slots PROPOSTOS de outros episódios
   * (MD1). Os propostos do próprio episódio não contam contra ele: quem
   * distribui ou propõe de novo é dono deles.
   */
  private async slotsOcupados(tx: Prisma.TransactionClient, orgId: string, desde: Date, episodioId: string): Promise<Array<{ formato: string; em: Date }>> {
    const aPartir = minuto(new Date(desde.getTime() - MINUTO));
    const linhas = (await tx.pautaPeca.findMany({
      where: {
        orgId,
        ...daSemana,
        OR: [
          { status: { in: ['aprovada', 'publicada'] }, agendadaPara: { gte: aPartir } },
          { status: { in: ['rascunho', 'aprovada'] }, agendadaPara: null, slotProposto: { gte: aPartir } },
        ],
      },
      select: { formato: true, status: true, meta: true, agendadaPara: true, slotProposto: true },
    })) as Array<{ formato: string; status: PautaPecaStatus; meta: unknown; agendadaPara: Date | null; slotProposto: Date | null }>;
    const saida: Array<{ formato: string; em: Date }> = [];
    for (const x of linhas) {
      if (x.agendadaPara && (x.status === 'aprovada' || x.status === 'publicada')) saida.push({ formato: x.formato, em: x.agendadaPara });
      else if (x.slotProposto && !x.agendadaPara && !ehPecaDaSemana(x.meta, episodioId)) saida.push({ formato: x.formato, em: x.slotProposto });
    }
    return saida;
  }

  /** Os slots propostos às peças da semana do episódio ainda sem agenda, menos as de `exceto`. */
  private async propostosDoEpisodio(
    tx: Prisma.TransactionClient,
    orgId: string,
    e: { id: string; rodadaId: string },
    exceto: ReadonlySet<string>,
  ): Promise<Array<{ formato: string; em: Date }>> {
    const linhas = (await tx.pautaPeca.findMany({
      where: { orgId, rodadaId: e.rodadaId, ...daSemana, status: { in: ['rascunho', 'aprovada'] }, agendadaPara: null, slotProposto: { not: null } },
      select: { id: true, formato: true, meta: true, slotProposto: true },
    })) as Array<{ id: string; formato: string; meta: unknown; slotProposto: Date | null }>;
    return linhas
      .filter((p) => !exceto.has(p.id) && ehPecaDaSemana(p.meta, e.id) && !!p.slotProposto)
      .map((p) => ({ formato: p.formato, em: p.slotProposto as Date }));
  }

  /**
   * MD1: PROPÕE um slot da grade para as peças da semana ainda em RASCUNHO do
   * episódio (sem agenda e sem proposta), a partir do dia seguinte — quem
   * aprova precisa de tempo para olhar. Grava só `slotProposto`: `agendadaPara`
   * continua exclusivo da peça aprovada. Não colide com a agenda de ninguém nem
   * com o proposto de outro episódio; o que não cabe fica sem slot, com aviso.
   */
  async proporSlots(orgId: string, episodioId: string, actorId: string): Promise<{ propostas: number; semVaga: number; avisos: string[] }> {
    const e = await this.episodios.obter(orgId, episodioId);
    const motivo = motivoParaNaoAgendar(e.status);
    if (motivo) throw new BadRequestException(motivo);
    let lida: ReturnType<typeof gradeDaNota>;
    try {
      lida = gradeDaNota(await this.notaDaGrade(orgId));
    } catch (erro) {
      this.log.warn(`propor slots de ${orgId}: memória indisponível (${(erro as Error).message})`);
      throw new ServiceUnavailableException('A grade da empresa não pôde ser lida agora: nenhum slot foi proposto.');
    }
    const { grade, avisos: avisosDaGrade } = lida;
    const desde = instanteNoFuso(somarDias(diaNoFuso(this.agora(), PAUTA_FUSO_DA_AGENDA), 1), '00:00');

    const feito = await this.comAAgendaTravada(orgId, async (tx) => {
      const rascunhos = ((await tx.pautaPeca.findMany({
        where: { orgId, rodadaId: e.rodadaId, ...daSemana, status: 'rascunho', agendadaPara: null, slotProposto: null },
        select: { id: true, formato: true, meta: true },
      })) as Array<{ id: string; formato: string; meta: unknown }>).filter((p) => ehPecaDaSemana(p.meta, e.id));
      if (!rascunhos.length) return { gravadas: [] as Array<{ id: string; em: string }>, avisos: [] as string[], semVaga: 0 };
      const ocupados = await this.slotsOcupados(tx, orgId, desde, e.id);
      // Os já propostos do próprio episódio também tomam o slot: senão duas
      // passagens poriam duas peças do mesmo formato no mesmo minuto.
      const proprios = await this.propostosDoEpisodio(tx, orgId, e, new Set());
      const r = distribuir({
        pecas: rascunhos.map((p) => ({ id: p.id, formato: p.formato as PautaFormatoDaSemana, itemN: lerMetaDaSemana(p.meta).itemN })),
        ocupados: [...ocupados, ...proprios],
        grade,
        desde,
      });
      const gravadas: Array<{ id: string; em: string }> = [];
      const avisos: string[] = [];
      for (const a of r.alocacoes) {
        const u = await tx.pautaPeca.updateMany({
          where: { id: a.id, orgId, status: 'rascunho', agendadaPara: null, slotProposto: null },
          data: { slotProposto: a.em },
        });
        if (u.count === 0) avisos.push(`A peça ${a.id} mudou enquanto isso e ficou sem slot proposto.`);
        else gravadas.push({ id: a.id, em: a.em.toISOString() });
      }
      for (const s of r.semVaga) {
        avisos.push(`${PAUTA_FORMATO_DA_SEMANA_ROTULO[s.formato]} da matéria ${s.itemN}: sem slot livre nas próximas 4 semanas da grade.`);
      }
      return { gravadas, avisos, semVaga: r.semVaga.length };
    });

    if (feito.gravadas.length || feito.semVaga) {
      await this.audit.log({
        orgId,
        actorId,
        action: 'pauta.semana_proposta',
        entityType: 'pauta_episodio',
        entityId: episodioId,
        after: { desde: desde.toISOString(), propostas: feito.gravadas, semVaga: feito.semVaga },
      });
    }
    return { propostas: feito.gravadas.length, semVaga: feito.semVaga, avisos: [...avisosDaGrade, ...feito.avisos] };
  }

  private async pecaDaSemana(orgId: string, pecaId: string, db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<LinhaDaPeca> {
    const p = (await db.pautaPeca.findFirst({ where: { id: pecaId, orgId }, select: DA_PECA })) as LinhaDaPeca | null;
    if (!p || !ehPecaDaSemana(p.meta)) throw new NotFoundException('Peça da semana não encontrada.');
    return p;
  }

  /**
   * Muda o slot de UMA peça aprovada (ou a tira da agenda, com nulo). Não aceita
   * o passado nem além de 90 dias, e não põe duas peças do mesmo formato no mesmo minuto.
   */
  async reagendar(orgId: string, pecaId: string, actorId: string, input: PautaReagendarInput): Promise<{ id: string; agendadaPara: string | null }> {
    const antes = await this.pecaDaSemana(orgId, pecaId);
    const e = await this.episodios.obter(orgId, lerMetaDaSemana(antes.meta).episodioId);
    const motivo = motivoParaNaoAgendar(e.status);
    if (motivo) throw new BadRequestException(motivo);
    const agora = this.agora();
    const em = input.agendadaPara === null ? null : minuto(new Date(input.agendadaPara));
    if (em) {
      if (em.getTime() < agora.getTime() - MINUTO) throw new BadRequestException('Esse horário já passou: escolha um slot à frente.');
      if (em.getTime() > agora.getTime() + PAUTA_TETO_DO_REAGENDAR_DIAS * DIA) {
        throw new BadRequestException(`A agenda vai até ${PAUTA_TETO_DO_REAGENDAR_DIAS} dias à frente.`);
      }
    }

    const p = await this.comAAgendaTravada(orgId, async (tx) => {
      const p = await this.pecaDaSemana(orgId, pecaId, tx);
      this.exigirAprovada(p);
      if (em) {
        const outra = (await tx.pautaPeca.findFirst({
          where: { orgId, ...daSemana, formato: p.formato, agendadaPara: em, status: { in: ['aprovada', 'publicada'] }, id: { not: p.id } },
          select: { id: true, titulo: true },
        })) as { id: string; titulo: string } | null;
        if (outra) {
          throw new ConflictException(
            `Já há um ${PAUTA_FORMATO_DA_SEMANA_ROTULO[p.formato as PautaFormatoDaSemana].toLowerCase()} nesse horário ("${outra.titulo}"): escolha outro.`,
          );
        }
      }
      const u = await tx.pautaPeca.updateMany({ where: { id: p.id, orgId, status: 'aprovada' }, data: { agendadaPara: em } });
      if (u.count === 0) throw new ConflictException('A peça mudou enquanto isso — recarregue e tente de novo.');
      return p;
    });

    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.semana_reagendada',
      entityType: 'pauta_peca',
      entityId: p.id,
      before: { agendadaPara: p.agendadaPara?.toISOString() ?? null },
      after: { agendadaPara: em?.toISOString() ?? null },
    });
    // MD8: o horário é parte do que a semana assinou. Reagendar tira a peça do
    // lote; para ela sair sozinha no horário novo, "Aprovar a semana" monta um
    // lote novo só com ela.
    if ((p.agendadaPara?.getTime() ?? null) !== (em?.getTime() ?? null)) {
      await revogarItemDaPeca(this.lotes, this.log, orgId, p.id, 'a peça foi reagendada', actorId);
    }
    return { id: p.id, agendadaPara: em?.toISOString() ?? null };
  }

  private exigirAprovada(p: { status: PautaPecaStatus }, para: 'agendar' | 'postar' = 'agendar') {
    if (p.status === 'publicada') throw new BadRequestException('Peça já postada — a data dela é a da postagem.');
    if (p.status !== 'aprovada') {
      throw new BadRequestException(
        para === 'postar' ? 'Só a peça aprovada se marca como postada: aprove antes.' : 'Só a peça aprovada entra na agenda: aprove antes.',
      );
    }
  }

  /**
   * "Marcar como postada": o operador postou à mão e registra — status
   * `publicada`, quando e quem, e o link público se houver. Registro INTERNO:
   * nada sai do OS, não passa pela porta. Na peça já marcada à mão, só o link
   * muda (quem esqueceu de colar). A postada pela MC17 (com `externalId`) não se mexe daqui.
   */
  async marcarPostada(orgId: string, pecaId: string, actorId: string, input: PautaMarcarPostadaInput): Promise<PautaPecaNaAgenda> {
    const antes = await this.pecaDaSemana(orgId, pecaId);
    const url = input.url ?? null;
    let data: Prisma.PautaPecaUpdateManyMutationInput;
    let where: Prisma.PautaPecaWhereInput;
    if (antes.status === 'publicada') {
      if (antes.externalId) throw new BadRequestException('Esta peça foi publicada pelo OS: o registro é o da publicação.');
      if (!url) throw new BadRequestException('A peça já está marcada como postada: mande o link para acrescentá-lo.');
      where = { id: antes.id, orgId, status: 'publicada', externalId: null };
      data = { urlPublicada: url };
    } else {
      this.exigirAprovada(antes, 'postar');
      where = { id: antes.id, orgId, status: 'aprovada' };
      data = { status: 'publicada', publicadaEm: this.agora(), publicadaPor: actorId, urlPublicada: url, erro: null };
    }
    const u = await this.prisma.pautaPeca.updateMany({ where, data });
    if (u.count === 0) throw new ConflictException('A peça mudou enquanto isso — recarregue e tente de novo.');

    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.semana_postada',
      entityType: 'pauta_peca',
      entityId: antes.id,
      before: { status: antes.status, urlPublicada: antes.urlPublicada },
      after: { status: 'publicada', manual: true, urlPublicada: url ?? antes.urlPublicada, agendadaPara: antes.agendadaPara?.toISOString() ?? null },
    });
    if (antes.status !== 'publicada') await revogarItemDaPeca(this.lotes, this.log, orgId, antes.id, 'a peça foi postada à mão', actorId);
    const depois = await this.pecaDaSemana(orgId, pecaId);
    const eps = await this.episodiosDe(orgId, [lerMetaDaSemana(depois.meta).episodioId]);
    return this.naAgenda(depois, eps.get(lerMetaDaSemana(depois.meta).episodioId));
  }
}
