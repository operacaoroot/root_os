'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  TOTEM_MAXIMO_ETIQUETAS_POR_VEZ,
  TotemLoteUuidSchema,
  totemLoteDataBR,
  type TotemEtiquetaDoPainel,
} from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Botao, Card } from '../../../referencias/ui';
import { urlCurtaDaEtiqueta, urlDaEtiqueta } from '../../../p/formato';
import { mensagemDoErro } from '../../lotes/comum';
import {
  FORMATOS_DE_ETIQUETA,
  ID_DA_FOLHA,
  cssDaImpressao,
  ehFormatoDeEtiqueta,
  svgDoQr,
  type FormatoDeEtiqueta,
} from '../impressao';

const CHAVE_DO_FORMATO = 'totem:formato-da-etiqueta';

function formatoGuardado(): FormatoDeEtiqueta {
  try {
    const v = window.localStorage.getItem(CHAVE_DO_FORMATO);
    return ehFormatoDeEtiqueta(v) ? v : '60x40';
  } catch {
    return '60x40';
  }
}

function idsDaUrl(texto: string | null): string[] {
  if (!texto) return [];
  const ids = texto
    .split(',')
    .map((s) => s.trim())
    .filter((s) => TotemLoteUuidSchema.safeParse(s).success);
  return [...new Set(ids)].slice(0, TOTEM_MAXIMO_ETIQUETAS_POR_VEZ);
}

