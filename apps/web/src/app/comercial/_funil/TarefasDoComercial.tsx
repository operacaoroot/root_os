'use client';

/*
 * AS TAREFAS DO COMERCIAL (adendo de 21/10/2026, §A1).
 *
 * Duas portas para as mesmas tarefas (`/comercial/tarefas`):
 *   · o bloco "Tarefas do comercial" no topo do Funil vivo: as SEM lead (as
 *     internas da máquina comercial), recolhível com o estado lembrado, com a
 *     contagem no cabeçalho e o filtro "Responsável" do funil valendo para ele;
 *   · o bloco "Tarefas" do painel do lead (`TarefasDoLead`): as ligadas a ele.
 *
 * Nos dois: "+ tarefa" na linha (título, responsável, prazo; Enter salva, Esc
 * desfaz), concluir com um clique e editar título, responsável e prazo. A aberta
 * igual (a regra e a frase do Dia a dia) não nasce de novo: a tela confere com o
 * que tem à vista e a API confere de novo com todas (M3, 22/10/2026). Toda
 * escrita leva a versão lida; outra aba que salvou no meio dá a frase da API.
 * Por baixo é `WorkTask` (a lista do comercial), mas ela mora e se edita aqui.
 */
import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { TAREFA_IGUAL_JA_EXISTE, tarefaIgual, type TarefaDoComercial, type TarefasDoComercial } from '@mktos/shared';

import { apiPatch, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dataDoDia } from '@/lib/cockpit';

import { BOTAO, BOTAO_PRIMARIO, Chip, Erro, ErroDaAcao, FOCO, INPUT, useCarregar } from '../_ui';
import { useMudouNoPainel } from '../_painel/provedor';
import { BotaoDoMenuDaTarefa, MenuDaTarefaProvider, alvoDoMenu, useMenuDaTarefa } from '@/components/trabalho/MenuDaTarefa';
import { PilhaDeAvatares } from '@/components/PilhaDeAvatares';
import { TarefaFlutuante } from '@/components/trabalho/TrabalhoView';
import { useTarefaNaUrl } from '@/lib/tarefa-na-url';

/** Onde o bloco do funil guarda se está aberto ou recolhido. */
export const CHAVE_DO_BLOCO_RECOLHIDO = 'mktos.funil.tarefas-do-comercial.recolhido';

/** O caminho da leitura: as do lead, ou as sem lead com o filtro de responsável do funil. */
export function caminhoDasTarefas(f: { leadId?: string | null; pessoa?: string | null }): string {
  const q = new URLSearchParams();
  if (f.leadId) q.set('leadId', f.leadId);
  else q.set('semLead', '1');
  if (f.pessoa) q.set('pessoa', f.pessoa);
  return `/comercial/tarefas?${q.toString()}`;
}

/** A resposta pode não ter o formato (rota fora do ar, dublê de teste): nada quebra, a lista fica vazia. */
function tarefasDe(d: TarefasDoComercial | null): TarefaDoComercial[] {
  return Array.isArray(d?.tarefas) ? d.tarefas : [];
}

function pessoasDe(d: TarefasDoComercial | null): { id: string; nome: string }[] {
  return Array.isArray(d?.pessoas) ? d.pessoas : [];
}

const ROTULO_DA_SITUACAO: Partial<Record<TarefaDoComercial['situacao'], string>> = {
  atrasada: 'atrasada',
  hoje: 'hoje',
};

/** "Ana · prazo 22/10 · atrasada": o que a linha diz embaixo do título (em texto, para onde não há avatar). */
export function detalheDaTarefa(t: Pick<TarefaDoComercial, 'pessoa' | 'responsavelTexto' | 'prazo' | 'situacao'>): string {
  return [t.pessoa?.nome ?? t.responsavelTexto ?? 'sem responsável', prazoDaTarefa(t)].join(' · ');
}

/** "prazo 22/10 · atrasada": o detalhe sem o responsável, que na linha vai como avatar (I6). */
export function prazoDaTarefa(t: Pick<TarefaDoComercial, 'prazo' | 'situacao'>): string {
  const partes = [t.prazo ? `prazo ${dataDoDia(t.prazo)}` : 'sem prazo'];
  const s = ROTULO_DA_SITUACAO[t.situacao];
  if (s) partes.push(s);
  return partes.join(' · ');
}

