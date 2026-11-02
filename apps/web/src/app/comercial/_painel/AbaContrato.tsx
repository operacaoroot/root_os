'use client';

/*
 * A ABA CONTRATO DO PAINEL DO LEAD (fase F4 do módulo de contratos, 02/11/2026).
 *
 * Acha o contrato do lead filtrando o quadro por `leadId`. Três caminhos: sem contrato
 * registrado, "Criar contrato"; contrato importado, o que ele sempre mostrou (PDF e
 * parcelas por `ContratosImportados`) e o encerrar das rotas antigas; contrato
 * registrado, a ficha inteira. `campo` traz o passo que o gesto do quadro abriu.
 */
import { useCallback, useState } from 'react';
import { MODALIDADES_DE_CONTRATO, ROTULO_DA_MODALIDADE, type ContratoNoQuadro, type ContratoVivo, type FichaDoLead, type ModalidadeDeContrato, type QuadroDeContratos } from '@mktos/shared';

import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';

import { BOTAO, BOTAO_PRIMARIO, CARTAO, Carregando, Erro, INPUT, ROTULO, Rotulo, useCarregar } from '../_ui';
import { RetornoDaAcao, useAcaoDoContrato } from '../_contratos/acao';
import { FormularioDeEncerrar } from '../_contratos/EncerrarVivo';
import { FichaDoContrato } from '../_contratos/FichaDoContrato';
import { CAMINHO_DO_QUADRO, CAMINHO_DO_REGISTRO, FRASE_SEM_ZAPSIGN, contratoDoPasso, dataCompleta, passoDoCampo, type PassoDoContrato } from '../_contratos/regras';
import { ContratosImportados } from './ContratosImportados';

export function AbaContrato({ leadId, ficha, campo, aoMudar }: {
  leadId: string;
  ficha: FichaDoLead | null;
  campo: string | null;
  aoMudar: () => Promise<void>;
}) {
  const quadro = useCarregar<QuadroDeContratos>(CAMINHO_DO_QUADRO, 30_000);
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const passo = passoDoCampo(campo);

  const recarregarQuadro = quadro.recarregar;
  const mudou = useCallback(async () => {
    await Promise.all([recarregarQuadro(), aoMudar()]);
  }, [recarregarQuadro, aoMudar]);

  const reais = (quadro.dados?.itens ?? []).filter((c) => c.leadId === leadId && !c.fantasma);
  const atual = reais.find((c) => c.id === escolhido) ?? contratoDoPasso(reais, passo);

  return (
    <div className="space-y-3" data-testid="aba-contrato">
      {quadro.dados && !quadro.dados.assinaturaConfigurada && (
        <p role="status" data-testid="contrato-sem-zapsign" className="rounded border border-warn/50 bg-warn/10 px-3 py-2 text-[13px]">{FRASE_SEM_ZAPSIGN}</p>
      )}
      <Erro erro={quadro.erro} aoTentar={() => void quadro.recarregar()} />
      {quadro.carregando && !quadro.dados && !quadro.erro && <Carregando linhas={3} altura="h-20" />}
      {quadro.dados && !atual && <CriarContrato leadId={leadId} aoMudar={mudou} />}
      {reais.length > 1 && atual && (
        <label className="flex flex-wrap items-center gap-2">
          <span className={ROTULO}>Contrato deste lead</span>
          <select data-testid="contrato-escolher" className={`${INPUT} !w-auto max-md:min-h-[44px]`} value={atual.id} onChange={(e) => setEscolhido(e.target.value)}>
            {reais.map((c) => <option key={c.id} value={c.id}>{rotuloDoContrato(c)}</option>)}
          </select>
        </label>
      )}
      {atual?.importado && <ContratoImportadoNaFicha leadId={leadId} passo={passo} aoMudar={mudou} />}
      {atual && !atual.importado && quadro.dados && (
        <FichaDoContrato
          key={atual.id}
          contratoId={atual.id}
          leadId={leadId}
          ficha={ficha}
          passo={passo}
          assinaturaConfigurada={quadro.dados.assinaturaConfigurada}
          aoMudar={mudou}
        />
      )}
    </div>
  );
}

function rotuloDoContrato(c: ContratoNoQuadro): string {
  return [c.modalidade ? ROTULO_DA_MODALIDADE[c.modalidade] : 'Contrato', c.numero ? `nº ${c.numero}` : null, c.importado ? 'importado' : null].filter(Boolean).join(' · ');
}

