/*
 * O IMPORTADOR DO CRM ANTIGO PELA LINHA DE COMANDO (rodada de produção 1, 21/10/2026).
 *
 *   node dist/scripts/importar-crm.js --org <apelido|id> [--como <e-mail>] [--detalhe <arquivo>]
 *   node dist/scripts/importar-crm.js --org <apelido|id> --como <e-mail> --valer [--detalhe <arquivo>] [--web <origem>]
 *
 * Padrão `--simular`: só lê e imprime as contagens do plano. Escreve só com `--valer`.
 * `--como` é a pessoa da casa em nome de quem o importador registra (relida no banco,
 * ativa, com `leads.editar` e `tarefas.editar`; conta de máquina é recusada) e é
 * obrigatório para `--valer`. `--detalhe` grava o plano COM TÍTULOS num arquivo, que
 * precisa ficar fora de repositório git (é dado de cliente). O console só mostra
 * contagens: nenhum título, nome, telefone ou e-mail sai no stdout, no stderr ou no log.
 *
 * A sequência na produção: `--simular` → conferir com o Rodrigo → `--valer` →
 * `--simular` de novo, que tem de dar zero a fazer.
 *
 * Roda compilado (Nest), contra o banco de `DATABASE_URL`, com as tarefas de fundo
 * desligadas (`sem-tarefas-de-fundo.ts`, o PRIMEIRO import). A lógica mora em
 * `comercial/importador-crm/`; aqui só os argumentos, a pessoa e a saída.
 *
 * Códigos de saída: 0 ok; 1 falhou antes ou no meio; 2 houve erro em algum cartão
 * (o resto seguiu; o detalhe tem o motivo); 3 algum efeito externo foi contado a
 * mais depois da passada (não deveria acontecer nunca: confira antes de seguir).
 */
import './sem-tarefas-de-fundo';

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';

import { AppModule } from '../app.module';
import { comContexto } from '../common/contexto-execucao';
import {
  ImportadorCrmService,
  type EfeitosContados,
  type RelatorioDoImportador,
} from '../comercial/importador-crm/importador-crm.service';
import { uuidDe } from '../comercial/eventos';
import { dentroDeGit } from '../comercial/importador-crm/detalhe';

function opcao(args: string[], nome: string): string | undefined {
  const i = args.indexOf(`--${nome}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}

const celula = (s: string) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

function markdownDoDetalhe(r: RelatorioDoImportador, quando: string): string {
  return [
    `# Importador do CRM antigo · ${r.modo} · ${quando}`,
    '',
    'Fora do git: tem título e nome de cliente.',
    '',
    '## Plano',
    '',
    '| passo | item | ação | motivo | id |',
    '|---|---|---|---|---|',
    ...r.detalhe.map((l) => `| ${l.passo} | ${celula(l.item)} | ${celula(l.acao)} | ${celula(l.motivo)} | ${l.id} |`),
    '',
    '## Sobras (ficaram onde estavam)',
    '',
    '| item | onde | por quê | id |',
    '|---|---|---|---|',
    ...r.sobrasDetalhe.map((s) => `| ${celula(s.titulo)} | ${celula(s.onde)} | ${celula(s.motivo)} | ${s.cartaoId} |`),
    '',
  ].join('\n');
}

