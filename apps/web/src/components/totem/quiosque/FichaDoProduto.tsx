'use client';

import type { ReactNode } from 'react';
import { ArrowLeft, TriangleAlert } from 'lucide-react';
import {
  TOTEM_ROTULO_DO_SELO,
  totemSituacaoDaValidade,
  type TotemCatalogoConfig,
  type TotemCatalogoLote,
  type TotemCatalogoProduto,
} from '@mktos/shared';

import { dataDoCalendario, dataLocal, diaEMesLocal, numeroBr, textoDaPorcao, textoDoPreco } from './formato';
import { IconeDoSelo } from './IconeDoSelo';
import { ImagemOuInicial, Juta } from './Marca';
import { alergenicosEfetivos, temVdNaoEstabelecido } from './vitrine';

/*
 * A ficha do produto: o que o cliente veio ver no totem. A situação da
 * validade é recalculada aqui, com a data do aparelho, porque o catálogo pode
 * ter sido baixado dias antes.
 */

const SOMBRA_DO_CARTAO = 'shadow-[0_1px_2px_rgba(31,43,23,0.10),0_6px_18px_rgba(31,43,23,0.08)]';

function comPonto(texto: string): string {
  return /[.!?…]$/.test(texto.trim()) ? texto : `${texto}.`;
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-[family-name:var(--q-fonte-chamada)] text-[24px] font-medium uppercase tracking-[.08em] text-[color:var(--q-destaque-tinta)]">
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
          <span className="ml-3 inline-block rounded-full bg-[color:var(--q-sucesso-fundo)] px-3 py-1 text-[18px] text-[color:var(--q-sucesso)]">
            Dentro da validade
          </span>
        )}
        {situacao === 'atencao' && (
          <span className="ml-3 inline-block rounded-full bg-[color:var(--q-atencao-fundo)] px-3 py-1 text-[18px] text-[color:var(--q-atencao)]">
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
  const porcao = textoDaPorcao(produto.porcaoG, produto.porcaoDescricao);
  const temVd = produto.nutricional.some((n) => n.vd != null);
  const semVd = temVdNaoEstabelecido(produto.nutricional);
  return (
    <div className="space-y-3">
      {porcao && (
        <p className="inline-block rounded-[10px] bg-[color:var(--q-afundado)] px-4 py-2 text-[20px] font-semibold">
          {porcao}
        </p>
      )}
      <table className="w-full border-collapse text-left text-[21px]">
        <thead>
          <tr className="border-b-[3px] border-[color:var(--q-tinta)]">
            <th scope="col" className="py-2 pr-3 font-semibold">Nutriente</th>
            <th scope="col" className="py-2 pr-3 text-right font-semibold">Por porção</th>
            {temVd && <th scope="col" className="py-2 text-right font-semibold">%VD*</th>}
          </tr>
        </thead>
        <tbody>
          {produto.nutricional.map((n) => (
            <tr key={n.nutriente} className="border-b border-[color:var(--q-linha)]">
              <th scope="row" className="py-2.5 pr-3 font-normal">{n.nutriente}</th>
              <td className="py-2.5 pr-3 text-right tabular-nums">
                {numeroBr(n.quantidade)} {n.unidade}
              </td>
              {temVd && <td className="py-2.5 text-right tabular-nums">{n.vd == null ? '**' : `${numeroBr(n.vd)}%`}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {temVd && (
        <p className="text-[17px] leading-snug text-[color:var(--q-tinta-suave)]">
          *Percentual do valor diário que a porção fornece, numa dieta de 2.000 kcal.
        </p>
      )}
      {semVd && <p className="text-[17px] leading-snug text-[color:var(--q-tinta-suave)]">** VD não estabelecido.</p>}
      {produto.fonteNutricional && (
        <p className="text-[17px] leading-snug text-[color:var(--q-tinta-suave)]">Fonte da tabela: {comPonto(produto.fonteNutricional)}</p>
      )}
    </div>
  );
}

export interface FichaDoProdutoProps {
  produto: TotemCatalogoProduto;
  /**
   * Sem a configuração, a ficha confia no catálogo: o preço só vem nele com
   * o preço ligado, e o aviso padrão de alergênicos fica de fora.
   */
  config?: Pick<TotemCatalogoConfig, 'alergenicosPadrao' | 'precoLigado'> | null;
  aoVoltar: () => void;
}

export function FichaDoProduto({ produto, config = null, aoVoltar }: FichaDoProdutoProps) {
  const hoje = new Date();
  const alergenicos = alergenicosEfetivos(produto, { alergenicosPadrao: config?.alergenicosPadrao ?? null });
  const precoLigado = config ? config.precoLigado : true;
  const preco =
    precoLigado && produto.precoCentavos != null && produto.unidadePreco
      ? textoDoPreco(produto.precoCentavos, produto.unidadePreco)
      : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={produto.nome}
      className="fixed inset-0 z-30 flex flex-col bg-[color:var(--q-fundo)] text-[color:var(--q-sobre-fundo)]"
    >
      <div className="relative flex shrink-0 items-center gap-4 overflow-hidden border-b-4 border-[#CB8139] bg-[color:var(--q-primaria)] px-6 py-4">
        <Juta />
        <button
          type="button"
          onClick={aoVoltar}
          className="relative flex min-h-16 items-center gap-3 rounded-[10px] bg-[#CB8139] px-6 text-[24px] font-semibold text-[#16200F] active:brightness-95"
        >
          <ArrowLeft aria-hidden className="h-8 w-8" />
          Voltar
        </button>
        {produto.categoria && (
          <p className="relative min-w-0 flex-1 truncate text-right font-[family-name:var(--q-fonte-chamada)] text-[20px] font-medium uppercase tracking-[.14em] text-[color:var(--q-primaria-rotulo)]">
            {produto.categoria}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6">
        <div className="mx-auto max-w-[1400px] space-y-6">
          <header className="grid items-start gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <ImagemOuInicial
              src={produto.imagemUrl}
              nome={produto.nome}
              prioridade
              className={`aspect-[4/3] w-full rounded-[18px] ${SOMBRA_DO_CARTAO}`}
              classeDaInicial="text-[160px]"
            />
            <div className="min-w-0 space-y-5">
              <div className="space-y-2">
                <h1 className="break-words font-[family-name:var(--q-fonte-display)] text-[clamp(40px,4.4vw,56px)] font-semibold leading-[1.08]">
                  {produto.nome}
                </h1>
                <p className="font-[family-name:var(--q-fonte-chamada)] text-[22px] font-medium uppercase tracking-[.08em] text-[color:var(--q-tinta-suave)]">
                  Cód. {produto.codigo}
                </p>
              </div>
              {produto.selos.length > 0 && (
                <ul className="flex flex-wrap gap-3" aria-label="Selos">
                  {produto.selos.map((s) => (
                    <li
                      key={s}
                      className="flex min-h-[52px] items-center gap-2.5 rounded-full border-2 border-[color:var(--q-primaria)] bg-[color:var(--q-cartao)] py-1.5 pl-2 pr-5 text-[20px] font-semibold text-[color:var(--q-tinta)]"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[color:var(--q-primaria)] text-[color:var(--q-sobre-primaria)]">
                        <IconeDoSelo selo={s} className="h-6 w-6" />
                      </span>
                      {TOTEM_ROTULO_DO_SELO[s]}
                    </li>
                  ))}
                </ul>
              )}
              {preco && (
                <p className="inline-block bg-[#CB8139] px-4 py-1 font-[family-name:var(--q-fonte-chamada)] text-[36px] font-medium uppercase tracking-[.04em] text-[#16200F]">
                  {preco}
                </p>
              )}
              {alergenicos && (
                <div
                  role="note"
                  className="flex items-start gap-3 rounded-[10px] border-2 border-[color:var(--q-atencao)] bg-[color:var(--q-atencao-fundo)] px-4 py-3 text-[22px] text-[color:var(--q-atencao)]"
                >
                  <TriangleAlert aria-hidden className="mt-1 h-7 w-7 shrink-0" />
                  <p>
                    <span className="font-bold">Alergênicos: </span>
                    {alergenicos}
                  </p>
                </div>
              )}
            </div>
          </header>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className={`space-y-6 rounded-[18px] bg-[color:var(--q-cartao)] p-6 text-[color:var(--q-tinta)] ${SOMBRA_DO_CARTAO}`}>
              <Secao titulo="Composição">
                <p className="text-[22px] leading-relaxed">
                  {produto.composicao?.trim() || 'A composição deste produto ainda não foi cadastrada.'}
                </p>
              </Secao>
              {produto.beneficios?.trim() && (
                <Secao titulo="Por que escolher">
                  <p className="whitespace-pre-line text-[22px] leading-relaxed">{produto.beneficios}</p>
                </Secao>
              )}
              {produto.sugestoes?.trim() && (
                <Secao titulo="Sugestões de uso">
                  <p className="whitespace-pre-line text-[22px] leading-relaxed">{produto.sugestoes}</p>
                </Secao>
              )}
              <Secao titulo="Lote e validade">
                <LoteEValidade lote={produto.lote} hoje={hoje} />
              </Secao>
            </div>

            <div className={`rounded-[18px] bg-[color:var(--q-cartao)] p-6 text-[color:var(--q-tinta)] ${SOMBRA_DO_CARTAO}`}>
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
