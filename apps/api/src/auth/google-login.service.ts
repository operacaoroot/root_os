import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { comContextoDePlataforma, comEmpresaResolvida } from '../prisma/contexto-de-plataforma';

// Login com a conta Google ("Entrar com o Gmail"). Usa a MESMA credencial OAuth do
// conector (google.env), mas pede só openid/email/profile — nenhum acesso a dados.
// O Google devolve o browser no redirect do conector, que já está autorizado no
// Google Cloud; o prefixo do `state` diz que aquela volta é de login e não de
// conexão. Registrando uma URI própria lá, basta apontar GOOGLE_LOGIN_REDIRECT_URI.
const SCOPES = ['openid', 'email', 'profile'];
export const LOGIN_STATE_PREFIX = 'login:';

/*
 * O `typ` do `state`.
 *
 * Este token é assinado com o MESMO assinador da sessão e sai numa rota anônima
 * — `GET /auth/google/start` devolve um redirect com ele na URL, e qualquer um
 * lê. Enquanto o `JwtAuthGuard` conferia só a assinatura, mandá-lo de volta como
 * `Bearer` fazia dele um token de sessão sem empresa. Agora ele se declara, e o
 * guarda de sessão recusa o que não for `sessao` (ver `jwt-auth.guard.ts`).
 *
 * Do lado de cá a checagem também apertou: `purpose` continua sendo conferido
 * (compatibilidade com um `state` emitido minutos antes do deploy) e `typ` passa
 * a ser exigido de tudo que não traga `purpose` — o efeito prático é que um
 * token de SESSÃO apresentado como `state` deixa de passar por aqui.
 */
export const TIPO_DO_ESTADO = 'estado-login';

/** Recusa esperada — o `slug` vira a mensagem certa na tela de login. */
class LoginRecusado extends UnauthorizedException {
  constructor(
    readonly slug: 'nao-autorizado' | 'estado-invalido',
    message: string,
  ) {
    super(message);
  }
}

