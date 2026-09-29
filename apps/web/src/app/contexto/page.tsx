'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, RefreshCw, Search } from 'lucide-react';
import { ErroDaApi, apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CaminhoDeCarga } from './CaminhoDeCarga';
import { Gaveta, type AlvoDaGaveta } from './Gaveta';
import { Mapa } from './Mapa';
import { Diretorio } from './Diretorio';
import {
  eixosIncertos,
  estadoDaEmpresa,
  familiaPorChave,
  montarMapa,
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
  const [ocultos, setOcultos] = useState<Set<FamiliaKey>>(new Set());
  const [termo, setTermo] = useState('');
  const [bruto, setBruto] = useState<BrutoDaBusca | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erroDaBusca, setErroDaBusca] = useState<string | null>(null);
  const [relendo, setRelendo] = useState(false);
  const [recado, setRecado] = useState<string | null>(null);

  const carregar = useCallback(() => {
    if (!token) return;

    const puxar = <T,>(key: FamiliaKey, aplicar: (f: Fonte<T>) => void) => {
      const familia: DescricaoDeFamilia = familiaPorChave(key);
      if (!can(familia.permissao)) {
        aplicar({ dado: null, semPermissao: true });
        return;
      }
      apiGet<T>(familia.consulta, token)
        .then((dado) => aplicar({ dado }))
        .catch((e: unknown) => aplicar(porQueNaoVeio<T>(e)));
    };

    puxar<MemoriaList>('memoria', setMemoria);
    puxar<RosterDeAgentes>('agentes', setAgentes);
    puxar<ListaDeRotinas>('rotinas', setRotinas);
    puxar<CatalogoDeConexoes>('conexoes', setConexoes);
    puxar<Organograma>('gente', setOrganograma);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (ready && token) carregar();
  }, [ready, token, carregar]);

  const mapa = useMemo(
    () => montarMapa({ memoria, agentes, rotinas, conexoes, organograma }),
    [memoria, agentes, rotinas, conexoes, organograma],
  );

  /* A busca, disparada com folga para não pedir uma consulta por tecla. */
  useEffect(() => {
    const alvoDaBusca = termo.trim();
    if (!token || alvoDaBusca.length < 2) {
      setBruto(null);
      setBuscando(false);
      setErroDaBusca(null);
      return;
    }
    setBuscando(true);
    setErroDaBusca(null);
    let vivo = true;
    const id = setTimeout(() => {
      procurar(alvoDaBusca, token)
        .then((r) => {
          if (!vivo) return;
          setBruto(r);
          setBuscando(false);
        })
        .catch((e: Error) => {
          if (!vivo) return;
          setBruto(null);
          setErroDaBusca(e.message);
          setBuscando(false);
        });
    }, 300);
    return () => {
      vivo = false;
      clearTimeout(id);
    };
  }, [termo, token]);

  /* A junção é derivada: ela refaz quando o mapa muda, sem pedir nada de novo. */
  const juncao = useMemo(
    () => (bruto ? juntar(bruto, mapa.catalogo.memoria) : null),
    [bruto, mapa.catalogo.memoria],
  );

  const relerAVault = () => {
    if (!token) return;
    setRelendo(true);
    setRecado(null);
    apiPost<{ ok: boolean; notes: number }>('/knowledge/reindex', {}, token)
      .then((r) => {
        setRecado(`${r.notes} nota(s) lida(s) da vault.`);
        carregar();
      })
      .catch((e: Error) => setRecado(e.message))
      .finally(() => setRelendo(false));
  };

  const abrirItem = (item: ItemDoEixo) => setAlvo({ tipo: 'registro', item });
  const abrirEixo = (eixo: EixoDoMapa) =>
    setAlvo({ tipo: 'eixo', eixo, itens: mapa.catalogo[eixo.key] });

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

  if (!ready) return <p className="text-sm text-muted">Carregando…</p>;

  const estado = estadoDaEmpresa(mapa);
  const incertos = eixosIncertos(mapa);
  const memoriaVazia = memoria.dado !== null && memoria.dado.total === 0;

  return (
    <div className="space-y-4">
      <section className="rounded-root border border-border bg-surface p-4" aria-label="Do conhecimento ao trabalho">
        <h2 className="font-semibold">Do conhecimento ao trabalho</h2>
        <p className="mt-1 text-sm text-muted">Explore as fontes e quem responde por elas. Abra um processo para acompanhar o que ele recebe e o que precisa entregar.</p>
        <nav aria-label="Caminhos de trabalho" className="mt-3 flex flex-wrap gap-4 text-sm text-brand">
          {can('tarefas.ver') && <a className="underline" href="/trabalho">Projetos e tarefas</a>}
          {can('pauta.ver') && <><a className="underline" href="/referencias#radar">Fontes de conteúdo</a><a className="underline" href="/pauta">Produção de conteúdo</a></>}
          {can('automacoes.ver') && <a className="underline" href="/rotinas">Rotinas e resultados</a>}
        </nav>
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-[260px] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Procurar no contexto (ex.: política de desconto)"
            aria-label="Procurar no contexto"
            className="w-full rounded-root border border-border bg-surface py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-dim"
          />
        </div>
        {can('obsidian.editar') && (
          <button
            type="button"
            onClick={relerAVault}
            disabled={relendo}
            className="inline-flex items-center gap-2 rounded-root border border-border px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-text disabled:opacity-60"
          >
            <RefreshCw size={14} className={relendo ? 'animate-spin' : ''} /> reler a vault
          </button>
        )}
      </div>

      {recado && <p className="text-xs text-muted">{recado}</p>}

      {(juncao || buscando || erroDaBusca) && (
        <Resultados
          juncao={juncao}
          buscando={buscando}
          erro={erroDaBusca}
          modo={bruto?.modo ?? null}
          catalogo={mapa.catalogo.memoria}
          onAbrir={abrirItem}
        />
      )}

      {estado === 'carregando' ? (
        <p className="text-sm text-muted">Montando o mapa…</p>
      ) : estado === 'desconhecida' ? (
        <CaminhoDeCarga mapa={mapa} incertos={incertos} onCarregou={carregar} />
      ) : estado === 'vazia' ? (
        <CaminhoDeCarga mapa={mapa} onCarregou={carregar} />
      ) : (
        <>
          {memoriaVazia && <CaminhoDeCarga mapa={mapa} compacto onCarregou={carregar} />}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr),360px]">
            <Mapa
              mapa={mapa}
              selecionado={alvo?.tipo === 'registro' ? alvo.item.id : null}
              destaque={juncao?.ids ?? null}
              ocultos={ocultos}
              onSelecionar={abrirItem}
              onAbrirEixo={abrirEixo}
            />
            {alvoAtual ? (
              <Gaveta alvo={alvoAtual} onFechar={() => setAlvo(null)} onAbrirItem={abrirItem} />
            ) : (
              <Legenda mapa={mapa} ocultos={ocultos} onAlternar={alternarEixo} onAbrirEixo={abrirEixo} />
            )}
          </div>
          <Diretorio mapa={mapa} onAbrir={abrirItem} />
        </>
      )}
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
  onAbrir: (item: ItemDoEixo) => void;
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
                onClick={() => item && onAbrir(item)}
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
  ocultos,
  onAlternar,
  onAbrirEixo,
}: {
  mapa: MapaDados;
  ocultos: Set<FamiliaKey>;
  onAlternar: (key: FamiliaKey) => void;
  onAbrirEixo: (eixo: EixoDoMapa) => void;
}) {
  return (
    <aside aria-label="Legenda do mapa" className="space-y-2 rounded-root border border-border bg-surface p-4">
      <h2 className="text-[10px] uppercase tracking-[0.16em] text-dim">o que está no mapa</h2>
      <ul className="divide-y divide-border">
        {mapa.eixos.map((eixo) => {
          const oculto = ocultos.has(eixo.key);
          return (
            <li key={eixo.key} className="flex items-start gap-2 py-2">
              <button
                type="button"
                onClick={() => onAlternar(eixo.key)}
                aria-label={oculto ? `Mostrar ${eixo.rotulo} no mapa` : `Esconder ${eixo.rotulo} do mapa`}
                className="mt-0.5 text-dim hover:text-text"
              >
                {oculto ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
              <button
                type="button"
                onClick={() => onAbrirEixo(eixo)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm text-text">{eixo.rotulo}</span>
                  <span className="font-os-mono text-sm tabular-nums text-muted">
                    {rotuloDoTotal(eixo)}
                  </span>
                </span>
                <span className="block text-[11px] leading-snug text-muted">{eixo.descricao}</span>
                {eixo.erro && <span className="block text-[11px] text-bad">{eixo.erro}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="pt-1 text-[11px] leading-relaxed text-dim">
        A linha cheia é o desenho do mapa. A linha tracejada é vínculo declarado no dado: a rotina e o
        agente que ela roda, o agente e a pessoa que responde por ele, a nota e a que ela substitui.
      </p>
    </aside>
  );
}

function rotuloDoTotal(eixo: EixoDoMapa): string {
  if (eixo.estado === 'sem_permissao') return 'sem acesso';
  if (eixo.estado === 'erro') return 'falhou';
  if (eixo.estado === 'carregando') return '…';
  return String(eixo.total ?? 0);
}
