'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';

/*
 * O CLAUDE (ANTHROPIC) EM CONEXÕES (leva 5, L8, 27/10/2026).
 *
 * Pedido do Rodrigo (item 21 de 26/10): poder colocar a chave da API do Claude
 * pela tela, como as outras conexões. Esta é a gaveta "Configurar" do cartão
 * "Claude (Anthropic)"; o estado sondado, quem usa e o botão Testar são do
 * `CartaoDeConexao`, como em todo conector.
 *
 * O que mora aqui:
 *   · a CHAVE: de onde vem hoje (cofre desta empresa, variável de ambiente da
 *     API, ou nenhuma), quando foi gravada e só os 4 últimos caracteres. O campo
 *     é de senha, e a chave digitada some ao gravar: ela não volta nunca;
 *   · TESTAR A CHAVE: uma chamada mínima à Anthropic (lista de modelos, sem gastar
 *     token), com a chave que vale agora;
 *   · REMOVER: tira a chave do cofre e volta a valer a variável de ambiente, que
 *     é como a produção sempre rodou;
 *   · MODELO POR FUNÇÃO: só leitura, o que cada agente recebe hoje pela regra do
 *     cadastro (variável por função > cadastro > padrão), com a lista permitida;
 *   · o TETO DIÁRIO de custo de IA desta empresa, com o link da tela que o mostra.
 *
 * Os tipos são locais de propósito: `packages/shared` é de outra lane nesta leva.
 */

type OrigemDaChave = 'cofre' | 'ambiente' | 'nenhuma';
interface EstadoDaChave {
  origem: OrigemDaChave;
  gravadaEm: string | null;
  versao: number | null;
  final: string | null;
  ambienteTemChave: boolean;
}
interface ModeloEmVigor {
  id: string;
  nome: string;
  area: string;
  tipo: 'agente' | 'rotina' | 'automacao';
  estado: string;
  modelo: string;
  esforco: string;
  origem: 'cadastro' | 'variavel' | 'padrao';
}
interface Estado {
  chave: EstadoDaChave;
  modelosPermitidos: string[];
  modelosPorFuncao: ModeloEmVigor[];
  teto: { configurado: boolean; ativo: boolean; tetoUsd: number | null; comprometidoUsd: number | null; restanteUsd: number | null; dia: string | null };
  caminhoDoTeto: string;
}
interface Sonda {
  ok: boolean;
  origem: 'cofre' | 'ambiente' | null;
  final: string | null;
  modelo: string | null;
  latenciaMs: number;
  erro: string | null;
}

const ORIGEM: Record<ModeloEmVigor['origem'], string> = { cadastro: 'do cadastro', variavel: 'da variável por função', padrao: 'do padrão da API' };

const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '';

const usd = (v: number | null) => (v === null ? '' : `US$ ${v.toFixed(2)}`);

function fraseDaChave(c: EstadoDaChave): string {
  if (c.origem === 'cofre') return `Chave gravada no cofre desta empresa em ${quando(c.gravadaEm)} ····${c.final ?? ''}${c.versao && c.versao > 1 ? ` (versão ${c.versao})` : ''}.`;
  if (c.origem === 'ambiente') return 'Usando a variável de ambiente da API. Nenhuma chave gravada aqui.';
  return 'Nenhuma chave: grave uma aqui ou defina a variável de ambiente da API.';
}

function fraseDaSonda(s: Sonda): string {
  const origem = s.origem === 'cofre' ? `a chave do cofre ····${s.final ?? ''}` : 'a chave da variável de ambiente';
  if (s.ok) return `A Anthropic respondeu em ${s.latenciaMs} ms com ${origem}${s.modelo ? ` (modelo listado: ${s.modelo})` : ''}.`;
  return `Erro: ${s.erro ?? 'a Anthropic não respondeu'}${s.origem ? ` (com ${origem})` : ''}`;
}

