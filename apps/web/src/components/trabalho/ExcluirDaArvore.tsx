'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { MoreHorizontal, X } from 'lucide-react';
import {
  nomeParaConfirmar, fraseDosCamposGuardados,
  type TrabListaExcluida, type TrabListaTarefasArquivadas, type TrabListaTarefasMovidas,
  type TrabPastaExcluida, type TrabPastaExcluidaComDestino,
} from '@mktos/shared';
import { apiDelete, apiPost } from '@/lib/api';
import { posicaoDoMenu, type PosicaoDoMenu } from '@/lib/posicao-do-menu';

/*
 * O MENU "⋯" DA ÁRVORE E OS DIÁLOGOS DE EXCLUIR (P3 e A3, 21/10/2026).
 *
 * É como o Rodrigo limpa o Trabalho. As regras são da API
 * (`WorkService.apagarLista`, `apagarPasta`, `excluirPastaComDestino`,
 * `moverTarefasDaLista`); a tela só não oferece o que a API recusaria:
 *  · Renomear abre o nome no próprio lugar da árvore (quem desenha é a árvore);
 *  · excluir lista pede o nome escrito. Com tarefa ativa, o diálogo pergunta o que
 *    fazer com elas: MOVER para outra lista (mesmos ids, etapa pelo nome) ou
 *    ARQUIVAR todas, e só então a lista sai. Lista vazia é apagada; a que guarda
 *    tarefas arquivadas é arquivada. Para quem usa, as duas são "excluir";
 *  · excluir pasta vazia é uma confirmação simples. Com listas ou pastas dentro,
 *    o diálogo pede o destino delas (outra pasta ou Sem pasta) e nenhuma lista
 *    some junto: elas mudam de lugar com as tarefas, e depois a pasta sai;
 *  · "Mover para…" na pasta (M3, 22/10/2026) é o caminho do teclado para o mesmo
 *    arraste de pasta sobre pasta: escolhe a pasta de destino ou o primeiro nível;
 *    os destinos já vêm sem ela, sem as de dentro dela e sem as fundas demais;
 *  · mover as tarefas leva os campos de mesmo nome e tipo; o aviso conta os que
 *    ficaram guardados na lista de origem;
 *  · a lista da implantação e a pasta Clientes que a guarda mostram o menu com os
 *    itens desabilitados e a frase do porquê.
 * O menu abre pelo teclado (Enter ou espaço no botão), as setas andam entre os
 * itens, Esc fecha e o foco volta para o botão "⋯".
 *
 * Produção 22B, I1 (22/10/2026): o menu abre por PORTAL, fixo na janela e
 * posicionado pelo botão (`posicaoDoMenu`): vira para cima ou para a esquerda
 * quando falta espaço e nunca é mais largo que a janela, com o texto inteiro
 * quebrando linha em vez de cortar. O "⋯" só aparece com o mouse sobre a linha
 * ou com o foco nela (quem desenha a linha marca `group/arvore`); em tela de
 * toque, sem hover, ele fica sempre visível. Aberto, continua visível.
 */

type Acao = 'excluir-lista' | 'arquivar-tarefas' | 'excluir-pasta';

export interface ItemDoMenu { chave: string; texto: string; dica?: string; desabilitado?: boolean; aoEscolher: () => void }

/** A largura pedida do menu do "⋯" (cabe o texto das dicas sem cortar; a janela estreita encolhe). */
export const LARGURA_DO_MENU_DA_ARVORE = 272;

/**
 * As classes do "⋯": escondido até o mouse passar pela linha ou o foco entrar nela;
 * sempre visível no toque (sem hover) e enquanto o menu estiver aberto.
 */
export const CLASSE_DO_GATILHO_DA_ARVORE =
  'opacity-0 group-hover/arvore:opacity-100 group-focus-within/arvore:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 [@media(hover:none)]:opacity-100';