type Campos = { titulo: string; pessoaId: string; prazo: string };

/**
 * O formulário da linha: criar e editar usam o mesmo. Enter (em qualquer campo)
 * salva; Esc desfaz e devolve o foco a quem abriu.
 */
function FormDaTarefa({
  inicial,
  pessoas,
  rotulo,
  testId,
  aoSalvar,
  aoDesfazer,
}: {
  inicial: Campos;
  pessoas: { id: string; nome: string }[];
  rotulo: string;
  testId: string;
  aoSalvar: (c: Campos) => Promise<void>;
  aoDesfazer: () => void;
}) {
  const [c, setC] = useState<Campos>(inicial);
  const [erro, setErro] = useState<unknown>(null);
  const [salvando, setSalvando] = useState(false);
  const titulo = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => titulo.current?.focus(), []);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!c.titulo.trim() || salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      await aoSalvar(c);
    } catch (er) {
      setErro(er);
      setSalvando(false);
    }
  }

  return (
    <form
      aria-label={rotulo}
      data-testid={testId}
      onSubmit={salvar}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.nativeEvent.isComposing) return;
        // O Esc é do formulário: não fecha o painel do lead nem o menu de trás.
        e.preventDefault();
        e.stopPropagation();
        aoDesfazer();
      }}
      className="flex min-w-0 flex-wrap items-end gap-1.5 rounded border border-border bg-surface-2 p-2"
    >
      <label className="min-w-0 flex-[1_1_12rem]">
        <span className="sr-only">título da tarefa</span>
        <input
          ref={titulo}
          value={c.titulo}
          onChange={(e) => setC({ ...c, titulo: e.target.value })}
          maxLength={300}
          placeholder="o que precisa ser feito"
          aria-describedby={id}
          data-testid={`${testId}-titulo`}
          // O painel do lead pergunta antes de fechar com texto digitado; o título que só veio preenchido não conta.
          data-painel-ignorar={c.titulo === inicial.titulo ? '' : undefined}
          className={INPUT}
        />
      </label>
      <label className="min-w-0 flex-[1_1_8rem]">
        <span className="sr-only">responsável</span>
        <select value={c.pessoaId} onChange={(e) => setC({ ...c, pessoaId: e.target.value })} data-testid={`${testId}-pessoa`} className={INPUT}>
          <option value="">sem responsável</option>
          {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
      </label>
      <label className="min-w-0 flex-[1_1_8rem]">
        <span className="sr-only">prazo</span>
        <input type="date" value={c.prazo} onChange={(e) => setC({ ...c, prazo: e.target.value })} data-testid={`${testId}-prazo`} className={INPUT} />
      </label>
      <span className="flex gap-1.5">
        <button type="submit" disabled={!c.titulo.trim() || salvando} className={BOTAO_PRIMARIO}>salvar</button>
        <button type="button" onClick={aoDesfazer} className={BOTAO}>cancelar</button>
      </span>
      <p id={id} className="w-full text-[11px] text-dim">Enter salva, Esc desfaz.</p>
      {erro ? <div className="w-full"><ErroDaAcao erro={erro} /></div> : null}
    </form>
  );
}

