import { Injectable, Logger } from '@nestjs/common';
import {
  MINIMO_DO_MOTIVO,
  ORDEM_DOS_NIVEIS,
  afrouxamentosDoDiff,
  avaliar,
  classificar,
  type Capacidade,
  type DiffDePolitica,
  type Nivel,
  type Politica,
} from '@mktos/policy';
import { PrismaService } from '../prisma/prisma.service';
import { exigirTenant } from '../common/contexto-execucao';
import { ModulosService } from '../tenants/modulos.service';
import { catalogoVisivel } from '../tenants/modulos';
import { PolicyService } from './policy.service';
import { janelaLegivel } from './limites';
import {
  EFEITO_NEUTRO,
  linhaDeLog,
  simularAcao,
  type PedidoDeSimulacao,
  type ResultadoDaSimulacao,
} from './simulador';

/** Uma capacidade como o documento a declara. */
type CapacidadeDoDocumento = Politica['capacidades'][number];

/*
 * O QUE A TELA DA RÉGUA MOSTRA — RF-P-09 e RF-B-01.
 *
 * Monta, para a empresa de quem está olhando, as cinco coisas que a tela pede:
 * os seis níveis com o que cada um exige, os sinais de escalonamento e quando
 * acendem, o catálogo de capacidades com os agentes que declararam cada uma, as
 * sobrescritas da empresa (com data e responsável) e o simulador.
 *
 * A REGRA QUE GOVERNA O ARQUIVO INTEIRO: A TELA PERGUNTA, A API RESPONDE.
 * Nada do que sai daqui é para o front recalcular. Os níveis saem do documento
 * que VALE para esta empresa (`PolicyService.documento`), e o que cada um exige
 * sai de `avaliar()` — a mesma função que a porta chama. Se a política mudar, a
 * tela muda junto, sem ninguém tocar no web. Uma cópia da escada em TypeScript
 * do front seria uma segunda régua, e no dia em que a primeira mudasse a tela
 * passaria a ensinar o errado com toda a confiança do mundo.
 *
 * E A OUTRA: SIMULAR NÃO É EXECUTAR. `simular()` chama `simularAcao()`, que é
 * puro — não cria aprovação, não chama efeito, não grava decisão. Note que ele
 * NÃO usa `PolicyService.avaliarERegistrar()`, que é o caminho que grava
 * `PolicyDecision`: uma simulação na tabela de decisões contaminaria a contagem
 * de "o que a régua decidiu" com hipóteses que ninguém executou. O que fica é
 * uma linha de log, marcada como consulta — montada por `linhaDeLog()`, que
 * sanitiza o texto vindo do corpo da requisição para que ninguém escreva uma
 * linha falsa dentro da nossa.
 *
 * E A TERCEIRA, QUE FALTAVA: O CATÁLOGO É FILTRADO PELOS MÓDULOS DA EMPRESA.
 * O documento de política é o mesmo para todo mundo que herda a base, e ele
 * descreve o produto INTEIRO — financeiro, pauta, leads, instagram, metas,
 * pixels. Entregá-lo cru daria a uma empresa que não contratou nada disso os
 * identificadores, as rotas e os nomes de ferramenta de tudo. O gate de rota
 * (RF-T-06) já recusa `/api/finance/*` para ela; aqui o mesmo mapa esconde a
 * capacidade correspondente — nas duas visões do catálogo E no simulador, senão
 * bastaria pedir a simulação de `financeiro.dre.ler` para descobrir que existe.
 */
@Injectable()
export class ReguaService {
  private readonly log = new Logger('ReguaService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly modulos: ModulosService,
  ) {}

  /**
   * A política desta empresa com o catálogo já podado pelos módulos dela.
   *
   * Devolve o documento inteiro — níveis, gatilhos, invariantes e limites são a
   * régua, não são produto, e valem para todo mundo. O que muda é a lista de
   * capacidades.
   */
  private async politicaVisivel(orgId: string): Promise<Politica> {
    const politica = this.policy.documento(orgId);
    const ligados = await this.modulos.modulosDaOrg(orgId);
    const visiveis = catalogoVisivel(politica.capacidades, ligados, (erro, c) =>
      this.log.error(
        `capacidade "${(c as CapacidadeDoDocumento).id}": ${erro.message} — ` +
          'ela fica VISÍVEL no painel até o prefixo ser declarado',
      ),
    );
    return visiveis.length === politica.capacidades.length
      ? politica
      : { ...politica, capacidades: visiveis };
  }

  /* ------------------------------------------------------------- níveis ---- */

