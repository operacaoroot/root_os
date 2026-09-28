/*
 * O RETORNO DO OAUTH DO YOUTUBE, como o controlador o recebe (MD10).
 *
 * O controlador da conexão não importa o conector (a catraca "conector só pela
 * porta" proíbe controller da pasta de importar o serviço, e uma exceção nova
 * seria dívida nova). Recebe só isto, por injeção, montado em
 * `youtube.module.ts`: concluir a autorização é o consentimento de uma pessoa
 * na tela do Google, não ação sobre o mundo — não há o que reter, e a porta
 * não entra. Conectar e revogar passam pelo contrato de conector
 * (`/integrations/youtube/autorizacao` e `/revogacao`), como os outros.
 */

export const CONEXAO_DO_YOUTUBE = Symbol('CONEXAO_DO_YOUTUBE');

export interface ConexaoDoYoutube {
  /** Confere o `state` antes do banco, guarda o refresh token no cofre e devolve para onde o navegador volta. */
  concluirAutorizacao(estado: string, codigo: string | undefined, erro: string | undefined): Promise<string>;
}
