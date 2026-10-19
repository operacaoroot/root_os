import type { TrabPassoDoCartao, TrabTipoDoPasso } from '@mktos/shared';
import type { Prisma } from '@prisma/client';

import { mudancasDaAuditoria, tipoDasMudancas } from '../caixa/atividade-da-caixa';

/*
 * O MOVIMENTO DO CARTÃO (rodada da implantação I2, 18/10/2026) — as frases.
 *
 * O pedido do Rodrigo: "acessar a última movimentação ou o último comentário
 * sem nem clicar na task". A fonte é a MESMA da caixa de entrada: a auditoria
 * `work.task.create`/`update` que o quadro grava e as linhas de `WorkComment`.
 * O "o que mudou" sai de `mudancasDaAuditoria`, a regra da caixa, para as duas
 * telas nunca contarem a mesma edição de jeitos diferentes.
 *
 * Edição que não mexeu em nada que a tela mostra (ordem, descrição, campo) não
 * vira passo, pelo mesmo motivo da caixa: não é movimento de ninguém.
 */

/** Quantos passos o balão mostra. */
export const PASSOS_NO_BALAO = 3;
/** O trecho do comentário no rodapé e no balão. */
export const TRECHO_DO_COMENTARIO = 80;
/** Quem assina a escrita do fechamento na auditoria (`card-da-implantacao.ts`). */
export const ATOR_DO_FECHAMENTO = 'comercial';

export interface LinhaDeAuditoria {
  action: string;
  actorType: string;
  actorId: string | null;
  before: Prisma.JsonValue | null;
  after: Prisma.JsonValue | null;
  createdAt: Date;
}

export function trechoDoComentario(texto: string): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  return limpo.length > TRECHO_DO_COMENTARIO ? `${limpo.slice(0, TRECHO_DO_COMENTARIO - 1).trimEnd()}…` : limpo;
}

export function quemDaAuditoria(a: Pick<LinhaDeAuditoria, 'actorType' | 'actorId'>, nomeDe: ReadonlyMap<string, string>): string {
  if (a.actorType === 'user') return (a.actorId && nomeDe.get(a.actorId)) || 'alguém da equipe';
  if (a.actorType === 'ai') return 'agente';
  return a.actorId === ATOR_DO_FECHAMENTO ? 'Fechamento comercial' : 'sistema';
}

/** O passo de uma linha de auditoria, ou nulo quando ela não mexeu em nada visível. */
export function passoDaAuditoria(a: LinhaDeAuditoria, nomeDe: ReadonlyMap<string, string>): TrabPassoDoCartao | null {
  const quem = quemDaAuditoria(a, nomeDe);
  const em = a.createdAt.toISOString();
  if (a.action === 'work.task.create') {
    return { tipo: 'criacao', quem, frase: a.actorId === ATOR_DO_FECHAMENTO && a.actorType === 'system' ? 'abriu o card' : 'criou', em };
  }
  const mudancas = mudancasDaAuditoria(a.before, a.after);
  if (mudancas.length === 0) return null;
  const tipo = tipoDasMudancas(mudancas) as TrabTipoDoPasso;
  const m = mudancas[0];
  const frase =
    tipo === 'status' ? `moveu para ${mudancas.find((x) => x.campo === 'status')?.para ?? '?'}`
      : tipo === 'atribuicao' ? (mudancas.find((x) => x.campo === 'responsavel')?.para ? `passou para ${mudancas.find((x) => x.campo === 'responsavel')!.para}` : 'tirou o responsável')
        : tipo === 'vencimento' ? 'mudou o vencimento'
          : m.campo === 'titulo' ? 'renomeou'
            : 'editou';
  return { tipo, quem, frase, em };
}

export function passoDoComentario(c: { authorName: string; text: string; createdAt: Date }): TrabPassoDoCartao {
  return { tipo: 'comentario', quem: c.authorName || 'alguém da equipe', frase: `“${trechoDoComentario(c.text)}”`, em: c.createdAt.toISOString() };
}

/** O rodapé: o mais novo dos dois. */
export function ultimoPasso(passos: readonly TrabPassoDoCartao[], comentario: TrabPassoDoCartao | null): TrabPassoDoCartao | null {
  const movimento = passos[0] ?? null;
  if (!movimento) return comentario;
  if (!comentario) return movimento;
  return comentario.em > movimento.em ? comentario : movimento;
}