  /**
   * Os seis degraus com o que cada um exige.
   *
   * `escreve`, `bloqueado`, o nome e a lista de rastro saem do documento. O que
   * cada nível EXIGE (aprovação, alçada, reautenticação, motivo) sai de
   * `avaliar()`, com um efeito neutro e o nível declarado: assim o número na
   * tela é literalmente o que o motor responderia, e não uma tabela paralela
   * escrita à mão que envelhece calada.
   */
  private niveis(politica: Politica) {
    return ORDEM_DOS_NIVEIS.map((nivel) => {
      const doDocumento = politica.niveis?.[nivel];
      const decisao = avaliar({
        id: `(nível ${nivel})`,
        descricao: doDocumento?.nome ?? nivel,
        nivel,
        efeito: EFEITO_NEUTRO,
      });
      return {
        nivel,
        nome: doDocumento?.nome ?? nivel,
        escreve: doDocumento?.escreve ?? false,
        bloqueado: doDocumento?.bloqueado ?? false,
        rastro: doDocumento?.rastro ?? [],
        aprovacao: decisao.aprovacao,
        exigeAprovacao: decisao.exigeAprovacao,
        exigeReautenticacao: decisao.exigeReautenticacao,
        exigeMotivo: decisao.exigeMotivo,
        permitido: decisao.permitido,
        motivo: decisao.motivo,
      };
    });
  }

  /* ------------------------------------------------------------- sinais ---- */

  /**
   * Os seis sinais, com a descrição do documento e COMO cada um acende.
   *
   * `origem` é conhecimento do motor, não do documento: dois saem de conta com
   * os limites da empresa, três exigem histórico no banco e um é DECLARADO pelo
   * runtime. Esse último — procedência externa — é de mão única (RF-G-07):
   * conteúdo externo só eleva nível, e no contexto de execução existe marcar,
   * não existe desmarcar. É a única assimetria da lista e a tela precisa dizê-la.
   */
  private sinais(politica: Politica) {
    const limites = politica.limitesPadrao;
    const comoAcende: Record<string, { origem: string; quando: string; maoUnica: boolean }> = {
      destinatario_novo: {
        origem: 'histórico',
        quando: 'o destinatário não tem histórico confirmado nesta empresa',
        maoUnica: false,
      },
      fora_da_janela: {
        origem: 'limite da empresa',
        quando: `a hora da execução cai fora de ${limites.janelaHoraria[0]}–${limites.janelaHoraria[1]}`,
        maoUnica: false,
      },
      volume_atipico: {
        origem: 'histórico',
        quando: 'a capacidade passa de 3x a média por hora dos últimos 30 dias',
        maoUnica: false,
      },
      fonte_nao_confiavel: {
        origem: 'declarado pelo runtime',
        quando:
          'o pedido foi montado a partir de mensagem, documento ou página — marca de mão ' +
          'única: existe marcar, não existe desmarcar (RF-G-07)',
        maoUnica: true,
      },
      erro_recente: {
        origem: 'histórico',
        quando: 'o mesmo agente teve ação recusada ou com erro nas últimas 24h',
        maoUnica: false,
      },
      valor_acima_do_limite: {
        origem: 'limite da empresa',
        quando: `o valor envolvido passa de ${limites.tetoCustoCentavosPorExecucao} centavos por execução`,
        maoUnica: false,
      },
    };

    return {
      regra: politica.escalonamento.regra,
      sinais: politica.escalonamento.sinais.map((s) => ({
        id: s.id,
        descricao: s.descricao,
        ...(comoAcende[s.id] ?? { origem: 'desconhecida', quando: '', maoUnica: false }),
      })),
    };
  }

  /* -------------------------------------------------------- capacidades ---- */

