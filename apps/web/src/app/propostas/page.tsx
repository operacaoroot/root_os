'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type {
  DetalheDaPropostaDaSala,
  PainelComercial,
  PainelComercialNegocio,
  PropostaDaSalaNaLista,
  PropostasDaSala,
  ResultadoDoVinculo,
  VinculosDasPropostas,
} from '@mktos/shared';
import { refDaPropostaDoServico } from '@mktos/shared';
import { ErroDaApi, apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Colunas, Numero, Quadro, brl } from '@/components/painel';
import {
  ETAPAS,
  ETAPAS_DA_SALA,
  quando,
  tempo,
  type DetalheDaProposta,
  type ListaDePropostas,
  type PropostaNaLista,
} from './tipos';
import { leadsDaBusca, semAcento } from './lead-da-proposta';

/*
 * ============================================================================
 * PROPOSTAS · quem recebeu, quem leu e quem quer fechar (versão final, 19/10/2026)
 * ============================================================================
 *
 * A tela é a do Lucas (dash, lista, detalhe com tempo por parte e visitas) e
 * lê duas origens, cada linha dizendo de onde veio (decisão 1 do Rodrigo):
 *   · SALA: a proposta publicada no cockpit e lida pelo cliente em
 *     `/s/<token>/proposta`, da empresa da sessão, com `leads.ver`
 *     (`GET /comercial/propostas`). Leitura por seção, reações e aceite.
 *   · SERVIÇO DE PROPOSTAS: as antigas da ROOT (proposta.operacaoroot.com),
 *     que continuam aparecendo só na sessão da plataforma, como antes.
 *
 * O dash em cima soma as duas; todo número do funil filtra a lista. O lead de
 * cada proposta abre no painel do lead do cockpit (`/comercial/lead/<id>`).
 *
 * A PROPOSTA É DO LEAD (rodada de produção 3, I5, 22/10/2026): a primeira coluna
 * é o lead (a empresa, com o contato no balão) e o título da proposta vai como
 * texto de apoio; a coluna da origem e as do funil saíram; clicar na linha abre o
 * lead. A proposta do serviço sem lead diz "sem lead" e oferece "Vincular a um
 * lead" (busca entre os leads da empresa) e "Criar lead" (nasce em Qualificação
 * com o nome da proposta); o vínculo fica gravado (`/comercial/vinculos-de-propostas`).
 * O bloco "Aparelhos da equipe" subiu para entre o painel e a lista.
 */

const BASE_DO_SERVICO = '/tenants/plataforma/propostas';
/** Etapa do leitor: 0 enviada · 1 abriu · 2 leu o investimento · 3 aceitou ou clicou em pagar. */
const COR_DA_ETAPA = ['bg-muted/40', 'bg-brand/35', 'bg-brand/65', 'bg-brand'];
const NOMES_DO_FUNIL = ['Enviadas', 'Abriram', 'Leram o investimento', 'Aceitaram ou clicaram em pagar'];

type Origem = 'sala' | 'servico';
interface Linha {
  origem: Origem;
  /** Única entre as duas origens. */
  chave: string;
  titulo: string;
  cliente: string;
  subtitulo: string;
  estado: string;
  etapa: number;
  aberturas: number;
  /** A sala não identifica navegador: ausente. */
  pessoas: number | null;
  ultimaAtividade: string | null;
  reacoes: PropostaDaSalaNaLista['reacoes'] | null;
  sala?: PropostaDaSalaNaLista;
  servico?: PropostaNaLista;
}

/** A apresentação institucional não é negócio de um cliente: não pede lead. */
const ehInstitucional = (p: PropostaNaLista) => p.cliente === 'root-institucional';

/** O lead de uma linha, como a tela mostra: a empresa, o contato (balão) e de onde veio o vínculo. */
interface LeadDaLinha {
  id: string;
  empresa: string;
  contato: string | null;
  /** `sala`: o lead da proposta publicada; `vinculo`: gravado por uma pessoa; `nome`: casado pelo nome, sem vínculo gravado. */
  como: 'sala' | 'vinculo' | 'nome';
  negocio?: PainelComercialNegocio;
}

/** A referência gravada da proposta do serviço (nula quando o serviço mandou um segmento fora do formato). */
const refDaLinha = (l: Linha) => (l.servico ? refDaPropostaDoServico(l.servico.cliente, l.servico.chave) : null);

