import { ForbiddenException, Injectable, Logger, Optional } from '@nestjs/common';
import { ActorType, RiskLevel } from '@prisma/client';
import { comContexto, contextoAtual, novaCorrelacao, tenantAtual } from '../common/contexto-execucao';
import { PrismaService } from '../prisma/prisma.service';
import { EventLogService } from '../gateway/event-log.service';
import { ReauthService } from '../auth/reauth.service';
import { lerAprovador } from '../auth/aprovador';
import { ConsoleDaPlataformaService } from './console.service';
import { alcadaDe, atendeAlcada, descreverAlcada, temPapelDeMaquina } from '../approvals/alcada';
import {
  ALCADA_DA_AUTORIZACAO,
  AcessoDeSuporteNegadoError,
  AutorizacaoInvalidaError,
  EVENTO_AUTORIZADO,
  EVENTO_NEGADO,
  EVENTO_REVOGADO,
  EVENTO_TETO_DE_RECUSA,
  EVENTO_USADO,
  EXIGE_REAUTENTICACAO,
  JANELA_DO_TETO_MINUTOS,
  LIMITE_DE_RECUSAS_NA_JANELA,
  NIVEL_DA_AUTORIZACAO,
  SUPERFICIE_DO_CLIENTE,
  SUPERFICIE_DO_SUPORTE,
  cercar,
  conferirPedido,
  escolherAcesso,
  estadoDoAcesso,
  segundosRestantes,
  type EscopoDeSuporte,
  type MotivoDaRecusa,
  type PedidoDeAutorizacao,
} from './plataforma';

