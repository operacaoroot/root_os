'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { PainelDeTarefas, SituacaoDoPrazo, TarefaDoDia, TrabEstrutura } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Numero, Quadro } from '@/components/painel';
import { AvatarDaPessoa } from '@/components/AvatarDaPessoa';
import { Barras, type Fatia } from './graficos';
import { TarefaFlutuante } from '@/components/trabalho/TrabalhoView';
import { useTarefaNaUrl } from '@/lib/tarefa-na-url';

/*
 * DIA A DIA › VISÃO GERAL (versão final, 19/10/2026): o dash das tarefas do
 * Lucas (atrasadas, sem responsável, feitas na semana, por pessoa), com o
 * "por área" trocado por POR PASTA e POR LISTA do Trabalho (decisão 4 do
 * Rodrigo: a `WorkArea` fica no esquema, a organização é pasta e lista).
 *
 * A lista de todas as tarefas não mora mais aqui: ela é "Todas" no Trabalho.
 * Todo número e toda coluna abrem o Trabalho já filtrado, pelos parâmetros
 * que a tela do Trabalho lê (`pasta`, `lista`, `visao`, `assigneeUserId`,
 * `semResponsavel`, `overdue`); o recorte de prazo que o Trabalho ainda não
 * tem como filtro vai em `prazo` (hoje, proximos_7, sem_prazo) e as
 * concluídas em `concluidas=1`.
 */

const SEM = 'sem';
const SEM_PASTA = 'sem-pasta';
const TODAS = 'todas';
/** Quantas listas o gráfico mostra; o resto soma numa coluna só. */
const LISTAS_NO_GRAFICO = 12;

const NOME_DA_SITUACAO: Record<SituacaoDoPrazo, string> = {
  atrasada: 'Atrasadas', hoje: 'Hoje', proximos_7: 'Próximos 7 dias', mais_tarde: 'Mais tarde', sem_prazo: 'Sem prazo', feita: 'Concluídas',
};
const FORTE = 'rgb(var(--os-ac))';
const MEDIO = 'rgb(var(--os-ac) / 0.45)';
const FRACO = 'rgb(var(--os-tx2) / 0.3)';
const VERMELHO = 'rgb(var(--os-err))';
const COR_DA_SITUACAO: Record<SituacaoDoPrazo, string> = {
  atrasada: VERMELHO, hoje: FORTE, proximos_7: MEDIO, mais_tarde: MEDIO, sem_prazo: FRACO, feita: FORTE,
};
const ABERTAS: SituacaoDoPrazo[] = ['atrasada', 'hoje', 'proximos_7', 'sem_prazo'];
const colunasDoPrazo = (tarefas: TarefaDoDia[]): SituacaoDoPrazo[] =>
  tarefas.some((t) => t.situacao === 'mais_tarde') ? ['atrasada', 'hoje', 'proximos_7', 'mais_tarde', 'sem_prazo'] : ABERTAS;
const primeiro = (nome: string) => nome.split(' ')[0];

type Recorte = SituacaoDoPrazo | 'emdia';
export interface FiltroDaVisaoGeral { pessoa?: string; situacao?: Recorte; pasta?: string; lista?: string }

/** O endereço do Trabalho já filtrado: é para onde todo clique da Visão geral leva. */
export function urlDoTrabalho(f: FiltroDaVisaoGeral): string {
  const q = new URLSearchParams();
  q.set('pasta', f.pasta ?? TODAS);
  if (f.lista) q.set('lista', f.lista);
  q.set('visao', 'lista');
  if (f.pessoa === SEM) q.set('semResponsavel', '1');
  else if (f.pessoa) q.set('assigneeUserId', f.pessoa);
  if (f.situacao === 'atrasada') q.set('overdue', '1');
  // Layout 26/10 (P-21): "feitas" abre só as concluídas (antes mostrava as concluídas JUNTO com as abertas)
  // e o número de abertas abre sem as concluídas.
  else if (f.situacao === 'feita') q.set('prazo', 'feita');
  else if (f.situacao) q.set('prazo', f.situacao);
  if (f.situacao !== 'feita') q.set('concluidas', 'ocultar');
  return `/trabalho?${q}`;
}

