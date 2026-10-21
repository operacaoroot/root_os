'use client';

import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { MoreHorizontal, X } from 'lucide-react';
import { nomeParaConfirmar, type TrabListaExcluida, type TrabListaTarefasArquivadas, type TrabPastaExcluida } from '@mktos/shared';
import { apiDelete, apiPost } from '@/lib/api';

/*
 * EXCLUIR LISTA E PASTA PELA ÁRVORE (rodada de produção 1, P3, 21/10/2026).
 *
 * É como o Rodrigo limpa o Trabalho daqui para a frente. As regras são da API
 * (`WorkService.apagarLista`/`apagarPasta`); a tela só não oferece o que a API
 * recusaria:
 *  · a lista sai só vazia ou com todas as tarefas arquivadas. Com tarefa viva, o
 *    menu oferece antes "Arquivar todas as N tarefas" (uma escrita condicionada ao
 *    N que a tela mostrou);
 *  · excluir pede o nome da lista escrito (sem diferença de maiúscula nem de
 *    espaço). Lista vazia é apagada; a que guarda tarefas arquivadas é arquivada,
 *    e as tarefas ficam no banco. Para quem usa, as duas são "excluir";
 *  · a pasta sai só sem lista nem pasta dentro;
 *  · a lista da implantação não tem o menu (a API também recusa).
 */

type Acao = 'excluir-lista' | 'arquivar-tarefas' | 'excluir-pasta';

