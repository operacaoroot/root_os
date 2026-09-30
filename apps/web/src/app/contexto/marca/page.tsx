'use client';

import { useEffect, useRef, useState } from 'react';
import {
  PAUTA_SECOES_DA_MARCA,
  PAUTA_TETO_DE_PILARES,
  PAUTA_TETO_DO_PERFIL_DA_MARCA,
  type PautaMarcaPainel,
  type PautaMarcaDestino,
  type PautaMarcaPrevia,
  type PautaMarcaAplicarInput,
} from '@mktos/shared';
import { useAuth } from '@/lib/auth';
import { apiGet, apiPost, apiPut } from '@/lib/api';

/*
 * MK1 na tela. A marca e os pilares são o que a casa é e sobre o que fala; a
 * voz (aba Voz da Pauta) é como ela fala. Esta página mostra, no fim, o BLOCO
 * que os prompts da pauta recebem agora — é a prova visível de que existe um
 * ponto único e de que o que está escrito aqui chegou lá.
 *
 * Fica sob `/contexto` porque marca é contexto da empresa, e não uma tela do
 * bloco de marketing: quem escreve precisa dela à mão. A aba de verdade dentro
 * do Contexto entra na MK7, com a reorganização do menu.
 */

const MODELO = PAUTA_SECOES_DA_MARCA.map((s) => `## ${s}\n`).join('\n');

const EXEMPLO_DE_PILARES = [
  '// um pilar por linha: Nome | cor | descrição',
  '// a cor é opcional; sem ela, entra a da paleta da marca',
  'Bastidores | #9bdb1f | como a Root trabalha por dentro',
  'Números | #ff1f6b | o que deu certo e quanto custou',
].join('\n');

const areaCls =
  'w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-os-mono text-sm outline-none focus:border-brand-dim disabled:opacity-50';

