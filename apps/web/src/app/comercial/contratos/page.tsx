'use client';

import Link from 'next/link';
import type { ContratoVivo } from '@mktos/shared';

import { ROTULO_DO_PRODUTO, contarParcelas, dataDoDia, numeroOuAusente, reaisOuAusente } from '@/lib/cockpit';

import { Aviso, BarraDaSaude, CARTAO, Carregando, Chip, Erro, FOCO, useCarregar } from '../_ui';

/*
 * TELA 11 · OS CONTRATOS VIVOS (lane C), a lista. O contrato não some depois
 * de assinado: cada um abre a tela com parcelas, entregas, saúde e marcos.
 */
export default function ContratosPage() {
  const { dados, erro, carregando } = useCarregar<ContratoVivo[]>('/comercial/contratos', 60_000);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <p className="text-[13.5px] text-muted">Os contratos depois do sim. Parcelas, entregas e marcos vêm do fio e dos provedores; nada aqui é digitado.</p>
      <Erro erro={erro} />
      {carregando && !dados && <Carregando />}
      {dados && dados.length === 0 && <Aviso>Nenhum contrato vivo ainda. Ele nasce quando o fechamento conclui.</Aviso>}
      <ul className="grid gap-3 md:grid-cols-2">
        {(dados ?? []).map((c) => {
          const p = contarParcelas(c.parcelas);
          const proxima = c.parcelas.find((x) => x.estado !== 'paga');
          return (
            <li key={c.leadId}>
              <Link href={`/comercial/contratos/${c.leadId}`} className={`block ${CARTAO} hover:border-brand ${FOCO}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-[14.5px] font-semibold">{c.cliente}</p>
                  {p.atrasadas > 0 && <Chip tom="ruim">{p.atrasadas} atrasada{p.atrasadas > 1 ? 's' : ''}</Chip>}
                </div>
                <p className="mt-1 text-[12.5px] text-muted">
                  {c.produto ? ROTULO_DO_PRODUTO[c.produto] : 'produto ausente'} · {reaisOuAusente(c.valorCentavos)}
                  {c.descontoPct != null ? ` · ${c.descontoPct}% aprovado` : ''}
                </p>
                <p className="mt-1 text-[12.5px]">
                  {p.pagas}/{p.total} parcelas pagas{proxima ? ` · próxima vence ${dataDoDia(proxima.vence)}` : ''}
                </p>
                <BarraDaSaude saude={c.saude} />
                <p className="mt-1 text-[11.5px] text-dim">
                  saúde {numeroOuAusente(c.saude)} · implantação {c.faseDaImplantacao ? `fase ${c.faseDaImplantacao.atual} de ${c.faseDaImplantacao.total}` : 'ausente'}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
