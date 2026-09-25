import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INSTAGRAM_ESCOPO_DE_PUBLICAR,
  PAUTA_CHAVE_DA_PUBLICACAO_AUTOMATICA,
  PAUTA_FORA_DO_LOTE_YOUTUBE,
  PAUTA_MARCADOR_DA_PAGINA_DE_LINKS,
  YOUTUBE_ANTECEDENCIA_DA_PUBLICACAO_MS,
  YOUTUBE_ANTECEDENCIA_DO_ENVIO_MS,
  YOUTUBE_USOS_DO_ENVIO,
  instanteNoFuso,
} from '@mktos/shared';
import { ApprovalsService } from '../src/approvals/approvals.service';
import { LotesService } from '../src/approvals/lotes.service';
import { AssinaturaDeLoteService } from '../src/approvals/assinatura-de-lote.service';
import { ReauthService } from '../src/auth/reauth.service';
import { AuditService } from '../src/audit/audit.service';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { AcoesService } from '../src/gateway/acoes.service';
import { PortaDoOperador, type AcaoRetida } from '../src/gateway/porta-do-operador.service';
import { InterruptoresRegistry } from '../src/gateway/interruptores.registry';
import { ConectoresService } from '../src/integrations/conectores.service';
import { comContexto } from '../src/common/contexto-execucao';
import { cifrar, decifrar } from '../src/common/crypto';
import type { GraphDePublicacao } from '../src/pauta/graph-de-publicacao';
import { PublicacaoInstagramService } from '../src/pauta/publicacao-instagram.service';
import { LoteDaSemanaService } from '../src/pauta/lote-da-semana.service';
import { EnvioAoYoutubeService } from '../src/pauta/envio-ao-youtube.service';
import type { ClienteDoYoutube, MetadadosDoVideo, VideoNoYoutube } from '../src/pauta/cliente-do-youtube';
import type { MemoriaService } from '../src/memory/memoria.service';
import type { StorageService } from '../src/storage/storage.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * MD10 — O YOUTUBE, COM O BANCO E A PORTA DE VERDADE.
 *
 * O serviço montado à mão, com a política semeada, o lote da semana (MD7/MD8)
 * assinado por outra pessoa e um YouTube de mentira que registra cada chamada:
 * sem lote, ou com a auditoria pendente, a sessão é recusada e o YouTube não
 * recebe nada; com o lote assinado, a sessão sai pela porta (sempre privada), o
 * vídeo é conferido e ganha a thumb; o modo teste recusa a publicação, a nota
 * desligada também, e o pacote mudado depois da assinatura não agenda. Com
 * tudo certo, o `publishAt` sai uma vez só.
 */

class YoutubeFalso implements ClienteDoYoutube {
  chamadas: Array<{ metodo: string; args: unknown[] }> = [];
  metadados: MetadadosDoVideo | null = null;
  /** O que o `videos.list` devolve para cada id; ausente = o vídeo não existe. */
  videos = new Map<string, VideoNoYoutube>();
  /** O Google estreitou o token do Mac ao escopo de envio? */
  soEnvio = true;
  /** O canal que a autorização alcança. */
  canal: string | null = 'UCreal';
  tokensForcados = 0;
  private sessao = 0;
  /** O vídeo que cada sessão resumable criou (ausente = o upload não terminou). */
  videoDaSessao = new Map<string, string>();
  /** A playlist de uploads do canal. */
  uploads: Array<{ videoId: string; privacidade: string | null; enviadoEm: string | null }> = [];

  async conectado(): Promise<boolean> {
    return true;
  }
  async tokenDoEnvio(_org: string, o: { forcar?: boolean } = {}): Promise<{ token: string; expiraEm: Date; soEnvio: boolean }> {
    if (o.forcar) this.tokensForcados++;
    return { token: 'at-curto', expiraEm: new Date(Date.now() + 3600_000), soEnvio: this.soEnvio };
  }
  async canalConectado(): Promise<string | null> {
    return this.canal;
  }
  urlDoVideo(id: string): string {
    return `https://video.teste/${id}`;
  }
  async abrirSessao(_org: string, e: { bytes: number; mime: string; metadados: MetadadosDoVideo }): Promise<string> {
    this.chamadas.push({ metodo: 'abrirSessao', args: [e] });
    this.metadados = e.metadados;
    return `https://upload.teste/sessao/${++this.sessao}`;
  }
  async resultadoDaSessao(_org: string, uri: string, bytes: number): Promise<{ videoId: string | null; recebidos: number }> {
    this.chamadas.push({ metodo: 'resultadoDaSessao', args: [uri, bytes] });
    const videoId = this.videoDaSessao.get(uri) ?? null;
    return { videoId, recebidos: videoId ? bytes : 0 };
  }
  async uploadsDoCanal(): Promise<Array<{ videoId: string; privacidade: string | null; enviadoEm: string | null }>> {
    this.chamadas.push({ metodo: 'uploadsDoCanal', args: [] });
    return this.uploads;
  }
  async lerVideo(_org: string, id: string): Promise<VideoNoYoutube | null> {
    this.chamadas.push({ metodo: 'lerVideo', args: [id] });
    return this.videos.get(id) ?? null;
  }
  async definirThumb(_org: string, id: string, png: Buffer): Promise<void> {
    this.chamadas.push({ metodo: 'definirThumb', args: [id, createHash('sha256').update(png).digest('hex')] });
  }
  async inserirNaPlaylist(_org: string, playlist: string, id: string): Promise<string> {
    this.chamadas.push({ metodo: 'inserirNaPlaylist', args: [playlist, id] });
    return 'pli-1';
  }
  async agendar(_org: string, id: string, quando: Date): Promise<VideoNoYoutube> {
    this.chamadas.push({ metodo: 'agendar', args: [id, quando.toISOString()] });
    const v = this.videos.get(id)!;
    const agendado = { ...v, publishAt: quando.toISOString(), privacidade: 'private' };
    this.videos.set(id, agendado);
    return agendado;
  }
  /** O vídeo que o Mac "subiu" pela última sessão aberta: o que a sessão levou, privado. */
  subiu(id: string, extra: Partial<VideoNoYoutube> = {}) {
    const m = this.metadados!;
    this.videos.set(id, { id, titulo: m.titulo, descricao: m.descricao, categoria: m.categoria, privacidade: 'private', publishAt: null, uploadStatus: 'uploaded', ...extra });
    this.videoDaSessao.set(`https://upload.teste/sessao/${this.sessao}`, id);
  }
  /** Um vídeo que entrou no canal POR FORA da sessão (o Studio, ou o token do Mac usado à parte). */
  porFora(id: string, extra: Partial<VideoNoYoutube> = {}) {
    const m = this.metadados!;
    this.videos.set(id, { id, titulo: m.titulo, descricao: m.descricao, categoria: m.categoria, privacidade: 'private', publishAt: null, uploadStatus: 'uploaded', ...extra });
  }
  escritas() {
    return this.chamadas.filter((c) => !['lerVideo', 'resultadoDaSessao', 'uploadsDoCanal'].includes(c.metodo));
  }
}

