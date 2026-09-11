import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EfeitosRegistry, type ContextoDoEfeito } from '../gateway/efeitos.registry';

// Conector Google (OAuth 2.0) — Gmail/Agenda/Docs/Drive. Credencial PRÓPRIA do root
// (google.env), tokens guardados por org (isolado do escritório). Escopos read+write
// (a escrita entra pelo fluxo de aprovação; reads já expostos).
const SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
];

@Injectable()
export class GoogleService implements OnModuleInit {
  private readonly log = new Logger('GoogleService');
  private readonly clientId = process.env.GOOGLE_CLIENT_ID ?? '';
  private readonly clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
  private readonly redirectUri = process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:4000/api/google/callback';
  private readonly webBase = process.env.WEB_ORIGIN?.split(',')[0] ?? 'http://localhost:4000';

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly efeitos: EfeitosRegistry,
  ) {}

  get configured(): boolean {
    return this.clientId.length > 0 && this.clientSecret.length > 0;
  }

  /*
   * ==========================================================================
   * O CONECTOR DECLARA AS CAPACIDADES QUE REALIZA — fatia 3.3
   * ==========================================================================
   *
   * Até 11/09/2026 o `GoogleController` chamava estes nove métodos direto: o
   * e-mail saía, o evento nascia e o documento era criado com a régua R0–R5 sem
   * nunca ter visto a ação. Quatro escritas externas vivas em produção,
   * autenticadas só por JWT e permissão de papel — sem classificação de risco,
   * sem retenção por aprovação, sem RASTRO e fora do alcance do interruptor de
   * conector. Era item de segurança, não de arquitetura.
   *
   * Agora a rota pede a capacidade à porta (`PortaDoOperador`), e quem a porta
   * chama é a função registrada AQUI.
   *
   * POR QUE A INSCRIÇÃO MORA DENTRO DO CONECTOR, e não num arquivo de fiação:
   * a catraca de arquitetura (`test/arquitetura.test.ts`) proíbe qualquer
   * arquivo fora de `src/gateway/` de importar um serviço de conector — e
   * proíbe também re-exportá-lo, justamente para que a proibição não tenha
   * atalho. Um `google-efeitos.service.ts` ao lado seria uma violação nova. O
   * conector importar o REGISTRO é o inverso, e é permitido: quem depende de
   * quem continua certo, e o `GatewayModule` é `@Global`, então isto não mexe
   * no grafo de módulos.
   *
   * OS ARGUMENTOS SÃO OS DO CATÁLOGO, em português, e não os do corpo HTTP. É o
   * catálogo que a porta valida (`argsSchema`) e é ele que a aprovação assina
   * pelo hash do conteúdo; o controlador traduz o corpo da requisição para cá.
   * Traduzir no controlador e não aqui é o que mantém uma única forma de
   * argumento entre o caminho do agente e o caminho da tela.
   */
  onModuleInit(): void {
    /*
     * ========================================================================
     * ESTE CONECTOR NÃO SE INSCREVE EM `ConectoresConfiguradosRegistry`
     * ========================================================================
     *
     * E a ausência é a decisão, não o esquecimento. A primeira versão desta
     * fatia inscreveu as quatro chaves do Google (`gmail`, `gcal`, `gdocs`,
     * `drive`) com `() => this.configured` — e `configured` aqui é
     * `GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET`, uma propriedade do PROCESSO.
     * Em produção ela é verdadeira para todo mundo.
     *
     * O efeito na tela de Conexões foi o oposto do pretendido: para uma empresa
     * que NUNCA autorizou o Google não existe linha em `IntegrationAccount`,
     * então a tela caía na derivação, recebia `true` e passava a exibir o Google
     * como CONECTADO. A fatia existia para tornar a tela honesta e a deixou
     * menos honesta do que antes.
     *
     * As quatro superfícies são de AUTORIZAÇÃO POR EMPRESA, e o estado
     * verdadeiro delas é a linha que `handleCallback` escreve logo abaixo. Sem
     * inscrição, o registro devolve `null` — "ninguém respondeu por esta chave"
     * —, a tela usa o registro do banco e volta a dizer a verdade.
     *
     * Quem precisa distinguir "o app não tem credencial" de "esta empresa não
     * autorizou" tem `GET /google/status`, que devolve `configured` e
     * `connected` em campos separados. O raciocínio completo está no cabeçalho
     * de `gateway/conectores-configurados.registry.ts`.
     */
    const texto = (v: unknown): string => String(v ?? '').trim();
    const numero = (v: unknown, padrao: number): number => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.min(Math.trunc(n), 50) : padrao;
    };

    this.efeitos.registrar({
      // ---------- leitura (R0) ----------
      'comunicacao.email.buscar': (a, org) =>
        this.gmailRecent(org, texto(a.q ?? a.busca), numero(a.limite, 10)),
      'comunicacao.email.ler': (a, org) => this.gmailGet(org, texto(a.id)),
      'comunicacao.agenda.listar': (a, org) => this.calendarUpcoming(org, numero(a.limite, 10)),
      'contexto.arquivo.listar': (a, org) =>
        this.driveList(org, texto(a.q ?? a.busca), numero(a.limite, 15)),
      'contexto.documento.ler': (a, org) => this.docGet(org, texto(a.id)),

      // ---------- escrita (R3: só sai depois que uma pessoa confirma) ----------
      'email.enviar': (a, org, ctx: ContextoDoEfeito) =>
        this.sendGmail(
          org,
          {
            to: texto(a.para),
            subject: texto(a.assunto),
            body: String(a.corpo ?? ''),
            ...(texto(a.cc) ? { cc: texto(a.cc) } : {}),
          },
          ctx.actorId ?? undefined,
        ),
      'agenda.evento.criar': (a, org, ctx: ContextoDoEfeito) =>
        this.createCalendarEvent(
          org,
          {
            title: texto(a.titulo),
            start: texto(a.inicio),
            // Sem fim declarado a Agenda recusa o evento. Uma hora é o default
            // menos surpreendente, e fica dito aqui em vez de o modelo ter de
            // adivinhar o formato do campo.
            end: texto(a.fim) || new Date(new Date(texto(a.inicio)).getTime() + 3600_000).toISOString(),
            description: texto(a.descricao) || undefined,
            location: texto(a.local) || undefined,
            attendees: Array.isArray(a.convidados) ? (a.convidados as string[]).map(texto) : [],
          },
          ctx.actorId ?? undefined,
        ),
      'documento.criar': (a, org, ctx: ContextoDoEfeito) =>
        this.createDoc(
          org,
          { title: texto(a.titulo), content: a.conteudo ? String(a.conteudo) : undefined },
          ctx.actorId ?? undefined,
        ),
      'documento.anexar': (a, org, ctx: ContextoDoEfeito) =>
        this.appendDoc(org, texto(a.documentoId), String(a.texto ?? ''), ctx.actorId ?? undefined),
    }, 'GoogleService');
  }

  private assert() {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'Google não configurado: defina GOOGLE_CLIENT_ID/SECRET em ~/.config/root/google.env e reinicie a API.',
      );
    }
  }

  // ---------- OAuth ----------
  authUrl(state: string): string {
    this.assert();
    const p = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent', // garante refresh_token
      include_granted_scopes: 'true',
      scope: SCOPES.join(' '),
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  }

  /** Troca o code por tokens, descobre o e-mail e guarda a conexão. Retorna p/ onde redirecionar. */
  async handleCallback(orgId: string, code: string): Promise<string> {
    this.assert();
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) throw new BadRequestException(`Troca de código falhou: HTTP ${res.status}`);
    const t = (await res.json()) as {
      access_token: string; refresh_token?: string; expires_in: number; scope?: string; token_type?: string;
    };
    const email = await this.fetchEmail(t.access_token);
    const expiresAt = new Date(Date.now() + (t.expires_in - 60) * 1000);

    await this.prisma.googleAccount.upsert({
      where: { orgId },
      update: {
        email, accessToken: t.access_token, tokenType: t.token_type, scope: t.scope, expiresAt,
        ...(t.refresh_token ? { refreshToken: t.refresh_token } : {}),
      },
      create: {
        orgId, email, accessToken: t.access_token, refreshToken: t.refresh_token,
        tokenType: t.token_type, scope: t.scope, expiresAt,
      },
    });
    await this.upsertIntegration(orgId, 'connected');
    await this.audit.log({ orgId, action: 'google.connect', entityType: 'integration', entityId: 'google', after: { email } });
    this.log.log(`Google conectado: ${email}`);
    return `${this.webBase}/google`;
  }

  private async fetchEmail(accessToken: string): Promise<string | null> {
    const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) return null;
    return ((await r.json()) as { email?: string }).email ?? null;
  }

  /** Access token válido (renova via refresh_token se expirou). */
  private async token(orgId: string): Promise<string> {
    this.assert();
    const acc = await this.prisma.googleAccount.findUnique({ where: { orgId } });
    if (!acc) throw new ServiceUnavailableException('Google não conectado. Conecte em Integrações.');
    if (acc.expiresAt > new Date()) return acc.accessToken;
    if (!acc.refreshToken) throw new ServiceUnavailableException('Sessão Google expirada. Reconecte.');

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId, client_secret: this.clientSecret,
        refresh_token: acc.refreshToken, grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) throw new ServiceUnavailableException(`Refresh do Google falhou: HTTP ${res.status}`);
    const t = (await res.json()) as { access_token: string; expires_in: number };
    const expiresAt = new Date(Date.now() + (t.expires_in - 60) * 1000);
    await this.prisma.googleAccount.update({ where: { orgId }, data: { accessToken: t.access_token, expiresAt } });
    return t.access_token;
  }

  /**
   * Chamada autenticada a uma API do Google.
   *
   * ------------------------------------------------------------------------
   * ERA PÚBLICA, E POR ISSO A FRONTEIRA NÃO EXISTIA — fatia 3.3
   * ------------------------------------------------------------------------
   * `api(orgId, url, init)` aceita URL ARBITRÁRIA e método arbitrário. Enquanto
   * ela fosse pública, qualquer serviço do projeto podia montar
   * `https://gmail.googleapis.com/.../messages/send` por fora e entregar pronto
   * — e o pedido saía com o token do tenant sem que a porta visse o método, o
   * destino ou a natureza da ação. É o caso real de `pauta/espelho.service.ts`,
   * que montava os endereços do Drive aqui do lado.
   *
   * Fechá-la é o que faz mover o import mover a fronteira de verdade: agora o
   * que sai daqui são MÉTODOS COM NOME, cada um com um destino fixo — e o que
   * não tem método não tem como ser pedido.
   *
   * Quem precisar de uma superfície nova do Google acrescenta um método aqui,
   * com nome, e — se ela agir sobre o mundo — uma capacidade no catálogo. É
   * mais trabalho de propósito: é onde a decisão de expor uma API externa nova
   * fica visível.
   */
  private async api<T = any>(orgId: string, url: string, init?: RequestInit): Promise<T> {
    const at = await this.token(orgId);
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BadRequestException(`Google ${url.split('?')[0]} → HTTP ${res.status} ${body.slice(0, 160)}`);
    }
    return res.json() as Promise<T>;
  }

  async status(orgId: string) {
    const acc = await this.prisma.googleAccount.findUnique({ where: { orgId } });
    return {
      configured: this.configured,
      connected: !!acc,
      email: acc?.email ?? null,
      scopes: acc?.scope?.split(' ') ?? [],
      connectedAt: acc?.connectedAt?.toISOString() ?? null,
      authUrl: this.configured ? this.authUrl(orgId) : null,
    };
  }

  async disconnect(orgId: string) {
    await this.prisma.googleAccount.deleteMany({ where: { orgId } });
    await this.upsertIntegration(orgId, 'disconnected');
    await this.audit.log({ orgId, action: 'google.disconnect', entityType: 'integration', entityId: 'google' });
    return { ok: true };
  }

  private async upsertIntegration(orgId: string, status: 'connected' | 'disconnected') {
    // marca as 4 integrações Google no hub (cria o registro se ainda não existir)
    const labels: Record<string, string> = { gmail: 'Gmail', drive: 'Google Drive', gcal: 'Google Agenda', gdocs: 'Google Docs' };
    for (const key of Object.keys(labels)) {
      const ex = await this.prisma.integrationAccount.findFirst({ where: { orgId, key } });
      if (ex) {
        await this.prisma.integrationAccount.update({
          where: { id: ex.id },
          data: { status, connectedAt: status === 'connected' ? new Date() : ex.connectedAt },
        });
      } else {
        await this.prisma.integrationAccount.create({
          data: { orgId, key, label: labels[key], status, connectedAt: status === 'connected' ? new Date() : null },
        });
      }
    }
  }

  // ---------- Leitura ----------
  async calendarUpcoming(orgId: string, maxResults = 10) {
    const now = new Date().toISOString();
    const j = await this.api<{ items: any[] }>(orgId,
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(now)}&maxResults=${maxResults}&singleEvents=true&orderBy=startTime`);
    return (j.items ?? []).map((e) => ({
      id: e.id,
      title: e.summary ?? '(sem título)',
      start: e.start?.dateTime ?? e.start?.date ?? null,
      end: e.end?.dateTime ?? e.end?.date ?? null,
      location: e.location ?? null,
      link: e.htmlLink ?? null,
      attendees: (e.attendees ?? []).map((a: any) => a.email).filter(Boolean),
    }));
  }

  async gmailRecent(orgId: string, q = '', maxResults = 10) {
    const list = await this.api<{ messages?: Array<{ id: string }> }>(orgId,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
    const ids = (list.messages ?? []).map((m) => m.id);
    const out = [];
    for (const id of ids) {
      const m = await this.api<any>(orgId,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
      const h = (name: string) => (m.payload?.headers ?? []).find((x: any) => x.name === name)?.value ?? null;
      out.push({ id, from: h('From'), subject: h('Subject'), date: h('Date'), snippet: m.snippet ?? '', unread: (m.labelIds ?? []).includes('UNREAD') });
    }
    return out;
  }

  async gmailGet(orgId: string, id: string) {
    const m = await this.api<any>(orgId, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`);
    const h = (name: string) => (m.payload?.headers ?? []).find((x: any) => x.name === name)?.value ?? null;
    return { id, from: h('From'), to: h('To'), subject: h('Subject'), date: h('Date'), snippet: m.snippet ?? '', body: extractBody(m.payload) };
  }

  async driveList(orgId: string, q = '', pageSize = 15) {
    const query = q ? `name contains '${q.replace(/'/g, "\\'")}'` : "trashed = false";
    const j = await this.api<{ files: any[] }>(orgId,
      `https://www.googleapis.com/drive/v3/files?pageSize=${pageSize}&orderBy=modifiedTime desc&q=${encodeURIComponent(query)}&fields=${encodeURIComponent('files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName))')}`);
    return (j.files ?? []).map((f) => ({
      id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime,
      link: f.webViewLink ?? null, owner: f.owners?.[0]?.displayName ?? null,
    }));
  }

  async docGet(orgId: string, docId: string) {
    const d = await this.api<any>(orgId, `https://docs.googleapis.com/v1/documents/${docId}`);
    return { id: docId, title: d.title ?? '(sem título)', content: extractDocText(d) };
  }

  // ---------- Escrita (com aprovação humana: só executa por ação de usuário/IA aprovada) ----------
  async sendGmail(orgId: string, input: { to: string; subject: string; body: string; cc?: string }, actorId?: string) {
    const raw = buildRawEmail(input);
    const r = await this.api<{ id: string; threadId: string }>(orgId,
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      { method: 'POST', body: JSON.stringify({ raw }) });
    await this.audit.log({
      orgId, actorId, action: 'google.gmail.send', entityType: 'gmail', entityId: r.id,
      after: { to: input.to, cc: input.cc ?? null, subject: input.subject },
    });
    this.log.log(`Gmail enviado → ${input.to} (${input.subject})`);
    return { ok: true, id: r.id, threadId: r.threadId };
  }

  async createCalendarEvent(
    orgId: string,
    input: { title: string; start: string; end: string; description?: string; location?: string; attendees?: string[] },
    actorId?: string,
  ) {
    const body = {
      summary: input.title,
      description: input.description,
      location: input.location,
      start: { dateTime: new Date(input.start).toISOString() },
      end: { dateTime: new Date(input.end).toISOString() },
      attendees: (input.attendees ?? []).map((email) => ({ email })),
    };
    const e = await this.api<{ id: string; htmlLink: string }>(orgId,
      'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all',
      { method: 'POST', body: JSON.stringify(body) });
    await this.audit.log({
      orgId, actorId, action: 'google.calendar.create', entityType: 'calendar', entityId: e.id,
      after: { title: input.title, start: input.start },
    });
    this.log.log(`Evento criado: ${input.title}`);
    return { ok: true, id: e.id, link: e.htmlLink };
  }

  async createDoc(orgId: string, input: { title: string; content?: string }, actorId?: string) {
    const doc = await this.api<{ documentId: string }>(orgId,
      'https://docs.googleapis.com/v1/documents', { method: 'POST', body: JSON.stringify({ title: input.title }) });
    if (input.content) {
      await this.api(orgId, `https://docs.googleapis.com/v1/documents/${doc.documentId}:batchUpdate`,
        { method: 'POST', body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text: input.content } }] }) });
    }
    await this.audit.log({
      orgId, actorId, action: 'google.docs.create', entityType: 'docs', entityId: doc.documentId,
      after: { title: input.title },
    });
    this.log.log(`Doc criado: ${input.title}`);
    return { ok: true, id: doc.documentId, link: `https://docs.google.com/document/d/${doc.documentId}/edit` };
  }

  /**
   * Grava (ou atualiza) um arquivo de texto numa pasta do Drive.
   *
   * Existe porque o espelho .md da Pauta montava os DOIS endereços do Drive por
   * conta própria — a busca e o upload multipart — e os entregava ao passa-tudo
   * `api()`. O endpoint é do conector; quem espelha pede "grava este texto com
   * este nome nesta pasta", e não uma URL.
   *
   * NOME ESTÁVEL ATUALIZA NO LUGAR: procura antes na pasta e faz PATCH quando
   * acha, para o espelho de uma ficha editada não virar um segundo arquivo.
   *
   * Não é capacidade do catálogo e por isso não passa pela porta — é escrita do
   * OS no próprio Drive dele, disparada por rotina, não ação proposta por
   * agente. Está anotado no relatório da fatia como decisão consciente.
   */
  async gravarArquivoNoDrive(
    orgId: string,
    entrada: { folderId: string; nome: string; conteudo: string; mimeType?: string },
  ): Promise<{ id: string; atualizado: boolean }> {
    const mime = entrada.mimeType ?? 'text/markdown';
    const nome = entrada.nome;
    const q = `name = '${nome.replace(/'/g, "\\'")}' and '${entrada.folderId}' in parents and trashed = false`;
    const achados = await this.api<{ files?: Array<{ id: string }> }>(
      orgId,
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
    );
    const existenteId = achados.files?.[0]?.id ?? null;

    const boundary = `mktos-${Math.random().toString(36).slice(2)}`;
    const metadata = existenteId ? {} : { name: nome, parents: [entrada.folderId], mimeType: mime };
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: ${mime}; charset=UTF-8\r\n\r\n` +
      `${entrada.conteudo}\r\n` +
      `--${boundary}--`;

    const url = existenteId
      ? `https://www.googleapis.com/upload/drive/v3/files/${existenteId}?uploadType=multipart&fields=id`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id';

    const r = await this.api<{ id: string }>(orgId, url, {
      method: existenteId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    return { id: r.id, atualizado: !!existenteId };
  }

  async appendDoc(orgId: string, docId: string, text: string, actorId?: string) {
    await this.api(orgId, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}:batchUpdate`,
      { method: 'POST', body: JSON.stringify({ requests: [{ insertText: { endOfSegmentLocation: {}, text } }] }) });
    await this.audit.log({
      orgId, actorId, action: 'google.docs.append', entityType: 'docs', entityId: docId, after: { chars: text.length },
    });
    return { ok: true, id: docId };
  }
}

// Monta um e-mail RFC 2822 e devolve em base64url (formato exigido pela API do Gmail).
function buildRawEmail(input: { to: string; subject: string; body: string; cc?: string }): string {
  const enc = (s: string) => `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
  const lines = [`To: ${input.to}`];
  if (input.cc) lines.push(`Cc: ${input.cc}`);
  lines.push(
    `Subject: ${enc(input.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(input.body, 'utf8').toString('base64'),
  );
  return Buffer.from(lines.join('\r\n'), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Decodifica base64url do corpo do Gmail (prioriza text/plain).
function extractBody(payload: any): string {
  const walk = (p: any): string => {
    if (!p) return '';
    if (p.mimeType === 'text/plain' && p.body?.data) return b64url(p.body.data);
    for (const part of p.parts ?? []) { const r = walk(part); if (r) return r; }
    if (p.body?.data) return b64url(p.body.data);
    return '';
  };
  return walk(payload).slice(0, 20000);
}
function b64url(s: string): string {
  try { return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch { return ''; }
}
function extractDocText(doc: any): string {
  let out = '';
  for (const el of doc.body?.content ?? []) {
    for (const pe of el.paragraph?.elements ?? []) out += pe.textRun?.content ?? '';
  }
  return out.slice(0, 20000);
}
