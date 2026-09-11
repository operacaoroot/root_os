'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Botao, Card, Chip, inputCls } from '../referencias/ui';
import {
  ESTADOS,
  emHoras,
  quando,
  tomDoEstado,
  type EstadoDaRotina,
  type ExecucaoResumo,
  type RotinaResumo,
  type RotinasList,
} from './tipos';

/*
 * A TELA DE ROTINAS — RF-N-04.
 *
 * Até aqui `/rotinas` caía no placeholder de módulo sem tela. O que ela mostra
 * agora é dado real, e três coisas que a tela antiga de Pauta não tinha como
 * dizer:
 *
 *  · O ESTADO DECLARADO (rodando · aprendendo · planejada · pausada), separado
 *    do interruptor. "Está ligada" e "está em produção" são perguntas
 *    diferentes, e juntá-las num botão só é como a distinção se perde. NA
 *    ROTINA ESPELHADA DA PAUTA os dois andam juntos, e de propósito: lá embaixo
 *    a tela de Pauta tem um interruptor só, e deixá-lo ligado enquanto aqui se
 *    declara "pausada" faria a tela antiga dizer que está tudo de pé enquanto
 *    nada dispara.
 *  · O HISTÓRICO. Cada passagem com início, duração, desfecho e o motivo quando
 *    deu errado — em vez de um `ultimoStatus` que a próxima execução apaga.
 *  · O TEMPO DEVOLVIDO (RF-N-05), que só aparece quando ALGUÉM DECLAROU a linha
 *    de base. Sem declaração a tela mostra travessão; número inventado aqui
 *    seria pior do que número nenhum.
 *
 * A tela NÃO cria rotina. Hoje toda rotina nasce de outro lugar (a da pauta, da
 * tela de Pauta) e o criador genérico depende de escolher o executor — é
 * decisão de produto, não de tela, e está no relatório da fatia.
 */
