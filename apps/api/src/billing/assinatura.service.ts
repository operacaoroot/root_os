import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ActorType, RiskLevel } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { CofreService } from '../cofre/cofre.service';
import { EventLogService } from '../gateway/event-log.service';
import { contextoAtual, exigirTenant } from '../common/contexto-execucao';
import {
  JANELA_DO_TETO_MS,
  TETO_DE_CONFERENCIAS,
  type EstadoDeAssinatura,
  acessoBloqueado,
  cabeConferencia,
  decidirTransicao,
  ehEstadoDeAssinatura,
} from './assinatura';
import {
  CobrancaAsaasService,
  SemCredencialDeCobranca,
  type CobrancaLida,
} from './cobranca-asaas.service';

/*
 * ============================================================================
 * A ASSINATURA DE UMA EMPRESA — RF-O-03
 * ============================================================================
 *
 * Guarda o plano, espelha as cobranças do provedor e move o estado de acesso.
 * A DECISÃO de mover mora em `assinatura.ts`, pura e sem banco; aqui mora o que
 * ela custa: ler, gravar e registrar.
 *
 * ----------------------------------------------------------------------------
 * O QUE ESTE SERVIÇO NÃO FAZ, e é a fatia inteira
 * ----------------------------------------------------------------------------
 * `delete`, `deleteMany`, `updateMany` sem `orgId`, `Org.modulos = []`,
 * `Org.isActive = false`, `cofre.revogar` — nada disso aparece neste arquivo,
 * nem deve aparecer. Suspender é gravar `'suspensa'` numa coluna. Se um dia
 * alguém precisar "limpar" algo ao suspender, a resposta é não: o que faz
 * "voltar a pagar restaura o acesso sem nenhuma perda" ser verdade é justamente
 * não ter havido perda.
 *
 * ----------------------------------------------------------------------------
 * IDEMPOTÊNCIA — "e se alguém rodar duas vezes?"
 * ----------------------------------------------------------------------------
 * Em três camadas, e nenhuma delas depende de ninguém lembrar:
 *
 *  1. O ESPELHO grava por `upsert` em (`orgId`, `referencia`), que é índice
 *     único no banco. Duas conferências simultâneas atualizam a mesma linha.
 *  2. A DECISÃO devolve `{ muda: false }` quando o destino é o estado atual —
 *     então a segunda rodada não escreve, não registra evento e não move
 *     `suspensaEm` para frente.
 *  3. A TRANSIÇÃO grava com `updateMany` condicionado ao estado de origem
 *     (`where: { id, status: de }`). Duas rodadas que decidam ao mesmo tempo:
 *     a primeira atualiza uma linha, a segunda atualiza ZERO, e a segunda sabe
 *     que perdeu — em vez de sobrescrever o que a primeira acabou de fazer.
 */

/** O retrato que a tela recebe. Sem nada do provedor além de endereço. */
export interface RetratoDaAssinatura {
  existe: boolean;
  status: EstadoDeAssinatura | null;
  bloqueado: boolean;
  plano: string | null;
  valorCentavos: number | null;
  ciclo: string | null;
  diasDeCarencia: number | null;
  suspensaEm: string | null;
  motivoDaSuspensao: string | null;
  reativadaEm: string | null;
  /** Cobranças vencidas até aqui foram perdoadas por reativação explícita. */
  perdoadasAte: string | null;
  /**
   * Há endereço da assinatura NO PROVEDOR? Nunca o valor.
   *
   * Booleano e não o identificador: a tela precisa saber se dá para conferir, e
   * o identificador só serviria para ser copiado para algum lugar onde ninguém
   * vigia. É a mesma escolha de `credencialGuardada`, um grau abaixo em
   * sensibilidade.
   */
  ligadaAoProvedor: boolean;
  conferidaEm: string | null;
  /** Há credencial de cobrança no cofre? NUNCA o valor — ver `RF-C-02`. */
  credencialGuardada: boolean;
  cobrancas: Array<{
    referencia: string;
    status: string;
    valorCentavos: number;
    vencimento: string;
    pagoEm: string | null;
  }>;
}

/**
 * POR QUE A CONFERÊNCIA NÃO DECIDIU — em código, não em frase.
 *
 * A tela traduzia QUALQUER `leituraCompleta: false` como "não consegui falar com
 * o provedor". Duas das quatro causas não têm nada a ver com comunicação: "esta
 * empresa não tem assinatura" e "a assinatura não está ligada a nenhuma
 * assinatura no provedor" — e hoje, com ZERO empresas tendo linha de assinatura,
 * uma dessas duas é a resposta de CEM POR CENTO dos cliques. A tela mentia sobre
 * a causa no único estado que existe.
 *
 * Um código por causa é o que permite a tela dizer a verdade sem ler frase em
 * português — o mesmo contrato de `CODIGO_ASSINATURA_SUSPENSA`.
 */
