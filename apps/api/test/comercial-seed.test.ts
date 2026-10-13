/**
 * A SEMENTE DAS EMPRESAS DE DEMONSTRAÇÃO (lane F, 13/10/2026).
 *
 * `db:seed:comercial` põe no banco de homologação as oito empresas fictícias das
 * telas do mapa. O que esta suíte prova, contra o banco descartável:
 *   · rodar a semente DUAS vezes (a segunda com outro relógio) deixa as mesmas
 *     contagens: nada duplica, nem a sala, nem o token;
 *   · para cada lead, a ficha gravada é EXATAMENTE a projeção dos eventos que
 *     estão no banco (as funções da API, refeitas aqui), e a etapa é a da tela 04;
 *   · o link da sala reescreve o token cujo hash está no banco, e o token só
 *     existe cifrado ali;
 *   · o fio da Alicerce passa pelos portões da C07 a cada passagem de etapa;
 *   · toda proposta publicada tem o preço da tabela de 04/10 e as parcelas fecham;
 *   · as duas decisões abertas têm o padrão entre as opções e o prazo da config;
 *   · nenhum texto semeado tem travessão nem emoji.
 * Mais uma parte pura, sem banco, da projeção.
 */
import { LEAD_STATUS_DA_ETAPA, TABELA_DE_PRECO, parcelasFecham, precoNaTabela, type ComercialEtapa, type ComercialProduto } from '@mktos/shared';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { eventoIdComercial } from '../src/comercial/eventos';
import { estadoDaFicha } from '../src/comercial/ficha.service';
import { faltaParaSair } from '../src/comercial/portoes';
import { decifrarTokenDaSala, hashDoTokenDaSala } from '../src/comercial/sala-token';
import { COLUNAS_PROJETADAS, iguais, projetarLead } from '../prisma/seed-comercial/projecao';
import { montarRoteiros } from '../prisma/seed-comercial/roteiro';
import { contar, semearDemonstracao, type RelatorioDaSemente } from '../prisma/seed-comercial/semear';
import { exigirBancoDescartavel } from './banco-de-teste';

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (empresa, leads, eventos, fichas, salas, decisões e cobranças da semente comercial)');

const MARCA = `sf${Date.now().toString(36).slice(-6)}`;
const SEGREDO = 'chave-de-teste-da-semente-com-mais-de-16-caracteres';
const BASE = 'http://sala.teste';
const H = 3_600_000;

describe('a projeção do fio na ficha (pura)', () => {
  const t = (min: number) => new Date(Date.UTC(2026, 9, 1, 12, min));

  it('aplica os fatos em ordem de tempo, move a etapa pelo etapa.mudou e guarda de onde o lead saiu', () => {
    const eventos = [
      { id: 'b', type: 'etapa.mudou', payload: { de: 'novo_lead', para: 'qualificacao' }, occurredAt: t(10) },
      { id: 'a', type: 'lead.chegou', payload: { telefone: '5511900000099', canal: 'conteudo' }, occurredAt: t(0) },
      { id: 'c', type: 'form.respondido', payload: { sistema: 'Omie', baseOrganizada: true }, occurredAt: t(9) },
      { id: 'd', type: 'lead.pontuado', payload: { pontuacao: 55, perfil: 'P2' }, occurredAt: t(11) },
      { id: 'e', type: 'saida.registrada', payload: { saida: 'geladeira', motivo: 'momento', voltaEm: '2026-12-10T12:00:00-03:00' }, occurredAt: t(20) },
      { id: 'f', type: 'etapa.mudou', payload: { de: 'qualificacao', para: 'geladeira' }, occurredAt: t(21) },
    ];
    const p = projetarLead(eventos, t(0));
    expect(p.ficha).toMatchObject({ etapa: 'geladeira', etapaAntesDaSaida: 'qualificacao', canal: 'conteudo', sistemaErp: 'Omie', baseDados: true, produto: 'operacao', pontuacao: 55, perfil: 'P2', motivoSaida: 'momento', propostaVersao: 0 });
    expect((p.ficha.etapaDesde as Date).getTime()).toBe(t(21).getTime());
    expect((p.ficha.voltaEm as Date).toISOString()).toBe('2026-12-10T15:00:00.000Z');
    expect(p.lead).toEqual({ status: LEAD_STATUS_DA_ETAPA.geladeira, score: 55, ownerId: null });
    expect(Object.keys(p.ficha).sort()).toEqual([...COLUNAS_PROJETADAS].sort());
  });

  it('o roteiro monta oito empresas, com tempo estritamente crescente e id de evento sem repetição', () => {
    const roteiros = montarRoteiros({ orgId: 'org-x', agora: new Date(Date.UTC(2026, 9, 13, 15, 0)), dono: null, decisaoExpiraHoras: 4, validadePropostaDias: 8 });
    expect(roteiros.map((r) => r.empresa)).toEqual(['Café Serra', 'Studio Lume', 'Construtora Alicerce', 'Ótica Vista', 'Rede Pão Bom', 'Mercado Bom Preço', 'Pet Feliz', 'Auto Peças Sul']);
    for (const r of roteiros) {
      const tempos = r.eventos.map((e) => e.em.getTime());
      expect(tempos, r.slug).toEqual([...tempos].sort((a, b) => a - b));
      expect(new Set(tempos).size, `${r.slug}: dois eventos no mesmo instante`).toBe(tempos.length);
      const ids = r.eventos.map((e) => eventoIdComercial('org-x', r.leadId, e.type, e.chave));
      expect(new Set(ids).size, `${r.slug}: chave repetida`).toBe(ids.length);
      expect(r.eventos[0].em.getTime(), r.slug).toBeGreaterThanOrEqual(r.entrada.getTime());
      expect(r.eventos.at(-1)!.em.getTime(), `${r.slug}: evento no futuro`).toBeLessThanOrEqual(Date.UTC(2026, 9, 13, 15, 0));
    }
  });
});

