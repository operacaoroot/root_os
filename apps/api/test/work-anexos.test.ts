import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { ANEXO_MAX_BYTES, motivoParaRecusarAnexo } from '@mktos/shared';

import { AuditService } from '../src/audit/audit.service';
import type { ArquivistaDoClientePort, PedidoDeArquivo, ResultadoDoArquivo } from '../src/clientes/portas';
import type { PrismaService } from '../src/prisma/prisma.service';
import { AnexosDaTarefaService } from '../src/work/anexos/anexos.service';
import { exigirBancoDescartavel } from './banco-de-teste';
import { StorageEmMemoria } from './clientes-dubles';

/*
 * TR-06 · O ANEXO NA TAREFA (rodada dos agentes, 21/10/2026, lane A4).
 *
 * O arquivo sobe, fica no storage do OS e vira `WorkAnexo`; a cópia na pasta do
 * cliente é pedida ao arquivista (porta `ARQUIVISTA_DO_CLIENTE`), aqui um dublê
 * que anota o pedido e grava o registro como o de verdade grava. Tarefa sem
 * cliente ou do cliente interno fica só no OS. `WorkAnexo` é filho de
 * `WorkTask`: a empresa vem da tarefa, e anexo de uma empresa pendurado em
 * tarefa de outra é recusado pelo banco.
 */

const URL = process.env.TEST_DATABASE_URL;
if (URL) exigirBancoDescartavel(URL, 'cria tarefas e anexos de teste');

const ORG = 'org-a4-anexos';
const ORG_B = 'org-a4-anexos-b';