  /**
   * O catálogo desta empresa e, para cada capacidade, os agentes que a
   * DECLARARAM.
   *
   * A relação existe porque a porta já a impõe: `tool-gateway.service.ts` recusa
   * `fora_da_declaracao` antes de olhar nível nenhum (RF-N-03). A tela só torna
   * visível uma trava que já está de pé — e, de quebra, mostra os dois buracos
   * que ninguém enxergava: capacidade que nenhum agente declarou (existe e
   * ninguém alcança) e capacidade sem `ferramenta` (declarada e inalcançável
   * por qualquer modelo, porque o adaptador filtra por esse campo).
   */
  private async catalogo(orgId: string, politica: Politica, todasAsIds: ReadonlySet<string>) {
    const agentes = await this.prisma.agent.findMany({
      where: { orgId },
      select: {
        slug: true,
        nome: true,
        estado: true,
        ativo: true,
        capacidades: true,
        autonomiaAte: true,
      },
      orderBy: { nome: 'asc' },
    });

    const grau = (n: string) => ORDEM_DOS_NIVEIS.indexOf(n as Nivel);
    const noCatalogo = new Map(politica.capacidades.map((c) => [c.id, c]));

    const capacidades = politica.capacidades.map((c) => {
      const declarantes = agentes.filter((a) => a.capacidades.includes(c.id));
      return {
        id: c.id,
        descricao: c.descricao,
        nivel: c.nivel,
        /** O que o efeito dela produz pela escada — se divergir, o catálogo mente. */
        nivelCalculado: classificar(c.efeito as Capacidade['efeito']),
        efeito: c.efeito,
        desfazer: c.desfazer ?? null,
        ferramenta: c.ferramenta ?? null,
        rota: c.rota ?? null,
        validaArgumentos: Boolean(
          c.argsSchema &&
            (c.argsSchema as { properties?: unknown }).properties &&
            Object.keys((c.argsSchema as { properties: object }).properties).length > 0,
        ),
        agentes: declarantes.map((a) => ({
          slug: a.slug,
          nome: a.nome,
          estado: a.estado,
          ativo: a.ativo,
          autonomiaAte: a.autonomiaAte,
          // O teto DECLARADO do agente. Quem impõe é a porta; aqui é leitura.
          acimaDaAutonomia: grau(c.nivel) > grau(a.autonomiaAte),
        })),
      };
    });

    /*
     * A MESMA RELAÇÃO VISTA DO OUTRO LADO: a fatia do catálogo que cada agente
     * declarou poder usar.
     *
     * Não é a mesma lista de cabeça para baixo por conveniência de tela: é a
     * pergunta que a porta responde a cada chamada ("este agente declarou esta
     * capacidade?"), e ela faz aparecer um caso que a visão por capacidade não
     * mostra — o id declarado que NÃO EXISTE no catálogo. A porta deixa passar
     * o passo 1 (está na declaração) e o motor devolve R5 bloqueado no passo
     * seguinte, porque capacidade sem classificação vale R5. Da declaração do
     * agente, aquilo parece uma permissão; é uma porta fechada.
     */
    /*
     * O NÍVEL DE UMA CAPACIDADE QUE NÃO ESTÁ NO CATÁLOGO NÃO É ESCOLHA DA TELA.
     * Ele é `avaliar(null)` — a invariante 2 da política, decidida pela mesma
     * função que a porta chama. Antes o front escrevia `?? 'R5'`, o que é uma
     * segunda régua de uma linha só: no dia em que a política mudar o degrau da
     * capacidade sem classificação, a tela continuaria dizendo R5.
     */
    const semClassificacao = avaliar(null);

    const porAgente = agentes.map((a) => {
      const declaradas: {
        id: string;
        nivel: Nivel | null;
        nivelEfetivo: Nivel;
        porque: string;
        acimaDaAutonomia: boolean;
      }[] = [];
      /*
       * Declarada pelo agente, existente no catálogo do produto e ESCONDIDA
       * porque a empresa não contratou o módulo. Sai da lista (senão o id
       * vazaria justamente pela porta que o filtro fecha) e vira contagem: o
       * operador precisa saber que o agente dele declara coisa que não alcança,
       * sem que isso diga o que é.
       */
      let ocultasPorModulo = 0;

      for (const id of a.capacidades) {
        const cap = noCatalogo.get(id);
        if (!cap) {
          if (todasAsIds.has(id)) {
            ocultasPorModulo += 1;
            continue;
          }
          declaradas.push({
            id,
            nivel: null,
            nivelEfetivo: semClassificacao.nivel,
            porque: `não está no catálogo desta empresa: ${semClassificacao.motivo}`,
            acimaDaAutonomia: true,
          });
          continue;
        }
        const acima = grau(cap.nivel) > grau(a.autonomiaAte);
        declaradas.push({
          id,
          nivel: cap.nivel,
          nivelEfetivo: cap.nivel,
          porque: acima
            ? `nível ${cap.nivel}, acima do teto declarado ${a.autonomiaAte} deste agente`
            : `nível ${cap.nivel}`,
          acimaDaAutonomia: acima,
        });
      }

      return {
        slug: a.slug,
        nome: a.nome,
        estado: a.estado,
        ativo: a.ativo,
        autonomiaAte: a.autonomiaAte,
        capacidades: declaradas,
        semClassificacao: declaradas.filter((d) => d.nivel === null).map((d) => d.id),
        ocultasPorModulo,
      };
    });

    return { capacidades, agentes: porAgente };
  }