export type PorqueDaConferencia =
  | 'ok'
  | 'sem_assinatura'
  | 'sem_endereco_no_provedor'
  | 'sem_credencial'
  | 'provedor_indisponivel';

export interface ResultadoDaConferencia {
  conferida: boolean;
  leituraCompleta: boolean;
  espelhadas: number;
  de: EstadoDeAssinatura | null;
  para: EstadoDeAssinatura | null;
  porque: PorqueDaConferencia;
  motivo: string;
}

@Injectable()
export class AssinaturaService {
  private readonly log = new Logger('Assinatura');

  constructor(
    private readonly prisma: PrismaService,
    private readonly provedor: CobrancaAsaasService,
    private readonly cofre: CofreService,
    private readonly eventos: EventLogService,
  ) {}

  // ------------------------------------------------------------------ leitura

  /**
   * O estado de acesso desta empresa. É o que o gate pergunta em toda requisição.
   *
   * Devolve `null` quando não há assinatura, e `null` NÃO BLOQUEIA (ver
   * `acessoBloqueado`). Uma consulta por chave primária indexada; o gate guarda
   * a resposta por poucos segundos (ver `suspensao.interceptor.ts`).
   */
  async estadoDeAcesso(orgId: string): Promise<EstadoDeAssinatura | null> {
    const id = exigirTenant(orgId, 'AssinaturaService.estadoDeAcesso');
    const linha = await this.prisma.assinatura.findUnique({
      where: { orgId: id },
      select: { status: true },
    });
    if (!linha) return null;
    if (!ehEstadoDeAssinatura(linha.status)) {
      /*
       * O CHECK do banco impede isto. Chegar aqui significa que alguém escreveu
       * por fora, com o CHECK removido — e nesse caso a resposta segura é LIBERAR
       * com grito, não trancar: um valor que não sabemos ler não é prova de
       * inadimplência de ninguém.
       */
      this.log.error(`[assinatura] estado ilegível na empresa ${id}: ${linha.status} — acesso LIBERADO`);
      return null;
    }
    return linha.status;
  }

  /** O retrato completo, para a tela. */
  async retrato(orgId: string): Promise<RetratoDaAssinatura> {
    const id = exigirTenant(orgId, 'AssinaturaService.retrato');

    const linha = await this.prisma.assinatura.findUnique({ where: { orgId: id } });
    const credencialGuardada = await this.temCredencial(id);

    if (!linha) {
      return {
        existe: false,
        status: null,
        bloqueado: false,
        plano: null,
        valorCentavos: null,
        ciclo: null,
        diasDeCarencia: null,
        suspensaEm: null,
        motivoDaSuspensao: null,
        reativadaEm: null,
        perdoadasAte: null,
        ligadaAoProvedor: false,
        conferidaEm: null,
        credencialGuardada,
        cobrancas: [],
      };
    }

    const cobrancas = await this.prisma.cobrancaDeAssinatura.findMany({
      where: { orgId: id, assinaturaId: linha.id },
      orderBy: { vencimento: 'desc' },
      take: 24,
      select: {
        referencia: true,
        status: true,
        valorCentavos: true,
        vencimento: true,
        pagoEm: true,
      },
    });

    const status = ehEstadoDeAssinatura(linha.status) ? linha.status : null;
    return {
      existe: true,
      status,
      bloqueado: acessoBloqueado(status),
      plano: linha.plano,
      valorCentavos: linha.valorCentavos,
      ciclo: linha.ciclo,
      diasDeCarencia: linha.diasDeCarencia,
      suspensaEm: linha.suspensaEm?.toISOString() ?? null,
      motivoDaSuspensao: linha.motivoDaSuspensao,
      reativadaEm: linha.reativadaEm?.toISOString() ?? null,
      perdoadasAte: linha.perdoadasAte?.toISOString() ?? null,
      ligadaAoProvedor: !!linha.provedorAssinaturaId,
      conferidaEm: linha.conferidaEm?.toISOString() ?? null,
      credencialGuardada,
      cobrancas: cobrancas.map((c) => ({
        referencia: c.referencia,
        status: c.status,
        valorCentavos: c.valorCentavos,
        vencimento: c.vencimento.toISOString(),
        pagoEm: c.pagoEm?.toISOString() ?? null,
      })),
    };
  }

