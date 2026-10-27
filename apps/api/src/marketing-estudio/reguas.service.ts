import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  FORMATOS_COM_REGUA,
  PARAMS_PADRAO,
  lerArquivoDaComunidade,
  problemaDaEnquete,
  semTravessao,
  type FormatoComRegua,
  type ReguaDoFormato,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';
import { GoogleService } from '../google/google.service';
import { MarcaService } from '../pauta/marca.service';
import { jsonDaIa, lerMetaDoLink } from './leitura-de-link';
import { REGRAS_DE_PARTIDA, SYSTEM_REGUA, sistemaDoFormato } from './prompts';

/*
 * PRODUÇÃO › FORMATOS, as réguas do ROOT Estúdio (26/10/2026). Cada formato tem
 * referências (link ou texto), a régua em tópicos e parâmetros. "Extrair régua"
 * faz a engenharia reversa das referências; "Gerar com a régua" escreve o post
 * da Máquina (headline, roteiro, slides, legenda) seguindo a régua e a marca.
 *
 * Gerar nunca apaga o que a pessoa escreveu sem ela ver: o texto anterior vai
 * para o histórico de comentários do post antes de ser trocado.
 *
 * Comunidade Wpp: os arquivos que o agente da comunidade grava em
 * Root/11-operacao/canal-whatsapp/semanas entram no Banco como posts. Importar
 * só cria o que falta (o nome do arquivo é a chave); nunca regrava post existente.
 */

const RAIZ_PADRAO_NO_DRIVE = '1WqCqI0gOxvVEhTPUQktATvj1lH1pOPSt';
const PASTA_DA_COMUNIDADE = ['11-operacao', 'canal-whatsapp', 'semanas'];
const simulada = () => process.env.MARKETING_IA_SIMULADA === '1';
const FORMATOS = FORMATOS_COM_REGUA as readonly string[];

type Referencia = ReguaDoFormato['referencias'][number];

@Injectable()
export class ReguasService {
  private readonly log = new Logger('ReguasDoMarketing');
  private readonly raizNoDrive = (process.env.MEMORIA_DRIVE_RAIZ_ID || RAIZ_PADRAO_NO_DRIVE).trim();

  constructor(
    private readonly prisma: PrismaService,
    private readonly marcas: MarcaService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    @Optional() private readonly google?: GoogleService,
  ) {}

  async listar(orgId: string): Promise<ReguaDoFormato[]> {
    const salvas = await this.prisma.marketingRegua.findMany({ where: { orgId } });
    return FORMATOS_COM_REGUA.map((formato) => {
      const r = salvas.find((s) => s.formato === formato);
      return {
        formato,
        regras: r?.regras || REGRAS_DE_PARTIDA[formato] || '',
        params: { ...PARAMS_PADRAO[formato], ...((r?.params as Record<string, string | number>) ?? {}) },
        referencias: (Array.isArray(r?.referencias) ? r!.referencias : []) as unknown as Referencia[],
        atualizadaEm: r?.atualizadaEm.toISOString() ?? null,
      };
    });
  }

  async salvar(orgId: string, formato: string, entrada: { regras: string; params: Record<string, string | number> }): Promise<ReguaDoFormato> {
    const f = this.formato(formato);
    await this.prisma.marketingRegua.upsert({
      where: { orgId_formato: { orgId, formato: f } },
      create: { orgId, formato: f, regras: entrada.regras, params: entrada.params },
      update: { regras: entrada.regras, params: entrada.params },
    });
    return (await this.listar(orgId)).find((r) => r.formato === f)!;
  }