function doNegocio(n: PainelComercialNegocio, como: LeadDaLinha['como']): LeadDaLinha {
  const contato = [n.nome !== n.titulo ? n.nome : null, n.contato].filter(Boolean).join(' · ') || null;
  return { id: n.id, empresa: n.titulo, contato, como, negocio: n };
}

/**
 * O lead da proposta. Na sala, é o lead dela. No serviço de propostas, o vínculo
 * gravado por uma pessoa (I5); sem ele, o casamento pelo nome de antes (o título
 * da proposta ou o cliente, sem acento, com a empresa ou o nome do lead), que a
 * pessoa pode trocar vinculando. Sem nada, a linha diz "sem lead".
 */
function leadDaLinha(l: Linha, negocios: PainelComercialNegocio[], vinculos: Map<string, string>): LeadDaLinha | undefined {
  if (l.sala) {
    const n = negocios.find((x) => x.id === l.sala!.leadId);
    return n ? doNegocio(n, 'sala') : { id: l.sala.leadId, empresa: l.sala.cliente, contato: null, como: 'sala' };
  }
  if (!l.servico) return undefined;
  const ref = refDaLinha(l);
  const gravado = ref ? vinculos.get(ref) : undefined;
  if (gravado) {
    const n = negocios.find((x) => x.id === gravado);
    return n ? doNegocio(n, 'vinculo') : { id: gravado, empresa: 'lead vinculado', contato: null, como: 'vinculo' };
  }
  const alvos = [l.servico.titulo, l.servico.cliente.replace(/-/g, ' ')].map(semAcento).filter(Boolean);
  const n = negocios.find((x) => [x.titulo, x.nome].map(semAcento).some((y) => y && alvos.includes(y)));
  return n ? doNegocio(n, 'nome') : undefined;
}


function daSala(p: PropostaDaSalaNaLista): Linha {
  return {
    origem: 'sala',
    chave: `sala:${p.leadId}`,
    titulo: p.titulo,
    cliente: p.cliente,
    subtitulo: `${p.cliente} · publicada em ${quando(p.publicadaEm)}${p.valor != null ? ` · ${brl(p.valor)}` : ''}`,
    estado: p.estado,
    etapa: p.etapa,
    aberturas: p.aberturas,
    pessoas: null,
    ultimaAtividade: p.ultimaAtividade,
    reacoes: p.reacoes,
    sala: p,
  };
}

