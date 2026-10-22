'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  chaveDoNomeNoNivel, listaDaImplantacao, motivoParaNaoMoverPasta,
  TRAB_LISTA_DA_IMPLANTACAO_PROTEGIDA, TRAB_NOME_DE_LISTA_REPETIDO, TRAB_NOME_DE_PASTA_REPETIDO, TRAB_PASTA_DA_IMPLANTACAO_PROTEGIDA,
  type TrabEstrutura, type TrabListaDto,
} from '@mktos/shared';
import { apiPatch, apiPost } from '@/lib/api';
import { AcoesDaListaNaArvore, AcoesDaPastaNaArvore, type DestinoDaArvore } from './ExcluirDaArvore';
import { ArquivadasDaArvore } from './ArquivadasDaArvore';

/*
 * A ÁRVORE DE TAREFAS, EDITÁVEL ONDE A PESSOA ESTÁ OLHANDO (adendo da rodada de
 * produção 1, A3, 21/10/2026).
 *
 * Pastas dentro de pastas (recuadas) e as listas de cada uma; as listas sem pasta
 * no fim. Para quem tem `tarefas.editar`:
 *  · "+ nova pasta" no fim, com o nome no próprio lugar: Enter cria, Esc desfaz.
 *    Com uma pasta escolhida no topo, a nova nasce dentro dela (é o que a árvore
 *    está mostrando); sem escolha, no topo;
 *  · duplo clique no nome (ou "⋯" › Renomear, ou F2) abre o nome para editar:
 *    Enter salva, Esc desfaz. Nome repetido no mesmo nível é recusado aqui e na
 *    API com a mesma frase, sem diferença de maiúscula nem acento;
 *  · arrastar uma lista para o nome de outra pasta (ou para "Sem pasta") muda a
 *    lista de pasta; soltar sobre outra lista põe antes dela (no mesmo nível,
 *    reordena; em outro, muda de pasta e entra naquela posição). HTML5 nativo,
 *    como o quadro;
 *  · arrastar uma pasta SOBRE outra a põe dentro dela; soltar na faixa ENTRE duas
 *    pastas a põe ali (no mesmo nível, reordena; em outro, muda de mãe e entra
 *    naquela posição). Ciclo, nível (`motivoParaNaoMoverPasta`) e nome repetido são
 *    recusados aqui com a frase da API; "⋯" › Mover para… faz o mesmo pelo teclado
 *    (M3, 22/10/2026);
 *  · no fim, a seção recolhida "Arquivadas (N)" com Desarquivar (M3);
 *  · Alt+↑ e Alt+↓ no item focado sobem e descem uma posição, e o foco fica nele;
 *  · a lista da implantação não muda de nome nem sai da pasta Clientes, e a pasta
 *    que a guarda não muda de nome nem se exclui: o menu diz por quê.
 * A ordem vai em `POST /trabalho/arvore/ordem` com todos os irmãos do nível, que a
 * API confere; mudar a lista de pasta, em `PATCH /trabalho/listas/:id`; mudar a
 * pasta de mãe, em `POST /trabalho/pastas/:id/mover`.
 */

/** Recusa feita na própria tela (antes da API): vira aviso, não erro de carregar. */
class RecusaDaTela extends Error {}

type Pasta = TrabEstrutura['folders'][number];
type Arrastado = { tipo: 'pasta' | 'lista'; id: string; paiId: string | null };
type Editando = { tipo: 'pasta' | 'lista'; id: string } | { tipo: 'nova-pasta' };

const CHAVE_DO_ARRASTE = 'application/x-trabalho-arvore';

/** A pasta e todas as que estão dentro dela, em qualquer nível. */
function pastaEDescendentes(folders: readonly Pasta[], raiz: string): Set<string> {
  const dentro = new Set([raiz]);
  for (let mudou = true; mudou;) {
    mudou = false;
    for (const f of folders) {
      if (f.parentId && dentro.has(f.parentId) && !dentro.has(f.id)) { dentro.add(f.id); mudou = true; }
    }
  }
  return dentro;
}

/** "Mãe / Filha": o caminho da pasta, para os seletores de destino. */
function caminhoDaPasta(folders: readonly Pasta[], id: string): string {
  const partes: string[] = [];
  const vistas = new Set<string>();
  for (let atual = folders.find((f) => f.id === id); atual && !vistas.has(atual.id); atual = folders.find((f) => f.id === atual!.parentId)) {
    vistas.add(atual.id);
    partes.unshift(atual.name);
  }
  return partes.join(' / ');
}

