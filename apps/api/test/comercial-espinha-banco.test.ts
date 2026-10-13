/**
 * A ESPINHA DO COCKPIT CONTRA O BANCO (lane A, 13/10/2026).
 *
 * Os serviços de verdade, montados à mão (nada de Nest sob vitest), num banco
 * descartável. O que se prova:
 *   · o lead entra pelo WhatsApp e a reação da espinha cria a ficha, pontua,
 *     dá dono pela regra e semeia a rotina do relógio;
 *   · o mesmo fato repetido NÃO duplica evento nem reação;
 *   · o formulário move a E2 e `Lead.status` segue o mapa;
 *   · a reação NÃO força a etapa contra o portão: grava o que falta e o lead
 *     anda sozinho quando o fato que faltava chega depois;
 *   · decisão vencida aplica o padrão escrito e grava `decisao.expirada`;
 *   · quem propôs não decide; a segunda resposta é 409;
 *   · a saída passa por `podeSair`; a config nasce com os padrões vigentes;
 *   · o relógio abre o lead parado uma vez por período.
 */
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConfigComercialService } from '../src/comercial/config.service';
import { DecisoesRegistry, DecisoesService, SEM_PRAZO } from '../src/comercial/decisoes.service';
import { leadIdDoTelefone } from '../src/comercial/eventos';
import { FichaService } from '../src/comercial/ficha.service';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { REGRA_DO_DONO, ReacoesDaEspinha } from '../src/comercial/reacoes-da-espinha';
import { RelogioDaEspinha, SLUG_DA_ROTINA_COMERCIAL, TIPO_DA_ROTINA_COMERCIAL } from '../src/comercial/relogio-da-espinha';
import { RelogioComercialRegistry } from '../src/comercial/relogio.registry';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ExecutoresDeRotinaRegistry } from '../src/routines/executores.registry';
import { exigirBancoDescartavel } from './banco-de-teste';

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (leads, eventos, fichas, decisões e rotinas do comercial)');

const MARCA = `ea${Date.now().toString(36).slice(-6)}`;
const SUFIXO = Date.now().toString().slice(-8);
const TEL_A = `+55329${SUFIXO}`;
const TEL_B = `+55319${SUFIXO}`;
const DIA = 86_400_000;

