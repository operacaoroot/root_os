import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { loteVigentePorProduto, type ClienteDoLoteVigente, type TotemLoteVigente } from './lote-vigente';

/**
 * A porta de injeção de `loteVigentePorProduto` para os outros módulos do Totem
 * (o catálogo público da frente B importa o `TotemLoteModule` e recebe este
 * serviço). A regra continua na função pura, que os testes chamam sem Nest.
 *
 * Quem já está dentro de uma transação ou de `comTenantPublico` passa o `tx`;
 * sem ele, a consulta usa o client do contexto atual.
 */
@Injectable()
export class LoteVigenteService {
  constructor(private readonly prisma: PrismaService) {}

  porProduto(
    lojaId: string,
    produtoIds?: readonly string[],
    tx: ClienteDoLoteVigente = this.prisma,
  ): Promise<Map<string, TotemLoteVigente>> {
    return loteVigentePorProduto(tx, lojaId, produtoIds);
  }
}
