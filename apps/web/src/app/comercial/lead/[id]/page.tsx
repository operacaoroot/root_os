'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ComercialMotivoDeSaida, ComercialSaida, FichaDoLead } from '@mktos/shared';
import { COMERCIAL_MOTIVOS_DE_SAIDA, COMERCIAL_ROTULO_DA_ETAPA, COMERCIAL_SAIDAS, ehSaida } from '@mktos/shared';

import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { localSPParaIso } from '@/lib/sala-do-cliente';
import { AUSENTE, ROTULO_DA_FONTE, ROTULO_DO_MOTIVO, ROTULO_DO_PRODUTO, diaDeHojeSP, diaSP, diaSeguinte, fioPorDia, horaSP, instantesLegiveis, numeroOuAusente, problemaDaSaida, quandoRoda, reaisOuAusente } from '@/lib/cockpit';

import { AbasDoLead, Aviso, BarraDaSaude, BOTAO, CARTAO, Carregando, Chip, Erro, FOCO, INPUT, Rotulo, useCarregar } from '../../_ui';

/*
 * TELA 05 · O FIO DO LEAD (lane C). A ficha é a LEITURA do fio: nada nela é
 * digitado, cada linha veio de um evento com a fonte marcada. O que o fio não
 * trouxe aparece como ausente. A única escrita desta tela é registrar uma
 * SAÍDA, que é um fato com motivo e dono (não um campo), conferido pela API.
 */
export default function FioDoLeadPage() {
  const { id } = useParams<{ id: string }>();
  const { dados: f, erro, carregando, recarregar } = useCarregar<FichaDoLead>(id ? `/comercial/lead/${id}` : null, 30_000);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/comercial/funil" className={`text-[12px] text-muted hover:text-brand ${FOCO}`}>← funil vivo</Link>
        {id && <span className="ml-auto"><AbasDoLead leadId={id} atual="fio" /></span>}
      </div>
      <Erro erro={erro} />
      {carregando && !f && <Carregando />}
      {f && <Ficha f={f} aoMudar={recarregar} />}
    </div>
  );
}

