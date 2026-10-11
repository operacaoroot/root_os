'use client';

import { ArrowLeft, TriangleAlert } from 'lucide-react';
import {
  TOTEM_ROTULO_DO_SELO,
  totemSituacaoDaValidade,
  type TotemCatalogoLote,
  type TotemCatalogoProduto,
} from '@mktos/shared';

import { dataDoCalendario, dataLocal, diaEMesLocal, numeroBr, textoDoPreco } from './formato';

/*
 * A ficha do produto: o que o cliente veio ver no totem. A situação da
 * validade é recalculada aqui, com a data do aparelho, porque o catálogo pode
 * ter sido baixado dias antes.
 */

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-[family-name:var(--q-fonte-chamada)] text-[24px] uppercase tracking-wide text-[color:var(--q-destaque-tinta)]">
        {titulo}
      </h2>
      {children}
    </section>
  );
}

function LoteEValidade({ lote, hoje }: { lote: TotemCatalogoLote | null; hoje: Date }) {
  if (!lote) {
    return (
      <p className="text-[22px] leading-relaxed text-[color:var(--q-tinta-suave)]">
        A loja ainda não registrou o lote deste produto. Para saber a validade, fale com um atendente.
      </p>
    );
  }
  const situacao = totemSituacaoDaValidade(lote.validadeEm, hoje);
  return (
    <div className="space-y-3 text-[22px] leading-relaxed">
      <p>
        <span className="font-semibold">Lote {lote.codigo}</span>
        {lote.presumido ? `, recebido em ${diaEMesLocal(lote.repostoEm)}.` : `, reposto em ${dataLocal(lote.repostoEm)}.`}
      </p>
      {lote.fabricadoEm && <p>Fabricado em {dataDoCalendario(lote.fabricadoEm)}.</p>}
      <p>
        Validade: <span className="font-semibold">{dataDoCalendario(lote.validadeEm)}</span>
        {situacao === 'ok' && (
          <span className="ml-3 rounded-full bg-[color:var(--q-sucesso-fundo)] px-3 py-1 text-[18px] text-[color:var(--q-sucesso)]">
            Dentro da validade
          </span>
        )}
        {situacao === 'atencao' && (
          <span className="ml-3 rounded-full bg-[color:var(--q-atencao-fundo)] px-3 py-1 text-[18px] text-[color:var(--q-atencao)]">
            Vence em breve
          </span>
        )}
      </p>
      {situacao === 'vencido' && (
        <p
          role="alert"
          className="flex items-start gap-3 rounded-[10px] border-2 border-[color:var(--q-perigo)] bg-[color:var(--q-perigo-fundo)] px-4 py-3 font-semibold text-[color:var(--q-perigo)]"
        >
          <TriangleAlert aria-hidden className="mt-1 h-7 w-7 shrink-0" />
          A validade deste lote passou. Consulte um atendente antes de levar.
        </p>
      )}
    </div>
  );
}

