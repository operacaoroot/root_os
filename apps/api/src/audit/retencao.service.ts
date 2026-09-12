import { BadRequestException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { EventLogService } from '../gateway/event-log.service';
import { AuditService } from './audit.service';

/*
 * QUANTO TEMPO O RASTRO DESTA EMPRESA FICA (RF-R-06).
 *
 * Até 11/09/2026 a resposta era uma variável de ambiente — `RASTRO_RETENCAO_DIAS`,
 * 1825, fixa no `docker-compose.yml`, igual para a instância inteira. Isso erra
 * nos dois sentidos: o cliente que precisa guardar MAIS (um processo judicial em
 * curso) não consegue, e o que precisa guardar MENOS (minimização, LGPD art. 16)
 * também não.
 *
 * O PADRÃO CONTINUA SENDO HERANÇA, NÃO CÓPIA. Empresa sem linha nesta tabela usa
 * `retencao.rastroDias` da política (1825 dias, justificados pelo prazo
 * decadencial do CTN art. 173). Materializar o padrão numa linha no dia do
 * provisionamento congelaria o valor herdado, e a próxima mudança da política
 * não alcançaria mais ninguém — é o mesmo motivo pelo qual `PolicyService` não
 * guarda a base sob a chave da empresa.
 *
 * ENCURTAR EXIGE MOTIVO ESCRITO. Alongar, não. A assimetria é a mesma da
 * sobrescrita de política: a direção que AFROUXA precisa de responsável e de
 * razão, a que endurece pode ser silenciosa. Aqui "afrouxar" é apagar prova mais
 * cedo — e é a única direção em que um erro é irreversível.
 *
 * O PRAZO NÃO É RETROATIVO. `EventLog.retencaoAte` é gravado na linha, com o
 * prazo que valia naquele instante. Mudar a configuração hoje muda o que será
 * escrito de hoje em diante; não estende nem encurta o que já está lá. É o que
 * permite responder "por que esta linha ainda existe?" sem reconstituir o
 * histórico da configuração.
 */

export const PEDIDO_DE_RETENCAO = z.object({
  /**
   * O teto de 36 500 (100 anos) é o mesmo do CHECK da tabela. Prazo maior que
   * isso não é retenção: é desligar a retenção sem ninguém ter decidido.
   */
  dias: z.number().int().min(1).max(36_500),
  motivo: z.string().trim().min(10).max(500).optional(),
});

export type PedidoDeRetencao = z.infer<typeof PEDIDO_DE_RETENCAO>;

/**
 * O corpo de "volte a herdar o padrão".
 *
 * `motivo` é opcional AQUI e obrigatório NO SERVIÇO quando a herança encurta o
 * prazo — porque só lá se sabe se ela encurta. O schema não tem como decidir
 * isso sozinho: depende do prazo atual da empresa e do padrão da política.
 */
export const PEDIDO_DE_HERANCA = z.object({
  motivo: z.string().trim().min(10).max(500).optional(),
});

export interface RetencaoDaEmpresa {
  dias: number;
  /** `true` = não há linha própria; o prazo vem da política. */
  herdado: boolean;
  padraoHerdado: number;
  motivo: string | null;
  definidoPor: string | null;
  atualizadoEm: string | null;
}

@Injectable()
export class RetencaoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: EventLogService,
    /*
     * O LOG ANTIGO CONTINUA ESCREVENDO, EM PARALELO COM O NOVO.
     *
     * A tela de auditoria ainda lê de `AuditLog` (`AuditService.list`), então
     * aposentá-lo nesta fatia faria a mudança de retenção sumir da única tela
     * onde alguém iria procurar por ela. Os dois recebem a mesma mudança: o
     * `AuditLog` com o antes/depois que a tela sabe mostrar, o `EventLog` com a
     * linha encadeada que a auditoria de verdade usa. O antigo sai quando a tela
     * passar a ler o novo — e isso é outra fatia.
     */
    private readonly auditoria: AuditService,
  ) {}

  async ler(orgId: string): Promise<RetencaoDaEmpresa> {
    const padrao = this.eventos.retencaoPadrao();
    const linha = await this.prisma.rastroRetencao.findUnique({ where: { orgId } });
    if (!linha) {
      return {
        dias: padrao,
        herdado: true,
        padraoHerdado: padrao,
        motivo: null,
        definidoPor: null,
        atualizadoEm: null,
      };
    }
    return {
      dias: linha.dias,
      herdado: false,
      padraoHerdado: padrao,
      motivo: linha.motivo,
      definidoPor: linha.definidoPor,
      atualizadoEm: linha.atualizadoEm.toISOString(),
    };
  }

  /**
   * Define o prazo desta empresa.
   *
   * `definidoPor` é PESSOA, e o serviço não tem como conferir isso sozinho — a
   * rota exige `admin.permissoes` e passa `user.sub`. A mesma regra do aprovador
   * vale aqui: a decisão de guardar menos prova não pode ser de um agente.
   */
  async definir(entrada: {
    orgId: string;
    dias: number;
    motivo?: string;
    definidoPor: string;
  }): Promise<RetencaoDaEmpresa> {
    const { dias, motivo } = PEDIDO_DE_RETENCAO.parse({ dias: entrada.dias, motivo: entrada.motivo });
    if (!entrada.definidoPor?.trim()) {
      throw new BadRequestException('retenção do rastro: falta quem está decidindo');
    }

    const antes = await this.ler(entrada.orgId);
    if (dias < antes.dias && !motivo) {
      throw new BadRequestException(
        `encurtar a retenção do rastro de ${antes.dias} para ${dias} dias exige motivo escrito ` +
          '(pelo menos 10 caracteres): é a única direção em que a mudança apaga prova.',
      );
    }

    const linha = await this.prisma.rastroRetencao.upsert({
      where: { orgId: entrada.orgId },
      create: {
        orgId: entrada.orgId,
        dias,
        motivo: motivo ?? null,
        definidoPor: entrada.definidoPor,
      },
      update: { dias, motivo: motivo ?? null, definidoPor: entrada.definidoPor },
    });
    this.eventos.esquecerRetencao(entrada.orgId);

    /*
     * A MUDANÇA DA REGRA DO RASTRO ENTRA NO PRÓPRIO RASTRO.
     *
     * Sem `nivel`: a política não tem capacidade para "configurar a retenção do
     * rastro", e `avaliar(null)` vale R5 — que bloquearia uma configuração de
     * painel. Inventar um degrau aqui seria escrever régua no lugar errado. Está
     * registrado como pergunta no relatório da fatia; até lá a linha carrega
     * tudo o que um degrau exigiria (quem, quando, de quanto para quanto, por
     * quê) e o nível fica honestamente vazio.
     */
    await this.eventos.registrar({
      orgId: entrada.orgId,
      tipo: 'rastro.retencao.definida',
      actorType: 'user',
      actorId: entrada.definidoPor,
      conteudo: {
        motivo: motivo ?? (dias > antes.dias ? 'prazo alongado' : 'prazo mantido ou redefinido'),
        estadoAnterior: { dias: antes.dias, herdado: antes.herdado },
        estadoNovo: { dias, herdado: false },
        aprovador: entrada.definidoPor,
        aprovadoEm: linha.atualizadoEm,
        fontes: [{ tipo: 'configuracao', origem: 'painel de auditoria' }],
      },
    });

    await this.auditoria.log({
      orgId: entrada.orgId,
      actorType: 'user',
      actorId: entrada.definidoPor,
      action: 'rastro.retencao.definida',
      entityType: 'RastroRetencao',
      entityId: linha.id,
      before: { dias: antes.dias, herdado: antes.herdado },
      after: { dias, herdado: false, motivo: motivo ?? null },
    });

    return this.ler(entrada.orgId);
  }

  /**
   * Tira a configuração própria: a empresa volta a herdar o padrão.
   *
   * Apagar a CONFIGURAÇÃO, nunca evento.
   *
   * E COBRA MOTIVO PELA MESMA REGRA DE `definir`, quando encurta. Até
   * 11/09/2026 não cobrava, e isso era um contorno inteiro da trava: uma empresa
   * com prazo de 3650 dias voltava ao padrão de 1825 sem motivo nenhum, com
   * exatamente as mesmas permissões que `definir({ dias: 1825 })` — que seria
   * recusado. O comentário desta função já dizia que as duas direções precisam
   * ser enxergadas do mesmo jeito; só um caminho cobrava.
   *
   * Quando a herança ALONGA (empresa com prazo curto voltando ao padrão), não
   * cobra — a assimetria é a mesma: a direção que apaga prova mais cedo precisa
   * de responsável e razão, a que endurece pode ser silenciosa.
   */
  async herdar(orgId: string, por: string, motivo?: string): Promise<RetencaoDaEmpresa> {
    if (!por?.trim()) {
      throw new BadRequestException('retenção do rastro: falta quem está decidindo');
    }

    const antes = await this.ler(orgId);
    if (antes.herdado) return antes;

    const encurta = antes.padraoHerdado < antes.dias;
    const razao = motivo?.trim();
    if (encurta && (!razao || razao.length < 10)) {
      throw new BadRequestException(
        `voltar a herdar o prazo do rastro ENCURTA a guarda desta empresa de ${antes.dias} para ` +
          `${antes.padraoHerdado} dias, e encurtar exige motivo escrito (pelo menos 10 caracteres) — ` +
          'a mesma regra de definir um prazo menor à mão. É a única direção em que a mudança ' +
          'apaga prova.',
      );
    }

    await this.prisma.rastroRetencao.delete({ where: { orgId } });
    this.eventos.esquecerRetencao(orgId);

    await this.eventos.registrar({
      orgId,
      tipo: 'rastro.retencao.herdada',
      actorType: 'user',
      actorId: por,
      conteudo: {
        motivo: razao ?? 'voltou a herdar o prazo da política',
        estadoAnterior: { dias: antes.dias, herdado: false },
        estadoNovo: { dias: antes.padraoHerdado, herdado: true },
        aprovador: por,
        aprovadoEm: new Date(),
      },
    });

    await this.auditoria.log({
      orgId,
      actorType: 'user',
      actorId: por,
      action: 'rastro.retencao.herdada',
      entityType: 'RastroRetencao',
      before: { dias: antes.dias, herdado: false },
      after: { dias: antes.padraoHerdado, herdado: true, motivo: razao ?? null },
    });

    return this.ler(orgId);
  }
}
