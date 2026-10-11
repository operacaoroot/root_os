import { randomBytes } from 'node:crypto';

import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  TOTEM_ALFABETO_CROCKFORD,
  TOTEM_CPF_ANONIMIZADO,
  TOTEM_MENSAGEM_ACEITE,
  TOTEM_MENSAGEM_CELULAR_INVALIDO,
  TOTEM_MENSAGEM_CPF_INVALIDO,
  TOTEM_POLITICA_A_CONFIRMAR,
  TOTEM_POLITICA_VERSAO,
  TOTEM_TAMANHO_CODIGO_CUPOM,
  TotemCadastroCorpoSchema,
  TotemCodigoCupomSchema,
  totemCpfValido,
  totemMascararCelular,
  totemMascararCpf,
  totemMontarPolitica,
  totemNormalizarCelular,
  totemStatusEfetivoDoCupom,
} from '@mktos/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { cadastrarCliente, finalidadesDoConsentimento, type EntradaDoCadastro } from '../src/totem/cadastro/cadastrar';
import { anonimizarCliente, anonimizarInativos, limiteDeInatividade, revogarCampanhas } from '../src/totem/cadastro/clientes';
import { hashDoCpf, lerPepper } from '../src/totem/cadastro/cpf';
import {
  campanhaGerenciavel,
  campanhaValeNaLoja,
  campanhaVisivel,
  cancelarCupom,
  darBaixaNoCupom,
} from '../src/totem/cadastro/cupons';
import { gerarCodigo } from '../src/totem/comum/segredos';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * MÓDULO TOTEM — CADASTRO, CUPOM E CAMPANHAS (frente D, CONTRATO.md seção 9).
 *
 * A primeira metade é regra pura (CPF, celular, HMAC, código, escopo, política)
 * e roda sempre. A segunda grava no Postgres de `TEST_DATABASE_URL`, em duas
 * empresas só desta suíte, e confere o que a regra pura não alcança: a linha
 * gravada sem CPF em claro, um cupom por pessoa e campanha, a campanha de outra
 * loja que não emite, o cupom vencido sem baixa e a anonimização.
 */

/** Monta um CPF válido a partir de nove dígitos, para cada caso ter o seu. */
function cpfDe(nove: string): string {
  const d = nove.split('').map(Number);
  const dv = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i += 1) soma += d[i]! * (n + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  d.push(dv(9));
  d.push(dv(10));
  return d.join('');
}

describe('cadastro: CPF', () => {
  it('aceita o CPF com os dígitos verificadores certos, com ou sem pontuação', () => {
    expect(totemCpfValido('529.982.247-25')).toBe(true);
    expect(totemCpfValido('52998224725')).toBe(true);
    expect(totemCpfValido(cpfDe('123456789'))).toBe(true);
  });

  it('recusa dígito verificador errado, dígitos repetidos e tamanho errado', () => {
    expect(totemCpfValido('529.982.247-24')).toBe(false);
    expect(totemCpfValido('529.982.247-35')).toBe(false);
    expect(totemCpfValido('111.111.111-11')).toBe(false);
    expect(totemCpfValido('5299822472')).toBe(false);
    expect(totemCpfValido('529982247250')).toBe(false);
    expect(totemCpfValido('')).toBe(false);
  });

  it('mascara mostrando só os seis dígitos do meio', () => {
    expect(totemMascararCpf('529.982.247-25')).toBe('***.982.247-**');
    expect(totemMascararCpf('52998224725')).not.toMatch(/529|25$/);
  });
});

describe('cadastro: celular', () => {
  it('normaliza para E.164 com ou sem o 55 e com o zero de longa distância', () => {
    expect(totemNormalizarCelular('(27) 99876-5432')).toBe('+5527998765432');
    expect(totemNormalizarCelular('+55 27 99876-5432')).toBe('+5527998765432');
    expect(totemNormalizarCelular('027 99876 5432')).toBe('+5527998765432');
  });

  it('recusa fixo, DDD inexistente e número curto', () => {
    expect(totemNormalizarCelular('(27) 3333-4444')).toBeNull();
    expect(totemNormalizarCelular('(27) 39876-5432')).toBeNull();
    expect(totemNormalizarCelular('(20) 99876-5432')).toBeNull();
    expect(totemNormalizarCelular('99876-5432')).toBeNull();
  });

  it('mascara o meio do número e devolve null para o celular apagado', () => {
    expect(totemMascararCelular('+5527998765432')).toBe('(27) 9****-5432');
    expect(totemMascararCelular('')).toBeNull();
  });
});

