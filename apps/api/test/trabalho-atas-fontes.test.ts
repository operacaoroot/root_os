import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ActorType, PrismaClient } from '@prisma/client';
import {
  ATA_CHAVE_DO_DRIVE,
  idDaPastaDoDrive,
  lerRefDaAta,
  tipoDoArquivoDeAta,
  type TrabGranolaReunioes,
} from '@mktos/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApprovalsService } from '../src/approvals/approvals.service';
import { AuditService } from '../src/audit/audit.service';
import { PermissionsGuard } from '../src/auth/permissions.guard';
import { ReauthService } from '../src/auth/reauth.service';
import { comContexto } from '../src/common/contexto-execucao';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { EventLogService } from '../src/gateway/event-log.service';
import { InterruptoresRegistry } from '../src/gateway/interruptores.registry';
import { PortaDoOperador } from '../src/gateway/porta-do-operador.service';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { consultaDoDrive, leituraDoArquivo } from '../src/google/drive-das-atas';
import { ConectoresService } from '../src/integrations/conectores.service';
import type { LlmProvider, LlmStepInput, LlmStepOutput } from '../src/llm/llm.provider';
import { StubProvider } from '../src/llm/stub.provider';
import { MemoriaService } from '../src/memory/memoria.service';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { AtasController } from '../src/work/atas/atas.controller';
import { AtasDoGranolaService } from '../src/work/atas/atas-do-granola.service';
import { AtasService, type AcessoAsAtas, type QuemDecide } from '../src/work/atas/atas.service';
import { DriveDasAtasService, RECUSA_DO_DRIVE_NAS_ATAS } from '../src/work/atas/fonte-do-drive';
import { SoGenteNasAtasGuard } from '../src/work/atas/so-gente-nas-atas.guard';
import { promptDaAtaDoGranola } from '../src/work/atas/leitor-do-granola';
import { CheckoutDeTarefaService } from '../src/work/checkout-de-tarefa.service';
import { criarEstruturaSugerida } from '../src/work/estrutura-sugerida';
import { WorkService } from '../src/work/work.service';
import { exigirBancoDescartavel } from './banco-de-teste';
import { TRANSCRICAO_FICTICIA } from './dubles/granola-mcp';

/*
 * ==========================================================================
 * AS ATAS: VAULT, GRANOLA E A PASTA DO DRIVE (produção 21, P7, 21/10/2026)
 * ==========================================================================
 *
 * O que esta suíte cobra:
 *   1. (sem banco) a regra do tipo pelo nome, o id da pasta tirado do link e a
 *      consulta do Drive escapada; o prompt da transcrição do Drive diz a origem;
 *   2. (sem banco) as rotas novas: permissões e a ordem antes de `:ref`;
 *   3. (banco + porta de verdade + DUBLÊ do Drive como efeito da porta) a pasta
 *      se escolhe pela nota `trabalho.atas.drive` (MemoriaService); a lista junta
 *      vault, colada, Granola e Drive, a mais nova primeiro; busca por palavra
 *      (o Drive recebe `texto` dentro da `pasta`), por data, por tipo e por
 *      fonte; sem `drive.ver` o Drive fica de fora e diz por quê;
 *   4. abrir o arquivo do Drive vai PELA PORTA (`contexto.arquivo.ler`, R0, com
 *      o registro na `ToolCall`), mascara o segredo, e o texto NÃO fica em tabela
 *      nenhuma (nem no registro da porta); arquivo de outra pasta é 404;
 *   5. "Sugerir tarefas" numa ata do Drive grava só as sugestões e o índice
 *      (tamanho e sha256) na auditoria; transcrição não sugere direto;
 *   6. "Gerar ata" de uma transcrição do Drive: nota da memória com procedência
 *      `drive:<id>`, versão nova ao gerar de novo, e a transcrição não é gravada.
 */

const RAIZ = join(__dirname, '..', '..', '..');
const PASTA_DO_STUB = join(RAIZ, 'homolog/fixtures/stub');
const ATA_EXEMPLO = readFileSync(join(RAIZ, 'homolog/fixtures/ata-trabalho-exemplo.md'), 'utf8');

