'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  SEM_INFORMACAO,
  type PainelComercial,
  type PainelComercialGrupo,
  type PainelComercialMes,
  type PainelComercialNegocio,
} from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Ajustes } from './Ajustes';
import { BarraDividida, COR_DO_TOM, Colunas, Numero, Quadro, brl, curto, type Tom } from '@/components/painel';
import { EVENTO_FICHA_MUDOU, abrirFicha } from '@/lib/ficha';

const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const nomeDoMes = (aaaaMm: string) => MES[Number(aaaaMm.slice(5, 7)) - 1];
const mesPorExtenso = (p: string) => (p.length === 4 ? p : `${nomeDoMes(p)}/${p.slice(0, 4)}`);
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
/** Ganho em lima cheio, aberto em lima claro, perda em cinza: um acento só. */
const TOM_DO_RESULTADO: Record<'aberta' | 'ganho' | 'perdido', Tom> = { ganho: 'forte', aberta: 'medio', perdido: 'fraco' };
const negocios = (n: number) => `${n} ${n === 1 ? 'negócio' : 'negócios'}`;

/*
 * O FILTRO é o elo entre o painel e a lista: todo número do painel é clicável e
 * vira um filtro da aba Negócios. Mora na URL (?ver=negocios&canal=BNI…) para o
 * voltar do navegador desfazer o clique e o link poder ser mandado a alguém.
 */
type Situacao = 'aberta' | 'ganho' | 'perdido';
interface Filtro {
  etapa?: string;
  canal?: string;
  vendedor?: string;
  situacao?: Situacao;
  /** Prefixo de `mesFechado`: `2026` (o ano) ou `2026-08` (o mês). */
  fechado?: string;
  /** Prefixo de `mesEntrada`. */
  entrada?: string;
}
const CHAVES: (keyof Filtro)[] = ['etapa', 'canal', 'vendedor', 'situacao', 'fechado', 'entrada'];
type Aba = 'painel' | 'negocios' | 'ajustes';
const ABAS: Aba[] = ['painel', 'negocios', 'ajustes'];
const SITUACAO: Record<Situacao, string> = { aberta: 'Em negociação', ganho: 'Fechados', perdido: 'Perdidos' };

function lerUrl(): { ver: Aba; filtro: Filtro } {
  if (typeof window === 'undefined') return { ver: 'painel', filtro: {} };
  const q = new URLSearchParams(window.location.search);
  const filtro: Filtro = {};
  for (const k of CHAVES) {
    const v = q.get(k);
    if (v) (filtro as Record<string, string>)[k] = v;
  }
  const v = q.get('ver');
  return { ver: v === 'negocios' || v === 'ajustes' ? v : 'painel', filtro };
}

function escreverUrl(ver: Aba, filtro: Filtro, empilhar: boolean) {
  const q = new URLSearchParams();
  if (ver !== 'painel') q.set('ver', ver);
  for (const k of CHAVES) if (filtro[k]) q.set(k, filtro[k]!);
  const url = `${window.location.pathname}${q.toString() ? `?${q}` : ''}`;
  if (empilhar) window.history.pushState(null, '', url);
  else window.history.replaceState(null, '', url);
}

function passa(n: PainelComercialNegocio, f: Filtro) {
  if (f.etapa && n.etapa !== f.etapa) return false;
  if (f.canal && (n.canal ?? SEM_INFORMACAO) !== f.canal) return false;
  if (f.vendedor && (n.vendedor ?? SEM_INFORMACAO) !== f.vendedor) return false;
  if (f.situacao && n.resultado !== f.situacao) return false;
  if (f.fechado && !(n.mesFechado ?? '').startsWith(f.fechado)) return false;
  if (f.entrada && !n.mesEntrada.startsWith(f.entrada)) return false;
  return true;
}