/*
 * ============================================================================
 * ACESSO DE SUPORTE: O CLIENTE AUTORIZA, TEM PRAZO, E FICA REGISTRADO — RF-B-02
 * ============================================================================
 *
 * A PROMESSA DE VENDA E A EXIGÊNCIA DE LGPD, no mesmo mecanismo:
 *
 *   · quem autoriza é o CLIENTE, e ninguém mais. O operador da plataforma não
 *     tem rota que crie a própria autorização — `autorizar()` roda na empresa
 *     do usuário autenticado, e a empresa da plataforma não tem o que autorizar
 *     sobre si mesma;
 *   · autorizar é MUDANÇA DE ACESSO: R4 na escada ("Valor e acesso"), o que
 *     traz QUATRO exigências que este arquivo cobra uma a uma — motivo escrito
 *     (`exigeMotivo`), alçada `titular` LIDA DO BANCO, gente e nunca conta de
 *     máquina (invariante 7 da escada), e REAUTENTICAÇÃO de quem assina;
 *   · tem PRAZO, e ele acaba sozinho. Não há varredor que "expire" nada: quem
 *     decide é `estadoDoAcesso()`, a cada tentativa de uso, comparando com o
 *     relógio. Prazo que depende de um cron rodando é prazo que não vale no dia
 *     em que o cron para — e esta execução já encontrou um mecanismo que gravava
 *     um campo e ninguém lia;
 *   · fica REGISTRADO no RASTRO DA EMPRESA CLIENTE, que é onde o cliente audita:
 *     autorização, revogação, uso e RECUSA. A recusa também, e é de propósito —
 *     tentativa de entrar depois do prazo é o evento que mais interessa a quem
 *     audita, e um mecanismo que só registra o sucesso não prova nada. Com TETO,
 *     porém: ver "o teto do rastro", abaixo.
 *
 * ----------------------------------------------------------------------------
 * AS DUAS CORREÇÕES DE 11/09/2026, ditas em voz alta
 * ----------------------------------------------------------------------------
 * 1. A ALÇADA VEM DO BANCO, NÃO DO TOKEN. A primeira versão lia `quem.papeis`,
 *    que vem do JWT de OITO HORAS: quem fosse rebaixado continuava autorizando
 *    acesso de suporte à própria empresa por até oito horas, e três comentários
 *    e a tela diziam o contrário. O repositório já tinha fixado o padrão oposto
 *    no arquivo vizinho, com a explicação escrita (`src/auth/aprovador.ts`,
 *    `ApprovalsService.confirm`): a releitura acontece em TODO nível, antes da
 *    trava de alçada. Aqui é a mesma consulta, a mesma função.
 *
 * 2. O DEGRAU EXIGE REAUTENTICAÇÃO, E AGORA ELA ACONTECE. R4 pede prova de
 *    presença; a primeira versão cobria motivo, alçada e "é gente" e omitia
 *    justamente essa — com o serviço que a faz já existindo e já exportado pelo
 *    `AuthModule`. Declarar um degrau e cumprir três quartos dele é a forma de
 *    verificação que parece proteger e não protege.
 *
 * ----------------------------------------------------------------------------
 * O TETO DO RASTRO — e por que "empresa registrada" não bastava
 * ----------------------------------------------------------------------------
 * Cada tentativa negada grava um evento no rastro DA EMPRESA CLIENTE, e evento
 * do rastro não se apaga (02-CONSTRAINTS). A primeira versão apresentava a
 * conferência de "esta empresa está registrada no console?" como a defesa contra
 * enchente — e ela só cobre empresa NÃO registrada, enquanto a semente da
 * migration registra TODAS. Quer dizer: o operador podia encher o rastro de
 * qualquer cliente, sem teto, e a limpeza depois é proibida.
 *
 * O teto está em `registrarRecusa`: passadas `LIMITE_DE_RECUSAS_NA_JANELA`
 * recusas na janela, a recusa continua acontecendo e deixa de virar linha nova;
 * uma única linha de `EVENTO_TETO_DE_RECUSA` entra por janela, dizendo que o
 * padrão existe. É o mesmo desenho da trava de reautenticação, pelo mesmo
 * motivo: o tamanho do rastro não pode ser escolha de quem ataca.
 *
 * ----------------------------------------------------------------------------
 * O QUE O ACESSO DE SUPORTE **NÃO** DÁ
 * ----------------------------------------------------------------------------
 * Ele não abre registro nenhum. Com a autorização na mão, o operador alcança a
 * `SUPERFICIE_DO_SUPORTE` — e lá as tabelas de cliente respondem `count`, com
 * filtro FECHADO em colunas que não são conteúdo, e mais nada. `findMany` em
 * `Session` LANÇA; `session.count({ where: { pedido: { startsWith: 'a' } } })`
 * também, porque contagem com filtro livre sobre texto é leitura do texto.
 *
 * Isso é decisão de produto, e o caminho de crescer é declarado: escopo novo
 * (`ESCOPOS_DE_SUPORTE`) mais o par (modelo, operação) e os campos/filtros em
 * `SUPERFICIE_DO_SUPORTE`, com o motivo escrito.
 *
 * ----------------------------------------------------------------------------
 * DUAS CERCAS, DOIS LADOS DO BALCÃO
 * ----------------------------------------------------------------------------
 * `cercaDoCliente` (SUPERFICIE_DO_CLIENTE) serve `autorizar`, `listar` e
 * `revogar` — que rodam na sessão do PRÓPRIO cliente e por isso alcançam
 * `User.findFirst` (o papel de quem assina, lido do banco).
 * `cerca` (SUPERFICIE_DO_SUPORTE) serve `usar` — o operador da plataforma dentro
 * da casa do cliente. Ela NÃO tem `user`, e não pode ganhar: juntar as duas daria
 * ao operador a leitura que só o lado do cliente precisa.
 *
 * `usar()` abre o contexto DA EMPRESA CLIENTE (`comContexto({ orgId })`). É o
 * único ponto do console que faz isso, e é o que o acesso de suporte significa:
 * entrar na casa do cliente. Depois da virada para o papel restrito, essa troca
 * dá à conexão o alcance da policy daquela empresa — TODAS as tabelas dela. O
 * que contém isso é a cerca, e nada mais. Por isso a suíte mede a tentativa com
 * o papel restrito E com o papel dono: nos dois a cerca tem de recusar.
 */

