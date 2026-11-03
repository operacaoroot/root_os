import { Prisma } from '@prisma/client';

import { acharClientePorNome, nomeDeClienteNormalizado, principalDoCliente } from '../work/clientes-da-casa';

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
 * CADASTRO ÚNICO (03/11/2026): o achado é sempre o PRINCIPAL. O repetido que a integração
 * apontou (`Partner.principalId`, Curral × "Curral (Marcelo Alves Meroto)") devolve o
 * principal, se ele for cliente desta empresa; senão, o próprio achado.
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
    const p = await tx.partner.findFirst({ where: { id: d.partnerIdDaFicha, orgId, isCliente: true, interno: false }, select: { id: true, principalId: true } });
    if (p) return { id: await principalDoCliente(tx, orgId, p), como: 'ficha' };
  }

  const doc = (d.cnpj ?? '').replace(/\D/g, '');
  if (doc.length >= 11) {
    const p = await tx.partner.findFirst({ where: { orgId, cnpjCpf: doc, isCliente: true, interno: false }, orderBy: { createdAt: 'asc' }, select: { id: true, principalId: true } });
    if (p) return { id: await principalDoCliente(tx, orgId, p), como: 'cnpj' };
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

/*
 * O CLIENTE DO FECHAMENTO, depois do cliente da ficha (cadastro único, 03/11/2026).
 *
 * O fechamento só reaproveitava pelo CNPJ: sem CNPJ no cadastro do Financeiro, nascia
 * o segundo `Partner` (Curral, ProMedical, Custeio). Agora, a mesma régua de cima:
 *
 *   1. o CNPJ do aceite, só entre clientes (D-12), resolvido para o principal;
 *   2. sem cliente com esse CNPJ, o nome (`acharClientePorNome`, já no principal), sob o
 *      cadeado do "Novo cliente": ganha só o CNPJ e o e-mail VAZIOS. O de nome igual com
 *      OUTRO CNPJ não é o mesmo cliente: segue para o 3 (o CNPJ do aceite não troca o dele);
 *   3. sem nada disso, nasce o cliente, como antes.
 *
 * A ficha passa a apontar o reaproveitado quando não tinha cliente ou o dela não valeu
 * (`apontarFicha`, o aviso "a conciliar" de quem chama); o criado, sempre.
 */

export interface DadosDoClienteDoFechamento {
  /** O CNPJ do aceite, só dígitos ('' = sem CNPJ). */
  doc: string;
  razaoSocial: string;
  email: string | null;
  telefone: string | null;
  apontarFicha: boolean;
}

export async function acharOuCriarClienteDoFechamento(
  tx: Tx, orgId: string, leadId: string, d: DadosDoClienteDoFechamento,
): Promise<{ estado: 'reaproveitado' | 'criado'; detalhe: string; ref: string }> {
  const ja = d.doc ? await tx.partner.findFirst({ where: { orgId, cnpjCpf: d.doc, isCliente: true }, orderBy: { createdAt: 'asc' }, select: { id: true, principalId: true } }) : null;
  if (ja) {
    const id = await principalDoCliente(tx, orgId, ja);
    if (d.apontarFicha) await tx.comercialFicha.updateMany({ where: { leadId, orgId }, data: { partnerId: id } });
    return { estado: 'reaproveitado', detalhe: 'cliente já existia com este CNPJ', ref: id };
  }

  const alvo = nomeDeClienteNormalizado(d.razaoSocial);
  if (alvo) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cliente-por-nome:${orgId}:${alvo}`}))`;
    const achado = await acharClientePorNome(tx, orgId, d.razaoSocial);
    const p = achado ? await tx.partner.findFirst({ where: { id: achado.id, orgId }, select: { id: true, cnpjCpf: true, email: true } }) : null;
    const docDele = (p?.cnpjCpf ?? '').replace(/\D/g, '');
    if (p && !(d.doc && docDele && docDele !== d.doc)) {
      const vazios: { cnpjCpf?: string; email?: string } = {};
      if (!docDele && d.doc) vazios.cnpjCpf = d.doc;
      if (!p.email && d.email) vazios.email = d.email;
      if (Object.keys(vazios).length) await tx.partner.updateMany({ where: { id: p.id, orgId }, data: vazios });
      if (d.apontarFicha) await tx.comercialFicha.updateMany({ where: { leadId, orgId }, data: { partnerId: p.id } });
      return { estado: 'reaproveitado', detalhe: 'cliente já existia com este nome', ref: p.id };
    }
  }

  const p = await tx.partner.create({
    data: { orgId, isCliente: true, razaoSocial: d.razaoSocial, cnpjCpf: d.doc, email: d.email || null, phone: d.telefone ?? null },
  });
  await tx.comercialFicha.updateMany({ where: { leadId, orgId }, data: { partnerId: p.id } });
  return { estado: 'criado', detalhe: d.razaoSocial, ref: p.id };
}
