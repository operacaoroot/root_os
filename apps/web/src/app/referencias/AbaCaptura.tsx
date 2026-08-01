'use client';

import { useState } from 'react';
import { apiPost, apiUpload } from '@/lib/api';
import { Botao, Campo, Card, inputCls } from './ui';

interface Props {
  token: string | null;
  editavel: boolean;
  onErro: (m: string | null) => void;
  onMudou: () => void;
}

type Modo = 'link' | 'texto' | 'print';

// Caixa de entrada: grava cru, sem processar nada. Processar custa Apify e IA —
// por isso é um segundo passo, na aba Fila.
export function AbaCaptura({ token, editavel, onErro, onMudou }: Props) {
  const [modo, setModo] = useState<Modo>('link');
  const [url, setUrl] = useState('');
  const [titulo, setTitulo] = useState('');
  const [nota, setNota] = useState('');
  const [texto, setTexto] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [ok, setOk] = useState<string | null>(null);

  const limpar = () => {
    setUrl('');
    setTitulo('');
    setNota('');
    setTexto('');
    setArquivo(null);
  };

  const salvar = async () => {
    onErro(null);
    setOk(null);
    setSalvando(true);
    try {
      const r = await apiPost<{ id: string; duplicada: boolean }>(
        '/pauta/capturas',
        {
          tipo: modo,
          url: modo === 'link' ? url.trim() : null,
          titulo: titulo.trim() || null,
          nota: nota.trim() || null,
          texto: modo === 'texto' ? texto : null,
        },
        token,
      );

      if (modo === 'print' && arquivo) {
        await apiUpload(`/pauta/capturas/${r.id}/imagem`, arquivo, token);
      }

      setOk(
        r.duplicada
          ? 'Essa referência já estava no acervo — nada foi duplicado.'
          : 'Capturado. Processe na aba Fila quando quiser virar ficha.',
      );
      limpar();
      onMudou();
    } catch (e) {
      onErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  const podeSalvar =
    editavel &&
    !salvando &&
    ((modo === 'link' && url.trim().length > 8) ||
      (modo === 'texto' && texto.trim().length > 20) ||
      (modo === 'print' && !!arquivo));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card titulo="Capturar referência">
        <div className="mb-4 flex gap-2">
          {(['link', 'texto', 'print'] as Modo[]).map((m) => (
            <button
              key={m}
              onClick={() => setModo(m)}
              className={`rounded-lg border px-3 py-1.5 text-sm capitalize ${
                modo === m ? 'border-brand text-brand' : 'border-border text-muted hover:text-text'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {modo === 'link' && (
            <Campo
              label="Link"
              hint="Post do Instagram/TikTok, tweet, artigo, newsletter. Instagram e TikTok precisam do Apify."
            >
              <input
                className={inputCls}
                placeholder="https://www.instagram.com/p/..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={!editavel}
              />
            </Campo>
          )}

          {modo === 'texto' && (
            <Campo label="Texto" hint="Cole a legenda, o roteiro ou o corpo do artigo.">
              <textarea
                className={`${inputCls} min-h-[180px] font-mono text-xs`}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                disabled={!editavel}
              />
            </Campo>
          )}

          {modo === 'print' && (
            <Campo label="Print" hint="PNG, JPG ou WebP, até 8 MB. É o caso dos prints que hoje ficam soltos no Drive.">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
                disabled={!editavel}
                className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-border file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:text-text"
              />
            </Campo>
          )}

          <Campo label="Título (opcional)">
            <input
              className={inputCls}
              placeholder="Como você chamaria isso"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              disabled={!editavel}
            />
          </Campo>

          <Campo label="Nota (opcional)" hint="O que te chamou atenção. A IA usa isso ao montar a ficha.">
            <textarea
              className={`${inputCls} min-h-[70px]`}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              disabled={!editavel}
            />
          </Campo>

          <div className="flex items-center gap-3">
            <Botao tone="brand" onClick={salvar} disabled={!podeSalvar}>
              {salvando ? 'Salvando…' : 'Capturar'}
            </Botao>
            {ok && <span className="text-sm text-good">{ok}</span>}
            {!editavel && <span className="text-sm text-muted">Sem permissão para capturar.</span>}
          </div>
        </div>
      </Card>

      <Card titulo="Como funciona">
        <ol className="space-y-3 text-sm text-muted">
          <li>
            <span className="text-text">1. Captura</span> — grava o item cru. Barato e instantâneo,
            nada é processado ainda.
          </li>
          <li>
            <span className="text-text">2. Fila</span> — você manda processar: o Apify (ou um fetch)
            busca o conteúdo e a IA monta a ficha de 14 campos.
          </li>
          <li>
            <span className="text-text">3. Acervo</span> — você corrige o que a IA errou e marca as
            fichas campeãs.
          </li>
          <li>
            <span className="text-text">4. Radar</span> — perfis vigiados alimentam a fila sozinhos,
            dentro do teto de gasto.
          </li>
        </ol>
        <p className="mt-4 border-t border-border pt-3 text-xs text-muted">
          Link repetido não duplica: a captura deduplica pela URL normalizada (sem UTM, sem
          fragmento).
        </p>
      </Card>
    </div>
  );
}
