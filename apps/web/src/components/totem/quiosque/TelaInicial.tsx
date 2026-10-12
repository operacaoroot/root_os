'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardOff, QrCode, Search, Ticket, WifiOff, X } from 'lucide-react';
import {
  normalizarBusca,
  type TotemCatalogo,
  type TotemCatalogoCampanha,
  type TotemCatalogoProduto,
  type TotemTipoEvento,
} from '@mktos/shared';

import { Banners } from './Banners';
import { buscarProdutos, categoriasDoCatalogo, indexarProdutos, produtosEmOrdem } from './busca';
import type { DadosDoEvento } from './fila';
import { GradeDeProdutos } from './GradeDeProdutos';
import { Juta, Selo } from './Marca';
import { TecladoVirtual } from './TecladoVirtual';

export { TOTEM_LOGO_PADRAO } from './Marca';

/*
 * A tela de início: a vitrine de banners, a busca com o teclado do quiosque,
 * as categorias e a lista de produtos. Em pé, a vitrine fica em cima e some
 * enquanto o cliente digita; deitada, ocupa a coluna da esquerda.
 *
 * A busca vira evento só depois de uma pausa na digitação (ou quando o cliente
 * abre um produto), para "c", "ca", "cas"... não virarem cinco buscas no
 * relatório.
 */

const PAUSA_PARA_REGISTRAR_MS = 1500;
const BOAS_VINDAS_PADRAO =
  'Que bom ter você aqui. Procure um produto para ver ingredientes, tabela nutricional, lote e validade.';

export function boasVindasDaLoja(catalogo: Pick<TotemCatalogo, 'config'>): string {
  return catalogo.config.mensagemBoasVindas?.trim() || BOAS_VINDAS_PADRAO;
}

export interface TelaInicialProps {
  catalogo: TotemCatalogo;
  online: boolean;
  aoAbrirProduto: (p: TotemCatalogoProduto) => void;
  aoRegistrar: (tipo: TotemTipoEvento, dados?: DadosDoEvento) => void;
  aoAbrirCadastro: () => void;
  aoTocarCampanha?: (campanha: TotemCatalogoCampanha) => void;
}

