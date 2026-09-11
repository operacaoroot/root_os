import { Injectable, Logger, Optional } from '@nestjs/common';
import { ActorType, ApprovalState, RiskLevel } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { PolicyService } from '../../policy/policy.service';
import { ApprovalsService } from '../../approvals/approvals.service';
import { atendeAlcada, descreverAlcada, exigeMotivo } from '../../approvals/alcada';
import { RECUSA_POR_VINCULO } from '../../approvals/vinculo-de-conteudo';
import { AcoesService } from '../acoes.service';
import { ToolGateway } from '../tool-gateway.service';
import { EventLogService, sigiloso } from '../event-log.service';
import { correlacaoAtual } from '../../common/contexto-execucao';
import { segredoDoCodigo } from './configuracao-do-canal';
import { sufixoVisivel } from './identidade-de-canal';
import { fraseDaRecusa, motivoParaNaoDecidir } from './pode-decidir-no-canal';
import { CANAL, identidadeDoCanal, type DecisorDoCanal } from './quem-decide';
import {
  codigoDaAprovacao,
  codigosIguais,
  lerRespostaDeCanal,
  pareceTentativaDeDecisao,
  type DecisaoDeCanal,
} from './resposta-de-canal';
import { textoDoFormato } from './pedido-no-canal';
import { EnvioDeAprovacaoService } from './envio-de-aprovacao.service';
import { TetoDeTentativas } from './teto-de-tentativas';

