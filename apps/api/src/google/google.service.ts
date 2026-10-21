import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  lerTituloDeReuniao,
  montarTituloDeReuniao,
  type ModalidadeDeReuniao,
  type ReuniaoDaAgenda,
} from '@mktos/shared';
import { arquivoDoDriveEhLegivel } from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MAX_BYTES_DO_ARQUIVO_LIDO, consultaDoDrive, leituraDoArquivo, type OpcoesDaListaDoDrive } from './drive-das-atas';
import { PdfIlegivelError, textoDoPdf } from './texto-do-pdf';
import { EfeitosRegistry, type ContextoDoEfeito } from '../gateway/efeitos.registry';
import { CofreService, SegredoIndisponivelError } from '../cofre/cofre.service';
import { NOMES_CONHECIDOS } from '../cofre/segredo';
import { CONECTOR_DO_GOOGLE } from '../cofre/migrar-credenciais';
import {
  PRAZO_DA_CHAMADA_DE_SONDA_MS,
  RegistroDeConectores,
} from '../integrations/conectores.registry';
import { revogacaoFoiSuperada } from '../integrations/revogacao-superada';
import {
  type ConectorDoContrato,
  type ContextoDoVerbo,
  type ResultadoDeAutorizacao,
  type ResultadoDeRevogacao,
  type ResultadoDeSincronizacao,
  type SaudeDeConector,
  conectado,
  erroDeConector,
  frasedoErro,
  naoConfigurado,
} from '../integrations/contrato-de-conector';

// Conector Google (OAuth 2.0) — Gmail/Agenda/Docs/Drive. Credencial PRÓPRIA do root
// (google.env), tokens guardados por org (isolado do escritório). Escopos read+write
// (a escrita entra pelo fluxo de aprovação; reads já expostos).
/**
 * Um arquivo `.md` visto dentro de uma vault do Obsidian que mora no Drive.
 *
 * `caminho` é relativo à raiz da vault e usa `/`, igual ao que o lado do
 * filesystem produz com `relative()` — as duas fontes precisam gerar a MESMA
 * chave, senão trocar de fonte reindexaria tudo como nota nova e arquivaria a
 * memória da origem antiga.
 *
 * `modificadoEm` é o que permite pular o download do que não mudou. Ele vem da
 * listagem, de graça: é a diferença entre reler 152 arquivos a cada meia hora
 * e reler só os que alguém tocou.
 */
export interface ArquivoDeVaultNoDrive {
  id: string;
  nome: string;
  caminho: string;
  modificadoEm: Date;
  bytes: number;
}

const SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
];

