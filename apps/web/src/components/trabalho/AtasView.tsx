'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ATA_MAX_CARACTERES, ATA_MIN_CARACTERES, DICA_DO_NOME_DA_TAREFA } from '@mktos/shared';
import type {
  TrabAtaDetalhe, TrabAtaGeracao, TrabAtaLista, TrabAtaResumo, TrabAtaSugestaoDto, TrabEstrutura,
} from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
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
 */

const ALVO = 'max-md:min-h-[44px]';
const INP = `w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none focus:border-brand-dim disabled:opacity-60 ${ALVO}`;
const BTN = `rounded-lg border border-border bg-surface px-3 py-1.5 text-sm hover:border-brand-dim disabled:opacity-50 ${ALVO}`;
const BTN_PRIMARIO = `rounded-lg bg-brand/15 px-3 py-1.5 text-sm text-text outline outline-1 outline-brand-dim hover:bg-brand/25 disabled:opacity-50 ${ALVO}`;

const dataBR = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : null);

function ataDoEndereco(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('ata');
}

function escreverAtaNoEndereco(ref: string | null) {
  const u = new URL(window.location.href);
  if (ref) u.searchParams.set('ata', ref);
  else u.searchParams.delete('ata');
  window.history.replaceState({}, '', `${u.pathname}${u.search}`);
}

