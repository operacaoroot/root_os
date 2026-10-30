import { Injectable, NotImplementedException } from '@nestjs/common';
import type { CompromissoProposto, DiaLivre, RegrasDaAgenda, ResultadoDaRegua, SocioDaAgenda } from '@mktos/shared';

/*
 * A RÉGUA NO SERVIDOR (agenda v2, 29/10/2026, lane G2).
 *
 * As regras da casa (`AgendaRegraPessoa`, `AgendaRito`, `Feriado`,
 * `AgendaRegraTexto`, semeadas na primeira leitura da empresa da casa) e o
 * MESMO motor puro da tela (`avaliarNaRegua`, `horariosLivres` em
 * `packages/shared/src/agenda-regua.ts`) sobre os eventos do espelho.
 *
 * ESQUELETO DA LANE 0 — o contrato que a escrita (G4) e o link (G6) chamam.
 */
@Injectable()
export class ReguaService {
  async regras(orgId: string, opcoes: { podeEditar?: boolean } = {}): Promise<RegrasDaAgenda> {
    void orgId; void opcoes;
    throw new NotImplementedException('Régua da agenda: lane G2.');
  }

  /** O semáforo de um compromisso, com os eventos do espelho em volta. */
  async avaliar(orgId: string, proposta: CompromissoProposto, agora?: Date): Promise<ResultadoDaRegua> {
    void orgId; void proposta; void agora;
    throw new NotImplementedException('Régua da agenda: lane G2.');
  }

  /** Os horários verdes que o link público mostra. */
  async livres(
    orgId: string,
    pedido: { socio: SocioDaAgenda; tipo: 'cliente' | 'interna'; modalidade: 'online' | 'presencial'; duracaoMin: number; de: string; ate: string },
    agora?: Date,
  ): Promise<DiaLivre[]> {
    void orgId; void pedido; void agora;
    throw new NotImplementedException('Régua da agenda: lane G2.');
  }
}