/** O recorte do cliente Prisma que o LADO DO CLIENTE usa. Ver `cercar()`. */
interface PrismaDoCliente {
  acessoDeSuporte: {
    findFirst(args: unknown): Promise<LinhaDeAcesso | null>;
    findMany(args: unknown): Promise<LinhaDeAcesso[]>;
    count(args: unknown): Promise<number>;
    create(args: unknown): Promise<LinhaDeAcesso>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  user: { findFirst(args: unknown): Promise<unknown> };
}

/** O recorte que o LADO DA PLATAFORMA usa, com a autorização na mão. */
interface PrismaDoSuporte {
  acessoDeSuporte: {
    findMany(args: unknown): Promise<LinhaDeAcesso[]>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  session: { count(args: unknown): Promise<number> };
  approval: { count(args: unknown): Promise<number> };
  rotinaExecucao: { count(args: unknown): Promise<number> };
  eventLog: { count(args: unknown): Promise<number> };
}

interface LinhaDeAcesso {
  id: string;
  orgId: string;
  operadorEmail: string;
  operadorNome: string | null;
  escopo: string;
  motivo: string;
  autorizadoPorId: string;
  autorizadoPorNome: string;
  autorizadoEm: Date;
  expiraEm: Date;
  revogadoEm: Date | null;
  revogadoPorId: string | null;
  usos: number;
  ultimoUsoEm: Date | null;
  eventoId: string | null;
}

/**
 * Quem assina a autorização, do lado do cliente.
 *
 * `papeis` é o que o TOKEN DE SESSÃO diz, e serve para UMA coisa: recusar conta
 * de máquina cedo, antes de qualquer consulta. A autoridade que decide vem de
 * `lerAprovador`, do banco — ver o cabeçalho.
 */
export interface QuemAutoriza {
  id: string;
  nome: string;
  email: string;
  papeis: readonly string[];
  /** Endereço de origem, para o rastro da reautenticação. */
  ip?: string;
}

/** O operador da plataforma que tenta usar o acesso. */
export interface OperadorDaPlataforma {
  id: string;
  nome: string;
  email: string;
}

export interface AcessoNaTela {
  id: string;
  operadorEmail: string;
  operadorNome: string | null;
  escopo: string;
  motivo: string;
  autorizadoPorNome: string;
  autorizadoEm: string;
  expiraEm: string;
  revogadoEm: string | null;
  estado: 'valido' | 'expirado' | 'revogado';
  segundosRestantes: number;
  usos: number;
  ultimoUsoEm: string | null;
}

/** O que o escopo `diagnostico` devolve: três números e nenhum registro. */
export interface DiagnosticoDeSuporte {
  empresaId: string;
  escopo: EscopoDeSuporte;
  janelaHoras: number;
  sessoesNaJanela: number;
  sessoesQueFalharam: number;
  aprovacoesPendentes: number;
  rotinasQueFalharam: number;
  /** Quando o acesso usado acaba. A tela mostra a contagem regressiva. */
  acessoExpiraEm: string;
}

const JANELA_HORAS = 24;

/**
 * Quantas autorizações da mesma pessoa a decisão examina.
 *
 * Vinte e não uma: a versão anterior pegava a de `expiraEm` mais distante e
 * decidia sobre ela, o que ESCONDE a válida quando há duas vivas — uma revogada
 * de prazo longo ganhava da válida de prazo curto. E vinte e não "todas" porque
 * a lista é endereçada por `(orgId, operadorEmail, expiraEm)`, que é índice, e
 * ninguém acumula vinte autorizações vivas sem que isso já seja o problema.
 */
const CANDIDATAS_EXAMINADAS = 20;

@Injectable()
export class AcessoDeSuporteService {
  private readonly log = new Logger('AcessoDeSuporte');
  private readonly cercaDoCliente: PrismaDoCliente;
  private readonly cerca: PrismaDoSuporte;
  /** A mesma cerca do cliente, na forma que `lerAprovador` recebe. */
  private readonly prismaDoAprovador: PrismaService;

  constructor(
    prisma: PrismaService,
    private readonly eventos: EventLogService,
    /**
     * Só para uma pergunta: "esta empresa está registrada no console?". Ver
     * `usar()`. Não é um atalho para ler `EmpresaNaPlataforma` daqui — a leitura
     * acontece dentro da cerca do console, na empresa da plataforma.
     */
    private readonly console: ConsoleDaPlataformaService,
    /**
     * A PROVA DE PRESENÇA de R4. `@Optional()` pelo mesmo motivo que em
     * `ApprovalsService`: as suítes montam o serviço sem ele. E, também como
     * lá, a ausência RECUSA a autorização em vez de pulá-la — trava que depende
     * de serviço opcional é trava que some quando o serviço some.
     */
    @Optional() private readonly reauth?: ReauthService,
    /**
     * O relógio, injetável.
     *
     * Existe para a suíte poder ADIANTAR o tempo e provar a expiração por
     * TENTATIVA — a única forma de a expiração ser um mecanismo em vez de um
     * campo bonito. `@Optional()` porque o Nest não tem o que injetar aqui: em
     * produção é sempre `new Date()`.
     */
    @Optional() private readonly relogio: () => Date = () => new Date(),
  ) {
    this.cercaDoCliente = cercar(prisma, SUPERFICIE_DO_CLIENTE, 'cliente') as PrismaDoCliente;
    this.cerca = cercar(prisma, SUPERFICIE_DO_SUPORTE, 'suporte') as PrismaDoSuporte;
    this.prismaDoAprovador = this.cercaDoCliente as unknown as PrismaService;
  }