/** O nome no próprio lugar: Enter salva, Esc desfaz, sair do campo também desfaz. */
function NomeNoLugar({ inicial, rotulo, testId, conferir, aoSalvar, aoSair }: {
  inicial: string; rotulo: string; testId: string;
  /** A frase da recusa feita na tela (nome repetido), ou nulo. */
  conferir: (nome: string) => string | null;
  aoSalvar: (nome: string) => Promise<void>;
  aoSair: () => void;
}) {
  const [nome, setNome] = useState(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  const salvar = () => {
    const n = nome.trim();
    if (!n || n === inicial) { aoSair(); return; }
    const recusa = conferir(n);
    if (recusa) { setErro(recusa); return; }
    setOcupado(true); setErro(null);
    aoSalvar(n).catch((e) => {
      setErro((e as Error).message); setOcupado(false);
      // A recusa da API (nome repetido, protegida) deixa o nome aberto para corrigir.
      setTimeout(() => campo.current?.focus(), 0);
    });
  };
  return (
    <span className="block min-w-0 flex-1 space-y-0.5">
      <input
        ref={campo} autoFocus aria-label={rotulo} data-testid={testId} value={nome} maxLength={80} disabled={ocupado}
        aria-invalid={erro ? true : undefined}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => { setNome(e.target.value); setErro(null); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); salvar(); }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); aoSair(); }
        }}
        onBlur={() => { if (!ocupado) aoSair(); }}
        className="w-full min-w-0 rounded border border-border bg-surface-2 px-2 py-1 text-[13px] normal-case tracking-normal text-text outline-none focus:border-brand-dim"
      />
      {erro && <span role="alert" data-testid={`${testId}-erro`} className="block px-1 text-[11px] normal-case tracking-normal text-bad">{erro}</span>}
    </span>
  );
}

