import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * O seed não pode apagar nem duplicar o que já existe (ROOT-SEED1, E9).
 *
 * Roda `prisma/seed.ts` de verdade, como processo filho, contra TEST_DATABASE_URL
 * (migrations aplicadas; a política não é necessária). Planta uma linha "real"
 * de cada tipo que o bloco 5 tocava, mais uma tarefa homônima de uma semente que
 * veio do ClickUp (com externalId), roda o seed duas vezes e confere que o banco
 * ficou igual. O mutante troca a assinatura da tarefa por "só o título" e precisa
 * ser reprovado, senão o teste não mede o que diz medir.
 *
 * SEED_PRESERVA_SCRIPT aponta outro script (caminho relativo a apps/api) e serve
 * à contraprova contra a versão antiga do seed, que apagava tudo; o teste
 * principal então deve FALHAR.
 *
 * Este arquivo semeia a empresa de slug `root`, a mesma do seed. Nenhuma outra
 * suíte da API usa essa empresa no banco.
 */
const URL_DO_BANCO = process.env.TEST_DATABASE_URL ?? '';
if (URL_DO_BANCO) exigirBancoDescartavel(URL_DO_BANCO, 'semeia e apaga dados da empresa `root`');

const RAIZ_DA_API = resolve(__dirname, '..');
const SCRIPT = process.env.SEED_PRESERVA_SCRIPT ?? 'prisma/seed.ts';
const TITULO_HOMONIMO = 'Aprovar criativo Black Friday';