function rotuloDoFiltro(k: keyof Filtro, v: string) {
  if (k === 'situacao') return SITUACAO[v as Situacao] ?? v;
  if (k === 'fechado') return `Fechado em ${mesPorExtenso(v)}`;
  if (k === 'entrada') return `Entrou em ${mesPorExtenso(v)}`;
  if (k === 'etapa') return `Etapa: ${v}`;
  if (k === 'canal') return `Canal: ${v}`;
  return `Vendedor: ${v}`;
}

export default function ComercialPage() {
  const { token, ready, can } = useAuth();
  const [p, setP] = useState<PainelComercial | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ver, setVer] = useState<Aba>('painel');
  const [filtro, setFiltro] = useState<Filtro>({});
  const [criando, setCriando] = useState(false);

  useEffect(() => {
    const ler = () => {
      const u = lerUrl();
      setVer(u.ver);
      setFiltro(u.filtro);
    };
    ler();
    window.addEventListener('popstate', ler);
    return () => window.removeEventListener('popstate', ler);
  }, []);

  useEffect(() => {
    if (!ready || !token) return;
    const ler = () => apiGet<PainelComercial>('/comercial/painel', token).then(setP).catch((e) => setError(e.message));
    ler();
    // A ficha em janela gravou: os números de baixo acompanham.
    window.addEventListener(EVENTO_FICHA_MUDOU, ler);
    return () => window.removeEventListener(EVENTO_FICHA_MUDOU, ler);
  }, [ready, token]);

  const abrir = useCallback((f: Filtro) => {
    setFiltro(f);
    setVer('negocios');
    escreverUrl('negocios', f, true);
    window.scrollTo({ top: 0 });
  }, []);
  const trocarAba = (v: Aba) => {
    setVer(v);
    escreverUrl(v, filtro, true);
  };
  const tirar = (k: keyof Filtro) => {
    const f = { ...filtro };
    delete f[k];
    setFiltro(f);
    escreverUrl(ver, f, false);
  };

  const novoLead = async () => {
    if (!token || !p?.lista) return;
    const titulo = window.prompt('Nome do lead (empresa | contato):');
    if (!titulo?.trim()) return;
    setCriando(true);
    try {
      const t = await apiPost<{ id: string }>('/trabalho/tarefas', { listId: p.lista.id, title: titulo.trim() }, token);
      setCriando(false);
      abrirFicha(t.id);
      apiGet<PainelComercial>('/comercial/painel', token).then(setP).catch(() => {});
    } catch (e) {
      setError((e as Error).message);
      setCriando(false);
    }
  };

  return (
    <div className="com-tema mx-auto max-w-[1180px] space-y-6 text-text">
      {p?.lista && (
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border">
          <div className="flex gap-1">
            {ABAS.map((v) => (
              <button
                key={v}
                onClick={() => trocarAba(v)}
                className={`-mb-px border-b-2 px-3 py-2.5 text-[0.95rem] ${
                  ver === v ? 'border-brand font-medium text-text' : 'border-transparent text-muted hover:text-text'
                }`}
              >
                {v === 'painel' ? 'Painel' : v === 'negocios' ? `Negócios (${p.negocios.length})` : 'Ajustes'}
              </button>
            ))}
          </div>
          {can('tarefas.editar') && (
            <button
              onClick={novoLead}
              disabled={criando}
              className="mb-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-50"
            >
              + Novo lead
            </button>
          )}
        </div>
      )}

      {error && <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{error}</div>}
      {!p && !error && <p className="text-muted">Carregando…</p>}

      {p && !p.lista && (
        <div className="rounded-md border border-border bg-surface px-5 py-4">
          <p>
            Ainda não existe a lista <b>Gestão de Leads</b> no Trabalho. O painel lê dela: etapas, canal de aquisição,
            vendedor e valor da proposta.
          </p>
        </div>
      )}

      {p?.lista && ver === 'painel' && <Painel p={p} abrir={abrir} ajustes={() => trocarAba('ajustes')} />}
      {p?.lista && ver === 'negocios' && <Negocios p={p} filtro={filtro} tirar={tirar} limpar={() => abrir({})} />}
      {p?.lista && ver === 'ajustes' && <Ajustes listaId={p.lista.id} />}
    </div>
  );
}

