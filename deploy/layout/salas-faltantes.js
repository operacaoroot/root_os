// SALAS FALTANTES (leva 5, L6, 27/10/2026): a sala do cliente para todo lead ATIVO que não tem.
// A sala nasce sozinha na chegada do lead (`lead.chegou` -> reação `sala.abrir`), mas o lead importado do
// CRM antigo (`lead.importado`, sem reação), o criado à mão pela proposta ou por script e o anterior a 13/10
// nunca ganharam sala. Este script cria pelo MESMO `SalaService.garantir` da reação (fato `sala.aberta` no fio,
// idempotente pelo `leadId` único: a segunda rodada não cria nada) e grava a auditoria `sala.criada_pelo_script`.
// Lead ATIVO = tem ficha do comercial, a etapa não é saída (desqualificado, geladeira, perdido, parceiro:
// a regra `ehSaida` do shared) e o contrato não foi encerrado (`contrato.concluido`/`contrato.desativado`).
// Lead sem ficha (fora do comercial) é só contado. Nenhum `lead.chegou` é fabricado: M1 e espinha não disparam.
// O "antes" (os leads sem sala e as salas que o script criou) fica em /tmp/salas-faltantes-antes.json.
// `--desfazer` NÃO apaga: REVOGA (`revogadoEm`) só as salas que este script criou e que o cliente nunca abriu;
// "gerar link novo" no painel reabre qualquer uma delas.
// Rode DENTRO do mktos_api:
//   node /tmp/salas-faltantes.js                          -> ensaio (só lê, conta e diz o que faria)
//   node /tmp/salas-faltantes.js --simular                -> o mesmo
//   node /tmp/salas-faltantes.js --valer --como <e-mail>  -> grava (a pessoa é relida no banco, ativa, nesta empresa)
//   node /tmp/salas-faltantes.js --desfazer --como <e-mail> -> revoga as salas que o script criou e ninguém abriu
// Quantos faltam, a qualquer hora: rode em `--simular` (a contagem "faltam" no fim) ou no Postgres:
//   SELECT count(*) FROM "Lead" l JOIN "ComercialFicha" f ON f."leadId" = l.id LEFT JOIN "SalaDoCliente" s ON s."leadId" = l.id
//    WHERE l."orgId" = '63cdd80e-0435-488d-98b5-c2653d235e50' AND s.id IS NULL
//      AND f.etapa NOT IN ('desqualificado','geladeira','perdido','parceiro');
'use strict';
const D = '/app/apps/api/dist/';
require(D + 'scripts/sem-tarefas-de-fundo');
const fs = require('node:fs');
const req = (m) => require(require.resolve(m, { paths: [D] }));
const { NestFactory } = req('@nestjs/core');
const { ehSaida } = req('@mktos/shared');
const { randomUUID } = require('node:crypto');
const { AppModule } = require(D + 'app.module');
const { comContexto } = require(D + 'common/contexto-execucao');
const { PrismaService } = require(D + 'prisma/prisma.service');
const { AuditService } = require(D + 'audit/audit.service');
const { SalaService } = require(D + 'comercial/sala.service');

const VALER = process.argv.includes('--valer');
const DESFAZER = process.argv.includes('--desfazer');
const COMO = (() => { const i = process.argv.indexOf('--como'); return i >= 0 ? String(process.argv[i + 1] ?? '').trim().toLowerCase() : null; })();
const ORG = '63cdd80e-0435-488d-98b5-c2653d235e50';
const ANTES = '/tmp/salas-faltantes-antes.json';
const ORIGEM = 'script.salas-faltantes.20261027';
const ENCERRADO = ['contrato.concluido', 'contrato.desativado'];