function Etiqueta({
  etiqueta,
  formato,
  origem,
  svg,
}: {
  etiqueta: TotemEtiquetaDoPainel;
  formato: FormatoDeEtiqueta;
  origem: string;
  svg: string | undefined;
}) {
  const f = FORMATOS_DE_ETIQUETA[formato];
  const linha: React.CSSProperties = { fontSize: `${f.linhaPt}pt`, lineHeight: 1.2, margin: 0 };
  return (
    <div
      className="etiqueta-impressa"
      style={{
        width: `${f.larguraMm}mm`,
        height: `${f.alturaMm}mm`,
        padding: '2mm',
        boxSizing: 'border-box',
        overflow: 'hidden',
        background: '#fff',
        color: '#000',
        fontFamily: 'Arial, Helvetica, sans-serif',
        display: 'grid',
        gridTemplateColumns: `minmax(0, 1fr) ${f.qrMm}mm`,
        gridTemplateRows: 'minmax(0, 1fr) auto',
        columnGap: '1.5mm',
        rowGap: '1mm',
      }}
    >
      <div style={{ minWidth: 0, overflow: 'hidden' }}>
        <p
          style={{
            fontSize: `${f.nomePt}pt`,
            fontWeight: 700,
            lineHeight: 1.1,
            margin: 0,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {etiqueta.produtoNome}
        </p>
        <div style={{ borderTop: '0.3mm dashed #000', margin: '1mm 0' }} />
        <p style={linha}>Cód. {etiqueta.produtoCodigo}</p>
        <p style={linha}>Lote {etiqueta.loteCodigo ?? 'no QR'}</p>
        <p style={linha}>Val. {etiqueta.validadeEm ? totemLoteDataBR(etiqueta.validadeEm) : 'no QR'}</p>
      </div>
      <div
        className="qr-da-etiqueta"
        style={{ width: `${f.qrMm}mm`, height: `${f.qrMm}mm` }}
        dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      />
      <p
        style={{
          gridColumn: '1 / -1',
          fontSize: `${f.urlPt}pt`,
          fontFamily: '"Courier New", monospace',
          lineHeight: 1.1,
          margin: 0,
          wordBreak: 'break-all',
        }}
      >
        {urlCurtaDaEtiqueta(origem, etiqueta.codigo)}
      </p>
    </div>
  );
}

function Impressao() {
  const { token, ready } = useAuth();
  const params = useSearchParams();
  const ids = useMemo(() => idsDaUrl(params.get('ids')), [params]);
  const [formato, setFormato] = useState<FormatoDeEtiqueta>('60x40');
  const [origem, setOrigem] = useState('');
  const [etiquetas, setEtiquetas] = useState<TotemEtiquetaDoPainel[] | null>(null);
  const [svgs, setSvgs] = useState<Record<string, string>>({});
  const [folha, setFolha] = useState<HTMLElement | null>(null);
  const [imprimiu, setImprimiu] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    setFormato(formatoGuardado());
    setOrigem(window.location.origin);
    setFolha(document.body);
  }, []);

  useEffect(() => {
    if (!token || ids.length === 0) return;
    apiGet<TotemEtiquetaDoPainel[]>(`/totem-lotes/etiquetas?ids=${ids.join(',')}`, token)
      .then(setEtiquetas)
      .catch((e: unknown) => setErro(mensagemDoErro(e)));
  }, [token, ids]);

  useEffect(() => {
    if (!etiquetas || !origem) return;
    let vivo = true;
    Promise.all(etiquetas.map(async (e) => [e.codigo, await svgDoQr(urlDaEtiqueta(origem, e.codigo))] as const))
      .then((pares) => vivo && setSvgs(Object.fromEntries(pares)))
      .catch(() => vivo && setErro('Não deu para desenhar o QR das etiquetas.'));
    return () => {
      vivo = false;
    };
  }, [etiquetas, origem]);

  function escolherFormato(f: FormatoDeEtiqueta) {
    setFormato(f);
    try {
      window.localStorage.setItem(CHAVE_DO_FORMATO, f);
    } catch {
      // Sem armazenamento, o formato vale só nesta visita.
    }
  }

  function imprimir() {
    setAviso(null);
    window.print();
    setImprimiu(true);
  }

  async function marcarImpressas() {
    if (!etiquetas) return;
    setErro(null);
    try {
      const r = await apiPost<{ atualizadas: number }>(
        '/totem-lotes/etiquetas/impressas',
        { ids: etiquetas.map((e) => e.id) },
        token,
      );
      setAviso(`${r.atualizadas} etiqueta(s) marcada(s) como impressa(s).`);
      setImprimiu(false);
    } catch (e) {
      setErro(mensagemDoErro(e));
    }
  }

  if (!ready) return null;

  const prontas = etiquetas !== null && etiquetas.length > 0 && etiquetas.every((e) => svgs[e.codigo]);
  const lista = etiquetas ?? [];

  return (
    <div className="space-y-6">
      <style>{cssDaImpressao(formato)}</style>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Imprimir etiquetas</h1>
          <p className="text-sm text-muted">
            Uma etiqueta por página, no tamanho do rolo. No diálogo de impressão, escolha a impressora térmica, margem
            nenhuma e escala de 100%.
          </p>
        </div>
        <Link href="/totem-gestao/etiquetas" className="text-sm text-muted underline">
          Voltar para as etiquetas
        </Link>
      </header>

      {erro && <p className="text-sm text-bad">{erro}</p>}
      {aviso && <p className="text-sm text-good">{aviso}</p>}

      {ids.length === 0 ? (
        <p className="text-sm text-muted">
          Nenhuma etiqueta escolhida. Volte para a lista, marque as etiquetas e clique em imprimir.
        </p>
      ) : (
        <>
          <Card titulo="Tamanho do papel">
            <fieldset className="flex flex-wrap items-center gap-4 text-sm">
              <legend className="sr-only">Tamanho do papel</legend>
              {(Object.keys(FORMATOS_DE_ETIQUETA) as FormatoDeEtiqueta[]).map((f) => (
                <label key={f} className="flex items-center gap-2">
                  <input type="radio" name="formato" checked={formato === f} onChange={() => escolherFormato(f)} />
                  {FORMATOS_DE_ETIQUETA[f].rotulo}
                </label>
              ))}
              <Botao tone="brand" disabled={!prontas} onClick={imprimir}>
                Imprimir {lista.length} etiqueta(s)
              </Botao>
            </fieldset>
            {imprimiu && (
              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                <span>As etiquetas saíram certas? Marque como impressas para o painel saber quais já estão na loja.</span>
                <Botao onClick={marcarImpressas}>Marcar como impressas</Botao>
              </div>
            )}
          </Card>

          {etiquetas !== null && etiquetas.length < ids.length && (
            <p className="text-sm text-warn">
              {ids.length - etiquetas.length} etiqueta(s) não aparecem aqui porque foram revogadas ou são de outra loja.
            </p>
          )}

          <div className="flex flex-wrap gap-4">
            {lista.map((e) => (
              <div key={e.id} className="rounded border border-border p-1">
                <Etiqueta etiqueta={e} formato={formato} origem={origem} svg={svgs[e.codigo]} />
              </div>
            ))}
          </div>
        </>
      )}

      {folha &&
        prontas &&
        createPortal(
          <div id={ID_DA_FOLHA}>
            {lista.map((e) => (
              <Etiqueta key={e.id} etiqueta={e} formato={formato} origem={origem} svg={svgs[e.codigo]} />
            ))}
          </div>,
          folha,
        )}
    </div>
  );
}

export default function PaginaDeImpressaoDasEtiquetas() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Carregando as etiquetas…</p>}>
      <Impressao />
    </Suspense>
  );
}
