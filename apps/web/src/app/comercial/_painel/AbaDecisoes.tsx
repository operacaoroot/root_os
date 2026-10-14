'use client';

/*
 * ABA DECISÕES. As decisões abertas deste lead, com os botões de um toque (as
 * mesmas da fila, pela mesma rota), e as já tomadas ou vencidas logo abaixo.
 * Decidir aqui mostra o resultado aqui: o aviso no canto diz o que aconteceu,
 * o fio ganha a linha e a fila de trás tira o cartão.
 */
import type { DecisaoNaFila } from '@mktos/shared';

import { ROTULO_DO_TIPO_DE_DECISAO, quandoCurtoSP } from '@/lib/cockpit';

import { Aviso, CARTAO, Carregando, Chip, Erro, Rotulo } from '../_ui';
import { CartaoDeDecisao } from '../_decisao';
import { usePainel } from './provedor';

const ROTULO_DO_ESTADO: Record<string, string> = { tomada: 'tomada', expirada: 'venceu: valeu o padrão', aberta: 'aberta' };

export function AbaDecisoes({
  abertas,
  fechadas,
  listaParcial,
  carregando,
  erro,
  aoTentar,
  aoMudar,
}: {
  abertas: DecisaoNaFila[];
  fechadas: DecisaoNaFila[];
  /** A lista geral da empresa bateu no teto da API: as fechadas deste lead podem estar incompletas. */
  listaParcial: boolean;
  carregando: boolean;
  erro: unknown;
  aoTentar: () => void;
  aoMudar: () => Promise<void>;
}) {
  const painel = usePainel();
  if (carregando) return <Carregando linhas={2} altura="h-32" />;

  return (
    <div className="space-y-4">
      <Erro erro={erro} aoTentar={aoTentar} />
      {!erro && abertas.length === 0 && <Aviso>Nenhuma decisão aberta para este lead. O que saiu da regra aparece aqui com o padrão escrito.</Aviso>}
      {abertas.map((d) => (
        <CartaoDeDecisao
          key={d.id}
          d={d}
          noPainel
          aoResponder={async (texto) => {
            painel.avisar(texto);
            await aoMudar();
          }}
        />
      ))}

      {listaParcial && (
        <p className="text-[12px] text-dim">A empresa passou de 200 decisões: as já fechadas deste lead podem não aparecer todas aqui. O fio tem cada uma.</p>
      )}
      {fechadas.length > 0 && (
        <section className={CARTAO} aria-label="decisões já fechadas">
          <Rotulo>já fechadas</Rotulo>
          <ul className="mt-2 divide-y divide-border text-[12.5px]">
            {fechadas.map((d) => {
              const escolha = d.opcoes.find((o) => o.chave === d.escolha)?.rotulo ?? d.escolha;
              return (
                <li key={d.id} className="space-y-0.5 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip>{ROTULO_DO_TIPO_DE_DECISAO[d.tipo] ?? d.tipo}</Chip>
                    <span className="ml-auto font-os-mono text-[11px] tabular-nums text-dim">{quandoCurtoSP(d.criadaEm)}</span>
                  </div>
                  <p className="break-words">{d.titulo}</p>
                  <p className="text-muted">
                    {ROTULO_DO_ESTADO[d.estado] ?? d.estado}
                    {escolha ? ` · ${escolha}` : ''}
                    {d.decididoPor ? ` · ${d.decididoPor}` : ''}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
