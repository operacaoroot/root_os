import { ConflictException } from '@nestjs/common';

/*
 * UMA GERAÇÃO LONGA DE CADA VEZ (MC-R).
 *
 * As gerações da máquina de conteúdo são síncronas e duram minutos (uma chamada
 * de modelo por matéria, runs do Apify de até dois minutos). Se o proxy da
 * frente, a rede do celular ou a pessoa desistir no meio, o Nest continua o
 * handler até o fim — e o segundo clique pagaria a IA ou o Apify de novo por
 * cima do primeiro. A chave vale ANTES de qualquer gasto: o segundo pedido da
 * mesma coisa recebe 409 na hora.
 *
 * É memória do processo, e basta porque a API roda num container só. Mais de
 * uma réplica pediria o mesmo freio no banco (advisory lock de sessão).
 */
const emAndamento = new Set<string>();

export const MSG_EM_ANDAMENTO = 'já está em andamento — espere terminar e recarregue a tela.';

export async function umaPorVez<T>(chave: string, oQue: string, fn: () => Promise<T>): Promise<T> {
  if (emAndamento.has(chave)) throw new ConflictException(`${oQue} ${MSG_EM_ANDAMENTO}`);
  emAndamento.add(chave);
  try {
    return await fn();
  } finally {
    emAndamento.delete(chave);
  }
}
