import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { YOUTUBE_AUDITORIA_ROTULO, youtubeAuditoria } from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CofreService, SegredoIndisponivelError } from '../cofre/cofre.service';
import { NOMES_CONHECIDOS } from '../cofre/segredo';
import { comTenantPublico, resolverOrgDaChave } from '../common/tenant-publico';
import { PRAZO_DA_CHAMADA_DE_SONDA_MS, RegistroDeConectores } from '../integrations/conectores.registry';
import {
  type ConectorDoContrato,
  type ContextoDoVerbo,
  type ResultadoDeAutorizacao,
  type ResultadoDeRevogacao,
  type ResultadoDeSincronizacao,
  type SaudeDeConector,
  conectado,
  erroDeConector,
  frasedoErro,
  naoConfigurado,
} from '../integrations/contrato-de-conector';
import {
  ErroDoYoutube,
  type ClienteDoYoutube,
  type MetadadosDoVideo,
  type ResultadoDaSessao,
  type UploadDoCanal,
  type VideoNoYoutube,
} from '../pauta/cliente-do-youtube';
import type { ConexaoDoYoutube } from './conexao-do-youtube';

/*
 * ============================================================================
 * O CONECTOR DO YOUTUBE (MD10)
 * ============================================================================
 *
 * Projeto PRÓPRIO no Google Cloud, separado do Google da empresa
 * (`google/google.service.ts`): outro par cliente/segredo, outros escopos e
 * outra tela de consentimento. O `SCOPES` do Google não muda — pedir escopo do
 * YouTube ali faria toda empresa que conecta o Gmail dar acesso ao canal.
 *
 * Escopos: `youtube.upload` (abrir a sessão de envio) e `youtube.force-ssl`
 * (`videos.update`, `thumbnails.set` e `playlistItems.insert` não aceitam só o
 * de envio). O refresh token mora no COFRE, chave `youtube`, e nunca sai dele;
 * o token de acesso com os dois escopos fica só na memória do processo (uma
 * réplica da API). O Mac recebe OUTRO, renovado pedindo só `youtube.upload`
 * (`tokenDoEnvio`), por ~1 h, para mandar os bytes à sessão já aberta: com
 * ele, não dá para tornar um vídeo público nem apagar.
 *
 * Este arquivo é o ÚNICO com o endereço do YouTube. Quem escreve no canal são
 * os efeitos da pauta (`pauta/envio-ao-youtube.service.ts`), pela porta, com o
 * cliente que chega por injeção (`CLIENTE_DO_YOUTUBE`).
 *
 * `YOUTUBE_API_URL`, `YOUTUBE_UPLOAD_URL` e `YOUTUBE_OAUTH_URL` existem para o
 * dublê do ensaio: fora de loopback só `https://`, porque o token vai no
 * cabeçalho.
 */

const CONECTOR = 'youtube';
const ESCOPO_DO_ENVIO = 'https://www.googleapis.com/auth/youtube.upload';
const ESCOPOS = [ESCOPO_DO_ENVIO, 'https://www.googleapis.com/auth/youtube.force-ssl'] as const;
const PAGINA_DE_CONSENTIMENTO = 'https://accounts.google.com/o/oauth2/v2/auth';
const API_PADRAO = 'https://www.googleapis.com/youtube/v3';
const UPLOAD_PADRAO = 'https://www.googleapis.com/upload/youtube/v3';
const OAUTH_PADRAO = 'https://oauth2.googleapis.com';
/** O `typ` do `state` do OAuth: o `JwtAuthGuard` só aceita `sessao`, então este token nunca vale como login. */
export const TIPO_DO_ESTADO_DO_YOUTUBE = 'estado-youtube';
/** O token de acesso é renovado quando falta menos que isto para vencer. */
const FOLGA_DO_TOKEN_MS = 5 * 60_000;
const PRAZO_DA_CHAMADA_MS = 60_000;

/** URL de fornecedor vinda de variável: só https, ou http em loopback (o dublê). */
export function urlDoFornecedor(valor: string | undefined, padrao: string): string {
  const v = (valor ?? '').trim().replace(/\/+$/, '');
  if (!v) return padrao;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new Error(`URL do YouTube inválida: "${v}".`);
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const loopback = host === 'localhost' || host === '::1' || /^127\./.test(host);
  if (u.protocol === 'https:' || (u.protocol === 'http:' && loopback)) return v;
  throw new Error(`URL do YouTube "${v}" é http fora desta máquina: o token iria em claro. Use https://.`);
}

