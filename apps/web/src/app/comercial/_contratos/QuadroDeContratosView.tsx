'use client';

/*
 * O QUADRO DE CONTRATOS (fase F4, 02/11/2026). Sete colunas derivadas, com rolagem
 * horizontal própria e o arrastar HTML5 nativo da casa.
 *
 * ARRASTAR NÃO INVENTA REALIDADE: a coluna só aceita o cartão onde `acaoNaTela` diz que
 * há ação, e soltar abre o passo na aba Contrato do painel do lead. Nada é gravado no
 * gesto, e nenhum gesto marca assinado. O seletor "Mover" do cartão faz o mesmo pelo
 * teclado e pelo celular.
 */
import { useState } from 'react';
import { DICA_DA_ETAPA, ETAPAS_DO_QUADRO, ROTULO_DA_ETAPA_DO_QUADRO, type ContratoNoQuadro, type EtapaDoQuadro } from '@mktos/shared';

import { reaisOuAusente } from '@/lib/cockpit';

import { Chip, FOCO, INPUT } from '../_ui';
import { LinkDoLead } from '../_painel/provedor';
import { ROTULO_DA_ACAO, acaoNaTela, chipsDoCartao, destinosDoCartao, linhaDoCartao } from './regras';

export function QuadroDeContratosView({ itens, hoje, podeMover, aoMover }: {
  itens: readonly ContratoNoQuadro[];
  hoje: string;
  podeMover: boolean;
  /** Abre o passo: quem chama decide como. Só vem com destino em que há ação. */
  aoMover: (item: ContratoNoQuadro, destino: EtapaDoQuadro, origem: Element | null) => void;
}) {
  const [arrastando, setArrastando] = useState<ContratoNoQuadro | null>(null);
  const [sobre, setSobre] = useState<EtapaDoQuadro | null>(null);

  return (
    <div
      data-testid="contratos-quadro"
      className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 md:snap-none"
      onDragOver={(e) => {
        // Arrastando perto da borda, o quadro anda para o lado (as colunas da direita chegam).
        if (!arrastando) return;
        const q = e.currentTarget.getBoundingClientRect();
        const borda = 90;
        if (e.clientX > q.right - borda) e.currentTarget.scrollLeft += 18;
        else if (e.clientX < q.left + borda) e.currentTarget.scrollLeft -= 18;
      }}
    >
      {ETAPAS_DO_QUADRO.map((etapa) => {
        const cartoes = itens.filter((c) => c.etapa === etapa);
        const aceita = !!arrastando && acaoNaTela(arrastando, etapa) !== null;
        return (
          <section
            key={etapa}
            aria-label={ROTULO_DA_ETAPA_DO_QUADRO[etapa]}
            data-testid={`contratos-coluna-${etapa}`}
            data-aceita={arrastando ? (aceita ? 'sim' : 'nao') : undefined}
            className={`flex w-[17rem] min-w-0 shrink-0 snap-start flex-col rounded border bg-surface p-2 max-md:max-h-[72dvh] max-md:w-[86%] ${sobre === etapa && aceita ? 'border-brand' : 'border-border'} ${arrastando && !aceita ? 'opacity-50' : ''}`}
            onDragOver={(e) => {
              // Sem `preventDefault`, o navegador não deixa soltar: é assim que a coluna sem ação recusa.
              if (!aceita) return;
              e.preventDefault();
              if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
              if (sobre !== etapa) setSobre(etapa);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setSobre(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const item = arrastando;
              setArrastando(null);
              setSobre(null);
              if (item && acaoNaTela(item, etapa)) aoMover(item, etapa, null);
            }}
          >
            <header className="shrink-0 px-1 pb-2">
              <h2 className="flex items-baseline justify-between font-os-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
                <span className="truncate">{ROTULO_DA_ETAPA_DO_QUADRO[etapa]}</span>
                <span className="tabular-nums" data-testid={`contratos-total-${etapa}`}>{cartoes.length}</span>
              </h2>
              <p className="mt-0.5 text-[11px] text-dim">{DICA_DA_ETAPA[etapa]}</p>
            </header>
            <ul className="min-h-0 flex-1 space-y-2 pr-0.5 max-md:overflow-y-auto">
              {cartoes.map((c) => (
                <li key={c.id}>
                  <Cartao
                    c={c}
                    hoje={hoje}
                    podeMover={podeMover}
                    aoArrastar={(sim) => { setArrastando(sim ? c : null); if (!sim) setSobre(null); }}
                    aoMover={aoMover}
                  />
                </li>
              ))}
              {cartoes.length === 0 && <li className="px-1 py-2 text-[12px] text-dim">ninguém aqui</li>}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Cartao({ c, hoje, podeMover, aoArrastar, aoMover }: {
  c: ContratoNoQuadro;
  hoje: string;
  podeMover: boolean;
  aoArrastar: (sim: boolean) => void;
  aoMover: (item: ContratoNoQuadro, destino: EtapaDoQuadro, origem: Element | null) => void;
}) {
  const destinos = podeMover ? destinosDoCartao(c) : [];
  const atencao = c.etapa === 'renovar' || c.etapa === 'a_encerrar';
  const linha = linhaDoCartao(c);
  const borda = c.fantasma ? 'border-dashed border-border-strong' : atencao ? 'border-warn/70' : 'border-border-strong shadow-sm';
  return (
    <div
      data-testid={`contrato-card-${c.id}`}
      data-fantasma={c.fantasma ? 'sim' : undefined}
      draggable={destinos.length > 0}
      onDragStart={(e) => {
        e.dataTransfer?.setData('text/plain', c.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        aoArrastar(true);
      }}
      onDragEnd={() => aoArrastar(false)}
      onClick={(e) => {
        // O cartão inteiro abre o painel; o link e o seletor cuidam de si.
        if ((e.target as HTMLElement).closest('a, button, input, select, label')) return;
        e.currentTarget.querySelector<HTMLAnchorElement>('[data-cartao-do-contrato]')?.click();
      }}
      className={`cursor-pointer rounded border p-2.5 transition-colors duration-150 hover:border-brand/70 ${c.fantasma ? 'bg-transparent' : 'bg-surface'} ${borda}`}
    >
      <LinkDoLead leadId={c.leadId} aba="contrato" data-cartao-do-contrato title={c.cliente} className={`block min-w-0 rounded-sm ${FOCO}`}>
        <p className="truncate text-[13.5px] font-semibold">{c.cliente}</p>
      </LinkDoLead>
      {linha && <p className="mt-0.5 text-[12px] text-muted">{linha}</p>}
      <div className="mt-1.5 flex flex-wrap gap-1">
        {chipsDoCartao(c, hoje).map((ch) => <Chip key={ch.texto} tom={ch.tom}>{ch.texto}</Chip>)}
      </div>
      {c.aviso && <p className="mt-1.5 text-[11.5px] text-warn">{c.aviso}</p>}
      <div className="mt-1.5 flex items-baseline justify-between gap-2 text-[11.5px]">
        <span className="min-w-0 truncate text-dim" title={c.dono ?? undefined}>{c.dono ?? 'sem dono'}</span>
        <span className="shrink-0 font-os-mono tabular-nums">{c.valorCentavos == null ? 'sem valor' : reaisOuAusente(c.valorCentavos)}</span>
      </div>
      {destinos.length > 0 && (
        <select
          data-testid={`contrato-mover-${c.id}`}
          aria-label={`Mover ${c.cliente}: abre o próximo passo`}
          className={`${INPUT} mt-2 !py-1 text-[12px] max-md:min-h-[44px]`}
          value=""
          onChange={(e) => {
            const destino = e.target.value as EtapaDoQuadro;
            if (destino) aoMover(c, destino, e.currentTarget);
          }}
        >
          <option value="">Mover</option>
          {destinos.map((d) => <option key={d.etapa} value={d.etapa}>{ROTULO_DA_ETAPA_DO_QUADRO[d.etapa]}: {ROTULO_DA_ACAO[d.acao]}</option>)}
        </select>
      )}
    </div>
  );
}
