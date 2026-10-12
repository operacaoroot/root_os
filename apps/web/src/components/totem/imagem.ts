import { TOTEM_MIDIA_LADO_MAXIMO, TOTEM_MIDIA_MAX_BYTES, TOTEM_MIDIA_PREFIXO_URL } from '@mktos/shared';
import { API_BASE } from '@/lib/api';

/*
 * A imagem do totem antes do envio: o navegador reduz e regrava a foto, porque
 * a do celular chega com 4 mil pixels e 5 MB, e o quiosque baixa o catálogo
 * inteiro na pré-carga. Regravar também tira o EXIF, que leva a localização
 * de onde a foto foi tirada.
 */

/** O tamanho final, sem passar do lado máximo e sem aumentar foto pequena. */
export function ladosReduzidos(
  largura: number,
  altura: number,
  maximo: number = TOTEM_MIDIA_LADO_MAXIMO,
): { largura: number; altura: number } {
  const maior = Math.max(largura, altura);
  if (maior <= maximo) return { largura, altura };
  const fator = maximo / maior;
  return { largura: Math.max(1, Math.round(largura * fator)), altura: Math.max(1, Math.round(altura * fator)) };
}

/**
 * O endereço que a `<img>` do painel usa. A imagem enviada fica guardada com o
 * caminho da API (`/api/totem-publico/midia/...`); quando a API está em outra
 * origem, como no desenvolvimento local, o caminho ganha a origem dela.
 */
export function enderecoDaImagem(url: string): string {
  if (!url.startsWith(TOTEM_MIDIA_PREFIXO_URL)) return url;
  return API_BASE.endsWith('/api') ? `${API_BASE.slice(0, -'/api'.length)}${url}` : url;
}

function carregar(arquivo: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const endereco = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(endereco);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(endereco);
      reject(new Error('Não deu para abrir esta imagem. Envie um arquivo JPG, PNG ou WEBP.'));
    };
    img.src = endereco;
  });
}

function gravar(canvas: HTMLCanvasElement, tipo: string, qualidade: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, tipo, qualidade));
}

/**
 * Reduz e regrava em WEBP. O Safari antigo não grava WEBP e devolve PNG no
 * lugar; aí a imagem sai em JPEG com fundo branco, que é o que a foto de
 * produto pede. Se ainda passar do limite, baixa a qualidade uma vez.
 */
export async function prepararImagem(arquivo: File): Promise<File> {
  const img = await carregar(arquivo);
  const { largura, altura } = ladosReduzidos(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('O navegador não conseguiu preparar a imagem.');

  ctx.drawImage(img, 0, 0, largura, altura);
  let blob = await gravar(canvas, 'image/webp', 0.85);
  if (!blob || blob.type !== 'image/webp') {
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, largura, altura);
    blob = await gravar(canvas, 'image/jpeg', 0.85);
  }
  if (blob && blob.size > TOTEM_MIDIA_MAX_BYTES) blob = await gravar(canvas, blob.type, 0.6);
  if (!blob) throw new Error('O navegador não conseguiu preparar a imagem.');
  if (blob.size > TOTEM_MIDIA_MAX_BYTES) throw new Error('A imagem continua grande demais. Tente uma foto menor.');

  const extensao = blob.type === 'image/webp' ? 'webp' : 'jpg';
  return new File([blob], `imagem.${extensao}`, { type: blob.type });
}
