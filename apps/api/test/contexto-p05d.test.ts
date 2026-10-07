import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextKind, type PrismaClient } from '@prisma/client';
import { MemoriaService, type NotaDeContexto, type NotaDaVaultParaProjetar } from '../src/memory/memoria.service';
import { chaveDaVault, hashDoCorpo } from '../src/memory/procedencia';
import { ObsidianService } from '../src/obsidian/obsidian.service';
import { lerNotaDaVault } from '../src/obsidian/cabecalho-da-nota';
import { assinaturaDoRecibo, deveRegistrar, resultadoDaVolta, type ReciboDaVault } from '../src/obsidian/recibo-da-vault';
import { semSigilosos, type EventLogService } from '../src/gateway/event-log.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ConectoresConfiguradosRegistry } from '../src/gateway/conectores-configurados.registry';
import { RegistroDeConectores } from '../src/integrations/conectores.registry';
import { liberarAGuarda } from '../src/scripts/liberar-guarda-da-vault';

afterEach(() => vi.restoreAllMocks());

// Dublês de persistência: a regra de projeção e o caminho até o recibo são reais.
function bancada() {
  const itens = new Map<string, NotaDeContexto & { orgId: string }>();
  const prisma = {
    contextItem: { findMany: vi.fn(async ({ where }) => [...itens.values()].filter((i) =>
      i.orgId === where.orgId && (!where.chave || where.chave.in.includes(i.chave)))), },
  } as unknown as PrismaService;
  const memoria = new MemoriaService(prisma, {} as EventLogService);
  vi.spyOn(memoria, 'liberacaoDaVault').mockResolvedValue(null);
  vi.spyOn(memoria, 'porChave').mockImplementation(async (orgId, chave) =>
    [...itens.values()].find((i) => i.orgId === orgId && i.chave === chave) ?? null);
  const criar = vi.spyOn(memoria, 'criar').mockImplementation(async (orgId, n) => {
    const item: NotaDeContexto & { orgId: string } = {
      orgId, id: `item-${itens.size}`, chave: n.chave, kind: n.kind ?? ContextKind.nota,
      title: n.title, body: n.body, tags: n.tags ?? [], sourceType: n.sourceType,
      sourceRef: n.sourceRef ?? null, procedencia: 'fixture',
      validFrom: n.validFrom?.toISOString() ?? null, validUntil: n.validUntil?.toISOString() ?? null,
      supersedesId: n.supersedesId ?? null, confidence: 1, contentHash: hashDoCorpo(n.body),
      versao: 1, temVetor: false, arquivadoEm: null, criadoEm: '', atualizadoEm: '',
    };
    itens.set(item.id, item);
    return item;
  });
  const alterar = vi.spyOn(memoria, 'alterar').mockImplementation(async (orgId, id, n) => {
    const item = itens.get(id)!;
    expect(item.orgId).toBe(orgId);
    Object.assign(item, n, {
      ...('validFrom' in n ? { validFrom: n.validFrom?.toISOString() ?? null } : {}),
      ...('validUntil' in n ? { validUntil: n.validUntil?.toISOString() ?? null } : {}),
      versao: item.versao + 1,
    });
    return item;
  });
  const obsidian = new ObsidianService(prisma, new ConectoresConfiguradosRegistry(),
    new RegistroDeConectores(), memoria);
  vi.spyOn(obsidian as never, 'vetorizarPendentesDaMemoria').mockResolvedValue(undefined as never);
  return { itens, memoria, obsidian, criar, alterar };
}

function nota(caminho: string, substitui: string | null): NotaDaVaultParaProjetar {
  return { caminho, title: caminho, body: `Conteúdo de ${caminho}`, tags: [],
    cabecalho: { kind: ContextKind.nota, validFrom: null, validUntil: null, substitui } };
}

function recibo(projecao: ReciboDaVault['projecao']): ReciboDaVault {
  return { colecao: 'vault:root-base', fonte: 'drive', inicioEm: '', fimEm: '',
    montante: { naoSeAplica: 'fixture' }, descoberta: { naoSeAplica: 'fixture' },
    leitura: { lidos: 1, reaproveitados: 0, falhas: 0 }, indexacao: null,
    vetorizacao: null, projecao, falha: null };
}

