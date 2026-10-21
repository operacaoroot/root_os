'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ATA_MAX_CARACTERES, ATA_MIN_CARACTERES, DICA_DO_NOME_DA_TAREFA } from '@mktos/shared';
import type {
  TrabAtaDetalhe, TrabAtaDriveEstado, TrabAtaGeracao, TrabAtaLista, TrabAtaResumo, TrabAtaSugestaoDto, TrabEstrutura,
  TrabGranolaAtaGerada,
} from '@mktos/shared';
import { apiGet, apiPost, apiPut } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { RoteiroMarkdown } from '@/app/pauta/roteiro-markdown';
import { SeletorDeCliente, type ClienteEscolhido } from './SeletorDeCliente';

/*
 * O BANCO DE ATAS DO TRABALHO (rodada do painel P3, 18/10/2026).
 *
 * À esquerda, as atas da operação: as do vault (a pasta das reuniões) e as
 * coladas aqui, a mais nova primeiro, com data, participantes e resumo. À
 * direita, a ata aberta inteira (markdown renderizado sem innerHTML) e as
 * sugestões de tarefa que ela rendeu.
 *
 * "Sugerir tarefas" pede a leitura ao agente; o que volta são RASCUNHOS. Cada
 * um mostra o trecho da ata de onde saiu, e só vira tarefa com o clique em
 * Aceitar (na lista escolhida, pelo mesmo caminho do botão "Nova tarefa"). Nada
 * vira tarefa sozinho. Descartar fica registrado.
 *
 * Revisão de 18/10/2026 (laudo `homolog/revisao/painel-20261018.md`):
 *   · PA-2: as atas do vault só aparecem para quem lê o vault (`obsidian.ver`),
 *     e a tela diz por quê; colar grava na memória e pede `obsidian.editar`;
 *   · PA-4: dono e vencimento são campos da sugestão. O que o leitor propôs é
 *     o ponto de partida, e o aceite leva o que a pessoa confirmou ou corrigiu;
 *   · PA-6: a ata colada vai até 200 mil caracteres, e a tela avisa antes.
 * No celular os botões e campos têm 44 px (o alvo do polegar).
 *
 * ATAS MAIS VIVAS E O GRANOLA DIRETO (rodada da interface, 20/10/2026, U5):
 * "Gerar ata" puxa a TRANSCRIÇÃO do Granola e escreve a ata e as sugestões
 * num pedido só; a transcrição não fica guardada. A ata aberta mostra as
 * decisões e as pendências como lista, com a pendência que virou tarefa
 * marcada.
 *
 * AS FONTES, A BUSCA E AS DUAS COLUNAS (produção 21, P7, 21/10/2026):
 *   · uma lista só com o vault, as coladas, o Granola (cada reunião é uma
 *     TRANSCRIÇÃO) e a pasta do Google Drive escolhida aqui ("Pasta do Drive");
 *     cada item diz se é ata ou transcrição, e a fonte;
 *   · a busca (palavra-chave, de, até, tipo e fonte) mora no endereço
 *     (`?q=&de=&ate=&tipo=&fonte=`), a mais nova primeiro;
 *   · no desktop a tela ocupa a janela e NÃO rola: a lista da esquerda tem a
 *     altura da janela e rolagem própria, e a direita mostra a ata ou a
 *     transcrição clicada, ampla, com rolagem própria e as ações (gerar ata da
 *     transcrição, sugerir tarefas, abrir na fonte). No celular, lista e
 *     detalhe são telas separadas, com "Voltar".
 */

const ALVO = 'max-md:min-h-[44px]';
const INP = `w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none focus:border-brand-dim disabled:opacity-60 ${ALVO}`;
const BTN = `rounded-lg border border-border bg-surface px-3 py-1.5 text-sm hover:border-brand-dim disabled:opacity-50 ${ALVO}`;
const BTN_PRIMARIO = `rounded-lg bg-brand/15 px-3 py-1.5 text-sm text-text outline outline-1 outline-brand-dim hover:bg-brand/25 disabled:opacity-50 ${ALVO}`;

/** A largura a partir da qual lista e detalhe ficam lado a lado (o `lg` do Tailwind). */
export const LARGURA_DAS_DUAS_COLUNAS = 1024;

const dataBR = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : null);

const CHAVES_DOS_FILTROS = ['q', 'de', 'ate', 'tipo', 'fonte'] as const;
type Filtros = Partial<Record<(typeof CHAVES_DOS_FILTROS)[number], string>>;

function filtrosDoEndereco(): Filtros {
  if (typeof window === 'undefined') return {};
  const p = new URLSearchParams(window.location.search);
  const f: Filtros = {};
  for (const k of CHAVES_DOS_FILTROS) {
    const v = p.get(k);
    if (v) f[k] = v;
  }
  return f;
}

function ataDoEndereco(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('ata');
}

/** Escreve a ata aberta e os filtros no endereço. `empurrar` cria uma entrada no histórico (o "voltar" do celular). */
function escreverNoEndereco(mudanca: { ata?: string | null; filtros?: Filtros }, empurrar = false) {
  const u = new URL(window.location.href);
  if (mudanca.ata !== undefined) {
    if (mudanca.ata) u.searchParams.set('ata', mudanca.ata);
    else u.searchParams.delete('ata');
  }
  if (mudanca.filtros) {
    for (const k of CHAVES_DOS_FILTROS) {
      const v = mudanca.filtros[k];
      if (v) u.searchParams.set(k, v);
      else u.searchParams.delete(k);
    }
  }
  const destino = `${u.pathname}${u.search}`;
  if (empurrar) window.history.pushState({}, '', destino);
  else window.history.replaceState({}, '', destino);
}

/** A rota da lista com a busca (sem busca, a rota de sempre). */
function rotaDaLista(f: Filtros): string {
  const p = new URLSearchParams();
  for (const k of CHAVES_DOS_FILTROS) if (f[k]) p.set(k, f[k]!);
  const qs = p.toString();
  return qs ? `/trabalho/atas?${qs}` : '/trabalho/atas';
}