/** Lead sem contrato registrado: nasce aqui, com a modalidade. */
function CriarContrato({ leadId, aoMudar }: { leadId: string; aoMudar: () => Promise<void> }) {
  const { token, can } = useAuth();
  const [modalidade, setModalidade] = useState<ModalidadeDeContrato>('implantacao');
  const acao = useAcaoDoContrato(aoMudar);
  const criar = () => acao.rodar('criar', () => apiPost(CAMINHO_DO_REGISTRO, { leadId, modalidade }, token));
  return (
    <section className={`${CARTAO} space-y-2`} aria-label="criar contrato" data-testid="contrato-criar-bloco">
      <Rotulo>sem contrato registrado</Rotulo>
      <p className="text-[12.5px] text-muted">Este lead ainda não tem contrato no sistema. O registro nasce aqui, e dele saem os signatários e a minuta.</p>
      {can('leads.editar') ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className={ROTULO}>Modalidade</span>
            <select data-testid="contrato-criar-modalidade" className={`${INPUT} !w-auto max-md:min-h-[44px]`} value={modalidade} onChange={(e) => setModalidade(e.target.value as ModalidadeDeContrato)}>
              {MODALIDADES_DE_CONTRATO.map((m) => <option key={m} value={m}>{ROTULO_DA_MODALIDADE[m]}</option>)}
            </select>
          </label>
          <button type="button" data-testid="contrato-criar" className={BOTAO_PRIMARIO} disabled={acao.ocupado !== null} onClick={() => void criar()}>
            {acao.ocupado ? 'Criando…' : 'Criar contrato'}
          </button>
        </div>
      ) : (
        <p className="text-[12px] text-dim">Criar contrato pede a permissão de editar leads.</p>
      )}
      <RetornoDaAcao acao={acao} />
    </section>
  );
}

/** O importado: o que ele sempre mostrou, e o encerrar pela rota antiga. */
function ContratoImportadoNaFicha({ leadId, passo, aoMudar }: { leadId: string; passo: PassoDoContrato | null; aoMudar: () => Promise<void> }) {
  const { can } = useAuth();
  const vivo = useCarregar<ContratoVivo>(`/comercial/contratos/${encodeURIComponent(leadId)}`, 60_000);
  const [encerrando, setEncerrando] = useState<'concluido' | 'desativado' | null>(null);
  const recarregarVivo = vivo.recarregar;
  const mudou = useCallback(async () => {
    await Promise.all([recarregarVivo(), aoMudar()]);
  }, [recarregarVivo, aoMudar]);
  const v = vivo.dados;
  return (
    <section className={`${CARTAO} space-y-2`} aria-label="contrato importado" data-testid="contrato-importado-bloco">
      <Rotulo>contrato importado</Rotulo>
      <Erro erro={vivo.erro} aoTentar={() => void vivo.recarregar()} />
      {vivo.carregando && !v && !vivo.erro && <Carregando linhas={2} altura="h-6" />}
      {v && <ContratosImportados itens={v.importados} leadId={leadId} aoMudar={mudou} />}
      {v?.encerramento && (
        <p className="text-[12.5px] text-muted" data-testid="contrato-importado-encerramento">
          {v.encerramento.situacao === 'concluido' ? 'Concluído' : 'Desativado'} em {dataCompleta(v.encerramento.em)}
          {v.encerramento.por ? ` por ${v.encerramento.por}` : ''}: {v.encerramento.motivo}
        </p>
      )}
      {v && !v.encerramento && can('leads.editar') && (
        <div className="space-y-2">
          {passo === 'encerrar' && !encerrando && <p className="text-[12.5px] text-muted">Como este contrato termina?</p>}
          {encerrando ? (
            <FormularioDeEncerrar contrato={v} situacao={encerrando} aoCancelar={() => setEncerrando(null)} aoConcluir={() => { setEncerrando(null); void mudou(); }} />
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" data-testid={`contrato-concluir-${leadId}`} className={BOTAO} onClick={() => setEncerrando('concluido')}>Concluir contrato</button>
              <button type="button" data-testid={`contrato-desativar-${leadId}`} className={BOTAO} onClick={() => setEncerrando('desativado')}>Desativar contrato</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