describe('cadastro: o corpo da rota pública', () => {
  const valido = {
    cpf: '529.982.247-25',
    telefone: '(27) 99876-5432',
    aceitePolitica: true,
    politicaVersao: TOTEM_POLITICA_VERSAO,
  };

  it('devolve o CPF só com dígitos, o celular em E.164, o nome vazio como null e campanhas desligadas', () => {
    const r = TotemCadastroCorpoSchema.parse({ ...valido, nome: '  ' });
    expect(r).toEqual({
      cpf: '52998224725',
      telefone: '+5527998765432',
      nome: null,
      aceitePolitica: true,
      aceitaCampanhas: false,
      politicaVersao: TOTEM_POLITICA_VERSAO,
    });
  });

  it('sem o aceite da política, recusa com a frase da tela', () => {
    const r = TotemCadastroCorpoSchema.safeParse({ ...valido, aceitePolitica: false });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toContain(TOTEM_MENSAGEM_ACEITE);
  });

  it('CPF e celular inválidos voltam com a frase de cada um', () => {
    const r = TotemCadastroCorpoSchema.safeParse({ ...valido, cpf: '529.982.247-24', telefone: '2733334444' });
    expect(r.success).toBe(false);
    const mensagens = r.error?.issues.map((i) => i.message) ?? [];
    expect(mensagens).toContain(TOTEM_MENSAGEM_CPF_INVALIDO);
    expect(mensagens).toContain(TOTEM_MENSAGEM_CELULAR_INVALIDO);
  });
});

describe('cadastro: HMAC do CPF', () => {
  const pepper = 'p'.repeat(40);

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('é determinístico, tem 64 caracteres hexadecimais e não contém o CPF', () => {
    const a = hashDoCpf(pepper, '52998224725');
    expect(a).toBe(hashDoCpf(pepper, '52998224725'));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain('52998224725');
    expect(a).not.toBe(hashDoCpf(pepper, '12345678909'));
  });

  it('muda com o pepper, então quem tem só o banco não recalcula', () => {
    expect(hashDoCpf(pepper, '52998224725')).not.toBe(hashDoCpf('q'.repeat(40), '52998224725'));
  });

  it('pepper ausente ou curto é tratado como ausente', () => {
    vi.stubEnv('TOTEM_CPF_PEPPER', '');
    expect(lerPepper()).toBeNull();
    vi.stubEnv('TOTEM_CPF_PEPPER', 'curto-demais');
    expect(lerPepper()).toBeNull();
    vi.stubEnv('TOTEM_CPF_PEPPER', pepper);
    expect(lerPepper()).toBe(pepper);
  });
});

describe('cupom: o código', () => {
  it('nunca tem I, L, O ou U, e tem o tamanho do cupom', () => {
    for (let i = 0; i < 2000; i += 1) {
      const c = gerarCodigo(TOTEM_TAMANHO_CODIGO_CUPOM);
      expect(c).toHaveLength(TOTEM_TAMANHO_CODIGO_CUPOM);
      expect(c).not.toMatch(/[ILOU]/);
      for (const ch of c) expect(TOTEM_ALFABETO_CROCKFORD).toContain(ch);
    }
  });

  it('o caixa digita minúsculo, com hífen ou com O no lugar de 0 e acha o mesmo código', () => {
    expect(TotemCodigoCupomSchema.parse('abcd-efg0')).toBe('ABCDEFG0');
    expect(TotemCodigoCupomSchema.parse('abcd efgo')).toBe('ABCDEFG0');
    expect(TotemCodigoCupomSchema.safeParse('ABCDEFGU').success).toBe(false);
  });

  it('cupom emitido depois da validade conta como vencido', () => {
    const agora = new Date('2026-10-11T12:00:00Z');
    expect(totemStatusEfetivoDoCupom('emitido', new Date('2026-10-11T11:59:59Z'), agora)).toBe('expirado');
    expect(totemStatusEfetivoDoCupom('emitido', new Date('2026-10-12T00:00:00Z'), agora)).toBe('emitido');
    expect(totemStatusEfetivoDoCupom('usado', new Date('2026-10-01T00:00:00Z'), agora)).toBe('usado');
  });
});