/** Uma tarefa: concluir com um clique e editar na própria linha. */
function LinhaDaTarefa({
  t,
  pessoas,
  podeEditar,
  aoMudar,
  aoAbrir,
}: {
  t: TarefaDoComercial;
  pessoas: { id: string; nome: string }[];
  podeEditar: boolean;
  aoMudar: () => Promise<void>;
  /** Abre a tarefa numa janela por cima da tela (sem sair dela). Sem isto, o título leva ao Trabalho. */
  aoAbrir?: (id: string) => void;
}) {
  const { token } = useAuth();
  const [editando, setEditando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  const editar = useRef<HTMLButtonElement>(null);
  const feita = t.status.tipo === 'concluida';
  // O menu da tarefa (produção 3, I4): botão direito, Shift+F10, tecla Menu e o "⋯".
  const menu = useMenuDaTarefa();

  async function alternar() {
    if (ocupado) return;
    setOcupado(true);
    setErro(null);
    try {
      await apiPatch(`/comercial/tarefas/${encodeURIComponent(t.id)}`, { expectedUpdatedAt: t.updatedAt, etapa: feita ? 'aberta' : 'concluida' }, token);
      await aoMudar();
    } catch (e) {
      setErro(e);
    } finally {
      setOcupado(false);
    }
  }

  if (editando) {
    return (
      <li>
        <FormDaTarefa
          inicial={{ titulo: t.titulo, pessoaId: t.pessoa?.id ?? '', prazo: t.prazo ?? '' }}
          pessoas={pessoas}
          rotulo={`Editar a tarefa ${t.titulo}`}
          testId={`tarefa-editar-${t.id}`}
          aoSalvar={async (c) => {
            // Só o que mudou vai à API: o resto da tarefa fica como está.
            const corpo: Record<string, unknown> = { expectedUpdatedAt: t.updatedAt };
            if (c.titulo.trim() !== t.titulo) corpo.titulo = c.titulo.trim();
            if ((c.pessoaId || null) !== (t.pessoa?.id ?? null)) corpo.pessoaId = c.pessoaId || null;
            if ((c.prazo || null) !== (t.prazo ?? null)) corpo.prazo = c.prazo || null;
            if (Object.keys(corpo).length > 1) await apiPatch(`/comercial/tarefas/${encodeURIComponent(t.id)}`, corpo, token);
            setEditando(false);
            await aoMudar();
          }}
          aoDesfazer={() => {
            setEditando(false);
            requestAnimationFrame(() => editar.current?.focus());
          }}
        />
      </li>
    );
  }

  return (
    <li {...alvoDoMenu(menu, { id: t.id, title: t.titulo })} data-testid={`tarefa-${t.id}`} className="flex min-w-0 items-start gap-2 py-1.5">
      <button
        type="button"
        role="checkbox"
        aria-checked={feita}
        aria-label={feita ? `reabrir ${t.titulo}` : `concluir ${t.titulo}`}
        data-testid={`tarefa-concluir-${t.id}`}
        disabled={!podeEditar || ocupado}
        onClick={() => void alternar()}
        // No celular o alvo do toque tem 44 px; a caixa desenhada continua pequena.
        className={`group mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm max-md:-my-3 max-md:h-11 max-md:w-11 disabled:cursor-not-allowed disabled:opacity-50 ${FOCO}`}
      >
        <span aria-hidden className={`flex h-4 w-4 items-center justify-center rounded-sm border text-[10px] leading-none ${feita ? 'border-good bg-good/20 text-good' : 'border-border group-hover:border-brand'}`}>{feita ? '✓' : ''}</span>
      </button>
      <div className="min-w-0 flex-1">
        {/* Layout 26/10: o título abre a tarefa por cima da tela (fechar volta para cá); sem janela, leva ao Trabalho. */}
        {aoAbrir ? (
          <button type="button" onClick={() => aoAbrir(t.id)} data-testid={`tarefa-abrir-${t.id}`} className={`block break-words rounded-sm text-left text-[12.5px] hover:text-brand hover:underline ${FOCO} ${feita ? 'text-dim line-through' : ''}`}>{t.titulo}</button>
        ) : (
          <Link href={`/trabalho?tarefa=${encodeURIComponent(t.id)}`} data-testid={`tarefa-abrir-${t.id}`} className={`block break-words rounded-sm text-[12.5px] hover:text-brand hover:underline ${FOCO} ${feita ? 'text-dim line-through' : ''}`}>{t.titulo}</Link>
        )}
        <p className={`flex min-w-0 items-center gap-1.5 text-[11px] ${t.situacao === 'atrasada' ? 'text-warn' : 'text-dim'}`}>
          {/* O responsável só com a imagem, o nome no balão (I6); o texto antigo sem conta vira as iniciais. */}
          <PilhaDeAvatares
            pessoas={t.pessoa ? [{ id: t.pessoa.id, nome: t.pessoa.nome }] : t.responsavelTexto ? [{ nome: t.responsavelTexto, rotulo: `${t.responsavelTexto} (sem conta)` }] : []}
            prefixo="Responsável"
            testId={`tarefa-responsavel-${t.id}`}
          />
          <span>{prazoDaTarefa(t)}</span>
        </p>
        <ErroDaAcao erro={erro} />
      </div>
      {podeEditar && !feita && (
        <button
          ref={editar}
          type="button"
          onClick={() => setEditando(true)}
          aria-label={`editar ${t.titulo}`}
          data-testid={`tarefa-editar-botao-${t.id}`}
          className={`shrink-0 rounded border border-border px-1.5 font-os-mono text-[10px] text-muted hover:border-brand hover:text-text max-md:min-h-[44px] max-md:min-w-[44px] ${FOCO}`}
        >
          editar
        </button>
      )}
      <BotaoDoMenuDaTarefa tarefa={{ id: t.id, title: t.titulo }} className="mt-0.5" />
    </li>
  );
}

/**
 * A lista com "+ tarefa", as abertas e as concluídas recolhidas. Serve ao bloco
 * do funil (sem lead) e ao painel do lead (com `leadId`, e a tarefa nova já
 * nasce ligada a ele).
 */
export function ListaDeTarefasDoComercial({
  dados,
  leadId,
  testId,
  aoMudar,
  vazio,
  aoAbrir,
}: {
  dados: TarefasDoComercial | null;
  leadId?: string | null;
  testId: string;
  aoMudar: () => Promise<void>;
  vazio: string;
  aoAbrir?: (id: string) => void;
}) {
  const { token, can } = useAuth();
  const podeEditar = can('leads.editar') && can('tarefas.editar');
  const [criando, setCriando] = useState(false);
  const [verFeitas, setVerFeitas] = useState(false);
  const mais = useRef<HTMLButtonElement>(null);
  const tarefas = tarefasDe(dados);
  const pessoas = pessoasDe(dados);
  const abertas = tarefas.filter((t) => t.status.tipo !== 'concluida');
  const feitas = tarefas.filter((t) => t.status.tipo === 'concluida');

  return (
    <MenuDaTarefaProvider onMudou={() => void aoMudar()}>
    <div className="min-w-0 space-y-1.5" data-testid={testId}>
      {abertas.length === 0 && !criando && <p className="text-[12px] text-dim">{vazio}</p>}
      {abertas.length > 0 && (
        <ul className="divide-y divide-border">
          {abertas.map((t) => <LinhaDaTarefa key={t.id} t={t} pessoas={pessoas} podeEditar={podeEditar} aoMudar={aoMudar} aoAbrir={aoAbrir} />)}
        </ul>
      )}
      {podeEditar && (criando ? (
        <FormDaTarefa
          inicial={{ titulo: '', pessoaId: '', prazo: '' }}
          pessoas={pessoas}
          rotulo="Nova tarefa"
          testId={`${testId}-nova`}
          aoSalvar={async (c) => {
            if (tarefaIgual(abertas, c.titulo, (t) => t.titulo)) throw new Error(TAREFA_IGUAL_JA_EXISTE);
            await apiPost('/comercial/tarefas', {
              titulo: c.titulo.trim(),
              ...(leadId ? { leadId } : {}),
              ...(c.pessoaId ? { pessoaId: c.pessoaId } : {}),
              ...(c.prazo ? { prazo: c.prazo } : {}),
            }, token);
            setCriando(false);
            await aoMudar();
            requestAnimationFrame(() => mais.current?.focus());
          }}
          aoDesfazer={() => {
            setCriando(false);
            requestAnimationFrame(() => mais.current?.focus());
          }}
        />
      ) : (
        <button ref={mais} type="button" data-testid={`${testId}-mais`} onClick={() => setCriando(true)} className={BOTAO}>
          + tarefa
        </button>
      ))}
      {feitas.length > 0 && (
        <div>
          <button
            type="button"
            aria-expanded={verFeitas}
            data-testid={`${testId}-feitas`}
            onClick={() => setVerFeitas((v) => !v)}
            className={`rounded-sm text-[11.5px] text-muted underline decoration-border underline-offset-2 hover:text-text max-md:min-h-[44px] ${FOCO}`}
          >
            {verFeitas ? 'esconder' : 'ver'} as concluídas ({feitas.length})
          </button>
          {verFeitas && (
            <ul className="mt-1 divide-y divide-border">
              {feitas.map((t) => <LinhaDaTarefa key={t.id} t={t} pessoas={pessoas} podeEditar={podeEditar} aoMudar={aoMudar} aoAbrir={aoAbrir} />)}
            </ul>
          )}
        </div>
      )}
    </div>
    </MenuDaTarefaProvider>
  );
}

/** Lê do navegador se o bloco estava recolhido (o padrão é aberto). */
function lerRecolhido(): boolean {
  try {
    return window.localStorage.getItem(CHAVE_DO_BLOCO_RECOLHIDO) === '1';
  } catch {
    return false;
  }
}

/**
 * O BLOCO DO FUNIL VIVO: as tarefas do comercial sem lead, no topo do funil,
 * no quadro e na lista. `pessoa` é o filtro "Responsável" do painel de Filtros
 * (id, `eu` ou `sem`); vazio mostra todas.
 */
export function BlocoDeTarefasDoComercial({ pessoa }: { pessoa: string }) {
  const [recolhido, setRecolhido] = useState(false);
  useEffect(() => setRecolhido(lerRecolhido()), []);
  const { dados, erro, recarregar } = useCarregar<TarefasDoComercial>(caminhoDasTarefas({ pessoa }), 60_000);
  // Layout 26/10: a tarefa abre por cima do funil; fechar volta para o funil, no mesmo lugar.
  const popup = useTarefaNaUrl();
  // A tarefa mudada no painel de um lead pode ter sido desligada dele e cair aqui.
  useMudouNoPainel(recarregar);
  const corpo = useId();
  const abertas = typeof dados?.abertas === 'number' ? dados.abertas : tarefasDe(dados).filter((t) => t.status.tipo !== 'concluida').length;
  const atrasadas = tarefasDe(dados).filter((t) => t.situacao === 'atrasada').length;

  const alternar = () => {
    const novo = !recolhido;
    setRecolhido(novo);
    try {
      window.localStorage.setItem(CHAVE_DO_BLOCO_RECOLHIDO, novo ? '1' : '0');
    } catch {
      /* navegador sem armazenamento: o bloco só não lembra */
    }
  };

  return (
    <section aria-label="Tarefas do comercial" data-testid="funil-tarefas-do-comercial" className="min-w-0 shrink-0 rounded border border-border bg-bg2">
      <h2 className="m-0">
        <button
          type="button"
          aria-expanded={!recolhido}
          aria-controls={corpo}
          data-testid="funil-tarefas-alternar"
          onClick={alternar}
          className={`flex w-full min-w-0 items-center gap-2 rounded px-2.5 py-1.5 text-left max-md:min-h-[44px] ${FOCO}`}
        >
          <span aria-hidden className="font-os-mono text-[10px] text-muted">{recolhido ? '▸' : '▾'}</span>
          <span className="font-os-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">Tarefas do comercial</span>
          <span className="font-os-mono text-[10.5px] tabular-nums text-text" data-testid="funil-tarefas-contagem">{abertas}</span>
          {atrasadas > 0 && <Chip tom="alerta">{atrasadas} {atrasadas === 1 ? 'atrasada' : 'atrasadas'}</Chip>}
          {pessoa && <span className="truncate text-[11px] text-dim">filtro de responsável do funil</span>}
        </button>
      </h2>
      <div id={corpo} hidden={recolhido} className="max-h-[38dvh] overflow-y-auto border-t border-border px-2.5 py-2">
        <Erro erro={erro} aoTentar={() => void recarregar()} />
        <ListaDeTarefasDoComercial
          dados={dados}
          testId="funil-tarefas"
          aoMudar={recarregar}
          aoAbrir={popup.abrir}
          vazio="Nenhuma tarefa do comercial sem lead aberta. As de um lead aparecem no cartão e no painel dele."
        />
      </div>
      <TarefaFlutuante tarefa={popup} onMudou={() => void recarregar()} />
    </section>
  );
}

