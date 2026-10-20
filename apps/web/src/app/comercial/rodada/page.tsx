import Operacao from '../../operacao/page';

/*
 * A RODADA DA SEMANA no Comercial (rodada da interface, 20/10/2026, U1, item 10 da ata).
 *
 * É a mesma tela de `/operacao` (a rodada semanal do painel do Pedro), com a mesma
 * trava: só a sessão da plataforma (a ROOT) a vê. A tela pergunta a
 * `/tenants/plataforma/quem-sou` e, para qualquer outra sessão, mostra o mesmo aviso
 * que `/operacao` mostra; a API do painel recusa com 403 de qualquer jeito. No menu, o
 * item só aparece para a plataforma (`ITENS_DA_ROOT`, em `navegacao-modulos.ts`).
 * `/operacao` segue viva.
 */
export default function RodadaDaSemanaPage() {
  return <Operacao />;
}
