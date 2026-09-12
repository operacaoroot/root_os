import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ActorType, ApprovalState } from '@prisma/client';
import { z } from 'zod';
import { ApprovalsService } from './approvals.service';
import { AcoesService } from '../gateway/acoes.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { enderecoDeOrigem } from '../auth/endereco-de-origem';
import { corpoDaRecusa } from '../integrations/conectores';
import { exigirTenant } from '../common/contexto-execucao';
import { PrismaService } from '../prisma/prisma.service';
import { ToolGateway } from '../gateway/tool-gateway.service';
import { alcadaDe, atendeAlcada, descreverAlcada, exigeMotivo } from './alcada';

const CreateApprovalSchema = z.object({
  resourceType: z.enum(['lead', 'task', 'campaign', 'content']),
  resourceId: z.string().min(1),
  changes: z.record(z.unknown()),
  summary: z.string().optional(),
});

/*
 * O CORPO DA CONFIRMAÇÃO — como quem decide prova que é ele, e por que decidiu.
 *
 * Nada do que a ação FAZ entra aqui: os argumentos executados são os gravados na
 * passagem pela porta. O que quem confirma manda é (1) como ele prova que é ele
 * — a senha, ou a prova curta obtida em `POST /auth/reautenticar` — e (2) o
 * MOTIVO, que R4 e R5 exigem por escrito (RF-A-03) e que até 11/09/2026 este
 * schema RECUSAVA: `.strict()` sem o campo transformava "mandar o motivo" em
 * erro 400, e a coluna `Approval.motivo` nunca saía de `null`.
 *
 * `.strict()` continua: campo desconhecido no corpo de uma confirmação R4 é
 * tentativa de mexer no que não é dela, e devolver 400 diz isso alto.
 */
const ConfirmarSchema = z
  .object({
    reauth: z
      .union([
        z.object({ senha: z.string().min(1) }).strict(),
        z.object({ token: z.string().min(1) }).strict(),
      ])
      .optional(),
    /*
     * O tamanho mínimo NÃO é conferido aqui, e é de propósito: quem sabe se este
     * nível exige motivo é a aprovação gravada, não o formato do corpo. Um `min`
     * no schema recusaria com 400 um R3 que mandou duas palavras, e deixaria a
     * regra de verdade (`MINIMO_DO_MOTIVO`, do pacote de política) escondida em
     * dois lugares.
     */
    motivo: z.string().max(2000).optional(),
  })
  .strict();

/** A permissão que a tela e as rotas de LEITURA da fila exigem (fatia 3.10). */
const VER = 'aprovacoes.ver';
/** A permissão de DECIDIR — confirmar ou rejeitar. Não é alçada; ver `alcada.ts`. */
const DECIDIR = 'aprovacoes.decidir';

/*
 * A FILA COMO SUPERFÍCIE DE TRABALHO — o que `GET /approvals/fila` devolve.
 *
 * `listar()` do serviço devolve o suficiente para uma LISTA (resumo, nível,
 * quanto tempo esperando). Para DECIDIR falta o que importa: o conteúdo exato
 * que vai sair, os gatilhos que acenderam o degrau, quem propôs e — a parte que
 * a onda 7 tornou obrigatória — QUEM PODE ASSINAR, já descontado quem propôs.
 *
 * Por que aqui e não num serviço próprio: o `ApprovalsModule` não é desta fatia
 * e `approvals.service.ts` foi mexido em três ondas seguidas, com travas finas
 * demais para receber carona. A montagem é só leitura e não decide nada — está
 * anotada no relatório para virar um `fila.service.ts` quando der para editar o
 * módulo.
 */
interface PessoaQueDecide {
  id: string;
  nome: string;
  email: string;
  /** A alçada VINDA DO BANCO — a mesma fonte que `confirm` relê ao decidir. */
  alcada: ReturnType<typeof alcadaDe>;
  /** Tem `aprovacoes.decidir` por algum perfil? Também lido do banco. */
  decide: boolean;
}

/** Em que gaveta da tela o item cai. */
type Gaveta = 'esperando' | 'confirmada' | 'expirou' | 'recusada';

/*
 * OS TETOS DA FILA — e por que eles são constantes com nome.
 *
 * Uma fila que devolve tudo é uma fila que um dia devolve trinta mil linhas com
 * conteúdo de mensagem dentro. O teto fica; o que não pode ficar é o teto
 * SILENCIOSO: até esta correção a resposta trazia `total: itens.length`, que é
 * o total DEPOIS do corte — quem lesse 100 acreditava que eram 100. Agora a
 * resposta carrega o total de verdade (`total`, por `count`), quantas linhas
 * vieram (`mostrando`) e se houve corte (`truncado`), e a tela avisa.
 */
const TETO_VIVAS = 100;
const TETO_FECHADAS = 60;
/** Pessoas lidas para montar "quem pode aprovar" e o censo. */
const TETO_PESSOAS = 500;

