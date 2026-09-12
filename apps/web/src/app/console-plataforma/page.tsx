'use client';

import { useCallback, useEffect, useState } from 'react';
import { ErroDaApi, apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Botao, Card, Chip, Kpi } from '../referencias/ui';

/*
 * ============================================================================
 * O CONSOLE DA PLATAFORMA — a tela de quem opera a ROOT (RF-B-02, fatia 6.3)
 * ============================================================================
 *
 * O QUE ELA MOSTRA: saúde, uso e cobrança POR empresa.
 * O QUE ELA NÃO MOSTRA: dado de empresa nenhuma. Nenhum lead, nenhuma mensagem,
 * nenhum lançamento, nenhum nome de pessoa do cliente. Isso não é disciplina de
 * quem escreveu esta tela — a API simplesmente não tem rota que devolva isso a
 * uma sessão de plataforma (ver `apps/api/src/platform/plataforma.ts`).
 *
 * ESTA TELA É CORTESIA, NÃO SEGURANÇA. Quem recusa é a API: `SessaoDaPlataformaGuard`
 * responde 403 para qualquer sessão que não seja a da empresa da plataforma — a
 * de `SLUG_DA_PLATAFORMA` (`apps/api/src/tenants/provisionar.ts`, hoje `root`),
 * a MESMA constante que o provisionamento usa —, e a cerca do console recusa
 * modelo, operação e argumento fora da superfície. Se alguém abrir esta URL sem
 * ser operador, a tela monta e cada chamada volta 403 — que é o que ela diz em
 * vez de quebrar.
 *
 * O ACESSO DE SUPORTE, DO LADO DAQUI: o operador não pede acesso, não se
 * autoriza e não tem botão para isso. Ele só USA o que o cliente já autorizou —
 * e mesmo então o que volta é CONTAGEM (quantas sessões, quantas falhas,
 * quantas aprovações paradas), com o prazo do acesso na tela. Quando não há
 * autorização, ou quando ela venceu, a API recusa e a tela diz qual dos dois
 * foi, porque as duas coisas pedem conversas diferentes com o cliente.
 *
 * O ITEM DE MENU não existe: `packages/shared/src/nav.ts` é a fonte única da
 * navegação e não é desta fatia. O endereço é digitado. Está no relatório.
 */

interface Resumo {
  empresas: number;
  ativas: number;
  suspensas: number;
  encerradas: number;
  comIncidente: number;
  inadimplentes: number;
  receitaMensalBrl: number;
  gastoIaUsdMes: number;
}

interface Empresa {
  empresaId: string;
  nome: string;
  slug: string;
  plano: string;
  estado: string;
  saude: string;
  usuarios: number;
  agentesAtivos: number;
  gastoIaUsdMes: number;
  mensalidadeBrl: number;
  cobrancaEmDia: boolean;
  proximaCobranca: string | null;
  medidoEm: string | null;
  ultimaAtividadeEm: string | null;
  observacao: string | null;
}

interface Diagnostico {
  empresaId: string;
  escopo: string;
  janelaHoras: number;
  sessoesNaJanela: number;
  sessoesQueFalharam: number;
  aprovacoesPendentes: number;
  rotinasQueFalharam: number;
  acessoExpiraEm: string;
}

const BASE = '/tenants/plataforma';