export function TelaInicial({
  catalogo,
  online,
  aoAbrirProduto,
  aoRegistrar,
  aoAbrirCadastro,
  aoTocarCampanha,
}: TelaInicialProps) {
  const [consulta, setConsulta] = useState('');
  const [categoria, setCategoria] = useState<string | null>(null);
  const [teclado, setTeclado] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  const linhaDaBusca = useRef<HTMLDivElement>(null);
  const bandeja = useRef<HTMLDivElement>(null);
  const rolagem = useRef<HTMLElement>(null);

  const indice = useMemo(() => indexarProdutos(catalogo.produtos), [catalogo.produtos]);
  const categorias = useMemo(() => categoriasDoCatalogo(catalogo.produtos), [catalogo.produtos]);
  const buscando = consulta.trim().length > 0;
  const resultados = useMemo(
    () => (buscando ? buscarProdutos(indice, consulta) : produtosEmOrdem(catalogo.produtos, categoria)),
    [buscando, indice, consulta, catalogo.produtos, categoria],
  );

  const registrarRef = useRef(aoRegistrar);
  registrarRef.current = aoRegistrar;
  const pendente = useRef<{ termo: string; achou: boolean } | null>(null);
  const ultimoRegistrado = useRef('');

  function registrarBuscaPendente() {
    const p = pendente.current;
    pendente.current = null;
    if (!p) return;
    const chave = normalizarBusca(p.termo);
    if (chave === ultimoRegistrado.current) return;
    ultimoRegistrado.current = chave;
    registrarRef.current(p.achou ? 'busca' : 'busca_sem_resultado', { termo: p.termo });
  }

  useEffect(() => {
    const termo = consulta.trim();
    if (normalizarBusca(termo).length < 2) {
      pendente.current = null;
      return;
    }
    pendente.current = { termo, achou: resultados.length > 0 };
    const relogio = setTimeout(registrarBuscaPendente, PAUSA_PARA_REGISTRAR_MS);
    return () => clearTimeout(relogio);
  }, [consulta, resultados.length]);

  useEffect(() => () => registrarBuscaPendente(), []);

  // Toque fora do campo e do teclado fecha o teclado. Vai no clique, e não no
  // pointerdown, para a tela não mudar de lugar debaixo do dedo antes de ele
  // soltar: o toque continua valendo para o que estava embaixo dele.
  useEffect(() => {
    if (!teclado) return;
    function aoClicar(e: MouseEvent) {
      const alvo = e.target as Node | null;
      if (alvo && (linhaDaBusca.current?.contains(alvo) || bandeja.current?.contains(alvo))) return;
      setTeclado(false);
      campo.current?.blur();
    }
    document.addEventListener('click', aoClicar, true);
    return () => document.removeEventListener('click', aoClicar, true);
  }, [teclado]);

  function fecharTeclado() {
    setTeclado(false);
    campo.current?.blur();
  }

  // Estável para os cartões memorizados não redesenharem a cada letra digitada.
  const abrirRef = useRef<(p: TotemCatalogoProduto) => void>(() => {});
  abrirRef.current = (p) => {
    registrarBuscaPendente();
    fecharTeclado();
    aoAbrirProduto(p);
  };
  const abrir = useCallback((p: TotemCatalogoProduto) => abrirRef.current(p), []);
  const chaveDaLista = buscando ? `busca:${normalizarBusca(consulta)}` : `categoria:${categoria ?? ''}`;

  const config = catalogo.config;
  const campanhas = catalogo.campanhas ?? [];
  const boasVindas = boasVindasDaLoja(catalogo);
  const temBannerDeCadastro = campanhas.some((c) => c.acao === 'cadastro');
  const mostraFaixaDoCadastro = config.cadastroLigado && !temBannerDeCadastro;

  return (
    <div className="flex h-full flex-col text-[color:var(--q-sobre-fundo)]">
      <header className="relative flex shrink-0 items-center gap-5 overflow-hidden border-b-4 border-[#CB8139] bg-[color:var(--q-primaria)] px-6 py-4 text-[color:var(--q-sobre-primaria)]">
        <Juta />
        <Selo src={config.logoUrl} className="relative" />
        <div className="relative min-w-0 flex-1">
          <p className="truncate font-[family-name:var(--q-fonte-chamada)] text-[18px] font-medium uppercase tracking-[.14em] text-[color:var(--q-primaria-rotulo)]">
            {catalogo.loja.nome}
          </p>
          <p className="truncate font-[family-name:var(--q-fonte-display)] text-[clamp(30px,3.2vw,40px)] font-semibold leading-tight">
            {config.nomeExibicao}
          </p>
        </div>
        {!online && (
          <p className="relative flex items-center gap-2 rounded-full border border-current px-4 py-2 text-[16px] text-[color:var(--q-primaria-suave)]">
            <WifiOff aria-hidden className="h-5 w-5 shrink-0" />
            Sem internet: mostrando o catálogo guardado
          </p>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col landscape:grid landscape:grid-cols-[5fr_7fr] landscape:grid-rows-[minmax(0,1fr)]">
        <section
          aria-label="Vitrine"
          className={`shrink-0 portrait:h-[34vh] portrait:min-h-[300px] landscape:h-full landscape:min-h-0 ${
            teclado || buscando ? 'portrait:hidden' : ''
          }`}
        >
          <Banners
            campanhas={campanhas}
            modo="vitrine"
            online={online}
            cadastroLigado={config.cadastroLigado}
            logoUrl={config.logoUrl}
            nomeExibicao={config.nomeExibicao}
            boasVindas={boasVindas}
            aoTocar={aoTocarCampanha}
          />
        </section>

        <div className="flex min-h-0 flex-1 flex-col landscape:h-full">
          {!buscando && (campanhas.length > 0 || mostraFaixaDoCadastro) && (
            <section className="space-y-4 px-6 pt-5">
              {campanhas.length > 0 && !teclado && (
                <p className="max-w-[1200px] font-[family-name:var(--q-fonte-display)] text-[28px] leading-snug">
                  {boasVindas}
                </p>
              )}
              {mostraFaixaDoCadastro &&
                (online ? (
                  <div className="flex flex-wrap items-center gap-4 rounded-[18px] bg-[color:var(--q-primaria)] px-5 py-4 text-[color:var(--q-sobre-primaria)]">
                    <p className="min-w-0 flex-1 text-[22px]">
                      {catalogo.campanha?.chamada || 'Faça seu cadastro e ganhe um cupom de desconto para a próxima compra.'}
                    </p>
                    <button
                      type="button"
                      onClick={aoAbrirCadastro}
                      className="flex min-h-16 items-center gap-3 rounded-[10px] bg-[#CB8139] px-6 text-[24px] font-semibold text-[#16200F] active:brightness-95"
                    >
                      <Ticket aria-hidden className="h-7 w-7" />
                      Ganhe seu cupom
                    </button>
                  </div>
                ) : (
                  <p className="flex items-center gap-3 rounded-[18px] border border-[color:var(--q-linha-forte)] px-5 py-4 text-[22px]">
                    <QrCode aria-hidden className="h-8 w-8 shrink-0" />
                    Para se cadastrar, aponte o celular para o QR da etiqueta.
                  </p>
                ))}
            </section>
          )}

          {/* O foco aparece na borda do rótulo; o contorno de foco da marca e o × nativo do campo de busca ficariam em dobro. */}
          <div ref={linhaDaBusca} className="flex shrink-0 items-center gap-3 px-6 py-4">
            <label className="flex min-h-[76px] flex-1 items-center gap-3 rounded-[18px] border-2 border-[color:var(--q-linha-forte)] bg-[color:var(--q-cartao)] px-5 text-[color:var(--q-tinta)] shadow-[0_1px_2px_rgba(31,43,23,0.10),0_6px_18px_rgba(31,43,23,0.08)] focus-within:border-[#CB8139]">
              <Search aria-hidden className="h-8 w-8 shrink-0 text-[color:var(--q-tinta-suave)]" />
              <span className="sr-only">Procurar produto</span>
              <input
                ref={campo}
                type="search"
                value={consulta}
                onChange={(e) => setConsulta(e.target.value)}
                onClick={() => setTeclado(true)}
                onKeyDown={() => setTeclado(true)}
                inputMode="none"
                enterKeyHint="search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                maxLength={80}
                placeholder="Procure pelo nome, como castanha ou granola"
                className="min-w-0 flex-1 bg-transparent text-[28px] !outline-none placeholder:text-[color:var(--q-tinta-suave)] [&::-webkit-search-cancel-button]:appearance-none"
              />
              {buscando && (
                <button
                  type="button"
                  onClick={() => setConsulta('')}
                  aria-label="Limpar a busca"
                  className="grid h-16 w-16 shrink-0 place-items-center rounded-full active:bg-[color:var(--q-afundado)]"
                >
                  <X aria-hidden className="h-8 w-8" />
                </button>
              )}
            </label>
            {teclado && (
              <button
                type="button"
                onClick={fecharTeclado}
                aria-label="Fechar teclado"
                className="grid h-[76px] w-[76px] shrink-0 place-items-center rounded-[18px] border-2 border-[color:var(--q-linha-forte)] bg-[color:var(--q-cartao)] text-[color:var(--q-tinta)] active:bg-[color:var(--q-afundado)]"
              >
                <KeyboardOff aria-hidden className="h-8 w-8" />
              </button>
            )}
          </div>

          {!buscando && categorias.length > 0 && (
            <nav aria-label="Categorias" className="flex shrink-0 gap-3 overflow-x-auto px-6 pb-4">
              {[null, ...categorias].map((c) => {
                const ativa = c === categoria;
                return (
                  <button
                    key={c ?? 'todas'}
                    type="button"
                    aria-pressed={ativa}
                    onClick={() => setCategoria(c)}
                    className={`min-h-16 shrink-0 rounded-full border-2 px-6 text-[22px] font-semibold ${
                      ativa
                        ? 'border-[color:var(--q-primaria)] bg-[color:var(--q-primaria)] text-[color:var(--q-sobre-primaria)]'
                        : 'border-[color:var(--q-linha-forte)] bg-[color:var(--q-cartao)] text-[color:var(--q-tinta)]'
                    }`}
                  >
                    {c ?? 'Todos'}
                  </button>
                );
              })}
            </nav>
          )}

          <main ref={rolagem} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6">
            {buscando && (
              <p className="pb-3 text-[20px] text-[color:var(--q-sobre-fundo-suave)]" aria-live="polite">
                {resultados.length === 0
                  ? `Não encontramos "${consulta.trim()}". Confira a escrita ou procure pela categoria.`
                  : resultados.length === 1
                    ? 'Um produto encontrado.'
                    : `${resultados.length} produtos encontrados.`}
              </p>
            )}
            <GradeDeProdutos produtos={resultados} chave={chaveDaLista} aoAbrir={abrir} rolagem={rolagem} />
          </main>

          {teclado && (
            <div ref={bandeja} className="shrink-0 border-t border-[color:var(--q-linha)] bg-[color:var(--q-afundado)]">
              <TecladoVirtual
                layout="qwerty"
                aoTecla={(c) => setConsulta((atual) => (atual + c.toLowerCase()).slice(0, 80))}
                aoApagar={() => setConsulta((atual) => atual.slice(0, -1))}
                aoLimpar={() => setConsulta('')}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