// Fluxo de aprovação de ação sensível (proposta → confirmação humana → escrita).
// A escrita real (PATCH /leads etc.) exige o token emitido aqui (ver ApprovalGuard).
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('approvals')
export class ApprovalsController {
  constructor(
    private readonly approvals: ApprovalsService,
    private readonly acoes: AcoesService,
    /*
     * O cliente do banco, só para MONTAR a fila (leitura). O `PrismaModule` é
     * `@Global`, então injetar aqui não pede edição no `ApprovalsModule` — que
     * não é arquivo desta fatia.
     */
    private readonly prisma: PrismaService,
    /*
     * A PORTA, e ela entra aqui por UMA razão só: `conferirAprovado`, que é a
     * metade SÓ-LEITURA da execução (não chama efeito, não escreve no banco,
     * não registra evento). Sem ela a tela oferecia botão que a execução
     * recusa — e a recusa é cara, porque acontece DEPOIS de a aprovação já ter
     * virado `confirmada`, que é irreversível para a fila.
     *
     * `GatewayModule` é `@Global`, então injetar aqui também não pede edição no
     * `ApprovalsModule`.
     */
    private readonly gateway: ToolGateway,
    /*
     * NÃO HÁ `PolicyService` AQUI, e a ausência é a correção da fatia 5.5.
     *
     * A primeira versão injetava a política para UMA pergunta — quais chaves do
     * catálogo entram no hash do conteúdo — porque este controlador conferia o
     * vínculo ao conteúdo. Ele não confere mais: a conferência foi para o
     * estrangulamento (`AcoesService.executarAprovada`), que é onde os argumentos
     * são lidos e entregues ao efeito. Ver `impedimentoDeExecucao`.
     */
  ) {}

  /*
   * A FILA. Existia proposta, confirmação e consulta por id, mas não existia
   * "o que está esperando" — e sem isso a fila não é superfície de trabalho,
   * é uma caixa que só quem já sabe o id consegue abrir.
   */
  @Get()
  @RequirePermissions(VER)
  listar(@CurrentUser() user: JwtUser, @Query('status') status?: string) {
    const valido = status && (Object.values(ApprovalState) as string[]).includes(status);
    return this.approvals.listar(
      // Mesma razão da `fila`: rota de LISTA sem empresa resolvida devolve a
      // lista de todo mundo, e o Prisma não reclama. `listar()` do serviço não
      // faz esta conferência (o arquivo não é desta fatia) — ela vale aqui, que
      // é por onde o HTTP entra.
      exigirTenant(user.orgId, 'ApprovalsController.listar'),
      valido ? (status as ApprovalState) : ApprovalState.pendente,
    );
  }

