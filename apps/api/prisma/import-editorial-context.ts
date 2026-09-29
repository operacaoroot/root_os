import 'reflect-metadata';
import { ActorType, ContextKind, ContextSource } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { comContexto, novaCorrelacao } from '../src/common/contexto-execucao';
import { EventLogService } from '../src/gateway/event-log.service';
import { MemoriaService, type NotaDeContexto, type VersaoDeNota } from '../src/memory/memoria.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  CAMINHO_DA_MARCA, CHAVE_DA_MARCA_NA_VAULT,
  prepararPlano, type EntradaEditorial, type OrigemSelecionada, type PlanoEditorial,
} from './import-editorial-context.plan';

type Memoria = Pick<MemoriaService, 'porChave' | 'criar' | 'historico'>;
type Acao = 'criar' | 'criado' | 'igual' | 'reusar-vault' | 'conflito' | 'evento-pendente';
export type LinhaDoPlano = {
  chave: string; acao: Acao; contentHash: string; itemId?: string;
  versao?: number; eventoSeq?: string | null;
};

function mesmaNota(atual: NotaDeContexto, entrada: EntradaEditorial): boolean {
  return atual.arquivadoEm === null && atual.kind === ContextKind.nota &&
    atual.title === entrada.title && atual.body === entrada.body &&
    atual.contentHash === entrada.contentHash &&
    atual.sourceType === entrada.sourceType && atual.sourceRef === entrada.sourceRef &&
    [...atual.tags].sort().join('\0') === [...entrada.tags].sort().join('\0');
}
function eloIntegro(versoes: VersaoDeNota[], aceitarMigracao = false): boolean {
  // O acervo antigo pode ter nascido por migração declarada. Uma criação feita
  // por esta CLI precisa ter evento próprio; falha_ao_registrar não basta.
  return versoes.length > 0 && versoes.some((v) => v.versao === 1) &&
    versoes.every((v) => v.eventoSeq !== null ||
      (aceitarMigracao && v.versao === 1 && v.semEventoPorque === 'migracao'));
}

export async function planejarImportacao(memoria: Memoria, orgId: string, plano: PlanoEditorial): Promise<LinhaDoPlano[]> {
  const linhas: LinhaDoPlano[] = [];
  for (const entrada of plano.entradas) {
    const atual = await memoria.porChave(orgId, entrada.chave);
    if (entrada.origem === 'marca') {
      const canonica = await memoria.porChave(orgId, CHAVE_DA_MARCA_NA_VAULT);
      if (canonica) {
        const compativel = canonica.arquivadoEm === null && canonica.kind === ContextKind.nota &&
          canonica.sourceType === ContextSource.vault && canonica.sourceRef === CAMINHO_DA_MARCA &&
          canonica.contentHash === entrada.contentHash && canonica.body === entrada.body &&
          canonica.title === entrada.title;
        if (!compativel || atual) {
          linhas.push({ chave: entrada.chave, acao: 'conflito', contentHash: entrada.contentHash, itemId: canonica.id });
          continue;
        }
        const versoes = await memoria.historico(orgId, canonica.id);
        linhas.push({ chave: entrada.chave, acao: eloIntegro(versoes, true) ? 'reusar-vault' : 'evento-pendente',
          contentHash: entrada.contentHash, itemId: canonica.id, versao: canonica.versao,
          eventoSeq: versoes.find((v) => v.versao === canonica.versao)?.eventoSeq ?? null });
        continue;
      }
    }
    if (!atual) {
      linhas.push({ chave: entrada.chave, acao: 'criar', contentHash: entrada.contentHash });
      continue;
    }
    if (!mesmaNota(atual, entrada)) {
      linhas.push({ chave: entrada.chave, acao: 'conflito', contentHash: entrada.contentHash, itemId: atual.id });
      continue;
    }
    const versoes = await memoria.historico(orgId, atual.id);
    linhas.push({ chave: entrada.chave, acao: eloIntegro(versoes) ? 'igual' : 'evento-pendente',
      contentHash: entrada.contentHash, itemId: atual.id, versao: atual.versao,
      eventoSeq: versoes.find((v) => v.versao === atual.versao)?.eventoSeq ?? null });
  }
  return linhas;
}