describe('a régua do anexo (pura)', () => {
  it('aceita documento, planilha, imagem e texto; recusa executável, extensão trocada, vazio e acima de 10 MB', () => {
    expect(motivoParaRecusarAnexo('contrato.pdf', 'application/pdf', 100)).toBeNull();
    expect(motivoParaRecusarAnexo('notas.md', 'application/octet-stream', 10)).toBeNull();
    expect(motivoParaRecusarAnexo('planilha.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 10)).toBeNull();
    expect(motivoParaRecusarAnexo('virus.exe', 'application/x-msdownload', 10)).toMatch(/não aceito/);
    expect(motivoParaRecusarAnexo('virus.exe', 'application/pdf', 10)).toMatch(/extensão/);
    expect(motivoParaRecusarAnexo('pagina.html', 'text/html', 10)).toMatch(/não aceito/);
    expect(motivoParaRecusarAnexo('a.pdf', 'application/pdf', 0)).toMatch(/vazio/);
    expect(motivoParaRecusarAnexo('a.pdf', 'application/pdf', ANEXO_MAX_BYTES + 1)).toMatch(/10 MB/);
  });
});

describe.skipIf(!URL)('TR-06 contra o banco', { timeout: 60_000 }, () => {
  let prisma: PrismaClient;
  let anexos: AnexosDaTarefaService;
  let storage: StorageEmMemoria;
  const pedidos: PedidoDeArquivo[] = [];
  const aprovacoes: string[] = [];
  const ids = { tarefaCliente: '', tarefaInterna: '', tarefaSem: '', tarefaB: '', cliente: '' };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    for (const [id, slug] of [[ORG, 'a4-anexos'], [ORG_B, 'a4-anexos-b']]) {
      await prisma.org.upsert({ where: { id }, create: { id, name: `A4 ${slug}`, slug }, update: {} });
    }
    const tarefa = async (org: string, titulo: string, clienteId: string | null) => {
      const lista = await prisma.workList.create({ data: { orgId: org, name: `Lista ${titulo}` } });
      const status = await prisma.workStatus.create({ data: { orgId: org, listId: lista.id, name: 'aberto', type: 'open' } as never });
      return (await prisma.workTask.create({ data: { orgId: org, listId: lista.id, statusId: status.id, title: titulo, clienteId } as never })).id;
    };
    const cliente = await prisma.partner.create({ data: { orgId: ORG, isCliente: true, razaoSocial: 'Anexo Exemplo Ltda' } });
    const interno =
      (await prisma.partner.findFirst({ where: { orgId: ORG, interno: true } })) ??
      (await prisma.partner.create({ data: { orgId: ORG, isCliente: true, razaoSocial: 'Casa (interno)', interno: true } }));
    ids.cliente = cliente.id;
    ids.tarefaCliente = await tarefa(ORG, 'Tarefa do cliente', cliente.id);
    ids.tarefaInterna = await tarefa(ORG, 'Tarefa da casa', interno.id);
    ids.tarefaSem = await tarefa(ORG, 'Tarefa sem cliente', null);
    ids.tarefaB = await tarefa(ORG_B, 'Tarefa da outra empresa', null);

    const p = prisma as unknown as PrismaService;
    // O arquivista de mentira: anota o pedido e grava o registro como o de verdade (estado aguardando).
    const arquivista: ArquivistaDoClientePort = {
      arquivar: async (pd): Promise<ResultadoDoArquivo> => {
        pedidos.push(pd);
        const c = pd.conteudo as { chave: string; sha256: string; bytes: number };
        const ap = await prisma.approval.create({
          data: {
            orgId: pd.orgId, capabilityId: 'drive.arquivo.enviar', propostoPorId: 'pessoa-1', resourceType: 'arquivo-do-cliente', resourceId: pd.ref!.id,
            contentHash: c.sha256, resumo: 'teste', tokenHash: `a4-${c.sha256}-${Date.now()}`, expiraEm: new Date(Date.now() + 86_400_000),
          },
        });
        aprovacoes.push(ap.id);
        await prisma.arquivoDoCliente.create({
          data: {
            orgId: pd.orgId, partnerId: pd.partnerId, origem: pd.origem, nomeOriginal: pd.nomeOriginal, tipoMime: pd.tipoMime,
            chave: c.chave, sha256: c.sha256, bytes: c.bytes, subpasta: '02-contrato', nome: '2026-10-21 - Contrato - x.pdf',
            estado: 'aguardando_aprovacao', approvalId: ap.id, refTipo: pd.ref?.tipo, refId: pd.ref?.id,
          },
        });
        return { estado: 'aguardando_aprovacao', approvalId: ap.id, subpasta: '02-contrato', nome: 'x' };
      },
    };
    anexos = new AnexosDaTarefaService(p, new AuditService(p), arquivista);
    storage = new StorageEmMemoria();
    anexos.usarArmazem(storage);
  });

  afterAll(async () => {
    const orgs = [ORG, ORG_B];
    await prisma.arquivoDoCliente.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.approval.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.workAnexo.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.workTask.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.workStatus.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.workList.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.auditLog.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.partner.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.org.deleteMany({ where: { id: { in: orgs } } });
    await prisma.$disconnect();
  });

  const arquivo = (nome: string, conteudo: string, mimetype = 'application/pdf') => ({ buffer: Buffer.from(conteudo), originalname: nome, mimetype, size: conteudo.length });

  it('anexo de tarefa de cliente: fica no OS e a cópia é pedida ao arquivista com o cliente da tarefa', async () => {
    const a = await anexos.enviar(ORG, ids.tarefaCliente, { id: 'pessoa-1', nome: 'Pessoa' }, arquivo('Contrato assinado.pdf', 'pdf do contrato'));
    expect(a.estado).toBe('aguardando_aprovacao');
    expect(a.approvalId).toBe(aprovacoes.at(-1));
    const linha = await prisma.workAnexo.findUniqueOrThrow({ where: { id: a.id } });
    expect(linha.orgId).toBe(ORG);
    expect(linha.sha256).toBe(createHash('sha256').update('pdf do contrato').digest('hex'));
    expect(storage.objetos.get(linha.chave)?.corpo.toString()).toBe('pdf do contrato');
    expect(pedidos.at(-1)).toMatchObject({ partnerId: ids.cliente, origem: 'anexo-da-tarefa', ref: { tipo: 'WorkAnexo', id: a.id }, atorId: 'pessoa-1' });

    // O mesmo arquivo na mesma tarefa é o mesmo anexo.
    const de_novo = await anexos.enviar(ORG, ids.tarefaCliente, { id: 'pessoa-1', nome: 'Pessoa' }, arquivo('Contrato assinado.pdf', 'pdf do contrato'));
    expect(de_novo.id).toBe(a.id);
    expect(await prisma.workAnexo.count({ where: { taskId: ids.tarefaCliente } })).toBe(1);

    const baixado = await anexos.baixar(ORG, ids.tarefaCliente, a.id);
    const partes: Buffer[] = [];
    for await (const p of baixado.stream as AsyncIterable<Buffer>) partes.push(p);
    expect(Buffer.concat(partes).toString()).toBe('pdf do contrato');
  });

  it('o pedido cuja aprovação venceu não aparece como "aguardando": a tela diz para anexar de novo', async () => {
    const a = await anexos.enviar(ORG, ids.tarefaCliente, { id: 'pessoa-1', nome: 'Pessoa' }, arquivo('Proposta.pdf', 'pdf da proposta'));
    expect(a.estado).toBe('aguardando_aprovacao');
    await prisma.approval.update({ where: { id: a.approvalId! }, data: { status: 'expirada' } });
    const depois = (await anexos.listar(ORG, ids.tarefaCliente)).find((x) => x.id === a.id)!;
    expect(depois).toMatchObject({ estado: 'erro', approvalId: null, motivo: expect.stringMatching(/venceu/) });
  });

  it('tarefa do cliente interno e tarefa sem cliente: só no OS, sem pedir nada ao arquivista', async () => {
    const antes = pedidos.length;
    const i = await anexos.enviar(ORG, ids.tarefaInterna, { id: 'pessoa-1', nome: 'Pessoa' }, arquivo('relatorio.txt', 'texto', 'text/plain'));
    const s = await anexos.enviar(ORG, ids.tarefaSem, { id: 'pessoa-1', nome: 'Pessoa' }, arquivo('foto.png', 'png', 'image/png'));
    expect(pedidos.length).toBe(antes);
    expect(i).toMatchObject({ estado: 'so_no_os', driveUrl: null, motivo: expect.stringMatching(/interno/) });
    expect(s).toMatchObject({ estado: 'so_no_os', motivo: expect.stringMatching(/sem cliente/) });
  });

  it('recusa tipo que não serve e não guarda nada', async () => {
    const antes = storage.objetos.size;
    await expect(anexos.enviar(ORG, ids.tarefaSem, { id: 'p', nome: 'P' }, arquivo('script.sh', 'rm -rf', 'application/x-sh'))).rejects.toThrow(/não aceito/);
    await expect(anexos.enviar(ORG, ids.tarefaSem, { id: 'p', nome: 'P' }, undefined)).rejects.toThrow(/nenhum arquivo/);
    expect(storage.objetos.size).toBe(antes);
  });

  it('ISOLAMENTO: a outra empresa não lista, não baixa e não pendura anexo em tarefa alheia', async () => {
    await expect(anexos.listar(ORG_B, ids.tarefaCliente)).rejects.toThrow(/não encontrada/);
    const meu = (await anexos.listar(ORG, ids.tarefaCliente))[0];
    await expect(anexos.baixar(ORG_B, ids.tarefaCliente, meu.id)).rejects.toThrow(/não encontrada/);
    await expect(anexos.baixar(ORG, ids.tarefaSem, meu.id)).rejects.toThrow(/não encontrado/);
    // O gatilho deriva a empresa da tarefa e recusa a de outra.
    await expect(
      prisma.workAnexo.create({
        data: { orgId: ORG_B, taskId: ids.tarefaCliente, nome: 'x.pdf', tipoMime: 'application/pdf', bytes: 1, sha256: 'a'.repeat(64), chave: 'k', autorNome: 'x' },
      }),
    ).rejects.toThrow();
    // Sem empresa declarada, a sentinela vira a empresa da tarefa.
    const derivado = await prisma.workAnexo.create({
      data: { taskId: ids.tarefaB, nome: 'y.pdf', tipoMime: 'application/pdf', bytes: 1, sha256: 'b'.repeat(64), chave: 'k2', autorNome: 'y' } as never,
    });
    expect(derivado.orgId).toBe(ORG_B);
  });
});
