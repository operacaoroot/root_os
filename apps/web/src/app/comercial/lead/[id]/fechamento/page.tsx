'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { EscritaDoFechamento, FechamentoDoLead } from '@mktos/shared';

import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { diaHoraSP, ficouRetida, horaSP, segundos } from '@/lib/cockpit';

import { AbasDoLead, AguardandoAprovacao, Aviso, BOTAO, CARTAO, Carregando, Chip, Erro, FOCO, Rotulo, useCarregar } from '../../../_ui';

/*
 * TELA 10 · O FECHAMENTO: AS CINCO ESCRITAS (lane C). Assinado e pago, o
 * fechamento roda com chave: rodar de novo não duplica nada. Rodar é
 * `comercial.fechamento.executar` (R4) pela porta: a titular assina em
 * /atendimento. Esta tela só lê e, quando preciso, PROPÕE de novo.
 */

type Fechamento = FechamentoDoLead & { aprovacao: { id: string; status: string } | null; vetado: boolean };

const ROTULO_DA_ESCRITA: Record<EscritaDoFechamento['escrita'], string> = {
  cliente: 'cliente',
  contrato: 'contrato',
  cobranca: 'cobrança',
  kit_e_trilho: 'kit e trilho',
  grupo: 'grupo',
};

const ROTULO_DO_ESTADO: Record<FechamentoDoLead['estado'], string> = {
  pendente: 'pendente',
  em_curso: 'em curso',
  concluido: 'concluído',
  erro: 'com erro',
};

export default function FechamentoPage() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuth();
  const { dados: f, erro, carregando, recarregar } = useCarregar<Fechamento>(id ? `/comercial/fechamentos/${id}` : null, 15_000);
  const [resposta, setResposta] = useState<unknown>(null);
  const [erroDaAcao, setErroDaAcao] = useState<unknown>(null);
  const [ocupado, setOcupado] = useState(false);

  async function rodar() {
    setOcupado(true);
    setErroDaAcao(null);
    try {
      setResposta(await apiPost(`/comercial/fechamentos/${id}/rodar`, {}, token));
      await recarregar();
    } catch (e) {
      setErroDaAcao(e);
    } finally {
      setOcupado(false);
    }
  }

  const pulado = resposta && typeof resposta === 'object' && 'pulado' in resposta ? String((resposta as { pulado: string }).pulado) : null;
  const retida = ficouRetida(resposta) ? (resposta as { approvalId: string }).approvalId : f?.aprovacao?.id ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/comercial/lead/${id}`} className={`text-[12px] text-muted hover:text-brand ${FOCO}`}>← fio do lead</Link>
        {id && <span className="ml-auto"><AbasDoLead leadId={id} atual="fechamento" /></span>}
      </div>
      <Erro erro={erro} />
      {carregando && !f && <Carregando />}
      {f && (
        <>
          <header className={`${CARTAO} flex flex-wrap items-center gap-2`}>
            <h1 className="text-[17px] font-semibold">Fechamento</h1>
            <Chip tom={f.estado === 'concluido' ? 'bom' : f.estado === 'erro' ? 'ruim' : 'alerta'}>{ROTULO_DO_ESTADO[f.estado] ?? f.estado}</Chip>
            {f.concluidoEm && <span className="font-os-mono text-[12px] text-muted">{horaSP(f.concluidoEm)} · {diaHoraSP(f.concluidoEm).slice(0, 5)}</span>}
            {f.vetado && <Chip tom="ruim">vetado</Chip>}
            <span className="ml-auto font-os-mono text-[11px] text-dim">chave {f.chave}</span>
          </header>

          {retida && f.estado !== 'concluido' && <AguardandoAprovacao approvalId={retida} oQue="O fechamento (R4) espera a assinatura da titular." />}
          {pulado && <Aviso>Nada novo foi proposto: {pulado}.</Aviso>}

          <section className={CARTAO} aria-label="as cinco escritas">
            <Rotulo>as cinco escritas</Rotulo>
            <div className="mt-2 hidden grid-cols-[110px_150px_minmax(0,1fr)_70px_170px] gap-3 border-b border-border pb-1.5 font-os-mono text-[10px] uppercase tracking-[0.12em] text-dim md:grid">
              <span>escrita</span><span>onde</span><span>estado</span><span>tempo</span><span>se rodar de novo</span>
            </div>
            <ul className="divide-y divide-border">
              {f.escritas.map((e) => (
                <li key={e.escrita} className="grid gap-1 py-2 text-[13px] md:grid-cols-[110px_150px_minmax(0,1fr)_70px_170px] md:gap-3">
                  <span className="font-semibold">{ROTULO_DA_ESCRITA[e.escrita] ?? e.escrita}</span>
                  <span className="text-muted">{e.onde}</span>
                  <span className="min-w-0 break-words">
                    <Chip tom={e.estado === 'erro' ? 'ruim' : e.estado === 'pendente' ? 'neutro' : 'bom'}>{e.estado}</Chip>
                    {e.detalhe && <span className="ml-1.5 text-muted">{e.detalhe}</span>}
                  </span>
                  <span className="font-os-mono text-[12px] text-muted">{e.ms == null ? 'ausente' : segundos(e.ms)}</span>
                  <span className="text-[12px] text-muted">{e.seRodarDeNovo}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className={CARTAO} aria-label="copiado sem redigitar">
            <Rotulo>copiado sem redigitar</Rotulo>
            <p className="mt-2 text-[13px]">{f.copiadoSemRedigitar.length ? f.copiadoSemRedigitar.join(', ') : 'nada ainda'}</p>
            <p className="mt-1 text-[12px] text-muted">
              {f.iniciadoEm ? `começou em ${diaHoraSP(f.iniciadoEm)}` : 'ainda não começou'}{f.concluidoEm ? ` · terminou em ${diaHoraSP(f.concluidoEm)}` : ''} · versão {f.versao}
            </p>
          </section>

          {f.estado !== 'concluido' && (
            <section className={CARTAO} aria-label="rodar de novo">
              <p className="text-[12.5px] text-muted">
                O fechamento é proposto sozinho quando a primeira parcela está paga e as duas assinaturas estão no fio. Se a aprovação venceu, proponha de novo: a chave impede duplicar, e quem propõe não assina.
              </p>
              <button type="button" className={`mt-2 ${BOTAO}`} disabled={ocupado} onClick={() => void rodar()}>
                {ocupado ? 'propondo…' : 'propor o fechamento de novo'}
              </button>
              <div className="mt-2"><Erro erro={erroDaAcao} /></div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
