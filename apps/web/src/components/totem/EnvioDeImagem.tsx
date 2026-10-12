'use client';

import { useRef, useState } from 'react';
import { apiUpload } from '@/lib/api';
import { enderecoDaImagem, prepararImagem } from './imagem';

/*
 * Escolher, trocar e tirar a imagem de um produto ou de uma campanha. A imagem
 * sobe na hora em que é escolhida e o formulário guarda só o endereço; ela só
 * passa a valer quando o formulário é salvo.
 */

export function EnvioDeImagem({
  rotulo,
  dica,
  valor,
  aoMudar,
  destino,
  token,
  formato = 'quadrado',
  desligado,
}: {
  rotulo: string;
  dica?: string;
  valor: string;
  aoMudar: (url: string) => void;
  destino: 'produto' | 'campanha';
  token: string | null;
  /** Quadrado para a foto do produto; largo (16:9) para o banner da campanha. */
  formato?: 'quadrado' | 'largo';
  desligado?: boolean;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo) return;
    setErro(null);
    setEnviando(true);
    try {
      const preparada = await prepararImagem(arquivo);
      const { url } = await apiUpload<{ url: string }>(`/totem-gestao/midia/${destino}`, preparada, token);
      aoMudar(url);
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  const moldura = formato === 'largo' ? 'aspect-video w-full max-w-md' : 'aspect-square w-40';

  return (
    <div className="space-y-2">
      <span className="block text-xs text-muted">{rotulo}</span>
      <div
        className={`${moldura} flex items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-surface-2`}
      >
        {valor ? (
          // eslint-disable-next-line @next/next/no-img-element -- a imagem vem da API, fora do otimizador do Next
          <img src={enderecoDaImagem(valor)} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="px-3 text-center text-xs text-muted">{enviando ? 'Enviando…' : 'Sem imagem'}</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={entrada}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={escolher}
        />
        <button
          type="button"
          disabled={desligado || enviando}
          onClick={() => entrada.current?.click()}
          className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm font-medium hover:border-brand-dim disabled:cursor-not-allowed disabled:opacity-50"
        >
          {enviando ? 'Enviando…' : valor ? 'Trocar imagem' : 'Escolher imagem'}
        </button>
        {valor && !enviando && (
          <button
            type="button"
            disabled={desligado}
            onClick={() => aoMudar('')}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:text-text disabled:opacity-50"
          >
            Tirar imagem
          </button>
        )}
      </div>
      {dica && <span className="block text-[11px] text-muted">{dica}</span>}
      {erro && (
        <span role="alert" className="block text-xs text-bad">
          {erro}
        </span>
      )}
    </div>
  );
}
