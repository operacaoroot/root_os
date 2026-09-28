'use client';

import { useState } from 'react';
import { apiPost } from '@/lib/api';
import { Botao, Campo, Card, inputCls } from '../referencias/ui';
import { ESTADOS, TIPO_PAUTA_COMENTARIOS, type CorpoDaNovaRotinaDeComentarios, type EstadoDaRotina } from './tipos';

/*
 * "NOVA ROTINA DE COMENTÁRIOS" — MD9.
 *
 * A rotina que lê, pela porta e só leitura, os comentários dos posts da semana
 * com palavra-chave e monta a fila "quem comentou e o que responder" da aba
 * Semana. Nada sai do OS: a DM é mandada à mão. Criar a rotina é o que liga a
 * fila; desligar o Instagram em /conexoes para a leitura.
 */

export const PADRAO_DOS_COMENTARIOS = {
  nome: 'Comentários com palavra-chave',
  slug: 'comentarios-com-palavra',
  cron: '*/10 * * * *',
  tz: 'America/Sao_Paulo',
  estado: 'rodando' as EstadoDaRotina,
};

const CRON_DE_5_CAMPOS = /^(\S+\s+){4}\S+$/;

export function NovaRotinaDeComentarios({ token, onCriada }: { token: string | null; onCriada: () => void }) {
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [nome, setNome] = useState(PADRAO_DOS_COMENTARIOS.nome);
  const [slug, setSlug] = useState(PADRAO_DOS_COMENTARIOS.slug);
  const [cron, setCron] = useState(PADRAO_DOS_COMENTARIOS.cron);
  const [tz, setTz] = useState(PADRAO_DOS_COMENTARIOS.tz);
  const [estado, setEstado] = useState<EstadoDaRotina>(PADRAO_DOS_COMENTARIOS.estado);

  const valido = nome.trim() !== '' && CRON_DE_5_CAMPOS.test(cron.trim()) && tz.trim() !== '';

  async function criar() {
    setErro(null);
    setEnviando(true);
    const corpo: CorpoDaNovaRotinaDeComentarios = {
      nome: nome.trim(),
      ...(slug.trim() ? { slug: slug.trim() } : {}),
      tipo: TIPO_PAUTA_COMENTARIOS,
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
          Nova rotina de comentários
        </Botao>
      </div>
    );
  }

  return (
    <Card titulo="Nova rotina de comentários">
      <p className="mb-3 text-xs text-muted">
        A cada passagem, lê os comentários dos posts da semana com palavra-chave publicados nos últimos 7 dias e põe na
        fila da aba Semana quem comentou a palavra, com o texto da DM pronto. Só leitura: a DM é mandada à mão. Precisa
        da conta de publicação com a permissão de comentários e da chave{' '}
        <span className="font-mono">META_WEBHOOK_PESSOA_HMAC_KEY</span> no servidor; sem elas, a passagem pula.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Campo label="Nome">
          <input className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} />
        </Campo>
        <Campo label="Slug" hint="a-z, números e hífen">
          <input className={inputCls} value={slug} onChange={(e) => setSlug(e.target.value)} />
        </Campo>
        <Campo label="Quando (cron)" hint="*/10 * * * * = a cada 10 minutos (cerca de 6 leituras por hora por post)">
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
