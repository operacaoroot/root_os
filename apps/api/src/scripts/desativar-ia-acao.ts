/*
 * ============================================================================
 * DESATIVAR A CONTA DE MÁQUINA `ia-acao@` (rodada dos agentes, 21/10/2026, A1, CA-05)
 * ============================================================================
 *
 *   node dist/scripts/desativar-ia-acao.js            # simula (padrão): diz o que faria
 *   node dist/scripts/desativar-ia-acao.js --valer    # desativa de verdade
 *
 * POR QUE. A conta `ia-acao@marketing-os.local` era do bot de Telegram,
 * aposentado em 11/09/2026 (fatia 5.8), e não tem sucessor: ela não pode decidir
 * aprovação (`ia_acao` não tem `aprovacoes.decidir`, e o `confirm` recusa conta de
 * máquina), mas guarda seis permissões de escrita. Credencial viva sem dono é
 * superfície de ataque. A semente parou de criá-la (e de exigir
 * `MCP_ACTION_PASSWORD`) nesta mesma rodada; este comando cuida da que já existe.
 *
 * O QUE ELE FAZ, e só isso: marca a conta `isActive = false` e troca o hash da
 * senha por um valor que nenhum `bcrypt.compare` aceita (não é hash bcrypt), numa
 * transação com UMA linha de auditoria (`usuario.conta_de_maquina_desativada`,
 * `actorType system`). NUNCA APAGA: a linha do usuário, os papéis, os vínculos e
 * o histórico ficam. Se um dia o produto voltar a ter um executor de máquina, é
 * este perfil que ele herda (e alguém dá senha nova de propósito).
 *
 * IDEMPOTENTE: conta já desativada e com a senha já inutilizada não muda nada, e
 * nenhuma auditoria nova é escrita. Conta inexistente = nada a fazer.
 *
 * POR QUE NÃO SOBE O NEST: mesmo motivo de `liberar-guarda-da-vault.ts`. Roda
 * COMPILADO (`dist/`) porque é assim que ele existe dentro do container da api,
 * com a conexão dona das tabelas (`DATABASE_URL`).
 */
import { randomBytes } from 'node:crypto';
import { ActorType, PrismaClient } from '@prisma/client';

import { comContexto } from '../common/contexto-execucao';
import { comTenantNaSessao } from '../prisma/sessao-de-banco';

/** O e-mail fixo da conta (era o de `prisma/seed.ts`). */
export const EMAIL_DA_CONTA_DE_ACAO = 'ia-acao@marketing-os.local';

/** O prefixo da senha inutilizada: não é hash bcrypt, então `bcrypt.compare` devolve falso. */
export const PREFIXO_DA_SENHA_INUTILIZADA = '!desativada:';

export interface ResultadoDaDesativacao {
  /** `inexistente` · `ja-desativada` · `desativaria` (simulação) · `desativada`. */
  desfecho: 'inexistente' | 'ja-desativada' | 'desativaria' | 'desativada';
  usuarioId: string | null;
  orgId: string | null;
  estavaAtiva: boolean | null;
}

export async function desativarIaAcao(
  prisma: PrismaClient,
  opcoes: { valer: boolean; email?: string },
): Promise<ResultadoDaDesativacao> {
  const email = opcoes.email ?? EMAIL_DA_CONTA_DE_ACAO;
  const conta = await prisma.user.findUnique({
    where: { email },
    select: { id: true, orgId: true, isActive: true, passwordHash: true },
  });
  if (!conta) return { desfecho: 'inexistente', usuarioId: null, orgId: null, estavaAtiva: null };

  const senhaInutil = conta.passwordHash.startsWith(PREFIXO_DA_SENHA_INUTILIZADA);
  if (!conta.isActive && senhaInutil) {
    return { desfecho: 'ja-desativada', usuarioId: conta.id, orgId: conta.orgId, estavaAtiva: false };
  }
  if (!opcoes.valer) {
    return { desfecho: 'desativaria', usuarioId: conta.id, orgId: conta.orgId, estavaAtiva: conta.isActive };
  }

  // A escrita roda no contexto da empresa da conta: `app.org_id` vai com ela, como numa rota.
  await comContexto(
    { orgId: conta.orgId, actorType: ActorType.system, actorId: null, correlationId: `terminal-desativar-ia-acao-${conta.id}`, origem: 'script' },
    () => prisma.$transaction(async (tx) => {
    // Escrita condicionada ao que foi lido: se alguém mexeu na conta no meio, nada muda.
    const r = await tx.user.updateMany({
      where: { id: conta.id, isActive: conta.isActive, passwordHash: conta.passwordHash },
      data: {
        isActive: false,
        passwordHash: `${PREFIXO_DA_SENHA_INUTILIZADA}${randomBytes(32).toString('hex')}`,
      },
    });
    if (r.count !== 1) throw new Error('a conta mudou durante a desativação; rode de novo para conferir');
    await tx.auditLog.create({
      data: {
        orgId: conta.orgId,
        actorType: ActorType.system,
        actorId: null,
        action: 'usuario.conta_de_maquina_desativada',
        entityType: 'User',
        entityId: conta.id,
        before: { isActive: conta.isActive, senha: senhaInutil ? 'inutilizada' : 'utilizavel' },
        after: { isActive: false, senha: 'inutilizada' },
        metadata: {
          motivo:
            'conta de máquina ia-acao@ sem cliente desde a aposentadoria do bot de Telegram (11/09/2026); ' +
            'desativada sem apagar na rodada dos agentes (21/10/2026)',
          comando: 'scripts/desativar-ia-acao',
        },
      },
    });
    }),
  );
  return { desfecho: 'desativada', usuarioId: conta.id, orgId: conta.orgId, estavaAtiva: conta.isActive };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const valer = args.includes('--valer');
  if (valer && args.includes('--simular')) {
    console.error('use --simular OU --valer, não os dois');
    process.exit(2);
  }
  const base = new PrismaClient();
  const prisma = comTenantNaSessao(base, { modo: 'observar', avisar: () => undefined });
  try {
    const r = await desativarIaAcao(prisma, { valer });
    const frase: Record<ResultadoDaDesativacao['desfecho'], string> = {
      inexistente: `nenhuma conta ${EMAIL_DA_CONTA_DE_ACAO} neste banco: nada a fazer.`,
      'ja-desativada': `a conta ${EMAIL_DA_CONTA_DE_ACAO} já está desativada e sem senha utilizável: nada mudou.`,
      desativaria:
        `SIMULAÇÃO: a conta ${EMAIL_DA_CONTA_DE_ACAO} (${r.estavaAtiva ? 'ativa' : 'inativa'}) seria desativada ` +
        'e teria a senha inutilizada, com uma linha de auditoria. Rode com --valer para fazer.',
      desativada:
        `a conta ${EMAIL_DA_CONTA_DE_ACAO} foi desativada e a senha inutilizada (auditoria ` +
        '`usuario.conta_de_maquina_desativada`). Nada foi apagado.',
    };
    console.log(frase[r.desfecho]);
  } finally {
    await base.$disconnect();
  }
}

// Só quando o arquivo compilado é executado: a suíte importa `desativarIaAcao` sem disparar a linha de comando.
if (/desativar-ia-acao\.js$/.test(process.argv[1] ?? '')) {
  main().catch((e) => {
    console.error('\nfalhou:', (e as Error).message);
    process.exit(1);
  });
}