describe('as regras do Drive das atas (sem banco)', () => {
  it('o tipo sai do nome: transcrição, transcript, legenda; o resto é ata', () => {
    expect(tipoDoArquivoDeAta('Transcrição kickoff 2026-10-20.txt')).toBe('transcricao');
    expect(tipoDoArquivoDeAta('kickoff - transcript.md')).toBe('transcricao');
    expect(tipoDoArquivoDeAta('Reunião transcrita.pdf')).toBe('transcricao');
    expect(tipoDoArquivoDeAta('chamada.vtt')).toBe('transcricao');
    expect(tipoDoArquivoDeAta('Ata do comitê 2026-10-18')).toBe('ata');
    expect(tipoDoArquivoDeAta('Resumo da reunião.pdf')).toBe('ata');
  });

  it('o id da pasta sai do link (com /u/0/ e ?usp=), do link antigo ou do id; o resto é recusado', () => {
    const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
    expect(idDaPastaDoDrive(`https://drive.google.com/drive/folders/${id}`)).toBe(id);
    expect(idDaPastaDoDrive(`https://drive.google.com/drive/u/0/folders/${id}?usp=sharing`)).toBe(id);
    expect(idDaPastaDoDrive(`https://drive.google.com/open?id=${id}`)).toBe(id);
    expect(idDaPastaDoDrive(id)).toBe(id);
    expect(idDaPastaDoDrive(`http://drive.google.com/drive/folders/${id}`)).toBeNull();
    expect(idDaPastaDoDrive(`https://evil.example/drive/folders/${id}`)).toBeNull();
    expect(idDaPastaDoDrive("x' or name contains 'y")).toBeNull();
    expect(idDaPastaDoDrive('')).toBeNull();
  });

  it('a consulta do Drive fica dentro da pasta e escapa o que a pessoa digitou', () => {
    const q = consultaDoDrive({ pasta: '1PastaDasAtas0000000', texto: "d'água \\ teste", desde: '2026-10-01' });
    expect(q).toBe(
      "'1PastaDasAtas0000000' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder' and " +
        "fullText contains 'd\\'água \\\\ teste' and modifiedTime >= '2026-10-01T00:00:00'",
    );
    expect(() => consultaDoDrive({ pasta: "x' in parents or '1" })).toThrow();
  });

  it('a leitura do arquivo devolve o texto marcado sigiloso (o registro da porta guarda o resumo)', () => {
    const l = leituraDoArquivo({ id: '1Arquivo0000000000', nome: 'a.md', mimeType: 'text/markdown', modificadoEm: null, link: null, pastas: [], bytes: 3, texto: 'abc' });
    expect(l.texto).toMatchObject({ __sigiloso: true, valor: 'abc' });
  });

  it('o prompt da transcrição do Drive diz a origem e cerca a fala do mesmo jeito', () => {
    const p = promptDaAtaDoGranola({ reuniao: { granolaId: '1Arquivo0000000000', titulo: 'Kickoff', data: null, participantes: [], fonte: 'drive' }, transcricao: 'Ana: oi', listas: [], pessoas: [] });
    expect(p.system).toContain('salva no Google Drive');
    expect(p.user).toContain('Título no Google Drive: Kickoff');
    expect(p.user).toContain('drive:1Arquivo0000000000');
  });
});

describe('as rotas novas das atas: permissões e ordem (sem banco)', () => {
  const guarda = new PermissionsGuard(new Reflector());
  const soGente = new SoGenteNasAtasGuard();
  function contexto(metodo: keyof AtasController, permissions: string[], roles: string[] = []) {
    const handler = (AtasController.prototype as unknown as Record<string, unknown>)[metodo] as () => void;
    return {
      getHandler: () => handler,
      getClass: () => AtasController,
      switchToHttp: () => ({ getRequest: () => ({ user: { sub: 'u', orgId: 'o', permissions, roles } }) }),
    } as never;
  }

  it('escolher a pasta e gerar ata do Drive pedem tarefas.editar, obsidian.editar e drive.ver; máquina não', () => {
    expect(guarda.canActivate(contexto('pastaDoDrive', ['tarefas.ver']))).toBe(true);
    expect(() => guarda.canActivate(contexto('escolherPastaDoDrive', ['tarefas.editar', 'obsidian.editar']))).toThrow(ForbiddenException);
    expect(guarda.canActivate(contexto('escolherPastaDoDrive', ['tarefas.editar', 'obsidian.editar', 'drive.ver']))).toBe(true);
    expect(() => guarda.canActivate(contexto('gerarAtaDoDrive', ['tarefas.editar', 'obsidian.editar']))).toThrow(ForbiddenException);
    expect(guarda.canActivate(contexto('gerarAtaDoDrive', ['tarefas.editar', 'obsidian.editar', 'drive.ver']))).toBe(true);
    expect(() => soGente.canActivate(contexto('escolherPastaDoDrive', ['tarefas.editar', 'obsidian.editar', 'drive.ver'], ['ia_servico']))).toThrow(ForbiddenException);
  });

  it('as rotas do Drive vêm antes de :ref', () => {
    const nomes = Object.getOwnPropertyNames(AtasController.prototype);
    for (const m of ['pastaDoDrive', 'escolherPastaDoDrive', 'gerarAtaDoDrive']) expect(nomes.indexOf(m)).toBeLessThan(nomes.indexOf('ler'));
  });
});

