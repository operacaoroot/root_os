'use client';

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  PAUTA_HORAS_DA_CURADORIA,
  PAUTA_ORIGEM_ROTULOS,
  PAUTA_ORIGENS,
  type PautaItemCurado,
  type PautaOrigem,
  type PautaRodadaDetalhe,
  type PautaRodadaList,
} from '@mktos/shared';
import { apiGet, apiPost, apiPut } from '@/lib/api';
import { Botao, Card, Chip, inputCls } from '../referencias/ui';

/*
 * CURADORIA HUMANA (MC6). A rodada "para curadoria" chega com todos os
 * candidatos da janela; a IA só acende `sugerido`. Quem decide o que segue é
 * quem marca aqui — confirmar deixa só os marcados e a rodada vira `curada`,
 * e dali em diante é a rodada de sempre, na aba Rodadas.
 */

interface Props {
  token: string | null;
  editavel: boolean;
  onErro: (m: string | null) => void;
  bump: number;
  onMudou: () => void;
  /** A rodada que a aba Rodadas mandou abrir; sem ela, abre a pendente mais recente. */
  inicial?: string | null;
}

type Candidato = PautaItemCurado & { id: string };
type Filtro = 'todas' | PautaOrigem;

const JANELAS = [
  { horas: 72, rotulo: 'últimos 3 dias' },
  { horas: PAUTA_HORAS_DA_CURADORIA, rotulo: 'última semana' },
] as const;

function ehOrigem(o: unknown): o is PautaOrigem {
  return typeof o === 'string' && (PAUTA_ORIGENS as readonly string[]).includes(o);
}

function origensDe(c: Candidato): PautaOrigem[] {
  if (c.origens?.length) return c.origens;
  return ehOrigem(c.origem) ? [c.origem] : [];
}

