import { BadRequestException, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

import { CofreService, SegredoIndisponivelError } from '../../cofre/cofre.service';
import { contextoAtual } from '../../common/contexto-execucao';
import { PRAZO_DA_CHAMADA_DE_SONDA_MS, RegistroDeConectores } from '../../integrations/conectores.registry';
import {
  conectado,
  erroDeConector,
  naoConfigurado,
  type ConectorDoContrato,
  type ContextoDoVerbo,
  type ResultadoDeAutorizacao,
  type ResultadoDeRevogacao,
  type ResultadoDeSincronizacao,
  type SaudeDeConector,
} from '../../integrations/contrato-de-conector';
import { PrismaService } from '../../prisma/prisma.service';
import { InterruptoresRegistry } from '../interruptores.registry';
import {
  CABECALHO_DO_SEGREDO_DIGISAC,
  CONECTOR_DIGISAC,
  PARAMETRO_DO_SEGREDO_DIGISAC,
  SEGREDO_MINIMO_DIGISAC,
  caminhoDoWebhookDigisac,
  type AdministracaoDoDigisac,
  type ConexaoDoDigisac,
  type ContatoDoDigisac,
  type CredencialParaGuardar,
  type EnvioPeloDigisac,
  type OrigemDaCredencialDigisac,
  type ServicoDoDigisac,
} from './digisac.port';
import { TransporteDeCanalRegistry } from './transporte.registry';

/*
 * O CONECTOR DO DIGISAC (Interface 20/10, lane U6).
 *
 * O WhatsApp do escritório-modelo passa pelo DigiSac, uma plataforma de
 * atendimento com API REST. Este é o ÚNICO arquivo que fala HTTP com ela, que
 * lê as variáveis `DIGISAC_*` e que abre a credencial no cofre.
 *
 * O QUE FOI USADO DA API (documentação pública, coleção Postman da DigiSac,
 * consultada em 20/10/2026; ver o relatório da lane):
 *
 *   base     https://<conta>.digisac.me/api/v1   (Conta › Informações)
 *   auth     Authorization: Bearer <token de acesso pessoal> (Conta › API › Tokens)
 *   enviar   POST /messages  { text, type: 'chat', number, serviceId }   contato novo
 *            POST /messages  { text, type: 'chat', contactId }           contato conhecido
 *   grupo    POST /contacts  { serviceId, internalName, isGroup: true }
 *            POST /contacts/:id/add-members  [{ number }]
 *   contato  GET  /contacts/:id   →  data.number, isGroup, serviceId
 *   conexões GET  /services?perPage=…  e  GET /services/:id
 *   webhook  cadastrado na conta (Conta › API › Webhook), evento `message.created`;
 *            o corpo é `{ event, data: { id, isFromMe, type, text, contactId, serviceId, … } }`.
 *            O formulário do webhook só tem nome, URL, tipo e eventos: NÃO há
 *            cabeçalho próprio nem assinatura. Por isso o segredo viaja no
 *            parâmetro `segredo` da URL cadastrada (o cabeçalho
 *            `x-digisac-segredo` também vale, para quem põe um intermediário).
 *
 * CREDENCIAL, POR EMPRESA: o cofre primeiro (conector `digisac`, nomes `url`,
 * `token`, `servico` e, opcional, `webhook_segredo`). Sem nada no cofre, e só
 * para a EMPRESA DA CASA (slug `root`), valem as variáveis de ambiente
 * `DIGISAC_URL`, `DIGISAC_TOKEN`, `DIGISAC_SERVICE_ID` e
 * `DIGISAC_WEBHOOK_SEGREDO`. Credencial revogada no cofre NÃO cai para o
 * ambiente: revogar é parar. Empresa cliente nunca usa a credencial do
 * processo, e é isso que impede o token de uma empresa servir a outra.
 *
 * NADA DO ESCRITÓRIO CARDOZO & SAGGIORO ENTRA AQUI: a conta DigiSac da Root é
 * [a decidir]. As provas rodam contra um dublê HTTP.
 */

const SLUG_DA_CASA = 'root';
const PRAZO_DO_ENVIO_MS = 20_000;
const CAPACIDADE_DO_ENVIO = 'comercial.whatsapp.enviar';

const NOMES = { url: 'url', token: 'token', servico: 'servico', segredo: 'webhook_segredo' } as const;

interface Credencial {
  base: string;
  token: string;
  servicoId: string;
  origem: Exclude<OrigemDaCredencialDigisac, 'nenhuma'>;
}

type Corpo = Record<string, unknown>;

/** Erro do DigiSac com o status e o começo do corpo, sem o token. */
export class DigisacRespondeuErro extends Error {
  constructor(
    readonly status: number,
    metodo: string,
    caminho: string,
    corpo: string,
  ) {
    super(`DigiSac ${metodo} ${caminho} respondeu HTTP ${status}${corpo ? `: ${corpo.slice(0, 200)}` : ''}`);
    this.name = 'DigisacRespondeuErro';
  }
}

/** A empresa ainda não tem DigiSac configurado (ou revogou). */
export class DigisacNaoConfiguradoError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'DigisacNaoConfiguradoError';
  }
}