  /*
   * A FILA INTEIRA, PRONTA PARA DECIDIR — RF-A-05.
   *
   * DECLARADA ANTES DE `@Get(':id')` de propósito: o Nest casa rota na ordem em
   * que o método aparece na classe, e `:id` engoliria `fila`.
   *
   * O QUE ELA RESPONDE, E DE ONDE VEM CADA COISA:
   *
   *   · o que espera / o que expirou / o que foi recusado → quatro consultas na
   *     tabela `Approval`, todas com `orgId`. `listar()` do serviço só devolve
   *     UM estado por chamada e descarta o pendente já vencido (`expiraEm > now`),
   *     que é justamente o item que a pessoa procura quando pergunta "cadê aquilo
   *     que eu ia aprovar";
   *   · o CONTEÚDO EXATO que vai sair → `ToolCall.args`, os argumentos GRAVADOS
   *     na passagem pela porta. São os mesmos bytes que `executarAprovada` manda
   *     ao efeito — não uma reconstrução. Quando a capacidade é `restrita`, a
   *     porta já gravou redigido (`{ redigido: true, chaves }`) e é isso que
   *     aparece, com o aviso. **SÓ PARA QUEM PODE DECIDIR** — ver o bloco
   *     `A EXPOSIÇÃO DE CONTEÚDO` logo abaixo;
   *   · o que IMPEDE a execução hoje → `ToolGateway.conferirAprovado`, a metade
   *     só-leitura do disparo. Ela responde as três perguntas que a execução faz
   *     e a fila não antecipava: a capacidade ainda está no catálogo desta
   *     empresa, a régua de HOJE ainda permite, e os argumentos gravados ainda
   *     casam com o `argsSchema` atual. As três recusam DEPOIS de a aprovação
   *     virar `confirmada` — estado sem saída pela fila. Perguntando aqui, o
   *     item vira explicação em vez de botão;
   *   · os GATILHOS que acenderam o degrau → `PolicyDecision.sinais`, pela
   *     `decisionId` que a aprovação guarda. Não recalculamos nada: sinal é do
   *     momento da proposta, e recalcular aqui mostraria a régua de agora sobre
   *     um pedido de ontem;
   *   · QUEM PODE APROVAR → os usuários ATIVOS da empresa, com os papéis e as
   *     permissões lidos do BANCO, filtrados por (1) ter `aprovacoes.decidir`,
   *     (2) ter alçada que alcança a `alcadaMinima` da linha e (3) não ser quem
   *     propôs. As três são as mesmas perguntas que `confirm` faz — se a tela
   *     usasse o token da sessão, ela prometeria o que a trava recusa.
   *
   * ---------------------------------------------------------------------------
   * A EXPOSIÇÃO DE CONTEÚDO — decisão do Pedro, registrada no relatório
   * ---------------------------------------------------------------------------
   * Esta rota é a PRIMEIRA superfície de requisição do repositório a devolver os
   * argumentos de uma chamada de ferramenta. Antes dela ninguém lia isso por
   * HTTP: o RASTRO já trocava conteúdo `confidencial` por resumo criptográfico
   * (`EventLogService`), e a redação que a porta grava em `ToolCall.args` só
   * alcança a sensibilidade `restrita` — a `confidencial`, que é a do corpo de
   * uma mensagem de WhatsApp, vai em claro na coluna. Ou seja: a fatia não
   * ampliou de um para seis quem lê o corpo; ampliou de ZERO para seis.
   *
   * A regra, decidida e não inferida: **o conteúdo exato vai só para quem pode
   * DECIDIR**. É a assinatura informada que justifica a exposição — quem vai
   * responder pelo envio precisa ler o que assina. Quem tem apenas
   * `aprovacoes.ver` recebe a fila inteira (resumo, nível, gatilhos, prazo,
   * quem assina) SEM o conteúdo, e a tela diz por quê.
   *
   * Fica de pé uma exposição menor e declarada: quem decide lê o conteúdo de
   * QUALQUER domínio, porque a fila não filtra por módulo. Está no relatório
   * como pergunta.
   *
   * ---------------------------------------------------------------------------
   * `expirada` NÃO É ESCRITA AQUI — e o agendador que a escreveria não existe
   * ---------------------------------------------------------------------------
   * Pendente com prazo vencido aparece na gaveta "expirou" por CÁLCULO. Uma rota
   * de leitura que escreve é uma rota que, num GET repetido por engano, decide o
   * destino de uma ação — por isso o cálculo.
   *
   * A verdade sobre o estado: `ApprovalsService.expirarVencidas()` existe e
   * **NÃO TEM CHAMADOR NENHUM** no repositório (conferido em 11/09/2026, por
   * varredura do nome). Não há agendador. Quem de fato muda `pendente` para
   * `expirada` é `confirm`, quando alguém tenta confirmar uma vencida. O efeito
   * prático é que a coluna `status` guarda `pendente` para sempre em toda
   * aprovação que ninguém tocou — o que esta tela desenha certo e uma consulta
   * SQL ingênua lê errado. É dívida declarada, está no relatório.
   */
  @Get('fila')
  @RequirePermissions(VER)
  async fila(@CurrentUser() user: JwtUser) {
    // Empresa resolvida ANTES da primeira consulta, como manda a casa
    // (02-CONSTRAINTS, RF-T-04): `findMany({ where: { orgId: undefined } })` é
    // um filtro que o Prisma ignora, e o que sobra é "a fila de todo mundo".
    // Um token sem `orgId` é erro, nunca "todas as empresas".
    const orgId = exigirTenant(user.orgId, 'ApprovalsController.fila');
    const agora = new Date();

    const vivasEm = { orgId, status: { in: [ApprovalState.pendente, ApprovalState.confirmada] } };
    const fechadasEm = { orgId, status: { in: [ApprovalState.expirada, ApprovalState.rejeitada] } };

    const [vivas, fechadas, pessoas, quantasVivas, quantasFechadas, quantasPessoas] =
      await Promise.all([
        this.prisma.approval.findMany({
          where: vivasEm,
          orderBy: { criadoEm: 'asc' },
          take: TETO_VIVAS,
        }),
        this.prisma.approval.findMany({
          where: fechadasEm,
          orderBy: { criadoEm: 'desc' },
          take: TETO_FECHADAS,
        }),
        this.quemDecide(orgId),
        // Os totais REAIS, para o teto parar de mentir. Três contagens por
        // índice (`@@index([orgId, status, expiraEm])`), não três varreduras.
        this.prisma.approval.count({ where: vivasEm }),
        this.prisma.approval.count({ where: fechadasEm }),
        this.prisma.user.count({ where: { orgId, isActive: true } }),
      ]);

    const linhas = [...vivas, ...fechadas];
    const toolCallIds = linhas.map((a) => a.toolCallId).filter((v): v is string => !!v);
    const decisionIds = linhas.map((a) => a.decisionId).filter((v): v is string => !!v);
    /*
     * Os ids que são de GENTE — para trocar identificador por nome na tela.
     * Proponente só quando `propostoPorTipo` diz que é pessoa: a porta grava
     * `'agente'` (ou o slug) quando quem propôs foi máquina, e procurar isso na
     * tabela de usuários é uma consulta que nunca acha nada.
     */
    const idsDePessoa = new Set<string>();
    for (const a of linhas) {
      if (a.propostoPorTipo === ActorType.user) idsDePessoa.add(a.propostoPorId);
      if (a.aprovadoPorId) idsDePessoa.add(a.aprovadoPorId);
    }

    const [chamadas, decisoes, proponentes] = await Promise.all([
      toolCallIds.length
        ? this.prisma.toolCall.findMany({
            where: { orgId, id: { in: toolCallIds } },
            select: { id: true, args: true, capabilityId: true, agentSlug: true, correlationId: true },
          })
        : Promise.resolve([]),
      decisionIds.length
        ? this.prisma.policyDecision.findMany({
            where: { orgId, id: { in: decisionIds } },
            select: { id: true, sinais: true, motivo: true, nivelBase: true },
          })
        : Promise.resolve([]),
      idsDePessoa.size
        ? this.prisma.user.findMany({
            where: { orgId, id: { in: [...idsDePessoa] } },
            select: { id: true, name: true, email: true },
          })
        : Promise.resolve([]),
    ]);

    const porChamada = new Map(chamadas.map((c) => [c.id, c]));
    const porDecisao = new Map(decisoes.map((d) => [d.id, d]));
    const porPessoa = new Map(proponentes.map((p) => [p.id, p]));

    /*
     * EU, SEGUNDO O BANCO — e não segundo o token.
     *
     * O token vale oito horas; papel rebaixado, perfil trocado ou usuário
     * desativado só aparecem na releitura. É a mesma consulta que alimenta
     * "quem pode aprovar", então a tela e a trava falam da mesma linha.
     *
     * `undefined` quer dizer que quem está olhando não é usuário ativo desta
     * empresa — acontece com token recém-revogado. Nesse caso não há alçada
     * nenhuma, e nenhum botão aparece.
     */
    const eu = pessoas.find((p) => p.id === user.sub);

    /*
     * DECIDIR, SEGUNDO O BANCO **E** SEGUNDO O TOKEN — as duas coisas.
     *
     * A tela lê do banco (é a fonte que `confirm` relê) e a TRAVA da rota lê do
     * token, que dura oito horas. As duas divergem em duas direções:
     *
     *   · promovido no meio da sessão — o banco já diz que decide, o token ainda
     *     não carrega `aprovacoes.decidir`, e o `PermissionsGuard` responde
     *     "Permissão insuficiente" antes de o controlador rodar. Sem esta
     *     conjunção a tela mostrava o botão e a pessoa levava uma recusa
     *     genérica, sem saber que o conserto é sair e entrar de novo;
     *   · rebaixado no meio da sessão — o token ainda carrega a chave, o banco
     *     já não; aí quem recusa é `confirm`, relendo o papel. O botão também
     *     não deve aparecer.
     *
     * Falha fechada nas duas: precisa das duas fontes concordando.
     */
    const tokenDecide = (user.permissions ?? []).includes(DECIDIR);
    const decideAgora = (eu?.decide ?? false) && tokenDecide;

    const itens = linhas.map((ap) => {
      const chamada = ap.toolCallId ? porChamada.get(ap.toolCallId) : undefined;
      const decisao = ap.decisionId ? porDecisao.get(ap.decisionId) : undefined;
      const vencida = ap.expiraEm <= agora;
      const gaveta: Gaveta =
        ap.status === ApprovalState.rejeitada
          ? 'recusada'
          : ap.status === ApprovalState.expirada || (ap.status === ApprovalState.pendente && vencida)
            ? 'expirou'
            : ap.status === ApprovalState.confirmada
              ? 'confirmada'
              : 'esperando';

      const aprovadores = pessoas.filter(
        (p) => p.decide && p.id !== ap.propostoPorId && atendeAlcada(ap.alcadaMinima, p.alcada),
      );
      const souOProponente = ap.propostoPorId === user.sub;

      /*
       * O QUE IMPEDE A EXECUÇÃO — perguntado à porta, sem custar nada.
       *
       * Só para as gavetas em que a pergunta muda alguma coisa: uma aprovação
       * recusada ou expirada não vai executar de jeito nenhum, e a conferência
       * ali só produziria texto assustador sobre uma linha encerrada.
       */
      const impedimento =
        chamada && ap.capabilityId && (gaveta === 'esperando' || gaveta === 'confirmada')
          ? this.impedimentoDaPorta(
              orgId,
              ap.capabilityId,
              (chamada.args ?? {}) as Record<string, unknown>,
            )
          : null;

      const posso =
        gaveta === 'esperando' &&
        !impedimento &&
        decideAgora &&
        aprovadores.some((p) => p.id === user.sub);

      const proponente = porPessoa.get(ap.propostoPorId);
      return {
        id: ap.id,
        gaveta,
        status: ap.status,
        nivel: ap.nivelExigido,
        nivelBase: decisao?.nivelBase ?? null,
        resumo: ap.resumo,
        capacidade: ap.capabilityId,
        canal: ap.canal,
        recurso: { tipo: ap.resourceType, id: ap.resourceId },
        agente: chamada?.agentSlug ?? null,
        correlationId: chamada?.correlationId ?? null,
        /*
         * O CONTEÚDO EXATO — e só para quem pode DECIDIR (ver o bloco da rota).
         *
         * `null` também quando a aprovação é da superfície antiga (as cinco
         * rotas com @SensitiveWrite), que não retém ação nenhuma — lá quem
         * executa é a própria rota, com o token, e não há argumento gravado. Os
         * dois casos são `null`, e é `conteudoOculto` que os distingue: sem essa
         * bandeira a tela diria "esta ação não leva argumento" para quem, na
         * verdade, não tem permissão de lê-los.
         */
        conteudo: decideAgora && chamada ? (chamada.args ?? {}) : null,
        // `!!chamada` na conta: sem ação retida não há conteúdo NENHUM para
        // ocultar, e dizer "você não pode ver" sobre o que não existe é outra
        // frase falsa — só que na direção oposta.
        conteudoOculto: !decideAgora && !!chamada,
        /**
         * Os 12 primeiros do `contentHash` GRAVADO na aprovação. É identificador
         * — serve para casar esta linha com a do RASTRO e com a do `ToolCall` —,
         * NÃO é prova conferida: ninguém recalcula o hash sobre o conteúdo aqui,
         * nem no servidor nem no navegador. Quem o confere de verdade é a porta,
         * no momento de propor. O rótulo da tela diz isso com todas as letras.
         */
        hashDoConteudo: ap.contentHash.slice(0, 12),
        /**
         * O que a execução recusaria HOJE, em português, ou `null`. Vem da
         * metade só-leitura da porta — nunca de uma segunda régua escrita aqui.
         *
         * VAI PARA TODO MUNDO QUE VÊ A FILA, inclusive quem não recebe o
         * conteúdo, e isso foi conferido: as frases da porta carregam o id da
         * capacidade e NOMES de campo do `argsSchema` (`validacao.ts` monta a
         * mensagem só com `campo` e `problema`), nunca VALORES. Nome de campo do
         * catálogo é informação pública do produto; o texto que sairia, não.
         */
        impedimento,
        gatilhos: decisao?.sinais ?? [],
        motivoDaRegua: decisao?.motivo ?? null,
        exigeReauth: ap.exigeReauth,
        exigeMotivo: exigeMotivo(ap.nivelExigido),
        alcadaMinima: ap.alcadaMinima,
        proponente: {
          id: ap.propostoPorId,
          tipo: ap.propostoPorTipo,
          nome: proponente?.name ?? (ap.propostoPorTipo === ActorType.ai ? 'agente' : ap.propostoPorId),
        },
        propostaEm: ap.criadoEm.toISOString(),
        expiraEm: ap.expiraEm.toISOString(),
        esperandoMs: agora.getTime() - ap.criadoEm.getTime(),
        decididoPor: ap.aprovadoPorId ? (porPessoa.get(ap.aprovadoPorId)?.name ?? ap.aprovadoPorId) : null,
        decididoEm: ap.aprovadoEm?.toISOString() ?? null,
        motivo: ap.motivo,
        /** Quem, hoje, pode assinar ESTA linha. Vazio = ninguém, e a tela diz. */
        aprovadores: aprovadores.map((p) => ({
          id: p.id,
          nome: p.nome,
          email: p.email,
          alcada: descreverAlcada(p.alcada),
        })),
        euPossoAprovar: posso,
        porQueNao: posso
          ? null
          : this.porQueNao({
              gaveta,
              souOProponente,
              eu,
              minima: ap.alcadaMinima,
              impedimento,
              tokenDecide,
            }),
      };
    });

    return {
      agora: agora.toISOString(),
      eu: {
        id: user.sub,
        alcada: descreverAlcada(eu?.alcada ?? null),
        decide: eu?.decide ?? false,
        /**
         * Decide NESTA SESSÃO (banco e token concordando) — é o que governa o
         * botão e a entrega do conteúdo.
         */
        decideNestaSessao: decideAgora,
        /** Recebe o conteúdo exato? Hoje é a mesma resposta de `decideNestaSessao`. */
        veConteudo: decideAgora,
      },
      /*
       * O CENSO DA EMPRESA, e ele existe para a tela ser HONESTA em vez de
       * parecer quebrada. Hoje a ROOT tem um usuário só com alçada — então toda
       * ação que ele mesmo propôs fica sem quem a assine (invariante 7). Sem este
       * número, a tela mostraria "ninguém pode aprovar" com cara de defeito.
       */
      censo: {
        pessoasQueDecidem: pessoas.filter((p) => p.decide && p.alcada).length,
        porAlcada: {
          titular: pessoas.filter((p) => p.decide && p.alcada === 'titular').length,
          responsavel: pessoas.filter((p) => p.decide && p.alcada === 'responsavel').length,
          operador: pessoas.filter((p) => p.decide && p.alcada === 'operador').length,
        },
        /*
         * O censo também tem teto, e ele também precisa se anunciar: acima de
         * `TETO_PESSOAS` usuários ativos o número vira uma amostra, e "uma pessoa
         * só com alçada" seria uma afirmação falsa sobre a empresa.
         */
        pessoasLidas: pessoas.length,
        pessoasAtivas: quantasPessoas,
        truncado: quantasPessoas > pessoas.length,
      },
      itens,
      /*
       * `total` é o TOTAL, não o que coube. Até esta correção ele era
       * `itens.length` — o número depois do corte —, e a tela jurava que 100
       * eram todas. `mostrando` e `truncado` completam a frase.
       */
      total: quantasVivas + quantasFechadas,
      mostrando: itens.length,
      truncado: quantasVivas > vivas.length || quantasFechadas > fechadas.length,
      tetos: { vivas: TETO_VIVAS, fechadas: TETO_FECHADAS, pessoas: TETO_PESSOAS },
    };
  }

