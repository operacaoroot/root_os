// Dados do comercial combinados com o Lucas em 26/10/2026 (catálogo P-57):
//   · Sr. aGranel: contato "Felipe", empresa "Sr. aGranel", valor negociado R$ 56.000 (segue em Contrato);
//   · Juma: lead em E7 · Follow-up (dono Pedro) com a tarefa "Proposta Juma — fazer FUP" ligada;
//   · Dispropan: o produto já fechado (2x Imersão, R$ 4.997, repasse) vira lead próprio em "Negócio fechado"
//     (como o Custeio); o produto novo segue no FUP; os dois ligados ao cadastro Dispropan;
//   · Cultural e Clube de Permuta = o mesmo cliente (Juliano Rodrigues): um cadastro "Cultural & Clube de Permuta";
//     a permuta da sala (lead "Cultural") vai para "Negócio fechado" como permuta, R$ 12.000; o Clube segue no funil;
//     a tarefa "Manutenção wpp | Cultural & Clube" ganha esse cliente.
// Tudo pelos serviços do OS (fatos no fio, sem disparar proposta, cobrança nem mensagem). Rode DENTRO do mktos_api:
//   node /tmp/dados-comerciais-26-10.js            -> ensaio (só lê e diz o que faria)
//   node /tmp/dados-comerciais-26-10.js --valer    -> grava
'use strict';
const D = '/app/apps/api/dist/';
require(D + 'scripts/sem-tarefas-de-fundo');
const req = (m) => require(require.resolve(m, { paths: [D] }));
const { NestFactory } = req('@nestjs/core');
const { randomUUID } = require('node:crypto');
const { AppModule } = require(D + 'app.module');
const { comContexto } = require(D + 'common/contexto-execucao');
const { PrismaService } = require(D + 'prisma/prisma.service');
const { AuditService } = require(D + 'audit/audit.service');
const { LeadsService } = require(D + 'leads/leads.service');
const { FichaService } = require(D + 'comercial/ficha.service');
const { FioService } = require(D + 'comercial/fio.service');
const { TarefasDoComercialService } = require(D + 'comercial/tarefas/tarefas-do-comercial.service');
const { WorkService } = require(D + 'work/work.service');

