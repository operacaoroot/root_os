'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiGet, apiPatch, apiPost, apiPut, apiUpload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Botao, Campo, Card, Chip, inputCls } from '../../referencias/ui';
import {
  ROTULO_DA_FASE,
  ROTULO_DO_BLOCO,
  ROTULO_DO_NIVEL,
  dataBR,
  dataHoraBR,
  paraInputDate,
  type ConviteGerado,
  type ConviteNaBancada,
  type ItemNaBancada,
  type MensagensDoConvite,
  type Portoes,
  type ResultadoDaLeitura,
  type RetratoDoTrilho,
  type TrilhoCompleto,
} from '../tipos';

/*
 * A BANCADA DE UM TRILHO — tudo o que a Root faz com um cliente na esteira.
 *
 * A tela é a MESMA para as cinco fases; o que muda é qual seção está em
 * evidência. Cada seção fala com uma rota do `TrilhosController`, e nenhuma
 * decide nada sozinha: o portão é do código (`fases.ts`), a regra de corte é
 * do serviço, a mensagem sai pronta para copiar.
 */

type Aba = 'fase' | 'formulario' | 'linha-do-tempo';

const PERFIS = ['P1', 'P2', 'P3', 'nao-entra'] as const;
const NIVEIS = ['beaba', 'avancar-junto', 'entregar-pronto'] as const;
const dataInput = (v: string) => (v ? new Date(`${v}T12:00:00`).toISOString() : null);
const hoje = () => new Date().toISOString().slice(0, 10);

