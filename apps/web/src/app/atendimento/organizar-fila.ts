import { CAPACIDADE_DE_APROVAR_A_SEMANA } from '@mktos/shared';
import { comNivelExplicado, diaSP } from '@/lib/cockpit';
import type { Fila, ItemDaFila, Nivel } from './tipos';

/*
 * COMO A FILA SE ORGANIZA NA TELA (rodada do painel P4, 18/10/2026).
 *
 * Só forma. Os três grupos, os contadores e o filtro são lidos dos campos que
 * o servidor já calculou do banco (`gaveta`, `euPossoAprovar`, `impedimento`,
 * `aprovadores`, `decideNestaSessao`): nenhuma trava nova nasce aqui, e nenhuma
 * deixa de valer. Quem decide se a assinatura vale continua sendo `confirm`.
 *
 *   · DEPENDE DE VOCÊ: o que você pode assinar agora, e o que só sai da fila
 *     com a sua recusa (a ação que a execução recusaria hoje, a confirmada que
 *     não executou). As duas regras do botão são as de sempre: assinar só com
 *     `euPossoAprovar`; recusar com `decideNestaSessao`.
 *   · AGUARDANDO OUTRA PESSOA: você pediu, falta a alçada, falta a titular,
 *     seu perfil só acompanha.
 *   · DECIDIDAS E VENCIDAS: recusadas e expiradas. Histórico.
 */

export type Grupo = 'voce' | 'outra' | 'historico';

type Eu = Pick<Fila['eu'], 'id' | 'alcada' | 'decideNestaSessao'>;

/** Recusar: a mesma conta que o item sempre fez (esperando ou no limbo, e decidindo nesta sessão). */
export function podeRecusar(item: Pick<ItemDaFila, 'gaveta'>, eu: Pick<Eu, 'decideNestaSessao'>): boolean {
  return (item.gaveta === 'esperando' || item.gaveta === 'confirmada') && eu.decideNestaSessao;
}

export function grupoDoItem(item: ItemDaFila, eu: Eu): Grupo {
  if (item.gaveta === 'expirou' || item.gaveta === 'recusada') return 'historico';
  if (item.gaveta === 'esperando' && item.euPossoAprovar) return 'voce';
  // Confirmada sem capacidade = superfície do token (o mover do funil): quem
  // conclui é quem pediu. Para quem pediu, é o passo dele (revisão PA-7:
  // "conclua no funil"); para quem confirmou, ela espera outra pessoa.
  if (concluiNoFunil(item, eu)) return 'voce';
  if (item.gaveta === 'confirmada' && !item.capacidade) return 'outra';
  // Só a sua recusa tira da fila: a execução recusaria hoje, ou já confirmou e não executou.
  if (podeRecusar(item, eu) && (item.gaveta === 'confirmada' || item.impedimento)) return 'voce';
  return 'outra';
}

/**
 * O pedido de mover que EU fiz já foi confirmado: falta eu concluir no funil,
 * com o token que só a minha aba tem, até `expiraEm` (revisão PA-7).
 */
export function concluiNoFunil(item: Pick<ItemDaFila, 'gaveta' | 'capacidade' | 'recurso' | 'proponente'>, eu: Pick<Eu, 'id'>): boolean {
  return item.gaveta === 'confirmada' && !item.capacidade && item.recurso.tipo === 'lead' && item.proponente.id === eu.id;
}

/** O cartão do lead no funil, onde quem pediu conclui a mudança. */
export function linkDoCartao(item: Pick<ItemDaFila, 'recurso'>): string {
  return `/comercial/funil?lead=${encodeURIComponent(item.recurso.id)}`;
}

/** Por que o item está esperando outra pessoa, em poucas palavras. A frase inteira do servidor vai no `title`. */
export function motivoDaEspera(item: ItemDaFila, eu: Eu): string {
  if (concluiNoFunil(item, eu)) return 'Confirmada: conclua no funil';
  if (item.gaveta === 'confirmada' && !item.capacidade) return 'Confirmada: quem pediu conclui';
  if (item.gaveta === 'confirmada') return 'Confirmada, a execução não concluiu';
  if (item.impedimento) return 'A execução recusaria hoje';
  if (item.proponente.id === eu.id) return 'Você pediu: assina outra pessoa';
  if (!eu.decideNestaSessao) return 'Seu perfil acompanha, não assina';
  if (item.alcadaMinima === 'titular' && eu.alcada !== 'titular') return 'Falta a titular';
  return `Pede alçada ${item.alcadaMinima}`;
}