export default function RotinasPage() {
  const { token, ready, can } = useAuth();
  const [data, setData] = useState<RotinasList | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [historico, setHistorico] = useState<Record<string, ExecucaoResumo[]>>({});
  const [minutos, setMinutos] = useState<Record<string, string>>({});

  const editavel = can('automacoes.executar');

  const carregar = useCallback(() => {
    if (!token) return;
    apiGet<RotinasList>('/rotinas', token)
      .then(setData)
      .catch((e: Error) => setErro(e.message));
  }, [token]);

  useEffect(() => {
    if (ready) carregar();
  }, [ready, carregar]);

  async function agir(id: string, fn: () => Promise<unknown>) {
    setErro(null);
    setOcupado(id);
    try {
      await fn();
      carregar();
      if (aberta === id) await abrirHistorico(id, true);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  async function abrirHistorico(id: string, forcar = false) {
    if (!forcar && aberta === id) {
      setAberta(null);
      return;
    }
    setAberta(id);
    try {
      const linhas = await apiGet<ExecucaoResumo[]>(`/rotinas/${id}/execucoes?limite=30`, token);
      setHistorico((h) => ({ ...h, [id]: linhas }));
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  const rodando = data?.items.filter((r) => r.estado === 'rodando').length ?? 0;
  const emFalha = data?.items.filter((r) => r.ultimoStatus?.startsWith('erro')).length ?? 0;
  const minutosTotais =
    data?.items.reduce((s, r) => s + (r.minutosDevolvidos ?? 0), 0) ?? 0;
  const semLinhaDeBase = data?.items.filter((r) => r.minutosPorExecucao === null).length ?? 0;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        O trabalho que acontece sozinho nesta empresa. Cada rotina tem um horário, um estado
        declarado e um histórico — e só dispara quando o estado e o interruptor concordam.
      </p>

      {erro && (
        <div className="rounded-root border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{erro}</div>
      )}

      {data?.descobertaCega && (
        <div className="rounded-root border border-bad/40 bg-bad/10 p-3 text-sm text-bad">
          <strong>Nenhuma rotina está disparando — em empresa nenhuma.</strong> A pergunta que
          descobre quais empresas têm rotina roda fora de requisição, sem empresa na sessão, e o
          isolamento por linha a devolve vazia. Não é falta de rotina: é a conexão desta API não
          atravessar a policy. O conserto é de infraestrutura (dar <code className="text-xs">BYPASSRLS</code>{' '}
          ao papel da aplicação, ou mover a descoberta para um comando de manutenção) e está em{' '}
          <code className="text-xs">docs/DEPLOY.md</code>. O que esta tela mostra abaixo é o estado
          guardado, não o que está acontecendo.
        </div>
      )}

      {data && data.avisos.length > 0 && (
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          <p className="font-medium">A última reconciliação com a tela de Pauta tropeçou:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            {data.avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {data && !data.agendadorAtivo && (
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          <code className="text-xs">ROTINAS_CRON=off</code> — nenhuma rotina dispara sozinha nesta
          instância. Dá para rodar na mão pelo botão de cada uma.
        </div>
      )}

      {data?.pautaDesligadaPorVariavel && (
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          <code className="text-xs">PAUTA_CRON=off</code> — as rotinas de pauta ficam de fora do
          agendador. A variável é apelido de compatibilidade: para pausar uma rotina, use o estado
          aqui; para desligar o agendador inteiro, <code className="text-xs">ROTINAS_CRON=off</code>.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Numero label="Rodando" valor={rodando} />
        <Numero label="Com erro na última" valor={emFalha} tom={emFalha > 0 ? 'bad' : undefined} />
        <Numero
          label="Tempo devolvido"
          valor={minutosTotais > 0 ? emHoras(minutosTotais) : '—'}
          nota={
            semLinhaDeBase > 0
              ? `${semLinhaDeBase} rotina(s) sem linha de base declarada`
              : 'soma das linhas de base declaradas'
          }
        />
        <Numero label="Rotinas" valor={data?.items.length ?? 0} />
      </div>

      {data && data.items.length === 0 && (
        <Card>
          <p className="text-sm text-muted">
            Nenhuma rotina nesta empresa ainda. A rotina de pauta aparece aqui sozinha assim que for
            criada na tela de Pauta.
          </p>
        </Card>
      )}

      <div className="space-y-2">
        {data?.items.map((r) => (
          <Linha
            key={r.id}
            rotina={r}
            editavel={editavel}
            ocupado={ocupado === r.id}
            aberta={aberta === r.id}
            historico={historico[r.id] ?? []}
            minutos={minutos[r.id] ?? ''}
            onMinutos={(v) => setMinutos((m) => ({ ...m, [r.id]: v }))}
            onAbrir={() => abrirHistorico(r.id)}
            onRodar={() => agir(r.id, () => apiPost(`/rotinas/${r.id}/rodar`, {}, token))}
            onEstado={(estado) => agir(r.id, () => apiPatch(`/rotinas/${r.id}`, { estado }, token))}
            onAtivo={(ativo) => agir(r.id, () => apiPatch(`/rotinas/${r.id}`, { ativo }, token))}
            onLinhaDeBase={(n) =>
              agir(r.id, async () => {
                await apiPatch(`/rotinas/${r.id}`, { minutosPorExecucao: n }, token);
                setMinutos((m) => ({ ...m, [r.id]: '' }));
              })
            }
          />
        ))}
      </div>
    </div>
  );
}

function Numero({
  label,
  valor,
  nota,
  tom,
}: {
  label: string;
  valor: number | string;
  nota?: string;
  tom?: 'bad';
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tom === 'bad' ? 'text-bad' : ''}`}>{valor}</p>
      {nota && <p className="mt-1 text-[11px] text-muted">{nota}</p>}
    </div>
  );
}

function Linha({
  rotina: r,
  editavel,
  ocupado,
  aberta,
  historico,
  minutos,
  onMinutos,
  onAbrir,
  onRodar,
  onEstado,
  onAtivo,
  onLinhaDeBase,
}: {
  rotina: RotinaResumo;
  editavel: boolean;
  ocupado: boolean;
  aberta: boolean;
  historico: ExecucaoResumo[];
  minutos: string;
  onMinutos: (v: string) => void;
  onAbrir: () => void;
  onRodar: () => void;
  onEstado: (estado: EstadoDaRotina) => void;
  onAtivo: (ativo: boolean) => void;
  onLinhaDeBase: (n: number) => void;
}) {
  const n = Number(minutos);
  const minutosValidos = minutos !== '' && Number.isInteger(n) && n >= 0 && n <= 1440;

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={tomDoEstado(r.estado)}>
              {ESTADOS.find((e) => e.valor === r.estado)?.rotulo ?? r.estado}
            </Chip>
            {!r.ativo && <Chip tone="warn">interruptor desligado</Chip>}
            {!r.temExecutor && <Chip tone="bad">sem executor</Chip>}
            <code className="text-[11px] text-muted">{r.cron}</code>
            <Chip>{r.tz}</Chip>
            {r.agenteSlug && <Chip>{r.agenteSlug}</Chip>}
          </div>

          <p className="mt-1 text-sm">
            {r.nome} <span className="text-muted">· {r.slug}</span>
          </p>

          <p className="mt-0.5 text-[11px] text-muted">
            {r.dispara
              ? `próxima: ${quando(r.proximaExecucaoEm)}`
              : 'não dispara no estado atual'}
            {' · '}última: {quando(r.ultimaExecucaoEm)}
            {' · '}
            {r.execucoes} execução(ões), {r.falhas} falha(s)
            {r.minutosDevolvidos !== null && ` · ${emHoras(r.minutosDevolvidos)} devolvidos`}
          </p>

          {r.ultimoStatus && (
            <p
              className={`mt-0.5 text-xs ${r.ultimoStatus.startsWith('erro') ? 'text-bad' : 'text-muted'}`}
            >
              {r.ultimoStatus}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            className={`${inputCls} w-auto py-1 text-xs`}
            value={r.estado}
            onChange={(e) => onEstado(e.target.value as EstadoDaRotina)}
            disabled={!editavel || ocupado}
            title={
              r.origem === 'pauta'
                ? `${ESTADOS.find((e) => e.valor === r.estado)?.explica} — nesta rotina o estado ` +
                  'também liga e desliga o interruptor da tela de Pauta'
                : ESTADOS.find((e) => e.valor === r.estado)?.explica
            }
          >
            {ESTADOS.map((e) => (
              <option key={e.valor} value={e.valor}>
                {e.rotulo}
              </option>
            ))}
          </select>

          <Botao
            tone="brand"
            onClick={onRodar}
            disabled={!editavel || ocupado || !r.temExecutor}
            title={r.temExecutor ? 'roda agora, sem esperar o horário' : 'esta rotina não tem executor inscrito'}
          >
            {ocupado ? 'Rodando…' : 'Rodar agora'}
          </Botao>

          <Botao onClick={() => onAtivo(!r.ativo)} disabled={!editavel || ocupado}>
            {r.ativo ? 'Desligar' : 'Ligar'}
          </Botao>

          <Botao tone="ghost" onClick={onAbrir}>
            {aberta ? 'Fechar histórico' : 'Histórico'}
          </Botao>
        </div>
      </div>

      {aberta && (
        <div className="border-t border-border px-4 py-3">
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-[11px] text-muted">
                Linha de base — minutos que uma pessoa gastava por execução (RF-N-05)
              </span>
              <input
                type="number"
                min={0}
                max={1440}
                className={`${inputCls} w-48`}
                placeholder={r.minutosPorExecucao?.toString() ?? 'ninguém declarou'}
                value={minutos}
                onChange={(e) => onMinutos(e.target.value)}
                disabled={!editavel || ocupado}
              />
            </label>
            <Botao onClick={() => onLinhaDeBase(n)} disabled={!editavel || ocupado || !minutosValidos}>
              Declarar
            </Botao>
          </div>

          {historico.length === 0 ? (
            <p className="text-xs text-muted">Nenhuma passagem registrada ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="py-1 pr-3">quando</th>
                    <th className="py-1 pr-3">desfecho</th>
                    <th className="py-1 pr-3">origem</th>
                    <th className="py-1 pr-3">duração</th>
                    <th className="py-1">o que aconteceu</th>
                  </tr>
                </thead>
                <tbody>
                  {historico.map((e) => (
                    <tr key={e.id} className="border-t border-border/60">
                      <td className="whitespace-nowrap py-1 pr-3 text-muted">{quando(e.inicioEm)}</td>
                      <td className="py-1 pr-3">
                        <Chip tone={e.status === 'ok' ? 'good' : e.status === 'erro' ? 'bad' : 'muted'}>
                          {e.status}
                        </Chip>
                      </td>
                      <td className="py-1 pr-3 text-muted">{e.origem}</td>
                      <td className="whitespace-nowrap py-1 pr-3 text-muted">
                        {e.duracaoMs === null ? '—' : `${(e.duracaoMs / 1000).toFixed(1)}s`}
                      </td>
                      <td className={`py-1 ${e.erro ? 'text-bad' : ''}`}>{e.erro ?? e.resumo ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
