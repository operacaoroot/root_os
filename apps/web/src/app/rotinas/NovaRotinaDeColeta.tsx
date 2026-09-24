'use client';

import { useState } from 'react';
import { apiPost } from '@/lib/api';
import { Botao, Campo, Card, inputCls } from '../referencias/ui';
import { ESTADOS, TIPO_PAUTA_COLETA, type EstadoDaRotina, type CorpoDaNovaColeta } from './tipos';

/*
 * "NOVA ROTINA DE COLETA" — MC5.
 *
 * A coleta de quinta: roda as fontes da pauta (feed, busca, creators, Gmail; o
 * grupo de WhatsApp chega sozinho) e deixa a rodada da semana aguardando a
 * curadoria em /pauta. Os padrões são os do episódio: quinta às 22h em São
 * Paulo, janela de 168h. Quem valida é a API; aqui só se evita a viagem do
 * obviamente vazio.
 */

export const PADRAO_DA_COLETA = {
  nome: 'Coleta semanal da pauta',
  slug: 'coleta-semanal-da-pauta',
  cron: '0 22 * * 4',
  tz: 'America/Sao_Paulo',
  horas: 168,
  estado: 'rodando' as EstadoDaRotina,
};

const CRON_DE_5_CAMPOS = /^(\S+\s+){4}\S+$/;

export function NovaRotinaDeColeta({ token, onCriada }: { token: string | null; onCriada: () => void }) {
  const [aberto, setAberto] = useState(false);
  // O erro fica no card, perto do botão: a tarja da página fica fora da tela no celular.
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [nome, setNome] = useState(PADRAO_DA_COLETA.nome);
  const [slug, setSlug] = useState(PADRAO_DA_COLETA.slug);
  const [cron, setCron] = useState(PADRAO_DA_COLETA.cron);
  const [tz, setTz] = useState(PADRAO_DA_COLETA.tz);
  const [horas, setHoras] = useState(String(PADRAO_DA_COLETA.horas));
  const [estado, setEstado] = useState<EstadoDaRotina>(PADRAO_DA_COLETA.estado);

  const h = Number(horas);
  const valido =
    nome.trim() !== '' &&
    CRON_DE_5_CAMPOS.test(cron.trim()) &&
    tz.trim() !== '' &&
    Number.isInteger(h) &&
    h >= 6 &&
    h <= 336;

  async function criar() {
    setErro(null);
    setEnviando(true);
    const corpo: CorpoDaNovaColeta = {
      nome: nome.trim(),
      ...(slug.trim() ? { slug: slug.trim() } : {}),
      tipo: TIPO_PAUTA_COLETA,
      cron: cron.trim(),
      tz: tz.trim(),
      estado,
      config: { horas: h },
    };
    try {
      await apiPost('/rotinas', corpo, token);
      setAberto(false);
      onCriada();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  if (!aberto) {
    return (
      <div className="flex justify-end">
        <Botao tone="brand" onClick={() => setAberto(true)}>
          Nova rotina de coleta
        </Botao>
      </div>
    );
  }

  return (
    <Card titulo="Nova rotina de coleta">
      <p className="mb-3 text-xs text-muted">
        Coleta o feed, a busca, os creators e o Gmail da pauta (o grupo de WhatsApp chega sozinho) e
        deixa a rodada da semana aguardando a curadoria em <a className="underline" href="/pauta">Pauta</a>.
        Não cura nada: quem marca é você.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Campo label="Nome">
          <input className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} />
        </Campo>
        <Campo label="Slug" hint="a-z, números e hífen">
          <input className={inputCls} value={slug} onChange={(e) => setSlug(e.target.value)} />
        </Campo>
        <Campo label="Quando (cron)" hint="0 22 * * 4 = toda quinta às 22h">
          <input className={inputCls} value={cron} onChange={(e) => setCron(e.target.value)} />
        </Campo>
        <Campo label="Fuso">
          <input className={inputCls} value={tz} onChange={(e) => setTz(e.target.value)} />
        </Campo>
        <Campo label="Janela (horas)" hint="168h = a semana do episódio">
          <input
            type="number"
            min={6}
            max={336}
            className={inputCls}
            value={horas}
            onChange={(e) => setHoras(e.target.value)}
          />
        </Campo>
        <Campo label="Estado" hint={ESTADOS.find((e) => e.valor === estado)?.explica}>
          <select
            className={inputCls}
            value={estado}
            onChange={(e) => setEstado(e.target.value as EstadoDaRotina)}
          >
            {ESTADOS.map((e) => (
              <option key={e.valor} value={e.valor}>
                {e.rotulo}
              </option>
            ))}
          </select>
        </Campo>
      </div>
      {erro && (
        <p role="alert" className="mt-4 rounded-root border border-bad/40 bg-bad/10 p-3 text-sm text-bad">
          {erro}
        </p>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Botao tone="ghost" onClick={() => setAberto(false)} disabled={enviando}>
          Cancelar
        </Botao>
        <Botao tone="brand" onClick={criar} disabled={!valido || enviando}>
          {enviando ? 'Criando…' : 'Criar rotina'}
        </Botao>
      </div>
    </Card>
  );
}