@Injectable()
export class GoogleService implements OnModuleInit {
  private readonly log = new Logger('GoogleService');
  private readonly clientId = process.env.GOOGLE_CLIENT_ID ?? '';
  private readonly clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
  private readonly redirectUri = process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:4000/api/google/callback';
  private readonly webBase = process.env.WEB_ORIGIN?.split(',')[0] ?? 'http://localhost:4000';

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly efeitos: EfeitosRegistry,
    /** O contrato único de conector (fatia 5.4) — módulo `@Global`. */
    private readonly contrato: RegistroDeConectores,
    /**
     * O COFRE (fatia 5.3). `@Optional()` pelos dois motivos que o consumidor da
     * bio já documenta: a suíte constrói este serviço à mão, e cofre ausente tem
     * de significar "use a coluna de origem" e não "o Google parou". Ver
     * `credencialDoCofre`.
     */
    @Optional() private readonly cofre?: CofreService,
  ) {}

  get configured(): boolean {
    return this.clientId.length > 0 && this.clientSecret.length > 0;
  }

  /*
   * ==========================================================================
   * O CONECTOR DECLARA AS CAPACIDADES QUE REALIZA — fatia 3.3
   * ==========================================================================
   *
   * Até 11/09/2026 o `GoogleController` chamava estes nove métodos direto: o
   * e-mail saía, o evento nascia e o documento era criado com a régua R0–R5 sem
   * nunca ter visto a ação. Quatro escritas externas vivas em produção,
   * autenticadas só por JWT e permissão de papel — sem classificação de risco,
   * sem retenção por aprovação, sem RASTRO e fora do alcance do interruptor de
   * conector. Era item de segurança, não de arquitetura.
   *
   * Agora a rota pede a capacidade à porta (`PortaDoOperador`), e quem a porta
   * chama é a função registrada AQUI.
   *
   * POR QUE A INSCRIÇÃO MORA DENTRO DO CONECTOR, e não num arquivo de fiação:
   * a catraca de arquitetura (`test/arquitetura.test.ts`) proíbe qualquer
   * arquivo fora de `src/gateway/` de importar um serviço de conector — e
   * proíbe também re-exportá-lo, justamente para que a proibição não tenha
   * atalho. Um `google-efeitos.service.ts` ao lado seria uma violação nova. O
   * conector importar o REGISTRO é o inverso, e é permitido: quem depende de
   * quem continua certo, e o `GatewayModule` é `@Global`, então isto não mexe
   * no grafo de módulos.
   *
   * OS ARGUMENTOS SÃO OS DO CATÁLOGO, em português, e não os do corpo HTTP. É o
   * catálogo que a porta valida (`argsSchema`) e é ele que a aprovação assina
   * pelo hash do conteúdo; o controlador traduz o corpo da requisição para cá.
   * Traduzir no controlador e não aqui é o que mantém uma única forma de
   * argumento entre o caminho do agente e o caminho da tela.
   */
  onModuleInit(): void {
    /*
     * ========================================================================
     * ESTE CONECTOR NÃO SE INSCREVE EM `ConectoresConfiguradosRegistry`
     * ========================================================================
     *
     * E a ausência é a decisão, não o esquecimento. A primeira versão desta
     * fatia inscreveu as quatro chaves do Google (`gmail`, `gcal`, `gdocs`,
     * `drive`) com `() => this.configured` — e `configured` aqui é
     * `GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET`, uma propriedade do PROCESSO.
     * Em produção ela é verdadeira para todo mundo.
     *
     * O efeito na tela de Conexões foi o oposto do pretendido: para uma empresa
     * que NUNCA autorizou o Google não existe linha em `IntegrationAccount`,
     * então a tela caía na derivação, recebia `true` e passava a exibir o Google
     * como CONECTADO. A fatia existia para tornar a tela honesta e a deixou
     * menos honesta do que antes.
     *
     * As quatro superfícies são de AUTORIZAÇÃO POR EMPRESA, e o estado
     * verdadeiro delas é a linha que `handleCallback` escreve logo abaixo. Sem
     * inscrição, o registro devolve `null` — "ninguém respondeu por esta chave"
     * —, a tela usa o registro do banco e volta a dizer a verdade.
     *
     * Quem precisa distinguir "o app não tem credencial" de "esta empresa não
     * autorizou" tem `GET /google/status`, que devolve `configured` e
     * `connected` em campos separados. O raciocínio completo está no cabeçalho
     * de `gateway/conectores-configurados.registry.ts`.
     */
    /*
     * ========================================================================
     * O CONTRATO ÚNICO, ESSE SIM, ELE IMPLEMENTA — fatia 5.4
     * ========================================================================
     *
     * E a diferença em relação ao registro de cima é exatamente o que fazia
     * falta: `ConectoresConfiguradosRegistry` pergunta "o PROCESSO tem
     * credencial?", uma propriedade do ambiente; o contrato pergunta "ESTA
     * EMPRESA consegue usar isto AGORA?", que é a pergunta que a tela sempre
     * precisou fazer. Por isso a inscrição LÁ continua ausente e a inscrição
     * AQUI existe: a saúde do contrato recebe `orgId` e só responde verde depois
     * de uma chamada de verdade com o token desta empresa.
     */
    this.contrato.registrar(this.descritorDoContrato(), 'GoogleService');

    const texto = (v: unknown): string => String(v ?? '').trim();
    const numero = (v: unknown, padrao: number): number => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.min(Math.trunc(n), 50) : padrao;
    };

    this.efeitos.registrar({
      // ---------- leitura (R0) ----------
      'comunicacao.email.buscar': (a, org) =>
        this.gmailRecent(org, texto(a.q ?? a.busca), numero(a.limite, 10)),
      'comunicacao.email.ler': (a, org) => this.gmailGet(org, texto(a.id)),
      'comunicacao.agenda.listar': (a, org) => this.calendarUpcoming(org, numero(a.limite, 10)),
      // A agenda de um INTERVALO. `numero()` trava em 50, que serve a uma lista
      // e não a um mês inteiro de calendário — daí o teto próprio.
      'comunicacao.agenda.periodo': (a, org) =>
        this.calendarPeriodo(org, texto(a.de), texto(a.ate), Math.min(Number(a.limite) || 250, 2500)),
      // `pasta`, `texto` e `desde` são do banco de atas (produção 21, P7): a lista
      // dentro da pasta das atas. Sem `pasta`, é a busca por nome de sempre.
      'contexto.arquivo.listar': (a, org) =>
        this.driveList(
          org,
          texto(a.q ?? a.busca),
          numero(a.limite, 15),
          texto(a.pasta) ? { pasta: texto(a.pasta), texto: texto(a.texto) || undefined, desde: texto(a.desde) || undefined } : undefined,
        ),
      'contexto.documento.ler': (a, org) => this.docGet(org, texto(a.id)),
      // O texto de um arquivo do Drive para o banco de atas (produção 21, P7): volta sigiloso ao registro.
      'contexto.arquivo.ler': (a, org) => this.lerTextoDoArquivo(org, texto(a.id)),

      // ---------- escrita (R3: só sai depois que uma pessoa confirma) ----------
      'email.enviar': (a, org, ctx: ContextoDoEfeito) =>
        this.sendGmail(
          org,
          {
            to: texto(a.para),
            subject: texto(a.assunto),
            body: String(a.corpo ?? ''),
            ...(texto(a.cc) ? { cc: texto(a.cc) } : {}),
          },
          ctx.actorId ?? undefined,
        ),
      'agenda.evento.criar': (a, org, ctx: ContextoDoEfeito) =>
        this.createCalendarEvent(
          org,
          {
            title: texto(a.titulo),
            start: texto(a.inicio),
            // Sem fim declarado a Agenda recusa o evento. Uma hora é o default
            // menos surpreendente, e fica dito aqui em vez de o modelo ter de
            // adivinhar o formato do campo.
            end: texto(a.fim) || new Date(new Date(texto(a.inicio)).getTime() + 3600_000).toISOString(),
            description: texto(a.descricao) || undefined,
            location: texto(a.local) || undefined,
            attendees: Array.isArray(a.convidados) ? (a.convidados as string[]).map(texto) : [],
          },
          ctx.actorId ?? undefined,
        ),
      /*
       * MARCAR REUNIÃO — irmã de `agenda.evento.criar` e, na prática, a que a
       * casa usa. A outra segue viva para o que não é reunião (bloqueio de
       * agenda, viagem), onde o título é livre; esta não tem título nenhum nos
       * argumentos, e é por isso que nem um agente consegue fugir do padrão.
       */
      'agenda.reuniao.marcar': (a, org, ctx: ContextoDoEfeito) =>
        this.marcarReuniao(
          org,
          {
            tipo: texto(a.tipo) === 'interna' ? 'interna' : 'cliente',
            modalidade: texto(a.modalidade) === 'presencial' ? 'presencial' : 'online',
            ...(texto(a.cliente) ? { cliente: texto(a.cliente) } : {}),
            responsavel: texto(a.responsavel),
            inicio: texto(a.inicio),
            ...(texto(a.fim) ? { fim: texto(a.fim) } : {}),
            ...(Number.isFinite(Number(a.duracaoMinutos))
              ? { duracaoMinutos: Math.trunc(Number(a.duracaoMinutos)) }
              : {}),
            ...(texto(a.pauta) ? { pauta: texto(a.pauta) } : {}),
            ...(texto(a.local) ? { local: texto(a.local) } : {}),
            ...(Array.isArray(a.convidados) ? { convidados: (a.convidados as string[]).map(texto) } : {}),
          },
          ctx.actorId ?? undefined,
        ),
      'documento.criar': (a, org, ctx: ContextoDoEfeito) =>
        this.createDoc(
          org,
          { title: texto(a.titulo), content: a.conteudo ? String(a.conteudo) : undefined },
          ctx.actorId ?? undefined,
        ),
      'documento.anexar': (a, org, ctx: ContextoDoEfeito) =>
        this.appendDoc(org, texto(a.documentoId), String(a.texto ?? ''), ctx.actorId ?? undefined),
    }, 'GoogleService');
  }

  private assert() {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'Google não configurado: defina GOOGLE_CLIENT_ID/SECRET em ~/.config/root/google.env e reinicie a API.',
      );
    }
  }

  /*
   * ==========================================================================
   * O SEGUNDO CONSUMIDOR REAL DO COFRE — RF-C-01, RF-C-02 (fatia 5.4)
   * ==========================================================================
   *
   * Até aqui os dois tokens do Google viviam em TEXTO PURO nas colunas de
   * `GoogleAccount`. A migração (`cofre/migrar-credenciais.ts`) já os COPIAVA
   * para o cofre — cifrados, com dado associado por empresa e rotacionáveis —
   * mas ninguém os LIA de lá: o depósito era paralelo, e o valor em uso
   * continuava sendo o da coluna. Migração que ninguém lê não migrou nada.
   *
   * A ORDEM, e o que cada degrau significa (é a mesma de `bio-credenciais`,
   * deliberadamente — duas escadas diferentes para a mesma pergunta é como uma
   * delas envelhece sem ninguém notar):
   *
   *   1. COFRE (`google/access_token` e `google/refresh_token` DESTA empresa) —
   *      o que manda depois da migração. É a única fonte cifrada com o CHAVEIRO,
   *      isto é, a única rotacionável;
   *   2. COLUNA DE ORIGEM (`GoogleAccount.accessToken` / `.refreshToken`) — a
   *      queda, e ela é indispensável: a migração COPIA e não apaga nada, então
   *      até alguém rodar `cofre.cli.js migrar` esta é a única fonte que existe.
   *      Remover a queda antes disso derrubaria o Google de todo mundo.
   *
   * A CHAVE DO COFRE É `google`, O GRUPO — e não `gmail`/`gcal`/`gdocs`/`drive`.
   * O catálogo lista quatro porque são quatro telas; a credencial é UMA (uma
   * linha de `GoogleAccount` por empresa). Guardar sob `gmail` faria o `gcal`
   * procurar um segredo que não existe. A constante vem de
   * `cofre/migrar-credenciais.ts`, que é quem a declarou ao gravar — copiá-la
   * para cá criaria duas verdades sobre o mesmo nome.
   *
   * REVOGADO NÃO CAI PARA A COLUNA, e é a parte que mais importa. Uma queda
   * escrita como "qualquer erro do cofre → usa a coluna" transformaria a
   * REVOGAÇÃO numa sugestão: revogar no cofre e continuar lendo a coluna antiga é
   * NÃO TER REVOGADO. Os dois desfechos ficam separados com todas as letras.
   */

  /**
   * Pergunta ao cofre. Três desfechos, e eles NÃO se confundem:
   *   · string     → o cofre tem, e é ele que vale;
   *   · 'revogado' → há linha, e ela foi queimada. NÃO há queda;
   *   · null       → não há linha, ou o cofre não pôde responder. Cai para a coluna.
   *
   * "Não pôde responder" é real e não é defeito: `CofreService` exige que a
   * empresa do argumento seja a mesma do contexto de execução (ele falha fechado
   * sob isolamento por linha), e há chamador legítimo fora de requisição HTTP.
   * Falhar ali derrubaria o conector por causa de um depósito que ainda pode
   * estar vazio.
   */
  private async credencialDoCofre(
    orgId: string,
    nome: string,
  ): Promise<string | 'revogado' | null> {
    if (!this.cofre) return null;
    try {
      return await this.cofre.envolver(
        { orgId, conector: CONECTOR_DO_GOOGLE, nome },
        (c) => c.usar((s) => s),
      );
    } catch (e) {
      if (e instanceof SegredoIndisponivelError) {
        // A distinção vem de um CAMPO, nunca da mensagem: comparar texto para
        // decidir se uma revogação vale seria prender a trava a uma redação.
        return e.revogado ? 'revogado' : null;
      }
      this.log.debug(
        `cofre não respondeu por google/${nome} da empresa ${orgId} ` +
          `(${(e as Error).message}); usando a coluna de origem.`,
      );
      return null;
    }
  }

  /**
   * O valor do cofre, ou o da coluna. Revogado lança — com UMA exceção medida.
   *
   * ------------------------------------------------------------------------
   * A EXCEÇÃO: REVOGAÇÃO SUPERADA POR AUTORIZAÇÃO POSTERIOR
   * ------------------------------------------------------------------------
   * "Revogado é terminal" é a regra, e ela existe porque cair para a coluna
   * antiga depois de uma revogação é não ter revogado. Só que, sozinha, ela
   * fabricava um beco sem saída: desconectar revoga no cofre e apaga a linha;
   * se a gravação do cofre falhar na REAUTORIZAÇÃO (ela é "tenta e segue"), a
   * marca de revogação continua lá, a leitura lança "reautorize em Conexões" e
   * reautorizar cai no mesmo lugar. O conector morreria para sempre, com a
   * instrução que não resolve.
   *
   * `revogacaoFoiSuperada` responde a pergunta certa — a autorização local é
   * POSTERIOR à revogação? — e, quando é, a credencial da coluna volta a valer,
   * o cofre é RECONCILIADO na hora e o log grita. Na dúvida, terminal.
   *
   * `autorizadaEm` é o `connectedAt` da linha local. Ele serve porque
   * desconectar APAGA a linha: uma linha posterior ao `revogadoEm` só pode ter
   * nascido de alguém autorizando de novo.
   */
  private async credencial(
    orgId: string,
    nome: string,
    daColuna: string | null,
    contexto: { autorizadaEm?: Date | null; escopo?: string[]; expiraEm?: Date | null } = {},
  ): Promise<string | null> {
    const noCofre = await this.credencialDoCofre(orgId, nome);
    if (noCofre === 'revogado') {
      const veredito = await revogacaoFoiSuperada(this.cofre, {
        orgId,
        conector: CONECTOR_DO_GOOGLE,
        nome: nome,
        autorizadaEm: contexto.autorizadaEm ?? null,
      });
      if (!veredito.superada) {
        throw new ServiceUnavailableException(
          `A credencial "${nome}" do Google desta empresa foi REVOGADA e não existe mais ` +
            `(${veredito.porque ?? 'revogação em vigor'}). Reautorize a conta em Conexões — ` +
            'revogar não tem volta, e cair para a coluna antiga seria não ter revogado.',
        );
      }
      this.log.error(
        `empresa ${orgId}: o cofre ainda marca google/${nome} como revogado ` +
          `(${veredito.revogadaEm?.toISOString() ?? 'sem data'}), mas há autorização POSTERIOR ` +
          `(${contexto.autorizadaEm?.toISOString() ?? 'sem data'}). A gravação no cofre falhou ` +
          'em algum retorno de OAuth. Usando a coluna e regravando no cofre agora.',
      );
      if (daColuna) {
        await this.guardarNoCofre(orgId, nome, daColuna, {
          escopo: contexto.escopo,
          expiraEm: contexto.expiraEm ?? null,
        });
      }
      return daColuna;
    }
    return noCofre ?? daColuna;
  }

  /**
   * Guarda no cofre o que acabou de ser escrito na coluna.
   *
   * ESCREVE NOS DOIS LUGARES enquanto a coluna de origem existir, e é o mesmo
   * raciocínio de `BioCredenciaisService.salvar`: gravar só no cofre deixaria a
   * coluna com o valor VELHO — e ela ainda é a queda de leitura, então um
   * rollback do código, ou um contexto em que o cofre não responde,
   * ressuscitaria o token anterior sem aviso.
   *
   * BEST-EFFORT de propósito: falhar aqui não pode desfazer um OAuth que deu
   * certo nem derrubar uma renovação de token que já foi aceita pelo Google. O
   * que se perde sai no log, e a próxima passagem de `cofre.cli.js migrar
   * --forcar` reconcilia.
   */
  private async guardarNoCofre(
    orgId: string,
    nome: string,
    valor: string,
    extra: { escopo?: string[]; expiraEm?: Date | null; actorId?: string | null } = {},
  ): Promise<void> {
    if (!this.cofre || !valor) return;
    try {
      await this.cofre.guardar({
        orgId,
        conector: CONECTOR_DO_GOOGLE,
        nome,
        valor,
        escopo: extra.escopo ?? [],
        origem: 'google-oauth',
        expiraEm: extra.expiraEm ?? null,
        actorId: extra.actorId ?? null,
      });
    } catch (e) {
      this.log.error(
        `token do Google gravado na coluna mas NÃO no cofre (empresa ${orgId}, ${nome}): ` +
          `${(e as Error).message}. Reconcilie com \`cofre.cli.js migrar --forcar --empresa ${orgId}\`.`,
      );
    }
  }

  /**
   * O CONTRATO ÚNICO — autorizar, sincronizar, saúde, revogar (RF-X-01).
   *
   * UMA chave para as QUATRO superfícies, porque a credencial é uma só. A sonda
   * de saúde é feita uma vez e o resultado vale para gmail, gcal, gdocs e drive
   * — quem monta o catálogo espalha (ver `integrations.service.ts`).
   */
  private descritorDoContrato(): ConectorDoContrato {
    return {
      chave: CONECTOR_DO_GOOGLE,
      rotulo: 'Google (Gmail, Agenda, Docs, Drive)',
      escopoDaCredencial: 'empresa',
      linhasDoCatalogo: ['gmail', 'gcal', 'gdocs', 'drive'],

      autorizar: async (ctx: ContextoDoVerbo): Promise<ResultadoDeAutorizacao> => {
        if (!this.configured) {
          return {
            tipo: 'manual',
            instrucao:
              'O aplicativo do Google não tem credencial neste processo: o operador precisa ' +
              'definir o par cliente/segredo no ambiente da API e reiniciá-la. Enquanto isso ' +
              'não acontecer, nenhuma empresa consegue autorizar — não é uma pendência desta ' +
              'empresa.',
          };
        }
        // `state` carrega o orgId: é assim que o callback sabe de quem é a
        // autorização que está voltando (ver `GoogleConexaoController`).
        return { tipo: 'redirecionar', url: this.authUrl(ctx.orgId) };
      },

      /**
       * SINCRONIZAR, aqui, é RENOVAR A LIGAÇÃO.
       *
       * O Google não tem espelho local — Gmail, Agenda, Docs e Drive são lidos
       * sob demanda. O que se degrada com o tempo é a AUTORIZAÇÃO: o access
       * token vence em uma hora e o refresh é o que a mantém viva. `token()`
       * renova quando preciso, grava o valor novo nos dois lugares e deixa a
       * conexão marcada como viva no hub.
       */
      sincronizar: async (ctx: ContextoDoVerbo): Promise<ResultadoDeSincronizacao> => {
        const acc = await this.prisma.googleAccount.findUnique({ where: { orgId: ctx.orgId } });
        if (!acc) {
          return {
            tipo: 'nao_se_aplica',
            motivo:
              'Esta empresa ainda não autorizou nenhuma conta Google — não há ligação a ' +
              'renovar. Use "autorizar".',
          };
        }
        const antes = acc.expiresAt;
        await this.token(ctx.orgId);
        const depois = await this.prisma.googleAccount.findUnique({
          where: { orgId: ctx.orgId },
          select: { expiresAt: true, email: true },
        });
        await this.upsertIntegration(ctx.orgId, 'connected');
        const renovou = !!depois && depois.expiresAt.getTime() !== antes.getTime();
        return {
          tipo: 'feito',
          resumo: renovou
            ? `Autorização de ${depois?.email ?? 'conta sem e-mail'} renovada — o novo token ` +
              `vale até ${depois?.expiresAt.toLocaleString('pt-BR')}.`
            : `Autorização de ${depois?.email ?? 'conta sem e-mail'} continua válida até ` +
              `${depois?.expiresAt.toLocaleString('pt-BR')} — nada precisou ser renovado.`,
        };
      },

      /**
       * A SONDA — e é AQUI que mora a armadilha desta fatia.
       *
       * A pergunta certa NÃO é "o aplicativo tem credencial": ela é verdadeira em
       * produção para todo mundo, e foi respondê-la que fez a tela exibir o
       * Google como CONECTADO em empresa que nunca autorizou nada. A pergunta é
       * "ESTA EMPRESA autorizou, e a autorização ainda serve?" — e as duas
       * metades são conferidas separadas, porque o conserto de cada uma é
       * diferente: a primeira é do operador da VPS, a segunda é de quem clica em
       * conectar.
       *
       * E o verde só nasce da TERCEIRA parte: uma chamada de verdade ao Google
       * com o token desta empresa. Linha no banco não prova nada — um refresh
       * token revogado do outro lado deixa a linha intacta.
       */
      saude: async (ctx: ContextoDoVerbo): Promise<SaudeDeConector> => {
        if (!this.configured) {
          return naoConfigurado(
            'O aplicativo do Google não tem credencial neste processo (o par cliente/segredo ' +
              'do ambiente da API). Nenhuma empresa consegue autorizar enquanto isso não for ' +
              'resolvido pelo operador.',
          );
        }
        const acc = await this.prisma.googleAccount.findUnique({ where: { orgId: ctx.orgId } });
        if (!acc) {
          return naoConfigurado(
            'Esta empresa ainda não autorizou nenhuma conta Google. O aplicativo está pronto; ' +
              'falta alguém clicar em conectar e consentir na tela do Google.',
          );
        }
        const comecou = Date.now();
        const orcamento = PRAZO_DA_CHAMADA_DE_SONDA_MS;
        try {
          const at = await this.token(ctx.orgId, { prazoMs: orcamento });
          const email = await this.sondarEmail(at, orcamento - (Date.now() - comecou));
          return conectado(
            Date.now() - comecou,
            `conta ${email ?? acc.email ?? 'sem e-mail conhecido'} respondeu; token válido até ` +
              `${acc.expiresAt.toLocaleString('pt-BR')}.`,
          );
        } catch (e) {
          return erroDeConector(frasedoErro(e), Date.now() - comecou);
        }
      },

      /**
       * REVOGAR — QUEIMA a credencial desta empresa. Não é desligar.
       *
       * Faz as DUAS coisas, e as duas são necessárias: queima no cofre (de onde
       * a leitura vem agora) e apaga a linha de `GoogleAccount` (que é a queda
       * de leitura enquanto a migração das colunas não terminar). Queimar só no
       * cofre deixaria o token em texto puro na coluna, lido pela própria queda —
       * uma revogação que não revoga.
       */
      revogar: async (
        ctx: ContextoDoVerbo & { motivo?: string | null },
      ): Promise<ResultadoDeRevogacao> => {
        const r = await this.disconnect(ctx.orgId, {
          actorId: ctx.actorId ?? null,
          motivo: ctx.motivo ?? null,
        });
        return {
          tipo: 'revogado',
          segredos: r.segredosRevogados,
          resumo:
            'A autorização do Google desta empresa foi apagada e as credenciais guardadas ' +
            'foram queimadas. Isto NÃO tem volta: para voltar a usar Gmail, Agenda, Docs ou ' +
            'Drive, alguém precisa autorizar de novo na tela do Google.',
        };
      },
    };
  }

  /**
   * Uma chamada de SONDA ao Google: com prazo, e sem passar pelo `api()`.
   *
   * O prazo é o que SOBRA do orçamento da sonda, não o orçamento inteiro: quando
   * a autorização estava vencida, `token()` já gastou parte dele renovando. Dois
   * prazos cheios em sequência somariam nove segundos dentro de um relógio de
   * fora de seis — e aí quem responde é o relógio de fora, com a frase genérica,
   * que é exatamente o que o corte de dentro existe para evitar.
   */
  private async sondarEmail(accessToken: string, prazoMs: number): Promise<string | null> {
    const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(Math.max(250, prazoMs)),
    });
    if (!r.ok) {
      const corpo = await r.text().catch(() => '');
      throw new Error(
        `O Google respondeu HTTP ${r.status} ao conferir a conta` +
          (corpo ? `: ${corpo.slice(0, 200)}` : '') +
          (r.status === 401 || r.status === 403
            ? ' — a autorização desta empresa foi revogada do lado do Google, ou os escopos ' +
              'mudaram. É preciso conectar de novo.'
            : ''),
      );
    }
    return ((await r.json()) as { email?: string }).email ?? null;
  }

  // ---------- OAuth ----------
  authUrl(state: string): string {
    this.assert();
    const p = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent', // garante refresh_token
      include_granted_scopes: 'true',
      scope: SCOPES.join(' '),
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  }

  /** Troca o code por tokens, descobre o e-mail e guarda a conexão. Retorna p/ onde redirecionar. */
  async handleCallback(orgId: string, code: string): Promise<string> {
    this.assert();
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) throw new BadRequestException(`Troca de código falhou: HTTP ${res.status}`);
    const t = (await res.json()) as {
      access_token: string; refresh_token?: string; expires_in: number; scope?: string; token_type?: string;
    };
    const email = await this.fetchEmail(t.access_token);
    const expiresAt = new Date(Date.now() + (t.expires_in - 60) * 1000);

    await this.prisma.googleAccount.upsert({
      where: { orgId },
      update: {
        email, accessToken: t.access_token, tokenType: t.token_type, scope: t.scope, expiresAt,
        ...(t.refresh_token ? { refreshToken: t.refresh_token } : {}),
      },
      create: {
        orgId, email, accessToken: t.access_token, refreshToken: t.refresh_token,
        tokenType: t.token_type, scope: t.scope, expiresAt,
      },
    });
    /*
     * OS DOIS TOKENS VÃO PARA O COFRE na mesma passagem em que vão para a coluna
     * (fatia 5.4). Esta é a primeira vez que eles ficam CIFRADOS EM REPOUSO no
     * caminho normal — até aqui só a migração os copiava, e o que uma
     * autorização nova escrevia continuava em texto puro.
     *
     * O refresh token vai SEM `expiraEm`, e a diferença não é cosmética: ele não
     * vence junto com o access token, e gravar `expiresAt` nele faria a tela do
     * cofre dizer que ele expirou em uma hora. É a mesma nota que a migração já
     * carrega.
     */
    const escopo = (t.scope ?? '').split(/[\s,]+/).filter(Boolean);
    await this.guardarNoCofre(orgId, NOMES_CONHECIDOS.acesso, t.access_token, {
      escopo,
      expiraEm: expiresAt,
    });
    if (t.refresh_token) {
      await this.guardarNoCofre(orgId, NOMES_CONHECIDOS.renovacao, t.refresh_token, { escopo });
    }

    await this.upsertIntegration(orgId, 'connected');
    await this.audit.log({ orgId, action: 'google.connect', entityType: 'integration', entityId: 'google', after: { email } });
    this.log.log(`Google conectado: ${email}`);
    return `${this.webBase}/google`;
  }

  private async fetchEmail(accessToken: string): Promise<string | null> {
    const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) return null;
    return ((await r.json()) as { email?: string }).email ?? null;
  }

  /**
   * Access token válido (renova via refresh_token se expirou).
   *
   * O VALOR VEM DO COFRE quando existe, e da coluna quando não — ver
   * `credencialDoCofre`. A LINHA de `GoogleAccount` continua sendo lida: ela
   * carrega os METADADOS (vencimento, e-mail, escopos), que não são segredo e
   * não têm por que estar cifrados.
   */
  private async token(orgId: string, opcoes: { prazoMs?: number } = {}): Promise<string> {
    this.assert();
    const acc = await this.prisma.googleAccount.findUnique({ where: { orgId } });
    if (!acc) throw new ServiceUnavailableException('Google não conectado. Conecte em Integrações.');

    const escopo = (acc.scope ?? '').split(/[\s,]+/).filter(Boolean);

    if (acc.expiresAt > new Date()) {
      const atual = await this.credencial(orgId, NOMES_CONHECIDOS.acesso, acc.accessToken, {
        autorizadaEm: acc.connectedAt,
        escopo,
        expiraEm: acc.expiresAt,
      });
      if (atual) return atual;
      // Sem valor em lugar nenhum e a linha dizendo que ainda vale: a única
      // leitura honesta é que a credencial sumiu por baixo do metadado. Cair
      // para o refresh é melhor do que devolver string vazia ao Google.
      this.log.warn(
        `empresa ${orgId}: o access token do Google não está nem no cofre nem na coluna, ` +
          'apesar de a linha dizer que ainda vale. Tentando renovar pelo refresh.',
      );
    }

    const refresh = await this.credencial(orgId, NOMES_CONHECIDOS.renovacao, acc.refreshToken, {
      autorizadaEm: acc.connectedAt,
      escopo,
    });
    if (!refresh) throw new ServiceUnavailableException('Sessão Google expirada. Reconecte.');

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId, client_secret: this.clientSecret,
        refresh_token: refresh, grant_type: 'refresh_token',
      }),
      /*
       * PRAZO SÓ QUANDO QUEM CHAMA É A SONDA. As ações (enviar e-mail, criar
       * evento) chamam isto sem prazo, como sempre chamaram — apertar o relógio
       * delas por causa de uma tela de diagnóstico seria mudar o comportamento
       * de um caminho que ninguém pediu para mudar. A sonda, essa, tem de caber
       * no orçamento dela: ver `saude`.
       */
      signal: opcoes.prazoMs ? AbortSignal.timeout(opcoes.prazoMs) : undefined,
    });
    if (!res.ok) {
      const corpo = await res.text().catch(() => '');
      throw new ServiceUnavailableException(
        `Refresh do Google falhou: HTTP ${res.status}${corpo ? ` — ${corpo.slice(0, 200)}` : ''}`,
      );
    }
    const t = (await res.json()) as { access_token: string; expires_in: number };
    const expiresAt = new Date(Date.now() + (t.expires_in - 60) * 1000);
    await this.prisma.googleAccount.update({ where: { orgId }, data: { accessToken: t.access_token, expiresAt } });
    await this.guardarNoCofre(orgId, NOMES_CONHECIDOS.acesso, t.access_token, { escopo, expiraEm: expiresAt });
    return t.access_token;
  }

  /**
   * Chamada autenticada a uma API do Google.
   *
   * ------------------------------------------------------------------------
   * ERA PÚBLICA, E POR ISSO A FRONTEIRA NÃO EXISTIA — fatia 3.3
   * ------------------------------------------------------------------------
   * `api(orgId, url, init)` aceita URL ARBITRÁRIA e método arbitrário. Enquanto
   * ela fosse pública, qualquer serviço do projeto podia montar
   * `https://gmail.googleapis.com/.../messages/send` por fora e entregar pronto
   * — e o pedido saía com o token do tenant sem que a porta visse o método, o
   * destino ou a natureza da ação. É o caso real de `pauta/espelho.service.ts`,
   * que montava os endereços do Drive aqui do lado.
   *
   * Fechá-la é o que faz mover o import mover a fronteira de verdade: agora o
   * que sai daqui são MÉTODOS COM NOME, cada um com um destino fixo — e o que
   * não tem método não tem como ser pedido.
   *
   * Quem precisar de uma superfície nova do Google acrescenta um método aqui,
   * com nome, e — se ela agir sobre o mundo — uma capacidade no catálogo. É
   * mais trabalho de propósito: é onde a decisão de expor uma API externa nova
   * fica visível.
   */
  private async api<T = any>(orgId: string, url: string, init?: RequestInit): Promise<T> {
    const at = await this.token(orgId);
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BadRequestException(`Google ${url.split('?')[0]} → HTTP ${res.status} ${body.slice(0, 160)}`);
    }
    return res.json() as Promise<T>;
  }

  async status(orgId: string) {
    const acc = await this.prisma.googleAccount.findUnique({ where: { orgId } });
    return {
      configured: this.configured,
      connected: !!acc,
      email: acc?.email ?? null,
      scopes: acc?.scope?.split(' ') ?? [],
      connectedAt: acc?.connectedAt?.toISOString() ?? null,
      authUrl: this.configured ? this.authUrl(orgId) : null,
    };
  }

  /**
   * DESCONECTAR = REVOGAR. As duas fontes são queimadas, nesta ordem.
   *
   * Antes da fatia 5.4 isto apagava só a linha de `GoogleAccount`. Com o cofre
   * lido na frente da coluna, apagar só a linha deixaria os tokens VIVOS no
   * cofre — e a próxima autorização (ou um `migrar --forcar` distraído) os
   * traria de volta. Uma desconexão que não desconecta é pior do que nenhuma,
   * porque quem clicou vai embora achando que resolveu.
   *
   * A ORDEM IMPORTA: o cofre primeiro. Se a queima do cofre falhar, a linha
   * continua lá e a próxima leitura ainda funciona — estado consistente, e o
   * erro sobe para quem clicou. Ao contrário, apagar a linha e falhar no cofre
   * deixaria a empresa sem metadado e COM segredo guardado, que é o pior dos
   * dois mundos e ninguém teria como perceber.
   *
   * `nome` não é informado de propósito: queima o CONJUNTO de segredos do
   * conector `google` desta empresa (access e refresh juntos) — deixar o refresh
   * vivo seria deixar a porta destrancada com o aviso de fechada. O cofre
   * preserva sozinho o segredo do aplicativo, que aqui nem existe.
   */
  async disconnect(
    orgId: string,
    opcoes: { actorId?: string | null; motivo?: string | null } = {},
  ): Promise<{ ok: true; segredosRevogados: string[] }> {
    let segredosRevogados: string[] = [];
    if (this.cofre) {
      const r = await this.cofre.revogar({
        orgId,
        conector: CONECTOR_DO_GOOGLE,
        motivo: opcoes.motivo ?? 'conta Google desconectada',
        por: opcoes.actorId ?? null,
      });
      segredosRevogados = r.revogados;
    }
    await this.prisma.googleAccount.deleteMany({ where: { orgId } });
    await this.upsertIntegration(orgId, 'disconnected');
    await this.audit.log({
      orgId,
      actorId: opcoes.actorId ?? undefined,
      action: 'google.disconnect',
      entityType: 'integration',
      entityId: 'google',
      after: { segredosRevogados, motivo: opcoes.motivo ?? null },
    });
    return { ok: true, segredosRevogados };
  }

  private async upsertIntegration(orgId: string, status: 'connected' | 'disconnected') {
    // marca as 4 integrações Google no hub (cria o registro se ainda não existir)
    const labels: Record<string, string> = { gmail: 'Gmail', drive: 'Google Drive', gcal: 'Google Agenda', gdocs: 'Google Docs' };
    for (const key of Object.keys(labels)) {
      const ex = await this.prisma.integrationAccount.findFirst({ where: { orgId, key } });
      if (ex) {
        await this.prisma.integrationAccount.update({
          where: { id: ex.id },
          data: { status, connectedAt: status === 'connected' ? new Date() : ex.connectedAt },
        });
      } else {
        await this.prisma.integrationAccount.create({
          data: { orgId, key, label: labels[key], status, connectedAt: status === 'connected' ? new Date() : null },
        });
      }
    }
  }

  // ---------- Leitura ----------
  async calendarUpcoming(orgId: string, maxResults = 10) {
    const now = new Date().toISOString();
    const j = await this.api<{ items: any[] }>(orgId,
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(now)}&maxResults=${maxResults}&singleEvents=true&orderBy=startTime`);
    return (j.items ?? []).map((e) => ({
      id: e.id,
      title: e.summary ?? '(sem título)',
      start: e.start?.dateTime ?? e.start?.date ?? null,
      end: e.end?.dateTime ?? e.end?.date ?? null,
      location: e.location ?? null,
      link: e.htmlLink ?? null,
      attendees: (e.attendees ?? []).map((a: any) => a.email).filter(Boolean),
    }));
  }

  /**
   * A AGENDA DE UM INTERVALO — o que o calendário da tela precisa e
   * `calendarUpcoming` não dá.
   *
   * `calendarUpcoming` responde "o que vem a seguir", contado de agora: serve ao
   * cartão do painel e é inútil para desenhar setembro, porque não sabe voltar
   * no tempo nem parar no fim do mês. Daí os dois extremos explícitos.
   *
   * O que volta a mais em relação à listagem curta é o que a tela mostra sem ter
   * de pedir de novo: o padrão já DESMONTADO (`reuniao`), o link do Meet e se o
   * evento é de dia inteiro — um evento `date` (sem hora) colocado numa grade
   * horária é o clássico "aniversário às 21h" de fuso.
   */
  async calendarPeriodo(orgId: string, de: string, ate: string, maxResults = 250) {
    const inicio = new Date(de);
    const fim = new Date(ate);
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) {
      throw new BadRequestException('Período inválido: use datas ISO em `de` e `ate`.');
    }
    if (fim <= inicio) throw new BadRequestException('O fim do período tem de ser depois do início.');

    const params = new URLSearchParams({
      timeMin: inicio.toISOString(),
      timeMax: fim.toISOString(),
      maxResults: String(Math.min(Math.max(maxResults, 1), 2500)),
      singleEvents: 'true',
      orderBy: 'startTime',
    });
    const j = await this.api<{ items: any[] }>(
      orgId,
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    );
    return (j.items ?? []).map((e) => {
      const titulo = e.summary ?? '(sem título)';
      return {
        id: e.id,
        title: titulo,
        /** O padrão da casa lido do título, ou `null` quando o evento foge dele. */
        reuniao: lerTituloDeReuniao(titulo),
        start: e.start?.dateTime ?? e.start?.date ?? null,
        end: e.end?.dateTime ?? e.end?.date ?? null,
        diaInteiro: !e.start?.dateTime,
        location: e.location ?? null,
        description: e.description ?? null,
        link: e.htmlLink ?? null,
        meet: e.hangoutLink ?? null,
        status: e.status ?? null,
        organizador: e.organizer?.email ?? null,
        attendees: (e.attendees ?? []).map((a: any) => a.email).filter(Boolean),
      };
    });
  }

  async gmailRecent(orgId: string, q = '', maxResults = 10) {
    const list = await this.api<{ messages?: Array<{ id: string }> }>(orgId,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
    const ids = (list.messages ?? []).map((m) => m.id);
    const out = [];
    for (const id of ids) {
      const m = await this.api<any>(orgId,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
      const h = (name: string) => (m.payload?.headers ?? []).find((x: any) => x.name === name)?.value ?? null;
      out.push({ id, from: h('From'), subject: h('Subject'), date: h('Date'), snippet: m.snippet ?? '', unread: (m.labelIds ?? []).includes('UNREAD'), link: permalinkDoGmail(id) });
    }
    return out;
  }

  async gmailGet(orgId: string, id: string) {
    const m = await this.api<any>(orgId, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`);
    const h = (name: string) => (m.payload?.headers ?? []).find((x: any) => x.name === name)?.value ?? null;
    return { id, from: h('From'), to: h('To'), subject: h('Subject'), date: h('Date'), snippet: m.snippet ?? '', body: extractBody(m.payload), link: permalinkDoGmail(id) };
  }

  /**
   * Lista arquivos do Drive. Sem `opcoes`, é a busca por nome de sempre (a tela
   * do Google e a ferramenta do agente). Com `opcoes.pasta` (produção 21, P7, o
   * banco de atas), lista os arquivos DENTRO da pasta, inclusive de drive
   * compartilhado, com a busca no texto (`fullText contains`) e o corte por data
   * de modificação; a consulta é montada por `consultaDoDrive`, que escapa cada
   * valor e recusa id de pasta fora do formato.
   */
  async driveList(orgId: string, q = '', pageSize = 15, opcoes?: OpcoesDaListaDoDrive) {
    const query = opcoes?.pasta
      ? consultaDoDrive({ pasta: opcoes.pasta, nome: q, texto: opcoes.texto, desde: opcoes.desde })
      : q ? `name contains '${q.replace(/'/g, "\\'")}'` : "trashed = false";
    const compartilhados = opcoes?.pasta ? '&supportsAllDrives=true&includeItemsFromAllDrives=true' : '';
    const j = await this.api<{ files: any[] }>(orgId,
      `https://www.googleapis.com/drive/v3/files?pageSize=${pageSize}&orderBy=modifiedTime desc&q=${encodeURIComponent(query)}${compartilhados}&fields=${encodeURIComponent('files(id,name,mimeType,modifiedTime,createdTime,size,webViewLink,owners(displayName))')}`);
    return (j.files ?? []).map((f) => ({
      id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime,
      link: f.webViewLink ?? null, owner: f.owners?.[0]?.displayName ?? null,
      ...(opcoes?.pasta ? { createdTime: f.createdTime ?? null, size: f.size ? Number(f.size) : null } : {}),
    }));
  }

  /**
   * O TEXTO de um arquivo do Drive (capacidade `contexto.arquivo.ler`, R0,
   * produção 21, P7): Documento Google exportado como texto; `.txt`, `.md` e
   * legendas baixados como estão; PDF lido por `textoDoPdf`. O texto volta
   * marcado `sigiloso` (`leituraDoArquivo`): o RASTRO e o registro da chamada
   * guardam o resumo criptográfico e o tamanho, nunca o texto. Arquivo maior que
   * o teto nem é baixado.
   */
  async lerTextoDoArquivo(orgId: string, fileId: string) {
    if (!/^[A-Za-z0-9_-]{10,120}$/.test(fileId)) throw new BadRequestException('Esse não é um id de arquivo do Drive.');
    const id = encodeURIComponent(fileId);
    const meta = await this.api<{ id: string; name: string; mimeType: string; size?: string; modifiedTime?: string; webViewLink?: string; parents?: string[]; trashed?: boolean }>(
      orgId,
      `https://www.googleapis.com/drive/v3/files/${id}?supportsAllDrives=true&fields=${encodeURIComponent('id,name,mimeType,size,modifiedTime,webViewLink,parents,trashed')}`,
    );
    if (meta.trashed) throw new BadRequestException('Este arquivo está na lixeira do Drive.');
    const bytes = meta.size ? Number(meta.size) : null;
    if (bytes !== null && bytes > MAX_BYTES_DO_ARQUIVO_LIDO) {
      throw new BadRequestException(`O arquivo passa de ${Math.round(MAX_BYTES_DO_ARQUIVO_LIDO / 1_048_576)} MB e não é lido daqui. Abra no Drive.`);
    }
    let texto: string;
    if (meta.mimeType === 'application/vnd.google-apps.document') {
      texto = (await this.baixarDoDrive(orgId, `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=${encodeURIComponent('text/plain')}`)).toString('utf8');
    } else if (meta.mimeType === 'application/pdf' || /\.pdf$/i.test(meta.name)) {
      const pdf = await this.baixarDoDrive(orgId, `https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`);
      try {
        texto = textoDoPdf(pdf);
      } catch (e) {
        if (e instanceof PdfIlegivelError) throw new BadRequestException(`Não deu para ler este PDF: ${e.message}. Abra no Drive.`);
        throw e;
      }
      if (!texto.trim()) throw new BadRequestException('Este PDF não tem texto (é imagem ou escaneado). Abra no Drive.');
    } else if (arquivoDoDriveEhLegivel(meta.name, meta.mimeType) && !meta.mimeType.startsWith('application/vnd.google-apps.')) {
      texto = (await this.baixarDoDrive(orgId, `https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`)).toString('utf8');
    } else {
      throw new BadRequestException('Este tipo de arquivo não é lido daqui (só Documento Google, PDF com texto, .txt e .md). Abra no Drive.');
    }
    return leituraDoArquivo({
      id: meta.id,
      nome: meta.name,
      mimeType: meta.mimeType,
      modificadoEm: meta.modifiedTime ?? null,
      link: meta.webViewLink ?? null,
      pastas: meta.parents ?? [],
      bytes,
      texto,
    });
  }

  /** Os bytes de um endereço do Drive (export ou `alt=media`), com o token desta empresa e o teto de tamanho. */
  private async baixarDoDrive(orgId: string, url: string): Promise<Buffer> {
    const at = await this.token(orgId);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${at}` } });
    if (!res.ok) {
      const corpo = await res.text().catch(() => '');
      throw new BadRequestException(`O Drive não entregou o arquivo (HTTP ${res.status}). ${corpo.slice(0, 120)}`.trim());
    }
    const dados = Buffer.from(await res.arrayBuffer());
    if (dados.length > MAX_BYTES_DO_ARQUIVO_LIDO) throw new BadRequestException('O arquivo é grande demais para ser lido daqui. Abra no Drive.');
    return dados;
  }

  async docGet(orgId: string, docId: string) {
    const d = await this.api<any>(orgId, `https://docs.googleapis.com/v1/documents/${docId}`);
    return { id: docId, title: d.title ?? '(sem título)', content: extractDocText(d) };
  }

  // ---------- Escrita (com aprovação humana: só executa por ação de usuário/IA aprovada) ----------
  async sendGmail(orgId: string, input: { to: string; subject: string; body: string; cc?: string }, actorId?: string) {
    const raw = buildRawEmail(input);
    const r = await this.api<{ id: string; threadId: string }>(orgId,
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      { method: 'POST', body: JSON.stringify({ raw }) });
    await this.audit.log({
      orgId, actorId, action: 'google.gmail.send', entityType: 'gmail', entityId: r.id,
      after: { to: input.to, cc: input.cc ?? null, subject: input.subject },
    });
    this.log.log(`Gmail enviado → ${input.to} (${input.subject})`);
    return { ok: true, id: r.id, threadId: r.threadId };
  }

  async createCalendarEvent(
    orgId: string,
    input: {
      title: string;
      start: string;
      end: string;
      description?: string;
      location?: string;
      attendees?: string[];
      /** Pede um Meet ao próprio Google. Ver `conferenceDataVersion` abaixo. */
      meet?: boolean;
    },
    actorId?: string,
  ) {
    /*
     * O MEET NASCE COM O EVENTO, e não depois.
     *
     * O `createRequest` é a única forma de a Agenda gerar a sala: não existe
     * endpoint de "criar Meet" para colar num evento já feito. Duas exigências
     * do Google que é fácil esquecer e caro descobrir em produção:
     *   · `requestId` tem de ser único por pedido — repetido, a API devolve a
     *     conferência ANTERIOR em vez de abrir outra;
     *   · sem `conferenceDataVersion=1` na URL, o corpo é aceito e o
     *     `conferenceData` é silenciosamente IGNORADO. O evento nasce sem sala e
     *     ninguém vê erro nenhum.
     */
    const body: Record<string, unknown> = {
      summary: input.title,
      description: input.description,
      location: input.location,
      start: { dateTime: new Date(input.start).toISOString() },
      end: { dateTime: new Date(input.end).toISOString() },
      attendees: (input.attendees ?? []).map((email) => ({ email })),
    };
    if (input.meet) {
      body.conferenceData = {
        createRequest: {
          requestId: `root-os-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      };
    }
    const e = await this.api<{ id: string; htmlLink: string; hangoutLink?: string }>(orgId,
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all${input.meet ? '&conferenceDataVersion=1' : ''}`,
      { method: 'POST', body: JSON.stringify(body) });
    await this.audit.log({
      orgId, actorId, action: 'google.calendar.create', entityType: 'calendar', entityId: e.id,
      after: { title: input.title, start: input.start, meet: !!input.meet },
    });
    this.log.log(`Evento criado: ${input.title}`);
    return { ok: true, id: e.id, link: e.htmlLink, meet: e.hangoutLink ?? null };
  }

  /*
   * ==========================================================================
   * MARCAR REUNIÃO — a agenda da Root no padrão da casa (24/09/2026)
   * ==========================================================================
   *
   * A diferença para `createCalendarEvent` cabe numa frase: aqui NINGUÉM passa
   * o título. Ele é montado por `montarTituloDeReuniao` a partir dos campos, e
   * é essa ausência que faz o padrão valer para todo mundo — a tela, o agente
   * que um dia marcar uma reunião pelo MCP e qualquer script que chame a porta.
   * Um campo `titulo` opcional aqui seria o mesmo que não ter padrão.
   *
   * O MEET SAI DA MODALIDADE, e não de uma caixinha: reunião online sem link é
   * reunião que alguém vai perguntar "onde é?" meia hora antes. Presencial não
   * ganha sala — ganha o campo de local.
   *
   * A DURAÇÃO PADRÃO é uma hora, o mesmo default que a capacidade de evento já
   * usava quando o fim não vinha declarado. Sem fim, a Agenda recusa o evento.
   */
  async marcarReuniao(
    orgId: string,
    input: {
      tipo: 'cliente' | 'interna';
      modalidade: ModalidadeDeReuniao;
      cliente?: string;
      responsavel: string;
      inicio: string;
      fim?: string;
      duracaoMinutos?: number;
      pauta?: string;
      local?: string;
      convidados?: string[];
    },
    actorId?: string,
  ) {
    const inicio = new Date(input.inicio);
    if (Number.isNaN(inicio.getTime())) {
      throw new BadRequestException('Início inválido: mande data e hora ISO 8601.');
    }
    const fim = input.fim
      ? new Date(input.fim)
      : new Date(inicio.getTime() + (input.duracaoMinutos ?? 60) * 60_000);
    if (Number.isNaN(fim.getTime()) || fim <= inicio) {
      throw new BadRequestException('A reunião tem de terminar depois de começar.');
    }

    // `montarTituloDeReuniao` é quem cobra cliente e responsável, com a mensagem
    // em português que a tela mostra. Aqui só traduzimos o corpo para a forma.
    const reuniao: ReuniaoDaAgenda =
      input.tipo === 'cliente'
        ? {
            tipo: 'cliente',
            modalidade: input.modalidade,
            cliente: input.cliente ?? '',
            responsavel: input.responsavel,
          }
        : { tipo: 'interna', modalidade: input.modalidade, responsavel: input.responsavel };

    let titulo: string;
    try {
      titulo = montarTituloDeReuniao(reuniao);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }

    const online = input.modalidade === 'online';
    const criado = await this.createCalendarEvent(
      orgId,
      {
        title: titulo,
        start: inicio.toISOString(),
        end: fim.toISOString(),
        ...(input.pauta ? { description: input.pauta } : {}),
        ...(input.local && !online ? { location: input.local } : {}),
        ...(input.convidados?.length ? { attendees: input.convidados } : {}),
        meet: online,
      },
      actorId,
    );
    return { ...criado, titulo, reuniao };
  }

  async createDoc(orgId: string, input: { title: string; content?: string }, actorId?: string) {
    const doc = await this.api<{ documentId: string }>(orgId,
      'https://docs.googleapis.com/v1/documents', { method: 'POST', body: JSON.stringify({ title: input.title }) });
    if (input.content) {
      await this.api(orgId, `https://docs.googleapis.com/v1/documents/${doc.documentId}:batchUpdate`,
        { method: 'POST', body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text: input.content } }] }) });
    }
    await this.audit.log({
      orgId, actorId, action: 'google.docs.create', entityType: 'docs', entityId: doc.documentId,
      after: { title: input.title },
    });
    this.log.log(`Doc criado: ${input.title}`);
    return { ok: true, id: doc.documentId, link: `https://docs.google.com/document/d/${doc.documentId}/edit` };
  }

  /**
   * Grava (ou atualiza) um arquivo de texto numa pasta do Drive.
   *
   * Existe porque o espelho .md da Pauta montava os DOIS endereços do Drive por
   * conta própria — a busca e o upload multipart — e os entregava ao passa-tudo
   * `api()`. O endpoint é do conector; quem espelha pede "grava este texto com
   * este nome nesta pasta", e não uma URL.
   *
   * NOME ESTÁVEL ATUALIZA NO LUGAR: procura antes na pasta e faz PATCH quando
   * acha, para o espelho de uma ficha editada não virar um segundo arquivo.
   *
   * Não é capacidade do catálogo e por isso não passa pela porta — é escrita do
   * OS no próprio Drive dele, disparada por rotina, não ação proposta por
   * agente. Está anotado no relatório da fatia como decisão consciente.
   */
  async gravarArquivoNoDrive(
    orgId: string,
    entrada: { folderId: string; nome: string; conteudo: string; mimeType?: string },
  ): Promise<{ id: string; atualizado: boolean }> {
    const mime = entrada.mimeType ?? 'text/markdown';
    const nome = entrada.nome;
    const q = `name = '${nome.replace(/'/g, "\\'")}' and '${entrada.folderId}' in parents and trashed = false`;
    const achados = await this.api<{ files?: Array<{ id: string }> }>(
      orgId,
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
    );
    const existenteId = achados.files?.[0]?.id ?? null;

    const boundary = `mktos-${Math.random().toString(36).slice(2)}`;
    const metadata = existenteId ? {} : { name: nome, parents: [entrada.folderId], mimeType: mime };
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: ${mime}; charset=UTF-8\r\n\r\n` +
      `${entrada.conteudo}\r\n` +
      `--${boundary}--`;

    const url = existenteId
      ? `https://www.googleapis.com/upload/drive/v3/files/${existenteId}?uploadType=multipart&fields=id`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id';

    const r = await this.api<{ id: string }>(orgId, url, {
      method: existenteId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    return { id: r.id, atualizado: !!existenteId };
  }

  /*
   * ===================================================================
   * LER UMA VAULT DO OBSIDIAN QUE MORA NO DRIVE
   * ===================================================================
   *
   * O par de `gravarArquivoNoDrive`, e pelo mesmo motivo: é o OS lendo o Drive
   * DELE, por rotina, não ação proposta por agente. Destino fixo (uma pasta que
   * quem chama já tem), método fixo, sem URL vinda de fora — foi assim que o
   * passa-tudo `api()` deixou de ser público na fatia 3.3, e não vou reabri-lo
   * pela porta dos fundos.
   *
   * POR QUE SÓ `.md`, E POR QUE ISSO É REGRA E NÃO DETALHE: a vault real do
   * Pedro tem 1.524 notas `.md` e, ao lado delas, 1.634 jpg, 168 png e 146 mp4.
   * Uma varredura ingênua baixaria gigabytes de mídia a cada passada para
   * jogar tudo fora — a base de conhecimento indexa TEXTO. O filtro está na
   * consulta ao Drive, não depois: assim os anexos nem chegam a ser listados.
   *
   * O TETO NÃO É PARANOIA. O identificador de pasta vem de configuração, e uma
   * configuração errada pode apontar para a raiz do Drive inteiro. Sem teto,
   * uma letra trocada vira uma varredura de dezenas de milhares de arquivos
   * contra a cota da conta. Estourar o teto LANÇA em vez de devolver o que
   * coube: meia vault parece uma vault, e reindexar com metade apagaria o resto
   * do índice sem ninguém perceber.
   */
  async listarVaultNoDrive(
    orgId: string,
    folderId: string,
    limites: { maxArquivos?: number; maxProfundidade?: number; apenasRaiz?: boolean } = {},
  ): Promise<ArquivoDeVaultNoDrive[]> {
    const maxArquivos = limites.maxArquivos ?? 5000;
    const maxProfundidade = limites.maxProfundidade ?? 12;
    /*
     * `apenasRaiz` é para a SONDA, que tem 4,5 s e só precisa saber se a pasta
     * responde. Ele é um interruptor próprio, e não `maxProfundidade: 0`, porque
     * o teto de profundidade LANÇA ao ser estourado — de propósito, para meia
     * vault nunca passar por vault inteira. Uma vault com subpastas (todas têm)
     * faria a sonda ficar vermelha dizendo "mais de 0 níveis", que é acusar
     * defeito onde não há.
     */
    const apenasRaiz = limites.apenasRaiz === true;
    const achados: ArquivoDeVaultNoDrive[] = [];

    const visitar = async (pastaId: string, prefixo: string, profundidade: number): Promise<void> => {
      if (profundidade > maxProfundidade) {
        throw new BadRequestException(
          `A pasta do Drive tem mais de ${maxProfundidade} níveis a partir da raiz da vault. ` +
            'Isso é atalho circular ou pasta errada muito mais vezes do que é vault funda.',
        );
      }
      let pageToken: string | undefined;
      do {
        /*
         * `trashed = false` importa: arquivo na lixeira continua respondendo à
         * consulta por pasta e voltaria para o índice como nota viva.
         *
         * Os dois `...AllDrives` cobrem a pasta COMPARTILHADA — que é o caso
         * real aqui: a vault é de uma conta e o OS entra por outra. Sem eles,
         * uma vault em Drive compartilhado lista vazia, sem erro nenhum.
         */
        const q =
          `'${pastaId.replace(/'/g, "\\'")}' in parents and trashed = false and ` +
          "(mimeType = 'application/vnd.google-apps.folder' or name contains '.md')";
        const url =
          'https://www.googleapis.com/drive/v3/files' +
          `?q=${encodeURIComponent(q)}` +
          '&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true' +
          `&fields=${encodeURIComponent('nextPageToken,files(id,name,mimeType,modifiedTime,size)')}` +
          (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');

        const pagina = await this.api<{
          nextPageToken?: string;
          files?: Array<{ id: string; name: string; mimeType: string; modifiedTime?: string; size?: string }>;
        }>(orgId, url);

        for (const f of pagina.files ?? []) {
          if (f.mimeType === 'application/vnd.google-apps.folder') {
            // `.obsidian`, `.trash` e afins: mesma regra do walk do filesystem.
            if (f.name.startsWith('.')) continue;
            if (apenasRaiz) continue;
            await visitar(f.id, prefixo ? `${prefixo}/${f.name}` : f.name, profundidade + 1);
            continue;
          }
          /*
           * `name contains '.md'` é o que o Drive sabe filtrar, e ele casa
           * "notas.md.bak" também. A conferência exata é aqui.
           */
          if (!f.name.toLowerCase().endsWith('.md')) continue;
          if (f.name.startsWith('.')) continue;

          if (achados.length >= maxArquivos) {
            throw new BadRequestException(
              `A pasta do Drive tem mais de ${maxArquivos} arquivos .md. Ou o identificador aponta ` +
                'para uma pasta maior do que a vault, ou o teto precisa ser levantado de propósito. ' +
                'Nada foi indexado — meia vault reindexada apagaria o resto do índice.',
            );
          }
          achados.push({
            id: f.id,
            nome: f.name,
            caminho: prefixo ? `${prefixo}/${f.name}` : f.name,
            modificadoEm: f.modifiedTime ? new Date(f.modifiedTime) : new Date(0),
            bytes: f.size ? Number(f.size) : 0,
          });
        }
        pageToken = pagina.nextPageToken;
      } while (pageToken);
    };

    await visitar(folderId, '', 0);
    return achados;
  }

  /**
   * O conteúdo de um arquivo do Drive, como texto.
   *
   * `api()` não serve: ele manda `Content-Type: application/json` e faz
   * `res.json()` no retorno, e `alt=media` devolve o arquivo cru. Um `.md`
   * entraria no índice como erro de parse — que é o tipo de defeito que aparece
   * como "a busca não acha nada" três telas adiante.
   *
   * DOCUMENTO NATIVO DO GOOGLE NÃO PASSA POR AQUI, e a recusa é explícita. Um
   * Documento Google tem `mimeType` próprio e `alt=media` responde 403 para
   * ele: precisaria de `/export`. Medido em 13/09/2026, a vault do Pedro tem
   * ZERO arquivos nativos (nem .gdoc, nem .gsheet) — então isto não é caminho
   * morto por desenho, é caminho que ainda não existe. Quando existir, a frase
   * aqui diz o que fazer em vez de deixar um 403 solto subir.
   */
  async baixarTextoDoDrive(orgId: string, fileId: string): Promise<string> {
    const at = await this.token(orgId);
    const url =
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}` +
      '?alt=media&supportsAllDrives=true';
    const res = await fetch(url, { headers: { Authorization: `Bearer ${at}` } });
    if (!res.ok) {
      const corpo = await res.text().catch(() => '');
      if (res.status === 403 && corpo.includes('fileNotDownloadable')) {
        throw new BadRequestException(
          `O arquivo ${fileId} é um documento NATIVO do Google (Documento, Planilha), não um ` +
            'arquivo `.md`. Ele não baixa: precisa ser exportado, e a vault do Obsidian não ' +
            'deveria tê-lo. Converta para `.md` ou tire-o da pasta da vault.',
        );
      }
      throw new BadRequestException(`Drive alt=media ${fileId} → HTTP ${res.status} ${corpo.slice(0, 160)}`);
    }
    return res.text();
  }

  async appendDoc(orgId: string, docId: string, text: string, actorId?: string) {
    await this.api(orgId, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}:batchUpdate`,
      { method: 'POST', body: JSON.stringify({ requests: [{ insertText: { endOfSegmentLocation: {}, text } }] }) });
    await this.audit.log({
      orgId, actorId, action: 'google.docs.append', entityType: 'docs', entityId: docId, after: { chars: text.length },
    });
    return { ok: true, id: docId };
  }
}

