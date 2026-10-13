'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ContratoVivo } from '@mktos/shared';

import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ROTULO_DO_PRODUTO, contarParcelas, dataDoDia, diaHoraSP, diaSP, numeroOuAusente, reaisOuAusente } from '@/lib/cockpit';

import { AbasDoLead, BOTAO, CARTAO, Carregando, Chip, Erro, FOCO, INPUT, Numero, Rotulo, useCarregar } from '../../_ui';

/*
 * TELA 11 · O CONTRATO VIVO (lane C). A gestão depois do sim: parcelas e a
 * régua de cobrança, entregas, saúde, fase da implantação e os marcos já
 * agendados. O que a API não mede (saúde, primeiro valor) aparece ausente.
 */
export default function ContratoVivoPage() {
  const { leadId } = useParams<{ leadId: string }>();
  const { dados: c, erro, carregando } = useCarregar<ContratoVivo>(leadId ? `/comercial/contratos/${leadId}` : null, 60_000);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/comercial/contratos" className={`text-[12px] text-muted hover:text-brand ${FOCO}`}>← contratos</Link>
        {leadId && <span className="ml-auto"><AbasDoLead leadId={leadId} atual="contrato" /></span>}
      </div>
      <Erro erro={erro} />
      {carregando && !c && <Carregando />}
      {c && <Contrato c={c} />}
    </div>
  );
}

function Contrato({ c }: { c: ContratoVivo }) {
  const p = contarParcelas(c.parcelas);
  return (
    <>
      <h1 className="text-[19px] font-semibold">{c.cliente}</h1>
      <section aria-label="resumo" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Numero
          valor={reaisOuAusente(c.valorCentavos)}
          legenda={`${c.produto ? ROTULO_DO_PRODUTO[c.produto] : 'produto ausente'}${c.descontoPct != null ? ` · ${c.descontoPct}% aprovado` : ''}`}
          tom="brand"
        />
        <Numero valor={`${p.pagas}/${p.total}`} legenda="parcelas pagas" tom={p.atrasadas ? 'ruim' : undefined} />
        <Numero valor={c.faseDaImplantacao ? `fase ${c.faseDaImplantacao.atual} de ${c.faseDaImplantacao.total}` : 'ausente'} legenda="na implantação" />
        <Numero valor={numeroOuAusente(c.saude)} legenda="saúde: uso, respostas, prazos" />
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className={CARTAO} aria-label="parcelas">
          <Rotulo>parcelas e régua de cobrança</Rotulo>
          <ul className="mt-2 divide-y divide-border text-[13px]">
            {c.parcelas.map((x) => (
              <li key={x.n} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="font-os-mono">{x.n}/{x.total}</span>
                <span>{reaisOuAusente(x.valorCentavos)}</span>
                <Chip tom={x.estado === 'paga' ? 'bom' : x.estado === 'atrasada' ? 'ruim' : 'neutro'}>{x.estado}</Chip>
                <span className="text-muted">{x.estado === 'paga' && x.pagaEm ? `paga em ${diaSP(x.pagaEm)}` : `vence ${dataDoDia(x.vence)}`}</span>
                {x.aviso && <span className="w-full text-[12px] text-warn">{x.aviso}</span>}
              </li>
            ))}
          </ul>
          <ul className="mt-2 space-y-0.5 text-[12px] text-muted">
            {c.reguaDeCobranca.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </section>

        <section className={CARTAO} aria-label="entregas">
          <Rotulo>entregas</Rotulo>
          <ul className="mt-2 space-y-1 text-[13px]">
            {c.entregas.map((e) => (
              <li key={e.texto} className="flex gap-2">
                <span aria-hidden className={e.feito ? 'text-good' : 'text-dim'}>{e.feito ? '●' : '○'}</span>
                <span className={e.feito ? '' : 'text-muted'}>{e.texto}</span>
                <span className="sr-only">{e.feito ? 'feito' : 'a fazer'}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12.5px] text-muted">
            Primeiro valor percebido: {c.primeiroValorEm ? diaSP(c.primeiroValorEm) : 'ausente'}.
          </p>
        </section>
      </div>

      <section className={CARTAO} aria-label="marcos">
        <Rotulo>próximos marcos, já agendados</Rotulo>
        <ul className="mt-2 space-y-1.5 text-[13px]">
          {c.marcos.map((m) => (
            <li key={m.chave} className="grid grid-cols-[96px_minmax(0,1fr)] gap-2">
              <span className="font-os-mono text-brand">{m.quando ? diaHoraSP(m.quando).slice(0, 5) : 'sem data'}</span>
              <span className={m.feito ? 'line-through text-muted' : ''}>{m.rotulo}</span>
            </li>
          ))}
          {c.marcos.length === 0 && <li className="text-muted">Nenhum marco agendado.</li>}
        </ul>
        <p className="mt-2 text-[12.5px] text-muted">Aditivos: {c.aditivos === 0 ? 'nenhum' : c.aditivos}.</p>
      </section>

      <AssinaturaDaRoot leadId={c.leadId} />
    </>
  );
}

function AssinaturaDaRoot({ leadId }: { leadId: string }) {
  const { token } = useAuth();
  const [r, setR] = useState<{ linkAssinatura: string | null; assinadoRootEm: string | null } | null>(null);
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<unknown>(null);
  return (
    <section className={CARTAO} aria-label="assinatura da Root">
      <Rotulo>assinatura da Root</Rotulo>
      <p className="mt-1 text-[12.5px] text-muted">Só o sócio titular cadastrado para assinar recebe o link, depois de confirmar a senha. A assinatura volta pelo provedor e entra no fio.</p>
      <label className="mt-2 block text-[12.5px]">
        sua senha
        <input type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} className={`mt-1 ${INPUT}`} />
      </label>
      <button
        type="button"
        className={`mt-2 ${BOTAO}`}
        disabled={!senha}
        onClick={async () => {
          setErro(null);
          try {
            setR(await apiPost(`/comercial/contratos/${leadId}/assinar-pela-root`, { senha }, token));
          } catch (e) {
            setErro(e);
          } finally {
            setSenha('');
          }
        }}
      >
        ver a assinatura da Root
      </button>
      {r && (
        <p className="mt-2 text-[12.5px]">
          {r.assinadoRootEm ? `Assinado pela Root em ${diaHoraSP(r.assinadoRootEm)}.` : r.linkAssinatura ? (
            <a href={r.linkAssinatura} target="_blank" rel="noreferrer" className="underline decoration-brand">abrir o link de assinatura</a>
          ) : 'O link de assinatura da Root ainda não chegou do provedor.'}
        </p>
      )}
      <div className="mt-2"><Erro erro={erro} /></div>
    </section>
  );
}
