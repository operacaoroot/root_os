'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, RefreshCw, Search } from 'lucide-react';
import { ErroDaApi, apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ProntidaoLocal } from '@/components/ProntidaoLocal';
import { CaminhoDeCarga } from './CaminhoDeCarga';
import { Gaveta, type AlvoDaGaveta } from './Gaveta';
import { NotaAberta } from './NotaAberta';
import { MapaDaEmpresa } from './MapaDaEmpresa';
import { Diretorio } from './Diretorio';
import {
  eixosIncertos,
  estadoDaEmpresa,
  familiaPorChave,
  montarMapa,
  recortarMapa,
  AREAS,
  type FiltroDeArea,
  type DescricaoDeFamilia,
  type EixoDoMapa,
  type FamiliaKey,
  type Fonte,
  type ItemDoEixo,
  type Mapa as MapaDados,
} from './grafo';
import type {
  AchadoDeMemoria,
  CatalogoDeConexoes,
  ListaDeRotinas,
  MemoriaList,
  Organograma,
  ResultadoDeBusca,
  RosterDeAgentes,
} from './tipos';

/*
 * ============================================================================
 * CONTEXTO — o mapa como tela principal (fatia 4.4 · RF-M-04, RF-B-01)
 * ============================================================================
 *
 * Esta tela era o navegador da base de conhecimento: uma lista de notas e uma
 * caixa de busca. Agora ela é o MAPA — o contexto do negócio desenhado, onde
 * cada ponto é um registro que existe e abre o registro de verdade.
 *
 * ----------------------------------------------------------------------------
 * CINCO FONTES, CINCO PERMISSÕES, NENHUMA DELAS OBRIGATÓRIA
 * ----------------------------------------------------------------------------
 * O mapa lê memória, agentes, rotinas, conexões e gente. Cada uma dessas rotas
 * exige a sua permissão, e quem entra aqui tem `obsidian.ver` (é o que o menu
 * cobra) mas não necessariamente as outras quatro. A rota e a permissão de cada
 * eixo estão declaradas em `FAMILIAS` (`grafo.ts`) e é de lá que este arquivo
 * lê as duas — o eixo é buscado SÓ quando a pessoa pode vê-lo, e o que ela não
 * pode ver aparece como "sem permissão" em vez de zero.
 *
 * A DIFERENÇA ENTRE "ZERO" E "NÃO SEI" É O ASSUNTO DESTA TELA. Um eixo que
 * falhou, um que ainda não respondeu e um que o usuário não pode ver são três
 * coisas distintas, e nenhuma delas é "esta empresa não tem nada" —
 * `estadoDaEmpresa` (em `grafo.ts`) separa as quatro respostas possíveis, e a
 * tela diz "não deu para ver" quando é isso que está acontecendo.
 *
 * RECUSA POR PERMISSÃO NÃO É FALHA. O 403 do servidor vira `semPermissao`, e
 * não a caixa vermelha de erro: as duas palavras dizem coisas diferentes para
 * quem está olhando, e culpar o sistema por uma decisão de papel é a única das
 * três frases desta tela que seria mentira.
 *
 * ----------------------------------------------------------------------------
 * ABRIR O MAPA NÃO SONDA FORNECEDOR NENHUM
 * ----------------------------------------------------------------------------
 * O eixo de conexões é pedido com `?sondar=0`. Sem isso, cada abertura da tela
 * dispara uma varredura externa em todos os conectores do contrato — cinco
 * fornecedores, com orçamento de seis segundos cada, usando credencial de
 * verdade. É caro em qualquer tela; nesta, que é a que a ROOT abre na frente do
 * cliente, a primeira abertura pagava a rajada inteira. Medir saúde é trabalho
 * da tela de Conexões, que tem botão para isso; aqui a conexão aparece com o
 * estado do banco e o selo cinza de "não medido nesta volta", que é a verdade.
 *
 * ----------------------------------------------------------------------------
 * OS NÚMEROS SÃO OS DA API
 * ----------------------------------------------------------------------------
 * O total de cada eixo vem da resposta da rota daquele eixo (`total` na memória,
 * `totais.pessoas` no organograma), e não de um `length` calculado aqui depois
 * de filtrar. Uma segunda contagem no navegador é como duas telas do mesmo
 * produto passam a dizer números diferentes sobre a mesma empresa — e, num
 * sistema em que cada empresa só enxerga o que é dela, número que diverge é
 * pergunta de confiança, não detalhe de interface.
 *
 * ----------------------------------------------------------------------------
 * A BUSCA USA AS DUAS QUE EXISTEM — E SÓ COBRA UMA VEZ POR TERMO
 * ----------------------------------------------------------------------------
 * `GET /memoria/buscar` é TEXTUAL por contrato: quem tem a chave do fornecedor
 * de embedding é o conector, e aquela rota não vai atrás dele. `GET
 * /knowledge/search` é semântica, sobre o índice da vault, e cai sozinha para
 * palavra-chave quando o índice não responde.
 *
 * A CONSULTA DEPENDE DO TERMO, E DE MAIS NADA. A junção com o mapa é feita
 * depois, em memória. Enquanto o efeito dependia do catálogo — um array novo a
 * cada montagem do mapa — a busca redisparava a cada eixo que respondia, a cada
 * recarga e a cada gravação de nota; uma das duas chamadas gasta vetorização,
 * então isso era dinheiro saindo a cada re-render, e o intervalo de espera só
 * absorvia o que chegasse junto.
 */