const curto = (id) => String(id).slice(0, 8);

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const audit = app.get(AuditService);
  const salas = app.get(SalaService);

  // Quem assina: só em --valer/--desfazer, relida no banco (ativa, desta empresa). O ensaio não precisa de ninguém.
  let pessoa = null;
  if (VALER || DESFAZER) {
    if (!COMO) { console.log('falta --como <e-mail>: quem grava precisa ser uma pessoa ativa desta empresa'); return app.close(); }
    pessoa = await prisma.user.findFirst({ where: { orgId: ORG, email: { equals: COMO, mode: 'insensitive' }, isActive: true }, select: { id: true, name: true, email: true } });
    if (!pessoa) { console.log(`ninguém ativo com o e-mail ${COMO} nesta empresa: nada foi feito`); return app.close(); }
  }
  const ctx = (fn) => comContexto({ orgId: ORG, actorId: pessoa?.id ?? null, actorType: pessoa ? 'user' : 'system', correlationId: randomUUID(), origem: 'script' }, fn);

  if (DESFAZER) {
    if (!fs.existsSync(ANTES)) { console.log(`sem ${ANTES}: nada a desfazer`); return app.close(); }
    const a = JSON.parse(fs.readFileSync(ANTES, 'utf8'));
    const ids = (a.criadas ?? []).map((c) => c.salaId);
    let revogadas = 0, abertasPeloCliente = 0;
    await ctx(async () => {
      for (const salaId of ids) {
        const s = await prisma.salaDoCliente.findFirst({ where: { id: salaId, orgId: ORG }, select: { id: true, leadId: true, acessos: true, revogadoEm: true } });
        if (!s || s.revogadoEm) continue;
        // Sala que o cliente já abriu fica: revogar tiraria dele um endereço que já usa.
        if (s.acessos > 0) { abertasPeloCliente++; continue; }
        await prisma.salaDoCliente.update({ where: { id: s.id }, data: { revogadoEm: new Date() } });
        await audit.log({ orgId: ORG, actorId: pessoa.id, action: 'sala.revogada_pelo_script', entityType: 'sala_do_cliente', entityId: s.id, after: { leadId: s.leadId, origem: `${ORIGEM}.desfazer` } });
        revogadas++;
      }
    });
    console.log(`desfeito: ${revogadas} sala(s) revogada(s); ${abertasPeloCliente} ficaram porque o cliente já abriu. "Gerar link novo" no painel reabre qualquer uma.`);
    return app.close();
  }

  // 1. Os leads da empresa com ficha, a etapa e se já têm sala.
  const leads = await prisma.lead.findMany({
    where: { orgId: ORG },
    select: { id: true, name: true, ficha: { select: { etapa: true } }, sala: { select: { id: true } } },
    orderBy: { enteredAt: 'asc' },
  });
  const encerrados = new Set((await prisma.leadEvent.findMany({ where: { lead: { orgId: ORG }, type: { in: ENCERRADO } }, select: { leadId: true } })).map((e) => e.leadId));

  const contagem = { leads: leads.length, semFicha: 0, saida: 0, encerrado: 0, comSala: 0, faltam: 0 };
  const faltantes = [];
  for (const l of leads) {
    if (!l.ficha) { contagem.semFicha++; continue; }
    if (ehSaida(l.ficha.etapa)) { contagem.saida++; continue; }
    if (encerrados.has(l.id)) { contagem.encerrado++; continue; }
    if (l.sala) { contagem.comSala++; continue; }
    contagem.faltam++;
    faltantes.push({ leadId: l.id, nome: l.name, etapa: l.ficha.etapa });
  }
  console.log('leads da empresa:', contagem.leads, '| sem ficha (fora do comercial):', contagem.semFicha, '| em saída:', contagem.saida, '| contrato encerrado:', contagem.encerrado, '| ativos com sala:', contagem.comSala);
  console.log(`faltam: ${contagem.faltam} sala(s) para lead(s) ativo(s)`);
  for (const f of faltantes) console.log(`  · ${curto(f.leadId)} ${f.nome} (${f.etapa})`);
  if (!VALER) { console.log(faltantes.length ? 'ensaio: nada gravado. Rode com --valer --como <e-mail> para criar.' : 'ensaio: nada a fazer.'); return app.close(); }
  if (!faltantes.length) { console.log('nada a fazer.'); return app.close(); }

  // 2. Grava, pelo mesmo caminho da reação. O "antes" vai sendo escrito a cada sala, para o --desfazer achar o que foi criado.
  const antes = { em: new Date().toISOString(), por: pessoa.email, faltantes, criadas: [] };
  fs.writeFileSync(ANTES, JSON.stringify(antes, null, 2));
  let criadas = 0, jaTinham = 0, erros = 0;
  await ctx(async () => {
    for (const f of faltantes) {
      try {
        const r = await salas.garantir(ORG, f.leadId);
        if (!r.nova) { jaTinham++; continue; }
        await audit.log({ orgId: ORG, actorId: pessoa.id, action: 'sala.criada_pelo_script', entityType: 'sala_do_cliente', entityId: r.salaId, after: { leadId: f.leadId, etapa: f.etapa, origem: ORIGEM, linkReescrevivel: Boolean(r.link) } });
        antes.criadas.push({ salaId: r.salaId, leadId: f.leadId });
        fs.writeFileSync(ANTES, JSON.stringify(antes, null, 2));
        criadas++;
      } catch (e) {
        erros++;
        console.log(`  ! ${curto(f.leadId)} ${f.nome}: ${(e && e.message) || e}`);
      }
    }
  });
  console.log(`gravado: ${criadas} sala(s) criada(s), ${jaTinham} já tinham (corrida), ${erros} erro(s). Antes em ${ANTES}.`);
  if (criadas && !process.env.ENCRYPTION_KEY) console.log('atenção: sem ENCRYPTION_KEY no ambiente o token não foi guardado; o painel vai pedir "gerar link novo" com a chave presente.');
  await app.close();
}

main().then(() => process.exit(0)).catch((err) => { console.error('ERRO', err?.response ?? err); process.exit(1); });
