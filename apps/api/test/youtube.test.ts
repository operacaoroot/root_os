import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { JwtService } from '@nestjs/jwt';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PAUTA_MARCADOR_DA_PAGINA_DE_LINKS,
  ROLES,
  YOUTUBE_ANTECEDENCIA_DA_PUBLICACAO_MS,
  YOUTUBE_ANTECEDENCIA_DO_ENVIO_MS,
  YoutubeArquivoSchema,
  YoutubeConcluidoSchema,
  YoutubeSessaoSchema,
  PautaHorarioDoYoutubeSchema,
  bytesUtf8,
  faltasDoYoutube,
  motivoDaAuditoriaParaEnviar,
  motivoDaAuditoriaParaPublicar,
  youtubeAuditoria,
} from '@mktos/shared';
import { YoutubeService, TIPO_DO_ESTADO_DO_YOUTUBE, escoposCompletos, soOEscopoDoEnvio, urlDoFornecedor } from '../src/youtube/youtube.service';
import {
  argsDaPublicacao,
  argsDoEnvio,
  capacidadesDoLote,
  categoriaDaNota,
  divergenciaDoVideo,
  janelasDoYoutube,
  mesmosArgs,
  motivoDoCanalDeTeste,
  playlistDaNota,
  pngDaThumbConfere,
  problemaDoTexto,
  thumbEscolhida,
  type EpisodioParaOYoutube,
} from '../src/pauta/youtube-do-episodio';
import { ErroDoYoutube } from '../src/pauta/cliente-do-youtube';
import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import { EnvioAoYoutubeController, YoutubeDaPautaController } from '../src/pauta/envio-ao-youtube.controller';
import {
  BLOCO,
  MULTIPLO,
  TOKENS_SEGUIDOS,
  cabecalhoDoBloco,
  caminhoDoEstado,
  enviarAoYoutube,
  espera,
  proximoByte,
  tamanhoDoBloco,
} from '../../../tools/root-midia/lib/youtube.mjs';

/*
 * MD10 — O YOUTUBE PELA API.
 *
 * Sem banco: o interruptor da auditoria, as faltas, os argumentos dos dois
 * itens (título até 100 caracteres, descrição até 5.000 BYTES com a página no
 * lugar do marcador), as janelas, a conferência do vídeo e as rotas. Com um
 * dublê HTTP local: o conector (o OAuth com `state` assinado, a sessão sempre
 * privada, o `videos.update` só com `part=status`, o refresh pelo cofre) e o
 * envio do Mac pelo protocolo resumable (308 com `Range`, conexão caída no
 * meio, 5xx, 404 de sessão e a retomada depois de o processo morrer).
 */

const SHA = 'a'.repeat(64);

function episodio(p: Partial<EpisodioParaOYoutube> = {}): EpisodioParaOYoutube {
  return {
    id: 'ep-1',
    titulos: [
      { texto: 'Agentes no escritório', angulo: 'resultado', escolhido: true },
      { texto: 'Outro título', angulo: 'lista', escolhido: false },
    ],
    descricao: `O episódio da semana.\n\nLinks: ${PAUTA_MARCADOR_DA_PAGINA_DE_LINKS}`,
    thumbs: [{ n: 1, texto: 'agentes', destaque: 'agentes', tempoSeg: 3, imagem: { chave: 'pauta/thumb/ep-1-1-abcdef012345.png', sha: 'abcdef012345', bytes: 10, largura: 1280, altura: 720, enviadaEm: '2026-09-01T00:00:00Z' } }],
    thumbEscolhida: 1,
    publicarNoYoutubeEm: new Date('2026-09-03T21:00:00Z'),
    bioPage: { handle: 'root-ep-01', publicada: true },
    ...p,
  };
}
const CTX = { origemDaBio: 'https://bio.teste', categoria: '28' };
const ARQUIVO = { sha256: SHA, bytes: 314_572_800 };

