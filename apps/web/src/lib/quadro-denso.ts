/*
 * O QUADRO DENSO DO TRABALHO (rodada da implantação I2, 18/10/2026) — as regras
 * que a tela usa, fora do componente para o teste alcançar.
 *
 * O pedido do Rodrigo: "caber mais status na tela; diminuir as tasks; clicar em
 * qualquer parte da tarefa para abrir; acessar a última movimentação ou o
 * último comentário sem nem clicar na task; rolar a tela de cada status
 * separadamente". Vale para a visão Quadro do Trabalho inteira; a Implantação é
 * o caso de prova.
 */

export type Densidade = 'compacto' | 'medio' | 'cheio';
export const DENSIDADES: readonly { chave: Densidade; rotulo: string }[] = [
  { chave: 'compacto', rotulo: 'compacto' },
  { chave: 'medio', rotulo: 'médio' },
  { chave: 'cheio', rotulo: 'cheio' },
];
export const CHAVE_DA_DENSIDADE = 'root-os:trabalho:densidade';
export const DENSIDADE_PADRAO: Densidade = 'compacto';

export function lerDensidade(valor: string | null | undefined): Densidade {
  return valor === 'compacto' || valor === 'medio' || valor === 'cheio' ? valor : DENSIDADE_PADRAO;
}

/**
 * A largura mínima da coluna por densidade. Medido na homologação a 1440 px, com
 * o menu do OS e a árvore de listas abertos, o quadro tem 916 px: no compacto,
 * 7 × 120 + 6 vãos de 8 = 888 cabem sem rolar (o nome longo vira reticências e
 * o balão mostra o resto). Médio e cheio rolam na horizontal, de propósito.
 */
export const LARGURA_MINIMA_DA_COLUNA: Record<Densidade, number> = { compacto: 120, medio: 168, cheio: 220 };

export type Escopo = 'todos' | 'meus' | 'atrasados';
export const ESCOPOS: readonly { chave: Escopo; rotulo: string }[] = [
  { chave: 'todos', rotulo: 'todos' },
  { chave: 'meus', rotulo: 'meus' },
  { chave: 'atrasados', rotulo: 'atrasados' },
];
export function lerEscopo(valor: string | null | undefined): Escopo {
  return valor === 'meus' || valor === 'atrasados' ? valor : 'todos';
}

const normal = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');

/**
 * "Meus": o responsável (texto livre herdado do ClickUp) é a pessoa logada.
 * Casa o nome inteiro, ou o primeiro nome quando o responsável foi escrito só
 * com ele ("Pedro" para "Pedro Magnago"). Sem nome na sessão, nada é "meu".
 */
export function ehMeu(assignee: string | null | undefined, nome: string | null | undefined): boolean {
  if (!assignee || !nome) return false;
  const a = normal(assignee);
  const n = normal(nome);
  if (!a || !n) return false;
  return a === n || (!a.includes(' ') && a === n.split(' ')[0]);
}

/** Dias na etapa acima disto ficam em magenta (o mockup aprovado: "> 5 dias"). */
export const DIAS_DE_ALERTA_NA_ETAPA = 5;

/** "agora", "5min", "2h", "1d", "3sem": o rodapé mono do cartão. */
export function haCurto(iso: string, agora: Date = new Date()): string {
  const ms = agora.getTime() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (!Number.isFinite(min) || min < 1) return 'agora';
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 14) return `há ${d}d`;
  return `há ${Math.floor(d / 7)}sem`;
}

/**
 * Onde o balão aparece: ao lado do cartão, do lado que tem espaço, sem sair da
 * tela. Recebe o retângulo do cartão e o tamanho da janela; devolve o canto
 * superior esquerdo em coordenadas da janela (o balão é `position: fixed`).
 */
export function posicaoDoBalao(
  cartao: { top: number; left: number; right: number; bottom: number },
  janela: { largura: number; altura: number },
  balao: { largura: number; altura: number },
  m = 8,
): { top: number; left: number } {
  const entre = (v: number, min: number, max: number) => Math.max(min, Math.min(v, Math.max(min, max)));
  const cabeDireita = cartao.right + m + balao.largura <= janela.largura - m;
  const cabeEsquerda = cartao.left - m - balao.largura >= m;
  if (cabeDireita || cabeEsquerda) {
    return {
      left: Math.round(cabeDireita ? cartao.right + m : cartao.left - m - balao.largura),
      top: Math.round(entre(cartao.top, m, janela.altura - m - balao.altura)),
    };
  }
  // Sem espaço dos lados (celular): embaixo do cartão, ou em cima se embaixo não couber.
  const embaixo = cartao.bottom + m;
  const top = embaixo + balao.altura <= janela.altura - m ? embaixo : cartao.top - m - balao.altura;
  return {
    left: Math.round(entre(cartao.left, m, janela.largura - m - balao.largura)),
    top: Math.round(entre(top, m, janela.altura - m - balao.altura)),
  };
}
