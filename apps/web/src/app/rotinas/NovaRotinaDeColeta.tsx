'use client';

import { useState } from 'react';
import { cronSemanal, horarioSemanal, DIAS_DA_COLETA } from './horario-da-coleta';
import { apiPost } from '@/lib/api';
import { Botao, Campo, Card, inputCls } from '../referencias/ui';
import { ESTADOS, TIPO_PAUTA_COLETA, type EstadoDaRotina, type CorpoDaNovaColeta } from './tipos';

/*
 * "NOVA ROTINA DE COLETA" — MC5.
 *
 * A coleta de quinta: roda as fontes da pauta (feed, busca, creators, Gmail; o
 * recebimento do grupo de WhatsApp depende da conexão) e deixa a rodada da semana aguardando a
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
  const [modo, setModo] = useState<'simples' | 'avancado'>('simples');
  const [dia, setDia] = useState('4');
  const [horario, setHorario] = useState('22:00');
  const [avisoHorario, setAvisoHorario] = useState<string | null>(null);
  const [tz, setTz] = useState(PADRAO_DA_COLETA.tz);
  const [horas, setHoras] = useState(String(PADRAO_DA_COLETA.horas));
  const [estado, setEstado] = useState<EstadoDaRotina>(PADRAO_DA_COLETA.estado);

  const h = Number(horas);
  const cronEfetivo = modo === 'simples' ? cronSemanal(dia, horario) : cron.trim();

  function trocarModo(proximo: 'simples' | 'avancado') {
    setAvisoHorario(null);
    if (proximo === 'avancado') {
      setCron(cronEfetivo ?? '');
    } else {
      const simples = horarioSemanal(cron);
      if (!simples) {
        setAvisoHorario('Este cron usa uma frequência que o modo simples não representa. Continue no avançado ou informe um único dia da semana e horário.');
        return;
      }
      setDia(simples.dia);
      setHorario(simples.horario);
    }
    setModo(proximo);
  }
  const valido =
    nome.trim() !== '' &&
    !!cronEfetivo && CRON_DE_5_CAMPOS.test(cronEfetivo) &&
    tz.trim() !== '' &&
    Number.isInteger(h) &&
    h >= 6 &&
    h <= 336;

  async function criar() {
    if (!valido || !cronEfetivo || enviando) return;
    setErro(null);
    setEnviando(true);
    const corpo: CorpoDaNovaColeta = {
      nome: nome.trim(),
      ...(slug.trim() ? { slug: slug.trim() } : {}),
      tipo: TIPO_PAUTA_COLETA,
      cron: cronEfetivo,
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
        Coleta as fontes ativas configuradas no Radar e deixa a rodada para você conferir em{' '}
        <a className="underline" href="/pauta">Pauta</a>. Gmail depende da conta e da etiqueta;
        links do WhatsApp dependem do grupo conectado. Confira as entradas antes de criar a rotina.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Campo label="Nome">
          <input className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} />
        </Campo>
        <Campo label="Slug" hint="a-z, números e hífen">
          <input className={inputCls} value={slug} onChange={(e) => setSlug(e.target.value)} />
        </Campo>
        <Campo label="Como definir o horário">
          <select className={`${inputCls} min-h-11`} value={modo} disabled={enviando}
            onChange={(e) => trocarModo(e.target.value as 'simples' | 'avancado')}>
            <option value="simples">Dia e horário</option>
            <option value="avancado">Cron avançado</option>
          </select>
        </Campo>
        {modo === 'simples' ? <>
          <Campo label="Dia da semana">
            <select className={`${inputCls} min-h-11`} value={dia} disabled={enviando} onChange={(e) => setDia(e.target.value)}>
              {DIAS_DA_COLETA.map((nome, i) => <option key={nome} value={i}>{nome}</option>)}
            </select>
          </Campo>
          <Campo label="Horário" hint="no fuso informado abaixo">
            <input type="time" className={`${inputCls} min-h-11`} value={horario} disabled={enviando} onChange={(e) => setHorario(e.target.value)} />
          </Campo>
        </> : <Campo label="Quando (cron)" hint="5 campos: minuto, hora, dia do mês, mês e dia da semana">
          <input className={inputCls} value={cron} disabled={enviando} onChange={(e) => setCron(e.target.value)} />
        </Campo>}
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
      {modo === 'simples' && cronEfetivo && <p className="mt-3 text-sm text-muted">
        Toda semana: {DIAS_DA_COLETA[Number(dia)]}, às {horario}, no fuso {tz || 'a informar'}.
      </p>}
      {avisoHorario && <p role="alert" className="mt-3 text-sm text-warn">{avisoHorario}</p>}
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