async function publicar(b: ReturnType<typeof bancada>, r: ReciboDaVault) {
  vi.spyOn(b.obsidian as never, 'gravarFrescor').mockResolvedValue(undefined as never);
  vi.spyOn(b.memoria, 'ultimoReciboDaVault').mockResolvedValue(null);
  const registrar = vi.spyOn(b.memoria, 'registrarReciboDaVault').mockResolvedValue({ id: 'recibo-fixture', seq: 1n });
  await b.obsidian['publicarRecibo']('casa', r, [], false);
  const entrada = registrar.mock.calls.at(-1)![1];
  const payload = entrada.payload as unknown as {
    recibo: { projecao: { avisos: Array<{ __sigiloso: boolean; valor: string }> } };
  };
  expect(payload.recibo.projecao.avisos.every((a) => a.__sigiloso === true)).toBe(true);
  return { entrada, payload, publico: JSON.stringify(semSigilosos(payload)) };
}

describe('P-05d: autoalvo e avisos entre coletor, projeção e recibo', () => {
  it('recusa autoalvo na primeira e segunda voltas, sem versão extra', async () => {
    const b = bancada();
    const n = nota('pasta/n.md', 'pasta/n.md');
    for (let volta = 0; volta < 2; volta++) {
      const r = await b.memoria.projetarDaVault('casa', [n]);
      expect([...b.itens.values()][0].supersedesId).toBeNull();
      expect(r.substituicoes).toEqual({ resolvidas: 0, semAlvo: 1 });
      expect(r.avisos).toHaveLength(1);
    }
    expect(b.criar).toHaveBeenCalledTimes(1);
    expect(b.alterar).not.toHaveBeenCalled();
  });

  it('corrige autoalvo já persistido e preserva identidade e texto', async () => {
    const b = bancada();
    const n = nota('pasta/n.md', 'pasta/n.md');
    await b.memoria.projetarDaVault('casa', [nota(n.caminho, null)]);
    const item = [...b.itens.values()][0];
    item.supersedesId = item.id;
    const antes = { id: item.id, chave: item.chave, body: item.body, contentHash: item.contentHash };
    const r = await b.memoria.projetarDaVault('casa', [n]);
    expect(item.supersedesId).toBeNull();
    expect(item).toMatchObject(antes);
    expect(r.alteradas).toBe(1);
    expect(r.avisos).toHaveLength(1);
  });

  // R1 do revisor: mesmo input de cache, com datas preservadas pelo dublê.
  it('limpa autoalvo persistido com cabeçalho reaproveitado e a segunda volta é idempotente', async () => {
    const b = bancada();
    const lida = { ...lerNotaDaVault('privado/n.md',
      '---\nkind: regra\nvalido_de: 2026-09-15\nvalido_ate: 2026-12-31\n---\nCorpo persistido'), fileTime: new Date(0) };
    await b.obsidian['projetarNaMemoria']('casa', [lida], new Map(), []);
    const item = [...b.itens.values()][0];
    item.supersedesId = item.id;
    const { supersedesId: _autoalvo, versao, ...preservado } = { ...item };
    b.alterar.mockClear();
    const vetor = vi.spyOn(b.memoria, 'gravarVetor').mockResolvedValue(1);
    const cache = { ...lida, cabecalho: undefined };
    const p = await b.obsidian['projetarNaMemoria']('casa', [cache], new Map(), []);
    expect.soft(item.supersedesId).toBeNull();
    expect.soft(p!.alteradas).toBe(1);
    expect.soft(p!.avisos).toHaveLength(1);
    expect(item).toMatchObject(preservado);
    expect(item.versao).toBe(versao + 1);
    expect(b.alterar).toHaveBeenCalledTimes(1);
    const mudanca = b.alterar.mock.calls[0][2];
    expect(mudanca).not.toHaveProperty('kind');
    expect(mudanca).not.toHaveProperty('validFrom');
    expect(mudanca).not.toHaveProperty('validUntil');
    const exportado = await publicar(b, recibo(p));
    expect(exportado.payload.recibo.projecao.avisos[0].valor).toMatch(/própria nota/);
    for (const privado of [item.id, lida.path, lida.content]) {
      expect(exportado.publico).not.toContain(privado);
      expect(exportado.entrada.resumo).not.toContain(privado);
    }
    const aposCorrecao = { ...item };
    const segunda = await b.obsidian['projetarNaMemoria']('casa', [cache], new Map(), []);
    expect(item).toEqual(aposCorrecao);
    expect(segunda!.alteradas).toBe(0);
    expect(segunda!.inalteradas).toBe(1);
    expect(segunda!.avisos).toEqual([]);
    expect(b.alterar).toHaveBeenCalledTimes(1);
    expect(vetor).not.toHaveBeenCalled();
  });

  it('mantém alvo diferente da mesma organização, inclusive criado na mesma volta', async () => {
    const b = bancada();
    const notas = [nota('a.md', 'b.md'), nota('b.md', 'c.md'), nota('c.md', null)];
    for (let volta = 0; volta < 2; volta++) {
      const r = await b.memoria.projetarDaVault('casa', notas);
      const a = await b.memoria.porChave('casa', chaveDaVault('a.md'));
      const alvo = await b.memoria.porChave('casa', chaveDaVault('b.md'));
      expect(a!.supersedesId).toBe(alvo!.id);
      expect(r.avisos).toEqual([]);
    }
  });

  it.each(['pasta/n.md', './n.md', '[[n]]', '[[#Seção]]', '../../fora.md', 'Repetida'])
  ('encaminha o motivo do leitor e mantém nulo: %s', async (substitui) => {
    const b = bancada();
    const caminhos = ['pasta/n.md', 'a/Repetida.md', 'b/Repetida.md'];
    const notas = caminhos.map((p, i) => ({ ...lerNotaDaVault(p,
      i === 0 ? `---\nsubstitui: ${substitui}\n---\nCorpo` : 'Outro corpo'), fileTime: new Date(0) }));
    for (let volta = 0; volta < 2; volta++) {
      const r = await b.obsidian['projetarNaMemoria']('casa', notas, new Map(), []);
      expect((await b.memoria.porChave('casa', chaveDaVault(caminhos[0])))!.supersedesId).toBeNull();
      expect(r!.substituicoes.semAlvo).toBe(1);
      expect(r!.avisos).toHaveLength(1);
      expect(r!.avisos[0]).toMatch(/própria nota|vazio depois|sai da raiz|mesmo nome/);
      const exportado = await publicar(b, recibo(r));
      expect(exportado.publico).not.toContain(caminhos[0]);
      expect(exportado.publico).not.toContain(substitui);
    }
  });

  it('leva kind/data inválidos ao recibo sob sigiloso e exporta sem texto privado', async () => {
    const b = bancada();
    const n = { ...lerNotaDaVault('privado/n.md',
      '---\nkind: tipo-secreto\nvalido_de: data-secreta\nvalido_ate: data-final-secreta\n---\nCorpo'), fileTime: new Date(0) };
    const p = await b.obsidian['projetarNaMemoria']('casa', [n], new Map(), []);
    expect(p!.avisos).toHaveLength(3);
    const item = [...b.itens.values()][0];
    expect(item.kind).toBe(ContextKind.nota);
    expect(item.validFrom).toBeNull();
    expect(item.validUntil).toBeNull();
    const { publico, entrada } = await publicar(b, recibo(p));
    for (const segredo of ['privado/n.md', 'tipo-secreto', 'data-secreta', 'data-final-secreta']) {
      expect(publico).not.toContain(segredo);
      expect(entrada.resumo).not.toContain(segredo);
    }
  });

  it('alvo de outra organização fica nulo e não revela ID nem conteúdo', async () => {
    const b = bancada();
    await b.memoria.projetarDaVault('outra', [nota('alvo.md', null)]);
    const privado = [...b.itens.values()][0];
    const r = await b.memoria.projetarDaVault('casa', [nota('n.md', 'alvo.md')]);
    expect((await b.memoria.porChave('casa', 'vault:n.md'))!.supersedesId).toBeNull();
    expect(r.substituicoes.semAlvo).toBe(1);
    expect(JSON.stringify(r)).not.toContain(privado.id);
    expect(JSON.stringify(r)).not.toContain(privado.body);
  });

  it('respeita a consulta autorizada sem resultado e não procura IDs em outra empresa', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const memoria = new MemoriaService({ contextItem: { findFirst } } as unknown as PrismaService, {} as EventLogService);
    expect(await memoria.porChave('casa', 'vault:restrita.md')).toBeNull();
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { orgId: 'casa', chave: 'vault:restrita.md', OR: [{ acessoRestrito: false }] },
    }));
  });

  it('CLI de guarda mostra contagens sem listar os avisos privados do recibo', async () => {
    const b = bancada();
    const n = { ...lerNotaDaVault('privado/n.md', '---\nkind: tipo-secreto\n---\nCorpo'), fileTime: new Date(0) };
    const p = await b.obsidian['projetarNaMemoria']('casa', [n], new Map(), []);
    const { payload } = await publicar(b, recibo(p));
    const linhas: string[] = [];
    const prisma = {
      org: { findFirst: vi.fn().mockResolvedValue({ id: 'casa', slug: 'root' }) },
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'usuario', email: 'fixture@example.test',
        roles: [{ permissions: [{ key: 'obsidian.editar' }] }] }) },
      eventLog: { findFirst: vi.fn().mockResolvedValue({ id: 'recibo-fixture', ocorreuEm: new Date(0), payload }) },
    } as unknown as PrismaClient;
    await liberarAGuarda(prisma, { como: 'usuario', motivo: 'fixture', simular: true }, (linha) => linhas.push(linha));
    expect(linhas.join('\n')).toContain('arquivamentos segurados: 0');
    expect(linhas.join('\n')).not.toContain('privado/n.md');
    expect(linhas.join('\n')).not.toContain('tipo-secreto');
  });

  it('cabeçalho não relido conserva a referência válida e não cria versão', async () => {
    const b = bancada();
    const notas = [{ ...nota('a.md', 'b.md'), cabecalho: { kind: ContextKind.regra,
      validFrom: new Date('2026-09-15'), validUntil: new Date('2026-12-31'), substitui: 'b.md' } },
      nota('b.md', null)];
    await b.memoria.projetarDaVault('casa', notas);
    b.alterar.mockClear();
    const antes = { ...(await b.memoria.porChave('casa', 'vault:a.md'))! };
    const r = await b.memoria.projetarDaVault('casa', notas.map((n) => ({ ...n, cabecalho: undefined })));
    expect(await b.memoria.porChave('casa', 'vault:a.md')).toEqual(antes);
    expect(r.inalteradas).toBe(2);
    expect(b.alterar).not.toHaveBeenCalled();
  });

  it('publica recibo quando o aviso muda e deduplica sua repetição', async () => {
    const b = bancada();
    const r = recibo({ criadas: 0, alteradas: 0, inalteradas: 1, arquivadas: 0,
      restauradas: 0, falhas: 0, arquivamentoRecusado: 0, movidas: 0, movimentosRecusados: 0,
      movimentosDescartados: { ambiguos: 0, curtos: 0 }, pares: [],
      guardas: { arquivamento: { quantidade: 0, conjunto: null }, movimentos: { quantidade: 0, conjunto: null } },
      liberacaoUsada: null, substituicoes: { resolvidas: 0, semAlvo: 0 }, avisos: [], falhou: null });
    vi.spyOn(b.obsidian as never, 'gravarFrescor').mockResolvedValue(undefined as never);
    let anterior = { assinatura: assinaturaDoRecibo(r, resultadoDaVolta(r)), ocorreuEm: new Date() };
    vi.spyOn(b.memoria, 'ultimoReciboDaVault').mockImplementation(async () => anterior);
    const registrar = vi.spyOn(b.memoria, 'registrarReciboDaVault').mockImplementation(async (_org, entrada) => {
      anterior = { assinatura: (entrada.payload as { assinatura: string }).assinatura, ocorreuEm: new Date() };
      return { id: 'recibo-fixture', seq: 1n };
    });
    r.projecao!.avisos = ['privado/n.md: substituição persistida aponta para a própria nota'];
    await b.obsidian['publicarRecibo']('casa', r, [], false);
    expect(registrar).toHaveBeenCalledTimes(1);
    await b.obsidian['publicarRecibo']('casa', r, [], false);
    expect(registrar).toHaveBeenCalledTimes(1);
    // A retirada do aviso após a limpeza também muda a assinatura uma vez.
    r.projecao!.avisos = [];
    await b.obsidian['publicarRecibo']('casa', r, [], false);
    expect(registrar).toHaveBeenCalledTimes(2);
    await b.obsidian['publicarRecibo']('casa', r, [], false);
    expect(registrar).toHaveBeenCalledTimes(2);
  });

  it('aviso alterado muda a assinatura e gera recibo mesmo sem nova versão', () => {
    const b = recibo({ criadas: 0, alteradas: 0, inalteradas: 1, arquivadas: 0,
      restauradas: 0, falhas: 0, arquivamentoRecusado: 0, movidas: 0, movimentosRecusados: 0,
      movimentosDescartados: { ambiguos: 0, curtos: 0 }, pares: [],
      guardas: { arquivamento: { quantidade: 0, conjunto: null }, movimentos: { quantidade: 0, conjunto: null } },
      liberacaoUsada: null, substituicoes: { resolvidas: 0, semAlvo: 0 }, avisos: [], falhou: null });
    const anterior = assinaturaDoRecibo(b, resultadoDaVolta(b));
    b.projecao!.avisos.push('caminho privado: kind desconhecido');
    const assinatura = assinaturaDoRecibo(b, resultadoDaVolta(b));
    expect(assinatura).not.toBe(anterior);
    const agora = new Date();
    expect(deveRegistrar({ anterior: { assinatura: anterior, ocorreuEm: agora },
      assinatura, recibo: b, agora }).registrar).toBe(true);
    expect(deveRegistrar({ anterior: { assinatura, ocorreuEm: agora },
      assinatura, recibo: b, agora }).registrar).toBe(false);
    expect(assinatura).not.toContain('privado');
  });
});
