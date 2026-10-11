'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, KeyboardOff, QrCode, Search, Ticket, WifiOff, X } from 'lucide-react';
import {
  normalizarBusca,
  TOTEM_ROTULO_DO_SELO,
  type TotemCatalogo,
  type TotemCatalogoProduto,
  type TotemTipoEvento,
} from '@mktos/shared';

import { buscarProdutos, categoriasDoCatalogo, indexarProdutos, produtosEmOrdem } from './busca';
import type { DadosDoEvento } from './fila';
import { TecladoVirtual } from './TecladoVirtual';

/*
 * A tela de início: boas-vindas, busca com o teclado do quiosque, categorias e
 * a lista de produtos. A busca vira evento só depois de uma pausa na
 * digitação (ou quando o cliente abre um produto), para "c", "ca", "cas"...
 * não virarem cinco buscas no relatório.
 */

const PAUSA_PARA_REGISTRAR_MS = 1500;

export const TOTEM_LOGO_PADRAO = '/totem/selo-sr-agranel-150.jpg';

export interface TelaInicialProps {
  catalogo: TotemCatalogo;
  online: boolean;
  aoAbrirProduto: (p: TotemCatalogoProduto) => void;
  aoRegistrar: (tipo: TotemTipoEvento, dados?: DadosDoEvento) => void;
  aoAbrirCadastro: () => void;
}

function Logo({ src }: { src: string }) {
  const [falhou, setFalhou] = useState(false);
  return (
    <img
      src={falhou ? TOTEM_LOGO_PADRAO : src}
      alt=""
      width={75}
      height={75}
      draggable={false}
      className="h-[75px] w-[75px] shrink-0 rounded-full object-contain"
      onError={() => setFalhou(true)}
    />
  );
}

function CartaoDoProduto({ produto, aoAbrir }: { produto: TotemCatalogoProduto; aoAbrir: () => void }) {
  return (
    <button
      type="button"
      onClick={aoAbrir}
      className="flex min-h-24 flex-col items-start justify-center gap-1 rounded-[18px] bg-[color:var(--q-cartao)] px-5 py-4 text-left text-[color:var(--q-tinta)] shadow-[0_1px_2px_rgba(31,43,23,0.10),0_6px_18px_rgba(31,43,23,0.08)] active:bg-[color:var(--q-afundado)]"
    >
      <span className="text-[26px] font-semibold leading-tight">{produto.nome}</span>
      {(produto.categoria || produto.selos.length > 0) && (
        <span className="text-[18px] text-[color:var(--q-tinta-suave)]">
          {[produto.categoria, ...produto.selos.map((s) => TOTEM_ROTULO_DO_SELO[s])].filter(Boolean).join(' · ')}
        </span>
      )}
    </button>
  );
}

