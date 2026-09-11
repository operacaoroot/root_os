import { Global, Module } from '@nestjs/common';

import { PrismaService, criarPrismaService } from './prisma.service';

/*
 * O cliente do banco é registrado por FÁBRICA, não por classe.
 *
 * `criarPrismaService()` conecta com o papel restrito da aplicação (quando
 * provisionado) e devolve o cliente que declara a empresa em toda transação. O
 * token continua sendo `PrismaService`: quem injeta não muda uma linha, e
 * `app.get(PrismaService)` (usado pelos scripts de linha de comando) continua
 * devolvendo o mesmo objeto.
 *
 * A fábrica é assíncrona porque abre a conexão aqui — é o que o antigo
 * `onModuleInit` fazia. Falha de conexão continua derrubando o boot, que é o
 * comportamento desejado: subir sem banco só adia o erro.
 */
@Global()
@Module({
  providers: [{ provide: PrismaService, useFactory: criarPrismaService }],
  exports: [PrismaService],
})
export class PrismaModule {}