function listaDeEscopos(concedidos: string | null | undefined): string[] {
  return String(concedidos ?? '').split(/[\s,]+/).filter(Boolean);
}

/** Os escopos concedidos cobrem os dois pedidos? O Google deixa a pessoa desmarcar um. */
export function escoposCompletos(concedidos: string | null | undefined): boolean {
  const lista = listaDeEscopos(concedidos);
  return ESCOPOS.every((e) => lista.includes(e));
}

/** O token renovado para o Mac tem SÓ o escopo de envio? Sem o campo `scope` na resposta, não se sabe: conta como não. */
export function soOEscopoDoEnvio(concedidos: string | null | undefined): boolean {
  const lista = listaDeEscopos(concedidos);
  return lista.length > 0 && lista.every((e) => e === ESCOPO_DO_ENVIO);
}

/** Uma autorização em Testing vence 7 dias depois do consentimento. */
const VALIDADE_EM_TESTING_MS = 7 * 86_400_000;

function paraVideo(item: Record<string, any> | null | undefined): VideoNoYoutube | null {
  if (!item || typeof item.id !== 'string') return null;
  const sn = item.snippet ?? {};
  const st = item.status ?? {};
  return {
    id: item.id,
    titulo: typeof sn.title === 'string' ? sn.title : null,
    descricao: typeof sn.description === 'string' ? sn.description : null,
    categoria: sn.categoryId != null ? String(sn.categoryId) : null,
    privacidade: typeof st.privacyStatus === 'string' ? st.privacyStatus : null,
    publishAt: typeof st.publishAt === 'string' ? st.publishAt : null,
    uploadStatus: typeof st.uploadStatus === 'string' ? st.uploadStatus : null,
    tamanho: item.fileDetails?.fileSize != null && Number.isFinite(Number(item.fileDetails.fileSize)) ? Number(item.fileDetails.fileSize) : null,
  };
}