/*
 * ============================================================================
 * DECIDIR PELO CANAL — a mesma ação que a tela executaria (RF-A-06)
 * ============================================================================
 *
 * Este serviço é a quarta porta de entrada de conteúdo externo do sistema, e a
 * única em que o que entra DECIDE em vez de alimentar o modelo. O que a defende
 * está repartido em arquivos, de propósito, e cada um cobre uma pergunta:
 *
 *   · `resposta-de-canal.ts` — ISTO É UMA DECISÃO? Casamento literal contra uma
 *     linha inteira e exata. Nada é interpretado, nada é inferido, nada chega a
 *     modelo nenhum. Grupo, encaminhamento, citação, botão, mensagem editada e
 *     evento que não é `messages.upsert` morrem ali.
 *   · `identidade-de-canal.ts` + `quem-decide.ts` — DE QUEM É ESTA DECISÃO? Só
 *     endereço de telefone, casado por IGUALDADE contra `ChannelIdentity`, com
 *     papel, permissão e alçada lidos do BANCO agora.
 *   · `pode-decidir-no-canal.ts` — ESTE CANAL DECIDE ESTE TIPO DE COISA? Lista de
 *     permissão por capacidade e sensibilidade do efeito. Conferida na MONTAGEM
 *     do pedido e DE NOVO aqui.
 *   · `teto-de-tentativas.ts` — QUANTAS VEZES? O freio de custo.
 *   · este arquivo — A DECISÃO VALE? É aqui que a ordem das travas acontece.
 *
 * ----------------------------------------------------------------------------
 * IDENTIDADE NÃO CADASTRADA É **IGNORADA**, não recusada
 * ----------------------------------------------------------------------------
 * Silêncio absoluto: nenhuma resposta, nenhuma dica, nenhuma mudança de
 * comportamento observável. A rota devolve o mesmo corpo para tudo E DEVOLVE
 * ANTES DE PROCESSAR (ver o controlador) — este segundo detalhe é o que fecha o
 * oráculo de TEMPO, que a primeira versão desta fatia deixou aberto: número
 * conhecido varria até duzentas aprovações com um HMAC cada e fazia uma chamada
 * externa; desconhecido fazia uma consulta e uma escrita. A diferença de latência
 * separava as duas classes tão bem quanto uma resposta diferente separaria.
 *
 * O que NÃO é silencioso é o RASTRO: uma tentativa de decisão vinda de
 * identidade desconhecida é evento de segurança e fica registrada — com o número
 * marcado como sigiloso, para que o log append-only de cinco anos guarde a
 * possibilidade de CONFERIR um número suspeito sem guardar a lista de telefones
 * de ninguém. Conversa fiada do dia a dia não gera registro nenhum: só o que
 * casou com o formato de decisão, e só até o teto de tentativas.
 *
 * ----------------------------------------------------------------------------
 * QUEM PROPÔS NÃO APROVA — e o canal não pode virar a porta dos fundos disso
 * ----------------------------------------------------------------------------
 * A invariante 7 é conferida em três lugares diferentes, e nenhum deles é
 * redundância desperdiçada:
 *
 *   1. NA SAÍDA — `decisoresComCanal` tira o proponente da lista de quem recebe
 *      o pedido. Quem propôs não recebe o código;
 *   2. AQUI — antes de mexer em qualquer estado, para que a recusa não custe a
 *      aprovação e para que a pessoa receba a explicação certa;
 *   3. EM `ApprovalsService.confirm` — a trava de verdade, que vale para
 *      qualquer chamador, inclusive um que tenha errado as duas primeiras.
 *
 * ----------------------------------------------------------------------------
 * A ORDEM DAS TRAVAS É A MESMA DA TELA, E PELO MESMO MOTIVO
 * ----------------------------------------------------------------------------
 * `ApprovalsController.confirm` faz quatro passos: (1) conector ligado?
 * (2) a régua de hoje ainda deixa? (3) confirmar; (4) executar. Os dois
 * primeiros vêm ANTES do terceiro porque `confirm` é irreversível para a fila —
 * recusar depois deixa a aprovação `confirmada` e não consumida, um estado do
 * qual nenhuma superfície a tira. Esse defeito apareceu três vezes na história
 * deste módulo, com roupas diferentes; aqui ele não se repete porque este
 * serviço faz os mesmos quatro passos, na mesma ordem, chamando os mesmos
 * métodos.
 *
 * ----------------------------------------------------------------------------
 * O VÍNCULO AO CONTEÚDO **SAIU DAQUI** — e isso é o conserto, não o contrário
 * ----------------------------------------------------------------------------
 * A primeira versão conferia o vínculo neste arquivo E no controlador da fila.
 * Duas superfícies, e o script de terminal (`src/scripts/aprovar.ts`) em nenhuma
 * das duas — ele confirmava e executava sem conferência nenhuma. Pior: nas duas
 * que conferiam, a conferência acontecia ANTES e a leitura dos argumentos
 * acontecia DEPOIS, dentro de `executarAprovada`. Quem consegue escrever em
 * `ToolCall.args` — que é exatamente o modelo de ameaça que esta fatia declara —
 * trocava o conteúdo NA JANELA entre uma coisa e outra, e a linha do RASTRO saía
 * carimbada com o `contentHash` antigo. Era o buraco original, deslocado alguns
 * milissegundos.
 *
 * Agora a conferência mora no ESTRANGULAMENTO: `AcoesService.executarAprovada`,
 * imediatamente antes do `updateMany` que marca a aprovação como consumida, na
 * mesma função que lê os argumentos e os entrega ao efeito. Os três chamadores
 * passam por lá. O que este arquivo faz com isso é traduzir a recusa para a
 * conversa de quem decidiu (ver o `catch` de `aprovar`).
 */
@Injectable()
export class CanalDeAprovacaoService {
  private readonly log = new Logger('CanalDeAprovacao');