// ---------------- Painel ----------------

function Painel({ p, abrir, ajustes }: { p: PainelComercial; abrir: (f: Filtro) => void; ajustes: () => void }) {
  const ano = String(p.ano);
  return (
    <>
      <Destaque p={p} abrir={abrir} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Quadro titulo="Funil geral" nota="negócios em cada etapa · clique numa etapa">
          <Colunas chamada="clique para ver os negócios"
            itens={p.etapas.map((e) => ({
              chave: e.nome,
              rotulo: e.nome,
              v: e.qtd,
              mostra: String(e.qtd),
              tom: TOM_DO_RESULTADO[e.resultado],
              dica: [e.nome, negocios(e.qtd), e.valor ? brl(e.valor) : 'sem valor'],
              onClick: () => abrir({ etapa: e.nome }),
            }))}
          />
        </Quadro>
        <Quadro titulo="Valor por fase do funil" nota="soma do valor da proposta em cada etapa">
          <Colunas chamada="clique para ver os negócios"
            itens={p.etapas.map((e) => ({
              chave: e.nome,
              rotulo: e.nome,
              v: e.valor,
              mostra: curto(e.valor),
              tom: TOM_DO_RESULTADO[e.resultado],
              dica: [e.nome, e.valor ? brl(e.valor) : 'sem valor', negocios(e.qtd)],
              onClick: () => abrir({ etapa: e.nome }),
            }))}
          />
        </Quadro>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Quadro titulo={`Contratos fechados por mês · ${p.ano}`} nota="valor da proposta dos negócios fechados · clique num mês">
          <Meses meses={p.fechadosPorMes} medida="valor" onClick={(m) => abrir({ situacao: 'ganho', fechado: m })} verbo="fechados" />
        </Quadro>
        <Quadro titulo="Oportunidades geradas por mês" nota="leads que entraram no CRM, últimos 12 meses">
          <Meses meses={p.entradasPorMes} medida="qtd" onClick={(m) => abrir({ entrada: m })} verbo="entraram" />
        </Quadro>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Quadro titulo="Por canal de aquisição" nota="de onde vem o lead e de onde vem o contrato" acao={<Gerenciar onClick={ajustes} o="canais" />}>
          <Grupos grupos={p.canais} primeira="Canal" abrir={(nome, extra) => abrir({ canal: nome, ...extra })} />
        </Quadro>
        <Quadro titulo="Por vendedor" nota="quem carrega o quê" acao={<Gerenciar onClick={ajustes} o="vendedores" />}>
          <Grupos grupos={p.vendedores} primeira="Vendedor" abrir={(nome, extra) => abrir({ vendedor: nome, ...extra })} />
        </Quadro>
      </div>

      <Quadro titulo="Em negociação agora" nota="do maior valor para o menor">
        <ListaDeNegocios itens={p.negocios.filter((n) => n.resultado === 'aberta')} vazio="Nenhum negócio aberto." />
      </Quadro>
    </>
  );
}

/*
 * O DESTAQUE do painel: o ano numa barra só. Fechado (lima cheio) e em
 * negociação (lima claro) lado a lado, na proporção do valor; somados são o
 * potencial do ano. Cada parte abre os negócios dela.
 */
