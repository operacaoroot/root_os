import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { lerCompromisso, type EventoDaAgenda, type RespostaDoEspelho } from '@mktos/shared';

import type { PrismaService } from '../src/prisma/prisma.service';
import type { EspelhoService } from '../src/agenda/espelho/espelho.service';
import { ReguaService } from '../src/agenda/regua/regua.service';
import { SEMENTE_DOS_RITOS, sementeDosFeriados, usuarioDoSocio } from '../src/agenda/regua/regua-semente';
import {
  FeriadoCriarSchema,
  LivresQuerySchema,
  PessoaAlterarSchema,
  PropostaSchema,
  RitoAlterarSchema,
} from '../src/agenda/regua/regua.schemas';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * A RÉGUA DA AGENDA NO SERVIDOR (agenda v2, 29/10/2026, lane G2).
 *
 * O serviço instanciado à mão (sem injeção do Nest), contra o banco de teste, com
 * um DUBLÊ do espelho (a lane A implementa o de verdade em paralelo). Prova: a
 * semente da casa com os valores do desenho `Regras`, idempotente e sem passar
 * por cima de edição; fora da casa nada é semeado; escrever audita; regra de uma
 * empresa não aparece nem se altera pela outra; a régua e os livres leem o
 * espelho em volta do compromisso. Dados fictícios.
 */

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (regras da agenda e auditoria)');

const MARCA = `rg${Date.now().toString(36).slice(-6)}`;
const CASA = `org-regua-casa-${MARCA}`;
const OUTRA = `org-regua-outra-${MARCA}`;
const QUEM = { id: `socio-${MARCA}` };

const sp = (dia: string, hora: string) => new Date(`${dia}T${hora}:00-03:00`).toISOString();
const ev = (id: string, titulo: string, dia: string, de: string, ate: string): EventoDaAgenda => ({
  id, agenda: 'primary', origem: 'google', titulo, inicio: sp(dia, de), fim: sp(dia, ate), diaInteiro: false,
  local: null, meet: null, convidados: [], organizador: null, organizadorEhAgenda: true, status: 'confirmado',
  atualizadoNoGoogle: null, serieId: null, criadoPeloOs: false, link: null, leitura: lerCompromisso(titulo),
});