export default function MarcaPage() {
  const { token, ready, can } = useAuth();
  const editavel = can('pauta.editar');
  const podeLerFonte = can('pauta.ver') && can('obsidian.ver');
  const podeAplicar = editavel && can('obsidian.ver');
  const identidade = `${token ?? ''}:${podeLerFonte}:${podeAplicar}`;
  const sessao = useRef(identidade);
  sessao.current = identidade;
  const [identidadeDoEstado, setIdentidadeDoEstado] = useState(identidade);
  const revisaoPrevia = useRef<Record<PautaMarcaDestino, number>>({ perfil: 0, pilares: 0 });
  const revisaoPainel = useRef(0);
  const escritaEmCurso = useRef<symbol | null>(null);
  const [painel, setPainel] = useState<PautaMarcaPainel | null>(null);
  const [perfil, setPerfil] = useState('');
  const [pilares, setPilares] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<'perfil' | 'pilares' | null>(null);
  const [previas, setPrevias] = useState<Record<PautaMarcaDestino, PautaMarcaPrevia | null>>({ perfil: null, pilares: null });
  const [textos, setTextos] = useState<Record<PautaMarcaDestino, string>>({ perfil: '', pilares: '' });
  const [aplicando, setAplicando] = useState<PautaMarcaDestino | null>(null);

  useEffect(() => {
    let cancelada = false;
    const leitura = ++revisaoPainel.current;
    escritaEmCurso.current = null;
    setPainel(null);
    setPerfil('');
    setPilares('');
    setPrevias({ perfil: null, pilares: null });
    setTextos({ perfil: '', pilares: '' });
    setErro(null);
    setSalvando(null);
    setAplicando(null);
    revisaoPrevia.current.perfil++;
    revisaoPrevia.current.pilares++;
    setIdentidadeDoEstado(identidade);
    if (!ready || !token) return;
    apiGet<PautaMarcaPainel>('/pauta/marca', token)
      .then((p) => {
        if (cancelada || sessao.current !== identidade || revisaoPainel.current !== leitura) return;
        setPainel(p);
        setPerfil(p.perfil ?? '');
        setPilares(p.pilaresTexto);
      })
      .catch((e: Error) => { if (!cancelada && sessao.current === identidade) setErro(e.message); });
    return () => { cancelada = true; };
  }, [ready, token, podeLerFonte, podeAplicar, identidade]);

  async function carregarPrevia(qual: PautaMarcaDestino) {
    if (!podeLerFonte || !token) return;
    const sequencia = ++revisaoPrevia.current[qual];
    setErro(null);
    try {
      const p = await apiGet<PautaMarcaPrevia>(`/pauta/marca/projecao/${qual}`, token);
      if (sessao.current !== identidade || revisaoPrevia.current[qual] !== sequencia) return;
      setPrevias((v) => ({ ...v, [qual]: p }));
      setTextos((v) => ({ ...v, [qual]: p.textoProposto }));
    } catch (e) {
      if (sessao.current === identidade && revisaoPrevia.current[qual] === sequencia) setErro((e as Error).message);
    }
  }

  async function aplicar(qual: PautaMarcaDestino) {
    const p = previas[qual];
    if (!podeAplicar || !painel || !p || !token || escritaEmCurso.current ||
        !p.fonteContextItemId || !p.fonteVersao || !p.fonteHash || !p.secoesUsadas.length) return;
    const escrita = Symbol('aplicar');
    escritaEmCurso.current = escrita;
    ++revisaoPainel.current;
    setAplicando(qual);
    setErro(null);
    const corpo: PautaMarcaAplicarInput = {
      fonteContextItemId: p.fonteContextItemId, fonteVersao: p.fonteVersao, fonteHash: p.fonteHash,
      destinoContextItemId: p.destinoContextItemId, destinoVersao: p.destinoVersao,
      destinoHash: p.destinoHash, secoesUsadas: p.secoesUsadas, textoFinal: textos[qual],
    };
    try {
      const novo = await apiPost<PautaMarcaPainel>(`/pauta/marca/projecao/${qual}`, corpo, token);
      if (sessao.current !== identidade) return;
      setPainel(novo);
      if (qual === 'perfil') setPerfil(novo.perfil ?? '');
      else setPilares(novo.pilaresTexto);
      await carregarPrevia(qual);
    } catch (e) {
      if (sessao.current === identidade) setErro(`${(e as Error).message} Atualize a prévia antes de tentar novamente.`);
    } finally {
      if (sessao.current === identidade && escritaEmCurso.current === escrita) {
        escritaEmCurso.current = null;
        setAplicando(null);
      }
    }
  }

  async function salvar(qual: 'perfil' | 'pilares') {
    if (!editavel || !painel || !token || escritaEmCurso.current) return;
    const escrita = Symbol('salvar');
    escritaEmCurso.current = escrita;
    ++revisaoPainel.current;
    setSalvando(qual);
    setErro(null);
    try {
      const corpo =
        qual === 'perfil'
          ? { perfil, versao: painel?.perfilVersao ?? undefined }
          : { pilares, versao: painel?.pilaresVersao ?? undefined };
      const caminho = qual === 'perfil' ? '/pauta/marca' : '/pauta/marca/pilares';
      const p = await apiPut<PautaMarcaPainel>(caminho, corpo, token);
      if (sessao.current !== identidade) return;
      setPainel(p);
      if (qual === 'perfil') setPerfil(p.perfil ?? '');
      else setPilares(p.pilaresTexto);
      if (podeLerFonte) await carregarPrevia(qual);
    } catch (e) {
      if (sessao.current === identidade) setErro((e as Error).message);
    } finally {
      if (sessao.current === identidade && escritaEmCurso.current === escrita) {
        escritaEmCurso.current = null;
        setSalvando(null);
      }
    }
  }

  if (!ready) return <p className="text-muted">Carregando…</p>;
  if (identidadeDoEstado !== identidade) return <p className="text-muted">Atualizando acesso…</p>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Marca e pilares</h1>
        <p className="mt-1 text-sm text-muted">
          Quem a casa é e sobre o que ela fala. Isto entra nos pedidos que a pauta faz à IA — no
          roteiro, nas peças da semana, na newsletter e no pacote do YouTube —, ao lado da voz de
          quem apresenta. Em branco, os pedidos ficam exatamente como eram.
        </p>
      </div>

      {erro && (
        <div role="alert" className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{erro}</div>
      )}

      {painel?.avisos.length ? (
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          {painel.avisos.map((a) => (
            <p key={a}>{a}</p>
          ))}
        </div>
      ) : null}

      <section className="rounded-xl border border-border bg-surface p-5" aria-labelledby="projecao-titulo">
        <h2 id="projecao-titulo" className="font-semibold">Guia de marca na Memória</h2>
        <p className="mt-1 text-sm text-muted">
          Confira os trechos do guia e edite o texto curto antes de aplicar. Perfil e pilares são
          versões separadas; cada botão grava apenas o destino indicado.
        </p>
        {!podeLerFonte ? (
          <p className="mt-3 text-sm text-muted">Para consultar a fonte, sua conta precisa de acesso à Pauta e à Memória.</p>
        ) : (
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            {(['perfil', 'pilares'] as const).map((qual) => {
              const p = previas[qual];
              const titulo = qual === 'perfil' ? 'Perfil' : 'Pilares';
              const aplicavel = p && p.fonteContextItemId && p.fonteVersao && p.fonteHash &&
                p.secoesUsadas.length > 0 && !['fonte_ausente', 'fonte_arquivada'].includes(p.estado) &&
                textos[qual].length <= PAUTA_TETO_DO_PERFIL_DA_MARCA &&
                (qual !== 'perfil' || textos[qual].trim().length >= 80);
              return (
                <div key={qual} className="rounded-lg border border-border bg-surface-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-medium">{titulo}</h3>
                    <button type="button" onClick={() => carregarPrevia(qual)}
                      aria-label={`${p ? 'Atualizar prévia' : 'Conferir guia'} de ${titulo.toLowerCase()}`}
                      className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-brand-dim focus-visible:outline-2 focus-visible:outline-brand">
                      {p ? 'Atualizar prévia' : 'Conferir guia'}
                    </button>
                  </div>
                  {p && (
                    <div className="mt-3 space-y-3 text-sm">
                      <p aria-live="polite" className="text-muted">
                        {p.estado === 'ja_aplicado' ? 'Esta projeção já está aplicada.' :
                          p.estado === 'fonte_alterada' ? 'O guia mudou desde a aplicação anterior.' :
                          p.estado === 'destino_alterado' ? 'O destino mudou desde a aplicação anterior.' :
                          p.estado === 'pronto' ? 'Prévia pronta para revisão.' : p.aviso}
                      </p>
                      {p.aviso && !['fonte_ausente', 'fonte_arquivada', 'excede_limite'].includes(p.estado) &&
                        <p className="text-warn">{p.aviso}</p>}
                      {p.fonteContextItemId && (
                        <p className="break-all font-os-mono text-xs text-muted">
                          Fonte: {p.fonteChave} · v{p.fonteVersao} · sha256:{p.fonteHash?.slice(0, 12)}
                        </p>
                      )}
                      {p.secoesUsadas.length > 0 && (
                        <div>
                          <p className="font-medium">Trechos usados</p>
                          <ul className="mt-1 list-disc pl-5 text-muted">
                            {p.secoesUsadas.map((s) => <li key={s.titulo}>{s.titulo} · {s.hash.slice(0, 12)}</li>)}
                          </ul>
                        </div>
                      )}
                      {p.diferenca && p.textoAtual && (
                        <details>
                          <summary className="cursor-pointer font-medium">Ver texto atual antes de trocar</summary>
                          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-border p-2 font-os-mono text-xs">{p.textoAtual}</pre>
                        </details>
                      )}
                      {p.secoesUsadas.length > 0 && (
                        <>
                          <label htmlFor={`projecao-${qual}`} className="block font-medium">Texto proposto para {titulo.toLowerCase()}</label>
                          <textarea id={`projecao-${qual}`} value={textos[qual]}
                            onChange={(e) => {
                              revisaoPrevia.current[qual]++;
                              setTextos((v) => ({ ...v, [qual]: e.target.value }));
                            }}
                            disabled={!podeAplicar || aplicando !== null || salvando !== null} rows={qual === 'perfil' ? 14 : 8}
                            className={areaCls} />
                          <p className="font-os-mono text-xs text-muted">{textos[qual].length} / {PAUTA_TETO_DO_PERFIL_DA_MARCA} caracteres</p>
                          {podeAplicar && (
                            <button type="button" onClick={() => aplicar(qual)}
                              disabled={!painel || !aplicavel || aplicando !== null || salvando !== null}
                              className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-bg hover:bg-brand/90 focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50">
                              {aplicando === qual ? 'Aplicando…' : `Aplicar somente ${titulo.toLowerCase()}`}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-os-mono text-[10px] uppercase tracking-[0.16em] font-semibold text-muted">
            O perfil da marca
          </h2>
          <span className="font-os-mono text-[11px] tabular-nums text-muted">
            {perfil.length} / {PAUTA_TETO_DO_PERFIL_DA_MARCA}
          </span>
        </div>
        <textarea
          aria-label="Perfil da marca"
          value={perfil}
          onChange={(e) => setPerfil(e.target.value)}
          disabled={!editavel || !painel || salvando !== null || aplicando !== null}
          rows={16}
          placeholder={MODELO}
          className={areaCls}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {editavel && (
            <button
              onClick={() => salvar('perfil')}
              disabled={!painel || salvando !== null || aplicando !== null || !perfil.trim()}
              className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-bg hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {salvando === 'perfil' ? 'Salvando…' : 'Salvar o perfil'}
            </button>
          )}
          {editavel && !perfil.trim() && (
            <button
              onClick={() => setPerfil(MODELO)}
              className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm hover:border-brand-dim"
            >
              Começar pelas seções
            </button>
          )}
          {painel?.perfilVersao ? (
            <span className="font-os-mono text-[11px] text-muted">versão {painel.perfilVersao}</span>
          ) : null}
          {painel?.projecoes?.perfil && (
            <span className="font-os-mono text-[11px] text-muted">
              Guia v{painel.projecoes.perfil.fonteVersao} aplicado no perfil v{painel.projecoes.perfil.versaoDestino}
              {painel.projecoes.perfil.atual ? ' · vigente' : ' · substituído por edição posterior'}
            </span>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-os-mono text-[10px] uppercase tracking-[0.16em] font-semibold text-muted">
            Os pilares
          </h2>
          <span className="font-os-mono text-[11px] tabular-nums text-muted">
            {painel?.pilares.length ?? 0} / {PAUTA_TETO_DE_PILARES}
          </span>
        </div>
        <textarea
          aria-label="Pilares de conteúdo"
          value={pilares}
          onChange={(e) => setPilares(e.target.value)}
          disabled={!editavel || !painel || salvando !== null || aplicando !== null}
          rows={8}
          placeholder={EXEMPLO_DE_PILARES}
          className={areaCls}
        />
        {painel?.pilares.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {painel.pilares.map((p) => (
              <span
                key={p.chave}
                className="rounded px-2 py-0.5 text-xs"
                style={{ backgroundColor: `${p.cor}22`, color: p.cor }}
                title={p.descricao}
              >
                {p.nome}
              </span>
            ))}
          </div>
        ) : null}
        {painel?.projecoes?.pilares && (
          <p className="mt-2 font-os-mono text-[11px] text-muted">
            Guia v{painel.projecoes.pilares.fonteVersao} aplicado nos pilares v{painel.projecoes.pilares.versaoDestino}
            {painel.projecoes.pilares.atual ? ' · vigente' : ' · substituído por edição posterior'}
          </p>
        )}
        {editavel && (
          <div className="mt-3">
            <button
              onClick={() => salvar('pilares')}
              disabled={!painel || salvando !== null || aplicando !== null}
              className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-bg hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {salvando === 'pilares' ? 'Salvando…' : 'Salvar os pilares'}
            </button>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-3 font-os-mono text-[10px] uppercase tracking-[0.16em] font-semibold text-muted">
          O que os pedidos à IA recebem agora
        </h2>
        {painel?.bloco ? (
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-2 p-3 font-os-mono text-xs text-muted">
            {painel.bloco}
          </pre>
        ) : (
          <p className="text-sm text-muted">
            Nada ainda. Sem marca escrita e sem pilar, os pedidos à IA continuam como eram antes —
            nenhuma linha a mais.
          </p>
        )}
      </section>
    </div>
  );
}
