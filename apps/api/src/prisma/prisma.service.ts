import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import {
  anunciarPapel,
  comTenantNaSessao,
  modoDoTenant,
  urlDaAplicacao,
} from './sessao-de-banco';

/*
 * O cliente do banco da aplicação.
 *
 * A classe continua sendo `PrismaClient` — é ela o TOKEN de injeção e o TIPO que
 * 57 arquivos já declaram em `private readonly prisma: PrismaService`. Nada
 * disso muda: o que muda é quem CONSTRÓI a instância, e o que ela faz antes de
 * cada consulta (ver `sessao-de-banco.ts`).
 *
 * Por que uma fábrica e não o construtor. `$extends` do Prisma devolve um objeto
 * NOVO, não `this` — não há como um construtor de subclasse "virar" o cliente
 * estendido sem o truque de retornar outra coisa de dentro do construtor, que
 * quebra `instanceof` e esconde a troca de quem lê a classe. A fábrica diz em
 * voz alta o que está acontecendo, e é ela que o módulo registra.
 */
@Injectable()
export class PrismaService extends PrismaClient {}

/**
 * Constrói o cliente que a aplicação usa: conecta com o papel restrito quando
 * ele estiver provisionado, declara a empresa em toda transação e anuncia no log
 * o que o isolamento por linha vale nesta conexão.
 */
export async function criarPrismaService(): Promise<PrismaService> {
  const log = new Logger('Prisma');
  const modo = modoDoTenant();
  const url = urlDaAplicacao();

  // O modo `impor` sem papel restrito seria teatro: a consulta passaria a exigir
  // empresa no TypeScript, e o banco continuaria obedecendo ao dono, que ignora
  // policy. Quem liga o modo tem de ter provisionado o papel.
  if (modo === 'impor' && !url) {
    throw new Error(
      'TENANT_MODO=impor sem conexão de aplicação. Provisione o papel restrito ' +
        '(DB_APP_USER/DB_APP_PASSWORD, ou APP_DATABASE_URL) — ver deploy/papel-app.sh.',
    );
  }

  const base = new PrismaService(url ? { datasourceUrl: url } : {});
  await base.$connect();
  await anunciarPapel(base, modo, (m) => log.log(m));

  return comTenantNaSessao(base, { modo, avisar: (m) => log.warn(m) });
}
