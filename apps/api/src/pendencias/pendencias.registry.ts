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
 *
 * QUEM PODE RESPONDER (revisão adversarial de 21/10/2026): a rota pede só
 * `dashboard.ver`, que todo perfil de gente tem. Cada tratador DECLARA a
 * permissão que a decisão exige (`{ permissao }`), e o serviço a relê no BANCO
 * antes de tomar a linha: responder ou descartar sem ela é 403, e nada muda.
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

export interface OpcoesDoTratador {
  /** A permissão (de `packages/shared/src/permissions.ts`) que quem responde ou descarta precisa ter, relida no banco. */
  permissao?: string;
}

@Injectable()
export class PendenciasRegistry {
  private readonly tratadores = new Map<string, { fn: TratadorDaPendencia; quem: string; permissao: string | null }>();

  aoResponder(tipo: string, fn: TratadorDaPendencia, quem = 'serviço não identificado', opcoes: OpcoesDoTratador = {}): void {
    const ja = this.tratadores.get(tipo);
    if (ja) throw new Error(`pendência "${tipo}" já tem tratador (${ja.quem}); ${quem} tentou inscrever outro`);
    this.tratadores.set(tipo, { fn, quem, permissao: opcoes.permissao?.trim() || null });
  }

  tratador(tipo: string): TratadorDaPendencia | undefined {
    return this.tratadores.get(tipo)?.fn;
  }

  /** A permissão que o tratador do tipo declarou, ou `null` (tipo sem tratador, ou tratador que não exige). */
  permissaoDe(tipo: string): string | null {
    return this.tratadores.get(tipo)?.permissao ?? null;
  }
}
