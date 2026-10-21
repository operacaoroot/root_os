import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { CAMPO_ISCA_DO_FORMULARIO, FormularioDoSiteSchema, RESPOSTA_DO_FORMULARIO } from '@mktos/shared';
import { ActorType } from '@prisma/client';

import { comTenantPublico, resolverOrgDaChave } from '../../common/tenant-publico';
import { PortaDoOperador } from '../../gateway/porta-do-operador.service';
import { MemoriaService } from '../../memory/memoria.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ModulosService } from '../../tenants/modulos.service';
import { ATOR_DO_FORMULARIO, CAP_LEAD_CRIAR, chaveDaRequisicao } from '../lead-criar.service';

/*
 * O FORMULÁRIO DO SITE (rodada dos agentes, 21/10/2026, CO-15) — sem modelo.
 *
 * `POST /api/publico/lead`, ANÔNIMA (como o link do onboarding e a sala): quem
 * preenche o formulário de operacaoroot.com não tem token. O que segura:
 *
 *   · o CORS só das duas origens do site e o corpo pequeno (`cors.ts`, antes do
 *     parser), o teto por origem (IP) no controlador;
 *   · o CAMPO-ISCA (`website`): humano não vê, robô preenche; preenchido, a
 *     resposta é a mesma do sucesso e nada é gravado;
 *   · o schema do shared (`FormularioDoSiteSchema`): nome, um contato, tamanhos;
 *   · a EMPRESA vem da chave `k` (o id da empresa no OS, o mesmo do pixel),
 *     resolvida pela sentinela pública (`resolverOrgDaChave`); chave que não
 *     resolve e empresa sem o módulo `leads` respondem o mesmo 404;
 *   · E SÓ DE EMPRESA QUE OPTOU (revisão adversarial de 21/10/2026): o `k` é o
 *     id da empresa, que o pixel já publica no site, então sem opt-in qualquer
 *     um criava lead em qualquer empresa do OS. Vale só com a nota da memória
 *     `comercial.formulario.site` com a primeira linha `ligado` (só LIDA aqui,
 *     sem leitor; escrita é de gente, pela memória). Sem ela, ou arquivada, o
 *     mesmo 404 da chave que não existe;
 *   · o lead nasce PELA PORTA, com a capacidade `comercial.lead.criar` (R1),
 *     em nome do sistema (`formulario-do-site`). Fora das 08h às 20h ou em
 *     volume atípico a régua sobe para R2 e o pedido fica retido para uma pessoa:
 *     a resposta ao site é a mesma (nada ecoa do lado de dentro);
 *   · a chave da porta é o hash da requisição: o mesmo envio repetido cai no
 *     mesmo lead e no mesmo fato.
 *
 * O texto do formulário é DADO: vai ao fio e à tela, nunca a um prompt.
 * Nenhuma mensagem, cobrança ou contrato nasce daqui.
 */

/** A nota da memória que liga o formulário do site na empresa (primeira linha `ligado`). */
export const NOTA_DO_FORMULARIO_DO_SITE = 'comercial.formulario.site';

/** A primeira linha da nota diz `ligado`? (sem marcação de markdown, sem acento, sem caixa) */
export function formularioLigadoNaNota(corpo: string | null | undefined): boolean {
  const primeira = String(corpo ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  return (primeira ?? '').replace(/[*_`#>\s-]/g, '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase() === 'ligado';
}

@Injectable()
export class FormularioDoSiteService {
  private readonly log = new Logger('ComercialFormularioDoSite');

  constructor(
    private readonly prisma: PrismaService,
    private readonly porta: PortaDoOperador,
    private readonly modulos: ModulosService,
    private readonly memoria: MemoriaService,
  ) {}

  /** A empresa optou pelo formulário do site? Falha ao ler = não (o 404 de sempre). */
  private async optou(orgId: string): Promise<boolean> {
    const nota = await this.memoria.porChave(orgId, NOTA_DO_FORMULARIO_DO_SITE, null).catch(() => null);
    return !!nota && !nota.arquivadoEm && formularioLigadoNaNota(nota.body);
  }

  async receber(corpo: unknown): Promise<typeof RESPOSTA_DO_FORMULARIO> {
    // A isca vem antes de tudo: o robô ouve o mesmo "recebido" e não aprende nada.
    const bruto = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
    const isca = bruto[CAMPO_ISCA_DO_FORMULARIO];
    if (typeof isca === 'string' && isca.trim()) {
      this.log.warn('formulário do site: campo-isca preenchido, nada gravado');
      return RESPOSTA_DO_FORMULARIO;
    }
    const r = FormularioDoSiteSchema.safeParse(bruto);
    if (!r.success) {
      throw new BadRequestException({ message: 'Formulário inválido.', erros: r.error.issues.map((i) => `${i.path.join('.') || 'corpo'}: ${i.message}`) });
    }
    const f = r.data;
    const empresa = await resolverOrgDaChave(this.prisma as never, f.k);
    if (!empresa) throw new NotFoundException('Não encontrado.');
    return comTenantPublico(empresa.orgId, async () => {
      if (!(await this.modulos.modulosDaOrg(empresa.orgId)).has('leads')) throw new NotFoundException('Não encontrado.');
      if (!(await this.optou(empresa.orgId))) throw new NotFoundException('Não encontrado.');
      const campos = { nome: f.nome, email: f.email ?? null, telefone: f.telefone ?? null, empresa: f.empresa ?? null, mensagem: f.mensagem ?? null };
      const chave = chaveDaRequisicao({ origem: 'formulario-do-site', ...campos });
      const args: Record<string, unknown> = { origem: 'formulario-do-site', nome: f.nome, chave };
      if (f.email) args.email = f.email;
      if (f.telefone) args.telefone = f.telefone;
      if (f.empresa) args.empresa = f.empresa;
      if (f.mensagem) args.mensagem = f.mensagem;
      try {
        await this.porta.executar({
          orgId: empresa.orgId,
          actorId: ATOR_DO_FORMULARIO,
          actorType: ActorType.system,
          capabilityId: CAP_LEAD_CRIAR,
          args,
          resource: { type: 'lead.entrada', id: chave },
        });
      } catch (e) {
        // Recusa da régua, conector desligado, erro do efeito: o site ouve só que não deu agora.
        this.log.warn(`formulário do site da empresa ${empresa.orgId} não registrado: ${(e as Error).message.slice(0, 200)}`);
        throw new ServiceUnavailableException('Não conseguimos registrar o contato agora. Tente de novo em instantes.');
      }
      return RESPOSTA_DO_FORMULARIO;
    });
  }
}
