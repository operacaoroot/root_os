import { Prisma } from '@prisma/client';

import { acharClientePorNome, nomeDeClienteNormalizado } from '../work/clientes-da-casa';

/*
 * O CLIENTE DO LEAD QUE AINDA NÃO FECHOU (ajustes da versão final A2, 19/10/2026).
 *
 * "Iniciar onboarding" antes do fechamento abre o card da implantação, e todo card
 * novo tem cliente (rodada do trabalho T4). Uma pessoa, um `Partner`, sempre: este
 * arquivo acha o cliente que já existe antes de criar outro, nesta ordem:
 *
 *   1. o `Partner` que a ficha já aponta (`ComercialFicha.partnerId`), se for cliente desta empresa;
 *   2. o CNPJ, só entre clientes (a regra D-12 do fechamento: fornecedor com o mesmo CNPJ não vira cliente);
 *   3. o nome, pela régua do Trabalho (`acharClientePorNome`, a do "Novo cliente", achado 1.7):
 *      fornecedor de nome parecido NÃO vira cliente por aqui;
 *   4. sem nada disso, nasce um `Partner` cliente com o que a ficha tem.
 *
 * TELEFONE E E-MAIL NÃO LIGAM SOZINHOS (revisão adversarial A2, achado 1): o contador que atende
 * dez clientes manda o mesmo e-mail por todos, e a empresa nova viraria o cadastro de outra. O
 * contato vai para o cliente novo, nunca serve de chave.
 *
 * Roda dentro da transação de quem chama, sob o MESMO cadeado do "Novo cliente"
 * (`cliente-por-nome:<empresa>:<nome normalizado>`): dois cliques, ou o "Novo
 * cliente" no mesmo instante, dão um cliente só. Sem Nest, para a suíte medir.
 */

type Tx = Prisma.TransactionClient;

export interface DadosDoClienteDoLead {
  partnerIdDaFicha: string | null;
  /** Razão social, ou o nome do lead (o nome do cliente novo). */
  nome: string;
  cnpj: string | null;
  telefone: string | null;
  email: string | null;
}

export type ComoAchou = 'ficha' | 'cnpj' | 'nome' | 'criado';

export async function acharOuCriarClienteDoLead(tx: Tx, orgId: string, d: DadosDoClienteDoLead): Promise<{ id: string; como: ComoAchou }> {
  const nome = d.nome.trim().replace(/\s+/g, ' ');
  const alvo = nomeDeClienteNormalizado(nome);
  if (alvo) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cliente-por-nome:${orgId}:${alvo}`}))`;

  if (d.partnerIdDaFicha) {
    const p = await tx.partner.findFirst({ where: { id: d.partnerIdDaFicha, orgId, isCliente: true, interno: false }, select: { id: true } });
    if (p) return { id: p.id, como: 'ficha' };
  }

  const doc = (d.cnpj ?? '').replace(/\D/g, '');
  if (doc.length >= 11) {
    const p = await tx.partner.findFirst({ where: { orgId, cnpjCpf: doc, isCliente: true, interno: false }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (p) return { id: p.id, como: 'cnpj' };
  }

  if (alvo) {
    const p = await acharClientePorNome(tx, orgId, nome);
    if (p) return { id: p.id, como: 'nome' };
  }

  const criado = await tx.partner.create({
    data: {
      orgId,
      isCliente: true,
      razaoSocial: (nome || 'Cliente sem nome').slice(0, 160),
      cnpjCpf: doc || null,
      email: (d.email ?? '').trim().toLowerCase() || null,
      phone: d.telefone || null,
    },
    select: { id: true },
  });
  return { id: criado.id, como: 'criado' };
}