describe.skipIf(!URL)('a semente das empresas de demonstração, contra o banco', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
  let ORG = '';
  let dono = { id: '', nome: '' };
  let leadIds: string[] = [];
  let primeira: RelatorioDaSemente;
  let segunda: RelatorioDaSemente;
  const agora1 = new Date(Date.now() - 2 * H);
  const agora2 = new Date(agora1.getTime() + 3 * H);
  const opcoes = () => ({ orgId: ORG, dono, decisaoExpiraHoras: 4, validadePropostaDias: 8, segredo: SEGREDO, baseDoLink: BASE });

  beforeAll(async () => {
    const org = await prisma.org.create({ data: { name: `Semente ${MARCA}`, slug: `semente-${MARCA}` } });
    ORG = org.id;
    const papel = await prisma.role.create({ data: { orgId: ORG, key: 'admin_master', name: 'Admin Master' } });
    const u = await prisma.user.create({ data: { orgId: ORG, name: 'Sócia da conta', email: `socia.${MARCA}@root.local`, passwordHash: 'x', roles: { connect: { id: papel.id } } }, select: { id: true, name: true } });
    dono = { id: u.id, nome: u.name };
    leadIds = montarRoteiros({ orgId: ORG, agora: agora1, dono, decisaoExpiraHoras: 4, validadePropostaDias: 8 }).map((r) => r.leadId);

    expect(await contar(prisma, leadIds)).toEqual({ leads: 0, eventos: 0, fichas: 0, salas: 0, decisoes: 0, cobrancas: 0, documentos: 0 });
    primeira = await semearDemonstracao(prisma, { ...opcoes(), agora: agora1 });
    segunda = await semearDemonstracao(prisma, { ...opcoes(), agora: agora2 });
  });

  afterAll(async () => {
    if (ORG) {
      const leads = (await prisma.lead.findMany({ where: { orgId: ORG }, select: { id: true } })).map((l) => l.id);
      await prisma.comercialReacao.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.comercialDecisao.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.comercialCobranca.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.comercialDocumento.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.salaDoCliente.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.comercialFicha.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.leadEvent.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.lead.deleteMany({ where: { orgId: ORG } });
      await prisma.user.deleteMany({ where: { orgId: ORG } });
      await prisma.role.deleteMany({ where: { orgId: ORG } });
      await prisma.org.deleteMany({ where: { id: ORG } });
    }
    await prisma.$disconnect();
  });

  it('rodar duas vezes (a segunda com outro relógio) deixa as mesmas contagens', async () => {
    const esperadoEventos = montarRoteiros({ orgId: ORG, agora: agora1, dono, decisaoExpiraHoras: 4, validadePropostaDias: 8 }).reduce((s, r) => s + r.eventos.length, 0);
    expect(primeira.contagens).toEqual({ leads: 8, eventos: esperadoEventos, fichas: 8, salas: 8, decisoes: 6, cobrancas: 3, documentos: 1 });
    expect(segunda.contagens).toEqual(primeira.contagens);
    expect(await contar(prisma, leadIds)).toEqual(primeira.contagens);
    expect(primeira.salas.every((s) => s.nova)).toBe(true);
    expect(segunda.salas.every((s) => !s.nova)).toBe(true);
  });

  it('cada ficha gravada é a projeção dos eventos do lead, e a etapa é a da tela 04', async () => {
    const roteiros = montarRoteiros({ orgId: ORG, agora: agora1, dono, decisaoExpiraHoras: 4, validadePropostaDias: 8 });
    for (const r of roteiros) {
      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: r.leadId } });
      const ficha = await prisma.comercialFicha.findUniqueOrThrow({ where: { leadId: r.leadId } });
      const eventos = await prisma.leadEvent.findMany({ where: { leadId: r.leadId } });
      const proj = projetarLead(eventos, lead.enteredAt);
      for (const c of COLUNAS_PROJETADAS) {
        expect(iguais((ficha as Record<string, unknown>)[c], proj.ficha[c]), `${r.slug}.${c}: gravado ${JSON.stringify((ficha as Record<string, unknown>)[c])} × projetado ${JSON.stringify(proj.ficha[c])}`).toBe(true);
      }
      expect(ficha.etapa, r.slug).toBe(r.etapaEsperada);
      expect(lead.status, r.slug).toBe(LEAD_STATUS_DA_ETAPA[r.etapaEsperada]);
      expect(lead.score, r.slug).toBe(proj.lead.score);
      expect(lead.ownerId, r.slug).toBe(dono.id);
      expect(ficha.donoId, r.slug).toBe(dono.id);
      // O que não é projeção (saúde e próxima ação) é o overlay declarado, e só ele.
      expect(ficha.saude, r.slug).toBe(r.overlay.saude);
      expect(ficha.proximaAcaoTexto, r.slug).toBe(r.overlay.proximaAcao?.descricao ?? null);
      // Os ids dos eventos são os derivados da chave do fato.
      const ids = new Set(eventos.map((e) => e.id));
      for (const e of r.eventos) expect(ids.has(eventoIdComercial(ORG, r.leadId, e.type, e.chave)), `${r.slug}: ${e.type}/${e.chave}`).toBe(true);
    }
  });

  it('as etapas da tela 04: quatro colunas do funil e as saídas com motivo', async () => {
    const f = async (nome: string) => prisma.comercialFicha.findFirstOrThrow({ where: { leadId: { in: leadIds }, lead: { name: nome } } });
    expect((await f('Café Serra')).etapa).toBe('novo_lead');
    expect((await f('Studio Lume')).etapa).toBe('qualificacao');
    expect((await f('Marina Duarte')).etapa).toBe('follow_up'); // Construtora Alicerce
    expect((await f('Ótica Vista')).etapa).toBe('diagnostico');
    expect((await f('Rede Pão Bom')).etapa).toBe('follow_up');
    expect((await f('Mercado Bom Preço')).etapa).toBe('contrato');
    const pet = await f('Pet Feliz');
    expect(pet).toMatchObject({ etapa: 'geladeira', motivoSaida: 'outro', etapaAntesDaSaida: 'novo_lead' });
    expect(pet.voltaEm?.toISOString().slice(5, 10)).toBe('12-10');
    expect(await f('Auto Peças Sul')).toMatchObject({ etapa: 'perdido', motivoSaida: 'preco', etapaAntesDaSaida: 'follow_up' });
  });

  it('a sala: o link reescreve o token do hash gravado, e rodar de novo devolve o mesmo link', async () => {
    expect(segunda.salas.map((s) => s.link)).toEqual(primeira.salas.map((s) => s.link));
    for (const s of primeira.salas) {
      expect(s.link, s.slug).toMatch(new RegExp(`^${BASE}/s/[A-Za-z0-9_-]{43}$`));
      const token = s.link!.split('/s/')[1];
      const sala = await prisma.salaDoCliente.findUniqueOrThrow({ where: { leadId: s.leadId } });
      expect(sala.tokenHash).toBe(hashDoTokenDaSala(token));
      expect(sala.tokenCifrado).not.toContain(token);
      expect(decifrarTokenDaSala(sala.tokenCifrado!, SEGREDO, sala.id)).toBe(token);
      expect(sala.revogadoEm).toBeNull();
      expect(sala.validoAte.getTime()).toBeGreaterThan(Date.now());
    }
  });

  it('o fio da Alicerce passa pelos portões da C07 a cada passagem de etapa', async () => {
    const alicerce = montarRoteiros({ orgId: ORG, agora: agora1, dono, decisaoExpiraHoras: 4, validadePropostaDias: 8 }).find((r) => r.slug === 'alicerce')!;
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: alicerce.leadId } });
    const eventos = (await prisma.leadEvent.findMany({ where: { leadId: alicerce.leadId } })).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const passagens = eventos.filter((e) => e.type === 'etapa.mudou');
    expect(passagens.map((e) => (e.payload as { para: string }).para)).toEqual(['qualificacao', 'reuniao_agendada', 'sessao', 'diagnostico', 'proposta', 'follow_up']);
    for (const p of passagens) {
      const antes = projetarLead(eventos.filter((e) => e.occurredAt.getTime() < p.occurredAt.getTime()), lead.enteredAt);
      const proposta = [...eventos].reverse().find((e) => e.type === 'proposta.publicada' && e.occurredAt.getTime() < p.occurredAt.getTime());
      // A regra do portão desde a revisão E-3: laudo limpo, ou levado à liberação por uma pessoa na decisão.
      const l = proposta ? ((proposta.payload ?? {}) as { laudo?: { ok?: boolean; liberadoNaDecisao?: unknown } }).laudo : undefined;
      const laudo = proposta ? l?.ok === true || typeof l?.liberadoNaDecisao === 'string' : null;
      const estado = estadoDaFicha(antes.ficha as never, { name: lead.name, phone: lead.phone }, laudo);
      expect(faltaParaSair(estado), `saindo de ${antes.ficha.etapa} para ${(p.payload as { para: string }).para}`).toEqual([]);
    }
  });

  it('toda proposta publicada tem o preço da tabela de 04/10, parcelas que fecham, e o quadro de exemplo foi levado à liberação por uma pessoa', async () => {
    const pubs = await prisma.leadEvent.findMany({ where: { leadId: { in: leadIds }, type: 'proposta.publicada' } });
    expect(pubs.length).toBe(4); // Alicerce, Rede Pão Bom, Mercado Bom Preço, Auto Peças Sul
    for (const e of pubs) {
      const p = e.payload as { produto: ComercialProduto; valorCentavos: number; parcelas: number; parcelaCentavos: number; dentroDaTabela: boolean; laudo: { ok: boolean; apontamentos: string[]; liberadoNaDecisao?: string }; quadroDeExemplo: boolean; hash: string };
      expect(precoNaTabela(p.produto, p.valorCentavos)).toBe(true);
      expect(parcelasFecham(p.valorCentavos, p.parcelas, p.parcelaCentavos)).toBe(true);
      expect(p.dentroDaTabela).toBe(true);
      // Revisão E-3: o quadro de exemplo é apontamento; a decisão tomada por gente é sobre este hash.
      expect(p.laudo.ok).toBe(false);
      expect(p.laudo.apontamentos.join(' ')).toMatch(/exemplo/i);
      const d = await prisma.comercialDecisao.findUniqueOrThrow({ where: { id: p.laudo.liberadoNaDecisao! } });
      expect(d).toMatchObject({ tipo: 'proposta_fora_da_tabela', estado: 'tomada', escolha: 'liberar', leadId: e.leadId });
      expect((d.dados as { hash: string }).hash).toBe(p.hash);
      expect(d.decididoEm!.getTime()).toBeLessThan(e.occurredAt.getTime());
      expect(p.quadroDeExemplo).toBe(true);
    }
    expect(TABELA_DE_PRECO.imersao).toMatchObject({ valorCentavos: 297_000, parcelas: 10, parcelaCentavos: 29_700 });
    expect(TABELA_DE_PRECO.operacao).toMatchObject({ valorCentavos: 1_199_700, parcelas: 3, parcelaCentavos: 399_900 });
    const cobrancas = await prisma.comercialCobranca.findMany({ where: { leadId: { in: leadIds } }, orderBy: { parcela: 'asc' } });
    expect(cobrancas.map((c) => c.valorCentavos)).toEqual([399_900, 399_900, 399_900]);
    expect(cobrancas.reduce((s, c) => s + c.valorCentavos, 0)).toBe(1_199_700);
  });

  it('as duas decisões abertas: padrão entre as opções, prazo da config e evento de abertura no fio', async () => {
    const ds = await prisma.comercialDecisao.findMany({ where: { leadId: { in: leadIds }, estado: 'aberta' }, include: { lead: { select: { name: true } } } });
    expect(ds.map((d) => `${d.tipo}:${d.lead.name}`).sort()).toEqual(['ponto_zero:Studio Lume', 'pedido_de_ajuste:Marina Duarte'].sort());
    for (const d of ds) {
      const chaves = (d.opcoes as { chave: string }[]).map((o) => o.chave);
      expect(chaves).toContain(d.padrao);
      expect(d.estado).toBe('aberta');
      expect(d.expiraEm.getTime() - d.criadoEm.getTime()).toBe(4 * H);
      const ev = await prisma.leadEvent.findUniqueOrThrow({ where: { id: d.eventoAberturaId! } });
      expect(ev.type).toBe('decisao.aberta');
    }
    const ajuste = ds.find((d) => d.tipo === 'pedido_de_ajuste')!;
    expect(ajuste.padrao).toBe('manter');
    expect((ajuste.opcoes as { chave: string }[]).map((o) => o.chave)).toEqual(['desconto:4', 'desconto:8', 'manter']);
    expect(ds.find((d) => d.tipo === 'ponto_zero')!.padrao).toBe('geladeira');
  });

  it('nenhum texto semeado tem travessão, emoji ou a construção "não é X, é Y"', async () => {
    const eventos = await prisma.leadEvent.findMany({ where: { leadId: { in: leadIds } }, select: { type: true, payload: true } });
    const decisoes = await prisma.comercialDecisao.findMany({ where: { leadId: { in: leadIds } }, select: { titulo: true, contexto: true, opcoes: true } });
    const textos: string[] = [];
    const colher = (v: unknown) => {
      if (typeof v === 'string') textos.push(v);
      else if (Array.isArray(v)) v.forEach(colher);
      else if (v && typeof v === 'object') Object.values(v).forEach(colher);
    };
    for (const e of eventos) colher(e.payload);
    for (const d of decisoes) colher([d.titulo, d.contexto, d.opcoes]);
    expect(textos.length).toBeGreaterThan(100);
    const ruins = textos.filter((t) => /[—–]/.test(t) || /\p{Extended_Pictographic}/u.test(t) || /\bnão (é|foi|são)\b[^.;:]{0,60}[,;] (é|foi|são)\b/i.test(t));
    expect(ruins).toEqual([]);
  });

  it('o que o mapa não diz fica por decidir: CNPJ, e-mail e endereço do Mercado Bom Preço não são números inventados', async () => {
    const mercado = await prisma.comercialFicha.findFirstOrThrow({ where: { leadId: { in: leadIds }, lead: { name: 'Mercado Bom Preço' } } });
    expect(mercado.cadastro).toEqual({ cnpj: '[a decidir]', razaoSocial: 'Mercado Bom Preço', endereco: '[a decidir]', quemAssina: '[a decidir]', email: '[a decidir]' });
    const todos = await prisma.leadEvent.findMany({ where: { leadId: { in: leadIds }, type: 'cnpj.enriquecido' } });
    for (const e of todos) expect((e.payload as { cnpj?: string }).cnpj).toBeUndefined();
    const lead: ComercialEtapa = 'contrato';
    expect(mercado.etapa).toBe(lead);
  });
});