describe('campanha: o escopo de lojas', () => {
  it('quem tem uma loja da campanha vê; campanha de todas as lojas todo mundo vê', () => {
    expect(campanhaVisivel(['l1'], ['l1', 'l2'])).toBe(true);
    expect(campanhaVisivel(['l3'], ['l1', 'l2'])).toBe(false);
    expect(campanhaVisivel(['l3'], [])).toBe(true);
    expect(campanhaVisivel('todas', ['l1'])).toBe(true);
  });

  it('mexer exige todas as lojas da campanha no escopo, e "todas as lojas" só para a rede', () => {
    expect(campanhaGerenciavel(['l1', 'l2'], ['l1', 'l2'])).toBe(true);
    expect(campanhaGerenciavel(['l1'], ['l1', 'l2'])).toBe(false);
    expect(campanhaGerenciavel(['l1'], [])).toBe(false);
    expect(campanhaGerenciavel('todas', [])).toBe(true);
  });

  it('o cupom vale nas lojas da campanha ou em qualquer uma quando a lista é vazia', () => {
    expect(campanhaValeNaLoja(['l1'], 'l1')).toBe(true);
    expect(campanhaValeNaLoja(['l1'], 'l2')).toBe(false);
    expect(campanhaValeNaLoja([], 'l2')).toBe(true);
  });

  it('o consentimento leva "campanhas" só quando a pessoa marcou a caixa', () => {
    expect(finalidadesDoConsentimento(false)).toEqual(['cupom']);
    expect(finalidadesDoConsentimento(true)).toEqual(['cupom', 'campanhas']);
  });
});

describe('anonimização e política', () => {
  it('o limite de inatividade fica 24 meses antes', () => {
    expect(limiteDeInatividade(new Date('2026-10-11T12:00:00Z')).toISOString()).toBe('2024-10-11T12:00:00.000Z');
  });

  it('a política sem configuração marca os dados da empresa como a confirmar', () => {
    const p = totemMontarPolitica();
    expect(p.versao).toBe(TOTEM_POLITICA_VERSAO);
    expect(p.publicadaEm).toBe('11/10/2026');
    expect(p.camposAConfirmar).toHaveLength(4);
    expect(JSON.stringify(p.secoes)).toContain(TOTEM_POLITICA_A_CONFIRMAR);
  });

  it('a política com a configuração completa não tem nada a confirmar', () => {
    const p = totemMontarPolitica({
      controladorNome: 'Loja Exemplo',
      controladorDocumento: '00.000.000/0001-00',
      controladorEndereco: 'Rua Exemplo, 1',
      encarregadoNome: 'Fulana',
      encarregadoContato: 'privacidade@exemplo.com',
    });
    expect(p.camposAConfirmar).toEqual([]);
    expect(JSON.stringify(p)).not.toContain(TOTEM_POLITICA_A_CONFIRMAR);
    expect(p.controlador).toBe('Loja Exemplo');
  });
});

/* ==========================================================================
 * Contra o Postgres
 * ========================================================================== */

const URL = process.env.TEST_DATABASE_URL;
const ORG = 'org-teste-totem-cadastro';
const VIZINHA = 'org-teste-totem-cadastro-vizinha';

exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (lojas, campanhas, clientes e cupons do totem)');