  private agora(): Date {
    return this.relogio();
  }

  // ==========================================================================
  // O LADO DO CLIENTE: autorizar, listar, revogar
  // ==========================================================================

  /**
   * O cliente autoriza um operador da plataforma a entrar, por um prazo.
   *
   * Roda no contexto da empresa do usuário autenticado — `tenantAtual()`, nunca
   * um id vindo do corpo do pedido. Autorizar acesso em empresa alheia não é uma
   * rota que exista.
   */
  async autorizar(pedido: PedidoDeAutorizacao, quem: QuemAutoriza): Promise<AcessoNaTela> {
    const orgId = tenantAtual('autorizar acesso de suporte');
    const agora = this.agora();
    const conferido = conferirPedido(pedido, agora);

    /*
     * AS QUATRO CONFERÊNCIAS DE R4, e nenhuma delas é decorativa.
     *
     * 1. GENTE, NÃO MÁQUINA — no token E no banco. `ia_servico` e `ia_acao`
     *    carregam `mcp.executar` e chegariam a qualquer rota que só pedisse
     *    permissão. Conceder acesso ao dado da empresa é decisão de pessoa
     *    (invariante 7 da escada). O token é a recusa BARATA, antes da consulta;
     *    o banco é a que decide.
     * 2. ALÇADA `titular`, LIDA DO BANCO. É a que R4 exige na política — a mesma
     *    tabela que a fila de aprovação consulta (`approvals/alcada.ts`), pela
     *    mesma consulta (`auth/aprovador.ts`). Do token ela duraria oito horas
     *    depois de a pessoa ser rebaixada.
     * 3. REAUTENTICAÇÃO. O degrau pede prova de presença, e aqui ela acontece.
     * 4. QUEM PEDE NÃO ASSINA. Se o e-mail que vai RECEBER o acesso é o mesmo de
     *    quem está assinando, isto é autoconcessão — e não importa que os dois
     *    estejam em empresas diferentes.
     */
    if (temPapelDeMaquina(quem.papeis)) {
      throw new ForbiddenException(
        'Conta de serviço (IA) não autoriza acesso de suporte: quem concede acesso é gente.',
      );
    }
    if (conferido.operadorEmail === quem.email.trim().toLowerCase()) {
      throw new ForbiddenException(
        'Ninguém autoriza acesso de suporte para si mesmo — quem pede não assina.',
      );
    }

    await this.exigirAutoridadeDoBanco(orgId, quem.id, 'sessao');

    if (EXIGE_REAUTENTICACAO) {
      if (!this.reauth) {
        throw new ForbiddenException(
          `Autorizar acesso de suporte é ${NIVEL_DA_AUTORIZACAO} e exige reautenticação: o ` +
            'verificador não está disponível nesta instância.',
        );
      }
      if (!pedido.senha) {
        throw new ForbiddenException(
          'Confirme a sua senha para autorizar o acesso de suporte: é uma ação ' +
            `${NIVEL_DA_AUTORIZACAO} ("Valor e acesso").`,
        );
      }
      /*
       * `aprovacaoId` NÃO é uma aprovação: é a CHAVE da fila e do teto de
       * tentativa dentro do `ReauthService`, que trabalha por
       * (empresa, pessoa, chave). Usar uma chave estável por empresa faz o teto
       * de senha valer para esta operação como vale para uma aprovação.
       *
       * O preço, registrado em FORA DO ESCOPO: a linha de auditoria que aquele
       * serviço grava diz `entityType: 'approval'`, porque o literal está lá
       * dentro — quem auditar vai procurar uma `Approval` com este id e não vai
       * achar. Consertar é uma linha em `src/auth/reauth.service.ts`, que não é
       * arquivo desta fatia.
       */
      const prova = await this.reauth.conferir({
        userId: quem.id,
        orgId,
        aprovacaoId: `suporte:${orgId}`,
        prova: { senha: pedido.senha },
        ip: quem.ip,
      });
      // A conferência de senha leva tempo (bcrypt). A autoridade é reconferida
      // com o que a prova acabou de ler, exatamente como em `confirm`.
      this.exigirAutoridade(prova.papeis, 'reautenticacao');
    }

    const linha = await this.cercaDoCliente.acessoDeSuporte.create({
      data: {
        orgId,
        operadorEmail: conferido.operadorEmail,
        operadorNome: conferido.operadorNome,
        escopo: conferido.escopo,
        motivo: conferido.motivo,
        autorizadoPorId: quem.id,
        autorizadoPorNome: quem.nome,
        autorizadoEm: agora,
        expiraEm: conferido.expiraEm,
      },
    });

    /*
     * O RASTRO vem DEPOIS da linha, e carrega o id dela — é o par que permite,
     * seis meses depois, ligar uma autorização ao evento encadeado que a
     * registrou. A ordem inversa (evento antes) gravaria um evento que aponta
     * para uma linha que pode não ter nascido.
     *
     * `sensibilidade: 'interna'`: o conteúdo aqui é e-mail de operador, motivo e
     * prazo — identificadores de operação, o mesmo que já vai para a auditoria.
     * Nada de dado de cliente entra neste evento.
     */
    const evento = await this.registrarNoRastro({
      orgId,
      tipo: EVENTO_AUTORIZADO,
      actorId: quem.id,
      conteudo: {
        argumentos: {
          acessoId: linha.id,
          operadorEmail: conferido.operadorEmail,
          escopo: conferido.escopo,
          minutos: conferido.minutos,
        },
        motivo: conferido.motivo,
        estadoAnterior: { acesso: 'nenhum' },
        estadoNovo: {
          acesso: 'autorizado',
          operadorEmail: conferido.operadorEmail,
          escopo: conferido.escopo,
          expiraEm: conferido.expiraEm.toISOString(),
        },
        aprovador: quem.nome,
        aprovadoEm: agora,
        reautenticado: EXIGE_REAUTENTICACAO,
      },
    });

    if (evento) {
      await this.cercaDoCliente.acessoDeSuporte.updateMany({
        where: { orgId, id: linha.id },
        data: { eventoId: evento },
      });
      linha.eventoId = evento;
    }

    this.log.log(
      `acesso de suporte autorizado por ${quem.nome} para ${conferido.operadorEmail} ` +
        `(escopo ${conferido.escopo}, ${conferido.minutos} min)`,
    );
    return paraTela(linha, agora);
  }

