import { PERFIL_FOTO_LADO, PERFIL_FOTO_MAX_BYTES_DO_ENVIO } from '@mktos/shared';

/*
 * A FOTO REDUZIDA NO NAVEGADOR (produção 22B, I6).
 *
 * O servidor não redimensiona (não há biblioteca de imagem no repositório, e
 * dependência nova é decisão humana): quem reduz é esta tela, num canvas,
 * antes de enviar. O recorte é o quadrado do centro, a saída é JPEG de 256 px.
 * Redesenhar no canvas também tira os metadados do arquivo original (o EXIF de
 * uma foto de celular, com o GPS).
 *
 * O que chega aqui ainda é conferido pelo servidor pelos bytes: esta função é
 * conforto, não trava.
 */

export const TIPOS_ACEITOS_NA_TELA = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** O quadrado do centro de uma imagem `largura × altura`. */
export function recorteQuadrado(largura: number, altura: number): { sx: number; sy: number; lado: number } {
  const lado = Math.min(largura, altura);
  return { sx: Math.floor((largura - lado) / 2), sy: Math.floor((altura - lado) / 2), lado };
}

/** A recusa da tela, antes de abrir o arquivo (o servidor confere de novo). */
export function recusaDoArquivo(arquivo: { type: string; size: number; name: string }): string | null {
  if (arquivo.type === 'image/svg+xml' || /\.svg$/i.test(arquivo.name)) return 'SVG não serve de foto de perfil. Envie JPG, PNG ou WebP.';
  if (!(TIPOS_ACEITOS_NA_TELA as readonly string[]).includes(arquivo.type)) return 'Envie JPG, PNG ou WebP.';
  if (arquivo.size > PERFIL_FOTO_MAX_BYTES_DO_ENVIO) return 'A foto passa de 2 MB.';
  return null;
}

async function abrir(arquivo: Blob): Promise<{ desenhavel: CanvasImageSource; largura: number; altura: number; soltar: () => void }> {
  if (typeof createImageBitmap === 'function') {
    const b = await createImageBitmap(arquivo);
    return { desenhavel: b, largura: b.width, altura: b.height, soltar: () => b.close() };
  }
  const url = URL.createObjectURL(arquivo);
  const img = new Image();
  await new Promise<void>((ok, falha) => {
    img.onload = () => ok();
    img.onerror = () => falha(new Error('Não deu para abrir a imagem.'));
    img.src = url;
  });
  return { desenhavel: img, largura: img.naturalWidth, altura: img.naturalHeight, soltar: () => URL.revokeObjectURL(url) };
}

/** Reduz para um JPEG quadrado de 256 px (o quadrado do centro). */
export async function reduzirFoto(arquivo: File, lado = PERFIL_FOTO_LADO): Promise<File> {
  const recusa = recusaDoArquivo(arquivo);
  if (recusa) throw new Error(recusa);
  const img = await abrir(arquivo);
  try {
    const r = recorteQuadrado(img.largura, img.altura);
    const destino = Math.min(lado, r.lado);
    const canvas = document.createElement('canvas');
    canvas.width = destino;
    canvas.height = destino;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Este navegador não deixa reduzir a imagem.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, destino, destino);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img.desenhavel, r.sx, r.sy, r.lado, r.lado, 0, 0, destino, destino);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.88));
    if (!blob) throw new Error('Não deu para gerar a foto reduzida.');
    return new File([blob], 'foto.jpg', { type: 'image/jpeg' });
  } finally {
    img.soltar();
  }
}