describe.skipIf(!URL)('cadastro e cupom contra o Postgres', () => {
  let prisma: PrismaClient;
  const PEPPER = randomBytes(24).toString('hex');
  const TELEFONE = '+5527998765432';
  let loja1: string;
  let loja2: string;
  let campanha: string;

  async function limpar(): Promise<void> {
    const orgs = { orgId: { in: [ORG, VIZINHA] } };
    await prisma.totemCupom.deleteMany({ where: orgs });
    await prisma.totemConsentimento.deleteMany({ where: orgs });
    await prisma.totemCliente.deleteMany({ where: orgs });
    await prisma.totemCampanha.deleteMany({ where: orgs });
    await prisma.totemLoja.deleteMany({ where: orgs });
  }

  /** Transação com a empresa declarada, igual à do serviço. */
  function naEmpresa<T>(orgId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, true)`, orgId);
      return fn(tx);
    });
  }

  function entrada(cpf: string, extra: Partial<EntradaDoCadastro> = {}): EntradaDoCadastro {
    return {
      orgId: ORG,
      lojaId: loja1,
      dispositivoId: null,
      canal: 'totem',
      cpfHash: hashDoCpf(PEPPER, cpf),
      cpfMascarado: totemMascararCpf(cpf),
      telefone: TELEFONE,
      nome: null,
      aceitaCampanhas: false,
      politicaVersao: TOTEM_POLITICA_VERSAO,
      ...extra,
    };
  }

  const cadastrar = (e: EntradaDoCadastro) => naEmpresa(e.orgId, (tx) => cadastrarCliente(tx, e));

  function clienteDoCpf(cpf: string) {
    return prisma.totemCliente.findUnique({
      where: { orgId_cpfHash: { orgId: ORG, cpfHash: hashDoCpf(PEPPER, cpf) } },
    });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    for (const id of [ORG, VIZINHA]) {
      await prisma.org.upsert({ where: { id }, create: { id, name: id, slug: id }, update: {} });
    }
    await limpar();
    loja1 = (await prisma.totemLoja.create({ data: { orgId: ORG, codigo: 'D1', nome: 'Loja D1' } })).id;
    loja2 = (await prisma.totemLoja.create({ data: { orgId: ORG, codigo: 'D2', nome: 'Loja D2' } })).id;
    await prisma.totemLoja.create({ data: { orgId: VIZINHA, codigo: 'V1', nome: 'Loja V1' } });
    const ontem = new Date(Date.now() - 86_400_000);
    campanha = (
      await prisma.totemCampanha.create({
        data: {
          orgId: ORG,
          nome: 'Só na D1',
          chamada: 'Ganhe 10% na primeira compra',
          tipoBeneficio: 'percentual',
          valorBeneficio: 10,
          validadeDias: 30,
          inicioEm: ontem,
          lojaIds: [loja1],
        },
      })
    ).id;
    // Campanha de TODAS as lojas, mas da outra empresa: não pode valer na D2.
    await prisma.totemCampanha.create({
      data: {
        orgId: VIZINHA,
        nome: 'Da vizinha',
        chamada: 'Outra empresa',
        tipoBeneficio: 'valor',
        valorBeneficio: 5,
        validadeDias: 30,
        inicioEm: ontem,
        lojaIds: [],
      },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await limpar();
    await prisma.org.deleteMany({ where: { id: { in: [ORG, VIZINHA] } } });
    await prisma.$disconnect();
  });

  it('grava o HMAC e a máscara, nunca o CPF em claro, e a resposta não traz CPF nem celular', async () => {
    const cpf = cpfDe('100000001');
    const r = await cadastrar(entrada(cpf, { aceitaCampanhas: true, nome: 'Maria' }));
    expect(r.cupom).not.toBeNull();
    expect(JSON.stringify(r)).not.toContain(cpf);
    expect(JSON.stringify(r)).not.toContain('998765432');

    const cliente = await clienteDoCpf(cpf);
    expect(cliente).not.toBeNull();
    expect(cliente!.cpfHash).toBe(hashDoCpf(PEPPER, cpf));
    expect(cliente!.cpfMascarado).toBe(totemMascararCpf(cpf));

    const linhas = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT * FROM "TotemCliente" WHERE "orgId" = $1`,
      ORG,
    );
    const consentimentos = await prisma.totemConsentimento.findMany({ where: { orgId: ORG } });
    const cupons = await prisma.totemCupom.findMany({ where: { orgId: ORG } });
    for (const tudo of [linhas, consentimentos, cupons]) expect(JSON.stringify(tudo)).not.toContain(cpf);

    const consentimento = consentimentos.find((c) => c.clienteId === cliente!.id)!;
    expect(consentimento).toMatchObject({
      politicaVersao: TOTEM_POLITICA_VERSAO,
      finalidades: ['cupom', 'campanhas'],
      canal: 'totem',
      lojaId: loja1,
      revogadoEm: null,
    });
  });

  it('o mesmo CPF na mesma campanha recebe o mesmo cupom, sem consentimento repetido', async () => {
    const cpf = cpfDe('100000002');
    const a = await cadastrar(entrada(cpf));
    const b = await cadastrar(entrada(cpf));
    expect(a.cupom?.codigo).toBeTruthy();
    expect(b.cupom?.codigo).toBe(a.cupom?.codigo);
    const cliente = await clienteDoCpf(cpf);
    const cupons = await prisma.totemCupom.findMany({ where: { orgId: ORG, clienteId: cliente!.id } });
    expect(cupons.map((c) => c.campanhaId)).toEqual([campanha]);
    expect(await prisma.totemConsentimento.count({ where: { orgId: ORG, clienteId: cliente!.id } })).toBe(1);
  });

  it('campanha de outra loja, ou de outra empresa, não emite cupom', async () => {
    const cpf = cpfDe('100000003');
    const r = await cadastrar(entrada(cpf, { lojaId: loja2 }));
    expect(r).toEqual({ cupom: null, motivoSemCupom: 'sem_campanha' });
    const cliente = await clienteDoCpf(cpf);
    expect(await prisma.totemCupom.count({ where: { clienteId: cliente!.id } })).toBe(0);
  });

  it('celular diferente para um CPF já cadastrado não troca o número gravado', async () => {
    const cpf = cpfDe('100000004');
    await cadastrar(entrada(cpf));
    await cadastrar(entrada(cpf, { telefone: '+5511912345678' }));
    expect((await clienteDoCpf(cpf))!.telefone).toBe(TELEFONE);
  });

  it('versão nova da política revoga o consentimento antigo e grava outro', async () => {
    const cpf = cpfDe('100000005');
    await cadastrar(entrada(cpf, { politicaVersao: '2026-01-01' }));
    await cadastrar(entrada(cpf));
    const cliente = await clienteDoCpf(cpf);
    const todos = await prisma.totemConsentimento.findMany({ where: { clienteId: cliente!.id } });
    expect(todos).toHaveLength(2);
    expect(todos.filter((c) => c.revogadoEm === null).map((c) => c.politicaVersao)).toEqual([TOTEM_POLITICA_VERSAO]);
  });

  it('a baixa usa o cupom uma vez só, e o cadastro seguinte diz que ele já foi usado', async () => {
    const cpf = cpfDe('100000006');
    const r = await cadastrar(entrada(cpf));
    const codigo = r.cupom!.codigo;
    const pedido = { orgId: ORG, codigo, lojaId: loja1, usuarioId: 'u-caixa', escopo: 'todas' as const };

    await naEmpresa(ORG, (tx) => darBaixaNoCupom(tx, pedido));
    const usado = await prisma.totemCupom.findUnique({ where: { orgId_codigo: { orgId: ORG, codigo } } });
    expect(usado).toMatchObject({ status: 'usado', usadoLojaId: loja1, usadoPor: 'u-caixa' });

    await expect(naEmpresa(ORG, (tx) => darBaixaNoCupom(tx, pedido))).rejects.toThrow(/já foi usado/);
    expect(await cadastrar(entrada(cpf))).toEqual({ cupom: null, motivoSemCupom: 'cupom_usado' });
  });

  it('cupom vencido não tem baixa nem cancelamento, e continua gravado como estava', async () => {
    const cpf = cpfDe('100000007');
    const r = await cadastrar(entrada(cpf));
    const codigo = r.cupom!.codigo;
    await prisma.totemCupom.update({
      where: { orgId_codigo: { orgId: ORG, codigo } },
      data: { validoAte: new Date(Date.now() - 60_000) },
    });

    const baixa = naEmpresa(ORG, (tx) =>
      darBaixaNoCupom(tx, { orgId: ORG, codigo, lojaId: loja1, usuarioId: 'u-caixa', escopo: 'todas' }),
    );
    await expect(baixa).rejects.toBeInstanceOf(ConflictException);
    await expect(
      naEmpresa(ORG, (tx) => darBaixaNoCupom(tx, { orgId: ORG, codigo, lojaId: loja1, usuarioId: 'u', escopo: 'todas' })),
    ).rejects.toThrow(/venceu em \d{2}\/\d{2}\/\d{4}/);
    await expect(naEmpresa(ORG, (tx) => cancelarCupom(tx, { orgId: ORG, codigo, escopo: 'todas' }))).rejects.toThrow(
      /venceu/,
    );

    const gravado = await prisma.totemCupom.findUnique({ where: { orgId_codigo: { orgId: ORG, codigo } } });
    expect(gravado).toMatchObject({ status: 'emitido', usadoEm: null });
    expect(await cadastrar(entrada(cpf))).toEqual({ cupom: null, motivoSemCupom: 'cupom_vencido' });
  });

  it('o cupom não vale em loja fora da campanha, e fora do escopo do caixa nem aparece', async () => {
    const cpf = cpfDe('100000008');
    const codigo = (await cadastrar(entrada(cpf))).cupom!.codigo;
    await expect(
      naEmpresa(ORG, (tx) =>
        darBaixaNoCupom(tx, { orgId: ORG, codigo, lojaId: loja2, usuarioId: 'u', escopo: 'todas' }),
      ),
    ).rejects.toThrow('Este cupom não vale nesta loja.');
    await expect(
      naEmpresa(ORG, (tx) =>
        darBaixaNoCupom(tx, { orgId: ORG, codigo, lojaId: loja2, usuarioId: 'u', escopo: [loja2] }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      naEmpresa(VIZINHA, (tx) =>
        darBaixaNoCupom(tx, { orgId: VIZINHA, codigo, lojaId: loja1, usuarioId: 'u', escopo: 'todas' }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('revogar só as campanhas mantém o cadastro e o cupom', async () => {
    const cpf = cpfDe('100000009');
    const codigo = (await cadastrar(entrada(cpf, { aceitaCampanhas: true }))).cupom!.codigo;
    const cliente = (await clienteDoCpf(cpf))!;
    await naEmpresa(ORG, (tx) => revogarCampanhas(tx, ORG, cliente.id));

    const depois = (await clienteDoCpf(cpf))!;
    expect(depois.aceitaCampanhas).toBe(false);
    expect(depois.telefone).toBe(TELEFONE);
    const ativos = await prisma.totemConsentimento.findMany({ where: { clienteId: cliente.id, revogadoEm: null } });
    expect(ativos.map((c) => c.finalidades)).toEqual([['cupom']]);
    const cupom = await prisma.totemCupom.findUnique({ where: { orgId_codigo: { orgId: ORG, codigo } } });
    expect(cupom?.status).toBe('emitido');
  });

  it('anonimizar apaga o que leva à pessoa e guarda o histórico do cupom', async () => {
    const cpf = cpfDe('100000010');
    const codigo = (await cadastrar(entrada(cpf, { nome: 'João', aceitaCampanhas: true }))).cupom!.codigo;
    const antes = (await clienteDoCpf(cpf))!;

    expect(await naEmpresa(ORG, (tx) => anonimizarCliente(tx, ORG, antes.id))).toBe(true);
    const depois = await prisma.totemCliente.findUniqueOrThrow({ where: { id: antes.id } });
    expect(depois).toMatchObject({
      telefone: '',
      nome: null,
      cpfMascarado: TOTEM_CPF_ANONIMIZADO,
      aceitaCampanhas: false,
    });
    expect(depois.anonimizadoEm).not.toBeNull();
    expect(depois.cpfHash).not.toBe(antes.cpfHash);
    expect(await clienteDoCpf(cpf)).toBeNull();
    expect(await prisma.totemConsentimento.count({ where: { clienteId: antes.id, revogadoEm: null } })).toBe(0);
    const cupom = await prisma.totemCupom.findUnique({ where: { orgId_codigo: { orgId: ORG, codigo } } });
    expect(cupom?.clienteId).toBe(antes.id);

    // Um cadastro novo com o mesmo CPF vira outro cliente, sem ligação com o anonimizado.
    await cadastrar(entrada(cpf));
    const novo = (await clienteDoCpf(cpf))!;
    expect(novo.id).not.toBe(antes.id);
    expect(await naEmpresa(ORG, (tx) => anonimizarCliente(tx, ORG, 'nao-existe'))).toBe(false);
  });

  it('a anonimização em lote pega só o cadastro sem uso há mais de 24 meses', async () => {
    const parado = cpfDe('100000011');
    const ativo = cpfDe('100000012');
    await cadastrar(entrada(parado, { lojaId: loja2 }));
    await cadastrar(entrada(ativo, { lojaId: loja2 }));
    const idParado = (await clienteDoCpf(parado))!.id;
    const tresAnos = new Date(Date.now() - 3 * 365 * 86_400_000);
    await prisma.$executeRawUnsafe(
      `UPDATE "TotemCliente" SET "atualizadoEm" = $1, "criadoEm" = $1 WHERE id = $2`,
      tresAnos,
      idParado,
    );
    await prisma.totemConsentimento.updateMany({ where: { clienteId: idParado }, data: { aceitoEm: tresAnos } });

    const r = await naEmpresa(ORG, (tx) => anonimizarInativos(tx, ORG));
    expect(r.anonimizados).toBe(1);
    expect((await prisma.totemCliente.findUniqueOrThrow({ where: { id: idParado } })).anonimizadoEm).not.toBeNull();
    expect((await clienteDoCpf(ativo))!.anonimizadoEm).toBeNull();
  });
});