  /** O que o cliente vê: quem tem acesso à casa dele, e até quando. */
  async listar(): Promise<AcessoNaTela[]> {
    const orgId = tenantAtual('acessos de suporte');
    const agora = this.agora();
    const linhas = await this.cercaDoCliente.acessoDeSuporte.findMany({
      where: { orgId },
      orderBy: { autorizadoEm: 'desc' },
      take: 100,
    });
    return linhas.map((l) => paraTela(l, agora));
  }

  /**
   * O cliente revoga. Revogar é imediato e não espera o prazo.
   *
   * Idempotente: revogar duas vezes não move a data da primeira, senão a
   * segunda chamada apagaria o instante em que o acesso de fato acabou.
   *
   * REVOGAR NÃO EXIGE REAUTENTICAÇÃO, e a assimetria é deliberada: o degrau
   * protege a CONCESSÃO de acesso. Tirar acesso é sempre a direção segura, e
   * pedir senha para revogar seria um atrito na única ação que o cliente pode
   * precisar fazer com pressa.
   */
  async revogar(acessoId: string, quem: QuemAutoriza): Promise<AcessoNaTela> {
    const orgId = tenantAtual('revogar acesso de suporte');
    const agora = this.agora();
    const atual = await this.cercaDoCliente.acessoDeSuporte.findFirst({
      where: { orgId, id: acessoId },
    });
    if (!atual) throw new AutorizacaoInvalidaError('Acesso de suporte não encontrado.');
    if (atual.revogadoEm) return paraTela(atual, agora);

    await this.cercaDoCliente.acessoDeSuporte.updateMany({
      where: { orgId, id: acessoId },
      data: { revogadoEm: agora, revogadoPorId: quem.id },
    });

    await this.registrarNoRastro({
      orgId,
      tipo: EVENTO_REVOGADO,
      actorId: quem.id,
      conteudo: {
        argumentos: { acessoId, operadorEmail: atual.operadorEmail, escopo: atual.escopo },
        motivo: `revogado por ${quem.nome}`,
        estadoAnterior: { acesso: estadoDoAcesso(atual, agora) },
        estadoNovo: { acesso: 'revogado', revogadoEm: agora.toISOString() },
      },
    });
    return paraTela({ ...atual, revogadoEm: agora, revogadoPorId: quem.id }, agora);
  }

