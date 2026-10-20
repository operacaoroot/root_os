import { Prisma } from '@prisma/client';

import { acharClientePorNome, nomeDeClienteNormalizado } from '../work/clientes-da-casa';
import { normalizarTelefone } from './eventos';

/*
 * O CLIENTE DO LEAD QUE AINDA NÃO FECHOU (ajustes da versão final A2, 19/10/2026).
 *
 * "Iniciar onboarding" antes do fechamento abre o card da implantação, e todo card
 * novo tem cliente (rodada do trabalho T4). Uma pessoa, um `Partner`, sempre: este
 * arquivo acha o cliente que já existe antes de criar outro, nesta ordem:
 *
 *   1. o `Partner` que a ficha já aponta (`ComercialFicha.partnerId`), se for cliente desta empresa;
 *   2. o CNPJ, só entre clientes (a regra D-12 do fechamento: fornecedor com o mesmo CNPJ não vira cliente);
 *   3. o telefone ou o e-mail, só entre clientes;
 *   4. o nome, pela régua do Trabalho (`acharClientePorNome`, a do "Novo cliente", achado 1.7):
 *      fornecedor de nome parecido NÃO vira cliente por aqui;
 *   5. sem nada disso, nasce um `Partner` cliente com o que a ficha tem.
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

export type ComoAchou = 'ficha' | 'cnpj' | 'contato' | 'nome' | 'criado';

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

  const tel = d.telefone ? normalizarTelefone(d.telefone) : '';
  const email = (d.email ?? '').trim().toLowerCase();
  if (tel.length >= 10 || email) {
    const candidatos = await tx.partner.findMany({
      where: {
        orgId, isCliente: true, interno: false,
        OR: [...(email ? [{ email: { equals: email, mode: 'insensitive' as const } }] : []), ...(tel.length >= 10 ? [{ phone: { not: null } }] : [])],
      },
      select: { id: true, phone: true, email: true, ativo: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 2000,
    });
    const casa = candidatos
      .filter((p) => (email && (p.email ?? '').trim().toLowerCase() === email) || (tel.length >= 10 && !!p.phone && normalizarTelefone(p.phone) === tel))
      .sort((a, b) => Number(b.ativo) - Number(a.ativo))[0];
    if (casa) return { id: casa.id, como: 'contato' };
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
      email: email || null,
      phone: d.telefone || null,
    },
    select: { id: true },
  });
  return { id: criado.id, como: 'criado' };
}
