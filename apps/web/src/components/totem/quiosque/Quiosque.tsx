'use client';

import { useCallback, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import {
  TOTEM_TEMPO_OCIOSO_PADRAO_SEG,
  type TotemCatalogoCampanha,
  type TotemCatalogoProduto,
} from '@mktos/shared';

import { CadastroCupom } from '../CadastroCupom';
import { FichaDoProduto } from './FichaDoProduto';
import { temaDoQuiosque } from './formato';
import { aplicarGuardas, useGuardasDoQuiosque, useOciosidade, useServiceWorkerDoQuiosque } from './guardas';
import { ListaDaCampanha } from './ListaDaCampanha';
import { Juta } from './Marca';
import { TelaDeAtivacao } from './TelaDeAtivacao';
import { TelaDeManutencao } from './TelaDeManutencao';
import { TelaDeEspera } from './TelaDeEspera';
import { boasVindasDaLoja, TelaInicial } from './TelaInicial';
import { useQuiosque } from './useQuiosque';

/*
 * O QUIOSQUE DA LOJA (CONTRATO.md, seção 7). Junta o estado do aparelho, as
 * telas e as guardas de quiosque. Tudo o que o cliente abre (ficha, cadastro,
 * política de privacidade, manutenção) é uma camada por cima da tela inicial,
 * nunca outra página: assim a volta por inatividade fecha tudo de uma vez e o
 * totem não fica preso fora de `/totem`. Parado, o totem entra no descanso de
 * tela com os banners da loja; um toque devolve a tela inicial limpa.
 */

const FONTES = {
  '--q-fonte-display': 'var(--fonte-fraunces), Georgia, serif',
  '--q-fonte-chamada': 'var(--fonte-oswald), "Arial Narrow", sans-serif',
  '--q-fonte-texto': 'var(--fonte-montserrat), system-ui, sans-serif',
};

// O CadastroCupom (frente D) lê as cores destes dois nomes, e não dos --q-*.
const CORES_DO_CADASTRO = {
  '--totem-cor-primaria': 'var(--q-primaria)',
  '--totem-cor-fundo': 'var(--q-fundo)',
} as CSSProperties;

function Aviso({ children }: { children: ReactNode }) {
  return (
    <main className="grid h-full place-items-center px-6 text-center text-[color:var(--q-sobre-fundo)]">
      <div className="max-w-[900px] space-y-6">{children}</div>
    </main>
  );
}

export function Quiosque({ classeDasFontes = '' }: { classeDasFontes?: string }) {
  const q = useQuiosque();
  const [produto, setProduto] = useState<TotemCatalogoProduto | null>(null);
  const [campanhaAberta, setCampanhaAberta] = useState<TotemCatalogoCampanha | null>(null);
  const [cadastroAberto, setCadastroAberto] = useState(false);
  const [espera, setEspera] = useState(false);
  const [manutencao, setManutencao] = useState(false);
  const [privacidade, setPrivacidade] = useState<string | null>(null);
  const [rodada, setRodada] = useState(0);

  const voltarAoInicio = useCallback(() => {
    setProduto(null);
    setCampanhaAberta(null);
    setCadastroAberto(false);
    setManutencao(false);
    setPrivacidade(null);
    setRodada((r) => r + 1);
    setEspera(true);
  }, []);

  const ocioso = (q.catalogo?.config.tempoOciosoSeg ?? TOTEM_TEMPO_OCIOSO_PADRAO_SEG) * 1000;
  const tocar = useOciosidade(ocioso, voltarAoInicio, q.fase === 'pronto');

  useGuardasDoQuiosque({
    aoPrivacidade: setPrivacidade,
    aoManutencao: () => {
      if (q.aparelho) setManutencao(true);
    },
    aoAtividade: tocar,
  });
  useServiceWorkerDoQuiosque();

  function abrirProduto(p: TotemCatalogoProduto) {
    setProduto(p);
    q.registrar('ver_produto', { produtoId: p.id });
  }

  function tocarCampanha(c: TotemCatalogoCampanha) {
    q.registrar('campanha_tocada', { termo: c.nome });
    if (c.acao === 'cadastro') {
      if (q.catalogo?.config.cadastroLigado) setCadastroAberto(true);
    } else if (c.acao === 'produtos') {
      setCampanhaAberta(c);
    }
  }

  // A política abre num iframe da mesma origem; as guardas e o relógio de
  // inatividade precisam valer lá dentro também.
  function prepararIframe(iframe: HTMLIFrameElement) {
    const janela = iframe.contentWindow;
    if (!janela) return;
    try {
      aplicarGuardas(janela.document, setPrivacidade);
      janela.document.addEventListener('pointerdown', tocar, true);
      janela.document.addEventListener('keydown', tocar, true);
    } catch {
      /* outra origem: o sandbox já impede a navegação para fora */
    }
  }

  const estilo = {
    ...temaDoQuiosque(q.catalogo?.config ?? null),
    ...FONTES,
    fontFamily: 'var(--q-fonte-texto)',
    touchAction: 'manipulation',
    overscrollBehavior: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTouchCallout: 'none',
    WebkitTapHighlightColor: 'transparent',
  } as CSSProperties;

  let tela: ReactNode;
  if (q.fase === 'carregando') {
    tela = (
      <Aviso>
        <p className="text-[28px]">Abrindo o totem…</p>
      </Aviso>
    );
  } else if (q.fase === 'ativacao' || !q.aparelho) {
    tela = <TelaDeAtivacao aoAtivar={q.ativar} />;
  } else if (!q.catalogo) {
    tela = (
      <Aviso>
        {q.sincronia.erro && !q.sincronia.sincronizando ? (
          <>
            <p className="text-[28px] leading-relaxed">{q.sincronia.erro}</p>
            <p className="text-[22px] text-[color:var(--q-sobre-fundo-suave)]">
              O totem ainda não tem o catálogo da loja guardado. Ele precisa de internet pelo menos uma vez.
            </p>
            <button
              type="button"
              onClick={() => void q.sincronizar()}
              className="inline-flex min-h-[72px] items-center gap-3 rounded-[10px] bg-[color:var(--q-primaria)] px-8 text-[24px] font-semibold text-[color:var(--q-sobre-primaria)]"
            >
              <RefreshCw aria-hidden className="h-7 w-7" />
              Tentar de novo
            </button>
          </>
        ) : (
          <p className="text-[28px]">Baixando o catálogo da loja…</p>
        )}
      </Aviso>
    );
  } else {
    const catalogo = q.catalogo;
    tela = (
      <>
        <TelaInicial
          key={rodada}
          catalogo={catalogo}
          online={q.online}
          aoAbrirProduto={abrirProduto}
          aoRegistrar={q.registrar}
          aoAbrirCadastro={() => setCadastroAberto(true)}
          aoTocarCampanha={tocarCampanha}
        />
        {campanhaAberta && (
          <ListaDaCampanha
            campanha={campanhaAberta}
            produtos={catalogo.produtos}
            aoAbrirProduto={abrirProduto}
            aoVoltar={() => setCampanhaAberta(null)}
          />
        )}
        {produto && <FichaDoProduto produto={produto} config={catalogo.config} aoVoltar={() => setProduto(null)} />}
        {cadastroAberto && catalogo.config.cadastroLigado && (
          <div className="fixed inset-0 z-40 flex flex-col bg-[color:var(--q-fundo)]">
            {/* Sem "Voltar" aqui: o "Cancelar" do formulário fica travado enquanto o cadastro é enviado. */}
            <div className="relative shrink-0 overflow-hidden border-b-4 border-[#CB8139] bg-[color:var(--q-primaria)] px-6 py-7">
              <Juta />
              <p className="relative text-center font-[family-name:var(--q-fonte-chamada)] text-[24px] font-medium uppercase tracking-[.14em] text-[color:var(--q-primaria-rotulo)]">
                Cupom de desconto
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-8 py-10">
              <div className="mx-auto flex min-h-full max-w-[960px] flex-col justify-center" style={CORES_DO_CADASTRO}>
                <CadastroCupom
                  origem="totem"
                  credencial={{ token: q.aparelho.token }}
                  aoConcluir={() => setCadastroAberto(false)}
                  aoCancelar={() => setCadastroAberto(false)}
                />
              </div>
            </div>
          </div>
        )}
        {espera && (
          <TelaDeEspera
            catalogo={catalogo}
            online={q.online}
            boasVindas={boasVindasDaLoja(catalogo)}
            aoSair={() => setEspera(false)}
          />
        )}
      </>
    );
  }

  return (
    <div
      className={`${classeDasFontes} fixed inset-0 overflow-hidden bg-[color:var(--q-fundo)] text-[color:var(--q-sobre-fundo)]`}
      style={estilo}
    >
      {tela}

      {privacidade && (
        <div className="fixed inset-0 z-[45] flex flex-col bg-[color:var(--q-fundo)]">
          <div className="border-b border-[color:var(--q-linha)] px-6 py-3">
            <button
              type="button"
              onClick={() => setPrivacidade(null)}
              className="flex min-h-16 items-center gap-3 rounded-[10px] bg-[color:var(--q-primaria)] px-6 text-[24px] font-semibold text-[color:var(--q-sobre-primaria)]"
            >
              <ArrowLeft aria-hidden className="h-8 w-8" />
              Voltar ao totem
            </button>
          </div>
          <iframe
            src={privacidade}
            title="Política de privacidade"
            sandbox="allow-same-origin allow-scripts"
            className="min-h-0 w-full flex-1 border-0 bg-white"
            onLoad={(e) => prepararIframe(e.currentTarget)}
          />
        </div>
      )}

      {manutencao && q.aparelho && (
        <TelaDeManutencao
          aparelho={q.aparelho}
          catalogo={q.catalogo}
          online={q.online}
          sincronia={q.sincronia}
          eventosNaFila={q.eventosNaFila}
          aoSincronizar={() => void q.sincronizar()}
          aoFechar={() => setManutencao(false)}
        />
      )}
    </div>
  );
}
