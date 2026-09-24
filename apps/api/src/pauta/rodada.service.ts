import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PAUTA_HORAS_DA_CURADORIA, PAUTA_TETO_DE_CANDIDATOS, type PautaOrigem } from '@mktos/shared';
import { Prisma, PautaCanal, PautaRodadaStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ColetaService, type ResultadoDaColetaDaRodada } from './coleta.service';
import { parseJsonDaIa } from './parse-json';
import {
  comOrigem,
  filtroDasOrigens,
  lerOrigensDaRodada,
  insumoDaRodada,
  insumoDaRodadaComSobra,
  linhaDoInsumo,
  tiposDaColetaDasOrigens,
} from './origem-da-rodada';
import {
  RESUMO_NO_PROMPT_DE_SUGESTAO,
  SYSTEM_SUGESTAO,
  aplicarSugestoes,
  candidatoDaCaptura,
  corpoDaCuradoria,
  itensDaCuradoria,
  lerCandidatos,
  marcar,
  sobraPorOrigem,
  tituloDaSugestao,
  type Candidato,
  type SugestaoDaIa,
} from './curadoria-da-rodada';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';

// Uma rodada é a peça-mãe: coleta a janela, cura numa chamada só e vira N peças.
// Ver docs/PAUTA.md §7. O que a diferencia de "gerar um texto com IA" é o
// segundo insumo: as fichas CAMPEÃS do acervo entram no mesmo prompt, então o
// derivador recebe família, objetivo, fórmula de headline e anti-padrões
// validados — não "escreva um carrossel sobre X".

/** Quantos itens a curadoria recebe no prompt, somadas as origens. */
const TETO_DO_INSUMO = 60;

const SYSTEM_CURADORIA = `Você é o editor de conteúdo da ROOT, uma comunidade brasileira sobre IA aplicada a negócios.
Recebe uma lista de notícias coletadas na janela e escolhe o que vira pauta.
Cada item traz a origem: W grupo de WhatsApp, N busca/notícia, R feed RSS, C creator
(post de um perfil vigiado), L newsletter.

Responda SOMENTE com um objeto JSON válido, sem cercas de código:
{
  "titulo": string,           // nome da edição, até 80 caracteres
  "itens": [                  // de 3 a 5, os mais relevantes
    { "titulo": string, "url": string, "porque": string, "ganchoBr": string }
  ],
  "corpo": string             // o miolo curado em markdown, 200-350 palavras
}

Critérios de seleção, nesta ordem:
1. Muda o que alguém decide na semana (ferramenta nova utilizável, mudança de preço, capacidade nova).
2. Tem consequência prática para pequenas e médias empresas brasileiras.
3. É verificável — a URL sustenta a afirmação.
Descarte: press release sem produto, especulação sobre modelo não lançado, treta de rede social.

Regras:
- Use SOMENTE os itens fornecidos. Nunca invente notícia, número ou URL.
- Item sem link público (newsletter) serve de contexto e de confirmação; não o selecione.
- Post de creator (C) é opinião de uma pessoa: só selecione se a URL sustentar o fato.
- "porque" explica em uma frase por que isso importa para quem toca um negócio.
- "ganchoBr" traduz a notícia para a realidade brasileira em uma frase.
- O "corpo" é texto corrido em português do Brasil, direto, sem emoji e sem "no mundo da IA".
- Não prometa o que os itens não sustentam.`;

// Cada canal deriva do MESMO miolo, com as restrições do formato.
const SYSTEM_PECAS = `Você adapta uma edição curada para os canais da ROOT.
Recebe o miolo da edição e um repertório de estruturas que já funcionaram (fichas campeãs
do método "Cérebro de Conteúdo": família, objetivo, fórmula de headline, estrutura, prova,
anti-padrões). Use o repertório como molde — é o que separa uma peça da ROOT de um texto genérico.

Responda SOMENTE com um objeto JSON válido, sem cercas de código:
{
  "whatsapp": { "titulo": string, "corpo": string },
  "instagram": { "titulo": string, "legenda": string, "slides": [ { "titulo": string, "texto": string } ] },
  "newsletter": { "titulo": string, "corpo": string },
  "clickup": { "titulo": string, "corpo": string }
}

Restrições por canal:
- whatsapp: mensagem de grupo, até 900 caracteres, quebras curtas, sem markdown de link
  (o link entra sozinho no fim, não escreva URL). Abre com o que mudou, fecha com uma pergunta.
- instagram: de 6 a 8 slides. O slide 1 é a capa e segue a fórmula de headline do repertório.
  O último é o CTA. Cada "texto" cabe em até 220 caracteres. A legenda tem até 600.
- newsletter: markdown, 250-400 palavras, com subtítulos.
- clickup: descrição de tarefa para produzir a peça, com o checklist do que falta.

Regras: português do Brasil, sem emoji, sem inventar dado. Se o repertório indicar um
anti-padrão, respeite-o explicitamente.`;

