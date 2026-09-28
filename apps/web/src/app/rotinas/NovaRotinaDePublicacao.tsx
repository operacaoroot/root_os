'use client';

import { useState } from 'react';
import { apiPost } from '@/lib/api';
import { Botao, Campo, Card, inputCls } from '../referencias/ui';
import { ESTADOS, TIPO_PAUTA_PUBLICAR, type CorpoDaNovaPublicacao, type EstadoDaRotina } from './tipos';

/*
 * "NOVA ROTINA DE PUBLICAÇÃO" — MD6.
 *
 * A rotina que termina a publicação no Instagram já aprovada (o Reels que a
 * Meta ainda processava) e olha as peças no horário. Publicar sozinha, sem
 * ninguém clicar, pede mais duas coisas que não moram aqui: a nota
 * `pauta.publicacao.automatica` ligada e a semana aprovada num lote (MD8).
 * Quem valida é a API.
 */

export const PADRAO_DA_PUBLICACAO = {
  nome: 'Publicação da semana',
  slug: 'publicacao-da-semana',
  cron: '* * * * *',
  tz: 'America/Sao_Paulo',
  estado: 'rodando' as EstadoDaRotina,
};

const CRON_DE_5_CAMPOS = /^(\S+\s+){4}\S+$/;

export function NovaRotinaDePublicacao({ token, onCriada }: { token: string | null; onCriada: () => void }) {
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [nome, setNome] = useState(PADRAO_DA_PUBLICACAO.nome);
  const [slug, setSlug] = useState(PADRAO_DA_PUBLICACAO.slug);
  const [cron, setCron] = useState(PADRAO_DA_PUBLICACAO.cron);
  const [tz, setTz] = useState(PADRAO_DA_PUBLICACAO.tz);
  const [estado, setEstado] = useState<EstadoDaRotina>(PADRAO_DA_PUBLICACAO.estado);

  const valido = nome.trim() !== '' && CRON_DE_5_CAMPOS.test(cron.trim()) && tz.trim() !== '';

  async function criar() {
    setErro(null);
    setEnviando(true);
    const corpo: CorpoDaNovaPublicacao = {
      nome: nome.trim(),
      ...(slug.trim() ? { slug: slug.trim() } : {}),
      tipo: TIPO_PAUTA_PUBLICAR,
      cron: cron.trim(),
      tz: tz.trim(),
      estado,
      config: {},
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
          Nova rotina de publicação
        </Botao>
      </div>
    );
  }

  return (
    <Card titulo="Nova rotina de publicação">
      <p className="mb-3 text-xs text-muted">
        A cada passagem, termina a publicação no Instagram que outra pessoa já aprovou e a Meta ainda processava, e
        olha as peças aprovadas no horário. Publicar sozinha, sem ninguém clicar, também pede a nota{' '}
        <span className="font-mono">pauta.publicacao.automatica</span> ligada e a semana aprovada num lote — sem os
        dois, a passagem só registra que pulou e a peça segue pelo &quot;Publicar agora&quot; ou à mão.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Campo label="Nome">
          <input className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} />
        </Campo>
        <Campo label="Slug" hint="a-z, números e hífen">
          <input className={inputCls} value={slug} onChange={(e) => setSlug(e.target.value)} />
        </Campo>
        <Campo label="Quando (cron)" hint="* * * * * = a cada minuto (a Meta pede o status do vídeo uma vez por minuto)">
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
