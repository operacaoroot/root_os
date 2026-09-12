'use client';

import { useEffect, useState } from 'react';
import type { PautaRotinaList } from '@mktos/shared';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { Botao, Campo, Card, Chip, inputCls } from '../referencias/ui';

interface Props {
  token: string | null;
  editavel: boolean;
  onErro: (m: string | null) => void;
  bump: number;
  onMudou: () => void;
}

// Presets: 3x/semana é o pedido original (seg/qua/sex de manhã).
const PRESETS = [
  { rotulo: '3x/semana · 07:00', cron: '0 7 * * 1,3,5' },
  { rotulo: 'Diário · 07:00', cron: '0 7 * * *' },
  { rotulo: 'Semanal · seg 07:00', cron: '0 7 * * 1' },
];

export function AbaRotinas({ token, editavel, onErro, bump, onMudou }: Props) {
  const [data, setData] = useState<PautaRotinaList | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const [nome, setNome] = useState('Notícias de IA');
  const [slug, setSlug] = useState('noticias-ia');
  const [cron, setCron] = useState(PRESETS[0].cron);
  const [horas, setHoras] = useState(72);

  useEffect(() => {
    if (!token) return;
    apiGet<PautaRotinaList>('/pauta/rotinas', token)
      .then(setData)
      .catch((e: Error) => onErro(e.message));
  }, [token, bump, onErro]);

  const criar = async () => {
    onErro(null);
    try {
      await apiPost('/pauta/rotinas', { slug, nome, cron, horas, tz: 'America/Sao_Paulo' }, token);
      onMudou();
    } catch (e) {
      onErro((e as Error).message);
    }
  };

  const alternar = async (id: string, ativo: boolean) => {
    try {
      await apiPatch(`/pauta/rotinas/${id}`, { ativo }, token);
      onMudou();
    } catch (e) {
      onErro((e as Error).message);
    }
  };

  const rodar = async (id: string) => {
    onErro(null);
    setOcupado(id);
    try {
      await apiPost(`/pauta/rotinas/${id}/rodar`, {}, token);
      onMudou();
    } catch (e) {
      onErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const remover = async (id: string) => {
    try {
      await apiDelete(`/pauta/rotinas/${id}`, token);
      onMudou();
    } catch (e) {
      onErro((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      {data && !data.cronAtivo && (
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          As rotinas de pauta não disparam sozinhas nesta instância — pode ser{' '}
          <code className="text-xs">ROTINAS_CRON=off</code> (o agendador inteiro),{' '}
          <code className="text-xs">PAUTA_CRON=off</code> (só as de pauta) ou o módulo de rotinas
          fora do ar. A tela <a className="underline" href="/rotinas">Rotinas</a> diz qual dos três.
          Dá para rodar na mão pelo botão abaixo.
        </div>
      )}

      <Card titulo="Nova rotina">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Campo label="Nome">
            <input className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} disabled={!editavel} />
          </Campo>
          <Campo label="Slug" hint="a-z, números e hífen">
            <input className={inputCls} value={slug} onChange={(e) => setSlug(e.target.value)} disabled={!editavel} />
          </Campo>
          <Campo label="Quando" hint="cron de 5 campos, fuso de São Paulo">
            <select
              className={inputCls}
              value={PRESETS.some((p) => p.cron === cron) ? cron : ''}
              onChange={(e) => e.target.value && setCron(e.target.value)}
              disabled={!editavel}
            >
              {PRESETS.map((p) => (
                <option key={p.cron} value={p.cron}>
                  {p.rotulo}
                </option>
              ))}
              <option value="">(personalizado abaixo)</option>
            </select>
          </Campo>
          <Campo label="Janela de coleta (horas)" hint="72h = validade prática de uma notícia">
            <input
              type="number"
              min={6}
              max={336}
              className={inputCls}
              value={horas}
              onChange={(e) => setHoras(Number(e.target.value))}
              disabled={!editavel}
            />
          </Campo>
        </div>

        <div className="mt-3">
          <Campo label="Cron" hint="min hora dia mês diaDaSemana — ex.: 0 7 * * 1,3,5">
            <input
              className={`${inputCls} font-mono`}
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              disabled={!editavel}
            />
          </Campo>
        </div>

        <div className="mt-3">
          <Botao tone="brand" onClick={criar} disabled={!editavel || nome.length < 2 || slug.length < 2}>
            Criar rotina
          </Botao>
        </div>
      </Card>

      {data && data.items.length === 0 && (
        <Card>
          <p className="text-sm text-muted">
            Nenhuma rotina ainda. A de notícias de IA 3x/semana é o preset acima.
          </p>
        </Card>
      )}

      <div className="space-y-2">
        {data?.items.map((r) => (
          <div
            key={r.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={r.ativo ? 'good' : 'muted'}>{r.ativo ? 'ativa' : 'pausada'}</Chip>
                <code className="text-[11px] text-muted">{r.cron}</code>
                <Chip>janela {r.horas}h</Chip>
                <Chip>{r.rodadas} rodada(s)</Chip>
              </div>
              <p className="mt-1 text-sm">
                {r.nome} <span className="text-muted">· {r.slug}</span>
              </p>
              <p className="mt-0.5 text-[11px] text-muted">
                {r.proximoRun
                  ? `próxima: ${new Date(r.proximoRun).toLocaleString('pt-BR')}`
                  : 'sem próxima execução calculada'}
                {r.ultimoRun && ` · última: ${new Date(r.ultimoRun).toLocaleString('pt-BR')}`}
              </p>
              {r.ultimoStatus && (
                <p
                  className={`mt-0.5 text-xs ${r.ultimoStatus.startsWith('erro') ? 'text-bad' : 'text-muted'}`}
                >
                  {r.ultimoStatus}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Botao tone="brand" onClick={() => rodar(r.id)} disabled={!editavel || ocupado === r.id}>
                {ocupado === r.id ? 'Rodando…' : 'Rodar agora'}
              </Botao>
              <Botao onClick={() => alternar(r.id, !r.ativo)} disabled={!editavel}>
                {r.ativo ? 'Pausar' : 'Ativar'}
              </Botao>
              <Botao tone="bad" onClick={() => remover(r.id)} disabled={!editavel}>
                Remover
              </Botao>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
