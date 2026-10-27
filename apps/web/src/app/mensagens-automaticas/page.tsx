'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPatch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { quando, type ExecucaoResumo, type RotinaResumo, type RotinasList } from '../rotinas/tipos';

/*
 * MENSAGENS AUTOMÁTICAS (27/10/2026, pedido do Lucas: "preciso ter acesso ao fluxo de
 * mensagens automáticas que rodam pelo OS, tanto pra mudar quanto pra ligar e desligar
 * se der merda"). Uma tela só com o que o OS manda sozinho, para onde e quando.
 *
 * NÃO CRIA NADA NOVO: cada linha é uma rotina que já existe, e ligar ou desligar é o
 * mesmo interruptor de /rotinas (PATCH /rotinas/:id { ativo }). "Parar todas" desliga
 * esses mesmos interruptores, um por um. O texto continua onde já é editado (a peça da
 * Comunidade, a regra da DM); onde ele é fixo no código, a tela diz isso.
 */

interface Envio {
  tipo: string;
  nome: string;
  destino: string;
  quando: string;
  texto: { rotulo: string; href?: string };
  aviso?: string;
}

const ENVIOS: Envio[] = [
  {
    tipo: 'tarefas.resumo-do-grupo',
    nome: 'Resumo das tarefas',
    destino: 'Grupo Estratégia e Produto',
    quando: '07h e 18h',
    texto: { rotulo: 'Texto fixo, montado com as tarefas do dia' },
  },
  {
    tipo: 'marketing.comunidade.envio',
    nome: 'Comunidade: news e enquete',
    destino: 'Grupo Operação Root | IA para negócios',
    quando: '08h do dia agendado',
    texto: { rotulo: 'Editar na coluna Comunidade', href: '/marketing/producao' },
  },
  {
    tipo: 'marketing.comunidade.isca',
    nome: 'Comunidade: material da isca',
    destino: 'Grupo Operação Root | IA para negócios',
    quando: 'Ao bater os corações da meta',
    texto: { rotulo: 'Editar no Material da isca da peça', href: '/marketing/producao' },
  },
  {
    tipo: 'pauta.coletar-comentarios',
    nome: 'DM do Instagram',
    destino: 'Quem comentou a palavra-chave',
    quando: 'A cada 10 min',
    texto: { rotulo: 'Editar na regra da semana', href: '/pauta' },
    aviso: 'Desligar também para a leitura dos comentários.',
  },
];

