import type { ComercialProvedorDeWhatsapp } from '@mktos/shared';

/*
 * A PORTA DO WHATSAPP DO COMERCIAL — Lane B (13/10/2026).
 *
 * Uma interface, três provedores (`WHATSAPP_PROVEDOR`, padrão `simulado`):
 *
 *   · `simulado` — nada sai da máquina. A mensagem fica em `ComercialMensagem`
 *     e a tela `/comercial/simulador` é o celular do lead e o da mesa;
 *   · `evolution` — a Evolution da Root. A catraca de arquitetura proíbe
 *     entregar pelo transporte do canal fora de `src/gateway/canais/`, e esta
 *     pasta não é conector: o provedor existe, diz que está pendente e por quê
 *     (ver `evolution.provider.ts`);
 *   · `meta` — a Cloud API oficial. Só a interface e o esqueleto documentado;
 *     sem credencial não sobe, e a credencial é decisão da mesa (K08-4);
 *   · `digisac` — o DigiSac (Interface 20/10, U6). O provedor traduz e chama o
 *     conector de `gateway/canais/digisac.conector.ts` pela porta
 *     `ENVIO_PELO_DIGISAC`; credencial no cofre da empresa (ver `digisac.provider.ts`).
 *
 * QUEM CHAMA ESTA PORTA. Só o EFEITO de `comercial.whatsapp.enviar`, que a
 * `PortaDoOperador` dispara depois de a régua deixar (R3: com a assinatura de
 * outra pessoa). Nenhuma rota chama o provedor direto.
 */

export interface FormularioInterativo {
  id: string;
  titulo: string;
  campos: readonly { chave: string; rotulo: string; tipo: string }[];
}

export interface BotaoInterativo {
  /** O que volta quando o lead toca (o horário em ISO, a chave da decisão). */
  chave: string;
  rotulo: string;
}

/** O que o simulador e o provedor oficial renderizam além do texto. */
export interface Interativo {
  formulario?: FormularioInterativo;
  botoes?: BotaoInterativo[];
}

export interface EnvioFeito {
  /** O id da mensagem no provedor (no simulado, o id da linha). */
  mensagemExternaId: string;
  provedor: ComercialProvedorDeWhatsapp;
}

export interface WhatsappPort {
  readonly provedor: ComercialProvedorDeWhatsapp;
  /** Há como entregar? `false` = toda chamada lança com o motivo. */
  readonly configured: boolean;
  enviarTexto(destino: string, texto: string): Promise<EnvioFeito>;
  enviarFormulario(destino: string, texto: string, formulario: FormularioInterativo): Promise<EnvioFeito>;
  enviarBotoes(destino: string, texto: string, botoes: BotaoInterativo[]): Promise<EnvioFeito>;
  criarGrupo(nome: string, participantes: string[]): Promise<{ jid: string }>;
  enviarNoGrupo(jid: string, texto: string): Promise<EnvioFeito>;
}

/** O que chega de fora: o lead escreveu, respondeu o formulário ou tocou num botão. */
export interface EventoDeEntrada {
  telefone: string;
  texto: string;
  mensagemId: string | null;
  interativo?: { formulario?: Record<string, unknown>; botao?: string } | null;
}

/**
 * A entrada: cada provedor traduz o corpo do seu webhook (ou, no simulado, o
 * que a tela "digitou") para o mesmo evento. Devolve `null` para o que não é
 * mensagem de lead (status de entrega, mensagem própria, grupo).
 */
export interface EntradaDeWhatsapp {
  receber(corpo: unknown): EventoDeEntrada | null;
}

/** Token de injeção do provedor escolhido. */
export const WHATSAPP_PORT = Symbol('WHATSAPP_PORT');

export function provedorDoAmbiente(valor = process.env.WHATSAPP_PROVEDOR): ComercialProvedorDeWhatsapp {
  const v = String(valor ?? '').trim().toLowerCase();
  if (v === 'evolution' || v === 'meta' || v === 'digisac') return v;
  return 'simulado';
}

export class ProvedorIndisponivelError extends Error {}