export default function TrilhoPage() {
  const { id } = useParams<{ id: string }>();
  const { token, ready, can } = useAuth();
  const editavel = can('tarefas.editar');
  const [t, setT] = useState<TrilhoCompleto | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>('fase');

  const carregar = useCallback(() => {
    if (!token) return;
    apiGet<TrilhoCompleto>(`/tenants/onboarding/trilhos/${id}`, token).then(setT).catch((e: Error) => setErro(e.message));
  }, [id, token]);

  useEffect(() => {
    if (ready) carregar();
  }, [ready, carregar]);

  /** Toda ação passa por aqui: trava o botão, recarrega, mostra o erro em português. */
  async function agir<T>(chave: string, fn: () => Promise<T>, depois?: (r: T) => void): Promise<T | undefined> {
    if (!token) return undefined;
    setErro(null);
    setAviso(null);
    setOcupado(chave);
    try {
      const r = await fn();
      depois?.(r);
      carregar();
      return r;
    } catch (e) {
      const err = e as Error & { body?: { faltando?: string[]; temas?: string[] } };
      setErro(err.message);
      return undefined;
    } finally {
      setOcupado(null);
    }
  }

  const patch = (dados: Record<string, unknown>) => agir('patch', () => apiPatch(`/tenants/onboarding/trilhos/${id}`, dados, token));

  if (!ready) return null;
  if (!t) return <p className="text-sm text-muted">{erro ?? 'carregando…'}</p>;

  const encerrado = t.fase === 'encerrado';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/onboarding" className="text-[11px] text-muted underline underline-offset-2">← onboarding</Link>
          <h1 className="text-xl font-semibold">{t.cliente}</h1>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Chip tone={encerrado ? 'muted' : 'brand'}>{t.faseRotulo}</Chip>
            {t.perfil && <Chip tone="muted">{t.perfil}</Chip>}
            {t.nivelRotulo && <Chip tone="muted">{t.nivelRotulo}</Chip>}
            {t.receitaDetalhe && <Chip tone="muted">{t.receitaDetalhe.nome}</Chip>}
            {t.empresaId && <Chip tone="good">empresa no OS</Chip>}
            {t.cardId && <Link href="/trabalho"><Chip tone="muted">cartão na esteira</Chip></Link>}
          </div>
          <p className="mt-1 text-[12px] text-muted">
            {t.contatoNome ?? 'sem contato'}{t.contatoWhatsapp ? ` · ${t.contatoWhatsapp}` : ''}{t.contatoEmail ? ` · ${t.contatoEmail}` : ''} · conduz {t.conduzidoPor ?? '?'}{t.implantadoPor ? ` · implanta ${t.implantadoPor}` : ''}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-2">
            <Link href={`/onboarding/${id}/roteiro`}><Botao>Roteiro do kickoff</Botao></Link>
            {editavel && !encerrado && (
              <Botao tone="brand" disabled={!t.podeAvancar || ocupado === 'avancar'} onClick={() => agir('avancar', () => apiPost(`/tenants/onboarding/trilhos/${id}/avancar`, {}, token))} title={t.podeAvancar ? `Avança para ${t.proxima ? ROTULO_DA_FASE[t.proxima] : ''}` : `Falta: ${t.faltando.join('; ')}`}>
                {t.proxima ? `Avançar → ${ROTULO_DA_FASE[t.proxima]}` : 'Avançar'}
              </Botao>
            )}
            {editavel && !encerrado && <BotaoEncerrar onEncerrar={(motivo) => agir('encerrar', () => apiPost(`/tenants/onboarding/trilhos/${id}/encerrar`, { motivo }, token))} />}
          </div>
          {!t.podeAvancar && !encerrado && (
            <ul className="text-right text-[11px] text-muted">
              {t.faltando.map((f) => <li key={f}>· {f}</li>)}
            </ul>
          )}
        </div>
      </div>

      {erro && <p className="rounded-lg border border-bad/40 bg-bad/10 p-2 text-sm text-bad">{erro}</p>}
      {aviso && <p className="rounded-lg border border-good/40 bg-good/10 p-2 text-sm text-good">{aviso}</p>}

      <div className="flex gap-1 border-b border-border">
        {(['fase', 'formulario', 'linha-do-tempo'] as Aba[]).map((a) => (
          <button key={a} type="button" onClick={() => setAba(a)} className={`px-3 py-2 text-sm ${aba === a ? 'border-b-2 border-brand font-medium' : 'text-muted hover:text-text'}`}>
            {a === 'fase' ? 'A fase e os portões' : a === 'formulario' ? `O formulário (${t.itens.respondidos} respondidos)` : `Linha do tempo (${t.marcos.length})`}
          </button>
        ))}
      </div>

      {aba === 'fase' && (
        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <div className="space-y-4">
            <Portoes t={t} editavel={editavel && !encerrado} onPatch={patch} ocupado={ocupado} />
            {t.pendenciasDoRelogio.length > 0 && (
              <Card titulo="O relógio — vencido hoje">
                <ul className="space-y-1 text-[13px]">
                  {t.pendenciasDoRelogio.map((p, i) => <li key={i}><Chip tone="warn">{p.tipo}</Chip> <span className="text-muted">{p.texto}</span></li>)}
                </ul>
              </Card>
            )}
            {t.fase === 'qualificar' && <SecaoTriagem t={t} editavel={editavel} agir={agir} token={token} />}
            {(t.fase === 'qualificar' || t.fase === 'diagnostico') && <SecaoDossie t={t} editavel={editavel} agir={agir} token={token} />}
            {t.fase === 'contrato' && <SecaoAta t={t} editavel={editavel} agir={agir} token={token} setAviso={setAviso} />}
            {t.fase === 'contrato' && <SecaoLinkBCD t={t} editavel={editavel} agir={agir} token={token} />}
            {t.fase === 'contrato' && <SecaoBoasVindas t={t} token={token} />}
            {(t.fase === 'contrato' || t.fase === 'imersao' || t.fase === 'operacao') && <SecaoMemoria t={t} editavel={editavel} agir={agir} token={token} setAviso={setAviso} />}
            {t.fase === 'imersao' && t.receitaDetalhe && (
              <Card titulo={`Pauta dos dois dias — ${t.receitaDetalhe.nome}`}>
                <div className="grid gap-3 md:grid-cols-2">
                  {(['dia1', 'dia2'] as const).map((d) => (
                    <div key={d}>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{d === 'dia1' ? 'Dia 1' : 'Dia 2'}</p>
                      <ol className="mt-1 list-decimal space-y-1 pl-5 text-[13px]">{t.receitaDetalhe!.pautaDaImersao[d].map((x, i) => <li key={i}>{x}</li>)}</ol>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[12px] text-muted">Critério de saída: {t.receitaDetalhe.criterioDeSaida}</p>
                {editavel && (
                  <div className="mt-3 flex gap-2">
                    {['imersao.dia1', 'imersao.dia2', 'imersao.duvida'].map((tipo) => (
                      <BotaoMarco key={tipo} tipo={tipo} rotulo={tipo === 'imersao.dia1' ? 'Registrar dia 1' : tipo === 'imersao.dia2' ? 'Registrar dia 2' : 'Dúvida/objeção (glossário)'} onRegistrar={(texto) => agir(tipo, () => apiPost(`/tenants/onboarding/trilhos/${id}/marcos`, { tipo, texto }, token))} />
                    ))}
                  </div>
                )}
              </Card>
            )}
            {t.fase === 'operacao' && editavel && (
              <Card titulo="Operação assistida — a rotina">
                <div className="flex flex-wrap gap-2">
                  <BotaoMarco tipo="check.semanal" rotulo="Check semanal feito" onRegistrar={(texto) => agir('check', () => apiPost(`/tenants/onboarding/trilhos/${id}/marcos`, { tipo: 'check.semanal', texto }, token))} />
                  <BotaoMarco tipo="retrospectiva" rotulo="Retrospectiva interna" onRegistrar={(texto) => agir('retro', () => apiPost(`/tenants/onboarding/trilhos/${id}/marcos`, { tipo: 'retrospectiva', texto }, token))} />
                  <BotaoMarco tipo="contato.ativo" rotulo="Contato ativo feito" onRegistrar={(texto) => agir('contato', () => apiPost(`/tenants/onboarding/trilhos/${id}/marcos`, { tipo: 'contato.ativo', texto }, token))} />
                </div>
                <p className="mt-2 text-[12px] text-muted">A retrospectiva responde: o que foi improvisado ao vivo e devia ser padrão? A resposta volta para a receita.</p>
              </Card>
            )}
          </div>
          <div className="space-y-4">
            <Dados t={t} editavel={editavel && !encerrado} onPatch={patch} ocupado={ocupado} />
            <ProximoPasso t={t} editavel={editavel && !encerrado} onPatch={patch} ocupado={ocupado} />
            {t.receitaDetalhe && (
              <Card titulo="A receita">
                <p className="text-[13px]"><span className="font-medium">{t.receitaDetalhe.nome}</span> <Chip tone={t.receitaDetalhe.estado === 'inteira' ? 'good' : 'warn'}>{t.receitaDetalhe.estado}</Chip></p>
                <p className="mt-1 text-[12px] text-muted">Dor: {t.receitaDetalhe.dor}</p>
                <p className="mt-1 text-[12px] text-muted">Métrica: {t.receitaDetalhe.metricaDaLinhaDeBase}</p>
                <p className="mt-1 text-[12px] text-muted">Régua: {t.receitaDetalhe.nivelNaRegua}</p>
              </Card>
            )}
          </div>
        </div>
      )}

      {aba === 'formulario' && <Formulario t={t} editavel={editavel && !encerrado} agir={agir} token={token} />}

      {aba === 'linha-do-tempo' && (
        <Card titulo="Linha do tempo">
          <ul className="space-y-2">
            {t.marcos.map((m) => (
              <li key={m.id} className="border-b border-border pb-2 text-[13px] last:border-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-os-mono text-[11px] text-muted">{dataHoraBR(m.em)}</span>
                  <Chip tone={m.tipo.startsWith('fase') ? 'brand' : m.tipo.startsWith('alerta') || m.tipo.startsWith('convite.cobranca') ? 'bad' : m.tipo.startsWith('convite.lembrete') ? 'warn' : 'muted'}>{m.tipo}</Chip>
                  <span className="text-[11px] text-muted">{m.quem}</span>
                </div>
                <p className="mt-0.5">{m.texto}</p>
                {m.dados.mensagemPronta === true && (
                  <p className="mt-1 text-[11px] text-muted">Mensagem pronta em “Mensagens prontas”, no convite (aba “A fase e os portões”).</p>
                )}
                {typeof m.dados.aviso === 'string' && <p className="mt-1 text-[11px] text-warn">{m.dados.aviso}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pedaços
// ---------------------------------------------------------------------------

type Agir = <T>(chave: string, fn: () => Promise<T>, depois?: (r: T) => void) => Promise<T | undefined>;

function BotaoEncerrar({ onEncerrar }: { onEncerrar: (motivo: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState('');
  if (!aberto) return <Botao tone="bad" onClick={() => setAberto(true)}>Encerrar</Botao>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); onEncerrar(motivo); setAberto(false); }} className="flex gap-1">
      <input className={inputCls} placeholder="por quê?" minLength={4} required value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      <Botao tone="bad" type="submit">Confirmar</Botao>
      <Botao tone="ghost" onClick={() => setAberto(false)}>×</Botao>
    </form>
  );
}

function BotaoMarco({ tipo, rotulo, onRegistrar }: { tipo: string; rotulo: string; onRegistrar: (texto: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState('');
  if (!aberto) return <Botao onClick={() => setAberto(true)} title={tipo}>{rotulo}</Botao>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); onRegistrar(texto.trim() || rotulo); setTexto(''); setAberto(false); }} className="flex gap-1">
      <input className={inputCls} placeholder="o que aconteceu (uma linha)" value={texto} onChange={(e) => setTexto(e.target.value)} />
      <Botao type="submit" tone="brand">Registrar</Botao>
      <Botao tone="ghost" onClick={() => setAberto(false)}>×</Botao>
    </form>
  );
}

function Dados({ t, editavel, onPatch, ocupado }: { t: TrilhoCompleto; editavel: boolean; onPatch: (d: Record<string, unknown>) => void; ocupado: string | null }) {
  const [f, setF] = useState({
    cliente: t.cliente, contatoNome: t.contatoNome ?? '', contatoWhatsapp: t.contatoWhatsapp ?? '', contatoEmail: t.contatoEmail ?? '',
    perfil: t.perfil ?? '', nivel: t.nivel ?? '', receita: t.receita ?? '', conduzidoPor: t.conduzidoPor ?? '', implantadoPor: t.implantadoPor ?? '',
    reuniaoEm: paraInputDate(t.reuniaoEm), kickoffEm: paraInputDate(t.kickoffEm), imersaoEm: paraInputDate(t.imersaoEm), grupoJid: t.grupoJid ?? '', observacoes: t.observacoes ?? '',
  });
  useEffect(() => {
    setF({
      cliente: t.cliente, contatoNome: t.contatoNome ?? '', contatoWhatsapp: t.contatoWhatsapp ?? '', contatoEmail: t.contatoEmail ?? '',
      perfil: t.perfil ?? '', nivel: t.nivel ?? '', receita: t.receita ?? '', conduzidoPor: t.conduzidoPor ?? '', implantadoPor: t.implantadoPor ?? '',
      reuniaoEm: paraInputDate(t.reuniaoEm), kickoffEm: paraInputDate(t.kickoffEm), imersaoEm: paraInputDate(t.imersaoEm), grupoJid: t.grupoJid ?? '', observacoes: t.observacoes ?? '',
    });
  }, [t]);
  const salvar = (e: FormEvent) => {
    e.preventDefault();
    onPatch({
      cliente: f.cliente, contatoNome: f.contatoNome || null, contatoWhatsapp: f.contatoWhatsapp || null, contatoEmail: f.contatoEmail || null,
      perfil: f.perfil || null, nivel: f.nivel || null, receita: f.receita || null, conduzidoPor: f.conduzidoPor || null, implantadoPor: f.implantadoPor || null,
      reuniaoEm: dataInput(f.reuniaoEm), kickoffEm: dataInput(f.kickoffEm), imersaoEm: dataInput(f.imersaoEm), grupoJid: f.grupoJid || null, observacoes: f.observacoes || null,
    });
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Card titulo="O cliente">
      <form onSubmit={salvar} className="grid gap-2 md:grid-cols-2">
        <Campo label="Cliente"><input className={inputCls} value={f.cliente} onChange={set('cliente')} disabled={!editavel} /></Campo>
        <Campo label="Contato"><input className={inputCls} value={f.contatoNome} onChange={set('contatoNome')} disabled={!editavel} /></Campo>
        <Campo label="WhatsApp"><input className={inputCls} value={f.contatoWhatsapp} onChange={set('contatoWhatsapp')} disabled={!editavel} /></Campo>
        <Campo label="E-mail"><input className={inputCls} type="email" value={f.contatoEmail} onChange={set('contatoEmail')} disabled={!editavel} /></Campo>
        <Campo label="Perfil (ICP)">
          <select className={inputCls} value={f.perfil} onChange={set('perfil')} disabled={!editavel}><option value="">—</option>{PERFIS.map((p) => <option key={p} value={p}>{p}</option>)}</select>
        </Campo>
        <Campo label="Nível de oferta">
          <select className={inputCls} value={f.nivel} onChange={set('nivel')} disabled={!editavel}><option value="">—</option>{NIVEIS.map((n) => <option key={n} value={n}>{ROTULO_DO_NIVEL[n]}</option>)}</select>
        </Campo>
        <Campo label="Receita (a frente)">
          <select className={inputCls} value={f.receita} onChange={set('receita')} disabled={!editavel}><option value="">—</option>{t.receitas.map((r) => <option key={r.chave} value={r.chave}>{r.nome}{r.estado === 'semente' ? ' (semente)' : ''}</option>)}</select>
        </Campo>
        <Campo label="Conduz"><input className={inputCls} value={f.conduzidoPor} onChange={set('conduzidoPor')} disabled={!editavel} /></Campo>
        <Campo label="Implanta"><input className={inputCls} value={f.implantadoPor} onChange={set('implantadoPor')} disabled={!editavel} /></Campo>
        <Campo label="Grupo (JID)"><input className={inputCls} value={f.grupoJid} onChange={set('grupoJid')} disabled={!editavel} /></Campo>
        <Campo label="Reunião (diagnóstico)"><input className={inputCls} type="date" value={f.reuniaoEm} onChange={set('reuniaoEm')} disabled={!editavel} /></Campo>
        <Campo label="Kickoff"><input className={inputCls} type="date" value={f.kickoffEm} onChange={set('kickoffEm')} disabled={!editavel} /></Campo>
        <Campo label="Imersão"><input className={inputCls} type="date" value={f.imersaoEm} onChange={set('imersaoEm')} disabled={!editavel} /></Campo>
        <div className="md:col-span-2"><Campo label="Observações"><textarea className={inputCls} rows={2} value={f.observacoes} onChange={set('observacoes')} disabled={!editavel} /></Campo></div>
        {editavel && <div className="md:col-span-2"><Botao type="submit" tone="brand" disabled={ocupado === 'patch'}>Salvar</Botao></div>}
      </form>
    </Card>
  );
}

function ProximoPasso({ t, editavel, onPatch, ocupado }: { t: TrilhoCompleto; editavel: boolean; onPatch: (d: Record<string, unknown>) => void; ocupado: string | null }) {
  const [f, setF] = useState({ texto: t.proximoPasso ?? '', dono: t.proximoPassoDono ?? '', data: paraInputDate(t.proximoPassoEm) });
  useEffect(() => setF({ texto: t.proximoPasso ?? '', dono: t.proximoPassoDono ?? '', data: paraInputDate(t.proximoPassoEm) }), [t]);
  return (
    <Card titulo="Próximo passo — com dono e data">
      {!t.proximoPasso && <p className="mb-2 text-[12px] text-bad">Estado sem próximo passo é alerta. Toda fase termina com um.</p>}
      <form onSubmit={(e) => { e.preventDefault(); onPatch({ proximoPasso: f.texto || null, proximoPassoDono: f.dono || null, proximoPassoEm: dataInput(f.data) }); }} className="grid gap-2 md:grid-cols-[1fr_140px_140px_auto]">
        <input className={inputCls} placeholder="o que" value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} disabled={!editavel} />
        <input className={inputCls} placeholder="dono" value={f.dono} onChange={(e) => setF({ ...f, dono: e.target.value })} disabled={!editavel} />
        <input className={inputCls} type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} disabled={!editavel} />
        {editavel && <Botao type="submit" disabled={ocupado === 'patch'}>Salvar</Botao>}
      </form>
    </Card>
  );
}

function Portoes({ t, editavel, onPatch, ocupado }: { t: TrilhoCompleto; editavel: boolean; onPatch: (d: Record<string, unknown>) => void; ocupado: string | null }) {
  const p = t.portoes;
  const [dupla, setDupla] = useState({ dono: p.dupla?.donoPerguntas?.nome ?? '', donoPapel: p.dupla?.donoPerguntas?.papel ?? '', guardiao: p.dupla?.guardiaoAcesso?.nome ?? '', guardiaoPapel: p.dupla?.guardiaoAcesso?.papel ?? '' });
  const [lb, setLb] = useState({ metrica: p.linhaDeBase?.metrica ?? t.receitaDetalhe?.metricaDaLinhaDeBase ?? '', valor: p.linhaDeBase?.valor?.toString() ?? '', unidade: p.linhaDeBase?.unidade ?? '', medidoEm: p.linhaDeBase?.medidoEm ?? hoje(), quemMediu: p.linhaDeBase?.quemMediu ?? '' });
  const [crit, setCrit] = useState({ atingidoEm: p.criterioDeSaida?.atingidoEm ?? hoje(), evidencia: p.criterioDeSaida?.evidencia ?? '' });
  const [d30, setD30] = useState({ valor: p.medicaoDia30?.valor?.toString() ?? '', medidoEm: p.medicaoDia30?.medidoEm ?? hoje(), quemMediu: p.medicaoDia30?.quemMediu ?? '' });
  const [ad, setAd] = useState({ antes: p.antesDepois?.antes?.toString() ?? p.linhaDeBase?.valor?.toString() ?? '', depois: p.antesDepois?.depois?.toString() ?? p.medicaoDia30?.valor?.toString() ?? '', unidade: p.antesDepois?.unidade ?? p.linhaDeBase?.unidade ?? '' });

  const marcarData = (chave: keyof Portoes, limpar = false) => onPatch({ portoes: { [chave]: limpar ? null : hoje() } });
  const fase = t.fase;
  const mostra = (chaves: string[]) => chaves.includes(fase);

  return (
    <Card titulo={`Os portões da fase ${t.faseRotulo}`}>
      <ul className="space-y-1.5">
        {t.portoesNaTela.map((g) => (
          <li key={g.chave} className="flex items-start gap-2 text-[13px]">
            <span className={g.cumprido ? 'text-good' : 'text-muted'}>{g.cumprido ? '●' : '○'}</span>
            <div className="flex-1">
              <span className={g.cumprido ? '' : 'text-text'}>{g.rotulo}</span>
              {g.detalhe && <span className="ml-2 text-[11.5px] text-muted">{g.detalhe}</span>}
            </div>
          </li>
        ))}
      </ul>

      {editavel && (
        <div className="mt-4 space-y-3 border-t border-border pt-3">
          {mostra(['diagnostico']) && (
            <BotaoData rotulo="Proposta enviada" valor={p.propostaEnviadaEm} onMarcar={() => marcarData('propostaEnviadaEm')} onLimpar={() => marcarData('propostaEnviadaEm', true)} ocupado={ocupado === 'patch'} />
          )}
          {mostra(['contrato']) && (
            <>
              <BotaoData rotulo="Entrada compensada (card 02)" valor={p.entradaCompensadaEm} onMarcar={() => marcarData('entradaCompensadaEm')} onLimpar={() => marcarData('entradaCompensadaEm', true)} ocupado={ocupado === 'patch'} />
              <form onSubmit={(e) => { e.preventDefault(); onPatch({ portoes: { dupla: { donoPerguntas: { nome: dupla.dono, papel: dupla.donoPapel || undefined }, guardiaoAcesso: { nome: dupla.guardiao, papel: dupla.guardiaoPapel || undefined } } } }); }} className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
                <input className={inputCls} placeholder="dono das perguntas *" required value={dupla.dono} onChange={(e) => setDupla({ ...dupla, dono: e.target.value })} />
                <input className={inputCls} placeholder="papel" value={dupla.donoPapel} onChange={(e) => setDupla({ ...dupla, donoPapel: e.target.value })} />
                <input className={inputCls} placeholder="guardião do acesso *" required value={dupla.guardiao} onChange={(e) => setDupla({ ...dupla, guardiao: e.target.value })} />
                <input className={inputCls} placeholder="papel" value={dupla.guardiaoPapel} onChange={(e) => setDupla({ ...dupla, guardiaoPapel: e.target.value })} />
                <Botao type="submit">Dupla</Botao>
              </form>
              <form onSubmit={(e) => { e.preventDefault(); onPatch({ portoes: { linhaDeBase: { metrica: lb.metrica, valor: Number(lb.valor), unidade: lb.unidade || undefined, medidoEm: lb.medidoEm, quemMediu: lb.quemMediu } } }); }} className="grid gap-2 md:grid-cols-[1.4fr_90px_80px_130px_1fr_auto]">
                <input className={inputCls} placeholder="métrica *" required value={lb.metrica} onChange={(e) => setLb({ ...lb, metrica: e.target.value })} />
                <input className={inputCls} placeholder="valor *" required type="number" step="any" value={lb.valor} onChange={(e) => setLb({ ...lb, valor: e.target.value })} />
                <input className={inputCls} placeholder="unid." value={lb.unidade} onChange={(e) => setLb({ ...lb, unidade: e.target.value })} />
                <input className={inputCls} type="date" required value={lb.medidoEm} onChange={(e) => setLb({ ...lb, medidoEm: e.target.value })} />
                <input className={inputCls} placeholder="quem mediu *" required value={lb.quemMediu} onChange={(e) => setLb({ ...lb, quemMediu: e.target.value })} />
                <Botao type="submit">Linha de base</Botao>
              </form>
              {t.nivel !== 'beaba' && <BotaoData rotulo="Ambiente conferido no D-1 (card 15)" valor={p.ambienteOkEm} onMarcar={() => marcarData('ambienteOkEm')} onLimpar={() => marcarData('ambienteOkEm', true)} ocupado={ocupado === 'patch'} />}
            </>
          )}
          {mostra(['imersao']) && (
            <form onSubmit={(e) => { e.preventDefault(); onPatch({ portoes: { criterioDeSaida: { atingidoEm: crit.atingidoEm, evidencia: crit.evidencia } } }); }} className="grid gap-2 md:grid-cols-[130px_1fr_auto]">
              <input className={inputCls} type="date" required value={crit.atingidoEm} onChange={(e) => setCrit({ ...crit, atingidoEm: e.target.value })} />
              <input className={inputCls} placeholder="a evidência: o que aconteceu na frente do cliente *" required minLength={3} value={crit.evidencia} onChange={(e) => setCrit({ ...crit, evidencia: e.target.value })} />
              <Botao type="submit">Critério de saída</Botao>
            </form>
          )}
          {mostra(['operacao']) && (
            <>
              <form onSubmit={(e) => { e.preventDefault(); onPatch({ portoes: { medicaoDia30: { valor: Number(d30.valor), medidoEm: d30.medidoEm, quemMediu: d30.quemMediu } } }); }} className="grid gap-2 md:grid-cols-[110px_130px_1fr_auto]">
                <input className={inputCls} placeholder="valor dia 30 *" required type="number" step="any" value={d30.valor} onChange={(e) => setD30({ ...d30, valor: e.target.value })} />
                <input className={inputCls} type="date" required value={d30.medidoEm} onChange={(e) => setD30({ ...d30, medidoEm: e.target.value })} />
                <input className={inputCls} placeholder="quem mediu *" required value={d30.quemMediu} onChange={(e) => setD30({ ...d30, quemMediu: e.target.value })} />
                <Botao type="submit">Medição do dia 30</Botao>
              </form>
              <form onSubmit={(e) => { e.preventDefault(); onPatch({ portoes: { antesDepois: { antes: Number(ad.antes), depois: Number(ad.depois), unidade: ad.unidade || undefined, registradoEm: hoje() } } }); }} className="grid gap-2 md:grid-cols-[110px_110px_90px_auto]">
                <input className={inputCls} placeholder="antes *" required type="number" step="any" value={ad.antes} onChange={(e) => setAd({ ...ad, antes: e.target.value })} />
                <input className={inputCls} placeholder="depois *" required type="number" step="any" value={ad.depois} onChange={(e) => setAd({ ...ad, depois: e.target.value })} />
                <input className={inputCls} placeholder="unid." value={ad.unidade} onChange={(e) => setAd({ ...ad, unidade: e.target.value })} />
                <Botao type="submit">Antes/depois</Botao>
              </form>
              <BotaoData rotulo="Case escrito" valor={p.caseEm} onMarcar={() => marcarData('caseEm')} onLimpar={() => marcarData('caseEm', true)} ocupado={ocupado === 'patch'} />
              <BotaoData rotulo="Mensalidade proposta" valor={p.mensalidadePropostaEm} onMarcar={() => marcarData('mensalidadePropostaEm')} onLimpar={() => marcarData('mensalidadePropostaEm', true)} ocupado={ocupado === 'patch'} />
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function BotaoData({ rotulo, valor, onMarcar, onLimpar, ocupado }: { rotulo: string; valor: string | undefined; onMarcar: () => void; onLimpar: () => void; ocupado: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[13px]">
      <span>{rotulo}{valor ? <span className="ml-2 text-muted">· {valor}</span> : ''}</span>
      {valor ? <Botao tone="ghost" onClick={onLimpar} disabled={ocupado}>desfazer</Botao> : <Botao onClick={onMarcar} disabled={ocupado}>Marcar hoje</Botao>}
    </div>
  );
}

function SecaoTriagem({ t, editavel, agir, token }: { t: TrilhoCompleto; editavel: boolean; agir: Agir; token: string | null }) {
  const convite = t.convites.find((c) => c.blocos === 'A' && c.estado !== 'revogado');
  return (
    <Card titulo="Fase 0 · a triagem (bloco A) antes da 1ª reunião">
      <p className="text-[12.5px] text-muted">Cinco perguntas, 5 minutos, no celular. Vai no WhatsApp com prazo D-3 da reunião. Sem resposta em D-1, o relógio avisa.</p>
      <Convites t={t} blocos="A" convite={convite} editavel={editavel} agir={agir} token={token} />
    </Card>
  );
}

function Convites({ t, blocos, convite, editavel, agir, token }: { t: TrilhoCompleto; blocos: 'A' | 'BCD'; convite: ConviteNaBancada | undefined; editavel: boolean; agir: Agir; token: string | null }) {
  const [gerado, setGerado] = useState<ConviteGerado | null>(null);
  const [msgs, setMsgs] = useState<MensagensDoConvite | null>(null);
  const gerar = () => agir(`convite-${blocos}`, () => apiPost<ConviteGerado>(`/tenants/onboarding/trilhos/${t.id}/convites`, { blocos }, token), setGerado);
  const mensagens = (c: ConviteNaBancada) => agir(`msgs-${c.id}`, () => apiGet<MensagensDoConvite>(`/tenants/onboarding/trilhos/${t.id}/convites/${c.id}/mensagens`, token), setMsgs);
  const copiar = (s: string) => navigator.clipboard.writeText(s);
  return (
    <div className="mt-3 space-y-3">
      {gerado && (
        <div className="rounded-lg border border-brand/40 bg-brand/10 p-3">
          <p className="text-[12px] font-medium">Link gerado — ele aparece UMA vez aqui. Copie a mensagem e mande no grupo; depois marque como enviado.</p>
          {gerado.aprovadosPelaRegra > 0 && <p className="text-[11px] text-muted">{gerado.aprovadosPelaRegra} proposta(s) literal(is) aprovada(s) pela regra.</p>}
          <pre className="mt-2 whitespace-pre-wrap rounded bg-surface p-2 text-[12.5px]">{gerado.mensagem}</pre>
          <div className="mt-2 flex gap-2">
            <Botao tone="brand" onClick={() => copiar(gerado.mensagem)}>Copiar mensagem</Botao>
            <Botao onClick={() => copiar(gerado.link)}>Copiar só o link</Botao>
            <Botao onClick={() => agir('enviado', () => apiPost(`/tenants/onboarding/trilhos/${t.id}/convites/${gerado.conviteId}/enviado`, {}, token), () => setGerado(null))}>Marquei como enviado</Botao>
          </div>
        </div>
      )}
      {convite ? (
        <div className="rounded-lg border border-border bg-surface-2 p-3 text-[12.5px]">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={convite.estado === 'ativo' ? 'good' : convite.estado === 'concluido' ? 'brand' : 'muted'}>{convite.estado}</Chip>
            <span className="text-muted">válido até {dataBR(convite.validoAte)} · {convite.enviadoEm ? `enviado ${dataBR(convite.enviadoEm)}` : 'ainda não marcado como enviado'}{convite.lembradoEm ? ` · lembrete ${dataBR(convite.lembradoEm)}` : ''}{convite.concluidoEm ? ` · concluído ${dataBR(convite.concluidoEm)}` : ''} · {convite.acessos} acesso(s)</span>
          </div>
          {editavel && convite.estado === 'ativo' && (
            <div className="mt-2 flex flex-wrap gap-2">
              {!convite.enviadoEm && <Botao onClick={() => agir('enviado', () => apiPost(`/tenants/onboarding/trilhos/${t.id}/convites/${convite.id}/enviado`, {}, token))}>Marquei como enviado</Botao>}
              {convite.temLink && <Botao onClick={() => mensagens(convite)}>Mensagens prontas</Botao>}
              <Botao tone="bad" onClick={() => agir('revogar', () => apiPost(`/tenants/onboarding/trilhos/${t.id}/convites/${convite.id}/revogar`, {}, token))}>Revogar</Botao>
              <Botao onClick={gerar}>Gerar outro link</Botao>
            </div>
          )}
          {msgs && msgs.link && (
            <div className="mt-2 space-y-2">
              {[['Envio', msgs.envio], ['Lembrete (dia 3)', msgs.lembrete], ['Cobrança pessoal (dia 5)', msgs.cobranca]].map(([r, m]) => m && (
                <div key={r}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{r}</p>
                  <div className="flex items-start gap-2"><pre className="flex-1 whitespace-pre-wrap rounded bg-surface p-2 text-[12px]">{m}</pre><Botao onClick={() => copiar(m)}>copiar</Botao></div>
                </div>
              ))}
              {msgs.faltam.length > 0 && <p className="text-[11px] text-muted">Faltam: {msgs.faltam.join(', ')}</p>}
            </div>
          )}
        </div>
      ) : (
        editavel && !gerado && <Botao tone="brand" onClick={gerar}>Gerar o link {blocos === 'A' ? 'da triagem' : 'do formulário (B–D)'}</Botao>
      )}
    </div>
  );
}

function SecaoDossie({ t, editavel, agir, token }: { t: TrilhoCompleto; editavel: boolean; agir: Agir; token: string | null }) {
  const [fonte, setFonte] = useState('');
  const [folha, setFolha] = useState<string | null>(null);
  return (
    <Card titulo="O dossiê de uma página e as três hipóteses (pesquisador de conta)">
      <p className="text-[12.5px] text-muted">Cole o que é público (site, Instagram, notícia). O agente junta com a triagem e com o que a memória da Root já sabe; cada afirmação sai com fonte e marcada como hipótese.</p>
      {editavel && (
        <div className="mt-2 space-y-2">
          <textarea className={inputCls} rows={4} placeholder="fonte pública (dado, não instrução)" value={fonte} onChange={(e) => setFonte(e.target.value)} />
          <Botao tone="brand" onClick={() => agir('dossie', () => apiPost(`/tenants/onboarding/trilhos/${t.id}/dossie`, { fontePublica: fonte || null }, token))}>Gerar dossiê</Botao>
        </div>
      )}
      {t.dossie && (
        <div className="mt-3 space-y-2 text-[13px]">
          <ul className="space-y-0.5">{t.dossie.afirmacoes.map((a, i) => <li key={i}>• {a.texto} <span className="text-[11px] text-muted">({a.fonte}{a.hipotese ? ' · hipótese' : ''})</span></li>)}</ul>
          {t.dossie.perfilSugerido && <p>Perfil sugerido: <Chip tone="brand">{t.dossie.perfilSugerido}</Chip> <span className="text-muted">{t.dossie.motivoDoPerfil}</span></p>}
          <div className="grid gap-2 md:grid-cols-3">
            {t.dossie.hipoteses.map((h) => (
              <div key={h.titulo} className="rounded-lg border border-border bg-surface-2 p-2">
                <p className="font-medium">{h.titulo}</p>
                <p className="text-[12px] text-muted">Como era: {h.comoEra}</p>
                <p className="text-[12px] text-muted">Como fica: {h.comoFica}</p>
                <p className="text-[11px] text-muted">{h.receita ?? 'sem receita'} · {h.metrica}</p>
              </div>
            ))}
          </div>
          {t.dossie.perguntasQueFaltam.length > 0 && <p className="text-[12px]">Perguntas que faltam: {t.dossie.perguntasQueFaltam.join(' · ')}</p>}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <Botao onClick={() => agir('folha', () => apiGet<{ markdown: string }>(`/tenants/onboarding/trilhos/${t.id}/folha`, token), (r) => setFolha(r.markdown))}>Folha de reunião (60 min)</Botao>
        {folha && <Botao onClick={() => navigator.clipboard.writeText(folha)}>copiar</Botao>}
      </div>
      {folha && <pre className="mt-2 whitespace-pre-wrap rounded bg-surface-2 p-3 text-[12px]">{folha}</pre>}
    </Card>
  );
}

function SecaoAta({ t, editavel, agir, token, setAviso }: { t: TrilhoCompleto; editavel: boolean; agir: Agir; token: string | null; setAviso: (s: string) => void }) {
  const [modo, setModo] = useState<'texto' | 'link' | 'arquivo'>('texto');
  const [texto, setTexto] = useState('');
  const [url, setUrl] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [kickoffEm, setKickoffEm] = useState(paraInputDate(t.kickoffEm) || hoje());
  const depois = (r: ResultadoDaLeitura) => {
    setAviso(`Ata lida: ${r.ata.propostas} proposta(s), ${r.ata.emBranco} em branco${r.ata.segredosRemovidos ? `, ${r.ata.segredosRemovidos} segredo(s) mascarado(s)` : ''}${r.leitura.avisos.length ? ` · avisos: ${r.leitura.avisos.join(' | ')}` : ''}`);
    setTexto('');
    setArquivo(null);
  };
  const ler = () => {
    const k = dataInput(kickoffEm);
    if (modo === 'arquivo') {
      if (!arquivo) return;
      return agir('ata', () => apiUpload<ResultadoDaLeitura>(`/tenants/onboarding/trilhos/${t.id}/ata/arquivo${k ? `?kickoffEm=${encodeURIComponent(k)}` : ''}`, arquivo, token), depois);
    }
    // Texto colado acima de ~80 mil caracteres não cabe no corpo JSON da API: vai como arquivo.
    if (modo === 'texto' && texto.length > 80_000) {
      const blob = new File([texto], 'ata-colada.txt', { type: 'text/plain' });
      return agir('ata', () => apiUpload<ResultadoDaLeitura>(`/tenants/onboarding/trilhos/${t.id}/ata/arquivo${k ? `?kickoffEm=${encodeURIComponent(k)}` : ''}`, blob, token), depois);
    }
    const fonte = modo === 'texto' ? { tipo: 'texto', texto } : { tipo: 'link', url };
    return agir('ata', () => apiPost<ResultadoDaLeitura>(`/tenants/onboarding/trilhos/${t.id}/ata`, { fonte, kickoffEm: k }, token), depois);
  };
  return (
    <Card titulo="A ata do kickoff → propostas (leitor de ata)">
      <p className="text-[12.5px] text-muted">Cole a transcrição (Granola), o link ou envie o PDF. O agente propõe uma resposta por tema com trecho e minuto; literal vai direto, interpretado espera o seu OK, o que a ata não cobriu chega em branco. A transcrição não é gravada — só o hash e o que virou proposta.</p>
      {editavel && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {(['texto', 'link', 'arquivo'] as const).map((m) => <Botao key={m} tone={modo === m ? 'brand' : 'default'} onClick={() => setModo(m)}>{m === 'arquivo' ? 'PDF / arquivo' : m}</Botao>)}
            <label className="ml-auto flex items-center gap-1 text-[12px] text-muted">kickoff em <input className={inputCls} type="date" value={kickoffEm} onChange={(e) => setKickoffEm(e.target.value)} /></label>
          </div>
          {modo === 'texto' && <textarea className={inputCls} rows={6} placeholder="a transcrição inteira, com as marcas de tempo se houver" value={texto} onChange={(e) => setTexto(e.target.value)} />}
          {modo === 'link' && <input className={inputCls} placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />}
          {modo === 'arquivo' && <input type="file" accept=".pdf,.txt,.md,text/plain,application/pdf" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} className="text-[12px]" />}
          <Botao tone="brand" onClick={ler} disabled={modo === 'texto' ? texto.trim().length < 200 : modo === 'link' ? !url : !arquivo}>Ler a ata</Botao>
        </div>
      )}
      {t.atas.length > 0 && (
        <ul className="mt-3 space-y-1 text-[12px] text-muted">
          {t.atas.map((a) => <li key={a.id}>{dataHoraBR(a.lidaEm)} · {a.fonte}{a.referencia ? ` (${a.referencia})` : ''} · {a.caracteres.toLocaleString('pt-BR')} caracteres · {a.erro ? <span className="text-bad">{a.erro}</span> : `${a.propostas} propostas, ${a.emBranco} em branco`}{a.segredosRemovidos ? ` · ${a.segredosRemovidos} segredo(s) mascarado(s)` : ''} · {a.modelo ?? '—'} · US$ {a.custoUsd.toFixed(4)}{a.custoEstimado ? '' : ' (não medido)'}</li>)}
        </ul>
      )}
    </Card>
  );
}

function SecaoLinkBCD({ t, editavel, agir, token }: { t: TrilhoCompleto; editavel: boolean; agir: Agir; token: string | null }) {
  const convite = t.convites.find((c) => c.blocos === 'BCD' && c.estado !== 'revogado');
  const pend = t.itens.pendentesDeAprovacao;
  return (
    <Card titulo="O link do cliente (blocos B–D)">
      <p className="text-[12.5px] text-muted">
        Sai quando nada interpretado estiver esperando o seu OK. {pend > 0 ? <span className="text-warn">{pend} proposta(s) esperam decisão na aba “O formulário”.</span> : <span className="text-good">Nada pendente.</span>} Depois de enviado, o relógio conta 3 dias.
      </p>
      <Convites t={t} blocos="BCD" convite={convite} editavel={editavel} agir={agir} token={token} />
    </Card>
  );
}

function SecaoBoasVindas({ t, token }: { t: TrilhoCompleto; token: string | null }) {
  const [passos, setPassos] = useState([{ texto: 'Kickoff gravado', data: paraInputDate(t.kickoffEm), dono: t.conduzidoPor ?? '' }, { texto: 'Imersão — dia 1', data: paraInputDate(t.imersaoEm), dono: t.implantadoPor ?? '' }]);
  const [root, setRoot] = useState([t.conduzidoPor, t.implantadoPor].filter(Boolean).join(', '));
  const [texto, setTexto] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const gerar = async () => {
    if (!token) return;
    setErro(null);
    try {
      const r = await apiPost<{ texto: string }>(`/tenants/onboarding/trilhos/${t.id}/boas-vindas`, { passos: passos.filter((p) => p.texto).map((p) => ({ texto: p.texto, data: p.data ? dataInput(p.data) : null, dono: p.dono || null })), root: root.split(',').map((s) => s.trim()).filter(Boolean) }, token);
      setTexto(r.texto);
    } catch (e) {
      setErro((e as Error).message);
    }
  };
  return (
    <Card titulo="Boas-vindas no grupo, com datas reais (cards 04 e 05)">
      <div className="space-y-2">
        {passos.map((p, i) => (
          <div key={i} className="grid gap-2 md:grid-cols-[1fr_140px_140px]">
            <input className={inputCls} placeholder="passo" value={p.texto} onChange={(e) => setPassos(passos.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)))} />
            <input className={inputCls} type="date" value={p.data} onChange={(e) => setPassos(passos.map((x, j) => (j === i ? { ...x, data: e.target.value } : x)))} />
            <input className={inputCls} placeholder="dono" value={p.dono} onChange={(e) => setPassos(passos.map((x, j) => (j === i ? { ...x, dono: e.target.value } : x)))} />
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Botao onClick={() => setPassos([...passos, { texto: '', data: '', dono: '' }])}>+ passo</Botao>
          <input className={`${inputCls} md:max-w-xs`} placeholder="do lado da Root: nomes" value={root} onChange={(e) => setRoot(e.target.value)} />
          <Botao tone="brand" onClick={gerar}>Gerar mensagem</Botao>
        </div>
        {erro && <p className="text-[12px] text-bad">{erro}</p>}
        {texto && <div className="flex items-start gap-2"><pre className="flex-1 whitespace-pre-wrap rounded bg-surface-2 p-2 text-[12.5px]">{texto}</pre><Botao onClick={() => navigator.clipboard.writeText(texto)}>copiar</Botao></div>}
      </div>
    </Card>
  );
}

function SecaoMemoria({ t, editavel, agir, token, setAviso }: { t: TrilhoCompleto; editavel: boolean; agir: Agir; token: string | null; setAviso: (s: string) => void }) {
  const { can } = useAuth();
  const [retrato, setRetrato] = useState<RetratoDoTrilho | null>(null);
  const carregados = t.itens_.filter((i) => i.notaId).length;
  return (
    <Card titulo="A empresa do cliente no OS e a memória dela">
      <p className="text-[12.5px] text-muted">
        {t.empresaId ? `Empresa provisionada (${t.empresaId.slice(0, 8)}…). ${carregados} nota(s) carregada(s) na memória do cliente.` : 'A empresa do cliente ainda não existe no OS. Provisionar cria o tenant com o contato como administrador.'}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {editavel && !t.empresaId && can('admin.usuarios') && <Botao tone="brand" onClick={() => agir('empresa', () => apiPost(`/tenants/onboarding/trilhos/${t.id}/empresa`, {}, token))}>Provisionar empresa no OS</Botao>}
        {editavel && t.empresaId && <Botao tone="brand" onClick={() => agir('memoria', () => apiPost<{ carregados: number }>(`/tenants/onboarding/trilhos/${t.id}/memoria`, {}, token), (r) => setAviso(`${r.carregados} nota(s) carregada(s) na memória do cliente.`))}>Carregar a memória do cliente</Botao>}
        <Botao onClick={() => agir('retrato', () => apiGet<RetratoDoTrilho>(`/tenants/onboarding/trilhos/${t.id}/retrato`, token), setRetrato)}>Ver o retrato</Botao>
      </div>
      {retrato && (
        <div className="mt-3 space-y-2">
          {retrato.partes.map((p) => (
            <div key={p.temaId} className="text-[13px]"><span className="font-medium">{p.titulo}.</span> {p.texto} <span className="text-[11px] text-muted">({p.fonte})</span></div>
          ))}
          {retrato.pendentes.length > 0 && <p className="text-[12px] text-warn">Sem resposta: {retrato.pendentes.join(', ')}</p>}
          <div className="rounded-lg border border-brand/40 bg-brand/10 p-2 text-[13px]">
            <p className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-brand">A primeira pergunta</p>
            {retrato.primeiraPergunta.pergunta && <p className="font-medium">“{retrato.primeiraPergunta.pergunta}”</p>}
            <p className="text-muted">{retrato.primeiraPergunta.resposta}</p>
          </div>
        </div>
      )}
    </Card>
  );
}

function Formulario({ t, editavel, agir, token }: { t: TrilhoCompleto; editavel: boolean; agir: Agir; token: string | null }) {
  const blocos = useMemo(() => ['A', 'B', 'C', 'D'].map((b) => ({ b, itens: t.itens_.filter((i) => i.bloco === b) })).filter((x) => x.itens.length), [t.itens_]);
  return (
    <div className="space-y-4">
      <p className="text-[12.5px] text-muted">
        A regra de corte: <span className="text-good">literal</span> vai direto ao cliente; <span className="text-warn">interpretado</span> espera o seu OK; <span className="text-bad">sem proposta</span> chega em branco. O que o cliente já respondeu a bancada não toca.
      </p>
      {blocos.map(({ b, itens }) => (
        <Card key={b} titulo={`Bloco ${b} · ${ROTULO_DO_BLOCO[b]}`}>
          <div className="space-y-2">
            {itens.map((i) => <Item key={i.temaId} t={t} i={i} editavel={editavel} agir={agir} token={token} />)}
          </div>
        </Card>
      ))}
    </div>
  );
}

function Item({ t, i, editavel, agir, token }: { t: TrilhoCompleto; i: ItemNaBancada; editavel: boolean; agir: Agir; token: string | null }) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(i.proposta ?? '');
  const respondido = ['confirmado', 'corrigido', 'respondido'].includes(i.status);
  const tomStatus = respondido ? 'good' : i.status === 'aprovado' ? 'brand' : i.status === 'proposto' ? (i.tipo === 'literal' ? 'good' : 'warn') : i.status === 'descartado' ? 'bad' : 'muted';
  const decidir = (decisao: string, txt?: string) => agir(`item-${i.temaId}`, () => apiPost(`/tenants/onboarding/trilhos/${t.id}/itens/${i.temaId}/decisao`, { decisao, texto: txt ?? null }, token), () => setEditando(false));
  const escrever = () => agir(`item-${i.temaId}`, () => apiPut(`/tenants/onboarding/trilhos/${t.id}/itens/${i.temaId}`, { texto }, token), () => setEditando(false));
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{i.titulo}</span>
        <Chip tone={i.obrigatorio ? 'brand' : 'muted'}>{i.obrigatorio ? 'obrigatório' : 'opcional'}</Chip>
        {i.ramo && <Chip tone="muted">ramo: {i.ramo.join(' / ')}</Chip>}
        <Chip tone={tomStatus}>{i.status}{i.status === 'proposto' || i.status === 'aprovado' ? ` · ${i.tipo}` : ''}</Chip>
        <span className="ml-auto text-[11px] text-muted">{i.fonteMinuto ? `ata · ${i.fonteMinuto}` : i.origem === 'root' ? 'escrito na bancada' : i.origem === 'triagem' ? 'triagem' : ''}</span>
      </div>
      <p className="mt-1 text-[12px] text-muted">{i.pergunta}</p>
      {respondido ? (
        <div className="mt-2 text-[13px]"><span className="text-good">✓</span> {i.textoFinal} <span className="text-[11px] text-muted">— {i.status} por {i.respondidoPor}{i.respondidoVia === 'audio' ? ' (áudio)' : ''} em {dataBR(i.respondidoEm)}{i.notaId ? ' · na memória' : ''}</span></div>
      ) : i.proposta && !editando ? (
        <div className="mt-2 text-[13px]">
          <p>{i.proposta}</p>
          {i.fonteTrecho && <p className="mt-1 text-[11.5px] text-muted">“{i.fonteTrecho}”</p>}
          {i.fonteNota && <p className="text-[11px] text-warn">{i.fonteNota}</p>}
          {i.aprovadoPor && <p className="text-[11px] text-muted">{i.status} por {i.aprovadoPor}</p>}
        </div>
      ) : null}
      {editavel && !respondido && (
        <div className="mt-2">
          {editando ? (
            <div className="space-y-2">
              <textarea className={inputCls} rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} />
              <div className="flex gap-2">
                <Botao tone="brand" onClick={() => (i.proposta ? decidir('editar', texto) : escrever())}>Salvar e aprovar</Botao>
                <Botao tone="ghost" onClick={() => setEditando(false)}>Cancelar</Botao>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {i.status === 'proposto' && <Botao tone="brand" onClick={() => decidir('aprovar')}>Aprovar</Botao>}
              {(i.status === 'proposto' || i.status === 'aprovado') && <Botao onClick={() => { setTexto(i.proposta ?? ''); setEditando(true); }}>Editar</Botao>}
              {(i.status === 'proposto' || i.status === 'aprovado') && <Botao tone="bad" onClick={() => decidir('descartar')}>Descartar</Botao>}
              {(i.status === 'aprovado' || i.status === 'descartado') && <Botao tone="ghost" onClick={() => decidir('desfazer')}>Desfazer</Botao>}
              {(i.status === 'em-branco' || i.status === 'descartado') && <Botao onClick={() => { setTexto(''); setEditando(true); }}>Escrever o que a Root sabe</Botao>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
