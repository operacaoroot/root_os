'use client';

import { useState } from 'react';
import { ROTULO_DO_TIPO_DE_NEGOCIO, type ComercialTipoDeNegocio } from '@mktos/shared';
import type { ClienteDaCarteira } from '@/components/clientes/ClienteEscopo';
import { BOTAO_DA_CARTEIRA, SelecaoDaCarteira } from '@/components/clientes/SelecaoDaCarteira';
import { RegistrosPaginadosDaCarteira, type PaginaDaCarteira } from '@/components/clientes/RegistrosPaginadosDaCarteira';
import { diaCompleto } from '@/lib/datas-do-cartao';

type Situacao = 'previsto' | 'realizado' | 'conciliado';
type Base = { id: string; clienteId: string; valor: string };
type Recebivel = Base & {
  descricao: string;
  status: Situacao;
  data: string;
  vencimento: string | null;
  recebidoEm: string | null;
};
type Parcela = { id: string; numero: number; valor: string; vencimento: string; pagaEm: string | null };
type Acordo = Base & {
  produto: string;
  tipo: ComercialTipoDeNegocio;
  fechadoEm: string | null;
  parcelas?: Parcela[];
  parcelasIncompletas?: boolean;
};
type Registro = Recebivel | Acordo;
type Estado = { status: Situacao; quantidade: number; valor: string };
type PaginaFinanceira = PaginaDaCarteira<Registro> & { periodo: null; estados?: Estado[] };
type Secao = 'recebiveis' | 'acordos';

const SECOES = {
  recebiveis: { nome: 'Recebíveis', rotulo: 'Recebíveis do cliente', busca: 'Buscar recebíveis', vazio: 'Nenhum recebível encontrado.' },
  acordos: { nome: 'Acordos', rotulo: 'Acordos do cliente', busca: 'Buscar acordos', vazio: 'Nenhum acordo encontrado.' },
};
const SITUACOES: Record<Situacao, string> = { previsto: 'Previsto', realizado: 'Realizado', conciliado: 'Conciliado' };

