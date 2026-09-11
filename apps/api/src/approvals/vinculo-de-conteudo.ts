import { canonicalHash } from './approvals.service';

/*
 * ============================================================================
 * O VÍNCULO AO CONTEÚDO EXATO, CONFERIDO NA HORA DE DECIDIR (RF-A-06, RF-A-03)
 * ============================================================================
 *
 * Função pura. Compara o `contentHash` GRAVADO na aprovação com o hash dos
 * argumentos que estão HOJE em `ToolCall.args`.
 *
 * "OS BYTES QUE VÃO PARA O EFEITO" é uma afirmação, e ela só é verdadeira por
 * duas razões — as duas conquistadas na correção desta fatia:
 *
 *  1. QUEM CHAMA. A conferência mora em `AcoesService.executarAprovada`, sobre a
 *     MESMA variável que desce para `dispararAprovado`, imediatamente antes de a
 *     aprovação virar `consumida`. Enquanto ela morava nos chamadores (o
 *     controlador da fila e o canal de WhatsApp), havia uma janela entre
 *     conferir e ler — e o script de terminal não conferia nada.
 *  2. A FÓRMULA. `canonicalHash` serializava com a lista de chaves como FILTRO do
 *     `JSON.stringify`, e filtro assim se aplica em todos os níveis: objeto
 *     aninhado serializava VAZIO e dois conteúdos de miolo diferente davam o
 *     mesmo hash. Hoje ela usa `canonizar`, o JSON estável do RASTRO. Ver o
 *     comentário em `approvals.service.ts`.
 *
 * ----------------------------------------------------------------------------
 * O BURACO QUE ISTO FECHA — medido, não suposto
 * ----------------------------------------------------------------------------
 * A escada promete `vinculo: 'conteudo'` de R2 para cima: a assinatura vale para
 * AQUELE conteúdo, e mudar o conteúdo derruba a assinatura. O repositório
 * cumpria isso em UM dos dois caminhos de execução:
 *
 *  · pelo TOKEN (`ApprovalsService.consumir`, usado pela porta quando o agente
 *    volta com `approvalToken`), o hash é recalculado e comparado — é a linha
 *    "A mudança difere do que foi aprovado";
 *  · pela FILA (`AcoesService.executarAprovada`, que é por onde a tela e este
 *    canal executam), NÃO era. O método lê `ToolCall.args`, revalida o formato
 *    contra o `argsSchema` de hoje e dispara. Nada compara os argumentos com o
 *    hash que a pessoa assinou.
 *
 * Na prática isso quer dizer: entre a proposta e a confirmação, quem conseguisse
 * escrever em `ToolCall.args` trocaria o texto que vai sair mantendo a aprovação
 * — e a linha do RASTRO sairia carimbada com o `contentHash` do conteúdo ANTIGO,
 * afirmando que o que saiu foi o que foi assinado. É a forma mais silenciosa de
 * a promessa de vínculo deixar de valer.
 *
 * ----------------------------------------------------------------------------
 * POR QUE A CONFERÊNCIA NÃO VALE PARA CONTEÚDO REDIGIDO
 * ----------------------------------------------------------------------------
 * Para capacidade de sensibilidade `restrita`, a porta grava em `ToolCall.args`
 * a REDAÇÃO (`{ redigido: true, chaves: [...] }`, ver `ToolGateway.redigir`),
 * enquanto o `contentHash` da aprovação é calculado sobre os argumentos CRUS.
 * Os dois nunca casam, por construção — comparar ali acusaria adulteração em
 * toda aprovação restrita do sistema.
 *
 * Então `vinculoDoConteudo` devolve `'redigido'` nesse caso: não é "intacto"
 * (não há como afirmar isso) nem "quebrado" (não há evidência de nada). O
 * estrangulamento DEIXA PASSAR — a pessoa que assinou na tela viu a mesma
 * redação que a porta gravou e sabia o que estava assinando. O canal de WhatsApp
 * nunca chega a este caso: `restrita` é R4 na escada, e R4 ele recusa de dentro.
 *
 * A dívida fica declarada, e é de `ToolCall`: hoje a redação DESTRÓI o conteúdo
 * em vez de cifrá-lo, então o caminho da fila não tem como executar uma ação
 * restrita com os argumentos de verdade (ela já não teria o que mandar ao
 * efeito). Quando `restrita` ganhar conteúdo cifrado em vez de apagado, esta
 * função passa a valer também para ela, sem mudar de forma.
 */

/** O que a conferência pode dizer. Três respostas, não duas — ver o cabeçalho. */
export type EstadoDoVinculo = 'intacto' | 'quebrado' | 'redigido';

export interface ConferenciaDeVinculo {
  estado: EstadoDoVinculo;
  /** O hash dos argumentos de hoje. `null` quando não deu para calcular. */
  hashAtual: string | null;
}

/** Os argumentos gravados são a redação que a porta escreve para `restrita`? */
export function argsRedigidos(args: unknown): boolean {
  return (
    args !== null &&
    typeof args === 'object' &&
    (args as Record<string, unknown>).redigido === true
  );
}

/**
 * O conteúdo que vai sair ainda é o que foi assinado?
 *
 * `hashKeys` é o mesmo do catálogo que a proposta usou. Vazio quer dizer O CORPO
 * INTEIRO — a mesma falha fechada de `canonicalHash`: capacidade que não declara
 * chaves prende a aprovação a tudo.
 *
 * MUDAR AS `hashKeys` NO CATÁLOGO TAMBÉM QUEBRA O VÍNCULO, e está certo assim: a
 * aprovação foi dada sobre um recorte do conteúdo, e trocar o recorte muda o que
 * ela cobria. O conserto é repropor, não afrouxar a comparação.
 */
export function vinculoDoConteudo(entrada: {
  resourceType: string;
  argsGravados: unknown;
  hashKeys: string[];
  contentHash: string;
}): ConferenciaDeVinculo {
  if (argsRedigidos(entrada.argsGravados)) return { estado: 'redigido', hashAtual: null };

  const args = (entrada.argsGravados ?? {}) as Record<string, unknown>;
  let hashAtual: string;
  try {
    hashAtual = canonicalHash(entrada.resourceType, args, entrada.hashKeys);
  } catch {
    // Argumento que não serializa não tem hash — e o que não tem hash não casa.
    return { estado: 'quebrado', hashAtual: null };
  }
  return {
    estado: hashAtual === entrada.contentHash ? 'intacto' : 'quebrado',
    hashAtual,
  };
}

/** A frase que quem decide lê quando o vínculo quebrou. Uma só, nos dois canais. */
export const RECUSA_POR_VINCULO =
  'O conteúdo desta ação MUDOU depois que ela foi proposta: o que está gravado para sair não ' +
  'é mais o que foi apresentado para aprovação. A aprovação foi INVALIDADA e nada saiu — o ' +
  'caminho é o agente propor de novo, com o conteúdo de agora.';