describe.skipIf(!URL)('a espinha do cockpit, contra o banco', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
  const p = prisma as unknown as PrismaService;
  let ORG = '';
  let admin = { id: '', name: '' };
  let outro = { id: '', name: '' };
  let fio: FioService;
  let fichas: FichaService;
  let decisoes: DecisoesService;
  let config: ConfigComercialService;
  let relogio: RelogioDaEspinha;
  let rotinas: ExecutoresDeRotinaRegistry;
  let leadA = '';
  let leadB = '';

  const etapa = async (leadId: string) => (await prisma.comercialFicha.findFirst({ where: { leadId } }))?.etapa;
  const status = async (leadId: string) => (await prisma.lead.findFirst({ where: { id: leadId } }))?.status;
  const contar = (leadId: string, type?: string) => prisma.leadEvent.count({ where: { leadId, ...(type ? { type } : {}) } });

  beforeAll(async () => {
    const org = await prisma.org.create({ data: { name: `Espinha ${MARCA}`, slug: `espinha-${MARCA}` } });
    ORG = org.id;
    const papel = await prisma.role.create({ data: { orgId: ORG, key: 'admin_master', name: 'Admin Master' } });
    admin = await prisma.user.create({ data: { orgId: ORG, name: 'Sócia da conta', email: `socia.${MARCA}@root.local`, passwordHash: 'x', roles: { connect: { id: papel.id } } }, select: { id: true, name: true } });
    outro = await prisma.user.create({ data: { orgId: ORG, name: 'Analista', email: `analista.${MARCA}@root.local`, passwordHash: 'x' }, select: { id: true, name: true } });

    const reacoes = new ReacoesRegistry();
    fio = new FioService(p, reacoes);
    config = new ConfigComercialService(p);
    const aoDecidir = new DecisoesRegistry();
    decisoes = new DecisoesService(p, fio, config, aoDecidir);
    fichas = new FichaService(p, fio, config);
    rotinas = new ExecutoresDeRotinaRegistry();
    relogio = new RelogioDaEspinha(p, rotinas, new RelogioComercialRegistry(), decisoes, fio, config);
    relogio.inscrever();
    new ReacoesDaEspinha(p, fio, reacoes, fichas, decisoes, aoDecidir, relogio).inscrever();
  });

  afterAll(async () => {
    if (ORG) {
      const leads = (await prisma.lead.findMany({ where: { orgId: ORG }, select: { id: true } })).map((l) => l.id);
      await prisma.comercialReacao.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.comercialDecisao.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.comercialFicha.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.leadEvent.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.lead.deleteMany({ where: { orgId: ORG } });
      await prisma.rotina.deleteMany({ where: { orgId: ORG } });
      await prisma.comercialConfig.deleteMany({ where: { orgId: ORG } });
      await prisma.user.deleteMany({ where: { orgId: ORG } });
      await prisma.role.deleteMany({ where: { orgId: ORG } });
      await prisma.org.deleteMany({ where: { id: ORG } });
    }
    await prisma.$disconnect();
  });

  it('a config sem linha devolve os padrões da regra vigente; gravar valida e escreve só o que veio', async () => {
    const c = await config.ler(ORG);
    expect(c).toMatchObject({ gravada: false, envioAutomatico: false, fechamentoAutomatico: false, silencioAprova: false, leadParadoDias: null, decisaoExpiraHoras: null });
    await expect(config.gravar(ORG, { leadParadoDias: 0 })).rejects.toThrow(/inválida/);
    await expect(config.gravar(ORG, { inventado: true })).rejects.toThrow(/inválida/);
    const g = await config.gravar(ORG, { valoresDeHomologacao: true, autonomia: { vigia: 'A3' } });
    expect(g).toMatchObject({ gravada: true, valoresDeHomologacao: true, envioAutomatico: false, leadParadoDias: null, autonomia: { vigia: 'A3' } });
  });

  it('o lead entra: ficha em E1, pontuação inicial pelo canal, dono pela regra e a rotina semeada', async () => {
    const r = await fichas.entrarPeloWhats(ORG, { telefone: TEL_A, texto: 'Vi o vídeo do fechamento. Funciona com Omie?', canal: 'conteudo', mensagemId: `m1-${MARCA}` });
    leadA = r.leadId;
    expect(leadA).toBe(leadIdDoTelefone(ORG, TEL_A));
    expect(r.leadNovo).toBe(true);
    const ficha = await prisma.comercialFicha.findFirst({ where: { leadId: leadA } });
    expect(ficha).toMatchObject({ etapa: 'novo_lead', canal: 'conteudo', perfil: 'P1', donoId: admin.id });
    expect(ficha?.pontuacao).toBeGreaterThan(0);
    const dono = await prisma.leadEvent.findFirst({ where: { leadId: leadA, type: 'dono.atribuido' } });
    expect((dono?.payload as { regra?: string }).regra).toBe(REGRA_DO_DONO);
    const lead = await prisma.lead.findFirst({ where: { id: leadA } });
    expect(lead?.ownerId).toBe(admin.id);
    expect(lead?.name).toMatch(/^Lead \d{4}$/);
    const rotina = await prisma.rotina.findFirst({ where: { orgId: ORG, slug: SLUG_DA_ROTINA_COMERCIAL } });
    expect(rotina).toMatchObject({ tipo: TIPO_DA_ROTINA_COMERCIAL, cron: '* * * * *', estado: 'rodando' });
    expect(rotinas.tem(TIPO_DA_ROTINA_COMERCIAL)).toBe(true);
  });

  it('o mesmo fato repetido não duplica evento nem reação', async () => {
    const eventos = await contar(leadA);
    const reacoes = await prisma.comercialReacao.count({ where: { leadId: leadA } });
    const r = await fichas.entrarPeloWhats(ORG, { telefone: TEL_A, texto: 'Vi o vídeo do fechamento. Funciona com Omie?', canal: 'conteudo', mensagemId: `m1-${MARCA}` });
    expect(r.leadNovo).toBe(false);
    const de_novo = await fio.registrar(ORG, leadA, 'lead.chegou', 'whatsapp', { telefone: TEL_A, texto: 'x' });
    expect(de_novo.novo).toBe(false);
    expect(await contar(leadA)).toBe(eventos);
    expect(await prisma.comercialReacao.count({ where: { leadId: leadA } })).toBe(reacoes);
    expect(await contar(leadA, 'lead.chegou')).toBe(1);
  });

  it('o formulário move para E2, e Lead.status e Lead.score seguem', async () => {
    const form = { sistema: 'Omie', baseOrganizada: true, maiorDor: 'fechamento leva 9 dias', equipeFinanceiro: 3, nome: 'Marina Duarte', empresa: 'Construtora Alicerce' };
    const r1 = await fio.registrar(ORG, leadA, 'form.respondido', 'form-1', form);
    expect(r1.novo).toBe(true);
    expect(await etapa(leadA)).toBe('qualificacao');
    expect(await status(leadA)).toBe('qualificado');
    const lead = await prisma.lead.findFirst({ where: { id: leadA } });
    expect(lead?.name).toBe('Marina Duarte');
    expect(lead?.score).toBeGreaterThan(50);
    const ficha = await prisma.comercialFicha.findFirst({ where: { leadId: leadA } });
    expect(ficha).toMatchObject({ sistemaErp: 'Omie', baseDados: true, produto: 'operacao', empresa: 'Construtora Alicerce' });
    // Repetido: mesmo id, nenhuma mudança de etapa nova.
    const mudancas = await contar(leadA, 'etapa.mudou');
    expect((await fio.registrar(ORG, leadA, 'form.respondido', 'form-1', form)).novo).toBe(false);
    expect(await contar(leadA, 'etapa.mudou')).toBe(mudancas);
    // Base organizada não abre ponto zero.
    expect(await prisma.comercialDecisao.count({ where: { leadId: leadA, tipo: 'ponto_zero' } })).toBe(0);
  });

  it('a reação não força a etapa: a ata sem confirmação de véspera fica em E3, e o lead anda quando a confirmação chega', async () => {
    await fio.registrar(ORG, leadA, 'agenda.escolhida', 'h1', { horario: '2026-10-16T13:00:00.000Z', oferecidos: ['2026-10-16T13:00:00.000Z', '2026-10-17T18:00:00.000Z'] });
    expect(await etapa(leadA)).toBe('reuniao_agendada');
    expect(await status(leadA)).toBe('reuniao');

    const ata = await fio.registrar(ORG, leadA, 'ata.chegou', 'ata-1', { hash: 'f'.repeat(64), caracteres: 4200, fonte: 'texto', por: admin.name });
    expect(await etapa(leadA)).toBe('reuniao_agendada');
    const reacao = await prisma.comercialReacao.findFirst({ where: { eventoId: ata.eventoId, reacao: 'espinha.projetar' } });
    expect(reacao?.estado).toBe('ok');
    expect((reacao?.resultado as { faltando?: string[] }).faltando).toEqual(['confirmação de véspera enviada']);

    await fio.registrar(ORG, leadA, 'agenda.confirmada', 'vespera', { horario: '2026-10-16T13:00:00.000Z', via: 'simulado' });
    expect(await etapa(leadA)).toBe('sessao');

    // E4 pede a rota: o diagnóstico pronto a define, e o lead vai a E5.
    await fio.registrar(ORG, leadA, 'diagnostico.pronto', 'v1', { dores: [{ n: 1, texto: 'fechamento em 9 dias', minuto: '00:12:40' }], objecoes: [], produtoSugerido: 'operacao', modelo: 'stub', custoUsd: 0, custoDesconhecido: true });
    expect(await etapa(leadA)).toBe('diagnostico');
    expect(await status(leadA)).toBe('oportunidade');
  });

  it('o portão de E5 segura a proposta até o diagnóstico ser aprovado, e o fato tardio destrava', async () => {
    const proposta = { versao: 1, produto: 'operacao', valorCentavos: 1_199_700, parcelas: 3, parcelaCentavos: 399_900, formas: ['pix', 'boleto', 'cartao'], validaAte: '2026-10-30T00:00:00.000Z', dentroDaTabela: true, laudo: { ok: true, apontamentos: [] }, hash: 'a'.repeat(64), quadroDeCustos: { mesNormalCentavos: 18_000, piorMesCentavos: 35_000 } };
    await fio.registrar(ORG, leadA, 'proposta.publicada', 'v1', proposta);
    expect(await etapa(leadA)).toBe('diagnostico');
    await fio.registrar(ORG, leadA, 'proposta.lida', 'v1:ouvimos', { versao: 1, bloco: 'ouvimos', visita: 1 });
    expect(await etapa(leadA)).toBe('diagnostico');

    // O sócio aprova o diagnóstico: o mesmo fato com outra chave. O lead anda E5 → E6 → E7.
    await fio.registrar(ORG, leadA, 'diagnostico.pronto', 'v1:aprovado', { dores: [{ n: 1, texto: 'fechamento em 9 dias', minuto: '00:12:40' }], objecoes: [], produtoSugerido: 'operacao', modelo: 'stub', custoUsd: 0, custoDesconhecido: true, aprovadoEm: new Date().toISOString(), aprovadoPor: admin.name });
    expect(await etapa(leadA)).toBe('follow_up');
    expect(await status(leadA)).toBe('proposta');

    const ficha = await fichas.projecao(ORG, leadA);
    expect(ficha.etapa).toBe('follow_up');
    expect(ficha.portao.proxima).toBe('contrato');
    expect(ficha.portao.faltando).toEqual(['resposta do cliente (aceite) ou saída com motivo']);
    expect(ficha.fio.some((l) => l.type === 'etapa.mudou')).toBe(true);
    expect(ficha.dono?.nome).toBe(admin.name);
  });

  it('o lead sem canal fica em E1 com o que falta escrito, e o ponto zero vai para a fila', async () => {
    const r = await fichas.entrarPeloWhats(ORG, { telefone: TEL_B, texto: 'Oi, vi no Instagram', mensagemId: `m2-${MARCA}` });
    leadB = r.leadId;
    expect((await prisma.comercialFicha.findFirst({ where: { leadId: leadB } }))?.pontuacao).toBeNull(); // sem dado, sem número
    const form = await fio.registrar(ORG, leadB, 'form.respondido', 'form-1', { sistema: 'planilhas soltas', baseOrganizada: false, maiorDor: 'não sei o lucro', equipeFinanceiro: 1, empresa: 'Studio Lume' });
    expect(await etapa(leadB)).toBe('novo_lead');
    const reacao = await prisma.comercialReacao.findFirst({ where: { eventoId: form.eventoId, reacao: 'espinha.projetar' } });
    expect((reacao?.resultado as { faltando?: string[] }).faltando).toContain('canal de entrada');
    // A pontuação do formulário chega depois e reprojeta: no fim, só o canal falta.
    const pontuado = await prisma.leadEvent.findFirstOrThrow({ where: { leadId: leadB, type: 'lead.pontuado' } });
    const ultima = await prisma.comercialReacao.findFirst({ where: { eventoId: pontuado.id, reacao: 'espinha.projetar' } });
    expect((ultima?.resultado as { faltando?: string[] }).faltando).toEqual(['canal de entrada']);
    const projecao = await fichas.projecao(ORG, leadB);
    expect(projecao.portao.faltando).toEqual(['canal de entrada']);
    const pz = await prisma.comercialDecisao.findFirst({ where: { leadId: leadB, tipo: 'ponto_zero' } });
    expect(pz).toMatchObject({ estado: 'aberta', padrao: 'geladeira' });
    expect(pz?.expiraEm.getTime()).toBe(SEM_PRAZO.getTime()); // sem decisaoExpiraHoras, não vence sozinha
    expect(await contar(leadB, 'decisao.aberta')).toBe(1);
  });

  it('a decisão vencida aplica o padrão escrito, grava o evento e roda a reação (ponto zero → geladeira)', async () => {
    const pz = await prisma.comercialDecisao.findFirstOrThrow({ where: { leadId: leadB, tipo: 'ponto_zero' } });
    await prisma.comercialDecisao.update({ where: { id: pz.id }, data: { expiraEm: new Date(Date.now() - 60_000) } });
    const n = await decisoes.expirarVencidas(ORG, new Date());
    expect(n).toBeGreaterThanOrEqual(1);
    const depois = await prisma.comercialDecisao.findUniqueOrThrow({ where: { id: pz.id } });
    expect(depois).toMatchObject({ estado: 'expirada', escolha: 'geladeira', canal: 'relogio' });
    expect(await contar(leadB, 'decisao.expirada')).toBe(1);
    expect(await etapa(leadB)).toBe('geladeira');
    expect(await status(leadB)).toBe('qualificado');
    const ficha = await prisma.comercialFicha.findFirst({ where: { leadId: leadB } });
    expect(ficha).toMatchObject({ motivoSaida: 'sem_base', etapaAntesDaSaida: 'novo_lead' });
    // Passar de novo não aplica duas vezes.
    expect(await decisoes.expirarVencidas(ORG, new Date())).toBe(0);
  });

  it('quem propôs não decide; a segunda resposta é 409; escolha fora das opções é 400', async () => {
    const d = await decisoes.abrir({
      orgId: ORG,
      leadId: leadA,
      tipo: 'pedido_de_ajuste',
      chave: 'ajuste-v1',
      titulo: 'Pediu 8% de desconto',
      contexto: 'Operação ROOT R$ 11.997 → R$ 11.037.',
      opcoes: [{ chave: 'aprovar_8', rotulo: 'aprovar 8%' }, { chave: 'manter', rotulo: 'manter o preço' }],
      padrao: 'manter',
      propostoPor: outro.id,
    });
    expect(d.nova).toBe(true);
    expect((await decisoes.abrir({ orgId: ORG, leadId: leadA, tipo: 'pedido_de_ajuste', chave: 'ajuste-v1', titulo: 'x', contexto: 'x', opcoes: [{ chave: 'manter', rotulo: 'manter' }], padrao: 'manter' })).nova).toBe(false);
    await expect(decisoes.abrir({ orgId: ORG, leadId: leadA, tipo: 'pedido_de_ajuste', titulo: 'x', contexto: 'x', opcoes: [{ chave: 'a', rotulo: 'a' }], padrao: 'b' })).rejects.toThrow(/padrão/);

    await expect(decisoes.responder(ORG, d.id, 'aprovar_8', { id: outro.id, nome: outro.name }, 'tela')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(decisoes.responder(ORG, d.id, 'aprovar_50', { id: admin.id, nome: admin.name }, 'tela')).rejects.toThrow(/fora das opções/);
    const r = await decisoes.responder(ORG, d.id, 'aprovar_8', { id: admin.id, nome: admin.name }, 'tela');
    expect(r).toMatchObject({ escolha: 'aprovar_8', como: 'tomada' });
    await expect(decisoes.responder(ORG, d.id, 'manter', { id: admin.id, nome: admin.name }, 'simulado')).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.leadEvent.count({ where: { leadId: leadA, type: 'decisao.tomada' } })).toBe(1);

    const fila = await decisoes.fila(ORG);
    expect(fila.decisoes.every((x) => x.estado === 'aberta')).toBe(true);
    expect(fila.resumo.leadsVivos).toBeGreaterThanOrEqual(1);
    expect(fila.rodouSozinhoHoje.length).toBeGreaterThan(0);
  });

  it('o relógio abre o lead parado uma vez por período, e só com o número configurado', async () => {
    const agora = new Date();
    await prisma.comercialFicha.updateMany({ where: { leadId: leadA }, data: { etapaDesde: new Date(agora.getTime() - 3 * DIA) } });
    expect(await relogio.leadsParados(ORG, agora)).toBe(0); // leadParadoDias [a decidir] = desligado
    await config.gravar(ORG, { leadParadoDias: 2 });
    const r1 = await relogio.passagem(ORG, agora);
    expect(r1.status).toBe('ok');
    expect(await prisma.comercialDecisao.count({ where: { leadId: leadA, tipo: 'lead_parado' } })).toBe(1);
    const r2 = await relogio.passagem(ORG, new Date(agora.getTime() + 60_000));
    expect(r2.status).toBe('pulada');
    expect(await prisma.comercialDecisao.count({ where: { leadId: leadA, tipo: 'lead_parado' } })).toBe(1);
    // O lead em saída (B, na geladeira) não é "parado".
    expect(await prisma.comercialDecisao.count({ where: { leadId: leadB, tipo: 'lead_parado' } })).toBe(0);
  });

  it('a saída passa por podeSair: perdido com motivo; sair de novo é 409; o funil a mostra', async () => {
    const f = await fichas.registrarSaida(ORG, leadA, { saida: 'perdido', motivo: 'preco', detalhe: 'achou caro' }, { id: admin.id, nome: admin.name });
    expect(f.etapa).toBe('perdido');
    expect(f.motivoSaida).toBe('preco');
    expect(await status(leadA)).toBe('perdido');
    await expect(fichas.registrarSaida(ORG, leadA, { saida: 'desqualificado', motivo: 'outro' }, null)).rejects.toBeInstanceOf(ConflictException);
    await expect(fichas.registrarSaida(ORG, leadB, { saida: 'geladeira', motivo: 'momento' }, null)).rejects.toThrow(/data de volta/);

    const funil = await fichas.funil(ORG);
    expect(funil.colunas).toHaveLength(10);
    const saidas = funil.colunas.find((c) => c.etapa === 'saidas')!;
    expect(saidas.cartoes.map((c) => c.leadId).sort()).toEqual([leadA, leadB].sort());
    // O fato tardio de um lead em saída fica na ficha e a etapa não anda.
    await fio.registrar(ORG, leadA, 'proposta.aceita', 'v1', { versao: 1, produto: 'operacao', valorCentavos: 1_199_700, parcelas: 3, forma: 'pix', hash: 'a'.repeat(64) });
    expect(await etapa(leadA)).toBe('perdido');
  });
});