function reaisDecimais(valor: string): string {
  const partes = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(valor);
  if (!partes) return '—';
  const [, sinal, inteiro, decimal = ''] = partes;
  const grupos = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sinal}R$ ${grupos},${decimal.padEnd(2, '0')}`;
}

function tituloDoRegistro(r: Registro) {
  return 'descricao' in r ? r.descricao : r.produto;
}
function tipoDoRegistro(r: Registro) {
  return 'descricao' in r ? SITUACOES[r.status] : ROTULO_DO_TIPO_DE_NEGOCIO[r.tipo];
}

export function FinanceiroDaCarteira({ clientes, token }: { clientes: ClienteDaCarteira[]; token: string }) {
  const [secao, setSecao] = useState<Secao>('recebiveis');
  const { rotulo, busca, vazio } = SECOES[secao];

  return (
    <section className="mx-auto max-w-6xl space-y-4 [overflow-wrap:anywhere]">
      <h1 className="text-lg font-semibold">Financeiro por cliente</h1>
      <SelecaoDaCarteira clientes={clientes} rotulo="Cliente do Financeiro">
        {(cliente) => (
          <>
            <div role="group" aria-label="Dados do Financeiro" className="flex flex-wrap gap-2">
              {(['recebiveis', 'acordos'] as const).map((s) => (
                <button key={s} type="button" aria-pressed={secao === s}
                  className={`${BOTAO_DA_CARTEIRA}${secao === s ? ' border-brand text-brand' : ''}`}
                  onClick={() => setSecao(s)}>
                  {SECOES[s].nome}
                </button>
              ))}
            </div>
            <RegistrosPaginadosDaCarteira<Registro, PaginaFinanceira> key={`${cliente.id}:${secao}`}
              clienteId={cliente.id} token={token} base={`/finance/carteira/${secao}`}
              rotulo={rotulo} buscaRotulo={busca} vazio={vazio}
              identificar={(r) => ('descricao' in r) === (secao === 'recebiveis') ? r.id : undefined}
              titulo={tituloDoRegistro}
              subtitulo={(r) => [tipoDoRegistro(r), reaisDecimais(r.valor)].filter(Boolean).join(' · ')}
              resumo={secao === 'recebiveis' ? (dados, termo) => <ResumoDosRecebiveis dados={dados} busca={termo} /> : undefined}
              detalhe={(r) => <DetalheFinanceiro registro={r} />} />
          </>
        )}
      </SelecaoDaCarteira>
    </section>
  );
}

function ResumoDosRecebiveis({ dados, busca }: { dados: PaginaFinanceira; busca: string }) {
  if (!dados.total || !Array.isArray(dados.estados) || !dados.estados.length || dados.periodo !== null) return null;
  return (
    <section className="space-y-2" aria-label="Valores por situação">
      <h2 className="text-sm font-medium">Valores por situação</h2>
      <p className="text-sm text-muted">
        Valores brutos dos lançamentos de entrada vinculados a contratos deste cliente. Todos os períodos{busca ? ` · busca por “${busca}”` : ''}.
      </p>
      <dl className="grid gap-2 sm:grid-cols-3">
        {dados.estados.map((estado) => (
          <div key={estado.status} className="min-w-0 rounded-root border border-border bg-surface p-3">
            <dt className="text-sm text-muted">{SITUACOES[estado.status]}</dt>
            <dd className="font-medium tabular-nums">{reaisDecimais(estado.valor)}</dd>
            <dd className="text-xs text-muted">{estado.quantidade} {estado.quantidade === 1 ? 'título' : 'títulos'}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function DetalheFinanceiro({ registro: r }: { registro: Registro }) {
  const campos = 'descricao' in r
    ? [['Situação', tipoDoRegistro(r)], ['Valor do título', reaisDecimais(r.valor)], ['Data do lançamento', diaCompleto(r.data)],
      ['Vencimento', diaCompleto(r.vencimento)], ['Recebido em', diaCompleto(r.recebidoEm)]]
    : [['Tipo', tipoDoRegistro(r)], ['Valor do acordo', reaisDecimais(r.valor)], ['Fechado em', diaCompleto(r.fechadoEm)]];
  return (
    <>
      <dl className="grid gap-2 sm:grid-cols-2">
        {campos.filter(([, valor]) => valor).map(([rotulo, valor]) => (
          <div key={rotulo} className="min-w-0 break-words">
            <dt className="text-muted">{rotulo}</dt>
            <dd>{valor}</dd>
          </div>
        ))}
      </dl>
      {!('descricao' in r) && <ParcelasDaCarteira parcelas={r.parcelas ?? []} incompletas={r.parcelasIncompletas === true} />}
    </>
  );
}

function ParcelasDaCarteira({ parcelas, incompletas }: { parcelas: Parcela[]; incompletas: boolean }) {
  return (
    <section aria-label="Parcelas do acordo" className="space-y-2">
      <h3 className="font-medium">Parcelas do acordo</h3>
      {incompletas && <p role="status" className="text-warn">Há parcelas fora da consulta por inconsistência no vínculo de recebimento.</p>}
      {parcelas.length === 0
        ? <p className="text-muted">Nenhuma parcela disponível.</p>
        : <ul className="divide-y divide-border rounded-root border border-border">
          {parcelas.map((p) => (
            <li key={p.id} className="space-y-1 px-3 py-2">
              <p className="font-medium">Parcela {p.numero}</p>
              <dl className="flex flex-wrap gap-x-5 gap-y-1">
                <div><dt className="text-muted">Valor</dt><dd className="tabular-nums">{reaisDecimais(p.valor)}</dd></div>
                <div><dt className="text-muted">Vencimento</dt><dd>{diaCompleto(p.vencimento) ?? '—'}</dd></div>
                <div><dt className="text-muted">Recebimento</dt><dd>{diaCompleto(p.pagaEm) ?? 'Sem data'}</dd></div>
              </dl>
            </li>
          ))}
        </ul>}
    </section>
  );
}
