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
  decisoes,
  carregando,
  erro,
  aoTentar,
  aoMudar,
}: {
  decisoes: DecisaoNaFila[];
  carregando: boolean;
  erro: unknown;
  aoTentar: () => void;
  aoMudar: () => Promise<void>;
}) {
  const painel = usePainel();
  if (carregando) return <Carregando linhas={2} altura="h-32" />;
  const abertas = decisoes.filter((d) => d.estado === 'aberta');
  const fechadas = decisoes.filter((d) => d.estado !== 'aberta');

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

      {fechadas.length > 0 && (
        <section className={CARTAO} aria-label="decisões já fechadas">
          <Rotulo>já fechadas</Rotulo>
          <ul className="mt-2 divide-y divide-border text-[12.5px]">
            {fechadas.map((d) => {
              const escolha = d.opcoes.find((o) => o.chave === d.escolha)?.rotulo ?? d.escolha;
              return (
                <li key={d.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5">
                  <Chip>{ROTULO_DO_TIPO_DE_DECISAO[d.tipo] ?? d.tipo}</Chip>
                  <span className="min-w-0 flex-1">{d.titulo}</span>
                  <span className="text-muted">
                    {ROTULO_DO_ESTADO[d.estado] ?? d.estado}
                    {escolha ? ` · ${escolha}` : ''}
                    {d.decididoPor ? ` · ${d.decididoPor}` : ''}
                  </span>
                  <span className="font-os-mono text-[11px] tabular-nums text-dim">{quandoCurtoSP(d.criadaEm)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