const PREFIXO_DA_VAULT = 'vault:';

/** O que o índice da vault devolve por resultado. */
interface AchadoDoIndice {
  id: string;
  title: string;
  path: string;
  snippet: string;
}

/** O resultado CRU das duas buscas. `null` em um dos lados = aquela rota falhou. */
interface BrutoDaBusca {
  termo: string;
  memoria: AchadoDeMemoria[] | null;
  indice: AchadoDoIndice[] | null;
  modo: string | null;
}

interface ItemDeResultado {
  id: string;
  titulo: string;
  sub: string;
}

/** O cruzamento do resultado cru com o que está no mapa. */
interface Juncao {
  /** Os ids de nó que casaram — é o que o mapa destaca. */
  ids: Set<string>;
  itens: ItemDeResultado[];
  /** Resultados do índice sem nota correspondente na listagem desta tela. */
  semPar: number;
  /**
   * O índice respondeu, a memória tem nota vinda da vault e NADA casou.
   *
   * Não é fila de trabalho: é a chave tendo divergido entre os dois lados.
   * Mandar reler a vault aqui não conserta nada — e era o que a tela fazia.
   */
  chavesDivergiram: boolean;
}

export default function ContextoPage() {
  const { token, ready, can } = useAuth();

  const [memoria, setMemoria] = useState<Fonte<MemoriaList>>({ dado: null });
  const [agentes, setAgentes] = useState<Fonte<RosterDeAgentes>>({ dado: null });
  const [rotinas, setRotinas] = useState<Fonte<ListaDeRotinas>>({ dado: null });
  const [conexoes, setConexoes] = useState<Fonte<CatalogoDeConexoes>>({ dado: null });
  const [organograma, setOrganograma] = useState<Fonte<Organograma>>({ dado: null });

  const [alvo, setAlvo] = useState<AlvoDaGaveta | null>(null);
  const [fonteDoEndereco, setFonteDoEndereco] = useState<{ notaId: string; versionId: string | null } | null>(null);
  useEffect(() => {
    const ler = () => {
      const p = new URLSearchParams(window.location.search);
      const notaId = p.get('nota');
      setFonteDoEndereco(notaId ? { notaId, versionId: p.get('versao') } : null);
    };
    ler(); window.addEventListener('popstate', ler);
    return () => window.removeEventListener('popstate', ler);
  }, []);
  const limparFonteDoEndereco = () => {
    setFonteDoEndereco(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('nota'); url.searchParams.delete('versao');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  };
  const [sessao, setSessao] = useState<string | null>(null);
  const identidadeAtual = useRef({ token, ready, numero: 0 });
  if (identidadeAtual.current.token !== token || identidadeAtual.current.ready !== ready) {
    identidadeAtual.current = { token, ready, numero: identidadeAtual.current.numero + 1 };
  }
  const numeroDaSessao = identidadeAtual.current.numero;
  const geracao = useRef(0);
  const acessoDaBusca = useRef(0);
  const origemDaGaveta = useRef<Element | null>(null);
  const rolagemDoDiretorio = useRef<HTMLDivElement | null>(null);
  const posicaoDoDiretorio = useRef(0);
  const [ocultos, setOcultos] = useState<Set<FamiliaKey>>(new Set());
  const [termo, setTermo] = useState('');
  const [area, setArea] = useState<FiltroDeArea>('');
  const [familiaFiltrada, setFamiliaFiltrada] = useState<FamiliaKey | ''>('');
  const [bruto, setBruto] = useState<BrutoDaBusca | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erroDaBusca, setErroDaBusca] = useState<string | null>(null);
  const [relendo, setRelendo] = useState(false);
  const [recado, setRecado] = useState<string | null>(null);

  const carregar = useCallback(() => {
    if (!token || !ready || identidadeAtual.current.numero !== numeroDaSessao) return;
    const ciclo = ++geracao.current;

    const puxar = <T,>(key: FamiliaKey, aplicar: (f: Fonte<T>) => void) => {
      const familia: DescricaoDeFamilia = familiaPorChave(key);
      if (!can(familia.permissao)) {
        aplicar({ dado: null, semPermissao: true });
        return;
      }
      apiGet<T>(familia.consulta, token)
        .then((dado) => { if (ciclo === geracao.current) aplicar({ dado }); })
        .catch((e: unknown) => { if (ciclo === geracao.current) aplicar(porQueNaoVeio<T>(e)); });
    };

    puxar<MemoriaList>('memoria', setMemoria);
    puxar<RosterDeAgentes>('agentes', setAgentes);
    puxar<ListaDeRotinas>('rotinas', setRotinas);
    puxar<CatalogoDeConexoes>('conexoes', setConexoes);
    puxar<Organograma>('gente', setOrganograma);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, ready, numeroDaSessao]);

  useEffect(() => {
    ++geracao.current;
    setMemoria({ dado: null });
    setAgentes({ dado: null });
    setRotinas({ dado: null });
    setConexoes({ dado: null });
    setOrganograma({ dado: null });
    setAlvo(null);
    setArea('');
    setFamiliaFiltrada('');
    setTermo('');
    setBruto(null);
    setRelendo(false);
    setRecado(null);
    setOcultos(new Set());
    origemDaGaveta.current = null;
    posicaoDoDiretorio.current = 0;
    setSessao(ready ? token : null);
    if (ready && token) carregar();
    return () => { ++geracao.current; };
  }, [ready, token, carregar]);

  const mapaBase = useMemo(
    () => montarMapa({ memoria, agentes, rotinas, conexoes, organograma }),
    [memoria, agentes, rotinas, conexoes, organograma],
  );

  /* A busca, disparada com folga para não pedir uma consulta por tecla. */
  useEffect(() => {
    const alvoDaBusca = termo.trim();
    if (!token || sessao !== token || alvoDaBusca.length < 2) {
      setBruto(null);
      setBuscando(false);
      setErroDaBusca(null);
      return;
    }
    setBuscando(true);
    setErroDaBusca(null);
    let vivo = true;
    const acessoDoPedido = acessoDaBusca.current;
    const id = setTimeout(() => {
      procurar(alvoDaBusca, token)
        .then((r) => {
          if (!vivo || acessoDoPedido !== acessoDaBusca.current) return;
          setBruto(r);
          setBuscando(false);
        })
        .catch((e: Error) => {
          if (!vivo || acessoDoPedido !== acessoDaBusca.current) return;
          setBruto(null);
          setErroDaBusca(e.message);
          setBuscando(false);
        });
    }, 300);
    return () => {
      vivo = false;
      clearTimeout(id);
    };
  }, [termo, token, sessao]);

  /* A junção é derivada: ela refaz quando o mapa muda, sem pedir nada de novo. */
  const resultadoAtual = bruto?.termo === termo.trim() ? bruto : null;
  const juncao = useMemo(
    () => (resultadoAtual ? juntar(resultadoAtual, mapaBase.catalogo.memoria) : null),
    [resultadoAtual, mapaBase.catalogo.memoria],
  );

  const recorteAtivo = !!(area || familiaFiltrada || termo.trim());
  const mapa = useMemo(() => recortarMapa(mapaBase, {
    area, familia: familiaFiltrada, busca: termo,
    idsDaBusca: juncao?.ids,
  }), [mapaBase, area, familiaFiltrada, termo, juncao]);

  const relerAVault = () => {
    if (!token) return;
    const sessaoDoPedido = numeroDaSessao;
    const vigente = () => identidadeAtual.current.numero === sessaoDoPedido;
    setRelendo(true);
    setRecado(null);
    apiPost<{ ok: boolean; notes: number }>('/knowledge/reindex', {}, token)
      .then((r) => {
        if (!vigente()) return;
        setRecado(`${r.notes} nota(s) lida(s) da vault.`);
        carregar();
      })
      .catch((e: Error) => { if (vigente()) setRecado(e.message); })
      .finally(() => { if (vigente()) setRelendo(false); });
  };

  const fonteIndisponivel = () => {
    ++acessoDaBusca.current;
    setAlvo(null); setMemoria({ dado: null }); setBruto(null); setTermo('');
    setRecado('Fonte não disponível para esta conta.');
    carregar();
  };

  const lembrarOrigem = (origem?: Element) => {
    if (origem && !origem.closest('[aria-label="Registro selecionado"]')) origemDaGaveta.current = origem;
  };
  const abrirItem = (item: ItemDoEixo, origem?: Element) => {
    limparFonteDoEndereco();
    lembrarOrigem(origem);
    setAlvo({ tipo: 'registro', item });
  };
  const abrirEixo = (eixo: EixoDoMapa, origem?: Element) => {
    limparFonteDoEndereco();
    lembrarOrigem(origem);
    setAlvo({ tipo: 'eixo', eixo, itens: mapa.catalogo[eixo.key] });
  };
  const fecharGaveta = () => {
    limparFonteDoEndereco();
    setAlvo(null);
    requestAnimationFrame(() => {
      const origem = origemDaGaveta.current;
      if (rolagemDoDiretorio.current) rolagemDoDiretorio.current.scrollTop = posicaoDoDiretorio.current;
      if (origem?.isConnected && 'focus' in origem) (origem as HTMLElement).focus();
      else document.getElementById('busca-do-contexto')?.focus();
      origemDaGaveta.current = null;
    });
  };

  useEffect(() => {
    if (alvo?.tipo === 'registro' && !Object.values(mapa.catalogo).some((itens) => itens.some((item) => item.id === alvo.item.id))) {
      setAlvo(null);
    }
  }, [mapa, alvo]);

  /*
   * A LISTA DE UM EIXO É REMONTADA A CADA DESENHO, e não a guardada no clique.
   * Sem isto, gravar a primeira nota com a gaveta aberta deixaria ali a lista de
   * antes da gravação — a tela mostrando um estado que o banco já não tem.
   */
  const alvoAtual: AlvoDaGaveta | null =
    alvo?.tipo === 'eixo'
      ? {
          tipo: 'eixo',
          eixo: mapa.eixos.find((e) => e.key === alvo.eixo.key) ?? alvo.eixo,
          itens: mapa.catalogo[alvo.eixo.key],
        }
      : alvo;

  const alternarEixo = (key: FamiliaKey) =>
    setOcultos((atual) => {
      const novo = new Set(atual);
      if (novo.has(key)) novo.delete(key);
      else novo.add(key);
      return novo;
    });

  if (!ready || sessao !== token) return <p className="text-sm text-muted">Carregando…</p>;

  const estado = estadoDaEmpresa(mapaBase);
  const incertos = eixosIncertos(mapaBase);
  const memoriaVazia = memoria.dado !== null && memoria.dado.total === 0;

  return (
    <div className="space-y-4">
      {fonteDoEndereco && <aside aria-label="Fonte usada na tarefa" className="space-y-3 rounded-root border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Fonte usada na tarefa</h2><button type="button" className="text-sm text-brand underline" onClick={limparFonteDoEndereco}>Fechar fonte usada</button></div>
        <NotaAberta notaId={fonteDoEndereco.notaId} versaoInicial={fonteDoEndereco.versionId} onIndisponivel={fonteIndisponivel} />
      </aside>}

      <section className="overflow-hidden rounded-sm border border-border bg-surface" aria-label="Console de contexto">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4">
          <div className="flex flex-wrap items-center gap-4">
            <span className="font-os-mono text-lg font-semibold tracking-tight"><span className="text-brand">ROOT</span><span className="px-1 text-dim">/</span><span className="text-text">OS</span></span>
            <span className="hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
            <div>
              <h2 className="font-os-mono text-xs font-semibold uppercase tracking-[0.16em] text-text">Mapa de contexto</h2>
              <p className="mt-1 text-[11px] text-muted" role="status">
                {mapa.registros} {mapa.registros === 1 ? 'registro carregado' : 'registros carregados'}{recorteAtivo ? ' neste recorte' : ''}
                {estado === 'carregando' ? ' · carregando fontes' : incertos.length ? ' · algumas fontes indisponíveis' : ''}
              </p>
            </div>
          </div>
          {can('obsidian.editar') && <button type="button" onClick={relerAVault} disabled={relendo}
            className="inline-flex min-h-11 items-center gap-2 rounded-root border border-border px-3 text-xs text-muted hover:bg-surface-2 hover:text-text disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
            <RefreshCw size={14} className={relendo ? 'animate-spin' : ''} /> Reler a vault
          </button>}
        </header>
        {recado && <p className="border-b border-border px-4 py-2 text-xs text-muted" role="status">{recado}</p>}

        <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_340px]">
          <MapaDaEmpresa mapa={mapa} recorteAtivo={recorteAtivo}
            selecionado={alvo?.tipo === 'registro' ? alvo.item.id : null}
            destaque={termo.trim() ? null : juncao?.ids ?? null} ocultos={ocultos}
            onSelecionar={abrirItem} onAbrirEixo={abrirEixo} areaSelecionada={area}
            onSelecionarArea={(novaArea) => { setArea(novaArea); setAlvo(null); }} />

          <aside aria-label="Explorar o mapa" className="flex min-w-0 flex-col border-t border-border lg:max-h-[calc(clamp(570px,70vh,850px)_+_128px)] lg:border-l lg:border-t-0">
            <div className="space-y-3 px-4 py-4">
              <h2 className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted">Explorar</h2>
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input id="busca-do-contexto" value={termo} onChange={(evento) => { setTermo(evento.target.value); setAlvo(null); }}
                  placeholder="Buscar no mapa e no diretório" aria-label="Buscar no mapa e no diretório"
                  className="min-h-11 w-full rounded-root border border-border bg-bg py-2 pl-9 pr-3 text-sm text-text outline-none focus:border-brand-dim" />
              </div>
              <div className="grid grid-cols-2 gap-2" aria-label="Filtros do mapa e do diretório">
                <label className="min-w-0 text-[11px] text-muted">Área
                  <select value={area} onChange={(evento) => { setArea(evento.target.value as FiltroDeArea); setAlvo(null); }}
                    className="mt-1 block min-h-11 w-full rounded-root border border-border bg-bg px-2 text-xs text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
                    <option value="">Todas as áreas</option>
                    {AREAS.map((opcao) => <option key={opcao.key} value={opcao.key}>{opcao.rotulo}</option>)}
                    <option value="sem-area">Sem área definida</option>
                  </select>
                </label>
                <label className="min-w-0 text-[11px] text-muted">Tipo de registro
                  <select value={familiaFiltrada} onChange={(evento) => { setFamiliaFiltrada(evento.target.value as FamiliaKey | ''); setAlvo(null); }}
                    className="mt-1 block min-h-11 w-full rounded-root border border-border bg-bg px-2 text-xs text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
                    <option value="">Todos os tipos</option>
                    {mapaBase.eixos.map((eixo) => <option key={eixo.key} value={eixo.key}>{eixo.rotulo}</option>)}
                  </select>
                </label>
              </div>
              {recorteAtivo && <button type="button" onClick={() => { setArea(''); setFamiliaFiltrada(''); setTermo(''); setAlvo(null); }}
                className="min-h-11 text-xs text-brand underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">Limpar filtros</button>}
            </div>

            {(juncao || buscando || erroDaBusca) && <div className="max-h-48 overflow-y-auto px-4 pb-3">
              <Resultados juncao={juncao} buscando={buscando} erro={erroDaBusca} modo={bruto?.modo ?? null}
                catalogo={mapa.catalogo.memoria} onAbrir={abrirItem} />
            </div>}

            {alvoAtual && <div className="min-h-0 flex-1 border-t border-border [&>aside]:h-[560px] [&>aside]:max-h-none [&>aside]:rounded-none [&>aside]:border-0 lg:[&>aside]:h-full">
              <Gaveta alvo={alvoAtual} onFechar={fecharGaveta} onAbrirItem={abrirItem} onFonteIndisponivel={fonteIndisponivel} />
            </div>}
            <div hidden={!!alvoAtual} style={alvoAtual ? { display: 'none' } : undefined} className="flex min-h-0 flex-1 flex-col">
              <Legenda mapa={mapa} recorteAtivo={recorteAtivo} ocultos={ocultos} onAlternar={alternarEixo} onAbrirEixo={abrirEixo} />
              <div ref={rolagemDoDiretorio} onScroll={(evento) => { if (!alvoAtual) posicaoDoDiretorio.current = evento.currentTarget.scrollTop; }}
                className="min-h-[144px] max-h-[420px] flex-1 overflow-y-auto overscroll-contain lg:max-h-none">
                <Diretorio mapa={mapa} recorteAtivo={recorteAtivo} onAbrir={abrirItem} compacto />
              </div>
            </div>
          </aside>
        </div>
      </section>

      <ProntidaoLocal tipo="contexto" />

      {estado !== 'carregando' && (memoriaVazia || estado === 'vazia' || estado === 'desconhecida') && <details className="rounded-sm border border-border bg-surface">
        <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
          Carregar e organizar o contexto{memoriaVazia ? ' · memória ainda vazia' : ''}
        </summary>
        <div className="border-t border-border p-3">
          <CaminhoDeCarga mapa={mapaBase} compacto={estado === 'com_contexto' && memoriaVazia} incertos={estado === 'desconhecida' ? incertos : []} onCarregou={carregar} />
        </div>
      </details>}
      <nav aria-label="Caminhos de trabalho" className="flex flex-wrap gap-4 px-1 text-xs text-muted">
        {can('tarefas.ver') && <a className="min-h-11 content-center underline underline-offset-4 hover:text-text" href="/trabalho">Projetos e tarefas</a>}
        {can('pauta.ver') && <><a className="min-h-11 content-center underline underline-offset-4 hover:text-text" href="/referencias#radar">Fontes de conteúdo</a><a className="min-h-11 content-center underline underline-offset-4 hover:text-text" href="/pauta">Produção de conteúdo</a></>}
        {can('automacoes.ver') && <a className="min-h-11 content-center underline underline-offset-4 hover:text-text" href="/rotinas">Rotinas e resultados</a>}
      </nav>
    </div>
  );
}

