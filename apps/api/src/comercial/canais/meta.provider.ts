import type { BotaoInterativo, EnvioFeito, FormularioInterativo, WhatsappPort } from './whatsapp.port';
import { ProvedorIndisponivelError } from './whatsapp.port';

/*
 * O PROVEDOR DA CLOUD API DA META — ESQUELETO, sem chamada e sem credencial.
 *
 * FORA DO ARRANQUE desde a Produção 22 (M4): `WHATSAPP_PROVEDOR=meta` derruba a
 * API com a frase de `RECUSA_DO_PROVEDOR_META` (`whatsapp.port.ts`), e nada
 * instancia esta classe. O arquivo fica como o mapa do que falta para o dia em
 * que a mesa decidir a Cloud API (K08-4).
 *
 * A C08 recomenda a Cloud API para o 1:1 com o lead (proposta, follow-up,
 * assinatura) e deixa o custo por conversa para a mesa levantar e decidir
 * (K08-4). Até a decisão, este arquivo é o mapa do que falta: nenhum endereço é
 * chamado e nenhuma variável é lida.
 *
 * O QUE CADA MÉTODO VAI SER (Graph API, versão a fixar na decisão):
 *
 *   · enviarTexto       POST /{phone-number-id}/messages com
 *                       { messaging_product: 'whatsapp', to, type: 'text', text: { body } }.
 *                       Fora da janela de 24 h só sai TEMPLATE aprovado pela Meta
 *                       (type: 'template'): os oito textos da C08 viram templates.
 *   · enviarFormulario  POST /{phone-number-id}/messages, type 'interactive',
 *                       interactive.type 'flow' (WhatsApp Flows). O Flow nasce em
 *                       POST /{waba-id}/flows e é publicado em POST /{flow-id}/publish;
 *                       a resposta chega no webhook em
 *                       `interactive.nfm_reply.response_json`.
 *   · enviarBotoes      type 'interactive', interactive.type 'button' (até 3
 *                       botões de resposta); o toque chega como `button_reply.id`.
 *   · criarGrupo        a Cloud API não cria grupo de conversa: grupo fica com a
 *                       Evolution (C08).
 *   · enviarNoGrupo     idem.
 *
 * A ENTRADA (webhook): GET de verificação com `hub.verify_token`, e POST com a
 * assinatura `X-Hub-Signature-256` (HMAC-SHA256 do corpo com o app secret),
 * conferida ANTES de ler o corpo. `entry[].changes[].value.messages[]` vira o
 * `EventoDeEntrada` da porta; `statuses[]` (entregue, lida) não é mensagem.
 *
 * CREDENCIAL: token do sistema, phone-number-id, waba-id e app secret moram no
 * COFRE da empresa, num conector próprio (como o YouTube), nunca em variável
 * lida aqui. O conector novo é quem fala com a Graph; este provedor o recebe
 * por injeção, e o envio continua sendo o efeito da porta.
 */
export const META_PENDENTE = 'Cloud API da Meta não configurada: [a decidir] pela mesa (K08-4).';

export class MetaProvider implements WhatsappPort {
  readonly provedor = 'meta' as const;
  readonly configured = false;

  async enviarTexto(_destino: string, _texto: string): Promise<EnvioFeito> {
    throw new ProvedorIndisponivelError(META_PENDENTE);
  }

  async enviarFormulario(_destino: string, _texto: string, _formulario: FormularioInterativo): Promise<EnvioFeito> {
    throw new ProvedorIndisponivelError(META_PENDENTE);
  }

  async enviarBotoes(_destino: string, _texto: string, _botoes: BotaoInterativo[]): Promise<EnvioFeito> {
    throw new ProvedorIndisponivelError(META_PENDENTE);
  }

  async criarGrupo(_nome: string, _participantes: string[]): Promise<{ jid: string }> {
    throw new ProvedorIndisponivelError(META_PENDENTE);
  }

  async enviarNoGrupo(_jid: string, _texto: string): Promise<EnvioFeito> {
    throw new ProvedorIndisponivelError(META_PENDENTE);
  }
}
