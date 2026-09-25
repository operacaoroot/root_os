import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  PAUTA_FORA_DO_LOTE_YOUTUBE,
  PAUTA_FORMATOS_DA_SEMANA,
  PAUTA_FORMATO_DA_SEMANA_ROTULO,
  YOUTUBE_USOS_DA_PUBLICACAO,
  YOUTUBE_USOS_DO_ENVIO,
  bytesUtf8,
  youtubeAuditoria,
  apelidoDoEpisodio,
  diaNoFuso,
  etapaDaPecaNaSemana,
  horaNoFuso,
  type PautaAprovacaoDaSemana,
  type PautaConteudoDoLote,
  type PautaFormatoDaSemana,
  type PautaLoteMontado,
  type PautaPecaParaAprovar,
  type PautaPecaStatus,
  type PautaItemDoYoutubeNoLote,
  type PautaYoutubeNoLote,
} from '@mktos/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { LotesService, type DetalheDoLote, type ItemParaMontar, type ItemVivo, type LoteQueAtivou, type ReacaoAoAtivar } from '../approvals/lotes.service';
import { EnvioAoYoutubeService } from './envio-ao-youtube.service';
import { CAPACIDADE_DE_ENVIAR, CAPACIDADE_DE_PUBLICAR, capacidadesDoLote, janelasDoYoutube } from './youtube-do-episodio';
import { ehPecaDaSemana, lerMetaDaSemana } from './derivacao-do-episodio';
import { legendaDoPedido, type ContaParaPublicar } from './publicacao-instagram';
import { PublicacaoInstagramService, contaDePublicacao, publicacoesEmJogo, publicacoesParaATela } from './publicacao-instagram.service';
import { umaPorVez } from './uma-por-vez';
import {
  CAPACIDADE_DO_ITEM,
  CAPACIDADE_DO_LOTE,
  RECURSO_DO_LOTE,
  argsDoItem,
  divergenciaDoItem,
  entraNaAprovacao,
  impedimentosDaSemana,
  janelaDoItem,
  ocupadoComAsCandidatas,
  problemaDaPeca,
  problemaDaPublicacao,
  reabreNaAtivacao,
  slotDaPeca,
  validadeDoLote,
  type PecaDoLote,
} from './lote-da-semana';

/*
 * ============================================================================
 * APROVAR A SEMANA NUM PONTO SÓ (MD8)
 * ============================================================================
 *
 * A semana de posts de um episódio vira UM lote de `pauta.semana.aprovar` (R4,
 * MD7): cada item é o pedido exato de publicação de uma peça, e uma segunda
 * pessoa, titular, assina a lista inteira com senha e motivo em /atendimento.
 *
 *   · MONTAR (`preparar`): as peças com slot (proposto pelo encadeamento ou
 *     agendado), menos as que ficam de fora; cada uma passa pelas
 *     pré-condições (página de links no ar, conta de publicação, mídia no
 *     storage, carrossel até 10, legenda até 2.200, slot à frente) e entra com
 *     o hash dos argumentos que o executor vai mandar à porta no horário.
 *   · PEDIR A ASSINATURA: a rota da MD7 (`POST /approvals/lotes/:id/pedir-assinatura`).
 *   · ATIVAR (`aoAtivar`, inscrito em `LotesService`): na transação que liga o
 *     lote, as peças passam a `aprovada` no slot, o proposto é limpo e o
 *     episódio vai a Agendado. A peça que mudou depois de montada não é
 *     aprovada: o item dela é revogado ali mesmo.
 *   · DEPOIS: editar texto, mídia ou horário revoga só o item daquela peça
 *     (quem edita chama `LotesService.revogarItensDoRecurso`); "Cancelar a
 *     semana" revoga o lote inteiro, sem assinatura, porque só diminui o
 *     alcance; e a rotina `pauta.publicar-agendadas` publica cada item no
 *     horário, se a nota `pauta.publicacao.automatica` estiver ligada.
 *
 * Nada aqui fala com a Meta. A única saída de fora do OS continua sendo o
 * efeito de `instagram.post.publicar`, disparado pela porta.
 */

const DA_PECA = {
  id: true,
  canal: true,
  formato: true,
  status: true,
  titulo: true,
  corpo: true,
  meta: true,
  agendadaPara: true,
  slotProposto: true,
} as const;

type LinhaDaPeca = PecaDoLote & { titulo: string };

const quando = (d: Date) => `${diaNoFuso(d).slice(8, 10)}/${diaNoFuso(d).slice(5, 7)} ${horaNoFuso(d)}`;