// Monta um e-mail RFC 2822 e devolve em base64url (formato exigido pela API do Gmail).
function buildRawEmail(input: { to: string; subject: string; body: string; cc?: string }): string {
  const enc = (s: string) => `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
  const lines = [`To: ${input.to}`];
  if (input.cc) lines.push(`Cc: ${input.cc}`);
  lines.push(
    `Subject: ${enc(input.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(input.body, 'utf8').toString('base64'),
  );
  return Buffer.from(lines.join('\r\n'), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Decodifica base64url do corpo do Gmail (prioriza text/plain).
/**
 * O endereço do e-mail no Gmail. Estável: é a chave com que a pauta deduplica a
 * newsletter coletada (MC2), então mudar o formato duplica o que já entrou.
 */
function permalinkDoGmail(id: string): string {
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(id)}`;
}

function extractBody(payload: any): string {
  const walk = (p: any): string => {
    if (!p) return '';
    if (p.mimeType === 'text/plain' && p.body?.data) return b64url(p.body.data);
    for (const part of p.parts ?? []) { const r = walk(part); if (r) return r; }
    if (p.body?.data) return b64url(p.body.data);
    return '';
  };
  return walk(payload).slice(0, 20000);
}
function b64url(s: string): string {
  try { return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch { return ''; }
}
function extractDocText(doc: any): string {
  let out = '';
  for (const el of doc.body?.content ?? []) {
    for (const pe of el.paragraph?.elements ?? []) out += pe.textRun?.content ?? '';
  }
  return out.slice(0, 20000);
}