  async adicionarReferencia(orgId: string, formato: string, ref: { url?: string; texto?: string; nota?: string }): Promise<ReguaDoFormato> {
    const f = this.formato(formato);
    const atual = (await this.listar(orgId)).find((r) => r.formato === f)!;
    const nova: Referencia = ref.url ? { id: randomUUID(), tipo: 'link', url: ref.url, nota: ref.nota } : { id: randomUUID(), tipo: 'texto', texto: ref.texto, nota: ref.nota };
    const referencias = [...atual.referencias, nova].slice(-30);
    await this.prisma.marketingRegua.upsert({
      where: { orgId_formato: { orgId, formato: f } },
      create: { orgId, formato: f, regras: atual.regras, params: atual.params, referencias: referencias as unknown as Prisma.InputJsonValue },
      update: { referencias: referencias as unknown as Prisma.InputJsonValue },
    });
    return (await this.listar(orgId)).find((r) => r.formato === f)!;
  }

  async removerReferencia(orgId: string, formato: string, refId: string): Promise<ReguaDoFormato> {
    const f = this.formato(formato);
    const atual = (await this.listar(orgId)).find((r) => r.formato === f)!;
    await this.prisma.marketingRegua.updateMany({
      where: { orgId, formato: f },
      data: { referencias: atual.referencias.filter((r) => r.id !== refId) as unknown as Prisma.InputJsonValue },
    });
    return (await this.listar(orgId)).find((r) => r.formato === f)!;
  }

  /** Engenharia reversa das referências: devolve a régua nova SEM salvar (a pessoa revisa e salva). */
  async extrair(orgId: string, formato: string): Promise<{ regras: string; params: Record<string, string | number> }> {
    const f = this.formato(formato);
    const atual = (await this.listar(orgId)).find((r) => r.formato === f)!;
    if (!atual.referencias.length) throw new BadRequestException('Adicione pelo menos uma referência (link ou texto) antes de extrair a régua.');
    if (simulada()) return { regras: `${REGRAS_DE_PARTIDA[f]}\n- (régua simulada a partir de ${atual.referencias.length} referência(s))`, params: atual.params };
    this.exigirIa();
    const textos: string[] = [];
    for (const r of atual.referencias.slice(0, 12)) {
      if (r.tipo === 'texto') textos.push(`${r.texto}${r.nota ? `\n(nota: ${r.nota})` : ''}`);
      else if (r.url) {
        const m = await lerMetaDoLink(r.url);
        textos.push(`${r.url}\nTítulo: ${m.titulo}\nDescrição: ${m.descricao}${r.nota ? `\n(nota: ${r.nota})` : ''}`);
      }
    }
    const marca = await this.marcas.bloco(orgId).catch(() => '');
    const saida = await this.llm.complete({
      funcao: 'CT-22',
      system: SYSTEM_REGUA,
      user: [`Formato: ${f}`, marca && `Marca:\n${marca}`, `Régua atual:\n${atual.regras}`, `Referências (${textos.length}):`, ...textos.map((t, i) => `[${i + 1}] ${t}`)].filter(Boolean).join('\n\n'),
      orgId,
      maxTokens: 2500,
    });
    const j = jsonDaIa<{ rules?: unknown[]; params?: Record<string, string | number> }>(saida);
    const regras = (Array.isArray(j.rules) ? j.rules : []).map((r) => `- ${semTravessao(r)}`).join('\n');
    if (!regras) throw new ServiceUnavailableException('A IA não devolveu a régua. Tente de novo.');
    return { regras, params: { ...atual.params, ...(j.params ?? {}) } };
  }

