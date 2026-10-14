/*
 * O texto digitado no painel que nenhum envio levou (lane UX). Fechar pelo
 * Esc, pelo fundo, pelo botão, pelo voltar do navegador ou trocar de aba
 * pergunta antes de perder o que a pessoa escreveu.
 */

export const PERGUNTA_DO_TEXTO_NAO_SALVO = 'Há texto digitado e não salvo no painel. Sair e perder o texto?';

/** Há texto digitado no painel que nenhum envio levou? (campo de texto, de senha ou área de texto com valor). */
export function temTextoNaoSalvo(raiz: ParentNode | null): boolean {
  if (!raiz) return false;
  const campos = raiz.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'textarea, input:not([type]), input[type="text"], input[type="password"], input[type="search"], input[type="email"]',
  );
  return Array.from(campos).some((c) => !c.disabled && !c.hasAttribute('data-painel-ignorar') && c.value.trim().length > 0);
}

/** O painel aberto agora, se houver (o diálogo mora num portal no <body>). */
export function dialogoDoPainel(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('[data-painel-do-lead] [role="dialog"]');
}

/** Pode sair do que está na tela? Sem texto pendente, sim; com texto, quem decide é a pessoa. */
export function podeSairSemPerder(raiz: ParentNode | null = dialogoDoPainel()): boolean {
  return !temTextoNaoSalvo(raiz) || window.confirm(PERGUNTA_DO_TEXTO_NAO_SALVO);
}