/**
 * Por que o eixo não veio — e a diferença entre recusa e falha.
 *
 * 403 é decisão de papel: quem está olhando não tem a permissão daquela rota. A
 * tela diz "sem acesso". Qualquer outra coisa é o sistema não tendo respondido,
 * e aí a frase é "falhou", com a mensagem que veio. Enquanto o `catch` jogava
 * tudo num campo só, uma recusa de permissão aparecia em vermelho culpando o
 * sistema por uma decisão que ele tomou de propósito.
 */
function porQueNaoVeio<T>(e: unknown): Fonte<T> {
  if (e instanceof ErroDaApi && e.status === 403) return { dado: null, semPermissao: true };
  return { dado: null, erro: e instanceof Error ? e.message : 'a fonte não respondeu' };
}

/**
 * Dispara as duas buscas e devolve o que cada uma respondeu, SEM cruzar nada.
 *
 * A falha de UMA não derruba a outra: o índice fora do ar degrada a busca para o
 * que a memória sabe responder sozinha, que é o que RNF-04 pede. Se as duas
 * falharem, quem chamou recebe o erro.
 */
async function procurar(termo: string, token: string): Promise<BrutoDaBusca> {
  const naMemoria = apiGet<ResultadoDeBusca>(
    `/memoria/buscar?q=${encodeURIComponent(termo)}&limite=20`,
    token,
  ).catch(() => null);
  const noIndice = apiGet<{ items: AchadoDoIndice[]; mode: string }>(
    `/knowledge/search?q=${encodeURIComponent(termo)}&limit=20`,
    token,
  ).catch(() => null);

  const [memoria, indice] = await Promise.all([naMemoria, noIndice]);
  if (!memoria && !indice) throw new Error('A busca não respondeu. Tente de novo.');

  const modo = [
    memoria ? `palavra (${memoria.modo})` : null,
    indice ? `significado (${indice.mode})` : null,
  ]
    .filter(Boolean)
    .join(' + ');

  return {
    termo,
    memoria: memoria?.itens ?? null,
    indice: indice?.items ?? null,
    modo: modo || null,
  };
}