describe('a régua no servidor (regras, semente, escrita auditada, avaliar, livres)', () => {
  let prisma: PrismaClient;
  let regua: ReguaService;
  let eventosDoEspelho: EventoDaAgenda[] = [];
  const pedidos: Array<{ orgId: string; de: Date; ate: Date }> = [];
  const espelho = {
    periodo: async (orgId: string, de: Date, ate: Date): Promise<RespostaDoEspelho> => {
      pedidos.push({ orgId, de, ate });
      return { eventos: orgId === CASA ? eventosDoEspelho : [], sincronia: { ultimaPassagem: null, erro: null, atrasada: false }, fonte: 'espelho' };
    },
  } as unknown as EspelhoService;

  const novoServico = () => {
    const s = new ReguaService(prisma as unknown as PrismaService, espelho);
    vi.spyOn(s as unknown as { ehDaCasa: (o: string) => Promise<boolean> }, 'ehDaCasa').mockImplementation(async (o) => o === CASA);
    return s;
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.org.create({ data: { id: CASA, name: `Casa ${MARCA}`, slug: `regua-casa-${MARCA}` } });
    await prisma.org.create({ data: { id: OUTRA, name: `Outra ${MARCA}`, slug: `regua-outra-${MARCA}` } });
    // A Equipe: um Rodrigo, um Lucas, dois Pedros (ambíguo: e-mail nulo).
    for (const [nome, email] of [
      ['Rodrigo Teste', `rodrigo-${MARCA}@casa.teste`],
      ['Lucas Teste', `lucas-${MARCA}@casa.teste`],
      ['Pedro Um', `pedro1-${MARCA}@casa.teste`],
      ['Pedro Dois', `pedro2-${MARCA}@casa.teste`],
    ]) {
      await prisma.user.create({ data: { orgId: CASA, name: nome, email, passwordHash: 'x' } });
    }
    regua = novoServico();
  });

  afterAll(async () => {
    for (const orgId of [CASA, OUTRA]) {
      await prisma.auditLog.deleteMany({ where: { orgId } });
      await prisma.agendaRegraPessoa.deleteMany({ where: { orgId } });
      await prisma.agendaRito.deleteMany({ where: { orgId } });
      await prisma.feriado.deleteMany({ where: { orgId } });
      await prisma.agendaRegraTexto.deleteMany({ where: { orgId } });
      await prisma.user.deleteMany({ where: { orgId } });
      await prisma.org.deleteMany({ where: { id: orgId } });
    }
    await prisma.$disconnect();
  });

  it('semeia a casa com os valores do desenho Regras', async () => {
    const r = await regua.regras(CASA, { podeEditar: true });
    expect(r.podeEditar).toBe(true);
    expect(r.pessoas.map((p) => [p.nome, p.janela.inicio, p.janela.fim, p.intervaloMin, p.trajetoMin, p.tetoPorDia, p.substituto, p.area])).toEqual([
      ['Rodrigo', '08:00', '19:00', 15, 30, 5, 'Lucas', 'onboarding e contrato'],
      ['Lucas', '09:00', '18:00', 15, 30, 4, 'Rodrigo', 'marca e marketing'],
      ['Pedro', '08:30', '18:00', 10, 30, 5, 'Rodrigo', 'FinOps'],
    ]);
    const rodrigo = r.pessoas[0];
    expect(rodrigo.bloqueiosFixos).toEqual([{ diaDaSemana: 4, inicio: '19:00', fim: null }]);
    // Fechado ligado, mas SEM e-mail pessoal: quem cadastra é o Rodrigo.
    expect(rodrigo.fechadoLigado).toBe(true);
    expect(rodrigo.emailPessoal).toBeNull();
    // O e-mail no OS vem da Equipe pelo primeiro nome; dois Pedros = nenhum.
    expect(rodrigo.email).toBe(`rodrigo-${MARCA}@casa.teste`);
    expect(r.pessoas[1].email).toBe(`lucas-${MARCA}@casa.teste`);
    expect(r.pessoas[2].email).toBeNull();

    expect(r.ritos.map((x) => [x.nome, x.diaDaSemana, x.ordinalNoMes, x.inicio, x.duracaoMin, x.politica, x.aDecidir])).toEqual([
      ['Reunião Interna - Todos (pauta da semana)', 2, null, '08:00', 60, 'pergunta', true],
      ['Reunião Interna - Todos (estrutura fixa)', 4, null, '19:30', 90, 'bloqueia', false],
      ['Sábado da Root', 6, 1, null, 1440, 'bloqueia', false],
    ]);

    expect(r.feriados).toHaveLength(sementeDosFeriados().length);
    expect(r.feriados.find((f) => f.data === '2026-11-02')).toMatchObject({ nome: 'Finados', tipo: 'nacional', ligado: true });
    const facultativos = r.feriados.filter((f) => f.tipo === 'facultativo');
    expect(new Set(facultativos.map((f) => f.nome))).toEqual(new Set(['Carnaval', 'Corpus Christi']));
    expect(facultativos.every((f) => !f.ligado)).toBe(true);
    expect(r.feriados.some((f) => f.data.startsWith('2027-'))).toBe(true);

    expect(r.textos.map((t) => t.ligada)).toEqual([true, true, false]);
    expect(r.textos[0].frase).toBe('Cliente novo só depois das 10h na segunda.');
  });

  it('semear de novo não duplica nem passa por cima do que foi editado', async () => {
    const antes = await regua.regras(CASA);
    await regua.alterarPessoa(CASA, QUEM, antes.pessoas[1].id, { tetoPorDia: 6 });
    const outroProcesso = novoServico();
    const depois = await outroProcesso.regras(CASA);
    expect(depois.pessoas).toHaveLength(3);
    expect(depois.ritos).toHaveLength(SEMENTE_DOS_RITOS.length);
    expect(depois.feriados).toHaveLength(antes.feriados.length);
    expect(depois.textos).toHaveLength(3);
    expect(depois.pessoas[1].tetoPorDia).toBe(6);
  });

  it('fora da casa nada é semeado: listas vazias', async () => {
    const r = await regua.regras(OUTRA, { podeEditar: false });
    expect(r).toEqual({ pessoas: [], ritos: [], feriados: [], textos: [], podeEditar: false });
    expect(await prisma.agendaRegraPessoa.count({ where: { orgId: OUTRA } })).toBe(0);
  });

  it('alterar a régua de um sócio grava e audita o antes e o depois', async () => {
    const r = await regua.regras(CASA);
    const pedro = r.pessoas.find((p) => p.nome === 'Pedro')!;
    const novo = await regua.alterarPessoa(CASA, QUEM, pedro.id, {
      janela: { inicio: '09:00', fim: '17:30' },
      emailPessoal: 'pedro.pessoal@pessoal.teste',
      fechadoLigado: true,
      bloqueiosFixos: [{ diaDaSemana: 5, inicio: '16:00', fim: '18:00' }],
    });
    expect(novo).toMatchObject({ janela: { inicio: '09:00', fim: '17:30' }, emailPessoal: 'pedro.pessoal@pessoal.teste', fechadoLigado: true });
    expect(novo.bloqueiosFixos).toEqual([{ diaDaSemana: 5, inicio: '16:00', fim: '18:00' }]);
    const a = await prisma.auditLog.findFirst({ where: { orgId: CASA, action: 'agenda.regras.pessoa', entityId: pedro.id }, orderBy: { createdAt: 'desc' } });
    expect(a?.actorId).toBe(QUEM.id);
    expect((a?.before as { janelaInicio: string }).janelaInicio).toBe('08:30');
    expect((a?.after as { janelaInicio: string }).janelaInicio).toBe('09:00');
  });

  it('o substituto é outro sócio', async () => {
    const r = await regua.regras(CASA);
    await expect(regua.alterarPessoa(CASA, QUEM, r.pessoas[0].id, { substituto: 'Rodrigo' })).rejects.toThrow(/outro sócio/);
  });

  it('salvar o horário do rito tira o [a decidir]', async () => {
    const r = await regua.regras(CASA);
    const terca = r.ritos.find((x) => x.aDecidir)!;
    const novo = await regua.alterarRito(CASA, QUEM, terca.id, { inicio: '08:00' });
    expect(novo.aDecidir).toBe(false);
    expect(await prisma.auditLog.count({ where: { orgId: CASA, action: 'agenda.regras.rito', entityId: terca.id } })).toBe(1);
    const de = await regua.alterarRito(CASA, QUEM, terca.id, { aDecidir: true });
    expect(de.aDecidir).toBe(true);
  });

  it('feriado municipal se cadastra; feriado se liga e desliga; nada some', async () => {
    const f = await regua.criarFeriado(CASA, QUEM, { data: '2026-05-31', nome: 'Aniversário da cidade', cidade: 'Cidade Fictícia' });
    expect(f).toMatchObject({ tipo: 'municipal', cidade: 'Cidade Fictícia', ligado: true });
    // Repetir o mesmo devolve o mesmo, sem duplicar.
    expect((await regua.criarFeriado(CASA, QUEM, { data: '2026-05-31', nome: 'Aniversário da cidade', cidade: 'Cidade Fictícia' })).id).toBe(f.id);
    const desligado = await regua.alterarFeriado(CASA, QUEM, f.id, { ligado: false });
    expect(desligado.ligado).toBe(false);
    expect(await prisma.auditLog.count({ where: { orgId: CASA, entityId: f.id } })).toBe(2);
  });

  it('regras em frase: criar e desligar, auditado', async () => {
    const t = await regua.criarTexto(CASA, QUEM, { frase: 'Nada de reunião na hora do almoço.' });
    expect(t.ligada).toBe(true);
    const d = await regua.alterarTexto(CASA, QUEM, t.id, { ligada: false });
    expect(d).toMatchObject({ frase: 'Nada de reunião na hora do almoço.', ligada: false });
    expect(await prisma.auditLog.count({ where: { orgId: CASA, entityId: t.id } })).toBe(2);
  });

  it('isolamento: a regra de uma empresa não se lê nem se altera pela outra', async () => {
    const r = await regua.regras(CASA);
    await expect(regua.alterarPessoa(OUTRA, QUEM, r.pessoas[0].id, { tetoPorDia: 1 })).rejects.toThrow(/não existe nesta empresa/);
    await expect(regua.alterarRito(OUTRA, QUEM, r.ritos[0].id, { ligado: false })).rejects.toThrow(/não existe nesta empresa/);
    await expect(regua.alterarFeriado(OUTRA, QUEM, r.feriados[0].id, { ligado: false })).rejects.toThrow(/não existe nesta empresa/);
    await expect(regua.alterarTexto(OUTRA, QUEM, r.textos[0].id, { ligada: false })).rejects.toThrow(/não existe nesta empresa/);
    expect((await regua.regras(CASA)).pessoas[0].tetoPorDia).toBe(5);
    // O que a outra cadastra fica nela.
    await regua.criarTexto(OUTRA, QUEM, { frase: 'Regra só da outra empresa.' });
    expect((await regua.regras(CASA)).textos.some((t) => t.frase === 'Regra só da outra empresa.')).toBe(false);
    expect((await regua.regras(OUTRA)).textos.map((t) => t.frase)).toEqual(['Regra só da outra empresa.']);
  });

  it('avaliar lê o espelho em volta do compromisso e chama o mesmo motor', async () => {
    eventosDoEspelho = [ev('pm', 'Reunião Online - Clinimodelo - Rodrigo', '2026-11-04', '09:00', '10:00')];
    pedidos.length = 0;
    const p = { tipo: 'cliente' as const, modalidade: 'online' as const, responsaveis: ['Rodrigo' as const], inicio: sp('2026-11-04', '09:30'), fim: sp('2026-11-04', '10:30') };
    const r = await regua.avaliar(CASA, p, new Date(sp('2026-11-01', '10:00')));
    expect(r.cor).toBe('vermelho');
    expect(r.itens[0]).toMatchObject({ regra: 'choque', eventoId: 'pm' });
    expect(pedidos[0].de.getTime()).toBeLessThan(new Date(p.inicio).getTime());
    expect(pedidos[0].ate.getTime()).toBeGreaterThan(new Date(p.fim).getTime());
    // O próprio evento fora da conta.
    expect((await regua.avaliar(CASA, { ...p, ignorarEventoId: 'pm' }, new Date(sp('2026-11-01', '10:00')))).cor).toBe('verde');
  });

  it('livres: só horários verdes, sem título', async () => {
    eventosDoEspelho = [ev('x', 'Reunião Online - Segredo - Lucas', '2026-11-04', '10:00', '11:00')];
    const d = await regua.livres(
      CASA,
      { socio: 'Lucas', tipo: 'cliente', modalidade: 'online', duracaoMin: 60, de: '2026-11-04', ate: '2026-11-04' },
      new Date(sp('2026-11-03', '20:00')),
    );
    expect(d).toHaveLength(1);
    expect(d[0].manha).toEqual(['11:30']);
    expect(JSON.stringify(d)).not.toContain('Segredo');
  });

  it('usuarioDoSocio só casa um nome inteiro, uma pessoa', () => {
    const us = [{ id: '1', name: 'Rodrigo S' }, { id: '2', name: 'Rodriguinho' }, { id: '3', name: 'Lucas A' }, { id: '4', name: 'lúcas b' }];
    expect(usuarioDoSocio('Rodrigo', us)?.id).toBe('1');
    expect(usuarioDoSocio('Lucas', us)).toBeNull();
    expect(usuarioDoSocio('Pedro', us)).toBeNull();
  });
});