const VALER = process.argv.includes('--valer');
const ORG = '63cdd80e-0435-488d-98b5-c2653d235e50';
const LUCAS = { id: 'fbb3983f-bd69-43d8-b284-5316cf25534a', nome: 'Lucas Fernandes' };
const PEDRO = 'ada0c91e-b82a-4beb-aa1c-0790c31a8a26';
const REF = 'lucas-2026-10-26:dados-comerciais';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const audit = app.get(AuditService);
  const leads = app.get(LeadsService);
  const fichas = app.get(FichaService);
  const fio = app.get(FioService);
  const tarefas = app.get(TarefasDoComercialService);
  const trabalho = app.get(WorkService);
  const ctx = (fn) => comContexto({ orgId: ORG, actorId: LUCAS.id, actorType: 'user', correlationId: randomUUID(), origem: 'script' }, fn);
  if (typeof fichas.editarIdentidade !== 'function' || typeof fichas.ajustarNegocio !== 'function') throw new Error('a imagem no ar ainda não tem a edição de identidade/negócio: publique a leva antes');

  const acharLead = async (texto) => prisma.lead.findMany({
    where: { orgId: ORG, OR: [{ name: { contains: texto, mode: 'insensitive' } }, { ficha: { empresa: { contains: texto, mode: 'insensitive' } } }] },
    select: { id: true, name: true, ownerId: true, ficha: { select: { etapa: true, empresa: true, donoId: true, partnerId: true, produto: true, valorCentavos: true, tipoNegocio: true } } },
  });
  const acharTarefa = async (titulo) => prisma.workTask.findFirst({ where: { orgId: ORG, title: { contains: titulo, mode: 'insensitive' }, excluidaEm: null }, select: { id: true, title: true, leadId: true, clienteId: true, updatedAt: true } });
  const ligarAoCadastro = async (leadId, partnerId) => {
    const f = await prisma.comercialFicha.findFirst({ where: { leadId }, select: { partnerId: true } });
    if (f?.partnerId === partnerId) return;
    await prisma.comercialFicha.update({ where: { leadId }, data: { partnerId } });
    await audit.log({ orgId: ORG, actorId: LUCAS.id, action: 'comercial.ficha.cliente', entityType: 'lead', entityId: leadId, before: { partnerId: f?.partnerId ?? null }, after: { partnerId, origem: REF } });
  };
  const criarLead = async (ref, nome, dono) => {
    const e = await leads.entrada({ sub: LUCAS.id, orgId: ORG, permissions: ['leads.editar'] }, { origem: { tipo: 'manual', ref }, nome, ownerId: dono });
    await fichas.garantir(ORG, e.id);
    const d = { donoId: dono };
    const ev = await fio.registrar(ORG, e.id, 'dono.atribuido', ref, d, { semReacoes: true });
    await fichas.aplicar({ eventoId: ev.eventoId, orgId: ORG, leadId: e.id, type: 'dono.atribuido', payload: d, em: new Date() });
    return e.id;
  };
  const fechar = async (leadId, campos) => {
    await prisma.comercialFicha.update({ where: { leadId }, data: campos });
    await audit.log({ orgId: ORG, actorId: LUCAS.id, action: 'comercial.ficha.preenchida', entityType: 'lead', entityId: leadId, after: { ...campos, origem: REF } });
    const r = await fichas.moverAMao(ORG, leadId, { para: 'fechado' }, LUCAS);
    console.log('    mover -> fechado', r.ok ? 'ok' : 'FALHOU ' + JSON.stringify(r.faltando));
  };

  // ---------- 1. Sr. aGranel
  const granel = (await acharLead('aGranel')).filter((l) => l.ficha && !['fechado'].includes(l.ficha.etapa));
  console.log('\n== Sr. aGranel:', JSON.stringify(granel.map((l) => ({ id: l.id, nome: l.name, ...l.ficha }))));
  if (VALER && granel.length === 1) await ctx(async () => {
    await fichas.editarIdentidade(ORG, granel[0].id, { nome: 'Felipe', empresa: 'Sr. aGranel' }, LUCAS);
    await fichas.ajustarNegocio(ORG, granel[0].id, { valorNegociado: 56000 }, LUCAS);
    console.log('  contato Felipe, empresa Sr. aGranel, valor negociado R$ 56.000');
  });

  // ---------- 2. Juma
  const juma = await acharLead('Juma');
  const tJuma = await acharTarefa('Proposta Juma');
  console.log('\n== Juma: leads', JSON.stringify(juma.map((l) => ({ id: l.id, nome: l.name, etapa: l.ficha?.etapa }))), '| tarefa', JSON.stringify(tJuma));
  if (VALER) await ctx(async () => {
    const id = juma[0]?.id ?? await criarLead(`${REF}:juma`, 'Juma', PEDRO);
    if (!juma[0]) console.log('  lead criado', id);
    const f = await prisma.comercialFicha.findFirst({ where: { leadId: id }, select: { etapa: true } });
    if (f && f.etapa !== 'follow_up') { const r = await fichas.moverAMao(ORG, id, { para: 'follow_up' }, LUCAS); console.log('  mover -> follow_up', r.ok ? 'ok' : 'FALHOU ' + JSON.stringify(r.faltando)); }
    if (tJuma && tJuma.leadId !== id) { await tarefas.editar(ORG, LUCAS.id, tJuma.id, { expectedUpdatedAt: tJuma.updatedAt.toISOString(), leadId: id }); console.log('  tarefa ligada ao lead'); }
  });

  // ---------- 3. Dispropan (dois produtos)
  const disp = await acharLead('Dispropan');
  const pDisp = await prisma.partner.findFirst({ where: { orgId: ORG, razaoSocial: 'Dispropan' }, select: { id: true } });
  console.log('\n== Dispropan: leads', JSON.stringify(disp.map((l) => ({ id: l.id, nome: l.name, ...l.ficha }))), '| cadastro', pDisp?.id);
  if (VALER) await ctx(async () => {
    let fechado = disp.find((l) => /imers/i.test(l.name));
    if (!fechado) {
      const dono = disp[0]?.ficha?.donoId ?? disp[0]?.ownerId ?? PEDRO;
      const id = await criarLead(`${REF}:dispropan-imersao`, 'Dispropan (2x Imersão)', dono);
      console.log('  lead do produto fechado criado', id);
      await fichas.definirTipoDoNegocio(ORG, id, { tipo: 'repasse' }, LUCAS);
      await fechar(id, { produto: 'imersao', valorCentavos: 499700, forma: '2x Imersão ROOT, R$ 4.997 (fechada em junho/2026; repasse)' });
      fechado = { id };
    }
    if (pDisp) for (const l of [...disp, fechado]) await ligarAoCadastro(l.id, pDisp.id);
    console.log('  os dois ligados ao cadastro Dispropan');
  });

  // ---------- 4. Cultural & Clube de Permuta (mesmo cliente)
  const cult = (await acharLead('Cultural')).filter((l) => /juliano/i.test(l.name));
  const clube = (await acharLead('Clube de Permuta')).filter((l) => /juliano/i.test(l.name) || /clube/i.test(l.ficha?.empresa ?? ''));
  const pCult = await prisma.partner.findFirst({ where: { orgId: ORG, razaoSocial: { startsWith: 'Cultural' } }, select: { id: true, razaoSocial: true, isCliente: true } });
  const tWpp = await acharTarefa('Manutenção wpp');
  console.log('\n== Cultural:', JSON.stringify(cult.map((l) => ({ id: l.id, nome: l.name, ...l.ficha }))), '\n== Clube:', JSON.stringify(clube.map((l) => ({ id: l.id, nome: l.name, ...l.ficha }))), '\n== cadastro', JSON.stringify(pCult), '| tarefa', JSON.stringify(tWpp));
  if (VALER && pCult) await ctx(async () => {
    if (pCult.razaoSocial !== 'Cultural & Clube de Permuta' || !pCult.isCliente) {
      await prisma.partner.update({ where: { id: pCult.id }, data: { razaoSocial: 'Cultural & Clube de Permuta', isCliente: true } });
      await audit.log({ orgId: ORG, actorId: LUCAS.id, action: 'finance.partner.rename', entityType: 'partner', entityId: pCult.id, before: { razaoSocial: pCult.razaoSocial, isCliente: pCult.isCliente }, after: { razaoSocial: 'Cultural & Clube de Permuta', isCliente: true, origem: REF } });
      console.log('  cadastro: Cultural & Clube de Permuta');
    }
    if (cult.length === 1 && cult[0].ficha?.etapa !== 'fechado') {
      await fichas.editarIdentidade(ORG, cult[0].id, { nome: 'Juliano Rodrigues', empresa: 'Cultural (permuta da sala)' }, LUCAS);
      await fichas.definirTipoDoNegocio(ORG, cult[0].id, { tipo: 'permuta' }, LUCAS);
      await fechar(cult[0].id, { produto: 'operacao', valorCentavos: 1200000, forma: 'Operação ROOT em permuta pela sala, R$ 12.000' });
    }
    if (clube.length === 1) await fichas.editarIdentidade(ORG, clube[0].id, { nome: 'Juliano Rodrigues', empresa: 'Clube de Permuta' }, LUCAS);
    for (const l of [...cult, ...clube]) await ligarAoCadastro(l.id, pCult.id);
    if (tWpp && tWpp.clienteId !== pCult.id) { await trabalho.editarTarefa(ORG, LUCAS.id, tWpp.id, { expectedUpdatedAt: tWpp.updatedAt.toISOString(), clienteId: pCult.id }); console.log('  tarefa Manutenção wpp com o cliente'); }
  });

  await app.close();
}

main().then(() => process.exit(0)).catch((err) => { console.error('ERRO', err?.response ?? err); process.exit(1); });