export default function MensagensAutomaticasPage() {
  const { token } = useAuth();
  const [rotinas, setRotinas] = useState<RotinaResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);
  const [historico, setHistorico] = useState<ExecucaoResumo[]>([]);

  const carregar = useCallback(() => {
    if (!token) return;
    apiGet<RotinasList>('/rotinas', token)
      .then((d) => setRotinas(d.items))
      .catch((e) => setErro((e as Error).message));
  }, [token]);
  useEffect(carregar, [carregar]);

  const daLinha = (e: Envio) => rotinas?.find((r) => r.tipo === e.tipo) ?? null;
  const ligadas = ENVIOS.map(daLinha).filter((r): r is RotinaResumo => !!r && r.ativo);

  async function ligar(r: RotinaResumo, ativo: boolean) {
    setErro(null);
    setOcupado(true);
    try {
      await apiPatch(`/rotinas/${r.id}`, { ativo }, token);
    } catch (e) {
      setErro((e as Error).message);
    }
    setOcupado(false);
    carregar();
  }

  async function pararTodas() {
    if (!confirm(`Desligar ${ligadas.length} envio(s) automático(s) agora? Nada sai até alguém religar.`)) return;
    setErro(null);
    setOcupado(true);
    const falhas: string[] = [];
    for (const r of ligadas) {
      try {
        await apiPatch(`/rotinas/${r.id}`, { ativo: false }, token);
      } catch (e) {
        falhas.push(`${r.nome}: ${(e as Error).message}`);
      }
    }
    if (falhas.length) setErro(`Não desliguei: ${falhas.join('; ')}`);
    setOcupado(false);
    carregar();
  }

  async function verHistorico(r: RotinaResumo) {
    if (aberta === r.id) return setAberta(null);
    setAberta(r.id);
    setHistorico([]);
    try {
      setHistorico(await apiGet<ExecucaoResumo[]>(`/rotinas/${r.id}/execucoes?limite=10`, token));
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-sm text-muted">
          O que o OS manda sozinho, para onde vai e quando. Desligar vale na hora, sem mexer no servidor. É o mesmo
          interruptor da tela de Rotinas.
        </p>
        <button
          type="button"
          disabled={ocupado || ligadas.length === 0}
          onClick={() => void pararTodas()}
          className="rounded-root border border-bad/50 px-3 py-1.5 text-sm font-medium text-bad hover:bg-bad/10 disabled:opacity-50"
        >
          Parar todas{ligadas.length ? ` (${ligadas.length} ligada${ligadas.length > 1 ? 's' : ''})` : ''}
        </button>
      </div>

      {erro && <div className="rounded-root border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{erro}</div>}
      {!rotinas && !erro && <p className="text-sm text-muted">Carregando…</p>}

      {rotinas && (
        <div className="divide-y divide-border rounded-xl border border-border bg-surface">
          {ENVIOS.map((e) => {
            const r = daLinha(e);
            return (
              <div key={e.tipo} className="px-4 py-3">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{e.nome}</p>
                    <p className="text-xs text-muted">
                      {e.destino} · {e.quando}
                    </p>
                    <p className="mt-1 text-xs">
                      {e.texto.href ? (
                        <Link href={e.texto.href} className="underline">
                          {e.texto.rotulo}
                        </Link>
                      ) : (
                        <span className="text-muted">{e.texto.rotulo}</span>
                      )}
                      {r && (
                        <>
                          {' · '}
                          <button type="button" className="underline" onClick={() => void verHistorico(r)}>
                            {aberta === r.id ? 'fechar o que saiu' : 'ver o que saiu'}
                          </button>
                        </>
                      )}
                    </p>
                    {r && (
                      <p className="mt-0.5 text-[11px] text-muted">
                        {r.ativo && r.dispara ? `próximo: ${quando(r.proximaExecucaoEm)} · ` : ''}último: {quando(r.ultimaExecucaoEm)}
                        {r.ultimoStatus ? ` · ${r.ultimoStatus}` : ''}
                      </p>
                    )}
                    {e.aviso && r && <p className="mt-0.5 text-[11px] text-muted">{e.aviso}</p>}
                  </div>
                  {r ? (
                    <label className="flex cursor-pointer items-center gap-2 text-xs">
                      <input type="checkbox" checked={r.ativo} disabled={ocupado} onChange={(ev) => void ligar(r, ev.target.checked)} />
                      {r.ativo ? (r.dispara ? 'Ligado' : `Ligado, mas ${r.estado}`) : 'Desligado'}
                    </label>
                  ) : (
                    <span className="text-xs text-muted">Ainda não existe nesta empresa</span>
                  )}
                </div>
                {r && aberta === r.id && (
                  <ul className="mt-2 space-y-1 rounded-root bg-surface-2 p-2.5 text-xs">
                    {historico.length === 0 && <li className="text-muted">Nada registrado ainda.</li>}
                    {historico.map((h) => (
                      <li key={h.id}>
                        <span className="text-muted">{quando(h.inicioEm)}</span> · {h.status}
                        {h.resumo ? ` · ${h.resumo}` : ''}
                        {h.erro ? ` · ${h.erro}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted">
        As respostas do agente de tarefas no grupo (quando alguém chama com @) ligam e desligam em{' '}
        <Link href="/agentes" className="underline">
          Agentes de IA
        </Link>
        . As mensagens do comercial (M1 a M8) são preparadas pelo OS, mas só saem quando alguém confirma.
      </p>
    </div>
  );
}