export function ConexaoClaude({ token, gerenciar, aoMudar }: { token: string; gerenciar: boolean; aoMudar?: () => void }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [sonda, setSonda] = useState<Sonda | null>(null);
  const [chave, setChave] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [confirmarRemocao, setConfirmarRemocao] = useState(false);

  const carregar = useCallback(() => {
    // Resposta sem o formato (API antiga, dublê de teste) não derruba a tela: a gaveta só não mostra o estado.
    apiGet<Estado | null>('/integrations/anthropic/estado', token)
      .then((e) => setEstado(e && typeof e === 'object' && e.chave ? e : null))
      .catch((e) => setErro((e as Error).message));
  }, [token]);

  useEffect(() => carregar(), [carregar]);

  const fazer = async (fn: () => Promise<string | null>) => {
    setOcupado(true);
    setErro(null);
    setAviso(null);
    try {
      const texto = await fn();
      if (texto) setAviso(texto);
      carregar();
      aoMudar?.();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const gravar = () =>
    fazer(async () => {
      const r = await apiPut<{ ok: true; final: string; versao: number }>('/integrations/anthropic/chave', { chave }, token);
      // A chave some do campo e não volta: só o final fica, no estado.
      setChave('');
      setSonda(null);
      return `Chave gravada no cofre da empresa (····${r.final}). Ela não aparece de novo; teste para conferir.`;
    });

  const testar = () =>
    fazer(async () => {
      setSonda(await apiPost<Sonda>('/integrations/anthropic/testar', {}, token));
      return null;
    });

  const remover = () =>
    fazer(async () => {
      const r = await apiDelete<{ ok: true; revogada: boolean; voltaPara: 'ambiente' | 'nenhuma' }>('/integrations/anthropic/chave', token);
      setConfirmarRemocao(false);
      setSonda(null);
      if (!r.revogada) return 'Não havia chave gravada no cofre desta empresa.';
      return r.voltaPara === 'ambiente'
        ? 'Chave removida do cofre. Volta a valer a variável de ambiente da API, como antes.'
        : 'Chave removida do cofre. Não há variável de ambiente: os agentes ficam sem modelo até alguém gravar outra chave.';
    });

  if (!estado) return erro ? <p className="text-sm text-bad">{erro}</p> : null;

  const c = estado.chave;

  return (
    <div className="space-y-4 text-xs" data-testid="conteudo-claude">
      {/* 1. a chave */}
      <section aria-label="Chave da API" className="space-y-2">
        <div className="text-[11px] uppercase tracking-wide text-muted">Chave da API</div>
        <p data-testid="claude-estado-da-chave" className="text-text">{fraseDaChave(c)}</p>
        {c.origem === 'cofre' && c.ambienteTemChave && (
          <p className="text-muted">A variável de ambiente da API continua preenchida: se a chave do cofre for removida, ela volta a valer.</p>
        )}
        {gerenciar && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void gravar();
            }}
          >
            <label className="min-w-0 flex-1">
              <span className="block text-muted">{c.origem === 'cofre' ? 'Trocar a chave da API da Anthropic' : 'Chave da API da Anthropic'}</span>
              <input
                data-testid="claude-chave"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={chave}
                maxLength={400}
                disabled={ocupado}
                onChange={(e) => setChave(e.target.value)}
                placeholder="sk-ant-…"
                className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 font-mono text-xs text-text"
              />
            </label>
            <button type="submit" data-testid="claude-gravar" disabled={ocupado || !chave.trim()} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-50">
              Gravar no cofre
            </button>
          </form>
        )}
        <div className="flex flex-wrap gap-2">
          {gerenciar && (
            <button type="button" data-testid="claude-testar" disabled={ocupado || c.origem === 'nenhuma'} onClick={() => void testar()}
              title={c.origem === 'nenhuma' ? 'Não há chave para testar.' : 'Uma chamada mínima à Anthropic, sem gastar token.'}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-brand disabled:opacity-50">
              Testar a chave
            </button>
          )}
          {gerenciar && c.origem === 'cofre' && (
            <button type="button" data-testid="claude-remover" disabled={ocupado} onClick={() => setConfirmarRemocao(true)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted disabled:opacity-50">
              Remover chave (volta à variável de ambiente)
            </button>
          )}
        </div>
        {confirmarRemocao && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2">
            <span className="text-text">
              Remover tira a chave do cofre desta empresa.{' '}
              {c.ambienteTemChave ? 'Volta a valer a variável de ambiente da API.' : 'Não há variável de ambiente: os agentes ficam sem modelo até alguém gravar outra chave.'}
            </span>
            <button type="button" data-testid="claude-remover-confirmar" disabled={ocupado} onClick={() => void remover()} className="font-medium text-bad disabled:opacity-50">
              remover agora
            </button>
            <button type="button" onClick={() => setConfirmarRemocao(false)} className="text-muted">cancelar</button>
          </div>
        )}
        {sonda && (
          <p data-testid="claude-sonda" role="status" className={`rounded-lg border px-3 py-2 ${sonda.ok ? 'border-good/30 bg-good/10 text-good' : 'border-bad/30 bg-bad/10 text-bad'}`}>
            {fraseDaSonda(sonda)}
          </p>
        )}
        {aviso && <p role="status" className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text">{aviso}</p>}
        {erro && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-bad">{erro}</p>}
      </section>

      {/* 2. modelo por função, só leitura */}
      <section aria-label="Modelo por função" className="space-y-2">
        <div className="text-[11px] uppercase tracking-wide text-muted">Modelo por função</div>
        <p className="text-muted">
          Só leitura: o que cada agente recebe hoje. Modelos permitidos: {estado.modelosPermitidos.join(', ')}. Para trocar, ajuste a lista por função no ambiente da API e suba de novo.
        </p>
        <table data-testid="claude-modelos" className="w-full text-left text-[11px]">
          <thead>
            <tr className="text-muted">
              <th className="py-1 pr-2 font-normal">Função</th>
              <th className="py-1 pr-2 font-normal">Modelo</th>
              <th className="py-1 pr-2 font-normal">Esforço</th>
              <th className="py-1 font-normal">Origem</th>
            </tr>
          </thead>
          <tbody>
            {estado.modelosPorFuncao.map((m) => (
              <tr key={m.id} className="border-t border-border">
                <td className="py-1 pr-2 text-text" title={m.id}>{m.nome} <span className="text-muted">({m.id}{m.estado !== 'ativo' ? ` · ${m.estado}` : ''})</span></td>
                <td className="py-1 pr-2 font-mono text-text">{m.modelo}</td>
                <td className="py-1 pr-2 text-text">{m.esforco}</td>
                <td className="py-1 text-muted">{ORIGEM[m.origem]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* 3. o teto diário */}
      <section aria-label="Teto diário de custo de IA" className="space-y-1" data-testid="claude-teto">
        <div className="text-[11px] uppercase tracking-wide text-muted">Teto diário de custo de IA</div>
        {estado.teto.configurado ? (
          <p className="text-text">
            Teto de {usd(estado.teto.tetoUsd)} por dia{estado.teto.ativo ? '' : ' (em observação: soma e não recusa)'}. Hoje: {usd(estado.teto.comprometidoUsd)} comprometidos, {usd(estado.teto.restanteUsd)} restantes.
          </p>
        ) : (
          <p className="text-muted">Esta empresa não tem teto diário definido: sem teto não há corte nem alerta.</p>
        )}
        <a href={estado.caminhoDoTeto} className="text-[11px] text-brand underline">Ver o teto diário de custo de IA</a>
      </section>
    </div>
  );
}
