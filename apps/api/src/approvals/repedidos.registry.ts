import { Injectable } from '@nestjs/common';

/*
 * "PEDIR DE NOVO" — a vencida volta à fila com o conteúdo de AGORA (rodada do
 * trabalho T7, 19/10/2026).
 *
 * Uma aprovação vencida não se aprova: o prazo protege contra decisão velha
 * executando fora de contexto. O que a fila oferece no lugar é recriar o pedido,
 * e a regra é uma só: o pedido novo nasce pelo MESMO caminho que criou o
 * original, que relê o conteúdo de agora (o mover relê a etapa e os portões, a
 * sala remonta a versão aberta, a proposta relê a versão vigente, a mensagem
 * relê o texto guardado, o dinheiro relê o aceite). Nada da aprovação vencida é
 * reaproveitado: nem o token, nem o prazo, nem a assinatura, nem os argumentos
 * gravados como verdade. Os argumentos gravados entram só para ACHAR o recurso
 * (qual lead, qual mensagem), e o serviço do domínio decide o resto.
 *
 * POR QUE UM REGISTRO, como o dos efeitos da porta e o dos executores de rotina:
 * a fila (`approvals`) não pode importar os domínios (comercial, pauta, Google)
 * sem fechar ciclo de módulo, e quem sabe remontar o pedido é o domínio. Cada um
 * se inscreve com a chave do pedido. Chave sem inscrição = a fila NÃO oferece o
 * botão e diz por quê (`MOTIVO_SEM_CAMINHO`, ou o motivo próprio da chave).
 *
 * QUEM CLICA VIRA O PROPONENTE (invariante 7): o pedido novo é proposto em nome
 * de quem clicou, que por isso não pode assiná-lo. A tela diz isso antes do
 * clique. A permissão exigida é a da rota de origem (`permissoes`): pedir de
 * novo pela fila não pode alcançar mais do que pedir pela tela do domínio.
 */

/** A chave de um pedido: a capacidade, ou `legado:<recurso>` na superfície do token. */
export function chaveDoPedido(capabilityId: string | null, resourceType: string): string {
  return capabilityId ?? `legado:${resourceType}`;
}

/** O que o serviço do domínio recebe para remontar o pedido. */
export interface PedidoVencido {
  orgId: string;
  /** A aprovação vencida. Só para achar o recurso e conferir que ela é a que travou. */
  approvalId: string;
  capabilityId: string | null;
  resourceType: string;
  resourceId: string;
  contentHash: string;
  /** Os argumentos gravados na porta (`ToolCall.args`), ou `null` na superfície do token. */
  args: Record<string, unknown> | null;
  /** Quem clicou: vira o proponente do pedido novo. */
  quem: { id: string; nome: string | null; papeis: readonly string[] };
}

/** O que volta: a aprovação nova (ou `null` se a régua de hoje deixou sair sem assinatura). */
export interface PedidoRefeito {
  approvalId: string | null;
  /** Uma frase curta para a tela, quando o domínio tem algo a dizer além do padrão. */
  aviso?: string;
  /**
   * O que só quem pediu pode guardar (o token de uso único do mover, que mora na
   * aba de quem pediu). Vai na resposta desta chamada e em nenhum outro lugar.
   */
  paraQuemPediu?: Record<string, unknown>;
}

export interface Repedido {
  /** As permissões da rota de origem. Quem não as tem não pede de novo pela fila. */
  permissoes: string[];
  repedir: (p: PedidoVencido) => Promise<PedidoRefeito>;
}

/** O motivo padrão de não haver botão, para a chave que ninguém inscreveu. */
export const MOTIVO_SEM_CAMINHO =
  'Este tipo de pedido não sabe se refazer com o conteúdo de agora. Peça de novo na tela de origem.';

/**
 * Os tipos que de propósito NÃO se refazem pela fila, com o porquê. Ficam aqui,
 * e não espalhados, para a tela dizer a frase certa em vez da genérica.
 */
export const MOTIVOS_SEM_REPEDIDO: Readonly<Record<string, string>> = {
  'email.enviar': 'O texto do e-mail foi escrito na hora e não fica guardado fora deste pedido. Escreva de novo em Google.',
  'email.rascunhar': 'O rascunho foi escrito na hora e não fica guardado fora deste pedido. Escreva de novo em Google.',
  'agenda.evento.criar': 'O evento foi descrito na hora e não fica guardado fora deste pedido. Crie de novo em Google.',
  'agenda.reuniao.marcar': 'A reunião foi descrita na hora e não fica guardada fora deste pedido. Marque de novo em Google.',
  'documento.criar': 'O documento foi escrito na hora e não fica guardado fora deste pedido. Crie de novo em Google.',
  'documento.anexar': 'O texto foi escrito na hora e não fica guardado fora deste pedido. Escreva de novo em Google.',
  'whatsapp.mensagem.enviar': 'A mensagem foi escrita na hora e não fica guardada fora deste pedido. Escreva de novo na tela de origem.',
  'pauta.semana.aprovar': 'O lote da semana se monta de novo em Pauta, aba Semana, "Aprovar a semana": ele relê cada post.',
  'instagram.post.publicar': 'Peça de novo em Pauta, aba Semana, "Publicar agora": ele relê a peça aprovada.',
};

@Injectable()
export class RepedidosRegistry {
  private readonly mapa = new Map<string, Repedido>();
  private readonly dono = new Map<string, string>();

  /** Reinscrição LANÇA, como nos outros registros da casa: duas receitas para o mesmo pedido é defeito. */
  inscrever(chave: string, r: Repedido, quem = 'serviço não identificado'): void {
    const anterior = this.dono.get(chave);
    if (anterior !== undefined) {
      throw new Error(`"Pedir de novo" de "${chave}" inscrito duas vezes: por "${anterior}" e agora por "${quem}".`);
    }
    if (MOTIVOS_SEM_REPEDIDO[chave]) {
      throw new Error(`"${chave}" está na lista dos que não se refazem pela fila: tire de lá antes de inscrever.`);
    }
    this.mapa.set(chave, r);
    this.dono.set(chave, quem);
  }

  de(chave: string): Repedido | null {
    return this.mapa.get(chave) ?? null;
  }

  get inscritos(): string[] {
    return [...this.mapa.keys()].sort();
  }

  /** Por que esta chave não tem botão, ou `null` quando tem. */
  porQueNao(chave: string): string | null {
    if (this.mapa.has(chave)) return null;
    return MOTIVOS_SEM_REPEDIDO[chave] ?? MOTIVO_SEM_CAMINHO;
  }
}
