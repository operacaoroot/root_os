import type { BioFinalidade } from '@mktos/shared';
import { INSTAGRAM_ESCOPO_DE_PUBLICAR } from '@mktos/shared';

/**
 * Com que finalidade a conexão fica gravada depois do callback (MD5).
 *
 * `publicacao` exige as duas coisas: alguém quis publicar com esta conta (pediu
 * agora, ou ela já era a de publicação) E a Meta concedeu o escopo de publicar.
 * Concedidos desconhecidos (`null`) não contam como concedido: sem a prova, a
 * conta fica como da bio e a tela avisa.
 *
 * O caso que o "já era" cobre: a conta de publicação reconectada pela bio, que
 * pede só leitura. Se a Meta devolver o escopo de publicar de novo, ela segue de
 * publicação; se não devolver, o token novo não publica e a conexão cai para
 * `bio`, em vez de parecer apta e falhar na hora do post.
 */
export function finalidadeDaConexao(entrada: {
  pedida: BioFinalidade;
  anterior: BioFinalidade | null;
  concedidos: readonly string[] | null;
}): { finalidade: BioFinalidade; aviso: 'publicacao_sem_escopo' | 'publicacao_mantida' | null } {
  const podePublicar = entrada.concedidos?.includes(INSTAGRAM_ESCOPO_DE_PUBLICAR) ?? false;
  const querPublicar = entrada.pedida === 'publicacao' || entrada.anterior === 'publicacao';
  if (querPublicar && podePublicar) return { finalidade: 'publicacao', aviso: null };
  if (entrada.pedida === 'publicacao') return { finalidade: 'bio', aviso: 'publicacao_sem_escopo' };
  /*
   * A conta de publicação reconectada pela bio, sem publicar: NÃO é rebaixada
   * nem tem o token trocado. Rebaixar seria desconectar a conta de publicação
   * por quem só tem `bio.editar`, contornando o `pauta.publicar` que o
   * desconectar exige. Quem chama não grava nada e volta com o aviso.
   */
  if (entrada.anterior === 'publicacao') return { finalidade: 'publicacao', aviso: 'publicacao_mantida' };
  return { finalidade: 'bio', aviso: null };
}

/** O `state` que a rota gera tem 32 caracteres base64url; fora disso nem se consulta o banco. */
export function estadoBemFormado(estado: unknown): estado is string {
  return typeof estado === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(estado);
}