export default function ConsoleDaPlataforma() {
  const { token, ready } = useAuth();
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    if (!token) return;
    setCarregando(true);
    setErro(null);
    try {
      await apiGet<{ plataforma: true }>(`${BASE}/quem-sou`, token);
      setAutorizado(true);
      const [r, e] = await Promise.all([
        apiGet<Resumo>(`${BASE}/resumo`, token),
        apiGet<Empresa[]>(`${BASE}/empresas`, token),
      ]);
      setResumo(r);
      setEmpresas(e);
    } catch (e) {
      // 403 aqui é a resposta certa para quem não opera a plataforma: a tela
      // explica em vez de mostrar uma casca vazia com ar de defeito.
      if (e instanceof ErroDaApi && e.status === 403) setAutorizado(false);
      else setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [token]);

  useEffect(() => {
    if (ready) void carregar();
  }, [ready, carregar]);

  if (!ready || carregando) return <Aviso>carregando…</Aviso>;

  if (autorizado === false) {
    return (
      <Aviso>
        <p className="text-[12px] text-text">Esta área é do console da plataforma.</p>
        <p className="mt-2 text-[11.5px] leading-[1.6] text-muted">
          A sua sessão é de uma empresa cliente. O console é a visão de quem opera a ROOT e não
          mostra dado de empresa nenhuma — inclusive o da sua.
        </p>
      </Aviso>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-os-mono text-[13px] font-bold tracking-[-0.01em] text-text">
          Console da plataforma
        </h1>
        <p className="mt-1 max-w-[720px] text-[11.5px] leading-[1.6] text-muted">
          Saúde, uso e cobrança por empresa. Nada aqui mostra dado de cliente: para entrar na conta
          de alguém é preciso uma autorização de suporte dada pelo próprio cliente, com prazo, e ela
          fica registrada no rastro da empresa dele.
        </p>
      </header>

      {erro && (
        <div className="rounded-xl border border-bad/40 bg-bad/10 p-4 text-[11.5px] text-bad">
          {erro}
        </div>
      )}

      {resumo && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="empresas" valor={resumo.empresas} />
          <Kpi label="ativas" valor={resumo.ativas} />
          <Kpi label="com incidente" valor={resumo.comIncidente} />
          <Kpi label="inadimplentes" valor={resumo.inadimplentes} />
          <Kpi label="receita mensal" valor={brl(resumo.receitaMensalBrl)} />
          <Kpi label="gasto de IA no mês" valor={usd(resumo.gastoIaUsdMes)} />
          <Kpi label="suspensas" valor={resumo.suspensas} />
          <Kpi label="encerradas" valor={resumo.encerradas} />
        </div>
      )}

      <Card
        titulo="empresas"
        acao={
          <Botao tone="ghost" onClick={() => void carregar()}>
            recarregar
          </Botao>
        }
      >
        {empresas.length === 0 ? (
          <p className="text-[11.5px] leading-[1.6] text-muted">
            Nenhuma empresa registrada no console — e é assim que ele nasce. O registro é feito por{' '}
            <code className="text-text">PUT /api{BASE}/empresas/:empresaId</code>; o console não
            varre a tabela de empresas de propósito, porque varrer exigiria uma leitura que
            alcançaria também os usuários de cada cliente. Empresa não registrada aqui também não
            aceita acesso de suporte.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-[11.5px]">
              <thead className="font-os-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                <tr>
                  <th className="py-2">empresa</th>
                  <th>plano</th>
                  <th>estado</th>
                  <th>saúde</th>
                  <th className="text-right">usuários</th>
                  <th className="text-right">IA (mês)</th>
                  <th className="text-right">mensalidade</th>
                  <th>medido em</th>
                  <th className="text-right">suporte</th>
                </tr>
              </thead>
              <tbody>
                {empresas.map((e) => (
                  <LinhaDaEmpresa key={e.empresaId} empresa={e} token={token} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function LinhaDaEmpresa({ empresa, token }: { empresa: Empresa; token: string | null }) {
  const [diag, setDiag] = useState<Diagnostico | null>(null);
  const [recusa, setRecusa] = useState<string | null>(null);
  const [indo, setIndo] = useState(false);

  async function entrar() {
    if (!token) return;
    setIndo(true);
    setRecusa(null);
    try {
      const d = await apiPost<Diagnostico>(
        `${BASE}/empresas/${encodeURIComponent(empresa.empresaId)}/suporte`,
        { escopo: 'diagnostico' },
        token,
      );
      setDiag(d);
    } catch (e) {
      // O código vem em vocabulário fechado (`sem_autorizacao`, `expirado`,
      // `revogado`) justamente para a tela não depender da frase em português.
      setRecusa(textoDaRecusa(e));
      setDiag(null);
    } finally {
      setIndo(false);
    }
  }

  return (
    <>
      <tr className="border-t border-border">
        <td className="py-2">
          <span className="text-text">{empresa.nome}</span>
          <span className="ml-2 text-muted">/{empresa.slug}</span>
        </td>
        <td>{empresa.plano}</td>
        <td>
          <Chip tone={empresa.estado === 'ativa' ? 'good' : 'warn'}>{empresa.estado}</Chip>
        </td>
        <td>
          <Chip tone={tomDaSaude(empresa.saude)}>{empresa.saude}</Chip>
        </td>
        <td className="text-right">{empresa.usuarios}</td>
        <td className="text-right">{usd(empresa.gastoIaUsdMes)}</td>
        <td className="text-right">
          {brl(empresa.mensalidadeBrl)}
          {!empresa.cobrancaEmDia && <span className="ml-1 text-bad">•</span>}
        </td>
        <td className="text-muted">{quando(empresa.medidoEm)}</td>
        <td className="text-right">
          <Botao tone="ghost" onClick={() => void entrar()} disabled={indo}>
            {indo ? 'entrando…' : 'usar acesso'}
          </Botao>
        </td>
      </tr>
      {(diag || recusa) && (
        <tr className="border-t border-border/50 bg-surface-2/40">
          <td colSpan={9} className="px-2 py-3 text-[11px]">
            {recusa && <span className="text-warn">{recusa}</span>}
            {diag && (
              <span className="text-muted">
                últimas {diag.janelaHoras} h — sessões: <b className="text-text">{diag.sessoesNaJanela}</b>
                {' · '}falharam: <b className="text-text">{diag.sessoesQueFalharam}</b>
                {' · '}aprovações paradas: <b className="text-text">{diag.aprovacoesPendentes}</b>
                {' · '}rotinas com erro: <b className="text-text">{diag.rotinasQueFalharam}</b>
                {' · '}acesso vence {quando(diag.acessoExpiraEm)}. Este acesso ficou registrado no
                rastro da empresa.
              </span>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[520px] border border-border bg-bg2 p-6 font-os-mono text-[11px] text-muted">
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- ajudantes */

function textoDaRecusa(e: unknown): string {
  const codigo = e instanceof ErroDaApi ? e.codigo : null;
  if (codigo === 'sem_autorizacao') {
    return 'Esta empresa não autorizou acesso de suporte. Quem autoriza é o cliente, na tela dele — ninguém daqui consegue conceder.';
  }
  if (codigo === 'expirado') return 'A autorização de suporte venceu. Peça uma nova ao cliente.';
  if (codigo === 'revogado') return 'A autorização de suporte foi revogada pelo cliente.';
  if (codigo === 'escopo_nao_autorizado') return 'A autorização não cobre este escopo.';
  if (codigo === 'operador_diferente') return 'A autorização foi dada a outra pessoa.';
  return (e as Error).message;
}

function tomDaSaude(s: string): 'good' | 'warn' | 'bad' | 'muted' {
  if (s === 'ok') return 'good';
  if (s === 'atencao') return 'warn';
  if (s === 'incidente') return 'bad';
  return 'muted';
}

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function usd(v: number): string {
  return `US$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function quando(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
