'use client';

import { useState } from 'react';
import {
  PAUTA_ETAPAS_DO_ENCADEAMENTO,
  PAUTA_ETAPA_DO_ENCADEAMENTO_ROTULO,
  type PautaEtapaDoEncadeamento,
} from '@mktos/shared';
import { apiPost } from '@/lib/api';
import { Botao, Campo, Card, inputCls } from '../referencias/ui';
import { ESTADOS, TIPO_PAUTA_ENCADEAR, type CorpoDoNovoEncadeamento, type EstadoDaRotina } from './tipos';

/*
 * "NOVA ROTINA DE ENCADEAMENTO" — MD1.
 *
 * A transcrição chega do Mac e o OS anda sozinho, um passo por episódio a cada
 * passagem: pacote, página de links montada (fora do ar), newsletter, semana de
 * posts e os slots PROPOSTOS. Nada é publicado. Sem esta rotina, nada anda
 * sozinho — é ela o interruptor. Quem valida é a API.
 */

export const PADRAO_DO_ENCADEAMENTO = {
  nome: 'Encadeamento da pauta',
  slug: 'encadeamento-da-pauta',
  cron: '*/5 * * * *',
  tz: 'America/Sao_Paulo',
  estado: 'rodando' as EstadoDaRotina,
};

const CRON_DE_5_CAMPOS = /^(\S+\s+){4}\S+$/;

export function NovaRotinaDeEncadeamento({ token, onCriada }: { token: string | null; onCriada: () => void }) {
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [nome, setNome] = useState(PADRAO_DO_ENCADEAMENTO.nome);
  const [slug, setSlug] = useState(PADRAO_DO_ENCADEAMENTO.slug);
  const [cron, setCron] = useState(PADRAO_DO_ENCADEAMENTO.cron);
  const [tz, setTz] = useState(PADRAO_DO_ENCADEAMENTO.tz);
  const [estado, setEstado] = useState<EstadoDaRotina>(PADRAO_DO_ENCADEAMENTO.estado);
  const [etapas, setEtapas] = useState<PautaEtapaDoEncadeamento[]>([...PAUTA_ETAPAS_DO_ENCADEAMENTO]);

  const valido = nome.trim() !== '' && CRON_DE_5_CAMPOS.test(cron.trim()) && tz.trim() !== '' && etapas.length > 0;
  const todas = etapas.length === PAUTA_ETAPAS_DO_ENCADEAMENTO.length;

  const alternar = (e: PautaEtapaDoEncadeamento) =>
    setEtapas((atual) =>
      atual.includes(e) ? atual.filter((x) => x !== e) : PAUTA_ETAPAS_DO_ENCADEAMENTO.filter((x) => x === e || atual.includes(x)),
    );

  async function criar() {
    setErro(null);
    setEnviando(true);
    const corpo: CorpoDoNovoEncadeamento = {
      nome: nome.trim(),
      ...(slug.trim() ? { slug: slug.trim() } : {}),
      tipo: TIPO_PAUTA_ENCADEAR,
      cron: cron.trim(),
      tz: tz.trim(),
      estado,
      // Todas marcadas = config vazia: etapa nova que a API ganhar entra sozinha.
      config: todas ? {} : { etapas },
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
          Nova rotina de encadeamento
        </Botao>
      </div>
    );
  }

  return (
    <Card titulo="Nova rotina de encadeamento">
      <p className="mb-3 text-xs text-muted">
        Quando a transcrição chega do Mac, o OS anda sozinho até a semana em rascunho: um passo por episódio a
        cada passagem, no máximo dois episódios. Nada é publicado — a página de links fica fora do ar e os slots
        ficam só propostos, esperando a aprovação em <a className="underline" href="/pauta">Pauta</a>. Cada passo
        que gasta IA entra no teto de custo da empresa.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Campo label="Nome">
          <input className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} />
        </Campo>
        <Campo label="Slug" hint="a-z, números e hífen">
          <input className={inputCls} value={slug} onChange={(e) => setSlug(e.target.value)} />
        </Campo>
        <Campo label="Quando (cron)" hint="*/5 * * * * = a cada 5 minutos">
          <input className={inputCls} value={cron} onChange={(e) => setCron(e.target.value)} />
        </Campo>
        <Campo label="Fuso">
          <input className={inputCls} value={tz} onChange={(e) => setTz(e.target.value)} />
        </Campo>
        <Campo label="Estado" hint={ESTADOS.find((e) => e.valor === estado)?.explica}>
          <select className={inputCls} value={estado} onChange={(e) => setEstado(e.target.value as EstadoDaRotina)}>
            {ESTADOS.map((e) => (
              <option key={e.valor} value={e.valor}>
                {e.rotulo}
              </option>
            ))}
          </select>
        </Campo>
      </div>
      <fieldset className="mt-3">
        <legend className="mb-1 text-xs text-muted">Etapas que a rotina anda sozinha</legend>
        <ul className="space-y-1">
          {PAUTA_ETAPAS_DO_ENCADEAMENTO.map((e) => (
            <li key={e}>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={etapas.includes(e)} onChange={() => alternar(e)} />
                <span className="break-words">{PAUTA_ETAPA_DO_ENCADEAMENTO_ROTULO[e]}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
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
