/*
 * A IMPLANTAÇÃO DE CLIENTES NUMA TELA SÓ (rodada do trabalho T1, 19/10/2026).
 *
 * O item de menu "Implantação de clientes" abre o kanban denso da lista
 * "Onboarding de cliente" da pasta "Clientes", que é a da estrutura sugerida do
 * Trabalho e onde o fechamento comercial abre o card (sexta escrita). A tela, a
 * API (que recusa criar cartão solto nessa lista) e o card do fechamento acham
 * a MESMA lista pela mesma regra: pelo nome, sem diferença de maiúscula nem de
 * espaço, como a estrutura sugerida faz.
 */

export const LISTA_DA_IMPLANTACAO = 'Onboarding de cliente';
export const PASTA_DA_IMPLANTACAO = 'Clientes';

/** O nome comparável de pasta e lista (o mesmo critério da estrutura sugerida). */
export function chaveDoNomeDoTrabalho(nome: string): string {
  return nome.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
}

interface PastaComListas {
  id: string;
  name: string;
  parentId?: string | null;
  lists: { id: string; name: string }[];
}

/** A lista da implantação dentro da árvore do Trabalho, ou nulo quando ainda não existe. */
export function listaDaImplantacao(pastas: readonly PastaComListas[]): { pastaId: string; listaId: string } | null {
  const pasta = pastas.find((p) => !p.parentId && chaveDoNomeDoTrabalho(p.name) === chaveDoNomeDoTrabalho(PASTA_DA_IMPLANTACAO));
  if (!pasta) return null;
  const lista = pasta.lists.find((l) => chaveDoNomeDoTrabalho(l.name) === chaveDoNomeDoTrabalho(LISTA_DA_IMPLANTACAO));
  return lista ? { pastaId: pasta.id, listaId: lista.id } : null;
}

/** A frase de quem tenta abrir cartão solto na implantação: a porta é o comercial. */
export const PORTA_DA_IMPLANTACAO =
  'O cliente entra na implantação pelo contrato assinado no comercial. Quem fechou fora do sistema entra por "Registrar cliente já fechado", no Funil vivo.';