/**
 * Cruza o resultado das duas buscas com o que está desenhado no mapa.
 *
 * O elo entre o índice da vault e a memória é a chave estável `vault:<caminho>`
 * (`chaveDaVault`, em `apps/api/src/memory/procedencia.ts`). Quando um resultado
 * do índice não acha par, existem TRÊS motivos possíveis e a tela não sabe qual
 * é: a nota ainda não foi projetada na memória, a nota foi arquivada de
 * propósito (`GET /memoria` não traz arquivada sem `?arquivadas=1`), ou a chave
 * divergiu entre os dois lados.
 *
 * A VERSÃO ANTERIOR ESCOLHIA O PRIMEIRO E AFIRMAVA. Chamava todos de "ainda não
 * versionadas" e mandava reler a vault — instrução que não conserta os outros
 * dois casos, e que contava como pendência cada nota que alguém arquivou de
 * propósito. Aqui o que se afirma é o que se sabe: quantos não casaram. E o caso
 * em que NADA casou, tendo a memória nota vinda da vault, é separado, porque
 * esse não é fila de trabalho — é defeito de chave, e releitura não resolve.
 */
function juntar(bruto: BrutoDaBusca, notas: ItemDoEixo[]): Juncao {
  const porChave = new Map<string, ItemDoEixo>();
  let temNotaDaVault = false;
  for (const n of notas) {
    if (n.registro.familia !== 'memoria') continue;
    porChave.set(n.registro.nota.chave, n);
    if (n.registro.nota.sourceType === 'vault') temNotaDaVault = true;
  }

  const ids = new Set<string>();
  const itens: ItemDeResultado[] = [];
  let semPar = 0;
  let casaram = 0;

  for (const achado of bruto.memoria ?? []) {
    const id = `nota:${achado.id}`;
    if (ids.has(id)) continue;
    ids.add(id);
    itens.push({ id, titulo: achado.title, sub: achado.procedencia });
  }

  for (const achado of bruto.indice ?? []) {
    const no = porChave.get(`${PREFIXO_DA_VAULT}${achado.path}`);
    if (!no) {
      semPar += 1;
      continue;
    }
    casaram += 1;
    if (ids.has(no.id)) continue;
    ids.add(no.id);
    itens.push({ id: no.id, titulo: no.rotulo, sub: no.sub });
  }

  const doIndice = bruto.indice?.length ?? 0;
  return { ids, itens, semPar, chavesDivergiram: doIndice > 0 && casaram === 0 && temNotaDaVault };
}