describe('a validação das rotas da régua (os limites dos CHECKs)', () => {
  it('hora HH:MM, janela em ordem, números nos limites', () => {
    expect(PessoaAlterarSchema.safeParse({ janela: { inicio: '25:00', fim: '18:00' } }).success).toBe(false);
    expect(PessoaAlterarSchema.safeParse({ janela: { inicio: '18:00', fim: '09:00' } }).success).toBe(false);
    expect(PessoaAlterarSchema.safeParse({ tetoPorDia: 31 }).success).toBe(false);
    expect(PessoaAlterarSchema.safeParse({ intervaloMin: 241 }).success).toBe(false);
    expect(PessoaAlterarSchema.safeParse({ trajetoMin: -1 }).success).toBe(false);
    expect(PessoaAlterarSchema.safeParse({ nome: 'Outro' }).success).toBe(false);
    expect(PessoaAlterarSchema.safeParse({ emailPessoal: 'não é e-mail' }).success).toBe(false);
    expect(PessoaAlterarSchema.parse({ emailPessoal: ' Rodrigo@Pessoal.Teste ' }).emailPessoal).toBe('rodrigo@pessoal.teste');
    expect(PessoaAlterarSchema.safeParse({ bloqueiosFixos: [{ diaDaSemana: 7, inicio: '19:00' }] }).success).toBe(false);
  });

  it('rito, feriado, proposta e livres', () => {
    expect(RitoAlterarSchema.safeParse({ ordinalNoMes: 6 }).success).toBe(false);
    expect(RitoAlterarSchema.safeParse({ duracaoMin: 4 }).success).toBe(false);
    expect(RitoAlterarSchema.safeParse({ quem: 'Todos' }).success).toBe(true);
    expect(FeriadoCriarSchema.safeParse({ data: '2026-02-30', nome: 'X', cidade: 'Y' }).success).toBe(false);
    expect(FeriadoCriarSchema.safeParse({ data: '2026-05-31', nome: 'Aniversário', cidade: 'Cidade', tipo: 'nacional' }).success).toBe(false);
    expect(PropostaSchema.safeParse({ tipo: 'cliente', responsaveis: ['Fulano'], inicio: sp('2026-11-04', '10:00'), fim: sp('2026-11-04', '11:00') }).success).toBe(false);
    expect(PropostaSchema.safeParse({ tipo: 'cliente', responsaveis: ['Rodrigo'], inicio: sp('2026-11-04', '11:00'), fim: sp('2026-11-04', '10:00') }).success).toBe(false);
    expect(LivresQuerySchema.parse({ socio: 'Pedro', de: '2026-11-04', ate: '2026-11-06' })).toMatchObject({ tipo: 'cliente', modalidade: 'online', duracao: 60 });
    expect(LivresQuerySchema.safeParse({ socio: 'Pedro', de: '2026-11-06', ate: '2026-11-04' }).success).toBe(false);
  });
});
