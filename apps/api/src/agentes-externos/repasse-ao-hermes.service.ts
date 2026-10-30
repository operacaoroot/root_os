import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { EstadoDeAgente } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RepasseDoWhatsappRegistry } from '../gateway/canais/repasse.registry';
import { temPapelDeMaquina } from '../approvals/alcada';
import { mesmoTelefone } from '../work/agente-de-tarefas/pedido-do-grupo';
import {
  CABECALHO_DA_ASSINATURA,
  CABECALHO_DO_INSTANTE,
  PRAZO_DO_REPASSE_MS,
  assinar,
  configuracaoDoRepasse,
  corpoDoRepasse,
  decidirRepasse,
  lerMensagem,
  type PessoaDaEquipe,
} from './repasse-ao-hermes';

/** O slug do agente que recebe o repasse. */
export const SLUG_DA_ROOTINHA = 'rootinha';

/*
 * ============================================================================
 * O REPASSE AO HERMES (A9, 30/10/2026) — a Rootinha ouvindo o WhatsApp da empresa
 * ============================================================================
 *
 * DESLIGADO POR PADRÃO. Só se inscreve no repasse do webhook com as DUAS
 * variáveis (`ROOTINHA_WEBHOOK_URL` e `ROOTINHA_WEBHOOK_SEGREDO`, este com 32+
 * caracteres). Metade configurado fica desligado e diz por quê no log — a mesma
 * escolha do canal de aprovação, que recusa subir com metade.
 *
 * LIGA E DESLIGA NA TELA DE AGENTES, como o TR-12: com as variáveis, a cópia só
 * sai quando o registro `Agent` da Rootinha NESTA empresa está ativo. Pausada,
 * silêncio.
 *
 * A REGRA de quais mensagens são dela mora em `repasse-ao-hermes.ts` (pura). Aqui
 * fica só o que precisa de banco (quem é da equipe, o estado do agente) e de rede
 * (o POST assinado, com prazo curto). Falha de rede vira rótulo no log do
 * webhook; nunca derruba a entrada, porque o registro do repasse prende a falha.
 */
@Injectable()
export class RepasseAoHermesService implements OnModuleInit {
  private readonly log = new Logger('RepasseAoHermes');
  private readonly config = configuracaoDoRepasse(process.env);
  /** O `fetch`. Só a suíte troca. */
  enviar: typeof fetch = (...a) => fetch(...a);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly registro?: RepasseDoWhatsappRegistry,
  ) {}

  onModuleInit(): void {
    if (!this.config.ligado) {
      if (!/vazios$/.test(this.config.motivo)) this.log.warn(`repasse à Rootinha desligado: ${this.config.motivo}`);
      return;
    }
    if (!this.registro) {
      this.log.warn('as variáveis da Rootinha estão definidas, mas o registro de repasse do webhook não está no ar');
      return;
    }
    this.registro.registrar((orgId, evento) => this.repassar(orgId, evento), 'RepasseAoHermesService');
  }

  async repassar(orgId: string, evento: unknown): Promise<string | null> {
    if (!this.config.ligado) return null;
    const m = lerMensagem(evento);
    if (!m) return null;
    const agente = await this.prisma.agent.findFirst({
      where: { orgId, slug: SLUG_DA_ROOTINHA },
      select: { estado: true, ativo: true },
    });
    if (!agente || agente.estado !== EstadoDeAgente.ativo || !agente.ativo) return null;

    const pessoa = await this.pessoaDaEquipe(orgId, m.remetente);
    const d = decidirRepasse(m, pessoa);
    if (!d.repassar) return null;

    const corpo = JSON.stringify(corpoDoRepasse(orgId, m, d));
    const instante = String(Date.now());
    const res = await this.enviar(this.config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [CABECALHO_DO_INSTANTE]: instante,
        [CABECALHO_DA_ASSINATURA]: assinar(this.config.segredo, instante, corpo),
      },
      body: corpo,
      signal: AbortSignal.timeout(PRAZO_DO_REPASSE_MS),
    });
    // Só o status: a resposta do Hermes não entra no log nem volta para ninguém.
    return res.ok ? d.motivo : `http-${res.status}`;
  }

  /** O usuário ativo da equipe com este telefone (gente, não conta de máquina), ou `null`. */
  private async pessoaDaEquipe(orgId: string, remetente: string | null): Promise<PessoaDaEquipe | null> {
    if (!remetente) return null;
    const contas = await this.prisma.user.findMany({
      where: { orgId, isActive: true, phone: { not: null } },
      select: { id: true, name: true, phone: true, roles: { select: { key: true } } },
    });
    const achada = contas.find((c) => mesmoTelefone(c.phone, remetente) && !temPapelDeMaquina(c.roles.map((r) => r.key)));
    return achada ? { id: achada.id, nome: achada.name } : null;
  }
}
