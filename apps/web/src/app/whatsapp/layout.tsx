import { ProvedorDoPainel } from '../comercial/_painel/provedor';

/*
 * A área WhatsApp (rodada da interface, 20/10/2026, U1) é a tela que morava em
 * `/comercial/simulador`. Ela abre o painel do lead por cima de si
 * (`?lead=<id>&aba=...`) como as telas do Comercial, então leva o mesmo provedor e a
 * mesma raiz que quebra palavra comprida do layout de `/comercial`.
 */
export default function LayoutDoWhatsapp({ children }: { children: React.ReactNode }) {
  return (
    <div data-comercial-raiz className="min-w-0 [overflow-wrap:anywhere]">
      <ProvedorDoPainel>{children}</ProvedorDoPainel>
    </div>
  );
}