function MenuDaArvore({ rotulo, testId, itens, gatilho }: {
  rotulo: string; testId: string; itens: ItemDoMenu[];
  /** O botão "⋯": quem fecha um diálogo aberto daqui devolve o foco para ele. */
  gatilho: React.RefObject<HTMLButtonElement | null>;
}) {
  const [aberto, setAberto] = useState(false);
  const [posicao, setPosicao] = useState<PosicaoDoMenu | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const habilitados = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [])];
  // Mede o menu já desenhado e o põe onde cabe, antes de pintar.
  useLayoutEffect(() => {
    if (!aberto) { setPosicao(null); return; }
    const b = gatilho.current?.getBoundingClientRect();
    if (!b) return;
    setPosicao(posicaoDoMenu(b, { largura: LARGURA_DO_MENU_DA_ARVORE, altura: menu.current?.scrollHeight ?? 0 }, { largura: window.innerWidth, altura: window.innerHeight }));
  }, [aberto, itens.length, gatilho]);
  useEffect(() => {
    if (!aberto) return;
    habilitados()[0]?.focus({ preventScroll: true });
    const dentro = (alvo: EventTarget | null) => alvo instanceof Node && (!!menu.current?.contains(alvo) || !!gatilho.current?.contains(alvo));
    const fora = (e: MouseEvent) => { if (!dentro(e.target)) setAberto(false); };
    // Fixo na janela: rolar a página ou mudar a janela tiraria o menu de perto do botão. Fecha,
    // mas só se o botão saiu do lugar: o evento da rolagem que trouxe o "⋯" à vista chega um quadro
    // depois do clique (roda do mouse, rolagem suave, o foco no primeiro item) e fecharia o menu
    // que acabou de abrir.
    const onde = gatilho.current?.getBoundingClientRect();
    const rolou = (e: Event) => {
      if (dentro(e.target)) return;
      const agora = gatilho.current?.getBoundingClientRect();
      if (onde && agora && Math.abs(agora.top - onde.top) < 2 && Math.abs(agora.left - onde.left) < 2) return;
      setAberto(false);
    };
    const mudouAJanela = () => setAberto(false);
    document.addEventListener('mousedown', fora);
    document.addEventListener('scroll', rolou, true);
    window.addEventListener('resize', mudouAJanela);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('scroll', rolou, true);
      window.removeEventListener('resize', mudouAJanela);
    };
  }, [aberto, gatilho]);
  const fechar = () => { setAberto(false); gatilho.current?.focus(); };
  const andar = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(); return; }
    // O menu mora no fim da página (portal): o Tab volta ao "⋯" em vez de fugir para lá.
    if (e.key === 'Tab') { e.preventDefault(); fechar(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const lista = habilitados();
    if (!lista.length) return;
    const atual = lista.indexOf(document.activeElement as HTMLButtonElement);
    const proximo = e.key === 'Home' ? 0 : e.key === 'End' ? lista.length - 1
      : e.key === 'ArrowDown' ? (atual + 1) % lista.length : (atual - 1 + lista.length) % lista.length;
    lista[proximo]?.focus();
  };
  return (
    <span className="relative shrink-0">
      <button
        ref={gatilho}
        type="button"
        data-testid={testId}
        // O nome acessível não repete o nome da lista: ele já é o do botão ao lado. O título diz de quem é.
        aria-label="Mais ações"
        title={rotulo}
        aria-haspopup="menu"
        aria-expanded={aberto}
        onClick={(e) => { e.stopPropagation(); setAberto((a) => !a); }}
        className={`rounded p-0.5 text-muted transition-opacity hover:bg-surface-2 hover:text-text max-md:min-h-[44px] max-md:min-w-[44px] ${CLASSE_DO_GATILHO_DA_ARVORE}`}
      >
        <MoreHorizontal size={14} />
      </button>
      {aberto && typeof document !== 'undefined' && createPortal(
        <div
          ref={menu} role="menu" aria-label={rotulo} onKeyDown={andar} data-testid={`${testId}-menu`} data-lado={posicao?.lado}
          style={{
            position: 'fixed', top: posicao?.top ?? 0, left: posicao?.left ?? 0,
            width: posicao?.largura ?? LARGURA_DO_MENU_DA_ARVORE, maxWidth: 'calc(100vw - 16px)',
            maxHeight: posicao?.maxAltura ?? undefined, opacity: posicao ? 1 : 0,
          }}
          className="z-50 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg"
        >
          {itens.map((it) => (
            <button
              key={it.chave}
              type="button"
              role="menuitem"
              data-testid={`${testId}-${it.chave}`}
              disabled={it.desabilitado}
              onClick={() => { setAberto(false); it.aoEscolher(); }}
              className="block w-full whitespace-normal break-words rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-surface-2 focus:bg-surface-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
            >
              {it.texto}
              {it.dica && <span className="block text-[11px] text-muted">{it.dica}</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </span>
  );
}

function Confirmacao({ titulo, children, aoFechar, gatilho }: {
  titulo: string; children: React.ReactNode; aoFechar: () => void; gatilho: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <Dialog.Root open onOpenChange={(a) => { if (!a) aoFechar(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          // O foco volta ao "⋯" de onde o diálogo saiu (o item do menu já não existe).
          onCloseAutoFocus={(e) => { e.preventDefault(); gatilho.current?.focus(); }}
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 space-y-3 overflow-y-auto rounded-xl border border-border bg-surface p-4"
        >
          <div className="flex items-start justify-between gap-2">
            <Dialog.Title className="min-w-0 break-words text-base font-semibold">{titulo}</Dialog.Title>
            <Dialog.Close aria-label="Fechar" className="text-muted hover:text-text"><X size={16} /></Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const BOTAO = 'min-h-10 rounded-lg border px-3 text-sm disabled:opacity-50';
const SELETOR = 'w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none focus:border-brand-dim disabled:opacity-60';

/** Um destino possível: o id e como ele aparece ("Pasta / Lista", "Sem pasta / Lista"). */
export interface DestinoDaArvore { id: string; rotulo: string }

const tarefasNoPlural = (n: number) => (n === 1 ? '1 tarefa' : `${n} tarefas`);

/**
 * A frase do porquê a lista não sai direto (I3): ela tem tarefa ativa. O mesmo menu
 * oferece "Arquivar todas as N tarefas", e o excluir pergunta para onde elas vão.
 */
export function porqueNaoSaiDireto(vivas: number): string | undefined {
  if (vivas <= 0) return undefined;
  return vivas === 1
    ? 'Tem 1 tarefa ativa: antes de sair, ela vai para outra lista ou é arquivada.'
    : `Tem ${vivas} tarefas ativas: antes de sair, elas vão para outra lista ou são arquivadas.`;
}

/** A frase do porquê a pasta não sai direto: o que aparece dentro dela. */
export function porqueAPastaNaoSaiDireto(conteudo: { listas: number; pastas: number }): string | undefined {
  const partes = [
    conteudo.listas ? (conteudo.listas === 1 ? '1 lista' : `${conteudo.listas} listas`) : null,
    conteudo.pastas ? (conteudo.pastas === 1 ? '1 pasta' : `${conteudo.pastas} pastas`) : null,
  ].filter(Boolean).join(' e ');
  if (!partes) return undefined;
  const um = conteudo.listas + conteudo.pastas === 1;
  return `Tem ${partes} dentro: antes de sair, ${um ? 'vai' : 'vão'} para outra pasta ou Sem pasta.`;
}

/** O menu da lista na árvore: renomear, arquivar todas, excluir (movendo ou arquivando as tarefas antes). */
export function AcoesDaListaNaArvore({ lista, token, protegida, destinos = [], aoRenomear, aoAparencia, aoExcluir, aoMudar, aoErro, aoAviso }: {
  lista: { id: string; name: string; total: number };
  token: string | null;
  /** A frase do porquê, quando a lista é protegida (a da implantação): renomear e excluir ficam desabilitados. */
  protegida?: string | null;
  /** As listas que podem receber as tarefas (sem ela, sem a da implantação, sem as de cadastro). */
  destinos?: DestinoDaArvore[];
  aoRenomear?: () => void;
  /** "Ícone e cor" (I1): quem chama abre o seletor. */
  aoAparencia?: () => void;
  /** A lista saiu do Trabalho: quem chama fecha a lista se ela estava aberta. */
  aoExcluir: (r: TrabListaExcluida) => void;
  aoMudar: () => void;
  aoErro: (m: string) => void;
  aoAviso?: (m: string) => void;
}) {
  const gatilho = useRef<HTMLButtonElement>(null);
  const [acao, setAcao] = useState<Acao | null>(null);
  const [nome, setNome] = useState('');
  const [escolha, setEscolha] = useState<'mover' | 'arquivar' | ''>('');
  const [destino, setDestino] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const vivas = lista.total;
  const fechar = () => { setAcao(null); setNome(''); setEscolha(''); setDestino(''); setErro(null); };
  const nomeConfere = nomeParaConfirmar(nome) === nomeParaConfirmar(lista.name) && nome.trim() !== '';
  const rota = `/trabalho/listas/${encodeURIComponent(lista.id)}`;
  const mudouNoMeio = (e: unknown) => {
    if ((e as { status?: number }).status !== 409) return false;
    fechar(); aoErro('A lista mudou enquanto você confirmava. A tela foi atualizada; confira e tente de novo.'); aoMudar();
    return true;
  };

  const excluirDepois = (antes: string | null) => apiDelete<TrabListaExcluida>(rota, token, { confirmarNome: nome })
    .then((r) => { fechar(); if (antes) aoAviso?.(antes); aoExcluir(r); })
    .catch((e) => {
      // O primeiro passo já valeu: as tarefas mudaram. A lista fica, e a tela diz isso.
      if (antes) { aoMudar(); setErro(`${antes} A lista não saiu: ${(e as Error).message}`); return; }
      if (!mudouNoMeio(e)) setErro((e as Error).message);
    });

  const excluir = () => {
    setOcupado(true); setErro(null);
    let passo: Promise<unknown>;
    if (vivas === 0) passo = excluirDepois(null);
    else if (escolha === 'mover') {
      const alvo = destinos.find((d) => d.id === destino);
      passo = apiPost<TrabListaTarefasMovidas>(`${rota}/mover-tarefas`, { destinoId: destino, esperadas: vivas }, token)
        .then((r) => {
          const etapa = r.mudaramDeEtapa > 0
            ? ` ${r.mudaramDeEtapa === 1 ? '1 mudou' : `${r.mudaramDeEtapa} mudaram`} de etapa (o destino não tem etapa com o mesmo nome).`
            : '';
          const campos = fraseDosCamposGuardados(r.camposGuardados ?? 0);
          return excluirDepois(`${tarefasNoPlural(r.movidas)} ${r.movidas === 1 ? 'foi' : 'foram'} para ${alvo?.rotulo ?? 'a outra lista'}.${etapa}${campos ? ` ${campos}` : ''}`);
        })
        .catch((e) => { if (!mudouNoMeio(e)) setErro((e as Error).message); });
    } else {
      passo = apiPost<TrabListaTarefasArquivadas>(`${rota}/arquivar-tarefas`, { esperadas: vivas }, token)
        .then((r) => excluirDepois(`${tarefasNoPlural(r.arquivadas)} ${r.arquivadas === 1 ? 'foi arquivada' : 'foram arquivadas'}.`))
        .catch((e) => { if (!mudouNoMeio(e)) setErro((e as Error).message); });
    }
    void passo.finally(() => setOcupado(false));
  };
  const arquivar = () => {
    setOcupado(true); setErro(null);
    apiPost<TrabListaTarefasArquivadas>(`${rota}/arquivar-tarefas`, { esperadas: vivas }, token)
      .then(() => { fechar(); aoMudar(); })
      .catch((e) => { if (!mudouNoMeio(e)) setErro((e as Error).message); })
      .finally(() => setOcupado(false));
  };

  const plural = vivas === 1 ? 'tarefa' : 'tarefas';
  const escolhaPronta = vivas === 0 || escolha === 'arquivar' || (escolha === 'mover' && !!destino);
  const textoDoBotao = vivas === 0 ? 'Excluir lista' : escolha === 'mover' ? 'Mover e excluir' : escolha === 'arquivar' ? 'Arquivar e excluir' : 'Excluir lista';
  return (
    <>
      <MenuDaArvore
        gatilho={gatilho}
        rotulo={`Ações da lista ${lista.name}`}
        testId={`trabalho-lista-acoes-${lista.id}`}
        itens={[
          ...(aoRenomear ? [{ chave: 'renomear', texto: 'Renomear', desabilitado: !!protegida, dica: protegida ?? undefined, aoEscolher: aoRenomear }] : []),
          ...(aoAparencia ? [{ chave: 'aparencia', texto: 'Ícone e cor', aoEscolher: aoAparencia }] : []),
          ...(vivas > 0 && !protegida ? [{ chave: 'arquivar', texto: vivas === 1 ? 'Arquivar a única tarefa' : `Arquivar todas as ${vivas} tarefas`, dica: 'Elas saem das listas e continuam guardadas.', aoEscolher: () => setAcao('arquivar-tarefas') }] : []),
          {
            chave: 'excluir', texto: 'Excluir lista', desabilitado: !!protegida,
            dica: protegida ?? porqueNaoSaiDireto(vivas),
            aoEscolher: () => setAcao('excluir-lista'),
          },
        ]}
      />
      {acao === 'arquivar-tarefas' && (
        <Confirmacao gatilho={gatilho} titulo={vivas === 1 ? `Arquivar a tarefa de ${lista.name}?` : `Arquivar as ${vivas} tarefas de ${lista.name}?`} aoFechar={fechar}>
          <p className="text-sm text-muted">
            As tarefas saem do quadro, de Todas e do Dia a dia. Nada é apagado: o filtro Incluir arquivadas mostra de novo.
          </p>
          {erro && <p role="alert" className="text-sm text-bad">{erro}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Dialog.Close className={`${BOTAO} border-border text-muted`}>Cancelar</Dialog.Close>
            <button type="button" data-testid="trabalho-arquivar-tarefas-confirmar" disabled={ocupado} onClick={arquivar} className={`${BOTAO} border-brand-dim text-brand`}>
              {ocupado ? 'Arquivando…' : `Arquivar ${vivas} ${plural}`}
            </button>
          </div>
        </Confirmacao>
      )}
      {acao === 'excluir-lista' && (
        <Confirmacao gatilho={gatilho} titulo={`Excluir a lista ${lista.name}?`} aoFechar={fechar}>
          {vivas === 0 ? (
            <p className="text-sm text-muted">A lista sai do Trabalho. Se ela guarda tarefas arquivadas, elas continuam guardadas.</p>
          ) : (
            <fieldset className="space-y-2 text-sm" data-testid="trabalho-excluir-lista-escolha">
              <legend className="mb-1 text-muted">
                A lista tem {tarefasNoPlural(vivas)} {vivas === 1 ? 'ativa' : 'ativas'}. O que fazer com {vivas === 1 ? 'ela' : 'elas'} antes de excluir?
              </legend>
              <label className="flex items-start gap-2">
                <input
                  type="radio" name={`destino-${lista.id}`} value="mover" data-testid="trabalho-excluir-lista-mover"
                  checked={escolha === 'mover'} disabled={destinos.length === 0} onChange={() => setEscolha('mover')} className="mt-1"
                />
                <span>
                  Mover {vivas === 1 ? 'a tarefa' : `as ${vivas} tarefas`} para outra lista
                  <span className="block text-[12px] text-muted">
                    {destinos.length === 0 ? 'Não há outra lista de tarefas que possa receber.' : 'Mesmas tarefas, mesma etapa quando o destino tem uma de mesmo nome.'}
                  </span>
                </span>
              </label>
              {escolha === 'mover' && (
                <select
                  aria-label="Lista que recebe as tarefas" data-testid="trabalho-excluir-lista-destino"
                  value={destino} onChange={(e) => setDestino(e.target.value)} className={SELETOR}
                >
                  <option value="">Escolha a lista</option>
                  {destinos.map((d) => <option key={d.id} value={d.id}>{d.rotulo}</option>)}
                </select>
              )}
              <label className="flex items-start gap-2">
                <input
                  type="radio" name={`destino-${lista.id}`} value="arquivar" data-testid="trabalho-excluir-lista-arquivar"
                  checked={escolha === 'arquivar'} onChange={() => setEscolha('arquivar')} className="mt-1"
                />
                <span>
                  Arquivar {vivas === 1 ? 'a tarefa' : `as ${vivas} tarefas`} e excluir
                  <span className="block text-[12px] text-muted">Nada é apagado: as arquivadas continuam guardadas.</span>
                </span>
              </label>
            </fieldset>
          )}
          <label className="block space-y-1 text-sm">
            <span>Para confirmar, escreva o nome da lista</span>
            <input
              autoFocus={vivas === 0} data-testid="trabalho-excluir-lista-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120}
              onKeyDown={(e) => { if (e.key === 'Enter' && nomeConfere && escolhaPronta && !ocupado) excluir(); }}
              placeholder={lista.name}
              className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none focus:border-brand-dim"
            />
          </label>
          {erro && <p role="alert" className="text-sm text-bad">{erro}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Dialog.Close className={`${BOTAO} border-border text-muted`}>Cancelar</Dialog.Close>
            <button type="button" data-testid="trabalho-excluir-lista-confirmar" disabled={!nomeConfere || !escolhaPronta || ocupado} onClick={excluir} className={`${BOTAO} border-bad/50 text-bad`}>
              {ocupado ? 'Excluindo…' : textoDoBotao}
            </button>
          </div>
        </Confirmacao>
      )}
    </>
  );
}

const SEM_PASTA = '__sem-pasta__';
const PRIMEIRO_NIVEL = '__primeiro-nivel__';

/** O menu da pasta na árvore: renomear, mover para outra pasta e excluir (vazia, ou levando o que está dentro para outro lugar). */
export function AcoesDaPastaNaArvore({ pasta, conteudo, protegida, destinos = [], destinosParaMover, emPrimeiroNivel = false, token, aoRenomear, aoAparencia, aoMover, aoExcluir, aoErro, aoAviso }: {
  pasta: { id: string; name: string };
  /** Listas e pastas que APARECEM dentro dela (as arquivadas não contam). */
  conteudo: { listas: number; pastas: number };
  /** A frase do porquê, quando a pasta é protegida (Clientes com a lista da implantação). */
  protegida?: string | null;
  /** As pastas que podem receber (sem ela e sem as que estão dentro dela). "Sem pasta" vem sempre. */
  destinos?: DestinoDaArvore[];
  /** Para onde ela pode ir em "Mover para…" (sem ela, sem as de dentro, sem as fundas demais e sem a mãe atual). */
  destinosParaMover?: DestinoDaArvore[];
  /** Já está no primeiro nível: "Primeiro nível" não aparece como destino. */
  emPrimeiroNivel?: boolean;
  token: string | null;
  aoRenomear?: () => void;
  /** "Ícone e cor" (I1): quem chama abre o seletor. */
  aoAparencia?: () => void;
  /** Move a pasta (nulo = primeiro nível); quem chama fala com a API e avisa. */
  aoMover?: (parentId: string | null) => Promise<void>;
  aoExcluir: (r: TrabPastaExcluida) => void;
  aoErro: (m: string) => void;
  aoAviso?: (m: string) => void;
}) {
  const gatilho = useRef<HTMLButtonElement>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [movendo, setMovendo] = useState(false);
  const [paraOnde, setParaOnde] = useState('');
  const [destino, setDestino] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const vazia = conteudo.listas + conteudo.pastas === 0;
  const fechar = () => { setConfirmando(false); setMovendo(false); setParaOnde(''); setDestino(''); setErro(null); };
  const opcoesDeMover = [...(emPrimeiroNivel ? [] : [{ id: PRIMEIRO_NIVEL, rotulo: 'Primeiro nível' }]), ...(destinosParaMover ?? [])];
  const mover = () => {
    if (!aoMover || !paraOnde) return;
    setOcupado(true); setErro(null);
    aoMover(paraOnde === PRIMEIRO_NIVEL ? null : paraOnde)
      .then(fechar)
      .catch((e) => setErro((e as Error).message))
      .finally(() => setOcupado(false));
  };
  const recusa = (e: unknown) => {
    if ((e as { status?: number }).status === 409 && /mudou/.test((e as Error).message)) { fechar(); aoErro((e as Error).message); return; }
    setErro((e as Error).message);
  };
  const excluir = () => {
    setOcupado(true); setErro(null);
    const pedido = vazia
      ? apiDelete<TrabPastaExcluida>(`/trabalho/pastas/${encodeURIComponent(pasta.id)}`, token).then((r) => { fechar(); aoExcluir(r); })
      : apiPost<TrabPastaExcluidaComDestino>(`/trabalho/pastas/${encodeURIComponent(pasta.id)}/excluir`, {
        destino: destino === SEM_PASTA ? { semPasta: true } : { folderId: destino },
        esperadas: conteudo,
      }, token).then((r) => {
        const para = destino === SEM_PASTA ? 'Sem pasta' : destinos.find((d) => d.id === destino)?.rotulo ?? 'a outra pasta';
        const partes = [
          r.listasMovidas ? (r.listasMovidas === 1 ? '1 lista' : `${r.listasMovidas} listas`) : null,
          r.pastasMovidas ? (r.pastasMovidas === 1 ? '1 pasta' : `${r.pastasMovidas} pastas`) : null,
        ].filter(Boolean).join(' e ');
        fechar();
        aoAviso?.(`A pasta ${pasta.name} saiu; ${partes} ${r.listasMovidas + r.pastasMovidas === 1 ? 'foi' : 'foram'} para ${para}, com as tarefas.`);
        aoExcluir(r);
      });
    pedido.catch(recusa).finally(() => setOcupado(false));
  };
  const resumo = [
    conteudo.listas ? (conteudo.listas === 1 ? '1 lista' : `${conteudo.listas} listas`) : null,
    conteudo.pastas ? (conteudo.pastas === 1 ? '1 pasta' : `${conteudo.pastas} pastas`) : null,
  ].filter(Boolean).join(' e ');
  return (
    <>
      <MenuDaArvore
        gatilho={gatilho}
        rotulo={`Ações da pasta ${pasta.name}`}
        testId={`trabalho-pasta-acoes-${pasta.id}`}
        itens={[
          ...(aoRenomear ? [{ chave: 'renomear', texto: 'Renomear', desabilitado: !!protegida, dica: protegida ?? undefined, aoEscolher: aoRenomear }] : []),
          ...(aoAparencia ? [{ chave: 'aparencia', texto: 'Ícone e cor', aoEscolher: aoAparencia }] : []),
          ...(aoMover ? [{
            chave: 'mover', texto: 'Mover para…', desabilitado: !!protegida || opcoesDeMover.length === 0,
            dica: protegida ?? (opcoesDeMover.length === 0 ? 'Não há outra pasta que possa receber esta.' : undefined),
            aoEscolher: () => setMovendo(true),
          }] : []),
          {
            chave: 'excluir', texto: 'Excluir pasta', desabilitado: !!protegida,
            dica: protegida ?? porqueAPastaNaoSaiDireto(conteudo),
            aoEscolher: () => setConfirmando(true),
          },
        ]}
      />
      {movendo && (
        <Confirmacao gatilho={gatilho} titulo={`Mover a pasta ${pasta.name}`} aoFechar={fechar}>
          <p className="text-sm text-muted">A pasta vai com as listas e as pastas de dentro, e as tarefas não mudam.</p>
          <label className="block space-y-1 text-sm">
            <span>Para onde</span>
            <select
              autoFocus aria-label="Para onde vai a pasta" data-testid="trabalho-mover-pasta-destino"
              value={paraOnde} onChange={(e) => setParaOnde(e.target.value)} className={SELETOR}
            >
              <option value="">Escolha o destino</option>
              {opcoesDeMover.map((d) => <option key={d.id} value={d.id}>{d.rotulo}</option>)}
            </select>
          </label>
          {erro && <p role="alert" className="text-sm text-bad">{erro}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Dialog.Close className={`${BOTAO} border-border text-muted`}>Cancelar</Dialog.Close>
            <button type="button" data-testid="trabalho-mover-pasta-confirmar" disabled={ocupado || !paraOnde} onClick={mover} className={`${BOTAO} border-brand-dim text-brand`}>
              {ocupado ? 'Movendo…' : 'Mover pasta'}
            </button>
          </div>
        </Confirmacao>
      )}
      {confirmando && (
        <Confirmacao gatilho={gatilho} titulo={`Excluir a pasta ${pasta.name}?`} aoFechar={fechar}>
          {vazia ? (
            <p className="text-sm text-muted">A pasta está vazia e sai do Trabalho.</p>
          ) : (
            <div className="space-y-2 text-sm">
              <p className="text-muted">
                A pasta tem {resumo} dentro. Nenhuma lista é apagada: elas mudam de lugar com as tarefas, e depois a pasta sai.
              </p>
              <label className="block space-y-1">
                <span>Para onde {conteudo.listas + conteudo.pastas === 1 ? 'vai' : 'vão'}</span>
                <select
                  autoFocus aria-label="Para onde vão as listas e pastas" data-testid="trabalho-excluir-pasta-destino"
                  value={destino} onChange={(e) => setDestino(e.target.value)} className={SELETOR}
                >
                  <option value="">Escolha o destino</option>
                  {destinos.map((d) => <option key={d.id} value={d.id}>{d.rotulo}</option>)}
                  <option value={SEM_PASTA}>Sem pasta</option>
                </select>
              </label>
            </div>
          )}
          {erro && <p role="alert" className="text-sm text-bad">{erro}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Dialog.Close className={`${BOTAO} border-border text-muted`}>Cancelar</Dialog.Close>
            <button type="button" data-testid="trabalho-excluir-pasta-confirmar" disabled={ocupado || (!vazia && !destino)} onClick={excluir} className={`${BOTAO} border-bad/50 text-bad`}>
              {ocupado ? 'Excluindo…' : vazia ? 'Excluir pasta' : 'Mover e excluir a pasta'}
            </button>
          </div>
        </Confirmacao>
      )}
    </>
  );
}
