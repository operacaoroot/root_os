'use client';

import { useEffect, useState } from 'react';
import type { PainelDeTarefas, SituacaoDoPrazo, TarefaDoDia, TrabEstrutura } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Numero, Quadro } from '@/components/painel';
import { Barras, type Fatia } from './graficos';

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
  else if (f.situacao === 'feita') q.set('concluidas', '1');
  else if (f.situacao) q.set('prazo', f.situacao);
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

export function VisaoGeralDasTarefas() {
  const { token, ready } = useAuth();
  const [p, setP] = useState<PainelDeTarefas | null>(null);
  const [estrutura, setEstrutura] = useState<TrabEstrutura | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (!ready || !token) return;
    apiGet<PainelDeTarefas>('/trabalho/todas', token).then(setP).catch((e) => setErro(e.message));
    // Sem a estrutura o dash mostra as listas, e as pastas ficam sem nome (não some número).
    apiGet<TrabEstrutura>('/trabalho/estrutura', token).then(setEstrutura).catch(() => setEstrutura(null));
  }, [ready, token]);
  if (erro) return <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{erro}</div>;
  if (!p) return <p className="text-muted">Carregando…</p>;
  const abrir = (f: FiltroDaVisaoGeral) => { window.location.href = urlDoTrabalho(f); };

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

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { r: 'Tarefas abertas', v: abertas.length, n: 'todas as pastas', f: {} as FiltroDaVisaoGeral },
          { r: 'Atrasadas', v: conta('atrasada'), n: 'prazo já passou', f: { situacao: 'atrasada' } as FiltroDaVisaoGeral },
          { r: 'Não atribuídas', v: semDono, n: 'sem responsável', f: { pessoa: SEM } as FiltroDaVisaoGeral },
          { r: 'Feitas na semana', v: feitas, n: 'últimos 7 dias', f: { situacao: 'feita' } as FiltroDaVisaoGeral },
        ].map((c) => (
          <div key={c.r} className="rounded-md border border-border bg-surface px-4 py-3">
            <Numero rotulo={c.r} valor={String(c.v)} nota={c.n} onClick={() => abrir(c.f)} />
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Quadro titulo="Carga por prazo" nota="tarefas abertas · clique numa coluna">
          <Barras itens={porSituacao} />
        </Quadro>
        <Quadro titulo="Tarefas por responsável" nota="abertas · clique numa pessoa">
          <Barras itens={porPessoa} />
        </Quadro>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Quadro titulo="Tarefas por pasta" nota="abertas em cada pasta do Trabalho · clique numa coluna">
          {porPasta.length ? <Barras itens={porPasta} /> : <p className="text-sm text-muted">Nenhuma tarefa aberta.</p>}
        </Quadro>
        <Quadro titulo="Tarefas por lista" nota="abertas em cada lista · clique numa coluna">
          {porLista.length ? <Barras itens={porLista} /> : <p className="text-sm text-muted">Nenhuma tarefa aberta.</p>}
        </Quadro>
      </div>

      <Quadro titulo="Cada pessoa" nota="o que está atrasado, em dia e sem prazo · clique num número">
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
                    <td className="py-2">{r.pessoa?.nome ?? 'Sem responsável'}</td>
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
    </div>
  );
}