  /**
   * A CONFERÊNCIA SÓ DE LEITURA DA PORTA — o motivo, em vez da exceção.
   *
   * Mesmo padrão de `AcoesService.conectorDesligado()`, e pelo mesmo motivo
   * escrito lá: quem decide o transporte é quem chama. `confirm` relança o erro
   * inteiro (com o 403/400 que a porta escolheu); a fila usa só a frase, para
   * virar explicação na tela.
   *
   * `conferirAprovado` NÃO TOCA EM NADA — não chama efeito, não escreve no
   * banco, não registra evento — e é toda em memória: resolve a capacidade no
   * catálogo já carregado, reclassifica e valida os argumentos contra o
   * `argsSchema`. Chamá-la uma vez por item da fila não custa ida ao banco.
   */
  private conferirSemLancar(
    orgId: string,
    capabilityId: string,
    args: Record<string, unknown>,
  ): unknown | null {
    try {
      this.gateway.conferirAprovado({ capabilityId, args, orgId });
      return null;
    } catch (e) {
      return e;
    }
  }

  /** A mesma conferência, já reduzida à frase que a tela mostra. */
  private impedimentoDaPorta(
    orgId: string,
    capabilityId: string,
    args: Record<string, unknown>,
  ): string | null {
    const erro = this.conferirSemLancar(orgId, capabilityId, args);
    return erro ? (erro as Error).message : null;
  }

