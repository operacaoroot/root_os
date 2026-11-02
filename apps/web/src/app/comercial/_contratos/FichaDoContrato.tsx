'use client';

/*
 * A FICHA DO CONTRATO (fase F4, 02/11/2026): etapas no topo, a faixa de ação, quem
 * assina, os dados, os documentos, o histórico e o bloco da minuta. Lê sempre
 * `GET /comercial/contratos/registro/:id`.
 */
import { useCallback, useState } from 'react';
import { ROTULO_DA_ETAPA_DO_QUADRO, ROTULO_DA_MODALIDADE, type ContratoNaFicha, type FichaDoLead } from '@mktos/shared';

import { useAuth } from '@/lib/auth';
import { horaSP } from '@/lib/cockpit';

import { BOTAO, CARTAO, Carregando, Chip, Erro, Rotulo, useCarregar } from '../_ui';
import { MinutaDoContrato } from '../_painel/MinutaDoContrato';
import { DadosDoContrato } from './DadosDoContrato';
import { DocumentosDoContrato } from './DocumentosDoContrato';
import { FaixaDeAcao } from './FaixaDeAcao';
import { SignatariosDoContrato } from './SignatariosDoContrato';
import { CAMINHO_DO_REGISTRO, ETAPAS_DA_FICHA, dataCompleta, degrauDaFicha, type PassoDoContrato } from './regras';

export function FichaDoContrato({ contratoId, leadId, ficha, passo, assinaturaConfigurada, aoMudar }: {
  contratoId: string;
  leadId: string;
  ficha: FichaDoLead | null;
  passo: PassoDoContrato | null;
  assinaturaConfigurada: boolean;
  aoMudar: () => Promise<void>;
}) {
  const { can } = useAuth();
  const caminho = `${CAMINHO_DO_REGISTRO}/${encodeURIComponent(contratoId)}`;
  const contrato = useCarregar<ContratoNaFicha>(caminho, 30_000);
  const recarregar = contrato.recarregar;
  const mudou = useCallback(async () => {
    await Promise.all([recarregar(), aoMudar()]);
  }, [recarregar, aoMudar]);

  const c = contrato.dados;
  if (!c) {
    return contrato.erro ? <Erro erro={contrato.erro} aoTentar={() => void contrato.recarregar()} /> : <Carregando linhas={3} altura="h-20" />;
  }
  const podeEditar = can('leads.editar');
  const temAceite = (ficha?.fio ?? []).some((l) => l.type === 'proposta.aceita' || l.type === 'aceite.declarado');

  return (
    <div className="space-y-3" data-testid="ficha-contrato" data-estado={c.estado}>
      <Erro erro={contrato.erro} aoTentar={() => void contrato.recarregar()} />
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-[13px] text-muted">
          {c.modalidade ? `Contrato de ${ROTULO_DA_MODALIDADE[c.modalidade].toLocaleLowerCase('pt-BR')}` : 'Contrato sem modalidade'}
          {c.numero ? ` · nº ${c.numero}` : ''}
          {c.dono ? ` · sócio da conta: ${c.dono}` : ''}
        </p>
        <Chip tom={c.etapa === 'renovar' || c.etapa === 'a_encerrar' ? 'alerta' : 'neutro'}>{ROTULO_DA_ETAPA_DO_QUADRO[c.etapa]}</Chip>
      </div>

      <EtapasDaFicha c={c} />
      <FaixaDeAcao c={c} leadId={leadId} passo={passo} assinaturaConfigurada={assinaturaConfigurada} podeEditar={podeEditar} aoMudar={mudou} />

      <div className="grid gap-3 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
        <SignatariosDoContrato c={c} podeEditar={podeEditar} aoMudar={mudou} />
        <DadosDoContrato c={c} podeEditar={podeEditar} aoMudar={mudou} />
      </div>

      <DocumentosDoContrato c={c} leadId={leadId} podeEditar={podeEditar} aoMudar={mudou} />

      <section className={`${CARTAO} space-y-2`} aria-label="histórico do contrato" data-testid="contrato-historico">
        <Rotulo>histórico</Rotulo>
        {c.historico.length === 0 ? (
          <p className="text-[12.5px] text-muted">Nada registrado ainda.</p>
        ) : (
          <ul className="space-y-1 text-[12.5px]">
            {c.historico.map((h, i) => (
              <li key={`${h.em}-${i}`} className="flex flex-wrap gap-x-3">
                <span className="font-os-mono text-[11.5px] tabular-nums text-dim">{dataCompleta(h.em)} {horaSP(h.em)}</span>
                <span className="min-w-0 flex-1">{h.texto}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <BlocoDaMinuta leadId={leadId} temAceite={temAceite} aberto={passo === 'minuta' || !!c.minutaId} />
    </div>
  );
}

function EtapasDaFicha({ c }: { c: ContratoNaFicha }) {
  const agora = degrauDaFicha(c.etapa);
  return (
    <ol className="flex gap-1 overflow-x-auto" data-testid="contrato-etapas" aria-label="etapas do contrato">
      {ETAPAS_DA_FICHA.map((nome, i) => {
        const estado = i < agora ? 'feita' : i === agora ? 'agora' : 'a fazer';
        return (
          <li
            key={nome}
            aria-current={i === agora ? 'step' : undefined}
            className={`min-w-[6.5rem] flex-1 rounded border px-2 py-1.5 text-[12px] ${i === agora ? 'border-brand font-semibold' : i < agora ? 'border-border-strong' : 'border-border text-dim'}`}
          >
            <span className="block truncate">{nome}</span>
            <span className="block font-os-mono text-[10px] uppercase tracking-[0.1em] text-muted">{estado}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** "Gerar minuta" abre o `MinutaDoContrato` de sempre: ele fala com a API só depois de aberto. */
function BlocoDaMinuta({ leadId, temAceite, aberto }: { leadId: string; temAceite: boolean; aberto: boolean }) {
  const [mostrar, setMostrar] = useState(aberto);
  return (
    <section className={`${CARTAO} space-y-2`} aria-label="minuta do contrato da Root" data-testid="contrato-minuta">
      {mostrar ? (
        <MinutaDoContrato leadId={leadId} temAceite={temAceite} />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Rotulo>minuta do contrato da Root</Rotulo>
          <button type="button" data-testid="contrato-abrir-minuta" className={BOTAO} onClick={() => setMostrar(true)}>Gerar minuta</button>
        </div>
      )}
    </section>
  );
}
