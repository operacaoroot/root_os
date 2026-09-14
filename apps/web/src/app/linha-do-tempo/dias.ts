import type { LinhaDoTempoItem } from '@mktos/shared';

/* ========================================================================== *
 * O AGRUPAMENTO POR DIA — e por que ele mora no navegador
 * ========================================================================== *
 *
 * "Hoje" depende do fuso de quem olha. A API roda em UTC no container e devolve
 * a lista ORDENADA, sem cabeçalho de dia; quem decide em que dia cada evento
 * caiu é este arquivo, no fuso do navegador. Agrupar no servidor faria um evento
 * das 21h de Brasília aparecer sob o cabeçalho do dia seguinte — e o cabeçalho
 * de dia é justamente o que separa esta tela de `/rastro`.
 *
 * PURO E SEPARADO DA TELA de propósito: a aritmética de data é o tipo de coisa
 * que só quebra na virada do dia, no fim do mês e no horário de verão, e um caso
 * de teste que precise montar React para medir isso não vai existir.
 */

export interface DiaDaLinha {
  /** `AAAA-MM-DD` no fuso local. É a chave de agrupamento, não texto de tela. */
  chave: string;
  /** O que a pessoa lê: "hoje", "ontem" ou a data completa em português. */
  rotulo: string;
  itens: LinhaDoTempoItem[];
}

/** `AAAA-MM-DD` no fuso LOCAL — nunca `toISOString`, que converte para UTC. */
export function chaveDoDia(quando: Date): string {
  const mes = String(quando.getMonth() + 1).padStart(2, '0');
  const dia = String(quando.getDate()).padStart(2, '0');
  return `${quando.getFullYear()}-${mes}-${dia}`;
}

/**
 * O rótulo do dia. "hoje" e "ontem" existem porque são a leitura que a pessoa
 * faz primeiro; a data completa entra para todo o resto, com o dia da semana,
 * que é o que ancora a memória de quem procura ("foi na terça").
 *
 * `agora` é PARÂMETRO e não `new Date()` por dentro: relógio implícito é a razão
 * pela qual a suíte de Conexões está vermelha nesta árvore — um fixture com data
 * fixa que envelheceu. Aqui o teste passa o instante.
 */
export function rotuloDoDia(chave: string, agora: Date): string {
  const hoje = chaveDoDia(agora);
  const ontem = chaveDoDia(new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - 1));
  if (chave === hoje) return 'hoje';
  if (chave === ontem) return 'ontem';
  const [a, m, d] = chave.split('-').map(Number);
  return new Date(a, m - 1, d).toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Agrupa preservando a ORDEM RECEBIDA — a da cadeia do rastro, do mais recente
 * para o mais antigo. Não reordena nada: reordenar por data aqui seria discordar
 * de `seq`, e `seq` é a ordem em que os fatos foram gravados. Quando as duas
 * discordam (relógio do servidor mexido), a cadeia é quem tem razão.
 *
 * Dia repetido depois de um intervalo NÃO vira dois cabeçalhos: o agrupamento é
 * por chave, não por vizinhança. Com a lista sempre ordenada dá no mesmo; o
 * dia em que não estiver, a tela mostra um dia uma vez, que é o que ela promete.
 */
export function agruparPorDia(itens: LinhaDoTempoItem[], agora: Date): DiaDaLinha[] {
  const porChave = new Map<string, LinhaDoTempoItem[]>();
  const ordem: string[] = [];
  for (const item of itens) {
    const chave = chaveDoDia(new Date(item.ocorreuEm));
    if (!porChave.has(chave)) {
      porChave.set(chave, []);
      ordem.push(chave);
    }
    porChave.get(chave)!.push(item);
  }
  return ordem.map((chave) => ({
    chave,
    rotulo: rotuloDoDia(chave, agora),
    itens: porChave.get(chave)!,
  }));
}

/**
 * Quem fez, em uma frase. TRÊS casos, e o terceiro é o que costuma virar
 * mentira:
 *
 *  1. pessoa desta empresa -> o nome dela;
 *  2. IA ou sistema -> "um agente" / "o sistema" (com o nome do agente quando
 *     ele existe, resolvido do lado da API dentro da empresa);
 *  3. `atorTipo: 'user'` com id preenchido e nome NULO -> o ponteiro não resolve
 *     em gente desta empresa. Diz isso, em vez de inventar nome ou de esconder
 *     a linha. Mesma regra de `agents/donos-da-casa.ts`.
 */
export function atorLegivel(item: LinhaDoTempoItem): string {
  if (item.atorTipo === 'user') {
    if (item.ator) return item.ator;
    if (item.atorId) return 'alguém de fora desta empresa';
    return 'uma pessoa';
  }
  const agente = item.agenteNome ?? item.agenteSlug;
  if (item.atorTipo === 'ai') return agente ? `agente ${agente}` : 'a IA';
  return agente ? `o sistema (${agente})` : 'o sistema';
}
