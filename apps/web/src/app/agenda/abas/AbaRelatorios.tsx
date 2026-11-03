'use client';

import { useCallback, useEffect, useState } from 'react';
import type { RelatorioDaAgenda, TipoDeCompromisso } from '@mktos/shared';

import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { diaDoCartao, quandoDoCartao } from './conflitos-formato';

/*
 * A ABA RELATÓRIOS (agenda v2, 29/10/2026, lane G5) — `GET /agenda/relatorios?de=&ate=`.
 *
 * Só contagem do que está no espelho no período (padrão: o mês corrente):
 * compromissos por sócio e por tipo, reuniões online de cliente sem Meet, sócio
 * sem e-mail na Equipe (o convite não chega a ele), o que foi marcado assim
 * mesmo (com o motivo e quem pediu) e quantos foram criados direto no Google,
 * que é a redundância da casa e não é erro.
 */

const TIPOS: Array<[TipoDeCompromisso, string]> = [
  ['cliente', 'Cliente'],
  ['interna', 'Interna'],
  ['fechado', 'Fechado'],
  ['fora', 'Fora'],
  ['pessoal', 'Pessoal'],
  ['feriado', 'Feriado'],
  ['outro', 'Outro'],
];

const cartao = 'flex flex-col gap-2.5 rounded-[3px] border border-border bg-surface px-[18px] py-4';
const rotulo = 'font-os-mono text-[10px] uppercase tracking-[2px] text-muted';
const campo = 'rounded-[3px] border border-border bg-bg px-2 py-1 font-os-mono text-xs text-text outline-none focus:border-brand-dim';
const th = 'px-2 pb-1 font-os-mono text-[10px] font-medium uppercase tracking-[2px] text-muted';
const td = 'border-t border-border px-2 py-[7px] text-[12.5px] align-top';

export function AbaRelatorios() {
  const { token, ready } = useAuth();
  const [dados, setDados] = useState<RelatorioDaAgenda | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState<{ de: string; ate: string } | null>(null);

  const carregar = useCallback(() => {
    if (!token) return;
    const q = periodo ? `?${new URLSearchParams({ de: periodo.de, ate: periodo.ate }).toString()}` : '';
    apiGet<RelatorioDaAgenda>(`/agenda/relatorios${q}`, token)
      .then((r) => { setDados(r); setErro(null); })
      .catch((e: Error) => setErro(e.message));
  }, [token, periodo]);
  useEffect(() => { if (ready && token) carregar(); }, [ready, token, carregar]);

  const tiposComAlgo = TIPOS.filter(([t]) => (dados?.porTipo[t] ?? 0) > 0);
  const total = Object.values(dados?.porTipo ?? {}).reduce((a, b) => a + (b ?? 0), 0);

  return (
    <div className="font-central-sans flex flex-col gap-5" data-aba-relatorios="">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-os-mono text-[10px] font-bold uppercase tracking-[4px] text-mag">// relatórios · o que a agenda teve</div>
          <h2 className="mt-1 text-[28px] font-bold leading-tight tracking-[-1px]">
            {dados ? <><span className="font-os-mono">{total}</span> compromissos</> : 'Compromissos'} <span className="text-brand">no período.</span>
          </h2>
        </div>
        {dados && (
          <div className="flex items-center gap-1.5 text-xs">
            <label className="flex items-center gap-1">
              <span className={rotulo}>de</span>
              <input type="date" className={campo} aria-label="de" defaultValue={dados.de} onChange={(e) => e.target.value && setPeriodo({ de: e.target.value, ate: periodo?.ate ?? dados.ate })} />
            </label>
            <label className="flex items-center gap-1">
              <span className={rotulo}>até</span>
              <input type="date" className={campo} aria-label="até" defaultValue={dados.ate} onChange={(e) => e.target.value && setPeriodo({ de: periodo?.de ?? dados.de, ate: e.target.value })} />
            </label>
          </div>
        )}
      </div>

      {erro && <p className="text-sm text-mag" role="alert">{erro}</p>}
      {!dados && !erro && <p className="text-sm text-muted">Lendo o período…</p>}

      {dados && (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className={cartao} data-por-socio="">
              <span className={rotulo}>Por sócio</span>
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr>
                    <th className={th}>Sócio</th>
                    <th className={th}>Total</th>
                    {tiposComAlgo.map(([t, nome]) => <th key={t} className={th}>{nome}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {dados.porSocio.map((s) => (
                    <tr key={s.socio}>
                      <td className={td}>{s.socio}</td>
                      <td className={`${td} font-os-mono`}>{s.total}</td>
                      {tiposComAlgo.map(([t]) => <td key={t} className={`${td} font-os-mono`}>{s.porTipo[t] ?? 0}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className={cartao} data-por-tipo="">
              <span className={rotulo}>Por tipo</span>
              {tiposComAlgo.length === 0 && <p className="text-[13px] text-muted">Nada no período.</p>}
              <div className="flex flex-wrap gap-2">
                {tiposComAlgo.map(([t, nome]) => (
                  <span key={t} className="rounded-[3px] border border-border bg-bg px-2 py-1 text-[13px]">
                    {nome} <span className="font-os-mono">{dados.porTipo[t]}</span>
                  </span>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-border pt-2 text-[13px]">
                <span>Criados direto no Google</span>
                <span className="font-os-mono">{dados.criadosDiretoNoGoogle}</span>
              </div>
              <p className="text-[11px] text-dim">Marcar pelo celular é a redundância da casa, não é erro: aqui é só a contagem.</p>
            </section>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className={cartao} data-sem-meet="">
              <span className={rotulo}>Online sem Meet</span>
              {dados.semMeet.length === 0 ? (
                <p className="text-[13px]"><span className="font-os-mono text-info">OK</span> Toda reunião online de cliente tem Meet.</p>
              ) : (
                dados.semMeet.map((x) => (
                  <div key={x.id} className="flex items-center justify-between gap-2 text-[12.5px]">
                    <span className="font-os-mono">{x.titulo ?? '(sem título)'}</span>
                    <span className="font-os-mono text-[11px] text-warn">ATENÇÃO · {quandoDoCartao(x.inicio)}</span>
                  </div>
                ))
              )}
              <span className={`${rotulo} pt-2`}>Responsável sem e-mail</span>
              {dados.responsavelSemEmail.length === 0 ? (
                <p className="text-[13px]"><span className="font-os-mono text-info">OK</span> Os sócios têm e-mail na Equipe.</p>
              ) : (
                <p className="text-[13px]">
                  <span className="font-os-mono text-warn">ATENÇÃO</span> {dados.responsavelSemEmail.join(', ')}: sem e-mail na Equipe, o convite do Google não chega.
                </p>
              )}
            </section>

            <section className={cartao} data-assim-mesmo="">
              <span className={rotulo}>Marcados assim mesmo</span>
              {dados.marcadosAssimMesmo.length === 0 ? (
                <p className="text-[13px]"><span className="font-os-mono text-info">OK</span> Nada foi marcado no vermelho no período.</p>
              ) : (
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr><th className={th}>Quando</th><th className={th}>Compromisso</th><th className={th}>Motivo</th><th className={th}>Quem</th></tr>
                  </thead>
                  <tbody>
                    {dados.marcadosAssimMesmo.map((m) => (
                      <tr key={m.eventoId}>
                        <td className={`${td} font-os-mono`}>{diaDoCartao(m.inicio)}</td>
                        <td className={`${td} font-os-mono`}>{m.titulo ?? '(sem título)'}</td>
                        <td className={td}>{m.motivo}</td>
                        <td className={td}>{m.quem ?? 'não registrado'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