@Injectable()
export class LoteDaSemanaService implements OnModuleInit {
  private readonly log = new Logger('LoteDaSemana');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly lotes: LotesService,
    private readonly publicacao: PublicacaoInstagramService,
    /*
     * MD10: o vídeo do episódio entra no MESMO lote (o envio privado e o
     * agendamento). `@Optional()` porque as suítes da MD8 montam o serviço sem
     * ele — e então o lote é só do Instagram, como antes.
     */
    @Optional() private readonly youtube?: EnvioAoYoutubeService,
  ) {}

  onModuleInit(): void {
    const reacao: ReacaoAoAtivar = (tx, lote) => this.aoAtivar(tx, lote);
    this.lotes.aoAtivar(RECURSO_DO_LOTE, reacao, 'LoteDaSemanaService');
  }

  // ------------------------------------------------------------------ leitura

  private async episodio(orgId: string, episodioId: string, db: PrismaService | Prisma.TransactionClient = this.prisma) {
    const e = await db.pautaEpisodio.findFirst({
      where: { id: episodioId, orgId },
      select: { id: true, numero: true, status: true, rodadaId: true, bioPage: { select: { publicada: true } } },
    });
    if (!e) throw new NotFoundException('Episódio não encontrado.');
    return e;
  }

  private async pecasDoEpisodio(
    orgId: string,
    e: { id: string; rodadaId: string },
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<LinhaDaPeca[]> {
    const pecas = (await db.pautaPeca.findMany({
      where: { orgId, rodadaId: e.rodadaId, canal: 'instagram', formato: { in: [...PAUTA_FORMATOS_DA_SEMANA] } },
      orderBy: { criadaEm: 'asc' },
      select: DA_PECA,
    })) as LinhaDaPeca[];
    return pecas
      .filter((p) => ehPecaDaSemana(p.meta, e.id))
      .sort((a, b) => (slotDaPeca(a)?.getTime() ?? Infinity) - (slotDaPeca(b)?.getTime() ?? Infinity));
  }

  /**
   * Quem já ocupa o horário: outra peça aprovada ou publicada do MESMO formato
   * no mesmo minuto — a regra do reagendar (MC16).
   */
  private async ocupados(
    orgId: string,
    slots: Date[],
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<(formato: string, slot: Date, pecaId: string) => boolean> {
    if (!slots.length) return () => false;
    const outras = await db.pautaPeca.findMany({
      where: { orgId, canal: 'instagram', status: { in: ['aprovada', 'publicada'] }, agendadaPara: { in: slots } },
      select: { id: true, formato: true, agendadaPara: true },
    });
    return (formato, slot, pecaId) =>
      outras.some((o) => o.id !== pecaId && o.formato === formato && o.agendadaPara?.getTime() === slot.getTime());
  }

  /** `GET /pauta/episodios/:id/semana/aprovacao`: o que a aba Semana mostra ao lado do botão. */
  async estado(orgId: string, episodioId: string, userId: string): Promise<PautaAprovacaoDaSemana> {
    const e = await this.episodio(orgId, episodioId);
    const conta = await contaDePublicacao(this.prisma, orgId);
    const pecas = (await this.pecasDoEpisodio(orgId, e)).filter((p) => entraNaAprovacao(p.status) || p.status === 'publicada');
    const agora = new Date();
    const vivos = await this.lotes.itensVivos(orgId, CAPACIDADE_DO_ITEM, pecas.map((p) => p.id), agora);
    const publicacoes = await publicacoesParaATela(this.prisma, orgId, pecas.map((p) => p.id), agora);
    const emJogo = await publicacoesEmJogo(this.prisma, orgId, pecas.map((p) => p.id), agora);
    // As que entrariam num lote novo agora: a mesma lista que o `preparar` confere.
    const candidatas = pecas.filter((p) => entraNaAprovacao(p.status) && vivos.get(p.id)?.estadoDoLote !== 'ativo');
    const ocupado = ocupadoComAsCandidatas(await this.ocupados(orgId, pecas.map(slotDaPeca).filter((d): d is Date => !!d)), candidatas);
    const impedimentos = impedimentosDaSemana({ status: e.status, paginaNoAr: !!e.bioPage?.publicada, conta });

    const lista: PautaPecaParaAprovar[] = pecas.map((p) => {
      const m = lerMetaDaSemana(p.meta);
      const vivo = vivos.get(p.id) ?? null;
      const slot = slotDaPeca(p);
      // A peça de lote ASSINADO já está resolvida; a de lote só montado, ou na
      // fila, é conferida de novo: o slot pode ter passado enquanto a assinatura esperava.
      const problema =
        p.status === 'publicada'
          ? 'Já publicada.'
          : vivo?.estadoDoLote === 'ativo' || !conta
            ? null
            : (problemaDaPublicacao(emJogo.get(p.id) ?? null) ?? problemaDaPeca(p, conta, agora, ocupado));
      return {
        id: p.id,
        formato: p.formato as PautaFormatoDaSemana,
        itemN: m.itemN,
        titulo: p.titulo,
        status: p.status,
        slot: slot?.toISOString() ?? null,
        problema,
        noLote: vivo ? { loteId: vivo.loteId, estadoDoLote: vivo.estadoDoLote } : null,
        etapa: etapaDaPecaNaSemana({
          status: p.status,
          agendadaPara: p.agendadaPara?.toISOString() ?? null,
          slotProposto: p.slotProposto?.toISOString() ?? null,
          publicacao: publicacoes.get(p.id) ?? null,
          lote: vivo,
        }),
      };
    });

    const lotes = await this.lotes.lotesEmCurso(orgId, CAPACIDADE_DO_LOTE, RECURSO_DO_LOTE, e.id, agora);
    const youtube = await this.itensDoYoutube(orgId, e.id, agora);
    return {
      youtube: youtube.tela,
      episodioId: e.id,
      apelido: apelidoDoEpisodio(e.numero),
      status: e.status,
      automaticaLigada: await this.publicacao.automaticaLigada(orgId),
      impedimentos,
      pecas: lista,
      lotes: lotes.map((l) => ({
        id: l.id,
        estado: l.estado,
        validaAte: l.validaAte.toISOString(),
        hashCurto: l.hashConteudo.slice(0, 12),
        approvalId: l.approvalId,
        aprovadoEm: l.aprovadoEm?.toISOString() ?? null,
        itens: l.itens,
        ativos: l.ativos,
        montadoPorMim: l.propostoPorId === userId,
      })),
    };
  }

  // ------------------------------------------------------------------ o YouTube no lote (MD10)

  /**
   * Os itens do YouTube que entram no próximo lote deste episódio: o envio
   * privado (até 1 h antes do horário) e o agendamento (até 15 min antes), com
   * os argumentos do pacote de agora. Só o envio no modo teste; só o
   * agendamento quando o vídeo já está no YouTube; nada com a auditoria
   * pendente, com alguma falta, ou com os itens já num lote ativo.
   *
   * O item ATIVO cujo pacote mudou depois da assinatura (outro título marcado,
   * o pacote gerado de novo, a nota da categoria) não segura o vídeo: a tela o
   * oferece de novo, e a montagem (`revogarDivergentes`) o revoga antes de
   * montar o lote novo.
   */
  private async itensDoYoutube(
    orgId: string,
    episodioId: string,
    agora: Date,
    revogarDivergentes: { actorId: string } | null = null,
  ): Promise<{ itens: ItemParaMontar[]; resumo: string; tela: PautaYoutubeNoLote }> {
    const automatica = this.youtube ? await this.youtube.publicacaoAutomatica(orgId) : false;
    const fora = (faltas: string[], extra: Partial<PautaYoutubeNoLote> = {}) => ({
      itens: [] as ItemParaMontar[],
      resumo: '',
      tela: { entra: false, faltas, publicarEm: null, capacidades: [], noLote: null, automatica, ...extra },
    });
    if (!this.youtube) return fora(['O YouTube não está ligado nesta instância da API.']);
    const { episodio: e, envio, publicacao } = await this.youtube.argsAtuais(orgId, episodioId);
    const publicarEm = e.publicarNoYoutubeEm?.toISOString() ?? null;
    const r = e.envioAoYoutube;
    const subiu = r?.estado === 'conferido' || (r?.estado === 'erro' && !!r.conferidoEm);
    const vivos: Array<{ capabilityId: string; v: ItemVivo }> = [];
    for (const cap of [CAPACIDADE_DE_PUBLICAR, CAPACIDADE_DE_ENVIAR]) {
      const v = (await this.lotes.itensVivos(orgId, cap, [e.id], agora)).get(e.id);
      if (v) vivos.push({ capabilityId: cap, v });
    }
    // O item de envio do vídeo que já subiu não tem mais o que fazer (o lote do modo teste só tinha ele): não segura o vídeo.
    const seguram = vivos.filter((y) => y.v.estadoDoLote === 'ativo' && !(subiu && y.capabilityId === CAPACIDADE_DE_ENVIAR));
    let divergente = false;
    for (const x of seguram) {
      if ((await this.divergenciaDoYoutube(orgId, { capabilityId: x.capabilityId, recursoId: e.id, hashItem: x.v.hashItem })).divergente) divergente = true;
    }
    const vivo = seguram[0]?.v ?? vivos.find((y) => y.v.estadoDoLote !== 'ativo')?.v ?? null;
    const noLote = vivo ? { loteId: vivo.loteId, estadoDoLote: vivo.estadoDoLote } : null;
    if (seguram.length && !divergente) return fora([], { publicarEm, noLote });
    if (divergente && revogarDivergentes) {
      for (const cap of [CAPACIDADE_DE_ENVIAR, CAPACIDADE_DE_PUBLICAR]) {
        await this.lotes.revogarItensDoRecurso(orgId, cap, e.id, 'o pacote do vídeo mudou depois da assinatura', revogarDivergentes.actorId);
      }
    }
    const faltas = await this.youtube.faltas(orgId, e, agora);
    if (faltas.length) return fora(faltas, { publicarEm, noLote });
    const caps = capacidadesDoLote(youtubeAuditoria(process.env.YOUTUBE_AUDITORIA)).filter((c) => !(subiu && c === CAPACIDADE_DE_ENVIAR));
    if (!caps.length || 'problema' in envio || 'problema' in publicacao) {
      return fora(
        [
          r?.enviadoEmTeste
            ? 'O vídeo já subiu ao canal de teste e fica privado para sempre: com a auditoria aprovada, declare o vídeo final de novo para o canal real.'
            : 'O vídeo já está no YouTube e a publicação espera a auditoria (YOUTUBE_AUDITORIA=aprovada).',
        ],
        { publicarEm, noLote },
      );
    }
    const j = janelasDoYoutube(e.publicarNoYoutubeEm!, agora);
    const itens: ItemParaMontar[] = [];
    if (caps.includes(CAPACIDADE_DE_ENVIAR)) {
      itens.push({ capabilityId: CAPACIDADE_DE_ENVIAR, recursoId: e.id, args: envio.args as unknown as Record<string, unknown>, ...j.envio, usoMaximo: YOUTUBE_USOS_DO_ENVIO });
    }
    if (caps.includes(CAPACIDADE_DE_PUBLICAR)) {
      itens.push({ capabilityId: CAPACIDADE_DE_PUBLICAR, recursoId: e.id, args: publicacao.args as unknown as Record<string, unknown>, ...j.publicacao, usoMaximo: YOUTUBE_USOS_DA_PUBLICACAO });
    }
    const oQue =
      caps.length === 2 ? 'envio privado e agendamento' : caps.includes(CAPACIDADE_DE_ENVIAR) ? 'só o envio privado, ao canal de teste' : 'o agendamento do vídeo que já subiu';
    return {
      itens,
      resumo: `o vídeo no YouTube (${oQue}) para ${quando(e.publicarNoYoutubeEm!)}`,
      tela: { entra: true, faltas: [], publicarEm, capacidades: caps, noLote, automatica },
    };
  }

  /** Por que o item do YouTube não bate mais com o pacote de agora, ou nulo. */
  private async divergenciaDoYoutube(
    orgId: string,
    item: { capabilityId: string; recursoId: string; hashItem: string },
    db?: Prisma.TransactionClient,
  ): Promise<{ divergente: string | null; args: Record<string, unknown> | null }> {
    if (!this.youtube) return { divergente: 'O YouTube não está ligado nesta instância da API.', args: null };
    let atual;
    try {
      atual = await this.youtube.argsAtuais(orgId, item.recursoId, db);
    } catch {
      return { divergente: 'O episódio não existe mais.', args: null };
    }
    const x = item.capabilityId === CAPACIDADE_DE_PUBLICAR ? atual.publicacao : atual.envio;
    if ('problema' in x) return { divergente: `O vídeo não sai mais como está: ${x.problema}`, args: null };
    const args = x.args as unknown as Record<string, unknown>;
    const hashAgora = this.lotes.hashDoItem(orgId, item.capabilityId, args);
    return {
      divergente: hashAgora === item.hashItem ? null : 'O pacote do vídeo mudou depois de o lote ser montado (título, descrição, thumb, arquivo ou horário): este item não sai.',
      args,
    };
  }

  // ------------------------------------------------------------------ montar

  /**
   * "Aprovar a semana", o primeiro passo: monta o lote em `proposta`. Toda peça
   * da semana com slot entra, menos as marcadas "fica fora" e as que já estão
   * num lote ativo (a peça reagendada depois da assinatura entra num lote novo
   * de um item). Uma peça que não passa nas pré-condições barra a montagem com
   * o motivo dela: conserte ou deixe de fora — um lote nunca é assinado com um
   * item que a porta recusaria no horário. Também barra a peça cuja publicação
   * já está na Meta, publicada, ou com um "Publicar agora" vivo na fila, e a
   * segunda peça do mesmo formato no mesmo slot.
   *
   * O lote anterior deste episódio ainda sem assinatura (montado ou na fila) é
   * substituído: o hash muda e a aprovação antiga, se confirmada, não o ativa.
   * O que foi assinado no meio do caminho não é substituído (409).
   */
  async preparar(orgId: string, episodioId: string, actorId: string, fora: readonly string[]): Promise<PautaLoteMontado> {
    return umaPorVez(`pauta-lote-da-semana:${orgId}:${episodioId}`, 'A montagem do lote desta semana', async () => {
      const e = await this.episodio(orgId, episodioId);
      const conta = await contaDePublicacao(this.prisma, orgId);
      const impedimentos = impedimentosDaSemana({ status: e.status, paginaNoAr: !!e.bioPage?.publicada, conta });
      if (impedimentos.length) throw new BadRequestException(impedimentos.join(' '));

      const agora = new Date();
      const todas = await this.pecasDoEpisodio(orgId, e);
      const pecas = todas.filter((p) => entraNaAprovacao(p.status));
      const desconhecidas = fora.filter((id) => id !== PAUTA_FORA_DO_LOTE_YOUTUBE && !todas.some((p) => p.id === id));
      if (desconhecidas.length) throw new BadRequestException(`"Fica fora" com peça que não é desta semana: ${desconhecidas.join(', ')}.`);

      const vivos = await this.lotes.itensVivos(orgId, CAPACIDADE_DO_ITEM, pecas.map((p) => p.id), agora);
      const candidatas = pecas.filter((p) => !fora.includes(p.id) && vivos.get(p.id)?.estadoDoLote !== 'ativo');
      const youtube = fora.includes(PAUTA_FORA_DO_LOTE_YOUTUBE) ? { itens: [] as ItemParaMontar[], resumo: '' } : await this.itensDoYoutube(orgId, e.id, agora, { actorId });
      if (!candidatas.length && !youtube.itens.length) {
        throw new BadRequestException('Não há peça para aprovar: todas estão fora, sem rascunho ou aprovada, ou já no lote assinado.');
      }
      const ocupado = ocupadoComAsCandidatas(await this.ocupados(orgId, candidatas.map(slotDaPeca).filter((d): d is Date => !!d)), candidatas);
      const emJogo = await publicacoesEmJogo(this.prisma, orgId, candidatas.map((p) => p.id), agora);
      const rotulo = (p: LinhaDaPeca) =>
        `${PAUTA_FORMATO_DA_SEMANA_ROTULO[p.formato as PautaFormatoDaSemana] ?? p.formato} da matéria ${lerMetaDaSemana(p.meta).itemN}`;
      const problemas = candidatas
        .map((p) => ({
          p,
          problema: problemaDaPublicacao(emJogo.get(p.id) ?? null) ?? problemaDaPeca(p, conta as ContaParaPublicar, agora, ocupado),
        }))
        .filter((x) => x.problema);
      if (problemas.length) {
        throw new BadRequestException(
          `${problemas.map((x) => `${rotulo(x.p)}: ${x.problema}`).join(' · ')} — conserte ou marque "fica fora".`,
        );
      }

      const posts: ItemParaMontar[] = candidatas.map((p) => {
        const slot = slotDaPeca(p)!;
        return { capabilityId: CAPACIDADE_DO_ITEM, recursoId: p.id, args: argsDoItem(p, conta!) as unknown as Record<string, unknown>, ...janelaDoItem(slot) };
      });
      const itens = [...posts, ...youtube.itens];
      const validaAte = validadeDoLote(itens.map((i) => i.janelaAte));
      const slots = posts.map((i) => i.janelaDe.getTime());
      const apelido = apelidoDoEpisodio(e.numero);
      const resumo = [
        posts.length
          ? `Semana de ${apelido}: ${posts.length} post(s) no @${conta!.handle}, de ${quando(new Date(Math.min(...slots)))} a ${quando(new Date(Math.max(...slots)))} (São Paulo)`
          : `Semana de ${apelido}`,
        youtube.resumo,
      ]
        .filter(Boolean)
        .join('; ');

      const antigos = (await this.lotes.lotesEmCurso(orgId, CAPACIDADE_DO_LOTE, RECURSO_DO_LOTE, e.id, agora)).filter((l) => l.estado !== 'ativo');
      const m = await this.lotes.montar({
        orgId,
        capabilityId: CAPACIDADE_DO_LOTE,
        recursoTipo: RECURSO_DO_LOTE,
        recursoId: e.id,
        propostoPorId: actorId,
        validaAte,
        itens,
        resumo,
        agora,
      });
      /*
       * Só o que ainda NÃO foi assinado é substituído. Se a titular assinou o
       * lote antigo entre a leitura e aqui, a assinatura dela vale e o lote
       * novo, que ninguém assinou, é que cai.
       */
      for (const l of antigos) {
        const r = await this.lotes.revogarLote(orgId, l.id, `substituído pelo lote ${m.loteId.slice(0, 8)}, montado depois`, actorId, ['proposta', 'aguardando']);
        if (r.estado !== 'revogado') {
          await this.lotes.revogarLote(orgId, m.loteId, `o lote ${l.id.slice(0, 8)} foi assinado enquanto este era montado`, actorId, ['proposta']);
          throw new ConflictException('A semana foi assinada enquanto este lote era montado: recarregue a aba Semana. Nada foi substituído.');
        }
      }
      await this.audit.log({
        orgId,
        actorId,
        action: 'pauta.semana_lote_montado',
        entityType: 'pauta_episodio',
        entityId: e.id,
        after: {
          loteId: m.loteId,
          itens: itens.length,
          ...(youtube.itens.length ? { youtube: youtube.itens.map((i) => i.capabilityId) } : {}),
          fora: [...fora],
          hashConteudo: m.hashConteudo.slice(0, 12),
          validaAte: m.validaAte,
          ...(antigos.length ? { substituidos: antigos.map((l) => l.id) } : {}),
        },
      });
      return { loteId: m.loteId, hashConteudo: m.hashConteudo, validaAte: m.validaAte, itens: itens.length, fora: [...fora], substituidos: antigos.map((l) => l.id) };
    });
  }

  /**
   * "Cancelar a semana": revoga o lote inteiro. R1 e sem assinatura, porque só
   * diminui o alcance — nada sai por ele depois disso. O que já foi publicado
   * fica; as peças aprovadas continuam na agenda, no fluxo manual (MC16).
   */
  async cancelar(orgId: string, loteId: string, actorId: string): Promise<DetalheDoLote> {
    const l = await this.lotes.detalhe(orgId, loteId);
    if (l.capabilityId !== CAPACIDADE_DO_LOTE || l.recursoTipo !== RECURSO_DO_LOTE) throw new NotFoundException('Lote da semana não encontrado.');
    const r = await this.lotes.revogarLote(orgId, loteId, 'semana cancelada na aba Semana', actorId);
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.semana_cancelada',
      entityType: 'pauta_episodio',
      entityId: l.recursoId,
      before: { loteId, estado: l.estado },
      after: { loteId, estado: r.estado },
    });
    return r;
  }

  // ------------------------------------------------------------------ o que a titular lê

  /**
   * O conteúdo de cada item, lido da peça de AGORA, com o hash recalculado: a
   * titular não assina um hash sem ver o que ele cobre, e o item cuja peça
   * mudou depois de montado vem marcado (ele não sai). Leitura só.
   */
  async conteudo(orgId: string, loteId: string): Promise<PautaConteudoDoLote> {
    const l = await this.lotes.detalhe(orgId, loteId);
    if (l.capabilityId !== CAPACIDADE_DO_LOTE || l.recursoTipo !== RECURSO_DO_LOTE) throw new NotFoundException('Lote da semana não encontrado.');
    const conta = await contaDePublicacao(this.prisma, orgId);
    const e = await this.prisma.pautaEpisodio.findFirst({ where: { id: l.recursoId, orgId }, select: { numero: true } });
    const apelido = e ? apelidoDoEpisodio(e.numero) : 'ep-??';
    const itensDoItem = l.itens.filter((i) => i.capabilityId === CAPACIDADE_DO_ITEM);
    const pecas = (await this.prisma.pautaPeca.findMany({
      where: { orgId, id: { in: itensDoItem.map((i) => i.recursoId) } },
      select: DA_PECA,
    })) as LinhaDaPeca[];
    const porId = new Map(pecas.map((p) => [p.id, p]));

    const itens = itensDoItem.map((i) => {
      const p = porId.get(i.recursoId) ?? null;
      const m = p ? lerMetaDaSemana(p.meta) : null;
      let hashAgora: string | null = null;
      let erroAoMontar: string | null = null;
      if (p && conta) {
        try {
          hashAgora = this.lotes.hashDoItem(orgId, CAPACIDADE_DO_ITEM, argsDoItem(p, conta) as unknown as Record<string, unknown>);
        } catch (err) {
          erroAoMontar = (err as Error).message;
        }
      } else if (p) {
        erroAoMontar = 'a empresa está sem conta de publicação.';
      }
      const divergente =
        i.estado !== 'ativo'
          ? null
          : divergenciaDoItem({ estadoDaPeca: (p?.status ?? null) as PautaPecaStatus | null, hashAgora, hashItem: i.hashItem, erroAoMontar });
      const jpegs = (m?.imagens ?? []).filter((x) => (x as { tipo?: string }).tipo === 'jpeg').map((x) => x.n).sort((a, b) => a - b);
      const midia: PautaConteudoDoLote['itens'][number]['midia'] =
        p?.formato === 'corte'
          ? m?.video?.chave
            ? { tipo: 'video', bytes: (m.video as { bytes?: number }).bytes ?? null, duracaoSeg: (m.video as { duracaoSeg?: number }).duracaoSeg ?? null }
            : { tipo: 'nenhuma' }
          : jpegs.length
            ? { tipo: 'imagens', n: jpegs }
            : { tipo: 'nenhuma' };
      return {
        itemId: i.id,
        pecaId: i.recursoId,
        formato: p?.formato ?? '?',
        titulo: p?.titulo ?? '(peça apagada)',
        apelido,
        itemN: m?.itemN ?? 0,
        legenda: p ? legendaDoPedido(p.corpo) : '',
        midia,
        agendadaPara: i.janelaDe,
        janelaAte: i.janelaAte,
        handle: conta?.handle ?? null,
        estadoDoItem: i.estado,
        hashCurto: i.hashItem.slice(0, 12),
        divergente,
      };
    });
    const youtube: PautaItemDoYoutubeNoLote[] = [];
    for (const i of l.itens.filter((x) => x.capabilityId === CAPACIDADE_DE_ENVIAR || x.capabilityId === CAPACIDADE_DE_PUBLICAR)) {
      const d = await this.divergenciaDoYoutube(orgId, i);
      const a = (d.args ?? {}) as { titulo?: string; descricao?: string; categoria?: string; thumbN?: number; sha256?: string; bytes?: number; publicarEm?: string };
      youtube.push({
        itemId: i.id,
        capabilityId: i.capabilityId,
        episodioId: i.recursoId,
        titulo: a.titulo ?? '(o pacote não sai como está)',
        descricao: a.descricao ?? '',
        bytesDaDescricao: bytesUtf8(a.descricao ?? ''),
        categoria: a.categoria ?? '',
        thumbN: a.thumbN ?? null,
        arquivo: { sha256Curto: (a.sha256 ?? '').slice(0, 12), bytes: a.bytes ?? 0 },
        publicarEm: i.capabilityId === CAPACIDADE_DE_PUBLICAR ? (a.publicarEm ?? null) : null,
        janelaAte: i.janelaAte,
        estadoDoItem: i.estado,
        hashCurto: i.hashItem.slice(0, 12),
        divergente: i.estado === 'ativo' ? d.divergente : null,
      });
    }
    return {
      loteId: l.id,
      estado: l.estado,
      hashCurto: l.hashConteudo.slice(0, 12),
      validaAte: l.validaAte,
      total: l.itens.length,
      divergentes: itens.filter((i) => i.divergente).length + youtube.filter((i) => i.divergente).length,
      handle: conta?.handle ?? null,
      itens,
      youtube,
    };
  }

  // ------------------------------------------------------------------ a ativação

  /**
   * A reação à assinatura, na MESMA transação que liga o lote (MD8 item 4).
   * Sob os cadeados da agenda da empresa e da semana do episódio — os mesmos
   * do reagendar e da edição —, cada peça é relida e o hash dela recalculado
   * como aprovada no slot: bate com o assinado → `aprovada`, `agendadaPara` =
   * slot, proposto limpo, numa escrita condicionada ao estado lido; não bate
   * (editada depois de montado, a conta mudou, o horário foi ocupado, a
   * publicação já está na Meta) → o item volta para ser revogado, e a peça fica
   * como está. A publicação que a peça já tinha em `erro`, `recusada` ou com o
   * pedido morto volta a `pendente`, para o executor tomá-la no horário. O
   * episódio vai a Agendado (D-MC11) se estava na Derivação e ao menos uma peça
   * foi aprovada. Os itens chegam relidos dentro da transação (`LotesService.ativar`).
   */
  async aoAtivar(tx: Prisma.TransactionClient, lote: LoteQueAtivou): Promise<{ revogar: Array<{ itemId: string; motivo: string }>; resumo: Record<string, unknown> }> {
    if (lote.capabilityId !== CAPACIDADE_DO_LOTE) return { revogar: [], resumo: {} };
    const orgId = lote.orgId;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pauta-agenda:${orgId}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pauta-semana:${lote.recursoId}`}))`;

    const conta = await contaDePublicacao(tx, orgId);
    const itens = lote.itens.filter((i) => i.estado === 'ativo' && i.capabilityId === CAPACIDADE_DO_ITEM);
    const pecas = (await tx.pautaPeca.findMany({ where: { orgId, id: { in: itens.map((i) => i.recursoId) } }, select: DA_PECA })) as LinhaDaPeca[];
    const porId = new Map(pecas.map((p) => [p.id, p]));
    const jaOcupado = await this.ocupados(orgId, pecas.map(slotDaPeca).filter((d): d is Date => !!d), tx);
    // As aprovadas nesta ativação também ocupam: duas do mesmo formato no mesmo minuto, só a primeira.
    const agendadasAgora: Array<{ formato: string; slot: number }> = [];
    const ocupado = (formato: string, slot: Date, pecaId: string) =>
      jaOcupado(formato, slot, pecaId) || agendadasAgora.some((x) => x.formato === formato && x.slot === slot.getTime());
    const emJogo = await publicacoesEmJogo(tx, orgId, pecas.map((p) => p.id));

    const revogar: Array<{ itemId: string; motivo: string }> = [];
    const aprovadas: string[] = [];
    let reabertas = 0;
    for (const i of itens) {
      const p = porId.get(i.recursoId) ?? null;
      let hashAgora: string | null = null;
      let erroAoMontar: string | null = null;
      if (p && conta) {
        try {
          hashAgora = this.lotes.hashDoItem(orgId, CAPACIDADE_DO_ITEM, argsDoItem(p, conta) as unknown as Record<string, unknown>);
        } catch (e) {
          erroAoMontar = (e as Error).message;
        }
      } else if (p) {
        erroAoMontar = 'a empresa está sem conta de publicação.';
      }
      const divergente = divergenciaDoItem({ estadoDaPeca: (p?.status ?? null) as PautaPecaStatus | null, hashAgora, hashItem: i.hashItem, erroAoMontar });
      if (divergente || !p) {
        revogar.push({ itemId: i.id, motivo: divergente ?? 'A peça não existe mais.' });
        continue;
      }
      const slot = slotDaPeca(p)!;
      if (ocupado(p.formato, slot, p.id)) {
        revogar.push({ itemId: i.id, motivo: 'Outra peça do mesmo formato ocupou o horário antes da assinatura.' });
        continue;
      }
      const pub = emJogo.get(p.id) ?? null;
      const naMeta = problemaDaPublicacao(pub ? { ...pub, pedidoVivo: false } : null);
      if (naMeta) {
        revogar.push({ itemId: i.id, motivo: naMeta });
        continue;
      }
      const u = await tx.pautaPeca.updateMany({
        where: { id: p.id, orgId, status: p.status, agendadaPara: p.agendadaPara, slotProposto: p.slotProposto },
        data: { status: 'aprovada', agendadaPara: slot, slotProposto: null },
      });
      if (u.count !== 1) {
        revogar.push({ itemId: i.id, motivo: 'A peça mudou enquanto a semana era ativada.' });
        continue;
      }
      // A linha em erro, recusada ou com o pedido morto volta a `pendente` sem
      // pedido: é de onde o executor a toma no horário. Os containers ficam —
      // o efeito ainda pergunta à Meta se um publish sem resposta saiu.
      if (pub && reabreNaAtivacao(pub)) {
        const r = await tx.pautaPublicacao.updateMany({
          where: { orgId, pecaId: p.id, rede: 'instagram', estado: pub.estado, approvalId: pub.approvalId },
          data: { estado: 'pendente', approvalId: null, erro: null, proximaEm: null, loteItemId: null },
        });
        reabertas += r.count;
      }
      agendadasAgora.push({ formato: p.formato, slot: slot.getTime() });
      aprovadas.push(p.id);
    }

    // O YouTube (MD10): o item cujo pacote mudou depois de montado não vale.
    for (const i of lote.itens.filter((x) => x.estado === 'ativo' && (x.capabilityId === CAPACIDADE_DE_ENVIAR || x.capabilityId === CAPACIDADE_DE_PUBLICAR))) {
      const d = await this.divergenciaDoYoutube(orgId, i, tx);
      if (d.divergente) revogar.push({ itemId: i.id, motivo: d.divergente });
    }

    // Sem peça aprovada, o episódio fica onde está: Agendado sem post agendado travaria o "gerar de novo".
    const ep = aprovadas.length
      ? await tx.pautaEpisodio.updateMany({ where: { id: lote.recursoId, orgId, status: 'derivacao' }, data: { status: 'agendado' } })
      : { count: 0 };
    if (revogar.length) this.log.warn(`lote ${lote.id}: ${revogar.length} item(ns) revogado(s) na ativação`);
    return {
      revogar,
      resumo: { pecasAprovadas: aprovadas.length, episodioAgendado: ep.count === 1, ...(reabertas ? { publicacoesReabertas: reabertas } : {}) },
    };
  }
}
