import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  lerRefDaAta,
  tipoDoArquivoDeAta,
  type TrabAtaCandidato,
  type TrabAtaLigacao,
  type TrabAtaLigadaItem,
  type TrabAtaLigarInput,
  type TrabAtaResumo,
  type TrabAtaTipo,
} from '@mktos/shared';

import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AtasService, RECUSA_DO_VAULT_NAS_ATAS, type AcessoAsAtas, type QuemDecide } from './atas.service';
import { RECUSA_DO_DRIVE_NAS_ATAS } from './fonte-do-drive';
import { metadadosDaAta } from './leitor-de-atas';

/*
 * Layout 26/10: A ATA LIGADA A UM LEAD OU A UM CLIENTE.
 *
 * Na tela Atas, cada ata (ou transcrição) se liga à mão a UM lead e/ou a UM
 * cliente (o `Partner` cliente principal: `isCliente`, `ativo`, sem
 * `principalId`, fora o da casa). A linha mora em `AtaLigacao`, presa à
 * referência da ata, com o título, a data e o tipo copiados ao ligar: o painel
 * do lead e a ficha do cliente leem daqui ("a nossa reunião de tal dia") sem
 * reabrir o vault, o Drive ou o Granola.
 *
 * POR QUE NÃO O `POST /comercial/lead/:id/ata` (o fato `ata.chegou`, E4): esse
 * fato dispara reações do comercial — a ficha projeta o `ataHash` e pode andar a
 * etapa para a sessão, o leitor de ata gera o DIAGNÓSTICO com o modelo (custo de
 * IA) e o sócio da conta é gravado. Ligar uma ata a um lead é só dizer "esta
 * reunião é deste lead"; não pode rodar nada disso. Quem quiser o E4 continua
 * subindo a ata pelo comercial, como hoje.
 *
 * As mesmas regras do banco de atas (PA-2 e PA-3):
 *   · ligar é escrita de gente (`exigirGente`), com `tarefas.editar`; ligar a
 *     LEAD pede também `leads.ver` (o controller diz se a pessoa tem);
 *   · a ata do vault só se liga (e só aparece ligada) para quem lê o vault, e a
 *     do Drive para quem lê o Drive: a ligação não alarga acesso.
 */

const MAX_CANDIDATOS = 20;

/** Cliente que vale como alvo: o cadastro principal, ativo, que não é o da casa. */
const CLIENTE_VALIDO = { isCliente: true, ativo: true, interno: false, principalId: null } as const;

const nomeDoPartner = (p: { razaoSocial: string; nomeFantasia: string | null }) => (p.nomeFantasia?.trim() || p.razaoSocial).trim();

