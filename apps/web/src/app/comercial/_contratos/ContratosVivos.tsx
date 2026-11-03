'use client';

import { useMemo, useState } from 'react';
import {
  ROTULO_DA_SITUACAO_DO_CONTRATO, SITUACOES_DO_CONTRATO,
  type ContratoVivo, type SituacaoDoContrato,
} from '@mktos/shared';

import { useAuth } from '@/lib/auth';
import { ROTULO_DO_PRODUTO, contarParcelas, dataDoDia, numeroOuAusente, reaisOuAusente } from '@/lib/cockpit';

import { Aviso, BarraDaSaude, BOTAO, CARTAO, Carregando, Chip, Erro, FOCO, INPUT, ROTULO } from '../_ui';
import { LinkDoLead } from '../_painel/provedor';
import { ContratosImportados } from '../_painel/ContratosImportados';
import { FormularioDeEncerrar } from './EncerrarVivo';

/*
 * PARCELAS E ENCERRAMENTO (a lista da T8, 19/10/2026, agora em `?visao=vivos`).
 *
 * O quadro e a lista de registros vieram por cima (F4, 02/11/2026), e esta visão fica
 * porque é dela o que eles não têm: parcelas, saúde, fase da implantação, o importado
 * com "anexar PDF" e os dois encerramentos da rota antiga. Encerrar é à mão (decisão do
 * Rodrigo): "Concluir contrato" e "Desativar contrato", com motivo, no fio e na
 * auditoria. Parcela em aberto avisa e a cobrança NÃO é cancelada (fica com a mesa).
 */

const TOM_DA_SITUACAO: Record<SituacaoDoContrato, 'bom' | 'info' | 'neutro' | 'alerta'> = {
  ativo: 'bom', em_implantacao: 'info', concluido: 'neutro', desativado: 'alerta',
};

const soDigitos = (t: string) => t.replace(/\D/g, '');
const semAcento = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');

