/*
 * AS DUAS PORTAS DO DIGISAC (Interface 20/10, lane U6).
 *
 * Quem fala HTTP com o DigiSac é `digisac.conector.ts`, nesta pasta, e mais
 * ninguém. Este arquivo só declara o que o conector oferece, em DUAS portas
 * separadas, para que a pergunta "quem pode mandar WhatsApp pelo DigiSac?"
 * tenha uma resposta curta:
 *
 *   · `ENVIO_PELO_DIGISAC` manda mensagem e cria grupo. Só o provedor do
 *     comercial (`comercial/canais/digisac.provider.ts`) a usa, e o provedor
 *     só é chamado pelo EFEITO de `comercial.whatsapp.enviar` (R3), que a porta
 *     dispara depois da assinatura de outra pessoa. A suíte
 *     `comercial-canal-digisac.test.ts` confere que nenhum outro arquivo de
 *     `src/` chama os dois métodos de envio.
 *   · `ADMINISTRACAO_DO_DIGISAC` é o resto: o estado da conexão para a tela,
 *     guardar a credencial no cofre, listar as conexões da conta, conferir o
 *     segredo do webhook e ler o número de um contato. Nada disso manda
 *     mensagem a ninguém.
 *
 * O arquivo NÃO é o conector, de propósito: a catraca de arquitetura proíbe
 * importar conector fora de `src/gateway/`, e o comercial importa daqui só o
 * símbolo e o tipo. O conector é ligado às duas portas em `canais.module.ts`.
 */
import { DIGISAC_SEGREDO_MINIMO, type ConexaoDoDigisac, type ServicoDoDigisac } from '@mktos/shared';

export type { ConexaoDoDigisac, OrigemDaCredencialDigisac, ServicoDoDigisac } from '@mktos/shared';

/** O que o DigiSac diz de um contato. O número só sai daqui para a entrada. */
export interface ContatoDoDigisac {
  id: string;
  numero: string | null;
  grupo: boolean;
  servicoId: string | null;
}

export interface CredencialParaGuardar {
  url: string;
  token?: string;
  servicoId: string;
  segredoDoWebhook?: string;
}

export interface EnvioPeloDigisac {
  /** Manda texto a um número (contato novo ou não) pela conexão configurada. */
  enviarParaNumero(orgId: string, numero: string, texto: string): Promise<{ id: string }>;
  /** Manda texto a um contato que o DigiSac já conhece (o grupo do cliente, por exemplo). */
  enviarParaContato(orgId: string, contatoId: string, texto: string): Promise<{ id: string }>;
  /** Cria o grupo (contato com `isGroup`) e põe os participantes. */
  criarGrupo(orgId: string, nome: string, numeros: string[]): Promise<{ contatoId: string }>;
}

export interface AdministracaoDoDigisac {
  conexao(orgId: string): Promise<ConexaoDoDigisac>;
  guardarCredencial(orgId: string, entrada: CredencialParaGuardar, actorId: string | null): Promise<ConexaoDoDigisac>;
  listarServicos(orgId: string): Promise<ServicoDoDigisac[]>;
  /** O segredo apresentado confere com o desta empresa? Sem segredo configurado, sempre `false`. */
  webhookAutentico(orgId: string, apresentado: string | null | undefined): Promise<boolean>;
  /** O conector está ligado nesta empresa? A recusa fica no RASTRO, como na porta. */
  ligado(orgId: string): Promise<boolean>;
  /** A conexão que esta empresa usa (para a entrada ignorar mensagem de outra conexão da conta). */
  servicoDaEmpresa(orgId: string): Promise<string | null>;
  buscarContato(orgId: string, contatoId: string): Promise<ContatoDoDigisac | null>;
}

export const ENVIO_PELO_DIGISAC = Symbol('ENVIO_PELO_DIGISAC');
export const ADMINISTRACAO_DO_DIGISAC = Symbol('ADMINISTRACAO_DO_DIGISAC');

/** A chave do conector no contrato, no cofre e no catálogo. */
export const CONECTOR_DIGISAC = 'digisac';

/** O nome do parâmetro e do cabeçalho do segredo da entrada. */
export const PARAMETRO_DO_SEGREDO_DIGISAC = 'segredo';
export const CABECALHO_DO_SEGREDO_DIGISAC = 'x-digisac-segredo';

/** O caminho da entrada desta empresa (sem a origem). */
export const caminhoDoWebhookDigisac = (orgId: string) => `/api/comercial/webhooks/digisac/${orgId}`;

/** O tamanho mínimo do segredo do webhook (o mesmo piso dos segredos do canal). */
export const SEGREDO_MINIMO_DIGISAC = DIGISAC_SEGREDO_MINIMO;
