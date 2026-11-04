import { ConflictException, ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import { ActorType, ApprovalState, type OrigemArquivoCliente, type Prisma } from '@prisma/client';
import { canonicalHash } from '../approvals/approvals.service';
import { argsRedigidos } from '../approvals/vinculo-de-conteudo';
import { LEITURA_DA_EVOLUTION, type LeituraDaEvolution } from '../gateway/canais/evolution.port';
import { PolicyService } from '../policy/policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { ClienteEscopoService } from './cliente-escopo.service';

export interface ConteudoRecebido { chave: string; sha256: string; bytes: number; tipoMime: string }
export interface ArquivoRecebidoEsperado extends ConteudoRecebido { leadId: string | null; partnerId: string | null; origem: string }
type Prova = Record<string, string | number | null>;
type Fonte = { fonteId: string; leadId: string | null; partnerId: string | null; atorId: string | null; prova: Prova };
const negar = () => new ForbiddenException('A origem deste arquivo não está mais válida.');
const objeto = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const igual = (a: unknown, b: unknown) => canonicalHash('origem-arquivo', objeto(a), []) === canonicalHash('origem-arquivo', objeto(b), []);

/** Recibo de dados. Todo uso relê a fonte; a autorização R3 pertence à Porta. */
@Injectable()
export class OrigemArquivoClienteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly escopo: ClienteEscopoService,
    private readonly policy: PolicyService,
    @Optional() @Inject(LEITURA_DA_EVOLUTION) private readonly evolution?: LeituraDaEvolution,
  ) {}

  async registrarSala(p: { orgId: string; salaId: string; tokenHash: string; conteudo: ConteudoRecebido }) {
    const fonte = await this.fonteSala(p.orgId, p.salaId, p.tokenHash);
    if (p.conteudo.chave !== `comercial/sala/${p.salaId}/${p.conteudo.sha256}`) throw negar();
    return this.registrar(p.orgId, 'sala', `${p.salaId}:${p.tokenHash}:${p.conteudo.sha256}`, fonte, p.conteudo);
  }

  async registrarWhatsapp(p: { orgId: string; instancia: string; mensagemExternaId: string; remetenteNumero: string; conteudo: ConteudoRecebido }) {
    if (!p.instancia || !p.mensagemExternaId || !p.remetenteNumero) throw negar();
    const mensagem = await this.prisma.whatsAppMensagem.findFirst({ where: { orgId: p.orgId, instancia: p.instancia, mensagemExternaId: p.mensagemExternaId } });
    if (!mensagem || mensagem.remetenteNumero !== p.remetenteNumero) throw negar();
    const fonte = await this.fonteWhatsapp(p.orgId, mensagem.id);
    const midia = objeto(mensagem.midia);
    if ((midia.mime && midia.mime !== p.conteudo.tipoMime) || (typeof midia.tamanho === 'number' && midia.tamanho > 0 && midia.tamanho !== p.conteudo.bytes)) throw negar();
    if (p.conteudo.chave !== `clientes/arquivos/${p.orgId}/${p.conteudo.sha256}`) throw negar();
    return this.registrar(p.orgId, 'whatsapp', mensagem.id, fonte, p.conteudo);
  }

  async exigirContrato(orgId: string, leadId: string, documentoId: string, externoId: string, provedor: string) {
    return this.fonteContrato(orgId, documentoId, { leadId, externoId, provedor });
  }

  async registrarContrato(p: { orgId: string; leadId: string; documentoId: string; externoId: string; provedor: string; conteudo: ConteudoRecebido }) {
    const fonte = await this.exigirContrato(p.orgId, p.leadId, p.documentoId, p.externoId, p.provedor);
    if (p.conteudo.tipoMime !== 'application/pdf' || p.conteudo.chave !== `clientes/arquivos/${p.orgId}/${p.conteudo.sha256}`) throw negar();
    return this.registrar(p.orgId, 'contrato-assinado', p.documentoId, fonte, p.conteudo);
  }

  async exigir(orgId: string, id: string, esperado: ArquivoRecebidoEsperado) {
    const recibo = await this.prisma.origemArquivoCliente.findFirst({ where: { id, orgId, revogadoEm: null } });
    if (!recibo || recibo.tipo !== esperado.origem || recibo.leadId !== esperado.leadId) throw negar();
    this.conferirConteudo(recibo, esperado);
    const prova = objeto(recibo.prova);
    if (prova.v !== 1) throw negar();
    const fonte = recibo.tipo === 'sala'
      ? await this.fonteSala(orgId, recibo.fonteId, String(prova.tokenHash ?? ''))
      : recibo.tipo === 'whatsapp'
        ? await this.fonteWhatsapp(orgId, recibo.fonteId)
        : recibo.tipo === 'contrato-assinado'
          ? await this.fonteContrato(orgId, recibo.fonteId, { leadId: recibo.leadId ?? '', externoId: String(prova.externoId ?? ''), provedor: String(prova.provedor ?? '') })
          : null;
    if (!fonte || !igual(fonte.prova, recibo.prova) || fonte.leadId !== recibo.leadId || fonte.atorId !== recibo.atorId) throw negar();
    // Apenas a promoção de lead canônico sem cliente inicial pode resolver o destino depois.
    if (recibo.partnerId && recibo.partnerId !== fonte.partnerId) throw negar();
    if (fonte.partnerId !== esperado.partnerId) throw negar();
    return { atorId: fonte.atorId, leadId: fonte.leadId, partnerId: fonte.partnerId };
  }

  private conferirConteudo(a: ConteudoRecebido, b: ConteudoRecebido) {
    if (a.chave !== b.chave || a.sha256 !== b.sha256 || a.bytes !== b.bytes || a.tipoMime !== b.tipoMime) throw negar();
  }

  private async registrar(orgId: string, tipo: string, chaveDedupe: string, fonte: Fonte, conteudo: ConteudoRecebido) {
    if (!/^[a-f0-9]{64}$/.test(conteudo.sha256) || !Number.isInteger(conteudo.bytes) || conteudo.bytes < 1 || conteudo.bytes > 104857600 || !conteudo.tipoMime || conteudo.tipoMime.length > 120) throw negar();
    // createMany/skipDuplicates não altera a prova concorrente; a comparação posterior exige igualdade.
    await this.prisma.origemArquivoCliente.createMany({ data: [{ orgId, tipo, chaveDedupe, ...fonte, ...conteudo, prova: fonte.prova as Prisma.InputJsonValue }], skipDuplicates: true });
    const recibo = await this.prisma.origemArquivoCliente.findUniqueOrThrow({ where: { orgId_tipo_chaveDedupe: { orgId, tipo, chaveDedupe } } });
    if (recibo.fonteId !== fonte.fonteId || recibo.leadId !== fonte.leadId || recibo.atorId !== fonte.atorId || !igual(recibo.prova, fonte.prova)) throw new ConflictException('Esta origem já tem outro recibo.');
    const atual = await this.exigir(orgId, recibo.id, { leadId: fonte.leadId, partnerId: fonte.partnerId, origem: tipo, ...conteudo });
    return { id: recibo.id, ...atual };
  }

  private async clienteDoLead(orgId: string, leadId: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { id: true } });
    if (!lead) throw negar();
    const ficha = await this.prisma.comercialFicha.findFirst({ where: { leadId, orgId }, select: { partnerId: true } });
    if (ficha?.partnerId) await this.cliente(orgId, ficha.partnerId);
    return ficha?.partnerId ?? null;
  }

  private async cliente(orgId: string, partnerId: string) {
    const cliente = await this.prisma.partner.findFirst({ where: { id: partnerId, orgId, isCliente: true, ativo: true, principalId: null }, select: { id: true } });
    if (!cliente) throw negar();
  }

  private async fonteSala(orgId: string, salaId: string, tokenHash: string): Promise<Fonte> {
    const sala = await this.prisma.salaDoCliente.findFirst({ where: { id: salaId, orgId, tokenHash, revogadoEm: null, validoAte: { gt: new Date() } } });
    if (!sala) throw negar();
    return { fonteId: sala.id, leadId: sala.leadId, partnerId: await this.clienteDoLead(orgId, sala.leadId), atorId: null,
      prova: { v: 1, salaId: sala.id, tokenHash, validoAte: sala.validoAte.toISOString() } };
  }

  private async fonteWhatsapp(orgId: string, mensagemId: string): Promise<Fonte> {
    const m = await this.prisma.whatsAppMensagem.findFirst({ where: { id: mensagemId, orgId }, include: { conversa: true } });
    if (!m || m.deMim || m.direcao !== 'entrada' || m.grupo || !['document','image'].includes(m.tipo) || !m.remetenteNumero || m.origem !== 'webhook') throw negar();
    const midia = objeto(m.midia);
    if (m.tipo === 'image' && (typeof midia.mime !== 'string' || !midia.mime.startsWith('image/'))) throw negar();
    const c = m.conversa;
    if (c.orgId !== orgId || c.instancia !== m.instancia || c.chatJid !== m.chatJid || c.equipe || c.comunidade || c.grupo || c.leadId !== m.leadId || c.clienteId !== m.clienteId) throw negar();
    if (!this.evolution || !(await this.evolution.ligado(orgId)) || await this.evolution.instanciaDaEmpresa(orgId) !== m.instancia) throw negar();
    let partnerId = m.clienteId;
    if (m.leadId) {
      const daFicha = await this.clienteDoLead(orgId, m.leadId);
      if (partnerId && partnerId !== daFicha) throw negar();
      partnerId = daFicha;
    } else if (partnerId) await this.cliente(orgId, partnerId);
    else throw negar();
    return { fonteId: m.id, leadId: m.leadId, partnerId, atorId: null, prova: {
      v: 1, conversaId: c.id, instancia: m.instancia, mensagemExternaId: m.mensagemExternaId, chatJid: m.chatJid,
      remetenteNumero: m.remetenteNumero, remetenteJid: m.remetenteJid, leadId: m.leadId,
      tipo: m.tipo, mime: typeof midia.mime === 'string' ? midia.mime : null, tamanho: typeof midia.tamanho === 'number' ? midia.tamanho : null,
    } };
  }

  private async pessoa(orgId: string, id: string, partnerId: string | null, permissao: string) {
    await this.escopo.exigirAmplo(orgId, id);
    await this.escopo.exigirCliente(orgId, id, partnerId);
    if (!await this.prisma.user.findFirst({ where: { id, orgId, isActive: true, roles: { some: { orgId, permissions: { some: { key: permissao } } } } }, select: { id: true } })) throw negar();
  }

  private async fonteContrato(orgId: string, documentoId: string, esperado: { leadId: string; externoId: string; provedor: string }): Promise<Fonte> {
    const d = await this.prisma.comercialDocumento.findFirst({ where: { id: documentoId, orgId, leadId: esperado.leadId } });
    if (!d || d.externoId !== esperado.externoId || d.provedor !== esperado.provedor || d.provedor !== 'zapsign' || d.estado !== 'assinado' || !d.assinadoRootEm || !d.assinadoClienteEm || !d.origemApprovalId) throw negar();
    const ap = await this.prisma.approval.findFirst({ where: { id: d.origemApprovalId, orgId, status: ApprovalState.consumida, capabilityId: 'comercial.contrato.enviar', resourceType: 'comercial.contrato' } });
    if (!ap?.toolCallId || !ap.aprovadoPorId || !ap.consumidoEm || ap.nivelExigido !== 'R4') throw negar();
    const tc = await this.prisma.toolCall.findFirst({ where: { id: ap.toolCallId, orgId, capabilityId: ap.capabilityId, approvalId: ap.id } });
    const args = objeto(tc?.args);
    const cap = this.policy.resolverCapacidade(orgId, 'comercial.contrato.enviar');
    if (!tc || !cap || argsRedigidos(tc.args) || tc.actorId !== ap.propostoPorId || tc.actorType !== ap.propostoPorTipo || args.leadId !== d.leadId || args.hash !== d.hashConteudo) throw negar();
    const hashKeys = (cap as unknown as { hashKeys?: string[] }).hashKeys ?? [];
    if (canonicalHash(ap.resourceType, args, hashKeys) !== ap.contentHash) throw negar();
    const contratoId = typeof args.contratoId === 'string' ? args.contratoId : null;
    if (ap.resourceId !== `${contratoId ?? d.leadId}:${d.hashConteudo.slice(0, 16)}`) throw negar();
    const partnerId = await this.clienteDoLead(orgId, d.leadId);
    if (contratoId) {
      const c = await this.prisma.comercialContrato.findFirst({ where: { id: contratoId, orgId, leadId: d.leadId, documentoId: d.id } });
      if (!c || c.estado === 'cancelado' || (c.partnerId && c.partnerId !== partnerId)) throw negar();
    }
    await this.pessoa(orgId, ap.aprovadoPorId, partnerId, 'aprovacoes.decidir');
    let atorId: string | null = null;
    if (ap.propostoPorTipo === ActorType.user) {
      if (ap.propostoPorId === ap.aprovadoPorId) throw negar();
      await this.pessoa(orgId, ap.propostoPorId, partnerId, 'leads.editar'); atorId = ap.propostoPorId;
    } else {
      if (ap.propostoPorTipo !== ActorType.system || ap.propostoPorId !== 'comercial') throw negar();
      const humana = await this.prisma.approval.findFirst({ where: { orgId, capabilityId: 'comercial.contrato.enviar', resourceType: ap.resourceType, resourceId: ap.resourceId, OR: [{ propostoPorTipo: { not: ActorType.system } }, { propostoPorId: { not: 'comercial' } }] }, select: { id: true } });
      if (humana) throw negar();
    }
    return { fonteId: d.id, leadId: d.leadId, partnerId, atorId, prova: {
      v: 1, documentoId: d.id, externoId: d.externoId, provedor: d.provedor, hashConteudo: d.hashConteudo,
      assinadoRootEm: d.assinadoRootEm.toISOString(), assinadoClienteEm: d.assinadoClienteEm.toISOString(),
      approvalId: ap.id, approvalHash: ap.contentHash, proponenteTipo: ap.propostoPorTipo, proponenteId: ap.propostoPorId,
    } };
  }
}
