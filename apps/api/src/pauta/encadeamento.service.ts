import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, type Prisma } from '@prisma/client';
import {
  PAUTA_ETAPA_DO_ENCADEAMENTO_ROTULO,
  PAUTA_FORMATOS_DA_SEMANA,
  PAUTA_TIPO_DA_ROTINA_DE_ENCADEAMENTO,
  apelidoDoEpisodio,
  titulosDoPacote,
  type PautaEncadeamentoDoEpisodio,
  type PautaEpisodioStatus,
  type PautaEtapaDoEncadeamento,
  type PautaFormatoDaSemana,
  type PautaPecaStatus,
  type PautaResultadoDoPasso,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { estadoDispara, silencioDoTiqueDaPauta } from '../routines/rotina.tipos';
import { PacoteService } from './pacote.service';
import { ACAO_DA_MONTAGEM_DA_PAGINA, PaginaDeLinksService } from './pagina-de-links.service';
import { NewsletterService } from './newsletter.service';
import { DerivacaoService } from './derivacao.service';
import { AgendaService } from './agenda.service';
import { itensMantidos, lerTranscricao } from './episodio';
import { thumbsGuardadas } from './pacote-do-episodio';
import { ehNewsletterDaTranscricao } from './newsletter-do-episodio';
import { chaveDoItem, ehPecaDaSemana, lerMetaDaSemana } from './derivacao-do-episodio';
import { midiaDaPeca } from './agenda-da-semana';
import {
  ConfigDoEncadeamentoInvalidaError,
  STATUS_QUE_ENCADEIAM,
  TETO_DE_EPISODIOS_POR_PASSAGEM,
  etapasDaConfig,
  leituraDoHistorico,
  lerPassoDoRastro,
  paraATela,
  proximoPasso,
  type EpisodioParaEncadear,
  type PassoNoRastro,
} from './encadeamento-do-episodio';

/** Quem os serviços de sempre registram como autor do passo (o mesmo da coleta de quinta). */
export const ATOR_DO_ENCADEAMENTO = 'rotina';

/** O evento de cada passo no RASTRO. */
export const ACAO_DO_PASSO = 'pauta.encadeamento_passo';

/** Quantos passos do histórico se releem por episódio: cobre a trava de três e o último de cada etapa. */
const HISTORICO_LIDO = 20;

/**
 * Quantos episódios a passagem lê de cada vez (do mais velho). Ela segue lendo
 * o lote seguinte até dar os passos do teto ou acabar a lista: os parados em
 * Derivação (o fim normal do caminho) não escondem o episódio novo.
 */
export const LOTE_DE_CANDIDATOS = 20;

const DO_EPISODIO = {
  id: true,
  numero: true,
  status: true,
  rodadaId: true,
  transcricao: true,
  titulos: true,
  descricao: true,
  thumbs: true,
  bioPageId: true,
  atualizadoEm: true,
  bioPage: { select: { publicada: true } },
  rodada: { select: { itens: true } },
} as const;

interface LinhaDoEpisodio {
  id: string;
  numero: number;
  status: PautaEpisodioStatus;
  rodadaId: string;
  transcricao: unknown;
  titulos: unknown;
  descricao: string;
  thumbs: unknown;
  bioPageId: string | null;
  atualizadoEm: Date;
  bioPage: { publicada: boolean } | null;
  rodada: { itens: unknown } | null;
}

export interface PassoDaPassagem {
  episodioId: string;
  apelido: string;
  etapa: PautaEtapaDoEncadeamento;
  resultado: PautaResultadoDoPasso;
  detalhe: string;
}

export interface Passagem {
  orgId: string;
  rotinaId: string | null;
  correlationId: string;
  origem: 'cron' | 'manual';
  etapas: readonly PautaEtapaDoEncadeamento[];
}

/**
 * Como o desfecho de um passo é lido:
 *   · 409 — o `umaPorVez` do clique manual em curso, ou outra aba mexendo: `pulada`,
 *     sem pagar a IA duas vezes; a passagem seguinte relê e decide de novo;
 *   · 400/403/404 — falta insumo que só gente resolve (nenhuma matéria com link,
 *     módulo desligado): `dispensada` até alguém mexer no episódio;
 *   · o resto (IA fora do ar, JSON ruim, teto de custo) — `erro`, sem avançar.
 */
export function resultadoDoErro(e: unknown): PautaResultadoDoPasso {
  if (e instanceof ConflictException) return 'pulada';
  if (e instanceof BadRequestException || e instanceof ForbiddenException || e instanceof NotFoundException) return 'dispensada';
  return 'erro';
}

/*
 * O ENCADEAMENTO (MD1): a transcrição chega e o OS anda sozinho até a semana
 * em RASCUNHO com os slots propostos — pacote, página montada (sem pôr no ar),
 * newsletter, semana de posts e slots. Um passo por episódio por passagem, no
 * máximo dois episódios, pelos MESMOS serviços (e as mesmas chaves do
 * `umaPorVez`) dos botões da tela. Nada aqui sai do OS.
 *
 * Quem liga é a rotina `pauta.encadear` em /rotinas: sem ela criada, nada anda.
 */
@Injectable()
export class EncadeamentoService {
  private readonly log = new Logger('EncadeamentoService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pacotes: PacoteService,
    private readonly paginas: PaginaDeLinksService,
    private readonly newsletters: NewsletterService,
    private readonly semana: DerivacaoService,
    private readonly agenda: AgendaService,
  ) {}

  // ------------------------------------------------------------------ ler

  private async moduloBio(orgId: string): Promise<boolean> {
    const org = await this.prisma.org.findUnique({ where: { id: orgId }, select: { modulos: true } });
    return !!org?.modulos.includes('bio');
  }

  private async situacao(orgId: string, e: LinhaDoEpisodio, moduloBio: boolean): Promise<EpisodioParaEncadear> {
    const apelido = apelidoDoEpisodio(e.numero);
    // As descartadas entram na conta: a rotina só gera onde nunca houve nada.
    const daSemana = ((await this.prisma.pautaPeca.findMany({
      where: { orgId, rodadaId: e.rodadaId, canal: 'instagram', formato: { in: [...PAUTA_FORMATOS_DA_SEMANA] } },
      select: { formato: true, status: true, meta: true, agendadaPara: true, slotProposto: true },
    })) as Array<{ formato: string; status: PautaPecaStatus; meta: unknown; agendadaPara: Date | null; slotProposto: Date | null }>).filter((p) =>
      ehPecaDaSemana(p.meta, e.id),
    );
    const pecas = daSemana.filter((p) => p.status !== 'descartada');
    const newsletters = (await this.prisma.pautaPeca.findMany({
      where: { orgId, rodadaId: e.rodadaId, canal: 'newsletter' },
      select: { status: true, meta: true },
    })) as Array<{ status: PautaPecaStatus; meta: unknown }>;
    const daTranscricao = newsletters.filter((n) => ehNewsletterDaTranscricao(n.meta, e.id));
    const temNewsletter = daTranscricao.some((n) => n.status !== 'descartada');
    const paginaApagada =
      !e.bioPageId &&
      !!(await this.prisma.auditLog.findFirst({
        where: { orgId, action: ACAO_DA_MONTAGEM_DA_PAGINA, entityType: 'pauta_episodio', entityId: e.id },
        select: { id: true },
      }));

    const formatosPorMateria = new Map<string, Set<string>>();
    for (const p of daSemana) {
      const itemId = lerMetaDaSemana(p.meta).itemId;
      if (!itemId) continue;
      const fs = formatosPorMateria.get(itemId) ?? new Set<string>();
      fs.add(p.formato);
      formatosPorMateria.set(itemId, fs);
    }
    const mantidos = itensMantidos(e.rodada?.itens);
    const materiasSemPeca: number[] = [];
    const materiasIncompletas: number[] = [];
    mantidos.forEach((item, i) => {
      const fs = formatosPorMateria.get(chaveDoItem(item));
      if (!fs) materiasSemPeca.push(i + 1);
      else if (fs.size < PAUTA_FORMATOS_DA_SEMANA.length) materiasIncompletas.push(i + 1);
    });

    const titulos = titulosDoPacote(e.titulos).length;
    return {
      apelido,
      status: e.status,
      temTranscricao: lerTranscricao(e.transcricao).length > 0,
      temPacote: titulos > 0 || e.descricao.trim() !== '' || thumbsGuardadas(e.thumbs).length > 0,
      temTitulos: titulos > 0,
      temPagina: !!e.bioPageId,
      paginaApagada,
      paginaNoAr: !!e.bioPage?.publicada,
      moduloBio,
      temNewsletter,
      newsletterDescartada: !temNewsletter && daTranscricao.length > 0,
      mioloAprovado: newsletters.some((n) => n.status === 'aprovada' && !ehNewsletterDaTranscricao(n.meta)),
      materias: mantidos.length,
      materiasSemPeca,
      materiasIncompletas,
      pecasDescartadas: daSemana.length - pecas.length,
      pecas: pecas.map((p) => {
        const formato = p.formato as PautaFormatoDaSemana;
        const onde = midiaDaPeca(formato, p.meta, apelido).onde;
        return {
          formato,
          status: p.status,
          agendada: !!p.agendadaPara,
          temSlotProposto: !!p.slotProposto,
          midiaPronta: onde === 'storage' || onde === 'mac',
        };
      }),
    };
  }

  private async historico(orgId: string, episodioId: string): Promise<PassoNoRastro[]> {
    const linhas = (await this.prisma.auditLog.findMany({
      where: { orgId, action: ACAO_DO_PASSO, entityType: 'pauta_episodio', entityId: episodioId },
      orderBy: { createdAt: 'desc' },
      take: HISTORICO_LIDO,
      select: { after: true, createdAt: true },
    })) as Array<{ after: unknown; createdAt: Date }>;
    return linhas.map((l) => lerPassoDoRastro(l.after, l.createdAt)).filter((p): p is PassoNoRastro => !!p);
  }

  /** `GET /pauta/episodios/:id/encadeamento`: o próximo passo automático, ou por que ele para. */
  async doEpisodio(orgId: string, id: string): Promise<PautaEncadeamentoDoEpisodio> {
    const e = (await this.prisma.pautaEpisodio.findFirst({ where: { id, orgId }, select: DO_EPISODIO })) as LinhaDoEpisodio | null;
    if (!e) throw new NotFoundException('Episódio não encontrado');
    const rotina = await this.prisma.rotina.findFirst({
      where: { orgId, tipo: PAUTA_TIPO_DA_ROTINA_DE_ENCADEAMENTO },
      orderBy: { criadaEm: 'asc' },
      select: { nome: true, ativo: true, estado: true, config: true },
    });
    let etapas: PautaEtapaDoEncadeamento[];
    let configIlegivel: string | null = null;
    try {
      etapas = etapasDaConfig(rotina?.config);
    } catch (err) {
      if (!(err instanceof ConfigDoEncadeamentoInvalidaError)) throw err;
      etapas = [];
      configIlegivel = err.message;
    }
    const sit = await this.situacao(orgId, e, await this.moduloBio(orgId));
    const hist = await this.historico(orgId, id);
    const leitura = leituraDoHistorico(hist, e.atualizadoEm);
    let px = proximoPasso(sit, { etapas, dispensadas: leitura.dispensadas });
    if (configIlegivel) {
      px = { passo: 'parar', motivo: `A rotina falha a cada passagem: ${configIlegivel}.` };
    } else if (px.passo !== 'parar' && leitura.travada === px.passo) {
      const ultimo = hist.find((p) => p.etapa === px.passo && p.resultado === 'erro');
      px = {
        passo: 'parar',
        motivo:
          `Três erros seguidos ao ${PAUTA_ETAPA_DO_ENCADEAMENTO_ROTULO[px.passo]}` +
          `${ultimo?.detalhe ? ` (o último: ${ultimo.detalhe})` : ''}. A rotina espera alguém mexer no episódio — ou "Rodar agora" em /rotinas tenta de novo.`,
      };
    }
    // O tique calado por variável (a mesma leitura do agendador) também não dispara.
    const calada = rotina ? silencioDoTiqueDaPauta() : null;
    return {
      episodioId: id,
      passo: px.passo,
      motivo: px.motivo,
      etapas,
      rotina: {
        existe: !!rotina,
        dispara: !!rotina && rotina.ativo && estadoDispara(rotina.estado) && !calada,
        nome: rotina?.nome ?? null,
        calada,
      },
      ultimos: hist.slice(0, 5).map(paraATela),
    };
  }

  // ------------------------------------------------------------------ andar

  private async rodarEtapa(orgId: string, id: string, etapa: PautaEtapaDoEncadeamento, itens?: number[]): Promise<string> {
    switch (etapa) {
      case 'pacote': {
        const r = await this.pacotes.gerar(orgId, id, ATOR_DO_ENCADEAMENTO, { substituir: false });
        return `${r.episodio.titulos.length} título(s), ${r.episodio.thumbs.length} thumb(s)${r.avisos.length ? `, ${r.avisos.length} aviso(s)` : ''}`;
      }
      case 'pagina': {
        // Sem `bio.editar`: a rotina nunca remonta página que já está no ar.
        const r = await this.paginas.montar(orgId, id, { sub: ATOR_DO_ENCADEAMENTO, permissions: ['pauta.editar'] });
        return `página montada fora do ar: ${r.criados} botão(ões) novo(s), ${r.atualizados} atualizado(s)`;
      }
      case 'newsletter': {
        const r = await this.newsletters.gerar(orgId, id, ATOR_DO_ENCADEAMENTO, { substituir: false });
        const n = r.newsletter;
        return n ? `newsletter em rascunho${n.checagem.aprovada ? '' : `, ${n.checagem.apontamentos.length} apontamento(s) anti-slop`}` : 'newsletter gerada';
      }
      case 'semana': {
        const r = await this.semana.gerar(orgId, id, ATOR_DO_ENCADEAMENTO, { substituir: false, ...(itens?.length ? { itens } : {}) });
        const feitas = `${r.conta.criadas} peça(s) em rascunho`;
        // A semana pela metade é erro: entra no histórico e na trava de três, e a
        // passagem seguinte volta só às matérias que ficaram sem peça.
        if (r.conta.falharam > 0) throw new Error(`${feitas}, ${r.conta.falharam} falharam: ${r.avisos.join(' ')}`);
        return feitas;
      }
      case 'slots': {
        const r = await this.agenda.proporSlots(orgId, id, ATOR_DO_ENCADEAMENTO);
        if (r.propostas === 0) {
          throw new BadRequestException(r.avisos.join(' ') || 'Nenhum slot livre na grade para as peças em rascunho.');
        }
        return `${r.propostas} slot(s) proposto(s)${r.semVaga ? `, ${r.semVaga} sem vaga` : ''}`;
      }
    }
  }

  private async registrar(
    p: Passagem,
    e: { id: string; apelido: string },
    etapa: PautaEtapaDoEncadeamento,
    resultado: PautaResultadoDoPasso,
    detalhe: string,
  ): Promise<void> {
    const agora = (await this.prisma.pautaEpisodio.findFirst({ where: { id: e.id, orgId: p.orgId }, select: { atualizadoEm: true } })) as {
      atualizadoEm: Date;
    } | null;
    await this.audit.log({
      orgId: p.orgId,
      actorType: ActorType.system,
      action: ACAO_DO_PASSO,
      entityType: 'pauta_episodio',
      entityId: e.id,
      after: {
        etapa,
        episodio: e.apelido,
        resultado,
        detalhe: detalhe.slice(0, 500),
        episodioAtualizadoEm: agora?.atualizadoEm.toISOString() ?? null,
      },
      metadata: { correlationId: p.correlationId, rotinaId: p.rotinaId, origem: p.origem } as Prisma.InputJsonValue,
    });
  }

  /**
   * Uma passagem: do episódio mais velho ao mais novo, calcula o próximo passo
   * de cada um e roda UM passo em no máximo dois episódios, lendo em lotes até
   * achar os dois ou acabar a lista. A etapa que falhou três vezes seguidas sem
   * ninguém mexer fica travada (a passagem do relógio a pula com aviso). O
   * "Rodar agora" da tela passa por cima da trava e da dispensa: é gente pedindo.
   */
  async passar(p: Passagem): Promise<PassoDaPassagem[]> {
    const moduloBio = await this.moduloBio(p.orgId);
    const passos: PassoDaPassagem[] = [];
    const manual = p.origem === 'manual';
    let rodados = 0;
    let depoisDe: number | null = null;

    while (rodados < TETO_DE_EPISODIOS_POR_PASSAGEM) {
      const lote = (await this.prisma.pautaEpisodio.findMany({
        where: { orgId: p.orgId, status: { in: [...STATUS_QUE_ENCADEIAM] }, ...(depoisDe === null ? {} : { numero: { gt: depoisDe } }) },
        orderBy: { numero: 'asc' },
        take: LOTE_DE_CANDIDATOS,
        select: DO_EPISODIO,
      })) as LinhaDoEpisodio[];
      if (!lote.length) break;
      depoisDe = lote[lote.length - 1].numero;

      for (const e of lote) {
        if (rodados >= TETO_DE_EPISODIOS_POR_PASSAGEM) break;
        const sit = await this.situacao(p.orgId, e, moduloBio);
        const hist = await this.historico(p.orgId, e.id);
        const leitura = leituraDoHistorico(hist, e.atualizadoEm);
        const px = proximoPasso(sit, { etapas: p.etapas, dispensadas: manual ? [] : leitura.dispensadas });
        if (px.passo === 'parar') continue;
        const alvo = { id: e.id, apelido: sit.apelido };

        if (leitura.travada === px.passo && !manual) {
          const detalhe = `três erros seguidos ao ${PAUTA_ETAPA_DO_ENCADEAMENTO_ROTULO[px.passo]}: a rotina espera alguém mexer no episódio`;
          if (!leitura.jaAvisada) {
            this.log.warn(`encadeamento ${sit.apelido} de ${p.orgId}: ${detalhe}`);
            await this.registrar(p, alvo, px.passo, 'travada', detalhe);
          }
          passos.push({ episodioId: e.id, apelido: sit.apelido, etapa: px.passo, resultado: 'travada', detalhe });
          continue;
        }

        rodados++;
        let resultado: PautaResultadoDoPasso = 'ok';
        let detalhe: string;
        try {
          detalhe = await this.rodarEtapa(p.orgId, e.id, px.passo, px.itens);
        } catch (err) {
          resultado = resultadoDoErro(err);
          detalhe = ((err as Error)?.message ?? 'falha desconhecida').slice(0, 300);
          if (resultado === 'erro') this.log.warn(`encadeamento ${sit.apelido} de ${p.orgId}, ${px.passo}: ${detalhe}`);
        }
        await this.registrar(p, alvo, px.passo, resultado, detalhe);
        passos.push({ episodioId: e.id, apelido: sit.apelido, etapa: px.passo, resultado, detalhe });
      }
      if (lote.length < LOTE_DE_CANDIDATOS) break;
    }
    return passos;
  }
}