function Destaque({ p, abrir }: { p: PainelComercial; abrir: (f: Filtro) => void }) {
  const ano = String(p.ano);
  const fechado = p.totais.valorGanhoNoAno;
  const aberto = p.totais.emNegociacao;
  const verFechados = () => abrir({ situacao: 'ganho', fechado: ano });
  const verAbertos = () => abrir({ situacao: 'aberta' });
  return (
    <section className="grid gap-5 rounded-md border border-border bg-surface p-5 lg:grid-cols-[1fr_15rem]">
      <div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Numero rotulo={`Fechado em ${p.ano}`} valor={brl(fechado)} nota={`${p.totais.ganhosNoAno} contrato(s)`} cor={COR_DO_TOM.forte} onClick={verFechados} />
          <Numero rotulo="Em negociação" valor={brl(aberto)} nota={`${p.totais.abertos} aberto(s)`} cor={COR_DO_TOM.medio} onClick={verAbertos} />
        </div>
        <div className="mt-5">
          <BarraDividida
            rotuloDoTotal={`Potencial de ${p.ano}`}
            chamada="clique para ver os negócios"
            partes={[
              { chave: 'fechado', valor: fechado, tom: 'forte', dica: [`Fechado em ${p.ano}`, brl(fechado), negocios(p.totais.ganhosNoAno)], onClick: verFechados },
              { chave: 'aberto', valor: aberto, tom: 'medio', dica: ['Em negociação', brl(aberto), negocios(p.totais.abertos)], onClick: verAbertos },
            ]}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 border-border lg:grid-cols-1 lg:border-l lg:pl-5">
        <Numero
          rotulo="Conversão no ano"
          valor={p.totais.conversao == null ? '—' : `${p.totais.conversao}%`}
          nota={`${p.totais.ganhosNoAno} ganho(s), ${p.totais.perdidosNoAno} perdido(s)`}
          tamanho="medio"
          onClick={() => abrir({ fechado: ano })}
        />
        <Numero
          rotulo="Ticket médio"
          valor={p.totais.ticketMedio == null ? '—' : brl(p.totais.ticketMedio)}
          nota="dos contratos do ano"
          tamanho="medio"
          onClick={verFechados}
        />
      </div>
    </section>
  );
}

function Gerenciar({ onClick, o }: { onClick: () => void; o: string }) {
  return (
    <button onClick={onClick} className="text-sm text-muted underline hover:text-brand">
      gerenciar {o}
    </button>
  );
}





function Meses(props: { meses: PainelComercialMes[]; medida: 'valor' | 'qtd'; verbo: string; onClick: (mes: string) => void }) {
  const { meses, medida } = props;
  const vazio = meses.every((m) => m[medida] === 0);
  return (
    <div>
      <Colunas chamada="clique para ver os negócios"
        itens={meses.map((m) => ({
          chave: m.mes,
          rotulo: nomeDoMes(m.mes),
          v: m[medida],
          mostra: medida === 'valor' ? curto(m.valor) : String(m.qtd),
          tom: 'forte',
          dica: [mesPorExtenso(m.mes), `${negocios(m.qtd)} ${props.verbo}`, ...(m.valor ? [brl(m.valor)] : [])],
          onClick: () => props.onClick(m.mes),
        }))}
      />
      {vazio && <p className="mt-2 text-sm text-muted">Nada no período.</p>}
    </div>
  );
}

