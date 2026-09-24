import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { MetaAccount } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CofreService, SegredoIndisponivelError } from '../cofre/cofre.service';
import { NOMES_CONHECIDOS } from '../cofre/segredo';
import { CONECTOR_DA_META } from '../cofre/migrar-credenciais';
import {
  PRAZO_DA_CHAMADA_DE_SONDA_MS,
  RegistroDeConectores,
} from '../integrations/conectores.registry';
import { revogacaoFoiSuperada } from '../integrations/revogacao-superada';
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

// Conector Meta/Instagram (OAuth 2.0 via Login do Facebook) — MÉTRICAS do Instagram
// Business. Credencial PRÓPRIA do root (meta.env), tokens por org (isolado do escritório).
// Fluxo: Login do Facebook → user token longo → Página → conta Instagram Business → insights.
const SCOPES = [
  'public_profile',
  'pages_show_list',
  'pages_read_engagement',
  'business_management',
  'instagram_basic',
  'instagram_manage_insights',
];

@Injectable()
export class MetaService implements OnModuleInit {
  private readonly log = new Logger('MetaService');
  private readonly appId = process.env.META_APP_ID ?? '';
  private readonly appSecret = process.env.META_APP_SECRET ?? '';
  private readonly redirectUri = process.env.META_REDIRECT_URI ?? 'http://localhost:4000/api/meta/callback';
  // v24.0 desde a MD5: a v21.0 sai do ar em 21/01/2027. O diálogo do OAuth (`authUrl`) acompanha.
  private readonly graph = (process.env.META_GRAPH_URL || 'https://graph.facebook.com/v24.0').replace(/\/$/, '');
  private readonly webBase = process.env.WEB_ORIGIN?.split(',')[0] ?? 'http://localhost:4000';

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    /** O contrato único de conector (fatia 5.4) — módulo `@Global`. */
    private readonly contrato: RegistroDeConectores,
    /**
     * O COFRE (fatia 5.3). `@Optional()` pelo mesmo motivo do Google: a suíte
     * constrói este serviço à mão, e cofre ausente tem de significar "use a
     * coluna de origem", não "o Instagram parou".
     */
    @Optional() private readonly cofre?: CofreService,
  ) {}

  onModuleInit(): void {
    /*
     * ESTE CONECTOR NÃO SE INSCREVE EM `ConectoresConfiguradosRegistry`, e a
     * ausência é a mesma decisão do Google: `instagram` é chave de AUTORIZAÇÃO
     * POR EMPRESA, e responder `META_APP_ID && META_APP_SECRET` ali faria a tela
     * exibir "conectado" para empresa que nunca autorizou nada — verdadeiro em
     * produção para todo mundo. Ver o cabeçalho daquele registro.
     *
     * NO CONTRATO ele se inscreve, porque lá a pergunta é outra e vem COM a
     * empresa: "esta empresa autorizou, e a autorização ainda serve?".
     */
    this.contrato.registrar(this.descritorDoContrato(), 'MetaService');
  }

  get configured(): boolean {
    return this.appId.length > 0 && this.appSecret.length > 0;
  }
  private assert() {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'Meta não configurado: defina META_APP_ID/SECRET em ~/.config/root/meta.env e reinicie a API.',
      );
    }
  }

  /*
   * ==========================================================================
   * OS TOKENS DA META NO COFRE — RF-C-01, RF-C-02 (fatia 5.4)
   * ==========================================================================
   *
   * Mesma escada do Google, e ela é a mesma DE PROPÓSITO: cofre primeiro, coluna
   * como queda, revogado NÃO cai para a coluna. Duas escadas diferentes para a
   * mesma pergunta é como uma delas envelhece sem ninguém notar.
   *
   * `userToken` e `pageToken` viviam em TEXTO PURO em `MetaAccount`. A chave do
   * cofre é `meta` (declarada por quem gravou, em `cofre/migrar-credenciais.ts`)
   * e os nomes são `access_token` para o token do usuário e `page_token` para o
   * da Página.
   */

  /** Ver `GoogleService.credencialDoCofre` — mesmo contrato de três desfechos. */
  private async credencialDoCofre(
    orgId: string,
    nome: string,
  ): Promise<string | 'revogado' | null> {
    if (!this.cofre) return null;
    try {
      return await this.cofre.envolver(
        { orgId, conector: CONECTOR_DA_META, nome },
        (c) => c.usar((s) => s),
      );
    } catch (e) {
      if (e instanceof SegredoIndisponivelError) return e.revogado ? 'revogado' : null;
      this.log.debug(
        `cofre não respondeu por meta/${nome} da empresa ${orgId} (${(e as Error).message}); ` +
          'usando a coluna de origem.',
      );
      return null;
    }
  }

  /**
   * O valor do cofre, ou o da coluna. Revogado lança — com a MESMA exceção
   * medida do Google, e aqui ela importa ainda mais.
   *
   * O token da PÁGINA só é escrito no retorno do OAuth: não existe renovação que
   * o reconcilie depois. Uma gravação que falhasse ali, com o cofre marcando a
   * credencial como revogada, matava o Instagram da empresa PARA SEMPRE — e a
   * mensagem mandava reconectar, que era exatamente o que não resolvia. Ver
   * `revogacao-superada.ts` para o raciocínio inteiro.
   */
  private async credencial(
    orgId: string,
    nome: string,
    daColuna: string | null,
    contexto: { autorizadaEm?: Date | null; escopo?: string[]; expiraEm?: Date | null } = {},
  ): Promise<string | null> {
    const noCofre = await this.credencialDoCofre(orgId, nome);
    if (noCofre === 'revogado') {
      const veredito = await revogacaoFoiSuperada(this.cofre, {
        orgId,
        conector: CONECTOR_DA_META,
        nome,
        autorizadaEm: contexto.autorizadaEm ?? null,
      });
      if (!veredito.superada) {
        throw new ServiceUnavailableException(
          `A credencial "${nome}" da Meta desta empresa foi REVOGADA e não existe mais ` +
            `(${veredito.porque ?? 'revogação em vigor'}). Reconecte o Instagram — revogar não ` +
            'tem volta, e cair para a coluna antiga seria não ter revogado.',
        );
      }
      this.log.error(
        `empresa ${orgId}: o cofre ainda marca meta/${nome} como revogado ` +
          `(${veredito.revogadaEm?.toISOString() ?? 'sem data'}), mas há autorização POSTERIOR ` +
          `(${contexto.autorizadaEm?.toISOString() ?? 'sem data'}). A gravação no cofre falhou ` +
          'em algum retorno de OAuth. Usando a coluna e regravando no cofre agora.',
      );
      if (daColuna) {
        await this.guardarNoCofre(orgId, nome, daColuna, {
          escopo: contexto.escopo,
          expiraEm: contexto.expiraEm ?? null,
        });
      }
      return daColuna;
    }
    return noCofre ?? daColuna;
  }

  /** Guarda no cofre o que acabou de ir para a coluna. Best-effort — ver o Google. */
  private async guardarNoCofre(
    orgId: string,
    nome: string,
    valor: string | null | undefined,
    extra: { escopo?: string[]; expiraEm?: Date | null; actorId?: string | null } = {},
  ): Promise<void> {
    if (!this.cofre || !valor) return;
    try {
      await this.cofre.guardar({
        orgId,
        conector: CONECTOR_DA_META,
        nome,
        valor,
        escopo: extra.escopo ?? [],
        origem: 'meta-oauth',
        expiraEm: extra.expiraEm ?? null,
        actorId: extra.actorId ?? null,
      });
    } catch (e) {
      this.log.error(
        `token da Meta gravado na coluna mas NÃO no cofre (empresa ${orgId}, ${nome}): ` +
          `${(e as Error).message}. Reconcilie com \`cofre.cli.js migrar --forcar --empresa ${orgId}\`.`,
      );
    }
  }

  /**
   * O CONTRATO ÚNICO — autorizar, sincronizar, saúde, revogar (RF-X-01).
   *
   * A chave é `meta` (a unidade de CREDENCIAL, e a mesma sob a qual o cofre
   * guarda) e a linha do catálogo que ela cobre é `instagram` — que é o nome da
   * SUPERFÍCIE. Eram dois nomes para a mesma coisa espalhados pelo repositório;
   * agora a tradução é declarada aqui, por quem sabe.
   */
  private descritorDoContrato(): ConectorDoContrato {
    return {
      chave: CONECTOR_DA_META,
      rotulo: 'Instagram (Meta)',
      escopoDaCredencial: 'empresa',
      linhasDoCatalogo: ['instagram'],

      autorizar: async (ctx: ContextoDoVerbo): Promise<ResultadoDeAutorizacao> => {
        if (!this.configured) {
          return {
            tipo: 'manual',
            instrucao:
              'O aplicativo da Meta não tem credencial neste processo: o operador precisa ' +
              'definir o par app/segredo no ambiente da API e reiniciá-la. E há uma pegadinha ' +
              'própria deste conector: a URI de retorno do OAuth é REGISTRADA na consola da ' +
              'Meta — mudá-la exige cadastrar a nova lá antes do deploy, senão o login falha.',
          };
        }
        return { tipo: 'redirecionar', url: this.authUrl(ctx.orgId) };
      },

      sincronizar: async (): Promise<ResultadoDeSincronizacao> => ({
        tipo: 'nao_se_aplica',
        motivo:
          'Não há espelho local do Instagram para trazer: perfil, alcance e mídias são lidos ' +
          'sob demanda pela Graph API a cada abertura da tela, justamente para não guardar ' +
          'métrica velha. O que se degrada com o tempo é a AUTORIZAÇÃO (o token longo vale ~60 ' +
          'dias), e isso a sonda de saúde mostra.',
      }),

      /**
       * A SONDA. Mesma armadilha do Google, mesma resposta: a pergunta é por
       * EMPRESA, e o verde só nasce de uma chamada de verdade.
       *
       * Aqui há um terceiro estado que só a Meta tem: conta autorizada, token
       * válido e NENHUMA conta Instagram Business vinculada à Página. É `erro`
       * com a frase real, e não "não configurado" — a empresa fez a parte dela,
       * e o conserto é do outro lado (vincular no Meta Business).
       */
      saude: async (ctx: ContextoDoVerbo): Promise<SaudeDeConector> => {
        if (!this.configured) {
          return naoConfigurado(
            'O aplicativo da Meta não tem credencial neste processo (o par app/segredo do ' +
              'ambiente da API). Nenhuma empresa consegue autorizar enquanto isso não for ' +
              'resolvido pelo operador.',
          );
        }
        const acc = await this.prisma.metaAccount.findUnique({ where: { orgId: ctx.orgId } });
        if (!acc) {
          return naoConfigurado(
            'Esta empresa ainda não conectou nenhuma conta da Meta. O aplicativo está pronto; ' +
              'falta alguém autorizar pelo Login do Facebook.',
          );
        }
        if (acc.expiresAt < new Date()) {
          return erroDeConector(
            `A sessão do Facebook desta empresa venceu em ${acc.expiresAt.toLocaleString('pt-BR')}. ` +
              'O token longo vale cerca de 60 dias e precisa ser renovado reconectando o ' +
              'Instagram — não há refresh automático neste fluxo.',
          );
        }
        if (!acc.igUserId) {
          return erroDeConector(
            `A conta está autorizada (Página "${acc.pageName ?? 'sem nome'}"), mas NENHUMA conta ` +
              'Instagram Business está vinculada a ela. Vincule no Meta Business e reconecte: ' +
              'sem isso não há métrica para ler.',
          );
        }
        const comecou = Date.now();
        try {
          const t = await this.credencial(ctx.orgId, NOMES_CONHECIDOS.tokenDePagina, acc.pageToken, {
            autorizadaEm: acc.connectedAt,
            escopo: [...SCOPES],
            expiraEm: acc.expiresAt,
          });
          if (!t) {
            return erroDeConector(
              'A conta está autorizada mas o token da Página sumiu do cofre e da coluna — ' +
                'reconecte o Instagram.',
              Date.now() - comecou,
            );
          }
          const perfil = await this.sondarPerfil(acc.igUserId, t);
          return conectado(
            Date.now() - comecou,
            `@${perfil ?? acc.igUsername ?? 'perfil sem nome'} respondeu; a sessão vale até ` +
              `${acc.expiresAt.toLocaleString('pt-BR')}.`,
          );
        } catch (e) {
          return erroDeConector(frasedoErro(e), Date.now() - comecou);
        }
      },

      revogar: async (
        ctx: ContextoDoVerbo & { motivo?: string | null },
      ): Promise<ResultadoDeRevogacao> => {
        const r = await this.disconnect(ctx.orgId, {
          actorId: ctx.actorId ?? null,
          motivo: ctx.motivo ?? null,
        });
        return {
          tipo: 'revogado',
          segredos: r.segredosRevogados,
          resumo:
            'A conexão da Meta desta empresa foi apagada e as credenciais guardadas foram ' +
            'queimadas. Isto NÃO tem volta: para voltar a ler métricas do Instagram, alguém ' +
            'precisa autorizar de novo pelo Login do Facebook.',
        };
      },
    };
  }

  /** Uma chamada de SONDA à Graph: com prazo, e sem passar pelo `g()`. */
  private async sondarPerfil(igUserId: string, pageToken: string): Promise<string | null> {
    const res = await fetch(
      `${this.graph}/${igUserId}?fields=username&access_token=${encodeURIComponent(pageToken)}`,
      { signal: AbortSignal.timeout(PRAZO_DA_CHAMADA_DE_SONDA_MS) },
    );
    if (!res.ok) {
      const corpo = await res.text().catch(() => '');
      throw new Error(
        `A Graph API da Meta respondeu HTTP ${res.status} ao conferir o perfil` +
          (corpo ? `: ${corpo.slice(0, 220)}` : '') +
          (res.status === 400 || res.status === 401
            ? ' — normalmente quer dizer token expirado, permissão retirada pelo usuário, ou a ' +
              'Página sem a conta Instagram vinculada. É preciso reconectar.'
            : ''),
      );
    }
    return ((await res.json()) as { username?: string }).username ?? null;
  }

  // ---------- OAuth ----------
  authUrl(state: string): string {
    this.assert();
    const p = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      state,
      scope: SCOPES.join(','),
    });
    return `https://www.facebook.com/v24.0/dialog/oauth?${p}`;
  }

  private async g<T = any>(url: string): Promise<T> {
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BadRequestException(`Meta ${url.split('?')[0]} → HTTP ${res.status} ${body.slice(0, 200)}`);
    }
    return res.json() as Promise<T>;
  }
  /** Igual ao g(), mas engole erro (métrica indisponível p/ certo tipo de mídia). */
  private async gSafe<T = any>(url: string): Promise<T | null> {
    try { return await this.g<T>(url); } catch { return null; }
  }

  async handleCallback(orgId: string, code: string): Promise<string> {
    this.assert();
    // 1) code → token curto
    const short = await this.g<{ access_token: string }>(
      `${this.graph}/oauth/access_token?client_id=${this.appId}&client_secret=${this.appSecret}` +
      `&redirect_uri=${encodeURIComponent(this.redirectUri)}&code=${encodeURIComponent(code)}`,
    );
    // 2) token curto → token longo (~60d)
    const long = await this.g<{ access_token: string; expires_in?: number }>(
      `${this.graph}/oauth/access_token?grant_type=fb_exchange_token&client_id=${this.appId}` +
      `&client_secret=${this.appSecret}&fb_exchange_token=${short.access_token}`,
    );
    const userToken = long.access_token;
    const expiresAt = new Date(Date.now() + (long.expires_in ?? 60 * 24 * 3600) * 1000);

    // 3) Página com conta Instagram Business vinculada
    const pages = await this.g<{ data: Array<{ id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }> }>(
      `${this.graph}/me/accounts?fields=name,access_token,instagram_business_account{id,username}&access_token=${userToken}`,
    );
    const page = (pages.data ?? []).find((p) => p.instagram_business_account) ?? (pages.data ?? [])[0];

    await this.prisma.metaAccount.upsert({
      where: { orgId },
      update: {
        userToken, expiresAt, scope: SCOPES.join(','),
        pageId: page?.id ?? null, pageName: page?.name ?? null, pageToken: page?.access_token ?? null,
        igUserId: page?.instagram_business_account?.id ?? null, igUsername: page?.instagram_business_account?.username ?? null,
      },
      create: {
        orgId, userToken, expiresAt, scope: SCOPES.join(','),
        pageId: page?.id ?? null, pageName: page?.name ?? null, pageToken: page?.access_token ?? null,
        igUserId: page?.instagram_business_account?.id ?? null, igUsername: page?.instagram_business_account?.username ?? null,
      },
    });
    /*
     * OS DOIS TOKENS VÃO PARA O COFRE na mesma passagem (fatia 5.4) — primeira
     * vez que eles ficam cifrados em repouso no caminho normal. Os dois vencem
     * junto (o da Página herda a validade do token longo do usuário), então os
     * dois levam `expiresAt`.
     */
    const escopo = [...SCOPES];
    await this.guardarNoCofre(orgId, NOMES_CONHECIDOS.acesso, userToken, {
      escopo,
      expiraEm: expiresAt,
    });
    await this.guardarNoCofre(orgId, NOMES_CONHECIDOS.tokenDePagina, page?.access_token, {
      escopo,
      expiraEm: expiresAt,
    });

    await this.upsertIntegration(orgId, 'connected');
    await this.audit.log({ orgId, action: 'meta.connect', entityType: 'integration', entityId: 'instagram', after: { page: page?.name, ig: page?.instagram_business_account?.username } });
    this.log.log(`Meta conectado: página "${page?.name}" · IG @${page?.instagram_business_account?.username ?? '?'}`);
    return `${this.webBase}/instagram`;
  }

  /**
   * A conta desta empresa, com o token da Página JÁ RESOLVIDO.
   *
   * Devolve o par em vez de só a linha porque o token deixou de morar na linha:
   * ele vem do cofre quando existe e da coluna quando não (fatia 5.4). Deixar os
   * chamadores lerem `acc.pageToken` direto seria manter a leitura antiga viva ao
   * lado da nova — e a antiga venceria em silêncio no dia em que o cofre passasse
   * a ser a única fonte.
   */
  private async account(orgId: string): Promise<{ acc: MetaAccount; pageToken: string }> {
    this.assert();
    const acc = await this.prisma.metaAccount.findUnique({ where: { orgId } });
    if (!acc) throw new ServiceUnavailableException('Instagram não conectado. Conecte em /instagram.');
    if (acc.expiresAt < new Date()) throw new ServiceUnavailableException('Sessão do Facebook expirada. Reconecte o Instagram.');
    if (!acc.igUserId) throw new BadRequestException('Nenhuma conta Instagram Business vinculada à Página.');
    const pageToken = await this.credencial(orgId, NOMES_CONHECIDOS.tokenDePagina, acc.pageToken, {
      autorizadaEm: acc.connectedAt,
      escopo: [...SCOPES],
      expiraEm: acc.expiresAt,
    });
    if (!pageToken) throw new BadRequestException('Nenhuma conta Instagram Business vinculada à Página.');
    return { acc, pageToken };
  }

  async status(orgId: string) {
    const acc = await this.prisma.metaAccount.findUnique({ where: { orgId } });
    return {
      configured: this.configured,
      connected: !!acc,
      page: acc?.pageName ?? null,
      igUsername: acc?.igUsername ?? null,
      hasInstagram: !!acc?.igUserId,
      connectedAt: acc?.connectedAt?.toISOString() ?? null,
      authUrl: this.configured ? this.authUrl(orgId) : null,
    };
  }

  /**
   * DESCONECTAR = REVOGAR. Ver `GoogleService.disconnect` para o raciocínio
   * inteiro: com o cofre lido na frente da coluna, apagar só a linha deixaria os
   * tokens VIVOS no cofre, e quem clicou iria embora achando que resolveu.
   *
   * O cofre vem PRIMEIRO pelo mesmo motivo de lá: se a queima falhar, a linha
   * continua no lugar e o estado permanece consistente, com o erro subindo para
   * quem clicou. O contrário deixaria a empresa sem metadado e COM segredo.
   */
  async disconnect(
    orgId: string,
    opcoes: { actorId?: string | null; motivo?: string | null } = {},
  ): Promise<{ ok: true; segredosRevogados: string[] }> {
    let segredosRevogados: string[] = [];
    if (this.cofre) {
      const r = await this.cofre.revogar({
        orgId,
        conector: CONECTOR_DA_META,
        motivo: opcoes.motivo ?? 'conta da Meta desconectada',
        por: opcoes.actorId ?? null,
      });
      segredosRevogados = r.revogados;
    }
    await this.prisma.metaAccount.deleteMany({ where: { orgId } });
    await this.upsertIntegration(orgId, 'disconnected');
    await this.audit.log({
      orgId,
      actorId: opcoes.actorId ?? undefined,
      action: 'meta.disconnect',
      entityType: 'integration',
      entityId: 'instagram',
      after: { segredosRevogados, motivo: opcoes.motivo ?? null },
    });
    return { ok: true, segredosRevogados };
  }

  private async upsertIntegration(orgId: string, status: 'connected' | 'disconnected') {
    const ex = await this.prisma.integrationAccount.findFirst({ where: { orgId, key: 'instagram' } });
    if (ex) {
      await this.prisma.integrationAccount.update({ where: { id: ex.id }, data: { status, connectedAt: status === 'connected' ? new Date() : ex.connectedAt } });
    } else {
      await this.prisma.integrationAccount.create({ data: { orgId, key: 'instagram', label: 'Instagram', status, connectedAt: status === 'connected' ? new Date() : null } });
    }
  }

  // ---------- Métricas (leitura) ----------
  async overview(orgId: string) {
    const { acc, pageToken: t } = await this.account(orgId);
    const prof = await this.g<any>(`${this.graph}/${acc.igUserId}?fields=username,name,followers_count,follows_count,media_count,profile_picture_url,biography&access_token=${t}`);
    // insights de conta dos últimos 28 dias (best-effort — a API varia por versão/conta)
    const until = Math.floor(Date.now() / 1000);
    const since = until - 28 * 86400;
    const ins = await this.gSafe<{ data: Array<{ name: string; values: Array<{ value: number }> }> }>(
      `${this.graph}/${acc.igUserId}/insights?metric=reach,impressions,profile_views&period=day&since=${since}&until=${until}&access_token=${t}`);
    const sum = (name: string) => (ins?.data?.find((d) => d.name === name)?.values ?? []).reduce((s, v) => s + (v.value ?? 0), 0);
    return {
      username: prof.username ?? null,
      name: prof.name ?? null,
      biography: prof.biography ?? null,
      profilePic: prof.profile_picture_url ?? null,
      followers: prof.followers_count ?? 0,
      follows: prof.follows_count ?? 0,
      mediaCount: prof.media_count ?? 0,
      reach28: ins ? sum('reach') : null,
      impressions28: ins ? sum('impressions') : null,
      profileViews28: ins ? sum('profile_views') : null,
      source: { tool: 'instagram-graph', generatedAt: new Date().toISOString() },
    };
  }

  async media(orgId: string, limit = 12) {
    const { acc, pageToken: t } = await this.account(orgId);
    const list = await this.g<{ data: any[] }>(
      `${this.graph}/${acc.igUserId}/media?fields=id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count&limit=${Math.min(Math.max(limit, 1), 30)}&access_token=${t}`);
    const items = [];
    for (const m of list.data ?? []) {
      const ins = await this.gSafe<{ data: Array<{ name: string; values: Array<{ value: number }> }> }>(
        `${this.graph}/${m.id}/insights?metric=reach,impressions,saved&access_token=${t}`);
      const val = (name: string) => ins?.data?.find((d) => d.name === name)?.values?.[0]?.value ?? null;
      items.push({
        id: m.id,
        caption: (m.caption ?? '').slice(0, 200),
        type: m.media_product_type ?? m.media_type ?? null,
        permalink: m.permalink ?? null,
        timestamp: m.timestamp ?? null,
        likes: m.like_count ?? 0,
        comments: m.comments_count ?? 0,
        reach: val('reach'),
        impressions: val('impressions'),
        saved: val('saved'),
      });
    }
    return { items, total: items.length, source: { tool: 'instagram-graph', generatedAt: new Date().toISOString() } };
  }
}