  /**
   * A mesma conferência para UMA aprovação, buscando o que ela retém — o que
   * `confirm` chama antes de mexer no estado.
   *
   * Devolve o ERRO, não a frase, para quem chama poder relançá-lo com o status
   * que a porta escolheu. `null` quando não há o que conferir: aprovação
   * inexistente (quem reclama do id errado é `confirm`, para não dar duas
   * mensagens ao mesmo engano), aprovação da superfície antiga (sem ação retida)
   * ou chamada retida que sumiu (quem reclama é `executarAprovada`).
   *
   * ---------------------------------------------------------------------------
   * O VÍNCULO AO CONTEÚDO **NÃO** ESTÁ AQUI — e isso é deliberado
   * ---------------------------------------------------------------------------
   * A primeira versão da fatia 5.5 conferia o vínculo NESTA função, e também no
   * serviço do canal de WhatsApp. Duas superfícies, e o script de terminal
   * (`src/scripts/aprovar.ts`) em nenhuma das duas. Pior: conferir aqui e LER os
   * argumentos lá dentro (`AcoesService.executarAprovada`) deixa uma janela entre
   * a conferência e o uso, e quem consegue escrever em `ToolCall.args` — o modelo
   * de ameaça declarado — troca o conteúdo nessa janela.
   *
   * A conferência foi para o ESTRANGULAMENTO: `AcoesService.executarAprovada`,
   * imediatamente antes de a aprovação virar `consumida`, sobre a mesma variável
   * que desce para o efeito. Os três chamadores ficam cobertos por uma checagem
   * só, e não há janela. Ver o cabeçalho de `gateway/acoes.service.ts`.
   *
   * O que continua aqui é o que sempre foi daqui: reclassificar com a régua de
   * hoje e revalidar o FORMATO dos argumentos, sem tocar em nada.
   */
  private async impedimentoDeExecucao(orgId: string, approvalId: string): Promise<unknown | null> {
    exigirTenant(orgId, 'ApprovalsController.impedimentoDeExecucao');
    const ap = await this.prisma.approval.findFirst({
      where: { id: approvalId, orgId },
      select: { capabilityId: true, toolCallId: true, resourceType: true, contentHash: true },
    });
    if (!ap?.capabilityId || !ap.toolCallId) return null;

    const chamada = await this.prisma.toolCall.findFirst({
      where: { id: ap.toolCallId, orgId },
      select: { args: true },
    });
    if (!chamada) return null;

    return this.conferirSemLancar(
      orgId,
      ap.capabilityId,
      (chamada.args ?? {}) as Record<string, unknown>,
    );
  }