function mesmoConjunto(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

export function AbaCuradoria({ token, editavel, onErro, bump, onMudou, inicial = null }: Props) {
  const [pendentes, setPendentes] = useState<PautaRodadaList['items'] | null>(null);
  const [selecionada, setSelecionada] = useState<string | null>(inicial);
  const [detalhe, setDetalhe] = useState<PautaRodadaDetalhe | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [salvos, setSalvos] = useState<Set<string>>(new Set());
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [soSugeridos, setSoSugeridos] = useState(false);
  const [horas, setHoras] = useState<number>(PAUTA_HORAS_DA_CURADORIA);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    apiGet<PautaRodadaList>('/pauta/rodadas?limite=100', token)
      .then((d) => {
        const lista = d.items.filter((r) => r.status === 'aguardando_curadoria');
        setPendentes(lista);
        setSelecionada((atual) => (atual && lista.some((r) => r.id === atual) ? atual : (lista[0]?.id ?? null)));
      })
      .catch((e: Error) => onErro(e.message));
  }, [token, bump, onErro]);

  useEffect(() => {
    if (!token || !selecionada) {
      setDetalhe(null);
      return;
    }
    // Trocar de rodada tira a lista anterior da tela na hora, e a resposta que
    // chegar atrasada é descartada: os ids dos candidatos são os das capturas, e
    // duas curadorias de janelas sobrepostas os repetem — a marcação feita
    // olhando a lista de uma iria gravada na outra.
    let vivo = true;
    setDetalhe((d) => (d && d.id === selecionada ? d : null));
    apiGet<PautaRodadaDetalhe>(`/pauta/rodadas/${selecionada}`, token)
      .then((d) => {
        if (!vivo) return;
        setDetalhe(d);
        const ja = new Set(d.itens.filter((i) => i.id && i.marcado).map((i) => i.id as string));
        setMarcados(ja);
        setSalvos(new Set(ja));
      })
      .catch((e: Error) => {
        if (vivo) onErro(e.message);
      });
    return () => {
      vivo = false;
    };
  }, [token, selecionada, bump, onErro]);

  const candidatos = useMemo<Candidato[]>(
    () => (detalhe?.itens ?? []).filter((i): i is Candidato => typeof i.id === 'string'),
    [detalhe],
  );

  const porOrigem = useMemo(() => {
    const conta = new Map<PautaOrigem, number>();
    for (const c of candidatos) for (const o of origensDe(c)) conta.set(o, (conta.get(o) ?? 0) + 1);
    return conta;
  }, [candidatos]);

  const visiveis = candidatos.filter(
    (c) => (filtro === 'todas' || origensDe(c).includes(filtro)) && (!soSugeridos || c.sugerido),
  );
  const sugeridos = candidatos.filter((c) => c.sugerido);
  const sujo = !mesmoConjunto(marcados, salvos);
  // Uma escrita de cada vez: Salvar atrasado terminando depois de Confirmar
  // devolveria "saiu da curadoria" ao lado do aviso de sucesso.
  const escrevendo = ocupado !== null;

  const acao = async (nome: string, fn: () => Promise<void>) => {
    onErro(null);
    setAviso(null);
    setOcupado(nome);
    try {
      await fn();
    } catch (e) {
      onErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const alternar = (id: string) =>
    setMarcados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });

  const gerar = () =>
    acao('gerar', async () => {
      const r = await apiPost<{ id: string }>('/pauta/rodadas/curadoria', { horas }, token);
      setSelecionada(r.id);
      onMudou();
    });

  const salvar = () =>
    acao('salvar', async () => {
      if (!selecionada) return;
      await apiPut(`/pauta/rodadas/${selecionada}/curadoria`, { marcados: [...marcados] }, token);
      setSalvos(new Set(marcados));
      setAviso('Marcação salva.');
    });

  const confirmar = () =>
    acao('confirmar', async () => {
      if (!selecionada) return;
      const r = await apiPost<{ itens: number }>(
        `/pauta/rodadas/${selecionada}/curadoria/confirmar`,
        { marcados: [...marcados] },
        token,
      );
      setAviso(`Curadoria confirmada: ${r.itens} item(ns) seguem. A rodada está em Rodadas, pronta para gerar peças.`);
      setSelecionada(null);
      onMudou();
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={`${inputCls} w-auto`}
          value={horas}
          onChange={(e) => setHoras(Number(e.target.value))}
          disabled={!editavel}
          aria-label="Janela da coleta"
        >
          {JANELAS.map((j) => (
            <option key={j.horas} value={j.horas}>
              {j.rotulo}
            </option>
          ))}
        </select>
        <Botao tone="brand" onClick={gerar} disabled={!editavel || escrevendo}>
          {ocupado === 'gerar' ? 'Montando a lista…' : 'Montar lista para curadoria'}
        </Botao>
        {pendentes && pendentes.length > 1 && (
          <select
            className={`${inputCls} w-auto max-w-full`}
            value={selecionada ?? ''}
            onChange={(e) => setSelecionada(e.target.value)}
            disabled={escrevendo}
            aria-label="Rodada aguardando curadoria"
          >
            {pendentes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.titulo} · {new Date(r.criadaEm).toLocaleDateString('pt-BR')}
              </option>
            ))}
          </select>
        )}
      </div>

      {aviso && (
        <p role="status" className="rounded-lg border border-good/40 bg-good/10 px-3 py-2 text-sm text-good">
          {aviso}
        </p>
      )}

      {pendentes && pendentes.length === 0 && !detalhe && (
        <Card>
          <p className="text-sm text-muted">
            Nenhuma rodada aguardando curadoria. Monte a lista: entram todos os itens coletados na janela, a IA
            sugere os que levaria, e só o que você marcar segue para o roteiro.
          </p>
        </Card>
      )}

      {detalhe && (
        <>
          <div>
            <p className="text-sm font-medium">{detalhe.titulo}</p>
            <p className="text-[11px] text-muted">
              {new Date(detalhe.janelaIni).toLocaleDateString('pt-BR')} a{' '}
              {new Date(detalhe.janelaFim).toLocaleDateString('pt-BR')} · {candidatos.length} candidato(s) ·{' '}
              {sugeridos.length} sugerido(s) pela IA
            </p>
            {detalhe.erro && <p className="mt-1 text-xs text-warn">{detalhe.erro}</p>}
          </div>

          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por origem">
            <FiltroBotao ativo={filtro === 'todas'} onClick={() => setFiltro('todas')}>
              Todas ({candidatos.length})
            </FiltroBotao>
            {PAUTA_ORIGENS.filter((o) => porOrigem.has(o)).map((o) => (
              <FiltroBotao key={o} ativo={filtro === o} onClick={() => setFiltro(o)} titulo={PAUTA_ORIGEM_ROTULOS[o]}>
                {o} · {PAUTA_ORIGEM_ROTULOS[o]} ({porOrigem.get(o)})
              </FiltroBotao>
            ))}
            <label className="ml-1 inline-flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={soSugeridos} onChange={(e) => setSoSugeridos(e.target.checked)} />
              só sugeridos
            </label>
          </div>

          <ul className="space-y-2">
            {visiveis.map((c) => {
              const marcado = marcados.has(c.id);
              return (
                <li
                  key={c.id}
                  className={`flex items-start gap-3 rounded-lg border p-3 ${
                    c.sugerido ? 'border-brand/60 bg-brand/5' : 'border-border bg-surface'
                  }`}
                >
                  {/* A caixa é pequena para o dedo: o rótulo em volta leva o alvo a 44px. */}
                  <label className="-m-3 shrink-0 cursor-pointer p-3">
                    <input
                      type="checkbox"
                      className="block h-5 w-5 accent-brand"
                      checked={marcado}
                      onChange={() => alternar(c.id)}
                      disabled={!editavel}
                      aria-label={`Marcar: ${c.titulo}`}
                    />
                  </label>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      {origensDe(c).map((o) => (
                        <span
                          key={o}
                          className="inline-block rounded border border-border px-1 font-mono text-[11px] text-muted"
                          title={PAUTA_ORIGEM_ROTULOS[o]}
                          aria-label={`Origem: ${PAUTA_ORIGEM_ROTULOS[o]}`}
                        >
                          {o}
                        </span>
                      ))}
                      {c.sugerido && <Chip tone="brand">sugerido</Chip>}
                      {c.semLinkPublico && <Chip>só contexto</Chip>}
                      {c.fonte && <span className="truncate text-[11px] text-muted">{c.fonte}</span>}
                    </div>
                    {c.url ? (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-start gap-1 break-words text-sm text-brand hover:underline"
                      >
                        <span className="break-words">{c.titulo}</span>
                        <ExternalLink size={12} className="mt-1 shrink-0" />
                      </a>
                    ) : (
                      <p className="break-words text-sm">{c.titulo}</p>
                    )}
                    {c.resumo && <p className="mt-1 line-clamp-3 break-words text-xs text-muted">{c.resumo}</p>}
                    {c.sugerido && c.porque && <p className="mt-1 break-words text-xs text-brand">IA: {c.porque}</p>}
                  </div>
                </li>
              );
            })}
            {visiveis.length === 0 && <li className="text-sm text-muted">Nada neste filtro.</li>}
          </ul>

          {/* pr-40 deixa livre o canto do botão flutuante "perguntar" (fixed, z-40), que cobriria o Confirmar. */}
          <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-2 border-t border-border bg-bg/95 py-3 pl-1 pr-40 backdrop-blur">
            <span className="text-sm" aria-live="polite">
              <strong>{marcados.size}</strong> de {candidatos.length} marcado(s)
            </span>
            {sujo && <span className="text-xs text-warn">não salvo</span>}
            <div className="flex flex-wrap gap-2">
              <Botao
                tone="ghost"
                onClick={() => setMarcados(new Set([...marcados, ...sugeridos.map((c) => c.id)]))}
                disabled={!editavel || sugeridos.length === 0}
              >
                Marcar sugeridos
              </Botao>
              <Botao tone="ghost" onClick={() => setMarcados(new Set())} disabled={!editavel || marcados.size === 0}>
                Limpar
              </Botao>
              <Botao onClick={salvar} disabled={!editavel || !sujo || escrevendo}>
                {ocupado === 'salvar' ? 'Salvando…' : 'Salvar'}
              </Botao>
              <Botao
                tone="brand"
                onClick={confirmar}
                disabled={!editavel || marcados.size === 0 || escrevendo}
                title={marcados.size === 0 ? 'Marque pelo menos um item' : 'Só os marcados seguem'}
              >
                {ocupado === 'confirmar' ? 'Confirmando…' : `Confirmar (${marcados.size})`}
              </Botao>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FiltroBotao({
  ativo,
  onClick,
  titulo,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  titulo?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      aria-pressed={ativo}
      className={`rounded-full border px-2.5 py-1 text-xs ${
        ativo ? 'border-brand bg-brand/15 text-brand' : 'border-border text-muted hover:text-text'
      }`}
    >
      {children}
    </button>
  );
}
