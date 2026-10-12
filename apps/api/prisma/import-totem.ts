import { readFileSync } from 'node:fs';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  TOTEM_ALERGENICOS_DO_SISTEMA_ANTERIOR,
  TotemProdutoAntigoSchema,
  totemProdutoDoSistemaAnterior,
} from '../src/totem/gestao/importacao';
import { totemGestaoDadosDoProduto } from '../src/totem/gestao/regras';

/*
 * Importa o catálogo do sistema anterior (sragranel.com) para o totem de uma
 * empresa. O arquivo é a lista de produtos que a API antiga devolve.
 *
 *   TOTEM_ORG_SLUG=sragranel TOTEM_IMPORT_ARQUIVO=/caminho/produtos.json \
 *     pnpm --filter @mktos/api db:import:totem
 *
 * Pode rodar de novo: o produto cujo código já existe fica como está, então o
 * que a loja editou no painel não volta ao estado do sistema anterior. Os
 * produtos de exemplo da semente saem do ar, e o aviso de alergênicos do
 * sistema anterior vira o padrão só se a configuração ainda não tiver um.
 */

const prisma = new PrismaClient();

function parar(mensagem: string): never {
  console.error(`\n${mensagem}\n`);
  process.exit(1);
}

async function main() {
  const slug = process.env.TOTEM_ORG_SLUG?.trim();
  if (!slug) parar('Defina TOTEM_ORG_SLUG com o slug da empresa que recebe o catálogo.');
  const arquivo = process.env.TOTEM_IMPORT_ARQUIVO?.trim();
  if (!arquivo) parar('Defina TOTEM_IMPORT_ARQUIVO com o caminho do JSON do sistema anterior.');

  const org = await prisma.org.findUnique({ where: { slug } });
  if (!org) parar(`A empresa "${slug}" não existe.`);
  if (!org.isActive) parar(`A empresa "${slug}" está desativada.`);
  if (!org.modulos.includes('totem')) parar(`A empresa "${slug}" não tem o módulo totem. Rode a semente do totem antes.`);
  const orgId = org.id;

  let bruto: unknown;
  try {
    bruto = JSON.parse(readFileSync(arquivo, 'utf8'));
  } catch (e) {
    parar(`Não deu para ler ${arquivo}: ${(e as Error).message}`);
  }
  if (!Array.isArray(bruto)) parar(`${arquivo} não é uma lista de produtos.`);

  // Tudo é validado antes da primeira escrita: um item fora da forma para a importação inteira.
  const recusados: string[] = [];
  const produtos = bruto.flatMap((item, i) => {
    const antigo = TotemProdutoAntigoSchema.safeParse(item);
    if (!antigo.success) {
      recusados.push(`  item ${i}: ${antigo.error.issues[0]?.path.join('.')} ${antigo.error.issues[0]?.message}`);
      return [];
    }
    try {
      return [totemProdutoDoSistemaAnterior(antigo.data)];
    } catch (e) {
      recusados.push(`  item ${i} (id ${antigo.data.id}): ${(e as Error).message.split('\n')[0]}`);
      return [];
    }
  });
  if (recusados.length) parar(`${recusados.length} item(ns) fora da forma esperada:\n${recusados.slice(0, 20).join('\n')}`);

  const codigos = new Map<string, number>();
  for (const p of produtos) codigos.set(p.codigo, (codigos.get(p.codigo) ?? 0) + 1);
  const repetidos = [...codigos].filter(([, n]) => n > 1).map(([c]) => c);
  if (repetidos.length) parar(`Códigos repetidos no arquivo: ${repetidos.slice(0, 20).join(', ')}`);

  const existentes = new Set(
    (await prisma.totemProduto.findMany({ where: { orgId }, select: { codigo: true } })).map((p) => p.codigo),
  );
  const novos = produtos.filter((p) => !existentes.has(p.codigo));

  const resultado = await prisma.$transaction(async (tx) => {
    const criados = await tx.totemProduto.createMany({
      data: novos.map((p) => {
        const dados = totemGestaoDadosDoProduto(p);
        return {
          ...dados,
          orgId,
          codigo: p.codigo,
          nome: p.nome,
          nomeBusca: dados.nomeBusca!,
          nutricional: (dados.nutricional ?? []) as Prisma.InputJsonValue,
        };
      }),
      skipDuplicates: true,
    });
    const exemplos = await tx.totemProduto.updateMany({
      where: { orgId, exemplo: true, ativo: true },
      data: { ativo: false },
    });
    const alergenicos = await tx.totemConfig.updateMany({
      where: { orgId, OR: [{ alergenicosPadrao: null }, { alergenicosPadrao: '' }] },
      data: { alergenicosPadrao: TOTEM_ALERGENICOS_DO_SISTEMA_ANTERIOR },
    });
    return { criados: criados.count, exemplos: exemplos.count, alergenicos: alergenicos.count };
  });

  const semTabela = produtos.filter((p) => !p.nutricional?.length).length;
  const semCodigo = produtos.filter((p) => p.codigo.startsWith('SC-')).length;
  console.log(`\nCatálogo do sistema anterior → "${slug}"`);
  console.log(`  no arquivo ................ ${produtos.length}`);
  console.log(`  criados ................... ${resultado.criados}`);
  console.log(`  já existiam (mantidos) .... ${produtos.length - novos.length}`);
  console.log(`  sem tabela nutricional .... ${semTabela}`);
  console.log(`  sem código (SC-<id>) ...... ${semCodigo}`);
  console.log(`  exemplos tirados do ar .... ${resultado.exemplos}`);
  console.log(`  aviso de alergênicos ...... ${resultado.alergenicos ? 'gravado como padrão' : 'mantido o que já havia'}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