  /** Escreve o post pela régua do formato dele. O texto anterior vai para os comentários. */
  async gerarPost(orgId: string, postId: string, por: string, instrucao?: string) {
    const p = await this.prisma.marketingPost.findFirst({ where: { id: postId, orgId } });
    if (!p) throw new NotFoundException('Post não encontrado.');
    const formato = FORMATOS.includes(p.formato) ? (p.formato as FormatoComRegua) : p.formato === 'Story' || p.formato === 'Foto' ? 'Arte única' : 'Carrossel';
    const regua = (await this.listar(orgId)).find((r) => r.formato === formato)!;
    const subtipo = p.formato === 'Comunidade Wpp' ? p.subtipo || String(regua.params.subtipo ?? 'News semanal') : '';
    let j: Record<string, unknown>;
    if (simulada()) {
      j = {
        headline: p.headline || `${p.titulo} (gerado)`,
        subHeadline: subtipo === 'Enquete' ? 'Qual destas você já roda na operação?' : p.subHeadline,
        roteiro: formato === 'Comunidade Wpp' ? `*${p.titulo}*\n\n_texto simulado para o grupo_\n\n▸ ponto 1\n▸ ponto 2` : `GANCHO: ${p.headline || p.titulo}\nFALA: texto simulado`,
        slides: subtipo === 'Enquete' ? ['Atendimento', 'Financeiro', 'Estoque'] : formato === 'Carrossel' ? ['Slide 2 simulado', 'Slide 3 simulado'] : [],
        legenda: formato === 'Comunidade Wpp' ? '' : 'Legenda simulada. Você já viu isso na sua operação?',
        cta: 'Salve e mande para quem decide com você',
      };
    } else {
      this.exigirIa();
      const marca = await this.marcas.bloco(orgId).catch(() => '');
      const anterior = { headline: p.headline, subHeadline: p.subHeadline, roteiro: p.roteiro, slides: p.slides, legenda: p.legenda, cta: p.cta };
      const temAnterior = Object.values(anterior).some((v) => (Array.isArray(v) ? v.length : !!v));
      const saida = await this.llm.complete({
        funcao: 'CT-22',
        system: sistemaDoFormato(formato),
        user: [
          '## Marca', marca || '(marca ainda sem descrição)',
          `## Régua do ${formato} (siga)`, regua.regras, `Parâmetros: ${JSON.stringify(regua.params)}`,
          subtipo && `## Tipo da mensagem: ${subtipo}`,
          '## O post', `Título: ${p.titulo}`, p.pilar && `Pilar: ${p.pilar}`, p.headline && `Gancho: ${p.headline}`, p.porque && `Por que e de onde veio:\n${p.porque}`,
          (Array.isArray(p.fontes) ? (p.fontes as { nome?: string; link?: string }[]) : []).map((f) => `Fonte: ${f.nome ?? ''} ${f.link ?? ''}`).join('\n'),
          temAnterior && `## Versão anterior (JSON)\n${JSON.stringify(anterior)}`,
          instrucao ? `## Ajuste pedido\n${instrucao}\nAplique o ajuste e mantenha o que não foi pedido para mudar.` : temAnterior ? 'Faça uma versão nova, melhor que a anterior, seguindo a régua.' : '',
        ].filter(Boolean).join('\n\n'),
        orgId,
        maxTokens: 4000,
      });
      j = jsonDaIa(saida);
    }
    const t = (k: string, max: number) => (typeof j[k] === 'string' ? semTravessao(j[k]).slice(0, max) : undefined);
    const slides = Array.isArray(j.slides) ? (j.slides as unknown[]).map((s) => semTravessao(s).slice(0, 2000)).filter(Boolean).slice(0, 20) : undefined;
    if (subtipo === 'Enquete') {
      const problema = problemaDaEnquete(t('subHeadline', 600) ?? '', slides ?? []);
      if (problema) this.log.warn(`enquete do post ${postId}: ${problema}`);
    }
    const comentarios = Array.isArray(p.comentarios) ? [...(p.comentarios as unknown[])] : [];
    const tinhaTexto = [p.headline, p.roteiro, p.legenda].some(Boolean) || (Array.isArray(p.slides) && p.slides.length > 0);
    if (tinhaTexto) {
      comentarios.push({ autor: `${por} (versão antes de gerar)`, em: new Date().toISOString(), texto: JSON.stringify({ headline: p.headline, subHeadline: p.subHeadline, roteiro: p.roteiro, slides: p.slides, legenda: p.legenda, cta: p.cta }).slice(0, 4000) });
    }
    return this.prisma.marketingPost.update({
      where: { id: p.id },
      data: {
        ...(t('headline', 600) !== undefined ? { headline: t('headline', 600) } : {}),
        ...(t('subHeadline', 600) !== undefined ? { subHeadline: t('subHeadline', 600) } : {}),
        ...(t('roteiro', 20_000) !== undefined ? { roteiro: t('roteiro', 20_000) } : {}),
        ...(t('legenda', 6000) !== undefined ? { legenda: t('legenda', 6000) } : {}),
        ...(t('cta', 600) !== undefined ? { cta: t('cta', 600) } : {}),
        ...(t('design', 4000) !== undefined ? { design: t('design', 4000) } : {}),
        ...(slides !== undefined ? { slides } : {}),
        ...(subtipo && !p.subtipo ? { subtipo } : {}),
        comentarios: comentarios as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
  }

  /** Lê canal-whatsapp/semanas no Drive e cria no Banco o que falta. */
  async importarComunidade(orgId: string, por: string): Promise<{ lidos: number; criados: number; jaExistiam: number; ignorados: number }> {
    if (!this.google) throw new ServiceUnavailableException('O Google Drive não está ligado nesta instalação.');
    let pai = this.raizNoDrive;
    for (const nome of PASTA_DA_COMUNIDADE) {
      const achada = (await this.google.filhosDaPasta(orgId, pai, { nome, soPastas: true }))[0];
      if (!achada) throw new NotFoundException(`Não achei a pasta ${PASTA_DA_COMUNIDADE.join('/')} no Drive Root.`);
      pai = achada.id;
    }
    const arquivos = (await this.google.filhosDaPasta(orgId, pai)).filter((a) => a.nome.toLowerCase().endsWith('.md'));
    const existentes = new Set((await this.prisma.marketingPost.findMany({ where: { orgId, formato: 'Comunidade Wpp' }, select: { numero: true } })).map((p) => p.numero));
    const r = { lidos: arquivos.length, criados: 0, jaExistiam: 0, ignorados: 0 };
    for (const a of arquivos) {
      const base = a.nome.replace(/\.md$/i, '');
      if (existentes.has(base)) {
        r.jaExistiam++;
        continue;
      }
      if (!lerArquivoDaComunidade(a.nome, '```\nx\n```')) {
        r.ignorados++;
        continue;
      }
      const lido = lerArquivoDaComunidade(a.nome, await this.google.baixarTextoDoDrive(orgId, a.id));
      if (!lido) {
        r.ignorados++;
        continue;
      }
      await this.prisma.marketingPost.create({
        data: {
          orgId,
          numero: lido.numero.slice(0, 40),
          titulo: lido.titulo.slice(0, 200),
          formato: 'Comunidade Wpp',
          subtipo: lido.subtipo,
          tipoCard: 'arte',
          roteiro: lido.texto.slice(0, 20_000),
          slides: lido.opcoes,
          porque: `Importado de ${PASTA_DA_COMUNIDADE.join('/')}/${a.nome} (data do arquivo: ${lido.data}).`,
          fontes: [{ tipo: 'referencia', nome: a.nome.slice(0, 200), ...(a.url ? { link: a.url.slice(0, 500) } : {}) }],
          etapa: 'ideia',
          criadoPor: por,
          hist: [{ em: new Date().toISOString(), de: null, para: 'ideia', por: `${por} (importou da Comunidade)` }],
        },
      });
      r.criados++;
    }
    return r;
  }

  private formato(f: string): FormatoComRegua {
    if (!FORMATOS.includes(f)) throw new BadRequestException(`Formato desconhecido: ${f}.`);
    return f as FormatoComRegua;
  }

  private exigirIa(): void {
    if (!this.llm.configured) throw new ServiceUnavailableException(`IA não configurada: falta a credencial do provider "${this.llm.name}".`);
  }
}
