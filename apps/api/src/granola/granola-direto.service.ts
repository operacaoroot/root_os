import { Injectable, Logger, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError, auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { CONECTOR_GRANOLA, type TrabGranolaConexaoDireta } from '@mktos/shared';

import { AuditService } from '../audit/audit.service';
import { CofreService, SegredoIndisponivelError } from '../cofre/cofre.service';
import { comTenantPublico, resolverOrgDaChave } from '../common/tenant-publico';
import { urlSeguraDoFornecedor } from '../common/url-do-fornecedor';
import { ConectoresService } from '../integrations/conectores.service';
import { RegistroDeConectores } from '../integrations/conectores.registry';
import {
  type ContextoDoVerbo,
  type ResultadoDeAutorizacao,
  type ResultadoDeRevogacao,
  type ResultadoDeSincronizacao,
  type SaudeDeConector,
  conectado,
  erroDeConector,
  naoConfigurado,
} from '../integrations/contrato-de-conector';
import { PrismaService } from '../prisma/prisma.service';
import {
  type FonteDoGranola,
  GranolaIndisponivelError,
  GranolaNaoConectadoError,
  ID_DE_REUNIAO_DO_GRANOLA,
  type ReuniaoDoGranolaListada,
  type ReuniaoDoGranolaLida,
} from '../work/atas/fonte-do-granola';
import type { ConexaoDiretaDoGranola } from './conexao-direta';
import { FormatoDoGranolaError, type ResultadoDeFerramenta, lerPedacoDaTranscricao, lerReunioes, textosDoResultado } from './leitura-do-mcp';

/*
 * ============================================================================
 * O GRANOLA DIRETO — o OS como cliente do servidor MCP do Granola
 * (rodada da interface, 20/10/2026)
 * ============================================================================
 *
 * O QUE O GRANOLA OFERECE (pesquisa de 20/10/2026, fontes no relatório da U5):
 *   · servidor MCP oficial em `https://mcp.granola.ai/mcp`, transporte HTTP
 *     "streamable", autenticação SÓ por OAuth no navegador, por pessoa. Os
 *     metadados públicos (`/.well-known/oauth-protected-resource` e
 *     `mcp-auth.granola.ai/.well-known/oauth-authorization-server`) anunciam
 *     código de autorização com PKCE S256, registro dinâmico de cliente
 *     (`/oauth2/register`), `refresh_token` e cliente público
 *     (`token_endpoint_auth_methods_supported` com `none`). Ferramentas:
 *     `list_meetings`, `get_meetings`, `get_meeting_transcript` (planos pagos)
 *     e outras;
 *   · uma API REST (`public-api.granola.ai/v1`, chave `grn_…` criada no app,
 *     planos Business e Enterprise). Fica como alternativa: o caminho pedido
 *     pela ata é o MCP, e o OAuth de servidor é alcançável.
 *
 * COMO O OS FAZ: o SDK oficial do MCP (`@modelcontextprotocol/sdk`, o mesmo de
 * `packages/mcp`) faz a descoberta, o registro dinâmico, o PKCE, a troca do
 * código e a renovação; este arquivo só diz ONDE guardar cada coisa:
 *   · tudo no COFRE, por empresa, chave `granola`: o registro do cliente
 *     (`oauth_cliente`), o par de tokens (`oauth_tokens`) e o verificador PKCE
 *     da autorização em curso (`oauth_verificador`, com prazo de 10 minutos e
 *     queimado no retorno). Nada em variável de ambiente;
 *   · o `state` do OAuth é um token assinado de 10 minutos com `typ` próprio
 *     (`estado-granola`), que o guarda de sessão recusa, conferido ANTES de
 *     qualquer consulta no retorno (o padrão do YouTube).
 *
 * NÃO É UM AGENTE. A catraca "ninguém é cliente de MCP" existe contra o laço de
 * ferramenta paralelo (modelo escolhendo o que chamar, sem régua e sem RASTRO).
 * Aqui nenhum modelo escolhe ferramenta: o conector chama três ferramentas de
 * LEITURA, com nomes e argumentos fixos no código, como um cliente HTTP. A
 * exceção está declarada na catraca, presa a este arquivo.
 *
 * A TRANSCRIÇÃO volta só para quem pediu (o banco de atas), na memória do
 * processo. Este arquivo não a grava, não a loga e não a põe em mensagem de erro.
 *
 * `GRANOLA_MCP_URL` (padrão o servidor oficial) existe para o dublê: fora de
 * loopback só `https://`. `GRANOLA_REDIRECT_URI` (padrão
 * `<WEB_ORIGIN>/api/trabalho/granola/callback`) é para onde o Granola devolve o
 * navegador; mudar o endereço faz o OS registrar outro cliente na próxima
 * autorização.
 */

const CONECTOR = CONECTOR_GRANOLA;
const SERVIDOR_PADRAO = 'https://mcp.granola.ai/mcp';
export const TIPO_DO_ESTADO_DO_GRANOLA = 'estado-granola';
export const NOMES_DO_GRANOLA_DIRETO = {
  cliente: 'oauth_cliente',
  tokens: 'oauth_tokens',
  verificador: 'oauth_verificador',
} as const;
const PRAZO_DA_AUTORIZACAO_MS = 10 * 60_000;
const PRAZO_DA_CHAMADA_MS = 30_000;
const PRAZO_DA_SONDA_MS = 4_500;
const MAX_PEDACOS_DA_TRANSCRICAO = 8;
const CARACTERES_POR_PEDACO = 80_000;
const MAX_CARACTERES_DA_TRANSCRICAO = 400_000;

const curta = (e: unknown, max = 200) => String((e as Error)?.message ?? e ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

type Modo = 'autorizar' | 'concluir' | 'chamar';

@Injectable()
export class GranolaDiretoService implements FonteDoGranola, ConexaoDiretaDoGranola {
  private readonly log = new Logger('GranolaDireto');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly conectores: ConectoresService,
    private readonly audit: AuditService,
    /** `@Optional()` porque a suíte monta à mão; sem eles, nenhuma empresa está conectada e nada é esquecido. */
    @Optional() private readonly cofre?: CofreService,
    @Optional() private readonly contrato?: RegistroDeConectores,
  ) {}

  // Lidos a cada uso: a suíte troca o ambiente depois de montar o serviço.
  get servidor(): string {
    return urlSeguraDoFornecedor(process.env.GRANOLA_MCP_URL, SERVIDOR_PADRAO, 'do Granola');
  }
  private get web(): string {
    return process.env.WEB_ORIGIN?.split(',')[0]?.trim() || 'http://localhost:4000';
  }
  get retorno(): string {
    return (process.env.GRANOLA_REDIRECT_URI ?? '').trim() || `${this.web.replace(/\/+$/, '')}/api/trabalho/granola/callback`;
  }

  // ------------------------------------------------------------------ o cofre

  private async lerDoCofre(orgId: string, nome: string): Promise<string | null> {
    if (!this.cofre) return null;
    try {
      return await this.cofre.envolver({ orgId, conector: CONECTOR, nome }, (c) => c.usar(async (s) => s));
    } catch (e) {
      if (e instanceof SegredoIndisponivelError) return null;
      throw e;
    }
  }

  private async lerJson<T>(orgId: string, nome: string): Promise<T | null> {
    const cru = await this.lerDoCofre(orgId, nome);
    if (!cru) return null;
    try {
      return JSON.parse(cru) as T;
    } catch {
      return null;
    }
  }

  private async guardar(orgId: string, nome: string, valor: unknown, actorId: string | null, expiraEm: Date | null = null): Promise<void> {
    if (!this.cofre) throw new GranolaIndisponivelError('O cofre não está de pé: sem ele, o OS não guarda a autorização do Granola.');
    await this.cofre.guardar({
      orgId,
      conector: CONECTOR,
      nome,
      valor: JSON.stringify(valor),
      origem: 'granola-oauth',
      expiraEm,
      actorId,
    });
  }

  private async queimar(orgId: string, nomes: readonly string[], motivo: string, por: string | null): Promise<string[]> {
    if (!this.cofre) return [];
    const queimados: string[] = [];
    for (const nome of nomes) {
      const r = await this.cofre.revogar({ orgId, conector: CONECTOR, nome, motivo, por });
      queimados.push(...r.revogados);
    }
    return queimados;
  }

  private async lerTokens(orgId: string): Promise<(OAuthTokens & { obtidoEm?: string }) | null> {
    const t = await this.lerJson<OAuthTokens & { obtidoEm?: string }>(orgId, NOMES_DO_GRANOLA_DIRETO.tokens);
    return t && typeof t.access_token === 'string' && t.access_token ? t : null;
  }

  /** A linha do token no cofre (sem o valor): existe e não foi revogada. Não sai da casa. */
  private async linhaDosTokens(orgId: string): Promise<{ desde: string } | null> {
    if (!this.cofre) return null;
    try {
      const { items } = await this.cofre.estado(orgId);
      const l = items.find((i) => i.conector === CONECTOR && i.nome === NOMES_DO_GRANOLA_DIRETO.tokens);
      return l && !l.revogadoEm ? { desde: l.atualizadoEm ?? l.criadoEm } : null;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------ OAuth

  /**
   * O provedor que o SDK usa: diz onde ler e gravar o registro, o token e o
   * verificador desta empresa. Em `chamar`, uma autorização nova nunca começa
   * por baixo dos panos (o verificador não é gravado e o endereço é jogado fora).
   */
  private provedor(orgId: string, modo: Modo, o: { estado?: string; actorId?: string | null } = {}) {
    const svc = this;
    let urlDeAutorizacao: URL | null = null;
    const metadados: OAuthClientMetadata = {
      client_name: 'ROOT OS',
      redirect_uris: [svc.retorno],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
    const provedor: OAuthClientProvider = {
      get redirectUrl() {
        return svc.retorno;
      },
      get clientMetadata() {
        return metadados;
      },
      state: () => o.estado ?? '',
      async clientInformation() {
        const info = await svc.lerJson<OAuthClientInformationMixed & { redirect_uris?: string[] }>(orgId, NOMES_DO_GRANOLA_DIRETO.cliente);
        if (!info || typeof info.client_id !== 'string') return undefined;
        // Registrado para outro endereço de retorno: registra de novo.
        if (Array.isArray(info.redirect_uris) && !info.redirect_uris.includes(svc.retorno)) return undefined;
        return info;
      },
      async saveClientInformation(info) {
        await svc.guardar(orgId, NOMES_DO_GRANOLA_DIRETO.cliente, info, o.actorId ?? null);
      },
      async tokens() {
        return (await svc.lerTokens(orgId)) ?? undefined;
      },
      async saveTokens(tokens) {
        await svc.guardar(orgId, NOMES_DO_GRANOLA_DIRETO.tokens, { ...tokens, obtidoEm: new Date().toISOString() }, o.actorId ?? null);
      },
      redirectToAuthorization(url) {
        urlDeAutorizacao = url;
      },
      async saveCodeVerifier(verificador) {
        if (modo !== 'autorizar') return;
        const ate = new Date(Date.now() + PRAZO_DA_AUTORIZACAO_MS);
        await svc.guardar(orgId, NOMES_DO_GRANOLA_DIRETO.verificador, { v: verificador, ate: ate.toISOString() }, o.actorId ?? null, ate);
      },
      async codeVerifier() {
        const g = await svc.lerJson<{ v?: string; ate?: string }>(orgId, NOMES_DO_GRANOLA_DIRETO.verificador);
        if (!g?.v || !g.ate || new Date(g.ate).getTime() < Date.now()) {
          throw new GranolaNaoConectadoError('A autorização do Granola expirou antes de voltar. Clique em "Conectar ao Granola" de novo.');
        }
        return g.v;
      },
      async invalidateCredentials(escopo) {
        // O Granola recusou o que estava guardado: o que ele recusou não vale mais.
        const nomes =
          escopo === 'all'
            ? [NOMES_DO_GRANOLA_DIRETO.cliente, NOMES_DO_GRANOLA_DIRETO.tokens, NOMES_DO_GRANOLA_DIRETO.verificador]
            : escopo === 'client'
              ? [NOMES_DO_GRANOLA_DIRETO.cliente]
              : escopo === 'tokens'
                ? [NOMES_DO_GRANOLA_DIRETO.tokens]
                : escopo === 'verifier'
                  ? [NOMES_DO_GRANOLA_DIRETO.verificador]
                  : [];
        if (nomes.length) await svc.queimar(orgId, nomes, 'o Granola recusou a credencial guardada', null);
      },
    };
    return { provedor, urlDeAutorizacao: () => urlDeAutorizacao as URL | null };
  }

  async autorizar(ctx: ContextoDoVerbo): Promise<ResultadoDeAutorizacao> {
    if (!this.cofre) return { tipo: 'nao_se_aplica', motivo: 'O cofre não está de pé: sem ele, o OS não guarda a autorização do Granola.' };
    const estado = this.jwt.sign({ typ: TIPO_DO_ESTADO_DO_GRANOLA, org: ctx.orgId, sub: ctx.actorId ?? null }, { expiresIn: '10m' });
    const { provedor, urlDeAutorizacao } = this.provedor(ctx.orgId, 'autorizar', { estado, actorId: ctx.actorId ?? null });
    let r: 'AUTHORIZED' | 'REDIRECT';
    try {
      r = await auth(provedor, { serverUrl: this.servidor });
    } catch (e) {
      throw new GranolaIndisponivelError(`O Granola não aceitou começar a autorização: ${curta(e)}`);
    }
    if (r === 'AUTHORIZED') {
      this.contrato?.esquecer(ctx.orgId, CONECTOR);
      return { tipo: 'pronto', detalhe: 'O Granola já está conectado nesta empresa.' };
    }
    const url = urlDeAutorizacao();
    if (!url) throw new GranolaIndisponivelError('O Granola não devolveu a página de autorização.');
    return { tipo: 'redirecionar', url: url.toString() };
  }

  /** A empresa do `state`, ou nulo: assinatura, prazo e `typ` conferidos antes de qualquer consulta. */
  empresaDoEstado(estado: string): { orgId: string; actorId: string | null } | null {
    if (typeof estado !== 'string' || !estado || estado.length > 2048) return null;
    try {
      const c = this.jwt.verify<{ typ?: string; org?: string; sub?: string | null }>(estado);
      if (c.typ !== TIPO_DO_ESTADO_DO_GRANOLA || typeof c.org !== 'string' || !c.org) return null;
      return { orgId: c.org, actorId: typeof c.sub === 'string' ? c.sub : null };
    } catch {
      return null;
    }
  }

  private volta(motivo: string): string {
    return `${this.web}/conexoes?granola=${encodeURIComponent(motivo)}`;
  }

  async concluirAutorizacao(estado: string, codigo: string | undefined, erro: string | undefined): Promise<string> {
    const alvo = this.empresaDoEstado(estado);
    if (!alvo) return this.volta('expirado');
    if (erro) return this.volta(erro === 'access_denied' ? 'cancelado' : 'erro');
    if (!codigo || typeof codigo !== 'string' || codigo.length > 2048) return this.volta('erro');
    if (!this.cofre) return this.volta('sem_cofre');
    const org = await resolverOrgDaChave(this.prisma, alvo.orgId);
    if (!org) return this.volta('expirado');

    return comTenantPublico(org.orgId, async () => {
      const { provedor } = this.provedor(org.orgId, 'concluir', { actorId: alvo.actorId });
      try {
        const r = await auth(provedor, { serverUrl: this.servidor, authorizationCode: codigo });
        if (r !== 'AUTHORIZED') return this.volta('erro');
      } catch (e) {
        this.log.warn(`retorno do OAuth do Granola falhou (empresa ${org.orgId}): ${curta(e)}`);
        return this.volta(e instanceof GranolaNaoConectadoError ? 'expirado' : 'erro');
      } finally {
        await this.queimar(org.orgId, [NOMES_DO_GRANOLA_DIRETO.verificador], 'autorização concluída', alvo.actorId).catch(() => undefined);
      }
      await this.audit.log({
        orgId: org.orgId,
        actorId: alvo.actorId ?? undefined,
        action: 'granola.direto.conectado',
        entityType: 'integration',
        entityId: CONECTOR,
        after: { servidor: this.servidor },
      });
      this.contrato?.esquecer(org.orgId, CONECTOR);
      return this.volta('ok');
    });
  }

  async estado(orgId: string): Promise<TrabGranolaConexaoDireta> {
    const linha = await this.linhaDosTokens(orgId);
    return { conectado: !!linha, desde: linha?.desde ?? null, servidor: this.servidor, retorno: this.retorno };
  }

  async conectado(orgId: string): Promise<boolean> {
    return !!(await this.linhaDosTokens(orgId));
  }

  // ------------------------------------------------------------------ o MCP

  /** Abre o cliente MCP desta empresa, roda `fn` e fecha. O interruptor de Conexões vale antes de sair da casa. */
  private async comCliente<T>(orgId: string, fn: (cliente: Client, prazoMs: number) => Promise<T>, prazoMs = PRAZO_DA_CHAMADA_MS): Promise<T> {
    return this.conectores.envolver(CONECTOR, orgId, async () => {
      if (!(await this.lerTokens(orgId))) throw new GranolaNaoConectadoError();
      const { provedor } = this.provedor(orgId, 'chamar');
      const transporte = new StreamableHTTPClientTransport(new URL(this.servidor), { authProvider: provedor });
      const cliente = new Client({ name: 'root-os', version: '1.0.0' });
      try {
        await cliente.connect(transporte, { timeout: prazoMs });
        return await fn(cliente, prazoMs);
      } catch (e) {
        if (e instanceof GranolaNaoConectadoError || e instanceof GranolaIndisponivelError || e instanceof FormatoDoGranolaError) throw e;
        if (e instanceof UnauthorizedError || /\b401\b|unauthori[sz]ed|invalid_grant/i.test(curta(e))) {
          throw new GranolaNaoConectadoError('A autorização do Granola venceu ou foi revogada. Conecte de novo em Configurações › Integrações.');
        }
        throw new GranolaIndisponivelError(`O Granola não respondeu: ${curta(e)}`);
      } finally {
        await cliente.close().catch(() => undefined);
      }
    });
  }

  private async chamar(cliente: Client, nome: string, args: Record<string, unknown>, prazoMs: number): Promise<ResultadoDeFerramenta> {
    const r = (await cliente.callTool({ name: nome, arguments: args }, undefined, { timeout: prazoMs })) as ResultadoDeFerramenta;
    if (r.isError) {
      // O texto de erro do Granola é dele (plano, permissão, nota inexistente); vai curto.
      throw new GranolaIndisponivelError(`O Granola recusou "${nome}": ${curta(textosDoResultado(r).join(' ')) || 'sem motivo'}`);
    }
    return r;
  }

  async listarReunioes(orgId: string, o: { dias: number }): Promise<ReuniaoDoGranolaListada[]> {
    const time_range = o.dias <= 7 ? 'last_7_days' : 'last_30_days';
    return this.comCliente(orgId, async (cliente, prazo) => lerReunioes(await this.chamar(cliente, 'list_meetings', { time_range }, prazo)));
  }

  async lerReuniao(orgId: string, id: string): Promise<ReuniaoDoGranolaLida> {
    if (!ID_DE_REUNIAO_DO_GRANOLA.test(String(id ?? ''))) throw new GranolaIndisponivelError('Esse não é um id de reunião do Granola.');
    return this.comCliente(orgId, async (cliente, prazo) => {
      const meta = lerReunioes(await this.chamar(cliente, 'get_meetings', { meeting_ids: [id] }, prazo), 'a reunião').find((r) => r.id === id);
      const partes: string[] = [];
      let total = 0;
      let deslocamento = 0;
      for (let i = 0; i < MAX_PEDACOS_DA_TRANSCRICAO && total < MAX_CARACTERES_DA_TRANSCRICAO; i++) {
        const args: Record<string, unknown> = { meeting_id: id, max_chars: CARACTERES_POR_PEDACO };
        if (deslocamento > 0) args.offset = deslocamento;
        const pedaco = lerPedacoDaTranscricao(await this.chamar(cliente, 'get_meeting_transcript', args, prazo));
        if (pedaco.texto) {
          partes.push(pedaco.texto);
          total += pedaco.texto.length;
        }
        if (!pedaco.proximo || pedaco.proximo <= deslocamento) break;
        deslocamento = pedaco.proximo;
      }
      return {
        id,
        titulo: meta?.titulo ?? 'Reunião do Granola',
        em: meta?.em ?? null,
        participantes: meta?.participantes ?? [],
        emails: meta?.emails ?? [],
        link: meta?.link ?? null,
        transcricao: partes.join('\n').slice(0, MAX_CARACTERES_DA_TRANSCRICAO),
      };
    });
  }

  // ------------------------------------------------------------------ o contrato

  async sincronizar(ctx: ContextoDoVerbo): Promise<ResultadoDeSincronizacao> {
    if (!(await this.conectado(ctx.orgId))) {
      return { tipo: 'nao_se_aplica', motivo: 'O Granola direto não está conectado nesta empresa. As reuniões que o Zap manda continuam chegando.' };
    }
    const reunioes = await this.listarReunioes(ctx.orgId, { dias: 7 });
    return {
      tipo: 'feito',
      resumo: `${reunioes.length} reunião(ões) do Granola nos últimos 7 dias. Gere a ata em Trabalho › Atas.`,
      numeros: { reunioes: reunioes.length },
    };
  }

  async saude(ctx: ContextoDoVerbo): Promise<SaudeDeConector> {
    if (!(await this.conectado(ctx.orgId))) {
      return naoConfigurado('O Granola direto não está conectado. Use "Conectar ao Granola" no cartão do Granola.');
    }
    const comecou = Date.now();
    try {
      const n = await this.comCliente(ctx.orgId, async (cliente, prazo) => (await cliente.listTools(undefined, { timeout: prazo })).tools.length, PRAZO_DA_SONDA_MS);
      return conectado(Date.now() - comecou, `servidor MCP do Granola respondeu com ${n} ferramenta(s)`);
    } catch (e) {
      return erroDeConector(curta(e, 300), Date.now() - comecou);
    }
  }

  async revogar(ctx: ContextoDoVerbo & { motivo?: string | null }): Promise<ResultadoDeRevogacao> {
    // Primeiro pede ao Granola que esqueça este cliente (melhor esforço); depois queima o que o OS guarda.
    if (await this.lerTokens(ctx.orgId)) {
      await this.comCliente(ctx.orgId, (cliente, prazo) => this.chamar(cliente, 'sign_out', {}, prazo), PRAZO_DA_SONDA_MS).catch(() => undefined);
    }
    const queimados = await this.queimar(
      ctx.orgId,
      [NOMES_DO_GRANOLA_DIRETO.tokens, NOMES_DO_GRANOLA_DIRETO.cliente, NOMES_DO_GRANOLA_DIRETO.verificador],
      ctx.motivo?.trim() || 'conexão direta do Granola revogada',
      ctx.actorId ?? null,
    );
    this.contrato?.esquecer(ctx.orgId, CONECTOR);
    if (queimados.length) {
      await this.audit.log({
        orgId: ctx.orgId,
        actorId: ctx.actorId ?? undefined,
        action: 'granola.direto.revogado',
        entityType: 'integration',
        entityId: CONECTOR,
        after: { segredos: queimados },
      });
    }
    return {
      tipo: 'revogado',
      segredos: queimados,
      resumo: queimados.length
        ? 'A autorização direta do Granola foi queimada: o OS para de ler as reuniões na hora. As atas já geradas ficam. Para voltar, conecte de novo.'
        : 'Não havia autorização direta do Granola guardada nesta empresa.',
    };
  }
}
