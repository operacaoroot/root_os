import { AVISO_DO_CONTRATO_IMPORTADO, type ContratoImportadoNaTela } from '@mktos/shared';

import { dataDoDia, reaisOuAusente } from '@/lib/cockpit';

/*
 * OS CONTRATOS QUE VIERAM DO CRM ANTIGO (rodada de produção 1, 21/10/2026).
 *
 * O importador traz cada subtarefa de "Contratos dos clientes" como um contrato vivo
 * do cliente, sem o PDF assinado e sem parcela. A tela diz isso e pede o PDF; a régua
 * fica desligada até a mesa decidir parcelas e vencimentos.
 */
export function ContratosImportados({ itens }: { itens: readonly ContratoImportadoNaTela[] | undefined }) {
  if (!itens?.length) return null;
  return (
    <div className="mt-1 min-w-0" data-testid="contratos-importados">
      <p className="text-[12px] font-medium text-warn">{AVISO_DO_CONTRATO_IMPORTADO}</p>
      <ul className="mt-0.5 space-y-0.5 text-[12px] text-muted">
        {itens.map((c) => (
          <li key={c.origem || c.titulo} className="truncate" title={c.titulo}>
            {c.titulo} · {c.produtoRotulo ?? 'produto ausente'} · {reaisOuAusente(c.valorCentavos)} · {c.fechadoEm ? `fechado em ${dataDoDia(c.fechadoEm)}` : 'sem data de fechamento'}
          </li>
        ))}
      </ul>
      <p className="mt-0.5 text-[11.5px] text-dim">Parcelas, vencimentos e régua a decidir. Nenhum aviso de cobrança sai deste contrato.</p>
    </div>
  );
}
