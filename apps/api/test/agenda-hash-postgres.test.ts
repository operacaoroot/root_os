import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { AgendaLocalService } from '../src/agents/agenda-local.service';

// Opt-in em arquivo privado: { connectionString }, sempre clone em loopback.
// Apenas SELECT numa transação READ ONLY. Nunca cria extensão ou altera schema.
const arquivo = process.env.AGENDA_HASH_QA_FILE;
let conexao: string | undefined;
if (arquivo) {
  if ((statSync(arquivo).mode & 0o077) !== 0) throw new Error('A configuração QA precisa ser privada.');
  conexao = JSON.parse(readFileSync(arquivo, 'utf8')).connectionString;
  const url = new URL(conexao!);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('O ensaio só aceita clone QA em loopback.');
}
const fixtures = [
  { input: { z: [null, true, 0, 'ação'], a: { y: 2, x: 1 } }, canonical: '{"a":{"x":1,"y":2},"z":[null,true,0,"ação"]}' },
  { input: { aspas: '"texto"', quebra: 'a\nb', unicode: '🌱' }, canonical: '{"aspas":"\\"texto\\"","quebra":"a\\nb","unicode":"🌱"}' },
  { input: { receipt: { versao: 1, ativo: false }, escopo: { actorId: 'qa', orgId: 'qa-org' } }, canonical: '{"escopo":{"actorId":"qa","orgId":"qa-org"},"receipt":{"ativo":false,"versao":1}}' },
];
describe.skipIf(!conexao).sequential('Agenda: hash real em PostgreSQL sem pgcrypto', () => {
  let client: Client;
  let tx: Prisma.TransactionClient;
  const service = new AgendaLocalService(null as never, null as never, null as never);
  beforeAll(async () => {
    client = new Client({ connectionString: conexao }); await client.connect();
    await client.query('BEGIN READ ONLY');
    const absent = await client.query("SELECT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pgcrypto') AS absent");
    expect(absent.rows[0].absent).toBe(true);
    tx = { $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.reduce((out, part, i) => out + (i ? `$${i}` : '') + part, '');
      return (await client.query(query, values)).rows;
    } } as unknown as Prisma.TransactionClient;
  });
  afterAll(async () => { if (client) { await client.query('ROLLBACK').catch(() => {}); await client.end(); } });
  it.each(fixtures)('preserva bytes UTF-8 e canonização do contrato: $canonical', async ({ input, canonical }) => {
    const canonico = await client.query('SELECT public.app_json_canonico($1::jsonb) AS value', [JSON.stringify(input)]);
    expect(canonico.rows[0].value).toBe(canonical);
    const hash = await service.hashNoTx(tx, input);
    expect(hash).toBe(createHash('sha256').update(canonical, 'utf8').digest('hex'));
  });
});

// Recusa de resultado inválido não depende de banco e permanece no conjunto padrão.
describe('Agenda: recusa de assinatura não confirmada', () => {
  const service = new AgendaLocalService(null as never, null as never, null as never);
  it.each([[], [{ hash: 'inválido' }], [{ hash: 'a'.repeat(64) }, { hash: 'a'.repeat(64) }]].map(rows => ({ rows })))('recusa resultado inválido da consulta %#', async ({ rows }) => {
    const tx = { $queryRaw: async () => rows } as unknown as Prisma.TransactionClient;
    await expect(service.hashNoTx(tx, { tipo: 'exercicio' })).rejects.toThrow('assinatura');
  });
});