describe('MD10: a auditoria, as faltas e os argumentos (puro)', () => {
  it('YOUTUBE_AUDITORIA nasce pendente e falha fechada; pendente recusa tudo, teste só envia, aprovada libera', () => {
    expect(youtubeAuditoria(undefined)).toBe('pendente');
    expect(youtubeAuditoria('')).toBe('pendente');
    expect(youtubeAuditoria('APROVADA')).toBe('aprovada');
    expect(youtubeAuditoria('aprovado')).toBe('pendente');
    expect(motivoDaAuditoriaParaEnviar('pendente')).toMatch(/PRIVADO PARA SEMPRE/);
    expect(motivoDaAuditoriaParaEnviar('teste')).toBeNull();
    expect(motivoDaAuditoriaParaPublicar('teste')).toMatch(/canal de teste/);
    expect(motivoDaAuditoriaParaPublicar('aprovada')).toBeNull();
    expect(capacidadesDoLote('pendente')).toEqual([]);
    expect(capacidadesDoLote('teste')).toEqual(['youtube.video.enviar']);
    expect(capacidadesDoLote('aprovada')).toEqual(['youtube.video.enviar', 'youtube.video.publicar']);
  });

  it('as faltas dizem o que fazer, uma a uma', () => {
    const agora = new Date('2026-09-01T12:00:00Z');
    const pronto = {
      conectado: true,
      auditoria: 'aprovada' as const,
      tituloEscolhido: true,
      descricao: true,
      thumbEscolhida: true,
      thumbComImagem: true,
      arquivo: true,
      publicarEm: new Date('2026-09-03T21:00:00Z'),
      agora,
      validadeMaximaMs: 8 * 86_400_000,
    };
    expect(faltasDoYoutube(pronto)).toEqual([]);
    expect(faltasDoYoutube({ ...pronto, conectado: false })[0]).toMatch(/conecte em Conexões/);
    expect(faltasDoYoutube({ ...pronto, thumbComImagem: false })[0]).toMatch(/root-midia thumbs/);
    expect(faltasDoYoutube({ ...pronto, arquivo: false })[0]).toMatch(/--declarar/);
    expect(faltasDoYoutube({ ...pronto, publicarEm: new Date(agora.getTime() + 30 * 60_000) })[0]).toMatch(/1 h à frente/);
    expect(faltasDoYoutube({ ...pronto, publicarEm: new Date(agora.getTime() + 9 * 86_400_000) })[0]).toMatch(/8 dias/);
    expect(faltasDoYoutube({ ...pronto, auditoria: 'pendente' })[0]).toMatch(/YOUTUBE_AUDITORIA=pendente/);
  });

  it('os argumentos do envio: o título marcado, a descrição com a página no ar, a categoria, a thumb e o arquivo; a publicação soma o horário', () => {
    const e = argsDoEnvio(episodio(), ARQUIVO, CTX);
    expect('args' in e && e.args).toEqual({
      episodioId: 'ep-1',
      sha256: SHA,
      bytes: 314_572_800,
      titulo: 'Agentes no escritório',
      descricao: 'O episódio da semana.\n\nLinks: https://bio.teste/@root-ep-01',
      categoria: '28',
      thumbN: 1,
      thumbChave: 'pauta/thumb/ep-1-1-abcdef012345.png',
      thumbSha: 'abcdef012345',
    });
    const p = argsDaPublicacao(episodio(), ARQUIVO, CTX);
    expect('args' in p && p.args.publicarEm).toBe('2026-09-03T21:00:00.000Z');
    // Sem horário, o envio vale e a publicação não.
    expect('problema' in argsDaPublicacao(episodio({ publicarNoYoutubeEm: null }), ARQUIVO, CTX)).toBe(true);
    expect('args' in argsDoEnvio(episodio({ publicarNoYoutubeEm: null }), ARQUIVO, CTX)).toBe(true);
  });

  it('cada falta dos argumentos tem a frase: página fora do ar, thumb sem imagem, arquivo não declarado', () => {
    expect(argsDoEnvio(episodio({ bioPage: { handle: 'x', publicada: false } }), ARQUIVO, CTX)).toEqual({
      problema: expect.stringMatching(/marcador da página de links/),
    });
    expect(argsDoEnvio(episodio({ thumbEscolhida: 2 }), ARQUIVO, CTX)).toEqual({ problema: expect.stringMatching(/root-midia thumbs/) });
    expect(argsDoEnvio(episodio({ thumbEscolhida: null }), ARQUIVO, CTX)).toEqual({ problema: expect.stringMatching(/Escolha a thumb/) });
    expect(argsDoEnvio(episodio(), null, CTX)).toEqual({ problema: expect.stringMatching(/--declarar/) });
    expect(argsDoEnvio(episodio({ titulos: [] }), ARQUIVO, CTX)).toEqual({ problema: expect.stringMatching(/Marque o título/) });
  });

  it('o título até 100 CARACTERES e a descrição até 5.000 BYTES, contados depois de trocar o marcador; sem < >', () => {
    expect(problemaDoTexto('a'.repeat(100), 'ok')).toBeNull();
    expect(problemaDoTexto('a'.repeat(101), 'ok')).toMatch(/100 caracteres/);
    // 100 letras acentuadas são 100 caracteres (e 200 bytes): o título conta caracteres.
    expect(problemaDoTexto('ã'.repeat(100), 'ok')).toBeNull();
    const acentos = 'ç'.repeat(2600);
    expect(acentos.length).toBeLessThan(5000);
    expect(bytesUtf8(acentos)).toBeGreaterThan(5000);
    expect(problemaDoTexto('t', acentos)).toMatch(/bytes/);
    expect(problemaDoTexto('t', 'a'.repeat(5000))).toBeNull();
    expect(problemaDoTexto('t <b>', 'ok')).toMatch(/< e >/);
    // A URL da página entra no lugar do marcador ANTES da conta: a descrição no limite com o marcador estoura com a URL.
    const quase = `${'a'.repeat(5000 - bytesUtf8(PAUTA_MARCADOR_DA_PAGINA_DE_LINKS))}${PAUTA_MARCADOR_DA_PAGINA_DE_LINKS}`;
    expect(argsDoEnvio(episodio({ descricao: quase }), ARQUIVO, CTX)).toEqual({ problema: expect.stringMatching(/bytes/) });
  });

  it('as janelas: o envio fecha 1 h antes do horário e o agendamento 15 min antes', () => {
    const agora = new Date('2026-09-01T12:00:00Z');
    const hora = new Date('2026-09-03T21:00:00Z');
    const j = janelasDoYoutube(hora, agora);
    expect(j.envio).toEqual({ janelaDe: agora, janelaAte: new Date(hora.getTime() - YOUTUBE_ANTECEDENCIA_DO_ENVIO_MS) });
    expect(j.publicacao).toEqual({ janelaDe: agora, janelaAte: new Date(hora.getTime() - YOUTUBE_ANTECEDENCIA_DA_PUBLICACAO_MS) });
  });

  it('o vídeo do YouTube confere com o assinado: existe, está privado, e título, descrição e categoria batem', () => {
    const a = (argsDaPublicacao(episodio(), ARQUIVO, CTX) as { args: Parameters<typeof divergenciaDoVideo>[1] }).args;
    const v = { id: 'v1', titulo: a.titulo, descricao: a.descricao, categoria: '28', privacidade: 'private', publishAt: null as string | null, uploadStatus: 'uploaded' };
    expect(divergenciaDoVideo(v, a)).toBeNull();
    expect(divergenciaDoVideo(null, a)).toMatch(/não existe/);
    expect(divergenciaDoVideo({ ...v, privacidade: 'public' }, a)).toMatch(/não privado/);
    expect(divergenciaDoVideo({ ...v, titulo: 'outro' }, a)).toMatch(/título/);
    expect(divergenciaDoVideo({ ...v, descricao: 'outra' }, a)).toMatch(/descrição/);
    expect(divergenciaDoVideo({ ...v, categoria: '22' }, a)).toMatch(/categoria/);
    expect(divergenciaDoVideo({ ...v, publishAt: '2026-09-04T21:00:00Z' }, a)).toMatch(/outro horário/);
    expect(divergenciaDoVideo({ ...v, publishAt: a.publicarEm ?? null }, a)).toBeNull();
    // O tamanho do arquivo (fileDetails, só ao dono) amarra o vídeo ao assinado; ausente, vale a sessão aberta pelo OS.
    expect(divergenciaDoVideo({ ...v, tamanho: a.bytes }, a)).toBeNull();
    expect(divergenciaDoVideo({ ...v, tamanho: a.bytes - 1 }, a)).toMatch(/não é o vídeo final da semana/);
    expect(divergenciaDoVideo({ ...v, tamanho: null }, a)).toBeNull();
  });

  it('o vídeo que o YouTube recusou, cujo processamento falhou ou que foi apagado não é conferido (duplicata, por exemplo)', () => {
    const a = (argsDoEnvio(episodio(), ARQUIVO, CTX) as { args: Parameters<typeof divergenciaDoVideo>[1] }).args;
    const v = { id: 'v1', titulo: a.titulo, descricao: a.descricao, categoria: '28', privacidade: 'private', publishAt: null, uploadStatus: 'uploaded' };
    for (const st of ['rejected', 'failed', 'deleted']) expect(divergenciaDoVideo({ ...v, uploadStatus: st }, a), st).toMatch(new RegExp(`"${st}".*não vai ao ar`));
    for (const st of ['uploaded', 'processed', null]) expect(divergenciaDoVideo({ ...v, uploadStatus: st }, a), String(st)).toBeNull();
  });

  it('o modo teste só abre sessão para o canal de YOUTUBE_CANAL_DE_TESTE; fora do modo teste, o canal não importa', () => {
    expect(motivoDoCanalDeTeste('aprovada', undefined, 'UCreal')).toBeNull();
    expect(motivoDoCanalDeTeste('pendente', '', null)).toBeNull();
    expect(motivoDoCanalDeTeste('teste', '', 'UCreal')).toMatch(/exige YOUTUBE_CANAL_DE_TESTE/);
    expect(motivoDoCanalDeTeste('teste', 'UCteste', 'UCreal')).toMatch(/UCreal\) não é o canal de teste/);
    expect(motivoDoCanalDeTeste('teste', 'UCteste', null)).toMatch(/desconhecido/);
    expect(motivoDoCanalDeTeste('teste', ' UCteste ', 'UCteste')).toBeNull();
  });

  it('a thumb, a categoria e a playlist das notas; o PNG confere pelo sha curto; os argumentos comparam campo a campo', () => {
    expect(thumbEscolhida(episodio().thumbs, 1)).toEqual({ n: 1, chave: 'pauta/thumb/ep-1-1-abcdef012345.png', sha: 'abcdef012345' });
    expect(thumbEscolhida(episodio().thumbs, 3)).toBeNull();
    expect(categoriaDaNota('22\nqualquer')).toBe('22');
    expect(categoriaDaNota('pessoas')).toBe('28');
    expect(playlistDaNota('PLabcdefghij1234')).toBe('PLabcdefghij1234');
    expect(playlistDaNota('https://youtube.com/playlist')).toBeNull();
    const png = Buffer.from('png');
    expect(pngDaThumbConfere(createHash('sha256').update(png).digest('hex'), createHash('sha256').update(png).digest('hex').slice(0, 12))).toBe(true);
    expect(mesmosArgs({ a: 1, b: 'x' }, { b: 'x', a: 1 })).toBe(true);
    expect(mesmosArgs({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('os corpos das rotas: sha256 hex, tamanho até 256 GB, mime do vídeo, id do vídeo, horário com fuso', () => {
    expect(YoutubeArquivoSchema.parse({ sha256: SHA, bytes: 10 })).toEqual({ sha256: SHA, bytes: 10, mime: 'video/mp4' });
    expect(YoutubeArquivoSchema.safeParse({ sha256: SHA.toUpperCase(), bytes: 10 }).success).toBe(false);
    expect(YoutubeArquivoSchema.safeParse({ sha256: SHA, bytes: 0 }).success).toBe(false);
    expect(YoutubeArquivoSchema.safeParse({ sha256: SHA, bytes: 10, mime: 'image/png' }).success).toBe(false);
    expect(YoutubeArquivoSchema.safeParse({ sha256: SHA, bytes: 10, extra: 1 }).success).toBe(false);
    expect(YoutubeSessaoSchema.parse({ sha256: SHA, bytes: 10 }).nova).toBe(false);
    expect(YoutubeConcluidoSchema.safeParse({ videoId: 'dQw4w9WgXcQ' }).success).toBe(true);
    expect(YoutubeConcluidoSchema.safeParse({ videoId: '../x' }).success).toBe(false);
    expect(PautaHorarioDoYoutubeSchema.safeParse({ publicarEm: '2026-09-03T18:00:00-03:00' }).success).toBe(true);
    expect(PautaHorarioDoYoutubeSchema.safeParse({ publicarEm: '03/09 18h' }).success).toBe(false);
  });

  it('as variáveis novas estão no compose (com a auditoria nascendo pendente) e no .env.example', () => {
    const raiz = path.resolve(__dirname, '..', '..', '..');
    const compose = readFileSync(path.join(raiz, 'docker-compose.yml'), 'utf8');
    const exemplo = readFileSync(path.join(raiz, '.env.example'), 'utf8');
    for (const v of ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REDIRECT_URI', 'YOUTUBE_API_URL', 'YOUTUBE_UPLOAD_URL', 'YOUTUBE_OAUTH_URL', 'YOUTUBE_AUDITORIA', 'YOUTUBE_CANAL_DE_TESTE']) {
      expect(compose, v).toMatch(new RegExp(`${v}: \\$\\{${v}:-`));
      expect(exemplo, v).toMatch(new RegExp(`^${v}=`, 'm'));
    }
    expect(compose).toMatch(/YOUTUBE_AUDITORIA: \$\{YOUTUBE_AUDITORIA:-pendente\}/);
    expect(exemplo).toMatch(/^YOUTUBE_AUDITORIA=pendente$/m);
  });

  it('a sessão, o token e a conclusão pedem pauta.enviar_ao_youtube (a conta do Mac, não todo editor); o resto pede pauta.editar; ler pede pauta.ver; conectar pede pauta.publicar', () => {
    const perm = (c: object, m: string) => Reflect.getMetadata(PERMISSIONS_KEY, (c as Record<string, object>)[m]);
    const p = EnvioAoYoutubeController.prototype as unknown as Record<string, unknown>;
    expect(perm(p, 'estado')).toEqual(['pauta.ver']);
    for (const m of ['declarar', 'thumb', 'horario']) expect(perm(p, m), m).toEqual(['pauta.editar']);
    for (const m of ['sessao', 'token', 'concluido']) expect(perm(p, m), m).toEqual(['pauta.enviar_ao_youtube']);
    // Nenhum perfil de editor recebe o token: só o Admin Master nasce com ele.
    for (const [papel, def] of Object.entries(ROLES)) {
      expect((def.permissions as readonly string[]).includes('pauta.enviar_ao_youtube'), papel).toBe(papel === 'admin_master');
    }
    const y = YoutubeDaPautaController.prototype as unknown as Record<string, unknown>;
    expect(perm(y, 'pendentes')).toEqual(['pauta.ver']);
    expect(perm(y, 'conectar')).toEqual(['pauta.publicar']);
  });

  it('conectar o canal pela pauta vai ao RASTRO como conector.autorizar, o mesmo evento de /conexoes', async () => {
    const audit = { log: vi.fn(async () => undefined) };
    const contrato = { autorizar: vi.fn(async () => ({ tipo: 'redirecionar', url: 'https://consentimento.teste/x' })) };
    const c = new YoutubeDaPautaController({} as never, contrato as never, audit as never);
    expect(await c.conectar({ orgId: 'org-1', sub: 'p-1' } as never)).toMatchObject({ tipo: 'redirecionar' });
    expect(contrato.autorizar).toHaveBeenCalledWith('youtube', { orgId: 'org-1', actorId: 'p-1' });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', actorId: 'p-1', action: 'conector.autorizar', entityType: 'conector', entityId: 'youtube', after: { tipo: 'redirecionar', via: 'pauta' } }),
    );
  });
});

// ---------------------------------------------------------------------------
// O conector contra um dublê do Google (OAuth + Data API + upload)
// ---------------------------------------------------------------------------

interface Chamada {
  metodo: string;
  caminho: string;
  consulta: Record<string, string>;
  cabecalhos: Record<string, string | string[] | undefined>;
  corpo: string;
}

describe('MD10: o conector do YouTube contra o dublê', () => {
  let servidor: Server;
  let base = '';
  const chamadas: Chamada[] = [];
  let respostaDoToken: { status: number; corpo: unknown } = { status: 200, corpo: { access_token: 'at-novo', expires_in: 3599 } };
  const AMBIENTE = ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_API_URL', 'YOUTUBE_UPLOAD_URL', 'YOUTUBE_OAUTH_URL', 'YOUTUBE_REDIRECT_URI', 'WEB_ORIGIN', 'YOUTUBE_AUDITORIA'];
  const antes: Record<string, string | undefined> = {};
  const jwt = new JwtService({ secret: 'segredo-md10' });
  const guardados: Array<Record<string, unknown>> = [];
  let cofreVazio = false;
  let refreshVenceEm: string | null = null;
  const cofre = {
    envolver: async (_e: unknown, fn: (c: { usar: (f: (s: string) => unknown) => Promise<unknown> }) => Promise<unknown>) => fn({ usar: async (f) => f('refresh-do-cofre') }),
    estado: async () => ({ items: cofreVazio ? [] : [{ conector: 'youtube', nome: 'refresh_token', revogadoEm: null, expiraEm: refreshVenceEm }], total: 1, source: {} }),
    guardar: async (e: Record<string, unknown>) => {
      guardados.push(e);
      return { id: 'x', versao: 1 };
    },
    revogar: async () => ({ revogados: ['refresh_token'], jaRevogados: [], preservados: [] }),
  };
  let consultasAoBanco = 0;
  /** A linha de `IntegrationAccount` do YouTube: a data da conexão e o canal. */
  let conta: { connectedAt: Date | null; config: { canalId?: string } | null } | null = null;
  /** O item que o dublê da playlist já tem para o vídeo (o insert de antes cuja resposta se perdeu). */
  let playlistExistente: string | null = null;
  /** O que a sessão resumable responde à consulta: o id do vídeo, incompleta (308) ou sumiu (404). */
  let sessaoDoDuble = 'v-da-sessao';
  const totalDaSessao = 314_572_800;
  let canalFalha = false;
  const contas: Array<Record<string, unknown>> = [];
  const prisma = {
    org: { findUnique: async ({ where }: { where: { id: string } }) => (consultasAoBanco++, where.id === 'org-yt' ? { id: 'org-yt' } : null) },
    integrationAccount: {
      findFirst: async () => conta,
      create: async (a: Record<string, unknown>) => (contas.push(a), {}),
      update: async (a: Record<string, unknown>) => (contas.push(a), {}),
    },
  };
  const audit = { log: vi.fn(async () => undefined) };
  const contrato = { registrar: vi.fn(), esquecer: vi.fn() };
  let yt: YoutubeService;

  beforeAll(async () => {
    for (const k of AMBIENTE) antes[k] = process.env[k];
    servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
      const partes: Buffer[] = [];
      req.on('data', (c) => partes.push(c));
      req.on('end', () => {
        const u = new URL(req.url ?? '/', 'http://x');
        const corpo = Buffer.concat(partes).toString('utf8');
        chamadas.push({ metodo: req.method ?? '', caminho: u.pathname, consulta: Object.fromEntries(u.searchParams), cabecalhos: req.headers, corpo });
        const json = (status: number, c: unknown, extra: Record<string, string> = {}) => {
          res.writeHead(status, { 'Content-Type': 'application/json', ...extra });
          res.end(JSON.stringify(c));
        };
        if (u.pathname === '/oauth/token') return json(respostaDoToken.status, respostaDoToken.corpo);
        if (u.pathname === '/oauth/revoke') return json(200, {});
        if (u.pathname === '/upload/youtube/v3/videos' && req.method === 'POST') {
          return json(200, {}, { Location: `${base}/upload/youtube/v3/videos?uploadType=resumable&upload_id=sessao-1` });
        }
        if (u.pathname === '/upload/youtube/v3/videos' && req.method === 'PUT') {
          if (req.headers['content-range'] !== `bytes */${totalDaSessao}`) return json(400, { error: { message: 'Content-Range inesperado' } });
          if (sessaoDoDuble === 'sumiu') return json(404, { error: { message: 'sessão desconhecida' } });
          if (sessaoDoDuble === 'incompleta') {
            res.writeHead(308, { Range: 'bytes=0-1048575' });
            return res.end();
          }
          return json(200, { id: sessaoDoDuble, status: { privacyStatus: 'private' } });
        }
        if (u.pathname === '/upload/youtube/v3/thumbnails/set') return json(200, { items: [] });
        if (u.pathname === '/youtube/v3/videos' && req.method === 'GET') {
          return json(200, {
            items: [
              { id: u.searchParams.get('id'), snippet: { title: 'T', description: 'D', categoryId: '28' }, status: { privacyStatus: 'private', uploadStatus: 'uploaded' }, fileDetails: { fileSize: '314572800' } },
            ],
          });
        }
        if (u.pathname === '/youtube/v3/videos' && req.method === 'PUT') {
          const b = JSON.parse(corpo) as { id: string; status: Record<string, unknown> };
          return json(200, { id: b.id, status: b.status });
        }
        if (u.pathname === '/youtube/v3/channels') {
          if (canalFalha) return json(500, { error: { message: 'channels.list caiu' } });
          return json(200, { items: [{ id: 'UC1', snippet: { title: 'Operação Root' }, contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }] });
        }
        if (u.pathname === '/youtube/v3/playlistItems' && req.method === 'GET' && u.searchParams.get('playlistId') === 'UU1') {
          return json(200, {
            items: [
              { snippet: { resourceId: { videoId: 'v-nosso' }, publishedAt: '2026-09-25T10:00:00Z' }, status: { privacyStatus: 'private' } },
              { snippet: { resourceId: { videoId: 'v-estranho' }, publishedAt: '2026-09-25T10:05:00Z' }, status: { privacyStatus: 'public' } },
            ],
          });
        }
        if (u.pathname === '/youtube/v3/playlistItems' && req.method === 'GET') return json(200, { items: playlistExistente ? [{ id: playlistExistente }] : [] });
        if (u.pathname === '/youtube/v3/playlistItems') return json(200, { id: 'pli-1' });
        return json(404, { error: { message: 'rota do dublê desconhecida' } });
      });
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
    process.env.YOUTUBE_CLIENT_ID = 'cliente-teste';
    process.env.YOUTUBE_CLIENT_SECRET = 'segredo-teste';
    process.env.YOUTUBE_API_URL = `${base}/youtube/v3`;
    process.env.YOUTUBE_UPLOAD_URL = `${base}/upload/youtube/v3`;
    process.env.YOUTUBE_OAUTH_URL = `${base}/oauth`;
    process.env.YOUTUBE_REDIRECT_URI = 'https://os.teste/api/youtube/callback';
    process.env.WEB_ORIGIN = 'https://os.teste';
  });

  afterAll(async () => {
    await new Promise<void>((ok) => servidor.close(() => ok()));
    for (const k of AMBIENTE) {
      if (antes[k] === undefined) delete process.env[k];
      else process.env[k] = antes[k];
    }
  });

  beforeEach(() => {
    chamadas.length = 0;
    guardados.length = 0;
    consultasAoBanco = 0;
    cofreVazio = false;
    refreshVenceEm = null;
    conta = null;
    playlistExistente = null;
    sessaoDoDuble = 'v-da-sessao';
    canalFalha = false;
    contas.length = 0;
    respostaDoToken = { status: 200, corpo: { access_token: 'at-novo', expires_in: 3599 } };
    yt = new YoutubeService(prisma as never, audit as never, contrato as never, jwt, cofre as never);
  });

  it('a URL de fora de loopback só vale https: o token iria no cabeçalho', () => {
    expect(urlDoFornecedor('', 'https://padrao')).toBe('https://padrao');
    expect(urlDoFornecedor('http://127.0.0.1:9/x/', 'p')).toBe('http://127.0.0.1:9/x');
    expect(urlDoFornecedor('https://www.googleapis.com/youtube/v3', 'p')).toBe('https://www.googleapis.com/youtube/v3');
    expect(() => urlDoFornecedor('http://dubles.exemplo/youtube', 'p')).toThrow(/https/);
  });

  it('o consentimento pede os DOIS escopos, offline e com prompt=consent; o state é assinado com typ próprio', () => {
    const u = new URL(yt.urlDeAutorizacao('org-yt', 'pessoa-1'));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('scope')?.split(' ').sort()).toEqual([
      'https://www.googleapis.com/auth/youtube.force-ssl',
      'https://www.googleapis.com/auth/youtube.upload',
    ]);
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
    const claims = jwt.verify<{ typ: string; org: string; sub: string }>(u.searchParams.get('state')!);
    expect(claims).toMatchObject({ typ: TIPO_DO_ESTADO_DO_YOUTUBE, org: 'org-yt', sub: 'pessoa-1' });
    expect(escoposCompletos(u.searchParams.get('scope'))).toBe(true);
    expect(escoposCompletos('https://www.googleapis.com/auth/youtube.upload')).toBe(false);
  });

  it('o retorno do OAuth confere o state ANTES do banco: inválido, de outro typ ou vencido volta "expirado" sem consulta', async () => {
    expect(await yt.concluirAutorizacao('lixo', 'codigo', undefined)).toBe('https://os.teste/pauta?aba=episodios&youtube=expirado');
    const sessao = jwt.sign({ typ: 'sessao', org: 'org-yt' });
    expect(await yt.concluirAutorizacao(sessao, 'codigo', undefined)).toMatch(/youtube=expirado$/);
    const vencido = jwt.sign({ typ: TIPO_DO_ESTADO_DO_YOUTUBE, org: 'org-yt', exp: Math.floor(Date.now() / 1000) - 10 });
    expect(await yt.concluirAutorizacao(vencido, 'codigo', undefined)).toMatch(/youtube=expirado$/);
    expect(consultasAoBanco).toBe(0);
    expect(chamadas).toEqual([]);
    // Cancelado na tela do Google.
    const bom = jwt.sign({ typ: TIPO_DO_ESTADO_DO_YOUTUBE, org: 'org-yt' }, { expiresIn: '10m' });
    expect(await yt.concluirAutorizacao(bom, undefined, 'access_denied')).toMatch(/youtube=cancelado$/);
    // Empresa que não existe: o mesmo "expirado".
    const outra = jwt.sign({ typ: TIPO_DO_ESTADO_DO_YOUTUBE, org: 'nao-existe' }, { expiresIn: '10m' });
    expect(await yt.concluirAutorizacao(outra, 'codigo', undefined)).toMatch(/youtube=expirado$/);
  });

  it('com um escopo desmarcado nada é guardado; com os dois, o refresh vai ao cofre e o Testing (7 dias) é lembrado', async () => {
    const bom = jwt.sign({ typ: TIPO_DO_ESTADO_DO_YOUTUBE, org: 'org-yt', sub: 'pessoa-1' }, { expiresIn: '10m' });
    respostaDoToken = { status: 200, corpo: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3599, scope: 'https://www.googleapis.com/auth/youtube.upload' } };
    expect(await yt.concluirAutorizacao(bom, 'codigo', undefined)).toMatch(/youtube=escopo_incompleto$/);
    expect(guardados).toEqual([]);
    respostaDoToken = {
      status: 200,
      corpo: {
        access_token: 'at-1',
        refresh_token: 'rt-1',
        expires_in: 3599,
        refresh_token_expires_in: 604_799,
        scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl',
      },
    };
    expect(await yt.concluirAutorizacao(bom, 'codigo', undefined)).toMatch(/youtube=ok_testing$/);
    expect(guardados).toEqual([expect.objectContaining({ orgId: 'org-yt', conector: 'youtube', nome: 'refresh_token', valor: 'rt-1', origem: 'youtube-oauth', actorId: 'pessoa-1' })]);
    expect((guardados[0].expiraEm as Date).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    const troca = chamadas.filter((c) => c.caminho === '/oauth/token').at(-1)!;
    expect(new URLSearchParams(troca.corpo).get('grant_type')).toBe('authorization_code');
    expect(new URLSearchParams(troca.corpo).get('redirect_uri')).toBe('https://os.teste/api/youtube/callback');
    // O access token da troca fica na memória: a chamada seguinte não renova.
    await yt.lerVideo('org-yt', 'v1');
    const renovacoes = chamadas.filter((c) => c.caminho === '/oauth/token' && new URLSearchParams(c.corpo).get('grant_type') === 'refresh_token');
    expect(renovacoes).toEqual([]);
  });

  it('a reconexão cujo channels.list falha apaga o canal da conexão anterior e descarta o token do envio guardado', async () => {
    conta = { connectedAt: new Date(), config: { canalId: 'UCteste' } };
    respostaDoToken = { status: 200, corpo: { access_token: 'at-envio', expires_in: 3599, scope: 'https://www.googleapis.com/auth/youtube.upload' } };
    await yt.tokenDoEnvio('org-yt');
    const bom = jwt.sign({ typ: TIPO_DO_ESTADO_DO_YOUTUBE, org: 'org-yt', sub: 'pessoa-1' }, { expiresIn: '10m' });
    respostaDoToken = {
      status: 200,
      corpo: { access_token: 'at-real', refresh_token: 'rt-real', expires_in: 3599, scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl' },
    };
    canalFalha = true;
    expect(await yt.concluirAutorizacao(bom, 'codigo', undefined)).toMatch(/youtube=ok$/);
    expect(contas.at(-1)).toMatchObject({ data: { status: 'connected', config: { canalId: null, canal: null } } });
    // O token do envio da autorização anterior não sai mais: o próximo é renovado.
    respostaDoToken = { status: 200, corpo: { access_token: 'at-envio-novo', expires_in: 3599, scope: 'https://www.googleapis.com/auth/youtube.upload' } };
    expect((await yt.tokenDoEnvio('org-yt')).token).toBe('at-envio-novo');
  });

  it('a sessão resumable é SEMPRE privada e sem publishAt, com o tamanho e o tipo nos cabeçalhos; o token vem do refresh do cofre', async () => {
    const uri = await yt.abrirSessao('org-yt', { bytes: 314_572_800, mime: 'video/mp4', metadados: { titulo: 'T', descricao: 'D', categoria: '28' } });
    expect(uri).toBe(`${base}/upload/youtube/v3/videos?uploadType=resumable&upload_id=sessao-1`);
    const refresh = chamadas.find((c) => c.caminho === '/oauth/token')!;
    expect(Object.fromEntries(new URLSearchParams(refresh.corpo))).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'refresh-do-cofre' });
    const post = chamadas.find((c) => c.caminho === '/upload/youtube/v3/videos')!;
    expect(post.consulta).toEqual({ uploadType: 'resumable', part: 'snippet,status' });
    expect(post.cabecalhos['x-upload-content-length']).toBe('314572800');
    expect(post.cabecalhos['x-upload-content-type']).toBe('video/mp4');
    expect(post.cabecalhos.authorization).toBe('Bearer at-novo');
    const corpo = JSON.parse(post.corpo);
    expect(corpo.status).toEqual({ privacyStatus: 'private', selfDeclaredMadeForKids: false });
    expect(JSON.stringify(corpo)).not.toMatch(/publishAt/);
    expect(corpo.snippet).toEqual({ title: 'T', description: 'D', categoryId: '28' });
  });

  it('o agendamento manda SÓ part=status (privado + publishAt): nenhum campo do snippet vai no update', async () => {
    const quando = new Date('2026-09-03T21:00:00Z');
    const v = await yt.agendar('org-yt', 'v1', quando);
    expect(v).toMatchObject({ id: 'v1', privacidade: 'private', publishAt: '2026-09-03T21:00:00.000Z' });
    const put = chamadas.find((c) => c.metodo === 'PUT' && c.caminho === '/youtube/v3/videos')!;
    expect(put.consulta).toEqual({ part: 'status' });
    expect(JSON.parse(put.corpo)).toEqual({ id: 'v1', status: { privacyStatus: 'private', publishAt: '2026-09-03T21:00:00.000Z', selfDeclaredMadeForKids: false } });
  });

  it('a consulta da sessão resumable: PUT vazio com bytes */total; 200 traz o id, 308 diz até onde chegou, 404 é a sessão que sumiu', async () => {
    const uri = `${base}/upload/youtube/v3/videos?uploadType=resumable&upload_id=sessao-1`;
    expect(await yt.resultadoDaSessao('org-yt', uri, totalDaSessao)).toEqual({ videoId: 'v-da-sessao', recebidos: totalDaSessao });
    const put = chamadas.find((c) => c.metodo === 'PUT' && c.caminho === '/upload/youtube/v3/videos')!;
    expect(put.cabecalhos['content-range']).toBe(`bytes */${totalDaSessao}`);
    expect(put.corpo).toBe('');
    sessaoDoDuble = 'incompleta';
    expect(await yt.resultadoDaSessao('org-yt', uri, totalDaSessao)).toEqual({ videoId: null, recebidos: 1_048_576 });
    sessaoDoDuble = 'sumiu';
    await expect(yt.resultadoDaSessao('org-yt', uri, totalDaSessao)).rejects.toMatchObject({ status: 404 });
    // A URI de sessão fora de https (e fora de loopback) não recebe o token.
    await expect(yt.resultadoDaSessao('org-yt', 'http://upload.fora.teste/sessao', totalDaSessao)).rejects.toThrow(/https/);
  });

  it('ler o vídeo pede fileDetails (o tamanho); os uploads do canal saem da playlist de uploads, com a privacidade', async () => {
    expect(await yt.lerVideo('org-yt', 'v1')).toMatchObject({ tamanho: 314_572_800 });
    expect(chamadas.find((c) => c.caminho === '/youtube/v3/videos')!.consulta.part).toBe('snippet,status,fileDetails');
    expect(await yt.uploadsDoCanal('org-yt')).toEqual([
      { videoId: 'v-nosso', privacidade: 'private', enviadoEm: '2026-09-25T10:00:00Z' },
      { videoId: 'v-estranho', privacidade: 'public', enviadoEm: '2026-09-25T10:05:00Z' },
    ]);
    expect(chamadas.find((c) => c.caminho === '/youtube/v3/channels')!.consulta).toMatchObject({ part: 'contentDetails', mine: 'true' });
  });

  it('ler o vídeo, a thumb em PNG e a playlist saem dos endereços fixos do conector', async () => {
    expect(await yt.lerVideo('org-yt', 'v1')).toMatchObject({ id: 'v1', titulo: 'T', descricao: 'D', categoria: '28', privacidade: 'private' });
    await yt.definirThumb('org-yt', 'v1', Buffer.from('png'));
    const thumb = chamadas.find((c) => c.caminho === '/upload/youtube/v3/thumbnails/set')!;
    expect(thumb.consulta).toEqual({ videoId: 'v1', uploadType: 'media' });
    expect(thumb.cabecalhos['content-type']).toBe('image/png');
    expect(await yt.inserirNaPlaylist('org-yt', 'PL123', 'v1')).toBe('pli-1');
    expect(yt.urlDoVideo('v1')).toBe('https://youtu.be/v1');
  });

  it('a playlist não duplica: o item que já existe para o vídeo (o insert cuja resposta se perdeu) é reaproveitado, sem insert', async () => {
    playlistExistente = 'pli-antigo';
    expect(await yt.inserirNaPlaylist('org-yt', 'PL123', 'v1')).toBe('pli-antigo');
    const daPlaylist = chamadas.filter((c) => c.caminho === '/youtube/v3/playlistItems');
    expect(daPlaylist.map((c) => c.metodo)).toEqual(['GET']);
    expect(daPlaylist[0].consulta).toMatchObject({ part: 'id', playlistId: 'PL123', videoId: 'v1' });
  });

  it('o token do Mac é renovado pedindo SÓ youtube.upload, guardado à parte do da API; forçar descarta o guardado', async () => {
    const soEnvio = 'https://www.googleapis.com/auth/youtube.upload';
    respostaDoToken = { status: 200, corpo: { access_token: 'at-do-envio', expires_in: 3599, scope: soEnvio } };
    const t = await yt.tokenDoEnvio('org-yt');
    expect(t).toMatchObject({ token: 'at-do-envio', soEnvio: true });
    const pedido = new URLSearchParams(chamadas.find((c) => c.caminho === '/oauth/token')!.corpo);
    expect(pedido.get('scope')).toBe(soEnvio);
    // O guardado vale até vencer; o da API é outro, pedido sem estreitar.
    expect(await yt.tokenDoEnvio('org-yt')).toBe(t);
    respostaDoToken = { status: 200, corpo: { access_token: 'at-da-api', expires_in: 3599, scope: `${soEnvio} https://www.googleapis.com/auth/youtube.force-ssl` } };
    expect((await yt.tokenDeAcesso('org-yt')).token).toBe('at-da-api');
    expect(new URLSearchParams(chamadas.at(-1)!.corpo).get('scope')).toBeNull();
    // O Mac pediu outro (401): renova de verdade. O Google que ignora o escopo pedido devolve o largo, e isso fica dito.
    const forcado = await yt.tokenDoEnvio('org-yt', { forcar: true });
    expect(forcado).toMatchObject({ token: 'at-da-api', soEnvio: false });
    expect(soOEscopoDoEnvio(soEnvio)).toBe(true);
    expect(soOEscopoDoEnvio(`${soEnvio} https://www.googleapis.com/auth/youtube.force-ssl`)).toBe(false);
    expect(soOEscopoDoEnvio(undefined)).toBe(false);
  });

  it('o canal conectado sai da linha de IntegrationAccount gravada na conexão', async () => {
    expect(await yt.canalConectado('org-yt')).toBeNull();
    conta = { connectedAt: new Date(), config: { canalId: 'UCteste' } };
    expect(await yt.canalConectado('org-yt')).toBe('UCteste');
  });

  it('o refresh recusado (invalid_grant) diz para conectar de novo e cita o Testing; sem credencial no cofre, não conectado', async () => {
    respostaDoToken = { status: 400, corpo: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } };
    const e = await yt.tokenDeAcesso('org-yt').catch((x) => x);
    expect(e).toBeInstanceOf(ErroDoYoutube);
    expect(e.message).toMatch(/Testing, ela vence em 7 dias/);
    cofreVazio = true;
    expect(await yt.conectado('org-yt')).toBe(false);
  });

  it('a saúde acusa a tela de consentimento em Testing e diz a auditoria', async () => {
    yt.onModuleInit();
    const c = contrato.registrar.mock.calls.at(-1)![0] as { saude: (x: { orgId: string }) => Promise<{ estado: string; mensagem: string }> };
    refreshVenceEm = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const s = await c.saude({ orgId: 'org-yt' });
    expect(s.estado).toBe('conectado');
    expect(s.mensagem).toMatch(/canal Operação Root respondeu/);
    expect(s.mensagem).toMatch(/Testing/);
    expect(s.mensagem).toMatch(/auditoria pendente/);
    cofreVazio = true;
    expect((await c.saude({ orgId: 'org-yt' })).estado).toBe('nao_configurado');
  });

  it('sem o prazo do Google, a saúde lembra do Testing pela data da conexão enquanto ela tem menos de 7 dias', async () => {
    yt.onModuleInit();
    const c = contrato.registrar.mock.calls.at(-1)![0] as { saude: (x: { orgId: string }) => Promise<{ estado: string; mensagem: string }> };
    conta = { connectedAt: new Date(Date.now() - 2 * 86_400_000), config: null };
    expect((await c.saude({ orgId: 'org-yt' })).mensagem).toMatch(/Se a tela de consentimento ainda estiver em Testing, esta autorização vence em/);
    conta = { connectedAt: new Date(Date.now() - 8 * 86_400_000), config: null };
    expect((await c.saude({ orgId: 'org-yt' })).mensagem).not.toMatch(/Testing/);
  });
});

