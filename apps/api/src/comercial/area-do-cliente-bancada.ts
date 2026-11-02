import {
  AREA_ITENS,
  AREA_TOTAL_DE_ITENS,
  faseDoFluxoPorId,
  type AcaoDoItemNaBancada,
  type AreaDoClienteNaBancada,
  type AreaDoClienteParaOCliente,
  type AreaEstadoDoItem,
  type ItemDaAreaNaBancada,
} from '@mktos/shared';

import areaDoCliente from '../platform/area-do-cliente.json';

/*
 * A BANCADA DA ÁREA DO CLIENTE (leva A, 30/10/2026): a aba "Área do cliente"
 * no painel do lead, que diz, para cada um dos quinze itens, em que estado ele
 * está, de onde vem e qual é a ação que resolve. Pura: o serviço só lê e
 * entrega os insumos.
 *
 * O estado de um item, do mais urgente ao mais tranquilo:
 *   · `na_porta`: há uma versão esperando a segunda pessoa em /atendimento;
 *   · `rascunho`: a Root escreveu e ainda não pediu para publicar;
 *   · `lido`: a versão no ar foi aberta pelo cliente (a data fica aqui, D6);
 *   · `publicado`: a versão está no ar e o cliente ainda não a abriu ("novo");
 *   · `derivado`: o OS montou do que já sabe e o cliente já vê;
 *   · `vazio`: nada ainda, e o slot diz em que fase do fluxo chega.
 *
 * A ação: item derivado não tem ação (o OS monta sozinho); item com rascunho
 * pede `publicar`; o resto pede `escrever` (a primeira edição, ou a próxima).
 */

export interface VersaoDoItemNaBancada {
  item: string | null;
  numero: number;
  estado: string;
  approvalId: string | null;
  publicadaEm: Date | null;
  atualizadoEm: Date;
  publicadaPor: string | null;
  hash: string;
}

export interface LeituraNaBancada {
  item: string;
  versao: number;
  em: Date;
}

export interface EntradaDaBancada {
  leadId: string;
  temSala: boolean;
  modo: 'sala' | 'area';
  /** A área como o cliente a vê agora (nula sem sala ou em modo sala): diz quais derivados existem. */
  area: AreaDoClienteParaOCliente | null;
  versoes: readonly VersaoDoItemNaBancada[];
  leituras: readonly LeituraNaBancada[];
}

const ABERTOS = new Set(['rascunho', 'na_porta']);

/** O texto do desenho (`area-do-cliente.json`) que diz de onde o item vem hoje. */
export function fonteDoItem(id: string): string {
  const def = (areaDoCliente.itens as { id: string; fonte_no_os: { hoje: string } }[]).find((i) => i.id === id);
  return def?.fonte_no_os.hoje ?? '';
}

/** A edição de cada versão de item (1ª, 2ª...): a posição entre as versões do mesmo item. */
function edicoes(versoes: readonly VersaoDoItemNaBancada[]): Map<number, number> {
  const porItem = new Map<string, number[]>();
  for (const v of versoes) {
    if (!v.item) continue;
    const lista = porItem.get(v.item) ?? [];
    lista.push(v.numero);
    porItem.set(v.item, lista);
  }
  const out = new Map<number, number>();
  for (const numeros of porItem.values()) numeros.sort((a, b) => a - b).forEach((n, i) => out.set(n, i + 1));
  return out;
}

export function bancadaDaArea(e: EntradaDaBancada): AreaDoClienteNaBancada {
  const ed = edicoes(e.versoes);
  const derivados = new Set((e.area?.blocos ?? []).flatMap((b) => b.itens).filter((i) => i.origem === 'derivado').map((i) => i.id));

  const itens: ItemDaAreaNaBancada[] = AREA_ITENS.map((def) => {
    const fase = faseDoFluxoPorId(def.entraNaFase);
    const doItem = e.versoes.filter((v) => v.item === def.id);
    const aberta = doItem.find((v) => ABERTOS.has(v.estado)) ?? null;
    const publicada = [...doItem].filter((v) => v.estado === 'publicada').sort((a, b) => b.numero - a.numero)[0] ?? null;
    const leitura = publicada ? e.leituras.find((l) => l.item === def.id && l.versao === publicada.numero) ?? null : null;
    const derivado = derivados.has(def.id);

    let estado: AreaEstadoDoItem = 'vazio';
    if (aberta?.estado === 'na_porta') estado = 'na_porta';
    else if (aberta) estado = 'rascunho';
    else if (publicada && leitura) estado = 'lido';
    else if (publicada) estado = 'publicado';
    else if (derivado) estado = 'derivado';

    const acao: AcaoDoItemNaBancada = def.comoChega === 'derivado' ? 'nada' : aberta?.estado === 'rascunho' ? 'publicar' : aberta ? 'nada' : 'escrever';

    let nota: string | null = null;
    if (estado === 'na_porta') nota = 'A versão espera a liberação de outra pessoa em Aprovações. Mudar o rascunho agora devolve a versão a rascunho.';
    else if (estado === 'rascunho') nota = 'Rascunho gravado: o cliente ainda não vê. Publicar pede a liberação de outra pessoa.';
    else if (estado === 'lido') nota = 'O cliente abriu a versão que está no ar.';
    else if (estado === 'publicado') nota = 'No ar com o selo "novo": o cliente ainda não abriu.';
    else if (estado === 'derivado') nota = 'O OS monta sozinho a partir do que já está gravado. Não se digita.';
    else if (def.comoChega === 'derivado') nota = e.modo === 'area' ? 'O OS monta quando a fonte existir (leva B do desenho).' : 'Chega com a área: o OS monta a partir do que o fio já tem quando o negócio fechar.';
    else nota = `Chega na fase ${fase.numero} (${fase.nome})${def.tarefaDoFluxo ? `, com a tarefa ${def.tarefaDoFluxo} do fluxo` : ''}. Escreva quando estiver pronto; o cliente só vê depois da liberação.`;

    return {
      id: def.id,
      bloco: def.bloco,
      titulo: def.titulo,
      tarefaDoFluxo: def.tarefaDoFluxo,
      entraNaFase: { id: fase.id, numero: fase.numero, nome: fase.nome },
      comoChega: def.comoChega,
      estado,
      fonte: fonteDoItem(def.id),
      publicada: publicada
        ? { versao: publicada.numero, edicao: ed.get(publicada.numero) ?? 1, publicadaEm: (publicada.publicadaEm ?? publicada.atualizadoEm).toISOString(), publicadaPor: publicada.publicadaPor, hash: publicada.hash }
        : null,
      aberta: aberta ? { versao: aberta.numero, estado: aberta.estado as 'rascunho' | 'na_porta', approvalId: aberta.approvalId, atualizadoEm: aberta.atualizadoEm.toISOString() } : null,
      lidoEm: leitura ? leitura.em.toISOString() : null,
      acao,
      nota,
    };
  });

  return {
    leadId: e.leadId,
    temSala: e.temSala,
    modo: e.modo,
    noAr: itens.filter((i) => i.estado === 'publicado' || i.estado === 'lido' || i.estado === 'derivado').length,
    total: AREA_TOTAL_DE_ITENS,
    itens,
  };
}