function emSaoPaulo(d: Date): string {
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

async function erroDaResposta(r: Response, onde: string): Promise<ErroDoYoutube> {
  const corpo = await r.text().catch(() => '');
  let mensagem = corpo.slice(0, 300);
  let razao: string | null = null;
  try {
    const j = JSON.parse(corpo) as { error?: { message?: string; errors?: Array<{ reason?: string }> } | string; error_description?: string };
    if (typeof j.error === 'object' && j.error) {
      mensagem = j.error.message ?? mensagem;
      razao = j.error.errors?.[0]?.reason ?? null;
    } else if (typeof j.error === 'string') {
      razao = j.error;
      mensagem = j.error_description ?? j.error;
    }
  } catch {
    /* corpo que não é JSON: vai o texto */
  }
  return new ErroDoYoutube(r.status, `O YouTube respondeu HTTP ${r.status} em ${onde}: ${mensagem}`.slice(0, 500), razao);
}

@Injectable()
export class YoutubeService implements OnModuleInit, ClienteDoYoutube, ConexaoDoYoutube {
  private readonly log = new Logger('YoutubeService');
  /** O token de acesso de cada empresa, só em memória. O refresh token fica no cofre. */
  private readonly tokens = new Map<string, { token: string; expiraEm: Date }>();
  /** O token que vai ao Mac, pedido só com o escopo de envio; separado do de cima, que nunca sai da API. */
  private readonly tokensDoEnvio = new Map<string, { token: string; expiraEm: Date; soEnvio: boolean }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly contrato: RegistroDeConectores,
    private readonly jwt: JwtService,
    /** `@Optional()` porque a suíte monta à mão; sem cofre, nenhuma empresa está conectada. */
    @Optional() private readonly cofre?: CofreService,
  ) {}

  // Lidas a cada uso: o ensaio e a suíte trocam o ambiente depois de montar o serviço.
  private get clientId() {
    return (process.env.YOUTUBE_CLIENT_ID ?? '').trim();
  }
  private get clientSecret() {
    return (process.env.YOUTUBE_CLIENT_SECRET ?? '').trim();
  }
  private get redirectUri() {
    return (process.env.YOUTUBE_REDIRECT_URI ?? '').trim() || 'http://localhost:4000/api/youtube/callback';
  }
  private get api() {
    return urlDoFornecedor(process.env.YOUTUBE_API_URL, API_PADRAO);
  }
  private get upload() {
    return urlDoFornecedor(process.env.YOUTUBE_UPLOAD_URL, UPLOAD_PADRAO);
  }
  private get oauth() {
    return urlDoFornecedor(process.env.YOUTUBE_OAUTH_URL, OAUTH_PADRAO);
  }
  private get web() {
    return process.env.WEB_ORIGIN?.split(',')[0]?.trim() || 'http://localhost:4000';
  }

  get configurado(): boolean {
    return this.clientId.length > 0 && this.clientSecret.length > 0;
  }

  onModuleInit(): void {
    this.contrato.registrar(this.descritorDoContrato(), 'YoutubeService');
  }

  // ------------------------------------------------------------------ OAuth

  /** A página de consentimento do Google, com o `state` assinado (10 min) que diz de que empresa e de quem é o pedido. */
  urlDeAutorizacao(orgId: string, actorId: string | null): string {
    const state = this.jwt.sign({ typ: TIPO_DO_ESTADO_DO_YOUTUBE, org: orgId, sub: actorId ?? null }, { expiresIn: '10m' });
    const p = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'false',
      scope: ESCOPOS.join(' '),
      state,
    });
    return `${PAGINA_DE_CONSENTIMENTO}?${p}`;
  }

  /** A empresa do `state`, ou nulo: assinatura, prazo e `typ` conferidos antes de qualquer consulta. */
  private empresaDoEstado(estado: string): { orgId: string; actorId: string | null } | null {
    if (typeof estado !== 'string' || estado.length > 2048) return null;
    try {
      const c = this.jwt.verify<{ typ?: string; org?: string; sub?: string | null }>(estado);
      if (c.typ !== TIPO_DO_ESTADO_DO_YOUTUBE || typeof c.org !== 'string' || !c.org) return null;
      return { orgId: c.org, actorId: typeof c.sub === 'string' ? c.sub : null };
    } catch {
      return null;
    }
  }

  private volta(motivo: string): string {
    return `${this.web}/pauta?aba=episodios&youtube=${encodeURIComponent(motivo)}`;
  }

  /**
   * O retorno do Google (rota pública). O `state` é conferido antes do banco;
   * a empresa sai dele e o resto roda no contexto dela (o cofre exige). Sem o
   * refresh token ou com um escopo desmarcado, nada é guardado.
   */
  async concluirAutorizacao(estado: string, codigo: string | undefined, erro: string | undefined): Promise<string> {
    const alvo = this.empresaDoEstado(estado);
    if (!alvo) return this.volta('expirado');
    if (erro) return this.volta(erro === 'access_denied' ? 'cancelado' : 'erro');
    if (!codigo || typeof codigo !== 'string' || codigo.length > 2048) return this.volta('erro');
    if (!this.configurado) return this.volta('sem_credencial');
    const org = await resolverOrgDaChave(this.prisma, alvo.orgId);
    if (!org) return this.volta('expirado');

    return comTenantPublico(org.orgId, async () => {
      try {
        const r = await fetch(`${this.oauth}/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code: codigo,
            client_id: this.clientId,
            client_secret: this.clientSecret,
            redirect_uri: this.redirectUri,
            grant_type: 'authorization_code',
          }),
          signal: AbortSignal.timeout(PRAZO_DA_CHAMADA_MS),
        });
        if (!r.ok) throw await erroDaResposta(r, 'a troca do código');
        const t = (await r.json()) as {
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
          scope?: string;
          refresh_token_expires_in?: number;
        };
        if (!t.access_token || !t.refresh_token) return this.volta('sem_refresh');
        if (!escoposCompletos(t.scope)) return this.volta('escopo_incompleto');
        if (!this.cofre) return this.volta('sem_cofre');
        // Em Testing o Google devolve `refresh_token_expires_in` (7 dias): a saúde acusa.
        const refreshVenceEm = t.refresh_token_expires_in ? new Date(Date.now() + t.refresh_token_expires_in * 1000) : null;
        await this.cofre.guardar({
          orgId: org.orgId,
          conector: CONECTOR,
          nome: NOMES_CONHECIDOS.renovacao,
          valor: t.refresh_token,
          escopo: String(t.scope ?? '').split(/[\s,]+/).filter(Boolean),
          origem: 'youtube-oauth',
          expiraEm: refreshVenceEm,
          actorId: alvo.actorId,
        });
        this.tokens.set(org.orgId, { token: t.access_token, expiraEm: new Date(Date.now() + ((t.expires_in ?? 3600) - 60) * 1000) });
        // O token do envio guardado é da autorização anterior (talvez de outro canal): não sai mais ao Mac.
        this.tokensDoEnvio.delete(org.orgId);
        const canal = await this.canal(org.orgId).catch(() => null);
        // Sem o canal lido, o `canalId` da conexão anterior NÃO fica: a trava do modo teste leria o canal errado.
        await this.marcarIntegracao(org.orgId, 'connected', canal, { esquecerCanal: !canal });
        await this.audit.log({
          orgId: org.orgId,
          actorId: alvo.actorId ?? undefined,
          action: 'youtube.conectado',
          entityType: 'integration',
          entityId: CONECTOR,
          after: { canal: canal?.titulo ?? null, canalId: canal?.id ?? null, testing: !!refreshVenceEm },
        });
        this.contrato.esquecer(org.orgId, CONECTOR);
        return this.volta(refreshVenceEm ? 'ok_testing' : 'ok');
      } catch (e) {
        this.log.error(`retorno do OAuth do YouTube falhou (empresa ${org.orgId}): ${(e as Error).message}`);
        return this.volta('erro');
      }
    });
  }

  /** O canal da conta autorizada. */
  private async canal(orgId: string, prazoMs = PRAZO_DA_CHAMADA_MS): Promise<{ id: string; titulo: string } | null> {
    const j = await this.pedir<{ items?: Array<{ id: string; snippet?: { title?: string } }> }>(
      orgId,
      'GET',
      `${this.api}/channels?part=snippet&mine=true`,
      { onde: 'channels.list', prazoMs },
    );
    const c = j.items?.[0];
    return c ? { id: c.id, titulo: c.snippet?.title ?? c.id } : null;
  }

  private async marcarIntegracao(
    orgId: string,
    status: 'connected' | 'disconnected',
    canal: { id: string; titulo: string } | null,
    o: { esquecerCanal?: boolean } = {},
  ) {
    const ex = await this.prisma.integrationAccount.findFirst({ where: { orgId, key: CONECTOR } });
    const config = canal ? { canalId: canal.id, canal: canal.titulo } : o.esquecerCanal ? { canalId: null, canal: null } : undefined;
    if (ex) {
      await this.prisma.integrationAccount.update({
        where: { id: ex.id },
        data: { status, ...(config ? { config } : {}), connectedAt: status === 'connected' ? new Date() : ex.connectedAt },
      });
    } else {
      await this.prisma.integrationAccount.create({
        data: { orgId, key: CONECTOR, label: 'YouTube', status, ...(config ? { config } : {}), connectedAt: status === 'connected' ? new Date() : null },
      });
    }
  }

  // ------------------------------------------------------------------ credencial

  /** A linha do refresh token no cofre (sem o valor): existe, não revogada, não vencida. */
  private async linhaDoCofre(orgId: string): Promise<{ expiraEm: string | null } | null> {
    if (!this.cofre) return null;
    try {
      const { items } = await this.cofre.estado(orgId);
      const l = items.find((i) => i.conector === CONECTOR && i.nome === NOMES_CONHECIDOS.renovacao);
      if (!l || l.revogadoEm) return null;
      if (l.expiraEm && new Date(l.expiraEm).getTime() <= Date.now()) return null;
      return { expiraEm: l.expiraEm };
    } catch {
      return null;
    }
  }

  async conectado(orgId: string): Promise<boolean> {
    return !!(await this.linhaDoCofre(orgId));
  }

  async tokenDeAcesso(orgId: string, prazoMs = PRAZO_DA_CHAMADA_MS): Promise<{ token: string; expiraEm: Date }> {
    const guardado = this.tokens.get(orgId);
    if (guardado && guardado.expiraEm.getTime() - Date.now() > FOLGA_DO_TOKEN_MS) return guardado;
    const t = await this.renovar(orgId, prazoMs);
    const novo = { token: t.token, expiraEm: t.expiraEm };
    this.tokens.set(orgId, novo);
    return novo;
  }

  async tokenDoEnvio(orgId: string, o: { forcar?: boolean } = {}): Promise<{ token: string; expiraEm: Date; soEnvio: boolean }> {
    const guardado = this.tokensDoEnvio.get(orgId);
    if (!o.forcar && guardado && guardado.expiraEm.getTime() - Date.now() > FOLGA_DO_TOKEN_MS) return guardado;
    this.tokensDoEnvio.delete(orgId);
    const t = await this.renovar(orgId, PRAZO_DA_CHAMADA_MS, ESCOPO_DO_ENVIO);
    const novo = { token: t.token, expiraEm: t.expiraEm, soEnvio: soOEscopoDoEnvio(t.escopo) };
    this.tokensDoEnvio.set(orgId, novo);
    return novo;
  }

  /**
   * Um token novo pelo refresh token do cofre. Com `escopo`, pede só ele (o
   * `scope` da renovação, que o OAuth permite estreitar); quem chama confere o
   * `scope` da resposta, porque o Google pode ignorar o pedido.
   */
  private async renovar(orgId: string, prazoMs: number, escopo?: string): Promise<{ token: string; expiraEm: Date; escopo: string | null }> {
    if (!this.configurado) {
      throw new ErroDoYoutube(null, 'O YouTube não tem credencial neste processo (YOUTUBE_CLIENT_ID e YOUTUBE_CLIENT_SECRET).');
    }
    if (!this.cofre) throw new ErroDoYoutube(null, 'O cofre não está de pé: sem ele, nenhuma credencial do YouTube é lida.');
    let refresh: string;
    try {
      refresh = await this.cofre.envolver({ orgId, conector: CONECTOR, nome: NOMES_CONHECIDOS.renovacao }, (c) => c.usar(async (s) => s));
    } catch (e) {
      if (e instanceof SegredoIndisponivelError) {
        throw new ErroDoYoutube(null, e.revogado ? 'A autorização do YouTube desta empresa foi revogada: conecte o canal de novo.' : 'O canal do YouTube não está conectado nesta empresa.');
      }
      throw e;
    }
    const corpo = new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, refresh_token: refresh, grant_type: 'refresh_token' });
    if (escopo) corpo.set('scope', escopo);
    const r = await fetch(`${this.oauth}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corpo,
      signal: AbortSignal.timeout(prazoMs),
    }).catch((e: Error) => {
      throw new ErroDoYoutube(null, `A renovação do token do YouTube não teve resposta: ${e.message}`);
    });
    if (!r.ok) {
      const erro = await erroDaResposta(r, 'a renovação do token');
      if (erro.razao === 'invalid_grant') {
        throw new ErroDoYoutube(
          r.status,
          'O Google recusou a renovação: a autorização venceu ou foi revogada (com a tela de consentimento em Testing, ela vence em 7 dias). Conecte o canal de novo.',
          'invalid_grant',
        );
      }
      throw erro;
    }
    const t = (await r.json()) as { access_token?: string; expires_in?: number; scope?: string };
    if (!t.access_token) throw new ErroDoYoutube(r.status, 'A renovação do token do YouTube não devolveu token.');
    return { token: t.access_token, expiraEm: new Date(Date.now() + ((t.expires_in ?? 3600) - 60) * 1000), escopo: typeof t.scope === 'string' ? t.scope : null };
  }

  async canalConectado(orgId: string): Promise<string | null> {
    const conta = await this.prisma.integrationAccount.findFirst({ where: { orgId, key: CONECTOR, status: 'connected' }, select: { config: true } });
    const id = (conta?.config as { canalId?: unknown } | null)?.canalId;
    return typeof id === 'string' && id ? id : null;
  }

  urlDoVideo(videoId: string): string {
    return `https://youtu.be/${encodeURIComponent(videoId)}`;
  }

  /** Uma chamada autenticada ao YouTube. Só destinos fixos, montados neste arquivo. */
  private async pedir<T>(
    orgId: string,
    metodo: 'GET' | 'POST' | 'PUT',
    url: string,
    o: { onde: string; json?: unknown; corpo?: Buffer; tipo?: string; cabecalhos?: Record<string, string>; prazoMs?: number; location?: boolean },
  ): Promise<T> {
    const { token } = await this.tokenDeAcesso(orgId);
    let r: Response;
    try {
      r = await fetch(url, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(o.json !== undefined ? { 'Content-Type': 'application/json; charset=UTF-8' } : {}),
          ...(o.tipo ? { 'Content-Type': o.tipo } : {}),
          ...(o.cabecalhos ?? {}),
        },
        body: o.json !== undefined ? JSON.stringify(o.json) : o.corpo ? new Uint8Array(o.corpo) : undefined,
        signal: AbortSignal.timeout(o.prazoMs ?? PRAZO_DA_CHAMADA_MS),
      });
    } catch (e) {
      throw new ErroDoYoutube(null, `O YouTube não respondeu em ${o.onde}: ${(e as Error).message}`);
    }
    if (!r.ok) throw await erroDaResposta(r, o.onde);
    if (o.location) {
      const onde = r.headers.get('location');
      await r.text().catch(() => '');
      if (!onde) throw new ErroDoYoutube(r.status, `O YouTube abriu a sessão sem devolver o endereço dela (${o.onde}).`);
      return onde as T;
    }
    const texto = await r.text();
    return (texto ? JSON.parse(texto) : {}) as T;
  }

  // ------------------------------------------------------------------ o cliente da pauta

  async abrirSessao(orgId: string, e: { bytes: number; mime: string; metadados: MetadadosDoVideo }): Promise<string> {
    const uri = await this.pedir<string>(orgId, 'POST', `${this.upload}/videos?uploadType=resumable&part=snippet,status`, {
      onde: 'videos.insert (sessão resumable)',
      json: {
        snippet: { title: e.metadados.titulo, description: e.metadados.descricao, categoryId: e.metadados.categoria },
        // SEMPRE privado e sem publishAt: quem agenda é `agendar`, com o lote.
        status: { privacyStatus: 'private', selfDeclaredMadeForKids: false },
      },
      cabecalhos: { 'X-Upload-Content-Length': String(e.bytes), 'X-Upload-Content-Type': e.mime },
      location: true,
    });
    // O Mac manda o token para a URI da sessão: só https (ou o dublê em loopback).
    urlDoFornecedor(uri, uri);
    return uri;
  }

  async resultadoDaSessao(orgId: string, uri: string, bytes: number): Promise<ResultadoDaSessao> {
    urlDoFornecedor(uri, uri);
    const { token } = await this.tokenDeAcesso(orgId);
    let r: Response;
    try {
      r = await fetch(uri, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Range': `bytes */${bytes}` },
        redirect: 'manual',
        signal: AbortSignal.timeout(PRAZO_DA_CHAMADA_MS),
      });
    } catch (e) {
      throw new ErroDoYoutube(null, `O YouTube não respondeu à consulta da sessão de envio: ${(e as Error).message}`);
    }
    // 308 é "incompleto" no protocolo resumable; o `Range` diz até onde chegou.
    if (r.status === 308) {
      const faixa = /bytes=0-(\d+)/.exec(r.headers.get('range') ?? '');
      await r.text().catch(() => '');
      return { videoId: null, recebidos: faixa ? Number(faixa[1]) + 1 : 0 };
    }
    if (!r.ok) throw await erroDaResposta(r, 'a consulta da sessão de envio');
    const texto = await r.text();
    const j = (texto ? JSON.parse(texto) : {}) as { id?: unknown };
    return { videoId: typeof j.id === 'string' && j.id ? j.id : null, recebidos: bytes };
  }

  async lerVideo(orgId: string, videoId: string): Promise<VideoNoYoutube | null> {
    const j = await this.pedir<{ items?: Array<Record<string, any>> }>(
      orgId,
      'GET',
      `${this.api}/videos?part=snippet,status,fileDetails&id=${encodeURIComponent(videoId)}`,
      { onde: 'videos.list' },
    );
    return paraVideo(j.items?.[0]);
  }

  async uploadsDoCanal(orgId: string): Promise<UploadDoCanal[]> {
    const c = await this.pedir<{ items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }> }>(
      orgId,
      'GET',
      `${this.api}/channels?part=contentDetails&mine=true`,
      { onde: 'channels.list (uploads)' },
    );
    const playlist = c.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!playlist) return [];
    const j = await this.pedir<{ items?: Array<Record<string, any>> }>(
      orgId,
      'GET',
      `${this.api}/playlistItems?part=snippet,status&playlistId=${encodeURIComponent(playlist)}&maxResults=50`,
      { onde: 'playlistItems.list (uploads)' },
    );
    return (j.items ?? [])
      .map((i) => ({
        videoId: String(i.snippet?.resourceId?.videoId ?? ''),
        privacidade: typeof i.status?.privacyStatus === 'string' ? i.status.privacyStatus : null,
        enviadoEm: typeof i.snippet?.publishedAt === 'string' ? i.snippet.publishedAt : null,
      }))
      .filter((u) => u.videoId);
  }

  async definirThumb(orgId: string, videoId: string, png: Buffer): Promise<void> {
    await this.pedir(orgId, 'POST', `${this.upload}/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`, {
      onde: 'thumbnails.set',
      corpo: png,
      tipo: 'image/png',
    });
  }

  async inserirNaPlaylist(orgId: string, playlistId: string, videoId: string): Promise<string> {
    // O insert não é idempotente: a resposta perdida, ou a gravação que falhou depois dele, repetiria a entrada.
    const ja = await this.pedir<{ items?: Array<{ id?: string }> }>(
      orgId,
      'GET',
      `${this.api}/playlistItems?part=id&playlistId=${encodeURIComponent(playlistId)}&videoId=${encodeURIComponent(videoId)}&maxResults=1`,
      { onde: 'playlistItems.list' },
    );
    if (ja.items?.[0]?.id) return ja.items[0].id;
    const j = await this.pedir<{ id?: string }>(orgId, 'POST', `${this.api}/playlistItems?part=snippet`, {
      onde: 'playlistItems.insert',
      json: { snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } } },
    });
    return j.id ?? '';
  }

  async agendar(orgId: string, videoId: string, publishAt: Date): Promise<VideoNoYoutube> {
    // Só `part=status`: um update de snippet apagaria o que fosse omitido.
    const j = await this.pedir<Record<string, any>>(orgId, 'PUT', `${this.api}/videos?part=status`, {
      onde: 'videos.update (status)',
      json: { id: videoId, status: { privacyStatus: 'private', publishAt: publishAt.toISOString(), selfDeclaredMadeForKids: false } },
    });
    const v = paraVideo(j);
    if (!v) throw new ErroDoYoutube(200, 'O YouTube aceitou o agendamento sem devolver o vídeo.');
    return v;
  }

  // ------------------------------------------------------------------ revogar

  private async desconectar(orgId: string, actorId: string | null, motivo: string | null): Promise<string[]> {
    if (!this.cofre) return [];
    let refresh: string | null = null;
    try {
      refresh = await this.cofre.envolver({ orgId, conector: CONECTOR, nome: NOMES_CONHECIDOS.renovacao }, (c) => c.usar(async (s) => s));
    } catch {
      refresh = null;
    }
    // Revogar do lado do Google é o que faz a autorização morrer de verdade; falhar aqui não impede queimar o cofre.
    if (refresh && this.configurado) {
      await fetch(`${this.oauth}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refresh }),
        signal: AbortSignal.timeout(10_000),
      }).catch((e: Error) => this.log.warn(`revogação no Google falhou (empresa ${orgId}): ${e.message}`));
    }
    const r = await this.cofre.revogar({ orgId, conector: CONECTOR, motivo, por: actorId });
    this.tokens.delete(orgId);
    this.tokensDoEnvio.delete(orgId);
    await this.marcarIntegracao(orgId, 'disconnected', null);
    await this.audit.log({ orgId, actorId: actorId ?? undefined, action: 'youtube.desconectado', entityType: 'integration', entityId: CONECTOR, after: { revogados: r.revogados } });
    return r.revogados;
  }

  /**
   * O Google só às vezes manda `refresh_token_expires_in` em Testing (a
   * documentação diz que o campo vem no acesso por tempo). Sem ele, a
   * autorização da primeira semana ainda pode vencer aos 7 dias: a saúde lembra
   * pela data da conexão, e o aviso some sozinho quando ela passa dos 7 dias
   * de pé.
   */
  private async talvezTesting(orgId: string): Promise<string> {
    const conta = await this.prisma.integrationAccount.findFirst({ where: { orgId, key: CONECTOR }, select: { connectedAt: true } }).catch(() => null);
    const desde = conta?.connectedAt;
    if (!desde || Date.now() - desde.getTime() >= VALIDADE_EM_TESTING_MS) return '';
    return ` Se a tela de consentimento ainda estiver em Testing, esta autorização vence em ${emSaoPaulo(new Date(desde.getTime() + VALIDADE_EM_TESTING_MS))}: confira no Google Cloud.`;
  }

  // ------------------------------------------------------------------ o contrato

  private descritorDoContrato(): ConectorDoContrato {
    return {
      chave: CONECTOR,
      rotulo: 'YouTube (canal)',
      escopoDaCredencial: 'empresa',
      linhasDoCatalogo: [CONECTOR],

      autorizar: async (ctx: ContextoDoVerbo): Promise<ResultadoDeAutorizacao> => {
        if (!this.configurado) {
          return {
            tipo: 'manual',
            instrucao:
              'O YouTube não tem credencial neste processo: crie o projeto próprio no Google Cloud, ative a ' +
              'YouTube Data API v3, crie o cliente OAuth web com a redirect da API e ponha YOUTUBE_CLIENT_ID e ' +
              'YOUTUBE_CLIENT_SECRET no ambiente. Depois, conecte logado na conta DONA do canal.',
          };
        }
        return { tipo: 'redirecionar', url: this.urlDeAutorizacao(ctx.orgId, ctx.actorId ?? null) };
      },

      sincronizar: async (ctx: ContextoDoVerbo): Promise<ResultadoDeSincronizacao> => {
        if (!(await this.conectado(ctx.orgId))) {
          return { tipo: 'nao_se_aplica', motivo: 'O canal do YouTube não está conectado nesta empresa: não há autorização a renovar.' };
        }
        this.tokens.delete(ctx.orgId);
        this.tokensDoEnvio.delete(ctx.orgId);
        const t = await this.tokenDeAcesso(ctx.orgId);
        return { tipo: 'feito', resumo: `Autorização do YouTube renovada; o token vale até ${t.expiraEm.toLocaleString('pt-BR')}.` };
      },

      saude: async (ctx: ContextoDoVerbo): Promise<SaudeDeConector> => {
        if (!this.configurado) {
          return naoConfigurado('O YouTube não tem credencial neste processo (YOUTUBE_CLIENT_ID e YOUTUBE_CLIENT_SECRET). Nenhuma empresa consegue conectar o canal até o operador resolver.');
        }
        const linha = await this.linhaDoCofre(ctx.orgId);
        if (!linha) return naoConfigurado('Esta empresa ainda não conectou o canal do YouTube (ou a autorização venceu). Conecte logado na conta dona do canal.');
        const comecou = Date.now();
        try {
          await this.tokenDeAcesso(ctx.orgId, PRAZO_DA_CHAMADA_DE_SONDA_MS);
          const c = await this.canal(ctx.orgId, Math.max(250, PRAZO_DA_CHAMADA_DE_SONDA_MS - (Date.now() - comecou)));
          const auditoria = YOUTUBE_AUDITORIA_ROTULO[youtubeAuditoria(process.env.YOUTUBE_AUDITORIA)];
          const testing = linha.expiraEm
            ? ` ATENÇÃO: a tela de consentimento está em Testing, e a autorização vence em ${emSaoPaulo(new Date(linha.expiraEm))} — ponha o app em produção (ou Internal) e conecte de novo.`
            : await this.talvezTesting(ctx.orgId);
          return conectado(Date.now() - comecou, `canal ${c?.titulo ?? '(sem canal nesta conta)'} respondeu; ${auditoria}.${testing}`);
        } catch (e) {
          return erroDeConector(frasedoErro(e), Date.now() - comecou);
        }
      },

      revogar: async (ctx: ContextoDoVerbo & { motivo?: string | null }): Promise<ResultadoDeRevogacao> => {
        const segredos = await this.desconectar(ctx.orgId, ctx.actorId ?? null, ctx.motivo ?? null);
        return {
          tipo: 'revogado',
          segredos,
          resumo:
            'A autorização do YouTube desta empresa foi revogada no Google e queimada no cofre. Os vídeos do canal ' +
            'ficam como estão. Para voltar a enviar, conecte de novo na conta dona do canal.',
        };
      },
    };
  }
}
