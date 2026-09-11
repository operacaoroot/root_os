import { createHash } from 'node:crypto';
import type { PrismaService } from '../prisma/prisma.service';

/*
 * QUEM É O APROVADOR, SEGUNDO O BANCO — uma consulta, um lugar.
 *
 * Até 11/09/2026 esta releitura existia, mas morava DENTRO do caminho de
 * reautenticação. Como só R4 e R5 exigem reautenticação, R2 e R3 decidiam a
 * alçada com o que o token de sessão dizia — e o token vale oito horas. O
 * revisor mediu, contra a única capacidade com efeito ligado de verdade
 * (`whatsapp.mensagem.enviar`, R3): usuário DESATIVADO confirmou; usuário
 * REBAIXADO no banco, com token antigo dizendo o papel alto, confirmou; e um
 * `sub` que não existe na tabela de usuários confirmou. Demitido, rebaixado ou
 * apagado seguia aprovando saída externa até a sessão vencer.
 *
 * Por isso a consulta saiu do serviço de reautenticação e veio para cá: é a
 * MESMA consulta, chamada agora em todo nível, antes da trava de alçada, e uma
 * só cópia dela existe. Duas cópias de uma trava é uma trava que um dia diverge.
 *
 * O `passwordHash` vem junto porque quem confere senha precisa dele e porque a
 * IMPRESSÃO dele prende a prova em token à senha vigente (ver `impressaoDaSenha`).
 * Quem só quer os papéis ignora o campo; ele não sai desta camada.
 */

export interface AprovadorDoBanco {
  id: string;
  ativo: boolean;
  passwordHash: string;
  /** As chaves de papel do BANCO — o que decide alçada, não o que o token diz. */
  papeis: string[];
}

/**
 * Lê o aprovador na empresa da aprovação. Devolve `null` quando não existe ali
 * — e "não existe" e "existe inativo" são respostas diferentes de propósito:
 * quem chama recusa as duas, mas o RASTRO precisa saber qual foi.
 */
export async function lerAprovador(
  prisma: PrismaService,
  userId: string,
  orgId: string,
): Promise<AprovadorDoBanco | null> {
  const usuario = await prisma.user.findFirst({
    where: { id: userId, orgId },
    select: {
      id: true,
      isActive: true,
      passwordHash: true,
      roles: { select: { key: true } },
    },
  });
  if (!usuario) return null;
  return {
    id: usuario.id,
    ativo: usuario.isActive,
    passwordHash: usuario.passwordHash,
    papeis: usuario.roles.map((r) => r.key),
  };
}

/**
 * A impressão da senha vigente — 16 hex do sha256 do HASH (nunca da senha).
 *
 * Vai dentro da prova em token para que trocar a senha MATE as provas emitidas
 * com a senha antiga. Sem isto, quem tomou a sessão pedia a prova, a vítima
 * trocava a senha achando que tinha resolvido, e a prova de cinco minutos
 * continuava valendo. Não é segredo: é derivada de um hash bcrypt, que já é
 * derivado, e serve só para comparar "é a mesma de antes?".
 */
export function impressaoDaSenha(passwordHash: string): string {
  return createHash('sha256').update(passwordHash).digest('hex').slice(0, 16);
}
