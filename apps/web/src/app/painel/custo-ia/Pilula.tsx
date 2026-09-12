'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Coins } from 'lucide-react';
import { apiGet, ErroDaApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  alertaDoTeto,
  NAO_MEDIDO,
  ROTA_DO_RELATORIO,
  rotuloUsd,
  TOM_DO_TETO,
  tudoSemPreco,
  usd,
  type AlertaDeTeto,
  type RelatorioDeCustoIa,
} from './calculo';

/*
 * A PÍLULA "CUSTO HOJE · TETO" — o item da casca visual (RF-B-03).
 *
 * O NÚMERO GRANDE É O COMPROMETIDO, e não o gasto. Comprometido é
 * medido + estimado + reservado + arrasto: exatamente a soma que a porta compara
 * com o teto antes de deixar a chamada acontecer. Mostrar o gasto e alertar
 * sobre o comprometido deixaria a pílula verde no instante em que a chamada
 * seguinte é recusada — que é o único instante em que ela precisava avisar.
 *
 * Embaixo, as parcelas, cada uma com o nome do que é. Elas existem porque o
 * número grande sozinho não diz o que é medição e o que é conta nossa; e um
 * número de custo sem procedência é um número que ninguém pode levar para uma
 * conversa sobre fatura.
 *
 * A ÚLTIMA LINHA — "não mede: …" — ENTROU NA CORREÇÃO DA 6.4. A tela de detalhe
 * sempre teve o rodapé do que o painel não alcança; a pílula, que é o que todo
 * mundo vê, não tinha nada. Quem só olha o Console lia o número como se fosse o
 * custo de IA da empresa, e ele não é: a vetorização inteira está fora.
 *
 * Pede UM DIA (`?dias=1`): a pílula fala de hoje, e uma janela de 30 dias no
 * topo do Console seria varredura de sobra em toda visita.
 */

const CORES: Record<'default' | 'good' | 'warn' | 'bad', string> = {
  default: 'border-border text-muted',
  good: 'border-good/30 text-good',
  warn: 'border-warn/40 text-warn',
  bad: 'border-bad/40 text-bad',
};

type Estado =
  | { t: 'carregando' }
  | { t: 'indisponivel'; motivo: string }
  | { t: 'pronto'; r: RelatorioDeCustoIa; a: AlertaDeTeto };

export function PilulaCustoIa() {
  const { token, ready } = useAuth();
  const [estado, setEstado] = useState<Estado>({ t: 'carregando' });

  useEffect(() => {
    if (!ready || !token) return;
    let vivo = true;
    apiGet<RelatorioDeCustoIa>(`${ROTA_DO_RELATORIO}?dias=1`, token)
      .then((r) => {
        if (vivo) setEstado({ t: 'pronto', r, a: alertaDoTeto(r) });
      })
      .catch((e: unknown) => {
        if (!vivo) return;
        /*
         * Erro aqui NÃO é "custo zero". A pílula diz que não sabe, porque um
         * "US$ 0,00" nesse estado seria a afirmação mais cara da tela.
         */
        const status = e instanceof ErroDaApi ? e.status : 0;
        setEstado({
          t: 'indisponivel',
          motivo:
            status === 404
              ? 'o relatório de custo não respondeu nesta instância'
              : e instanceof Error
                ? e.message
                : 'falha ao ler o custo de IA',
        });
      });
    return () => {
      vivo = false;
    };
  }, [ready, token]);

  if (estado.t === 'carregando') {
    return (
      <div className="h-[54px] w-full max-w-[420px] animate-pulse rounded-root border border-border bg-surface" />
    );
  }

  if (estado.t === 'indisponivel') {
    return (
      <div
        title={estado.motivo}
        className="inline-flex max-w-full items-center gap-[9px] rounded-root border border-border bg-surface px-[12px] py-[9px] font-os-mono"
      >
        <AlertTriangle size={13} className="flex-none text-dim" />
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted">
            Custo de IA · hoje
          </div>
          <div className="truncate text-[13px] font-bold leading-tight text-muted">
            {NAO_MEDIDO} <span className="font-normal text-dim">{estado.motivo}</span>
          </div>
        </div>
      </div>
    );
  }

  const { r, a } = estado;
  const cor = CORES[TOM_DO_TETO[a.estado]];
  const h = r.hoje;
  const naoMede = r.naoCoberto ?? [];

  return (
    <Link
      href="/painel/custo-ia"
      title={a.frase}
      className={`group inline-flex max-w-full items-center gap-[10px] rounded-root border bg-surface px-[12px] py-[9px] font-os-mono transition-colors hover:bg-surface-2 ${cor}`}
    >
      <Coins size={14} className="flex-none opacity-80" />
      <div className="min-w-0">
        <div className="flex items-baseline gap-[7px]">
          <span className="text-[10px] uppercase tracking-[0.16em] text-muted">
            Custo de IA · hoje
          </span>
          {a.disparou && (
            <span aria-hidden className="h-[5px] w-[5px] flex-none rounded-full bg-current" />
          )}
        </div>

        <div className="mt-[2px] flex items-baseline gap-[7px] whitespace-nowrap">
          <span className="text-[16px] font-bold leading-none tracking-[-0.03em] tabular-nums">
            {h ? usd(h.comprometidoUsd) : NAO_MEDIDO}
          </span>
          <span className="text-[10px] text-muted">
            {a.tetoUsd === null
              ? 'sem teto definido — nada é escrito no livro-caixa'
              : `teto do dia: ${usd(a.tetoUsd)}`}
          </span>
        </div>

        {/*
          As parcelas. Cada uma com o nome do que é — ver `calculo.ts`.

          O NÚMERO GRANDE continua sendo o comprometido, sempre em dinheiro: é
          ele que a porta compara, e trocá-lo por travessão desfaria a única
          coisa que faz a pílula e a porta falarem do mesmo número. A parcela
          "medido", sim, é afirmação de medição — e num dia em que TODA chamada
          foi de modelo sem preço ela vira travessão, porque aquele zero é
          ausência de preço e não ausência de gasto.
        */}
        {h && (
          <div className="mt-[4px] truncate text-[9.5px] uppercase tracking-[0.08em] text-dim">
            medido {rotuloUsd(h.gastoUsd, !tudoSemPreco(h))} · estimado {usd(h.gastoEstimadoUsd)}
            {h.reservadoUsd > 0 && <> · em voo {usd(h.reservadoUsd)}</>}
            {h.arrastoUsd > 0 && <> · arrasto {usd(h.arrastoUsd)}</>}
            {h.chamadasSemPreco > 0 && (
              <> · {h.chamadasSemPreco} não medida{h.chamadasSemPreco > 1 ? 's' : ''}</>
            )}
          </div>
        )}

        {/*
          O QUE ESTE NÚMERO NÃO INCLUI — na pílula, não só na tela de detalhe.
          Sem esta linha, o Console entrega um número com cara de total.
        */}
        {naoMede.length > 0 && (
          <div
            className="truncate text-[9.5px] uppercase tracking-[0.08em] text-warn"
            title={naoMede.map((n) => `${n.oQue}: ${n.onde}`).join('\n\n')}
          >
            não mede: {naoMede.map((n) => n.oQue).join(' · ')}
          </div>
        )}
      </div>
    </Link>
  );
}
