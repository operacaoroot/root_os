'use client';

/*
 * ABA FIO (era a tela 05, `lead/[id]`). A ficha é a LEITURA do fio: nada nela
 * é digitado, cada linha veio de um evento com a fonte marcada. O que o fio
 * não trouxe aparece como ausente. A única escrita daqui é registrar uma
 * SAÍDA, que é um fato com motivo e dono (não um campo), conferido pela API.
 */
import { useState } from 'react';
import type { ComercialMotivoDeSaida, ComercialSaida, FichaDoLead } from '@mktos/shared';
import { COMERCIAL_MOTIVOS_DE_SAIDA, COMERCIAL_ROTULO_DA_ETAPA, COMERCIAL_SAIDAS, ehSaida } from '@mktos/shared';

import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { localSPParaIso } from '@/lib/sala-do-cliente';
import {
  AUSENTE,
  ROTULO_DA_FONTE,
  ROTULO_DO_MOTIVO,
  ROTULO_DO_PRODUTO,
  diaDeHojeSP,
  diaSeguinte,
  diaSemanaSP,
  fioPorDia,
  horaSP,
  instantesLegiveis,
  numeroOuAusente,
  problemaDaSaida,
  quandoCurtoSP,
  quandoRoda,
  reaisOuAusente,
} from '@/lib/cockpit';

import { BOTAO, BOTAO_PRIMARIO, CARTAO, Carregando, Chip, ErroDaAcao, INPUT, Rotulo } from '../_ui';
import { usePainel } from './provedor';