// ---------------------------------------------------------------------------
// O envio do Mac pelo protocolo resumable
// ---------------------------------------------------------------------------

/**
 * O dublê do upload resumable: guarda os bytes de cada sessão, responde 308
 * com `Range`, e sabe derrubar a conexão no meio de um bloco (guardando só o
 * que chegou em múltiplos de 256 KiB, como o YouTube), responder 5xx uma vez,
 * ou esquecer a sessão (404).
 */
class Protocolo {
  sessoes = new Map<string, { total: number; bytes: Buffer[]; recebidos: number }>();
  pedidos: Array<{ sessao: string; range: string | null; tamanho: number; status: number }> = [];
  cortarNoBloco: number | null = null;
  erroNoBloco: number | null = null;
  esquecerNoBloco: number | null = null;
  /** No bloco N, o token daquele pedido passa a ser recusado (401) para sempre: a autorização foi tirada. */
  recusarTokenNoBloco: number | null = null;
  tokensRecusados = new Set<string>();
  private blocos = 0;
  private seq = 0;
  videoId = 'video-dq1';

  abrir(total: number, base: string): string {
    const id = `s${++this.seq}`;
    this.sessoes.set(id, { total, bytes: [], recebidos: 0 });
    return `${base}/sessao/${id}`;
  }