export function AtasView() {
  const { token, ready, can } = useAuth();
  const podeVer = can('tarefas.ver');
  const podeEditar = can('tarefas.editar');
  // Colar escreve nota da memória: pede o mesmo que o POST /memoria (PA-2).
  const podeColar = podeEditar && can('obsidian.editar');
  const botaoColar = useRef<HTMLButtonElement>(null);

  const [lista, setLista] = useState<TrabAtaLista | null>(null);
  const [aberta, setAberta] = useState<TrabAtaDetalhe | null>(null);
  const [refAberta, setRefAberta] = useState<string | null>(null);
  const [estrutura, setEstrutura] = useState<TrabEstrutura | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [lendo, setLendo] = useState(false);
  const [decidindo, setDecidindo] = useState<string | null>(null);
  const [listaEscolhida, setListaEscolhida] = useState<Record<string, string>>({});
  const [ajustes, setAjustes] = useState<Record<string, Ajuste>>({});
  const [pessoas, setPessoas] = useState<{ id: string; nome: string }[]>([]);
  const [colando, setColando] = useState(false);

  const fecharColar = useCallback(() => {
    setColando(false);
    // O foco volta ao botão que abriu o formulário (o formulário some do DOM).
    window.setTimeout(() => botaoColar.current?.focus(), 0);
  }, []);

  const carregarLista = useCallback(() => {
    if (!token || !podeVer) return;
    apiGet<TrabAtaLista>('/trabalho/atas', token)
      .then((l) => {
        setLista(l);
        setRefAberta((atual) => atual ?? ataDoEndereco() ?? l.atas[0]?.id ?? null);
      })
      .catch((e) => setErro(e.message));
  }, [token, podeVer]);

  useEffect(() => { carregarLista(); }, [carregarLista]);

  useEffect(() => {
    if (!token || !podeEditar) return;
    apiGet<TrabEstrutura>('/trabalho/estrutura', token).then(setEstrutura).catch(() => setEstrutura(null));
    // T5: o responsável sai dos perfis reais da empresa, não de texto livre.
    apiGet<{ id: string; nome: string }[]>('/trabalho/pessoas', token).then((r) => setPessoas(Array.isArray(r) ? r : [])).catch(() => setPessoas([]));
  }, [token, podeEditar]);

  const abrir = useCallback((ref: string) => {
    if (!token) return;
    setRefAberta(ref);
    escreverAtaNoEndereco(ref);
    apiGet<TrabAtaDetalhe>(`/trabalho/atas/${encodeURIComponent(ref)}`, token)
      .then((a) => { setAberta(a); setErro(null); })
      .catch((e) => setErro(e.message));
  }, [token]);

  useEffect(() => {
    if (refAberta && (!aberta || aberta.id !== refAberta)) abrir(refAberta);
    // abrir só quando a ata pedida muda
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refAberta]);


  const gerar = () => {
    if (!aberta || !token) return;
    setLendo(true);
    setErro(null);
    apiPost<TrabAtaGeracao>(`/trabalho/atas/${encodeURIComponent(aberta.id)}/sugestoes`, {}, token)
      .then((g) => {
        setAvisos([
          g.criadas.length
            ? `${g.criadas.length} ${g.criadas.length === 1 ? 'sugestão nova' : 'sugestões novas'} em rascunho.`
            : 'Nenhuma sugestão nova nesta leitura.',
          ...(g.repetidas ? [`${g.repetidas} já tinha${g.repetidas === 1 ? '' : 'm'} sido sugerida${g.repetidas === 1 ? '' : 's'} antes.`] : []),
          ...g.avisos,
        ]);
        abrir(aberta.id);
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
      .then(() => { abrir(aberta.id); carregarLista(); })
      .catch((e) => setErro(e.message))
      .finally(() => setDecidindo(null));
  };

  if (!ready) return <p className="text-muted">Carregando…</p>;
  if (!token || !podeVer) return <p className="text-muted">Sem permissão para ver as atas.</p>;

  const rascunhos = aberta?.sugestoesDaAta.filter((s) => s.estado === 'rascunho') ?? [];
  const decididas = aberta?.sugestoesDaAta.filter((s) => s.estado !== 'rascunho') ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">Atas</h1>
          <p className="text-sm text-muted">
            As reuniões da operação e as tarefas que elas combinaram. Toda sugestão é rascunho até alguém aceitar.
          </p>
        </div>
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
      {podeEditar && !podeColar && (
        <p className="text-[12px] text-muted">
          Colar ata grava uma nota na memória da empresa, e isso pede também a permissão de editar a memória (obsidian.editar), que o seu perfil não tem.
        </p>
      )}

      {erro && <p role="alert" className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm break-words">{erro}</p>}

      {colando && podeColar && (
        <ColarAta
          token={token}
          onFechar={fecharColar}
          onSalva={(a) => {
            fecharColar();
            setAberta(a);
            setRefAberta(a.id);
            escreverAtaNoEndereco(a.id);
            carregarLista();
          }}
          onErro={setErro}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
        <section aria-label="Atas da operação" className="min-w-0 space-y-2">
          {lista && (
            <p className="px-1 text-[12px] text-muted break-words">
              {lista.vaultVisivel === false
                ? `As atas do vault (a pasta ${lista.pasta}) pedem a permissão de ler o vault (obsidian.ver), que o seu perfil não tem: aparecem só as atas coladas aqui.`
                : lista.notasDoVault > 0
                  ? `Do vault, a pasta ${lista.pasta}; e as coladas aqui.`
                  : `Nenhuma nota do vault indexada nesta empresa: aparecem só as atas coladas aqui (a pasta ${lista.pasta} entra quando o vault for indexado).`}
            </p>
          )}
          <ul data-testid="atas-lista" className="space-y-1.5">
            {lista?.atas.map((a) => (
              <li key={a.id}>
                <ItemDaAta ata={a} ativa={a.id === refAberta} onAbrir={() => { setAvisos([]); abrir(a.id); }} />
              </li>
            ))}
          </ul>
          {lista && lista.atas.length === 0 && (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted">
              Nenhuma ata ainda. {podeColar ? 'Cole a primeira em "Colar ata".' : 'Quem edita o Trabalho e a memória pode colar a primeira.'}
            </p>
          )}
          {!lista && !erro && <p className="text-sm text-muted">Carregando…</p>}
        </section>

        <section aria-label="Ata aberta" className="min-w-0 space-y-4">
          {!aberta && lista && lista.atas.length > 0 && <p className="text-sm text-muted">Escolha uma ata à esquerda.</p>}
          {aberta && (
            <>
              <header className="space-y-1 rounded-lg border border-border bg-surface p-3">
                <h2 className="text-lg font-semibold break-words">{aberta.titulo}</h2>
                <p className="text-[12px] text-muted break-words">
                  {[dataBR(aberta.data) ?? 'sem data', aberta.participantes.length ? aberta.participantes.join(', ') : 'participantes não informados', aberta.procedencia].join(' · ')}
                </p>
              </header>

              <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Sugestões de tarefa</h3>
                  {podeEditar && (
                    <button
                      type="button"
                      data-testid={`ata-gerar-${aberta.id}`}
                      className={BTN_PRIMARIO}
                      disabled={lendo || lista?.iaConfigurada === false}
                      onClick={gerar}
                      title={lista?.iaConfigurada === false ? 'A IA não está configurada nesta instalação.' : 'O agente lê a ata e propõe tarefas em rascunho.'}
                    >
                      {lendo ? 'Lendo a ata…' : 'Sugerir tarefas'}
                    </button>
                  )}
                </div>
                {avisos.length > 0 && (
                  <ul aria-label="O que a leitura disse" className="space-y-0.5 rounded-lg bg-surface-2 px-3 py-2 text-[12px] text-muted">
                    {avisos.map((a, i) => <li key={i} className="break-words">{a}</li>)}
                  </ul>
                )}
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

              <article aria-label="A ata inteira" className="rounded-lg border border-border bg-surface p-3">
                <RoteiroMarkdown texto={aberta.texto} />
              </article>
            </>
          )}
        </section>
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
  const { rascunho, aceitas } = ata.sugestoes;
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
        <span className="rounded bg-surface-2 px-1.5 py-0.5">{ata.fonte === 'vault' ? 'vault' : 'colada'}</span>
        {rascunho > 0 && <span className="rounded bg-brand/10 px-1.5 py-0.5 text-brand">{rascunho} para decidir</span>}
        {aceitas > 0 && <span className="rounded bg-surface-2 px-1.5 py-0.5">{aceitas} {aceitas === 1 ? 'virou tarefa' : 'viraram tarefas'}</span>}
      </span>
    </button>
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
