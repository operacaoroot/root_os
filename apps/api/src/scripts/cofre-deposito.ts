import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { comContexto, novaCorrelacao } from '../common/contexto-execucao';
import { criarPrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ClienteEscopoService } from '../clientes-escopo/cliente-escopo.service';
import { CofreDepositoService } from '../cofre-da-empresa/deposito.service';

// CLI do operador no servidor; não destranca nem lê itens. A capacidade criada
// permite somente depósito. O link vai para arquivo exclusivo, nunca para logs.
async function main() {
  const [orgId, userId, clienteId, arquivo] = process.argv.slice(2);
  if (!orgId || !userId || !clienteId || !arquivo?.startsWith('/')) throw new Error('Uso: cofre-deposito <orgId> <userId> <clienteId-uuid> <arquivo-absoluto-novo>');
  // Reservar antes da emissão evita criar links sem recibo por arquivo já existente.
  const { openSync, closeSync } = await import('node:fs');
  const fd = openSync(arquivo, 'wx', 0o600);
  const prisma = await criarPrismaService();
  try {
    const audit = new AuditService(prisma);
    const svc = new CofreDepositoService(prisma, audit, new ClienteEscopoService(prisma, audit));
    const r = await comContexto({ orgId, actorId: userId, actorType: 'user', origem: 'script', correlationId: novaCorrelacao('deposito') },
      () => svc.emitir(orgId, userId, clienteId));
    writeFileSync(fd, JSON.stringify(r, null, 2));
    console.log(JSON.stringify({ id: r.id, cliente: r.cliente, expiraEm: r.expiraEm, arquivo }));
  } finally {
    closeSync(fd);
    await prisma.$disconnect();
  }
}
main().catch(() => { console.error('Falha ao emitir o link; confira o arquivo e a auditoria antes de tentar novamente.'); process.exitCode = 1; });
