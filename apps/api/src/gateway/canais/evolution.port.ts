/*
 * AS DUAS PORTAS DA EVOLUTION DO COMERCIAL (Rodada de produção 1, 21/10/2026, P8).
 *
 * Quem fala HTTP com a Evolution é `pauta/evolution.service.ts`, e mais
 * ninguém: é o arquivo que a catraca de arquitetura conhece como o conector da
 * Evolution (CONECTORES) e o único que pode ler `EVOLUTION_*` (CREDENCIAIS). A
 * classe da empresa (`EvolutionDaEmpresaService`) mora lá, ao lado da do canal
 * de aprovação, e é provida por `canais.module.ts` (a pasta da porta pode
 * importar conector). Este arquivo só declara o que ela oferece, em DUAS portas:
 *
 *   · `ENVIO_PELA_EVOLUTION` manda texto a um número, cria o grupo do cliente e
 *     manda texto no grupo. Só o provedor do comercial
 *     (`comercial/canais/evolution.provider.ts`) a usa, e o provedor só é
 *     chamado pelo EFEITO de `comercial.whatsapp.enviar` (R3), que a porta
 *     dispara depois da assinatura de outra pessoa. A suíte
 *     `comercial-canal-evolution.test.ts` confere que nenhum outro arquivo de
 *     `src/` chama os métodos de envio.
 *   · `ADMINISTRACAO_DA_EVOLUTION` é o resto: o estado do cartão, guardar a
 *     credencial no cofre, sondar a instância, pedir o QR e responder qual
 *     instância a empresa usa. Nada disso manda mensagem a ninguém.
 *
 * O comercial importa daqui só os símbolos e os tipos, nunca o conector.
 */
import type { ConexaoDaEvolution, EstadoDaEvolution, QrDaEvolution } from '@mktos/shared';

export type { ConexaoDaEvolution, EstadoDaEvolution, OrigemDaCredencialEvolution, QrDaEvolution } from '@mktos/shared';

export interface CredencialDaEvolutionParaGuardar {
  url: string;
  chave?: string;
  instancia: string;
}

export interface EnvioPelaEvolution {
  /** Texto a um número (conversa individual), pela instância desta empresa. */
  enviarAoNumero(orgId: string, numero: string, texto: string): Promise<{ id: string }>;
  /** Cria o grupo do cliente e devolve o JID dele (termina em `@g.us`). */
  abrirGrupo(orgId: string, nome: string, numeros: string[], descricao?: string): Promise<{ jid: string }>;
  /** Texto num grupo que a instância desta empresa criou. */
  enviarAoGrupo(orgId: string, jidDoGrupo: string, texto: string): Promise<{ id: string }>;
}

/** O que o conector sabe da conexão; o provedor do comercial quem soma é a rota (ver `evolution.controller.ts`). */
export type ConexaoDoConectorEvolution = Omit<ConexaoDaEvolution, 'provedorDoComercial'>;

export interface AdministracaoDaEvolution {
  conexao(orgId: string): Promise<ConexaoDoConectorEvolution>;
  guardarCredencial(orgId: string, entrada: CredencialDaEvolutionParaGuardar, actorId: string | null): Promise<ConexaoDoConectorEvolution>;
  estadoDaInstancia(orgId: string): Promise<EstadoDaEvolution>;
  /** Pede o QR à Evolution (`instance/connect`). Instância já aberta não ganha QR. */
  gerarQr(orgId: string, actorId: string | null): Promise<QrDaEvolution>;
  /** O conector está ligado nesta empresa? */
  ligado(orgId: string): Promise<boolean>;
  /** A instância que esta empresa usa (para a entrada ignorar mensagem de outra instância). */
  instanciaDaEmpresa(orgId: string): Promise<string | null>;
}

/*
 * AS DUAS PORTAS DA CAIXA DE WHATSAPP (rodada de produção 4, 22/10/2026, W1 e W2).
 *
 *   · `LEITURA_DA_EVOLUTION` só LÊ o que a Evolution guarda (chats, grupos com os
 *     participantes, mensagens, foto). É a sincronização (`whatsapp.sincronizar`)
 *     que a usa: nada sai do número por ela. Devolve o corpo CRU da Evolution; quem
 *     interpreta é `whatsapp/leitura-da-evolution.ts`, a mesma regra do webhook.
 *   · `RESPOSTA_DE_GENTE_PELA_EVOLUTION` manda o texto que uma PESSOA digitou na
 *     caixa (`/whatsapp`), 1:1 ou grupo. Não é envio de agente: quem chama é só o
 *     serviço da caixa, depois de conferir a permissão `whatsapp.conversar` e que
 *     o pedido veio de gente (catraca em `whatsapp-caixa.test.ts`). As mensagens
 *     de agente (M1 a M8, pauta, aprovação) continuam pela porta de envio abaixo,
 *     atrás da régua.
 */
