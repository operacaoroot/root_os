'use client';

/*
 * "INICIAR ONBOARDING" NO PAINEL DO LEAD (ajustes da versão final A2, 19/10/2026).
 *
 * O onboarding começa com o lead ainda no funil: o card nasce na lista "Onboarding
 * de cliente", na etapa escolhida (padrão "Kickoff marcado"), com o selo "Iniciado
 * antes do fechamento". Quando o lead fechar, o fechamento reaproveita o mesmo card.
 * O botão só aparece com `leads.editar` e `tarefas.editar`, antes de "Negócio
 * fechado", fora das saídas e enquanto o lead não tem card. A API confere tudo de novo.
 */
import { useState } from 'react';
import type { EtapasDoOnboardingAntecipado, FichaDoLead } from '@mktos/shared';

import { useAuth } from '@/lib/auth';
import { ETAPAS_DE_RESERVA, iniciarOnboarding, lerEtapasDoOnboarding, linkDoCardAntecipado, mostrarIniciarOnboardingNoLead } from '@/lib/onboarding-antecipado';

import { BOTAO, BOTAO_PRIMARIO, CARTAO, ErroDaAcao, INPUT, Rotulo } from '../_ui';
import { usePainel } from './provedor';

export function IniciarOnboarding({ leadId, ficha, aoMudar }: { leadId: string; ficha: FichaDoLead; aoMudar: () => Promise<void> }) {
  const { token, can } = useAuth();
  const painel = usePainel();
  const [aberto, setAberto] = useState(false);
  const [etapas, setEtapas] = useState<EtapasDoOnboardingAntecipado | null>(null);
  const [etapa, setEtapa] = useState('');
  const [erro, setErro] = useState<unknown>(null);
  const [enviando, setEnviando] = useState(false);
  const [feito, setFeito] = useState<string | null>(null);

  // Depois de iniciar, a ficha relida já traz o card e o botão sai; o link do card fica até o painel fechar.
  if (!feito && !mostrarIniciarOnboardingNoLead(can, ficha)) return null;

  async function abrir() {
    setErro(null);
    setAberto(true);
    try {
      const e = await lerEtapasDoOnboarding(token);
      setEtapas(e);
      setEtapa(e.padrao);
    } catch {
      // Sem a lista, a escolha fica com a etapa padrão; a API confere de novo.
      setEtapas(ETAPAS_DE_RESERVA);
      setEtapa(ETAPAS_DE_RESERVA.padrao);
    }
  }

  async function iniciar() {
    if (enviando) return;
    setErro(null);
    setEnviando(true);
    try {
      const r = await iniciarOnboarding(token, leadId, etapa || ETAPAS_DE_RESERVA.padrao);
      setFeito(linkDoCardAntecipado(r));
      setAberto(false);
      painel.avisar(`Onboarding iniciado: o card está na Implantação, em ${r.etapa}.`);
      await aoMudar();
    } catch (e) {
      setErro(e);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className={CARTAO} aria-label="iniciar onboarding" data-testid="lead-iniciar-onboarding">
      <Rotulo>onboarding antes do fechamento</Rotulo>
      {feito ? (
        <p className="mt-2 text-[12.5px]">
          Card aberto. <a href={feito} className="underline underline-offset-2" data-testid="lead-onboarding-link">Abrir o card na Implantação</a>
        </p>
      ) : !aberto ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className={BOTAO} onClick={() => void abrir()}>Iniciar onboarding</button>
          <span className="text-[12px] text-dim">O card nasce na Implantação com o selo de antes do fechamento. Quando o lead fechar, o card é o mesmo.</span>
        </div>
      ) : (
        <div className="mt-2 space-y-2 text-[12.5px]">
          <label className="block">etapa de entrada
            <select className={INPUT} value={etapa} onChange={(e) => setEtapa(e.target.value)} disabled={!etapas}>
              {(etapas?.etapas ?? []).map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </label>
          <p className="text-[12px] text-muted">Os dados vêm da ficha do lead. O que ainda não existe fica [a decidir] no card.</p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={BOTAO_PRIMARIO} disabled={!etapas || enviando} onClick={() => void iniciar()}>{enviando ? 'Iniciando…' : 'Iniciar onboarding'}</button>
            <button type="button" className={BOTAO} onClick={() => setAberto(false)}>Cancelar</button>
          </div>
          <ErroDaAcao erro={erro} />
        </div>
      )}
    </section>
  );
}
