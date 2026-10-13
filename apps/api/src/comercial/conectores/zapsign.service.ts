import { Injectable, Logger, OnModuleInit, Optional, ServiceUnavailableException } from '@nestjs/common';

import { ConectoresConfiguradosRegistry } from '../../gateway/conectores-configurados.registry';
import { PRAZO_DA_CHAMADA_DE_SONDA_MS, RegistroDeConectores } from '../../integrations/conectores.registry';
import {
  conectado,
  erroDeConector,
  naoConfigurado,
  type ConectorDoContrato,
  type ResultadoDeAutorizacao,
  type ResultadoDeRevogacao,
  type ResultadoDeSincronizacao,
  type SaudeDeConector,
} from '../../integrations/contrato-de-conector';
import {
  documentoDaZapsign,
  lerWebhookDaZapsign,
  type AssinaturaNoWebhook,
  type DocumentoNoProvedor,
  type NovoDocumento,
  type PortaDeAssinatura,
} from '../portas/assinatura.port';
import { segredoConfere } from '../portas/cobranca.port';

/*
 * CONECTOR DA ZAPSIGN (cockpit comercial, lane D, 13/10/2026).
 *
 * Assinatura eletrônica do contrato, API v1. Conta e plano de API da Operação
 * ROOT (no escritório a mesma automação morreu no 402 por falta do plano de
 * API: aqui ela nasce com ele, e a chave é [a decidir] até a conta existir).
 *
 * É o ÚNICO arquivo que conhece o endereço da ZapSign, o token da API e o
 * segredo do webhook (catraca de arquitetura). O comercial o recebe pela porta
 * `PORTA_DE_ASSINATURA`, ligada em `zapsign.module.ts`, a fiação desta pasta.
 *
 *   ZAPSIGN_BASE_URL      padrão https://api.zapsign.com.br/api/v1 (o dublê da homologação: http://zapsign-mock:4012/api/v1)
 *   ZAPSIGN_API_TOKEN     Bearer da API (sandbox ou produção)
 *   ZAPSIGN_WEBHOOK_TOKEN o segredo que a ZapSign manda em `x-zapsign-token`; sem ele, todo webhook é recusado
 *
 * Quem cria documento é só o EFEITO de `comercial.contrato.enviar` (R4), que a
 * porta dispara depois da assinatura da titular.
 */

const PADRAO = 'https://api.zapsign.com.br/api/v1';

@Injectable()
export class ZapsignService implements OnModuleInit, PortaDeAssinatura {
  private readonly log = new Logger('ZapsignService');
  private readonly base = ((process.env.ZAPSIGN_BASE_URL ?? '').trim() || PADRAO).replace(/\/$/, '');
  private readonly token = (process.env.ZAPSIGN_API_TOKEN ?? '').trim();
  private readonly webhookToken = (process.env.ZAPSIGN_WEBHOOK_TOKEN ?? '').trim();
  readonly provedor = 'zapsign';

  constructor(
    @Optional() private readonly configurados?: ConectoresConfiguradosRegistry,
    @Optional() private readonly contrato?: RegistroDeConectores,
  ) {}

  onModuleInit(): void {
    this.configurados?.registrar('zapsign', () => this.configurada());
    this.contrato?.registrar(this.descritor(), 'ZapsignService');
  }

  configurada(): boolean {
    return this.token.length > 0;
  }

  private exigirConfigurada(): void {
    if (!this.configurada()) {
      throw new ServiceUnavailableException('ZapSign não configurada: defina ZAPSIGN_API_TOKEN no ambiente da API e recrie o container.');
    }
  }

