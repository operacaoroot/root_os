/*
 * SEMENTE DO E2E DA PRODUÇÃO 22, DENTRO DO CONTAINER DA API DA STACK DO SEED (3031).
 *
 * Um cliente importado do CRM antigo, FICTÍCIO, com um contrato vivo sem PDF e sem
 * parcela, como o importador deixa: lead + ficha fechada + `cliente.ativo` (importado) +
 * `contrato.importado`, gravados pelo MESMO `FioService` do build (sem reação).
 * Idempotente pelo nome (um nome novo por passada, salvo `SEMENTE_SUFIXO`). Imprime só o id do lead. Recusa empresa que não seja `root`
 * e `NODE_ENV=production`.
 *
 * Uso (Git Bash):
 *   MSYS_NO_PATHCONV=1 docker exec -i -e PERMITIR_SEMENTE_E2E=1 -w /app/apps/api rootos_final_seed_api node - < homolog/e2e/producao22-semente.cjs
 *   (a stack roda com NODE_ENV=production; a trava de nome `root` e a variável explícita seguram o resto)
 */
const { PrismaClient } = require('@prisma/client');
const { FioService, ReacoesRegistry } = require('/app/apps/api/dist/comercial/fio.service');

// Um por passada (a régua ligada no e2e trava as parcelas do anterior); `SEMENTE_SUFIXO` repete um.
const SUFIXO = process.env.SEMENTE_SUFIXO || Date.now().toString(36);
const NOME = `Cliente Importado Exemplo e2e 22 ${SUFIXO}`;
const ORIGEM = `cartao:e2e-producao22-${SUFIXO}`;

(async () => {
  if (process.env.NODE_ENV === 'production' && process.env.PERMITIR_SEMENTE_E2E !== '1') throw new Error('semente de e2e não roda em produção');
  const prisma = new PrismaClient();
  try {
    const org = await prisma.org.findFirst({ where: { slug: 'root' }, select: { id: true } });
    if (!org) throw new Error('empresa root não existe nesta stack');
    let lead = await prisma.lead.findFirst({ where: { orgId: org.id, name: NOME }, select: { id: true } });
    if (!lead) {
      lead = await prisma.lead.create({ data: { orgId: org.id, name: NOME, status: 'ganho' }, select: { id: true } });
      await prisma.comercialFicha.create({ data: { leadId: lead.id, etapa: 'fechado', empresa: NOME } });
      const fio = new FioService(prisma, new ReacoesRegistry());
      await fio.registrar(org.id, lead.id, 'cliente.ativo', `importacao.crm:${ORIGEM}-${lead.id}`, { chave: 'k', importado: true, origem: ORIGEM }, { semReacoes: true });
      await fio.registrar(org.id, lead.id, 'contrato.importado', ORIGEM, {
        origem: ORIGEM, cartaoDoCliente: ORIGEM, titulo: 'Assessoria mensal (exemplo)', produto: null, produtoRotulo: 'Assessoria', valorCentavos: 300_000,
        fechadoEm: '2025-11-03', semDocumento: true, parcelas: '[a decidir]', por: 'Importador', porId: null, marca: 'importacao.crm',
      }, { semReacoes: true, em: new Date('2025-11-03T12:00:00-03:00') });
    }
    process.stdout.write(`${lead.id}\n`);
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => {
  console.error(`semente: ${e.message}`);
  process.exit(1);
});
