'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiGet, apiPost, apiUpload } from '@/lib/api';
import type { EstadoDoLink, ItemDoLink, MapaDoCliente, NoDaTeia, RetratoDoTrilho, TeiaDoCliente } from '../../onboarding/tipos';

/*
 * O LINK DO CLIENTE — o KICKOFF, a estação atual de um mapa.
 *
 * Sem login (a rota está em `PUBLICAS` do AppShell): o token na URL é a
 * credencial. A página é a ESTAÇÃO ATUAL DE UM MAPA (desenho de 24/09): o
 * cliente vê o trecho inteiro — conversa, acordo, kickoff, contexto, memória
 * viva, frente rodando —, onde está, e o que recebe na estação 5. A estação de
 * hoje pede só o que falta, nesta ordem:
 *
 *   1. DECISÕES — o que só ele decide (obrigatório que a conversa não cobriu).
 *      Vêm primeiro porque são elas que definem o que a gente constrói.
 *   2. O QUE OUVIMOS DE VOCÊ — as propostas aprovadas, para confirmar ou
 *      corrigir, com o minuto da gravação.
 *   3. SE QUISER ACRESCENTAR — o opcional, sem peso.
 *
 * A PERGUNTA É A DO ROTEIRO DO KICKOFF, sempre: a espinha, ou a versão que o
 * roteirista reescreveu com o vocabulário do cliente (a API resolve isso em
 * `marcosDoLink`). Quem conduziu a conversa perguntou daquele jeito, e é
 * daquele jeito que ele lê aqui. Nada de reescrever pergunta na tela.
 *
 * A TEIA (24/09): ao lado das perguntas, o vault dele como no Obsidian — cada
 * tema é uma nota, as notas se ligam, e a cada resposta a nota acende e a
 * ligação com o índice aparece. As notas que já nasceram da transcrição
 * (marco `ata.notas`) estão lá desde o primeiro dia, com o minuto. O índice
 * do fim é o MOC: lista o que existe e de onde veio.
 *
 * O estado é o da API a cada resposta; nada de progresso no navegador (o link
 * guarda de onde parou porque o banco guarda). O nome de quem responde fica
 * no `localStorage` só para não perguntar de novo.
 */

const CHAVE_DO_NOME = 'onb_nome';

