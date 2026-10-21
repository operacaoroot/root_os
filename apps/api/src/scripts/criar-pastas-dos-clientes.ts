/*
 * AS PASTAS DOS CLIENTES QUE JÁ EXISTEM, PELA LINHA DE COMANDO (rodada dos agentes, 21/10/2026, TR-04).
 *
 *   node dist/scripts/criar-pastas-dos-clientes.js --org <apelido|id> [--detalhe <arquivo>]
 *   node dist/scripts/criar-pastas-dos-clientes.js --org <apelido|id> --como <e-mail> --valer [--detalhe <arquivo>]
 *
 * Padrão `--simular`: só lê e imprime as contagens. Com `--valer`, pede a pasta de
 * cada cliente ativo, não interno e sem ponteiro pela MESMA porta do botão
 * "Criar pasta do cliente" (`drive.pasta.criar`, R3): cada pedido fica RETIDO na
 * fila de aprovação (`/atendimento`) e espera uma SEGUNDA pessoa, porque quem
 * propõe é a pessoa de `--como` e quem propõe não aprova. Quando a aprovação é
 * confirmada, o efeito LIGA a pasta de mesmo nome que já existe na raiz (nada é
 * escrito no Drive) ou CRIA a nova copiando o `_modelo-cliente`.
 *
 * `--como` é obrigatório para `--valer` (relida no banco: ativa, desta empresa,
 * com `tarefas.editar` ou `leads.editar`; conta de máquina é recusada).
 * `--detalhe` grava a lista COM O NOME de cada cliente num arquivo fora de
 * repositório git (modo 600). O console só mostra contagens.
 *
 * A sequência na produção: `--simular` → conferir com o Rodrigo → `--valer` →
 * aprovar em /atendimento (outra pessoa) → `--simular` de novo, que tem de dar
 * zero a propor.
 *
 * Códigos de saída: 0 ok; 1 falhou; 2 algum cliente deu erro ou a empresa está
 * sem raiz/sem Google (o motivo está no detalhe).
 */
import './sem-tarefas-de-fundo';

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';

import { AppModule } from '../app.module';
import { temPapelDeMaquina } from '../approvals/alcada';
import { comContexto, novaCorrelacao } from '../common/contexto-execucao';
import { PastaDoClienteService } from '../clientes/pasta-do-cliente/pasta-do-cliente.service';
import { dentroDeGit, planoDasPastas, proporPastas, type PlanoDasPastas } from '../clientes/pasta-do-cliente/pastas-dos-clientes';
import { PrismaService } from '../prisma/prisma.service';

function opcao(args: string[], nome: string): string | undefined {
  const i = args.indexOf(`--${nome}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}

const celula = (s: string) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

function markdownDoDetalhe(p: PlanoDasPastas, quando: string): string {
  return [
    `# Pastas dos clientes · ${p.modo} · ${quando}`,
    '',
    'Fora do git: tem nome de cliente.',
    '',
    '| nome da pasta | ação | resultado | aprovação | motivo | id |',
    '|---|---|---|---|---|---|',
    ...p.linhas.map((l) => `| ${celula(l.nome)} | ${l.acao} | ${l.resultado ?? ''} | ${l.approvalId ?? ''} | ${celula(l.motivo ?? '')} | ${l.partnerId} |`),
    '',
  ].join('\n');
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const org = opcao(args, 'org');
  const como = opcao(args, 'como');
  const detalhe = opcao(args, 'detalhe');
  const valer = args.includes('--valer');
  if (valer && args.includes('--simular')) throw new Error('escolha um: --simular (padrão) ou --valer.');
  if (!org) throw new Error('falta --org <apelido|id>: o script nunca escolhe a empresa sozinho.');
  if (valer && !como) throw new Error('falta --como <e-mail>: os pedidos de pasta vão à fila de aprovação em nome de uma pessoa da casa.');
  if (detalhe && dentroDeGit(detalhe)) throw new Error('o arquivo de --detalhe tem nome de cliente: grave fora de repositório git.');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL vazia. Nunca passe a URL na linha de comando.');

  const dono = new PrismaClient({ datasourceUrl: url });
  let orgId: string;
  let pessoaId: string | null = null;
  try {
    const empresa = await dono.org.findFirst({ where: { OR: [{ id: org }, { slug: org }] }, select: { id: true } });
    if (!empresa) throw new Error('a empresa de --org não existe neste banco.');
    orgId = empresa.id;
    if (como) {
      const u = await dono.user.findFirst({
        where: { orgId, isActive: true, OR: [{ email: como.toLowerCase() }, { email: como }, { id: como }] },
        select: { id: true, roles: { select: { key: true, permissions: { select: { key: true } } } } },
      });
      if (!u) throw new Error('a pessoa de --como não é um usuário ativo desta empresa.');
      const papeis = u.roles.map((r) => r.key);
      if (temPapelDeMaquina(papeis)) throw new Error('a pessoa de --como é conta de máquina: pedir pasta é de gente.');
      const perms = new Set(u.roles.flatMap((r) => r.permissions.map((p) => p.key)));
      if (!perms.has('tarefas.editar') && !perms.has('leads.editar')) throw new Error('a pessoa de --como não tem tarefas.editar nem leads.editar.');
      pessoaId = u.id;
    }
  } finally {
    await dono.$disconnect();
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const pastas = app.get(PastaDoClienteService);
    const agora = new Date();
    const plano = await comContexto(
      { orgId, actorType: pessoaId ? 'user' : null, actorId: pessoaId, correlationId: novaCorrelacao('pastas-dos-clientes'), origem: 'script' },
      () => (valer && pessoaId ? proporPastas(prisma, pastas, orgId, pessoaId) : planoDasPastas(prisma, orgId)),
    );
    if (detalhe) {
      mkdirSync(path.dirname(path.resolve(detalhe)), { recursive: true });
      // Tem nome de cliente: só o dono do arquivo lê (no Windows o modo é ignorado).
      writeFileSync(detalhe, markdownDoDetalhe(plano, agora.toISOString()), { encoding: 'utf8', mode: 0o600 });
    }
    // Só contagens. Nada de nome de cliente.
    console.log(
      JSON.stringify(
        {
          modo: plano.modo,
          candidatos: plano.candidatos,
          comPonteiro: plano.comPonteiro,
          internos: plano.internos,
          semNome: plano.semNome,
          aguardandoAprovacao: plano.aguardandoAprovacao,
          aPropor: plano.aPropor,
          resultados: plano.resultados,
          detalheGravado: !!detalhe,
        },
        null,
        2,
      ),
    );
    if (plano.modo === 'simular') {
      console.log(plano.aPropor ? `${plano.aPropor} pedido(s) de pasta a propor. Nada foi escrito.` : 'Zero a propor: todo cliente tem pasta ou pedido na fila.');
    } else {
      console.log('Os pedidos estão na fila de aprovação (/atendimento): outra pessoa confirma cada um.');
    }
    if ((plano.resultados.erro ?? 0) > 0 || (plano.resultados.sem_raiz ?? 0) > 0) {
      console.error('Algum pedido não foi feito: o motivo está no arquivo de --detalhe.');
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
    // A mensagem é nossa (sem nome de cliente); nada do banco é ecoado.
    console.error('\nfalhou:', (e as Error).message);
    sairCom(1);
  },
);