export function TelaInicial({ catalogo, online, aoAbrirProduto, aoRegistrar, aoAbrirCadastro }: TelaInicialProps) {
  const [consulta, setConsulta] = useState('');
  const [categoria, setCategoria] = useState<string | null>(null);
  const [teclado, setTeclado] = useState(true);

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

  function abrir(p: TotemCatalogoProduto) {
    registrarBuscaPendente();
    aoAbrirProduto(p);
  }

  const config = catalogo.config;
  const boasVindas =
    config.mensagemBoasVindas?.trim() ||
    'Que bom ter você aqui. Procure um produto para ver ingredientes, tabela nutricional, lote e validade.';

  return (
    <div className="flex h-full flex-col text-[color:var(--q-sobre-fundo)]">
      <header className="flex items-center gap-5 px-6 pb-3 pt-5">
        <Logo src={config.logoUrl || TOTEM_LOGO_PADRAO} />
        <div className="min-w-0 flex-1">
          <p className="font-[family-name:var(--q-fonte-display)] text-[34px] font-semibold leading-tight">
            {config.nomeExibicao}
          </p>
          <p className="text-[18px] text-[color:var(--q-sobre-fundo-suave)]">{catalogo.loja.nome}</p>
        </div>
        {!online && (
          <p className="flex items-center gap-2 rounded-full border border-[color:var(--q-linha-forte)] px-4 py-2 text-[16px] text-[color:var(--q-sobre-fundo-suave)]">
            <WifiOff aria-hidden className="h-5 w-5" />
            Sem internet: mostrando o catálogo guardado
          </p>
        )}
      </header>

      {!buscando && (
        <section className="space-y-4 px-6 pb-2">
          <p className="max-w-[1200px] font-[family-name:var(--q-fonte-display)] text-[30px] leading-snug">{boasVindas}</p>
          {config.cadastroLigado &&
            (online ? (
              <div className="flex flex-wrap items-center gap-4 rounded-[18px] bg-[color:var(--q-primaria)] px-5 py-4 text-[color:var(--q-sobre-primaria)]">
                <p className="min-w-0 flex-1 text-[22px]">
                  {catalogo.campanha?.chamada || 'Faça seu cadastro e ganhe um cupom de desconto para a próxima compra.'}
                </p>
                <button
                  type="button"
                  onClick={aoAbrirCadastro}
                  className="flex min-h-16 items-center gap-3 rounded-[10px] bg-[color:var(--q-destaque)] px-6 text-[24px] font-semibold text-[color:var(--q-tinta)]"
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

      <div className="flex items-center gap-3 px-6 py-3">
        <label className="flex min-h-[72px] flex-1 items-center gap-3 rounded-[18px] border-2 border-[color:var(--q-linha-forte)] bg-[color:var(--q-cartao)] px-5 text-[color:var(--q-tinta)]">
          <Search aria-hidden className="h-8 w-8 shrink-0 text-[color:var(--q-tinta-suave)]" />
          <span className="sr-only">Procurar produto</span>
          <input
            type="search"
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            inputMode={teclado ? 'none' : 'search'}
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={80}
            placeholder="Procure pelo nome, como castanha ou granola"
            className="min-w-0 flex-1 bg-transparent text-[28px] outline-none placeholder:text-[color:var(--q-tinta-suave)]"
          />
          {buscando && (
            <button
              type="button"
              onClick={() => setConsulta('')}
              aria-label="Limpar a busca"
              className="grid h-16 w-16 shrink-0 place-items-center rounded-full"
            >
              <X aria-hidden className="h-8 w-8" />
            </button>
          )}
        </label>
        <button
          type="button"
          onClick={() => setTeclado((t) => !t)}
          aria-label={teclado ? 'Esconder o teclado' : 'Mostrar o teclado'}
          className="grid h-[72px] w-[72px] shrink-0 place-items-center rounded-[18px] border-2 border-[color:var(--q-linha-forte)] bg-[color:var(--q-cartao)] text-[color:var(--q-tinta)]"
        >
          {teclado ? <KeyboardOff aria-hidden className="h-8 w-8" /> : <Keyboard aria-hidden className="h-8 w-8" />}
        </button>
      </div>

      {!buscando && categorias.length > 0 && (
        <nav aria-label="Categorias" className="flex gap-3 overflow-x-auto px-6 pb-3">
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

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6">
        {buscando && (
          <p className="pb-3 text-[20px] text-[color:var(--q-sobre-fundo-suave)]" aria-live="polite">
            {resultados.length === 0
              ? `Não encontramos "${consulta.trim()}". Confira a escrita ou procure pela categoria.`
              : resultados.length === 1
                ? 'Um produto encontrado.'
                : `${resultados.length} produtos encontrados.`}
          </p>
        )}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
          {resultados.map((p) => (
            <CartaoDoProduto key={p.id} produto={p} aoAbrir={() => abrir(p)} />
          ))}
        </div>
      </main>

      {teclado && (
        <div className="border-t border-[color:var(--q-linha)] bg-[color:var(--q-afundado)]">
          <TecladoVirtual
            layout="qwerty"
            aoTecla={(c) => setConsulta((atual) => (atual + c.toLowerCase()).slice(0, 80))}
            aoApagar={() => setConsulta((atual) => atual.slice(0, -1))}
            aoLimpar={() => setConsulta('')}
          />
        </div>
      )}
    </div>
  );
}