  // ==========================================================================
  // O LADO DA PLATAFORMA: usar o acesso — e só o que ele cobre
  // ==========================================================================

  /**
   * O operador da plataforma entra na empresa do cliente, se puder.
   *
   * A ordem é a defesa: abre o contexto da empresa, LÊ as autorizações, DECIDE,
   * e só então lê qualquer outra coisa. Recusa é registrada no RASTRO daquela
   * empresa (com teto) antes de a exceção subir — se a exceção subisse antes, a
   * tentativa negada sumiria, e ela é justamente o que interessa a quem audita.
   */
  async usar(
    empresaId: string,
    operador: OperadorDaPlataforma,
    escopo: string,
  ): Promise<DiagnosticoDeSuporte> {
    const id = (empresaId ?? '').trim();
    if (!id) throw new AutorizacaoInvalidaError('Informe a empresa.');

    /*
     * SÓ EMPRESA REGISTRADA NO CONSOLE. A conferência roda ANTES da troca de
     * contexto, e ainda dentro da empresa da plataforma.
     *
     * Ela impede que `empresaId`, que vem do corpo do pedido, abra o contexto de
     * uma empresa QUALQUER. O que ela NÃO faz — e a primeira versão desta fatia
     * dizia que fazia — é conter enchente do rastro: a semente da migration
     * registra todas as empresas, então "registrada" é quase sempre verdade.
     * Quem contém é o teto em `registrarRecusa`.
     *
     * `ConsoleDaPlataformaService` é injetado só por isto, e usa a cerca dele —
     * este serviço continua sem alcançar `EmpresaNaPlataforma` por conta
     * própria.
     */
    if (!(await this.console.empresa(id))) {
      throw new AutorizacaoInvalidaError(
        'Esta empresa não está registrada no console da plataforma.',
      );
    }

    const fora = contextoAtual();
    const agora = this.agora();

    return comContexto(
      {
        orgId: id,
        actorType: ActorType.user,
        actorId: operador.id,
        correlationId: fora?.correlationId ?? novaCorrelacao('suporte'),
        origem: fora?.origem ?? 'http',
      },
      async () => {
        /*
         * TODAS as autorizações desta pessoa nesta empresa, e a decisão escolhe.
         * Pegar "a de prazo mais longo" e decidir sobre ela escondia a válida
         * quando havia duas vivas — ver `escolherAcesso`.
         */
        const candidatas = await this.cerca.acessoDeSuporte.findMany({
          where: { orgId: id, operadorEmail: operador.email.trim().toLowerCase() },
          orderBy: { expiraEm: 'desc' },
          take: CANDIDATAS_EXAMINADAS,
        });

        const escolha = escolherAcesso(candidatas, operador.email, escopo, agora);
        if (!escolha.valida) {
          const recusa = escolha.recusa ?? 'sem_autorizacao';
          await this.registrarRecusa(id, operador, escopo, recusa, escolha.candidata, agora);
          throw new AcessoDeSuporteNegadoError(recusa, id);
        }
        const valido = escolha.valida;

        const desde = new Date(agora.getTime() - JANELA_HORAS * 3_600_000);
        const [sessoes, falhas, pendentes, rotinasComErro] = await Promise.all([
          this.cerca.session.count({ where: { orgId: id, criadaEm: { gte: desde } } }),
          this.cerca.session.count({
            where: { orgId: id, criadaEm: { gte: desde }, status: 'falhou' },
          }),
          this.cerca.approval.count({ where: { orgId: id, status: 'pendente' } }),
          this.cerca.rotinaExecucao.count({
            where: { orgId: id, inicioEm: { gte: desde }, status: 'erro' },
          }),
        ]);

        await this.cerca.acessoDeSuporte.updateMany({
          where: { orgId: id, id: valido.id },
          data: { usos: { increment: 1 }, ultimoUsoEm: agora },
        });

        await this.registrarNoRastro({
          orgId: id,
          tipo: EVENTO_USADO,
          actorId: operador.id,
          nivel: RiskLevel.R0,
          conteudo: {
            argumentos: {
              acessoId: valido.id,
              operadorEmail: operador.email,
              escopo,
              leu: 'contagens',
            },
            resultado: { sessoes, falhas, pendentes, rotinasComErro },
            motivo: valido.motivo,
          },
        });

        return {
          empresaId: id,
          escopo: escopo as EscopoDeSuporte,
          janelaHoras: JANELA_HORAS,
          sessoesNaJanela: sessoes,
          sessoesQueFalharam: falhas,
          aprovacoesPendentes: pendentes,
          rotinasQueFalharam: rotinasComErro,
          acessoExpiraEm: valido.expiraEm.toISOString(),
        };
      },
    );
  }