export function ArvoreDoTrabalho({ estrutura, pastas, mostraSoltas, listaId, editable, token, pastaEscolhida, novaLista, onSelecionarLista, onMudou, onErro, onListaSaiu, onPastaSaiu }: {
  estrutura: TrabEstrutura;
  /** As pastas que a árvore mostra (a escolhida no topo e as de dentro, ou todas). */
  pastas: Pasta[];
  mostraSoltas: boolean;
  listaId: string | null;
  editable: boolean;
  token: string | null;
  /** A pasta escolhida no topo: a nova pasta nasce dentro dela. */
  pastaEscolhida: string | null;
  /** O "+ nova lista" de sempre, ao lado do "+ nova pasta". */
  novaLista?: React.ReactNode;
  onSelecionarLista: (id: string) => void;
  onMudou: () => void;
  onErro: (m: string) => void;
  onListaSaiu: (id: string) => void;
  onPastaSaiu: (id: string) => void;
}) {
  const [editando, setEditando] = useState<Editando | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  const [focarDepois, setFocarDepois] = useState<string | null>(null);
  const arrastado = useRef<Arrastado | null>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const implantacao = useMemo(() => listaDaImplantacao(estrutura.folders), [estrutura]);

  // Depois de gravar, a árvore volta da API e o foco fica no item que se moveu ou mudou de nome.
  useEffect(() => {
    if (!focarDepois) return;
    const el = raiz.current?.querySelector<HTMLElement>(`[data-arvore-item="${focarDepois}"]`);
    if (el) { el.focus(); setFocarDepois(null); }
  }, [estrutura, focarDepois, editando]);

  const filhasDe = (paiId: string | null) => estrutura.folders.filter((f) => (f.parentId ?? null) === paiId);
  const listasDe = (folderId: string | null): TrabListaDto[] => (folderId ? estrutura.folders.find((f) => f.id === folderId)?.lists ?? [] : estrutura.listasSoltas);
  const paiDaLista = (id: string): string | null => estrutura.folders.find((f) => f.lists.some((l) => l.id === id))?.id ?? null;
  const visiveis = new Set(pastas.map((p) => p.id));
  const raizes = pastas.filter((p) => !p.parentId || !visiveis.has(p.parentId));

  const nomeRepetido = (nome: string, irmaos: { id: string; name: string }[], exceto?: string) =>
    irmaos.some((i) => i.id !== exceto && chaveDoNomeNoNivel(i.name) === chaveDoNomeNoNivel(nome));
  const irmasDaPasta = (paiId: string | null, spaceId: string | null) =>
    estrutura.folders.filter((f) => (f.parentId ?? null) === paiId && (paiId !== null || (f.spaceId ?? null) === spaceId));

  const destinosDaLista = (id: string): DestinoDaArvore[] => [
    ...estrutura.folders.flatMap((f) => f.lists.map((l) => ({ l, rotulo: `${caminhoDaPasta(estrutura.folders, f.id)} / ${l.name}` }))),
    ...estrutura.listasSoltas.map((l) => ({ l, rotulo: `Sem pasta / ${l.name}` })),
  ].filter(({ l }) => l.id !== id && l.id !== implantacao?.listaId && l.natureza !== 'cadastro').map(({ l, rotulo }) => ({ id: l.id, rotulo }));
  const destinosDaPasta = (id: string): DestinoDaArvore[] => {
    const fora = pastaEDescendentes(estrutura.folders, id);
    return estrutura.folders.filter((f) => !fora.has(f.id)).map((f) => ({ id: f.id, rotulo: caminhoDaPasta(estrutura.folders, f.id) }));
  };

  const falhou = (e: unknown) => { onErro((e as Error).message); onMudou(); };

  // ---------- ordem e mudança de pasta ----------

  const gravarOrdem = (tipo: 'pasta' | 'lista', paiId: string | null, ids: string[]) =>
    apiPost('/trabalho/arvore/ordem', { tipo, paiId, ids }, token);

  /** Alt+↑/↓: troca com o vizinho, grava o nível inteiro e devolve o foco ao item. */
  const subirOuDescer = (tipo: 'pasta' | 'lista', id: string, passo: -1 | 1) => {
    const irmaos = tipo === 'pasta'
      ? filhasDe(estrutura.folders.find((f) => f.id === id)?.parentId ?? null)
      : listasDe(paiDaLista(id));
    const ids = irmaos.map((i) => i.id);
    const de = ids.indexOf(id);
    const para = de + passo;
    if (de < 0 || para < 0 || para >= ids.length) return;
    [ids[de], ids[para]] = [ids[para], ids[de]];
    const nome = irmaos[de].name;
    const paiId = tipo === 'pasta' ? estrutura.folders.find((f) => f.id === id)?.parentId ?? null : paiDaLista(id);
    gravarOrdem(tipo, paiId, ids)
      .then(() => { setAviso(`${nome}: posição ${para + 1} de ${ids.length}.`); setFocarDepois(`${tipo}:${id}`); onMudou(); })
      .catch(falhou);
  };

  const teclas = (tipo: 'pasta' | 'lista', id: string) => (e: React.KeyboardEvent) => {
    if (!editable) return;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); subirOuDescer(tipo, id, e.key === 'ArrowUp' ? -1 : 1); return; }
    if (e.key === 'F2' && !(tipo === 'lista' ? id === implantacao?.listaId : id === implantacao?.pastaId)) { e.preventDefault(); setEditando({ tipo, id }); }
  };

  /** Mudar a lista de pasta (soltar no nome da pasta, em "Sem pasta" ou sobre uma lista de outro nível). */
  const moverLista = (id: string, folderId: string | null, antesDe?: string) => {
    const lista = [...estrutura.folders.flatMap((f) => f.lists), ...estrutura.listasSoltas].find((l) => l.id === id);
    if (!lista) return;
    if (id === implantacao?.listaId) { setAviso(TRAB_LISTA_DA_IMPLANTACAO_PROTEGIDA); return; }
    const destino = listasDe(folderId);
    if (nomeRepetido(lista.name, destino, id)) { setAviso(`No destino já existe uma lista chamada "${lista.name}". Renomeie uma delas antes de mover.`); return; }
    const nomeDoDestino = folderId ? caminhoDaPasta(estrutura.folders, folderId) : 'Sem pasta';
    apiPatch(`/trabalho/listas/${encodeURIComponent(id)}`, { folderId }, token)
      .then(async () => {
        if (antesDe) {
          const ids = destino.map((l) => l.id);
          const pos = ids.indexOf(antesDe);
          ids.splice(pos < 0 ? ids.length : pos, 0, id);
          await gravarOrdem('lista', folderId, ids);
        }
        setAviso(`A lista ${lista.name} foi para ${nomeDoDestino}.`);
        setFocarDepois(`lista:${id}`);
        onMudou();
      })
      .catch(falhou);
  };

  /**
   * Mudar a pasta de mãe (soltar sobre outra pasta, na faixa entre pastas de outro
   * nível, ou "Mover para…"). `parentId` nulo = primeiro nível. As recusas da tela
   * (protegida, ciclo, nível, nome repetido) saem como `RecusaDaTela`, sem chamar a API.
   */
  const pedirMoverPasta = async (id: string, parentId: string | null, antesDe?: string) => {
    const pasta = estrutura.folders.find((f) => f.id === id);
    if (!pasta) return;
    if (parentId && id === implantacao?.pastaId) throw new RecusaDaTela(TRAB_PASTA_DA_IMPLANTACAO_PROTEGIDA);
    const motivo = motivoParaNaoMoverPasta(estrutura.folders, id, parentId);
    if (motivo) throw new RecusaDaTela(motivo);
    let topo = pasta;
    for (let i = 0; topo.parentId && i < 50; i++) topo = estrutura.folders.find((f) => f.id === topo.parentId) ?? { ...topo, parentId: null };
    const irmas = parentId ? filhasDe(parentId) : irmasDaPasta(null, topo.spaceId ?? null);
    if (nomeRepetido(pasta.name, irmas, id)) throw new RecusaDaTela(`No destino já existe uma pasta chamada "${pasta.name}". Renomeie uma delas antes de mover.`);
    await apiPost(`/trabalho/pastas/${encodeURIComponent(id)}/mover`, { parentId }, token);
    if (antesDe) {
      const ids = filhasDe(parentId).map((f) => f.id).filter((f) => f !== id);
      const pos = ids.indexOf(antesDe);
      ids.splice(pos < 0 ? ids.length : pos, 0, id);
      await gravarOrdem('pasta', parentId, ids);
    }
    setAviso(`A pasta ${pasta.name} foi para ${parentId ? caminhoDaPasta(estrutura.folders, parentId) : 'o primeiro nível'}.`);
    setFocarDepois(`pasta:${id}`);
    onMudou();
  };
  /** O arraste: recusa da tela vira aviso; recusa da API vira erro e a árvore volta da API. */
  const moverPastaArrastada = (id: string, parentId: string | null, antesDe?: string) => {
    pedirMoverPasta(id, parentId, antesDe).catch((e) => {
      if (e instanceof RecusaDaTela) setAviso(e.message);
      else falhou(e);
    });
  };
  /** Para onde a pasta pode ir em "Mover para…": sem ela, sem as de dentro, sem a mãe atual e sem as fundas demais. */
  const destinosParaMover = (f: Pasta): DestinoDaArvore[] => estrutura.folders
    .filter((d) => d.id !== (f.parentId ?? null) && !motivoParaNaoMoverPasta(estrutura.folders, f.id, d.id))
    .map((d) => ({ id: d.id, rotulo: caminhoDaPasta(estrutura.folders, d.id) }));

  /** Pôr o item arrastado antes de um irmão do mesmo nível. */
  const reordenarAntesDe = (tipo: 'pasta' | 'lista', id: string, paiId: string | null, antesDe: string) => {
    const irmaos = tipo === 'pasta' ? filhasDe(paiId) : listasDe(paiId);
    const ids = irmaos.map((i) => i.id).filter((i) => i !== id);
    const pos = ids.indexOf(antesDe);
    if (pos < 0) return;
    ids.splice(pos, 0, id);
    if (ids.join() === irmaos.map((i) => i.id).join()) return;
    gravarOrdem(tipo, paiId, ids).then(() => { setFocarDepois(`${tipo}:${id}`); onMudou(); }).catch(falhou);
  };

  // ---------- arrastar (HTML5 nativo) ----------

  const comecar = (item: Arrastado) => (e: React.DragEvent) => {
    if (!editable) return;
    e.stopPropagation();
    arrastado.current = item;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(CHAVE_DO_ARRASTE, `${item.tipo}:${item.id}`);
    e.dataTransfer.setData('text/plain', item.id);
  };
  const terminar = () => { arrastado.current = null; setAlvo(null); };
  /** Aceita o arraste neste alvo? A regra decide o que acontece no soltar. */
  const sobre = (chave: string, aceita: (a: Arrastado) => boolean) => (e: React.DragEvent) => {
    const a = arrastado.current;
    if (!a || !aceita(a)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (alvo !== chave) setAlvo(chave);
  };
  const soltar = (faz: (a: Arrastado) => void) => (e: React.DragEvent) => {
    const a = arrastado.current;
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    terminar();
    faz(a);
  };

  // ---------- renomear e criar ----------

  const renomearPasta = (f: Pasta) => async (nome: string) => {
    await apiPatch(`/trabalho/pastas/${encodeURIComponent(f.id)}`, { name: nome }, token);
    setEditando(null); setFocarDepois(`pasta:${f.id}`); setAviso(`A pasta ${f.name} agora se chama ${nome}.`); onMudou();
  };
  const renomearLista = (l: TrabListaDto) => async (nome: string) => {
    await apiPatch(`/trabalho/listas/${encodeURIComponent(l.id)}`, { name: nome }, token);
    setEditando(null); setFocarDepois(`lista:${l.id}`); setAviso(`A lista ${l.name} agora se chama ${nome}.`); onMudou();
  };
  const paiDaNovaPasta = pastaEscolhida && estrutura.folders.some((f) => f.id === pastaEscolhida) ? pastaEscolhida : null;
  const criarPasta = async (nome: string) => {
    const criada = await apiPost<{ id: string }>('/trabalho/pastas', paiDaNovaPasta ? { name: nome, parentId: paiDaNovaPasta } : { name: nome }, token);
    setEditando(null);
    if (criada?.id) setFocarDepois(`pasta:${criada.id}`);
    setAviso(`Pasta ${nome} criada${paiDaNovaPasta ? ` dentro de ${caminhoDaPasta(estrutura.folders, paiDaNovaPasta)}` : ''}.`);
    onMudou();
  };

  // ---------- desenho ----------

  const classeDoAlvo = (chave: string) => (alvo === chave ? 'ring-1 ring-brand-dim' : '');

  const linhaDaLista = (l: TrabListaDto, paiId: string | null) => {
    const protegida = l.id === implantacao?.listaId ? TRAB_LISTA_DA_IMPLANTACAO_PROTEGIDA : null;
    const chave = `lista:${l.id}`;
    const irmaos = listasDe(paiId);
    return (
      <div
        key={l.id}
        className={`flex items-center gap-0.5 rounded-md ${classeDoAlvo(chave)}`}
        onDragOver={sobre(chave, (a) => a.tipo === 'lista' && a.id !== l.id && (a.paiId === paiId || a.id !== implantacao?.listaId))}
        onDragLeave={() => { if (alvo === chave) setAlvo(null); }}
        onDrop={soltar((a) => {
          if (a.tipo !== 'lista') return;
          if (a.paiId === paiId) reordenarAntesDe('lista', a.id, paiId, l.id);
          else moverLista(a.id, paiId, l.id);
        })}
      >
        {editando?.tipo === 'lista' && editando.id === l.id ? (
          <NomeNoLugar
            inicial={l.name} rotulo={`Novo nome da lista ${l.name}`} testId={`trabalho-arvore-renomear-lista-${l.id}`}
            conferir={(n) => (nomeRepetido(n, irmaos, l.id) ? TRAB_NOME_DE_LISTA_REPETIDO : null)}
            aoSalvar={renomearLista(l)} aoSair={() => { setEditando(null); setFocarDepois(chave); }}
          />
        ) : (
          <button
            type="button"
            data-arvore-item={chave}
            data-testid={`trabalho-arvore-lista-${l.id}`}
            draggable={editable}
            onDragStart={comecar({ tipo: 'lista', id: l.id, paiId })}
            onDragEnd={terminar}
            onClick={() => onSelecionarLista(l.id)}
            onDoubleClick={() => { if (editable && !protegida) setEditando({ tipo: 'lista', id: l.id }); }}
            onKeyDown={teclas('lista', l.id)}
            aria-current={l.id === listaId ? 'page' : undefined}
            aria-keyshortcuts={editable ? 'Alt+ArrowUp Alt+ArrowDown F2' : undefined}
            className={[
              'flex min-w-0 flex-1 items-center justify-between rounded-md px-2 py-1 text-left text-[13px] transition focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-dim',
              l.id === listaId ? 'bg-brand/15 text-text' : 'text-muted hover:bg-surface-2 hover:text-text',
            ].join(' ')}
          >
            <span title={l.name} className="min-w-0 break-words">{l.name}</span>
            <span className="ml-1 text-[10px] text-muted">{l.total}</span>
          </button>
        )}
        {editable && (
          <AcoesDaListaNaArvore
            lista={l} token={token} protegida={protegida} destinos={destinosDaLista(l.id)}
            aoRenomear={() => setEditando({ tipo: 'lista', id: l.id })}
            aoExcluir={() => onListaSaiu(l.id)} aoMudar={onMudou} aoErro={onErro} aoAviso={setAviso}
          />
        )}
      </div>
    );
  };

  const noDaPasta = (f: Pasta, nivel: number): React.ReactNode => {
    const filhas = pastas.filter((p) => p.parentId === f.id);
    const protegida = f.id === implantacao?.pastaId ? TRAB_PASTA_DA_IMPLANTACAO_PROTEGIDA : null;
    const chave = `pasta:${f.id}`;
    const conteudo = { listas: f.lists.length, pastas: estrutura.folders.filter((x) => x.parentId === f.id).length };
    return (
      <div key={f.id} data-testid={`trabalho-arvore-no-${f.id}`} className={nivel > 0 ? 'ml-2 border-l border-border pl-1.5' : ''}>
        {/* A faixa ENTRE pastas: soltar aqui põe a pasta arrastada antes desta (M3). */}
        {editable && (
          <div
            aria-hidden
            data-testid={`trabalho-arvore-entre-${f.id}`}
            className={`-mt-1 mb-0.5 h-1.5 rounded ${alvo === `entre:${f.id}` ? 'bg-brand-dim' : ''}`}
            onDragOver={sobre(`entre:${f.id}`, (a) => a.tipo === 'pasta' && a.id !== f.id)}
            onDragLeave={() => { if (alvo === `entre:${f.id}`) setAlvo(null); }}
            onDrop={soltar((a) => {
              if (a.tipo !== 'pasta') return;
              const pai = f.parentId ?? null;
              if (a.paiId === pai) reordenarAntesDe('pasta', a.id, pai, f.id);
              else moverPastaArrastada(a.id, pai, f.id);
            })}
          />
        )}
        <div
          className={`flex items-start justify-between gap-1 rounded-md ${classeDoAlvo(chave)}`}
          onDragOver={sobre(chave, (a) => (a.tipo === 'lista'
            ? a.paiId !== f.id && a.id !== implantacao?.listaId
            : a.id !== f.id && a.paiId !== f.id))}
          onDragLeave={() => { if (alvo === chave) setAlvo(null); }}
          onDrop={soltar((a) => {
            if (a.tipo === 'lista') moverLista(a.id, f.id);
            // Pasta solta SOBRE a pasta: vai para dentro dela (M3).
            else moverPastaArrastada(a.id, f.id);
          })}
        >
          {editando?.tipo === 'pasta' && editando.id === f.id ? (
            <NomeNoLugar
              inicial={f.name} rotulo={`Novo nome da pasta ${f.name}`} testId={`trabalho-arvore-renomear-pasta-${f.id}`}
              conferir={(n) => (nomeRepetido(n, irmasDaPasta(f.parentId ?? null, f.spaceId ?? null), f.id) ? TRAB_NOME_DE_PASTA_REPETIDO : null)}
              aoSalvar={renomearPasta(f)} aoSair={() => { setEditando(null); setFocarDepois(chave); }}
            />
          ) : (
            <div
              title={f.name}
              data-arvore-item={chave}
              data-testid={`trabalho-arvore-pasta-${f.id}`}
              tabIndex={editable ? 0 : undefined}
              aria-label={editable ? `Pasta ${f.name}` : undefined}
              aria-keyshortcuts={editable ? 'Alt+ArrowUp Alt+ArrowDown F2' : undefined}
              draggable={editable}
              onDragStart={comecar({ tipo: 'pasta', id: f.id, paiId: f.parentId ?? null })}
              onDragEnd={terminar}
              onDoubleClick={() => { if (editable && !protegida) setEditando({ tipo: 'pasta', id: f.id }); }}
              onKeyDown={teclas('pasta', f.id)}
              className="min-w-0 flex-1 break-words rounded px-1 text-[11px] font-semibold uppercase tracking-wide text-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-dim"
            >
              {f.name}
            </div>
          )}
          {editable && (
            <AcoesDaPastaNaArvore
              pasta={f} conteudo={conteudo} protegida={protegida} destinos={destinosDaPasta(f.id)} token={token}
              destinosParaMover={destinosParaMover(f)} emPrimeiroNivel={!f.parentId}
              aoMover={(parentId) => pedirMoverPasta(f.id, parentId)}
              aoRenomear={() => setEditando({ tipo: 'pasta', id: f.id })}
              aoErro={(m) => { onErro(m); onMudou(); }} aoAviso={setAviso}
              aoExcluir={() => onPastaSaiu(f.id)}
            />
          )}
        </div>
        <div className="mt-1 space-y-0.5">
          {f.lists.length === 0 && conteudo.pastas === 0 && <p className="px-2 text-[11px] text-muted">Pasta vazia. Crie uma lista nela ou arraste uma para cá.</p>}
          {f.lists.map((l) => linhaDaLista(l, f.id))}
        </div>
        {filhas.length > 0 && <div className="mt-2 space-y-2">{filhas.map((x) => noDaPasta(x, nivel + 1))}</div>}
      </div>
    );
  };

  return (
    <div ref={raiz} className="space-y-3" data-testid="trabalho-arvore">
      {raizes.map((f) => noDaPasta(f, 0))}
      {/*
        LISTAS SEM PASTA também aparecem na árvore. Antes da esteira elas só
        existiam por importação; com o modelo, uma empresa sem pastas cria a
        lista solta, e ela sumiria da navegação se a árvore só desenhasse pastas.
        O título é alvo de arraste: soltar uma lista nele tira a lista da pasta.
      */}
      {mostraSoltas && (estrutura.listasSoltas.length > 0 || (editable && pastas.length > 0)) && (
        <div>
          <div
            data-testid="trabalho-arvore-sem-pasta"
            className={`rounded-md px-1 text-[11px] font-semibold uppercase tracking-wide text-muted ${classeDoAlvo('sem-pasta')}`}
            onDragOver={sobre('sem-pasta', (a) => a.tipo === 'lista' && a.paiId !== null && a.id !== implantacao?.listaId)}
            onDragLeave={() => { if (alvo === 'sem-pasta') setAlvo(null); }}
            onDrop={soltar((a) => { if (a.tipo === 'lista') moverLista(a.id, null); })}
          >
            Sem pasta
          </div>
          <div className="mt-1 space-y-0.5">
            {estrutura.listasSoltas.length === 0 && <p className="px-2 text-[11px] text-muted">Arraste uma lista para cá para tirá-la da pasta.</p>}
            {estrutura.listasSoltas.map((l) => linhaDaLista(l, null))}
          </div>
        </div>
      )}
      {editable && (
        <div className="space-y-1">
          {novaLista}
          {editando?.tipo === 'nova-pasta' ? (
            <NomeNoLugar
              inicial="" rotulo="Nome da nova pasta" testId="trabalho-arvore-nova-pasta-nome"
              conferir={(n) => (nomeRepetido(n, paiDaNovaPasta ? filhasDe(paiDaNovaPasta) : irmasDaPasta(null, null)) ? TRAB_NOME_DE_PASTA_REPETIDO : null)}
              aoSalvar={criarPasta} aoSair={() => { setEditando(null); setFocarDepois('nova-pasta'); }}
            />
          ) : (
            <button
              type="button" data-arvore-item="nova-pasta" data-testid="trabalho-arvore-nova-pasta"
              onClick={() => setEditando({ tipo: 'nova-pasta' })}
              title={paiDaNovaPasta ? `Nova pasta dentro de ${caminhoDaPasta(estrutura.folders, paiDaNovaPasta)}` : 'Nova pasta no topo'}
              className="flex items-center gap-1 px-1 text-xs text-muted hover:text-brand"
            >
              <Plus size={12} /> nova pasta
            </button>
          )}
        </div>
      )}
      <ArquivadasDaArvore token={token} editable={editable} versao={estrutura} onMudou={onMudou} onAviso={setAviso} />
      <p role="status" data-testid="trabalho-arvore-aviso" className="break-words px-1 text-[11px] text-muted empty:hidden">{aviso ?? ''}</p>
    </div>
  );
}
