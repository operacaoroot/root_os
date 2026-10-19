/*
 * A FICHA EM JANELA. Qualquer tela abre a ficha de um cliente por cima de si,
 * sem sair do lugar: o id vai para a URL (`?ficha=<id>`), então o voltar do
 * navegador fecha a janela e o link pode ser mandado a alguém. A janela mora
 * no AppShell (`FichaEmJanela`) e escuta estes eventos.
 */
export const EVENTO_DA_FICHA = 'root-os:ficha';
/** Disparado quando a ficha grava algo: a tela de baixo recarrega os números. */
export const EVENTO_FICHA_MUDOU = 'root-os:ficha-mudou';

export function fichaNaUrl(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('ficha');
}

export function abrirFicha(id: string) {
  const u = new URL(window.location.href);
  u.searchParams.set('ficha', id);
  window.history.pushState({ ficha: id }, '', u);
  window.dispatchEvent(new Event(EVENTO_DA_FICHA));
}

export function fecharFicha() {
  // Aberta por aqui: voltar desfaz o push e devolve a URL de antes, intacta.
  if (window.history.state?.ficha) {
    window.history.back();
    return;
  }
  const u = new URL(window.location.href);
  u.searchParams.delete('ficha');
  window.history.replaceState(null, '', u);
  window.dispatchEvent(new Event(EVENTO_DA_FICHA));
}

export function avisarQueAFichaMudou() {
  window.dispatchEvent(new Event(EVENTO_FICHA_MUDOU));
}