  /**
   * Há credencial de cobrança guardada? A pergunta que a tela faz.
   *
   * Passa pelo `estado` do cofre, que devolve a MARCA no lugar do valor — não
   * há caminho daqui para a string. E o `catch` existe porque "não consegui
   * perguntar ao cofre" não pode virar erro na tela de quem só queria ver a
   * fatura.
   */
  private async temCredencial(orgId: string): Promise<boolean> {
    try {
      const estado = await this.cofre.estado(orgId);
      return estado.items.some(
        (i) =>
          i.conector === CobrancaAsaasService.CONECTOR &&
          i.nome === CobrancaAsaasService.NOME_DA_CHAVE &&
          i.revogadoEm === null,
      );
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------ escrita

  /**
   * Cria ou atualiza a assinatura da empresa. NÃO muda o estado de acesso.
   *
   * Separado de `conferir` de propósito: mudar o plano de uma empresa suspensa
   * não pode reativá-la por efeito colateral, e mudar o plano de uma ativa não
   * pode suspendê-la. Quem move acesso é a conferência (automática, com prova) e
   * `reativar`/`suspender` (explícitos, com ator).
   */
  async definir(
    orgId: string,
    entrada: {
      plano: string;
      valorCentavos: number;
      ciclo?: string;
      diasDeCarencia?: number;
      provedorClienteId?: string | null;
      provedorAssinaturaId?: string | null;
    },
  ): Promise<RetratoDaAssinatura> {
    const id = exigirTenant(orgId, 'AssinaturaService.definir');
    const plano = entrada.plano?.trim();
    if (!plano) throw new BadRequestException('plano é obrigatório');
    if (!Number.isInteger(entrada.valorCentavos) || entrada.valorCentavos < 0) {
      throw new BadRequestException('valorCentavos precisa ser inteiro não negativo (em centavos)');
    }
    const ciclo = entrada.ciclo ?? 'mensal';
    if (ciclo !== 'mensal' && ciclo !== 'anual') {
      throw new BadRequestException('ciclo precisa ser "mensal" ou "anual"');
    }
    const carencia = entrada.diasDeCarencia ?? 7;
    if (!Number.isInteger(carencia) || carencia < 0 || carencia > 365) {
      throw new BadRequestException('diasDeCarencia precisa ser inteiro entre 0 e 365');
    }

    const antes = await this.prisma.assinatura.findUnique({ where: { orgId: id } });

    await this.prisma.assinatura.upsert({
      where: { orgId: id },
      create: {
        orgId: id,
        plano,
        valorCentavos: entrada.valorCentavos,
        ciclo,
        diasDeCarencia: carencia,
        provedorClienteId: entrada.provedorClienteId ?? null,
        provedorAssinaturaId: entrada.provedorAssinaturaId ?? null,
      },
      update: {
        plano,
        valorCentavos: entrada.valorCentavos,
        ciclo,
        diasDeCarencia: carencia,
        // `undefined` preserva: quem não mandou o endereço não o apaga.
        provedorClienteId: entrada.provedorClienteId ?? undefined,
        provedorAssinaturaId: entrada.provedorAssinaturaId ?? undefined,
      },
    });

    await this.registrar(id, 'assinatura.definida', RiskLevel.R2, {
      argumentos: { plano, valorCentavos: entrada.valorCentavos, ciclo, diasDeCarencia: carencia },
      estadoAnterior: antes
        ? { existia: true, plano: antes.plano, valorCentavos: antes.valorCentavos, status: antes.status }
        : { existia: false },
      estadoNovo: { existia: true, plano, valorCentavos: entrada.valorCentavos },
      motivo: antes ? 'plano alterado' : 'assinatura criada',
      fontes: [{ tipo: 'decisao-humana', rota: 'PUT /assinatura' }],
      resultado: { plano, valorCentavos: entrada.valorCentavos, ciclo, diasDeCarencia: carencia },
      desfazer: 'assinatura.definir com os valores anteriores',
      // `custo` é palavra da política também em R2. Ver a nota longa em
      // `aplicarTransicao`: dinheiro não passa por aqui, e o que se registra é a
      // verdade — registrar plano não chama modelo nenhum.
      custo: { modeloUsd: 0, apuracaoDeGasto: 'nenhuma: registrar plano não consome modelo' },
    });

    return this.retrato(id);
  }

  /**
   * Guarda a chave do provedor NO COFRE. O valor não volta, não é logado e não
   * é devolvido.
   *
   * O parâmetro `chave` é a única vez em que o valor cru aparece neste módulo, e
   * ele vai direto para `cofre.guardar` — que cifra com AES-256-GCM amarrado a
   * (empresa, conector, nome) e devolve só `{ id, versao }`.
   */
  async guardarCredencial(orgId: string, chave: string, actorId?: string | null): Promise<{ versao: number }> {
    const id = exigirTenant(orgId, 'AssinaturaService.guardarCredencial');
    const valor = chave?.trim();
    if (!valor) {
      // Vazio é o que a REVOGAÇÃO grava; deixar passar criaria linha viva e
      // ilegível. A mensagem não repete o que veio, nem truncado.
      throw new BadRequestException('a chave do provedor não pode ser vazia');
    }
    const { versao } = await this.cofre.guardar({
      orgId: id,
      conector: CobrancaAsaasService.CONECTOR,
      nome: CobrancaAsaasService.NOME_DA_CHAVE,
      valor,
      origem: 'assinatura:painel',
      actorId: actorId ?? null,
    });
    // O cofre já registra `cofre.segredo.guardado` no RASTRO. Um segundo evento
    // aqui contaria o mesmo fato duas vezes.
    return { versao };
  }

  // -------------------------------------------------------------- conferência

  /**
   * Pergunta ao provedor, espelha o que veio e move o estado se houver prova.
   *
   * É o ÚNICO caminho automático de suspensão. Todas as recusas que ele pode
   * devolver são "não mudou nada", nunca "suspendeu por precaução":
   *
   *   · sem assinatura .......... nada a conferir;
   *   · sem endereço no provedor  nada a perguntar;
   *   · leitura incompleta ...... "não sei" — e não sei não muda acesso;
   *   · leitura vazia ........... nenhuma cobrança vencida, logo nada a suspender.
   *
   * O ESPELHO ACONTECE MESMO NA LEITURA INCOMPLETA, e é seguro: `upsert` só
   * acrescenta e atualiza, nunca apaga. O que a leitura incompleta impede é a
   * DECISÃO, que é a parte que muda acesso.
   */
  async conferir(orgId: string, agora = new Date()): Promise<ResultadoDaConferencia> {
    const id = exigirTenant(orgId, 'AssinaturaService.conferir');
    this.exigirTeto(id, agora);

    const assinatura = await this.prisma.assinatura.findUnique({ where: { orgId: id } });
    if (!assinatura) {
      return {
        conferida: false,
        leituraCompleta: false,
        espelhadas: 0,
        de: null,
        para: null,
        porque: 'sem_assinatura',
        motivo: 'esta empresa não tem assinatura: nada a conferir e nada a suspender.',
      };
    }
    if (!assinatura.provedorAssinaturaId) {
      return {
        conferida: false,
        leituraCompleta: false,
        espelhadas: 0,
        de: ehEstadoDeAssinatura(assinatura.status) ? assinatura.status : null,
        para: null,
        porque: 'sem_endereco_no_provedor',
        motivo:
          'a assinatura não está ligada a nenhuma assinatura no provedor: não há o que perguntar. ' +
          'Enquanto estiver assim, ninguém é suspenso por ela.',
      };
    }

    /*
     * "NÃO HÁ CREDENCIAL" É RESPOSTA, NÃO ERRO DE SERVIDOR.
     *
     * O conector LANÇA `SemCredencialDeCobranca` de propósito — falta de chave é
     * conserto de gente, não intermitência de rede, e engolir as duas do mesmo
     * jeito esconderia a única que alguém pode resolver. Mas deixar a exceção
     * subir daqui transformava o botão "já paguei" em 500 para toda empresa que
     * ainda não guardou a chave no cofre, que é TODA a carteira hoje.
     *
     * Ela também é o desfecho de uma REVOGAÇÃO no meio da paginação: o cofre
     * recusa emprestar para a página seguinte, e a leitura fica incompleta —
     * que é o que se quer, porque leitura incompleta não muda acesso de ninguém.
     */
    let leitura;
    try {
      leitura = await this.provedor.cobrancasDaAssinatura(id, assinatura.provedorAssinaturaId);
    } catch (erro) {
      if (!(erro instanceof SemCredencialDeCobranca)) throw erro;
      this.log.warn(`[assinatura] empresa ${id} sem credencial de cobrança no cofre: nada foi conferido.`);
      return {
        conferida: false,
        leituraCompleta: false,
        espelhadas: 0,
        de: ehEstadoDeAssinatura(assinatura.status) ? assinatura.status : null,
        para: null,
        porque: 'sem_credencial',
        motivo:
          'não há credencial de cobrança guardada no cofre desta empresa (ou ela foi revogada): ' +
          'sem ela não dá para perguntar ao provedor. Enquanto estiver assim, ninguém é suspenso.',
      };
    }

    const idLocalPorReferencia = await this.espelhar(id, assinatura.id, leitura.cobrancas);

    if (leitura.completa) {
      // Só a leitura completa move o carimbo: `conferidaEm` significa "a última
      // vez que soubemos de verdade", e não "a última vez que tentamos".
      await this.prisma.assinatura.update({
        where: { id: assinatura.id },
        data: { conferidaEm: agora },
      });
    }

    const estadoAtual = ehEstadoDeAssinatura(assinatura.status) ? assinatura.status : 'ativa';

    /*
     * ============================================================================
     * A DECISÃO RODA SOBRE A LEITURA CORRENTE — nunca sobre o espelho inteiro
     * ============================================================================
     *
     * Esta era a falha grave da primeira escrita, e ela foi reproduzida contra o
     * banco: aqui havia um `findMany` das cobranças da empresa, e a decisão via
     * TODAS as linhas já espelhadas — não as que o provedor acabou de confirmar.
     *
     * Como o espelho NUNCA APAGA (de propósito: é o histórico de pagamento do
     * cliente, e uma resposta ruim do provedor não pode apagá-lo), uma cobrança
     * vencida espelhada uma única vez decidia acesso PARA SEMPRE. O desfecho
     * medido: o provedor para de mencionar a cobrança e devolve lista vazia com
     * leitura COMPLETA — e a empresa era suspensa assim mesmo, no cenário que o
     * cabeçalho de `assinatura.ts` declara impossível.
     *
     * Agora a decisão recebe `leitura.cobrancas` — e só elas. O que o espelho
     * acrescenta é o ID LOCAL de cada uma, porque é ele que vai para
     * `suspensaPorCobrancaId`: gravar ali a referência do provedor deixaria a
     * coluna apontando para fora do banco, uma chave estrangeira que não é uma.
     *
     * A linha que sumiu da resposta do provedor continua no banco, continua na
     * tela e continua no histórico. Ela só não decide mais nada sozinha.
     */
    const daLeitura = leitura.cobrancas.map((c) => ({
      id: idLocalPorReferencia.get(c.referencia) ?? c.referencia,
      referencia: c.referencia,
      status: c.status as CobrancaLida['status'],
      vencimento: c.vencimento,
    }));

    const transicao = decidirTransicao(
      {
        status: estadoAtual,
        diasDeCarencia: assinatura.diasDeCarencia,
        perdoadasAte: assinatura.perdoadasAte,
      },
      { completa: leitura.completa, cobrancas: daLeitura },
      agora,
    );

    const porque: PorqueDaConferencia = leitura.completa ? 'ok' : 'provedor_indisponivel';

    if (!transicao.muda) {
      return {
        conferida: leitura.completa,
        leituraCompleta: leitura.completa,
        espelhadas: idLocalPorReferencia.size,
        de: estadoAtual,
        para: null,
        porque,
        motivo: transicao.motivo,
      };
    }

    const aplicou = await this.aplicarTransicao(id, assinatura.id, transicao, agora, {
      automatica: true,
      chamadas: daLeitura.length,
    });

    return {
      conferida: leitura.completa,
      leituraCompleta: leitura.completa,
      espelhadas: idLocalPorReferencia.size,
      de: transicao.de,
      para: aplicou ? transicao.para : null,
      porque,
      motivo: aplicou
        ? transicao.motivo
        : `${transicao.motivo} — mas outra conferência chegou primeiro; nada foi reescrito.`,
    };
  }

  // ------------------------------------------------------------------- teto

  /**
   * Os carimbos de conferência por empresa. Memória do PROCESSO, de propósito.
   *
   * Ver o bloco do teto em `assinatura.ts`: o que ele protege é o provedor e o
   * cofre, e uma tabela nova para contar cliques seria escrita de banco no
   * caminho quente. Numa segunda réplica cada processo tem o seu teto — o que
   * dobra o limite e continua sendo teto, que é o ponto.
   */
  private readonly conferenciasPorEmpresa = new Map<string, number[]>();

  private exigirTeto(orgId: string, agora: Date): void {
    const r = cabeConferencia(this.conferenciasPorEmpresa.get(orgId) ?? [], agora.getTime());
    this.conferenciasPorEmpresa.set(orgId, r.carimbos);
    if (r.cabe) return;
    this.log.warn(
      `[assinatura] teto de conferências da empresa ${orgId} atingido ` +
        `(${TETO_DE_CONFERENCIAS} por ${JANELA_DO_TETO_MS / 60_000} min). Nada foi perguntado ao provedor.`,
    );
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'teto_de_conferencias',
        message:
          `Já conferimos com o provedor ${TETO_DE_CONFERENCIAS} vezes na última hora. ` +
          'Nada mudou no seu acesso por causa disto — tente de novo mais tarde.',
        liberaEm: r.liberaEm?.toISOString() ?? null,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /**
   * Grava o que veio do provedor. `upsert` por (empresa, referência).
   *
   * NÃO APAGA O QUE NÃO VEIO. Uma cobrança que sumiu da resposta do provedor —
   * por filtro, por paginação, por defeito dele — continua aqui. É a diferença
   * entre um espelho e uma sincronização destrutiva, e é ela que impede que uma
   * resposta ruim do provedor apague o histórico de pagamento do cliente.
   *
   * DEVOLVE O MAPA `referência do provedor → id local`, e não uma contagem. É a
   * outra metade da correção do defeito grave: quem decide precisa das linhas da
   * LEITURA CORRENTE com o id do banco, e a única forma de ter as duas coisas
   * sem reler a tabela inteira — que era exatamente o que fazia o espelho velho
   * decidir acesso — é o espelho entregar a correspondência que ele acabou de
   * escrever.
   */
  private async espelhar(
    orgId: string,
    assinaturaId: string,
    cobrancas: readonly CobrancaLida[],
  ): Promise<Map<string, string>> {
    const idPorReferencia = new Map<string, string>();
    for (const c of cobrancas) {
      const linha = await this.prisma.cobrancaDeAssinatura.upsert({
        where: { orgId_referencia: { orgId, referencia: c.referencia } },
        create: {
          orgId,
          assinaturaId,
          referencia: c.referencia,
          valorCentavos: c.valorCentavos,
          vencimento: c.vencimento,
          status: c.status,
          pagoEm: c.pagoEm,
        },
        update: {
          valorCentavos: c.valorCentavos,
          vencimento: c.vencimento,
          status: c.status,
          pagoEm: c.pagoEm,
          sincronizadaEm: new Date(),
        },
        select: { id: true },
      });
      idPorReferencia.set(c.referencia, linha.id);
    }
    return idPorReferencia;
  }

  /**
   * Move o estado, e só o estado.
   *
   * `updateMany` com `status` de ORIGEM no `where` é o que torna a escrita
   * segura sob concorrência sem transação serializável: quem perde a corrida
   * atualiza zero linhas e devolve `false`, em vez de sobrescrever a decisão de
   * quem chegou primeiro.
   *
   * `suspensaEm` só é escrita ao ENTRAR em `suspensa`; `reativadaEm` só ao SAIR
   * dela. Nenhuma das duas é limpa — ver a nota no `schema.prisma`: elas são a
   * prova de que houve suspensão, e apagar prova é o que esta fatia inteira
   * existe para não fazer.
   */
  private async aplicarTransicao(
    orgId: string,
    assinaturaId: string,
    transicao: { de: EstadoDeAssinatura; para: EstadoDeAssinatura; cobrancaId: string | null; motivo: string },
    agora: Date,
    ctx: { automatica: boolean; actorId?: string | null; chamadas?: number },
  ): Promise<boolean> {
    const entrandoEmSuspensao = transicao.para === 'suspensa';
    const saindoDeBloqueio = acessoBloqueado(transicao.de) && !acessoBloqueado(transicao.para);

    /*
     * A MARCA DA REATIVAÇÃO EXPLÍCITA — só na transição MANUAL que desbloqueia.
     *
     * `perdoadasAte` é o que impede a conferência seguinte de desfazer o que uma
     * pessoa acabou de decidir (ver `AssinaturaParaDecisao.perdoadasAte`). Ela é
     * escrita SÓ aqui, e só quando as duas coisas valem:
     *
     *  · a transição é MANUAL — `reativar`, com ator e motivo. Numa reativação
     *    automática não há nada a perdoar: ela só acontece quando a leitura
     *    corrente não tem cobrança vencida nenhuma. Escrever a marca ali
     *    perdoaria, de lambuja, toda cobrança com vencimento no passado que o
     *    provedor ainda não tivesse marcado como vencida — e essas viram vencidas
     *    depois, com data anterior à marca. Seria uma isenção silenciosa;
     *  · ela SAI DE UM BLOQUEIO. Reativar quem já estava ativo não é decisão
     *    sobre dívida nenhuma, e `reativar` devolve cedo nesse caso.
     */
    const perdoando = saindoDeBloqueio && !ctx.automatica;

    const r = await this.prisma.assinatura.updateMany({
      where: { id: assinaturaId, orgId, status: transicao.de },
      data: {
        status: transicao.para,
        ...(entrandoEmSuspensao
          ? {
              suspensaEm: agora,
              suspensaPorCobrancaId: transicao.cobrancaId,
              motivoDaSuspensao: transicao.motivo.slice(0, 500),
            }
          : {}),
        ...(saindoDeBloqueio ? { reativadaEm: agora } : {}),
        ...(perdoando ? { perdoadasAte: agora } : {}),
      },
    });
    if (r.count === 0) return false;

    /*
     * O NÍVEL É R4, e a escolha tem consequência: R4 é "muda estado de sistema",
     * e a política cobra da linha `motivo`, `estadoAnterior` e `estadoNovo` (ver
     * `ConteudoDoEvento`). Suspender é exatamente isso — muda o que a empresa
     * alcança —, e classificar como R2 ("ação com desfazer") deixaria a linha
     * sem a cobrança dos três campos que quem audita precisa ler.
     *
     * A SENSIBILIDADE É `interna`, e não `confidencial`. `confidencial` faz o
     * conteúdo cru virar resumo criptográfico mais referência — ou seja,
     * apagaria da linha justamente o MOTIVO pelo qual o acesso de uma empresa
     * foi cortado. Um RASTRO que não sabe dizer por que o cliente ficou fora não
     * serve para a única pergunta que vai ser feita. E não há dado de pessoa
     * aqui: o conteúdo é estado comercial da própria empresa dona do rastro.
     */
    await this.registrar(
      orgId,
      entrandoEmSuspensao ? 'assinatura.suspensa' : `assinatura.${transicao.para}`,
      RiskLevel.R4,
      {
        motivo: transicao.motivo,
        estadoAnterior: { status: transicao.de },
        estadoNovo: { status: transicao.para },
        argumentos: {
          automatica: ctx.automatica,
          cobrancaId: transicao.cobrancaId,
          perdoaCobrancasAte: perdoando ? agora.toISOString() : null,
        },
        /*
         * `custo` É PALAVRA DA POLÍTICA (`niveis.R4.rastro`), e ela FALTAVA.
         *
         * A linha era gravada incompleta e o registrador gritava no log a cada
         * suspensão — e gritava com razão, porque este é um campo que quem
         * escreve SABE preencher. Os que continuam ausentes têm dono declarado e
         * não são desta linha: `agente` (não há agente — quem decide é uma regra
         * ou uma pessoa), `ferramenta` (a leitura do provedor não é capacidade do
         * catálogo — ver a exceção declarada em `test/arquitetura.test.ts`),
         * `hashConteudo` e `aprovador`/`aprovadoEm` na transição automática (não
         * houve aprovação: escrever ali seria registrar gente onde não houve).
         *
         * O formato segue o da porta (`custoAteAqui`, em `tool-gateway`):
         * DINHEIRO NÃO PASSA POR AQUI. Suspender não chama modelo nenhum, e
         * inventar centavos plantaria no RASTRO um número que ninguém apurou. O
         * que esta decisão custou, de verdade, são as cobranças que a
         * sustentaram.
         */
        custo: {
          modeloUsd: 0,
          cobrancasConsideradas: ctx.chamadas ?? 0,
          apuracaoDeGasto: 'nenhuma: mudar estado de assinatura não consome modelo',
        },
        /*
         * A PROCEDÊNCIA DA DECISÃO. Numa transição automática, a fonte é a
         * leitura do provedor e a cobrança que a sustenta; numa manual, é a
         * pessoa. Quem audita precisa saber qual das duas foi, e sem este campo
         * as duas ficam com a mesma cara.
         */
        fontes: ctx.automatica
          ? [{ tipo: 'provedor-de-cobranca', cobrancaId: transicao.cobrancaId }]
          : [{ tipo: 'decisao-humana', actorId: ctx.actorId ?? null }],
        /*
         * `aprovador`/`aprovadoEm` SÓ NA TRANSIÇÃO MANUAL, e a distinção é a
         * mesma que o RASTRO faz entre linha de intenção e linha de desfecho: o
         * que não aconteceu não consta. Uma suspensão por inadimplência não teve
         * aprovador nenhum — ela saiu de uma regra e de uma cobrança vencida —, e
         * preencher o campo com o operador que rodou a conferência escreveria no
         * RASTRO que houve gente decidindo onde não houve.
         */
        ...(ctx.automatica
          ? {}
          : { aprovador: ctx.actorId ?? null, aprovadoEm: agora }),
        resultado: {
          bloqueadoAntes: acessoBloqueado(transicao.de),
          bloqueadoDepois: acessoBloqueado(transicao.para),
          perdoadasAte: perdoando ? agora.toISOString() : null,
          /*
           * A frase existe para quem for ler o RASTRO daqui a um ano e precisar
           * saber o que a suspensão fez com o dado do cliente. A resposta é
           * nada, e ela fica escrita na própria prova.
           */
          dadoDoTenant: 'intacto: suspensão muda status, não apaga registro',
        },
        desfazer: entrandoEmSuspensao ? 'assinatura.reativar' : null,
      },
      ctx.actorId ?? null,
    );

    return true;
  }

  /**
   * Reativa por ato explícito de gente (o operador da plataforma, a tela).
   *
   * Existe além da conferência porque a conferência depende do provedor, e há
   * casos legítimos em que ele não vai dizer o que aconteceu: pagamento por fora
   * (PIX direto, boleto de outra conta), acordo comercial, suspensão indevida
   * que precisa ser desfeita AGORA. Sem esta porta, desfazer um engano
   * dependeria de convencer um sistema de terceiro.
   *
   * ----------------------------------------------------------------------------
   * ELA DEIXA MARCA, E É A MARCA QUE FAZ A REATIVAÇÃO DURAR
   * ----------------------------------------------------------------------------
   * Nos três casos acima o provedor CONTINUA dizendo vencido — o dinheiro não
   * passou por ele, ou a dívida foi perdoada fora dele. A primeira escrita desta
   * fatia parava aqui, e o desfecho foi medido: conferir suspende, reativar
   * ativa, conferir um segundo depois suspende de novo. A reativação durava até
   * o próximo clique.
   *
   * Por isso `aplicarTransicao` grava `perdoadasAte = agora` nesta transição (e
   * só nesta), e `decidirTransicao` ignora toda cobrança vencida até ali. A
   * fatura seguinte vence DEPOIS da marca e volta a suspender normalmente: o
   * perdão é do que já estava vencido, não do contrato.
   *
   * Devolve o retrato depois — porque é isso que a tela precisa mostrar, e
   * porque olhar o retrato é a forma mais direta de confirmar que nada sumiu.
   */
  async reativar(
    orgId: string,
    motivo: string,
    actorId?: string | null,
    agora = new Date(),
  ): Promise<RetratoDaAssinatura> {
    const id = exigirTenant(orgId, 'AssinaturaService.reativar');
    const assinatura = await this.prisma.assinatura.findUnique({ where: { orgId: id } });
    if (!assinatura) throw new BadRequestException('esta empresa não tem assinatura');

    const de = ehEstadoDeAssinatura(assinatura.status) ? assinatura.status : 'ativa';
    if (!acessoBloqueado(de)) {
      // Já está com acesso. Idempotente e silencioso: não registra evento de uma
      // mudança que não houve.
      return this.retrato(id);
    }

    await this.aplicarTransicao(
      id,
      assinatura.id,
      {
        de,
        para: 'ativa',
        cobrancaId: null,
        motivo: motivo?.trim() ? `reativada por decisão: ${motivo.trim().slice(0, 300)}` : 'reativada por decisão',
      },
      agora,
      { automatica: false, actorId },
    );

    return this.retrato(id);
  }

  /**
   * Suspende por ato explícito. Existe pelo mesmo motivo de `reativar`, na outra
   * direção: fraude, pedido do cliente, decisão comercial.
   *
   * NÃO É O CAMINHO DA INADIMPLÊNCIA — aquele é `conferir`, que exige prova. Este
   * exige um ATOR e um MOTIVO, e é por isso que os dois são obrigatórios aqui:
   * uma suspensão sem dono e sem razão é indistinguível de um acidente.
   */
  async suspender(
    orgId: string,
    motivo: string,
    actorId: string,
    agora = new Date(),
  ): Promise<RetratoDaAssinatura> {
    const id = exigirTenant(orgId, 'AssinaturaService.suspender');
    const texto = motivo?.trim();
    if (!texto) throw new BadRequestException('motivo é obrigatório para suspender');
    if (!actorId?.trim()) throw new BadRequestException('suspensão manual precisa de ator');

    const assinatura = await this.prisma.assinatura.findUnique({ where: { orgId: id } });
    if (!assinatura) throw new BadRequestException('esta empresa não tem assinatura');

    const de = ehEstadoDeAssinatura(assinatura.status) ? assinatura.status : 'ativa';
    if (de === 'suspensa') return this.retrato(id);

    await this.aplicarTransicao(
      id,
      assinatura.id,
      { de, para: 'suspensa', cobrancaId: null, motivo: `suspensão manual: ${texto.slice(0, 300)}` },
      agora,
      { automatica: false, actorId },
    );

    return this.retrato(id);
  }

  // ------------------------------------------------------------------- rastro

  /**
   * Uma linha no RASTRO. O `catch` é a regra da casa: registro nunca derruba a
   * operação (o contrário faria uma falha de escrita do rastro impedir uma
   * reativação legítima, o que é pior do que perder a linha).
   */
  private async registrar(
    orgId: string,
    tipo: string,
    nivel: RiskLevel,
    conteudo: Record<string, unknown>,
    actorId: string | null = null,
  ): Promise<void> {
    const ctx = contextoAtual();
    try {
      await this.eventos.registrar({
        orgId,
        tipo,
        nivel,
        actorType: ctx?.actorType ?? ActorType.system,
        actorId: actorId ?? ctx?.actorId ?? null,
        correlationId: ctx?.correlationId ?? null,
        conteudo,
        sensibilidade: 'interna',
      });
    } catch (erro) {
      this.log.warn(
        `[assinatura] não consegui registrar "${tipo}" da empresa ${orgId}: ` +
          `${erro instanceof Error ? erro.name : 'erro'}`,
      );
    }
  }
}