// ===========================================================================
// Contra o Postgres, com a porta de verdade e o dublê do Drive
// ===========================================================================

const URL_DO_BANCO = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL_DO_BANCO ?? '', 'ESCREVE nele (notas da memória, sugestões, chamadas da porta e auditoria)');

const MARCA = `fon_${randomUUID().slice(0, 8)}`;
const ORG = `org-atas-fontes-${MARCA}`;
const EU = `u-atas-fontes-${MARCA}`;
const GENTE: QuemDecide = { id: EU, papeis: [] };
const PASTA = '1PastaDasAtas' + MARCA.replace(/[^A-Za-z0-9]/g, '').padEnd(12, '0');
const OUTRA_PASTA = '1OutraPasta' + MARCA.replace(/[^A-Za-z0-9]/g, '').padEnd(12, '0');
const ID_ATA = '1ArqAtaComite' + MARCA.replace(/[^A-Za-z0-9]/g, '');
const ID_TRANS = '1ArqTranscricao' + MARCA.replace(/[^A-Za-z0-9]/g, '');
const ID_FORA = '1ArqForaDaPasta' + MARCA.replace(/[^A-Za-z0-9]/g, '');
const ID_FOTO = '1ArqFotoDaSala' + MARCA.replace(/[^A-Za-z0-9]/g, '');
const FRASE_DA_ATA = 'a lontra azul atravessou o comitê de outubro';
const R1 = '7d3c2b1a-0f9e-4d8c-8b7a-6a5f4e3d2c1b';
const COM_DRIVE: AcessoAsAtas = { vault: true, drive: true, actorId: EU };

/** O Drive de mentira: a pasta das atas e um arquivo fora dela. Registra os argumentos que a porta passou. */
const ARQUIVOS = [
  { id: ID_ATA, name: 'Ata comitê 2026-10-18', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-10-18T15:00:00.000Z', pastas: [PASTA],
    texto: `${ATA_EXEMPLO}\n\nObservação: ${FRASE_DA_ATA}.\n\nA senha do sistema é Abacaxi#2026.` },
  { id: ID_TRANS, name: 'Transcrição kickoff 2026-10-20.txt', mimeType: 'text/plain', modifiedTime: '2026-10-20T18:00:00.000Z', pastas: [PASTA], texto: TRANSCRICAO_FICTICIA },
  { id: ID_FOTO, name: 'foto da sala.png', mimeType: 'image/png', modifiedTime: '2026-10-21T10:00:00.000Z', pastas: [PASTA], texto: '' },
  { id: ID_FORA, name: 'Ata de outra pasta', mimeType: 'text/plain', modifiedTime: '2026-10-19T10:00:00.000Z', pastas: [OUTRA_PASTA], texto: 'texto de outra pasta' },
];
const pedidosDaLista: Array<Record<string, unknown>> = [];

function naEmpresa<T>(fn: () => Promise<T>): Promise<T> {
  return comContexto({ orgId: ORG, actorType: ActorType.user, actorId: EU, correlationId: `teste-atas-fontes-${MARCA}`, origem: 'script' }, fn);
}