function doServico(p: PropostaNaLista): Linha {
  return {
    origem: 'servico',
    chave: `servico:${p.cliente}/${p.chave}`,
    titulo: p.titulo,
    cliente: p.cliente,
    subtitulo: p.link.replace(/^https?:\/\//, ''),
    estado: p.estado,
    etapa: p.etapa,
    aberturas: p.aberturas,
    pessoas: p.pessoas,
    ultimaAtividade: p.ultimaAtividade,
    reacoes: null,
    servico: p,
  };
}

export default function Propostas() {
  const { token, ready, can } = useAuth();
  const router = useRouter();
  const verSala = can('leads.ver');
  const editar = can('leads.editar');
  const [sala, setSala] = useState<PropostasDaSala | null>(null);
  const [servico, setServico] = useState<ListaDePropostas | null>(null);
  const [plataforma, setPlataforma] = useState<boolean | null>(null);
  const [crm, setCrm] = useState<PainelComercial | null>(null);
  const [vinculos, setVinculos] = useState<Map<string, string>>(new Map());
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  /** O serviço das propostas antigas fora do ar (503) não esconde as da sala: vira aviso. */
  const [avisoDoServico, setAvisoDoServico] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [selecionada, setSelecionada] = useState<Linha | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [vinculando, setVinculando] = useState<string | null>(null);
  /** Filtro do funil: só as propostas que chegaram até esta etapa. */
  const [chegou, setChegou] = useState<number | null>(null);

  const lerVinculos = useCallback(async () => {
    if (!token || !verSala) return;
    const r = await apiGet<VinculosDasPropostas>('/comercial/vinculos-de-propostas', token).catch(() => null);
    setVinculos(new Map((r?.vinculos ?? []).map((v) => [v.proposta, v.leadId])));
  }, [token, verSala]);

  const carregar = useCallback(async () => {
    if (!token) return;
    setCarregando(true);
    setErro(null);
    setAvisoDoServico(null);
    const tarefas: Promise<unknown>[] = [];
    if (verSala) {
      tarefas.push(apiGet<PropostasDaSala>('/comercial/propostas', token).then(setSala).catch((e) => setErro((e as Error).message)));
      tarefas.push(apiGet<PainelComercial>('/comercial/painel', token).then(setCrm).catch(() => setCrm(null)));
      tarefas.push(lerVinculos());
    }
    // As antigas do serviço de propostas: só a sessão da plataforma. Outra sessão recebe 403 e segue sem elas.
    tarefas.push(
      apiGet<{ plataforma: true }>('/tenants/plataforma/quem-sou', token)
        .then(async () => {
          setPlataforma(true);
          setServico(await apiGet<ListaDePropostas>(BASE_DO_SERVICO, token));
        })
        .catch((e) => {
          if (e instanceof ErroDaApi && e.status === 403) setPlataforma(false);
          else if (e instanceof ErroDaApi && e.status === 503) setAvisoDoServico((e as Error).message);
          else setErro((e as Error).message);
        }),
    );
    await Promise.all(tarefas);
    setCarregando(false);
  }, [token, verSala, lerVinculos]);

  useEffect(() => {
    if (ready) void carregar();
  }, [ready, carregar]);

  const linhas = useMemo(() => {
    const todas = [...(sala?.propostas ?? []).map(daSala), ...(servico?.propostas ?? []).map(doServico)];
    return todas.sort((a, b) => (b.ultimaAtividade ?? '').localeCompare(a.ultimaAtividade ?? ''));
  }, [sala, servico]);
  const negocios = useMemo(() => crm?.negocios ?? [], [crm]);
  const leadDe = (l: Linha) => leadDaLinha(l, negocios, vinculos);

  /** Grava o vínculo (vincular ou criar) e relê a lista; a frase da API aparece no topo. */
  const gravarVinculo = async (l: Linha, caminho: string, corpo: Record<string, string>, sucesso: (r: ResultadoDoVinculo) => string) => {
    if (!token) return;
    setOcupada(l.chave);
    setErro(null);
    setAviso(null);
    try {
      const r = await apiPost<ResultadoDoVinculo>(caminho, corpo, token);
      setVinculando(null);
      setAviso(sucesso(r));
      await Promise.all([lerVinculos(), apiGet<PainelComercial>('/comercial/painel', token).then(setCrm).catch(() => undefined)]);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupada(null);
    }
  };
  const vincular = (l: Linha, leadId: string) => {
    const proposta = refDaLinha(l);
    if (!proposta) return;
    void gravarVinculo(l, '/comercial/vinculos-de-propostas', { proposta, leadId }, (r) =>
      r.mudou ? 'Proposta vinculada ao lead.' : 'A proposta já estava vinculada a este lead.',
    );
  };
  const criarLead = (l: Linha) => {
    const proposta = refDaLinha(l);
    if (!proposta || !l.servico) return;
    void gravarVinculo(l, '/comercial/vinculos-de-propostas/lead', { proposta, nome: l.servico.titulo.slice(0, 200) }, (r) =>
      r.leadCriado ? 'Lead criado em Qualificação e ligado à proposta.' : r.mudou ? 'O lead desta proposta já existia: ficou ligado a ela.' : 'A proposta já estava ligada a este lead.',
    );
  };

  if (!ready || (carregando && !sala && !servico)) return <p className="text-muted">Carregando…</p>;

  if (!verSala && plataforma === false) {
    return (
      <div className="com-tema mx-auto max-w-[520px] rounded-md border border-border bg-surface p-6 text-text">
        <p className="font-medium">Sem acesso às propostas.</p>
        <p className="mt-2 text-sm text-muted">As propostas da sala pedem a permissão de ver leads.</p>
      </div>
    );
  }

  const visiveis = chegou == null ? linhas : linhas.filter((l) => l.etapa >= chegou);
  // Um lead por cliente: duas propostas do mesmo lead contam uma vez só.
  const leads = [...new Map(linhas.map((l) => leadDe(l)?.negocio).filter((x): x is PainelComercialNegocio => !!x).map((x) => [x.id, x])).values()];
  const emJogo = leads.reduce((s, x) => s + (x.resultado === 'aberta' ? x.valor ?? 0 : 0), 0);
  const fechadas = leads.filter((x) => x.resultado === 'ganho');
  const valorFechado = fechadas.reduce((s, x) => s + (x.valor ?? 0), 0);

  return (
    <div className="com-tema mx-auto max-w-[1180px] space-y-6 text-text">
      {erro && <div role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{erro}</div>}
      {aviso && <div role="status" className="rounded-lg border border-good/30 bg-good/10 px-4 py-2 text-sm text-good">{aviso}</div>}
      {avisoDoServico && (
        <div className="rounded-lg border border-border bg-surface px-4 py-2 text-sm text-muted">
          As propostas antigas do serviço de propostas não vieram agora ({avisoDoServico}). As da sala seguem abaixo.
        </div>
      )}

      <Funil linhas={linhas} chegou={chegou} filtrar={setChegou} emJogo={emJogo} fechadas={fechadas.length} valorFechado={valorFechado} comCrm={!!crm} />

      {/* I5: os aparelhos da equipe sobem para entre o painel e a lista. */}
      {servico && (
        <details className="rounded-md border border-border bg-surface px-5 py-3" data-testid="propostas-aparelhos">
          <summary className="cursor-pointer text-sm text-muted">
            Aparelhos da equipe ({servico.aparelhosDaEquipe.length}) · as visitas deles não contam no serviço de propostas
          </summary>
          {servico.aparelhosDaEquipe.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Nenhum aparelho cadastrado ainda.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {servico.aparelhosDaEquipe.map((a) => (
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

      <Quadro
        titulo={chegou == null ? 'Propostas' : `Propostas que chegaram em "${NOMES_DO_FUNIL[chegou]}"`}
        nota={`${visiveis.length} de ${linhas.length} · clique na linha para abrir o lead; "leitura" abre o detalhe da proposta`}
        acao={
          <div className="flex items-center gap-4">
            {chegou != null && (
              <button onClick={() => setChegou(null)} className="text-sm text-muted underline hover:text-text">ver todas</button>
            )}
            <button onClick={() => void carregar()} className="text-sm text-muted underline hover:text-text">recarregar</button>
          </div>
        }
      >
        {sala && sala.foraDoTeto > 0 && <p className="mb-3 text-sm text-muted">{sala.foraDoTeto} propostas mais antigas da sala ficaram fora da lista.</p>}
        {visiveis.length === 0 ? (
          <p className="text-muted">Nenhuma proposta aqui.</p>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm" data-testid="propostas-lista">
              <thead>
                <tr className="text-left">
                  <th className="com-rotulo pb-2 font-normal">Lead</th>
                  <th className="com-rotulo pb-2 font-normal">Situação</th>
                  <th className="com-rotulo pb-2 text-right font-normal">Aberturas</th>
                  <th className="com-rotulo pb-2 text-right font-normal">Pessoas</th>
                  <th className="com-rotulo pb-2 text-right font-normal">Reações</th>
                  <th className="com-rotulo pb-2 text-right font-normal">Última atividade</th>
                  <th className="com-rotulo pb-2 text-right font-normal"><span className="sr-only">Detalhe da proposta</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visiveis.map((l) => {
                  const ativa = l.chave === selecionada?.chave;
                  const lead = leadDe(l);
                  const ref = refDaLinha(l);
                  const institucional = !!l.servico && ehInstitucional(l.servico);
                  return (
                    <tr
                      key={l.chave}
                      data-testid={`proposta-${l.chave}`}
                      data-origem={l.origem}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('a, button, input, [role="dialog"]')) return;
                        if (lead) router.push(`/comercial/lead/${lead.id}`);
                        else setSelecionada(l);
                      }}
                      className={`cursor-pointer align-top ${ativa ? 'bg-brand/10' : 'hover:bg-surface-2'}`}
                    >
                      <td className="py-2.5 pr-3">
                        {lead ? (
                          <Link
                            href={`/comercial/lead/${lead.id}`}
                            title={lead.contato ? `Contato: ${lead.contato}` : 'Abrir o lead'}
                            className="font-medium hover:text-brand"
                            data-testid={`proposta-lead-${l.chave}`}
                          >
                            {lead.empresa}
                          </Link>
                        ) : (
                          <span className="font-medium text-muted" data-testid={`proposta-sem-lead-${l.chave}`}>
                            {institucional ? 'apresentação institucional' : 'sem lead'}
                          </span>
                        )}
                        <div className="text-xs text-muted">
                          {l.titulo}
                          {lead?.como === 'nome' && <span title="Casado pelo nome, sem vínculo gravado. Vincule para fixar."> · pelo nome</span>}
                        </div>
                        {!institucional && l.servico && ref && editar && (!lead || lead.como === 'nome') && (
                          <AcoesSemLead
                            linha={l}
                            negocios={negocios}
                            aberta={vinculando === l.chave}
                            ocupada={ocupada === l.chave}
                            semLead={!lead}
                            abrir={(sim) => setVinculando(sim ? l.chave : null)}
                            vincular={(leadId) => vincular(l, leadId)}
                            criar={() => criarLead(l)}
                          />
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          <span className={`inline-block h-2.5 w-2.5 rounded-sm ${COR_DA_ETAPA[l.etapa] ?? 'bg-muted/40'}`} />
                          {l.estado}
                        </span>
                      </td>
                      <td className="com-num py-2.5 text-right">{l.aberturas}</td>
                      <td className="com-num py-2.5 text-right">{l.pessoas ?? '—'}</td>
                      <td className="com-num py-2.5 text-right" title={l.reacoes ? `${l.reacoes.fazSentido} faz sentido · ${l.reacoes.duvidas} dúvida(s) · ${l.reacoes.ideias} ideia(s)` : 'o serviço de propostas não colhe reações'}>
                        {l.reacoes ? l.reacoes.fazSentido + l.reacoes.duvidas + l.reacoes.ideias : '—'}
                      </td>
                      <td className="whitespace-nowrap py-2.5 text-right text-muted">{quando(l.ultimaAtividade)}</td>
                      <td className="py-2.5 pl-3 text-right">
                        <button
                          type="button"
                          onClick={() => setSelecionada(l)}
                          className="rounded-md border border-border px-2 py-0.5 text-xs text-muted hover:border-brand hover:text-text"
                          data-testid={`proposta-leitura-${l.chave}`}
                        >
                          leitura
                        </button>
                      </td>
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
          {selecionada.sala ? (
            <DetalheSala proposta={selecionada.sala} token={token} fechar={() => setSelecionada(null)} />
          ) : selecionada.servico ? (
            <DetalheServico proposta={selecionada.servico} token={token} lead={leadDe(selecionada)} fechar={() => setSelecionada(null)} />
          ) : null}
        </Janela>
      )}
    </div>
  );
}

/**
 * As ações da proposta do serviço sem lead (I5): "Vincular a um lead" abre a
 * busca entre os leads da empresa; "Criar lead" cria em Qualificação com o nome
 * da proposta. Na linha casada só pelo nome, "Vincular" fixa (ou troca) o lead.
 * Esc fecha a busca.
 */
function AcoesSemLead({
  linha,
  negocios,
  aberta,
  ocupada,
  semLead,
  abrir,
  vincular,
  criar,
}: {
  linha: Linha;
  negocios: PainelComercialNegocio[];
  aberta: boolean;
  ocupada: boolean;
  semLead: boolean;
  abrir: (sim: boolean) => void;
  vincular: (leadId: string) => void;
  criar: () => void;
}) {
  const [texto, setTexto] = useState('');
  const achados = leadsDaBusca(negocios, texto);
  const botao = 'rounded-md border px-2.5 py-1 text-xs disabled:opacity-50';
  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          aria-expanded={aberta}
          disabled={ocupada}
          onClick={() => abrir(!aberta)}
          className={`${botao} border-brand text-brand hover:bg-brand/10`}
          data-testid={`proposta-vincular-${linha.chave}`}
        >
          {semLead ? 'Vincular a um lead' : 'Vincular a outro lead'}
        </button>
        {semLead && (
          <button type="button" disabled={ocupada} onClick={criar} className={`${botao} border-border text-muted hover:border-brand hover:text-text`} data-testid={`proposta-criar-lead-${linha.chave}`}>
            {ocupada ? 'gravando…' : 'Criar lead'}
          </button>
        )}
      </div>
      {aberta && (
        <div
          role="dialog"
          aria-label={`Vincular "${linha.titulo}" a um lead`}
          className="mt-2 w-full max-w-[360px] rounded-md border border-border bg-surface-2 p-2"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              abrir(false);
            }
          }}
        >
          <label className="block text-xs text-muted">
            Buscar lead pela empresa ou pelo contato
            <input
              autoFocus
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              className="mt-1 w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-text outline-none focus:border-brand"
              data-testid={`proposta-busca-${linha.chave}`}
            />
          </label>
          {achados.length === 0 ? (
            <p className="mt-2 text-xs text-muted">{negocios.length ? 'Nenhum lead com esse nome.' : 'Nenhum lead nesta empresa ainda.'}</p>
          ) : (
            <ul className="mt-2 max-h-56 overflow-y-auto">
              {achados.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    disabled={ocupada}
                    onClick={() => vincular(n.id)}
                    className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-brand/10 disabled:opacity-50"
                    data-testid={`proposta-escolher-${n.id}`}
                  >
                    <span className="block font-medium">{n.titulo}</span>
                    <span className="block text-xs text-muted">{[n.nome !== n.titulo ? n.nome : null, n.etapa].filter(Boolean).join(' · ')}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/*
 * O funil das propostas: cada etapa do leitor com o número grande e uma barra
 * proporcional ao total enviado. Clicar filtra a lista. À direita, o que as
 * propostas valem no funil do cockpit.
 */
function Funil(props: {
  linhas: Linha[];
  chegou: number | null;
  filtrar: (n: number | null) => void;
  emJogo: number;
  fechadas: number;
  valorFechado: number;
  comCrm: boolean;
}) {
  const total = props.linhas.length || 1;
  return (
    <section className="grid gap-5 rounded-md border border-border bg-surface p-5 lg:grid-cols-[1fr_15rem]">
      <div className="grid gap-4 sm:grid-cols-4">
        {NOMES_DO_FUNIL.map((nome, i) => {
          const n = props.linhas.filter((l) => l.etapa >= i).length;
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
          <div className="com-rotulo">Em negociação no funil</div>
          <div className="com-num mt-1.5 text-[1.5rem] font-bold leading-none">{props.comCrm ? brl(props.emJogo) : '—'}</div>
          <div className="mt-1.5 text-sm text-muted">valor dos leads abertos com proposta</div>
        </div>
        <div className="p-1">
          <div className="com-rotulo">Viraram contrato</div>
          <div className="com-num mt-1.5 text-[1.5rem] font-bold leading-none">{props.comCrm ? brl(props.valorFechado) : '—'}</div>
          <div className="mt-1.5 text-sm text-muted">{props.fechadas} lead(s) fechado(s)</div>
        </div>
      </div>
    </section>
  );
}

/**
 * O detalhe abre por cima da lista: centralizado, fechar no canto superior
 * direito, Esc e clique fora fecham, e a lista fica onde estava.
 */
function Janela({ fechar, children }: { fechar: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar();
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

function BotaoFechar({ fechar }: { fechar: () => void }) {
  return (
    <button
      onClick={fechar}
      aria-label="Fechar o detalhe"
      title="Fechar (Esc)"
      className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-xl leading-none text-muted hover:border-brand hover:text-text"
    >
      ×
    </button>
  );
}

function Progresso({ nomes, etapa, pago }: { nomes: readonly string[]; etapa: number; pago: { feito: boolean; nota?: string } }) {
  return (
    <ol className="mt-5 grid grid-cols-5 gap-1.5">
      {[...nomes, 'Pago'].map((nome, i) => {
        const ehPago = i === nomes.length;
        const cumprida = ehPago ? pago.feito : i === 0 || etapa >= i;
        return (
          <li key={nome}>
            <div className={`h-1.5 rounded-sm ${cumprida ? 'bg-brand' : 'bg-surface-2'}`} />
            <div className={`mt-1.5 text-xs ${cumprida ? 'text-text' : 'text-muted'}`}>
              {nome}
              {ehPago && pago.nota && <span className="block text-muted">{pago.nota}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** O detalhe da proposta da sala: tempo por seção, visitas, "faz sentido", dúvidas e ideias. */
function DetalheSala({ proposta, token, fechar }: { proposta: PropostaDaSalaNaLista; token: string | null; fechar: () => void }) {
  const [d, setD] = useState<DetalheDaPropostaDaSala | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [todas, setTodas] = useState(false);
  useEffect(() => {
    if (!token) return;
    let vivo = true;
    apiGet<DetalheDaPropostaDaSala>(`/comercial/propostas/${proposta.leadId}`, token)
      .then((x) => vivo && setD(x))
      .catch((e) => vivo && setErro((e as Error).message));
    return () => {
      vivo = false;
    };
  }, [token, proposta.leadId]);

  return (
    <section className="rounded-md border border-border bg-surface px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="com-rotulo">Proposta da sala</div>
          <h2 className="mt-1 text-[1.4rem] font-bold leading-tight">{proposta.cliente} · {proposta.titulo}</h2>
          <p className="text-sm text-muted">
            publicada em {quando(proposta.publicadaEm)}
            {proposta.valor != null ? ` · ${brl(proposta.valor)}` : ' · sem valor publicado'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/comercial/lead/${proposta.leadId}`} className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-ink hover:opacity-90">
            painel do lead
          </Link>
          <BotaoFechar fechar={fechar} />
        </div>
      </div>

      <Progresso
        nomes={ETAPAS_DA_SALA}
        etapa={proposta.etapa}
        pago={{ feito: !!proposta.pagaEm, nota: proposta.pagaEm ? quando(proposta.pagaEm) : 'sem pagamento registrado' }}
      />

      {erro && <p className="mt-5 text-sm text-bad">{erro}</p>}
      {!d && !erro ? (
        <p className="mt-5 text-sm text-muted">carregando o detalhe…</p>
      ) : d ? (
        <>
          <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Numero rotulo="Aberturas" valor={String(d.aberturas)} tamanho="medio" />
            <Numero rotulo="Tempo de leitura" valor={d.tempoTotalSegundos ? tempo(d.tempoTotalSegundos * 1000) : '–'} tamanho="medio" />
            <Numero rotulo="Parte mais vista" valor={d.maisVista ?? '–'} tamanho="texto" />
            <Numero rotulo="Reações" valor={String(d.reacoes.fazSentido + d.reacoes.duvidas + d.reacoes.ideias)} nota={`${d.reacoes.fazSentido} faz sentido · ${d.reacoes.duvidas} dúvida(s) · ${d.reacoes.ideias} ideia(s)`} tamanho="medio" />
          </div>

          {d.tempoPorParte.length > 0 && (
            <div className="mt-7">
              <h3 className="text-[0.95rem] font-semibold">Tempo por parte</h3>
              <p className="text-sm text-muted">onde a leitura parou mais; a parte mais vista em destaque</p>
              <div className="mt-3">
                <Colunas
                  itens={d.tempoPorParte.map((t) => ({
                    chave: t.secao,
                    rotulo: t.nome,
                    v: t.segundos,
                    mostra: tempo(t.segundos * 1000),
                    tom: t.nome === d.maisVista ? 'forte' : 'medio',
                    dica: [t.nome, tempo(t.segundos * 1000), `${t.aberturasQueViram} visita(s) chegaram aqui`],
                  }))}
                />
              </div>
            </div>
          )}

          {(d.fazSentidoPorSecao.length > 0 || d.anotacoes.length > 0) && (
            <div className="mt-7">
              <h3 className="text-[0.95rem] font-semibold">O que o cliente deixou</h3>
              {d.fazSentidoPorSecao.length > 0 && (
                <p className="mt-1 text-sm text-muted">
                  Faz sentido: {d.fazSentidoPorSecao.map((f) => `${f.nome} (${f.vezes})`).join(' · ')}
                </p>
              )}
              {d.anotacoes.length > 0 && (
                <ul className="mt-2 divide-y divide-border text-sm">
                  {d.anotacoes.map((a) => (
                    <li key={a.id} className="py-2">
                      <div className="text-xs text-muted">
                        {a.tipo === 'ideia' ? 'Ideia' : 'Dúvida'} · {quando(a.em)} · visita {a.acesso}
                        {a.respondidaEm ? ' · respondida' : ''}
                      </div>
                      <div className="mt-0.5 whitespace-pre-wrap">{a.texto}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mt-7">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-[0.95rem] font-semibold">Visitas</h3>
              {d.visitas.length > 5 && (
                <button onClick={() => setTodas((x) => !x)} className="text-sm text-muted underline hover:text-text">
                  {todas ? 'ver só as últimas' : `ver todas (${d.visitas.length})`}
                </button>
              )}
            </div>
            {d.visitas.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Ainda não abriu.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="com-rotulo pb-2 font-normal">Quando</th>
                      <th className="com-rotulo pb-2 font-normal">Visita</th>
                      <th className="com-rotulo pb-2 text-right font-normal">Tempo</th>
                      <th className="com-rotulo pb-2 pl-6 font-normal">Leu até</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-muted">
                    {(todas ? d.visitas : d.visitas.slice(0, 5)).map((v) => (
                      <tr key={v.acesso}>
                        <td className="whitespace-nowrap py-2">{quando(v.quando)}</td>
                        <td className="whitespace-nowrap text-text">visita {v.acesso}</td>
                        <td className="com-num whitespace-nowrap text-right">{v.segundos ? tempo(v.segundos * 1000) : '–'}</td>
                        <td className="pl-6">{v.leuAte}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-muted">
              Cada visita é uma abertura da sala do cliente. A sala não identifica navegador nem aparelho; as visitas da equipe entram na conta.
            </p>
          </div>
        </>
      ) : null}
    </section>
  );
}

/** O detalhe da proposta antiga do serviço de propostas (sessão da plataforma), como era. */
function DetalheServico({ proposta, token, lead, fechar }: { proposta: PropostaNaLista; token: string | null; lead?: { id: string }; fechar: () => void }) {
  const [detalhe, setDetalhe] = useState<DetalheDaProposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [todas, setTodas] = useState(false);
  useEffect(() => {
    if (!token) return;
    let vivo = true;
    apiGet<DetalheDaProposta>(`${BASE_DO_SERVICO}/${proposta.cliente}/${proposta.chave}`, token)
      .then((d) => vivo && setDetalhe(d))
      .catch((e) => vivo && setErro((e as Error).message));
    return () => {
      vivo = false;
    };
  }, [token, proposta.cliente, proposta.chave]);
  const copiar = () => {
    void navigator.clipboard
      .writeText(proposta.link)
      .then(() => {
        setCopiado(true);
        setTimeout(() => setCopiado(false), 1600);
      })
      .catch(() => setCopiado(false));
  };
  const botao = 'rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:border-brand hover:text-text';

  return (
    <section className="rounded-md border border-border bg-surface px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="com-rotulo">Proposta do serviço de propostas</div>
          <h2 className="mt-1 text-[1.4rem] font-bold leading-tight">{proposta.titulo}</h2>
          <p className="text-sm text-muted">{proposta.link.replace(/^https?:\/\//, '')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {lead && (
            <Link href={`/comercial/lead/${lead.id}`} className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-ink hover:opacity-90">
              painel do lead
            </Link>
          )}
          <button onClick={copiar} className={botao}>{copiado ? 'link copiado' : 'copiar link'}</button>
          <a href={`${proposta.link}?equipe=1`} target="_blank" rel="noopener noreferrer" className={botao}>abrir proposta</a>
          <BotaoFechar fechar={fechar} />
        </div>
      </div>

      <Progresso nomes={ETAPAS} etapa={proposta.etapa} pago={{ feito: false, nota: 'confira no Asaas' }} />

      {erro && <p className="mt-5 text-sm text-bad">{erro}</p>}
      {!detalhe && !erro ? (
        <p className="mt-5 text-sm text-muted">carregando o detalhe…</p>
      ) : detalhe ? (
        <>
          <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Numero rotulo="Aberturas" valor={String(detalhe.aberturas)} tamanho="medio" />
            <Numero rotulo="Pessoas" valor={String(detalhe.pessoas)} tamanho="medio" />
            <Numero rotulo="Tempo de leitura" valor={detalhe.aberturas ? tempo(detalhe.tempoTotalMs) : '–'} tamanho="medio" />
            <Numero rotulo="Parte mais vista" valor={detalhe.maisVista ?? '–'} tamanho="texto" />
          </div>

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
      ) : null}
    </section>
  );
}
