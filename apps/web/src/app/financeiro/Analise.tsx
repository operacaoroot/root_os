'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';

/*
 * Aba "Análise" do financeiro. Abre com a leitura da IA (guardada por dia no
 * servidor: reabrir não gasta modelo) e, embaixo, os números que ela leu:
 * para onde foi o dinheiro mês a mês (fixo, variável, impostos, investimento),
 * acordos (o que foi entregue × o que virou caixa), contas recorrentes,
 * fôlego do caixa, próximos 90 dias e dependência de cliente.
 */

type Tipo = 'pagante' | 'permuta' | 'repasse' | 'parceria';
type Linha = { id: string; cliente: string; produto: string; tipo: Tipo; valor: number; observacao: string | null; apelidos: string | null; recebido: number; aReceber: number; semRastro: number };
type Recorrente = {
  id: string; tipo: 'entrada' | 'saida'; descricao: string; quem: string | null; valor: number; periodicidade: string; dia: number; porMes: number;
  noMes: { pago: number; previsto: number; vence: string | null };
};
type Mes = {
  mes: string; receita: number; custoFixo: number; custoVariavel: number; custo: number; margem: number;
  despesaFixa: number; despesaVariavel: number; despesaEventual: number; despesas: number; impostos: number; sobra: number;
  investimento: number; retirada: number; saiu: number; fixoDoMes: number;
};
type Grupo = 'receita' | 'custoFixo' | 'custoVariavel' | 'despesaFixa' | 'despesaVariavel' | 'despesaEventual' | 'impostos' | 'investimento' | 'retirada';
type Natureza = 'fixo' | 'variavel' | 'eventual';
type Parte = { mes: string; grupo: Grupo; id: string; data: string; descricao: string; extrato: string; quem: string | null; conta: string | null; valor: number; rateio: boolean; mesesDeUso: number | null };
type ContaDaJanela = { id: string; codigo: string; nome: string; lado: 'custo' | 'despesa' | 'imposto'; grupo: string; natureza: Natureza | null; naturezaHerdada: Natureza | null; automatica: Natureza; total: number };
type Resumo = {
  caixa: { saldo: number; aReceber: number; aPagar: number; folegoMeses: number | null };
  acordos: { linhas: Linha[]; porTipo: { tipo: Tipo; acordos: number; valor: number; recebido: number; aReceber: number }[]; entregue: number; viraCaixa: number; semCaixaPct: number; semRastro: number };
  recorrentes: { linhas: Recorrente[]; custoMensal: number; receitaMensal: number; coberturaPct: number | null };
  mesAMes: { linhas: Mes[]; porMes: Mes[]; mesAtual: string; contas: ContaDaJanela[]; detalhe: Parte[] };
  proximos: { dias: number; entra: number; sai: number }[];
  dependencia: { pagador: string; valor: number; pct: number; total90: number } | null;
  pendencias: { semClassificacao: number; vencidoReceber: number; vencidoPagar: number };
};
type Leitura = { texto: string; geradaEm: string; guardada: boolean };

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const ROTULO: Record<Tipo, string> = { pagante: 'Pagante', permuta: 'Permuta', repasse: 'Repasse', parceria: 'Parceria' };
const EXPLICA: Record<Tipo, string> = {
  pagante: 'o dinheiro entra na ROOT',
  permuta: 'paga com produto ou serviço, sem caixa',
  repasse: 'entregue pela ROOT, dinheiro foi para outro',
  parceria: 'entregue sem cobrança',
};
const COR: Record<Tipo, string> = { pagante: 'bg-good', permuta: 'bg-brand', repasse: 'bg-warn', parceria: 'bg-muted' };
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const nomeDoMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const diaMes = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
// Linhas da tabela "Para onde foi o dinheiro", na ordem em que aparecem.
// Regra do financeiro (Pedro): custo é a operação, o que se usa para entregar ao cliente (plano 3.x);
// despesa é a estrutura e a administração (4.x). Dentro de cada lado: fixo, variável, eventual.
// `grupo`: a linha é uma soma de lançamentos e o clique na célula abre a lista.
type LinhaDaTabela = { k: keyof Omit<Mes, 'mes'>; rotulo: string; dica: string; grupo?: Grupo; forte?: boolean; opcional?: boolean; sub?: boolean };
const LINHAS_DO_MES: LinhaDaTabela[] = [
  { k: 'receita', rotulo: 'Entrou', dica: 'tudo o que entrou de cliente no mês', grupo: 'receita', forte: true },
  { k: 'custo', rotulo: 'Custo da operação', dica: 'o que se usa para entregar ao cliente (plano 3.x)', forte: true },
  { k: 'custoFixo', rotulo: 'fixo', dica: 'vem todo mês: assinaturas de IA, ferramentas da entrega', grupo: 'custoFixo', sub: true },
  { k: 'custoVariavel', rotulo: 'variável', dica: 'acompanha a demanda dos clientes: servidor/VPS, freelancer por projeto', grupo: 'custoVariavel', sub: true },
  { k: 'margem', rotulo: 'Margem da operação', dica: 'entrou − custo da operação: o que sobra para pagar a estrutura', forte: true },
  { k: 'despesas', rotulo: 'Despesas da estrutura', dica: 'o que mantém a empresa de pé (plano 4.x)', forte: true },
  { k: 'despesaFixa', rotulo: 'fixas', dica: 'vem todo mês, vendendo ou não: sala, internet, celular, ferramentas administrativas', grupo: 'despesaFixa', sub: true },
  { k: 'despesaVariavel', rotulo: 'variáveis', dica: 'sobem e descem com o movimento: taxas do banco e do Asaas', grupo: 'despesaVariavel', sub: true },
  { k: 'despesaEventual', rotulo: 'eventuais', dica: 'pontuais, por decisão: montagem da sala, confraternização, evento, uniforme, presente', grupo: 'despesaEventual', sub: true },
  { k: 'impostos', rotulo: 'Impostos', dica: 'contas 2.x (DAS do MEI)', grupo: 'impostos', opcional: true },
  { k: 'sobra', rotulo: 'Sobra', dica: 'margem − despesas − impostos: o que fica antes de investir e retirar', forte: true },
  { k: 'investimento', rotulo: 'Investimento', dica: 'contas 5.x: bem durável e de valor alto', grupo: 'investimento', opcional: true },
  { k: 'retirada', rotulo: 'Retirada dos sócios', dica: 'contas 4.6.x (pró-labore, dividendos)', grupo: 'retirada', opcional: true },
  { k: 'saiu', rotulo: 'Saiu no total', dica: 'tudo o que saiu no mês' },
];
const ROTULO_DO_GRUPO: Record<Grupo, string> = {
  receita: 'Entrou', custoFixo: 'Custo fixo da operação', custoVariavel: 'Custo variável da operação',
  despesaFixa: 'Despesas fixas', despesaVariavel: 'Despesas variáveis', despesaEventual: 'Despesas eventuais',
  impostos: 'Impostos', investimento: 'Investimento', retirada: 'Retirada dos sócios',
};
const ROTULO_NATUREZA: Record<Natureza, string> = { fixo: 'Fixo', variavel: 'Variável', eventual: 'Eventual' };
const inputCls = 'rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand-dim';
const Rotulo = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mb-3 font-os-mono text-[10px] uppercase tracking-[0.16em] font-medium text-muted">{children}</h2>
);