/**
 * A pasta de cima de cada lista (a árvore sobe pelo `parentId`): "Clientes"
 * junta Esteira, Onboarding de cliente e Execução. Lista solta = sem pasta.
 */
export function pastasDasListas(e: TrabEstrutura): Map<string, { id: string; nome: string }> {
  const porId = new Map(e.folders.map((f) => [f.id, f]));
  const raiz = (id: string) => {
    let f = porId.get(id);
    const vistos = new Set<string>();
    while (f?.parentId && porId.has(f.parentId) && !vistos.has(f.id)) {
      vistos.add(f.id);
      f = porId.get(f.parentId);
    }
    return f ? { id: f.id, nome: f.name } : null;
  };
  const out = new Map<string, { id: string; nome: string }>();
  for (const f of e.folders) {
    const r = raiz(f.id);
    if (r) for (const l of f.lists) out.set(l.id, r);
  }
  return out;
}

/**
 * `meio`: o que entra logo abaixo dos quatro números (a página do Dia a dia põe
 * ali WhatsApp e Implantação lado a lado). Sem `meio`, fica a Implantação, como antes.
 */
export function VisaoGeralDasTarefas({ meio }: { meio?: ReactNode } = {}) {
  const { token, ready } = useAuth();
  const [p, setP] = useState<PainelDeTarefas | null>(null);
  const [estrutura, setEstrutura] = useState<TrabEstrutura | null>(null);
  // Layout 26/10: clicar num número abre AQUI a lista exata das tarefas contadas (as do comercial
  // inclusas, que o Trabalho não mostra); cada uma abre por cima e fechar volta para cá.
  const [recorte, setRecorte] = useState<FiltroDaVisaoGeral | null>(null);
  const popup = useTarefaNaUrl();
  const [versao, setVersao] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (!ready || !token) return;
    apiGet<PainelDeTarefas>('/trabalho/todas', token).then(setP).catch((e) => setErro(e.message));
    // Sem a estrutura o dash mostra as listas, e as pastas ficam sem nome (não some número).
    apiGet<TrabEstrutura>('/trabalho/estrutura', token).then(setEstrutura).catch(() => setEstrutura(null));
  }, [ready, token, versao]);
  // O que vem em `meio` (WhatsApp e Implantação) não espera as tarefas: aparece mesmo com
  // as tarefas carregando ou com erro (antes, o erro do dash derrubava o cartão do WhatsApp).
  if (erro) return <div className="space-y-5"><div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{erro}</div>{meio}</div>;
  if (!p) return <div className="space-y-5"><p className="text-muted">Carregando as tarefas…</p>{meio}</div>;
  const abrir = (f: FiltroDaVisaoGeral) => setRecorte(f);

  const abertas = p.tarefas.filter((t) => t.situacao !== 'feita');
  const conta = (s: SituacaoDoPrazo) => abertas.filter((t) => t.situacao === s).length;
  const semDono = abertas.filter((t) => !t.pessoa).length;
  const seteDiasAtras = new Date(Date.now() - 7 * 86400e3).toISOString();
  const feitas = p.tarefas.filter((t) => t.situacao === 'feita' && t.updatedAt >= seteDiasAtras).length;
  const atrasadasDe = (lista: TarefaDoDia[]) => `${lista.filter((t) => t.situacao === 'atrasada').length} atrasadas`;

  const porSituacao: Fatia[] = colunasDoPrazo(abertas).map((s) => ({
    chave: s, rotulo: NOME_DA_SITUACAO[s], valor: conta(s), cor: COR_DA_SITUACAO[s], onClick: () => abrir({ situacao: s }),
  }));
  const porPessoa: Fatia[] = [
    ...p.pessoas.map((pe) => {
      const delas = abertas.filter((t) => t.pessoas.some((x) => x.id === pe.id));
      return { chave: pe.id, rotulo: primeiro(pe.nome), valor: delas.length, cor: FORTE, dica: atrasadasDe(delas), onClick: () => abrir({ pessoa: pe.id }) };
    }),
    ...(semDono ? [{ chave: SEM, rotulo: 'Sem responsável', valor: semDono, cor: FRACO, onClick: () => abrir({ pessoa: SEM }) }] : []),
  ];

  // Por pasta: a pasta de cima de cada lista; a lista solta cai em "Sem pasta".
  const pastaDe = estrutura ? pastasDasListas(estrutura) : new Map<string, { id: string; nome: string }>();
  const pastas = new Map<string, { nome: string; tarefas: TarefaDoDia[] }>();
  for (const t of abertas) {
    const pasta = pastaDe.get(t.lista.id) ?? { id: SEM_PASTA, nome: estrutura ? 'Sem pasta' : 'Pasta não carregada' };
    const g = pastas.get(pasta.id) ?? { nome: pasta.nome, tarefas: [] };
    g.tarefas.push(t);
    pastas.set(pasta.id, g);
  }
  const porPasta: Fatia[] = [...pastas.entries()]
    .sort((a, b) => (a[0] === SEM_PASTA ? 1 : b[0] === SEM_PASTA ? -1 : b[1].tarefas.length - a[1].tarefas.length))
    .map(([id, g]) => ({
      chave: id, rotulo: g.nome, valor: g.tarefas.length, cor: id === SEM_PASTA ? FRACO : FORTE, dica: atrasadasDe(g.tarefas),
      onClick: () => abrir({ pasta: id }),
    }));

  const listas = new Map<string, { nome: string; tarefas: TarefaDoDia[] }>();
  for (const t of abertas) {
    const g = listas.get(t.lista.id) ?? { nome: t.lista.nome, tarefas: [] };
    g.tarefas.push(t);
    listas.set(t.lista.id, g);
  }
  const ordenadas = [...listas.entries()].sort((a, b) => b[1].tarefas.length - a[1].tarefas.length);
  const resto = ordenadas.slice(LISTAS_NO_GRAFICO);
  const porLista: Fatia[] = [
    ...ordenadas.slice(0, LISTAS_NO_GRAFICO).map(([id, g]) => {
      const pasta = pastaDe.get(id);
      return {
        chave: id, rotulo: g.nome, valor: g.tarefas.length, cor: FORTE,
        dica: [pasta ? `pasta ${pasta.nome}` : 'sem pasta', atrasadasDe(g.tarefas)].join(' · '),
        onClick: () => abrir({ pasta: pasta?.id ?? SEM_PASTA, lista: id }),
      };
    }),
    ...(resto.length
      ? [{ chave: 'outras', rotulo: `Outras ${resto.length} listas`, valor: resto.reduce((s, [, g]) => s + g.tarefas.length, 0), cor: FRACO, onClick: () => abrir({}) }]
      : []),
  ];

  const doRecorte = (f: FiltroDaVisaoGeral): TarefaDoDia[] => {
    const base = f.situacao === 'feita' ? p.tarefas.filter((t) => t.situacao === 'feita' && t.updatedAt >= seteDiasAtras) : abertas;
    return base.filter((t) =>
      (!f.pessoa || (f.pessoa === SEM ? !t.pessoa : t.pessoas.some((x) => x.id === f.pessoa))) &&
      (!f.situacao || f.situacao === 'feita' || (f.situacao === 'emdia' ? ['hoje', 'proximos_7', 'mais_tarde'].includes(t.situacao) : t.situacao === f.situacao)) &&
      // "Sem prazo" não inclui a tarefa recorrente (ela tem regra, não falta prazo).
      (f.situacao !== 'sem_prazo' || !t.recorrencia) &&
      (!f.pasta || (pastaDe.get(t.lista.id)?.id ?? SEM_PASTA) === f.pasta) &&
      (!f.lista || t.lista.id === f.lista));
  };
  const tituloDoRecorte = (f: FiltroDaVisaoGeral) => [
    f.situacao === 'feita' ? 'Feitas nos últimos 7 dias' : f.situacao === 'emdia' ? 'Em dia' : f.situacao ? NOME_DA_SITUACAO[f.situacao] : 'Tarefas abertas',
    f.pessoa === SEM ? 'sem responsável' : f.pessoa ? p.pessoas.find((x) => x.id === f.pessoa)?.nome : null,
    f.lista ? abertas.find((t) => t.lista.id === f.lista)?.lista.nome : f.pasta ? (f.pasta === SEM_PASTA ? 'sem pasta' : pastas.get(f.pasta)?.nome) : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          // Layout 26/10: o total de abertas saiu (não ajuda a decidir); no lugar, o que vence hoje.
          { r: 'Para hoje', v: conta('hoje'), n: 'vencem hoje', f: { situacao: 'hoje' } as FiltroDaVisaoGeral },
          { r: 'Atrasadas', v: conta('atrasada'), n: 'prazo já passou', f: { situacao: 'atrasada' } as FiltroDaVisaoGeral },
          { r: 'Não atribuídas', v: semDono, n: 'sem responsável', f: { pessoa: SEM } as FiltroDaVisaoGeral },
          // Layout 26/10: toda tarefa deve ter prazo; recorrente não conta como "sem prazo".
          { r: 'Sem prazo', v: abertas.filter((t) => t.situacao === 'sem_prazo' && !t.recorrencia).length, n: 'dê um prazo a cada uma', f: { situacao: 'sem_prazo' } as FiltroDaVisaoGeral },
          { r: 'Feitas na semana', v: feitas, n: 'últimos 7 dias', f: { situacao: 'feita' } as FiltroDaVisaoGeral },
        ].map((c) => (
          <div key={c.r} className="rounded-md border border-border bg-surface px-4 py-3">
            <Numero rotulo={c.r} valor={String(c.v)} nota={c.n} onClick={() => abrir(c.f)} />
          </div>
        ))}
      </div>

      {/*
        Leva 5, L3 (27/10/2026): o cartão "Implantação" (produção 22, M1, S5) saiu do Dia a dia por decisão do
        Rodrigo em 26/10; os clientes ficam na lista Onboarding de cliente. O componente `ImplantacaoNoDiaADia`
        fica no código, sem uso, para o módulo voltar. Aqui só entra o que a página mandar (`meio`).
      */}
      {meio}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* P1 (21/10): sem rolagem lateral; o gráfico se ajusta à caixa e o balão fica dentro dela. */}
        <Quadro className="min-w-0" titulo="Carga por prazo" nota="tarefas abertas · clique numa coluna">
          <Barras itens={porSituacao} />
        </Quadro>
        <Quadro className="min-w-0 overflow-x-auto" titulo="Tarefas por responsável" nota="abertas · clique numa pessoa">
          <Barras itens={porPessoa} orientacao="colunas" />
        </Quadro>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Quadro className="min-w-0" titulo="Tarefas por pasta" nota="abertas em cada pasta do Trabalho · clique numa coluna">
          {porPasta.length ? <Barras itens={porPasta} /> : <p className="text-sm text-muted">Nenhuma tarefa aberta.</p>}
        </Quadro>
        <Quadro className="min-w-0" titulo="Tarefas por lista" nota="abertas em cada lista · clique numa coluna">
          {porLista.length ? <Barras itens={porLista} /> : <p className="text-sm text-muted">Nenhuma tarefa aberta.</p>}
        </Quadro>
      </div>

      <Quadro className="min-w-0 overflow-x-auto" titulo="Cada pessoa" nota="o que está atrasado, em dia e sem prazo · clique num número">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left">
                <th className="com-rotulo pb-2 font-normal">Pessoa</th>
                {(['Atrasadas', 'Em dia', 'Sem prazo', 'Feitas na semana'] as const).map((h) => (
                  <th key={h} className="com-rotulo pb-2 text-right font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {p.resumo.map((r) => {
                const id = r.pessoa?.id ?? SEM;
                const celula = (v: number, s: Recorte, mal = false) => (
                  <td className="py-2 text-right">
                    <button
                      disabled={!v}
                      onClick={() => abrir({ pessoa: id, situacao: s })}
                      className={`com-num rounded px-2 py-0.5 hover:bg-surface-2 disabled:text-muted/60 disabled:hover:bg-transparent ${mal && v ? 'font-bold text-bad' : ''}`}
                    >
                      {v}
                    </button>
                  </td>
                );
                return (
                  <tr key={id}>
                    {/* O nome é a informação da linha: fica, com o avatar ao lado (I6). */}
                    <td className="py-2">{r.pessoa ? <AvatarDaPessoa nome={r.pessoa.nome} pessoaId={r.pessoa.id} tamanho="p" mostrarNome /> : 'Sem responsável'}</td>
                    {celula(r.atrasadas, 'atrasada', true)}
                    {celula(r.emDia, 'emdia')}
                    {celula(r.semPrazo, 'sem_prazo')}
                    {celula(r.feitasNaSemana, 'feita')}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Quadro>
      {recorte && <JanelaDoRecorte titulo={tituloDoRecorte(recorte)} tarefas={doRecorte(recorte)} trabalho={urlDoTrabalho(recorte)} aoAbrir={popup.abrir} aoFechar={() => setRecorte(null)} />}
      <TarefaFlutuante tarefa={popup} onMudou={() => setVersao((v) => v + 1)} />
    </div>
  );
}

/** A lista exata do número clicado: título, lista, prazo e responsável; clicar abre a tarefa por cima. */
function JanelaDoRecorte({ titulo, tarefas, trabalho, aoAbrir, aoFechar }: {
  titulo: string; tarefas: TarefaDoDia[]; trabalho: string; aoAbrir: (id: string) => void; aoFechar: () => void;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[data-testid="tarefa-popup"]')) aoFechar(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [aoFechar]);
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 p-3 pt-[8vh]" onClick={aoFechar}>
      <div role="dialog" aria-modal="true" aria-label={titulo} data-testid="visao-geral-recorte" onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-[640px] flex-col rounded-lg border border-border bg-bg shadow-2xl">
        <header className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-[15px] font-semibold">{titulo} <span className="font-os-mono text-[12px] text-muted">· {tarefas.length}</span></h2>
          <button type="button" onClick={aoFechar} className="text-sm text-muted hover:text-text">Fechar</button>
        </header>
        <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {tarefas.length === 0 && <li className="px-4 py-6 text-sm text-muted">Nenhuma tarefa aqui.</li>}
          {tarefas.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => aoAbrir(t.id)} data-testid={`recorte-tarefa-${t.id}`} className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-surface-2">
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-[13.5px]">{t.titulo}</span>
                  <span className="block text-[12px] text-muted">
                    {t.lista.nome}{t.cliente ? ` · ${t.cliente.titulo}` : ''} · {t.prazo ? `prazo ${t.prazo.slice(8, 10)}/${t.prazo.slice(5, 7)}` : 'sem prazo'}
                    {t.situacao === 'atrasada' && <span className="text-bad"> · atrasada</span>}
                  </span>
                </span>
                {t.pessoa ? <AvatarDaPessoa nome={t.pessoa.nome} pessoaId={t.pessoa.id} tamanho="p" /> : <span className="text-[11px] text-muted">sem responsável</span>}
              </button>
            </li>
          ))}
        </ul>
        <footer className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-[12px] text-muted">
          <span>As mesmas tarefas de "Todas" no Trabalho.</span>
          <a href={trabalho} className="text-brand hover:underline">ver no Trabalho →</a>
        </footer>
      </div>
    </div>
  );
}
