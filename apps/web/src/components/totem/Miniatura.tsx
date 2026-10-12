import { enderecoDaImagem } from './imagem';

/** A foto pequena do produto nas listas do painel, ou o aviso de que falta foto. */
export function Miniatura({ url, tamanho = 'h-9 w-9' }: { url: string | null; tamanho?: string }) {
  return (
    <span
      className={`${tamanho} flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-2 text-center text-[10px] leading-tight text-muted`}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- a imagem vem da API, fora do otimizador do Next
        <img src={enderecoDaImagem(url)} alt="" className="h-full w-full object-cover" />
      ) : (
        'sem foto'
      )}
    </span>
  );
}
