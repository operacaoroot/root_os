import type { PrismaClient } from '@prisma/client';

import {
  PAPEL_INICIAL,
  provisionarTenant,
  type EntradaDeProvisionamento,
  type Provisionamento,
} from '../src/tenants/provisionar';

/*
 * A EMPRESA DE TESTE NASCE PELO CAMINHO DE VERDADE.
 *
 * Existe para a suíte de isolamento parar de semear a empresa por conta própria
 * (RF-T-07, fatia 1.7: "o segundo tenant criado por ela deve virar a fixture da
 * suíte"). Duas semeaduras diferentes — uma no produto, outra no teste — é como
 * um teste fica verde provando o que ele mesmo escreveu: se o provisionamento
 * esquecer o papel inicial, a suíte que cria o papel na mão não vê nada.
 *
 * QUEM USA. `tenant-isolation.test.ts` semeia a org B por aqui (ver "A org B
 * nasce do provisionamento" no `beforeAll` de lá) e `provisionamento.test.ts`
 * confere o próprio ajudante. Ninguém mais: a org A continua sendo semeada à mão
 * na suíte de isolamento, de propósito — ela precisa de uma empresa com UM papel
 * e UM usuário, moldada linha a linha, e é o contraste entre as duas que prova
 * que o isolamento não depende da forma como a empresa nasceu.
 *
 * MISTURAR O PRISMA COM O POOL `pg` DA SUÍTE É SEGURO AQUI, e vale dizer por
 * quê: o provisionamento roda numa transação PRÓPRIA, que já fez COMMIT quando
 * esta função devolve. A suíte só então abre a transação dela (`BEGIN` no pool
 * admin) e insere o resto do dado da org B referenciando ids já commitados —
 * nenhum `INSERT` espera por linha presa em transação alheia, e não há como
 * travar uma na outra.
 *
 * O QUE ELE DEVOLVE, E POR QUÊ. Além do retrato do provisionamento, as CHAVES
 * criadas por tabela, no formato que a limpeza cirúrgica de
 * `tenant-isolation.test.ts` usa (`ORDEM_LIMPEZA` + `sementes[x].chaves`). Sem
 * isso a suíte teria de descobrir sozinha o que apagar — e apagar por prefixo ou
 * por TRUNCATE é exatamente o que aquela suíte se proíbe.
 *
 * NÃO PASSA `rastro` NEM `auditar` DE PROPÓSITO. O `EventLog` é append-only por
 * RULE do banco: uma linha registrada aqui não teria como ser removida no
 * `afterAll`, e a suíte deixaria lixo permanente em cada rodada. O `AuditLog`
 * seria removível, mas as chaves dele não passariam pelo registro de limpeza da
 * suíte e sobrariam. Quem quiser exercitar RASTRO ou auditoria passa os próprios
 * callbacks — é o que `provisionamento.test.ts` faz.
 *
 * Este arquivo NÃO termina em `.test.ts`: o glob do vitest não o coleta como
 * suíte (mesma regra de `banco-de-teste.ts`).
 */

export interface TenantDeTeste {
  provisionamento: Provisionamento;
  orgId: string;
  /** O papel inicial (`admin_master`) criado pelo provisionamento. */
  papelInicialId: string;
  /** O primeiro administrador, quando a entrada pediu um. */
  adminUserId: string | null;
  /** tabela -> chaves criadas por esta empresa, para a limpeza cirúrgica. */
  chaves: Record<string, string[]>;
  /** Ordem de inserção; a limpeza percorre ao contrário. */
  ordemDeLimpeza: string[];
}

/**
 * Provisiona uma empresa descartável e diz o que precisa ser apagado depois.
 *
 * `permissoes` fica de fora das chaves: `Permission` é catálogo GLOBAL,
 * compartilhado por todas as empresas (`src/common/modelos-globais.ts`), e
 * apagá-lo no fim de um teste tiraria o chão de qualquer outra suíte rodando ao
 * mesmo tempo. É o mesmo que `db:sync-permissions` deixa para trás.
 */
export async function provisionarTenantDeTeste(
  prisma: PrismaClient,
  entrada: EntradaDeProvisionamento,
): Promise<TenantDeTeste> {
  const provisionamento = await provisionarTenant(prisma, entrada);
  const orgId = provisionamento.orgId;

  const papeis = await prisma.role.findMany({ where: { orgId }, select: { id: true, key: true } });
  const usuarios = await prisma.user.findMany({ where: { orgId }, select: { id: true } });

  const papelInicialId = papeis.find((p) => p.key === PAPEL_INICIAL)?.id;
  if (!papelInicialId) {
    // Não é defensivo à toa: se isto acontecer, o provisionamento parou de criar
    // o papel inicial e a suíte de isolamento estaria medindo uma empresa sem
    // dono sem perceber.
    throw new Error(
      `o provisionamento não deixou o papel inicial "${PAPEL_INICIAL}" na empresa ${orgId}.`,
    );
  }

  const chaves: Record<string, string[]> = {
    Org: [orgId],
    Role: papeis.map((r) => r.id),
    User: usuarios.map((u) => u.id),
  };

  /*
   * `_UserRoles` e `_RolePermissions` não entram: as tabelas implícitas do
   * Prisma têm FK com ON DELETE CASCADE, então some junto com o Role e o User.
   * Listá-las obrigaria a suíte a apagar na ordem certa duas vezes.
   */
  return {
    provisionamento,
    orgId,
    papelInicialId,
    adminUserId: provisionamento.admin?.userId ?? null,
    chaves,
    ordemDeLimpeza: ['Org', 'Role', 'User'],
  };
}
