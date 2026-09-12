import { Injectable, Logger } from '@nestjs/common';

import { CofreService, SegredoIndisponivelError } from '../cofre/cofre.service';
import {
  type CobrancaParaDecisao,
  type EstadoDeCobranca,
  type LeituraDoProvedor,
} from './assinatura';

/*
 * ============================================================================
 * O CONECTOR DE COBRANÇA — RF-O-03, RF-C-02
 * ============================================================================
 *
 * Fala com o Asaas para responder UMA pergunta: quais são as cobranças desta
 * assinatura, e qual o estado de cada uma. Nada mais.
 *
 * ----------------------------------------------------------------------------
 * A REGRA QUE DECIDE O DESENHO DESTE ARQUIVO
 * ----------------------------------------------------------------------------
 * **A credencial mora no COFRE, por empresa, e nunca em variável global.**
 *
 * Existe um segundo cliente de Asaas neste repositório (`finance/asaas.service.ts`)
 * e ele lê `process.env.ASAAS_API_KEY`. Aquele conector serve ao MÓDULO
 * FINANCEIRO — a conta da própria ROOT, cujo extrato aparece no painel de
 * finanças. Este aqui serve à COBRANÇA DO PRODUTO, que é outra relação: a chave
 * que cobra a empresa X é da conta que emite a fatura DELA, e num mundo com mais
 * de um operador (revenda, parceiro) não existe "a chave", existe a chave de
 * cada um. Uma variável de ambiente não tem onde guardar isso, e o dia em que
 * tivesse guardaria a de todo mundo no mesmo lugar.
 *
 * Por isso a chave sai do cofre (`conector: 'cobranca'`, `nome: 'api_key'`), por
 * EMPRÉSTIMO com prazo (RF-C-02): ela existe dentro do fechamento de `usar` e em
 * lugar nenhum mais. Não há campo, não há variável de instância, não há
 * parâmetro que a carregue para fora.
 *
 * ----------------------------------------------------------------------------
 * POR QUE `cobranca` E NÃO `asaas` COMO CHAVE DE CONECTOR NO COFRE
 * ----------------------------------------------------------------------------
 * Duas razões, e a segunda é a que importa:
 *
 *  1. `asaas` já tem dono: `AsaasService` se inscreve com essa chave em
 *     `ConectoresConfiguradosRegistry`, e uma segunda inscrição faz o registro
 *     avisar "inscrito duas vezes" — sinal que existe para acusar conector
 *     duplicado, e que mentiria se fosse ligado aqui de propósito.
 *
 *  2. O INTERRUPTOR DE CONECTOR É DO CLIENTE (RF-G-06): a tela de Conexões
 *     deixa a empresa desligar `asaas` quando quiser, e isso é correto para o
 *     conector do módulo financeiro — é a conta DELA. Se a verificação de
 *     pagamento passasse pelo mesmo interruptor, o devedor desligaria o medidor:
 *     `ConectoresService.exigirLigado` recusaria a leitura, a leitura viraria
 *     "não sei", e "não sei" nunca suspende (ver `assinatura.ts`). A conta é
 *     simples e o resultado é inaceitável.
 *
 *     Por isso este conector NÃO passa por `ConectoresService.envolver`, e a
 *     composição documentada no cofre ("primeiro o interruptor, depois o cofre")
 *     é deliberadamente quebrada aqui, com o motivo escrito: não há interruptor
 *     de cliente sobre a cobrança do produto que ele contratou.
 *
 * ----------------------------------------------------------------------------
 * SOMENTE LEITURA, e isso é fronteira de arquitetura
 * ----------------------------------------------------------------------------
 * Este conector só faz `GET`. Criar cobrança, cancelar cobrança e alterar valor
 * são ESCRITAS num sistema de terceiro — R3 na régua — e escrita externa não sai
 * fora do Tool Gateway (ADR-004, 02-CONSTRAINTS). Fazê-las exigiria capacidade
 * NOVA no catálogo, e capacidade nova em produção só entra por semente assinada.
 * Fica declarado no relatório da fatia como o que falta para a cobrança ser
 * emitida daqui em vez de no painel do provedor.
 *
 * A cobrança recorrente em si é gerada PELO PROVEDOR, a partir da assinatura
 * criada lá. O que este sistema faz é espelhar o resultado e decidir o acesso.
 */

/** O que o Asaas devolve em `GET /payments`. Só os campos que a decisão usa. */
interface PagamentoDoProvedor {
  id?: unknown;
  status?: unknown;
  value?: unknown;
  dueDate?: unknown;
  paymentDate?: unknown;
}

