import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ContextKind } from '@prisma/client';
import {
  chaveDaEstrategia,
  motivoParaNaoAprovarIdeia,
  transicaoDaIdeia,
  type PautaFormatoDaSemana,
  type PautaIdeiaNaLista,
  type PautaIdeiaSalvarInput,
  type PautaIdeiaStatus,
  type PautaIdeiasPainel,
  type PautaIdeiasProporInput,
  type PautaPilar,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MemoriaService } from '../memory/memoria.service';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';
import { SAIDA_DA_GERACAO_LONGA } from './saida-da-geracao';
import { MarcaService } from './marca.service';
import { ConcorrentesService } from './concorrentes.service';
import {
  IdeiasInvalidasError,
  SYSTEM_IDEIAS,
  entradaDasIdeias,
  lerIdeiasDaIa,
  metaDaPecaDeIdeia,
} from './ideias-da-pauta';
import { umaPorVez } from './uma-por-vez';

const DA_IDEIA = {
  id: true,
  pilar: true,
  titulo: true,
  ganchoFala: true,
  ganchoTela: true,
  roteiro: true,
  legenda: true,
  cta: true,
  porque: true,
  fontes: true,
  formato: true,
  prioridade: true,
  status: true,
  hist: true,
  pecaId: true,
  origem: true,
  criadaEm: true,
  atualizadaEm: true,
} as const;

/** O mês de hoje, em `AAAA-MM` (UTC, como a janela da estratégia). */
function mesDeHoje(agora = new Date()): string {
  return `${agora.getUTCFullYear()}-${String(agora.getUTCMonth() + 1).padStart(2, '0')}`;
}

/*
 * O BANCO DE IDEIAS (MK3).
 *
 * A IA propõe e gente aprova — a proposta nasce em `ideia`, nunca em
 * `aprovada`. Aprovar cria a `PautaPeca` SEM rodada (a ideia não vem de
 * curadoria) e já com status `aprovada`, que é o que a faz aparecer na Semana
 * esperando slot: quem aprovou a ideia aprovou a peça, e um segundo botão
 * dizendo a mesma coisa só ensinaria a clicar sem ler.
 */
@Injectable()
export class IdeiasService {
  private readonly log = new Logger('IdeiasService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly memoria: MemoriaService,
    private readonly marcas: MarcaService,
    private readonly concorrentes: ConcorrentesService,
  ) {}

  private paraTela(i: Record<string, unknown>): PautaIdeiaNaLista {
    return {
      id: String(i.id),
      pilar: String(i.pilar),
      titulo: String(i.titulo),
      ganchoFala: String(i.ganchoFala ?? ''),
      ganchoTela: String(i.ganchoTela ?? ''),
      roteiro: String(i.roteiro ?? ''),
      legenda: String(i.legenda ?? ''),
      cta: String(i.cta ?? ''),
      porque: String(i.porque ?? ''),
      fontes: Array.isArray(i.fontes) ? (i.fontes as PautaIdeiaNaLista['fontes']) : [],
      formato: String(i.formato),
      prioridade: i.prioridade as PautaIdeiaNaLista['prioridade'],
      status: i.status as PautaIdeiaStatus,
      hist: Array.isArray(i.hist) ? (i.hist as PautaIdeiaNaLista['hist']) : [],
      pecaId: (i.pecaId as string | null) ?? null,
      origem: String(i.origem ?? 'operador'),
      criadaEm: new Date(i.criadaEm as Date).toISOString(),
      atualizadaEm: new Date(i.atualizadaEm as Date).toISOString(),
    };
  }

  async painel(orgId: string): Promise<PautaIdeiasPainel> {
    const [linhas, pilares] = await Promise.all([
      this.prisma.pautaIdeia.findMany({
        where: { orgId },
        select: DA_IDEIA,
        orderBy: [{ status: 'asc' }, { atualizadaEm: 'desc' }],
        take: 400,
      }),
      this.marcas.pilares(orgId),
    ]);
    const ideias = linhas.map((l) => this.paraTela(l as unknown as Record<string, unknown>));
    const avisos: string[] = [];
    if (!pilares.length) {
      avisos.push('Sem pilar cadastrado: escreva os pilares na tela de Marca antes de abrir o banco.');
    } else {
      // Ideia cujo pilar saiu da nota: a tela mostra a chave crua e alguém
      // decide. Apagar a ideia seria perder trabalho por causa de um rename.
      const conhecidos = new Set(pilares.map((p) => p.nome.toLowerCase()));
      const orfas = [...new Set(ideias.map((i) => i.pilar).filter((p) => !conhecidos.has(p.toLowerCase())))];
      if (orfas.length) avisos.push(`Ideias em pilar que não está mais na lista: ${orfas.join(', ')}.`);
    }
    return { ideias, pilares, avisos, iaConfigurada: this.llm.configured };
  }