export default function LinkPage() {
  const { token } = useParams<{ token: string }>();
  const [estado, setEstado] = useState<EstadoDoLink | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [nomeOk, setNomeOk] = useState(false);
  const [retrato, setRetrato] = useState<RetratoDoTrilho | null>(null);
  const [mensagemFinal, setMensagemFinal] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [notaAberta, setNotaAberta] = useState<string | null>(null);
  /* O erro mora ao lado do que falhou (o campo, o botão de fechar), não num aviso no topo. */
  const [erroDe, setErroDe] = useState<Record<string, string>>({});
  const [fechando, setFechando] = useState(false);

  const base = `/tenants/onboarding/link/${token}`;

  const carregar = useCallback(() => {
    apiGet<EstadoDoLink>(base).then(setEstado).catch((e: Error) => setErro(e.message));
  }, [base]);

  useEffect(() => {
    carregar();
    try {
      const n = localStorage.getItem(CHAVE_DO_NOME);
      if (n) {
        setNome(n);
        setNomeOk(true);
      }
    } catch {
      /* navegador sem storage: pergunta o nome de novo */
    }
  }, [carregar]);

  useEffect(() => {
    if (estado?.concluido && estado.blocos === 'BCD' && !retrato) {
      apiGet<RetratoDoTrilho>(`${base}/retrato`).then(setRetrato).catch(() => undefined);
    }
  }, [estado, base, retrato]);

  async function agir<T>(chave: string, fn: () => Promise<T>): Promise<T | undefined> {
    setErroDe((atual) => ({ ...atual, [chave]: '' }));
    setOcupado(chave);
    try {
      const r = await fn();
      return r;
    } catch (e) {
      setErroDe((atual) => ({ ...atual, [chave]: (e as Error).message }));
      return undefined;
    } finally {
      setOcupado(null);
    }
  }

  const guardarNome = () => {
    const n = nome.trim();
    if (n.length < 2) return;
    try {
      localStorage.setItem(CHAVE_DO_NOME, n);
    } catch {
      /* sem storage, segue */
    }
    setNomeOk(true);
  };

  const irParaTema = (id: string) => {
    const el = document.getElementById(`tema-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const abrirNo = (no: NoDaTeia) => {
    if (no.tipo === 'tema' && no.temaId) irParaTema(no.temaId);
    else if (no.tipo === 'conversa') setNotaAberta(no.id);
    else if (no.tipo === 'indice') document.getElementById('indice')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (erro && !estado) {
    return (
      <Casca>
        <Marca />
        <div className="rounded-xl border border-border bg-surface p-5 text-sm">
          <p className="font-medium">Este link não está disponível.</p>
          <p className="mt-1 text-muted">Ele pode ter vencido ou sido substituído. Peça um novo no grupo com a Root.</p>
        </div>
      </Casca>
    );
  }
  if (!estado) return <Casca><Marca /><p className="text-sm text-muted">carregando…</p></Casca>;

  const kickoff = estado.blocos === 'BCD';
  const porTema = new Map(estado.itens.map((i) => [i.temaId, i]));
  const noDe = new Map(estado.teia.nos.map((n) => [n.id, n]));
  const pegar = (ids: string[]) => ids.map((id) => porTema.get(id)).filter((i): i is ItemDoLink => !!i);
  const decisoes = pegar(estado.ordem.decisoes);
  const confirmacoes = pegar(estado.ordem.confirmacoes);
  const extras = pegar(estado.ordem.extras);
  const decisoesAbertas = decisoes.filter((i) => i.modo !== 'feito').length;
  const jaConfirmados = confirmacoes.filter((i) => i.modo === 'feito').length;
  const rotulo = kickoff ? 'kickoff' : 'onboarding';

  if (!nomeOk) {
    return (
      <Casca largura="max-w-[560px]">
        <Marca rotulo={rotulo} />
        <MapaDoTrilho mapa={estado.mapa} compacto />
        <div className="mt-4 rounded-xl border border-border bg-surface p-5">
          <h1 className="text-[18px] font-bold leading-snug">
            {kickoff ? 'O trabalho começa aqui.' : `Onboarding da ${estado.cliente}`}
          </h1>
          <p className="mt-1 text-[13.5px] leading-relaxed text-muted">
            {kickoff
              ? `Você está na estação 3 de 6, o kickoff.${confirmacoes.length ? ` ${confirmacoes.length} respostas já vieram da conversa${estado.kickoffEm ? ` de ${dataCurta(estado.kickoffEm)}` : ''} — você só confirma.` : ''}${decisoesAbertas ? ` ${decisoesAbertas === 1 ? 'Falta uma decisão que só você toma' : `Faltam ${decisoesAbertas} decisões que só você toma`}.` : ''}${estado.teia.contagem.daConversa ? ` E ${estado.teia.contagem.daConversa} notas já nasceram da conversa — o seu vault começa com elas.` : ''} Pode parar e voltar.`
              : 'Cinco perguntas, uns 5 minutos. Com elas a gente chega na reunião falando da sua empresa, e não de IA em geral.'}
          </p>
          <label className="mt-4 block text-xs text-muted">Quem está respondendo?</label>
          <input className={INPUT} value={nome} onChange={(e) => setNome(e.target.value)} placeholder={estado.contatoNome ?? 'seu nome'} onKeyDown={(e) => e.key === 'Enter' && guardarNome()} />
          <button type="button" onClick={guardarNome} disabled={nome.trim().length < 2} className={BOTAO_PRIMARIO}>Começar</button>
        </div>
      </Casca>
    );
  }

  if (estado.concluido || mensagemFinal) {
    return (
      <Casca largura="max-w-[1040px]">
        <Marca rotulo={rotulo} />
        <div className="lg:grid lg:grid-cols-[minmax(0,640px)_minmax(300px,360px)] lg:items-start lg:gap-6">
          <div>
            <MapaDoTrilho mapa={estado.mapa} />
            <div className="mt-4 rounded-xl border border-border bg-surface p-5">
              <p className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted">{estado.cliente}</p>
              <h1 className="mt-1 text-[16px] font-bold">{mensagemFinal ?? 'Onboarding concluído.'}</h1>
              {retrato && (
                <div className="mt-4 space-y-3">
                  <p className="text-[12px] text-muted">Cada parte diz de onde veio. Se algo estiver errado, responda no grupo: corrigir substitui, não duplica.</p>
                  {retrato.partes.map((p) => (
                    <div key={p.temaId} className="rounded-lg border border-border bg-surface-2 p-3 text-[13.5px] leading-relaxed">
                      <span className="font-semibold">{p.titulo}.</span> {p.texto}
                      <div className="mt-1 font-os-mono text-[10.5px] text-muted">{p.fonte}</div>
                    </div>
                  ))}
                  {retrato.pendentes.length > 0 && <p className="text-[12px] text-warn">Ainda sem resposta: {retrato.pendentes.join(', ')}.</p>}
                  <div className="rounded-lg border border-brand/40 bg-brand/10 p-3">
                    <p className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-brand">A sua primeira pergunta</p>
                    {retrato.primeiraPergunta.pergunta && <p className="mt-1 font-medium">“{retrato.primeiraPergunta.pergunta}”</p>}
                    <p className="mt-1 text-[13px] text-muted">{retrato.primeiraPergunta.resposta}</p>
                  </div>
                </div>
              )}
            </div>
            {kickoff && <div className="mt-6"><Indice teia={estado.teia} cliente={estado.cliente} mapa={estado.mapa} notaAberta={notaAberta} aoAbrir={setNotaAberta} /></div>}
          </div>
          {kickoff && (
            <aside className="mt-6 lg:sticky lg:top-4 lg:mt-0">
              <Vault teia={estado.teia} aoClicar={abrirNo} notaAberta={notaAberta} aoFecharNota={() => setNotaAberta(null)} />
            </aside>
          )}
        </div>
      </Casca>
    );
  }

  const feitos = estado.progresso.confirmados + estado.progresso.respondidos;
  const pct = Math.round((feitos / Math.max(1, estado.progresso.total)) * 100);
  const faltando = estado.progresso.obrigatoriosFaltando;
  const temaDoTitulo = (titulo: string) => estado.itens.find((i) => i.titulo === titulo)?.temaId ?? null;

  const secoes: { chave: string; rotulo: string; titulo: string; ajuda: string; itens: ItemDoLink[] }[] = kickoff
    ? [
        {
          chave: 'decisoes',
          rotulo: 'Só você decide',
          titulo: decisoes.length === 1 ? 'A decisão desta estação' : 'As decisões desta estação',
          ajuda: `Vêm primeiro porque são elas que definem o que a gente constrói.${estado.audioDisponivel ? ' Pode escrever ou gravar um áudio.' : ''} Cada resposta vira uma nota no seu vault — a teia ao lado mostra onde ela se encaixa.`,
          itens: decisoes,
        },
        {
          chave: 'confirmacoes',
          rotulo: 'Da conversa',
          titulo: 'O que ouvimos de você',
          ajuda: `${jaConfirmados} de ${confirmacoes.length} confirmados. Cada trecho diz de onde veio — confirme, ou corrija com as suas palavras. Ao confirmar, a nota acende na teia.`,
          itens: confirmacoes,
        },
        {
          chave: 'extras',
          rotulo: 'Opcional',
          titulo: 'Se quiser acrescentar',
          ajuda: 'Pode deixar em branco: nada aqui trava o trabalho.',
          itens: extras,
        },
      ]
    : [
        {
          chave: 'triagem',
          rotulo: 'Antes da conversa',
          titulo: 'As cinco perguntas',
          ajuda: 'Uns 5 minutos. Com elas a gente chega na reunião falando da sua empresa.',
          itens: [...decisoes, ...confirmacoes, ...extras],
        },
      ];

  return (
    <Casca largura={kickoff ? 'max-w-[1040px]' : 'max-w-[640px]'}>
      <Marca rotulo={rotulo} />
      <div className={kickoff ? 'lg:grid lg:grid-cols-[minmax(0,640px)_minmax(300px,360px)] lg:items-start lg:gap-6' : ''}>
        <div className="min-w-0">
          <div className="sticky top-0 z-10 -mx-2 mb-4 rounded-xl border border-border bg-surface px-3 py-2">
            <div className="flex items-baseline justify-between gap-3 text-[12px]">
              <span className="truncate font-medium">{estado.cliente}</span>
              <span className="shrink-0 text-muted" aria-live="polite">
                {feitos} de {estado.progresso.total}
                {faltando.length ? ` · faltam ${faltando.length} obrigatória${faltando.length === 1 ? '' : 's'}` : ' · tudo respondido'}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${pct}%` }} /></div>
          </div>

          <MapaDoTrilho mapa={estado.mapa} />

          {kickoff && (
            <details className="mt-4 rounded-xl border border-border bg-surface lg:hidden">
              <summary className="cursor-pointer select-none p-3 text-[13px] font-semibold">
                A teia do seu vault <span className="font-os-mono text-[10px] font-normal uppercase tracking-[0.16em] text-muted">· {estado.teia.contagem.prontas} prontas · {estado.teia.contagem.daConversa} da conversa</span>
              </summary>
              <div className="border-t border-border p-3">
                <Vault teia={estado.teia} aoClicar={abrirNo} notaAberta={notaAberta} aoFecharNota={() => setNotaAberta(null)} semMoldura />
              </div>
            </details>
          )}

          <div className="mt-6">
            {secoes.filter((s) => s.itens.length > 0).map((s) => (
              <section key={s.chave} className="mb-7">
                <p className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-brand">{s.rotulo}</p>
                <h2 className="text-[17px] font-bold">{s.titulo}</h2>
                <p className="mb-2 text-[12px] text-muted">{s.ajuda}</p>
                <div className="space-y-3">
                  {s.itens.map((i) => (
                    <ItemCard
                      key={i.temaId}
                      i={i}
                      no={noDe.get(i.temaId) ?? null}
                      vizinhos={(noDe.get(i.temaId)?.ligacoes ?? []).map((id) => noDe.get(id)).filter((n): n is NoDaTeia => !!n && n.tipo !== 'indice')}
                      base={base}
                      nome={nome}
                      ocupado={ocupado}
                      erro={erroDe[`item-${i.temaId}`] || null}
                      audio={estado.audioDisponivel}
                      agir={agir}
                      onMudou={setEstado}
                      aoClicarVizinho={abrirNo}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>

          {kickoff && <Indice teia={estado.teia} cliente={estado.cliente} mapa={estado.mapa} notaAberta={notaAberta} aoAbrir={setNotaAberta} />}

          <div className="mb-8 space-y-3">
            {faltando.length > 0 && (
              <div className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-[12.5px]" role="status">
                <p className="font-semibold">Antes de fechar, {faltando.length === 1 ? 'falta uma obrigatória' : `faltam ${faltando.length} obrigatórias`}:</p>
                <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {faltando.map((titulo) => {
                    const id = temaDoTitulo(titulo);
                    return (
                      <li key={titulo}>
                        <button type="button" onClick={() => id && irParaTema(id)} className={`underline underline-offset-2 hover:text-brand ${FOCO}`}>{titulo}</button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {!fechando ? (
              <button type="button" disabled={faltando.length > 0} onClick={() => setFechando(true)} className={BOTAO_PRIMARIO}>
                {kickoff ? 'Concluir e ver o que o OS entendeu →' : 'Concluir'}
              </button>
            ) : (
              <div className="rounded-lg border border-brand/40 bg-brand/10 p-3">
                <p className="text-[13.5px] font-semibold">Isto fecha o link.</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted">Até aqui você pode editar qualquer resposta. Depois de fechar, ajustes vão pelo grupo com a Root.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={ocupado === 'concluir'}
                    aria-busy={ocupado === 'concluir'}
                    onClick={() => agir('concluir', () => apiPost<{ retrato: RetratoDoTrilho | null; mensagem: string }>(`${base}/concluir`, { nome })).then((r) => { if (r) { setRetrato(r.retrato); setMensagemFinal(r.mensagem); } })}
                    className={BOTAO_PRIMARIO}
                  >
                    {ocupado === 'concluir' ? 'fechando…' : kickoff ? 'Fechar e ver o retrato' : 'Fechar'}
                  </button>
                  <button type="button" onClick={() => setFechando(false)} className={BOTAO}>Ainda não</button>
                </div>
                {erroDe.concluir && <p role="alert" className="mt-2 text-[12.5px] text-bad">{erroDe.concluir}</p>}
              </div>
            )}
            <p className="text-center text-[11px] text-muted">Cada resposta é salva na hora e pode ser editada até você fechar. Pode sair e voltar: o link guarda de onde parou. Senha, token e dado bancário nunca entram por aqui.</p>
          </div>
        </div>

        {kickoff && (
          <aside className="hidden lg:sticky lg:top-4 lg:block">
            <Vault teia={estado.teia} aoClicar={abrirNo} notaAberta={notaAberta} aoFecharNota={() => setNotaAberta(null)} />
          </aside>
        )}
      </div>
    </Casca>
  );
}

// ---------------------------------------------------------------------------
// O MAPA — as seis estações, o ponto onde ele está e o que vem a seguir.
// ---------------------------------------------------------------------------

function MapaDoTrilho({ mapa, compacto = false }: { mapa: MapaDoCliente; compacto?: boolean }) {
  const atual = mapa.estacoes.find((e) => e.estado === 'aqui') ?? null;
  const seguinte = atual ? mapa.estacoes.find((e) => e.n === atual.n + 1) ?? null : null;

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-[13px] font-bold">{mapa.titulo}</h2>
        <span className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted">{mapa.subtitulo}</span>
      </div>

      <ol className="mt-3 grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-6">
        {mapa.estacoes.map((e) => (
          <li key={e.chave} className="min-w-0">
            <div className={`h-[3px] rounded-full ${e.estado === 'aqui' ? 'bg-brand' : e.estado === 'feita' ? 'bg-brand/40' : 'bg-surface-3'}`} />
            <div className="mt-1.5 flex items-baseline gap-1">
              <span className={`font-os-mono text-[10px] ${e.estado === 'adiante' ? 'text-dim' : 'text-brand'}`}>{e.estado === 'feita' ? '✓' : e.n}</span>
              <span className={`truncate text-[11.5px] font-semibold ${e.estado === 'adiante' ? 'text-dim' : ''}`}>{e.titulo}</span>
            </div>
            {e.quando && <div className="font-os-mono text-[10px] text-muted">{e.quando}</div>}
            {e.estado === 'aqui' && <div className="font-os-mono text-[9.5px] uppercase tracking-[0.12em] text-brand">você está aqui</div>}
          </li>
        ))}
      </ol>

      {atual && (
        <div className="mt-4 rounded-lg border border-brand/40 bg-brand/10 p-3">
          <p className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-brand">
            Estação {atual.n} · {atual.titulo}{atual.detalhe ? ` · ${atual.detalhe}` : ''}
          </p>
          <p className="mt-1 text-[13.5px] leading-relaxed">{atual.oQueE}</p>
        </div>
      )}
      {!compacto && seguinte && (
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          <span className="font-semibold">A seguir — estação {seguinte.n}, {seguinte.titulo.toLowerCase()}:</span> {seguinte.oQueE}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// O VAULT — a teia como no Obsidian: grafo e arquivos, crescendo a cada resposta.
// ---------------------------------------------------------------------------

const ICONE: Record<NoDaTeia['estado'], string> = { pronta: '●', rascunho: '◐', vazia: '○', conversa: '✎', indice: '◈' };
const ROTULO_DO_ESTADO: Record<NoDaTeia['estado'], string> = {
  pronta: 'pronta',
  rascunho: 'rascunho da conversa',
  vazia: 'em branco',
  conversa: 'da conversa',
  indice: 'índice',
};

function corDoNo(estado: NoDaTeia['estado']): { fill: string; stroke: string; dash?: string } {
  switch (estado) {
    case 'pronta':
      return { fill: 'rgb(var(--os-ac))', stroke: 'rgb(var(--os-ac))' };
    case 'rascunho':
      return { fill: 'rgb(var(--os-s1))', stroke: 'rgb(var(--os-ac))', dash: '2 2' };
    case 'conversa':
      return { fill: 'rgb(var(--os-cy))', stroke: 'rgb(var(--os-cy))' };
    case 'indice':
      return { fill: 'rgb(var(--os-tx))', stroke: 'rgb(var(--os-tx))' };
    default:
      return { fill: 'rgb(var(--os-s2))', stroke: 'rgb(var(--os-line-strong))' };
  }
}

function Vault({ teia, aoClicar, notaAberta, aoFecharNota, semMoldura = false }: { teia: TeiaDoCliente; aoClicar: (no: NoDaTeia) => void; notaAberta: string | null; aoFecharNota: () => void; semMoldura?: boolean }) {
  const [aba, setAba] = useState<'grafo' | 'arquivos'>('grafo');
  const nota = notaAberta ? teia.nos.find((n) => n.id === notaAberta) ?? null : null;
  const c = teia.contagem;

  return (
    <section className={semMoldura ? '' : 'rounded-xl border border-border bg-surface p-4'}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <div>
          <p className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-brand">O seu vault</p>
          <h2 className="font-os-mono text-[13px] font-bold">{teia.pasta}</h2>
        </div>
        <div className="flex gap-1 font-os-mono text-[10px] uppercase tracking-[0.12em]">
          <button type="button" onClick={() => setAba('grafo')} className={`rounded px-2 py-1 ${FOCO} ${aba === 'grafo' ? 'bg-brand/15 text-brand' : 'text-muted hover:text-text'}`}>grafo</button>
          <button type="button" onClick={() => setAba('arquivos')} className={`rounded px-2 py-1 ${FOCO} ${aba === 'arquivos' ? 'bg-brand/15 text-brand' : 'text-muted hover:text-text'}`}>arquivos</button>
        </div>
      </div>
      <p className="mt-1 font-os-mono text-[10px] text-muted">
        <span className="text-brand">●</span> {c.prontas} prontas · <span className="text-brand">◐</span> {c.rascunhos} da conversa a confirmar · <span className="text-info">✎</span> {c.daConversa} já escritas · ○ {c.vazias} em branco
      </p>

      {aba === 'grafo' ? <Grafo teia={teia} aoClicar={aoClicar} /> : <Arquivos teia={teia} aoClicar={aoClicar} />}

      {nota && (
        <div className="mt-3 rounded-lg border border-info/40 bg-info/10 p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-info">{ICONE[nota.estado]} {nota.pasta || 'vault'}{nota.minuto ? ` · ${nota.minuto}` : ''}</p>
            <button type="button" onClick={aoFecharNota} className="font-os-mono text-[10px] text-muted hover:text-text" aria-label="fechar nota">×</button>
          </div>
          <p className="mt-1 text-[13px] font-semibold">[[{nota.titulo}]]</p>
          {nota.corpo && <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{nota.corpo}</p>}
          {nota.ligacoes.length > 0 && (
            <p className="mt-2 font-os-mono text-[10px] text-muted">
              liga com: {nota.ligacoes.map((id) => teia.nos.find((n) => n.id === id)).filter((n): n is NoDaTeia => !!n && n.tipo !== 'indice').map((n) => `[[${n.titulo}]]`).join(' · ')}
            </p>
          )}
        </div>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-muted">Cada resposta sua vira uma nota aqui, com a origem. É o contexto que a IA passa a ler antes de qualquer proposta, dossiê ou post.</p>
    </section>
  );
}

function Grafo({ teia, aoClicar }: { teia: TeiaDoCliente; aoClicar: (no: NoDaTeia) => void }) {
  const [foco, setFoco] = useState<string | null>(null);
  const anteriores = useRef<Map<string, NoDaTeia['estado']>>(new Map());
  const [acesas, setAcesas] = useState<string[]>([]);

  // A nota que ACABOU de ficar pronta pisca uma vez — é o "acendeu" do Obsidian.
  useEffect(() => {
    const novas: string[] = [];
    for (const n of teia.nos) {
      const antes = anteriores.current.get(n.id);
      if (antes && antes !== 'pronta' && n.estado === 'pronta') novas.push(n.id);
      anteriores.current.set(n.id, n.estado);
    }
    if (novas.length) {
      setAcesas(novas);
      const t = setTimeout(() => setAcesas([]), 1400);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [teia]);

  const layout = useMemo(() => {
    const L = 320;
    const cx = L / 2;
    const cy = L / 2;
    const pos = new Map<string, { x: number; y: number }>();
    const temas = teia.nos.filter((n) => n.tipo === 'tema');
    const conversa = teia.nos.filter((n) => n.tipo === 'conversa');
    temas.forEach((n, i) => {
      const a = -Math.PI / 2 + (i / Math.max(1, temas.length)) * Math.PI * 2;
      pos.set(n.id, { x: cx + Math.cos(a) * 92, y: cy + Math.sin(a) * 92 });
    });
    conversa.forEach((n, i) => {
      const a = -Math.PI / 2 + ((i + 0.5) / Math.max(1, conversa.length)) * Math.PI * 2;
      pos.set(n.id, { x: cx + Math.cos(a) * 138, y: cy + Math.sin(a) * 138 });
    });
    pos.set('indice', { x: cx, y: cy });
    return { L, pos };
  }, [teia]);

  const vizinhos = useMemo(() => {
    if (!foco) return null;
    const s = new Set<string>([foco]);
    for (const a of teia.arestas) {
      if (a.de === foco) s.add(a.para);
      if (a.para === foco) s.add(a.de);
    }
    return s;
  }, [foco, teia]);

  const raio = (n: NoDaTeia) => (n.estado === 'indice' ? 7 : n.estado === 'pronta' ? 6 : n.estado === 'conversa' ? 5 : n.estado === 'rascunho' ? 5 : 3.5);
  const curto = (t: string) => (t.length > 18 ? `${t.slice(0, 17).trimEnd()}…` : t);

  return (
    <svg viewBox={`0 0 ${layout.L} ${layout.L}`} className="mt-2 w-full select-none" role="img" aria-label="A teia de notas do seu vault">
      {teia.arestas.map((a) => {
        const p = layout.pos.get(a.de);
        const q = layout.pos.get(a.para);
        if (!p || !q) return null;
        const de = teia.nos.find((n) => n.id === a.de);
        const para = teia.nos.find((n) => n.id === a.para);
        const viva = !!de && !!para && de.estado !== 'vazia' && para.estado !== 'vazia';
        const emFoco = vizinhos ? vizinhos.has(a.de) && vizinhos.has(a.para) : true;
        return (
          <line
            key={`${a.de}|${a.para}`}
            x1={p.x}
            y1={p.y}
            x2={q.x}
            y2={q.y}
            stroke={a.de === 'indice' || a.para === 'indice' ? 'rgb(var(--os-ac))' : 'rgb(var(--os-line-strong))'}
            strokeWidth={emFoco && vizinhos ? 1.4 : 0.8}
            style={{ opacity: vizinhos ? (emFoco ? 0.9 : 0.08) : viva ? 0.5 : 0.18, transition: 'opacity .3s, stroke-width .3s' }}
          />
        );
      })}
      {teia.nos.map((n) => {
        const p = layout.pos.get(n.id);
        if (!p) return null;
        const cor = corDoNo(n.estado);
        const r = raio(n);
        const apagado = vizinhos ? !vizinhos.has(n.id) : false;
        const dx = p.x - layout.L / 2;
        const anchor = n.tipo === 'indice' ? 'middle' : dx > 12 ? 'start' : dx < -12 ? 'end' : 'middle';
        const lx = n.tipo === 'indice' ? p.x : p.x + (dx > 12 ? r + 3 : dx < -12 ? -(r + 3) : 0);
        const ly = n.tipo === 'indice' ? p.y + r + 9 : dx > 12 || dx < -12 ? p.y + 3 : p.y < layout.L / 2 ? p.y - r - 4 : p.y + r + 9;
        return (
          <g
            key={n.id}
            onMouseEnter={() => setFoco(n.id)}
            onMouseLeave={() => setFoco(null)}
            onClick={() => aoClicar(n)}
            className="cursor-pointer"
            style={{ opacity: apagado ? 0.25 : 1, transition: 'opacity .3s' }}
          >
            {acesas.includes(n.id) && (
              <circle cx={p.x} cy={p.y} r={r} fill="none" stroke="rgb(var(--os-ac))" strokeWidth={2} className="animate-ping" style={{ transformOrigin: `${p.x}px ${p.y}px` }} />
            )}
            <circle cx={p.x} cy={p.y} r={r} fill={cor.fill} stroke={cor.stroke} strokeWidth={1.2} strokeDasharray={cor.dash} style={{ transition: 'r .3s, fill .3s' }} />
            <text x={lx} y={ly} textAnchor={anchor} fontSize={7.5} fill={n.estado === 'vazia' ? 'rgb(var(--os-tx3))' : 'rgb(var(--os-tx2))'} fontFamily="var(--os-mono)">
              {curto(n.titulo)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Arquivos({ teia, aoClicar }: { teia: TeiaDoCliente; aoClicar: (no: NoDaTeia) => void }) {
  const pastas = useMemo(() => {
    const ordem = ['Casa', 'Intenção', 'Operação', 'Triagem', 'Da conversa'];
    const por = new Map<string, NoDaTeia[]>();
    for (const n of teia.nos) {
      if (n.tipo === 'indice') continue;
      const lista = por.get(n.pasta) ?? [];
      lista.push(n);
      por.set(n.pasta, lista);
    }
    return ordem.filter((p) => por.has(p)).map((p) => ({ pasta: p, nos: por.get(p)! }));
  }, [teia]);
  const indice = teia.nos.find((n) => n.tipo === 'indice');

  return (
    <div className="mt-2 font-os-mono text-[11px] leading-[1.7]">
      <div className="text-text">{teia.pasta}</div>
      {pastas.map((p, pi) => (
        <div key={p.pasta}>
          <div className="text-muted">{pi === pastas.length - 1 && !indice ? '└─' : '├─'} {p.pasta}/</div>
          {p.nos.map((n, i) => (
            <button
              key={n.id}
              type="button"
              onClick={() => aoClicar(n)}
              className={`block w-full truncate text-left hover:text-brand ${n.estado === 'vazia' ? 'text-dim' : n.estado === 'conversa' ? 'text-info' : n.estado === 'pronta' ? 'text-brand' : 'text-text'}`}
              title={`${n.titulo} · ${ROTULO_DO_ESTADO[n.estado]}`}
            >
              <span className="text-muted">│  {i === p.nos.length - 1 ? '└─' : '├─'}</span> {ICONE[n.estado]} {n.titulo}.md{n.minuto ? <span className="text-muted"> · {n.minuto}</span> : null}
            </button>
          ))}
        </div>
      ))}
      {indice && (
        <button type="button" onClick={() => aoClicar(indice)} className="block w-full text-left text-text hover:text-brand">
          <span className="text-muted">└─</span> {ICONE.indice} Índice.md
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// O ÍNDICE — a nota-mapa do vault (o MOC): o que existe, de onde veio, o que falta.
// ---------------------------------------------------------------------------

function Indice({ teia, cliente, mapa, notaAberta, aoAbrir }: { teia: TeiaDoCliente; cliente: string; mapa: MapaDoCliente; notaAberta: string | null; aoAbrir: (id: string | null) => void }) {
  const estacao = mapa.estacoes.find((e) => e.chave === 'memoria');
  const temas = teia.nos.filter((n) => n.tipo === 'tema');
  const conversa = teia.nos.filter((n) => n.tipo === 'conversa');
  const prontas = temas.filter((n) => n.estado === 'pronta');
  const rascunhos = temas.filter((n) => n.estado === 'rascunho');
  const vazias = temas.filter((n) => n.estado === 'vazia');
  const nomeDe = (id: string) => teia.nos.find((n) => n.id === id)?.titulo ?? id;

  return (
    <section id="indice" className="mb-8 rounded-xl border border-border bg-surface p-4">
      <p className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-brand">
        {estacao ? `Estação ${estacao.n} · o índice do seu vault` : 'O índice do seu vault'}
      </p>
      <h2 className="mt-1 text-[16px] font-bold">Índice — {cliente}</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        É o pontapé inicial do trabalho. Esta é a nota-mapa do seu vault: o que já existe, de onde veio e o que ainda
        falta. Tudo o que você confirmar aqui vira nota sua, com a origem de cada frase — é o contexto que a IA passa a ler antes de
        qualquer proposta, dossiê ou post.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-info">✎ Já escritas da conversa · {conversa.length}</p>
          <ul className="mt-1 space-y-1 text-[12.5px]">
            {conversa.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => aoAbrir(notaAberta === n.id ? null : n.id)} className="text-left hover:underline">
                  <span className="text-brand">[[{n.titulo}]]</span>{n.minuto && <span className="font-os-mono text-[10px] text-muted"> · {n.minuto}</span>}
                </button>
                {notaAberta === n.id && n.corpo && <p className="mt-1 rounded-lg border border-border bg-surface-2 p-2 text-[12px] leading-relaxed text-muted">{n.corpo}</p>}
              </li>
            ))}
            {conversa.length === 0 && <li className="text-muted">Nenhuma ainda — a leitura da conversa escreve as primeiras.</li>}
          </ul>
        </div>
        <div>
          <p className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-brand">● Prontas · {prontas.length}</p>
          <ul className="mt-1 space-y-1 text-[12.5px]">
            {prontas.map((n) => (
              <li key={n.id}>
                <span className="text-brand">[[{n.titulo}]]</span>
                {n.ligacoes.filter((id) => id !== 'indice').length > 0 && (
                  <span className="font-os-mono text-[10px] text-muted"> → {n.ligacoes.filter((id) => id !== 'indice').slice(0, 3).map(nomeDe).join(' · ')}</span>
                )}
              </li>
            ))}
            {prontas.length === 0 && <li className="text-muted">Nenhuma ainda — a primeira confirmação acende a primeira.</li>}
          </ul>
          {rascunhos.length > 0 && (
            <>
              <p className="mt-3 font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted">◐ Esperando o seu OK · {rascunhos.length}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">{rascunhos.map((n) => `[[${n.titulo}]]`).join(' · ')}</p>
            </>
          )}
          {vazias.length > 0 && (
            <>
              <p className="mt-3 font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted">○ Em branco · {vazias.length}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-dim">{vazias.map((n) => `[[${n.titulo}]]`).join(' · ')}</p>
            </>
          )}
        </div>
      </div>

      {(mapa.promessa.fontes || mapa.promessa.primeiraPergunta) && (
        <div className="mt-4 space-y-1 border-t border-border pt-3 text-[12.5px] leading-relaxed">
          {mapa.promessa.fontes && (
            <p><span className="font-semibold">As suas fontes entram antes:</span> <span className="text-muted">{mapa.promessa.fontes}</span></p>
          )}
          {mapa.promessa.primeiraPergunta && (
            <p><span className="font-semibold">E a primeira pergunta que o seu dado responde:</span> <span className="text-muted">“{mapa.promessa.primeiraPergunta}”</span></p>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

type Agir = <T>(chave: string, fn: () => Promise<T>) => Promise<T | undefined>;

/*
 * O CARTÃO DE UM TEMA. Três modos vindos da API — confirmar (há proposta),
 * responder (em branco), feito — e, no feito, EDITAR: até o botão final tudo
 * se refaz. Quem confirmou corrige (a procedência da reunião fica); quem
 * corrigiu pode voltar ao que ouvimos; quem respondeu livre responde de novo,
 * por texto ou áudio. Cada gravação mostra "salvo às", com a hora que veio do
 * banco — é a prova, na tela, de que chegou. O erro fica aqui, ao lado.
 */
function ItemCard({ i, no, vizinhos, base, nome, ocupado, erro, audio, agir, onMudou, aoClicarVizinho }: { i: ItemDoLink; no: NoDaTeia | null; vizinhos: NoDaTeia[]; base: string; nome: string; ocupado: string | null; erro: string | null; audio: boolean; agir: Agir; onMudou: (e: EstadoDoLink) => void; aoClicarVizinho: (no: NoDaTeia) => void }) {
  const [corrigindo, setCorrigindo] = useState(false);
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState('');
  const [gravando, setGravando] = useState(false);
  const gravador = useRef<MediaRecorder | null>(null);
  const pedacos = useRef<Blob[]>([]);
  const rota = `${base}/itens/${i.temaId}`;
  const chave = `item-${i.temaId}`;
  const salvando = ocupado === chave;
  const idDoErro = `${chave}-erro`;

  // Quem confirmou ou corrigiu tem a proposta por baixo: editar é corrigir. Quem respondeu livre responde de novo.
  const editarEhCorrigir = i.status === 'confirmado' || i.status === 'corrigido';

  const confirmar = () => agir(chave, () => apiPost<EstadoDoLink>(`${rota}/confirmar`, { nome })).then((e) => { if (e) { onMudou(e); setEditando(false); } });
  const corrigir = (t: string) => agir(chave, () => apiPost<EstadoDoLink>(`${rota}/corrigir`, { texto: t, nome })).then((e) => { if (e) { onMudou(e); setCorrigindo(false); setEditando(false); setTexto(''); } });
  const responder = (t: string) => agir(chave, () => apiPost<EstadoDoLink>(`${rota}/responder`, { texto: t, nome })).then((e) => { if (e) { onMudou(e); setEditando(false); setTexto(''); } });
  const salvarEdicao = () => (editarEhCorrigir ? corrigir(texto) : responder(texto));

  async function alternarGravacao() {
    if (gravando) {
      gravador.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      pedacos.current = [];
      rec.ondataavailable = (ev) => { if (ev.data.size) pedacos.current.push(ev.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setGravando(false);
        const tipo = rec.mimeType || 'audio/webm';
        const blob = new Blob(pedacos.current, { type: tipo });
        if (blob.size < 1000) return;
        const arquivo = new File([blob], `resposta.${tipo.includes('mp4') ? 'm4a' : 'webm'}`, { type: tipo });
        const r = await agir(chave, () => apiUpload<{ texto: string; estado: EstadoDoLink }>(`${rota}/audio?nome=${encodeURIComponent(nome)}`, arquivo));
        if (r) {
          onMudou(r.estado);
          setEditando(false);
        }
      };
      gravador.current = rec;
      rec.start();
      setGravando(true);
    } catch {
      setGravando(false);
    }
  }

  const rodape = i.fonte ? <div className="font-os-mono text-[10.5px] text-muted">{i.fonte}</div> : null;
  const erroInline = erro ? <p id={idDoErro} role="alert" className="mt-2 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-[12.5px] text-bad">{erro}</p> : null;

  const areaDeTexto = (placeholder: string, linhas: number) => (
    <textarea
      className={INPUT}
      rows={linhas}
      placeholder={placeholder}
      value={texto}
      onChange={(e) => setTexto(e.target.value)}
      aria-invalid={!!erro}
      aria-describedby={erro ? idDoErro : undefined}
      autoFocus
    />
  );
  // O áudio só aparece quando a API diz que está ligado (transcrição configurada E com crédito).
  const botaoDeAudio = audio ? (
    <button type="button" className={gravando ? BOTAO_GRAVANDO : BOTAO} disabled={salvando && !gravando} onClick={alternarGravacao} aria-label={gravando ? 'Parar gravação' : 'Gravar áudio'} aria-busy={salvando && !gravando}>
      {gravando ? '■ Gravando… toque para parar' : salvando ? 'transcrevendo…' : '● Prefere falar? Gravar áudio'}
    </button>
  ) : null;

  return (
    <div id={`tema-${i.temaId}`} className={`scroll-mt-28 rounded-xl border p-4 transition-colors ${i.modo === 'feito' ? 'border-brand/40' : 'border-border'} bg-surface`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{i.titulo}</div>
        <div className="font-os-mono text-[10px] text-muted">{i.obrigatorio ? 'obrigatório' : 'opcional'}</div>
      </div>

      {/* A nota que esta resposta é no vault dele, e com o que ela se liga — como no Obsidian. */}
      {no && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-os-mono text-[10.5px]">
          <span className={no.estado === 'pronta' ? 'text-brand' : no.estado === 'rascunho' ? 'text-brand/80' : 'text-dim'} title={ROTULO_DO_ESTADO[no.estado]}>
            {ICONE[no.estado]} [[{no.titulo}]]
          </span>
          {vizinhos.length > 0 && (
            <span className="text-muted">
              liga com{' '}
              {vizinhos.slice(0, 3).map((v, k) => (
                <span key={v.id}>
                  {k > 0 && ' · '}
                  <button type="button" onClick={() => aoClicarVizinho(v)} className={`hover:underline ${FOCO} ${v.estado === 'conversa' ? 'text-info' : v.estado === 'pronta' ? 'text-brand' : 'text-muted'}`}>[[{v.titulo}]]</button>
                </span>
              ))}
            </span>
          )}
        </div>
      )}

      {i.modo === 'feito' && !editando && (
        <div className="mt-2">
          <p className="text-[14px] leading-relaxed">{i.textoFinal}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-brand">
            <span>✓ {i.status === 'confirmado' ? 'Confirmado' : i.status === 'corrigido' ? 'Corrigido' : i.respondidoVia === 'audio' ? 'Respondido por áudio' : 'Respondido'}</span>
            {i.respondidoEm && <span className="font-os-mono text-[10.5px] text-muted">salvo {dataHora(i.respondidoEm)}</span>}
          </div>
          {rodape}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={BOTAO} disabled={salvando} onClick={() => { setTexto(i.textoFinal ?? ''); setEditando(true); }}>Editar resposta</button>
            {i.status === 'corrigido' && (
              <button type="button" className={BOTAO} disabled={salvando} aria-busy={salvando} onClick={confirmar}>{salvando ? 'salvando…' : 'Voltar ao que ouvimos'}</button>
            )}
          </div>
          {erroInline}
        </div>
      )}

      {i.modo === 'feito' && editando && (
        <div className="mt-2">
          <p className="text-[12px] leading-snug text-muted">{i.pergunta}</p>
          <div className="mt-2 space-y-2">
            {areaDeTexto('Escreva a resposta como quer que fique.', 4)}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={BOTAO_PRIMARIO} disabled={!texto.trim() || salvando} aria-busy={salvando} onClick={salvarEdicao}>{salvando ? 'salvando…' : 'Salvar'}</button>
              {botaoDeAudio}
              <button type="button" className={BOTAO} disabled={salvando} onClick={() => { setEditando(false); setTexto(''); }}>Cancelar</button>
            </div>
            {editarEhCorrigir && <p className="text-[11px] text-muted">Salvar substitui o texto e mantém a origem (a reunião e o minuto).{audio ? ' Gravar áudio vira resposta sua, sem a origem.' : ''}</p>}
          </div>
          {erroInline}
        </div>
      )}

      {i.modo === 'confirmar' && (
        <div className="mt-2">
          {/* A pergunta que foi feita na conversa, para ele conferir a resposta contra ela. */}
          <p className="text-[12px] leading-snug text-muted">{i.pergunta}</p>
          <p className="mt-1.5 text-[14px] leading-relaxed">{i.interpretado ? 'Entendemos que: ' : ''}{i.proposta}</p>
          {rodape}
          {corrigindo ? (
            <div className="mt-2 space-y-2">
              {areaDeTexto('Escreva só a correção.', 3)}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={BOTAO_PRIMARIO} disabled={!texto.trim() || salvando} aria-busy={salvando} onClick={() => corrigir(texto)}>{salvando ? 'salvando…' : 'Salvar correção'}</button>
                <button type="button" className={BOTAO} disabled={salvando} onClick={() => { setCorrigindo(false); setTexto(''); }}>Cancelar</button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={BOTAO_PRIMARIO} disabled={salvando} aria-busy={salvando} onClick={confirmar}>{salvando ? 'salvando…' : 'Confirmar'}</button>
              <button type="button" className={BOTAO} disabled={salvando} onClick={() => { setTexto(i.proposta ?? ''); setCorrigindo(true); }}>Corrigir</button>
            </div>
          )}
          {erroInline}
        </div>
      )}

      {i.modo === 'responder' && (
        <div className="mt-2">
          <p className="text-[15px] font-medium leading-snug">{i.pergunta}</p>
          <p className="mt-1 text-[12px] text-muted">{i.aprofundar}</p>
          {i.formato === 'escolha' && i.opcoes ? (
            <div className="mt-3 grid gap-2">
              {i.opcoes.map((o) => (
                <button key={o} type="button" disabled={salvando} onClick={() => responder(o)} className={`rounded-lg border border-border bg-surface-2 px-3 py-3 text-left text-[14px] hover:border-brand ${FOCO}`}>{o}</button>
              ))}
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <textarea
                className={INPUT}
                rows={4}
                placeholder="Escreva aqui…"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                aria-invalid={!!erro}
                aria-describedby={erro ? idDoErro : undefined}
              />
              <div className="flex flex-wrap gap-2">
                <button type="button" className={BOTAO_PRIMARIO} disabled={!texto.trim() || salvando} aria-busy={salvando} onClick={() => responder(texto)}>{salvando ? 'salvando…' : 'Enviar'}</button>
                {botaoDeAudio}
              </div>
            </div>
          )}
          {erroInline}
        </div>
      )}
    </div>
  );
}

/* Foco visível em tudo que se clica (teclado e leitor de tela): nunca sumir sem substituto. */
const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';
const INPUT = `w-full rounded-lg border border-border bg-bg px-3 py-2 text-[14px] outline-none focus:border-brand ${FOCO}`;
const BOTAO_PRIMARIO = `w-full rounded-lg bg-brand px-4 py-3 text-[14px] font-semibold text-ink transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto ${FOCO}`;
const BOTAO = `rounded-lg border border-border px-4 py-3 text-[14px] transition hover:border-brand disabled:opacity-50 ${FOCO}`;
const BOTAO_GRAVANDO = `rounded-lg border border-bad bg-bad/10 px-4 py-3 text-[14px] text-bad ${FOCO}`;

const dataCurta = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';
const dataHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

function Casca({ children, largura = 'max-w-sm' }: { children: React.ReactNode; largura?: string }) {
  return (
    <div data-os-app className="grid min-h-screen place-items-start justify-center bg-bg p-4">
      <div className={`w-full ${largura} py-6`}>{children}</div>
    </div>
  );
}

function Marca({ rotulo = 'onboarding' }: { rotulo?: string }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <span aria-hidden className="grid h-10 w-10 place-items-center rounded-root border border-brand/30 bg-brand/10 text-[20px] font-extrabold italic leading-none tracking-[-0.05em] text-brand" style={{ transform: 'skewX(-10deg)', textShadow: 'var(--os-logo-shadow, none)' }}>R</span>
      <div className="font-os-mono">
        <div className="text-[14px] font-bold tracking-[-0.02em]">ROOT</div>
        <div className="text-[10px] uppercase tracking-[0.16em] text-muted">{rotulo}</div>
      </div>
    </div>
  );
}
