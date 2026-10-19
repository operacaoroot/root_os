'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PainelComercial, PainelComercialNegocio, TrabEstrutura } from '@mktos/shared';
import { ErroDaApi, apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { EVENTO_FICHA_MUDOU, abrirFicha } from '@/lib/ficha';
import { Colunas, Numero, Quadro, brl } from '@/components/painel';
import {
  ETAPAS,
  quando,
  tempo,
  type DetalheDaProposta,
  type ListaDePropostas,
  type PropostaNaLista,
} from './tipos';

/*
 * ============================================================================
 * PROPOSTAS COMERCIAIS — quem recebeu, quem leu e quem quer pagar
 * ============================================================================
 *
 * Tela da ROOT (sessão da plataforma), não de cliente: a API recusa qualquer
 * outra sessão com 403 e esta tela explica em vez de quebrar. Só leitura do
 * serviço de propostas (proposta.operacaoroot.com); o pagamento confirmado
 * mora no Asaas.
 *
 * Mesmo desenho do Painel geral (18/10/2026): o funil das propostas em cima,
 * como dash, e todo número clicável filtra a lista. Cada proposta mostra o lead
 * dela no CRM e abre a ficha em janela.
 *
 * Fica fora do NAV, que é filtrado por permissão, não por "ser a plataforma"
 * (ver `ITENS_DA_ROOT` em components/navegacao-modulos.ts).
 */

const BASE = '/tenants/plataforma/propostas';
/** Etapa do leitor: 0 enviada · 1 abriu · 2 leu o investimento · 3 clicou em pagar. */
const COR_DA_ETAPA = ['bg-muted/40', 'bg-brand/35', 'bg-brand/65', 'bg-brand'];

/*
 * A proposta e o lead se encontram pelo link: o campo "Link da proposta" da
 * ficha guarda o endereço curto (proposta.operacaoroot.com/felipe-fortes) ou o
 * longo (/cliente/chave). Qualquer um dos dois casa.
 */
const semProtocolo = (u: string) => u.replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();
function porLink(p: PropostaNaLista, negocios: PainelComercialNegocio[]): PainelComercialNegocio | undefined {
  const link = semProtocolo(p.link);
  return negocios.find((n) => {
    if (!n.linkProposta) return false;
    const l = semProtocolo(n.linkProposta);
    return l === link || l.endsWith(`/${p.chave.toLowerCase()}`);
  });
}
/**
 * Um card por cliente: a proposta casa pelo link e, se não casar, por outra
 * proposta do MESMO cliente que casou (o Sr. aGranel recebeu a Imersão e
 * depois a Operação; as duas são do mesmo card).
 */
function leadDaProposta(p: PropostaNaLista, negocios: PainelComercialNegocio[], propostas: PropostaNaLista[]): PainelComercialNegocio | undefined {
  return porLink(p, negocios) ?? propostas.filter((o) => o.cliente === p.cliente && o.chave !== p.chave).map((o) => porLink(o, negocios)).find(Boolean);
}
/** A apresentação institucional não é negócio de um cliente: não pede lead. */
const ehInstitucional = (p: PropostaNaLista) => p.cliente === 'root-institucional';

export default function Propostas() {
  const { token, ready } = useAuth();
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [dados, setDados] = useState<ListaDePropostas | null>(null);
  const [selecionada, setSelecionada] = useState<PropostaNaLista | null>(null);
  const [detalhe, setDetalhe] = useState<DetalheDaProposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [crm, setCrm] = useState<PainelComercial | null>(null);
  const [criando, setCriando] = useState<string | null>(null);
  /** Filtro do funil: só as propostas que chegaram até esta etapa. */
  const [chegou, setChegou] = useState<number | null>(null);

  useEffect(() => {
    if (!ready || !token) return;
    const ler = () => apiGet<PainelComercial>('/comercial/painel', token).then(setCrm).catch(() => setCrm(null));
    ler();
    window.addEventListener(EVENTO_FICHA_MUDOU, ler);
    return () => window.removeEventListener(EVENTO_FICHA_MUDOU, ler);
  }, [ready, token]);
  const negocios = useMemo(() => crm?.negocios ?? [], [crm]);

  /** Cria o lead da proposta já com o título e o link, e abre a ficha. */
  const criarLead = async (p: PropostaNaLista) => {
    if (!token || !crm?.lista) return;
    setCriando(p.chave);
    try {
      const e = await apiGet<TrabEstrutura>('/trabalho/estrutura', token);
      const l = [...e.folders.flatMap((f) => f.lists), ...e.listasSoltas].find((x) => x.id === crm.lista!.id);
      const campo = l?.fields.find((f) => f.type === 'url' && /proposta/i.test(f.name));
      const t = await apiPost<{ id: string }>(
        '/trabalho/tarefas',
        { listId: crm.lista.id, title: p.titulo, campos: campo ? { [campo.id]: { value: p.link } } : undefined },
        token,
      );
      setCriando(null);
      abrirFicha(t.id);
      apiGet<PainelComercial>('/comercial/painel', token).then(setCrm).catch(() => {});
    } catch (e) {
      setErro((e as Error).message);
      setCriando(null);
    }
  };

  const carregar = useCallback(async () => {
    if (!token) return;
    setCarregando(true);
    setErro(null);
    try {
      await apiGet<{ plataforma: true }>('/tenants/plataforma/quem-sou', token);
      setAutorizado(true);
      const d = await apiGet<ListaDePropostas>(BASE, token);
      setDados(d);
      // Nada abre sozinho: o detalhe é janela, e só aparece quando a proposta é clicada.
      setSelecionada((atual) => d.propostas.find((p) => p.chave === atual?.chave) ?? null);
    } catch (e) {
      if (e instanceof ErroDaApi && e.status === 403) setAutorizado(false);
      else setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [token]);

  useEffect(() => {
    if (ready) void carregar();
  }, [ready, carregar]);

  useEffect(() => {
    if (!token || !selecionada) return;
    let vivo = true;
    setDetalhe(null);
    apiGet<DetalheDaProposta>(`${BASE}/${selecionada.cliente}/${selecionada.chave}`, token)
      .then((d) => vivo && setDetalhe(d))
      .catch((e) => vivo && setErro((e as Error).message));
    return () => {
      vivo = false;
    };
  }, [token, selecionada]);

  if (!ready || (carregando && !dados)) return <p className="text-muted">Carregando…</p>;

  if (autorizado === false) {
    return (
      <div className="com-tema mx-auto max-w-[520px] rounded-md border border-border bg-surface p-6 text-text">
        <p className="font-medium">Esta área é da ROOT.</p>
        <p className="mt-2 text-sm text-muted">As propostas comerciais são vistas pela sessão de quem opera a plataforma.</p>
      </div>
    );
  }

  const propostas = dados?.propostas ?? [];
  const visiveis = chegou == null ? propostas : propostas.filter((p) => p.etapa >= chegou);
  // Um card por cliente: duas propostas do mesmo cliente contam uma vez só.
  const leads = [...new Map(propostas.map((p) => leadDaProposta(p, negocios, propostas)).filter((l): l is PainelComercialNegocio => !!l).map((l) => [l.id, l])).values()];
  const emJogo = leads.reduce((s, l) => s + (l && l.resultado === 'aberta' ? l.valor ?? 0 : 0), 0);
  const fechadas = leads.filter((l) => l?.resultado === 'ganho');
  const valorFechado = fechadas.reduce((s, l) => s + (l?.valor ?? 0), 0);

  return (
    <div className="com-tema mx-auto max-w-[1180px] space-y-6 text-text">
      {erro && <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{erro}</div>}

      <Funil propostas={propostas} chegou={chegou} filtrar={setChegou} emJogo={emJogo} fechadas={fechadas.length} valorFechado={valorFechado} />

      <Quadro
        titulo={chegou == null ? 'Propostas' : `Propostas que chegaram em "${ETAPAS[chegou]}"`}
        nota={`${visiveis.length} de ${propostas.length} · clique na proposta para abrir o detalhe, no lead para abrir a ficha`}
        acao={
          <div className="flex items-center gap-4">
            {chegou != null && (
              <button onClick={() => setChegou(null)} className="text-sm text-muted underline hover:text-text">ver todas</button>
            )}
            <button onClick={() => void carregar()} className="text-sm text-muted underline hover:text-text">recarregar</button>
          </div>
        }
      >
        {visiveis.length === 0 ? (
          <p className="text-muted">Nenhuma proposta aqui.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left">
                  <th className="com-rotulo pb-2 font-normal">Proposta</th>
                  <th className="com-rotulo pb-2 font-normal">Situação</th>
                  <th className="com-rotulo pb-2 font-normal">No CRM</th>
                  <th className="com-rotulo pb-2 text-right font-normal">Aberturas</th>
                  <th className="com-rotulo pb-2 text-right font-normal">Pessoas</th>
                  <th className="com-rotulo pb-2 text-right font-normal">Última atividade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visiveis.map((p) => {
                  const ativa = p.chave === selecionada?.chave;
                  const lead = leadDaProposta(p, negocios, propostas);
                  return (
                    <tr key={p.chave} onClick={() => setSelecionada(p)} className={`cursor-pointer ${ativa ? 'bg-brand/10' : 'hover:bg-surface-2'}`}>
                      <td className="py-2.5 pr-3">
                        <div className="font-medium">{p.titulo}</div>
                        <div className="text-xs text-muted">{p.link.replace(/^https?:\/\//, '')}</div>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          <span className={`inline-block h-2.5 w-2.5 rounded-sm ${COR_DA_ETAPA[p.etapa] ?? 'bg-muted/40'}`} />
                          {p.estado}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3" onClick={(e) => e.stopPropagation()}>
                        {lead ? (
                          <button onClick={() => abrirFicha(lead.id)} className="group text-left" title="Abrir a ficha do lead">
                            <span className="flex items-center gap-1.5 group-hover:text-brand">
                              <span className="inline-block h-2 w-2 rounded-full" style={{ background: lead.etapaCor }} />
                              {lead.etapa}
                            </span>
                            <span className="com-num whitespace-nowrap text-xs text-muted">{lead.valor != null ? brl(lead.valor) : 'sem valor'} · ficha →</span>
                          </button>
                        ) : ehInstitucional(p) ? (
                          <span className="text-sm text-muted">apresentação institucional</span>
                        ) : crm?.lista ? (
                          <button onClick={() => void criarLead(p)} className="rounded-md border border-brand px-2.5 py-1 text-xs text-brand hover:bg-brand/10">
                            {criando === p.chave ? 'criando…' : '+ criar lead'}
                          </button>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="com-num py-2.5 text-right">{p.aberturas}</td>
                      <td className="com-num py-2.5 text-right">{p.pessoas}</td>
                      <td className="py-2.5 text-right text-muted">{quando(p.ultimaAtividade)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Quadro>

      {selecionada && (
        <Janela fechar={() => setSelecionada(null)}>
          <Detalhe proposta={selecionada} detalhe={detalhe} lead={leadDaProposta(selecionada, negocios, dados?.propostas ?? [])} fechar={() => setSelecionada(null)} />
        </Janela>
      )}

      {dados && (
        <details className="rounded-md border border-border bg-surface px-5 py-3">
          <summary className="cursor-pointer text-sm text-muted">
            Aparelhos da equipe ({dados.aparelhosDaEquipe.length}) · as visitas deles não contam
          </summary>
          {dados.aparelhosDaEquipe.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Nenhum aparelho cadastrado ainda.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {dados.aparelhosDaEquipe.map((a) => (
                <li key={`${a.nome}-${a.desde}`} className="flex flex-wrap gap-x-3 text-muted">
                  <span className="font-medium text-text">{a.nome}</span>
                  <span>{a.aparelho}{a.descricao ? ` · ${a.descricao}` : ''}</span>
                  <span>desde {quando(a.desde)}</span>
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </div>
  );
}

/*
 * O funil das propostas, no lugar dos quatro cartões: cada etapa do leitor com
 * o número grande e uma barra proporcional ao total enviado. Clicar filtra a
 * lista. À direita, o que as propostas valem no CRM.
 */
function Funil(props: {
  propostas: PropostaNaLista[];
  chegou: number | null;
  filtrar: (n: number | null) => void;
  emJogo: number;
  fechadas: number;
  valorFechado: number;
}) {
  const total = props.propostas.length || 1;
  const nomes = ['Enviadas', 'Abriram', 'Leram o investimento', 'Clicaram em pagar'];
  return (
    <section className="grid gap-5 rounded-md border border-border bg-surface p-5 lg:grid-cols-[1fr_15rem]">
      <div className="grid gap-4 sm:grid-cols-4">
        {nomes.map((nome, i) => {
          const n = props.propostas.filter((p) => p.etapa >= i).length;
          const on = props.chegou === i;
          return (
            <button
              key={nome}
              onClick={() => props.filtrar(on ? null : i)}
              className={`group rounded-md p-1 text-left hover:bg-surface-2 ${on ? 'bg-brand/10' : ''}`}
              title={on ? 'Tirar o filtro' : `Ver as que chegaram em "${nome}"`}
            >
              <div className="com-rotulo flex items-center gap-2">
                <span className={`inline-block h-2.5 w-2.5 rounded-sm ${COR_DA_ETAPA[i]}`} />
                {nome}
              </div>
              <div className="com-num mt-1.5 text-[2.2rem] font-bold leading-none">{n}</div>
              <div className="mt-2 h-2 w-full rounded-sm bg-surface-2">
                <div className={`h-full rounded-sm ${COR_DA_ETAPA[i]}`} style={{ width: `${(n / total) * 100}%` }} />
              </div>
              <div className="mt-1.5 text-sm text-muted">
                {i === 0 ? 'todas' : `${Math.round((n / total) * 100)}% das enviadas`}
                <span className="opacity-0 transition group-hover:opacity-100"> · ver →</span>
              </div>
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-4 border-border lg:grid-cols-1 lg:border-l lg:pl-5">
        <div className="p-1">
          <div className="com-rotulo">Em negociação no CRM</div>
          <div className="com-num mt-1.5 text-[1.5rem] font-bold leading-none">{brl(props.emJogo)}</div>
          <div className="mt-1.5 text-sm text-muted">soma das propostas abertas</div>
        </div>
        <div className="p-1">
          <div className="com-rotulo">Viraram contrato</div>
          <div className="com-num mt-1.5 text-[1.5rem] font-bold leading-none">{brl(props.valorFechado)}</div>
          <div className="mt-1.5 text-sm text-muted">{props.fechadas} proposta(s) fechada(s)</div>
        </div>
      </div>
    </section>
  );
}


/**
 * O detalhe abre por cima da lista, como a ficha: centralizado, fechar no canto
 * superior direito, Esc e clique fora fecham, e a lista fica onde estava.
 */
function Janela({ fechar, children }: { fechar: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      // Com a ficha do lead aberta por cima, o Esc é dela.
      if (e.key === 'Escape' && !document.querySelector('[aria-label="Ficha do cliente"]')) fechar();
    };
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', esc);
    return () => {
      document.body.style.overflow = antes;
      window.removeEventListener('keydown', esc);
    };
  }, [fechar]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-3 min-[820px]:p-8" onClick={fechar}>
      <div role="dialog" aria-modal="true" aria-label="Detalhe da proposta" className="com-tema max-h-full w-full max-w-[1000px] overflow-y-auto rounded-lg text-text shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function Detalhe({ proposta, detalhe, lead, fechar }: { proposta: PropostaNaLista; detalhe: DetalheDaProposta | null; lead?: PainelComercialNegocio; fechar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = () => {
    void navigator.clipboard
      .writeText(proposta.link)
      .then(() => {
        setCopiado(true);
        setTimeout(() => setCopiado(false), 1600);
      })
      .catch(() => setCopiado(false));
  };
  const [todas, setTodas] = useState(false);
  const botao = 'rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:border-brand hover:text-text';

  return (
    <section className="rounded-md border border-border bg-surface px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="com-rotulo">Proposta</div>
          <h2 className="mt-1 text-[1.4rem] font-bold leading-tight">{proposta.titulo}</h2>
          <p className="text-sm text-muted">{proposta.link.replace(/^https?:\/\//, '')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {lead && (
            <button onClick={() => abrirFicha(lead.id)} className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-ink hover:opacity-90">
              ficha do lead
            </button>
          )}
          <button onClick={copiar} className={botao}>{copiado ? 'link copiado' : 'copiar link'}</button>
          <a href={`${proposta.link}?equipe=1`} target="_blank" rel="noopener noreferrer" className={botao}>abrir proposta</a>
          <button
            onClick={fechar}
            aria-label="Fechar o detalhe"
            title="Fechar (Esc)"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-xl leading-none text-muted hover:border-brand hover:text-text"
          >
            ×
          </button>
        </div>
      </div>

      {/* Progresso do leitor: as etapas cumpridas em lima, o pago fica no Asaas. */}
      <ol className="mt-5 grid grid-cols-5 gap-1.5">
        {[...ETAPAS, 'Pago'].map((nome, i) => {
          const cumprida = i === 0 || (i <= 3 && proposta.etapa >= i);
          const pago = i === 4;
          return (
            <li key={nome} title={pago ? 'O pagamento confirmado é conferido no Asaas, no link da proposta.' : undefined}>
              <div className={`h-1.5 rounded-sm ${cumprida ? 'bg-brand' : 'bg-surface-2'}`} />
              <div className={`mt-1.5 text-xs ${cumprida ? 'text-text' : 'text-muted'}`}>
                {nome}
                {pago && <span className="block text-muted">confira no Asaas</span>}
              </div>
            </li>
          );
        })}
      </ol>

      {!detalhe ? (
        <p className="mt-5 text-sm text-muted">carregando o detalhe…</p>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Numero rotulo="Aberturas" valor={String(detalhe.aberturas)} tamanho="medio" />
            <Numero rotulo="Pessoas" valor={String(detalhe.pessoas)} tamanho="medio" />
            <Numero rotulo="Tempo de leitura" valor={detalhe.aberturas ? tempo(detalhe.tempoTotalMs) : '–'} tamanho="medio" />
            <Numero rotulo="Parte mais vista" valor={detalhe.maisVista ?? '–'} tamanho="texto" />
          </div>

          {/* Empilhado, não lado a lado: o tempo por parte vira colunas na largura toda, e as visitas vêm embaixo. */}
          {detalhe.tempoPorParte.length > 0 && (
            <div className="mt-7">
              <h3 className="text-[0.95rem] font-semibold">Tempo por parte</h3>
              <p className="text-sm text-muted">onde a leitura parou mais; a parte mais vista em destaque</p>
              <div className="mt-3">
                <Colunas
                  itens={detalhe.tempoPorParte.map((t) => ({
                    chave: t.id,
                    rotulo: t.nome,
                    v: t.ms,
                    mostra: tempo(t.ms),
                    tom: t.nome === detalhe.maisVista ? 'forte' : 'medio',
                    dica: [t.nome, tempo(t.ms), `${t.aberturasQueViram} abertura(s) chegaram aqui`],
                  }))}
                />
              </div>
            </div>
          )}

          <div className="mt-7">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-[0.95rem] font-semibold">Visitas</h3>
              {detalhe.visitas.length > 5 && (
                <button onClick={() => setTodas((x) => !x)} className="text-sm text-muted underline hover:text-text">
                  {todas ? 'ver só as últimas' : `ver todas (${detalhe.visitas.length})`}
                </button>
              )}
            </div>
            {detalhe.visitas.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Ainda não abriu.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="com-rotulo pb-2 font-normal">Quando</th>
                      <th className="com-rotulo pb-2 font-normal">Quem</th>
                      <th className="com-rotulo pb-2 font-normal">Aparelho</th>
                      <th className="com-rotulo pb-2 text-right font-normal">Tempo</th>
                      <th className="com-rotulo pb-2 pl-6 font-normal">Leu até</th>
                      <th className="com-rotulo pb-2 font-normal">Pagar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-muted">
                    {(todas ? detalhe.visitas : detalhe.visitas.slice(0, 5)).map((v, i) => (
                      <tr key={`${v.quando}-${i}`}>
                        <td className="whitespace-nowrap py-2">{quando(v.quando)}</td>
                        <td className="whitespace-nowrap text-text">pessoa {v.pessoa}</td>
                        <td>{v.aparelho}</td>
                        <td className="com-num whitespace-nowrap text-right">{tempo(v.tempoMs)}</td>
                        <td className="pl-6">{v.leuAte}</td>
                        <td className={v.clicouEmPagar ? 'font-medium text-brand' : ''}>{v.clicouEmPagar ? 'clicou' : '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-muted">
              &quot;Pessoa&quot; é cada navegador diferente. Uma parte conta como vista com 2 s ou mais na tela.
              {detalhe.visitasDaEquipeIgnoradas > 0 && ` ${detalhe.visitasDaEquipeIgnoradas} abertura(s) da equipe foram ignoradas.`}
            </p>
          </div>
        </>
      )}
    </section>
  );
}