function Ficha({ f, aoMudar }: { f: FichaDoLead; aoMudar: () => Promise<void> }) {
  const dados: string[] = [
    f.cnpj ? `CNPJ ${f.cnpj}` : 'CNPJ ausente',
    f.sistemaErp ?? 'sistema ausente',
    f.baseDados == null ? 'base ausente' : f.baseDados ? 'base organizada' : 'sem base',
    f.perfil ?? 'perfil ausente',
    `pontuação ${numeroOuAusente(f.pontuacao)}`,
    `dono: ${f.dono?.nome ?? AUSENTE}`,
    `sócio da conta: ${f.socioDaConta?.nome ?? AUSENTE}`,
  ];
  const proxima = f.portao.proxima ? COMERCIAL_ROTULO_DA_ETAPA[f.portao.proxima] : null;

  return (
    <>
      <header className={`${CARTAO} space-y-2`}>
        <div className="flex flex-wrap items-baseline gap-2">
          <h1 className="text-[20px] font-semibold">{f.empresa ?? f.nome}</h1>
          {f.empresa && <span className="text-[14px] text-muted">· {f.nome}</span>}
          <Chip tom={ehSaida(f.etapa) ? 'alerta' : 'brand'}>{COMERCIAL_ROTULO_DA_ETAPA[f.etapa]}</Chip>
          <span className="font-os-mono text-[11px] text-dim">desde {diaSP(f.etapaDesde)} {horaSP(f.etapaDesde)}</span>
        </div>
        <p className="text-[12.5px] text-muted">{dados.join(' · ')}</p>
        <div className="max-w-xs">
          <BarraDaSaude saude={f.saude} />
          <p className="mt-1 text-[11.5px] text-dim">saúde {numeroOuAusente(f.saude)}</p>
        </div>
        <p className="text-[12.5px] text-muted">
          {f.produto ? ROTULO_DO_PRODUTO[f.produto] : 'produto ausente'} · {reaisOuAusente(f.valorCentavos)}
          {f.parcelas ? ` · ${f.parcelas}×` : ''} · proposta {f.propostaVersao ? `v${f.propostaVersao}` : AUSENTE}
          {f.validade ? ` · vale até ${diaSP(f.validade)}` : ''}
          {f.motivoSaida ? ` · motivo ${ROTULO_DO_MOTIVO[f.motivoSaida]}` : ''}
          {f.voltaEm ? ` · volta ${diaSP(f.voltaEm)}` : ''}
        </p>
        <p className="text-[12px] text-dim">{f.telefone ?? 'telefone ausente'} · {f.email ?? 'e-mail ausente'}</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-label="o fio" className={CARTAO}>
          <Rotulo>o fio · tudo que aconteceu</Rotulo>
          {f.fio.length === 0 && <p className="mt-2 text-[12.5px] text-muted">O fio ainda não tem eventos.</p>}
          <ol className="mt-2 space-y-3">
            {fioPorDia(f.fio).map((g) => (
              <li key={g.dia}>
                <p className="font-os-mono text-[11px] text-brand">D{g.dia}</p>
                <ul className="mt-1 divide-y divide-border">
                  {g.linhas.map((l) => (
                    <li key={l.eventoId} className="grid grid-cols-[44px_58px_minmax(0,1fr)] gap-2 py-1.5 text-[12.5px]">
                      <span className="font-os-mono text-muted">{horaSP(l.em)}</span>
                      <span className="font-os-mono text-[11px] text-info">{ROTULO_DA_FONTE[l.fonte] ?? l.fonte}</span>
                      <span className="min-w-0 break-words" title={l.type}>{instantesLegiveis(l.resumo)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>

        <aside className="space-y-4">
          <section className={CARTAO} aria-label="próximas ações">
            <Rotulo>próxima ação</Rotulo>
            {f.proximaAcao ? (
              <p className="mt-2 text-[13px]">
                {f.proximaAcao.descricao}
                {f.proximaAcao.quando && <span className="text-muted"> · {quandoRoda(f.proximaAcao.quando)} ({diaSP(f.proximaAcao.quando)} {horaSP(f.proximaAcao.quando)})</span>}
              </p>
            ) : (
              <p className="mt-2 text-[12.5px] text-muted">ausente</p>
            )}
            {f.proximasAcoesAutomaticas.length > 0 && (
              <>
                <Rotulo className="mt-3">próximas ações automáticas</Rotulo>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-[12.5px]">
                  {f.proximasAcoesAutomaticas.map((a) => <li key={a}>{a}</li>)}
                </ul>
              </>
            )}
          </section>

          <section className={CARTAO} aria-label="portão">
            <Rotulo>portão {proxima ? `para ${proxima}` : ''}</Rotulo>
            {!proxima && <p className="mt-2 text-[12.5px] text-muted">Sem próxima etapa no funil.</p>}
            <ul className="mt-2 space-y-1 text-[12.5px]">
              {f.portao.itens.map((p) => (
                <li key={p.chave} className="flex gap-2">
                  <span aria-hidden className={p.cumprido ? 'text-good' : 'text-dim'}>{p.cumprido ? '●' : '○'}</span>
                  <span className={p.cumprido ? '' : 'text-muted'}>{p.rotulo}</span>
                  <span className="sr-only">{p.cumprido ? 'cumprido' : 'falta'}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11.5px] text-dim">A etapa anda quando o fato chega. O portão pede o que falta ao próprio lead, pela sala.</p>
          </section>

          <section className={CARTAO} aria-label="ligado a">
            <Rotulo>ligado a</Rotulo>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              <Chip tom={f.ligadoA.sala ? 'bom' : 'neutro'}>sala {f.ligadoA.sala ? '· aberta' : '· ainda não'}</Chip>
              <Chip tom={f.ligadoA.ata ? 'bom' : 'neutro'}>ata {f.ligadoA.ata ? '· recebida' : '· ainda não'}</Chip>
              <Chip tom={f.ligadoA.proposta ? 'bom' : 'neutro'}>{f.ligadoA.proposta ? `proposta v${f.ligadoA.proposta}` : 'proposta · ainda não'}</Chip>
              <Chip tom={f.ligadoA.contrato ? 'bom' : 'neutro'}>contrato {f.ligadoA.contrato ? `· ${f.ligadoA.contrato}` : '· ainda não'}</Chip>
              <Chip tom={f.ligadoA.cobranca ? 'bom' : 'neutro'}>Asaas {f.ligadoA.cobranca ? `· ${f.ligadoA.cobranca}` : '· ainda não'}</Chip>
            </ul>
          </section>

          {f.etapa === 'contrato' && <AssinarPelaRoot leadId={f.leadId} />}
          {!ehSaida(f.etapa) && f.etapa !== 'fechado' && <RegistrarSaida leadId={f.leadId} aoMudar={aoMudar} />}
        </aside>
      </div>
    </>
  );
}

function AssinarPelaRoot({ leadId }: { leadId: string }) {
  const { token } = useAuth();
  const [r, setR] = useState<{ linkAssinatura: string | null; assinadoRootEm: string | null; estado: string } | null>(null);
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<unknown>(null);
  const [enviando, setEnviando] = useState(false);
  async function pedir() {
    if (enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      setR(await apiPost(`/comercial/contratos/${leadId}/assinar-pela-root`, { senha }, token));
    } catch (e) {
      setErro(e);
    } finally {
      setSenha('');
      setEnviando(false);
    }
  }
  return (
    <section className={CARTAO} aria-label="assinar pela Root">
      <Rotulo>contrato · assinatura da Root</Rotulo>
      <p className="mt-2 text-[12.5px] text-muted">Só o sócio titular cadastrado para assinar recebe o link, depois de confirmar a senha. A assinatura volta pelo provedor e entra no fio.</p>
      <label className="mt-2 block text-[12.5px]">
        sua senha
        <input type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} className={`mt-1 ${INPUT}`} />
      </label>
      <button type="button" className={`mt-2 ${BOTAO}`} disabled={!senha || enviando} onClick={() => void pedir()}>{enviando ? 'conferindo…' : 'assinar pela Root'}</button>
      {r && (
        <p className="mt-2 text-[12.5px]">
          {r.assinadoRootEm ? `Assinado pela Root em ${diaSP(r.assinadoRootEm)} ${horaSP(r.assinadoRootEm)}.` : r.linkAssinatura ? (
            <a href={r.linkAssinatura} target="_blank" rel="noreferrer" className="underline decoration-brand">abrir o link de assinatura</a>
          ) : 'O link de assinatura da Root ainda não chegou do provedor.'}
        </p>
      )}
      <div className="mt-2"><Erro erro={erro} /></div>
    </section>
  );
}

function RegistrarSaida({ leadId, aoMudar }: { leadId: string; aoMudar: () => Promise<void> }) {
  const { token } = useAuth();
  const [aberto, setAberto] = useState(false);
  const [saida, setSaida] = useState<ComercialSaida>('geladeira');
  const [motivo, setMotivo] = useState<ComercialMotivoDeSaida>('momento');
  const [detalhe, setDetalhe] = useState('');
  const [volta, setVolta] = useState('');
  const [parceiro, setParceiro] = useState('');
  const [erro, setErro] = useState<unknown>(null);
  const [ok, setOk] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const problema = problemaDaSaida({ saida, volta, parceiro });

  async function registrar() {
    setErro(null);
    if (problema || enviando) return;
    setEnviando(true);
    const corpo: Record<string, string> = { saida, motivo };
    if (detalhe.trim()) corpo.detalhe = detalhe.trim();
    if (saida === 'geladeira' && volta) {
      const iso = localSPParaIso(`${volta}T09:00`);
      if (iso) corpo.voltaEm = iso;
    }
    if (saida === 'parceiro' && parceiro.trim()) corpo.parceiro = parceiro.trim();
    try {
      await apiPost(`/comercial/lead/${leadId}/saida`, corpo, token);
      setOk(true);
      await aoMudar();
    } catch (e) {
      setErro(e);
    } finally {
      setEnviando(false);
    }
  }

  const ROTULO_DA_SAIDA: Record<ComercialSaida, string> = { desqualificado: 'desqualificado', geladeira: 'geladeira', perdido: 'perdido', parceiro: 'enviado a parceiro' };

  return (
    <section className={CARTAO} aria-label="saída">
      <Rotulo>saída com motivo</Rotulo>
      {!aberto ? (
        <button type="button" className={`mt-2 ${BOTAO}`} onClick={() => setAberto(true)}>registrar saída</button>
      ) : (
        <div className="mt-2 space-y-2 text-[12.5px]">
          <p className="text-muted">A saída é um fato no fio, com motivo e dono. Só a desqualificação é definitiva.</p>
          <label className="block">saída
            <select className={INPUT} value={saida} onChange={(e) => setSaida(e.target.value as ComercialSaida)}>
              {COMERCIAL_SAIDAS.map((s) => <option key={s} value={s}>{ROTULO_DA_SAIDA[s]}</option>)}
            </select>
          </label>
          <label className="block">motivo
            <select className={INPUT} value={motivo} onChange={(e) => setMotivo(e.target.value as ComercialMotivoDeSaida)}>
              {COMERCIAL_MOTIVOS_DE_SAIDA.map((m) => <option key={m} value={m}>{ROTULO_DO_MOTIVO[m]}</option>)}
            </select>
          </label>
          {saida === 'geladeira' && (
            <label className="block">volta em
              <input type="date" required min={diaSeguinte(diaDeHojeSP())} className={INPUT} value={volta} onChange={(e) => setVolta(e.target.value)} />
            </label>
          )}
          {saida === 'parceiro' && (
            <label className="block">para quem
              <input className={INPUT} value={parceiro} onChange={(e) => setParceiro(e.target.value)} maxLength={120} />
            </label>
          )}
          <label className="block">detalhe (opcional)
            <input className={INPUT} value={detalhe} onChange={(e) => setDetalhe(e.target.value)} maxLength={400} />
          </label>
          {problema && <p className="text-[12px] text-warn">{problema}</p>}
          <div className="flex gap-2">
            <button type="button" className={BOTAO} disabled={!!problema || enviando} onClick={() => void registrar()}>{enviando ? 'registrando…' : 'registrar'}</button>
            <button type="button" className={BOTAO} onClick={() => setAberto(false)}>cancelar</button>
          </div>
          {ok && <Aviso tom="bom">Saída registrada no fio.</Aviso>}
          <Erro erro={erro} />
        </div>
      )}
    </section>
  );
}