function TabelaNutricional({ produto }: { produto: TotemCatalogoProduto }) {
  if (!produto.nutricional.length) {
    return (
      <p className="text-[22px] text-[color:var(--q-tinta-suave)]">
        A tabela nutricional deste produto ainda não foi cadastrada.
      </p>
    );
  }
  const porcao =
    produto.porcaoDescricao?.trim() || (produto.porcaoG != null ? `Porção de ${numeroBr(produto.porcaoG)} g` : null);
  const temVd = produto.nutricional.some((n) => n.vd != null);
  return (
    <div className="space-y-2">
      {porcao && <p className="text-[20px] text-[color:var(--q-tinta-suave)]">{porcao}</p>}
      <table className="w-full border-collapse text-left text-[20px]">
        <thead>
          <tr className="border-b-2 border-[color:var(--q-tinta)]">
            <th scope="col" className="py-2 pr-3 font-semibold">Nutriente</th>
            <th scope="col" className="py-2 pr-3 text-right font-semibold">Por porção</th>
            {temVd && <th scope="col" className="py-2 text-right font-semibold">%VD*</th>}
          </tr>
        </thead>
        <tbody>
          {produto.nutricional.map((n) => (
            <tr key={n.nutriente} className="border-b border-[color:var(--q-linha)]">
              <th scope="row" className="py-2 pr-3 font-normal">{n.nutriente}</th>
              <td className="py-2 pr-3 text-right tabular-nums">
                {numeroBr(n.quantidade)} {n.unidade}
              </td>
              {temVd && <td className="py-2 text-right tabular-nums">{n.vd == null ? '—' : `${numeroBr(n.vd)}%`}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {temVd && (
        <p className="text-[16px] text-[color:var(--q-tinta-suave)]">
          *Percentual do valor diário que a porção fornece, numa dieta de 2.000 kcal.
        </p>
      )}
      {produto.fonteNutricional && (
        <p className="text-[16px] text-[color:var(--q-tinta-suave)]">Fonte da tabela: {produto.fonteNutricional}.</p>
      )}
    </div>
  );
}

export function FichaDoProduto({ produto, aoVoltar }: { produto: TotemCatalogoProduto; aoVoltar: () => void }) {
  const hoje = new Date();
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={produto.nome}
      className="fixed inset-0 z-30 flex flex-col bg-[color:var(--q-fundo)] text-[color:var(--q-sobre-fundo)]"
    >
      <div className="flex items-center gap-4 border-b border-[color:var(--q-linha)] px-6 py-3">
        <button
          type="button"
          onClick={aoVoltar}
          className="flex min-h-16 items-center gap-3 rounded-[10px] bg-[color:var(--q-primaria)] px-6 text-[24px] font-semibold text-[color:var(--q-sobre-primaria)]"
        >
          <ArrowLeft aria-hidden className="h-8 w-8" />
          Voltar
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-6">
        <div className="mx-auto max-w-[1400px] space-y-6">
          <header className="flow-root space-y-3">
            {produto.imagemUrl && (
              <img
                src={produto.imagemUrl}
                alt=""
                className="float-right ml-6 h-48 w-48 rounded-[18px] object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            )}
            {produto.categoria && (
              <p className="font-[family-name:var(--q-fonte-chamada)] text-[22px] uppercase tracking-wide text-[color:var(--q-sobre-fundo-suave)]">
                {produto.categoria}
              </p>
            )}
            <h1 className="font-[family-name:var(--q-fonte-display)] text-[48px] font-semibold leading-tight">
              {produto.nome}
            </h1>
            {produto.selos.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label="Selos">
                {produto.selos.map((s) => (
                  <li
                    key={s}
                    className="rounded-full bg-[color:var(--q-primaria)] px-4 py-2 text-[20px] font-semibold text-[color:var(--q-sobre-primaria)]"
                  >
                    {TOTEM_ROTULO_DO_SELO[s]}
                  </li>
                ))}
              </ul>
            )}
            {produto.precoCentavos != null && produto.unidadePreco && (
              <p className="font-[family-name:var(--q-fonte-chamada)] text-[36px] text-[color:var(--q-sobre-fundo)]">
                {textoDoPreco(produto.precoCentavos, produto.unidadePreco)}
              </p>
            )}
          </header>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-6 rounded-[18px] bg-[color:var(--q-cartao)] p-6 text-[color:var(--q-tinta)] shadow-[0_1px_2px_rgba(31,43,23,0.10),0_6px_18px_rgba(31,43,23,0.08)]">
              {produto.alergenicos?.trim() && (
                <div
                  role="note"
                  className="flex items-start gap-3 rounded-[10px] border-2 border-[color:var(--q-atencao)] bg-[color:var(--q-atencao-fundo)] px-4 py-3 text-[22px] text-[color:var(--q-atencao)]"
                >
                  <TriangleAlert aria-hidden className="mt-1 h-7 w-7 shrink-0" />
                  <p>
                    <span className="font-bold">Alergênicos: </span>
                    {produto.alergenicos}
                  </p>
                </div>
              )}
              <Secao titulo="Composição">
                <p className="text-[22px] leading-relaxed">
                  {produto.composicao?.trim() || 'A composição deste produto ainda não foi cadastrada.'}
                </p>
              </Secao>
              {produto.beneficios?.trim() && (
                <Secao titulo="Por que escolher">
                  <p className="text-[22px] leading-relaxed">{produto.beneficios}</p>
                </Secao>
              )}
              <Secao titulo="Lote e validade">
                <LoteEValidade lote={produto.lote} hoje={hoje} />
              </Secao>
            </div>

            <div className="rounded-[18px] bg-[color:var(--q-cartao)] p-6 text-[color:var(--q-tinta)] shadow-[0_1px_2px_rgba(31,43,23,0.10),0_6px_18px_rgba(31,43,23,0.08)]">
              <Secao titulo="Informação nutricional">
                <TabelaNutricional produto={produto} />
              </Secao>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