export function AnaliseView({ token, canEdit, onError }: { token: string | null; canEdit: boolean; onError: (e: unknown) => void }) {
  const [r, setR] = useState<Resumo | null>(null);
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const [lendo, setLendo] = useState(false);
  const [erroIa, setErroIa] = useState<string | null>(null);
  const [form, setForm] = useState({ cliente: '', produto: '', valor: '', tipo: 'pagante' as Tipo, observacao: '', apelidos: '' });
  const [aberto, setAberto] = useState(false);
  const [contasAbertas, setContasAbertas] = useState(false);
  const [celula, setCelula] = useState<{ mes: string; grupo: Grupo } | null>(null);
  const [mediaMensal, setMediaMensal] = useState(false);
  const [porMes, setPorMes] = useState(false);
  const [tipoFiltro, setTipoFiltro] = useState<Tipo | null>(null);

  const carregar = useCallback(() => {
    if (!token) return;
    apiGet<Resumo>('/finance/analise', token).then(setR).catch(onError);
  }, [token, onError]);

  const ler = useCallback((refazer = false) => {
    if (!token) return;
    setLendo(true);
    setErroIa(null);
    apiPost<Leitura>('/finance/analise/leitura', { refazer }, token)
      .then(setLeitura)
      .catch((e) => setErroIa(e instanceof Error ? e.message : String(e)))
      .finally(() => setLendo(false));
  }, [token]);

  useEffect(() => { carregar(); ler(false); }, [carregar, ler]);

  const salvar = () => {
    if (!form.cliente || !form.produto || !form.valor) { onError(new Error('Preencha cliente, produto e valor.')); return; }
    apiPost('/finance/analise/acordos', {
      cliente: form.cliente, produto: form.produto, valor: Number(form.valor), tipo: form.tipo,
      observacao: form.observacao || null, apelidos: form.apelidos || null,
    }, token)
      .then(() => { setForm({ cliente: '', produto: '', valor: '', tipo: 'pagante', observacao: '', apelidos: '' }); setAberto(false); carregar(); })
      .catch(onError);
  };
  const apagar = (id: string) => apiDelete(`/finance/analise/acordos/${id}`, token).then(carregar).catch(onError);
  const mudarNatureza = (id: string, natureza: Natureza | null) =>
    apiPatch(`/finance/chart-accounts/${id}`, { natureza }, token).then(carregar).catch(onError);
  const mudarMesesDeUso = (id: string, mesesDeUso: number | null) =>
    apiPatch(`/finance/transactions/${id}`, { mesesDeUso }, token).then(carregar).catch(onError);

  if (!r) return <p className="text-sm text-muted">Carregando…</p>;
  const max = Math.max(1, ...r.acordos.porTipo.map((t) => t.valor));
  const tabela = porMes ? r.mesAMes.porMes : r.mesAMes.linhas;
  const linhasDoMes = LINHAS_DO_MES.filter((l) => !l.opcional || tabela.some((m) => m[l.k] !== 0));
  const temAnual = r.mesAMes.detalhe.some((d) => (d.mesesDeUso ?? 1) > 1);
  // Lançamento e estorno do mesmo valor, dia e conta se anulam: saem da lista (a soma não muda).
  const doCelula = celula ? r.mesAMes.detalhe.filter((d) => d.mes === celula.mes && d.grupo === celula.grupo) : [];
  const anulados = new Set<number>();
  doCelula.forEach((a, i) => {
    if (anulados.has(i) || a.valor <= 0) return;
    const j = doCelula.findIndex((b, k) => k !== i && !anulados.has(k) && b.valor === -a.valor && b.data === a.data && b.conta === a.conta);
    if (j >= 0) { anulados.add(i); anulados.add(j); }
  });
  const partes = doCelula.filter((_, i) => !anulados.has(i));
  const paresOcultos = anulados.size / 2;
  const nMeses = r.mesAMes.linhas.length;

  return (
    <div className="space-y-6">
      {/* caixa */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Bloco rotulo="Na conta" valor={brl(r.caixa.saldo)} />
        <Bloco rotulo="Fôlego do caixa" valor={r.caixa.folegoMeses == null ? '—' : `${r.caixa.folegoMeses.toFixed(1)} meses`} nota="saldo ÷ contas recorrentes do mês" />
        <Bloco rotulo="Recorrente entra / mês" valor={brl(r.recorrentes.receitaMensal)} />
        <Bloco rotulo="Recorrente sai / mês" valor={brl(r.recorrentes.custoMensal)}
          nota={r.recorrentes.coberturaPct == null ? undefined : `a receita recorrente cobre ${r.recorrentes.coberturaPct.toFixed(0)}%`} />
      </div>

      {/* para onde foi o dinheiro */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Rotulo>Para onde foi o dinheiro</Rotulo>
          <div className="flex items-center gap-3 text-sm text-muted">
            <div className="flex rounded border border-border text-[12px]" role="group" aria-label="Leitura da tabela">
              <button onClick={() => setPorMes(false)} aria-pressed={!porMes} title="o que saiu do caixa em cada mês" className={`px-2 py-0.5 ${!porMes ? 'bg-brand/10 text-brand' : ''}`}>caixa</button>
              <button onClick={() => setPorMes(true)} aria-pressed={porMes} title="o que foi pago para vários meses (plano anual) dividido pelos meses de uso" className={`px-2 py-0.5 ${porMes ? 'bg-brand/10 text-brand' : ''}`}>por mês</button>
            </div>
            <span>realizado e conciliado</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="py-2 pr-3" />
                {tabela.map((m) => (
                  <th key={m.mes} className="py-2 pr-3 text-right">
                    {nomeDoMes(m.mes)}{m.mes === r.mesAMes.mesAtual && <span className="block normal-case tracking-normal">até hoje</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhasDoMes.map((l) => (
                <tr key={l.k} className={`${l.sub ? 'text-[12px] italic text-muted' : 'border-t border-border'} ${l.forte ? 'font-medium' : ''}`}>
                  <td className={`py-2 pr-3 ${l.sub ? 'pl-3 pt-0' : ''}`} title={l.dica}>{l.rotulo}</td>
                  {tabela.map((m) => {
                    const v = m[l.k];
                    const aberta = !!l.grupo && celula?.mes === m.mes && celula.grupo === l.grupo;
                    const cls = `tabular-nums ${v === 0 ? 'text-muted' : l.k === 'sobra' && m.sobra < 0 ? 'text-bad' : ''}`;
                    return (
                      <td key={m.mes} className={`py-2 pr-3 text-right ${l.sub ? 'pt-0' : ''}`}>
                        {l.grupo && v !== 0 ? (
                          <button
                            type="button"
                            onClick={() => setCelula(aberta ? null : { mes: m.mes, grupo: l.grupo! })}
                            aria-expanded={aberta}
                            title={`Ver o que compõe ${ROTULO_DO_GRUPO[l.grupo]} em ${nomeDoMes(m.mes)}`}
                            className={`${cls} rounded px-1 underline decoration-dotted underline-offset-4 hover:bg-surface-2 ${aberta ? 'bg-brand/10 text-brand' : ''}`}
                          >
                            {brl(v)}
                          </button>
                        ) : (
                          <span className={cls}>{v === 0 ? '—' : brl(v)}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[12px] text-muted">
          Vem todo mês, vendendo ou não (custo fixo + despesas fixas{tabela.some((m) => m.impostos) ? ' + imposto fixo' : ''}):{' '}
          {tabela.map((m) => `${nomeDoMes(m.mes)} ${brl(m.fixoDoMes)}`).join(' · ')} · contratos de saída somam {brl(r.recorrentes.custoMensal)}/mês
          {porMes && temAnual && ' · anuais divididos por 12'}
        </p>
        {celula && (
          <div className="mt-3 rounded-lg border border-brand/30 bg-surface-2/40 p-3">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span><b>{ROTULO_DO_GRUPO[celula.grupo]}</b> em {nomeDoMes(celula.mes)} · {partes.length} {partes.length === 1 ? 'lançamento' : 'lançamentos'} · {brl(partes.reduce((s, p) => s + p.valor, 0))}</span>
              <button onClick={() => setCelula(null)} className="text-muted hover:text-text">fechar</button>
            </div>
            <ul className="divide-y divide-border text-sm">
              {partes.map((p, i) => (
                <li key={`${p.id}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                  <span className="w-12 shrink-0 tabular-nums text-muted">{diaMes(p.data)}</span>
                  <span className="min-w-0 flex-1" title={p.extrato}>
                    {p.descricao}
                    {p.quem && <span className="ml-2 text-[12px] text-muted">{p.quem}</span>}
                    {p.rateio && <span className="ml-2 text-[11px] text-muted">(parte de um rateio)</span>}
                  </span>
                  {p.conta && <span className="shrink-0 text-[12px] text-muted">{p.conta}</span>}
                  {celula.grupo !== 'receita' && canEdit && !p.rateio && p.valor > 0 && (
                    <label className="flex shrink-0 items-center gap-1 text-[12px] text-muted" title="Pago de uma vez para 12 meses de uso: na leitura por mês entra 1/12 em cada mês">
                      <input type="checkbox" checked={(p.mesesDeUso ?? 1) === 12} onChange={(e) => mudarMesesDeUso(p.id, e.target.checked ? 12 : null)} />
                      anual
                    </label>
                  )}
                  <span className={`w-28 shrink-0 text-right tabular-nums ${p.valor < 0 ? 'text-good' : ''}`}>{brl(p.valor)}</span>
                </li>
              ))}
            </ul>
            {paresOcultos > 0 && (
              <p className="mt-2 text-[12px] text-muted">{paresOcultos} {paresOcultos === 1 ? 'par' : 'pares'} de pix estornado (saída e devolução no mesmo dia) {paresOcultos === 1 ? 'oculto' : 'ocultos'}: não mudam a soma.</p>
            )}
            {celula.grupo !== 'receita' && (
              <p className="mt-2 text-[12px] text-muted">
                Valor negativo é estorno abatendo o gasto. Para mudar custo ↔ despesa, troque a conta do lançamento na aba Lançamentos; para fixo/variável/eventual, use "Como cada conta conta" abaixo.
              </p>
            )}
          </div>
        )}
        <p className="mt-2 text-[12px] text-muted">
          Clique num valor para ver os lançamentos. Custo é a operação (o que se usa para entregar ao cliente); despesa é a estrutura. Fixo vem todo mês; variável acompanha a demanda; eventual é pontual, por decisão. Investimento e retirada ficam fora da sobra.
        </p>
        {r.mesAMes.contas.length > 0 && (
          <div className="mt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button onClick={() => setContasAbertas(!contasAbertas)} className="text-[12px] text-muted hover:text-text">
                {contasAbertas ? '▾' : '▸'} Como cada conta conta (fixo, variável ou eventual)
              </button>
              {contasAbertas && (
                <div className="flex rounded border border-border text-[12px]" role="group" aria-label="Valor mostrado">
                  <button onClick={() => setMediaMensal(false)} aria-pressed={!mediaMensal} className={`px-2 py-0.5 ${!mediaMensal ? 'bg-brand/10 text-brand' : 'text-muted'}`}>total do período</button>
                  <button onClick={() => setMediaMensal(true)} aria-pressed={mediaMensal} className={`px-2 py-0.5 ${mediaMensal ? 'bg-brand/10 text-brand' : 'text-muted'}`}>média por mês</button>
                </div>
              )}
            </div>
            {contasAbertas && (
              <ul className="mt-2 divide-y divide-border text-sm">
                {mediaMensal && (
                  <li className="py-1.5 text-[12px] text-muted">Média dos {nMeses} meses da tabela ({nomeDoMes(r.mesAMes.linhas[0].mes)} a {nomeDoMes(r.mesAMes.mesAtual)}, o atual ainda aberto).</li>
                )}
                {r.mesAMes.contas.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-1.5">
                    <span className="w-14 shrink-0 font-os-mono text-[12px] text-muted">{c.codigo}</span>
                    <span className="min-w-0 flex-1 truncate">{c.nome}</span>
                    <span className="w-16 shrink-0 text-[11px] text-muted">{c.lado === 'custo' ? 'custo' : c.lado === 'imposto' ? 'imposto' : 'despesa'}</span>
                    <select
                      aria-label={`Faixa da conta ${c.nome}`}
                      disabled={!canEdit}
                      value={c.natureza ?? ''}
                      onChange={(e) => mudarNatureza(c.id, (e.target.value || null) as Natureza | null)}
                      className="rounded border border-border bg-surface px-1.5 py-0.5 text-[12px]"
                    >
                      <option value="">{`automático (${ROTULO_NATUREZA[c.naturezaHerdada ?? c.automatica]})`}</option>
                      <option value="fixo">Fixo</option>
                      <option value="variavel">Variável</option>
                      <option value="eventual">Eventual</option>
                    </select>
                    <span className="w-32 shrink-0 text-right tabular-nums text-muted">
                      {brl(mediaMensal ? c.total / nMeses : c.total)}{mediaMensal && <span className="text-[11px]">/mês</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* acordos */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Rotulo>Entregue × virou caixa</Rotulo>
          <span className="text-sm text-muted">
            {brl(r.acordos.entregue)} entregues · {brl(r.acordos.viraCaixa)} em acordos pagantes · <b className="text-text">{r.acordos.semCaixaPct.toFixed(0)}%</b> sem caixa para a ROOT
          </span>
        </div>
        <div className="mt-2 space-y-2">
          {r.acordos.porTipo.filter((t) => t.acordos > 0).map((t) => {
            const on = tipoFiltro === t.tipo;
            const apagada = tipoFiltro !== null && !on;
            return (
              <button
                key={t.tipo}
                type="button"
                onClick={() => setTipoFiltro(on ? null : t.tipo)}
                aria-pressed={on}
                title={`${ROTULO[t.tipo]}: ${EXPLICA[t.tipo]} · ${t.acordos} acordo(s) · ${brl(t.valor)}${t.recebido ? ` · entrou ${brl(t.recebido)}` : ''}${t.aReceber ? ` · a receber ${brl(t.aReceber)}` : ''} — clique para ${on ? 'ver todos' : 'ver só estes'}`}
                className={`group grid w-full grid-cols-[110px_1fr_auto] items-center gap-3 rounded px-1 py-0.5 text-left text-sm transition-opacity hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${apagada ? 'opacity-40' : ''} ${on ? 'bg-surface-2' : ''}`}
              >
                <span className={on ? 'font-medium' : ''}>{ROTULO[t.tipo]} <span className="text-muted">({t.acordos})</span></span>
                <span className="h-2.5 overflow-hidden rounded bg-surface-2 group-hover:bg-border">
                  <span className={`block h-full ${COR[t.tipo]}`} style={{ width: `${(t.valor / max) * 100}%` }} />
                </span>
                <span className="w-28 text-right tabular-nums">{brl(t.valor)}</span>
              </button>
            );
          })}
          {tipoFiltro && (
            <p className="text-[12px] text-muted">
              Mostrando só {ROTULO[tipoFiltro].toLowerCase()}. <button className="underline hover:text-text" onClick={() => setTipoFiltro(null)}>Ver todos</button>
            </p>
          )}
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="py-2 pr-3">Cliente</th><th className="py-2 pr-3">Acordo</th><th className="py-2 pr-3">Tipo</th>
                <th className="py-2 pr-3 text-right">Valor</th><th className="py-2 pr-3 text-right">Entrou</th>
                <th className="py-2 pr-3 text-right">A receber</th><th className="py-2 pr-3 text-right">Sem rastro</th>{canEdit && <th />}
              </tr>
            </thead>
            <tbody>
              {r.acordos.linhas.length === 0 && <tr><td colSpan={8} className="py-4 text-center text-muted">Nenhum acordo cadastrado.</td></tr>}
              {r.acordos.linhas.filter((l) => !tipoFiltro || l.tipo === tipoFiltro).map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="py-2 pr-3">{l.cliente}</td>
                  <td className="py-2 pr-3 text-muted">{l.produto}{l.observacao && <span className="block text-[12px]">{l.observacao}</span>}</td>
                  <td className="py-2 pr-3"><span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${COR[l.tipo]}`} />{ROTULO[l.tipo]}</span></td>
                  <td className="py-2 pr-3 text-right tabular-nums">{brl(l.valor)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{l.recebido ? brl(l.recebido) : '—'}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{l.aReceber ? brl(l.aReceber) : '—'}</td>
                  <td className={`py-2 pr-3 text-right tabular-nums ${l.semRastro > 0 ? 'text-warn' : 'text-muted'}`}>{l.semRastro ? brl(l.semRastro) : '—'}</td>
                  {canEdit && <td className="py-2 text-right"><button onClick={() => apagar(l.id)} className="text-[12px] text-muted hover:text-bad">remover</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[12px] text-muted">
          "Entrou" casa o nome do cliente (ou um apelido) com as entradas do extrato. "Sem rastro" é o que um acordo pagante deveria ter trazido e não aparece nem como recebido nem como a receber.
        </p>
        {canEdit && (
          <div className="mt-3">
            {!aberto ? (
              <button onClick={() => setAberto(true)} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-2">+ Acordo</button>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <input className={inputCls} placeholder="Cliente" value={form.cliente} onChange={(e) => setForm({ ...form, cliente: e.target.value })} />
                <input className={inputCls} placeholder="Produto (ex.: Operação ROOT)" value={form.produto} onChange={(e) => setForm({ ...form, produto: e.target.value })} />
                <input className={inputCls} type="number" step="0.01" placeholder="Valor" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} />
                <select className={inputCls} value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as Tipo })}>
                  {(Object.keys(ROTULO) as Tipo[]).map((t) => <option key={t} value={t}>{ROTULO[t]} — {EXPLICA[t]}</option>)}
                </select>
                <input className={inputCls} placeholder="Observação (ex.: valor foi para o Pedro)" value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} />
                <input className={inputCls} placeholder="Nome no extrato (vírgula separa)" value={form.apelidos} onChange={(e) => setForm({ ...form, apelidos: e.target.value })} />
                <div className="flex gap-2">
                  <button onClick={salvar} className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-ink hover:opacity-90">Salvar</button>
                  <button onClick={() => setAberto(false)} className="rounded-lg border border-border px-3 py-2 text-sm">Cancelar</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* recorrentes */}
        <div className="rounded-xl border border-border bg-surface p-5">
          <Rotulo>Contas recorrentes</Rotulo>
          {r.recorrentes.linhas.length === 0 ? (
            <p className="text-sm text-muted">Nenhum contrato ativo. Cadastre em A Pagar/Receber → Contratos.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {r.recorrentes.linhas.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-2">
                  <span className={`w-14 shrink-0 text-[11px] uppercase ${c.tipo === 'entrada' ? 'text-good' : 'text-muted'}`}>{c.tipo === 'entrada' ? 'entra' : 'sai'}</span>
                  <span className="min-w-0 flex-1 truncate">{c.descricao}<span className="ml-2 text-muted">dia {c.dia}{c.periodicidade !== 'mensal' ? ` · ${c.periodicidade}` : ''}</span></span>
                  <span className={`w-24 shrink-0 text-right text-[12px] ${c.noMes.pago > 0 ? 'text-good' : 'text-muted'}`}
                    title="Situação no mês atual. O pagamento fica preso ao contrato quando é conciliado com o previsto do contrato.">
                    {c.noMes.pago > 0 ? (c.tipo === 'entrada' ? 'recebido' : 'pago') : c.noMes.vence ? `vence ${diaMes(c.noMes.vence)}` : ''}
                  </span>
                  <span className="w-28 shrink-0 text-right tabular-nums">{brl(c.porMes)}<span className="text-[11px] text-muted">/mês</span></span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* próximos e dependência */}
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-5">
            <Rotulo>Próximos dias</Rotulo>
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-muted"><tr><th className="py-1">Em</th><th className="py-1 text-right">Entra</th><th className="py-1 text-right">Sai</th><th className="py-1 text-right">Fica</th></tr></thead>
              <tbody>
                {r.proximos.map((p) => (
                  <tr key={p.dias} className="border-t border-border">
                    <td className="py-1.5">{p.dias} dias</td>
                    <td className="py-1.5 text-right tabular-nums text-good">{brl(p.entra)}</td>
                    <td className="py-1.5 text-right tabular-nums">{brl(p.sai)}</td>
                    <td className="py-1.5 text-right tabular-nums font-medium">{brl(r.caixa.saldo + p.entra - p.sai)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded-xl border border-border bg-surface p-5 text-sm">
            <Rotulo>Dependência e pendências</Rotulo>
            {r.dependencia && (
              <p><b>{r.dependencia.pct.toFixed(0)}%</b> do que entrou em 90 dias veio de <b>{r.dependencia.pagador}</b> ({brl(r.dependencia.valor)} de {brl(r.dependencia.total90)}).</p>
            )}
            <ul className="mt-2 space-y-1 text-muted">
              <li>{r.pendencias.semClassificacao} movimento(s) sem conta do plano</li>
              <li>{brl(r.pendencias.vencidoReceber)} a receber vencido · {brl(r.pendencias.vencidoPagar)} a pagar vencido</li>
              {r.acordos.semRastro > 0 && <li className="text-warn">{brl(r.acordos.semRastro)} de acordos pagantes sem rastro no caixa</li>}
            </ul>
          </div>
        </div>
      </div>
      {/* leitura da IA */}
      <div className="rounded-xl border border-brand/30 bg-surface p-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <Rotulo>Leitura da IA</Rotulo>
          <button onClick={() => ler(true)} disabled={lendo} className="rounded border border-border px-2.5 py-1 text-[12px] text-muted hover:text-text disabled:opacity-50">
            {lendo ? 'Lendo os números…' : 'Refazer a leitura'}
          </button>
        </div>
        {erroIa && <p className="text-sm text-bad">{erroIa}</p>}
        {!leitura && !erroIa && <p className="text-sm text-muted">Lendo os números…</p>}
        {leitura && (
          <>
            <ul className="space-y-2 text-[15px] leading-relaxed">
              {leitura.texto.split('\n').map((l) => l.replace(/^\s*[-•]\s*/, '').trim()).filter(Boolean).map((l, i) => {
                const [fato, acao] = l.split(' → ');
                return (
                  <li key={i} className="flex gap-2">
                    <span aria-hidden className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                    <span>{fato}{acao && <span className="text-brand"> → {acao}</span>}</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-[11px] text-muted">
              {leitura.guardada ? 'Leitura de hoje, guardada' : 'Leitura nova'} · {new Date(leitura.geradaEm).toLocaleString('pt-BR')}
            </p>
          </>
        )}
      </div>

    </div>
  );
}

function Bloco({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-[11px] uppercase tracking-wide text-muted">{rotulo}</div>
      <div className="mt-1 text-xl font-semibold">{valor}</div>
      {nota && <div className="mt-1 text-[12px] text-muted">{nota}</div>}
    </div>
  );
}