  /** O freio de custo. Ver `teto-de-tentativas.ts`. */
  private readonly teto = new TetoDeTentativas();

  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalsService,
    private readonly acoes: AcoesService,
    private readonly gateway: ToolGateway,
    private readonly envio: EnvioDeAprovacaoService,
    /*
     * O RASTRO e a POLÍTICA. `@Optional()` porque as suítes montam este serviço
     * à mão; a ausência do RASTRO NÃO vira permissão (o registro é o que se
     * perde, nunca a trava), e a ausência da POLÍTICA faz `motivoParaNaoDecidir`
     * responder `'sem-catalogo'` — que RECUSA decidir e NÃO invalida nada.
     */
    @Optional() private readonly eventos?: EventLogService,
    @Optional() private readonly policy?: PolicyService,
  ) {}

  /** O canal existe hoje? Segredos configurados E transporte inscrito. */
  get ligado(): boolean {
    return this.envio.ligado;
  }

  /**
   * Esquece o teto de tentativas. Só o teste usa — ver `teto-de-tentativas.ts`.
   */
  esquecerTentativas(): void {
    this.teto.esquecer();
  }

  /**
   * O WEBHOOK.
   *
   * Devolve sempre a mesma coisa para quem chama — um rótulo curto, para o log
   * do servidor. O que volta para a INTERNET é decidido pelo controlador, é
   * constante, e sai ANTES de este método terminar: ver lá.
   */
  async receber(orgId: string, evento: unknown): Promise<{ desfecho: string }> {
    if (!this.ligado) return { desfecho: 'canal-desligado' };

    const leitura = lerRespostaDeCanal(evento);
    if (leitura.tipo === 'ignorar') {
      /*
       * O LEMBRETE DE FORMATO — a ÚNICA resposta que sai para algo que não é
       * decisão, e ela sai só para quem JÁ É identidade cadastrada.
       *
       * Existe porque o operador que erra o formato (escreve "aprovar" e mais
       * uma palavra) receberia silêncio absoluto e concluiria que aprovou. Não
       * vira oráculo: quem não está cadastrado continua sem resposta nenhuma,
       * então o lembrete não revela nem que o código existe nem que o número é
       * conhecido para quem não seja o dono do número.
       */
      if (leitura.porque === 'fora-do-formato' && leitura.chaveDaIdentidade && leitura.texto) {
        if (pareceTentativaDeDecisao(leitura.texto)) {
          if (!this.teto.gastar(orgId, leitura.chaveDaIdentidade)) {
            return { desfecho: 'ignorado:teto-de-tentativas' };
          }
          const quem = await identidadeDoCanal(this.prisma as never, orgId, leitura.chaveDaIdentidade);
          if (quem) await this.envio.responder(quem.enderecoDoCanal, textoDoFormato());
        }
      }
      return { desfecho: `ignorado:${leitura.porque}` };
    }

    /*
     * O TETO, antes da primeira consulta e antes da primeira escrita.
     *
     * Daqui para baixo tudo custa: varrer as pendentes com um HMAC por linha,
     * escrever no RASTRO, mandar mensagem pela instância da ROOT. Estourado, o
     * caminho morre em silêncio — que é o mesmo silêncio de sempre, então nem o
     * teto vira oráculo.
     */
    if (!this.teto.gastar(orgId, leitura.chaveDaIdentidade)) {
      this.log.warn(
        `teto de tentativas do canal estourado na empresa ${orgId} (…${sufixoVisivel(leitura.chaveDaIdentidade)})`,
      );
      return { desfecho: 'ignorado:teto-de-tentativas' };
    }

    const quem = await identidadeDoCanal(this.prisma as never, orgId, leitura.chaveDaIdentidade);
    if (!quem) {
      await this.registrarTentativaAnonima(orgId, leitura.chaveDaIdentidade, leitura.decisao);
      return { desfecho: 'ignorado:identidade-nao-cadastrada' };
    }

    /*
     * Daqui para baixo quem está do outro lado É uma pessoa desta empresa, com
     * endereço cadastrado — então a recusa pode ser EXPLICADA. Cada `recusar`
     * abaixo devolve a frase para a conversa dela, e só para ela.
     */
    if (quem.maquina) {
      return this.recusar(
        quem,
        'Quem decide é gente: conta de serviço não confirma nem rejeita aprovação.',
        'conta-de-maquina',
      );
    }
    if (!quem.decide) {
      return this.recusar(
        quem,
        'Seu perfil acompanha a fila, mas não decide nela (falta "aprovacoes.decidir").',
        'sem-permissao',
      );
    }

    const ap = await this.acharPeloCodigo(orgId, leitura.codigo);
    if (!ap) {
      return this.recusar(
        quem,
        'Este código não corresponde a nenhuma aprovação esperando decisão. Ela pode já ter ' +
          'sido decidida, ou o prazo pode ter vencido — confira a fila no painel.',
        'codigo-sem-aprovacao',
      );
    }

    /*
     * AS TRAVAS QUE SÓ VALEM PARA O "SIM" — degrau, capacidade, alçada e
     * proponente.
     *
     * É a mesma assimetria que `ApprovalsService.reject` já assume, e pelo mesmo
     * motivo escrito lá: NEGAR NUNCA É MAIS ARRISCADO do que deixar como está.
     * Exigir titular para recusar emperraria a fila; recusar uma R4 pelo celular
     * não executa nada; recusar o que o canal não mostrou também não; e o
     * proponente recusando a própria proposta é ele desistindo, não ele se
     * autorizando.
     *
     * O que vale para o "não", e vale inteiro, é o de cima: ser identidade
     * cadastrada, ser gente e ter `aprovacoes.decidir`. Um "não" de quem não
     * decide nada apagaria a proposta de outra pessoa — que é a invariante 7 de
     * trás para frente.
     */
    return leitura.decisao === 'recusar'
      ? this.recusarAprovacao(orgId, ap, quem)
      : this.aprovar(orgId, ap, quem);
  }

  // ------------------------------------------------------------------ achar

  /** Os campos da aprovação que este canal lê. */
  private async acharPeloCodigo(orgId: string, codigo: string) {
    const segredo = segredoDoCodigo();
    if (!segredo) return null;

    /*
     * O código ENDEREÇA, não autoriza — então procurar por ele é varrer as
     * pendentes desta empresa e comparar. São no máximo `TETO` linhas e um HMAC
     * por linha (microssegundos); em troca, nada de coluna nova no banco e
     * nenhum índice por um valor derivado de segredo.
     *
     * Só PENDENTES e só DENTRO DO PRAZO: uma aprovação já confirmada, já
     * consumida, recusada ou vencida não é decidível por canal nenhum, e
     * responder "código desconhecido" para ela é a verdade do ponto de vista de
     * quem decide.
     */
    const TETO = 200;
    const linhas = await this.prisma.approval.findMany({
      where: { orgId, status: ApprovalState.pendente, expiraEm: { gt: new Date() } },
      orderBy: { criadoEm: 'desc' },
      take: TETO,
      select: {
        id: true,
        tokenHash: true,
        resourceType: true,
        resourceId: true,
        contentHash: true,
        resumo: true,
        capabilityId: true,
        toolCallId: true,
        nivelExigido: true,
        alcadaMinima: true,
        exigeReauth: true,
        propostoPorId: true,
      },
    });

    for (const linha of linhas) {
      if (codigosIguais(codigoDaAprovacao(segredo, orgId, linha.id, linha.tokenHash), codigo)) {
        return linha;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- decidir

  /**
   * A RECUSA PELO CANAL — o "não" é decisão, e decisão registrada.
   *
   * Passa por `ApprovalsService.reject`, que refaz as travas de "é gente" e "é
   * usuário ativo desta empresa" e grava `approval.reject` na auditoria. Não há
   * atalho: recusar pelo celular é o mesmo caminho de recusar na tela.
   */
  private async recusarAprovacao(
    orgId: string,
    ap: { id: string; resumo: string },
    quem: DecisorDoCanal,
  ): Promise<{ desfecho: string }> {
    await this.approvals.reject(orgId, ap.id, { id: quem.userId, papeis: [] });
    await this.envio.responder(
      quem.enderecoDoCanal,
      `Recusado. Nada saiu.\n${ap.resumo}`,
    );
    this.log.log(`aprovação ${ap.id} RECUSADA pelo canal por ${quem.userId}`);
    return { desfecho: 'recusada' };
  }

  /**
   * A APROVAÇÃO PELO CANAL — e a ordem é o desenho inteiro.
   *
   *   A. QUEM ESTÁ ASSINANDO PODE ASSINAR ISTO? Degrau, CAPACIDADE, alçada e
   *      invariante 7. São as travas que só valem para o "sim" (ver `receber`), e
   *      vêm antes de tudo porque nenhuma delas custa uma consulta a mais: a
   *      aprovação e a pessoa já estão em mãos.
   *   1. o conector desta aprovação ainda está ligado?
   *   2. a porta ainda deixaria esta ação sair? (catálogo, régua de hoje,
   *      formato dos argumentos — `conferirAprovado`, só leitura);
   *   3. confirmar (a aprovação vira `confirmada`);
   *   4. executar — e é DENTRO do 4, imediatamente antes de a aprovação virar
   *      `consumida`, que o VÍNCULO AO CONTEÚDO é conferido. Ver o cabeçalho.
   *
   * Os passos 1 e 2 vêm ANTES do 3 pelo mesmo motivo que na tela: `confirm` é
   * irreversível para a fila, e recusar depois dele deixa a aprovação num estado
   * de onde nada a tira. Aqui isso seria pior do que na tela — quem está do
   * outro lado é um celular, não uma pessoa olhando a fila, e não haveria quem
   * percebesse o item preso. A recusa por VÍNCULO é a exceção deliberada: ela é
   * terminal por desenho (`ApprovalsService.invalidarPorConteudo`), então não há
   * estado preso — a aprovação é DERRUBADA, e o caminho é repropor.
   *
   * Os passos 3 e 4 são EXATAMENTE os que o controlador chama, com os mesmos
   * argumentos: `approvals.confirm` e `acoes.executarAprovada`. É isso que faz
   * "aprovar pelo canal executa a mesma ação que a tela executaria e fecha o
   * mesmo evento" ser verdade por construção, e não por coincidência — o evento
   * `acao.executada`, o consumo do uso único, a correlação da proposta e o
   * conteúdo do RASTRO saem do mesmo código.
   *
   * A ALÇADA E A ALÇADA DE NOVO. `confirm` relê os papéis do banco e compara com
   * `alcadaMinima` por conta própria, em todo nível; a conferência que este
   * serviço fez antes não a substitui. `papeis: []` no `QuemAprova` é o
   * literalmente verdadeiro: não existe token de sessão neste caminho, então a
   * trava de "é gente" que olha a SESSÃO não tem o que olhar — e a que olha o
   * BANCO, que é a que decide, roda logo em seguida lá dentro. Este serviço
   * ainda recusa conta de máquina por conta própria, antes de chegar aqui.
   */
  private async aprovar(
    orgId: string,
    ap: {
      id: string;
      resourceType: string;
      contentHash: string;
      resumo: string;
      capabilityId: string | null;
      toolCallId: string | null;
      nivelExigido: RiskLevel;
      alcadaMinima: unknown;
      exigeReauth: boolean;
      propostoPorId: string;
    },
    quem: DecisorDoCanal,
  ): Promise<{ desfecho: string }> {
    /*
     * O DEGRAU QUE ESTE CANAL NÃO ALCANÇA, conferido de novo do lado de dentro.
     *
     * `EnvioDeAprovacaoService` já não manda código para R4/R5 (manda aviso sem
     * código), então em uso normal ninguém chega aqui. A trava fica porque
     * "ninguém tem o código" é uma propriedade do ENVIO, e trava não se apoia em
     * quem mandou a mensagem: quem tiver o segredo de derivação produz qualquer
     * código. O argumento inteiro — por que reautenticar por WhatsApp não
     * existe — está em `envio-de-aprovacao.service.ts`.
     */
    if (ap.exigeReauth || exigeMotivo(String(ap.nivelExigido))) {
      return this.recusar(
        quem,
        `Esta ação é ${ap.nivelExigido} e exige reautenticação e motivo escrito. O WhatsApp não ` +
          'prova identidade — decida no painel.',
        'degrau-fora-do-canal',
      );
    }

    /*
     * A CAPACIDADE — a MESMA conferência que a montagem do pedido fez, feita de
     * novo aqui, e pelo mesmo motivo do degrau acima: o envio decide o que SAI,
     * e trava não se apoia no que saiu. Quem tiver o segredo de derivação produz
     * o código de uma aprovação de `email.enviar` que este canal nunca ofereceu.
     *
     * `sem-catalogo` recusa SEM invalidar: a aprovação continua na fila e a tela
     * decide. Era a incoerência apontada na revisão — o canal derrubava a
     * aprovação quando a política faltava, e o controlador pulava a conferência.
     * Uma regra só: sem catálogo, não se decide, e não se destrói nada.
     */
    const recusa = motivoParaNaoDecidir({
      capabilityId: ap.capabilityId,
      sensibilidade: this.sensibilidadeDe(orgId, ap.capabilityId),
      temCatalogo: !!this.policy,
    });
    if (recusa) {
      this.log.warn(
        `aprovação ${ap.id} (${ap.capabilityId ?? 'sem capacidade'}) NÃO é decidível pelo canal: ${recusa}`,
      );
      return this.recusar(quem, fraseDaRecusa(recusa), `capacidade-${recusa}`);
    }

    /*
     * A ALÇADA, do BANCO. `confirm` a relê e compara de novo por conta própria —
     * esta conferência não a substitui: ela recusa ANTES de mexer no estado da
     * aprovação, para que a recusa não custe a linha.
     */
    if (!atendeAlcada(ap.alcadaMinima, quem.alcada)) {
      return this.recusar(
        quem,
        `Esta ação exige alçada "${ap.alcadaMinima}" e a sua é "${descreverAlcada(quem.alcada)}".`,
        'alcada-insuficiente',
      );
    }

    // Invariante 7 — o segundo dos três lugares em que ela é conferida.
    if (ap.propostoPorId === quem.userId) {
      return this.recusar(
        quem,
        'Você propôs esta ação, e quem propõe não assina. Ela precisa de outra pessoa com alçada.',
        'proponente',
      );
    }

    // Passo 1 — o interruptor do conector, antes de mexer no estado.
    const desligado = await this.acoes.conectorDesligado(orgId, ap.id, quem.userId);
    if (desligado) {
      return this.recusar(quem, desligado.motivo, 'conector-desligado');
    }

    // Passo 2 — a régua de hoje, o catálogo de hoje, o formato de hoje.
    const impedimento = await this.impedimento(orgId, ap);
    if (impedimento) return this.recusar(quem, impedimento, 'impedimento-da-porta');

    // Passos 3 e 4 — os mesmos do controlador. O vínculo ao conteúdo é conferido
    // DENTRO do 4, imediatamente antes do consumo.
    try {
      await this.approvals.confirm(orgId, ap.id, { id: quem.userId, papeis: [] });
      const execucao = await this.acoes.executarAprovada(orgId, ap.id, quem.userId);
      const desfecho =
        execucao.status === 'executado'
          ? 'Aprovado e executado.'
          : `Aprovado, mas nada saiu: ${'motivo' in execucao ? execucao.motivo : execucao.status}.`;
      await this.envio.responder(quem.enderecoDoCanal, `${desfecho}\n${ap.resumo}`);
      this.log.log(`aprovação ${ap.id} APROVADA pelo canal por ${quem.userId} (${execucao.status})`);
      return { desfecho: `aprovada:${execucao.status}` };
    } catch (e) {
      /*
       * Uma recusa vinda de `confirm` ou do estrangulamento. A frase dela já é
       * em português e já diz o que aconteceu com a aprovação — repassá-la é
       * melhor do que inventar uma. O erro NÃO é engolido: ele volta para o log
       * com o id, e a aprovação ficou no estado que o método que lançou escolheu.
       *
       * O VÍNCULO QUEBRADO ganha rótulo próprio no desfecho porque é a única
       * recusa deste caminho que DERRUBA a aprovação — quem lê o log precisa
       * distinguir "não deu para executar agora" de "esta aprovação morreu".
       */
      const motivo = (e as Error).message;
      const derrubada = motivo === RECUSA_POR_VINCULO;
      this.log.warn(
        `aprovação ${ap.id} pelo canal ${derrubada ? 'DERRUBADA por vínculo' : 'falhou'}: ${motivo}`,
      );
      await this.envio.responder(quem.enderecoDoCanal, motivo);
      return { desfecho: derrubada ? 'derrubada:quebrado' : 'erro' };
    }
  }

  // --------------------------------------------------------------- auxiliar

  /** A sensibilidade do efeito, do catálogo. `undefined` = não dá para saber. */
  private sensibilidadeDe(orgId: string, capabilityId: string | null): string | undefined {
    if (!capabilityId || !this.policy) return undefined;
    return this.policy.resolverCapacidade(orgId, capabilityId)?.efeito?.sensibilidade;
  }

  /**
   * A metade SÓ-LEITURA da porta, reduzida à frase — mesmo padrão do
   * `impedimentoDaPorta` da tela. Não toca em nada e não custa a aprovação.
   */
  private async impedimento(
    orgId: string,
    ap: { capabilityId: string | null; toolCallId: string | null },
  ): Promise<string | null> {
    if (!ap.capabilityId || !ap.toolCallId) return null;
    const chamada = await this.prisma.toolCall.findFirst({
      where: { id: ap.toolCallId, orgId },
      select: { args: true },
    });
    if (!chamada) return null;
    try {
      this.gateway.conferirAprovado({
        capabilityId: ap.capabilityId,
        args: (chamada.args ?? {}) as Record<string, unknown>,
        orgId,
      });
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }

  /** Responde a quem é cadastrado, e devolve o rótulo para o log. */
  private async recusar(
    quem: DecisorDoCanal,
    frase: string,
    rotulo: string,
  ): Promise<{ desfecho: string }> {
    await this.envio.responder(quem.enderecoDoCanal, frase);
    return { desfecho: `recusado:${rotulo}` };
  }

  /**
   * TENTATIVA DE DECISÃO DE QUEM NÃO É NINGUÉM AQUI.
   *
   * Registra e não responde. O número vai marcado como SIGILOSO — o RASTRO
   * guarda o resumo criptográfico e o tamanho, nunca o texto (ver `sigiloso`) —
   * mais os quatro últimos dígitos em claro, que é o que permite a alguém
   * reconhecer o próprio número numa investigação sem que o log vire uma lista
   * de telefones de cinco anos.
   *
   * O TETO já foi gasto antes desta chamada: sem ele, cada mensagem de um número
   * desconhecido virava uma linha append-only de cinco anos que ninguém apaga.
   */
  private async registrarTentativaAnonima(
    orgId: string,
    chave: string,
    decisao: DecisaoDeCanal,
  ): Promise<void> {
    this.log.warn(
      `tentativa de ${decisao} pelo canal vinda de identidade NÃO CADASTRADA ` +
        `(…${sufixoVisivel(chave)}) — ignorada`,
    );
    await this.registrar({
      orgId,
      tipo: 'canal.decisao.ignorada',
      // `system` e não `user`: não há pessoa nenhuma do outro lado — é o ponto
      // inteiro do evento. Carimbar `user` com ator nulo diria que alguém desta
      // casa agiu, que é o contrário do que aconteceu.
      actorType: ActorType.system,
      actorId: null,
      capabilityId: null,
      toolCallId: null,
      nivel: null,
      contentHash: null,
      payload: {
        canal: CANAL,
        decisao,
        motivo: 'identidade-nao-cadastrada',
        remetente: sigiloso(chave, 'whatsapp'),
        sufixo: sufixoVisivel(chave),
      },
      conteudo: { resumo: 'decisão por canal recusada: remetente desconhecido', canal: CANAL },
    });
  }

  /**
   * Uma linha no RASTRO, ou nada. O registro NUNCA derruba o caminho — essa é a
   * regra da casa, e aqui ela pesa mais: derrubar a resposta a um webhook por
   * causa do log faria a Evolution reentregar a mesma mensagem em laço.
   */
  private async registrar(entrada: {
    orgId: string;
    tipo: string;
    /** Quem agiu. `system` quando não há pessoa nenhuma do outro lado. */
    actorType?: ActorType;
    actorId: string | null;
    capabilityId: string | null;
    toolCallId: string | null;
    nivel: RiskLevel | null;
    contentHash: string | null;
    payload: Record<string, unknown>;
    conteudo: Record<string, unknown>;
  }): Promise<void> {
    if (!this.eventos) return;
    try {
      await this.eventos.registrar({
        orgId: entrada.orgId,
        tipo: entrada.tipo,
        actorType: entrada.actorType ?? ActorType.user,
        actorId: entrada.actorId,
        capabilityId: entrada.capabilityId,
        toolCallId: entrada.toolCallId,
        nivel: entrada.nivel,
        correlationId: correlacaoAtual() ?? null,
        payload: entrada.payload as never,
        contentHash: entrada.contentHash,
        conteudo: entrada.conteudo,
        // O que entra por este canal é `confidencial` por natureza: é mensagem
        // de gente. Declarar a sensibilidade é o que faz o `EventLogService`
        // trocar conteúdo cru por resumo criptográfico (RF-R-04).
        sensibilidade: 'confidencial',
      });
    } catch (e) {
      this.log.warn(`não deu para registrar "${entrada.tipo}": ${(e as Error).message}`);
    }
  }
}
