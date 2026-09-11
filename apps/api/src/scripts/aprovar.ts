/*
 * A fila de aprovação pela linha de comando.
 *
 * Sem argumento, LISTA o que está esperando. Com um id, confirma E executa —
 * o mesmo caminho da tela, incluindo as travas todas.
 *
 *   node dist/scripts/aprovar.js
 *   node dist/scripts/aprovar.js <approvalId> --como pedro@empresa.com
 *   node dist/scripts/aprovar.js <approvalId> --como pedro@empresa.com \
 *     --motivo "cliente confirmou por telefone às 14h"
 *
 * Roda compilado: tsx não emite metadata de decorator e o Nest não injeta nada.
 *
 * ---------------------------------------------------------------------------
 * POR QUE `--como` PASSOU A SER UM E-MAIL, E NÃO UM NOME (11/09/2026)
 * ---------------------------------------------------------------------------
 * Até a fatia 3.4 este script mandava para `confirm` o texto que viesse depois
 * de `--como` — "Pedro", ou o `$USER` do terminal. Aquilo virava `aprovadoPorId`
 * e `actorId` no RASTRO: a fila registrava como aprovador uma string que não era
 * usuário nenhum, e nenhuma das travas de alçada tinha em quem se apoiar.
 *
 * Agora o script RESOLVE a pessoa: procura um usuário ativo da empresa pelo
 * e-mail (ou pelo id) e passa `{ id, papeis }`. É o mesmo contrato da tela, e é
 * o que faz a alçada valer também aqui — aprovar R4 pelo terminal passou a pedir
 * titular, como na tela.
 *
 * R4 E R5 PEDEM A SENHA, e ela é lida do terminal com o eco desligado — nunca de
 * argumento (`ps` mostra argumento para qualquer usuário da máquina) e nunca de
 * variável de ambiente. Quem não quiser digitar senha em terminal aprova pela
 * tela; este caminho existe para quando a tela não está no ar.
 */
import { createInterface } from 'node:readline';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { AcoesService } from '../gateway/acoes.service';

/** Valor de uma opção `--nome valor`, ou `undefined`. */
function opcao(args: string[], nome: string): string | undefined {
  const i = args.indexOf(`--${nome}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}

/**
 * Lê uma linha do terminal SEM ecoar o que se digita.
 *
 * `readline` com `output` e um `_writeToOutput` que engole tudo é o jeito sem
 * dependência nova de esconder a senha. Quando a entrada não é um terminal
 * (canos, CI), não há o que esconder e nem o que perguntar: devolve vazio, e
 * quem chamou recusa com mensagem em vez de travar esperando para sempre.
 */
function perguntarSenha(rotulo: string): Promise<string> {
  if (!process.stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => undefined;
    process.stdout.write(rotulo);
    rl.question('', (resposta) => {
      rl.close();
      process.stdout.write('\n');
      resolve(resposta);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const id = args.find((a) => !a.startsWith('--'));
  const como = opcao(args, 'como');
  const motivo = opcao(args, 'motivo');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const approvals = app.get(ApprovalsService);
    const acoes = app.get(AcoesService);

    const org = await prisma.org.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
    if (!org) throw new Error('nenhuma empresa ativa');

    if (!id) {
      const fila = await approvals.listar(org.id);
      if (!fila.items.length) {
        console.log('\nA fila está vazia.\n');
        return;
      }
      console.log(`\n${fila.total} ação(ões) esperando gente:\n`);
      for (const a of fila.items) {
        const min = Math.floor(a.esperandoMs / 60000);
        console.log(`  ${a.nivel}  ${a.id}`);
        console.log(`      ${a.resumo}`);
        console.log(`      ${a.capacidade ?? '—'} · esperando há ${min} min · expira ${new Date(a.expiraEm).toLocaleTimeString('pt-BR')}`);
        console.log('');
      }
      console.log('para aprovar:  node dist/scripts/aprovar.js <id> --como <seu e-mail>\n');
      return;
    }

    if (!como) {
      throw new Error(
        'falta --como <e-mail>. Aprovar exige um USUÁRIO desta empresa, não um nome: é dele que ' +
          'saem a alçada e a linha do RASTRO.',
      );
    }

    // Por e-mail ou por id — os dois são identificadores de gente. `isActive` na
    // consulta é adiantamento: a trava de verdade está em `confirm`, que relê o
    // banco. Aqui é só para a mensagem sair boa antes de gastar a viagem.
    const usuario = await prisma.user.findFirst({
      where: { orgId: org.id, isActive: true, OR: [{ email: como }, { id: como }] },
      select: { id: true, email: true, name: true, roles: { select: { key: true } } },
    });
    if (!usuario) {
      throw new Error(
        `não achei usuário ativo "${como}" na empresa ${org.slug}. Use o e-mail com que a pessoa ` +
          'entra no sistema.',
      );
    }
    const papeis = usuario.roles.map((r) => r.key);

    // O nível decide se a senha é pedida. Ler a linha antes é o que permite
    // perguntar UMA vez, no terminal, em vez de falhar e mandar tentar de novo.
    const linha = await prisma.approval.findFirst({
      where: { id, orgId: org.id },
      select: { nivelExigido: true, exigeReauth: true },
    });
    if (!linha) throw new Error(`aprovação ${id} não existe nesta empresa`);

    let reauth: { senha: string } | undefined;
    if (linha.exigeReauth) {
      const senha = await perguntarSenha(
        `senha de ${usuario.email} (${linha.nivelExigido} exige reautenticação): `,
      );
      if (!senha) {
        throw new Error(
          `${linha.nivelExigido} exige reautenticação e não há terminal para pedir a senha. ` +
            'Aprove pela tela, ou rode este script num terminal de verdade.',
        );
      }
      reauth = { senha };
    }

    console.log(`\nconfirmando ${id} como ${usuario.name} <${usuario.email}>…`);
    const conf = await approvals.confirm(org.id, id, { id: usuario.id, papeis, reauth }, motivo);
    console.log(`  confirmada: ${conf.summary}`);

    const exec = await acoes.executarAprovada(org.id, id, usuario.id);
    if (exec.status === 'executado') {
      console.log(`  EXECUTADA: ${JSON.stringify(exec.resultado)}\n`);
    } else if (exec.status === 'sem_efeito') {
      console.log(`  NÃO EXECUTADA: ${exec.motivo}\n`);
    } else {
      console.log('  nada a executar (aprovação da superfície antiga)\n');
    }
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error('\nfalhou:', (e as Error).message);
  process.exit(1);
});