  // ==========================================================================

  /**
   * A autoridade de quem assina, SEGUNDO O BANCO — papel vigente, não o do
   * token de oito horas.
   *
   * A consulta é `lerAprovador` (`src/auth/aprovador.ts`), a mesma que a fila de
   * aprovação usa: uma cópia só de uma trava, porque duas cópias divergem. Ela
   * roda pela cerca do CLIENTE, que declara `user.findFirst` com `id` e `orgId`
   * no filtro e a relação `roles` com a coluna `key` — nada além disso.
   */
  private async exigirAutoridadeDoBanco(
    orgId: string,
    userId: string,
    fonte: string,
  ): Promise<void> {
    const doBanco = await lerAprovador(this.prismaDoAprovador, userId, orgId);
    if (!doBanco || !doBanco.ativo) {
      throw new ForbiddenException(
        'Quem autoriza acesso de suporte precisa ser um usuário ativo desta empresa.',
      );
    }
    this.exigirAutoridade(doBanco.papeis, fonte);
  }

  /** Gente, e com alçada `titular`. Recusa com a frase que a pessoa lê. */
  private exigirAutoridade(papeis: readonly string[], fonte: string): void {
    if (temPapelDeMaquina(papeis)) {
      throw new ForbiddenException(
        'Conta de serviço (IA) não autoriza acesso de suporte: quem concede acesso é gente.',
      );
    }
    const alcada = alcadaDe(papeis);
    if (!atendeAlcada(ALCADA_DA_AUTORIZACAO, alcada)) {
      this.log.warn(`alçada insuficiente para autorizar suporte (${fonte}): ${descreverAlcada(alcada)}`);
      throw new ForbiddenException(
        `Autorizar acesso de suporte é ${NIVEL_DA_AUTORIZACAO} ("Valor e acesso") e exige alçada ` +
          `${ALCADA_DA_AUTORIZACAO}. O seu perfil tem alçada ${descreverAlcada(alcada)}.`,
      );
    }
  }

