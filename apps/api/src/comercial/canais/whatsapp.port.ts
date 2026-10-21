import type { ComercialProvedorDeWhatsapp } from '@mktos/shared';

/*
 * A PORTA DO WHATSAPP DO COMERCIAL — Lane B (13/10/2026).
 *
 * Uma interface, três provedores (`WHATSAPP_PROVEDOR`, padrão `simulado`):
 *
 *   · `simulado` — nada sai da máquina. A mensagem fica em `ComercialMensagem`
 *     e a tela `/comercial/simulador` é o celular do lead e o da mesa;
 *   · `evolution` — a Evolution (Produção 21, P8). O provedor traduz e chama a
 *     classe da empresa do conector (`pauta/evolution.service.ts`) pela porta
 *     `ENVIO_PELA_EVOLUTION`; credencial no cofre da empresa, com a reserva de
 *     ambiente só da casa (ver `evolution.provider.ts`);
 *   · `meta` — a Cloud API oficial. Só a interface e o esqueleto documentado;
 *     sem credencial não sobe, e a credencial é decisão da mesa (K08-4);
 *
 * O provedor do DigiSac foi EXCLUÍDO em 21/10/2026 (rodada dos agentes, A6):
 * o valor antigo é recusado no arranque, com a frase de `PROVEDOR_EXCLUIDO`.
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

/**
 * O valor de `WHATSAPP_PROVEDOR` que deixou de existir e a frase do arranque.
 *
 * O DigiSac foi excluído do código em 21/10/2026. Um `.env` antigo com esse
 * valor NÃO cai calado no simulado: a API recusa subir dizendo o que trocar,
 * porque cair no simulado faria a mesa achar que a mensagem saiu. É o único
 * lugar do código, fora do cadastro de funções, que ainda escreve o nome (a
 * catraca `sem-digisac.test.ts` aceita este arquivo e nenhum outro de código).
 */
const PROVEDOR_EXCLUIDO = 'digisac';
export const RECUSA_DO_PROVEDOR_EXCLUIDO =
  'O DigiSac foi excluído em 21/10/2026: use WHATSAPP_PROVEDOR=evolution ou simulado ' +
  '(o valor WHATSAPP_PROVEDOR=digisac não é mais aceito e a API não sobe com ele).';

export class ProvedorExcluidoError extends Error {
  constructor() {
    super(RECUSA_DO_PROVEDOR_EXCLUIDO);
    this.name = 'ProvedorExcluidoError';
  }
}

export function provedorDoAmbiente(valor = process.env.WHATSAPP_PROVEDOR): ComercialProvedorDeWhatsapp {
  const v = String(valor ?? '').trim().toLowerCase();
  if (v === PROVEDOR_EXCLUIDO) throw new ProvedorExcluidoError();
  if (v === 'evolution' || v === 'meta') return v;
  return 'simulado';
}

export class ProvedorIndisponivelError extends Error {}