/**
 * O endereço da conta, normalizado: só esquema, host e porta, sem `/api/v1`.
 * `https` sempre, menos para o dublê local (loopback ou nome sem ponto, como o
 * de um container vizinho). Devolve `null` para o que não serve.
 */
export function baseDoDigisac(entrada: string | null | undefined): string | null {
  const cru = String(entrada ?? '').trim();
  if (!cru) return null;
  let u: URL;
  try {
    u = new URL(cru);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1' || !u.hostname.includes('.');
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
  const caminho = u.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  if (caminho) return null;
  return `${u.protocol}//${u.host}`;
}

/** Comparação em tempo constante. Vazio nunca confere. */
export function segredoDigisacConfere(esperado: string | null, apresentado: string | null | undefined): boolean {
  if (!esperado || typeof apresentado !== 'string' || apresentado === '') return false;
  const a = Buffer.from(apresentado, 'utf8');
  const b = Buffer.from(esperado, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** A lista de conexões, na forma que o DigiSac devolver (lista crua ou paginada em `data`). */
export function servicosDaResposta(corpo: unknown): ServicoDoDigisac[] {
  const lista = Array.isArray(corpo) ? corpo : Array.isArray((corpo as Corpo | null)?.data) ? ((corpo as Corpo).data as unknown[]) : [];
  return lista
    .filter((s): s is Corpo => !!s && typeof s === 'object' && typeof (s as Corpo).id === 'string')
    .map((s) => ({
      id: String(s.id),
      nome: typeof s.name === 'string' && s.name.trim() ? s.name.trim() : String(s.id),
      tipo: typeof s.type === 'string' ? s.type : null,
      arquivado: !!s.archivedAt,
    }));
}

@Injectable()
export class DigisacService implements OnModuleInit, EnvioPeloDigisac, AdministracaoDoDigisac {
  private readonly log = new Logger('DigisacService');
  private readonly ambiente = {
    url: (process.env.DIGISAC_URL ?? '').trim(),
    token: (process.env.DIGISAC_TOKEN ?? '').trim(),
    servico: (process.env.DIGISAC_SERVICE_ID ?? '').trim(),
    segredo: (process.env.DIGISAC_WEBHOOK_SEGREDO ?? '').trim(),
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly cofre: CofreService,
    /** `@Optional()` porque a suíte monta à mão; sem registro, o DigiSac só não aparece no contrato. */
    @Optional() private readonly contrato?: RegistroDeConectores,
    @Optional() private readonly transportes?: TransporteDeCanalRegistry,
    @Optional() private readonly interruptores?: InterruptoresRegistry,
  ) {}

  onModuleInit(): void {
    this.contrato?.registrar(this.descritor(), 'DigisacService');
    /*
     * Inscrito como o canal `digisac`, ao lado do `whatsapp` da Evolution, e
     * não no lugar dele: o canal de aprovação continua entregando pela
     * Evolution. A entrega aqui só existe dentro de um contexto de empresa (a
     * credencial é por empresa) e só a pasta do canal pode pedi-la (catraca).
     */
    this.transportes?.registrar(
      CONECTOR_DIGISAC,
      async (destino, texto) => {
        const orgId = contextoAtual()?.orgId;
        if (!orgId) throw new DigisacNaoConfiguradoError('entrega pelo DigiSac sem empresa no contexto: nada foi enviado');
        await this.enviarParaNumero(orgId, destino, texto);
      },
      'DigisacService',
    );
    if (this.ambiente.segredo && this.ambiente.segredo.length < SEGREDO_MINIMO_DIGISAC) {
      this.log.warn(`DIGISAC_WEBHOOK_SEGREDO tem menos de ${SEGREDO_MINIMO_DIGISAC} caracteres e foi ignorado: a entrada recusa tudo até trocar.`);
    }
  }

  // --------------------------------------------------------------- credencial

  private async daCasa(orgId: string): Promise<boolean> {
    const linha = await this.prisma.org.findFirst({ where: { id: orgId, slug: SLUG_DA_CASA }, select: { id: true } });
    return !!linha;
  }

  /** Lê um valor do cofre. `undefined` = não existe; `null` = revogado. */
  private async doCofre(orgId: string, nome: string): Promise<string | null | undefined> {
    try {
      return await this.cofre.envolver({ orgId, conector: CONECTOR_DIGISAC, nome }, (c) => c.usar((v) => v));
    } catch (e) {
      if (e instanceof SegredoIndisponivelError) return e.revogado ? null : undefined;
      throw e;
    }
  }

  /** A credencial em uso por esta empresa, ou o motivo de não haver. */
  private async credencial(orgId: string): Promise<Credencial | { motivo: string }> {
    const token = await this.doCofre(orgId, NOMES.token);
    if (token === null) return { motivo: 'O token do DigiSac desta empresa foi revogado. Salve um token novo em Conexões.' };
    if (token) {
      const base = baseDoDigisac(await this.doCofre(orgId, NOMES.url));
      const servicoId = (await this.doCofre(orgId, NOMES.servico)) ?? '';
      if (!base) return { motivo: 'O endereço da conta do DigiSac guardado no cofre não é válido. Salve de novo em Conexões.' };
      if (!servicoId) return { motivo: 'Falta o id da conexão do DigiSac. Salve em Conexões.' };
      return { base, token, servicoId, origem: 'cofre' };
    }
    if (this.ambiente.token && (await this.daCasa(orgId))) {
      const base = baseDoDigisac(this.ambiente.url);
      if (!base) return { motivo: 'DIGISAC_URL ausente ou inválida no ambiente da API.' };
      if (!this.ambiente.servico) return { motivo: 'DIGISAC_SERVICE_ID ausente no ambiente da API.' };
      return { base, token: this.ambiente.token, servicoId: this.ambiente.servico, origem: 'ambiente' };
    }
    return { motivo: 'DigiSac não configurado nesta empresa: salve o token e o id da conexão em Conexões.' };
  }

  private async exigirCredencial(orgId: string): Promise<Credencial> {
    const c = await this.credencial(orgId);
    if ('motivo' in c) throw new DigisacNaoConfiguradoError(c.motivo);
    return c;
  }

  private async segredoDoWebhook(orgId: string): Promise<string | null> {
    const doCofre = await this.doCofre(orgId, NOMES.segredo);
    if (doCofre === null) return null;
    if (doCofre) return doCofre.length >= SEGREDO_MINIMO_DIGISAC ? doCofre : null;
    if (this.ambiente.segredo.length >= SEGREDO_MINIMO_DIGISAC && (await this.daCasa(orgId))) return this.ambiente.segredo;
    return null;
  }

  // ---------------------------------------------------------------------- HTTP

  private async chamar<T>(c: Credencial, metodo: 'GET' | 'POST', caminho: string, corpo?: unknown, prazoMs = PRAZO_DO_ENVIO_MS): Promise<T | null> {
    const res = await fetch(`${c.base}/api/v1${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'marketing-os' },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
      signal: AbortSignal.timeout(prazoMs),
    });
    const texto = await res.text().catch(() => '');
    if (!res.ok) throw new DigisacRespondeuErro(res.status, metodo, caminho, texto);
    if (!texto) return null;
    try {
      return JSON.parse(texto) as T;
    } catch {
      return null;
    }
  }

  /** O botão de emergência: conector desligado nesta empresa não manda nada. */
  private async exigirLigado(orgId: string): Promise<void> {
    const recusa = await this.interruptores?.consultar({ orgId, conector: CONECTOR_DIGISAC, capabilityId: CAPACIDADE_DO_ENVIO });
    if (recusa) throw new DigisacNaoConfiguradoError(recusa.motivo);
  }

  private idDaMensagem(r: Corpo | null): string {
    const id = r && typeof r.id === 'string' ? r.id : null;
    if (!id) throw new Error('o DigiSac não devolveu o id da mensagem enviada');
    return id;
  }

  // -------------------------------------------------------------------- envio

  async enviarParaNumero(orgId: string, numero: string, texto: string): Promise<{ id: string }> {
    await this.exigirLigado(orgId);
    const c = await this.exigirCredencial(orgId);
    const digitos = String(numero ?? '').replace(/\D/g, '');
    if (digitos.length < 10 || digitos.length > 15) throw new Error('número de WhatsApp inválido: nada foi enviado');
    const r = await this.chamar<Corpo>(c, 'POST', '/messages', { text: texto, type: 'chat', number: digitos, serviceId: c.servicoId });
    return { id: this.idDaMensagem(r) };
  }

  async enviarParaContato(orgId: string, contatoId: string, texto: string): Promise<{ id: string }> {
    await this.exigirLigado(orgId);
    const c = await this.exigirCredencial(orgId);
    if (!contatoId.trim()) throw new Error('contato do DigiSac vazio: nada foi enviado');
    const r = await this.chamar<Corpo>(c, 'POST', '/messages', { text: texto, type: 'chat', contactId: contatoId });
    return { id: this.idDaMensagem(r) };
  }

  async criarGrupo(orgId: string, nome: string, numeros: string[]): Promise<{ contatoId: string }> {
    await this.exigirLigado(orgId);
    const c = await this.exigirCredencial(orgId);
    const r = await this.chamar<Corpo>(c, 'POST', '/contacts', { serviceId: c.servicoId, internalName: nome.slice(0, 100), isGroup: true });
    const contatoId = r && typeof r.id === 'string' ? r.id : null;
    if (!contatoId) throw new Error('o DigiSac não devolveu o grupo criado');
    const membros = numeros.map((n) => String(n).replace(/\D/g, '')).filter((n) => n.length >= 10);
    if (membros.length) {
      await this.chamar(c, 'POST', `/contacts/${encodeURIComponent(contatoId)}/add-members`, membros.map((number) => ({ number })));
    }
    return { contatoId };
  }

  // ----------------------------------------------------------- administração

  async conexao(orgId: string): Promise<ConexaoDoDigisac> {
    const { items } = await this.cofre.estado(orgId);
    const linha = (nome: string) => items.find((i) => i.conector === CONECTOR_DIGISAC && i.nome === nome) ?? null;
    const token = linha(NOMES.token);
    const c = await this.credencial(orgId);
    const desligado = await this.prisma.conectorDesligado.findFirst({ where: { orgId, conector: CONECTOR_DIGISAC }, select: { conector: true } });
    const segredo = await this.segredoDoWebhook(orgId);
    return {
      origem: 'motivo' in c ? 'nenhuma' : c.origem,
      url: 'motivo' in c ? null : c.base,
      servicoId: 'motivo' in c ? null : c.servicoId,
      tokenGuardado: !!token && !token.revogadoEm,
      tokenRevogadoEm: token?.revogadoEm ?? null,
      tokenAtualizadoEm: token && !token.revogadoEm ? token.atualizadoEm : null,
      segredoDoWebhook: !!segredo,
      caminhoDoWebhook: caminhoDoWebhookDigisac(orgId),
      parametroDoSegredo: PARAMETRO_DO_SEGREDO_DIGISAC,
      cabecalhoDoSegredo: CABECALHO_DO_SEGREDO_DIGISAC,
      desligado: !!desligado,
    };
  }

  /**
   * Guarda a credencial no cofre. O token é opcional quando já existe um
   * guardado (trocar só a conexão não pede o token de novo), e nunca volta.
   */
  async guardarCredencial(orgId: string, entrada: CredencialParaGuardar, actorId: string | null): Promise<ConexaoDoDigisac> {
    const base = baseDoDigisac(entrada.url);
    if (!base) throw new BadRequestException('Endereço da conta inválido: use https://<sua conta>.digisac.me, sem caminho.');
    const servicoId = String(entrada.servicoId ?? '').trim();
    if (!servicoId || servicoId.length > 120) throw new BadRequestException('Informe o id da conexão do DigiSac.');
    const token = String(entrada.token ?? '').trim();
    if (!token) {
      const atual = await this.doCofre(orgId, NOMES.token);
      if (!atual) throw new BadRequestException('Informe o token de acesso do DigiSac.');
    }
    const segredo = String(entrada.segredoDoWebhook ?? '').trim();
    if (segredo && segredo.length < SEGREDO_MINIMO_DIGISAC) {
      throw new BadRequestException(`O segredo do webhook precisa de pelo menos ${SEGREDO_MINIMO_DIGISAC} caracteres.`);
    }
    const origem = 'Integrações (WhatsApp pelo DigiSac)';
    if (token) await this.cofre.guardar({ orgId, conector: CONECTOR_DIGISAC, nome: NOMES.token, valor: token, origem, actorId });
    await this.cofre.guardar({ orgId, conector: CONECTOR_DIGISAC, nome: NOMES.url, valor: base, origem, actorId });
    await this.cofre.guardar({ orgId, conector: CONECTOR_DIGISAC, nome: NOMES.servico, valor: servicoId, origem, actorId });
    if (segredo) await this.cofre.guardar({ orgId, conector: CONECTOR_DIGISAC, nome: NOMES.segredo, valor: segredo, origem, actorId });
    return this.conexao(orgId);
  }

  async listarServicos(orgId: string): Promise<ServicoDoDigisac[]> {
    const c = await this.exigirCredencial(orgId);
    return servicosDaResposta(await this.chamar<unknown>(c, 'GET', '/services?perPage=100'));
  }

  async webhookAutentico(orgId: string, apresentado: string | null | undefined): Promise<boolean> {
    return segredoDigisacConfere(await this.segredoDoWebhook(orgId), apresentado);
  }

  async ligado(orgId: string): Promise<boolean> {
    const recusa = await this.interruptores?.consultar({ orgId, conector: CONECTOR_DIGISAC });
    return !recusa;
  }

  async servicoDaEmpresa(orgId: string): Promise<string | null> {
    const c = await this.credencial(orgId);
    return 'motivo' in c ? null : c.servicoId;
  }

  async buscarContato(orgId: string, contatoId: string): Promise<ContatoDoDigisac | null> {
    const c = await this.exigirCredencial(orgId);
    let r: Corpo | null;
    try {
      r = await this.chamar<Corpo>(c, 'GET', `/contacts/${encodeURIComponent(contatoId)}`);
    } catch (e) {
      if (e instanceof DigisacRespondeuErro && e.status === 404) return null;
      throw e;
    }
    if (!r || typeof r.id !== 'string') return null;
    const dados = (r.data ?? {}) as Corpo;
    const numero = typeof dados.number === 'string' ? dados.number : typeof r.number === 'string' ? r.number : null;
    return { id: r.id, numero, grupo: r.isGroup === true, servicoId: typeof r.serviceId === 'string' ? r.serviceId : null };
  }

  // ----------------------------------------------------------------- contrato

  private descritor(): ConectorDoContrato {
    return {
      chave: CONECTOR_DIGISAC,
      rotulo: 'WhatsApp (DigiSac)',
      escopoDaCredencial: 'empresa',
      linhasDoCatalogo: [CONECTOR_DIGISAC],
      autorizar: async (): Promise<ResultadoDeAutorizacao> => ({
        tipo: 'manual',
        instrucao:
          'O DigiSac não tem OAuth. No DigiSac, crie um token em Conta › API › Tokens de acesso pessoal e copie o id da ' +
          'conexão de WhatsApp. Em Conexões, no cartão WhatsApp (DigiSac), salve o endereço da conta, o token e o id da conexão. ' +
          'Depois cadastre no DigiSac o webhook com a URL que o cartão mostra, com o evento de mensagem criada.',
      }),
      sincronizar: async (ctx: ContextoDoVerbo): Promise<ResultadoDeSincronizacao> => {
        const servicos = await this.listarServicos(ctx.orgId);
        const ativos = servicos.filter((s) => !s.arquivado);
        return {
          tipo: 'feito',
          resumo: `${servicos.length} conexão(ões) na conta do DigiSac, ${ativos.length} ativa(s).`,
          numeros: { conexoes: servicos.length, ativas: ativos.length },
        };
      },
      saude: async (ctx: ContextoDoVerbo): Promise<SaudeDeConector> => {
        const c = await this.credencial(ctx.orgId);
        if ('motivo' in c) return naoConfigurado(c.motivo);
        const comecou = Date.now();
        try {
          const s = await this.chamar<Corpo>(c, 'GET', `/services/${encodeURIComponent(c.servicoId)}`, undefined, PRAZO_DA_CHAMADA_DE_SONDA_MS);
          const nome = s && typeof s.name === 'string' ? s.name : c.servicoId;
          const segredo = await this.segredoDoWebhook(ctx.orgId);
          return conectado(
            Date.now() - comecou,
            `Conexão "${nome}" encontrada (credencial do ${c.origem === 'cofre' ? 'cofre da empresa' : 'ambiente da casa'}).` +
              (segredo ? '' : ' Sem segredo de webhook: as respostas do lead não entram no OS.'),
          );
        } catch (e) {
          return erroDeConector(`O DigiSac não respondeu: ${(e as Error).message}`, Date.now() - comecou);
        }
      },
      revogar: async (ctx: ContextoDoVerbo & { motivo?: string | null }): Promise<ResultadoDeRevogacao> => {
        const r = await this.cofre.revogar({ orgId: ctx.orgId, conector: CONECTOR_DIGISAC, motivo: ctx.motivo ?? null, por: ctx.actorId ?? null });
        if (!r.revogados.length && !r.jaRevogados.length) {
          return {
            tipo: 'nao_se_aplica',
            motivo:
              'Não há credencial do DigiSac no cofre desta empresa. Se a casa usa as variáveis DIGISAC_*, elas são do processo: ' +
              'para parar agora, desligue o conector; para queimar, troque o token no DigiSac.',
          };
        }
        return {
          tipo: 'revogado',
          segredos: r.revogados,
          resumo: 'O token, a conexão e o segredo do webhook do DigiSac foram queimados no cofre. Nada sai nem entra até salvar de novo.',
        };
      },
    };
  }
}