  conteudo(id: string): Buffer {
    return Buffer.concat(this.sessoes.get(id)!.bytes);
  }

  tratar(req: IncomingMessage, res: ServerResponse): void {
    const id = /\/sessao\/(\w+)/.exec(req.url ?? '')?.[1] ?? '';
    const s = this.sessoes.get(id);
    const range = (req.headers['content-range'] as string | undefined) ?? null;
    const responder = (status: number, extra: Record<string, string> = {}, corpo = '') => {
      this.pedidos.push({ sessao: id, range, tamanho: Number(req.headers['content-length'] ?? 0), status });
      res.writeHead(status, extra);
      res.end(corpo);
    };
    const partes: Buffer[] = [];
    let recebidoNoPedido = 0;
    const eBloco = !!range && !range.startsWith('bytes */');
    const numero = eBloco ? ++this.blocos : 0;
    req.on('data', (c: Buffer) => {
      partes.push(c);
      recebidoNoPedido += c.length;
      if (eBloco && this.cortarNoBloco === numero && recebidoNoPedido > MULTIPLO * 1.5 && s) {
        // A conexão cai no meio: o que chegou em múltiplos de 256 KiB fica.
        const guardar = Math.floor(recebidoNoPedido / MULTIPLO) * MULTIPLO;
        s.bytes.push(Buffer.concat(partes).subarray(0, guardar));
        s.recebidos += guardar;
        this.cortarNoBloco = null;
        this.pedidos.push({ sessao: id, range, tamanho: recebidoNoPedido, status: 0 });
        req.socket.destroy();
      }
    });
    req.on('end', () => {
      if (res.headersSent || req.socket.destroyed) return;
      const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
      if (eBloco && this.recusarTokenNoBloco === numero) {
        this.recusarTokenNoBloco = null;
        this.tokensRecusados.add(token);
      }
      if (this.tokensRecusados.has(token)) return responder(401, {}, 'Unauthorized');
      if (!s) return responder(404, {}, 'Not Found');
      if (!range) return responder(400);
      if (range.startsWith('bytes */')) {
        if (s.recebidos >= s.total) return responder(200, { 'Content-Type': 'application/json' }, JSON.stringify({ id: this.videoId }));
        return responder(308, s.recebidos ? { Range: `bytes=0-${s.recebidos - 1}` } : {});
      }
      if (this.erroNoBloco === numero) {
        this.erroNoBloco = null;
        return responder(503);
      }
      if (this.esquecerNoBloco === numero) {
        this.esquecerNoBloco = null;
        this.sessoes.delete(id);
        return responder(404, {}, 'Not Found');
      }
      const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range)!;
      const [inicio, fim, total] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const corpo = Buffer.concat(partes);
      if (inicio !== s.recebidos || total !== s.total || corpo.length !== fim - inicio + 1) return responder(400, {}, 'faixa fora de ordem');
      s.bytes.push(corpo);
      s.recebidos += corpo.length;
      if (s.recebidos >= s.total) return responder(200, { 'Content-Type': 'application/json' }, JSON.stringify({ id: this.videoId }));
      return responder(308, { Range: `bytes=0-${s.recebidos - 1}` });
    });
  }
}

