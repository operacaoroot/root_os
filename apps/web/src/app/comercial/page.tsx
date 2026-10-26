'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  COMERCIAL_ROTULO_DA_ETAPA,
  SEM_INFORMACAO,
  type ComercialEtapa,
  type PainelComercial,
  type PainelComercialGrupo,
  type PainelComercialMes,
  type PainelComercialNegocio,
  type ResultadoDaEtapa,
} from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { partesDoLead } from '@/lib/nome-do-lead';
import { BarraDividida, COR_DO_TOM, Colunas, Numero, Quadro, brl, curto, type Tom } from '@/components/painel';

/*
 * PAINEL GERAL DO COMERCIAL (versão final, 19/10/2026): o desenho do Lucas,
 * lendo os dados do cockpit (lead, ficha, fechamentos e contratos vivos). Nada
 * vem mais da lista "Gestão de Leads" do Trabalho.
 *
 * Todo número do painel é clicável e vira um filtro da aba Negócios; cada
 * negócio abre o painel do lead (`/comercial/lead/<id>`), onde a etapa anda.
 * O filtro mora na URL (?ver=negocios&canal=Indicação…) para o voltar do
 * navegador desfazer o clique e o link poder ser mandado a alguém.
 */

const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const nomeDoMes = (aaaaMm: string) => MES[Number(aaaaMm.slice(5, 7)) - 1];
const mesPorExtenso = (p: string) => (p.length === 4 ? p : `${nomeDoMes(p)}/${p.slice(0, 4)}`);
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
/** Ganho em lima cheio, aberto em lima claro, perda e geladeira em cinza: um acento só. */
const TOM_DO_RESULTADO: Record<ResultadoDaEtapa, Tom> = { ganho: 'forte', aberta: 'medio', perdido: 'fraco', pausa: 'fraco' };
const negocios = (n: number) => `${n} ${n === 1 ? 'negócio' : 'negócios'}`;
const linkDoLead = (id: string) => `/comercial/lead/${id}`;