function semear(script: string): void {
  const r = spawnSync(process.execPath, ['--import', 'tsx', script], {
    cwd: RAIZ_DA_API,
    env: {
      ...process.env,
      DATABASE_URL: URL_DO_BANCO,
      ADMIN_PASSWORD: '',
      MCP_SERVICE_PASSWORD: '',
      MCP_ACTION_PASSWORD: '',
    },
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`seed saiu com ${r.status}: ${r.stderr || r.stdout}`);
}

function mutanteDaTarefaPorTitulo(): string {
  const origem = readFileSync(join(RAIZ_DA_API, 'prisma/seed.ts'), 'utf8');
  const alvo = 'prisma.task.findFirst({ where: signature,';
  if (!origem.includes(alvo)) throw new Error('o seed mudou: ajuste o mutante deste teste');
  const caminho = 'prisma/.seed-mutante-tarefa-por-titulo.ts';
  writeFileSync(
    join(RAIZ_DA_API, caminho),
    origem.replace(alvo, 'prisma.task.findFirst({ where: { orgId: org.id, title: t.title },'),
  );
  return caminho;
}

describe.skipIf(!URL_DO_BANCO)('seed: preserva dados existentes', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: URL_DO_BANCO } } });
  const mutantes: string[] = [];

  afterAll(async () => {
    for (const m of mutantes) rmSync(join(RAIZ_DA_API, m), { force: true });
    await prisma.$disconnect();
  });

  async function limparDemonstracao(orgId: string) {
    await prisma.leadEvent.deleteMany({ where: { lead: { orgId } } });
    await prisma.lead.deleteMany({ where: { orgId } });
    await prisma.pixelEvent.deleteMany({ where: { orgId } });
    await prisma.task.deleteMany({ where: { orgId } });
    await prisma.campaign.deleteMany({ where: { orgId } });
    await prisma.leadSource.deleteMany({ where: { orgId } });
  }

  async function fotografia(orgId: string) {
    const [fontes, campanhas, leads, eventos, pixels, tarefas] = await Promise.all([
      prisma.leadSource.findMany({ where: { orgId }, orderBy: { id: 'asc' } }),
      prisma.campaign.findMany({ where: { orgId }, orderBy: { id: 'asc' } }),
      prisma.lead.findMany({ where: { orgId }, orderBy: { id: 'asc' } }),
      prisma.leadEvent.findMany({ where: { lead: { orgId } }, orderBy: { id: 'asc' } }),
      prisma.pixelEvent.findMany({ where: { orgId }, orderBy: { id: 'asc' } }),
      prisma.task.findMany({ where: { orgId }, orderBy: { id: 'asc' } }),
    ]);
    return JSON.parse(JSON.stringify({ fontes, campanhas, leads, eventos, pixels, tarefas }));
  }

  /** Devolve o que o cenário viu de errado; vazio = seed correto. */
  async function cenario(script: string): Promise<string[]> {
    const falhas: string[] = [];

    semear(script); // garante empresa, perfis e a demonstração
    const org = await prisma.org.findUniqueOrThrow({ where: { slug: 'root' } });
    await limparDemonstracao(org.id);

    // Linhas reais, sintéticas, de cada tipo que o bloco 5 tocava.
    const fonteReal = await prisma.leadSource.create({
      data: { orgId: org.id, key: 'parceiro-real', name: 'Parceiro real', channel: 'organico' },
    });
    const campanhaReal = await prisma.campaign.create({
      data: { orgId: org.id, name: 'Campanha real de setembro', objective: 'leads', channel: 'google_ads', budget: '900.00', spend: '410.50', status: 'ativa' },
    });
    const leadReal = await prisma.lead.create({
      data: {
        orgId: org.id, name: 'Cliente Real', email: 'cliente.real@empresa.com.br',
        sourceId: fonteReal.id, campaignId: campanhaReal.id, status: 'qualificado', score: 61,
        events: { create: [{ type: 'created', payload: { origem: 'formulario' } }] },
      },
    });
    await prisma.pixelEvent.create({
      data: {
        orgId: org.id, eventId: 'real-evt-1', sessionId: 'real-sess', anonymousId: 'real-anon',
        eventName: 'purchase', value: '1290.00',
      },
    });
    await prisma.task.create({
      data: { orgId: org.id, tool: 'clickup', externalId: 'CU-REAL-1', title: 'Tarefa real do time', assignee: 'Ana', status: 'em_andamento' },
    });
    // Mesmo título de uma tarefa da semente, mas espelhada do ClickUp.
    const homonima = await prisma.task.create({
      data: { orgId: org.id, tool: 'clickup', externalId: 'CU-HOMONIMA', title: TITULO_HOMONIMO, assignee: 'Equipe', status: 'concluida' },
    });

    semear(script); // 1ª passagem sobre dados reais: só acrescenta a demonstração
    const aposPrimeira = await fotografia(org.id);

    // Edição de gente sobre linhas da semente tem de sobreviver ao reseed.
    const leadDaSemente = await prisma.lead.findFirstOrThrow({ where: { orgId: org.id, name: 'Ana Prado' } });
    await prisma.lead.update({ where: { id: leadDaSemente.id }, data: { status: 'ganho', score: 99 } });
    const campanhaDaSemente = await prisma.campaign.findFirstOrThrow({ where: { orgId: org.id, name: 'Lançamento Curso' } });
    await prisma.campaign.update({ where: { id: campanhaDaSemente.id }, data: { spend: '7777.00', status: 'pausada' } });
    const tarefaDaSemente = await prisma.task.findFirstOrThrow({
      where: { orgId: org.id, title: 'Revisar copy da página', externalId: null },
    });
    await prisma.task.update({ where: { id: tarefaDaSemente.id }, data: { status: 'concluida' } });
    const antes = await fotografia(org.id);

    semear(script); // 2ª passagem: idempotência
    const depois = await fotografia(org.id);

    // 1. a primeira passagem acrescentou a demonstração sem mexer no que era real
    const ids = (f: typeof antes, k: string) => new Set<string>(f[k].map((x: { id: string }) => x.id));
    const linhaReal = (k: string, id: string) => depois[k].find((x: { id: string }) => x.id === id);
    if (!linhaReal('fontes', fonteReal.id)) falhas.push('LeadSource real foi apagada');
    if (!linhaReal('campanhas', campanhaReal.id)) falhas.push('Campaign real foi apagada');
    if (!linhaReal('leads', leadReal.id)) falhas.push('Lead real foi apagado');
    if (!depois.pixels.some((p: { eventId: string }) => p.eventId === 'real-evt-1')) falhas.push('PixelEvent real foi apagado');
    if (!depois.eventos.some((e: { leadId: string }) => e.leadId === leadReal.id)) falhas.push('LeadEvent do lead real foi apagado');
    if (!depois.tarefas.some((t: { externalId: string | null }) => t.externalId === 'CU-REAL-1')) falhas.push('Task real foi apagada');

    // 2. a tarefa homônima espelhada continua intacta e a da semente convive com ela
    const hom = linhaReal('tarefas', homonima.id);
    if (!hom) falhas.push('Task homônima com externalId foi apagada');
    else if (hom.externalId !== 'CU-HOMONIMA' || hom.status !== 'concluida') falhas.push('Task homônima com externalId foi alterada');
    const comOTitulo = depois.tarefas.filter((t: { title: string }) => t.title === TITULO_HOMONIMO);
    if (comOTitulo.length !== 2) {
      falhas.push(`esperava 2 tarefas "${TITULO_HOMONIMO}" (a espelhada e a da semente), achei ${comOTitulo.length}`);
    }
    if (comOTitulo.filter((t: { externalId: string | null }) => t.externalId === null).length !== 1) {
      falhas.push('a tarefa da semente (externalId nulo) deveria existir uma vez só');
    }

    // 3. sem duplicação: a demonstração tem o tamanho fixo
    const contagem = {
      fontes: depois.fontes.length, campanhas: depois.campanhas.length, leads: depois.leads.length,
      pixels: depois.pixels.length, tarefas: depois.tarefas.length,
    };
    if (JSON.stringify(contagem) !== JSON.stringify({ fontes: 4, campanhas: 4, leads: 10, pixels: 41, tarefas: 7 })) {
      falhas.push(`contagem inesperada depois de duas execuções: ${JSON.stringify(contagem)}`);
    }

    // 4. a segunda passagem não muda nada, nem as edições feitas à mão
    if (JSON.stringify(antes) !== JSON.stringify(depois)) falhas.push('a segunda execução alterou linhas existentes');
    const leadDepois = linhaReal('leads', leadDaSemente.id);
    if (!leadDepois || leadDepois.status !== 'ganho' || leadDepois.score !== 99) falhas.push('edição do lead da semente se perdeu');
    const campDepois = linhaReal('campanhas', campanhaDaSemente.id);
    if (!campDepois || campDepois.status !== 'pausada' || campDepois.spend !== '7777') falhas.push('edição da campanha da semente se perdeu');
    const tarefaDepois = linhaReal('tarefas', tarefaDaSemente.id);
    if (!tarefaDepois || tarefaDepois.status !== 'concluida') falhas.push('edição da tarefa da semente se perdeu');

    // 5. o que a primeira passagem criou continua o mesmo, com os mesmos ids
    for (const k of ['fontes', 'campanhas', 'leads', 'pixels', 'tarefas']) {
      for (const id of ids(aposPrimeira, k)) {
        if (!ids(depois, k).has(id)) falhas.push(`${k}: linha ${id} da primeira passagem sumiu`);
      }
    }
    return falhas;
  }

  it('duas execuções sobre dados reais preservam tudo, sem duplicar a semente nem confundir tarefa homônima', async () => {
    expect(await cenario(SCRIPT)).toEqual([]);
  }, 180_000);

  it.skipIf(SCRIPT !== 'prisma/seed.ts')(
    'detecta um seed que identifica a tarefa só pelo título (mutante)',
    async () => {
      const mutante = mutanteDaTarefaPorTitulo();
      mutantes.push(mutante);
      const falhas = await cenario(mutante);
      expect(falhas.join(' | ')).toMatch(/tarefas? "Aprovar criativo Black Friday"|Task homônima/);
    },
    180_000,
  );
});
