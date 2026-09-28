/*
 * BAIXAR E COMPARTILHAR ARQUIVO PELA TELA.
 *
 * Dois cuidados que o celular pede:
 *   1. O Safari do iOS lê o blob DEPOIS do `click()` no link. Revogar a URL na
 *      mesma volta quebra o download (WebKitBlobResource), então ela vive um
 *      tempo e só então é solta.
 *   2. O que baixa no iPhone vai para o app Arquivos, e o Instagram pega mídia
 *      das Fotos. A folha de compartilhar do sistema (`navigator.share` com
 *      arquivos) oferece "Salvar imagens" e o próprio Instagram num toque só.
 */

export const PRAZO_DA_URL_DO_ARQUIVO_MS = 40_000;

export function baixarArquivo(nome: string, blob: Blob, semSuporte = 'Este navegador não deixou baixar o arquivo.') {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') throw new Error(semSuporte);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), PRAZO_DA_URL_DO_ARQUIVO_MS);
}

type NavegadorQueCompartilha = Navigator & {
  canShare?: (dados: { files?: File[] }) => boolean;
  share?: (dados: { files?: File[]; title?: string }) => Promise<void>;
};

/** O navegador sabe abrir a folha de compartilhar com estes arquivos? */
export function compartilhaArquivos(arquivos: File[]): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as NavegadorQueCompartilha;
  return typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: arquivos });
}

export type ResultadoDoCompartilhar = 'compartilhado' | 'cancelado' | 'precisa-de-outro-toque';

/**
 * Abre a folha de compartilhar. Desistir na folha não é erro. O navegador
 * recusa (`NotAllowedError`) quando o toque ficou para trás — buscar os
 * arquivos antes demorou —, e aí a tela pede um segundo toque com os
 * arquivos já prontos.
 */
export async function compartilharArquivos(arquivos: File[], titulo?: string): Promise<ResultadoDoCompartilhar> {
  const nav = navigator as NavegadorQueCompartilha;
  try {
    await nav.share!({ files: arquivos, ...(titulo ? { title: titulo } : {}) });
    return 'compartilhado';
  } catch (e) {
    const nome = (e as { name?: string })?.name;
    if (nome === 'AbortError') return 'cancelado';
    if (nome === 'NotAllowedError') return 'precisa-de-outro-toque';
    throw e;
  }
}