  /* -------------------------------------------------------- sobrescritas --- */

  /**
   * Marca, em cada linha do diff, se ela AFROUXOU — e quem decide é o pacote.
   *
   * `afrouxamentosDoDiff()` é a MESMA função que a trava do RF-P-06 consome
   * para exigir responsável e motivo. A tela pintava isso sozinha, com um
   * `d === 'desce' || d === 'nova' || d === 'afrouxa'`, e a cópia já estava
   * errada: ela ignorava as TRAVAS DE EXECUÇÃO — desligar a validação de
   * argumentos de uma capacidade afrouxa sem mexer no nível, e a linha saía
   * pintada de verde.
   *
   * Diff ilegível (linha antiga, formato de outra época) marca tudo como
   * afrouxamento: não dá para provar que apertou, e o lado caro do erro é
   * pintar de verde uma mudança que abriu a porta.
   */
  private anotarAfrouxamento(
    diff: DiffDePolitica | null,
    onde: string,
  ): (DiffDePolitica & { ilegivel?: boolean }) | null {
    if (!diff) return null;
    let alvos: Set<string>;
    try {
      alvos = new Set(afrouxamentosDoDiff(diff).map((a) => a.alvo));
    } catch (e) {
      this.log.warn(
        `diff ${onde} não é legível (${(e as Error).message}) — tudo marcado como afrouxamento`,
      );
      return {
        ...diff,
        ilegivel: true,
        capacidades: (diff.capacidades ?? []).map((c) => ({ ...c, afrouxa: true })),
        limites: (diff.limites ?? []).map((l) => ({ ...l, afrouxa: true })),
        secoes: (diff.secoes ?? []).map((s) => ({ ...s, afrouxa: true })),
      } as DiffDePolitica & { ilegivel: boolean };
    }
    return {
      ...diff,
      capacidades: diff.capacidades.map((c) => ({ ...c, afrouxa: alvos.has(c.id) })),
      limites: diff.limites.map((l) => ({ ...l, afrouxa: alvos.has(String(l.campo)) })),
      secoes: diff.secoes.map((s) => ({ ...s, afrouxa: alvos.has(s.secao) })),
    } as DiffDePolitica;
  }

