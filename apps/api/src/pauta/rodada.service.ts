import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, PautaCanal, PautaRodadaStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ColetaService } from './coleta.service';
import { parseJsonDaIa } from './parse-json';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';

// Uma rodada é a peça-mãe: coleta a janela, cura numa chamada só e vira N peças.
// Ver docs/PAUTA.md §7. O que a diferencia de "gerar um texto com IA" é o
// segundo insumo: as fichas CAMPEÃS do acervo entram no mesmo prompt, então o
// derivador recebe família, objetivo, fórmula de headline e anti-padrões
// validados — não "escreva um carrossel sobre X".

const SYSTEM_CURADORIA = `Você é o editor de conteúdo da ROOT, uma comunidade brasileira sobre IA aplicada a negócios.
Recebe uma lista de notícias coletadas na janela e escolhe o que vira pauta.

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly coleta: ColetaService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  // ---------- coleta do insumo ----------

  /**
   * Coleta as fontes da rodada (RSS e Gmail) e grava cada item novo como
   * captura. Insumo e referência moram na mesma caixa de entrada de propósito:
   * os dois são "item cru capturado" — o que muda é o destino (rodada × ficha),
   * não a natureza. O despacho por tipo mora em `ColetaService`.
   */
  coletarFeeds(orgId: string, actorId = 'sistema'): Promise<{ novas: number; fontes: number; erros: number }> {
    return this.coleta.coletarDaRodada(orgId, actorId);
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

  /** Roda a curadoria da janela. `horas` default 72h (a validade do insumo). */
  async gerar(
    orgId: string,
    actorId: string,
    opts: { rotinaId?: string | null; horas?: number } = {},
  ) {
    if (!this.llm.configured) {
      throw new ServiceUnavailableException(
        `IA não configurada: falta a credencial do provider "${this.llm.name}".`,
      );
    }

    const horas = opts.horas ?? 72;
    const janelaFim = new Date();
    const janelaIni = new Date(janelaFim.getTime() - horas * 3600_000);

    // Insumo: capturas de feed dentro da janela que ainda não viraram ficha.
    const capturas = await this.prisma.pautaCaptura.findMany({
      where: {
        orgId,
        capturadoEm: { gte: janelaIni },
        status: { in: ['rascunho', 'ficha'] },
        // Gmail é coletado mas não entra aqui: a URL da captura é o permalink de
        // uma caixa de entrada, e o item escolhido vira link publicado no grupo.
        // Entra com a curadoria humana (MC5/MC6), que decide o link de cada item.
        fonte: { tipo: 'rss' },
      },
      orderBy: { capturadoEm: 'desc' },
      take: 60,
      include: { fonte: { select: { nome: true } } },
    });

    if (capturas.length < 3) {
      throw new BadRequestException(
        `Só ${capturas.length} item(ns) de feed nas últimas ${horas}h — colete o Radar antes de gerar a rodada.`,
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
      const lista = capturas
        .map((c, i) => {
          const b = (c.bruto ?? {}) as { resumo?: string; publicadoEm?: string };
          return [
            `[${i + 1}] ${c.titulo ?? '(sem título)'}`,
            `    fonte: ${c.fonte?.nome ?? 'n/d'}${b.publicadoEm ? ` · ${b.publicadoEm.slice(0, 10)}` : ''}`,
            `    url: ${c.url}`,
            b.resumo ? `    resumo: ${b.resumo.slice(0, 500)}` : '',
          ]
            .filter(Boolean)
            .join('\n');
        })
        .join('\n\n');

      const saida = await this.llm.complete({
        system: SYSTEM_CURADORIA,
        user: `Janela: ${janelaIni.toISOString()} até ${janelaFim.toISOString()}\n\nItens coletados:\n\n${lista}`,
        // De quem é o gasto (RF-G-05). A curadoria roda pela tela E pela rotina
        // da madrugada; dizer a empresa aqui não depende de quem chamou ter
        // aberto o contexto — e o agendador abre, desde a correção da 3.6.
        orgId,
      });
      const cur = parseJsonDaIa<Curadoria>(saida);

      const itens = (cur.itens ?? []).filter((i) => i.url && i.titulo).slice(0, 5);
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
        after: { itens: itens.length, provider: this.llm.name, model: this.llm.model },
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

  // ---------- derivação das peças ----------

  async derivar(orgId: string, rodadaId: string, actorId: string) {
    const rodada = await this.prisma.pautaRodada.findFirst({
      where: { id: rodadaId, orgId },
      include: { pecas: true },
    });
    if (!rodada) throw new NotFoundException('Rodada não encontrada');
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

    const itens = (rodada.itens as unknown as ItemCurado[]) ?? [];
    const saida = await this.llm.complete({
      system: SYSTEM_PECAS,
      user:
        `Edição: ${rodada.titulo}\n\nMiolo curado:\n${rodada.corpo}\n\n` +
        `Itens (com URL):\n${itens.map((i) => `- ${i.titulo} — ${i.url}${i.ganchoBr ? ` (gancho BR: ${i.ganchoBr})` : ''}`).join('\n')}\n\n` +
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
