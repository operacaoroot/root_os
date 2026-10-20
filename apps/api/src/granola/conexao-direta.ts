import type { TrabGranolaConexaoDireta } from '@mktos/shared';
import type {
  ContextoDoVerbo,
  ResultadoDeAutorizacao,
  ResultadoDeRevogacao,
  ResultadoDeSincronizacao,
  SaudeDeConector,
} from '../integrations/contrato-de-conector';

/*
 * A CONEXÃO DIRETA DO GRANOLA, como quem não é o conector a recebe
 * (rodada da interface, 20/10/2026).
 *
 * Dois consumidores, e nenhum importa o conector (a catraca "conector só pela
 * porta" proíbe controller e serviço de fora da pasta de importar o serviço):
 *   · o retorno do OAuth (`granola-direto.controller.ts`), que só conclui a
 *     autorização: o consentimento é da pessoa, na tela do Granola, e não é
 *     ação sobre o mundo;
 *   · o descritor do Granola no contrato de conectores, que mora no serviço do
 *     Zap (`ficha/granola.service.ts`, uma inscrição só por chave) e soma o modo
 *     direto aos quatro verbos.
 * O módulo `granola/granola.module.ts` entrega a implementação por este token.
 */

export const CONEXAO_DIRETA_DO_GRANOLA = Symbol('CONEXAO_DIRETA_DO_GRANOLA');

export interface ConexaoDiretaDoGranola {
  estado(orgId: string): Promise<TrabGranolaConexaoDireta>;
  autorizar(ctx: ContextoDoVerbo): Promise<ResultadoDeAutorizacao>;
  /** Confere o `state` antes do banco, guarda o token no cofre e devolve para onde o navegador volta. */
  concluirAutorizacao(estado: string, codigo: string | undefined, erro: string | undefined): Promise<string>;
  sincronizar(ctx: ContextoDoVerbo): Promise<ResultadoDeSincronizacao>;
  saude(ctx: ContextoDoVerbo): Promise<SaudeDeConector>;
  /** Queima a autorização direta desta empresa (o token, o registro do cliente e o verificador pendente). */
  revogar(ctx: ContextoDoVerbo & { motivo?: string | null }): Promise<ResultadoDeRevogacao>;
}
