'use client';

import { useEffect, useState } from 'react';
import {
  PAUTA_SECOES_DA_MARCA,
  PAUTA_TETO_DE_PILARES,
  PAUTA_TETO_DO_PERFIL_DA_MARCA,
  type PautaMarcaPainel,
} from '@mktos/shared';
import { useAuth } from '@/lib/auth';
import { apiGet, apiPut } from '@/lib/api';

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
  const [painel, setPainel] = useState<PautaMarcaPainel | null>(null);
  const [perfil, setPerfil] = useState('');
  const [pilares, setPilares] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<'perfil' | 'pilares' | null>(null);

  useEffect(() => {
    if (!ready || !token) return;
    apiGet<PautaMarcaPainel>('/pauta/marca', token)
      .then((p) => {
        setPainel(p);
        setPerfil(p.perfil ?? '');
        setPilares(p.pilaresTexto);
      })
      .catch((e: Error) => setErro(e.message));
  }, [ready, token]);

  async function salvar(qual: 'perfil' | 'pilares') {
    setSalvando(qual);
    setErro(null);
    try {
      const corpo =
        qual === 'perfil'
          ? { perfil, versao: painel?.perfilVersao ?? undefined }
          : { pilares, versao: painel?.pilaresVersao ?? undefined };
      const caminho = qual === 'perfil' ? '/pauta/marca' : '/pauta/marca/pilares';
      const p = await apiPut<PautaMarcaPainel>(caminho, corpo, token);
      setPainel(p);
      setPerfil(p.perfil ?? '');
      setPilares(p.pilaresTexto);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(null);
    }
  }

  if (!ready) return <p className="text-muted">Carregando…</p>;

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
        <div className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{erro}</div>
      )}

      {painel?.avisos.length ? (
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          {painel.avisos.map((a) => (
            <p key={a}>{a}</p>
          ))}
        </div>
      ) : null}

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
          value={perfil}
          onChange={(e) => setPerfil(e.target.value)}
          disabled={!editavel}
          rows={16}
          placeholder={MODELO}
          className={areaCls}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {editavel && (
            <button
              onClick={() => salvar('perfil')}
              disabled={salvando !== null || !perfil.trim()}
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
          value={pilares}
          onChange={(e) => setPilares(e.target.value)}
          disabled={!editavel}
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
        {editavel && (
          <div className="mt-3">
            <button
              onClick={() => salvar('pilares')}
              disabled={salvando !== null}
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
