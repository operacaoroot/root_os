import { AuditService } from '../audit/audit.service';
import { comContexto, novaCorrelacao } from '../common/contexto-execucao';
import { criarPrismaService, type PrismaService } from '../prisma/prisma.service';
import { DemoError, exigir, lerDestino, lerFontes, lerManifesto } from '../demonstracao-v2/demonstracao-v2-manifesto';
import { prepararDemonstracao } from '../demonstracao-v2/demonstracao-v2-transacao';

/** Operação interna explícita. Não inicializa módulos, seeds, timers ou provedores. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const valores: Record<string, string> = {};
  const permitidas = new Set(['modo', 'manifesto', 'destino', 'destino-sha', 'fontes']);
  exigir(args.length > 0 && args.length % 2 === 0, 'demo_argumentos_invalidos');
  for (let i = 0; i < args.length; i += 2) {
    const nome = args[i].slice(2), valor = args[i + 1];
    exigir(args[i].startsWith('--') && permitidas.has(nome) && !Object.hasOwn(valores, nome)
      && valor && !valor.startsWith('--') && valor.length <= 4096, 'demo_argumentos_invalidos');
    valores[nome] = valor;
  }
  const modo = valores.modo;
  exigir(modo === 'aplicar' || modo === 'recuperar' || modo === 'conferir', 'demo_modo_invalido');
  exigir(valores.manifesto && valores.destino && valores['destino-sha'], 'demo_prova_destino_obrigatoria');
  if (modo === 'aplicar') exigir(valores.fontes, 'demo_prova_fonte_obrigatoria');
  // Todos os documentos são bounded/strict e o destino pinado antes de abrir conexão.
  const manifesto = lerManifesto(valores.manifesto);
  const destino = lerDestino(valores.destino, valores['destino-sha']);
  const fontes = valores.fontes ? lerFontes(valores.fontes) : undefined;
  let prisma: PrismaService | undefined;
  try {
    const resultado = await comContexto({ orgId: manifesto.orgId, actorId: manifesto.actorId,
      actorType: 'user', correlationId: novaCorrelacao('demo'), origem: 'script' }, async () => {
      prisma = await criarPrismaService();
      return prepararDemonstracao(prisma, new AuditService(prisma), manifesto, destino, modo, fontes);
    });
    process.stdout.write(JSON.stringify(resultado) + '\n');
  } finally { if (prisma) await prisma.$disconnect(); }
}

void main().catch((error: unknown) => {
  // Erros do banco/arquivos nunca imprimem URL, env, stack ou conteúdo de documentos.
  const code = error instanceof DemoError ? error.code : 'demo_operacao_recusada_ou_inconclusiva';
  process.stderr.write(JSON.stringify({ tipo: 'falha', code }) + '\n');
  process.exitCode = 1;
});
