import { Injectable, NotImplementedException } from '@nestjs/common';
import type { PedidoDeEscrita, ResultadoDaEscrita } from '@mktos/shared';

/*
 * A ESCRITA NO GOOGLE PELA PORTA (agenda v2, 29/10/2026, lane G4, decisão 2).
 *
 * Todo pedido (marcar, alterar, cancelar, desmarcar, reabrir) passa pela régua
 * (vermelho sem `forcado` não sai) e vai à `PortaDoOperador` com a capacidade do
 * catálogo. `naTela: true` só quando o controlador conferiu no banco que quem
 * pediu é gente (não conta de máquina): é o único caso em que a porta lê a
 * `aprovacaoR2Ligada` da empresa. Agente, rotina, WhatsApp e link público
 * chamam sem `naTela` e R2 continua retido.
 *
 * ESQUELETO DA LANE 0 — o contrato que os Conflitos (G5) e o link (G6) chamam.
 */
export interface QuemPedeAEscrita {
  orgId: string;
  /** `user` na tela; `system` no link público e nas rotinas; `ai` no agente. */
  actorType: 'user' | 'ai' | 'system';
  actorId: string | null;
  agentSlug?: string | null;
  /** Só o controlador da tela, depois de conferir no banco que é gente. */
  naTela?: boolean;
}

@Injectable()
export class EscritaDaAgendaService {
  async executar(quem: QuemPedeAEscrita, pedido: PedidoDeEscrita): Promise<ResultadoDaEscrita> {
    void quem; void pedido;
    throw new NotImplementedException('Escrita da agenda: lane G4.');
  }
}