interface ListaDoProvedor {
  data?: unknown;
  hasMore?: unknown;
  totalCount?: unknown;
}

/**
 * Falha ao falar com o provedor de cobrança.
 *
 * NÃO CARREGA A REQUISIÇÃO. Nem cabeçalho, nem corpo, nem URL com query — só o
 * caminho e o status. É deliberado: a mensagem e a PILHA de um `Error` são o
 * caminho mais curto para um segredo chegar ao RASTRO e ao modelo (o laço do
 * agente manda a mensagem do erro para dentro da conversa), e `Object.entries`
 * de um `Error` devolve `[]` — quem só olha os campos jura que está limpo.
 * Ver a seção da varredura em `cofre/segredo.ts`.
 */
export class FalhaDoProvedorDeCobranca extends Error {
  constructor(
    readonly caminho: string,
    readonly status: number | null,
    detalhe: string,
  ) {
    super(
      `provedor de cobrança recusou ${caminho}${status === null ? '' : ` (HTTP ${status})`}: ${detalhe}. ` +
        'A leitura fica INCOMPLETA e nenhum acesso muda por causa disto.',
    );
    this.name = 'FalhaDoProvedorDeCobranca';
  }
}

/**
 * Nenhuma credencial de cobrança guardada para esta empresa.
 *
 * Separado da falha de rede porque a consequência é a mesma e a causa não: quem
 * lê o log precisa saber se falta configurar ou se o provedor caiu.
 */
export class SemCredencialDeCobranca extends Error {
  constructor(orgId: string) {
    super(
      `a empresa ${orgId} não tem credencial de cobrança no cofre ` +
        `(conector "${CobrancaAsaasService.CONECTOR}", nome "${CobrancaAsaasService.NOME_DA_CHAVE}"). ` +
        'Sem ela não há como conferir pagamento — e sem conferir, nada é suspenso.',
    );
    this.name = 'SemCredencialDeCobranca';
  }
}

/**
 * `PENDING`/`OVERDUE`/… do Asaas → o vocabulário desta casa.
 *
 * O QUE NÃO CASA VIRA `aberta`, E NÃO `vencida`. Um estado novo do provedor
 * (`CHARGEBACK_REQUESTED`, o que for) é uma coisa que não sabemos ler; ler o
 * desconhecido como inadimplência é suspender por ignorância. `aberta` mantém o
 * acesso e deixa o caso visível na tela para alguém olhar.
 */
const DO_PROVEDOR: Readonly<Record<string, EstadoDeCobranca>> = {
  PENDING: 'aberta',
  AWAITING_RISK_ANALYSIS: 'aberta',
  AWAITING_CHARGEBACK_REVERSAL: 'aberta',
  OVERDUE: 'vencida',
  RECEIVED: 'paga',
  CONFIRMED: 'paga',
  RECEIVED_IN_CASH: 'paga',
  REFUNDED: 'cancelada',
  REFUND_REQUESTED: 'cancelada',
  CHARGEBACK_DISPUTE: 'aberta',
  DUNNING_REQUESTED: 'vencida',
  DUNNING_RECEIVED: 'paga',
};

export function estadoDaCobranca(bruto: unknown): EstadoDeCobranca {
  if (typeof bruto !== 'string') return 'aberta';
  return DO_PROVEDOR[bruto.toUpperCase()] ?? 'aberta';
}

