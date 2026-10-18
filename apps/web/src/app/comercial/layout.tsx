import { ProvedorDoPainel } from './_painel/provedor';

/*
 * O layout de /comercial (lane UX): toda tela daqui pode abrir o painel do
 * lead por cima de si, pela query `?lead=<id>&aba=...`, sem sair de onde está.
 *
 * Lane P6: a raiz quebra palavra comprida em qualquer ponto
 * (`overflow-wrap: anywhere`, que se herda). Nome de empresa de 80
 * caracteres, URL de 200 e mensagem colada sem espaço quebram dentro do
 * quadro em vez de empurrar a tela para o lado; o que é de uma linha só
 * continua com `truncate` e o texto inteiro no `title`.
 */
export default function LayoutDoComercial({ children }: { children: React.ReactNode }) {
  return (
    <div data-comercial-raiz className="min-w-0 [overflow-wrap:anywhere]">
      <ProvedorDoPainel>{children}</ProvedorDoPainel>
    </div>
  );
}
