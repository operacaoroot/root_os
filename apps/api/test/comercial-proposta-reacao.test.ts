import { randomBytes } from 'node:crypto';

import { NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { agregar, LEITURA_TETO_POR_LINHA, ReacoesDaPropostaService } from '../src/comercial/reacoes-da-proposta.service';
import { SalaController } from '../src/comercial/sala.controller';
import { SALA_NAO_ENCONTRADA, SalaService } from '../src/comercial/sala.service';
import { MARCA_DE_SEGREDO } from '../src/onboarding/trilho/segredos';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * A PROPOSTA MEDE LEITURA E COLHE IDEIAS — rodada da implantação I4 (18/10/2026).
 *
 * Pelos mesmos métodos que as rotas anônimas chamam (o controller da sala
 * montado à mão, sem Nest, como `comercial-sala.test.ts` faz): o token ruim dá
 * o 404 de sempre, o texto do cliente é limitado e varrido de segredo antes de
 * gravar, o teto por token responde 429, a leitura soma por visita até o teto,
 * o chip repetido não duplica, a ideia vira fato no fio e aparece na bancada, e
 * a outra empresa não alcança nada disso.
 */

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (leads, salas, eventos e reações da proposta)');
process.env.ENCRYPTION_KEY ??= 'chave-de-teste-da-sala-0123456789abcdef';
process.env.PUBLIC_BASE_URL = 'http://sala.teste';

const MARCA = `pr${Date.now().toString(36).slice(-6)}`;
const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
const p = prisma as unknown as PrismaService;

let ORG = '';
let OUTRA = '';
let LEAD = '';
let TOKEN = '';
let fio: FioService;
let sala: SalaService;
let reacoes: ReacoesDaPropostaService;
let controller: SalaController;

function tokenDoLink(link: string | null): string {
  const m = /\/s\/([A-Za-z0-9_-]{40,48})/.exec(link ?? '');
  if (!m) throw new Error(`sem token no link: ${link}`);
  return m[1];
}

async function linhas(tipo?: string) {
  return prisma.leadReacao.findMany({ where: { leadId: LEAD, ...(tipo ? { tipo } : {}) }, orderBy: { criadoEm: 'asc' } });
}

async function fatos(type: string) {
  return prisma.leadEvent.findMany({ where: { leadId: LEAD, type }, orderBy: { occurredAt: 'asc' } });
}

beforeAll(async () => {
  ORG = (await prisma.org.create({ data: { name: `Proposta ${MARCA}`, slug: `proposta-${MARCA}` } })).id;
  OUTRA = (await prisma.org.create({ data: { name: `Outra ${MARCA}`, slug: `outra-${MARCA}` } })).id;
  const reg = new ReacoesRegistry();
  fio = new FioService(p, reg);
  sala = new SalaService(p, fio, reg);
  reacoes = new ReacoesDaPropostaService(p, fio, sala);
  controller = new SalaController(sala, reacoes);

  LEAD = (await prisma.lead.create({ data: { orgId: ORG, name: `Alicerce ${MARCA}`, status: 'novo' } })).id;
  const { link } = await sala.garantir(ORG, LEAD);
  TOKEN = tokenDoLink(link);
  // A proposta v1 publicada, sem outra opção e com o quadro de custos.
  await fio.registrar(ORG, LEAD, 'proposta.publicada', 'v1', {
    versao: 1, produto: 'operacao', valorCentavos: 1199700, parcelas: 3, parcelaCentavos: 399900, formas: ['pix', 'boleto'],
    validaAte: null, dentroDaTabela: true, laudo: { ok: true, apontamentos: [] }, hash: 'h1',
    quadroDeCustos: { mesNormalCentavos: 40000, piorMesCentavos: 90000 },
  }, { semReacoes: true });
  await sala.visita(TOKEN, new Date());
});

afterAll(async () => {
  for (const org of [ORG, OUTRA].filter(Boolean)) {
    const leads = await prisma.lead.findMany({ where: { orgId: org }, select: { id: true } });
    const ids = leads.map((l) => l.id);
    await prisma.leadReacao.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.comercialReacao.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.salaDoCliente.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.leadEvent.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.lead.deleteMany({ where: { orgId: org } });
    await prisma.org.delete({ where: { id: org } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

describe('a rota anônima da proposta: as travas da entrada do cliente', () => {
  it('token ruim responde o MESMO 404, malformado ou bem formado e inexistente', async () => {
    const inexistente = randomBytes(32).toString('base64url');
    const corpo = { secao: 'montar', tipo: 'faz_sentido', versao: 1 };
    for (const t of ['curto', inexistente]) {
      await expect(controller.reacao(t, corpo, { ip: '10.9.0.1' })).rejects.toThrow(NotFoundException);
      await expect(controller.reacao(t, corpo, { ip: '10.9.0.1' })).rejects.toThrow(SALA_NAO_ENCONTRADA);
      await expect(controller.leitura(t, { secao: 'montar', segundos: 5, versao: 1 }, { ip: '10.9.0.1' })).rejects.toThrow(SALA_NAO_ENCONTRADA);
      await expect(controller.reacoesDaProposta(t, { ip: '10.9.0.1' })).rejects.toThrow(SALA_NAO_ENCONTRADA);
    }
  });

  it('texto acima de 1.000 caracteres é recusado (400) e nada é gravado', async () => {
    const antes = (await linhas()).length;
    await expect(reacoes.reagir(TOKEN, { secao: 'montar', tipo: 'ideia', texto: 'a'.repeat(1001), versao: 1 })).rejects.toMatchObject({ status: 400 });
    await expect(reacoes.reagir(TOKEN, { secao: 'montar', tipo: 'ideia', texto: '   ', versao: 1 })).rejects.toMatchObject({ status: 400 });
    await expect(reacoes.reagir(TOKEN, { secao: 'montar', tipo: 'faz_sentido', texto: 'oi', versao: 1 })).rejects.toMatchObject({ status: 400 });
    await expect(reacoes.reagir(TOKEN, { secao: 'montar', tipo: 'ideia', texto: 'x', versao: 1, extra: true })).rejects.toMatchObject({ status: 400 });
    await expect(reacoes.ler(TOKEN, { secao: 'montar', segundos: 61, versao: 1 })).rejects.toMatchObject({ status: 400 });
    expect((await linhas()).length).toBe(antes);
  });

  it('versão que não é a vigente é 409 (a proposta mudou com a página aberta)', async () => {
    await expect(reacoes.reagir(TOKEN, { secao: 'montar', tipo: 'faz_sentido', versao: 2 })).rejects.toMatchObject({ status: 409 });
    await expect(reacoes.ler(TOKEN, { secao: 'montar', segundos: 3, versao: 2 })).rejects.toMatchObject({ status: 409 });
  });

  it('o segredo sai ANTES de gravar: nem a linha nem o fato guardam o valor', async () => {
    const estado = await reacoes.reagir(TOKEN, { secao: 'investimento', tipo: 'ideia', texto: 'Podemos integrar com o banco? a senha é abacaxi123 e o token: tk_live_9f8e7d6c5b4a', versao: 1 });
    const ideia = (await linhas('ideia')).find((l) => l.texto?.includes('integrar'))!;
    expect(ideia.texto).toContain(MARCA_DE_SEGREDO);
    expect(ideia.texto).not.toContain('abacaxi123');
    expect(ideia.texto).not.toContain('tk_live_9f8e7d6c5b4a');
    const fato = (await fatos('proposta.ideia')).find((f) => JSON.stringify(f.payload).includes('integrar'))!;
    expect(JSON.stringify(fato.payload)).not.toContain('abacaxi123');
    expect(estado.anotacoes.find((a) => a.id === ideia.id)?.texto).toBe(ideia.texto);
  });

  it('o teto POR TOKEN estoura em 429, mesmo trocando de origem', async () => {
    const c = new SalaController(sala, reacoes);
    c.tetosPorToken.reacao = 3;
    const corpo = { secao: 'funciona', tipo: 'faz_sentido', versao: 1 };
    for (let i = 0; i < 3; i++) await c.reacao(TOKEN, corpo, { ip: `10.8.0.${i + 1}` });
    expect(() => c.reacao(TOKEN, corpo, { ip: '10.8.0.99' })).toThrow(expect.objectContaining({ status: 429 }));
    // A leitura tem balde próprio: a reação esgotada não cala a medição.
    c.tetosPorToken.leitura = 1;
    await c.leitura(TOKEN, { secao: 'funciona', segundos: 2, versao: 1 }, { ip: '10.8.0.50' });
    expect(() => c.leitura(TOKEN, { secao: 'funciona', segundos: 2, versao: 1 }, { ip: '10.8.0.51' })).toThrow(expect.objectContaining({ status: 429 }));
  });
});

describe('o que a página grava', () => {
  it('a leitura soma por visita, abre a linha nova na visita seguinte e não passa do teto', async () => {
    const a = await reacoes.ler(TOKEN, { secao: 'montar', segundos: 20, versao: 1 });
    const b = await reacoes.ler(TOKEN, { secao: 'montar', segundos: 30, versao: 1 });
    expect(a.segundos).toBe(20);
    expect(b.segundos).toBe(50);
    const daVisita = (await linhas('leitura')).filter((l) => l.secao === 'montar');
    expect(daVisita).toHaveLength(1);

    // Ver a seção grava o `proposta.lida` dos blocos dela, com a seção, pelo caminho da sala.
    const lidas = (await fatos('proposta.lida')).map((f) => f.payload as { bloco: string; secao?: string });
    expect(lidas.filter((l) => l.secao === 'montar').map((l) => l.bloco).sort()).toEqual(['ouvimos', 'recomendada']);
    // A proposta não tem outra opção: "como funciona" marca só a validade.
    expect(lidas.filter((l) => l.secao === 'funciona').map((l) => l.bloco)).toEqual(['validade']);

    await sala.visita(TOKEN, new Date());
    await reacoes.ler(TOKEN, { secao: 'montar', segundos: 5, versao: 1 });
    expect((await linhas('leitura')).filter((l) => l.secao === 'montar').map((l) => l.segundos).sort((x, y) => (x ?? 0) - (y ?? 0))).toEqual([5, 50]);

    // 61 batidas de 60 s: a linha para no teto.
    for (let i = 0; i < 61; i++) await reacoes.ler(TOKEN, { secao: 'investimento', segundos: 60, versao: 1 });
    const inv = (await linhas('leitura')).filter((l) => l.secao === 'investimento');
    expect(inv).toHaveLength(1);
    expect(inv[0].segundos).toBe(LEITURA_TETO_POR_LINHA);
  }, 30_000); // 61 batidas contra o banco: com as outras suítes em paralelo, 5 s não bastam.

  it('a mesma reação de chip duas vezes na mesma visita é UMA linha e UM fato', async () => {
    const antes = (await fatos('proposta.reagida')).length;
    const e1 = await reacoes.reagir(TOKEN, { secao: 'investimento', tipo: 'faz_sentido', versao: 1 });
    const e2 = await reacoes.reagir(TOKEN, { secao: 'investimento', tipo: 'faz_sentido', versao: 1 });
    expect(e1.fazSentido).toContain('investimento');
    expect(e2.fazSentido).toContain('investimento');
    const acesso = e2.acesso;
    expect((await linhas('faz_sentido')).filter((l) => l.secao === 'investimento' && l.acesso === acesso)).toHaveLength(1);
    expect((await fatos('proposta.reagida')).length).toBe(antes + 1);
  });

  it('a dúvida segue pelo `proposta.duvida` de sempre, com a seção', async () => {
    const e = await reacoes.reagir(TOKEN, { secao: 'funciona', tipo: 'duvida', texto: 'Dá para pagar a primeira no boleto?', versao: 1 });
    expect(e.contagem.duvidas).toBe(1);
    const d = (await fatos('proposta.duvida')).at(-1)!;
    expect(d.payload).toMatchObject({ versao: 1, pergunta: 'Dá para pagar a primeira no boleto?', resposta: null, secao: 'funciona' });
    // A sala de antes continua mostrando a dúvida na lista dela.
    expect((await sala.estado(TOKEN)).proposta?.duvidas?.map((x) => x.pergunta)).toContain('Dá para pagar a primeira no boleto?');
  });

  it('a ideia vira `proposta.ideia` no fio e aparece na bancada (`GET /comercial/lead/:id/reacoes`); o reenvio não duplica', async () => {
    const texto = 'Quero que o relatório chegue toda segunda às 8h.';
    await reacoes.reagir(TOKEN, { secao: 'montar', tipo: 'ideia', texto, versao: 1 });
    await reacoes.reagir(TOKEN, { secao: 'montar', tipo: 'ideia', texto, versao: 1 });
    expect((await linhas('ideia')).filter((l) => l.texto === texto)).toHaveLength(1);
    const fato = (await fatos('proposta.ideia')).find((f) => (f.payload as { texto: string }).texto === texto);
    expect(fato?.payload).toMatchObject({ versao: 1, secao: 'montar', texto });

    const bancada = await reacoes.doLead(ORG, LEAD);
    expect(bancada.versaoVigente).toBe(1);
    expect(bancada.acessosDaSala).toBeGreaterThanOrEqual(2);
    expect(bancada.anotacoes.find((a) => a.texto === texto)).toMatchObject({ tipo: 'ideia', secao: 'montar', versao: 1, respondidaEm: null, tarefaId: null });
    const montar = bancada.leitura.find((l) => l.secao === 'montar')!;
    expect(montar).toMatchObject({ versao: 1, acessos: 2, segundos: 55 });
    expect(bancada.fazSentido.some((f) => f.secao === 'investimento')).toBe(true);

    const pagina = await reacoes.daPagina(TOKEN);
    expect(pagina.contagem.anotacoes).toBe(2);
    expect(pagina.anotacoes.map((a) => a.tipo).sort()).toEqual(['duvida', 'ideia', 'ideia']);
  });

  it('isolamento: a outra empresa não lê as reações do lead (404) e o filtro por empresa não deixa vazar linha', async () => {
    await expect(reacoes.doLead(OUTRA, LEAD)).rejects.toThrow(NotFoundException);
    const daOutra = await prisma.leadReacao.findMany({ where: { orgId: OUTRA } });
    expect(daOutra).toHaveLength(0);
    // O gatilho deu à reação a empresa do lead, nunca a sentinela.
    expect(new Set((await linhas()).map((l) => l.orgId))).toEqual(new Set([ORG]));
  });

  it('o CHECK do banco segura o que o serviço deixasse passar', async () => {
    await expect(
      prisma.leadReacao.create({ data: { id: `chk-${MARCA}`, leadId: LEAD, versao: 1, secao: 'montar', tipo: 'ideia', texto: 'x'.repeat(1001), acesso: 1 } }),
    ).rejects.toThrow();
    await expect(
      prisma.leadReacao.create({ data: { id: `chk2-${MARCA}`, leadId: LEAD, versao: 1, secao: 'outra', tipo: 'faz_sentido', acesso: 1 } }),
    ).rejects.toThrow();
  });
});

describe('agregar (parte pura)', () => {
  it('soma os segundos por seção e versão e conta as visitas distintas', () => {
    const d = (s: string) => new Date(s);
    const base = { texto: null, respondidaEm: null, tarefaId: null };
    const r = agregar([
      { ...base, id: '1', versao: 1, secao: 'montar', tipo: 'leitura', segundos: 10, acesso: 1, criadoEm: d('2026-10-18T10:00:00Z'), atualizadoEm: d('2026-10-18T10:01:00Z') },
      { ...base, id: '2', versao: 1, secao: 'montar', tipo: 'leitura', segundos: 15, acesso: 2, criadoEm: d('2026-10-18T11:00:00Z'), atualizadoEm: d('2026-10-18T11:02:00Z') },
      { ...base, id: '3', versao: 1, secao: 'estranha', tipo: 'leitura', segundos: 99, acesso: 2, criadoEm: d('2026-10-18T11:00:00Z'), atualizadoEm: d('2026-10-18T11:00:00Z') },
      { ...base, id: '4', versao: 1, secao: 'investimento', tipo: 'ideia', texto: 'oi', segundos: null, acesso: 2, criadoEm: d('2026-10-18T11:03:00Z'), atualizadoEm: d('2026-10-18T11:03:00Z') },
    ]);
    expect(r.leitura).toEqual([{ versao: 1, secao: 'montar', acessos: 2, segundos: 25, ultimaEm: '2026-10-18T11:02:00.000Z' }]);
    expect(r.anotacoes).toHaveLength(1);
    expect(r.fazSentido).toHaveLength(0);
  });
});
