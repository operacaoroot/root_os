import { HttpException, HttpStatus } from '@nestjs/common';
import { TOTEM_TETOS_POR_HORA, type TotemTeto } from '@mktos/shared';

/*
 * O LIMITE POR ORIGEM E POR HORA DAS ROTAS PÚBLICAS DO TOTEM.
 *
 * Mesmo desenho do `TetoPorOrigem` de `onboarding/trilho/link-publico.controller.ts`:
 * em memória, por processo, janela fixa de uma hora. A chave é o endereço de
 * origem (`enderecoDeOrigem(req)`) ou, no catálogo e nos eventos, o id do
 * aparelho, porque uma loja inteira pode sair pelo mesmo IP.
 */

const HORA_MS = 3_600_000;
const MAXIMO_DE_CHAVES = 5000;

export class TetoPorOrigem {
  private readonly baldes = new Map<string, { ate: number; n: number }>();

  constructor(readonly tetoPorHora: number) {}

  /** Conta uma tentativa. `false` quando a chave passou do teto nesta hora. */
  registrar(chave: string | null | undefined, agora = Date.now()): boolean {
    const k = chave ?? 'desconhecida';
    const b = this.baldes.get(k);
    if (!b || b.ate <= agora) {
      if (this.baldes.size >= MAXIMO_DE_CHAVES) this.baldes.clear();
      this.baldes.set(k, { ate: agora + HORA_MS, n: 1 });
      return true;
    }
    b.n += 1;
    return b.n <= this.tetoPorHora;
  }
}

/** Um teto novo com o limite que o contrato dá a cada rota pública. */
export function tetoDoTotem(tipo: TotemTeto): TetoPorOrigem {
  return new TetoPorOrigem(TOTEM_TETOS_POR_HORA[tipo]);
}

/** Conta a tentativa e lança 429 quando passou do teto. */
export function conferirTeto(teto: TetoPorOrigem, chave: string | null | undefined): void {
  if (!teto.registrar(chave)) {
    throw new HttpException(
      { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Muitas tentativas. Espere alguns minutos.' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