  private async chamar<T>(metodo: 'GET' | 'POST', path: string, corpo?: unknown, prazoMs = 20_000): Promise<{ status: number; corpo: T | null }> {
    this.exigirConfigurada();
    const res = await fetch(`${this.base}${path}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', 'User-Agent': 'marketing-os' },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
      signal: AbortSignal.timeout(prazoMs),
    });
    const texto = await res.text().catch(() => '');
    let json: T | null = null;
    try {
      json = texto ? (JSON.parse(texto) as T) : null;
    } catch {
      json = null;
    }
    if (!res.ok && res.status !== 404) throw new Error(`ZapSign ${metodo} ${path} → HTTP ${res.status} ${texto.slice(0, 200)}`);
    return { status: res.status, corpo: json };
  }

  async criarDocumento(d: NovoDocumento): Promise<DocumentoNoProvedor> {
    const r = await this.chamar<Record<string, unknown>>('POST', '/docs/', {
      name: d.nome,
      markdown_text: d.markdown,
      external_id: d.referenciaExterna,
      lang: 'pt-br',
      disable_signer_emails: true,
      signers: d.signatarios.map((s) => ({ name: s.nome, email: s.email, external_id: s.papel, send_automatic_email: false })),
    });
    if (r.status === 404 || !r.corpo) throw new Error('ZapSign não devolveu o documento criado.');
    return documentoDaZapsign(r.corpo);
  }

  async consultarEstado(externoId: string): Promise<DocumentoNoProvedor | null> {
    const r = await this.chamar<Record<string, unknown>>('GET', `/docs/${encodeURIComponent(externoId)}/`);
    return r.status === 404 || !r.corpo ? null : documentoDaZapsign(r.corpo);
  }

  async enviarParaAssinar(externoId: string): Promise<DocumentoNoProvedor | null> {
    return this.consultarEstado(externoId);
  }

  webhookAutentico(token: string | undefined | null): boolean {
    return segredoConfere(this.webhookToken, token);
  }

  interpretarWebhook(corpo: unknown): AssinaturaNoWebhook | null {
    return lerWebhookDaZapsign(corpo);
  }

  private descritor(): ConectorDoContrato {
    return {
      chave: 'zapsign',
      rotulo: 'ZapSign (assinatura de contrato)',
      escopoDaCredencial: 'processo',
      autorizar: async (): Promise<ResultadoDeAutorizacao> => ({
        tipo: 'manual',
        instrucao:
          'A ZapSign não tem OAuth: o token da API (plano de API da conta da Operação ROOT) e o segredo do webhook ' +
          'ficam no ambiente da API (ZAPSIGN_API_TOKEN, ZAPSIGN_WEBHOOK_TOKEN). No painel da ZapSign, aponte o ' +
          'webhook para /api/comercial/webhooks/zapsign com o mesmo segredo.',
      }),
      sincronizar: async (): Promise<ResultadoDeSincronizacao> => ({
        tipo: 'nao_se_aplica',
        motivo: 'Não há espelho para trazer: o estado de cada contrato chega pelo webhook e fica em ComercialDocumento.',
      }),
      saude: async (): Promise<SaudeDeConector> => {
        if (!this.configurada()) return naoConfigurado('ZAPSIGN_API_TOKEN ausente no ambiente da API: nenhum contrato sai para assinatura.');
        const comecou = Date.now();
        try {
          await this.chamar('GET', '/docs/?page=1', undefined, PRAZO_DA_CHAMADA_DE_SONDA_MS);
          return conectado(Date.now() - comecou, this.webhookToken ? null : 'sem ZAPSIGN_WEBHOOK_TOKEN: a assinatura não volta ao OS.');
        } catch (e) {
          return erroDeConector(`A ZapSign não respondeu: ${(e as Error).message}`, Date.now() - comecou);
        }
      },
      revogar: async (): Promise<ResultadoDeRevogacao> => ({
        tipo: 'nao_se_aplica',
        motivo:
          'O token da ZapSign é do processo. Para parar agora, DESLIGUE o conector em Conexões (a porta recusa ' +
          'comercial.contrato.enviar); para queimar o token, troque-o no painel da ZapSign e no ambiente da API.',
      }),
    };
  }
}
