import { contextoAtual } from '../../common/contexto-execucao';
import type { EnvioPeloDigisac } from '../../gateway/canais/digisac.port';
import { normalizarTelefone } from '../eventos';
import type { BotaoInterativo, EnvioFeito, EntradaDeWhatsapp, EventoDeEntrada, FormularioInterativo, WhatsappPort } from './whatsapp.port';
import { ProvedorIndisponivelError } from './whatsapp.port';

/*
 * O PROVEDOR DIGISAC (Interface 20/10, lane U6): `WHATSAPP_PROVEDOR=digisac`.
 *
 * Só TRADUZ: o texto do comercial vira o pedido do DigiSac e o webhook do
 * DigiSac vira o `EventoDeEntrada`. O HTTP mora no conector
 * (`gateway/canais/digisac.conector.ts`), que este provedor recebe pela porta
 * `ENVIO_PELO_DIGISAC`. Quem chama o provedor é só o EFEITO de
 * `comercial.whatsapp.enviar` (R3): o provedor é transporte, não régua.
 *
 * BOTÕES E FORMULÁRIO VIRAM TEXTO NUMERADO. A API do DigiSac tem mensagens
 * interativas (lista e botões), mas elas são cadastradas antes, uma a uma, e
 * valem para a conexão oficial da WhatsApp Business API. O texto numerado sai
 * em qualquer conexão; a resposta "2" (ou "1. Omie 2. sim …") é lida na
 * entrada contra a última mensagem interativa enviada ao lead.
 *
 * GRUPO: a API cria grupo (contato com `isGroup`) e põe participantes; o envio
 * ao grupo vai pelo `contactId` do grupo. O jid que volta é `digisac:<id>`.
 */

/** O prefixo do "jid" de grupo do DigiSac (o id do contato-grupo). */
export const PREFIXO_DO_GRUPO_DIGISAC = 'digisac:';

export const DIGISAC_SEM_EMPRESA = 'envio pelo DigiSac sem empresa no contexto: nada foi enviado.';
export const DIGISAC_GRUPO_DE_OUTRO_PROVEDOR =
  'o grupo não foi criado pelo DigiSac (o jid não começa com digisac:): crie o grupo de novo com o DigiSac configurado.';

// O texto numerado (botões e formulário) é o mesmo da Evolution: mora em `texto-numerado.ts`.
export { escolhaNumerada, respostaDoFormulario, textoComBotoes, textoComFormulario } from './texto-numerado';
import { textoComBotoes, textoComFormulario } from './texto-numerado';

/** O que a entrada lê do corpo do webhook do DigiSac, antes de saber o número. */
export interface MensagemDoWebhookDigisac {
  mensagemId: string;
  contatoId: string;
  servicoId: string | null;
  texto: string;
  /** Só quando o webhook já traz o contato (`data.contact.data.number`). */
  numero: string | null;
}

export type LeituraDoWebhookDigisac = { mensagem: MensagemDoWebhookDigisac } | { ignorado: string };

/**
 * O corpo do webhook (`{ event, data: { id, isFromMe, type, text, contactId, serviceId, … } }`).
 * Só a mensagem de texto que o CONTATO mandou passa: evento que não é
 * `message.created`, mensagem da própria conta, comentário interno, mensagem
 * de bot e mensagem sem texto ficam de fora, com o motivo.
 */