  async criar(orgId: string, actorId: string, entrada: PautaIdeiaSalvarInput): Promise<PautaIdeiaNaLista> {
    const criada = await this.prisma.pautaIdeia.create({
      data: { orgId, ...entrada, fontes: entrada.fontes, criadaPor: actorId, origem: 'operador' },
      select: DA_IDEIA,
    });
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.ideia_criada',
      entityType: 'pauta_ideia',
      entityId: criada.id,
      after: { pilar: entrada.pilar, formato: entrada.formato },
    });
    return this.paraTela(criada as unknown as Record<string, unknown>);
  }

  async salvar(
    orgId: string,
    actorId: string,
    id: string,
    entrada: PautaIdeiaSalvarInput,
  ): Promise<PautaIdeiaNaLista> {
    const atual = await this.prisma.pautaIdeia.findFirst({ where: { id, orgId }, select: { status: true } });
    if (!atual) throw new NotFoundException('Ideia não encontrada');
    if (atual.status === 'aprovada') {
      // Editar depois de virar peça mudaria a ideia sem mudar o que vai ao ar:
      // a peça é a verdade dali em diante, e ela se edita na Semana.
      throw new ConflictException('Esta ideia já virou peça — edite a peça na aba Semana.');
    }
    const salva = await this.prisma.pautaIdeia.update({
      where: { id },
      data: { ...entrada, fontes: entrada.fontes },
      select: DA_IDEIA,
    });
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.ideia_salva',
      entityType: 'pauta_ideia',
      entityId: id,
      after: { pilar: entrada.pilar, formato: entrada.formato },
    });
    return this.paraTela(salva as unknown as Record<string, unknown>);
  }

  /**
   * A troca de status. `aprovada` é a única que cria coisa: a peça da semana.
   * As escritas vão numa transação e são CONDICIONADAS ao status lido — dois
   * cliques ao mesmo tempo não criam duas peças para a mesma ideia.
   */
  async mudarStatus(
    orgId: string,
    actorId: string,
    id: string,
    para: PautaIdeiaStatus,
  ): Promise<PautaIdeiaNaLista> {
    const ideia = await this.prisma.pautaIdeia.findFirst({ where: { id, orgId }, select: DA_IDEIA });
    if (!ideia) throw new NotFoundException('Ideia não encontrada');
    const de = ideia.status as PautaIdeiaStatus;
    if (de === para) return this.paraTela(ideia as unknown as Record<string, unknown>);
    if (!transicaoDaIdeia(de, para)) {
      throw new BadRequestException(`Uma ideia em "${de}" não vai direto para "${para}".`);
    }

    const agora = new Date().toISOString();
    const hist = [...(Array.isArray(ideia.hist) ? ideia.hist : []), { em: agora, de, para, por: actorId }];

    if (para !== 'aprovada') {
      const r = await this.prisma.pautaIdeia.updateMany({
        where: { id, orgId, status: de },
        data: { status: para, hist },
      });
      if (!r.count) throw new ConflictException('A ideia mudou enquanto você decidia — recarregue.');
      await this.audit.log({
        orgId,
        actorId,
        action: 'pauta.ideia_status',
        entityType: 'pauta_ideia',
        entityId: id,
        before: { status: de },
        after: { status: para },
      });
      return this.porId(orgId, id);
    }

    const motivo = motivoParaNaoAprovarIdeia({
      status: de,
      titulo: ideia.titulo,
      legenda: ideia.legenda,
      formato: ideia.formato,
    });
    if (motivo) throw new BadRequestException(motivo);

    const pecaId = await this.prisma.$transaction(async (tx) => {
      const peca = await tx.pautaPeca.create({
        data: {
          orgId,
          // SEM RODADA: a ideia não veio de curadoria. É o `rodadaId` opcional
          // da MK3, e é o que mantém a peça fora das varreduras de episódio.
          rodadaId: null,
          canal: 'instagram',
          formato: ideia.formato,
          titulo: ideia.titulo.slice(0, 200),
          corpo: ideia.legenda,
          meta: metaDaPecaDeIdeia({ id: ideia.id, pilar: ideia.pilar, formato: ideia.formato, cta: ideia.cta }),
          // `aprovada` e sem data: é assim que ela aparece na Semana esperando
          // slot. Quem aprovou a ideia aprovou a peça.
          status: 'aprovada',
        },
        select: { id: true },
      });
      const r = await tx.pautaIdeia.updateMany({
        where: { id, orgId, status: de },
        data: { status: 'aprovada', hist, pecaId: peca.id },
      });
      if (!r.count) throw new ConflictException('A ideia mudou enquanto você decidia — recarregue.');
      return peca.id;
    });

    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.ideia_aprovada',
      entityType: 'pauta_ideia',
      entityId: id,
      before: { status: de },
      after: { status: 'aprovada', pecaId, formato: ideia.formato },
    });
    return this.porId(orgId, id);
  }

  private async porId(orgId: string, id: string): Promise<PautaIdeiaNaLista> {
    const i = await this.prisma.pautaIdeia.findFirst({ where: { id, orgId }, select: DA_IDEIA });
    if (!i) throw new NotFoundException('Ideia não encontrada');
    return this.paraTela(i as unknown as Record<string, unknown>);
  }

  propor(orgId: string, actorId: string, entrada: PautaIdeiasProporInput): Promise<PautaIdeiaNaLista[]> {
    return umaPorVez(`pauta-ideias:${orgId}`, 'A proposta de ideias', () => this.proporAgora(orgId, actorId, entrada));
  }

  private async proporAgora(
    orgId: string,
    actorId: string,
    entrada: PautaIdeiasProporInput,
  ): Promise<PautaIdeiaNaLista[]> {
    if (!this.llm.configured) {
      throw new ServiceUnavailableException(`IA não configurada: falta a credencial do provider "${this.llm.name}".`);
    }
    const pilares = await this.marcas.pilares(orgId);
    const pilar = pilares.find((p) => p.nome.toLowerCase() === entrada.pilar.toLowerCase());
    if (!pilar) {
      throw new BadRequestException(`"${entrada.pilar}" não está na lista de pilares da casa.`);
    }

    const [marca, estrategia, dossies, jaExistem] = await Promise.all([
      this.marcas.bloco(orgId),
      this.estrategiaDoMes(orgId),
      this.dossies(orgId),
      this.titulosDoPilar(orgId, pilar),
    ]);

    const saida = await this.llm.complete({
      system: SYSTEM_IDEIAS,
      user: entradaDasIdeias({
        pilar,
        formato: entrada.formato as PautaFormatoDaSemana,
        quantas: entrada.quantas,
        marca,
        estrategia,
        dossies,
        jaExistem,
      }),
      // De quem é o gasto (RF-G-05), como nas outras chamadas da pauta.
      orgId,
      maxTokens: SAIDA_DA_GERACAO_LONGA,
    });

    let propostas: PautaIdeiaSalvarInput[];
    try {
      propostas = lerIdeiasDaIa(saida, pilar, entrada.formato as PautaFormatoDaSemana, entrada.quantas);
    } catch (err) {
      if (err instanceof IdeiasInvalidasError) {
        this.log.warn(`ideias de ${orgId}: ${err.message}`);
        throw new ServiceUnavailableException(err.message);
      }
      throw err;
    }

    const criadas = await this.prisma.$transaction(
      propostas.map((p) =>
        this.prisma.pautaIdeia.create({
          data: { orgId, ...p, fontes: p.fontes, criadaPor: actorId, origem: 'ia' },
          select: DA_IDEIA,
        }),
      ),
    );

    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.ideias_propostas',
      entityType: 'pauta_ideia',
      entityId: criadas[0]?.id ?? '',
      after: {
        pilar: pilar.nome,
        formato: entrada.formato,
        pedidas: entrada.quantas,
        criadas: criadas.length,
        provider: this.llm.name,
        model: this.llm.model,
      },
    });
    return criadas.map((c) => this.paraTela(c as unknown as Record<string, unknown>));
  }

  private async estrategiaDoMes(orgId: string): Promise<string> {
    try {
      const n = await this.memoria.porChave(orgId, chaveDaEstrategia(mesDeHoje()));
      return n && !n.arquivadoEm && n.kind === ContextKind.definicao ? n.body : '';
    } catch {
      return '';
    }
  }

  private async dossies(orgId: string) {
    const perfis = await this.concorrentes.listar(orgId);
    const lidos = await Promise.all(
      perfis.slice(0, 5).map(async (p) => {
        const d = await this.concorrentes.dossie(orgId, p.id);
        return d ? { handle: p.handle, oQueRende: d.oQueRende } : null;
      }),
    );
    return lidos.filter((d): d is NonNullable<typeof d> => Boolean(d));
  }

  /** Os títulos que já existem naquele pilar, para a IA não repetir. */
  private async titulosDoPilar(orgId: string, pilar: PautaPilar): Promise<string[]> {
    const linhas = await this.prisma.pautaIdeia.findMany({
      where: { orgId, pilar: pilar.nome, status: { not: 'descartada' } },
      select: { titulo: true },
      orderBy: { criadaEm: 'desc' },
      take: 60,
    });
    return linhas.map((l) => l.titulo);
  }
}