/** Desktop (lado a lado) ou celular (uma tela de cada vez). */
function useDuasColunas(): boolean {
  const ler = () => (typeof window === 'undefined' ? true : window.innerWidth >= LARGURA_DAS_DUAS_COLUNAS);
  const [largo, setLargo] = useState(ler);
  useEffect(() => {
    const medir = () => setLargo(ler());
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, []);
  return largo;
}

/**
 * A ALTURA ATÉ O FIM DA JANELA (a mesma conta do quadro do Trabalho): a tela de
 * Atas mede onde começa e ocupa o resto, para a PÁGINA não rolar; quem rola é a
 * lista e o detalhe, cada um por si. Remede ao redimensionar e quando algo
 * acima muda de tamanho (o formulário de colar, a pasta do Drive).
 */
function useAlturaAteOFim(ref: React.RefObject<HTMLElement | null>, ativo: boolean, folga = 24) {
  const [altura, setAltura] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!ativo) { setAltura(null); return; }
    const medir = () => {
      const el = ref.current;
      if (!el) return;
      const nova = Math.max(360, Math.floor(window.innerHeight - el.getBoundingClientRect().top - folga));
      setAltura((antes) => (antes === nova ? antes : nova));
    };
    medir();
    window.addEventListener('resize', medir);
    const observador = typeof ResizeObserver === 'function' ? new ResizeObserver(medir) : null;
    observador?.observe(document.body);
    return () => { window.removeEventListener('resize', medir); observador?.disconnect(); };
  }, [ref, ativo, folga]);
  return altura;
}

const ROTULO_DA_FONTE: Record<TrabAtaResumo['fonte'], string> = { vault: 'vault', colada: 'colada', granola: 'Granola', drive: 'Drive' };