function MenuDaArvore({ rotulo, testId, itens }: {
  rotulo: string; testId: string;
  itens: { chave: string; texto: string; dica?: string; desabilitado?: boolean; aoEscolher: () => void }[];
}) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);
  return (
    <span ref={caixa} className="relative shrink-0">
      <button
        type="button"
        data-testid={testId}
        // O nome acessível não repete o nome da lista: ele já é o do botão ao lado. O título diz de quem é.
        aria-label="Mais ações"
        title={rotulo}
        aria-haspopup="menu"
        aria-expanded={aberto}
        onClick={(e) => { e.stopPropagation(); setAberto((a) => !a); }}
        className="rounded p-0.5 text-muted hover:bg-surface-2 hover:text-text max-md:min-h-[44px] max-md:min-w-[44px]"
      >
        <MoreHorizontal size={14} />
      </button>
      {aberto && (
        <div role="menu" aria-label={rotulo} className="absolute right-0 top-full z-30 mt-1 w-56 rounded-lg border border-border bg-surface p-1 shadow-lg">
          {itens.map((it) => (
            <button
              key={it.chave}
              type="button"
              role="menuitem"
              data-testid={`${testId}-${it.chave}`}
              disabled={it.desabilitado}
              onClick={() => { setAberto(false); it.aoEscolher(); }}
              className="block w-full rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
            >
              {it.texto}
              {it.dica && <span className="block text-[11px] text-muted">{it.dica}</span>}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

function Confirmacao({ titulo, children, aoFechar }: { titulo: string; children: React.ReactNode; aoFechar: () => void }) {
  return (
    <Dialog.Root open onOpenChange={(a) => { if (!a) aoFechar(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 space-y-3 rounded-xl border border-border bg-surface p-4">
          <div className="flex items-start justify-between gap-2">
            <Dialog.Title className="text-base font-semibold">{titulo}</Dialog.Title>
            <Dialog.Close aria-label="Fechar" className="text-muted hover:text-text"><X size={16} /></Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const BOTAO = 'min-h-10 rounded-lg border px-3 text-sm disabled:opacity-50';

/** O menu da lista na árvore: excluir (só vazia ou toda arquivada) ou arquivar todas antes. */
export function AcoesDaListaNaArvore({ lista, token, aoExcluir, aoMudar, aoErro }: {
  lista: { id: string; name: string; total: number };
  token: string | null;
  /** A lista saiu do Trabalho: quem chama fecha a lista se ela estava aberta. */
  aoExcluir: (r: TrabListaExcluida) => void;
  aoMudar: () => void;
  aoErro: (m: string) => void;
}) {
  const [acao, setAcao] = useState<Acao | null>(null);
  const [nome, setNome] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const vivas = lista.total;
  const fechar = () => { setAcao(null); setNome(''); setErro(null); };
  const nomeConfere = nomeParaConfirmar(nome) === nomeParaConfirmar(lista.name) && nome.trim() !== '';

  const excluir = () => {
    setOcupado(true); setErro(null);
    apiDelete<TrabListaExcluida>(`/trabalho/listas/${encodeURIComponent(lista.id)}`, token, { confirmarNome: nome })
      .then((r) => { fechar(); aoExcluir(r); })
      .catch((e) => setErro((e as Error).message))
      .finally(() => setOcupado(false));
  };
  const arquivar = () => {
    setOcupado(true); setErro(null);
    apiPost<TrabListaTarefasArquivadas>(`/trabalho/listas/${encodeURIComponent(lista.id)}/arquivar-tarefas`, { esperadas: vivas }, token)
      .then(() => { fechar(); aoMudar(); })
      .catch((e) => {
        if ((e as { status?: number }).status === 409) { fechar(); aoErro('A lista mudou enquanto você confirmava. A tela foi atualizada; confira e tente de novo.'); aoMudar(); return; }
        setErro((e as Error).message);
      })
      .finally(() => setOcupado(false));
  };

  const plural = vivas === 1 ? 'tarefa' : 'tarefas';
  return (
    <>
      <MenuDaArvore
        rotulo={`Ações da lista ${lista.name}`}
        testId={`trabalho-lista-acoes-${lista.id}`}
        itens={[
          ...(vivas > 0 ? [{ chave: 'arquivar', texto: vivas === 1 ? 'Arquivar a única tarefa' : `Arquivar todas as ${vivas} tarefas`, dica: 'Elas saem das listas e continuam guardadas.', aoEscolher: () => setAcao('arquivar-tarefas') }] : []),
          {
            chave: 'excluir', texto: 'Excluir lista', desabilitado: vivas > 0,
            dica: vivas === 1 ? 'Arquive a tarefa antes.' : vivas > 1 ? `Arquive as ${vivas} tarefas antes.` : undefined,
            aoEscolher: () => setAcao('excluir-lista'),
          },
        ]}
      />
      {acao === 'arquivar-tarefas' && (
        <Confirmacao titulo={vivas === 1 ? `Arquivar a tarefa de ${lista.name}?` : `Arquivar as ${vivas} tarefas de ${lista.name}?`} aoFechar={fechar}>
          <p className="text-sm text-muted">
            As tarefas saem do quadro, de Todas e do Dia a dia. Nada é apagado: o filtro Incluir arquivadas mostra de novo.
          </p>
          {erro && <p role="alert" className="text-sm text-bad">{erro}</p>}
          <div className="flex justify-end gap-2">
            <Dialog.Close className={`${BOTAO} border-border text-muted`}>Cancelar</Dialog.Close>
            <button type="button" data-testid="trabalho-arquivar-tarefas-confirmar" disabled={ocupado} onClick={arquivar} className={`${BOTAO} border-brand-dim text-brand`}>
              {ocupado ? 'Arquivando…' : `Arquivar ${vivas} ${plural}`}
            </button>
          </div>
        </Confirmacao>
      )}
      {acao === 'excluir-lista' && (
        <Confirmacao titulo={`Excluir a lista ${lista.name}?`} aoFechar={fechar}>
          <p className="text-sm text-muted">
            A lista sai do Trabalho. Se ela guarda tarefas arquivadas, elas continuam guardadas.
          </p>
          <label className="block space-y-1 text-sm">
            <span>Para confirmar, escreva o nome da lista</span>
            <input
              autoFocus data-testid="trabalho-excluir-lista-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120}
              onKeyDown={(e) => { if (e.key === 'Enter' && nomeConfere && !ocupado) excluir(); }}
              placeholder={lista.name}
              className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none focus:border-brand-dim"
            />
          </label>
          {erro && <p role="alert" className="text-sm text-bad">{erro}</p>}
          <div className="flex justify-end gap-2">
            <Dialog.Close className={`${BOTAO} border-border text-muted`}>Cancelar</Dialog.Close>
            <button type="button" data-testid="trabalho-excluir-lista-confirmar" disabled={!nomeConfere || ocupado} onClick={excluir} className={`${BOTAO} border-bad/50 text-bad`}>
              {ocupado ? 'Excluindo…' : 'Excluir lista'}
            </button>
          </div>
        </Confirmacao>
      )}
    </>
  );
}

/** O menu da pasta na árvore: excluir só a pasta sem lista nem pasta dentro. */
export function AcoesDaPastaNaArvore({ pasta, vazia, token, aoExcluir, aoErro }: {
  pasta: { id: string; name: string };
  /** Sem lista e sem pasta dentro (as arquivadas não aparecem e não contam). */
  vazia: boolean;
  token: string | null;
  aoExcluir: (r: TrabPastaExcluida) => void;
  aoErro: (m: string) => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const excluir = () => {
    setOcupado(true); setErro(null);
    apiDelete<TrabPastaExcluida>(`/trabalho/pastas/${encodeURIComponent(pasta.id)}`, token)
      .then((r) => { setConfirmando(false); aoExcluir(r); })
      .catch((e) => { if ((e as { status?: number }).status === 409) { setConfirmando(false); aoErro((e as Error).message); return; } setErro((e as Error).message); })
      .finally(() => setOcupado(false));
  };
  return (
    <>
      <MenuDaArvore
        rotulo={`Ações da pasta ${pasta.name}`}
        testId={`trabalho-pasta-acoes-${pasta.id}`}
        itens={[{
          chave: 'excluir', texto: 'Excluir pasta', desabilitado: !vazia,
          dica: vazia ? undefined : 'Só sai a pasta sem lista nenhuma. Mova ou exclua as listas antes.',
          aoEscolher: () => setConfirmando(true),
        }]}
      />
      {confirmando && (
        <Confirmacao titulo={`Excluir a pasta ${pasta.name}?`} aoFechar={() => { setConfirmando(false); setErro(null); }}>
          <p className="text-sm text-muted">A pasta está vazia e sai do Trabalho.</p>
          {erro && <p role="alert" className="text-sm text-bad">{erro}</p>}
          <div className="flex justify-end gap-2">
            <Dialog.Close className={`${BOTAO} border-border text-muted`}>Cancelar</Dialog.Close>
            <button type="button" data-testid="trabalho-excluir-pasta-confirmar" disabled={ocupado} onClick={excluir} className={`${BOTAO} border-bad/50 text-bad`}>
              {ocupado ? 'Excluindo…' : 'Excluir pasta'}
            </button>
          </div>
        </Confirmacao>
      )}
    </>
  );
}
