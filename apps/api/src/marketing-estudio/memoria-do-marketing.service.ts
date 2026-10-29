import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import type { MarketingNota, Prisma } from '@prisma/client';
import {
  MEMORIA_ASSUNTOS,
  MEMORIA_PASTAS,
  MEMORIA_PASTA_NO_DRIVE,
  arquivoDaNota,
  assuntoValido,
  chaveDoLink,
  corpoDoLink,
  corpoDoVideo,
  ficaComoReferencia,
  grafoDasNotas,
  limparTags,
  nomeDeArquivo,
  nucleoDoLink,
  primeiraUrl,
  semTravessao,
  tagsDoTexto,
  tipoDeVideo,
  tituloDaIdeia,
  vaiParaIdeias,
  type AnaliseDeLink,
  type AnaliseDeVideo,
  type MemoriaAssunto,
  type MemoriaDestino,
  type MemoriaDestinoInput,
  type MemoriaGrafo,
  type MemoriaNota,
  type MemoriaNotaBreve,
  type MemoriaNotaSalvarInput,
  type MemoriaPainel,
  type MemoriaPasta,
  type MemoriaStatus,
  type MemoriaTipo,
  type MemoriaVia,
  type TriagemStatus,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';
import { TranscricaoService, MAX_BYTES_DE_AUDIO } from '../llm/transcricao.provider';
import { GoogleService } from '../google/google.service';
import { ApifyService } from '../pauta/apify.service';
import { MarcaService } from '../pauta/marca.service';
import { EntradaDeGrupoRegistry } from '../gateway/canais/entrada-de-grupo.registry';
import { lerLinksDoGrupo } from '../pauta/links-do-grupo';
import { comContextoDaEmpresaResolvida } from '../prisma/contexto-de-plataforma';
import { baixarAte, jsonDaIa, lerMetaDoLink } from './leitura-de-link';
import { SYSTEM_LINK, SYSTEM_VIDEO } from './prompts';

/*
 * MEMÓRIA DO MARKETING (26/10/2026), a do ROOT Estúdio dentro do OS.
 *
 * Entra por dois lugares: a caixa da tela e o grupo "Memória ROOT" do WhatsApp
 * (o número comercial da ROOT está no grupo; ideia do Rodrigo, decisão do Lucas).
 * Texto sem link vira ideia na hora. Link vira nota resumida pela IA. Reel e
 * TikTok são baixados pelo Apify, transcritos (OpenAI) e destrinchados: gancho,
 * estrutura, formato, CTA, por que funciona e como adaptar.
 *
 * Cada nota pronta também vira .md no Drive Root, em 40-marca-e-conteudo/Memória/<pasta>,
 * que já está no Obsidian do Lucas. O Drive é espelho: a nota vale no OS mesmo
 * quando o Drive falha, e a tela diz que ela ainda não foi para lá.
 *
 * Tudo chega na Entrada (29/10/2026). A equipe abre a nota e decide o destino:
 * Ideia de conteúdo (card em Ideias, pela Triagem), Referência externa (material de
 * fora para consultar, separado por assunto; não é memória da empresa) ou as duas.
 * A Triagem não puxa mais nota sozinha: só o que foi mandado.
 *
 * Variáveis: MEMORIA_GRUPO_JID (o grupo, @g.us) e MEMORIA_GRUPO_ORG_ID (a empresa dona);
 * MEMORIA_DRIVE_RAIZ_ID (a pasta Root no Drive); MARKETING_IA_SIMULADA=1 nos testes.
 */

const RAIZ_PADRAO_NO_DRIVE = '1WqCqI0gOxvVEhTPUQktATvj1lH1pOPSt';
const lim = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const simulada = () => process.env.MARKETING_IA_SIMULADA === '1';

function breve(n: MarketingNota): MemoriaNotaBreve {
  return {
    id: n.id,
    titulo: n.titulo,
    pasta: n.pasta as MemoriaPasta,
    tipo: n.tipo as MemoriaTipo,
    tags: n.tags,
    url: n.url,
    autor: n.autor,
    resumo: n.resumo,
    status: n.status as MemoriaStatus,
    erro: n.erro,
    via: n.via as MemoriaVia,
    noDrive: !!n.driveFileId,
    destino: n.destino as MemoriaDestino,
    assunto: assuntoValido(n.assunto),
    enviadaPor: n.enviadaPor,
    criadaEm: n.criadaEm.toISOString(),
    atualizadaEm: n.atualizadaEm.toISOString(),
  };
}

/** As três vistas da tela: Para decidir, Ideias de conteúdo e Referências (a nota "as duas" aparece nas duas). */
function noDestino(vista: string): Prisma.MarketingNotaWhereInput | null {
  if (vista === 'entrada') return { destino: 'entrada' };
  if (vista === 'conteudo') return { destino: { in: ['conteudo', 'conteudo_e_referencia'] } };
  if (vista === 'referencia') return { destino: { in: ['referencia', 'conteudo_e_referencia'] } };
  return null;
}

@Injectable()
export class MemoriaDoMarketingService implements OnModuleInit {
  private readonly log = new Logger('MemoriaDoMarketing');
  private readonly jid = (process.env.MEMORIA_GRUPO_JID ?? '').trim();
  private readonly orgDoGrupo = (process.env.MEMORIA_GRUPO_ORG_ID ?? '').trim();
  private readonly raizNoDrive = (process.env.MEMORIA_DRIVE_RAIZ_ID || RAIZ_PADRAO_NO_DRIVE).trim();
  /** Uma nota por vez neste processo: Apify, transcrição e IA custam e demoram. */
  private fila: Promise<unknown> = Promise.resolve();
  private readonly pastasNoDrive = new Map<string, string>();
  private grupoLigado = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly marcas: MarcaService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    @Optional() private readonly transcricao?: TranscricaoService,
    @Optional() private readonly google?: GoogleService,
    @Optional() private readonly apify?: ApifyService,
    @Optional() private readonly grupos?: EntradaDeGrupoRegistry,
  ) {}

  onModuleInit(): void {
    if (this.jid && this.orgDoGrupo && this.grupos) {
      this.grupoLigado = this.grupos.registrar(this.jid, (orgId, evento) => this.receberDoGrupo(orgId, evento), 'MemoriaDoMarketingService');
      if (!this.grupoLigado) this.log.warn('MEMORIA_GRUPO_JID precisa ser o JID de um grupo (termina em @g.us)');
    }
    // Nota que ficou na fila quando a API reiniciou volta a andar.
    if (process.env.NODE_ENV !== 'test') setTimeout(() => void this.retomarFila().catch((e) => this.log.warn(`retomar fila: ${e}`)), 20_000);
  }

  // ---------- leitura ----------

  /** O uso do mês no Apify (créditos grátis) ou nulo, sem Apify ou sem leitura. */
  async usoDoApify() {
    return { uso: this.apify?.configured ? await this.apify.usoDoMes() : null, configurado: !!this.apify?.configured };
  }

  async painel(orgId: string, filtro: { q?: string; tag?: string; pasta?: string; destino?: string; assunto?: string }): Promise<MemoriaPainel> {
    const vista = noDestino(filtro.destino ?? '');
    const where: Prisma.MarketingNotaWhereInput = { orgId, ...vista };
    if (filtro.pasta && (MEMORIA_PASTAS as readonly string[]).includes(filtro.pasta)) where.pasta = filtro.pasta;
    if (filtro.tag) where.tags = { has: filtro.tag.toLowerCase() };
    const assunto = assuntoValido(filtro.assunto);
    if (assunto) where.assunto = assunto;
    const q = lim(filtro.q, 200);
    if (q) where.OR = ['titulo', 'resumo', 'corpo', 'url'].map((c) => ({ [c]: { contains: q, mode: 'insensitive' } }));
    const [notas, todas] = await Promise.all([
      this.prisma.marketingNota.findMany({ where, orderBy: { atualizadaEm: 'desc' }, take: 500 }),
      this.prisma.marketingNota.findMany({ where: { orgId }, select: { pasta: true, tags: true, destino: true, assunto: true } }),
    ]);
    // Pastas, tags e assuntos contam dentro da vista aberta (Para decidir, Ideias ou Referências).
    const naVista = todas.filter((r) => (filtro.destino === 'entrada' ? r.destino === 'entrada' : filtro.destino === 'conteudo' ? vaiParaIdeias(r.destino) : filtro.destino === 'referencia' ? ficaComoReferencia(r.destino) : true));
    const tags: Record<string, number> = {};
    for (const n of naVista) for (const t of n.tags) tags[t] = (tags[t] ?? 0) + 1;
    return {
      notas: notas.map(breve),
      total: naVista.length,
      destinos: [
        { destino: 'entrada', n: todas.filter((r) => r.destino === 'entrada').length },
        { destino: 'conteudo', n: todas.filter((r) => vaiParaIdeias(r.destino)).length },
        { destino: 'referencia', n: todas.filter((r) => ficaComoReferencia(r.destino)).length },
      ],
      assuntos: MEMORIA_ASSUNTOS.map((a) => ({ assunto: a, n: naVista.filter((r) => r.assunto === a).length })),
      pastas: MEMORIA_PASTAS.map((nome) => ({ nome, n: naVista.filter((r) => r.pasta === nome).length })),
      tags: Object.entries(tags).sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ t, n })),
      ligacoes: {
        grupo: this.grupoLigado,
        drive: !!this.google,
        transcricao: !!this.transcricao?.configured,
        apify: !!this.apify?.configured,
        ia: simulada() || this.llm.configured,
      },
    };
  }

  async nota(orgId: string, id: string): Promise<MemoriaNota> {
    const n = await this.achar(orgId, id);
    const [citadaEm, card] = await Promise.all([
      this.prisma.marketingNota.findMany({
        where: { orgId, id: { not: n.id }, corpo: { contains: `[[${n.titulo}`, mode: 'insensitive' } },
        select: { id: true, titulo: true },
        orderBy: { atualizadaEm: 'desc' },
        take: 30,
      }),
      this.prisma.marketingIdeiaCard.findFirst({ where: { orgId, notaId: n.id }, select: { id: true, status: true } }),
    ]);
    return {
      ...breve(n),
      corpo: n.corpo,
      citadaEm,
      ideia: card ? { id: card.id, status: card.status as TriagemStatus } : null,
      decididaPor: n.decididaPor,
      decididaEm: n.decididaEm?.toISOString() ?? null,
    };
  }

  async grafo(orgId: string): Promise<MemoriaGrafo> {
    const notas = await this.prisma.marketingNota.findMany({
      where: { orgId },
      orderBy: { atualizadaEm: 'desc' },
      take: 400,
      select: { id: true, titulo: true, tipo: true, tags: true, url: true, autor: true, corpo: true },
    });
    return grafoDasNotas(notas.map((n) => ({ ...n, tipo: n.tipo as MemoriaTipo })));
  }

  // ---------- escrita ----------

  async criar(orgId: string, por: string, entrada: { titulo: string; pasta: MemoriaPasta; corpo: string }): Promise<MemoriaNotaBreve> {
    const n = await this.prisma.marketingNota.create({
      data: {
        orgId,
        titulo: entrada.titulo,
        pasta: entrada.pasta,
        tipo: entrada.pasta === 'Ideias' ? 'ideia' : 'nota',
        corpo: entrada.corpo,
        resumo: entrada.corpo.slice(0, 280),
        tags: tagsDoTexto(entrada.corpo),
        enviadaPor: por,
      },
    });
    void this.espelharNoDrive(orgId, n.id);
    return breve(n);
  }

  async salvar(orgId: string, id: string, entrada: MemoriaNotaSalvarInput): Promise<MemoriaNotaBreve> {
    const n = await this.achar(orgId, id);
    const data: Prisma.MarketingNotaUpdateInput = {};
    if (entrada.titulo !== undefined) data.titulo = entrada.titulo;
    if (entrada.pasta !== undefined) data.pasta = entrada.pasta;
    if (entrada.corpo !== undefined) {
      data.corpo = entrada.corpo;
      if (n.tipo === 'ideia' || n.tipo === 'nota') data.resumo = entrada.corpo.replace(/^#.*$/gm, '').trim().slice(0, 280);
    }
    if (entrada.tags !== undefined) data.tags = limparTags(entrada.tags);
    else if (entrada.corpo !== undefined) data.tags = limparTags([...n.tags, ...tagsDoTexto(entrada.corpo)]);
    const salva = await this.prisma.marketingNota.update({ where: { id: n.id }, data });
    void this.espelharNoDrive(orgId, salva.id);
    return breve(salva);
  }

  /**
   * O destino da nota. Ideia de conteúdo: quem chama pede o card à Triagem logo depois
   * (o controller faz isso). Tirar de Ideias apaga o card que ainda está em "nova" ou
   * que a IA descartou; o card já aprovado ou recusado fica, porque virou post ou ensinou
   * o algoritmo. Referência pede o assunto, para a biblioteca ficar separada.
   */
  async decidir(orgId: string, id: string, por: string, entrada: MemoriaDestinoInput): Promise<MemoriaNota> {
    const n = await this.achar(orgId, id);
    if (entrada.destino !== 'entrada' && n.status !== 'pronto') {
      throw new ConflictException('Espere a nota ficar pronta (ou tente de novo) antes de decidir para onde ela vai.');
    }
    const assunto: MemoriaAssunto | null = entrada.assunto === undefined ? assuntoValido(n.assunto) : entrada.assunto;
    if (ficaComoReferencia(entrada.destino) && !assunto) {
      throw new BadRequestException('Diga do que a referência trata: ferramenta, produto, conteúdo ou negócio.');
    }
    if (!vaiParaIdeias(entrada.destino)) {
      await this.prisma.marketingIdeiaCard.deleteMany({ where: { orgId, notaId: n.id, status: { in: ['nova', 'descartada_ia'] } } });
    }
    const decidida = entrada.destino !== 'entrada';
    await this.prisma.marketingNota.update({
      where: { id: n.id },
      data: { destino: entrada.destino, assunto, decididaEm: decidida ? new Date() : null, decididaPor: decidida ? por : null },
    });
    void this.espelharNoDrive(orgId, n.id);
    return this.nota(orgId, n.id);
  }

  /** Apaga a nota do OS. O .md do Drive fica (o Drive é do Lucas; apagar lá é com ele). */
  async apagar(orgId: string, id: string): Promise<{ ok: true }> {
    const n = await this.achar(orgId, id);
    await this.prisma.marketingNota.delete({ where: { id: n.id } });
    return { ok: true };
  }

  async capturar(orgId: string, texto: string, via: MemoriaVia, por: string | null): Promise<{ nota: MemoriaNotaBreve; repetida: boolean }> {
    texto = lim(texto, 8000);
    if (!texto) throw new BadRequestException('Escreva ou cole alguma coisa para guardar.');
    const url = primeiraUrl(texto);
    if (!url) {
      const n = await this.prisma.marketingNota.create({
        data: { orgId, pasta: 'Ideias', tipo: 'ideia', titulo: tituloDaIdeia(texto), corpo: texto, resumo: texto.slice(0, 280), tags: tagsDoTexto(texto), via, enviadaPor: por },
      });
      void this.espelharNoDrive(orgId, n.id);
      return { nota: breve(n), repetida: false };
    }
    // Repetida pela chave do link, não pela URL exata: www, barra no fim, /reel/ ou /p/ e
    // ?igsh= não fazem outra nota (nem gastam Apify de novo).
    const chave = chaveDoLink(url);
    const parecidas = await this.prisma.marketingNota.findMany({
      where: { orgId, url: { contains: nucleoDoLink(url), mode: 'insensitive' } },
      orderBy: { criadaEm: 'asc' },
      take: 50,
    });
    const existente = parecidas.find((p) => p.url && chaveDoLink(p.url) === chave);
    if (existente) return { nota: breve(existente), repetida: true };
    const video = tipoDeVideo(url);
    const comentario = texto.replace(url, '').trim();
    const n = await this.prisma.marketingNota.create({
      data: {
        orgId,
        pasta: video ? 'Vídeos' : 'Links',
        tipo: video ? 'video' : 'link',
        titulo: url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 80),
        url,
        status: 'fila',
        tags: tagsDoTexto(comentario),
        resumo: comentario.slice(0, 280),
        corpo: comentario,
        via,
        enviadaPor: por,
      },
    });
    this.enfileirar(orgId, n.id, comentario);
    return { nota: breve(n), repetida: false };
  }

  async tentarDeNovo(orgId: string, id: string): Promise<{ ok: true }> {
    const n = await this.achar(orgId, id);
    if (!n.url || !['erro', 'fila'].includes(n.status)) throw new ConflictException('Só dá para tentar de novo uma nota de link ou vídeo que falhou.');
    await this.prisma.marketingNota.update({ where: { id: n.id }, data: { status: 'fila', erro: null } });
    this.enfileirar(orgId, n.id, '');
    return { ok: true };
  }

  /** Manda de novo para o Drive as notas prontas que ainda não estão lá. */
  async sincronizarDrive(orgId: string): Promise<{ enviadas: number; falharam: number }> {
    const faltam = await this.prisma.marketingNota.findMany({ where: { orgId, status: 'pronto', driveFileId: null }, select: { id: true }, take: 200 });
    let enviadas = 0;
    let falharam = 0;
    for (const f of faltam) (await this.espelharNoDrive(orgId, f.id)) ? enviadas++ : falharam++;
    return { enviadas, falharam };
  }

  // ---------- grupo do WhatsApp ----------

  receberDoGrupo(orgId: string, evento: unknown): Promise<string> {
    if (orgId !== this.orgDoGrupo) return Promise.resolve('ignorado:empresa-errada');
    const leitura = lerLinksDoGrupo(evento, this.jid);
    if (leitura.tipo === 'ignorar') return Promise.resolve(`ignorado:${leitura.porque}`);
    return (async () => {
      let novas = 0;
      for (const url of leitura.urls) {
        const comentario = leitura.texto.replace(url, '').trim();
        const r = await this.capturar(orgId, `${url} ${comentario}`.trim(), 'whatsapp', leitura.remetente ?? 'grupo Memória ROOT');
        if (!r.repetida) novas++;
      }
      return `memoria:${novas}`;
    })();
  }

  // ---------- processamento ----------

  private enfileirar(orgId: string, id: string, comentario: string): void {
    const vez = this.fila.then(() =>
      comContextoDaEmpresaResolvida(orgId, () => this.processar(orgId, id, comentario), { origem: 'cron', actorId: 'memoria-do-marketing' }),
    );
    this.fila = vez.catch((e) => this.log.warn(`nota ${id}: ${e instanceof Error ? e.message : e}`));
  }

  private async retomarFila(): Promise<void> {
    if (this.orgDoGrupo) {
      await comContextoDaEmpresaResolvida(this.orgDoGrupo, async () => {
        const presas = await this.prisma.marketingNota.findMany({ where: { orgId: this.orgDoGrupo, status: { in: ['fila', 'processando'] } }, select: { id: true } });
        for (const p of presas) this.enfileirar(this.orgDoGrupo, p.id, '');
      });
    }
  }

  private async processar(orgId: string, id: string, comentario: string): Promise<void> {
    const n = await this.prisma.marketingNota.findFirst({ where: { id, orgId } });
    if (!n || !n.url) return;
    await this.prisma.marketingNota.update({ where: { id }, data: { status: 'processando', erro: null } });
    try {
      const marca = await this.marcas.bloco(orgId).catch(() => '');
      const nomeDaMarca = /ROOT/i.test(marca) ? 'a ROOT' : '';
      const video = tipoDeVideo(n.url);
      if (video) {
        let legenda = '';
        let autor = '';
        let transcricao = '';
        let semTranscricao = false;
        if (video === 'instagram' || video === 'tiktok') {
          const r = await this.videoPeloApify(n.url);
          legenda = r.legenda;
          autor = r.autor;
          transcricao = r.videoUrl ? await this.transcrever(orgId, r.videoUrl) : '';
          semTranscricao = !transcricao;
        } else {
          const m = await lerMetaDoLink(n.url);
          legenda = m.descricao;
          autor = m.autor ?? '';
          semTranscricao = true;
        }
        const a = await this.analisar<AnaliseDeVideo>(orgId, SYSTEM_VIDEO,
          `${marca}\n\nLink: ${n.url}\nAutor: ${autor}\nLegenda do post: ${legenda}\nComentário de quem guardou: ${comentario}\nTranscrição: ${(transcricao || '(sem transcrição)').slice(0, 12000)}`,
          () => ({ title: legenda.split('\n')[0].slice(0, 70) || 'Vídeo guardado', summary: 'Vídeo curto guardado para referência.', hook: 'Abre com a cena antes da fala.', structure: ['Cena de abertura', 'Comentário', 'Pergunta'], format: 'Vertical, legenda queimada.', cta: 'Pergunta nos comentários.', why_works: 'A cena prova o ponto antes da opinião.', adapt: ['Usar um clipe de operação real e comentar em seguida.'], tags: ['reels'], subject: 'conteudo' }));
        await this.prisma.marketingNota.update({
          where: { id },
          data: {
            status: 'pronto', erro: null,
            titulo: lim(a.title, 120) || n.titulo,
            autor: lim(autor.replace(/^@/, ''), 80) || null,
            resumo: lim(a.summary, 600),
            tags: limparTags([...n.tags, ...(a.tags ?? [])]),
            assunto: n.assunto ?? assuntoValido(a.subject),
            corpo: corpoDoVideo({ url: n.url, autor, analise: a, transcricao, legenda, marca: nomeDaMarca, semTranscricao }) + (comentario ? `\n## Comentário de quem guardou\n${comentario}\n` : ''),
          },
        });
      } else {
        const m = await lerMetaDoLink(n.url);
        const a = await this.analisar<AnaliseDeLink>(orgId, SYSTEM_LINK,
          `${marca}\n\nLink: ${n.url}\nTítulo da página: ${m.titulo}\nDescrição: ${m.descricao}\nAutor: ${m.autor ?? ''}\nComentário de quem guardou: ${comentario}`,
          () => ({ title: m.titulo || n.titulo, summary: m.descricao || 'Página guardada para consulta.', key_points: ['Ponto principal da página'], adapt: ['Virar um post comentando o ponto principal.'], tags: ['referencia'], subject: 'negocio' }));
        await this.prisma.marketingNota.update({
          where: { id },
          data: {
            status: 'pronto', erro: null,
            titulo: lim(a.title, 120) || lim(m.titulo, 120) || n.titulo,
            autor: lim(m.autor, 80) || null,
            resumo: lim(a.summary, 600) || lim(m.descricao, 600),
            tags: limparTags([...n.tags, ...(a.tags ?? [])]),
            assunto: n.assunto ?? assuntoValido(a.subject),
            corpo: corpoDoLink({ url: n.url, autor: m.autor, analise: a, descricao: m.descricao, marca: nomeDaMarca }) + (comentario ? `\n## Comentário de quem guardou\n${comentario}\n` : ''),
          },
        });
      }
      await this.espelharNoDrive(orgId, id);
    } catch (e) {
      await this.prisma.marketingNota.update({ where: { id }, data: { status: 'erro', erro: lim(e instanceof Error ? e.message : e, 400) } });
      throw e;
    }
  }

  private async videoPeloApify(url: string): Promise<{ videoUrl: string; legenda: string; autor: string }> {
    if (simulada()) return { videoUrl: '', legenda: 'Legenda simulada do post.', autor: 'perfil_teste' };
    if (!this.apify?.configured) throw new Error('Para ler Reels e TikToks a Memória usa o Apify, que é pago. Falta o APIFY_TOKEN no servidor.');
    const r = await this.apify.scrapeUrl(url);
    const it = r.items.find((x) => x && !x.error) as Record<string, unknown> | undefined;
    if (!it) throw new Error('O Apify não achou esse post. Ele pode ser privado ou ter sido apagado.');
    const video = (it.videoUrl ?? (it.mediaUrls as string[] | undefined)?.[0] ?? (it.videoMeta as Record<string, string> | undefined)?.downloadAddr ?? '') as string;
    return {
      videoUrl: String(video || ''),
      legenda: String(it.caption ?? it.text ?? it.description ?? '').slice(0, 3000),
      autor: String(it.ownerUsername ?? (it.authorMeta as Record<string, string> | undefined)?.name ?? ''),
    };
  }

  /** Baixa o vídeo e transcreve. Sem transcrição configurada, ou vídeo acima de 25 MB, segue sem. */
  private async transcrever(orgId: string, videoUrl: string): Promise<string> {
    if (!this.transcricao?.configured) return '';
    try {
      const arquivo = await baixarAte(videoUrl, MAX_BYTES_DE_AUDIO);
      if (!arquivo) return '';
      const tipo = arquivo.tipo.startsWith('video/') || arquivo.tipo.startsWith('audio/') ? arquivo.tipo : 'video/mp4';
      const t = await this.transcricao.transcrever({ orgId, audio: arquivo.dados, mimetype: tipo, nome: 'video.mp4' });
      return t.texto.trim();
    } catch (e) {
      this.log.warn(`transcrição: ${e instanceof Error ? e.message : e}`);
      return '';
    }
  }

  private async analisar<T>(orgId: string, system: string, user: string, simulado: () => T): Promise<T> {
    if (simulada()) return simulado();
    if (!this.llm.configured) throw new Error(`IA não configurada: falta a credencial do provider "${this.llm.name}".`);
    const saida = await this.llm.complete({ funcao: 'CT-20', system, user, orgId, maxTokens: 1500 });
    const bruto = jsonDaIa<T>(saida);
    return JSON.parse(JSON.stringify(bruto), (_k, v) => (typeof v === 'string' ? semTravessao(v) : v)) as T;
  }

  // ---------- espelho no Drive (Obsidian) ----------

  private async pastaNoDrive(orgId: string, pasta: string): Promise<string> {
    const chave = `${orgId}:${pasta}`;
    const cache = this.pastasNoDrive.get(chave);
    if (cache) return cache;
    let pai = this.raizNoDrive;
    for (const nome of [...MEMORIA_PASTA_NO_DRIVE, pasta]) {
      const achadas = await this.google!.filhosDaPasta(orgId, pai, { nome, soPastas: true });
      pai = achadas[0]?.id ?? (await this.google!.criarPasta(orgId, pai, nome)).id;
    }
    this.pastasNoDrive.set(chave, pai);
    return pai;
  }

  /** Grava o .md da nota no Drive. Devolve se deu certo; a falha fica no log e a nota segue no OS. */
  private async espelharNoDrive(orgId: string, id: string): Promise<boolean> {
    if (!this.google || process.env.MEMORIA_DRIVE_DESLIGADO === '1') return false;
    try {
      const n = await this.prisma.marketingNota.findFirst({ where: { id, orgId } });
      if (!n || n.status !== 'pronto') return false;
      const folderId = await this.pastaNoDrive(orgId, n.pasta);
      const conteudo = arquivoDaNota({ ...n, criadaEm: n.criadaEm.toISOString(), atualizadaEm: n.atualizadaEm.toISOString() });
      const r = await this.google.gravarArquivoNoDrive(orgId, { folderId, nome: `${nomeDeArquivo(n.titulo)}.md`, conteudo, mimeType: 'text/markdown' });
      await this.prisma.marketingNota.update({ where: { id }, data: { driveFileId: r.id, driveEm: new Date() } });
      return true;
    } catch (e) {
      this.log.warn(`Drive (nota ${id}): ${e instanceof Error ? e.message : e}`);
      return false;
    }
  }

  private async achar(orgId: string, id: string): Promise<MarketingNota> {
    const n = await this.prisma.marketingNota.findFirst({ where: { id, orgId } });
    if (!n) throw new NotFoundException('Nota não encontrada.');
    return n;
  }
}