class StubEspiao implements LlmProvider {
  readonly name = 'stub';
  readonly model = 'stub';
  readonly configured = true;
  readonly supportsTools = false;
  readonly pedidos: string[] = [];
  private readonly stub = new StubProvider(PASTA_DO_STUB);
  tetoDeSaida(): number {
    return 1;
  }
  complete(input: Parameters<LlmProvider['complete']>[0]): Promise<string> {
    this.pedidos.push(`${input.system}\n${input.user}`);
    return this.stub.complete(input);
  }
  step(input: LlmStepInput): Promise<LlmStepOutput> {
    this.pedidos.push(`${input.system}\n${input.turns.map((t) => (t.role === 'user' ? t.text : '')).join('\n')}`);
    return this.stub.step(input);
  }
}

describe.skipIf(!URL_DO_BANCO)('as fontes das atas contra o Postgres, a porta e o dublê do Drive', { timeout: 60_000 }, () => {
  let prisma: PrismaClient;
  let atas: AtasService;
  let doGranola: AtasDoGranolaService;
  let drive: DriveDasAtasService;
  let memoria: MemoriaService;
  let espiao: StubEspiao;

  const granola: TrabGranolaReunioes = {
    conectado: true,
    desligado: false,
    motivo: null,
    iaConfigurada: true,
    reunioes: [
      { id: R1, titulo: 'Reunião de diretoria', em: '2026-10-19T13:00:00.000Z', participantes: ['Paulo Rocha'], cliente: null, ataRef: null, ataVersao: null, naFicha: false },
    ],
  };

  /** Quantas linhas de TODA tabela da empresa contêm o texto (a prova de "não persistido"). */
  async function linhasQueContem(texto: string): Promise<Record<string, number>> {
    const tabelas = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'orgId'`,
    );
    const achados: Record<string, number> = {};
    for (const { table_name } of tabelas) {
      const [linha] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*)::bigint AS n FROM "${table_name}" t WHERE t."orgId" = $1 AND row_to_json(t)::text ILIKE $2`,
        ORG,
        `%${texto}%`,
      );
      if (Number(linha.n) > 0) achados[table_name] = Number(linha.n);
    }
    return achados;
  }

  beforeAll(async () => {
    process.env.GATEWAY_MODO = 'impor';
    prisma = new PrismaClient({ datasources: { db: { url: URL_DO_BANCO } } });
    await prisma.$connect();
    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    const policy = new PolicyService(p);
    await policy.onModuleInit();
    const approvals = new ApprovalsService(p, audit, new ReauthService(p, new JwtService({ secret: `segredo-${MARCA}` }), audit));
    const log = new EventLogService(p);
    const efeitos = new EfeitosRegistry();
    const interruptores = new InterruptoresRegistry();
    new ConectoresService(p, audit, log, interruptores).onModuleInit();
    const gateway = new ToolGateway(p, policy, new SinaisService(p, policy), approvals, log, undefined, interruptores, efeitos);
    const porta = new PortaDoOperador(gateway, efeitos);

    // O DUBLÊ DO DRIVE inscrito como os efeitos das duas capacidades R0: é a porta que o chama.
    efeitos.registrar(
      {
        'contexto.arquivo.listar': async (a) => {
          pedidosDaLista.push({ ...a });
          const pasta = String(a.pasta ?? '');
          if (!pasta) throw new BadRequestException('o dublê só lista dentro de pasta');
          const texto = String(a.texto ?? '').toLowerCase();
          const desde = String(a.desde ?? '');
          return ARQUIVOS.filter((f) => f.pastas.includes(pasta))
            .filter((f) => !texto || `${f.name} ${f.texto}`.toLowerCase().includes(texto))
            .filter((f) => !desde || f.modifiedTime >= `${desde}T00:00:00`)
            .slice(0, Number(a.limite ?? 15))
            .map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime, link: `https://drive.google.com/file/d/${f.id}/view`, owner: null, size: f.texto.length }));
        },
        'contexto.arquivo.ler': async (a) => {
          const f = ARQUIVOS.find((x) => x.id === a.id);
          if (!f) throw new NotFoundException('arquivo não existe no Drive');
          return leituraDoArquivo({ id: f.id, nome: f.name, mimeType: f.mimeType, modificadoEm: f.modifiedTime, link: `https://drive.google.com/file/d/${f.id}/view`, pastas: f.pastas, bytes: f.texto.length, texto: f.texto });
        },
      },
      'teste/dublê do Drive',
    );

    memoria = new MemoriaService(p, log);
    const work = new WorkService(p, audit, new CheckoutDeTarefaService(p, audit, log));
    espiao = new StubEspiao();
    drive = new DriveDasAtasService(porta, memoria);
    atas = new AtasService(p, memoria, work, audit, espiao, drive);
    doGranola = new AtasDoGranolaService(p, memoria, atas, audit, espiao);

    await prisma.org.upsert({ where: { id: ORG }, create: { id: ORG, name: ORG, slug: ORG }, update: {} });
    const chaves = ['tarefas.ver', 'tarefas.editar', 'obsidian.ver', 'obsidian.editar', 'drive.ver'];
    const permissoes = [];
    for (const key of chaves) permissoes.push(await prisma.permission.upsert({ where: { key }, create: { key }, update: {}, select: { id: true } }));
    const papel = await prisma.role.create({ data: { orgId: ORG, key: 'analista', name: 'Analista', permissions: { connect: permissoes } }, select: { id: true } });
    await prisma.user.create({ data: { id: EU, orgId: ORG, name: 'Rodrigo Teste', email: `${EU}@teste.local`, passwordHash: 'x', roles: { connect: { id: papel.id } } } });
    await prisma.$transaction((tx) => criarEstruturaSugerida(tx, ORG));

    // Uma ata do vault (pasta das reuniões) e uma colada.
    await prisma.knowledgeNote.create({
      data: { orgId: ORG, path: '80-Reunioes/2026-10-10 Diretoria.md', folder: '80-Reunioes', title: 'Diretoria de outubro', content: '# Diretoria\n\nData: 2026-10-10\n\nDecidimos revisar o orçamento do comitê.', fileTime: new Date('2026-10-10T12:00:00Z') },
    });
    await naEmpresa(() => atas.colar(ORG, GENTE, { titulo: 'Reunião de vendas', data: '2026-10-12', participantes: ['Marina Alves'], texto: 'A equipe de vendas revisou o funil e combinou ligar para os leads parados. '.repeat(3) }));
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.ataSugestao.deleteMany({ where: { orgId: ORG } });
    await prisma.$disconnect();
  });

  it('a pasta do Drive: link recusado se não é pasta; colado o link, a nota trabalho.atas.drive guarda o id pela memória', async () => {
    await expect(naEmpresa(() => drive.configurar(ORG, EU, 'https://exemplo.com/nao-e-drive'))).rejects.toThrow(BadRequestException);
    const estado = await naEmpresa(() => drive.configurar(ORG, EU, `https://drive.google.com/drive/u/0/folders/${PASTA}?usp=sharing`));
    expect(estado).toMatchObject({ configurada: true, pastaId: PASTA, link: `https://drive.google.com/drive/folders/${PASTA}` });
    const nota = await prisma.contextItem.findFirstOrThrow({ where: { orgId: ORG, chave: ATA_CHAVE_DO_DRIVE } });
    expect(nota.body.split('\n')[0]).toBe(PASTA);
    expect(nota.versao).toBe(1);
    // Pela memória: a versão e o evento existem.
    expect(await prisma.contextItemVersion.count({ where: { orgId: ORG, itemId: nota.id } })).toBe(1);
    // A conferência da pasta foi PELA PORTA.
    expect(await prisma.toolCall.count({ where: { orgId: ORG, capabilityId: 'contexto.arquivo.listar' } })).toBeGreaterThan(0);
  });

  it('a lista junta vault, colada, Granola e Drive, a mais nova primeiro, e diz o tipo', async () => {
    const l = await naEmpresa(() => atas.listar(ORG, COM_DRIVE, {}, { granola }));
    const ordem = l.atas.map((a) => `${a.fonte}:${a.tipo}:${a.data}`);
    expect(ordem).toEqual([
      'drive:transcricao:2026-10-20',
      'granola:transcricao:2026-10-19',
      'drive:ata:2026-10-18',
      'colada:ata:2026-10-12',
      'vault:ata:2026-10-10',
    ]);
    // A foto da pasta não é ata; o arquivo da outra pasta nem aparece.
    expect(l.atas.some((a) => a.id === `drive:${ID_FOTO}` || a.id === `drive:${ID_FORA}`)).toBe(false);
    expect(l.fontes?.drive).toMatchObject({ configurada: true, arquivos: 2, motivo: null });
    expect(l.fontes?.granola).toMatchObject({ conectado: true, reunioes: 1 });
    const doDrive = l.atas.find((a) => a.id === `drive:${ID_ATA}`)!;
    expect(doDrive).toMatchObject({ titulo: 'Ata comitê 2026-10-18', link: `https://drive.google.com/file/d/${ID_ATA}/view` });
    expect(lerRefDaAta(doDrive.id)).toEqual({ fonte: 'drive', id: ID_ATA });
  });

  it('a busca: palavra-chave (o Drive busca dentro da pasta), datas, tipo e fonte', async () => {
    pedidosDaLista.length = 0;
    const porPalavra = await naEmpresa(() => atas.listar(ORG, COM_DRIVE, { q: 'comitê' }, { granola }));
    expect(porPalavra.atas.map((a) => a.id).sort()).toEqual([`drive:${ID_ATA}`, porPalavra.atas.find((a) => a.fonte === 'vault')!.id].sort());
    expect(pedidosDaLista.at(-1)).toMatchObject({ pasta: PASTA, texto: 'comitê', limite: 50 });

    const doGranolaPorParticipante = await naEmpresa(() => atas.listar(ORG, COM_DRIVE, { q: 'paulo rocha', fonte: 'granola' }, { granola }));
    expect(doGranolaPorParticipante.atas.map((a) => a.id)).toEqual([`granola:${R1}`]);

    const porData = await naEmpresa(() => atas.listar(ORG, COM_DRIVE, { de: '2026-10-12', ate: '2026-10-19' }, { granola }));
    expect(porData.atas.map((a) => a.data)).toEqual(['2026-10-19', '2026-10-18', '2026-10-12']);
    expect(pedidosDaLista.at(-1)).toMatchObject({ desde: '2026-10-12' });

    const transcricoes = await naEmpresa(() => atas.listar(ORG, COM_DRIVE, { tipo: 'transcricao' }, { granola }));
    expect(transcricoes.atas.map((a) => a.id)).toEqual([`drive:${ID_TRANS}`, `granola:${R1}`]);

    const soVault = await naEmpresa(() => atas.listar(ORG, COM_DRIVE, { fonte: 'vault' }, { granola }));
    expect(soVault.atas.map((a) => a.fonte)).toEqual(['vault']);
  });

  it('sem drive.ver o Drive fica de fora, a lista diz por quê, e abrir é 403', async () => {
    const l = await naEmpresa(() => atas.listar(ORG, { vault: true, drive: false, actorId: EU }, {}, { granola }));
    expect(l.atas.some((a) => a.fonte === 'drive')).toBe(false);
    expect(l.fontes?.drive.motivo).toBe(RECUSA_DO_DRIVE_NAS_ATAS);
    await expect(naEmpresa(() => atas.ler(ORG, `drive:${ID_ATA}`, { vault: true, drive: false, actorId: EU }))).rejects.toThrow(ForbiddenException);
  });

  it('abrir a ata do Drive vai pela porta, mascara o segredo e não grava o texto em tabela nenhuma', async () => {
    const antes = await prisma.toolCall.count({ where: { orgId: ORG, capabilityId: 'contexto.arquivo.ler' } });
    const a = await naEmpresa(() => atas.ler(ORG, `drive:${ID_ATA}`, COM_DRIVE));
    expect(a).toMatchObject({ fonte: 'drive', tipo: 'ata', titulo: 'Ata comitê 2026-10-18' });
    expect(a.texto).toContain(FRASE_DA_ATA);
    expect(a.texto).not.toContain('Abacaxi#2026');
    expect(a.decisoes?.length ?? 0).toBeGreaterThanOrEqual(0);
    expect(await prisma.toolCall.count({ where: { orgId: ORG, capabilityId: 'contexto.arquivo.ler' } })).toBe(antes + 1);
    const chamada = await prisma.toolCall.findFirstOrThrow({ where: { orgId: ORG, capabilityId: 'contexto.arquivo.ler' }, orderBy: { criadoEm: 'desc' } });
    expect(chamada.actorId).toBe(EU);
    expect(JSON.stringify(chamada.resultado)).toContain('resumoCriptografico');
    expect(await linhasQueContem(FRASE_DA_ATA)).toEqual({});
  });

  it('o arquivo que não está na pasta das atas é "não encontrado", mesmo que o Drive o entregue', async () => {
    await expect(naEmpresa(() => atas.ler(ORG, `drive:${ID_FORA}`, COM_DRIVE))).rejects.toThrow(NotFoundException);
  });

  it('"Sugerir tarefas" na ata do Drive: sugestões em rascunho, o índice na auditoria e nada do texto', async () => {
    const g = await naEmpresa(() => atas.gerar(ORG, GENTE, `drive:${ID_ATA}`, COM_DRIVE));
    expect(g.criadas.length).toBeGreaterThan(0);
    expect(g.criadas.every((s) => s.ataRef === `drive:${ID_ATA}` && s.estado === 'rascunho')).toBe(true);
    const auditoria = await prisma.auditLog.findFirstOrThrow({ where: { orgId: ORG, action: 'trabalho.ata.sugestoes_geradas', entityId: `drive:${ID_ATA}` } });
    expect((auditoria.after as { arquivo: { sha256: string; caracteres: number } }).arquivo.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await linhasQueContem(FRASE_DA_ATA)).toEqual({});
    // Transcrição não sugere direto: gera a ata.
    await expect(naEmpresa(() => atas.gerar(ORG, GENTE, `drive:${ID_TRANS}`, COM_DRIVE))).rejects.toThrow(BadRequestException);
  });

  it('"Gerar ata" da transcrição do Drive: nota com procedência drive:<id>, versão nova ao gerar de novo, transcrição não gravada', async () => {
    const g = await naEmpresa(() => doGranola.gerarAtaDoDrive(ORG, GENTE, ID_TRANS, COM_DRIVE));
    expect(g.nova).toBe(true);
    expect(g.ficha).toBe('nao_se_aplica');
    expect(g.ata).toMatchObject({ fonte: 'drive', tipo: 'ata', transcricaoRef: `drive:${ID_TRANS}` });
    const nota = await prisma.contextItem.findFirstOrThrow({ where: { orgId: ORG, sourceRef: `drive:${ID_TRANS}` } });
    expect(nota.tags).toContain('drive');
    expect(nota.body).toContain(`- Fonte: drive:${ID_TRANS}`);
    // O pedido ao modelo levou a transcrição mascarada e cercada, com a origem do Drive.
    const pedido = espiao.pedidos.at(-1)!;
    expect(pedido).toContain(`drive:${ID_TRANS}`);
    expect(pedido).not.toContain('Abacaxi#2026');
    // A lista mostra que a transcrição já tem ata.
    const l = await naEmpresa(() => atas.listar(ORG, COM_DRIVE, { tipo: 'transcricao', fonte: 'drive' }, {}));
    expect(l.atas[0]).toMatchObject({ id: `drive:${ID_TRANS}`, ataGerada: `memoria:${nota.id}` });

    const deNovo = await naEmpresa(() => doGranola.gerarAtaDoDrive(ORG, GENTE, ID_TRANS, COM_DRIVE));
    expect(deNovo.nova).toBe(false);
    expect(deNovo.versao).toBe(2);
    expect(await prisma.contextItem.count({ where: { orgId: ORG, sourceRef: `drive:${ID_TRANS}` } })).toBe(1);
    // A frase que só existe na transcrição não foi gravada em lugar nenhum.
    expect(await linhasQueContem('girafa-violeta-azul-7731')).toEqual({});
    // Ata do Drive (não transcrição) não "gera ata".
    await expect(naEmpresa(() => doGranola.gerarAtaDoDrive(ORG, GENTE, ID_ATA, COM_DRIVE))).rejects.toThrow(BadRequestException);
  });

  it('tirar a pasta arquiva a nota (pela memória) e o Drive sai da lista', async () => {
    const estado = await naEmpresa(() => drive.configurar(ORG, EU, null));
    expect(estado.configurada).toBe(false);
    const nota = await prisma.contextItem.findFirstOrThrow({ where: { orgId: ORG, chave: ATA_CHAVE_DO_DRIVE } });
    expect(nota.arquivadoEm).not.toBeNull();
    const l = await naEmpresa(() => atas.listar(ORG, COM_DRIVE, {}, {}));
    expect(l.atas.some((a) => a.id.startsWith('drive:'))).toBe(false);
    expect(l.fontes?.drive.motivo).toBe('Nenhuma pasta do Drive escolhida para as atas.');
  });
});