export function lerWebhookDoDigisac(corpo: unknown): LeituraDoWebhookDigisac {
  const c = (corpo ?? {}) as Record<string, unknown>;
  if (c.event !== 'message.created') return { ignorado: `evento ${typeof c.event === 'string' ? c.event : 'ausente'}` };
  const d = (Array.isArray(c.data) ? c.data[0] : c.data) as Record<string, unknown> | undefined;
  if (!d || typeof d !== 'object') return { ignorado: 'sem mensagem' };
  if (d.isFromMe === true) return { ignorado: 'mensagem da própria conta' };
  if (d.isFromBot === true) return { ignorado: 'mensagem de robô' };
  if (d.type !== undefined && d.type !== 'chat') return { ignorado: `tipo ${String(d.type)}` };
  const texto = typeof d.text === 'string' ? d.text.trim() : '';
  if (!texto) return { ignorado: 'sem texto' };
  const mensagemId = typeof d.id === 'string' ? d.id : null;
  const contatoId = typeof d.contactId === 'string' ? d.contactId : null;
  if (!mensagemId || !contatoId) return { ignorado: 'sem id da mensagem ou do contato' };
  const contato = (d.contact ?? {}) as Record<string, unknown>;
  if (contato.isGroup === true) return { ignorado: 'mensagem de grupo' };
  const dadosDoContato = (contato.data ?? {}) as Record<string, unknown>;
  const numero = typeof dadosDoContato.number === 'string' ? dadosDoContato.number : null;
  return {
    mensagem: {
      mensagemId,
      contatoId,
      servicoId: typeof d.serviceId === 'string' ? d.serviceId : null,
      texto: texto.slice(0, 2000),
      numero,
    },
  };
}

export class DigisacProvider implements WhatsappPort, EntradaDeWhatsapp {
  readonly provedor = 'digisac' as const;
  readonly configured: boolean;

  constructor(private readonly envio: EnvioPeloDigisac | null) {
    this.configured = !!envio;
  }

  private orgId(): string {
    const id = contextoAtual()?.orgId;
    if (!id) throw new ProvedorIndisponivelError(DIGISAC_SEM_EMPRESA);
    return id;
  }

  private exigirEnvio(): EnvioPeloDigisac {
    if (!this.envio) throw new ProvedorIndisponivelError('o conector do DigiSac não está carregado nesta API: nada foi enviado.');
    return this.envio;
  }

  private async mandar(destino: string, texto: string): Promise<EnvioFeito> {
    const envio = this.exigirEnvio();
    const r = await envio.enviarParaNumero(this.orgId(), normalizarTelefone(destino), texto);
    return { mensagemExternaId: r.id, provedor: 'digisac' };
  }

  enviarTexto(destino: string, texto: string): Promise<EnvioFeito> {
    return this.mandar(destino, texto);
  }

  enviarFormulario(destino: string, texto: string, formulario: FormularioInterativo): Promise<EnvioFeito> {
    return this.mandar(destino, textoComFormulario(texto, formulario));
  }

  enviarBotoes(destino: string, texto: string, botoes: BotaoInterativo[]): Promise<EnvioFeito> {
    return this.mandar(destino, textoComBotoes(texto, botoes));
  }

  async criarGrupo(nome: string, participantes: string[]): Promise<{ jid: string }> {
    const envio = this.exigirEnvio();
    const r = await envio.criarGrupo(this.orgId(), nome, participantes.map(normalizarTelefone));
    return { jid: `${PREFIXO_DO_GRUPO_DIGISAC}${r.contatoId}` };
  }

  async enviarNoGrupo(jid: string, texto: string): Promise<EnvioFeito> {
    if (!jid.startsWith(PREFIXO_DO_GRUPO_DIGISAC)) throw new ProvedorIndisponivelError(DIGISAC_GRUPO_DE_OUTRO_PROVEDOR);
    const envio = this.exigirEnvio();
    const r = await envio.enviarParaContato(this.orgId(), jid.slice(PREFIXO_DO_GRUPO_DIGISAC.length), texto);
    return { mensagemExternaId: r.id, provedor: 'digisac' };
  }

  /**
   * A entrada SÍNCRONA da porta: só serve quando o webhook já traz o número do
   * contato. Sem ele, a rota de entrada pergunta ao DigiSac pelo contato
   * (`ADMINISTRACAO_DO_DIGISAC.buscarContato`) antes de montar o evento.
   */
  receber(corpo: unknown): EventoDeEntrada | null {
    const l = lerWebhookDoDigisac(corpo);
    if ('ignorado' in l || !l.mensagem.numero) return null;
    return { telefone: normalizarTelefone(l.mensagem.numero), texto: l.mensagem.texto, mensagemId: l.mensagem.mensagemId, interativo: null };
  }
}