/** "Pode assinar: Lucas, Bia" ou o aviso de que ninguém pode. */
export function quemPodeAssinar(item: Pick<ItemDaFila, 'aprovadores'>): string {
  const nomes = item.aprovadores.map((a) => a.nome);
  if (!nomes.length) return 'Ninguém pode assinar hoje';
  const mostra = nomes.slice(0, 2).join(', ');
  return `Pode assinar: ${mostra}${nomes.length > 2 ? ` e mais ${nomes.length - 2}` : ''}`;
}

/* ---------------------------------------------------------------- o passo */

export interface Passo {
  /** O botão de assinar (só quando `euPossoAprovar`). */
  assinar: { fechado: string; aberto: string } | null;
  /** O texto do botão de recusar, ou `null` quando ele não aparece. */
  recusar: string | null;
}

export function passoDoItem(item: ItemDaFila, eu: Eu): Passo {
  const titular = item.alcadaMinima === 'titular';
  const assinar = item.euPossoAprovar
    ? titular
      ? { fechado: 'Ler e assinar como titular', aberto: 'Assinar como titular' }
      : { fechado: 'Ler e confirmar', aberto: 'Confirmar' }
    : null;
  const recusar = podeRecusar(item, eu)
    ? item.gaveta === 'confirmada'
      ? 'Recusar e tirar da fila'
      : item.proponente.id === eu.id && !item.euPossoAprovar
        ? 'Cancelar o que eu propus'
        : 'Recusar'
    : null;
  return { assinar, recusar };
}

/* ---------------------------------------------- a forma da assinatura (T7) */

/**
 * ONDE SE ASSINA, sem trocar de tela (rodada do trabalho T7, 19/10/2026).
 *
 *   · `na-linha`: o conteúdo exato cabe na linha (o mover com o destino
 *     conferido pelo hash, a sala versão N conferida) e o nível não pede senha
 *     nem motivo: um clique aprova.
 *   · `caixa-na-linha`: cabe na linha, mas a regra pede senha e/ou motivo (R4):
 *     o clique abre a caixa ali mesmo, e "Aprovar" vai junto com a senha.
 *   · `ler-e-aprovar`: o conteúdo é longo (WhatsApp, proposta, lote): o clique
 *     abre o conteúdo no lugar, e o botão de aprovar fica ao lado dele.
 *
 * Só forma: quem decide se a assinatura vale continua sendo `confirm`, que
 * confere o hash como sempre.
 */
export type FormaDaAssinatura = 'na-linha' | 'caixa-na-linha' | 'ler-e-aprovar';

export const CAPACIDADE_DA_SALA_NA_FILA = 'comercial.sala.publicar';

export function cabeNaLinha(item: Pick<ItemDaFila, 'capacidade' | 'recurso' | 'destinoConferido' | 'impedimento'>): boolean {
  if (item.impedimento) return false;
  if (!item.capacidade && item.recurso.tipo === 'lead' && item.destinoConferido) return true;
  return item.capacidade === CAPACIDADE_DA_SALA_NA_FILA;
}

export function formaDaAssinatura(
  item: Pick<ItemDaFila, 'capacidade' | 'recurso' | 'destinoConferido' | 'impedimento' | 'exigeReauth' | 'exigeMotivo' | 'nivel'>,
): FormaDaAssinatura {
  if (!cabeNaLinha(item)) return 'ler-e-aprovar';
  if (item.exigeReauth || item.exigeMotivo) return 'caixa-na-linha';
  return item.nivel === 'R2' || item.nivel === 'R3' ? 'na-linha' : 'caixa-na-linha';
}

/** O rótulo do botão da linha, pela forma. */
export function rotuloNaLinha(forma: FormaDaAssinatura, titular: boolean): string {
  if (forma === 'ler-e-aprovar') return titular ? 'Ler e assinar como titular' : 'Ler e confirmar';
  return titular ? 'Aprovar como titular' : 'Aprovar';
}

/** A frase de quem pede de novo, dita antes do clique (invariante 7). */
export const FRASE_DO_PEDIR_DE_NOVO =
  'Você vira quem pede: o pedido novo leva o conteúdo de agora, e outra pessoa assina. Você não poderá assinar.';

/* ---------------------------------------------------------------- o nível */

const NIVEL_EM_PALAVRAS: Record<Nivel, string> = {
  R0: 'R0: só leitura',
  R1: 'R1: registra e segue',
  R2: 'R2: pede uma confirmação',
  R3: '',
  R4: '',
  R5: 'R5: bloqueado',
};