export function AtasView() {
  const { token, ready, can } = useAuth();
  const podeVer = can('tarefas.ver');
  const podeEditar = can('tarefas.editar');
  // Colar escreve nota da memória: pede o mesmo que o POST /memoria (PA-2).
  const podeColar = podeEditar && can('obsidian.editar');
  // Escolher a pasta do Drive escreve nota da memória e lê o Drive.
  const podeEscolherPasta = podeColar && can('drive.ver');
  const botaoColar = useRef<HTMLButtonElement>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const largo = useDuasColunas();
  const altura = useAlturaAteOFim(raiz, largo);

  const [filtros, setFiltros] = useState<Filtros>(filtrosDoEndereco);
  const [busca, setBusca] = useState(filtros.q ?? '');
  const [lista, setLista] = useState<TrabAtaLista | null>(null);
  const [aberta, setAberta] = useState<TrabAtaDetalhe | null>(null);
  const [refAberta, setRefAberta] = useState<string | null>(ataDoEndereco);
  const [abrindo, setAbrindo] = useState(false);
  const [estrutura, setEstrutura] = useState<TrabEstrutura | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [lendo, setLendo] = useState(false);
  const [decidindo, setDecidindo] = useState<string | null>(null);
  const [listaEscolhida, setListaEscolhida] = useState<Record<string, string>>({});
  const [ajustes, setAjustes] = useState<Record<string, Ajuste>>({});
  const [pessoas, setPessoas] = useState<{ id: string; nome: string }[]>([]);
  const [colando, setColando] = useState(false);
  const [pastaAberta, setPastaAberta] = useState(false);

  const fecharColar = useCallback(() => {
    setColando(false);
    // O foco volta ao botão que abriu o formulário (o formulário some do DOM).
    window.setTimeout(() => botaoColar.current?.focus(), 0);
  }, []);

  // Só a resposta do ÚLTIMO pedido vale: trocar "de" e "até" em sequência dispara duas
  // buscas, e a mais velha (só com o "de") não pode chegar por último e mandar na lista.
  const pedidoDaLista = useRef(0);
  const carregarLista = useCallback(() => {
    if (!token || !podeVer) return;
    const este = ++pedidoDaLista.current;
    apiGet<TrabAtaLista>(rotaDaLista(filtros), token)
      .then((l) => {
        if (este !== pedidoDaLista.current) return;
        setLista(l);
        // No desktop a primeira abre sozinha; no celular a lista vem primeiro.
        if (largo) setRefAberta((atual) => atual ?? ataDoEndereco() ?? l.atas[0]?.id ?? null);
      })
      .catch((e) => { if (este === pedidoDaLista.current) setErro(e.message); });
  }, [token, podeVer, filtros, largo]);

  useEffect(() => { carregarLista(); }, [carregarLista]);

  // A palavra-chave vai ao endereço e à API depois de uma pausa na digitação.
  useEffect(() => {
    const atual = filtros.q ?? '';
    if (busca.trim() === atual) return;
    const t = window.setTimeout(() => mudarFiltros({ q: busca.trim() || undefined }), 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca]);

  // O "voltar" do navegador no celular: a ata do endereço manda.
  useEffect(() => {
    const aoVoltar = () => {
      setRefAberta(ataDoEndereco());
      setFiltros(filtrosDoEndereco());
    };
    window.addEventListener('popstate', aoVoltar);
    return () => window.removeEventListener('popstate', aoVoltar);
  }, []);

  useEffect(() => {
    if (!token || !podeEditar) return;
    apiGet<TrabEstrutura>('/trabalho/estrutura', token).then(setEstrutura).catch(() => setEstrutura(null));
    // T5: o responsável sai dos perfis reais da empresa, não de texto livre.
    apiGet<{ id: string; nome: string }[]>('/trabalho/pessoas', token).then((r) => setPessoas(Array.isArray(r) ? r : [])).catch(() => setPessoas([]));
  }, [token, podeEditar]);

  const mudarFiltros = (mudanca: Filtros) => {
    const novos: Filtros = { ...filtros, ...mudanca };
    for (const k of CHAVES_DOS_FILTROS) if (!novos[k]) delete novos[k];
    setFiltros(novos);
    escreverNoEndereco({ filtros: novos });
  };

  const limparFiltros = () => {
    setBusca('');
    setFiltros({});
    escreverNoEndereco({ filtros: {} });
  };

  const buscarDetalhe = useCallback((ref: string) => {
    if (!token) return;
    setAbrindo(true);
    apiGet<TrabAtaDetalhe>(`/trabalho/atas/${encodeURIComponent(ref)}`, token)
      .then((a) => { setAberta(a); setErro(null); })
      .catch((e) => setErro(e.message))
      .finally(() => setAbrindo(false));
  }, [token]);

  const abrir = useCallback((ref: string) => {
    setAvisos([]);
    setRefAberta(ref);
    // No celular, abrir é ir para outra tela: entra no histórico para o "voltar" do aparelho.
    escreverNoEndereco({ ata: ref }, !largo);
    buscarDetalhe(ref);
  }, [buscarDetalhe, largo]);

  const voltar = () => {
    setRefAberta(null);
    setAberta(null);
    escreverNoEndereco({ ata: null });
  };

  useEffect(() => {
    if (refAberta && (!aberta || aberta.id !== refAberta)) buscarDetalhe(refAberta);
    // abrir só quando a ata pedida muda
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refAberta]);

  const avisosDaLeitura = (g: { criadas: unknown[]; repetidas: number; avisos: string[] }, extra: string[] = []) => [
    g.criadas.length
      ? `${g.criadas.length} ${g.criadas.length === 1 ? 'sugestão nova' : 'sugestões novas'} em rascunho.`
      : 'Nenhuma sugestão nova nesta leitura.',
    ...(g.repetidas ? [`${g.repetidas} já tinha${g.repetidas === 1 ? '' : 'm'} sido sugerida${g.repetidas === 1 ? '' : 's'} antes.`] : []),
    ...extra,
    ...g.avisos,
  ];

  const resumoDaFicha = (g: TrabGranolaAtaGerada): string[] => {
    const versao = g.nova ? 'Ata gerada da transcrição.' : `Ata reprocessada: versão ${g.versao} da mesma nota.`;
    const ficha =
      g.ficha === 'criada' ? `A reunião entrou na ficha de ${g.cliente?.titulo ?? 'cliente'}.`
        : g.ficha === 'atualizada' ? `A reunião na ficha de ${g.cliente?.titulo ?? 'cliente'} mostra a ata nova.`
          : g.ficha === 'ja_estava' ? 'A reunião já estava na ficha do cliente (veio pelo Zap).'
            : g.ficha === 'nao_se_aplica' ? 'A transcrição veio do Drive: ela não vai à ficha do cliente.'
              : 'Nenhum cliente reconhecido: a reunião não foi para ficha nenhuma.';
    return [versao, ficha];
  };

  /** "Sugerir tarefas" (ata colada, do vault ou do Drive) ou "Reprocessar da transcrição" (ata escrita de uma transcrição). */
  const gerar = () => {
    if (!aberta || !token) return;
    setLendo(true);
    setErro(null);
    const daTranscricao = !!aberta.transcricaoRef || aberta.fonte === 'granola';
    const rota = daTranscricao ? 'reprocessar' : 'sugestoes';
    apiPost<TrabAtaGeracao & Partial<TrabGranolaAtaGerada>>(`/trabalho/atas/${encodeURIComponent(aberta.id)}/${rota}`, {}, token)
      .then((g) => {
        setAvisos(avisosDaLeitura(g, daTranscricao && g.versao ? resumoDaFicha(g as TrabGranolaAtaGerada) : []));
        buscarDetalhe(aberta.id);
        carregarLista();
      })
      .catch((e) => setErro(e.message))
      .finally(() => setLendo(false));
  };

  /** "Gerar ata" de uma TRANSCRIÇÃO (Granola ou Drive): abre a ata escrita. */
  const gerarAtaDaTranscricao = (t: TrabAtaDetalhe) => {
    if (!token) return;
    const [fonte, id] = [t.fonte, t.id.slice(t.id.indexOf(':') + 1)];
    const rota = fonte === 'granola' ? `/trabalho/atas/granola/${encodeURIComponent(id)}/ata` : `/trabalho/atas/drive/${encodeURIComponent(id)}/ata`;
    setLendo(true);
    setErro(null);
    apiPost<TrabGranolaAtaGerada>(rota, {}, token)
      .then((g) => {
        setAvisos(avisosDaLeitura(g, resumoDaFicha(g)));
        setAberta(g.ata);
        setRefAberta(g.ata.id);
        escreverNoEndereco({ ata: g.ata.id });
        carregarLista();
      })
      .catch((e) => setErro(e.message))
      .finally(() => setLendo(false));
  };

  const decidir = (s: TrabAtaSugestaoDto, como: 'aceitar' | 'descartar') => {
    if (!token || !aberta) return;
    setDecidindo(s.id);
    setErro(null);
    const ajuste = ajustes[s.id] ?? {};
    const vencimento = ajuste.vencimento ?? s.vencimento ?? '';
    const responsavelId = ajuste.responsavelId !== undefined ? ajuste.responsavelId : pessoaDoNome(pessoas, s.donoSugerido)?.id ?? '';
    // T5: o aceite leva o que a pessoa confirmou ou corrigiu: título, o que será executado,
    // responsável (perfil da empresa), cliente, lista e vencimento (vazio = sem).
    const corpo = como === 'aceitar'
      ? {
        listaId: listaEscolhida[s.id] || s.listaId || undefined,
        titulo: (ajuste.titulo ?? s.titulo).trim() || undefined,
        descricao: (ajuste.descricao ?? s.trecho).trim() || null,
        responsavelId: responsavelId || null,
        clienteId: ajuste.cliente?.id,
        vencimento: vencimento || null,
      }
      : {};
    apiPost<TrabAtaSugestaoDto>(`/trabalho/atas/sugestoes/${s.id}/${como}`, corpo, token)
      .then(() => { buscarDetalhe(aberta.id); carregarLista(); })
      .catch((e) => setErro(e.message))
      .finally(() => setDecidindo(null));
  };

  if (!ready) return <p className="text-muted">Carregando…</p>;
  if (!token || !podeVer) return <p className="text-muted">Sem permissão para ver as atas.</p>;

  const rascunhos = aberta?.sugestoesDaAta.filter((s) => s.estado === 'rascunho') ?? [];
  const decididas = aberta?.sugestoesDaAta.filter((s) => s.estado !== 'rascunho') ?? [];
  const mostrarLista = largo || !refAberta;
  const mostrarDetalhe = largo || !!refAberta;
  const ehTranscricao = aberta?.tipo === 'transcricao';
  // A ata que o OS escreveu de uma transcrição (Granola ou Drive) se reprocessa da transcrição.
  const ataDaTranscricao = !!aberta && !ehTranscricao && (!!aberta.transcricaoRef || aberta.fonte === 'granola');
  const temFiltro = CHAVES_DOS_FILTROS.some((k) => !!filtros[k]);

  return (
    <div
      ref={raiz}
      data-testid="atas-tela"
      className={`flex flex-col gap-3 ${largo ? 'overflow-hidden' : ''}`}
      style={largo && altura ? { height: altura, overflow: 'hidden' } : largo ? { overflow: 'hidden' } : undefined}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">Atas</h1>
          <p className="text-sm text-muted">
            As reuniões da operação e as tarefas que elas combinaram. Toda sugestão é rascunho até alguém aceitar.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {podeEscolherPasta && (
            <button
              type="button"
              data-testid="ata-pasta-do-drive"
              className={BTN}
              onClick={() => setPastaAberta((v) => !v)}
              aria-expanded={pastaAberta}
              aria-controls="ata-pasta-form"
            >
              {pastaAberta ? 'Fechar' : 'Pasta do Drive'}
            </button>
          )}
          {podeColar && (
            <button
              ref={botaoColar}
              type="button"
              data-testid="ata-colar"
              className={BTN}
              onClick={() => (colando ? fecharColar() : setColando(true))}
              aria-expanded={colando}
              aria-controls="ata-colar-form"
            >
              {colando ? 'Fechar' : 'Colar ata'}
            </button>
          )}
        </div>
      </div>
      {podeEditar && !podeColar && (
        <p className="text-[12px] text-muted">
          Colar ata grava uma nota na memória da empresa, e isso pede também a permissão de editar a memória (obsidian.editar), que o seu perfil não tem.
        </p>
      )}

      {erro && <p role="alert" className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm break-words">{erro}</p>}

      {pastaAberta && podeEscolherPasta && (
        <PastaDoDrive
          token={token}
          estado={lista?.fontes?.drive ?? null}
          onSalva={() => { setPastaAberta(false); carregarLista(); }}
          onErro={setErro}
        />
      )}

      {colando && podeColar && (
        <ColarAta
          token={token}
          onFechar={fecharColar}
          onSalva={(a) => {
            fecharColar();
            setAberta(a);
            setRefAberta(a.id);
            escreverNoEndereco({ ata: a.id });
            carregarLista();
          }}
          onErro={setErro}
        />
      )}

      <form role="search" aria-label="Buscar atas" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(12rem,1fr)_auto_auto_auto_auto_auto]" onSubmit={(e) => { e.preventDefault(); mudarFiltros({ q: busca.trim() || undefined }); }}>
        <label className="text-[12px] text-muted sm:col-span-2 lg:col-span-1">
          <span className="sr-only">Palavra-chave</span>
          <input data-testid="atas-busca" type="search" className={INP} placeholder="Buscar por palavra-chave" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </label>
        <label className="flex items-center gap-1 text-[12px] text-muted">
          <span>De</span>
          <input data-testid="atas-de" type="date" aria-label="De" className={INP} value={filtros.de ?? ''} onChange={(e) => mudarFiltros({ de: e.target.value || undefined })} />
        </label>
        <label className="flex items-center gap-1 text-[12px] text-muted">
          <span>Até</span>
          <input data-testid="atas-ate" type="date" aria-label="Até" className={INP} value={filtros.ate ?? ''} onChange={(e) => mudarFiltros({ ate: e.target.value || undefined })} />
        </label>
        <select data-testid="atas-tipo" aria-label="Tipo" className={INP} value={filtros.tipo ?? ''} onChange={(e) => mudarFiltros({ tipo: e.target.value || undefined })}>
          <option value="">Atas e transcrições</option>
          <option value="ata">Só atas</option>
          <option value="transcricao">Só transcrições</option>
        </select>
        <select data-testid="atas-fonte" aria-label="Fonte" className={INP} value={filtros.fonte ?? ''} onChange={(e) => mudarFiltros({ fonte: e.target.value || undefined })}>
          <option value="">Todas as fontes</option>
          <option value="vault">Vault</option>
          <option value="colada">Coladas</option>
          <option value="granola">Granola</option>
          <option value="drive">Google Drive</option>
        </select>
        <button type="button" data-testid="atas-limpar" className={BTN} disabled={!temFiltro && !busca} onClick={limparFiltros}>Limpar</button>
      </form>

      <div className={`grid gap-4 ${largo ? 'min-h-0 flex-1 grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]' : ''}`}>
        {mostrarLista && (
          <section
            aria-label="Atas e transcrições"
            data-testid="atas-coluna-lista"
            className={`min-w-0 space-y-2 ${largo ? 'h-full min-h-0 overflow-y-auto overscroll-contain pr-1' : ''}`}
          >
            {lista && <EstadoDasFontes lista={lista} />}
            <ul data-testid="atas-lista" className="space-y-1.5">
              {lista?.atas.map((a) => (
                <li key={a.id}>
                  <ItemDaAta ata={a} ativa={a.id === refAberta} onAbrir={() => abrir(a.id)} />
                  <DecididasDaAta ata={a} />
                </li>
              ))}
            </ul>
            {lista && lista.atas.length === 0 && (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted">
                {temFiltro
                  ? 'Nada com essa busca. Mude a palavra ou as datas, ou limpe os filtros.'
                  : `Nenhuma ata ainda. ${podeColar ? 'Cole a primeira em "Colar ata".' : 'Quem edita o Trabalho e a memória pode colar a primeira.'}`}
              </p>
            )}
            {!lista && !erro && <p className="text-sm text-muted">Carregando…</p>}
          </section>
        )}

        {mostrarDetalhe && (
          <section
            aria-label="Ata aberta"
            data-testid="atas-coluna-detalhe"
            className={`min-w-0 space-y-4 ${largo ? 'h-full min-h-0 overflow-y-auto overscroll-contain pr-1' : ''}`}
          >
            {!largo && (
              <button type="button" data-testid="atas-voltar" className={BTN} onClick={voltar}>
                Voltar para a lista
              </button>
            )}
            {!aberta && abrindo && <p className="text-sm text-muted">Abrindo…</p>}
            {!aberta && !abrindo && lista && lista.atas.length > 0 && <p className="text-sm text-muted">Escolha uma ata ou transcrição à esquerda.</p>}
            {aberta && (
              <>
                <header className="space-y-2 rounded-lg border border-border bg-surface p-3">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                    <span className="rounded bg-surface-2 px-1.5 py-0.5">{ehTranscricao ? 'transcrição' : 'ata'}</span>
                    <span className="rounded bg-surface-2 px-1.5 py-0.5">{ROTULO_DA_FONTE[aberta.fonte]}</span>
                  </div>
                  <h2 className="text-lg font-semibold break-words">{aberta.titulo}</h2>
                  <p className="text-[12px] text-muted break-words">
                    {[dataBR(aberta.data) ?? 'sem data', aberta.participantes.length ? aberta.participantes.join(', ') : 'participantes não informados', aberta.procedencia].join(' · ')}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {ehTranscricao && podeColar && (
                      <button
                        type="button"
                        data-testid={`transcricao-gerar-${aberta.id}`}
                        className={BTN_PRIMARIO}
                        disabled={lendo || lista?.iaConfigurada === false || (aberta.fonte === 'drive' && !can('drive.ver'))}
                        title={lista?.iaConfigurada === false ? 'A IA não está configurada nesta instalação.' : 'Lê a transcrição, escreve a ata e propõe as tarefas. A transcrição não fica guardada no OS.'}
                        onClick={() => gerarAtaDaTranscricao(aberta)}
                      >
                        {lendo ? 'Lendo a transcrição…' : aberta.ataGerada ? 'Gerar a ata de novo' : 'Gerar ata'}
                      </button>
                    )}
                    {ehTranscricao && aberta.ataGerada && (
                      <button type="button" data-testid="transcricao-abrir-ata" className={BTN} onClick={() => abrir(aberta.ataGerada!)}>Abrir a ata gerada</button>
                    )}
                    {!ehTranscricao && aberta.transcricaoRef && (
                      <button type="button" data-testid="ata-abrir-transcricao" className={BTN} onClick={() => abrir(aberta.transcricaoRef!)}>Abrir a transcrição</button>
                    )}
                    {aberta.link && (
                      <a data-testid="ata-abrir-fonte" className={`${BTN} inline-flex items-center`} href={aberta.link} target="_blank" rel="noopener noreferrer">
                        Abrir {aberta.fonte === 'drive' ? 'no Drive' : aberta.fonte === 'granola' ? 'no Granola' : 'na fonte'}
                      </a>
                    )}
                  </div>
                  {ehTranscricao && !podeColar && (
                    <p className="text-[12px] text-muted">Gerar ata grava uma nota na memória e pede as permissões de editar o Trabalho e a memória.</p>
                  )}
                </header>

                {avisos.length > 0 && (
                  <ul aria-label="O que a leitura disse" className="space-y-0.5 rounded-lg bg-surface-2 px-3 py-2 text-[12px] text-muted">
                    {avisos.map((a, i) => <li key={i} className="break-words">{a}</li>)}
                  </ul>
                )}

                {!ehTranscricao && (
                  <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">Sugestões de tarefa</h3>
                      {podeEditar && (
                        <button
                          type="button"
                          data-testid={`ata-gerar-${aberta.id}`}
                          className={BTN_PRIMARIO}
                          disabled={lendo || lista?.iaConfigurada === false || (ataDaTranscricao && !podeColar)}
                          onClick={gerar}
                          title={
                            lista?.iaConfigurada === false
                              ? 'A IA não está configurada nesta instalação.'
                              : ataDaTranscricao
                                ? 'Puxa a transcrição de novo, reescreve a ata (versão nova) e propõe as tarefas que faltam.'
                                : 'O agente lê a ata e propõe tarefas em rascunho.'
                          }
                        >
                          {ataDaTranscricao
                            ? (lendo ? 'Lendo a transcrição…' : 'Reprocessar da transcrição')
                            : (lendo ? 'Lendo a ata…' : 'Sugerir tarefas')}
                        </button>
                      )}
                    </div>
                    {rascunhos.length === 0 && decididas.length === 0 && (
                      <p className="text-sm text-muted">Nenhuma sugestão desta ata ainda.</p>
                    )}
                    <ul className="space-y-2">
                      {rascunhos.map((s) => (
                        <li key={s.id} data-testid={`ata-sugestao-${s.id}`} className="space-y-2 rounded-lg border border-border bg-surface-2 p-3">
                          {!podeEditar && <p className="font-medium break-words">{s.titulo}</p>}
                          <blockquote className="border-l-2 border-brand-dim pl-2 text-[13px] text-muted break-words">{s.trecho}</blockquote>
                          {!podeEditar && (
                            <p className="text-[12px] text-muted break-words">
                              {[s.donoSugerido ? `dono sugerido: ${s.donoSugerido}` : 'sem dono sugerido', s.vencimento ? `vence ${dataBR(s.vencimento)}` : 'sem vencimento'].join(' · ')}
                            </p>
                          )}
                          {podeEditar && (
                            <FormularioDoAceite
                              s={s} ajuste={ajustes[s.id] ?? {}} pessoas={pessoas} estrutura={estrutura} token={token}
                              listaId={listaEscolhida[s.id] ?? s.listaId ?? ''}
                              onLista={(id) => setListaEscolhida((m) => ({ ...m, [s.id]: id }))}
                              onAjuste={(mudanca) => setAjustes((m) => ({ ...m, [s.id]: { ...m[s.id], ...mudanca } }))}
                            />
                          )}
                          {podeEditar && (
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                data-testid={`ata-aceitar-${s.id}`}
                                className={BTN_PRIMARIO}
                                disabled={decidindo === s.id || !(listaEscolhida[s.id] || s.listaId) || !ajustes[s.id]?.cliente}
                                title={!ajustes[s.id]?.cliente ? 'Escolha o cliente antes de aceitar' : undefined}
                                onClick={() => decidir(s, 'aceitar')}
                              >
                                Aceitar
                              </button>
                              <button
                                type="button"
                                data-testid={`ata-descartar-${s.id}`}
                                className={BTN}
                                disabled={decidindo === s.id}
                                onClick={() => decidir(s, 'descartar')}
                              >
                                Descartar
                              </button>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                    {decididas.length > 0 && (
                      <details className="text-sm">
                        <summary className={`cursor-pointer text-muted ${ALVO} max-md:flex max-md:items-center`}>Decididas ({decididas.length})</summary>
                        <ul className="mt-2 space-y-1">
                          {decididas.map((s) => (
                            <li key={s.id} data-testid={`ata-sugestao-${s.id}`} className="flex flex-wrap items-baseline gap-x-2 break-words">
                              <span className={s.estado === 'aceita' ? 'text-brand' : 'text-muted line-through'}>{s.titulo}</span>
                              <span className="text-[12px] text-muted">
                                {s.estado === 'aceita' ? `aceita${s.listaNome ? ` em ${s.listaNome}` : ''}` : 'descartada'}
                                {s.decididaPor ? ` por ${s.decididaPor}` : ''}
                              </span>
                              {s.estado === 'aceita' && s.workTaskId && s.listaId && (
                                <a className={`text-[12px] text-brand underline underline-offset-2 ${ALVO} max-md:inline-flex max-md:items-center`} href={`/trabalho?lista=${s.listaId}&tarefa=${s.workTaskId}`}>abrir a tarefa</a>
                              )}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                )}

                {!ehTranscricao && <DecisoesEPendencias ata={aberta} />}

                {ehTranscricao ? (
                  <article aria-label="A transcrição inteira" data-testid="transcricao-texto" className="rounded-lg border border-border bg-surface p-3">
                    <p className="mb-2 text-[11px] text-muted">A transcrição é lida agora da fonte e não fica guardada no OS.</p>
                    <pre className="whitespace-pre-wrap break-words font-sans text-sm">{aberta.texto}</pre>
                  </article>
                ) : (
                  <article aria-label="A ata inteira" className="rounded-lg border border-border bg-surface p-3">
                    <RoteiroMarkdown texto={aberta.texto} />
                  </article>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * O ACEITE EDITÁVEL (rodada do trabalho T5, 19/10/2026): tudo se ajusta antes
 * de criar. Título no imperativo (a IA propõe assim), o que será executado
 * (pré-preenchido com o trecho, que continua guardado como procedência),
 * responsável entre os perfis reais da empresa, cliente (T4, obrigatório),
 * pasta e lista em dois níveis, vencimento. A IA só propõe; o clique é de gente.
 * ------------------------------------------------------------------------ */
interface Ajuste {
  vencimento?: string;
  titulo?: string;
  descricao?: string;
  responsavelId?: string;
  cliente?: ClienteEscolhido;
}

const SOLTAS = '__soltas__';

const semAcento = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').trim().toLocaleLowerCase('pt-BR');

/** O perfil cujo nome (ou primeiro nome) a ata escreveu. Sem casamento claro, nenhum. */
function pessoaDoNome(pessoas: { id: string; nome: string }[], nome: string | null): { id: string; nome: string } | null {
  if (!nome) return null;
  const n = semAcento(nome);
  const inteiro = pessoas.filter((p) => semAcento(p.nome) === n);
  if (inteiro.length === 1) return inteiro[0];
  const primeiro = pessoas.filter((p) => semAcento(p.nome).split(' ')[0] === n.split(' ')[0]);
  return primeiro.length === 1 ? primeiro[0] : null;
}

function FormularioDoAceite({ s, ajuste, pessoas, estrutura, token, listaId, onLista, onAjuste }: {
  s: TrabAtaSugestaoDto; ajuste: Ajuste; pessoas: { id: string; nome: string }[]; estrutura: TrabEstrutura | null;
  token: string | null; listaId: string; onLista: (id: string) => void; onAjuste: (m: Ajuste) => void;
}) {
  const sugerido = pessoaDoNome(pessoas, s.donoSugerido);
  const responsavelId = ajuste.responsavelId !== undefined ? ajuste.responsavelId : sugerido?.id ?? '';
  const pastas = estrutura?.folders ?? [];
  const pastaDaLista = pastas.find((f) => f.lists.some((l) => l.id === listaId))?.id
    ?? (listaId && estrutura?.listasSoltas.some((l) => l.id === listaId) ? SOLTAS : '');
  const [pasta, setPasta] = useState<string>(pastaDaLista);
  useEffect(() => { if (pastaDaLista) setPasta(pastaDaLista); }, [pastaDaLista]);
  const listasDaPasta = pasta === SOLTAS ? estrutura?.listasSoltas ?? [] : pastas.find((f) => f.id === pasta)?.lists ?? [];
  const nomeDaPasta = new Map(pastas.map((f) => [f.id, f.name]));
  return (
    <div className="grid gap-2 sm:grid-cols-2" data-testid={`ata-formulario-${s.id}`}>
      <label className="space-y-1 text-[12px] text-muted sm:col-span-2">
        <span>Título</span>
        <input
          data-testid={`ata-titulo-${s.id}`}
          className={INP}
          value={ajuste.titulo ?? s.titulo}
          maxLength={300}
          title={DICA_DO_NOME_DA_TAREFA}
          onChange={(e) => onAjuste({ titulo: e.target.value })}
        />
        <span className="block text-[11px]">{DICA_DO_NOME_DA_TAREFA}</span>
      </label>
      <label className="space-y-1 text-[12px] text-muted sm:col-span-2">
        <span>O que será executado</span>
        <textarea
          data-testid={`ata-descricao-${s.id}`}
          className={`${INP} min-h-[64px]`}
          value={ajuste.descricao ?? s.trecho}
          maxLength={4000}
          onChange={(e) => onAjuste({ descricao: e.target.value })}
        />
        <span className="block text-[11px]">O trecho da ata continua guardado na tarefa como procedência.</span>
      </label>
      <label className="space-y-1 text-[12px] text-muted">
        <span>Responsável</span>
        <select data-testid={`ata-responsavel-${s.id}`} className={INP} value={responsavelId} onChange={(e) => onAjuste({ responsavelId: e.target.value })}>
          <option value="">Sem responsável</option>
          {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
        {s.donoSugerido && !sugerido && (
          <span className="block text-[11px] text-warn">A ata diz {s.donoSugerido}, que não é um perfil desta empresa. Escolha quem responde.</span>
        )}
      </label>
      <div className="space-y-1 text-[12px] text-muted">
        <span>Cliente *</span>
        <SeletorDeCliente valor={ajuste.cliente ?? null} token={token} obrigatorio onEscolher={(c) => onAjuste({ cliente: c })} testid={`ata-cliente-${s.id}`} />
      </div>
      <label className="space-y-1 text-[12px] text-muted">
        <span>Pasta</span>
        <select data-testid={`ata-pasta-${s.id}`} className={INP} value={pasta} onChange={(e) => { setPasta(e.target.value); onLista(''); }}>
          <option value="">Escolha a pasta…</option>
          {pastas.map((f) => (
            <option key={f.id} value={f.id}>{f.parentId && nomeDaPasta.get(f.parentId) ? `${nomeDaPasta.get(f.parentId)} › ` : ''}{f.name}</option>
          ))}
          {(estrutura?.listasSoltas.length ?? 0) > 0 && <option value={SOLTAS}>Sem pasta</option>}
        </select>
      </label>
      <label className="space-y-1 text-[12px] text-muted">
        <span>Lista</span>
        <select aria-label={`Lista da tarefa "${s.titulo}"`} data-testid={`ata-lista-${s.id}`} className={INP} value={listaId} onChange={(e) => onLista(e.target.value)}>
          <option value="">Escolha a lista…</option>
          {listaId && !listasDaPasta.some((l) => l.id === listaId) && <option value={listaId}>{s.listaNome ?? 'lista sugerida'}</option>}
          {listasDaPasta.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </label>
      <label className="space-y-1 text-[12px] text-muted">
        <span>Vence em</span>
        <input
          type="date"
          data-testid={`ata-vencimento-${s.id}`}
          className={INP}
          value={ajuste.vencimento ?? s.vencimento ?? ''}
          onChange={(e) => onAjuste({ vencimento: e.target.value })}
        />
      </label>
      <p className="text-[11px] text-muted sm:col-span-2">
        {s.donoSugerido || s.vencimento
          ? 'O leitor só propõe dono e vencimento que a ata escreve. Confira antes de aceitar.'
          : 'A ata não diz dono nem vencimento. Preencha se a reunião combinou.'}
      </p>
    </div>
  );
}

function ItemDaAta({ ata, ativa, onAbrir }: { ata: TrabAtaResumo; ativa: boolean; onAbrir: () => void }) {
  const { rascunho, aceitas, descartadas } = ata.sugestoes;
  const transcricao = ata.tipo === 'transcricao';
  return (
    <button
      type="button"
      data-testid={`ata-${ata.id}`}
      onClick={onAbrir}
      aria-current={ativa ? 'true' : undefined}
      className={`w-full space-y-1 rounded-lg border px-3 py-2 text-left ${ativa ? 'border-brand-dim bg-brand/10' : 'border-border bg-surface hover:border-brand-dim'}`}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate font-medium" title={ata.titulo}>{ata.titulo}</span>
        <span className="shrink-0 font-mono text-[11px] text-muted">{dataBR(ata.data) ?? 'sem data'}</span>
      </span>
      {ata.participantes.length > 0 && (
        <span className="block truncate text-[12px] text-muted" title={ata.participantes.join(', ')}>{ata.participantes.join(', ')}</span>
      )}
      {ata.resumo && <span className="line-clamp-2 block text-[12px] text-muted break-words">{ata.resumo}</span>}
      <span className="flex flex-wrap gap-1.5 text-[11px] text-muted">
        <span data-testid={`ata-tipo-${ata.id}`} className={`rounded px-1.5 py-0.5 ${transcricao ? 'bg-surface-2 text-text' : 'bg-surface-2'}`}>{transcricao ? 'transcrição' : 'ata'}</span>
        <span className="rounded bg-surface-2 px-1.5 py-0.5">{ROTULO_DA_FONTE[ata.fonte] ?? ata.fonte}</span>
        {transcricao && ata.ataGerada && <span className="rounded bg-surface-2 px-1.5 py-0.5">ata gerada</span>}
        {rascunho > 0 && <span className="rounded bg-brand/10 px-1.5 py-0.5 text-brand">{rascunho} para decidir</span>}
        {aceitas > 0 && <span className="rounded bg-surface-2 px-1.5 py-0.5">{aceitas} {aceitas === 1 ? 'virou tarefa' : 'viraram tarefas'}</span>}
        {descartadas > 0 && <span className="rounded bg-surface-2 px-1.5 py-0.5">{descartadas} {descartadas === 1 ? 'descartada' : 'descartadas'}</span>}
      </span>
    </button>
  );
}

/** De onde a lista veio, fonte por fonte, e por que uma delas não trouxe nada. */
function EstadoDasFontes({ lista }: { lista: TrabAtaLista }) {
  const f = lista.fontes;
  const vault = lista.vaultVisivel === false
    ? `As atas do vault (a pasta ${lista.pasta}) pedem a permissão de ler o vault (obsidian.ver), que o seu perfil não tem: aparecem só as atas coladas aqui.`
    : lista.notasDoVault > 0
      ? `Do vault, a pasta ${lista.pasta}; e as coladas aqui.`
      : `Nenhuma nota do vault indexada nesta empresa: aparecem só as atas coladas aqui (a pasta ${lista.pasta} entra quando o vault for indexado).`;
  return (
    <div data-testid="atas-fontes" className="space-y-0.5 px-1 text-[12px] text-muted break-words">
      <p>{vault}</p>
      {f && (
        f.granola.conectado ? (
          <p>Granola: as reuniões dos últimos 30 dias, como transcrição.</p>
        ) : (
          <p data-testid="granola-sem-conexao">
            {f.granola.motivo ?? 'Conecte o Granola em Configurações › Integrações para ler as reuniões daqui.'}{' '}
            <a href="/conexoes" className={`text-brand underline underline-offset-2 ${ALVO} max-md:inline-flex max-md:items-center`}>Abrir Integrações</a>
          </p>
        )
      )}
      {f && (
        <p data-testid="drive-estado">
          {f.drive.motivo
            ? `Google Drive: ${f.drive.motivo}`
            : `Google Drive: os arquivos da pasta escolhida (até 50 por busca, os mais recentes).`}
          {f.drive.link && (
            <>
              {' '}
              <a href={f.drive.link} target="_blank" rel="noopener noreferrer" className="text-brand underline underline-offset-2">abrir a pasta</a>
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** "Pasta do Drive": colar o link (ou o id) da pasta das atas, ou tirar a pasta. */
function PastaDoDrive({ token, estado, onSalva, onErro }: {
  token: string; estado: TrabAtaDriveEstado | null; onSalva: () => void; onErro: (m: string) => void;
}) {
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => { campo.current?.focus(); }, []);
  const [pasta, setPasta] = useState(estado?.link ?? '');
  const [salvando, setSalvando] = useState(false);
  const salvar = (valor: string | null) => {
    setSalvando(true);
    apiPut<TrabAtaDriveEstado>('/trabalho/atas/drive', { pasta: valor }, token)
      .then(onSalva)
      .catch((e) => onErro(e.message))
      .finally(() => setSalvando(false));
  };
  return (
    <form
      id="ata-pasta-form"
      aria-label="Pasta do Drive das atas"
      className="space-y-2 rounded-lg border border-border bg-surface p-3"
      onSubmit={(e) => { e.preventDefault(); if (pasta.trim()) salvar(pasta.trim()); }}
    >
      <p className="text-[12px] text-muted">
        Cole o link da pasta do Google Drive onde ficam as atas e as transcrições. O OS lê os arquivos (Documento Google, PDF com texto, .txt e .md) e não copia nada além do índice. Arquivo com "transcrição" no nome entra como transcrição.
      </p>
      <label className="block space-y-1 text-[12px] text-muted">
        <span>Link ou id da pasta</span>
        <input ref={campo} data-testid="ata-pasta-campo" className={INP} value={pasta} onChange={(e) => setPasta(e.target.value)} placeholder="https://drive.google.com/drive/folders/..." />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" data-testid="ata-pasta-salvar" className={BTN_PRIMARIO} disabled={salvando || !pasta.trim()}>
          {salvando ? 'Conferindo a pasta…' : 'Usar esta pasta'}
        </button>
        {estado?.configurada && (
          <button type="button" data-testid="ata-pasta-tirar" className={BTN} disabled={salvando} onClick={() => salvar(null)}>Tirar a pasta</button>
        )}
      </div>
    </form>
  );
}

const linkDaTarefa = (listaId: string | null, tarefaId: string) => (listaId ? `/trabalho?lista=${listaId}&tarefa=${tarefaId}` : `/trabalho?tarefa=${tarefaId}`);

/** Abaixo do item da lista: quem decidiu as sugestões e o link da tarefa criada (fora do botão). */
function DecididasDaAta({ ata }: { ata: TrabAtaResumo }) {
  const decididas = ata.decididas ?? [];
  if (decididas.length === 0) return null;
  return (
    <ul data-testid={`ata-decididas-${ata.id}`} aria-label={`Sugestões decididas de "${ata.titulo}"`} className="mt-1 space-y-0.5 px-3 text-[11px] text-muted">
      {decididas.slice(0, 3).map((d) => (
        <li key={d.id} className="flex flex-wrap items-baseline gap-x-1.5 break-words">
          <span className={d.estado === 'aceita' ? 'text-text' : 'line-through'}>{d.titulo}</span>
          <span>{d.estado === 'aceita' ? 'aceita' : 'descartada'}{d.decididaPor ? ` por ${d.decididaPor}` : ''}</span>
          {d.estado === 'aceita' && d.workTaskId && (
            <a className={`text-brand underline underline-offset-2 ${ALVO} max-md:inline-flex max-md:items-center`} href={linkDaTarefa(d.listaId, d.workTaskId)}>abrir a tarefa</a>
          )}
        </li>
      ))}
      {decididas.length > 3 && <li>e mais {decididas.length - 3}</li>}
    </ul>
  );
}

/** A ata aberta: decisões e pendências como lista, e a pendência que virou tarefa marcada. */
function DecisoesEPendencias({ ata }: { ata: TrabAtaDetalhe }) {
  const decisoes = ata.decisoes ?? [];
  const pendencias = ata.pendencias ?? [];
  if (decisoes.length === 0 && pendencias.length === 0) return null;
  return (
    <section aria-label="Decisões e pendências" className="grid gap-3 rounded-lg border border-border bg-surface p-3 md:grid-cols-2">
      <div className="min-w-0 space-y-1">
        <h3 className="text-sm font-semibold">Decisões</h3>
        {decisoes.length === 0 ? (
          <p className="text-[12px] text-muted">A ata não registra decisão.</p>
        ) : (
          <ul data-testid="ata-decisoes" className="list-disc space-y-0.5 pl-5 text-sm">
            {decisoes.map((d, i) => <li key={i} className="break-words">{d}</li>)}
          </ul>
        )}
      </div>
      <div className="min-w-0 space-y-1">
        <h3 className="text-sm font-semibold">Pendências</h3>
        {pendencias.length === 0 ? (
          <p className="text-[12px] text-muted">A ata não registra pendência.</p>
        ) : (
          <ul data-testid="ata-pendencias" className="space-y-1 text-sm">
            {pendencias.map((p, i) => (
              <li key={i} data-testid={`ata-pendencia-${i}`} className="flex flex-wrap items-baseline gap-x-2 break-words">
                <span className={p.workTaskId ? 'text-text' : 'text-muted'}>{p.texto}</span>
                {p.workTaskId ? (
                  <a className={`text-[12px] text-brand underline underline-offset-2 ${ALVO} max-md:inline-flex max-md:items-center`} href={linkDaTarefa(null, p.workTaskId)}>virou tarefa</a>
                ) : p.estado === 'rascunho' ? (
                  <span className="text-[12px] text-muted">sugestão para decidir</span>
                ) : p.estado === 'descartada' ? (
                  <span className="text-[12px] text-muted">sugestão descartada</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ColarAta({ token, onSalva, onErro, onFechar }: {
  token: string; onSalva: (a: TrabAtaDetalhe) => void; onErro: (m: string) => void; onFechar: () => void;
}) {
  const primeiro = useRef<HTMLInputElement>(null);
  useEffect(() => { primeiro.current?.focus(); }, []);
  const [titulo, setTitulo] = useState('');
  const [data, setData] = useState('');
  const [participantes, setParticipantes] = useState('');
  const [texto, setTexto] = useState('');
  const [salvando, setSalvando] = useState(false);

  const lerArquivo = (f: File | undefined) => {
    if (!f) return;
    if (!/\.(md|txt)$/i.test(f.name)) { onErro('Envie um arquivo .md ou .txt.'); return; }
    f.text().then((t) => {
      setTexto(t);
      if (!titulo) setTitulo(f.name.replace(/\.(md|txt)$/i, ''));
    }).catch(() => onErro('Não consegui ler o arquivo.'));
  };

  const curta = Array.from(texto.trim()).length < ATA_MIN_CARACTERES;
  // O schema conta unidades de texto (como `length`); a tela trava antes de a API recusar (PA-6).
  const longa = texto.length > ATA_MAX_CARACTERES;
  const salvar = () => {
    setSalvando(true);
    apiPost<TrabAtaDetalhe>('/trabalho/atas', {
      titulo: titulo.trim(),
      data: data || null,
      participantes: participantes.split(',').map((p) => p.trim()).filter(Boolean),
      texto,
    }, token)
      .then(onSalva)
      .catch((e) => onErro(e.message))
      .finally(() => setSalvando(false));
  };

  return (
    <form
      id="ata-colar-form"
      aria-label="Colar ata"
      className="space-y-2 rounded-lg border border-border bg-surface p-3"
      onSubmit={(e) => { e.preventDefault(); if (!curta && !longa && titulo.trim().length >= 3) salvar(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onFechar(); } }}
    >
      <p className="text-[12px] text-muted">A ata vira nota da memória da empresa, com versão e registro no rastro. Senha, token ou chave que estiverem no texto são mascarados antes de gravar.</p>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <label className="space-y-1 text-[12px] text-muted">
          <span>Título</span>
          <input ref={primeiro} data-testid="ata-colar-titulo" className={INP} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Reunião de operação" />
        </label>
        <label className="space-y-1 text-[12px] text-muted">
          <span>Data da reunião</span>
          <input type="date" aria-label="Data da reunião" className={INP} value={data} onChange={(e) => setData(e.target.value)} />
        </label>
      </div>
      <label className="block space-y-1 text-[12px] text-muted">
        <span>Participantes (separados por vírgula)</span>
        <input className={INP} value={participantes} onChange={(e) => setParticipantes(e.target.value)} />
      </label>
      <label className="block space-y-1 text-[12px] text-muted">
        <span>Texto da ata</span>
        <textarea data-testid="ata-colar-texto" className={`${INP} min-h-48 font-mono text-[13px]`} value={texto} onChange={(e) => setTexto(e.target.value)} />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-[12px] text-muted">
          <span className="mr-2">Ou envie um arquivo .md ou .txt</span>
          <input type="file" accept=".md,.txt,text/markdown,text/plain" aria-label="Arquivo da ata" onChange={(e) => lerArquivo(e.target.files?.[0])} className={`text-[12px] ${ALVO}`} />
        </label>
        <button type="submit" data-testid="ata-colar-salvar" className={BTN_PRIMARIO} disabled={salvando || curta || longa || titulo.trim().length < 3}>
          {salvando ? 'Salvando…' : 'Salvar ata'}
        </button>
      </div>
      {texto && curta && <p className="text-[12px] text-muted">A ata precisa de ao menos {ATA_MIN_CARACTERES} caracteres.</p>}
      {longa && (
        <p role="status" data-testid="ata-colar-longa" className="text-[12px] text-warn">
          A ata tem {texto.length.toLocaleString('pt-BR')} caracteres, e o teto é {ATA_MAX_CARACTERES.toLocaleString('pt-BR')}. Corte o que não é a reunião (anexos, cabeçalhos repetidos) ou divida em duas atas.
        </p>
      )}
    </form>
  );
}