  /**
   * As pessoas ativas da empresa, com alçada e permissão de decidir — do BANCO.
   *
   * `roles.permissions` e não a lista de `ROLES` do pacote compartilhado: quem
   * decide de verdade é o vínculo gravado (`Role` → `Permission`), e é ele que o
   * `PermissionsGuard` vai encontrar no token da próxima sessão. Ler do código
   * mostraria o perfil que o repositório DESENHOU, não o que a empresa tem.
   */
  private async quemDecide(orgId: string): Promise<PessoaQueDecide[]> {
    const linhas = await this.prisma.user.findMany({
      where: { orgId, isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        roles: { select: { key: true, permissions: { select: { key: true } } } },
      },
      orderBy: { name: 'asc' },
      take: TETO_PESSOAS,
    });
    return linhas.map((u) => ({
      id: u.id,
      nome: u.name,
      email: u.email,
      // `alcadaDe` devolve `null` para conta de máquina e para papel
      // desconhecido — as duas caem fora de "quem pode aprovar" sozinhas.
      alcada: alcadaDe(u.roles.map((r) => r.key)),
      decide: u.roles.some((r) => r.permissions.some((p) => p.key === DECIDIR)),
    }));
  }

  /**
   * A frase que a tela mostra no lugar do botão.
   *
   * A ORDEM É A DAS TRAVAS DE `confirm`, e isso não é detalhe: se a tela
   * explicasse "falta alçada" para quem é o proponente, a pessoa iria pedir papel
   * a quem administra e continuaria sendo recusada pelo mesmo motivo de antes.
   *
   * O IMPEDIMENTO VEM PRIMEIRO entre as travas de uma linha que espera, porque
   * ele é a única que não é sobre QUEM olha: ninguém executa aquela ação hoje, e
   * dizer "falta alçada" a quem tem alçada mandaria a pessoa procurar o problema
   * errado. As duas gavetas encerradas continuam falando antes de tudo — nelas
   * não há execução para impedir.
   */
  private porQueNao(entrada: {
    gaveta: Gaveta;
    souOProponente: boolean;
    eu: PessoaQueDecide | undefined;
    minima: string;
    impedimento: string | null;
    /** O token desta sessão carrega `aprovacoes.decidir`? */
    tokenDecide: boolean;
  }): string {
    const { gaveta, souOProponente, eu, minima, impedimento, tokenDecide } = entrada;
    if (gaveta === 'expirou') return 'O prazo desta aprovação venceu. Peça ao agente para propor de novo.';
    if (gaveta === 'recusada') return 'Esta ação já foi recusada.';
    if (gaveta === 'confirmada') {
      return (
        'Já foi confirmada e a execução não concluiu. A aprovação NÃO foi consumida e nada saiu, ' +
        'mas confirmar de novo não é possível — daqui só se recusa. ' +
        (impedimento ?? 'Se o motivo foi o conector do canal, ele se conserta em Conexões.')
      );
    }
    if (impedimento) return impedimento;
    if (souOProponente) {
      return 'Você propôs esta ação, e quem propõe não assina. Ela precisa de outra pessoa com alçada.';
    }
    if (!eu) return 'Sua sessão não corresponde a um usuário ativo desta empresa. Entre de novo.';
    if (!eu.decide) return 'Seu perfil acompanha a fila, mas não decide nela (falta "aprovacoes.decidir").';
    if (!tokenDecide) {
      return (
        'Seu perfil passou a decidir na fila DEPOIS que esta sessão começou. A permissão viaja no ' +
        'token, que dura horas: saia e entre de novo para ela valer — até lá o botão levaria uma ' +
        'recusa genérica.'
      );
    }
    if (!atendeAlcada(minima, eu.alcada)) {
      return `Esta ação exige alçada "${minima}" e a sua é "${descreverAlcada(eu.alcada)}".`;
    }
    return 'Esta ação não está esperando decisão.';
  }

