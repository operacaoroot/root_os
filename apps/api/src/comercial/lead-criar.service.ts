import { createHash } from 'node:crypto';

import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';

import { EfeitosRegistry } from '../gateway/efeitos.registry';
import { LeadsService } from '../leads/leads.service';
import { canonico, normalizarTelefone } from './eventos';
import { FichaService } from './ficha.service';
import { FioService } from './fio.service';
import { SalaService } from './sala.service';
import { WhatsappComercialService } from './whatsapp.service';

/*
 * O EFEITO DE `comercial.lead.criar` (rodada dos agentes, 21/10/2026, CO-15 e CO-16).
 *
 * A capacidade é R1 pela escada (escreve só dentro do OS: o lead, os fatos e a
 * auditoria; não manda mensagem, não cobra, não gera contrato), e só a PORTA
 * chama este efeito. Duas origens, as duas pela entrada idempotente que já existe:
 *
 *   · `formulario-do-site` (CO-15): a entrada de lead do OS (`LeadsService.entrada`,
 *     o `LeadEvent` com id derivado do hash da requisição), origem `manual` com a
 *     referência `formulario-do-site:<hash do contato>`: o mesmo e-mail (ou
 *     telefone) cai no mesmo lead, e o mesmo envio não grava nada de novo. Depois,
 *     a ficha do comercial, o `lead.chegou` (canal `site`, com `origem:
 *     'formulario-do-site'`, que faz a M1 NÃO ser preparada: o número foi
 *     digitado por um anônimo) e o `site.formulario` do envio;
 *   · `whatsapp` (CO-16): a entrada do WhatsApp do comercial
 *     (`WhatsappComercialService.receberEntrada`, id do lead derivado do
 *     telefone, a mensagem deduplicada pela chave). É o caminho de sempre de quem
 *     escreve para a Root: a M1 é preparada e vai à fila (R3), como antes.
 *
 * O texto (nome, empresa, mensagem) é DADO: vai ao fio e à tela, nunca a prompt.
 *
 * A SALA NASCE COM O LEAD (leva 5, L6, 27/10/2026): nos dois caminhos o
 * `lead.chegou` já dispara a reação `sala.abrir`; aqui o efeito garante a sala
 * de novo, pelo MESMO `SalaService.garantir` (idempotente pelo `leadId` único),
 * para o lead não ficar sem sala quando a reação é pulada ou falha e espera o
 * relógio. Falha ao garantir a sala nunca derruba a criação do lead.
 */

export const CAP_LEAD_CRIAR = 'comercial.lead.criar';
export const ATOR_DO_FORMULARIO = 'formulario-do-site';
export const ATOR_DA_TRIAGEM = 'triagem-do-whatsapp';

type P = Record<string, unknown>;

function texto(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}

/** A chave de idempotência de uma requisição (sha256 do conteúdo canônico). */
export function chaveDaRequisicao(campos: Record<string, unknown>): string {
  return createHash('sha256').update(canonico(campos)).digest('hex');
}

/** A referência da origem do formulário: o contato, em hash (o e-mail ou o telefone não vão em claro na referência). */
export function referenciaDoFormulario(email: string | null, telefone: string | null): string {
  const contato = email ? `e:${email.toLowerCase()}` : `t:${normalizarTelefone(telefone ?? '')}`;
  return `formulario-do-site:${createHash('sha256').update(contato).digest('hex').slice(0, 32)}`;
}

@Injectable()
export class LeadCriarService implements OnModuleInit {
  private readonly log = new Logger('ComercialLeadCriar');

  constructor(
    private readonly efeitos: EfeitosRegistry,
    private readonly leads: LeadsService,
    private readonly fichas: FichaService,
    private readonly fio: FioService,
    private readonly whats: WhatsappComercialService,
    // L6: opcional para a suíte que monta o serviço à mão sem a sala; em produção o Nest injeta.
    @Optional() private readonly sala?: SalaService,
  ) {}

  onModuleInit(): void {
    this.efeitos.registrar({ [CAP_LEAD_CRIAR]: (args, orgId) => this.efeito(args, orgId) }, 'comercial/lead-criar.service');
  }

  /** L6: a sala do lead, garantida pelo mesmo caminho da reação. Nunca lança: a sala é derivada, o lead é o fato. */
  private async garantirSala(orgId: string, leadId: string): Promise<void> {
    if (!this.sala) return;
    try {
      await this.sala.garantir(orgId, leadId);
    } catch (e) {
      this.log.warn(`sala do lead ${leadId} não garantida ao criar: ${(e as Error).message}`);
    }
  }

  async efeito(args: P, orgId: string): Promise<{ leadId: string; criado: boolean }> {
    if (args.origem === 'formulario-do-site') return this.doFormulario(args, orgId);
    if (args.origem === 'whatsapp') return this.doWhatsapp(args, orgId);
    throw new Error('origem de lead desconhecida: nada foi criado');
  }

  private async doFormulario(args: P, orgId: string): Promise<{ leadId: string; criado: boolean }> {
    const nome = texto(args.nome, 200);
    if (!nome) throw new Error('o formulário chegou sem nome: nada foi criado');
    const email = texto(args.email, 254)?.toLowerCase() ?? null;
    const telefoneCru = texto(args.telefone, 40);
    const telefone = telefoneCru ? normalizarTelefone(telefoneCru) : null;
    if (!email && !telefone) throw new Error('o formulário chegou sem contato: nada foi criado');
    const empresa = texto(args.empresa, 200);
    const mensagem = texto(args.mensagem, 2000);
    const chave = String(args.chave ?? '');

    const e = await this.leads.entrada(
      { sub: ATOR_DO_FORMULARIO, orgId, permissions: ['leads.editar'] },
      {
        origem: { tipo: 'manual', ref: referenciaDoFormulario(email, telefone) },
        nome,
        ...(email ? { email } : {}),
        ...(telefone ? { telefone } : {}),
      },
    );
    await this.fichas.garantir(orgId, e.id);
    await this.fio.registrar(orgId, e.id, 'lead.chegou', 'formulario-do-site', {
      telefone: telefone ?? '',
      texto: mensagem ?? '',
      canal: 'site',
      nome,
      origem: 'formulario-do-site',
      empresa,
    });
    await this.fio.registrar(orgId, e.id, 'site.formulario', chave, { nome, empresa, email, telefone, mensagem, chave });
    await this.garantirSala(orgId, e.id);
    if (e.criado) this.log.log(`lead novo pelo formulário do site na empresa ${orgId}`);
    return { leadId: e.id, criado: e.criado };
  }

  private async doWhatsapp(args: P, orgId: string): Promise<{ leadId: string; criado: boolean }> {
    const telefone = normalizarTelefone(String(args.telefone ?? ''));
    if (!/^\d{10,15}$/.test(telefone)) throw new Error('a mensagem do WhatsApp chegou sem telefone válido: nada foi criado');
    const mensagem = texto(args.mensagem, 2000) ?? '(mensagem sem texto)';
    const nome = texto(args.nome, 120);
    const r = await this.whats.receberEntrada(orgId, {
      telefone,
      texto: mensagem,
      ...(nome ? { nome } : {}),
      mensagemId: String(args.chave ?? '').slice(0, 120) || undefined,
    });
    await this.garantirSala(orgId, r.leadId);
    return { leadId: r.leadId, criado: r.leadNovo };
  }
}