function Grupos(props: { grupos: PainelComercialGrupo[]; primeira: string; abrir: (nome: string, extra?: Filtro) => void }) {
  const { grupos, abrir } = props;
  if (grupos.length === 0) return <p className="text-muted">Sem leads.</p>;
  const max = Math.max(1, ...grupos.map((g) => g.leads));
  const celula = 'com-num py-2 text-right';
  const link = 'rounded px-1 hover:bg-brand/15 hover:text-brand';
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left">
            <th className="com-rotulo pb-2 font-normal">{props.primeira}</th>
            <th className="com-rotulo pb-2 text-right font-normal">Leads</th>
            <th className="com-rotulo pb-2 text-right font-normal">Fechados</th>
            <th className="com-rotulo pb-2 text-right font-normal">Conv.</th>
            <th className="com-rotulo pb-2 text-right font-normal">Em negociação</th>
            <th className="com-rotulo pb-2 text-right font-normal">Fechado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {grupos.map((g) => (
            <tr key={g.nome} className="cursor-pointer hover:bg-surface-2" onClick={() => abrir(g.nome)} title={`Ver os ${negocios(g.leads)} de ${g.nome}`}>
              <td className="py-2 pr-3">
                <div className={g.nome === SEM_INFORMACAO ? 'text-muted' : ''}>{g.nome}</div>
                <div className="mt-1 h-1 rounded-full bg-brand/45" style={{ width: `${(g.leads / max) * 100}%` }} />
              </td>
              <td className={celula}>{g.leads}</td>
              <td className={celula}>
                <button className={link} onClick={(e) => { e.stopPropagation(); abrir(g.nome, { situacao: 'ganho' }); }} title={`Fechados de ${g.nome}`}>
                  {g.ganhos}
                </button>
              </td>
              <td className={`${celula} text-muted`}>{pct(g.ganhos, g.leads)}</td>
              <td className={celula}>
                {g.emNegociacao ? (
                  <button className={link} onClick={(e) => { e.stopPropagation(); abrir(g.nome, { situacao: 'aberta' }); }} title={`Em negociação de ${g.nome}`}>
                    {brl(g.emNegociacao)}
                  </button>
                ) : '—'}
              </td>
              <td className={celula}>{g.valorGanho ? brl(g.valorGanho) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------- Negócios ----------------

function Negocios(props: { p: PainelComercial; filtro: Filtro; tirar: (k: keyof Filtro) => void; limpar: () => void }) {
  const { p, filtro } = props;
  const itens = useMemo(() => p.negocios.filter((n) => passa(n, filtro)), [p, filtro]);
  const ativos = CHAVES.filter((k) => filtro[k]);
  const total = itens.reduce((s, n) => s + (n.valor ?? 0), 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {ativos.length === 0 && <span className="text-sm text-muted">Todos os negócios. Clique num número do painel para filtrar.</span>}
        {ativos.map((k) => (
          <button
            key={k}
            onClick={() => props.tirar(k)}
            className="rounded-full border border-brand/50 bg-brand/10 px-3 py-1 text-sm hover:bg-brand/20"
            title="Tirar este filtro"
          >
            {rotuloDoFiltro(k, filtro[k]!)} <span className="ml-1 text-muted">×</span>
          </button>
        ))}
        {ativos.length > 0 && (
          <button onClick={props.limpar} className="text-sm text-muted underline hover:text-text">limpar</button>
        )}
        <span className="ml-auto text-sm text-muted">
          {negocios(itens.length)} · <span className="com-num text-text">{brl(total)}</span>
        </span>
      </div>
      <div className="rounded-md border border-border bg-surface px-5 py-2">
        <ListaDeNegocios itens={itens} vazio="Nenhum negócio com esse filtro." completa />
      </div>
    </div>
  );
}

function ListaDeNegocios({ itens, vazio, completa }: { itens: PainelComercialNegocio[]; vazio: string; completa?: boolean }) {
  if (itens.length === 0) return <p className="py-2 text-muted">{vazio}</p>;
  return (
    <div className="divide-y divide-border">
      {itens.map((n) => (
        <button key={n.id} onClick={() => abrirFicha(n.id)} className="group flex w-full flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5 text-left hover:bg-surface-2">
          <span className="min-w-0 flex-1 font-medium group-hover:text-brand">{n.titulo}</span>
          <span className="flex items-center gap-1.5 text-sm text-muted">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: n.etapaCor }} />
            {n.etapa}
            {n.resultado === 'aberta' && n.diasNaEtapa != null && ` · há ${n.diasNaEtapa} ${n.diasNaEtapa === 1 ? 'dia' : 'dias'}`}
            {n.mesFechado && ` · ${mesPorExtenso(n.mesFechado)}`}
          </span>
          {completa && (
            <span className="text-sm text-muted">
              {n.canal ?? 'sem canal'} · {n.vendedor ?? 'sem vendedor'}
            </span>
          )}
          <span className="com-num w-28 text-right">{n.valor == null ? '—' : brl(n.valor)}</span>
        </button>
      ))}
    </div>
  );
}