export function ContratosVivos({ dados, erro, carregando, recarregar }: {
  dados: ContratoVivo[] | null;
  erro: unknown;
  carregando: boolean;
  recarregar: () => void | Promise<void>;
}) {
  const { can } = useAuth();
  const podeEncerrar = can('leads.editar');
  const [busca, setBusca] = useState('');
  const [situacao, setSituacao] = useState<'' | SituacaoDoContrato>('');
  const [produto, setProduto] = useState('');
  const [socio, setSocio] = useState('');
  const [encerrando, setEncerrando] = useState<{ leadId: string; situacao: 'concluido' | 'desativado' } | null>(null);

  const todos = useMemo(() => dados ?? [], [dados]);
  const contagem = useMemo(() => ({
    ativo: todos.filter((c) => c.situacao === 'ativo' || c.situacao === 'em_implantacao').length,
    em_implantacao: todos.filter((c) => c.situacao === 'em_implantacao').length,
    concluido: todos.filter((c) => c.situacao === 'concluido').length,
    desativado: todos.filter((c) => c.situacao === 'desativado').length,
  }), [todos]);
  const produtos = [...new Set(todos.map((c) => c.produto).filter((p): p is NonNullable<ContratoVivo['produto']> => !!p))];
  const socios = [...new Set(todos.map((c) => c.socioDaConta).filter((s): s is string => !!s))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const visiveis = todos.filter((c) => {
    const q = busca.trim();
    if (q) {
      const porNome = semAcento(c.cliente).includes(semAcento(q));
      const porCnpj = !!soDigitos(q) && !!c.cnpj && soDigitos(c.cnpj).includes(soDigitos(q));
      if (!porNome && !porCnpj) return false;
    }
    if (situacao && c.situacao !== situacao && !(situacao === 'ativo' && c.situacao === 'em_implantacao')) return false;
    if (produto && c.produto !== produto) return false;
    if (socio && c.socioDaConta !== socio) return false;
    return true;
  });

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <p className="text-[13.5px] text-muted">Os contratos depois do sim. Parcelas, entregas e marcos vêm do fio e dos provedores. Encerrar é decisão de gente, com motivo.</p>

      {/* O painel: contagens que também filtram. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="contratos-painel">
        {([
          ['ativo', 'Ativos'], ['em_implantacao', 'Em implantação'], ['concluido', 'Concluídos'], ['desativado', 'Desativados'],
        ] as const).map(([chave, rotulo]) => (
          <button
            key={chave}
            type="button"
            data-testid={`contratos-contagem-${chave}`}
            aria-pressed={situacao === chave}
            onClick={() => setSituacao((s) => (s === chave ? '' : chave))}
            className={`${CARTAO} text-left transition hover:border-brand ${FOCO} ${situacao === chave ? 'border-brand' : ''}`}
          >
            <span className="block font-os-mono text-[22px] tabular-nums">{contagem[chave]}</span>
            <span className={ROTULO}>{rotulo}</span>
            {chave === 'em_implantacao' && <span className="mt-0.5 block text-[11px] text-dim">ativos com o card de implantação aberto</span>}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1">
          <span className={ROTULO}>Buscar</span>
          <input data-testid="contratos-busca" className={INPUT} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou CNPJ" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={ROTULO}>Situação</span>
          <select data-testid="contratos-filtro-situacao" className={INPUT} value={situacao} onChange={(e) => setSituacao(e.target.value as '' | SituacaoDoContrato)}>
            <option value="">Todas</option>
            {SITUACOES_DO_CONTRATO.map((s) => <option key={s} value={s}>{ROTULO_DA_SITUACAO_DO_CONTRATO[s]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={ROTULO}>Produto</span>
          <select data-testid="contratos-filtro-produto" className={INPUT} value={produto} onChange={(e) => setProduto(e.target.value)}>
            <option value="">Todos</option>
            {produtos.map((p) => <option key={p} value={p}>{ROTULO_DO_PRODUTO[p]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={ROTULO}>Sócio da conta</span>
          <select data-testid="contratos-filtro-socio" className={INPUT} value={socio} onChange={(e) => setSocio(e.target.value)}>
            <option value="">Todos</option>
            {socios.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>

      <Erro erro={erro} aoTentar={() => void recarregar()} />
      {carregando && !dados && !erro && <Carregando linhas={2} altura="h-28" />}
      {dados && dados.length === 0 && <Aviso>Nenhum contrato vivo ainda. Ele nasce quando o fechamento conclui.</Aviso>}
      {dados && dados.length > 0 && visiveis.length === 0 && <Aviso>Nenhum contrato com esta busca e estes filtros.</Aviso>}
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-[repeat(2,minmax(0,1fr))]" data-testid="contratos-lista">
        {visiveis.map((c) => {
          const p = contarParcelas(c.parcelas);
          const proxima = c.parcelas.find((x) => x.estado !== 'paga');
          const encerrado = c.situacao === 'concluido' || c.situacao === 'desativado';
          return (
            <li key={c.leadId} data-testid={`contrato-${c.leadId}`} data-situacao={c.situacao} className={`relative min-w-0 ${CARTAO} transition hover:border-brand ${encerrado ? 'opacity-75' : ''}`}>
              <div className="flex flex-wrap items-center gap-2">
                <LinkDoLead leadId={c.leadId} aba="dinheiro" title={c.cliente} className={`min-w-0 flex-1 truncate text-[14.5px] font-semibold after:absolute after:inset-0 after:content-[''] ${FOCO}`}>
                  {c.cliente}
                </LinkDoLead>
                <Chip tom={TOM_DA_SITUACAO[c.situacao]}>{ROTULO_DA_SITUACAO_DO_CONTRATO[c.situacao]}</Chip>
                {p.atrasadas > 0 && <Chip tom="ruim">{p.atrasadas} atrasada{p.atrasadas > 1 ? 's' : ''}</Chip>}
              </div>
              <p className="mt-1 text-[12.5px] text-muted">
                {c.produto ? ROTULO_DO_PRODUTO[c.produto] : 'produto ausente'} · {reaisOuAusente(c.valorCentavos)}
                {c.descontoPct != null ? ` · ${c.descontoPct}% aprovado` : ''}
                {c.cnpj ? ` · ${c.cnpj}` : ''}
                {c.socioDaConta ? ` · sócio ${c.socioDaConta}` : ''}
              </p>
              {c.importados?.length && p.total === 0 ? (
                <ContratosImportados itens={c.importados} leadId={c.leadId} compacto aoMudar={recarregar} />
              ) : (
                <p className="mt-1 text-[12.5px] tabular-nums">
                  {p.pagas}/{p.total} parcelas pagas{proxima ? ` · próxima vence ${dataDoDia(proxima.vence)}` : ''}
                </p>
              )}
              {c.encerramento ? (
                <p className="mt-1 text-[12px] text-muted" data-testid={`contrato-encerramento-${c.leadId}`}>
                  {c.encerramento.situacao === 'concluido' ? 'Concluído' : 'Desativado'} em {dataDoDia(c.encerramento.em.slice(0, 10))}
                  {c.encerramento.por ? ` por ${c.encerramento.por}` : ''}: {c.encerramento.motivo}
                  {c.encerramento.parcelasEmAberto > 0 ? ` · ${c.encerramento.parcelasEmAberto} parcela(s) em aberto, cobrança mantida` : ''}
                </p>
              ) : (
                <>
                  <BarraDaSaude saude={c.saude} />
                  <p className="mt-1 text-[11.5px] text-dim">
                    saúde {numeroOuAusente(c.saude)} · implantação {c.faseDaImplantacao ? `fase ${c.faseDaImplantacao.atual} de ${c.faseDaImplantacao.total}` : 'ausente'}
                  </p>
                </>
              )}
              {podeEncerrar && !encerrado && (
                <div className="relative z-10 mt-2 flex flex-wrap gap-2">
                  {encerrando?.leadId === c.leadId ? (
                    <FormularioDeEncerrar
                      contrato={c}
                      situacao={encerrando.situacao}
                      aoCancelar={() => setEncerrando(null)}
                      aoConcluir={() => { setEncerrando(null); void recarregar(); }}
                    />
                  ) : (
                    <>
                      <button type="button" data-testid={`contrato-concluir-${c.leadId}`} className={BOTAO} onClick={() => setEncerrando({ leadId: c.leadId, situacao: 'concluido' })}>Concluir contrato</button>
                      <button type="button" data-testid={`contrato-desativar-${c.leadId}`} className={BOTAO} onClick={() => setEncerrando({ leadId: c.leadId, situacao: 'desativado' })}>Desativar contrato</button>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