interface ItemCurado {
  titulo?: string;
  url?: string;
  porque?: string;
  ganchoBr?: string;
}
interface Curadoria {
  titulo?: string;
  itens?: ItemCurado[];
  corpo?: string;
}
interface PecasGeradas {
  whatsapp?: { titulo?: string; corpo?: string };
  instagram?: { titulo?: string; legenda?: string; slides?: Array<{ titulo?: string; texto?: string }> };
  newsletter?: { titulo?: string; corpo?: string };
  clickup?: { titulo?: string; corpo?: string };
}

@Injectable()
export class RodadaService {
  private readonly log = new Logger('RodadaService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly coleta: ColetaService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  // ---------- coleta do insumo ----------

  /**
   * Coleta as fontes da rodada (RSS, Gmail, busca e perfis) e grava cada item novo como
   * captura. Insumo e referência moram na mesma caixa de entrada de propósito:
   * os dois são "item cru capturado" — o que muda é o destino (rodada × ficha),
   * não a natureza. O despacho por tipo mora em `ColetaService`.
   *
   * `origens` é a mesma da rotina: sem ela, todas; `['R', 'N']` coleta só feed e
   * busca, como antes do MC4, e não gasta run do Apify com perfil.
   */
  async coletarFeeds(orgId: string, actorId = 'sistema', origens?: unknown): Promise<ResultadoDaColetaDaRodada> {
    const lidas = lerOrigensDaRodada(origens);
    if ('erro' in lidas) throw new BadRequestException(lidas.erro);
    return this.coleta.coletarDaRodada(orgId, actorId, tiposDaColetaDasOrigens(lidas.origens));
  }

  // ---------- geração da rodada ----------

  private async repertorio(orgId: string, limite = 12) {
    return this.prisma.pautaReferencia.findMany({
      where: { orgId, campea: true },
      orderBy: { criadaEm: 'desc' },
      take: limite,
      select: {
        id: true,
        titulo: true,
        familia: true,
        objetivo: true,
        formulaHeadline: true,
        estruturaCorpo: true,
        prova: true,
        antiPadroes: true,
        emocaoAlvo: true,
      },
    });
  }

  /**
   * Roda a curadoria da janela. `horas` default 72h (a validade do insumo).
   * `origens` default todas (MC4); `['R', 'N']` é a rodada de antes do MC4.
   */
  async gerar(
    orgId: string,
    actorId: string,
    opts: { rotinaId?: string | null; horas?: number; origens?: unknown } = {},
  ) {
    const lidas = lerOrigensDaRodada(opts.origens);
    if ('erro' in lidas) throw new BadRequestException(lidas.erro);
    const { origens } = lidas;

    if (!this.llm.configured) {
      throw new ServiceUnavailableException(
        `IA não configurada: falta a credencial do provider "${this.llm.name}".`,
      );
    }

    const horas = opts.horas ?? 72;
    const janelaFim = new Date();
    const janelaIni = new Date(janelaFim.getTime() - horas * 3600_000);

    // Insumo: as capturas da janela, uma consulta por origem, para que o lote que a
    // coleta acabou de gravar (perfis, busca) não tire do corte o link que o
    // grupo mandou na semana. O equilíbrio mora em `insumoDaRodada`.
    const porOrigem = await this.capturasDaJanela(orgId, origens, janelaIni, TETO_DO_INSUMO);
    const capturas = insumoDaRodada(porOrigem, { janelaIni, teto: TETO_DO_INSUMO });

    if (capturas.length < 3) {
      throw new BadRequestException(
        `Só ${capturas.length} item(ns) coletado(s) nas últimas ${horas}h (origens ${origens.join(', ')}) — ` +
          'colete o Radar antes de gerar a rodada.',
      );
    }

    const rodada = await this.prisma.pautaRodada.create({
      data: {
        orgId,
        rotinaId: opts.rotinaId ?? null,
        status: 'coletando',
        titulo: `Rodada de ${janelaFim.toLocaleDateString('pt-BR')}`,
        janelaIni,
        janelaFim,
      },
    });

    try {
      const fichas = await this.repertorio(orgId);
      const lista = capturas.map((c, i) => linhaDoInsumo(c, i + 1)).join('\n\n');

      const saida = await this.llm.complete({
        system: SYSTEM_CURADORIA,
        user: `Janela: ${janelaIni.toISOString()} até ${janelaFim.toISOString()}\n\nItens coletados:\n\n${lista}`,
        // De quem é o gasto (RF-G-05). A curadoria roda pela tela E pela rotina
        // da madrugada; dizer a empresa aqui não depende de quem chamou ter
        // aberto o contexto — e o agendador abre, desde a correção da 3.6.
        orgId,
      });
      const cur = parseJsonDaIa<Curadoria>(saida);

      const itens = comOrigem(
        (cur.itens ?? []).filter((i) => i.url && i.titulo),
        capturas,
      ).slice(0, 5);
      if (!itens.length) throw new Error('A curadoria não selecionou nenhum item.');

      const atualizada = await this.prisma.pautaRodada.update({
        where: { id: rodada.id },
        data: {
          status: 'curada',
          titulo: (cur.titulo ?? rodada.titulo).slice(0, 200),
          itens: itens as unknown as Prisma.InputJsonValue,
          corpo: cur.corpo ?? '',
          fichasUsadas: fichas.map((f) => f.id),
          provider: this.llm.name,
          model: this.llm.model,
        },
      });

      await this.audit.log({
        orgId,
        actorId,
        action: 'pauta.rodada_gerada',
        entityType: 'pauta_rodada',
        entityId: rodada.id,
        after: {
          itens: itens.length,
          origens: itens.map((i) => i.origem ?? null),
          provider: this.llm.name,
          model: this.llm.model,
        },
      });

      return atualizada;
    } catch (e) {
      const msg = (e as Error).message ?? 'falha desconhecida';
      await this.prisma.pautaRodada.update({
        where: { id: rodada.id },
        data: { status: 'falhou', erro: msg.slice(0, 500) },
      });
      throw e;
    }
  }

  private whereDaJanela(orgId: string, fonte: ReturnType<typeof filtroDasOrigens>[number], janelaIni: Date) {
    return {
      orgId,
      capturadoEm: { gte: janelaIni },
      status: { in: ['rascunho' as const, 'ficha' as const] },
      fonte,
    };
  }

  private capturasDaJanela(orgId: string, origens: readonly PautaOrigem[], janelaIni: Date, take: number) {
    return Promise.all(
      filtroDasOrigens(origens).map((fonte) =>
        this.prisma.pautaCaptura.findMany({
          where: this.whereDaJanela(orgId, fonte, janelaIni),
          orderBy: { capturadoEm: 'desc' },
          take,
          include: { fonte: { select: { nome: true, tipo: true, plataforma: true, handle: true } } },
        }),
      ),
    );
  }

  // ---------- curadoria humana (MC6) ----------

  /**
   * A rodada "para curadoria": todos os candidatos da janela (até
   * `PAUTA_TETO_DE_CANDIDATOS`, com a sobra registrada), a IA só sugere, e a
   * rodada nasce em `aguardando_curadoria`. O modo de `gerar` — o da rotina
   * `pauta.rodada` — não muda.
   *
   * A sugestão é acessório: sem IA configurada, ou com a chamada falhando, a
   * lista nasce do mesmo jeito, sem sugeridos, e o motivo fica em `erro` — a
   * pessoa consegue curar sem a IA, e travar a curadoria por causa dela seria
   * devolver à IA a decisão que esta fatia tira dela.
   */
  async gerarParaCuradoria(
    orgId: string,
    actorId: string,
    opts: { rotinaId?: string | null; horas?: number; origens?: unknown } = {},
  ) {
    const lidas = lerOrigensDaRodada(opts.origens);
    if ('erro' in lidas) throw new BadRequestException(lidas.erro);
    const { origens } = lidas;

    const horas = opts.horas ?? PAUTA_HORAS_DA_CURADORIA;
    const janelaFim = new Date();
    const janelaIni = new Date(janelaFim.getTime() - horas * 3600_000);
    const teto = PAUTA_TETO_DE_CANDIDATOS;

    const porOrigem = await this.capturasDaJanela(orgId, origens, janelaIni, teto);
    const { escolhidas, deFora } = insumoDaRodadaComSobra(porOrigem, { janelaIni, teto });
    // A consulta de cada origem já para no teto: o que passou dele nela nem chega
    // ao corte acima. Para a sobra não sair subestimada, a origem que encheu a
    // consulta é contada inteira e o excedente entra na conta dela.
    const filtros = filtroDasOrigens(origens);
    const origensNoTeto = origens.filter((_, i) => porOrigem[i].length >= teto);
    const alemDaConsulta = await Promise.all(
      origensNoTeto.map(async (o) => {
        const total = await this.prisma.pautaCaptura.count({
          where: this.whereDaJanela(orgId, filtros[origens.indexOf(o)], janelaIni),
        });
        return [o, Math.max(0, total - teto)] as const;
      }),
    );

    if (!escolhidas.length) {
      throw new BadRequestException(
        `Nenhum item coletado nas últimas ${horas}h (origens ${origens.join(', ')}) — ` +
          'colete as fontes antes de montar a lista da curadoria.',
      );
    }

    const sobra = sobraPorOrigem(deFora);
    for (const [o, n] of alemDaConsulta) if (n) sobra[o] = (sobra[o] ?? 0) + n;
    const totalDeFora = Object.values(sobra).reduce((a, n) => a + (n ?? 0), 0);
    if (totalDeFora || origensNoTeto.length) {
      this.log.warn(
        `curadoria ${orgId}: ${escolhidas.length} candidato(s) no teto de ${teto}; ` +
          `${totalDeFora} ficaram de fora (${JSON.stringify(sobra)})` +
          (origensNoTeto.length ? `; origem(ns) ${origensNoTeto.join(', ')} bateram o teto da consulta` : ''),
      );
    }

    const rodada = await this.prisma.pautaRodada.create({
      data: {
        orgId,
        rotinaId: opts.rotinaId ?? null,
        status: 'coletando',
        titulo: `Curadoria de ${janelaFim.toLocaleDateString('pt-BR')}`,
        janelaIni,
        janelaFim,
      },
    });

    try {
      const fichas = await this.repertorio(orgId);
      let candidatos: Candidato[] = escolhidas.map((c) => candidatoDaCaptura(c));
      let titulo = rodada.titulo;
      let aviso: string | null = null;
      let usouIa = false;

      if (!this.llm.configured) {
        aviso = `Sem sugestão da IA: falta a credencial do provider "${this.llm.name}".`;
      } else {
        try {
          const lista = escolhidas
            .map((c, i) => linhaDoInsumo(c, i + 1, RESUMO_NO_PROMPT_DE_SUGESTAO))
            .join('\n\n');
          const saida = await this.llm.complete({
            system: SYSTEM_SUGESTAO,
            user: `Janela: ${janelaIni.toISOString()} até ${janelaFim.toISOString()}\n\nItens coletados (${escolhidas.length}):\n\n${lista}`,
            orgId,
          });
          usouIa = true;
          const sugestao = parseJsonDaIa<SugestaoDaIa>(saida);
          candidatos = aplicarSugestoes(candidatos, sugestao);
          titulo = tituloDaSugestao(sugestao) ?? titulo;
        } catch (e) {
          aviso = `Sem sugestão da IA: ${((e as Error).message ?? 'falha desconhecida').slice(0, 300)}`;
          this.log.warn(`curadoria ${orgId}: ${aviso}`);
        }
      }

      const atualizada = await this.prisma.pautaRodada.update({
        where: { id: rodada.id },
        data: {
          status: 'aguardando_curadoria',
          titulo,
          itens: candidatos as unknown as Prisma.InputJsonValue,
          corpo: '',
          fichasUsadas: fichas.map((f) => f.id),
          erro: aviso,
          ...(usouIa ? { provider: this.llm.name, model: this.llm.model } : {}),
        },
      });

      await this.audit.log({
        orgId,
        actorId,
        action: 'pauta.rodada_para_curadoria',
        entityType: 'pauta_rodada',
        entityId: rodada.id,
        after: {
          candidatos: candidatos.length,
          sugeridos: candidatos.filter((c) => c.sugerido).length,
          deFora: totalDeFora,
          sobraPorOrigem: sobra,
          origensNoTeto,
          teto,
          semSugestao: aviso,
        },
      });

      return atualizada;
    } catch (e) {
      const msg = (e as Error).message ?? 'falha desconhecida';
      await this.prisma.pautaRodada.update({
        where: { id: rodada.id },
        data: { status: 'falhou', erro: msg.slice(0, 500) },
      });
      throw e;
    }
  }

  private async rodadaEmCuradoria(orgId: string, rodadaId: string) {
    const rodada = await this.prisma.pautaRodada.findFirst({ where: { id: rodadaId, orgId } });
    if (!rodada) throw new NotFoundException('Rodada não encontrada');
    if (rodada.status !== 'aguardando_curadoria') {
      throw new BadRequestException(
        `Esta rodada está "${rodada.status}" — só a rodada aguardando curadoria aceita marcação.`,
      );
    }
    return rodada;
  }

  /**
   * Grava os itens que ficam — a lista inteira, não um delta: o que não vier
   * marcado fica desmarcado. A escrita é condicionada ao status, para uma
   * marcação atrasada não reabrir rodada que alguém acabou de confirmar.
   */
  async salvarMarcacao(orgId: string, rodadaId: string, actorId: string, ids: readonly string[]) {
    const rodada = await this.rodadaEmCuradoria(orgId, rodadaId);
    const lida = marcar(lerCandidatos(rodada.itens), ids);
    if ('erro' in lida) throw new BadRequestException(lida.erro);

    const r = await this.prisma.pautaRodada.updateMany({
      where: { id: rodada.id, orgId, status: 'aguardando_curadoria' },
      data: { itens: lida.candidatos as unknown as Prisma.InputJsonValue },
    });
    if (r.count === 0) throw new BadRequestException('A rodada saiu da curadoria enquanto a marcação era salva.');

    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.curadoria_marcada',
      entityType: 'pauta_rodada',
      entityId: rodada.id,
      after: { marcados: lida.marcados, candidatos: lida.candidatos.length },
    });
    return { ok: true, marcados: lida.marcados, candidatos: lida.candidatos.length };
  }

  /**
   * Fecha a curadoria: só os marcados seguem, o miolo é montado deles, e a
   * rodada vira `curada` — daí em diante é a rodada de sempre (derivar, publicar).
   * `ids` presente grava a marcação junto; ausente, vale a que foi salva.
   */
  async confirmarCuradoria(orgId: string, rodadaId: string, actorId: string, ids?: readonly string[]) {
    const rodada = await this.rodadaEmCuradoria(orgId, rodadaId);
    let candidatos = lerCandidatos(rodada.itens);
    if (ids) {
      const lida = marcar(candidatos, ids);
      if ('erro' in lida) throw new BadRequestException(lida.erro);
      candidatos = lida.candidatos;
    }
    const itens = itensDaCuradoria(candidatos);
    if (!itens.length) {
      throw new BadRequestException('Marque pelo menos um item antes de confirmar a curadoria.');
    }

    const r = await this.prisma.pautaRodada.updateMany({
      where: { id: rodada.id, orgId, status: 'aguardando_curadoria' },
      data: {
        status: 'curada',
        itens: itens as unknown as Prisma.InputJsonValue,
        corpo: corpoDaCuradoria(itens),
        // O "sem sugestão da IA" era aviso da lista; curada, a rodada não tem erro.
        erro: null,
      },
    });
    if (r.count === 0) throw new BadRequestException('Esta curadoria já foi confirmada.');

    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.curadoria_confirmada',
      entityType: 'pauta_rodada',
      entityId: rodada.id,
      before: { candidatos: candidatos.length },
      after: {
        mantidos: itens.map((i) => i.id),
        descartados: candidatos.length - itens.length,
        sugeridosMantidos: itens.filter((i) => i.sugerido).length,
      },
    });
    return { ok: true, status: 'curada' as const, itens: itens.length };
  }

  // ---------- derivação das peças ----------

  async derivar(orgId: string, rodadaId: string, actorId: string) {
    const rodada = await this.prisma.pautaRodada.findFirst({
      where: { id: rodadaId, orgId },
      include: { pecas: true },
    });
    if (!rodada) throw new NotFoundException('Rodada não encontrada');
    if (rodada.status === 'aguardando_curadoria') {
      throw new BadRequestException('Rodada aguardando curadoria — confirme os itens na aba Curadoria antes de gerar peças.');
    }
    if (rodada.status === 'coletando' || rodada.status === 'falhou') {
      throw new BadRequestException('Rodada ainda não foi curada com sucesso.');
    }
    if (rodada.pecas.length) {
      throw new BadRequestException('Esta rodada já tem peças — apague-as antes de gerar de novo.');
    }
    if (!this.llm.configured) {
      throw new ServiceUnavailableException(`IA não configurada (${this.llm.name}).`);
    }

    const fichas = await this.prisma.pautaReferencia.findMany({
      where: { orgId, id: { in: rodada.fichasUsadas } },
      select: {
        familia: true,
        objetivo: true,
        formulaHeadline: true,
        estruturaCorpo: true,
        prova: true,
        antiPadroes: true,
      },
    });

    const repertorio = fichas.length
      ? fichas
          .map(
            (f, i) =>
              `[${i + 1}] ${f.familia}/${f.objetivo}\n` +
              `    headline: ${f.formulaHeadline}\n` +
              `    estrutura: ${f.estruturaCorpo}\n` +
              `    prova: ${f.prova}` +
              (f.antiPadroes && f.antiPadroes !== 'não consta' ? `\n    anti-padrão: ${f.antiPadroes}` : ''),
          )
          .join('\n\n')
      : '(acervo sem fichas campeãs — escreva no tom direto da ROOT)';

    const itens = (rodada.itens as unknown as Array<ItemCurado & { resumo?: string; semLinkPublico?: boolean }>) ?? [];
    const saida = await this.llm.complete({
      system: SYSTEM_PECAS,
      user:
        `Edição: ${rodada.titulo}\n\nMiolo curado:\n${rodada.corpo}\n\n` +
        `Itens (com URL):\n${itens
          .map(
            (i) =>
              `- ${i.titulo}${i.semLinkPublico ? ' (newsletter, sem link público)' : ` — ${i.url}`}` +
              (i.ganchoBr ? ` (gancho BR: ${i.ganchoBr})` : i.resumo ? ` (resumo: ${i.resumo})` : ''),
          )
          .join('\n')}\n\n` +
        `Repertório de estruturas campeãs:\n${repertorio}`,
      // De quem é o gasto (RF-G-05). Ver o comentário em `gerar`.
      orgId,
    });
    const p = parseJsonDaIa<PecasGeradas>(saida);

    const criar: Array<{
      canal: PautaCanal;
      formato: string;
      titulo: string;
      corpo: string;
      meta: Prisma.InputJsonValue;
    }> = [];

    if (p.whatsapp?.corpo) {
      criar.push({
        canal: 'whatsapp',
        formato: 'texto',
        titulo: (p.whatsapp.titulo ?? rodada.titulo).slice(0, 200),
        corpo: p.whatsapp.corpo,
        meta: {},
      });
    }
    if (p.instagram?.slides?.length) {
      criar.push({
        canal: 'instagram',
        formato: 'carrossel',
        titulo: (p.instagram.titulo ?? rodada.titulo).slice(0, 200),
        corpo: p.instagram.legenda ?? '',
        meta: { slides: p.instagram.slides },
      });
    }
    if (p.newsletter?.corpo) {
      criar.push({
        canal: 'newsletter',
        formato: 'email',
        titulo: (p.newsletter.titulo ?? rodada.titulo).slice(0, 200),
        corpo: p.newsletter.corpo,
        meta: {},
      });
    }
    if (p.clickup?.corpo) {
      criar.push({
        canal: 'clickup',
        formato: 'tema',
        titulo: (p.clickup.titulo ?? rodada.titulo).slice(0, 200),
        corpo: p.clickup.corpo,
        meta: {},
      });
    }

    if (!criar.length) throw new ServiceUnavailableException('A IA não devolveu nenhuma peça utilizável.');

    for (const c of criar) {
      await this.prisma.pautaPeca.create({ data: { orgId, rodadaId: rodada.id, ...c } });
    }

    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.pecas_geradas',
      entityType: 'pauta_rodada',
      entityId: rodada.id,
      after: { canais: criar.map((c) => c.canal) },
    });

    return { ok: true, pecas: criar.length };
  }
}