  @Post()
  /*
   * PROPOR CONTINUA SENDO `mcp.executar`, e de propósito.
   *
   * Esta é a superfície ANTIGA — quem chama é quem vai EXECUTAR a ferramenta
   * logo em seguida com o token (`/pauta` publica assim). Trocá-la por
   * `aprovacoes.*` misturaria "pedir" com "assinar": a fatia 3.10 separou os dois
   * justamente para que a conta que age não seja a que autoriza.
   */
  @RequirePermissions('mcp.executar')
  create(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const input = CreateApprovalSchema.parse(body);
    return this.approvals.create({ orgId: user.orgId, actorId: user.sub, ...input });
  }

  /*
   * Confirmar EXECUTA. Sem isto a fila era um museu: a ação ficava retida,
   * alguém confirmava, e nada saía.
   *
   * A execução usa os argumentos gravados na passagem pela porta, nunca os que
   * chegam nesta requisição — é o que impede trocar o texto entre a aprovação
   * e o envio.
   *
   * SÃO QUATRO PASSOS, E A ORDEM É O DESENHO (RF-G-06, 11/09/2026):
   *
   *   1. o conector desta aprovação ainda está ligado?
   *   2. a porta ainda deixaria esta ação sair? (catálogo, régua de hoje,
   *      formato dos argumentos — `conferirAprovado`, só leitura);
   *   3. confirmar (a aprovação vira `confirmada`, o token nasce);
   *   4. executar.
   *
   * O PASSO 2 EXISTE PELO MESMO MOTIVO DO 1, e foi o que reprovou a primeira
   * versão desta rota. As três conferências dele já eram feitas — mas dentro de
   * `executarAprovada`, DEPOIS do `confirm`. Recusando ali, a aprovação ficava
   * `confirmada` e não consumida: some da fila (`listar` devolve pendentes),
   * `confirm` recusa o que não está pendente, e o único caminho que restava era
   * recusar e propor de novo. A tela, enquanto isso, oferecia o botão — porque
   * ela não perguntava nada disso.
   *
   * Perguntando aqui, a recusa custa zero: a aprovação continua PENDENTE e o
   * mesmo botão volta a funcionar quando a capacidade voltar ao catálogo, a
   * régua voltar a permitir ou alguém propuser com os argumentos de hoje.
   *
   * O passo 1 vem ANTES do 3 porque `confirm` é IRREVERSÍVEL para a fila: uma
   * vez `confirmada`, a aprovação sai de `listar` (que devolve as pendentes) e
   * `confirm` passa a recusá-la ("Aprovação já confirmada"). Perguntar depois de
   * confirmar deixava a ação num limbo do qual nenhuma superfície a tirava — e
   * desmentia a frase que o próprio operador lê na recusa, que promete que
   * religar restabelece o uso sem nova autorização.
   *
   * Perguntando antes, a recusa é um 403 e NADA muda: a aprovação continua
   * pendente, continua na fila, e este mesmo botão volta a funcionar assim que
   * alguém religar o conector em Conexões.
   */
  @Post(':id/confirm')
  @RequirePermissions(DECIDIR)
  async confirm(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    /*
     * Corpo VAZIO continua válido: R2 e R3 não pedem reautenticação nem motivo,
     * e obrigar um `{}` na requisição quebraria a tela por nada. Quem decide o
     * que é obrigatório é a aprovação gravada (`exigeReauth`, `nivelExigido`),
     * nunca o formato do corpo.
     */
    const { reauth, motivo } = ConfirmarSchema.parse(body ?? {});

    /*
     * PASSO 1 — o interruptor, antes de mexer no estado da aprovação.
     *
     * `ForbiddenException` e não uma exceção de `integrations/`: o controlador
     * de aprovações não importa o módulo de integrações, pelo mesmo motivo que a
     * porta não importa (ver `gateway/interruptores.registry.ts`) — o import
     * aqui é do arquivo PURO de conectores, que não traz módulo nenhum junto. A
     * frase e o corpo vêm prontos de `montarRecusa`/`corpoDaRecusa`.
     *
     * O corpo leva o código `conector_desligado` em `error`, e é por ele que a
     * tela distingue esta recusa das outras para oferecer o caminho de conserto
     * (Conexões) em vez de mais uma caixa vermelha. `message` continua a frase
     * em português, então o `Error.message` não muda para quem já o conferia.
     */
    const desligado = await this.acoes.conectorDesligado(user.orgId, id, user.sub);
    if (desligado) throw new ForbiddenException(corpoDaRecusa(desligado));

    /*
     * PASSO 2 — a régua de HOJE, o catálogo de HOJE e o formato de HOJE.
     *
     * O erro é RELANÇADO INTEIRO, não reembrulhado: a porta já escolheu o
     * transporte de cada recusa (403 para capacidade fora do catálogo e para
     * classificação que não executa, 400 para argumento que não casa mais) e as
     * frases dela terminam dizendo que a aprovação NÃO foi consumida — o que só
     * é verdade porque esta chamada vem antes do `confirm` logo abaixo.
     */
    const impedimento = await this.impedimentoDeExecucao(user.orgId, id);
    if (impedimento) throw impedimento;

    const confirmada = await this.approvals.confirm(
      user.orgId,
      id,
      {
        id: user.sub,
        /*
         * Os papéis do token entram SÓ para a trava de "é gente": um token de
         * conta de serviço não decide nada, mesmo que o banco diga outra coisa.
         * A ALÇADA é decidida pelos papéis do banco, relidos dentro de
         * `confirm` — token de oito horas não sustenta autoridade.
         */
        papeis: user.roles ?? [],
        reauth,
        ip: enderecoDeOrigem(req),
      },
      motivo,
    );
    const execucao = await this.acoes.executarAprovada(user.orgId, id, user.sub);
    return { ...confirmada, execucao };
  }

  @Post(':id/reject')
  @RequirePermissions(DECIDIR)
  reject(@CurrentUser() user: JwtUser, @Param('id') id: string, @Req() req: any) {
    return this.approvals.reject(user.orgId, id, {
      id: user.sub,
      papeis: user.roles ?? [],
      ip: enderecoDeOrigem(req),
    });
  }

  @Get(':id')
  @RequirePermissions(VER)
  get(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.approvals.get(user.orgId, id);
  }
}