describe('MD10: o envio do Mac pelo protocolo resumable (root-midia)', () => {
  let servidor: Server;
  let base = '';
  let p: Protocolo;
  const MIB = 1024 * 1024;
  const arquivo = Buffer.alloc(5 * MIB + 123_457);
  for (let i = 0; i < arquivo.length; i++) arquivo[i] = (i * 31 + 7) & 0xff;
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

  beforeAll(async () => {
    servidor = createServer((req, res) => p.tratar(req, res));
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((ok) => servidor.close(() => ok()));
  });
  beforeEach(() => {
    p = new Protocolo();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** O OS de mentira: abre sessão (nova ou a mesma), dá token. */
  function os() {
    let atual: string | null = null;
    const pedidos: boolean[] = [];
    return {
      pedidos,
      sessao: async (nova: boolean) => {
        pedidos.push(nova);
        if (nova || !atual) {
          atual = p.abrir(arquivo.length, base);
          return { uri: atual, token: 'at', nova: true };
        }
        return { uri: atual, token: 'at', nova: false };
      },
      tokenNovo: async () => ({ token: 'at-2' }),
    };
  }
  const lerBloco = async (i: number, f: number) => new Uint8Array(arquivo.subarray(i, f + 1));

  it('os números do protocolo: blocos múltiplos de 256 KiB, o próximo byte do Range e o Content-Range', () => {
    expect(BLOCO).toBe(64 * MIB);
    expect(BLOCO % MULTIPLO).toBe(0);
    expect(tamanhoDoBloco(MIB + 1000)).toBe(MIB);
    expect(tamanhoDoBloco(10)).toBe(MULTIPLO);
    expect(proximoByte('bytes=0-1048575')).toBe(1_048_576);
    expect(proximoByte(null)).toBe(0);
    expect(cabecalhoDoBloco(0, 1023, 5000)).toBe('bytes 0-1023/5000');
    expect(espera(1)).toBe(1000);
    expect(espera(10)).toBe(30_000);
    expect(caminhoDoEstado('/Users/pedro', 'ep-07')).toBe('/Users/pedro/.config/root/youtube-ep-07.json');
  });

  it('manda em blocos, cada um com o Content-Range certo, e o dublê devolve o id', async () => {
    const o = os();
    const r = await enviarAoYoutube({ total: arquivo.length, sessao: o.sessao, tokenNovo: o.tokenNovo, lerBloco, bloco: MIB, esperar: async () => undefined });
    expect(r).toEqual({ videoId: 'video-dq1', blocos: 6, retomadas: 0, sessoes: 1 });
    expect(sha(p.conteudo('s1'))).toBe(sha(arquivo));
    const faixas = p.pedidos.map((x) => x.range);
    expect(faixas[0]).toBe(`bytes 0-${MIB - 1}/${arquivo.length}`);
    expect(faixas.at(-1)).toBe(`bytes ${5 * MIB}-${arquivo.length - 1}/${arquivo.length}`);
    // Todo bloco menos o último é múltiplo de 256 KiB.
    for (const x of p.pedidos.slice(0, -1)) expect(x.tamanho % MULTIPLO).toBe(0);
  });

  it('a conexão cai no meio do 3º bloco: pergunta onde parou (308 com Range) e completa do byte certo', async () => {
    p.cortarNoBloco = 3;
    const o = os();
    const avisos: string[] = [];
    const r = await enviarAoYoutube({ total: arquivo.length, sessao: o.sessao, tokenNovo: o.tokenNovo, lerBloco, bloco: MIB, esperar: async () => undefined, avisar: (m) => avisos.push(m) });
    expect(r.videoId).toBe('video-dq1');
    expect(r.retomadas).toBe(1);
    expect(r.sessoes).toBe(1);
    expect(sha(p.conteudo('s1'))).toBe(sha(arquivo));
    // Depois do corte, a consulta de status e a retomada no meio do bloco (o que já chegou não vai de novo).
    const iConsulta = p.pedidos.findIndex((x) => x.range === `bytes */${arquivo.length}`);
    expect(iConsulta).toBeGreaterThan(0);
    expect(p.pedidos[iConsulta].status).toBe(308);
    expect(p.pedidos[iConsulta + 1].range).toMatch(new RegExp(`^bytes ${2 * MIB + MULTIPLO}-`));
    expect(avisos.join(' ')).toMatch(/conexão caiu/);
  });

  it('5xx: espera, pergunta onde parou e segue, na MESMA sessão', async () => {
    p.erroNoBloco = 2;
    const esperas: number[] = [];
    const o = os();
    const r = await enviarAoYoutube({ total: arquivo.length, sessao: o.sessao, tokenNovo: o.tokenNovo, lerBloco, bloco: MIB, esperar: async (ms) => void esperas.push(ms) });
    expect(r.videoId).toBe('video-dq1');
    expect(esperas).toEqual([1000]);
    expect(sha(p.conteudo('s1'))).toBe(sha(arquivo));
    expect(o.pedidos).toEqual([false]);
  });

  it('401 uma vez: pede UM token novo ao OS para a MESMA sessão, pergunta onde parou e completa', async () => {
    p.recusarTokenNoBloco = 3;
    const o = os();
    let pedidosDeToken = 0;
    const r = await enviarAoYoutube({
      total: arquivo.length, sessao: o.sessao, tokenNovo: async () => ({ token: `at-${++pedidosDeToken + 1}` }), lerBloco, bloco: MIB, esperar: async () => undefined,
    });
    expect(r).toMatchObject({ videoId: 'video-dq1', sessoes: 1 });
    expect(pedidosDeToken).toBe(1);
    expect(o.pedidos).toEqual([false]);
    expect(sha(p.conteudo('s1'))).toBe(sha(arquivo));
  });

  it('401 que persiste com o MESMO token de volta: desiste na hora, depois de pedir um token só, e diz para conectar de novo', async () => {
    p.recusarTokenNoBloco = 2;
    const o = os();
    let pedidosDeToken = 0;
    await expect(
      enviarAoYoutube({ total: arquivo.length, sessao: o.sessao, tokenNovo: async () => (pedidosDeToken++, { token: 'at' }), lerBloco, bloco: MIB, esperar: async () => undefined }),
    ).rejects.toThrow(/mesmo token: conecte o canal de novo/);
    expect(pedidosDeToken).toBe(1);
    expect(p.pedidos.filter((x) => x.status === 401)).toHaveLength(1);
  });

  it('401 que persiste com tokens novos (a autorização foi tirada): desiste depois de TOKENS_SEGUIDOS tokens, sem laço', async () => {
    p.recusarTokenNoBloco = 2;
    const o = os();
    let pedidosDeToken = 0;
    const tokenNovo = async () => {
      const t = `at-recusado-${++pedidosDeToken}`;
      p.tokensRecusados.add(t);
      return { token: t };
    };
    await expect(enviarAoYoutube({ total: arquivo.length, sessao: o.sessao, tokenNovo, lerBloco, bloco: MIB, esperar: async () => undefined })).rejects.toThrow(
      /recusou 3 tokens seguidos \(HTTP 401\).*conecte o canal de novo/,
    );
    expect(pedidosDeToken).toBe(TOKENS_SEGUIDOS);
    expect(p.pedidos.filter((x) => x.status === 401)).toHaveLength(TOKENS_SEGUIDOS + 1);
  });

  it('404 de sessão: pede uma NOVA ao OS e recomeça do zero, na sessão nova', async () => {
    p.esquecerNoBloco = 4;
    const o = os();
    const r = await enviarAoYoutube({ total: arquivo.length, sessao: o.sessao, tokenNovo: o.tokenNovo, lerBloco, bloco: MIB, esperar: async () => undefined });
    expect(r).toMatchObject({ videoId: 'video-dq1', sessoes: 2 });
    expect(o.pedidos).toEqual([false, true]);
    expect(p.sessoes.has('s1')).toBe(false);
    expect(sha(p.conteudo('s2'))).toBe(sha(arquivo));
  });

  it('o processo morre no meio (o Mac desligou): a próxima execução pede a MESMA sessão, pergunta onde parou e manda só o resto', async () => {
    const o = os();
    let lidos = 0;
    const morrer = async (i: number, f: number) => {
      if (++lidos === 4) throw new Error('o processo morreu');
      return lerBloco(i, f);
    };
    const estados: Array<Record<string, unknown>> = [];
    await expect(
      enviarAoYoutube({ total: arquivo.length, sessao: o.sessao, tokenNovo: o.tokenNovo, lerBloco: morrer, bloco: MIB, esperar: async () => undefined, gravarEstado: (e) => estados.push(e) }),
    ).rejects.toThrow(/morreu/);
    expect(p.sessoes.get('s1')!.recebidos).toBe(3 * MIB);
    expect(estados.at(-1)).toMatchObject({ ultimoByte: 3 * MIB, total: arquivo.length });
    // O estado no disco não tem a URI nem o token.
    expect(JSON.stringify(estados)).not.toMatch(/sessao\/s1|"at"/);

    const antesDoRecomeco = p.pedidos.length;
    const r = await enviarAoYoutube({ total: arquivo.length, sessao: o.sessao, tokenNovo: o.tokenNovo, lerBloco, bloco: MIB, esperar: async () => undefined });
    expect(r).toMatchObject({ videoId: 'video-dq1', sessoes: 1, blocos: 3 });
    expect(o.pedidos).toEqual([false, false]);
    expect(p.pedidos[antesDoRecomeco]).toMatchObject({ range: `bytes */${arquivo.length}`, status: 308 });
    expect(sha(p.conteudo('s1'))).toBe(sha(arquivo));
  });

  it('a resposta final perdida: a consulta de status devolve o id em vez de reenviar tudo', async () => {
    const o = os();
    await enviarAoYoutube({ total: arquivo.length, sessao: o.sessao, tokenNovo: o.tokenNovo, lerBloco, bloco: MIB, esperar: async () => undefined });
    const pedidosAntes = p.pedidos.length;
    const r = await enviarAoYoutube({ total: arquivo.length, sessao: o.sessao, tokenNovo: o.tokenNovo, lerBloco, bloco: MIB, esperar: async () => undefined });
    expect(r).toMatchObject({ videoId: 'video-dq1', blocos: 0 });
    expect(p.pedidos.length - pedidosAntes).toBe(1);
  });

  it('recusa que não é do protocolo (400) para com a frase do YouTube, sem tentar de novo', async () => {
    const o = os();
    const errado = async (i: number, f: number) => new Uint8Array(arquivo.subarray(i, f)); // um byte a menos
    await expect(
      enviarAoYoutube({ total: arquivo.length, sessao: o.sessao, tokenNovo: o.tokenNovo, lerBloco: errado, bloco: MIB, esperar: async () => undefined }),
    ).rejects.toThrow(/HTTP 400/);
  });
});
