import { Injectable, Logger } from '@nestjs/common';
import type { Sinal } from '@mktos/policy';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from './policy.service';
import { acimaDoTeto, conferirJanela, foraDaJanela } from './limites';

/*
 * Os seis sinais de escalonamento. O motor puro RECEBE os sinais prontos — ele
 * não pode calculá-los, porque calcular exige I/O. Quem faz a conta é isto.
 *
 * `fonte_nao_confiavel` não está aqui de propósito: ele não é calculado, é
 * DECLARADO pelo runtime quando o pedido foi montado a partir de mensagem,
 * documento ou página. É o RF-G-07 inteiro — conteúdo externo entra como dado,
 * jamais como instrução, e só pode ELEVAR o nível. Por isso a bandeira é de mão
 * única no contexto de execução: existe marcar, não existe desmarcar.
 *
 * A JANELA E O TETO SÃO CONTA EMPRESTADA, e não repetida: `foraDaJanela` e
 * `acimaDoTeto` moram em `limites.ts`, que é puro, e o simulador da tela da
 * Régua chama as MESMAS funções. Uma segunda cópia aqui faria a tela ensinar
 * uma janela e a porta impor outra — que é o defeito que a fatia 2.3 existe
 * para não criar. (Eles já moraram em `simulador.ts`: o caminho quente da porta
 * não tem por que depender de um módulo com esse nome para comparar relógio.)
 *
 * JANELA ILEGÍVEL ACENDE O SINAL — E AGORA AVISA. `foraDaJanela` falha fechada:
 * um `['8h', 'oito']` em `limitesPadrao.janelaHoraria` acende `fora_da_janela`
 * em TODA ação desta empresa, e subir um degrau em tudo é mudança grande demais
 * para acontecer calada. `conferirJanela` grita UMA vez por empresa — não a
 * cada chamada, que afogaria o log —, e `problemasDeJanela` recusa o documento
 * lá atrás, na sobrescrita, que é onde o defeito nasce.
 */
@Injectable()
export class SinaisService {
  private readonly log = new Logger('SinaisService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  async calcular(input: {
    orgId: string;
    capabilityId: string;
    agentSlug?: string | null;
    valorCentavos?: number | null;
    procedenciaExterna?: boolean;
    agora?: Date;
  }): Promise<Sinal[]> {
    const agora = input.agora ?? new Date();
    const sinais: Sinal[] = [];
    const limites = this.policy.limites(input.orgId);

    if (input.procedenciaExterna) sinais.push('fonte_nao_confiavel');

    conferirJanela(input.orgId, limites.janelaHoraria, (m) => this.log.error(m));
    const minutos = agora.getHours() * 60 + agora.getMinutes();
    if (foraDaJanela(minutos, limites.janelaHoraria)) sinais.push('fora_da_janela');

    if (acimaDoTeto(input.valorCentavos, limites.tetoCustoCentavosPorExecucao)) {
      sinais.push('valor_acima_do_limite');
    }

    const [naUltimaHora, mediaHora, errosRecentes] = await Promise.all([
      this.prisma.toolCall.count({
        where: {
          orgId: input.orgId,
          capabilityId: input.capabilityId,
          criadoEm: { gte: new Date(agora.getTime() - 3_600_000) },
        },
      }),
      this.mediaPorHora(input.orgId, input.capabilityId, agora),
      input.agentSlug
        ? this.prisma.toolCall.count({
            where: {
              orgId: input.orgId,
              agentSlug: input.agentSlug,
              status: { in: ['erro', 'recusado'] },
              criadoEm: { gte: new Date(agora.getTime() - 86_400_000) },
            },
          })
        : Promise.resolve(0),
    ]);

    // Só acusa volume atípico quando já existe média para comparar — senão o
    // primeiro uso de uma capacidade sempre seria "atípico".
    if (mediaHora > 0 && naUltimaHora > mediaHora * 3) sinais.push('volume_atipico');
    if (errosRecentes > 0) sinais.push('erro_recente');

    return sinais;
  }

  /** Média de chamadas por hora nos últimos 30 dias. */
  private async mediaPorHora(orgId: string, capabilityId: string, agora: Date): Promise<number> {
    const desde = new Date(agora.getTime() - 30 * 86_400_000);
    const total = await this.prisma.toolCall.count({
      where: { orgId, capabilityId, criadoEm: { gte: desde } },
    });
    return total / (30 * 24);
  }
}
