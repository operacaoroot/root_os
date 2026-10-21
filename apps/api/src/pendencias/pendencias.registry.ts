import { Injectable } from '@nestjs/common';

/**
 * O QUE ACONTECE QUANDO UMA PESSOA RESPONDE A UMA PENDÊNCIA (rodada dos agentes).
 *
 * Por REGISTRO e não por import, como os efeitos da porta: o módulo das
 * pendências não conhece o arquivista, a agenda nem o comercial, e quem abre a
 * pendência inscreve aqui o tratador do tipo dela. Tratador que escreve fora do
 * OS passa pela porta (`PortaDoOperador`): responder a pendência NUNCA é atalho
 * para pular a régua.
 *
 * Uma inscrição por tipo; inscrever de novo lança (dois tratadores para o mesmo
 * tipo seriam duas verdades sobre o que a resposta faz).
 */
export interface RespostaDaPendencia {
  orgId: string;
  pendenciaId: string;
  tipo: string;
  escolha: string;
  complemento?: string;
  usuarioId: string;
  refTipo: string | null;
  refId: string | null;
  dados: unknown;
}

export type TratadorDaPendencia = (r: RespostaDaPendencia) => Promise<void>;

@Injectable()
export class PendenciasRegistry {
  private readonly tratadores = new Map<string, { fn: TratadorDaPendencia; quem: string }>();

  aoResponder(tipo: string, fn: TratadorDaPendencia, quem = 'serviço não identificado'): void {
    const ja = this.tratadores.get(tipo);
    if (ja) throw new Error(`pendência "${tipo}" já tem tratador (${ja.quem}); ${quem} tentou inscrever outro`);
    this.tratadores.set(tipo, { fn, quem });
  }

  tratador(tipo: string): TratadorDaPendencia | undefined {
    return this.tratadores.get(tipo)?.fn;
  }
}
