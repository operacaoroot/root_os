import { moduloDaRotaDoWeb } from '@mktos/shared';

/*
 * Para onde o login manda (versão final, 19/10/2026; revisão final, achado 2.1).
 *
 * A entrada nova é a da primeira área do menu, Dia a dia › Visão geral, que é do
 * módulo `trabalho`. Ela só vale para quem tem `tarefas.ver` E o módulo contratado:
 * empresa cliente sem o módulo cairia em "Módulo não contratado". Sem saber os
 * módulos (resposta ainda não chegou ou falhou), não arrisca: vale a regra que a
 * produção tinha antes (Contexto, Marca ou o Painel geral da empresa).
 * Fora de `page.tsx` porque a página do App Router não pode exportar nada além do componente.
 */
export const ENTRADA_DO_DIA_A_DIA = '/dia-a-dia';

/** A regra da produção (`lucas/tarefas`), sem o Dia a dia. */
export function destinoDaProducao(permissoes: readonly string[]): string {
  return permissoes.includes('obsidian.ver') ? '/contexto' : permissoes.includes('pauta.ver') ? '/contexto/marca' : '/painel';
}

export function destinoDepoisDoLogin(permissoes: readonly string[], modulos: readonly string[] | null): string {
  const modulo = moduloDaRotaDoWeb(ENTRADA_DO_DIA_A_DIA);
  const contratado = modulos !== null && (!modulo || modulos.includes(modulo));
  return permissoes.includes('tarefas.ver') && contratado ? ENTRADA_DO_DIA_A_DIA : destinoDaProducao(permissoes);
}