type Situacao = ResultadoDaEtapa;
interface Filtro {
  /** A etapa do cockpit (`ComercialEtapa`). */
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
type Aba = 'painel' | 'negocios';
/** Integração 26/10: o tipo do acordo no singular e no plural. */
const ROTULO_DO_TIPO: Record<string, [string, string]> = {
  pagante: ['pagante', 'pagantes'], parceria: ['parceria', 'parcerias'], permuta: ['permuta', 'permutas'], repasse: ['repasse', 'repasses'],
};
const SITUACAO: Record<Situacao, string> = { aberta: 'Em negociação', ganho: 'Fechados', perdido: 'Perdidos', pausa: 'Na geladeira' };

function lerUrl(): { ver: Aba; filtro: Filtro } {
  if (typeof window === 'undefined') return { ver: 'painel', filtro: {} };
  const q = new URLSearchParams(window.location.search);
  const filtro: Filtro = {};
  for (const k of CHAVES) {
    const v = q.get(k);
    if (v) (filtro as Record<string, string>)[k] = v;
  }
  return { ver: q.get('ver') === 'negocios' ? 'negocios' : 'painel', filtro };
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
  if (f.etapa && n.etapaChave !== f.etapa) return false;
  if (f.canal && (n.canal ?? SEM_INFORMACAO) !== f.canal) return false;
  if (f.vendedor && (n.vendedor ?? SEM_INFORMACAO) !== f.vendedor) return false;
  if (f.situacao && n.resultado !== f.situacao) return false;
  if (f.fechado && !n.mesesFechados.some((m) => m.startsWith(f.fechado!)) && !(n.mesFechado ?? '').startsWith(f.fechado)) return false;
  if (f.entrada && !n.mesEntrada.startsWith(f.entrada)) return false;
  return true;
}

function rotuloDoFiltro(k: keyof Filtro, v: string) {
  if (k === 'situacao') return SITUACAO[v as Situacao] ?? v;
  if (k === 'fechado') return `Fechado em ${mesPorExtenso(v)}`;
  if (k === 'entrada') return `Entrou em ${mesPorExtenso(v)}`;
  if (k === 'etapa') return `Etapa: ${COMERCIAL_ROTULO_DA_ETAPA[v as ComercialEtapa] ?? v}`;
  if (k === 'canal') return `Canal: ${v}`;
  return `Vendedor: ${v}`;
}

export default function ComercialPage() {
  const { token, ready, can } = useAuth();
  const router = useRouter();
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
    apiGet<PainelComercial>('/comercial/painel', token).then(setP).catch((e) => setError(e.message));
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

  /** O lead novo entra pela entrada idempotente do cockpit (origem manual) e abre no painel dele. */
  const novoLead = async () => {
    if (!token) return;
    const nome = window.prompt('Nome do lead:');
    if (!nome?.trim()) return;
    setCriando(true);
    try {
      const ref = `painel-geral:${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now().toString(36)}`;
      const l = await apiPost<{ id: string }>('/leads/entrada', { origem: { tipo: 'manual', ref }, nome: nome.trim() }, token);
      router.push(linkDoLead(l.id));
    } catch (e) {
      setError((e as Error).message);
      setCriando(false);
    }
  };

  return (
    <div className="com-tema mx-auto max-w-[1180px] space-y-6 text-text">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border">
        <div className="flex gap-1">
          {(['painel', 'negocios'] as Aba[]).map((v) => (
            <button
              key={v}
              onClick={() => trocarAba(v)}
              className={`-mb-px border-b-2 px-3 py-2.5 text-[0.95rem] ${
                ver === v ? 'border-brand font-medium text-text' : 'border-transparent text-muted hover:text-text'
              }`}
            >
              {v === 'painel' ? 'Painel' : `Negócios${p ? ` (${p.negocios.length})` : ''}`}
            </button>
          ))}
        </div>
        <div className="mb-2 flex items-center gap-3">
          <Link href="/comercial/funil" className="text-sm text-muted underline hover:text-brand">abrir o Funil de vendas</Link>
          {can('leads.editar') && (
            <button
              onClick={novoLead}
              disabled={criando}
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-50"
            >
              + Novo lead
            </button>
          )}
        </div>
      </div>

      {error && <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{error}</div>}
      {!p && !error && <p className="text-muted">Carregando…</p>}
      {p && p.foraDoTeto > 0 && (
        <p className="text-sm text-muted">O painel leu os leads mais recentes; {p.foraDoTeto} mais antigos ficaram de fora da conta.</p>
      )}
      {p && p.negocios.length === 0 && (
        <div className="rounded-md border border-border bg-surface px-5 py-4">
          <p>Ainda não há leads no funil. O lead entra pelo WhatsApp, pela sala ou pelo botão de novo lead.</p>
        </div>
      )}

      {p && p.negocios.length > 0 && ver === 'painel' && <Painel p={p} abrir={abrir} />}
      {p && ver === 'negocios' && <Negocios p={p} filtro={filtro} tirar={tirar} limpar={() => abrir({})} />}
    </div>
  );
}

// ---------------- Painel ----------------

function Painel({ p, abrir }: { p: PainelComercial; abrir: (f: Filtro) => void }) {
  return (
    <>
      <Destaque p={p} abrir={abrir} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Quadro titulo="Funil geral" nota="negócios em cada etapa · clique numa etapa" acao={<Link href="/comercial/funil" className="text-sm text-muted underline hover:text-brand">Funil de vendas</Link>}>
          <Colunas chamada="clique para ver os negócios"
            itens={p.etapas.map((e) => ({
              chave: e.id,
              rotulo: e.nome,
              v: e.qtd,
              mostra: String(e.qtd),
              tom: TOM_DO_RESULTADO[e.resultado],
              dica: [e.nome, negocios(e.qtd), e.valor ? brl(e.valor) : 'sem valor'],
              onClick: () => abrir({ etapa: e.id }),
            }))}
          />
        </Quadro>
        <Quadro titulo="Valor por fase do funil" nota="soma do valor da proposta em cada etapa">
          <Colunas chamada="clique para ver os negócios"
            itens={p.etapas.map((e) => ({
              chave: e.id,
              rotulo: e.nome,
              v: e.valor,
              mostra: curto(e.valor),
              tom: TOM_DO_RESULTADO[e.resultado],
              dica: [e.nome, e.valor ? brl(e.valor) : 'sem valor', negocios(e.qtd)],
              onClick: () => abrir({ etapa: e.id }),
            }))}
          />
        </Quadro>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Quadro titulo={`Contratos fechados por mês · ${p.ano}`} nota="valor da proposta dos negócios fechados · clique num mês">
          <Meses meses={p.fechadosPorMes} medida="valor" onClick={(m) => abrir({ situacao: 'ganho', fechado: m })} verbo="fechados" />
        </Quadro>
        <Quadro titulo="Oportunidades geradas por mês" nota="leads que entraram, últimos 12 meses">
          <Meses meses={p.entradasPorMes} medida="qtd" onClick={(m) => abrir({ entrada: m })} verbo="entraram" />
        </Quadro>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Quadro titulo="Por canal de aquisição" nota="de onde vem o lead e de onde vem o contrato">
          <Grupos grupos={p.canais} primeira="Canal" abrir={(nome, extra) => abrir({ canal: nome, ...extra })} />
        </Quadro>
        <Quadro titulo="Por vendedor" nota="o dono do lead · quem carrega o quê">
          <Grupos grupos={p.vendedores} primeira="Vendedor" abrir={(nome, extra) => abrir({ vendedor: nome, ...extra })} />
        </Quadro>
      </div>

      <Quadro titulo="Em negociação agora" nota="do maior valor para o menor · clique para abrir o lead">
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
          <Numero rotulo="Em negociação · funil todo" valor={brl(aberto)} nota={`${p.totais.abertos} aberto(s), com ou sem proposta`} cor={COR_DO_TOM.medio} onClick={verAbertos} />
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
        <div className="mt-5 grid gap-4 border-t border-border pt-4 sm:grid-cols-3">
          {/* Integração 26/10: clientes pelos acordos do Financeiro (pagante, parceria, permuta, repasse); o funil só vê quem fechou nele. */}
          {p.totais.clientesPorAcordo && p.totais.clientesPorAcordo.total > 0 ? (
            <div className="rounded-md p-1">
              <Numero
                rotulo="Clientes ativos" valor={String(p.totais.clientesPorAcordo.total)} tamanho="medio"
                nota={p.totais.clientesPorAcordo.porTipo.map((t) => `${t.clientes.length} ${ROTULO_DO_TIPO[t.tipo]?.[t.clientes.length === 1 ? 0 : 1] ?? t.tipo}`).join(' · ')}
                onClick={() => abrir({ situacao: 'ganho' })}
              />
              <details className="mt-1 text-[12px] text-muted">
                <summary className="cursor-pointer hover:text-text">quem são · {p.totais.clientesAtivos} fecharam no funil</summary>
                <ul className="mt-1 space-y-0.5">
                  {p.totais.clientesPorAcordo.porTipo.map((t) => (
                    <li key={t.tipo}><b className="font-medium text-text">{ROTULO_DO_TIPO[t.tipo]?.[1] ?? t.tipo}:</b> {t.clientes.join(', ')}</li>
                  ))}
                </ul>
              </details>
            </div>
          ) : (
            <Numero rotulo="Clientes ativos" valor={String(p.totais.clientesAtivos)} nota="fecharam e seguem com contrato" tamanho="medio" onClick={() => abrir({ situacao: 'ganho' })} />
          )}
          <Link href="/comercial/contratos" className="group rounded-md p-1 hover:bg-surface-2">
            <div className="com-rotulo">Contratos vivos</div>
            <div className="com-num mt-1.5 text-[1.5rem] font-bold leading-none">{p.totais.contratosVivos}</div>
            <div className="mt-1.5 text-sm text-muted">em acompanhamento<span className="opacity-0 transition group-hover:opacity-100"> · ver →</span></div>
          </Link>
          <Numero rotulo="Na geladeira" valor={String(p.totais.naGeladeira)} nota="voltam com data" tamanho="medio" onClick={() => abrir({ situacao: 'pausa' })} />
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
          nota={p.totais.ganhosSemValor ? `dos contratos do ano com valor · ${p.totais.ganhosSemValor} sem valor na ficha` : 'dos contratos do ano'}
          tamanho="medio"
          onClick={verFechados}
        />
      </div>
    </section>
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
  // Layout 26/10 (P-28): do mais recente para o mais antigo (última atualização do negócio).
  const itens = useMemo(() => p.negocios.filter((n) => passa(n, filtro)).sort((a, b) => b.atualizadoEm.localeCompare(a.atualizadoEm)), [p, filtro]);
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
        {filtro.etapa && (
          <Link href="/comercial/funil" className="text-sm text-muted underline hover:text-brand">ver no Funil de vendas</Link>
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
        <Link key={n.id} href={linkDoLead(n.id)} className="group flex w-full flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5 text-left hover:bg-surface-2">
          <span className="min-w-0 flex-1">
            <TituloDoLead nome={n.titulo} />
          </span>
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
        </Link>
      ))}
    </div>
  );
}

/** Layout 26/10 (P-22): empresa em destaque e o representante ao lado, menor. */
function TituloDoLead({ nome }: { nome: string }) {
  const { titulo, pessoa } = partesDoLead(nome);
  return (
    <>
      <span className="font-medium group-hover:text-brand">{titulo}</span>
      {pessoa && <span className="ml-2 text-sm text-muted">{pessoa}</span>}
    </>
  );
}