function Resultados({
  juncao,
  buscando,
  erro,
  modo,
  catalogo,
  onAbrir,
}: {
  juncao: Juncao | null;
  buscando: boolean;
  erro: string | null;
  modo: string | null;
  catalogo: ItemDoEixo[];
  onAbrir: (item: ItemDoEixo, origem?: Element) => void;
}) {
  const porId = new Map(catalogo.map((i) => [i.id, i]));
  return (
    <div className="rounded-root border border-border bg-surface px-4 py-3">
      <div className="text-xs text-muted">
        {buscando
          ? 'procurando…'
          : erro
            ? erro
            : `${juncao?.itens.length ?? 0} nota(s) encontrada(s)${modo ? ` · por ${modo}` : ''}`}
      </div>

      {juncao?.chavesDivergiram && (
        <div className="mt-1 text-xs text-bad">
          O índice da vault respondeu, mas nenhum resultado casou com a chave de uma nota da memória.
          Isso é divergência entre as duas chaves, e não falta de releitura — reler a vault não
          resolve.
        </div>
      )}

      {!juncao?.chavesDivergiram && (juncao?.semPar ?? 0) > 0 && (
        <div className="mt-1 text-xs text-warn">
          {juncao?.semPar} resultado(s) do índice da vault sem nota correspondente nesta listagem:
          nota ainda não versionada, ou arquivada de propósito (a listagem não traz arquivadas).
          Reler a vault resolve o primeiro caso.
        </div>
      )}

      {(juncao?.itens.length ?? 0) > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {juncao?.itens.map((r) => {
            const item = porId.get(r.id);
            return (
              <button
                key={r.id}
                type="button"
                disabled={!item}
                onClick={(evento) => item && onAbrir(item, evento.currentTarget)}
                title={r.sub}
                className="rounded-root border border-border px-2 py-1 text-xs text-muted hover:border-brand/40 hover:text-text disabled:opacity-50"
              >
                {r.titulo}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * A legenda — e o que ela faz além de legendar.
 *
 * Cada linha diz o total daquele eixo (o número da API), deixa escondê-lo do
 * desenho e abre a lista completa dele. Eixo sem permissão e eixo que falhou
 * aparecem com o motivo, porque "0" seria mentira nos dois casos.
 */
function Legenda({
  mapa,
  recorteAtivo,
  ocultos,
  onAlternar,
  onAbrirEixo,
}: {
  mapa: MapaDados;
  recorteAtivo: boolean;
  ocultos: Set<FamiliaKey>;
  onAlternar: (key: FamiliaKey) => void;
  onAbrirEixo: (eixo: EixoDoMapa, origem?: Element) => void;
}) {
  return (
    <aside aria-label="Legenda do mapa" className="max-h-80 shrink-0 space-y-2 overflow-y-auto border-t border-border px-4 py-3">
      <h2 className="text-[10px] uppercase tracking-[0.16em] text-dim">tipos de registro</h2>
      <ul className="divide-y divide-border">
        {mapa.eixos.map((eixo) => {
          const oculto = ocultos.has(eixo.key);
          return (
            <li key={eixo.key} className="flex items-center gap-2 py-0.5">
              <button
                type="button"
                onClick={() => onAlternar(eixo.key)}
                aria-label={oculto ? `Mostrar ${eixo.rotulo} no mapa` : `Esconder ${eixo.rotulo} do mapa`}
                className="mt-0.5 min-h-11 min-w-11 cursor-pointer text-dim hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              >
                {oculto ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
              <button
                type="button"
                onClick={(evento) => onAbrirEixo(eixo, evento.currentTarget)}
                className="min-h-11 min-w-0 flex-1 cursor-pointer text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm text-text">{eixo.rotulo}</span>
                  <span className="font-os-mono text-sm tabular-nums text-muted">
                    {rotuloDoTotal(eixo, recorteAtivo)}
                  </span>
                </span>
                <span className="sr-only">{eixo.descricao}</span>
                {eixo.erro && <span className="block text-[11px] text-bad">{eixo.erro}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="space-y-1 border-t border-border pt-3 text-[11px] text-muted">
        <p className="flex items-center gap-2"><span className="w-6 border-t border-border-strong" aria-hidden="true" /> Organização do mapa</p>
        <p className="flex items-center gap-2"><span className="w-6 border-t border-dashed border-brand" aria-hidden="true" /> Vínculo declarado</p>
      </div>
    </aside>
  );
}

function rotuloDoTotal(eixo: EixoDoMapa, recorteAtivo: boolean): string {
  if (eixo.estado === 'sem_permissao') return 'sem acesso';
  if (eixo.estado === 'erro') return 'falhou';
  if (eixo.estado === 'carregando') return '…';
  return recorteAtivo ? `${eixo.totalNoRecorte} de ${eixo.total ?? 0}` : String(eixo.total ?? 0);
}
