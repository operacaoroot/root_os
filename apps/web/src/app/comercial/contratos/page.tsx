'use client';

import { useMemo, useState } from 'react';
import {
  ROTULO_DA_SITUACAO_DO_CONTRATO, SITUACOES_DO_CONTRATO,
  type ContratoVivo, type SituacaoDoContrato,
} from '@mktos/shared';

import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ROTULO_DO_PRODUTO, contarParcelas, dataDoDia, numeroOuAusente, reaisOuAusente } from '@/lib/cockpit';

import { Aviso, BarraDaSaude, BOTAO, BOTAO_PRIMARIO, CARTAO, Carregando, Chip, Erro, ErroDaAcao, FOCO, INPUT, ROTULO, useCarregar } from '../_ui';
import { LinkDoLead, useMudouNoPainel } from '../_painel/provedor';
import { ContratosImportados } from '../_painel/ContratosImportados';

/*
 * TELA 11 · OS CONTRATOS VIVOS (lane C), a lista. O contrato não some depois
 * de assinado: cada um abre o painel do lead na aba Dinheiro, por cima da
 * lista, com parcelas, entregas, saúde e marcos (lane UX).
 *
 * Rodada do trabalho T8 (19/10/2026): o painel no topo conta Ativos, Em
 * implantação (ativo com o card da implantação aberto, só informativo),
 * Concluídos e Desativados; a lista põe ativos primeiro e encerrados por
 * último, com busca por nome e CNPJ e filtros por situação, produto e sócio da
 * conta. Encerrar é à mão (decisão do Rodrigo): "Concluir contrato" e
 * "Desativar contrato", com motivo, no fio e na auditoria. Parcela em aberto
 * avisa e a cobrança NÃO é cancelada (fica com a mesa).
 */

const TOM_DA_SITUACAO: Record<SituacaoDoContrato, 'bom' | 'info' | 'neutro' | 'alerta'> = {
  ativo: 'bom', em_implantacao: 'info', concluido: 'neutro', desativado: 'alerta',
};

const soDigitos = (t: string) => t.replace(/\D/g, '');
const semAcento = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');

export default function ContratosPage() {
  const { dados, erro, carregando, recarregar } = useCarregar<ContratoVivo[]>('/comercial/contratos', 60_000);
  useMudouNoPainel(recarregar);
  const { can } = useAuth();
  const podeEncerrar = can('leads.editar');
  const [busca, setBusca] = useState('');
  const [situacao, setSituacao] = useState<'' | SituacaoDoContrato>('');
  const [produto, setProduto] = useState('');
  const [socio, setSocio] = useState('');
  const [encerrando, setEncerrando] = useState<{ leadId: string; situacao: 'concluido' | 'desativado' } | null>(null);

  const todos = dados ?? [];
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
                <ContratosImportados itens={c.importados} />
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

function FormularioDeEncerrar({ contrato, situacao, aoCancelar, aoConcluir }: {
  contrato: ContratoVivo; situacao: 'concluido' | 'desativado'; aoCancelar: () => void; aoConcluir: () => void;
}) {
  const { token } = useAuth();
  const [motivo, setMotivo] = useState('');
  const [ciente, setCiente] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  const emAberto = contrato.parcelas.filter((p) => p.estado !== 'paga').length;
  const pronto = motivo.trim().length >= 5 && (emAberto === 0 || ciente);
  const enviar = async () => {
    setEnviando(true); setErro(null);
    try {
      await apiPost(`/comercial/contratos/${contrato.leadId}/encerrar`, { situacao, motivo: motivo.trim(), ...(emAberto > 0 ? { cienteDasParcelas: ciente } : {}) }, token);
      aoConcluir();
    } catch (e) { setErro(e); } finally { setEnviando(false); }
  };
  return (
    <div className="w-full space-y-2" data-testid={`contrato-encerrar-${contrato.leadId}`}>
      <label className="block space-y-1">
        <span className={ROTULO}>{situacao === 'concluido' ? 'Por que o contrato terminou' : 'Por que o contrato foi desativado'}</span>
        <textarea autoFocus data-testid="contrato-motivo" className={`${INPUT} min-h-[64px]`} value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} />
      </label>
      {emAberto > 0 && (
        <div className="space-y-1 rounded border border-warn/50 bg-warn/10 p-2 text-[12px]" role="alert">
          <p>Há {emAberto} parcela(s) em aberto no Asaas. Encerrar o contrato NÃO cancela a cobrança: isso fica com a mesa.</p>
          <label className="flex items-center gap-2">
            <input type="checkbox" data-testid="contrato-ciente" checked={ciente} onChange={(e) => setCiente(e.target.checked)} />
            Vi as parcelas em aberto e sigo com o encerramento.
          </label>
        </div>
      )}
      <ErroDaAcao erro={erro} />
      <div className="flex gap-2">
        <button type="button" data-testid="contrato-confirmar" className={BOTAO_PRIMARIO} disabled={!pronto || enviando} onClick={() => void enviar()}>
          {situacao === 'concluido' ? 'Concluir contrato' : 'Desativar contrato'}
        </button>
        <button type="button" className={BOTAO} onClick={aoCancelar}>Cancelar</button>
      </div>
    </div>
  );
}
