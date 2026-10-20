'use client';

/*
 * "INICIAR ONBOARDING" NA IMPLANTAÇÃO (ajustes da versão final A2, 19/10/2026).
 *
 * O botão do topo do quadro abre a busca de leads do funil: só aparecem os
 * elegíveis (em andamento, sem card e sem cliente ativo), e a escolha chama a
 * MESMA rota do painel do lead. Não existe cartão solto aqui: sem lead, nada
 * nasce, e a porta única da implantação continua recusando cartão avulso.
 */
import { useEffect, useId, useState } from 'react';
import type { EtapasDoOnboardingAntecipado, LeadElegivelAoOnboarding, OnboardingAntecipadoResposta } from '@mktos/shared';

import { useAuth } from '@/lib/auth';
import { ETAPAS_DE_RESERVA, buscarLeadsElegiveis, iniciarOnboarding, lerEtapasDoOnboarding, podeIniciarOnboarding } from '@/lib/onboarding-antecipado';

const BOTAO = 'min-h-9 rounded-lg border border-border bg-surface px-3 text-sm hover:border-brand-dim disabled:cursor-not-allowed disabled:opacity-50 max-md:min-h-11';
const BOTAO_PRIMARIO = 'min-h-9 rounded-lg border border-brand-dim bg-brand/10 px-3 text-sm text-brand hover:bg-brand/20 disabled:cursor-not-allowed disabled:opacity-50 max-md:min-h-11';
const CAMPO = 'w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-brand-dim';

function mensagemDoErro(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Não foi possível iniciar agora. Tente de novo.';
}

export function IniciarOnboardingDaImplantacao({ onIniciado }: { onIniciado: (r: OnboardingAntecipadoResposta) => void }) {
  const { token, can } = useAuth();
  const id = useId();
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [leads, setLeads] = useState<LeadElegivelAoOnboarding[] | null>(null);
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [etapas, setEtapas] = useState<EtapasDoOnboardingAntecipado | null>(null);
  const [etapa, setEtapa] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!aberto || !token) return;
    let vivo = true;
    lerEtapasDoOnboarding(token)
      .then((e) => { if (vivo) { setEtapas(e); setEtapa(e.padrao); } })
      .catch(() => { if (vivo) { setEtapas(ETAPAS_DE_RESERVA); setEtapa(ETAPAS_DE_RESERVA.padrao); } });
    return () => { vivo = false; };
  }, [aberto, token]);

  useEffect(() => {
    if (!aberto || !token) return;
    let vivo = true;
    const t = setTimeout(() => {
      buscarLeadsElegiveis(token, busca)
        .then((l) => { if (vivo) { setLeads(l); setErro(null); } })
        .catch((e) => { if (vivo) { setLeads([]); setErro(mensagemDoErro(e)); } });
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [aberto, token, busca]);

  if (!podeIniciarOnboarding(can)) return null;

  async function iniciar() {
    if (!escolhido || enviando) return;
    setErro(null);
    setEnviando(true);
    try {
      const r = await iniciarOnboarding(token, escolhido, etapa || ETAPAS_DE_RESERVA.padrao);
      setAberto(false);
      setEscolhido(null);
      setBusca('');
      onIniciado(r);
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setEnviando(false);
    }
  }

  if (!aberto) {
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="implantacao-iniciar-onboarding">
        <button type="button" className={BOTAO} onClick={() => setAberto(true)}>Iniciar onboarding</button>
        <span className="text-[12px] text-muted">A partir de um lead do funil, antes do fechamento.</span>
      </div>
    );
  }

  return (
    <section aria-labelledby={`${id}-titulo`} className="space-y-3 rounded-lg border border-border bg-surface p-3" data-testid="implantacao-iniciar-onboarding">
      <h2 id={`${id}-titulo`} className="text-sm font-semibold">Iniciar onboarding a partir de um lead</h2>
      <p className="text-[12px] text-muted">Só aparecem leads em andamento no funil, sem card e sem negócio fechado. O card nasce com o selo de antes do fechamento.</p>
      <label className="block text-[12.5px]">buscar lead
        <input aria-label="Buscar lead do funil" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="nome ou empresa" className={CAMPO} />
      </label>
      {leads === null ? (
        <p className="text-[12px] text-muted">Carregando…</p>
      ) : leads.length === 0 ? (
        <p className="text-[12px] text-muted">Nenhum lead elegível{busca.trim() ? ' com essa busca' : ''}.</p>
      ) : (
        <ul className="max-h-56 space-y-1 overflow-y-auto" aria-label="Leads elegíveis">
          {leads.map((l) => (
            <li key={l.leadId}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[13px] hover:bg-surface-2">
                <input type="radio" name={`${id}-lead`} value={l.leadId} checked={escolhido === l.leadId} onChange={() => setEscolhido(l.leadId)} />
                <span className="min-w-0 flex-1 truncate">{l.empresa ?? l.nome}{l.empresa && l.empresa !== l.nome ? <span className="text-muted"> · {l.nome}</span> : null}</span>
                <span className="shrink-0 font-os-mono text-[10.5px] text-muted">{l.rotuloDaEtapa}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <label className="block text-[12.5px]">etapa de entrada
        <select className={CAMPO} value={etapa} onChange={(e) => setEtapa(e.target.value)} disabled={!etapas}>
          {(etapas?.etapas ?? []).map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      </label>
      {erro && <p role="alert" className="text-[12px] text-bad">{erro}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BOTAO_PRIMARIO} disabled={!escolhido || !etapas || enviando} onClick={() => void iniciar()}>{enviando ? 'Iniciando…' : 'Iniciar onboarding'}</button>
        <button type="button" className={BOTAO} onClick={() => { setAberto(false); setEscolhido(null); setErro(null); }}>Cancelar</button>
      </div>
    </section>
  );
}