function diferencaDosEfeitos(a: EfeitosContados, b: EfeitosContados): Record<string, number> {
  const d: Record<string, number> = {};
  for (const k of Object.keys(a) as (keyof EfeitosContados)[]) if (b[k] !== a[k]) d[k] = b[k] - a[k];
  return d;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const org = opcao(args, 'org');
  const como = opcao(args, 'como');
  const detalhe = opcao(args, 'detalhe');
  const web = opcao(args, 'web') ?? (process.env.WEB_ORIGIN ?? '').split(',')[0]?.trim() ?? '';
  const valer = args.includes('--valer');
  if (valer && args.includes('--simular')) throw new Error('escolha um: --simular (padrão) ou --valer.');
  if (!org) throw new Error('falta --org <apelido|id>: o importador nunca escolhe a empresa sozinho.');
  if (valer && !como) throw new Error('falta --como <e-mail>: a passada que escreve registra em nome de uma pessoa da casa.');
  if (detalhe && dentroDeGit(detalhe)) throw new Error('o arquivo de --detalhe tem dado de cliente: grave fora de repositório git.');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL vazia. Nunca passe a URL na linha de comando.');

  // A empresa e a pessoa, lidas antes do Nest pela conexão dona (o padrão de `gerar-documentacao`).
  const dono = new PrismaClient({ datasourceUrl: url });
  let orgId: string;
  let pessoa: { id: string; nome: string | null; papeis: string[] } | null = null;
  try {
    const empresa = await dono.org.findFirst({ where: { OR: [{ id: org }, { slug: org }] }, select: { id: true } });
    if (!empresa) throw new Error('a empresa de --org não existe neste banco.');
    orgId = empresa.id;
    if (como) {
      const u = await dono.user.findFirst({
        where: { orgId, isActive: true, OR: [{ email: como.toLowerCase() }, { email: como }, { id: como }] },
        select: { id: true, name: true, roles: { select: { key: true } } },
      });
      if (!u) throw new Error('a pessoa de --como não é um usuário ativo desta empresa.');
      pessoa = { id: u.id, nome: u.name, papeis: u.roles.map((r) => r.key) };
    }
  } finally {
    await dono.$disconnect();
  }

  // Só erro: o stdout fica com o JSON de contagens, e aviso de arranque não é deste script.
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const svc = app.get(ImportadorCrmService);
    const agora = new Date();
    const r = await comContexto(
      { orgId, actorType: pessoa ? 'user' : null, actorId: pessoa?.id ?? null, correlationId: uuidDe([orgId, 'importar-crm', agora.toISOString()]), origem: 'script' },
      async () => (pessoa
        ? await svc.executar(orgId, pessoa, { valer, web, agora })
        : await svc.executarSemPessoa(orgId, { valer: false, web, agora })),
    );
    if (detalhe) {
      mkdirSync(path.dirname(path.resolve(detalhe)), { recursive: true });
      // Tem dado de cliente: só o dono do arquivo lê (no Windows o modo é ignorado).
      writeFileSync(detalhe, markdownDoDetalhe(r, agora.toISOString()), { encoding: 'utf8', mode: 0o600 });
    }
    const diferenca = diferencaDosEfeitos(r.efeitos.antes, r.efeitos.depois);
    // Só contagens. Nada de título, nome, telefone, e-mail ou id de pessoa.
    console.log(JSON.stringify({
      modo: r.modo,
      crmEncontrado: r.crmEncontrado,
      cartoes: r.cartoes,
      passos: r.passos,
      porDestino: r.porDestino,
      sobras: r.sobras,
      erros: r.erros,
      efeitosExternos: { antes: r.efeitos.antes, depois: r.efeitos.depois, diferenca },
      detalheGravado: !!detalhe,
    }, null, 2));
    const aFazer = Object.values(r.passos).reduce((s, p) => s + p.aFazer, 0);
    if (r.modo === 'simular') console.log(aFazer ? `${aFazer} escrita(s) a fazer. Nada foi escrito.` : 'Zero a fazer: o banco já está como o importador deixa.');
    if (Object.keys(diferenca).length) {
      console.error('ATENÇÃO: algum efeito externo mudou durante a passada. Confira antes de seguir.');
      return 3;
    }
    if (r.erros) {
      console.error(`${r.erros} cartão(ões) com erro: o motivo está no arquivo de --detalhe.`);
      return 2;
    }
    return 0;
  } finally {
    await app.close();
  }
}

/** Sai de verdade (ver `provisionar-tenant.ts`): o Nest deixa temporizadores vivos. */
function sairCom(codigo: number): void {
  process.stdout.write('', () => process.exit(codigo));
}

main().then(
  (codigo) => sairCom(codigo),
  (e) => {
    // A mensagem é nossa (sem dado de cliente); nada do banco é ecoado.
    console.error('\nfalhou:', (e as Error).message);
    sairCom(1);
  },
);