export function AbaFio({ leadId, ficha: f, carregando, aoMudar }: { leadId: string; ficha: FichaDoLead | null; carregando: boolean; aoMudar: () => Promise<void> }) {
  const painel = usePainel();
  if (carregando) return <Carregando linhas={4} />;
  if (!f) return null;

  const dados: string[] = [
    f.cnpj ? `CNPJ ${f.cnpj}` : 'CNPJ ausente',
    f.sistemaErp ?? 'sistema ausente',
    f.baseDados == null ? 'base ausente' : f.baseDados ? 'base organizada' : 'sem base',
    f.perfil ?? 'perfil ausente',
    `pontuação ${numeroOuAusente(f.pontuacao)}`,
    `sócio da conta: ${f.socioDaConta?.nome ?? AUSENTE}`,
  ];
  const proxima = f.portao.proxima ? COMERCIAL_ROTULO_DA_ETAPA[f.portao.proxima] : null;
  // O fio do mais recente para o mais antigo: a linha que uma ação acabou de gravar aparece em cima.
  const dias = fioPorDia(f.fio).reverse().map((g) => ({ ...g, linhas: [...g.linhas].reverse() }));

  return (
    <div className="space-y-4">
      <section aria-label="ficha" className="space-y-1 text-[12.5px] text-muted">
        <p>{dados.join(' · ')}</p>
        <p className="tabular-nums">
          {f.produto ? ROTULO_DO_PRODUTO[f.produto] : 'produto ausente'} · {reaisOuAusente(f.valorCentavos)}
          {f.parcelas ? ` · ${f.parcelas}×` : ''} · proposta {f.propostaVersao ? `v${f.propostaVersao}` : AUSENTE}
          {f.validade ? ` · vale até ${quandoCurtoSP(f.validade)}` : ''}
          {f.motivoSaida ? ` · motivo ${ROTULO_DO_MOTIVO[f.motivoSaida]}` : ''}
          {f.voltaEm ? ` · volta ${quandoCurtoSP(f.voltaEm)}` : ''}
        </p>
        <p className="text-dim">
          {f.telefone ?? 'telefone ausente'} · {f.email ?? 'e-mail ausente'} · na etapa desde {quandoCurtoSP(f.etapaDesde)}
        </p>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <section className={CARTAO} aria-label="próxima ação">
          <Rotulo>próxima ação</Rotulo>
          {f.proximaAcao ? (
            <p className="mt-2 text-[13px]">
              {f.proximaAcao.descricao}
              {f.proximaAcao.quando && (
                <span className="text-muted tabular-nums"> · {quandoRoda(f.proximaAcao.quando)} ({quandoCurtoSP(f.proximaAcao.quando)})</span>
              )}
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
      </div>

      {f.etapa === 'contrato' && (
        <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
          O contrato espera assinaturas.
          <button type="button" className={BOTAO} onClick={() => painel.trocarAba('dinheiro')}>ver as assinaturas em Dinheiro</button>
        </p>
      )}

      <section aria-label="o fio" className={CARTAO}>
        <Rotulo>o fio · do mais recente ao primeiro contato</Rotulo>
        {f.fio.length === 0 && <p className="mt-2 text-[12.5px] text-muted">O fio ainda não tem eventos. O primeiro chega com a mensagem do lead.</p>}
        <ol className="mt-2 space-y-3">
          {dias.map((g) => (
            <li key={g.dia}>
              <p className="font-os-mono text-[11px] text-brand">
                D{g.dia}
                {g.linhas[0] && <span className="ml-2 text-dim">{diaSemanaSP(g.linhas[0].em)}</span>}
              </p>
              <ul className="mt-1 divide-y divide-border">
                {g.linhas.map((l) => (
                  <li key={l.eventoId} data-linha-do-fio={l.type} className="grid grid-cols-[44px_58px_minmax(0,1fr)] gap-2 py-1.5 text-[12.5px]">
                    <span className="font-os-mono tabular-nums text-muted">{horaSP(l.em)}</span>
                    <span className="font-os-mono text-[11px] text-info">{ROTULO_DA_FONTE[l.fonte] ?? l.fonte}</span>
                    <span className="min-w-0 break-words" title={l.type}>{instantesLegiveis(l.resumo)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>

      <section className={CARTAO} aria-label="ligado a">
        <Rotulo>ligado a</Rotulo>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          <li><Chip tom={f.ligadoA.sala ? 'bom' : 'neutro'}>sala {f.ligadoA.sala ? '· aberta' : '· ainda não'}</Chip></li>
          <li><Chip tom={f.ligadoA.ata ? 'bom' : 'neutro'}>ata {f.ligadoA.ata ? '· recebida' : '· ainda não'}</Chip></li>
          <li><Chip tom={f.ligadoA.proposta ? 'bom' : 'neutro'}>{f.ligadoA.proposta ? `proposta v${f.ligadoA.proposta}` : 'proposta · ainda não'}</Chip></li>
          <li><Chip tom={f.ligadoA.contrato ? 'bom' : 'neutro'}>contrato {f.ligadoA.contrato ? `· ${f.ligadoA.contrato}` : '· ainda não'}</Chip></li>
          <li><Chip tom={f.ligadoA.cobranca ? 'bom' : 'neutro'}>Asaas {f.ligadoA.cobranca ? `· ${f.ligadoA.cobranca}` : '· ainda não'}</Chip></li>
          {f.ligadoA.implantacao ? (
            <>
              <li>
                <a href={`/trabalho?lista=${f.ligadoA.implantacao.listId}&tarefa=${f.ligadoA.implantacao.cardId}`} data-testid="lead-card-implantacao" className="underline-offset-2 hover:underline">
                  <Chip tom="bom">implantação · {f.ligadoA.implantacao.etapa}</Chip>
                </a>
              </li>
              {f.ligadoA.implantacao.trilhoId && (
                <li>
                  <a href={`/onboarding/${f.ligadoA.implantacao.trilhoId}`} className="underline-offset-2 hover:underline"><Chip tom="bom">trilho de onboarding</Chip></a>
                </li>
              )}
            </>
          ) : (
            <li><Chip tom="neutro">implantação · nasce no fechamento</Chip></li>
          )}
        </ul>
      </section>

      {!ehSaida(f.etapa) && f.etapa !== 'fechado' && <RegistrarSaida leadId={leadId} aoMudar={aoMudar} />}
    </div>
  );
}

const ROTULO_DA_SAIDA: Record<ComercialSaida, string> = { desqualificado: 'desqualificado', geladeira: 'geladeira', perdido: 'perdido', parceiro: 'enviado a parceiro' };

function RegistrarSaida({ leadId, aoMudar }: { leadId: string; aoMudar: () => Promise<void> }) {
  const { token } = useAuth();
  const painel = usePainel();
  const [aberto, setAberto] = useState(false);
  const [saida, setSaida] = useState<ComercialSaida>('geladeira');
  const [motivo, setMotivo] = useState<ComercialMotivoDeSaida>('momento');
  const [detalhe, setDetalhe] = useState('');
  const [volta, setVolta] = useState('');
  const [parceiro, setParceiro] = useState('');
  const [erro, setErro] = useState<unknown>(null);
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
      setDetalhe('');
      setParceiro('');
      setAberto(false);
      painel.avisar(`Saída registrada no fio: ${ROTULO_DA_SAIDA[saida]}, ${ROTULO_DO_MOTIVO[motivo]}.`);
      await aoMudar();
    } catch (e) {
      setErro(e);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className={CARTAO} aria-label="saída">
      <Rotulo>saída com motivo</Rotulo>
      {!aberto ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className={BOTAO} onClick={() => setAberto(true)}>Registrar saída</button>
          <span className="text-[12px] text-dim">Só a desqualificação é definitiva.</span>
        </div>
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
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={BOTAO_PRIMARIO} disabled={!!problema || enviando} onClick={() => void registrar()}>{enviando ? 'Registrando…' : 'Registrar'}</button>
            <button type="button" className={BOTAO} onClick={() => { setAberto(false); setDetalhe(''); setParceiro(''); }}>Cancelar</button>
          </div>
          <ErroDaAcao erro={erro} />
        </div>
      )}
    </section>
  );
}