  /**
   * O que esta empresa mudou na régua herdada, com data e responsável
   * (RF-P-04 e RF-P-06).
   *
   * Os diffs vêm GRAVADOS, não recalculados: a base muda, e recalcular seis
   * meses depois responderia outra pergunta. São dois, com a referência no
   * nome — `diffDaBase` diz o que esta empresa tem de diferente da ROOT, e
   * `diffDaVersaoAnterior` diz o que AQUELA mudança fez. Uma queda de R4 para
   * R3 é `sobe` contra a base (que é R2) e `desce` contra o que estava valendo:
   * mostrar um dos dois chamando de "diff" faz quem lê entender a direção ao
   * contrário.
   */
  private async sobrescritas(orgId: string) {
    const versoes = await this.policy.historico(orgId);
    const autores = [...new Set(versoes.map((v) => v.autorId).filter((a): a is string => !!a))];
    const pessoas = autores.length
      ? await this.prisma.user.findMany({
          where: { orgId, id: { in: autores } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const porId = new Map(pessoas.map((p) => [p.id, p]));

    const linhas = versoes.map((v) => {
      const pessoa = v.autorId ? porId.get(v.autorId) : null;
      return {
        versao: v.versao,
        motivo: v.motivo,
        // `null` no autor é seed ou script, e a tela precisa dizer isso em vez
        // de mostrar um id cru que ninguém reconhece.
        responsavel: pessoa
          ? { id: pessoa.id, nome: pessoa.name, email: pessoa.email }
          : v.autorId
            ? { id: v.autorId, nome: v.autorId, email: null }
            : null,
        ativaDe: v.ativaDe,
        ativaAte: v.ativaAte,
        emVigor: v.ativaAte === null,
        criadoEm: v.criadoEm,
        diffDaBase: this.anotarAfrouxamento(
          (v.diffDaBase ?? null) as unknown as DiffDePolitica | null,
          `v${v.versao} contra a base`,
        ),
        diffDaVersaoAnterior: this.anotarAfrouxamento(
          (v.diffDaVersaoAnterior ?? null) as unknown as DiffDePolitica | null,
          `v${v.versao} contra a anterior`,
        ),
      };
    });

    const emVigor = linhas.find((l) => l.emVigor) ?? null;
    const delta = await this.policy.deltaDaEmpresa(orgId);

    return {
      /** Vazio = a empresa herda a régua da ROOT inteira, sem uma linha própria. */
      herdaTudo: emVigor === null,
      emVigor,
      historico: linhas,
      /** Os ids que o delta desta empresa declara — é o que a tela marca no catálogo. */
      idsSobrescritos: (delta?.capacidades ?? []).map((c) => c.id),
      /**
       * A trava do RF-P-06, com os valores que o código realmente cobra. Afrouxar
       * (rebaixar nível, acrescentar capacidade, desligar validação de argumento,
       * alargar limite) exige responsável identificado e motivo escrito; apertar
       * segue livre. É assimetria de propósito.
       */
      trava: {
        minimoDoMotivo: MINIMO_DO_MOTIVO,
        regra:
          'rebaixar nível nunca é automático: toda sobrescrita que afrouxa alguma coisa ' +
          'exige responsável identificado e motivo escrito, e é recusada inteira sem os dois. ' +
          'Apertar não exige assinatura nenhuma.',
      },
    };
  }

  /* --------------------------------------------------------------- painel -- */

  async painel(orgIdBruto: string) {
    const orgId = exigirTenant(orgIdBruto, 'ReguaService.painel');
    const completa = this.policy.documento(orgId);
    const politica = await this.politicaVisivel(orgId);
    const todasAsIds = new Set(completa.capacidades.map((c) => c.id));
    const [catalogo, sobrescritas] = await Promise.all([
      this.catalogo(orgId, politica, todasAsIds),
      this.sobrescritas(orgId),
    ]);

    return {
      politica: {
        versao: politica.versao,
        atualizadoEm: politica.atualizadoEm,
        origem: politica.origem,
        descricao: politica.descricao,
        /** Versão própria da empresa, ou nulo quando ela herda a base. */
        versaoDaEmpresa: sobrescritas.emVigor?.versao ?? null,
      },
      niveis: this.niveis(politica),
      escalonamento: this.sinais(politica),
      gatilhos: politica.gatilhos,
      invariantes: politica.invariantes,
      limites: politica.limitesPadrao,
      /**
       * A janela desta empresa dá para comparar com um relógio? Falso significa
       * que `fora_da_janela` está aceso em TODA ação — e a tela precisa dizer
       * isso, porque o operador veria um degrau a mais em tudo sem explicação.
       */
      janelaLegivel: janelaLegivel(politica.limitesPadrao.janelaHoraria),
      retencao: politica.retencao,
      capacidades: catalogo.capacidades,
      agentes: catalogo.agentes,
      /** Quantas capacidades o catálogo do produto tem e esta empresa não vê. */
      capacidadesOcultasPorModulo: todasAsIds.size - politica.capacidades.length,
      sobrescritas,
      /*
       * O efeito de partida do formulário do simulador. Vai daqui, e não fica
       * escrito no front, porque um campo novo no esquema do efeito passaria a
       * existir só de um lado: o "em branco" da tela diria uma coisa e o do
       * motor, outra.
       */
      efeitoNeutro: EFEITO_NEUTRO,
    };
  }

  /* ------------------------------------------------------------ simulador -- */

  /**
   * A ação hipotética. Devolve nível, gatilhos acesos e o que seria exigido.
   *
   * NÃO escreve: nem aprovação, nem `PolicyDecision`, nem evento no RASTRO. O
   * único registro é esta linha de log, e ela diz com todas as letras que foi
   * consulta — é o que permite alguém investigar "quem andou simulando o quê"
   * sem que a simulação vire prova de ação nenhuma. A linha é montada por
   * `linhaDeLog()`, que sanitiza o texto do pedido: `descricao` e
   * `capabilityId` são string livre, e uma quebra de linha no meio deles
   * escreveria uma SEGUNDA linha no arquivo, com a cara das nossas.
   *
   * O CATÁLOGO AQUI É O VISÍVEL, e não o completo. Sem isso, uma empresa sem o
   * módulo financeiro descobriria `financeiro.dre.ler` só pedindo a simulação
   * dela — e o painel, que filtra, viraria fachada. Com o filtro, a capacidade
   * de módulo não contratado responde exatamente como uma inventada: R5,
   * bloqueada, "não está no catálogo desta empresa".
   */
  async simular(
    orgIdBruto: string,
    pedido: PedidoDeSimulacao,
    quem?: string,
  ): Promise<ResultadoDaSimulacao> {
    const orgId = exigirTenant(orgIdBruto, 'ReguaService.simular');
    const politica = await this.politicaVisivel(orgId);
    const r = simularAcao(politica, pedido);
    this.log.log(linhaDeLog(orgId, quem, r));
    return r;
  }
}