export interface LeituraDaEvolution {
  /** `POST /chat/findChats/<instância>`: os chats que a Evolution guarda (cru). */
  conversas(orgId: string): Promise<unknown[]>;
  /** `GET /group/fetchAllGroups/<instância>?getParticipants=true` (cru). */
  grupos(orgId: string): Promise<unknown[]>;
  /**
   * `POST /chat/findMessages/<instância>` de UMA conversa, uma página (a 1 é a
   * mais nova). `registros` cru; `paginas` = quantas páginas a Evolution diz ter.
   */
  mensagens(orgId: string, remoteJid: string, pagina: number, porPagina: number): Promise<{ registros: unknown[]; paginas: number }>;
  /** `POST /chat/fetchProfilePictureUrl/<instância>`: a URL da foto, ou null. */
  foto(orgId: string, jid: string): Promise<string | null>;
  /** A instância que esta empresa usa (a prova de empresa do que chega). */
  instanciaDaEmpresa(orgId: string): Promise<string | null>;
  /** O conector está ligado nesta empresa? */
  ligado(orgId: string): Promise<boolean>;
}

export interface RespostaDeGentePelaEvolution {
  /**
   * O texto que uma PESSOA digitou na caixa, para a conversa `chatJid` (1:1
   * `…@s.whatsapp.net`/`…@lid` ou grupo `…@g.us`), pela instância desta empresa.
   * Conector desligado ou não configurado lança, com a frase.
   */
  responderComoPessoa(orgId: string, chatJid: string, texto: string): Promise<{ id: string }>;
}

/*
 * Layout 27/10 (Lucas: "não consigo nem abrir, nem enviar documentos pelo wpp do OS").
 * A TERCEIRA PORTA DA CAIXA, `MIDIA_DA_CAIXA_PELA_EVOLUTION`: o arquivo de uma
 * mensagem (baixar, para abrir na caixa) e o arquivo que uma PESSOA manda pela
 * caixa. Como a resposta de texto, quem chama é só o serviço da caixa, depois
 * da permissão (`leads.ver` para abrir; `whatsapp.conversar` e gente para
 * mandar). Catraca em `whatsapp-midia.test.ts`.
 */

/** A `key` da mensagem na Evolution (a v2 acha a mensagem pelo `id`; o resto vai junto por garantia). */
export interface ChaveDaMensagemNaEvolution {
  id: string;
  remoteJid: string;
  fromMe: boolean;
  participant?: string | null;
}

export interface MidiaBaixadaDaEvolution {
  /** O arquivo em base64, como a Evolution devolve. */
  base64: string;
  mime: string | null;
  nome: string | null;
}

export interface MidiaParaEnviarPelaEvolution {
  tipo: 'image' | 'video' | 'audio' | 'document';
  mime: string;
  base64: string;
  nome: string;
  /** A legenda que sai (já com a assinatura); o áudio não leva. */
  legenda: string | null;
}

export interface MidiaDaCaixaPelaEvolution {
  /**
   * `POST /chat/getBase64FromMediaMessage/<instância>`: o arquivo de uma
   * mensagem. Passou de `teto` bytes, lança `CorpoAcimaDoTetoError`; a
   * Evolution que não acha mais a mídia responde fora do 2xx (`EvolutionRespondeuErro`).
   */
  baixarMidia(orgId: string, chave: ChaveDaMensagemNaEvolution, teto: number): Promise<MidiaBaixadaDaEvolution>;
  /**
   * O arquivo que uma PESSOA mandou pela caixa: `POST /message/sendMedia` (foto,
   * vídeo, documento) ou `POST /message/sendWhatsAppAudio` (áudio). Mesmo
   * destino e mesmas recusas de `responderComoPessoa`.
   */
  responderMidiaComoPessoa(orgId: string, chatJid: string, midia: MidiaParaEnviarPelaEvolution): Promise<{ id: string }>;
}

export const LEITURA_DA_EVOLUTION = Symbol('LEITURA_DA_EVOLUTION');
export const RESPOSTA_DE_GENTE_PELA_EVOLUTION = Symbol('RESPOSTA_DE_GENTE_PELA_EVOLUTION');
export const MIDIA_DA_CAIXA_PELA_EVOLUTION = Symbol('MIDIA_DA_CAIXA_PELA_EVOLUTION');

export const ENVIO_PELA_EVOLUTION = Symbol('ENVIO_PELA_EVOLUTION');
export const ADMINISTRACAO_DA_EVOLUTION = Symbol('ADMINISTRACAO_DA_EVOLUTION');

/** A chave do conector da empresa no contrato, no cofre e no catálogo. */
export const CONECTOR_EVOLUTION = 'evolution';

/** O prefixo do "jid" de grupo que a Evolution do comercial criou (o resto é o JID `@g.us`). */
export const PREFIXO_DO_GRUPO_EVOLUTION = 'evolution:';

/**
 * A voz do AGENTE DE TAREFAS (TR-12) no grupo da equipe. Não é o envio do
 * comercial (`ENVIO_PELA_EVOLUTION`, R3) nem a resposta de gente da caixa: só
 * manda texto para o grupo de `AGENTE_TAREFAS_JID`, e qualquer outro destino
 * é recusado na própria porta. `mencoes` são telefones (só dígitos) marcados
 * com @ no texto; o WhatsApp notifica cada um mesmo com o grupo silenciado.
 */
export interface MensagemDoAgenteNoGrupo {
  falarNoGrupoDoAgente(orgId: string, texto: string, mencoes?: string[]): Promise<{ id: string }>;
}

export const MENSAGEM_DO_AGENTE_NO_GRUPO = Symbol('MENSAGEM_DO_AGENTE_NO_GRUPO');