/** O nível com o que ele pede de alguém. R3 e R4 com as palavras do comercial (`comNivelExplicado`). */
export function nivelEmPalavras(nivel: Nivel): string {
  if (nivel === 'R3' || nivel === 'R4') return comNivelExplicado(`(${nivel})`).slice(1, -1);
  return NIVEL_EM_PALAVRAS[nivel] ?? nivel;
}

/**
 * As condições de assinatura, legíveis, ANTES do clique. Tudo vem do item:
 * alçada mínima, a regra de duas pessoas, a senha e o motivo escrito.
 */
export function condicoesDeAssinatura(item: ItemDaFila): string[] {
  const c = [
    `Alçada ${item.alcadaMinima} ou acima`,
    `Outra pessoa que não quem pediu (${item.proponente.nome})`,
  ];
  if (item.exigeReauth) c.push('Sua senha de novo, na hora de assinar');
  if (item.exigeMotivo) c.push(`Um motivo escrito (${item.nivel} exige)`);
  return c;
}

/* ----------------------------------------------------------- tipo e filtro */

export const TIPOS = ['whatsapp', 'publicacao', 'lote', 'google', 'comercial', 'outros'] as const;
export type TipoDoPedido = (typeof TIPOS)[number];
export type Filtro = TipoDoPedido | 'todos';

export const ROTULO_DO_TIPO: Record<Filtro, string> = {
  todos: 'Tudo',
  whatsapp: 'WhatsApp',
  publicacao: 'Publicação',
  lote: 'Lote da semana',
  google: 'Google',
  comercial: 'Comercial',
  outros: 'Outros',
};

export function tipoDoPedido(item: Pick<ItemDaFila, 'capacidade' | 'canal' | 'recurso'>): TipoDoPedido {
  const cap = item.capacidade ?? '';
  if (cap === CAPACIDADE_DE_APROVAR_A_SEMANA) return 'lote';
  if (cap.startsWith('whatsapp.') || cap === 'comercial.whatsapp.enviar' || item.canal === 'whatsapp') return 'whatsapp';
  if (cap.startsWith('instagram.') || cap.startsWith('youtube.') || cap === 'conteudo.publicar' || item.recurso.tipo === 'content') {
    return 'publicacao';
  }
  if (cap.startsWith('email.') || cap.startsWith('agenda.') || cap.startsWith('documento.')) return 'google';
  if (cap.startsWith('comercial.') || cap.startsWith('crm.') || item.recurso.tipo === 'lead' || item.recurso.tipo.startsWith('comercial')) {
    return 'comercial';
  }
  return 'outros';
}

/** O filtro vem da query (`?tipo=`); valor desconhecido vira "todos". */
export function filtroDaQuery(search: string): Filtro {
  const t = new URLSearchParams(search).get('tipo');
  return t && (TIPOS as readonly string[]).includes(t) ? (t as TipoDoPedido) : 'todos';
}

/* ------------------------------------------------------------- contadores */

/** Vence hoje (São Paulo) e ainda não venceu, entre o que está vivo. */
export function venceHoje(item: Pick<ItemDaFila, 'gaveta' | 'expiraEm'>, agora: string): boolean {
  if (item.gaveta !== 'esperando') return false;
  const t = new Date(item.expiraEm).getTime();
  const a = new Date(agora).getTime();
  return t > a && diaSP(item.expiraEm) === diaSP(agora);
}

export interface Organizada {
  grupos: Record<Grupo, ItemDaFila[]>;
  contadores: { voce: number; vencendoHoje: number; porTipo: Record<Filtro, number> };
}

/**
 * Os três grupos já filtrados, e os contadores do topo SEM o filtro: "aguardando
 * você" é sobre a fila inteira, e esconder um número porque o filtro está em
 * WhatsApp faria a pessoa achar que não há mais nada.
 */
export function organizarFila(fila: Pick<Fila, 'itens' | 'eu' | 'agora'>, filtro: Filtro = 'todos'): Organizada {
  const grupos: Record<Grupo, ItemDaFila[]> = { voce: [], outra: [], historico: [] };
  const porTipo = Object.fromEntries((['todos', ...TIPOS] as Filtro[]).map((t) => [t, 0])) as Record<Filtro, number>;
  let voce = 0;
  let vencendoHoje = 0;
  for (const item of fila.itens) {
    const g = grupoDoItem(item, fila.eu);
    const tipo = tipoDoPedido(item);
    porTipo.todos += 1;
    porTipo[tipo] += 1;
    if (g === 'voce') voce += 1;
    if (g !== 'historico' && venceHoje(item, fila.agora)) vencendoHoje += 1;
    if (filtro === 'todos' || filtro === tipo) grupos[g].push(item);
  }
  return { grupos, contadores: { voce, vencendoHoje, porTipo } };
}