@Injectable()
export class GoogleLoginService {
  private readonly log = new Logger('GoogleLoginService');
  private readonly clientId = process.env.GOOGLE_CLIENT_ID ?? '';
  private readonly clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
  private readonly webBase =
    process.env.WEB_ORIGIN?.split(',')[0]?.trim() || 'http://localhost:4000';

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
  ) {}

  get configured(): boolean {
    return this.clientId.length > 0 && this.clientSecret.length > 0;
  }

  /**
   * Para onde o Google devolve o browser (a do conector, salvo URI própria).
   * Var vazia conta como não definida — o compose declara as duas sempre.
   */
  private get redirectUri(): string {
    return (
      process.env.GOOGLE_LOGIN_REDIRECT_URI?.trim() ||
      process.env.GOOGLE_REDIRECT_URI?.trim() ||
      'http://localhost:4000/api/google/callback'
    );
  }

  /** E-mails que podem ENTRAR criando usuário na hora (quem já é usuário entra sempre). */
  private get allowlist(): string[] {
    return (process.env.GOOGLE_LOGIN_ALLOWED_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  }

  /** URL do consentimento do Google. `state` é assinado (10 min) contra CSRF. */
  authUrl(): string {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'Google não configurado: defina GOOGLE_CLIENT_ID/SECRET em ~/.config/root/google.env e reinicie a API.',
      );
    }
    const state =
      LOGIN_STATE_PREFIX +
      this.jwt.sign({ typ: TIPO_DO_ESTADO, purpose: 'google-login' }, { expiresIn: '10m' });
    const p = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      prompt: 'select_account',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  }

  /**
   * Fecha o fluxo e devolve PARA ONDE redirecionar o browser: `/login#token=…`
   * quando deu certo, `/login?erro=…` quando não. O token vai no fragmento
   * (`#`) de propósito — fragmento não é enviado ao servidor nem cai em log.
   */
  async completeToRedirect(code?: string, state?: string, ip?: string): Promise<string> {
    try {
      const session = await this.login(code, state, ip);
      return `${this.webBase}/login#token=${encodeURIComponent(session.token)}`;
    } catch (err) {
      const motivo = err instanceof LoginRecusado ? err.slug : 'falhou';
      this.log.warn(`Login com Google recusado (${motivo}): ${(err as Error).message}`);
      return `${this.webBase}/login?erro=${motivo}`;
    }
  }

  private async login(code?: string, state?: string, ip?: string) {
    if (!this.configured) {
      throw new ServiceUnavailableException('Google não configurado nesta instância.');
    }
    if (!code) throw new Error('Google não devolveu o código.');
    this.verifyState(state);

    const accessToken = await this.exchange(code);
    const profile = await this.fetchProfile(accessToken);
    if (!profile.email) throw new Error('Google não devolveu o e-mail.');
    if (!profile.email_verified) {
      throw new LoginRecusado(
        'nao-autorizado',
        `E-mail não verificado no Google: ${profile.email}`,
      );
    }
    const email = profile.email.toLowerCase();

    let user = await this.findUser(email);
    if (!user) {
      if (!this.allowlist.includes(email)) {
        throw new LoginRecusado('nao-autorizado', `Conta ${email} não autorizada a entrar.`);
      }
      user = await this.provision(email, profile.name ?? email);
      this.log.log(`Usuário criado pelo login com Google: ${email}`);
    }
    if (!user.isActive) {
      throw new LoginRecusado('nao-autorizado', `Usuário ${email} está inativo.`);
    }

    return this.auth.issueSession(user, ip, 'auth.login.google');
  }

  private verifyState(state?: string) {
    if (!state?.startsWith(LOGIN_STATE_PREFIX)) {
      throw new LoginRecusado('estado-invalido', 'Estado de login ausente.');
    }
    try {
      const claims = this.jwt.verify<{ typ?: string; purpose?: string }>(
        state.slice(LOGIN_STATE_PREFIX.length),
      );
      // `purpose` é o campo antigo e continua valendo por uma janela de 10 min
      // (o tempo de vida do próprio `state`); `typ` é o novo e é o que recusa um
      // token de sessão apresentado aqui.
      const ehEstadoDeLogin =
        claims.typ === TIPO_DO_ESTADO || (!claims.typ && claims.purpose === 'google-login');
      if (!ehEstadoDeLogin) throw new Error('propósito inválido');
    } catch {
      throw new LoginRecusado('estado-invalido', 'Estado de login inválido ou expirado.');
    }
  }

  private async exchange(code: string): Promise<string> {
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
    if (!res.ok) throw new Error(`Troca de código falhou: HTTP ${res.status}`);
    const t = (await res.json()) as { access_token?: string };
    if (!t.access_token) throw new Error('Google não devolveu access_token.');
    return t.access_token;
  }

  private async fetchProfile(accessToken: string) {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) throw new Error(`userinfo falhou: HTTP ${r.status}`);
    return (await r.json()) as { email?: string; email_verified?: boolean; name?: string };
  }

  private findUser(email: string) {
    return comContextoDePlataforma(() => this.prisma.user.findUnique({
      where: { email },
      include: { roles: { include: { permissions: true } } },
    }));
  }

  /** Cria o usuário na org do root com papel de admin e senha inutilizável. */
  private async provision(email: string, name: string) {
    const org = await comContextoDePlataforma(async () =>
      (await this.prisma.org.findUnique({ where: { slug: 'root' } })) ??
      (await this.prisma.org.findFirst({ orderBy: { createdAt: 'asc' } })));
    if (!org) throw new Error('Nenhuma org no banco — rode o seed antes.');

    return comEmpresaResolvida(org.id, async () => {
      const adminRole = await this.prisma.role.findUnique({
        where: { orgId_key: { orgId: org.id, key: 'admin_master' } },
      });

      // Sem senha local: só entra por este fluxo (hash de bytes aleatórios).
      const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
      return this.prisma.user.create({
        data: {
          orgId: org.id,
          email,
          name,
          passwordHash,
          ...(adminRole ? { roles: { connect: { id: adminRole.id } } } : {}),
        },
        include: { roles: { include: { permissions: true } } },
      });
    });
  }
}