export async function aplicarImportacao(memoria: Memoria, orgId: string, plano: PlanoEditorial): Promise<LinhaDoPlano[]> {
  const antes = await planejarImportacao(memoria, orgId, plano);
  if (antes.some((linha) => linha.acao === 'conflito' || linha.acao === 'evento-pendente')) {
    throw new Error('Há conflito ou evento ausente. Nenhuma nova nota foi criada.');
  }
  const resultado: LinhaDoPlano[] = [];
  for (const entrada of plano.entradas) {
    const prevista = antes.find((linha) => linha.chave === entrada.chave)!;
    if (prevista.acao !== 'criar') {
      const novaLeitura = await planejarImportacao(memoria, orgId, { arquivos: {}, entradas: [entrada] });
      if (novaLeitura[0].acao !== prevista.acao || novaLeitura[0].itemId !== prevista.itemId) {
        throw new Error(`Banco mudou antes da conferência de ${entrada.chave}. Refaça o dry-run.`);
      }
      resultado.push(novaLeitura[0]);
      continue;
    }
    // Reconfere imediatamente antes de gravar. MemoriaService.criar também
    // protege a chave sob advisory lock se outra execução entrar em paralelo.
    const novaLeitura = await planejarImportacao(memoria, orgId, { arquivos: {}, entradas: [entrada] });
    if (novaLeitura[0].acao !== 'criar') throw new Error(`Banco mudou antes da criação de ${entrada.chave}. Refaça o dry-run.`);
    const criada = await memoria.criar(orgId, {
      chave: entrada.chave, kind: entrada.kind, title: entrada.title, body: entrada.body,
      tags: entrada.tags, sourceType: entrada.sourceType, sourceRef: entrada.sourceRef,
      motivo: entrada.motivo,
    });
    const versoes = await memoria.historico(orgId, criada.id);
    if (versoes.length !== 1 || versoes[0].eventoId === null || versoes[0].eventoSeq === null ||
        versoes[0].contentHash !== entrada.contentHash) {
      throw new Error(`Nota ${entrada.chave} foi criada, mas o evento não ficou íntegro. Pare e confira /memoria/integridade.`);
    }
    resultado.push({ chave: entrada.chave, acao: 'criado', contentHash: entrada.contentHash,
      itemId: criada.id, versao: 1, eventoSeq: versoes[0].eventoSeq });
  }
  return resultado;
}

type Opcoes = {
  only: OrigemSelecionada;
  docsJson?: string;
  marcaMd?: string;
  orgId?: string;
  offline: boolean;
  apply: boolean;
  expectDocsSha256?: string;
  expectMarcaSha256?: string;
};
function argumentos(argv: string[]): Opcoes {
  const out: Opcoes = { only: 'ambos', offline: false, apply: false };
  const valores: Record<string, keyof Opcoes> = {
    '--only': 'only', '--docs-json': 'docsJson', '--marca-md': 'marcaMd', '--org-id': 'orgId',
    '--expect-docs-sha256': 'expectDocsSha256', '--expect-marca-sha256': 'expectMarcaSha256',
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--offline') out.offline = true;
    else if (flag === '--apply') out.apply = true;
    else if (flag in valores) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`Falta valor para ${flag}`);
      (out as unknown as Record<string, unknown>)[valores[flag]] = value;
    } else throw new Error(`Argumento desconhecido: ${flag}`);
  }
  if (!['ambos', 'clickup', 'marca'].includes(out.only)) throw new Error('--only aceita ambos, clickup ou marca');
  if (out.offline && out.apply) throw new Error('--offline não pode ser usado com --apply');
  if (out.only !== 'marca' && !out.docsJson) throw new Error('Informe --docs-json');
  if (out.only !== 'clickup' && !out.marcaMd) throw new Error('Informe --marca-md');
  if (!out.offline && (!out.orgId || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(out.orgId))) {
    throw new Error('Informe --org-id UUID para consultar o banco');
  }
  return out;
}
function hashEsperado(esperado: string | undefined, atual: string | undefined, nome: string, obrigatorio: boolean): void {
  if (obrigatorio && !esperado) throw new Error(`--apply exige --expect-${nome}-sha256 do dry-run`);
  if (esperado && esperado.toLowerCase() !== atual) throw new Error(`SHA-256 do arquivo ${nome} mudou desde o dry-run`);
}

async function main(): Promise<void> {
  const op = argumentos(process.argv.slice(2));
  const plano = prepararPlano({
    only: op.only,
    docsRaw: op.docsJson ? readFileSync(op.docsJson, 'utf8') : undefined,
    marcaRaw: op.marcaMd ? readFileSync(op.marcaMd, 'utf8') : undefined,
  });
  hashEsperado(op.expectDocsSha256, plano.arquivos.clickupSha256, 'docs', op.apply && op.only !== 'marca');
  hashEsperado(op.expectMarcaSha256, plano.arquivos.marcaSha256, 'marca', op.apply && op.only !== 'clickup');
  if (op.offline) {
    console.log(JSON.stringify({ modo: 'offline', fontes: plano.arquivos,
      entradas: plano.entradas.map(({ chave, contentHash, sourceRef }) => ({ chave, contentHash, sourceRef })) }, null, 2));
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL ausente. Use a conexão de QA; não passe credenciais na linha de comando.');
  const prisma = new PrismaService({ datasourceUrl: url });
  try {
    await prisma.$connect();
    const org = await prisma.org.findUnique({ where: { id: op.orgId! }, select: { id: true, slug: true, isActive: true } });
    if (!org || org.slug !== 'root' || !org.isActive) throw new Error('Org informada não é a ROOT ativa');
    const memoria = new MemoriaService(prisma, new EventLogService(prisma));
    await comContexto({ orgId: org.id, actorType: ActorType.system, actorId: 'import-editorial-context',
      correlationId: novaCorrelacao(), origem: 'script' }, async () => {
      const linhas = op.apply
        ? await aplicarImportacao(memoria, org.id, plano)
        : await planejarImportacao(memoria, org.id, plano);
      console.log(JSON.stringify({ modo: op.apply ? 'apply' : 'dry-run', orgId: org.id,
        fontes: plano.arquivos, linhas }, null, 2));
      if (linhas.some((linha) => linha.acao === 'conflito' || linha.acao === 'evento-pendente')) process.exitCode = 2;
    });
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