  /**
   * Registra a tentativa negada no rastro do cliente — até o teto.
   *
   * Depois de `LIMITE_DE_RECUSAS_NA_JANELA` recusas na janela, a recusa segue
   * acontecendo e para de virar linha nova; uma única linha de teto entra por
   * janela. Evento do rastro não se apaga, então o teto é a diferença entre um
   * registro de auditoria e um depósito que qualquer operador enche.
   */
  private async registrarRecusa(
    orgId: string,
    operador: OperadorDaPlataforma,
    escopo: string,
    recusa: MotivoDaRecusa,
    acesso: LinhaDeAcesso | null,
    agora: Date,
  ): Promise<void> {
    this.log.warn(`acesso de suporte NEGADO a ${operador.email} na empresa ${orgId}: ${recusa}`);

    const desde = new Date(agora.getTime() - JANELA_DO_TETO_MINUTOS * 60_000);
    let acimaDoTeto = false;
    try {
      const recusadas = await this.cerca.eventLog.count({
        where: { orgId, tipo: EVENTO_NEGADO, ocorreuEm: { gte: desde } },
      });
      acimaDoTeto = recusadas >= LIMITE_DE_RECUSAS_NA_JANELA;
      if (acimaDoTeto) {
        const jaAvisado = await this.cerca.eventLog.count({
          where: { orgId, tipo: EVENTO_TETO_DE_RECUSA, ocorreuEm: { gte: desde } },
        });
        if (jaAvisado === 0) {
          await this.registrarNoRastro({
            orgId,
            tipo: EVENTO_TETO_DE_RECUSA,
            actorId: operador.id,
            nivel: RiskLevel.R0,
            conteudo: {
              argumentos: { operadorEmail: operador.email, escopo },
              resultado: {
                recusasNaJanela: recusadas,
                janelaMinutos: JANELA_DO_TETO_MINUTOS,
                observacao:
                  'teto atingido: as próximas tentativas negadas NÃO viram linha nova no rastro.',
              },
            },
          });
        }
      }
    } catch (e) {
      // Contar falhou: registra a recusa. Falha fechada aqui seria PERDER o
      // evento que mais interessa a quem audita para proteger o volume dele.
      this.log.error(`não consegui medir o teto de recusas: ${(e as Error).message}`);
      acimaDoTeto = false;
    }

    if (acimaDoTeto) return;

    await this.registrarNoRastro({
      orgId,
      tipo: EVENTO_NEGADO,
      actorId: operador.id,
      nivel: RiskLevel.R0,
      conteudo: {
        argumentos: { operadorEmail: operador.email, escopo, recusa },
        resultado: {
          recusa,
          acessoId: acesso?.id ?? null,
          expiraEm: acesso?.expiraEm?.toISOString() ?? null,
          agora: agora.toISOString(),
        },
      },
    });
  }

  /**
   * Grava no RASTRO e devolve o id do evento — ou `null` quando não deu.
   *
   * NÃO derruba a operação do cliente quando o registro falha, e a escolha é
   * consciente: o RASTRO é pré-condição de AÇÃO EXTERNA (é isso que a porta
   * garante), e o que acontece aqui é uma linha de banco que já existe. Derrubar
   * a autorização por causa do registro deixaria o cliente sem conseguir
   * autorizar suporte num incidente — que é exatamente quando ele precisa. A
   * falha sai como erro no log, alto.
   */
  private async registrarNoRastro(evento: {
    orgId: string;
    tipo: string;
    actorId: string;
    nivel?: RiskLevel;
    conteudo: Record<string, unknown>;
  }): Promise<string | null> {
    try {
      const linha = await this.eventos.registrar({
        orgId: evento.orgId,
        tipo: evento.tipo,
        actorType: ActorType.user,
        actorId: evento.actorId,
        // O padrão é R4 porque o evento padrão desta família é a AUTORIZAÇÃO, e
        // autorizar acesso é "Valor e acesso" na escada. Uso e recusa passam
        // R0 explicitamente: ler contagem não é mudança de acesso.
        nivel: evento.nivel ?? RiskLevel.R4,
        correlationId: contextoAtual()?.correlationId ?? null,
        conteudo: evento.conteudo,
        sensibilidade: 'interna',
      });
      return linha.id;
    } catch (e) {
      this.log.error(
        `NÃO consegui registrar "${evento.tipo}" no RASTRO da empresa ${evento.orgId}: ` +
          `${(e as Error).message}. A operação seguiu; o registro NÃO existe.`,
      );
      return null;
    }
  }
}

function paraTela(l: LinhaDeAcesso, agora: Date): AcessoNaTela {
  return {
    id: l.id,
    operadorEmail: l.operadorEmail,
    operadorNome: l.operadorNome,
    escopo: l.escopo,
    motivo: l.motivo,
    autorizadoPorNome: l.autorizadoPorNome,
    autorizadoEm: l.autorizadoEm.toISOString(),
    expiraEm: l.expiraEm.toISOString(),
    revogadoEm: l.revogadoEm?.toISOString() ?? null,
    estado: estadoDoAcesso(l, agora),
    segundosRestantes: segundosRestantes(l, agora),
    usos: l.usos,
    ultimoUsoEm: l.ultimoUsoEm?.toISOString() ?? null,
  };
}
