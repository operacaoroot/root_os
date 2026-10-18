import { readFileSync } from 'node:fs';
import { OPERACAO_TAMANHO_MAXIMO_EM_BYTES, OperacaoPainelSchema } from '@mktos/shared';
import { comContexto, novaCorrelacao } from '../common/contexto-execucao';
import { criarPrismaService, type PrismaService } from '../prisma/prisma.service';
import { SLUG_DA_PLATAFORMA } from '../tenants/provisionar';

/*
 * Importa uma rodada do painel da operação (`painel.json` da rotina
 * `painel-root-semanal`). Operação interna: não sobe Nest, timers nem provedores.
 *
 *   node dist/scripts/importar-painel-operacao.js --org-id <id> --arquivo <caminho|->
 *
 * `-` lê da entrada padrão, para rodar com `docker exec -i` sem copiar arquivo
 * para dentro do container. Reimportar a mesma rodada substitui o conteúdo.
 *
 * O contexto é o da PRÓPRIA org (e não o de plataforma): a policy de `Org` deixa
 * ler a linha da empresa do contexto, e é por ela que se confere o slug. Org de
 * cliente é recusada antes de qualquer escrita.
 */

class ImportacaoError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function exigir(condicao: unknown, code: string): asserts condicao {
  if (!condicao) throw new ImportacaoError(code);
}

function lerArgumentos(args: string[]): { orgId: string; arquivo: string } {
  const valores: Record<string, string> = {};
  const permitidas = new Set(['org-id', 'arquivo']);
  exigir(args.length === 4, 'operacao_argumentos_invalidos');
  for (let i = 0; i < args.length; i += 2) {
    const nome = args[i].slice(2), valor = args[i + 1];
    exigir(args[i].startsWith('--') && permitidas.has(nome) && !Object.hasOwn(valores, nome)
      && valor && valor.length <= 4096, 'operacao_argumentos_invalidos');
    valores[nome] = valor;
  }
  exigir(/^[A-Za-z0-9_-]{1,64}$/.test(valores['org-id'] ?? ''), 'operacao_org_invalida');
  exigir(valores.arquivo, 'operacao_argumentos_invalidos');
  return { orgId: valores['org-id'], arquivo: valores.arquivo };
}

function lerConteudo(arquivo: string) {
  const bruto = readFileSync(arquivo === '-' ? 0 : arquivo);
  exigir(bruto.length > 0 && bruto.length <= OPERACAO_TAMANHO_MAXIMO_EM_BYTES, 'operacao_tamanho_invalido');
  let json: unknown;
  try {
    json = JSON.parse(bruto.toString('utf8'));
  } catch {
    throw new ImportacaoError('operacao_json_invalido');
  }
  const resultado = OperacaoPainelSchema.safeParse(json);
  if (!resultado.success) {
    const caminhos = resultado.error.issues.slice(0, 5).map((i) => i.path.join('.') || '(raiz)');
    throw Object.assign(new ImportacaoError('operacao_formato_invalido'), { caminhos });
  }
  return resultado.data;
}

async function main(): Promise<void> {
  const { orgId, arquivo } = lerArgumentos(process.argv.slice(2));
  const conteudo = lerConteudo(arquivo);
  let prisma: PrismaService | undefined;
  try {
    const resultado = await comContexto({ orgId, actorType: 'system', actorId: null,
      correlationId: novaCorrelacao('operacao'), origem: 'script' }, async () => {
      prisma = await criarPrismaService();
      const org = await prisma.org.findFirst({ where: { id: orgId }, select: { slug: true } });
      exigir(org?.slug === SLUG_DA_PLATAFORMA, 'operacao_org_nao_e_a_plataforma');
      const linha = await prisma.operacaoRodada.upsert({
        where: { orgId_rodadaEm: { orgId, rodadaEm: conteudo.rodadaEm } },
        create: { orgId, rodadaEm: conteudo.rodadaEm, conteudo, origem: 'script' },
        update: { conteudo },
        select: { id: true, rodadaEm: true, createdAt: true, updatedAt: true },
      });
      return {
        tipo: 'ok',
        rodada: linha.rodadaEm,
        acao: linha.createdAt.getTime() === linha.updatedAt.getTime() ? 'criada' : 'substituida',
        clientes: conteudo.clientes.length,
        itensDeOnda: conteudo.ondas.reduce((n, o) => n + o.itens.length, 0),
      };
    });
    process.stdout.write(JSON.stringify(resultado) + '\n');
  } finally {
    if (prisma) await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  // Erros do banco nunca imprimem URL, env, stack ou conteúdo do painel.
  const code = error instanceof ImportacaoError ? error.code : 'operacao_importacao_recusada_ou_inconclusiva';
  const caminhos = (error as { caminhos?: string[] } | null)?.caminhos;
  process.stderr.write(JSON.stringify({ tipo: 'falha', code, ...(caminhos ? { caminhos } : {}) }) + '\n');
  process.exitCode = 1;
});