@Injectable()
export class LigacoesDasAtasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly atas: AtasService,
    private readonly audit: AuditService,
  ) {}

  /** A fonte que quem pede não lê não aparece nem se liga (PA-2). */
  private podeVerARef(ref: string, acesso: AcessoAsAtas): boolean {
    const fonte = lerRefDaAta(ref)?.fonte;
    if (fonte === 'vault') return acesso.vault;
    if (fonte === 'drive') return !!acesso.drive;
    return !!fonte;
  }

  /** Os nomes dos leads e dos clientes das ligações (os apagados ficam de fora). */
  private async nomes(orgId: string, leadIds: string[], clienteIds: string[]) {
    const [leads, clientes] = await Promise.all([
      leadIds.length ? this.prisma.lead.findMany({ where: { orgId, id: { in: leadIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
      clienteIds.length
        ? this.prisma.partner.findMany({ where: { orgId, id: { in: clienteIds } }, select: { id: true, razaoSocial: true, nomeFantasia: true } })
        : Promise.resolve([]),
    ]);
    return {
      lead: new Map(leads.map((l) => [l.id, l.name])),
      cliente: new Map(clientes.map((p) => [p.id, nomeDoPartner(p)])),
    };
  }

  private paraLigacao(
    l: { leadId: string | null; clienteId: string | null; atualizadaEm: Date; ligadaPor: string | null },
    nomes: { lead: Map<string, string>; cliente: Map<string, string> },
    pessoas: Map<string, string>,
  ): TrabAtaLigacao | null {
    const lead = l.leadId && nomes.lead.has(l.leadId) ? { id: l.leadId, nome: nomes.lead.get(l.leadId)! } : null;
    const cliente = l.clienteId && nomes.cliente.has(l.clienteId) ? { id: l.clienteId, nome: nomes.cliente.get(l.clienteId)! } : null;
    if (!lead && !cliente) return null;
    return { lead, cliente, ligadaEm: l.atualizadaEm.toISOString(), ligadaPor: l.ligadaPor ? pessoas.get(l.ligadaPor) ?? null : null };
  }

  private async nomesDePessoas(orgId: string, ids: (string | null)[]): Promise<Map<string, string>> {
    const unicos = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unicos.length) return new Map();
    const us = await this.prisma.user.findMany({ where: { orgId, id: { in: unicos } }, select: { id: true, name: true } });
    return new Map(us.map((u) => [u.id, u.name]));
  }

  /** Põe `ligadaA` em cada ata da lista (ou na aberta). Uma consulta para todas. */
  async anotar<T extends TrabAtaResumo>(orgId: string, atas: T[]): Promise<T[]> {
    if (!atas.length) return atas;
    const linhas = await this.prisma.ataLigacao.findMany({
      where: { orgId, ataRef: { in: atas.map((a) => a.id) } },
      select: { ataRef: true, leadId: true, clienteId: true, atualizadaEm: true, ligadaPor: true },
    });
    if (!linhas.length) return atas.map((a) => ({ ...a, ligadaA: null }));
    const nomes = await this.nomes(
      orgId,
      linhas.map((l) => l.leadId).filter((x): x is string => !!x),
      linhas.map((l) => l.clienteId).filter((x): x is string => !!x),
    );
    const pessoas = await this.nomesDePessoas(orgId, linhas.map((l) => l.ligadaPor));
    const porRef = new Map(linhas.map((l) => [l.ataRef, this.paraLigacao(l, nomes, pessoas)]));
    return atas.map((a) => ({ ...a, ligadaA: porRef.get(a.id) ?? null }));
  }

  /** As atas ligadas a um lead ou a um cliente, a mais nova primeiro (pela data da reunião). */
  async ligadas(orgId: string, alvo: { leadId?: string | null; clienteId?: string | null }, acesso: AcessoAsAtas): Promise<TrabAtaLigadaItem[]> {
    const onde = alvo.leadId ? { leadId: alvo.leadId } : alvo.clienteId ? { clienteId: alvo.clienteId } : null;
    if (!onde) throw new BadRequestException('Diga o lead (?lead=) ou o cliente (?cliente=).');
    const linhas = await this.prisma.ataLigacao.findMany({
      where: { orgId, ...onde },
      orderBy: { atualizadaEm: 'desc' },
      take: 200,
      select: { ataRef: true, titulo: true, data: true, tipo: true, atualizadaEm: true },
    });
    return linhas
      .filter((l) => this.podeVerARef(l.ataRef, acesso))
      .map((l) => ({
        ataRef: l.ataRef,
        titulo: l.titulo,
        data: l.data,
        tipo: (l.tipo === 'transcricao' ? 'transcricao' : 'ata') as TrabAtaTipo,
        ligadaEm: l.atualizadaEm.toISOString(),
      }))
      .sort((a, b) => (b.data ?? b.ligadaEm.slice(0, 10)).localeCompare(a.data ?? a.ligadaEm.slice(0, 10)));
  }

  /** A busca da ligação: leads pelo nome ou pela empresa; clientes pelo nome, fantasia ou documento. */
  async candidatos(orgId: string, tipo: 'lead' | 'cliente', q: string | null | undefined, podeLead: boolean): Promise<TrabAtaCandidato[]> {
    const busca = (q ?? '').trim().slice(0, 120);
    if (tipo === 'lead') {
      if (!podeLead) throw new ForbiddenException('Ligar a um lead pede a permissão de ver os leads (leads.ver).');
      const leads = await this.prisma.lead.findMany({
        where: {
          orgId,
          ...(busca ? { OR: [{ name: { contains: busca, mode: 'insensitive' } }, { ficha: { empresa: { contains: busca, mode: 'insensitive' } } }] } : {}),
        },
        orderBy: { updatedAt: 'desc' },
        take: MAX_CANDIDATOS,
        select: { id: true, name: true, ficha: { select: { empresa: true } } },
      });
      return leads.map((l) => {
        const empresa = l.ficha?.empresa?.trim() || null;
        return { tipo: 'lead' as const, id: l.id, nome: l.name, detalhe: empresa && empresa !== l.name ? empresa : null };
      });
    }
    const digitos = busca.replace(/\D/g, '');
    const clientes = await this.prisma.partner.findMany({
      where: {
        orgId,
        ...CLIENTE_VALIDO,
        ...(busca
          ? { OR: [
              { razaoSocial: { contains: busca, mode: 'insensitive' } },
              { nomeFantasia: { contains: busca, mode: 'insensitive' } },
              ...(digitos ? [{ cnpjCpf: { contains: digitos } }] : []),
            ] }
          : {}),
      },
      orderBy: { razaoSocial: 'asc' },
      take: MAX_CANDIDATOS,
      select: { id: true, razaoSocial: true, nomeFantasia: true },
    });
    return clientes.map((p) => {
      const nome = nomeDoPartner(p);
      return { tipo: 'cliente' as const, id: p.id, nome, detalhe: nome !== p.razaoSocial ? p.razaoSocial : null };
    });
  }

  /**
   * Liga ou desliga. `leadId`/`clienteId` ausente = não mexe; `null` = desliga.
   * Sem lead e sem cliente, a linha some. Nada além da linha e da auditoria.
   */
  async ligar(
    orgId: string,
    quem: QuemDecide,
    ref: string,
    input: TrabAtaLigarInput,
    acesso: AcessoAsAtas & { leads: boolean },
  ): Promise<TrabAtaLigacao | null> {
    await this.atas.exigirGente(orgId, quem);
    const lida = lerRefDaAta(ref);
    if (!lida) throw new NotFoundException('Ata não encontrada.');
    if (lida.fonte === 'vault' && !acesso.vault) throw new ForbiddenException(RECUSA_DO_VAULT_NAS_ATAS);
    if (lida.fonte === 'drive' && !acesso.drive) throw new ForbiddenException(RECUSA_DO_DRIVE_NAS_ATAS);
    if (input.leadId !== undefined && !acesso.leads) throw new ForbiddenException('Ligar a um lead pede a permissão de ver os leads (leads.ver).');

    if (input.leadId) {
      const lead = await this.prisma.lead.findFirst({ where: { id: input.leadId, orgId }, select: { id: true } });
      if (!lead) throw new NotFoundException('Lead não encontrado nesta empresa.');
    }
    if (input.clienteId) {
      const cliente = await this.prisma.partner.findFirst({ where: { id: input.clienteId, orgId, ...CLIENTE_VALIDO }, select: { id: true } });
      if (!cliente) throw new NotFoundException('Cliente não encontrado nesta empresa (ou é um cadastro repetido).');
    }

    const antes = await this.prisma.ataLigacao.findUnique({ where: { orgId_ataRef: { orgId, ataRef: ref } } });
    const leadId = input.leadId !== undefined ? input.leadId : antes?.leadId ?? null;
    const clienteId = input.clienteId !== undefined ? input.clienteId : antes?.clienteId ?? null;

    if (!leadId && !clienteId) {
      if (antes) await this.prisma.ataLigacao.deleteMany({ where: { orgId, ataRef: ref } });
      await this.registrar(orgId, quem.id, ref, antes, null);
      return null;
    }

    const copia = await this.copiaDaAta(orgId, ref, lida.fonte, input, acesso);
    const salva = await this.prisma.ataLigacao.upsert({
      where: { orgId_ataRef: { orgId, ataRef: ref } },
      create: { orgId, ataRef: ref, leadId, clienteId, ...copia, ligadaPor: quem.id },
      update: { leadId, clienteId, ...copia, ligadaPor: quem.id },
    });
    await this.registrar(orgId, quem.id, ref, antes, salva);
    const nomes = await this.nomes(orgId, leadId ? [leadId] : [], clienteId ? [clienteId] : []);
    return this.paraLigacao(salva, nomes, await this.nomesDePessoas(orgId, [salva.ligadaPor]));
  }

  /**
   * O título, a data e o tipo que a ligação guarda. A nota da memória e a do
   * vault são relidas aqui (só banco); o Drive e o Granola não se reabrem para
   * ligar: valem o título e a data que a lista mostrou.
   */
  private async copiaDaAta(
    orgId: string,
    ref: string,
    fonte: 'vault' | 'colada' | 'granola' | 'drive',
    input: TrabAtaLigarInput,
    acesso: AcessoAsAtas,
  ): Promise<{ titulo: string; data: string | null; tipo: TrabAtaTipo }> {
    if (fonte === 'vault' || fonte === 'colada') {
      const a = await this.atas.exigirAta(orgId, ref, acesso);
      return { titulo: a.titulo.slice(0, 300), data: metadadosDaAta(a.texto, a.caminho).data ?? input.data ?? null, tipo: 'ata' };
    }
    const titulo = input.titulo?.trim() || (fonte === 'granola' ? 'Reunião do Granola' : 'Arquivo do Drive');
    return {
      titulo: titulo.slice(0, 300),
      data: input.data ?? null,
      tipo: fonte === 'granola' ? 'transcricao' : tipoDoArquivoDeAta(titulo),
    };
  }

  private async registrar(
    orgId: string,
    actorId: string,
    ref: string,
    antes: { leadId: string | null; clienteId: string | null } | null,
    depois: { leadId: string | null; clienteId: string | null } | null,
  ): Promise<void> {
    await this.audit.log({
      orgId,
      actorId,
      action: depois ? 'trabalho.ata.ligada' : 'trabalho.ata.desligada',
      entityType: 'ata',
      entityId: ref,
      ...(antes ? { before: { leadId: antes.leadId, clienteId: antes.clienteId } } : {}),
      ...(depois ? { after: { leadId: depois.leadId, clienteId: depois.clienteId } } : {}),
    });
  }
}