const URL = process.env.TEST_DATABASE_URL;
if (URL) exigirBancoDescartavel(URL, 'ESCREVE nele (uma empresa, duas pessoas, um episódio, lotes, aprovações, o envio ao YouTube e RASTRO)');

const ORG = 'org-md10-youtube';
const SENHA = 'senha-da-titular-md10';
const SUFIXO = `md10-${Date.now().toString(36)}`;
/** Terça, 10h em São Paulo. */
const INICIO = instanteNoFuso('2026-09-01', '10:00');
/** O vídeo vai ao ar na quinta, 18h em São Paulo. */
const HORARIO = instanteNoFuso('2026-09-03', '18:00');
const PNG = Buffer.from('um-png-da-thumb-de-teste-md10');
const SHA_DO_PNG = createHash('sha256').update(PNG).digest('hex');
const ARQUIVO = { sha256: 'c'.repeat(64), bytes: 314_572_800, mime: 'video/mp4' as const };

describe.skipIf(!URL)('MD10: o vídeo do episódio no YouTube, pela porta e pelo lote da semana', () => {
  let prisma: PrismaClient;
  let approvals: ApprovalsService;
  let acoes: AcoesService;
  let lotes: LotesService;
  let assinatura: AssinaturaDeLoteService;
  let semana: LoteDaSemanaService;
  let youtube: EnvioAoYoutubeService;
  let conectores: ConectoresService;
  const falso = new YoutubeFalso();
  let nota: { body: string; arquivadoEm: string | null } | null = null;
  const id = { proponente: '', titular: '', episodio: '', rodada: '', pagina: '' };
  const ambienteAntes: Record<string, string | undefined> = {};
  const AMBIENTE = ['YOUTUBE_AUDITORIA', 'YOUTUBE_CANAL_DE_TESTE', 'PUBLIC_BIO_ORIGIN', 'ENCRYPTION_KEY', 'GATEWAY_MODO'];

  const naEmpresa = <T>(fn: () => Promise<T>, correlationId = 'clique-md10'): Promise<T> => comContexto({ orgId: ORG, correlationId, origem: 'http' }, fn);
  const rotina = (c: string) => comContexto({ orgId: ORG, correlationId: c, origem: 'cron' }, () => youtube.olharOHorario(ORG, c));
  const envio = () => prisma.envioAoYoutube.findFirst({ where: { orgId: ORG, episodioId: id.episodio } });
  const itens = async () => (await prisma.itemDoLote.findMany({ where: { orgId: ORG, estado: { not: 'revogado' } }, orderBy: { capabilityId: 'asc' } }));

  /** Um episódio por rodada: os de apoio ganham a rodada deles. */
  const novaRodada = async (titulo: string) =>
    (await prisma.pautaRodada.create({ data: { orgId: ORG, status: 'curada', titulo, janelaIni: INICIO, janelaFim: INICIO } })).id;

  async function assinar(loteId: string) {
    const r = (await naEmpresa(() => assinatura.pedirAssinatura(ORG, loteId, id.proponente))) as AcaoRetida;
    await naEmpresa(() => approvals.confirm(ORG, r.approvalId, { id: id.titular, papeis: ['admin_master'], reauth: { senha: SENHA } }, 'conferi o vídeo, o título, a thumb e o horário'));
    return naEmpresa(() => acoes.executarAprovada(ORG, r.approvalId, id.titular));
  }

  beforeAll(async () => {
    vi.setSystemTime(INICIO);
    for (const k of AMBIENTE) ambienteAntes[k] = process.env[k];
    process.env.GATEWAY_MODO = 'impor';
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
    process.env.PUBLIC_BIO_ORIGIN = 'https://bio.teste';
    process.env.YOUTUBE_AUDITORIA = 'aprovada';

    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    await prisma.org.upsert({
      where: { id: ORG },
      create: { id: ORG, name: 'YouTube MD10', slug: 'youtube-md10', modulos: ['pauta', 'bio'] },
      update: { modulos: ['pauta', 'bio'] },
    });
    const admin = await prisma.role.upsert({
      where: { orgId_key: { orgId: ORG, key: 'admin_master' } },
      create: { orgId: ORG, key: 'admin_master', name: 'Admin Master' },
      update: {},
      select: { id: true },
    });
    const usuario = async (email: string) =>
      (
        await prisma.user.upsert({
          where: { email },
          create: { orgId: ORG, email, name: email, passwordHash: await bcrypt.hash(SENHA, 4), roles: { connect: { id: admin.id } } },
          update: {},
          select: { id: true },
        })
      ).id;
    id.proponente = await usuario(`proponente@${SUFIXO}`);
    id.titular = await usuario(`titular@${SUFIXO}`);

    await prisma.bioConexao.deleteMany({ where: { orgId: ORG } });
    await prisma.bioConexao.create({
      data: {
        orgId: ORG,
        plataforma: 'instagram',
        externalId: 'ig-root',
        handle: 'operacaoroot',
        tokenCifrado: cifrar('token-de-publicacao'),
        escopos: `instagram_business_basic,${INSTAGRAM_ESCOPO_DE_PUBLICAR}`,
        finalidade: 'publicacao',
        expiraEm: new Date(Date.now() + 50 * 86_400_000),
      },
    });
    id.pagina = (await prisma.bioPage.create({ data: { orgId: ORG, handle: `youtube-md10-${SUFIXO}`, titulo: 'Links do ep-01', publicada: true } })).id;
    id.rodada = (await prisma.pautaRodada.create({ data: { orgId: ORG, status: 'curada', titulo: 'Rodada MD10', janelaIni: INICIO, janelaFim: INICIO } })).id;
    id.episodio = (
      await prisma.pautaEpisodio.create({
        data: {
          rodadaId: id.rodada,
          numero: 1,
          titulo: 'Semana 36',
          status: 'derivacao',
          bioPageId: id.pagina,
          titulos: [
            { texto: 'Agentes no escritório: o que já dá para fazer', angulo: 'resultado', escolhido: true },
            { texto: 'Três agentes que valem a pena', angulo: 'lista', escolhido: false },
          ],
          descricao: `O episódio da semana, com as matérias e os capítulos.\n\nOs links: ${PAUTA_MARCADOR_DA_PAGINA_DE_LINKS}`,
          thumbs: [
            { n: 1, texto: 'agentes', destaque: 'agentes', tempoSeg: 3, imagem: { chave: `pauta/thumb/ep-1-${SHA_DO_PNG.slice(0, 12)}.png`, sha: SHA_DO_PNG.slice(0, 12), bytes: PNG.length, largura: 1280, altura: 720, enviadaEm: INICIO.toISOString() } },
            { n: 2, texto: 'sem imagem', destaque: 'sem', tempoSeg: 9 },
          ],
          midia: { arquivoBruto: '/Users/pedro/Movies/OBS/bruto.mkv', arquivoFinal: '/Users/pedro/Movies/OBS/root-midia/ep-01/final.mp4', duracaoSeg: 1800, cortes: [], palavraDeCorte: null, editor: 'ffmpeg', recebidaEm: INICIO.toISOString() },
        },
      })
    ).id;

    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    const policy = new PolicyService(p);
    await policy.onModuleInit();
    const reauth = new ReauthService(p, new JwtService({ secret: 'segredo-md10' }), audit);
    approvals = new ApprovalsService(p, audit, reauth);
    lotes = new LotesService(p, policy, audit);
    const eventos = new EventLogService(p);
    const registro = new EfeitosRegistry();
    const interruptores = new InterruptoresRegistry();
    conectores = new ConectoresService(p, audit, eventos, interruptores);
    conectores.onModuleInit();
    const gateway = new ToolGateway(p, policy, new SinaisService(p, policy), approvals, eventos, undefined, interruptores, registro, lotes);
    acoes = new AcoesService(p, gateway, eventos, interruptores, policy);
    const porta = new PortaDoOperador(gateway, registro);
    assinatura = new AssinaturaDeLoteService(p, lotes, registro, porta);
    assinatura.onModuleInit();
    const memoria = {
      porChave: async (_org: string, chave: string) => (chave === PAUTA_CHAVE_DA_PUBLICACAO_AUTOMATICA ? nota : null),
    } as unknown as MemoriaService;
    const storage = {
      get: async (chave: string) => {
        if (!chave.includes(SHA_DO_PNG.slice(0, 12))) throw new Error('não existe');
        return { stream: Readable.from([PNG]), contentType: 'image/png', size: PNG.length };
      },
    } as unknown as StorageService;
    const graph = {} as GraphDePublicacao;
    const publicacao = new PublicacaoInstagramService(p, audit, registro, interruptores, porta, memoria, graph, lotes);
    publicacao.onModuleInit();
    youtube = new EnvioAoYoutubeService(p, audit, registro, interruptores, porta, memoria, storage, falso, lotes);
    youtube.onModuleInit();
    semana = new LoteDaSemanaService(p, audit, lotes, publicacao, youtube);
    semana.onModuleInit();
  });

  afterAll(async () => {
    vi.useRealTimers();
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
      prisma.$executeRawUnsafe('DELETE FROM "EventLog" WHERE "orgId" = $1', ORG),
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
    ]);
    await prisma.itemDoLote.deleteMany({ where: { orgId: ORG } });
    await prisma.aprovacaoDeLote.deleteMany({ where: { orgId: ORG } });
    await prisma.envioAoYoutube.deleteMany({ where: { orgId: ORG } });
    await prisma.pautaEpisodio.deleteMany({ where: { orgId: ORG } });
    await prisma.pautaRodada.deleteMany({ where: { orgId: ORG } });
    await prisma.bioPage.deleteMany({ where: { orgId: ORG } });
    await prisma.bioConexao.deleteMany({ where: { orgId: ORG } });
    await prisma.approval.deleteMany({ where: { orgId: ORG } });
    await prisma.toolCall.deleteMany({ where: { orgId: ORG } });
    await prisma.policyDecision.deleteMany({ where: { orgId: ORG } });
    await prisma.conectorDesligado.deleteMany({ where: { orgId: ORG } });
    await prisma.auditLog.deleteMany({ where: { orgId: ORG } });
    await prisma.user.deleteMany({ where: { orgId: ORG } });
    await prisma.role.deleteMany({ where: { orgId: ORG } });
    await prisma.org.deleteMany({ where: { id: ORG } });
    await prisma.$disconnect();
    for (const k of AMBIENTE) {
      if (ambienteAntes[k] === undefined) delete process.env[k];
      else process.env[k] = ambienteAntes[k];
    }
  });

  beforeEach(() => {
    falso.chamadas = [];
    process.env.YOUTUBE_AUDITORIA = 'aprovada';
    delete process.env.YOUTUBE_CANAL_DE_TESTE;
  });

  // Os casos dependem da ordem: é o vídeo de um episódio, do pacote ao horário.

  it('o pacote: a thumb e o horário do vídeo; o Mac declara o arquivo; sem isso, as faltas dizem o que fazer', async () => {
    const antes = await naEmpresa(() => youtube.doEpisodio(ORG, id.episodio));
    expect(antes.faltas).toEqual(expect.arrayContaining([expect.stringMatching(/--declarar/)]));
    expect(antes.arquivoFinal).toBe('/Users/pedro/Movies/OBS/root-midia/ep-01/final.mp4');
    await expect(naEmpresa(() => youtube.escolherThumb(ORG, id.episodio, id.proponente, 3))).rejects.toThrow(/não tem a thumb 3/);
    await expect(naEmpresa(() => youtube.definirHorario(ORG, id.episodio, id.proponente, new Date(INICIO.getTime() - 60_000)))).rejects.toThrow(/já passou/);
    await naEmpresa(() => youtube.definirHorario(ORG, id.episodio, id.proponente, HORARIO));
    await naEmpresa(() => youtube.declararArquivo(ORG, id.episodio, id.proponente, ARQUIVO));
    // A thumb 2 ainda não tem imagem: a falta aponta o Mac.
    const semImagem = await naEmpresa(() => youtube.escolherThumb(ORG, id.episodio, id.proponente, 2));
    expect(semImagem.faltas).toEqual([expect.stringMatching(/root-midia thumbs/)]);
    const pronto = await naEmpresa(() => youtube.escolherThumb(ORG, id.episodio, id.proponente, 1));
    expect(pronto).toMatchObject({ auditoria: 'aprovada', thumbEscolhida: 1, publicarEm: HORARIO.toISOString(), faltas: [], itens: [] });
    expect(pronto.envio).toMatchObject({ estado: 'declarado', sha256: ARQUIVO.sha256, bytes: ARQUIVO.bytes });
    // Declarar o mesmo arquivo de novo não mexe em nada.
    await naEmpresa(() => youtube.declararArquivo(ORG, id.episodio, id.proponente, ARQUIVO));
    expect(await prisma.auditLog.count({ where: { orgId: ORG, action: 'pauta.youtube_arquivo' } })).toBe(1);
  });

  it('sem lote, a sessão é recusada, e o YouTube não recebe NADA', async () => {
    await expect(naEmpresa(() => youtube.abrirSessao(ORG, id.episodio, id.proponente, ARQUIVO))).rejects.toThrow(/Não há item de envio ao YouTube num lote assinado/);
    expect(falso.chamadas).toEqual([]);
    expect(await prisma.toolCall.count({ where: { orgId: ORG } })).toBe(0);
  });

  it('com a auditoria pendente (o padrão), a sessão é recusada antes de tudo, e o YouTube fica de fora do lote', async () => {
    process.env.YOUTUBE_AUDITORIA = '';
    await expect(naEmpresa(() => youtube.abrirSessao(ORG, id.episodio, id.proponente, ARQUIVO))).rejects.toThrow(/PRIVADO PARA SEMPRE/);
    await expect(naEmpresa(() => youtube.concluir(ORG, id.episodio, id.proponente, 'vid-1'))).rejects.toThrow(/PRIVADO PARA SEMPRE/);
    expect(falso.chamadas).toEqual([]);
    const e = await naEmpresa(() => semana.estado(ORG, id.episodio, id.proponente));
    expect(e.youtube).toMatchObject({ entra: false, capacidades: [] });
    expect(e.youtube.faltas[0]).toMatch(/YOUTUBE_AUDITORIA=pendente/);
    await expect(naEmpresa(() => semana.preparar(ORG, id.episodio, id.proponente, []))).rejects.toThrow(/Não há peça para aprovar/);
  });

  let loteId = '';

  it('o lote da semana leva os dois itens do YouTube, com as janelas e o conteúdo exato; mudar o arquivo derruba os itens do lote montado', async () => {
    const e = await naEmpresa(() => semana.estado(ORG, id.episodio, id.proponente));
    expect(e.youtube).toMatchObject({ entra: true, faltas: [], capacidades: ['youtube.video.enviar', 'youtube.video.publicar'], publicarEm: HORARIO.toISOString() });

    const primeiro = await naEmpresa(() => semana.preparar(ORG, id.episodio, id.proponente, []));
    expect(primeiro.itens).toBe(2);
    // O Mac mediu outro arquivo: o lote montado não cobre mais o vídeo.
    await naEmpresa(() => youtube.declararArquivo(ORG, id.episodio, id.proponente, { ...ARQUIVO, sha256: 'd'.repeat(64) }));
    expect((await lotes.detalhe(ORG, primeiro.loteId)).itens.every((i) => i.estado === 'revogado')).toBe(true);
    await naEmpresa(() => youtube.declararArquivo(ORG, id.episodio, id.proponente, ARQUIVO));

    // "Fica fora" do YouTube: sem peça do Instagram, não há o que aprovar.
    await expect(naEmpresa(() => semana.preparar(ORG, id.episodio, id.proponente, [PAUTA_FORA_DO_LOTE_YOUTUBE]))).rejects.toThrow(/Não há peça para aprovar/);

    const m = await naEmpresa(() => semana.preparar(ORG, id.episodio, id.proponente, []));
    loteId = m.loteId;
    const d = await lotes.detalhe(ORG, m.loteId);
    expect(d.resumo).toMatch(/o vídeo no YouTube \(envio privado e agendamento\) para 03\/09 18:00/);
    const doEnvio = d.itens.find((i) => i.capabilityId === 'youtube.video.enviar')!;
    const daPublicacao = d.itens.find((i) => i.capabilityId === 'youtube.video.publicar')!;
    expect(doEnvio).toMatchObject({ recursoId: id.episodio, usoMaximo: YOUTUBE_USOS_DO_ENVIO, janelaAte: new Date(HORARIO.getTime() - YOUTUBE_ANTECEDENCIA_DO_ENVIO_MS).toISOString() });
    expect(daPublicacao).toMatchObject({ recursoId: id.episodio, janelaAte: new Date(HORARIO.getTime() - YOUTUBE_ANTECEDENCIA_DA_PUBLICACAO_MS).toISOString() });

    // O que a titular lê: o título, a descrição com a página no ar, a thumb, o arquivo e o horário.
    const c = await naEmpresa(() => semana.conteudo(ORG, m.loteId));
    expect(c).toMatchObject({ total: 2, divergentes: 0, itens: [] });
    const lido = c.youtube.find((i) => i.capabilityId === 'youtube.video.publicar')!;
    expect(lido).toMatchObject({
      titulo: 'Agentes no escritório: o que já dá para fazer',
      thumbN: 1,
      categoria: '28',
      arquivo: { sha256Curto: 'c'.repeat(12), bytes: ARQUIVO.bytes },
      publicarEm: HORARIO.toISOString(),
      divergente: null,
    });
    expect(lido.descricao).toContain(`https://bio.teste/@youtube-md10-${SUFIXO}`);
    expect(lido.descricao).not.toContain(PAUTA_MARCADOR_DA_PAGINA_DE_LINKS);

    // Antes da assinatura, a sessão ainda é recusada.
    await expect(naEmpresa(() => youtube.abrirSessao(ORG, id.episodio, id.proponente, ARQUIVO))).rejects.toThrow(/ainda não foi assinado/);
    expect(falso.chamadas).toEqual([]);
  });

  it('a titular assina: o lote fica ativo, e o vigia do Mac vê o episódio na fila do YouTube', async () => {
    const exec = await assinar(loteId);
    expect(exec.status).toBe('executado');
    expect(await lotes.detalhe(ORG, loteId)).toMatchObject({ estado: 'ativo', aprovadoPorId: id.titular });
    expect((await itens()).every((i) => i.estado === 'ativo')).toBe(true);
    const fila = await naEmpresa(() => youtube.pendentes(ORG));
    expect(fila.items).toEqual([expect.objectContaining({ id: id.episodio, apelido: 'ep-01', sha256: ARQUIVO.sha256, estado: 'declarado' })]);
  });

  it('o token largo não sai ao Mac com a auditoria aprovada, e o modo teste só abre para o canal de teste — sem gastar uso nem chamar o YouTube', async () => {
    // O Google ignorou o escopo só de envio: o token publicaria e apagaria vídeo fora do lote.
    falso.soEnvio = false;
    await expect(naEmpresa(() => youtube.abrirSessao(ORG, id.episodio, id.proponente, ARQUIVO))).rejects.toThrow(/mais que o escopo de envio/);
    falso.soEnvio = true;
    process.env.YOUTUBE_AUDITORIA = 'teste';
    await expect(naEmpresa(() => youtube.abrirSessao(ORG, id.episodio, id.proponente, ARQUIVO))).rejects.toThrow(/exige YOUTUBE_CANAL_DE_TESTE/);
    process.env.YOUTUBE_CANAL_DE_TESTE = 'UCteste';
    await expect(naEmpresa(() => youtube.abrirSessao(ORG, id.episodio, id.proponente, ARQUIVO))).rejects.toThrow(/\(UCreal\) não é o canal de teste/);
    expect(falso.chamadas).toEqual([]);
    expect(await prisma.toolCall.count({ where: { orgId: ORG, capabilityId: 'youtube.video.enviar' } })).toBe(0);
    expect((await itens()).find((i) => i.capabilityId === 'youtube.video.enviar')!.usos).toBe(0);
  });

  let uri = '';

  it('a sessão sai pela porta com o uso contado, SEMPRE privada; a URI fica cifrada, e pedir de novo devolve a mesma sem gastar uso', async () => {
    await expect(naEmpresa(() => youtube.abrirSessao(ORG, id.episodio, id.proponente, { ...ARQUIVO, bytes: ARQUIVO.bytes + 1 }))).rejects.toThrow(/não é o vídeo final declarado/);
    expect(falso.chamadas).toEqual([]);

    const s = await naEmpresa(() => youtube.abrirSessao(ORG, id.episodio, id.proponente, ARQUIVO));
    uri = s.uri;
    expect(s).toMatchObject({ uri: 'https://upload.teste/sessao/1', token: 'at-curto', bytes: ARQUIVO.bytes, sha256: ARQUIVO.sha256, nova: true });
    expect(falso.escritas()).toEqual([
      {
        metodo: 'abrirSessao',
        args: [
          {
            bytes: ARQUIVO.bytes,
            mime: 'video/mp4',
            metadados: expect.objectContaining({ titulo: 'Agentes no escritório: o que já dá para fazer', categoria: '28' }),
          },
        ],
      },
    ]);
    const r = (await envio())!;
    expect(r).toMatchObject({ estado: 'sessao_aberta', sessoes: 1 });
    expect(r.sessaoCifrada).not.toContain('upload.teste');
    expect(decifrar(r.sessaoCifrada!)).toBe(uri);
    const item = (await itens()).find((i) => i.capabilityId === 'youtube.video.enviar')!;
    expect(item.usos).toBe(1);
    // O RASTRO da porta não leva a sessão nem o token.
    const tc = await prisma.toolCall.findFirstOrThrow({ where: { orgId: ORG, capabilityId: 'youtube.video.enviar' } });
    expect(JSON.stringify(tc)).not.toMatch(/upload\.teste|at-curto/);

    falso.chamadas = [];
    const deNovo = await naEmpresa(() => youtube.abrirSessao(ORG, id.episodio, id.proponente, ARQUIVO));
    expect(deNovo).toMatchObject({ uri, nova: false });
    const token = await naEmpresa(() => youtube.novoToken(ORG, id.episodio, id.proponente));
    expect(token).toMatchObject({ uri, token: 'at-curto' });
    expect(falso.chamadas).toEqual([]);
    // O Mac só pede token por causa de um 401: o guardado é descartado.
    expect(falso.tokensForcados).toBe(1);
    expect((await itens()).find((i) => i.capabilityId === 'youtube.video.enviar')!.usos).toBe(1);
    // Cada entrega do token ao Mac vai ao RASTRO, sem o token nem a URI.
    const entregas = await prisma.auditLog.findMany({ where: { orgId: ORG, action: 'pauta.youtube_token_entregue' } });
    expect(entregas).toHaveLength(3);
    expect(entregas.map((x) => x.actorId)).toEqual([id.proponente, id.proponente, id.proponente]);
    expect(entregas.map((x) => (x.after as { renovado: boolean; soEnvio: boolean }).renovado).sort()).toEqual([false, false, true]);
    expect(entregas.every((x) => (x.after as { soEnvio: boolean }).soEnvio)).toBe(true);
    expect(JSON.stringify(entregas)).not.toMatch(/at-curto|upload\.teste/);
  });

  it('fora da janela do envio (1 h antes do horário), com o lote ainda de pé, nem a sessão nem o token saem, e o vigia não vê o episódio', async () => {
    vi.setSystemTime(new Date(HORARIO.getTime() - 30 * 60_000));
    try {
      expect((await lotes.detalhe(ORG, loteId)).estado).toBe('ativo');
      await expect(naEmpresa(() => youtube.novoToken(ORG, id.episodio, id.proponente))).rejects.toThrow(/janela do envio ao YouTube fechou/);
      await expect(naEmpresa(() => youtube.abrirSessao(ORG, id.episodio, id.proponente, ARQUIVO))).rejects.toThrow(/janela do envio ao YouTube fechou/);
      expect((await naEmpresa(() => youtube.pendentes(ORG))).items).toEqual([]);
      expect(falso.chamadas).toEqual([]);
    } finally {
      vi.setSystemTime(INICIO);
    }
    expect(await prisma.auditLog.count({ where: { orgId: ORG, action: 'pauta.youtube_token_entregue' } })).toBe(3);
  });

  it('o pacote mudado depois da assinatura: a sessão e o token são recusados, os itens caem e o vídeo volta ao "Aprovar a semana"; assinado de novo, a sessão aberta segue', async () => {
    const ep = await prisma.pautaEpisodio.findUniqueOrThrow({ where: { id: id.episodio } });
    await prisma.pautaEpisodio.update({ where: { id: id.episodio }, data: { descricao: `${ep.descricao}\n\nUma linha a mais.` } });
    await expect(naEmpresa(() => youtube.abrirSessao(ORG, id.episodio, id.proponente, ARQUIVO))).rejects.toThrow(/mudou depois da assinatura.*revogado/);
    expect(await itens()).toEqual([]);
    await expect(naEmpresa(() => youtube.novoToken(ORG, id.episodio, id.proponente))).rejects.toThrow(/Não há item de envio/);
    expect(falso.chamadas).toEqual([]);
    // O vídeo não fica preso ao lote antigo: ele volta a entrar.
    expect((await naEmpresa(() => semana.estado(ORG, id.episodio, id.proponente))).youtube).toMatchObject({ entra: true, capacidades: ['youtube.video.enviar', 'youtube.video.publicar'] });
    await prisma.pautaEpisodio.update({ where: { id: id.episodio }, data: { descricao: ep.descricao } });

    const m = await naEmpresa(() => semana.preparar(ORG, id.episodio, id.proponente, []));
    expect(m.itens).toBe(2);
    loteId = m.loteId;
    expect((await assinar(loteId)).status).toBe('executado');
    // A sessão que já estava aberta é a mesma, sem gastar uso do item novo.
    const s = await naEmpresa(() => youtube.abrirSessao(ORG, id.episodio, id.proponente, ARQUIVO));
    expect(s).toMatchObject({ uri, nova: false });
    expect(falso.chamadas).toEqual([]);
    expect((await itens()).find((i) => i.capabilityId === 'youtube.video.enviar')!.usos).toBe(0);
  });

  it('com o YouTube desligado em /conexoes, nem o token da sessão sai', async () => {
    await naEmpresa(() => conectores.desligar(ORG, 'youtube', { motivo: 'incidente no canal' }));
    await expect(naEmpresa(() => youtube.novoToken(ORG, id.episodio, id.proponente))).rejects.toThrow(/desligado/);
    await expect(naEmpresa(() => youtube.abrirSessao(ORG, id.episodio, id.proponente, { ...ARQUIVO, nova: true }))).rejects.toThrow(/desligado/);
    expect(falso.chamadas).toEqual([]);
    await naEmpresa(() => conectores.religar(ORG, 'youtube'));
  });

  it('o "concluído" pergunta à sessão aberta pelo OS qual vídeo ela criou: o upload inacabado e o id de outro vídeo (mesmo com o mesmo título) são recusados sem gravar nada', async () => {
    const usosAntes = (await itens()).find((i) => i.capabilityId === 'youtube.video.enviar')!.usos;
    // O Mac ainda não terminou: a sessão não criou vídeo nenhum.
    await expect(naEmpresa(() => youtube.concluir(ORG, id.episodio, id.proponente, 'nao-e-do-canal'))).rejects.toThrow(/não terminou/);
    expect(await envio()).toMatchObject({ estado: 'sessao_aberta', videoId: null });
    // Um editor sobe outro vídeo privado com o mesmo título, descrição e categoria, e informa o id dele.
    falso.porFora('vid-de-outro-arquivo');
    falso.subiu('vid-md10');
    await expect(naEmpresa(() => youtube.concluir(ORG, id.episodio, id.proponente, 'vid-de-outro-arquivo'))).rejects.toThrow(/não é o que a sessão aberta pelo OS recebeu/);
    expect(await envio()).toMatchObject({ estado: 'sessao_aberta', videoId: null });
    expect(falso.escritas()).toEqual([]);
    expect(falso.chamadas.filter((c) => c.metodo === 'resultadoDaSessao').map((c) => c.args)).toEqual([
      [uri, ARQUIVO.bytes],
      [uri, ARQUIVO.bytes],
    ]);
    expect((await itens()).find((i) => i.capabilityId === 'youtube.video.enviar')!.usos).toBe(usosAntes);
  });

  it('o "concluído" confere o vídeo: o da sessão que sumiu do canal é recusado e solto, com a sessão reaproveitável; o certo, privado e com o assinado, ganha a thumb', async () => {
    const sumiu = falso.videos.get('vid-md10')!;
    falso.videos.delete('vid-md10');
    await expect(naEmpresa(() => youtube.concluir(ORG, id.episodio, id.proponente, 'vid-md10'))).rejects.toThrow(/não existe no canal/);
    expect(await envio()).toMatchObject({ estado: 'sessao_aberta', videoId: null, erro: expect.stringMatching(/não existe no canal/) });
    expect(falso.escritas()).toEqual([]);
    // A execução seguinte do Mac recebe a MESMA sessão (e pergunta ao YouTube o id), sem subir o arquivo de novo.
    expect(await naEmpresa(() => youtube.abrirSessao(ORG, id.episodio, id.proponente, ARQUIVO))).toMatchObject({ uri, nova: false });
    expect(falso.escritas()).toEqual([]);

    falso.videos.set('vid-md10', sumiu);
    // Na janela da sessão, o canal recebeu um vídeo PÚBLICO que o OS não abriu (o token do Mac usado à parte).
    falso.uploads = [
      { videoId: 'vid-md10', privacidade: 'private', enviadoEm: new Date().toISOString() },
      { videoId: 'vid-publico-por-fora', privacidade: 'public', enviadoEm: new Date().toISOString() },
      { videoId: 'vid-antigo', privacidade: 'public', enviadoEm: '2020-01-01T00:00:00Z' },
    ];
    const r = await naEmpresa(() => youtube.concluir(ORG, id.episodio, id.proponente, 'vid-md10'));
    expect(r.envio).toMatchObject({ estado: 'conferido', videoId: 'vid-md10', erro: expect.stringMatching(/ATENÇÃO: o canal recebeu 1 vídeo\(s\) não privado\(s\) que o OS não abriu.*vid-publico-por-fora/) });
    const alerta = await prisma.auditLog.findFirstOrThrow({ where: { orgId: ORG, action: 'pauta.youtube_upload_fora_do_lote' } });
    expect(alerta.after).toMatchObject({ videos: [{ videoId: 'vid-publico-por-fora', privacidade: 'public' }] });
    falso.uploads = [];
    expect(r.envio?.thumbDefinidaEm).not.toBeNull();
    expect(falso.escritas()).toEqual([{ metodo: 'definirThumb', args: ['vid-md10', SHA_DO_PNG] }]);
    expect((await envio())!.sessaoCifrada).toBeNull();
    // Concluir de novo com o mesmo id não gasta uso nem chama o YouTube.
    falso.chamadas = [];
    await naEmpresa(() => youtube.concluir(ORG, id.episodio, id.proponente, 'vid-md10'));
    expect(falso.chamadas).toEqual([]);
    expect((await itens()).find((i) => i.capabilityId === 'youtube.video.enviar')!.usos).toBe(2);
    expect((await naEmpresa(() => youtube.pendentes(ORG))).items).toEqual([]);
  });

  it('no modo teste a publicação é recusada: a rotina pula, e o efeito chamado direto recusa sem tocar no YouTube', async () => {
    nota = { body: 'ligada', arquivadoEm: null };
    process.env.YOUTUBE_AUDITORIA = 'teste';
    const passagem = await rotina('rotina-teste');
    expect(passagem).toEqual([{ rotulo: 'ep-01 youtube', resultado: 'pulada', detalhe: 'auditoria do YouTube não aprovada' }]);
    const item = (await itens()).find((i) => i.capabilityId === 'youtube.video.publicar')!;
    const { publicacao } = await youtube.argsAtuais(ORG, id.episodio);
    await expect(
      naEmpresa(() => youtube.efeitoDePublicar((publicacao as unknown as { args: Record<string, unknown> }).args, ORG, { orgId: ORG, loteItemId: item.id })),
    ).rejects.toThrow(/YOUTUBE_AUDITORIA=teste/);
    expect(falso.chamadas).toEqual([]);
  });

  it('com a nota da publicação automática desligada, a rotina também só pula — mesmo com a janela fechada, sem erro nem item derrubado', async () => {
    nota = null;
    const passagem = await rotina('rotina-desligada');
    expect(passagem).toEqual([{ rotulo: 'ep-01 youtube', resultado: 'pulada', detalhe: 'publicação automática desligada' }]);
    expect(falso.chamadas).toEqual([]);
    vi.setSystemTime(new Date(HORARIO.getTime() - 10 * 60_000));
    try {
      expect(await rotina('rotina-desligada-tarde')).toEqual([{ rotulo: 'ep-01 youtube', resultado: 'pulada', detalhe: 'publicação automática desligada' }]);
    } finally {
      vi.setSystemTime(INICIO);
    }
    expect((await itens()).find((i) => i.capabilityId === 'youtube.video.publicar')?.estado).toBe('ativo');
    expect((await envio())!.erro ?? '').not.toMatch(/janela/);
    expect(await prisma.auditLog.count({ where: { orgId: ORG, action: 'pauta.youtube_passo', after: { path: ['passo'], equals: 'pulada' } } })).toBe(2);
  });

  it('o pacote mudado depois da assinatura não agenda: o efeito recusa o conteúdo que não é o assinado', async () => {
    const item = (await itens()).find((i) => i.capabilityId === 'youtube.video.publicar')!;
    const { publicacao: assinada } = await youtube.argsAtuais(ORG, id.episodio);
    const ep = await prisma.pautaEpisodio.findUniqueOrThrow({ where: { id: id.episodio } });
    await prisma.pautaEpisodio.update({
      where: { id: id.episodio },
      data: { titulos: [{ texto: 'Um título trocado depois', angulo: 'x', escolhido: true }] },
    });
    // O conteúdo que a titular lê passa a acusar a divergência.
    const c = await naEmpresa(() => semana.conteudo(ORG, loteId));
    expect(c.youtube.find((i) => i.capabilityId === 'youtube.video.publicar')?.divergente).toMatch(/pacote do vídeo mudou/);
    await expect(
      naEmpresa(() => youtube.efeitoDePublicar((assinada as unknown as { args: Record<string, unknown> }).args, ORG, { orgId: ORG, loteItemId: item.id })),
    ).rejects.toThrow(/mudou depois da assinatura/);
    expect(falso.chamadas).toEqual([]);
    await prisma.pautaEpisodio.update({ where: { id: id.episodio }, data: { titulos: ep.titulos as object } });
  });

  it('com a nota ligada e a auditoria aprovada, a rotina relê o vídeo e manda o publishAt pela porta, UMA vez — e acha o da semana entre mais de 20 envios parados', async () => {
    nota = { body: 'ligada', arquivadoEm: null };
    // Episódios antigos com o vídeo declarado ou conferido e sem lote (a auditoria pendente, o modo teste): não tiram o da semana da rotina.
    for (let n = 100; n < 121; n++) {
      await prisma.pautaEpisodio.create({
        data: {
          rodadaId: await novaRodada(`Rodada antiga ${n}`),
          numero: n,
          titulo: `Antigo ${n}`,
          status: 'agendado',
          envioAoYoutube: { create: { sha256: n.toString(16).padStart(64, '0'), bytes: BigInt(1024), estado: n % 2 ? 'declarado' : 'conferido', videoId: n % 2 ? null : `antigo-${n}` } },
        },
      });
    }
    expect(await prisma.envioAoYoutube.count({ where: { orgId: ORG, estado: { not: 'agendado' } } })).toBeGreaterThan(20);
    const passagem = await rotina('rotina-agenda');
    expect(passagem).toEqual([{ rotulo: 'ep-01 youtube', resultado: 'agendada', detalhe: HORARIO.toISOString() }]);
    expect(falso.chamadas.map((c) => c.metodo)).toEqual(['lerVideo', 'agendar']);
    expect(falso.chamadas[1].args).toEqual(['vid-md10', HORARIO.toISOString()]);
    expect(await envio()).toMatchObject({ estado: 'agendado', videoId: 'vid-md10', publicarEm: HORARIO });
    const rastro = await prisma.auditLog.findFirstOrThrow({ where: { orgId: ORG, action: 'pauta.youtube_agendado' } });
    expect(rastro.after).toMatchObject({ videoId: 'vid-md10', publicarEm: HORARIO.toISOString() });
    const e = await naEmpresa(() => youtube.doEpisodio(ORG, id.episodio));
    expect(e.url).toBe('https://video.teste/vid-md10');
    // Os usos que sobraram dos dois itens caem: o lote se encerra.
    expect(e.itens).toEqual([]);
    expect((await lotes.detalhe(ORG, loteId)).estado).toBe('encerrado');
    // A thumb e o horário travam depois de agendado.
    await expect(naEmpresa(() => youtube.escolherThumb(ORG, id.episodio, id.proponente, 2))).rejects.toThrow(/já está agendado/);

    falso.chamadas = [];
    expect(await rotina('rotina-de-novo')).toEqual([]);
    expect(falso.chamadas).toEqual([]);
    // Depois de subir, o arquivo não troca pelo OS.
    await expect(naEmpresa(() => youtube.declararArquivo(ORG, id.episodio, id.proponente, { ...ARQUIVO, sha256: 'e'.repeat(64) }))).rejects.toThrow(/já subiu/);
  });

  it('o modo teste: o vídeo sobe ao canal de teste marcado como tal, nunca entra na publicação, e o mesmo arquivo declarado de novo recomeça para o canal real', async () => {
    const HORARIO_2 = instanteNoFuso('2026-09-05', '18:00');
    const ARQUIVO_2 = { sha256: 'f'.repeat(64), bytes: 1_048_576, mime: 'video/mp4' as const };
    const pagina = await prisma.bioPage.create({ data: { orgId: ORG, handle: `youtube-md10-2-${SUFIXO}`, titulo: 'Links do ep-02', publicada: true } });
    const ep = await prisma.pautaEpisodio.create({
      data: {
        rodadaId: await novaRodada('Rodada MD10 2'),
        numero: 2,
        titulo: 'Semana 37',
        status: 'derivacao',
        bioPageId: pagina.id,
        titulos: [{ texto: 'O teste no canal de teste', angulo: 'resultado', escolhido: true }],
        descricao: `O episódio 2.\n\nOs links: ${PAUTA_MARCADOR_DA_PAGINA_DE_LINKS}`,
        thumbs: [{ n: 1, texto: 't', destaque: 't', tempoSeg: 3, imagem: { chave: `pauta/thumb/ep-2-${SHA_DO_PNG.slice(0, 12)}.png`, sha: SHA_DO_PNG.slice(0, 12), bytes: PNG.length, largura: 1280, altura: 720, enviadaEm: INICIO.toISOString() } }],
        midia: { arquivoBruto: '/b.mkv', arquivoFinal: '/f2.mp4', duracaoSeg: 60, cortes: [], palavraDeCorte: null, editor: 'ffmpeg', recebidaEm: INICIO.toISOString() },
      },
    });
    process.env.YOUTUBE_AUDITORIA = 'teste';
    process.env.YOUTUBE_CANAL_DE_TESTE = 'UCteste';
    falso.canal = 'UCteste';
    try {
      await naEmpresa(() => youtube.definirHorario(ORG, ep.id, id.proponente, HORARIO_2));
      await naEmpresa(() => youtube.declararArquivo(ORG, ep.id, id.proponente, ARQUIVO_2));
      await naEmpresa(() => youtube.escolherThumb(ORG, ep.id, id.proponente, 1));
      expect((await naEmpresa(() => semana.estado(ORG, ep.id, id.proponente))).youtube).toMatchObject({ entra: true, capacidades: ['youtube.video.enviar'] });
      const m = await naEmpresa(() => semana.preparar(ORG, ep.id, id.proponente, []));
      expect((await lotes.detalhe(ORG, m.loteId)).resumo).toMatch(/só o envio privado, ao canal de teste/);
      await assinar(m.loteId);
      expect(await naEmpresa(() => youtube.abrirSessao(ORG, ep.id, id.proponente, ARQUIVO_2))).toMatchObject({ nova: true });
      falso.subiu('vid-teste');
      expect((await naEmpresa(() => youtube.concluir(ORG, ep.id, id.proponente, 'vid-teste'))).envio).toMatchObject({ estado: 'conferido', enviadoEmTeste: true });

      // A auditoria saiu: o vídeo do canal de teste não é oferecido para publicar, e o efeito recusa.
      process.env.YOUTUBE_AUDITORIA = 'aprovada';
      const depois = await naEmpresa(() => semana.estado(ORG, ep.id, id.proponente));
      expect(depois.youtube).toMatchObject({ entra: false, capacidades: [] });
      expect(depois.youtube.faltas.join(' ')).toMatch(/subiu no modo teste.*declare o vídeo final de novo/);
      const { publicacao } = await youtube.argsAtuais(ORG, ep.id);
      falso.chamadas = [];
      await expect(
        naEmpresa(() => youtube.efeitoDePublicar((publicacao as unknown as { args: Record<string, unknown> }).args, ORG, { orgId: ORG, loteItemId: 'item-qualquer' })),
      ).rejects.toThrow(/modo teste/);
      expect(falso.chamadas).toEqual([]);

      // O MESMO arquivo, declarado de novo, recomeça o envio para o canal real.
      await naEmpresa(() => youtube.declararArquivo(ORG, ep.id, id.proponente, ARQUIVO_2));
      expect(await prisma.envioAoYoutube.findFirst({ where: { episodioId: ep.id } })).toMatchObject({ estado: 'declarado', videoId: null, enviadoEmTeste: false, conferidoEm: null });
      expect((await naEmpresa(() => semana.estado(ORG, ep.id, id.proponente))).youtube).toMatchObject({
        entra: true,
        capacidades: ['youtube.video.enviar', 'youtube.video.publicar'],
      });
    } finally {
      falso.canal = 'UCreal';
    }
  });
});