/** `1234.56` (reais do provedor) → `123456` (centavos). */
export function emCentavos(valor: unknown): number {
  const n = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

/** `2026-09-11` → Date. Data ilegível vira `null`, e linha sem data é descartada. */
export function dataDoProvedor(bruto: unknown): Date | null {
  if (typeof bruto !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(bruto)) return null;
  const d = new Date(`${bruto.slice(0, 10)}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Uma cobrança já traduzida, com os campos que a decisão e o espelho usam. */
export interface CobrancaLida extends CobrancaParaDecisao {
  valorCentavos: number;
  pagoEm: Date | null;
}

export interface LeituraDeCobrancas extends LeituraDoProvedor {
  cobrancas: readonly CobrancaLida[];
  /** Por que ficou incompleta, quando ficou. Vai para o log, nunca para o cliente. */
  porqueIncompleta: string | null;
}

@Injectable()
export class CobrancaAsaasService {
  private readonly log = new Logger('CobrancaAsaas');

  /** A chave do conector NO COFRE. Ver a nota do cabeçalho sobre não ser `asaas`. */
  static readonly CONECTOR = 'cobranca';
  /**
   * O nome do segredo no cofre.
   *
   * NÃO ESTÁ EM `NOMES_CONHECIDOS` (`cofre/segredo.ts`), e a versão anterior
   * deste comentário mandava o leitor "ver" lá — apontando para uma garantia que
   * não existe. Aquele objeto lista os quatro nomes que nasceram de OAuth
   * (`access_token`, `refresh_token`, `app_secret`, `page_token`) e é
   * declaradamente NÃO exaustivo; `api_key` é chave de API digitada por quem
   * administra, de outra natureza. O que amarra a grafia aqui é esta constante
   * ser a única citada nos três pontos que a usam (guardar, emprestar, perguntar
   * se existe) — e não uma lista compartilhada.
   */
  static readonly NOME_DA_CHAVE = 'api_key';

  /**
   * Páginas no máximo. Além disso a leitura é declarada INCOMPLETA.
   *
   * Não é um teto de desempenho, é a defesa contra o laço infinito de um
   * provedor que devolva `hasMore: true` para sempre — e, principalmente, é o
   * que faz a leitura truncada se ANUNCIAR em vez de passar por completa. Vinte
   * páginas de cem cobrem oito anos de assinatura mensal.
   */
  private static readonly TETO_DE_PAGINAS = 20;
  private static readonly POR_PAGINA = 100;

  /**
   * Quanto tempo cada chamada externa tem. Sem isto, um provedor lento segura a
   * requisição do cliente até o proxy desistir, e o que chega é 502 sem causa.
   */
  private static readonly TEMPO_LIMITE_MS = 15_000;

  constructor(private readonly cofre: CofreService) {}

  /**
   * As bases do Asaas.
   *
   * DUPLICADAS DE `finance/asaas.service.ts` DE PROPÓSITO, e a duplicação é o
   * caminho mais barato: importar daquele arquivo faria este módulo depender do
   * conector do financeiro (`apps/api/test/arquitetura.test.ts`, frente 1, conta
   * qualquer import dele como caminho paralelo), e exportar as constantes de lá
   * seria editar um arquivo de outra fatia por causa de duas strings. Se o Asaas
   * mudar de endereço, as duas linhas mudam — e as duas estão sob a mesma
   * catraca de endereço de fornecedor (frente 2), que acusa qualquer terceiro
   * que as copie para um lugar novo.
   */
  private static readonly BASE_PRODUCAO = 'https://api.asaas.com/v3';
  private static readonly BASE_SANDBOX = 'https://sandbox.asaas.com/api/v3';

  /**
   * O ambiente sai da PRÓPRIA CHAVE, dentro do empréstimo.
   *
   * O prefixo `$aact_hmlg_` é sandbox; qualquer outro é produção. Guardar o
   * ambiente numa coluna criaria o estado inconsistente clássico — chave de
   * sandbox com a coluna dizendo produção — e nesse estado as chamadas
   * responderiam 401 e a leitura ficaria eternamente incompleta.
   *
   * Recebe o segredo e devolve só a URL: o valor não sai deste parâmetro.
   */
  private static baseDaChave(segredo: string): string {
    return /hmlg/i.test(segredo) ? CobrancaAsaasService.BASE_SANDBOX : CobrancaAsaasService.BASE_PRODUCAO;
  }

  /**
   * As cobranças de uma assinatura, no provedor.
   *
   * NUNCA LANÇA POR FALHA DO PROVEDOR. Devolve `completa: false`, que é o que a
   * decisão lê como "não sei" — e "não sei" não muda acesso de ninguém. Lançar
   * daqui obrigaria cada chamador a lembrar do `catch`, e o chamador que
   * esquecesse derrubaria a requisição de um cliente por causa de uma
   * instabilidade do provedor.
   *
   * O que ele NÃO engole é erro de programação: `SemCredencialDeCobranca` sobe,
   * porque "não tem chave configurada" é conserto de gente, não intermitência.
   */
  async cobrancasDaAssinatura(
    orgId: string,
    assinaturaNoProvedor: string,
  ): Promise<LeituraDeCobrancas> {
    const caminhoBase = `/payments?subscription=${encodeURIComponent(assinaturaNoProvedor)}`;
    const cobrancas: CobrancaLida[] = [];

    try {
      for (let pagina = 0; pagina < CobrancaAsaasService.TETO_DE_PAGINAS; pagina += 1) {
        const caminho =
          `${caminhoBase}&limit=${CobrancaAsaasService.POR_PAGINA}` +
          `&offset=${pagina * CobrancaAsaasService.POR_PAGINA}`;

        /*
         * UM EMPRÉSTIMO POR PÁGINA — e o laço fica DE FORA dele.
         *
         * A primeira escrita envolvia o laço inteiro: um empréstimo atravessava
         * até vinte chamadas externas. O cofre declara, por escrito
         * (`PrazoDeEmprestimoExcessivoError`, em `cofre/segredo.ts`), que
         * empréstimo atravessa UMA chamada externa — e o resto do desenho
         * repousa nisso. Duas consequências medidas do jeito antigo:
         *
         *  · a chave ficava viva por até cinco minutos (o TETO), contra o prazo
         *    PADRÃO de um minuto, porque o prazo só é conferido na ENTRADA do
         *    empréstimo;
         *  · revogar com o empréstimo na rua limpa o objeto do mapa de vivos,
         *    mas NÃO a cópia que o fechamento já tem na mão: a chave revogada
         *    continuava sendo usada até o laço acabar.
         *
         * Com um empréstimo por página, revogar atinge a página seguinte: o
         * cofre recusa emprestar, a leitura fica INCOMPLETA, e leitura incompleta
         * não muda acesso de ninguém. O custo é uma abertura de GCM por página —
         * vinte no pior caso, contra uma chamada de rede cada.
         */
        const lista = await this.cofre.envolver(
          {
            orgId,
            conector: CobrancaAsaasService.CONECTOR,
            nome: CobrancaAsaasService.NOME_DA_CHAVE,
          },
          (credencial) =>
            /*
             * TUDO o que toca a chave acontece DENTRO deste fechamento, e o que
             * sai dele é `ListaDoProvedor` — o corpo já decodificado, sem
             * cabeçalho e sem nada que tenha encostado no segredo.
             */
            credencial.usar((chave) =>
              this.buscar(CobrancaAsaasService.baseDaChave(chave), caminho, chave),
            ),
        );

        const linhas = Array.isArray(lista.data) ? lista.data : [];
        for (const linha of linhas) {
          const traduzida = this.traduzir(linha as PagamentoDoProvedor);
          if (traduzida) cobrancas.push(traduzida);
        }

        if (lista.hasMore !== true || linhas.length === 0) {
          return { completa: true, cobrancas, porqueIncompleta: null };
        }
      }

      /*
       * Chegou ao teto com o provedor ainda dizendo que há mais. Poderia
       * devolver o que juntou e chamar de completo — e aí a cobrança paga que
       * ficasse na página 21 sumiria, e um cliente em dia seria suspenso.
       * Incompleta, então, e alto no log.
       */
      const porque = `o provedor ainda tinha páginas depois de ${CobrancaAsaasService.TETO_DE_PAGINAS}`;
      this.log.error(`[cobranca] leitura truncada da empresa ${orgId}: ${porque}`);
      return { completa: false, cobrancas, porqueIncompleta: porque };
    } catch (erro) {
      if (erro instanceof SegredoIndisponivelError) throw new SemCredencialDeCobranca(orgId);
      if (erro instanceof SemCredencialDeCobranca) throw erro;

      /*
       * Qualquer outra coisa — rede, timeout, HTTP 4xx/5xx, redirecionamento,
       * JSON inválido — vira leitura incompleta. A mensagem que vai para o log é
       * a NOSSA (`FalhaDoProvedorDeCobranca`), que não carrega requisição; a
       * original é descartada de propósito, porque é ela que poderia trazer
       * cabeçalho.
       *
       * As cobranças JÁ LIDAS seguem no retorno mesmo aqui: elas são verdade do
       * provedor, o espelho só acrescenta, e a decisão não olha para leitura
       * incompleta de todo jeito. Perder a página 1 porque a 2 caiu não protege
       * ninguém — só atrasa o histórico do cliente.
       */
      const descricao =
        erro instanceof FalhaDoProvedorDeCobranca
          ? erro.message
          : 'falha ao falar com o provedor de cobrança (detalhe suprimido: resposta de terceiro)';
      this.log.warn(`[cobranca] leitura incompleta da empresa ${orgId}: ${descricao}`);
      return { completa: false, cobrancas, porqueIncompleta: descricao };
    }
  }

  /**
   * Uma requisição ao provedor. A chave entra por CABEÇALHO, nunca por query.
   *
   * Não é detalhe de gosto: a URL vai para log de proxy, para mensagem de erro
   * de `fetch`, para a pilha do `Error` e para o registro de rede do browser de
   * quem estiver depurando. Cabeçalho, não.
   *
   * ----------------------------------------------------------------------------
   * REDIRECIONAMENTO É RECUSADO — o quarto caminho de vazamento da chave
   * ----------------------------------------------------------------------------
   * `fetch` sem `redirect` declarado SEGUE o redirecionamento, e a especificação
   * remove, ao atravessar origens, apenas os cabeçalhos de autorização que ela
   * CONHECE (`Authorization`, `Cookie`, `Proxy-Authorization`). `access_token` é
   * cabeçalho próprio do Asaas: ele sobrevive e é reenviado inteiro para a
   * origem de destino. Medido com dois servidores locais — um respondendo 302
   * para o outro —, a chave chegou no segundo com o valor em claro.
   *
   * Esse vazamento é de REDE, não de serialização: a varredura de segredo
   * (`contemAlgumSegredo`) olha objeto, e aqui nada de errado aparece em objeto
   * nenhum. Por isso a defesa é o modo `manual`, que devolve o 3xx em vez de
   * segui-lo, e o 3xx vira leitura incompleta.
   *
   * O provedor não redireciona. Qualquer um aqui é anomalia — provedor
   * comprometido, DNS sequestrado, proxy no meio —, e a resposta certa a uma
   * anomalia é "não sei", que nunca suspende ninguém. O destino do
   * redirecionamento NÃO entra na mensagem de erro: é conteúdo de terceiro e
   * pode carregar credencial na própria URL.
   */
  private async buscar(base: string, caminho: string, chave: string): Promise<ListaDoProvedor> {
    const cancelador = AbortSignal.timeout(CobrancaAsaasService.TEMPO_LIMITE_MS);
    let resposta: Response;
    try {
      resposta = await fetch(`${base}${caminho}`, {
        headers: {
          access_token: chave,
          'Content-Type': 'application/json',
          'User-Agent': 'root-os/cobranca',
        },
        redirect: 'manual',
        signal: cancelador,
      });
    } catch {
      // A exceção do `fetch` é DESCARTADA, não reembrulhada: `cause` carregaria
      // a requisição inteira, cabeçalhos inclusive, para dentro da nossa.
      throw new FalhaDoProvedorDeCobranca(caminhoSemQuery(caminho), null, 'sem resposta');
    }

    if (resposta.status >= 300 && resposta.status < 400) {
      this.log.error(
        `[cobranca] o provedor RESPONDEU REDIRECIONAMENTO (HTTP ${resposta.status}) em ` +
          `${caminhoSemQuery(caminho)} — recusado sem seguir. O destino não é registrado de ` +
          'propósito. Enquanto isto valer, a leitura fica incompleta e ninguém é suspenso.',
      );
      throw new FalhaDoProvedorDeCobranca(
        caminhoSemQuery(caminho),
        resposta.status,
        'redirecionamento recusado: seguir levaria a credencial para outra origem',
      );
    }

    if (!resposta.ok) {
      throw new FalhaDoProvedorDeCobranca(
        caminhoSemQuery(caminho),
        resposta.status,
        // O corpo do provedor NÃO entra. É conteúdo de terceiro (02-CONSTRAINTS)
        // e é o lugar clássico de um eco da requisição.
        'resposta de erro',
      );
    }

    try {
      return (await resposta.json()) as ListaDoProvedor;
    } catch {
      throw new FalhaDoProvedorDeCobranca(caminhoSemQuery(caminho), resposta.status, 'corpo ilegível');
    }
  }

  /**
   * Uma linha do provedor → uma cobrança desta casa. `null` descarta a linha.
   *
   * Descarta em vez de adivinhar: linha sem identificador ou sem vencimento não
   * tem como ser espelhada de forma idempotente nem como sustentar uma decisão
   * de suspensão. Uma linha descartada aparece no log e não muda acesso nenhum.
   */
  private traduzir(linha: PagamentoDoProvedor): CobrancaLida | null {
    const referencia = typeof linha.id === 'string' ? linha.id.trim() : '';
    const vencimento = dataDoProvedor(linha.dueDate);
    if (!referencia || !vencimento) return null;

    return {
      // `id` local ainda não existe (a linha pode ser nova): quem o resolve é o
      // espelho, no `upsert`. Aqui a identidade é a referência do provedor.
      id: referencia,
      referencia,
      status: estadoDaCobranca(linha.status),
      vencimento,
      valorCentavos: emCentavos(linha.value),
      pagoEm: dataDoProvedor(linha.paymentDate),
    };
  }
}

/** O caminho sem a query — o que pode ir para uma mensagem de erro. */
function caminhoSemQuery(caminho: string): string {
  return caminho.split('?')[0];
}
