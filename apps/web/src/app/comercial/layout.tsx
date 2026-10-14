import { ProvedorDoPainel } from './_painel/provedor';

/*
 * O layout de /comercial (lane UX): toda tela daqui pode abrir o painel do
 * lead por cima de si, pela query `?lead=<id>&aba=...`, sem sair de onde está.
 */
export default function LayoutDoComercial({ children }: { children: React.ReactNode }) {
  return <ProvedorDoPainel>{children}</ProvedorDoPainel>;
}
