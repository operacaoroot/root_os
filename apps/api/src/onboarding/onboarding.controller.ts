import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';

import { TEMAS_DA_CARGA } from '../agents/roster';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { enderecoDeOrigem, type RequisicaoComEndereco } from '../auth/endereco-de-origem';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import {
  CadastroInvalidoError,
  CadastroSemSlugError,
  EmailJaTemCasaError,
} from './cadastro';
import { RespostaVaziaError, TemaDesconhecidoError } from './carga-guiada';
import { FONTES_DA_ENTRADA } from './passos';
import { AssistenteIncompletoError, OnboardingService } from './onboarding.service';
import { RetratoSemFonteError } from './retrato';
import { TetoDeCadastro } from './teto-de-taxa';

/* ==========================================================================
 * O DEGRAU DE ENTRADA — RF-O-01, RF-O-02, RF-M-05
 * ==========================================================================
 *
 * O PREFIXO É `tenants`, E ISSO É DECISÃO, NÃO ACIDENTE.
 *
 * `tenants/modulos.ts` mapeia o PRIMEIRO segmento depois de `/api` para um
 * módulo contratado, e `moduloDoCaminho` LANÇA para prefixo que não está
 * declarado em nenhum dos dois conjuntos — falha em tempo de execução, não só
 * teste vermelho. `tenants` já está declarado como ESPINHA DO OS, e é
 * exatamente o que a entrada é: ela fala do sistema (a empresa existe? o
 * contexto está carregado?), não do negócio do cliente, e precisa responder
 * para uma empresa que não contratou módulo nenhum — que é a situação de toda
 * empresa no minuto em que ela nasce.
 *
 * Pendurar a entrada sob `tenants` também evita editar `modulos.ts`, que quatro
 * outras fatias desta onda estão tocando ao mesmo tempo: a última escrita
 * venceria e a linha de alguém sumiria. A decisão está no relatório.
 *
 * ----------------------------------------------------------------------------
 * A ROTA DE CADASTRO É ANÔNIMA, E RESPONDE SEMPRE A MESMA COISA
 * ----------------------------------------------------------------------------
 * Quem chega não tem conta — é o ponto do degrau de entrada. Só que rota
 * anônima que responde diferente conforme o que existe no banco é um oráculo:
 * `events.controller.ts` já pagou essa conta na ingestão do pixel, e a lição
 * vale aqui inteira.
 *
 * Então: nome de empresa já usado, e-mail que já pertence a outra empresa,
 * cadastro novo — os três devolvem A MESMA resposta. O que muda é o que ficou
 * gravado, e isso quem lê é a auditoria, não quem chamou.
 *
 * O QUE AINDA DISTINGUE, declarado porque fingir que não existe é pior: o
 * TEMPO. Criar empresa escreve mais do que não criar, e isso é observável de
 * fora. Quem estreita esse canal é o TETO DE TAXA abaixo — com cinco tentativas
 * por hora e por origem, medir diferença de tempo com significância vira caro.
 *
 * ----------------------------------------------------------------------------
 * O TETO DE TAXA É PRÉ-CONDIÇÃO DE SUBIR, NÃO ENFEITE
 * ----------------------------------------------------------------------------
 * Cada cadastro bem-sucedido escreve cerca de VINTE linhas — empresa, usuário,
 * nove papéis com vínculos, dois agentes, dois procedimentos, auditoria e
 * evento — e o `EventLog` não se apaga (RULE de append-only). A primeira
 * entrega desta fatia declarou isto numa pergunta e subiu assim mesmo; declarar
 * não contém. O contador está em `teto-de-taxa.ts`, com os limites do desenho
 * (por processo, em memória) escritos lá.
 *
 * A ORIGEM vem de `enderecoDeOrigem`, que lê o que o Express já podou sob
 * `trust proxy` — nunca `X-Forwarded-For` na mão, que deixaria quem chama
 * escolher o balde.
 */

const CadastroSchema = z.object({
  empresa: z.string().trim().min(2).max(120),
  nome: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
});

const RespostaSchema = z.object({
  tema: z.string().trim().min(1).max(60),
  /**
   * O teto é generoso de propósito: quem está contando o próprio negócio não
   * pode esbarrar num limite no meio da frase. O corte de verdade acontece em
   * `cortar`, por ponto de código, antes de virar nota.
   */
  resposta: z.string().min(1).max(20_000),
});

const PerguntaSchema = z.object({ pergunta: z.string().trim().min(3).max(2000) });

/**
 * A resposta da rota anônima. UMA, para qualquer desfecho — ver o cabeçalho.
 *
 * `Object.freeze` porque ela é devolvida por referência: um dia alguém escreve
 * `RESPOSTA_DO_CADASTRO.slug = …` num caminho de sucesso e a constante vira
 * variável global, com o dado de um cadastro vazando para o seguinte.
 */
const RESPOSTA_DO_CADASTRO = Object.freeze({
  ok: true,
  proximoPasso:
    'Pronto. Entre com a conta Google do e-mail que você informou — é ela que confirma quem ' +
    'você é. Do login em diante o OS conduz a carga do contexto.',
  entrar: '/login',
});

@Controller('tenants/onboarding')
export class OnboardingController {
  private readonly log = new Logger('OnboardingController');

  /*
   * UMA instância por controlador, e o controlador é singleton no Nest — é isso
   * que faz o contador contar. Campo de instância, e não `static`: `static`
   * seria compartilhado entre testes do mesmo processo e um caso encheria o
   * balde do outro.
   */
  private readonly teto = new TetoDeCadastro();

  /*
   * A PORTA DA RUA TEM TRANCA, E ELA NASCE FECHADA.
   *
   * `POST onboarding/cadastro` é anônima por desenho: é o degrau 0 do produto,
   * em que a pessoa entra sozinha, sem convite e sem ninguém da ROOT no
   * caminho. Isso é a fatia funcionando.
   *
   * Só que a rota vive no MESMO processo que atende `os.operacaoroot.com`, e no
   * dia em que este código subir ela passa a existir na internet. Sem tranca,
   * qualquer pessoa que ache a URL cria uma empresa no banco de produção, entra
   * nela pelo login com Google — que a rota provisiona, e por isso a allowlist
   * de e-mail não a alcança — e gasta modelo na conta da casa. O teto de taxa
   * acima limita a VAZÃO (cinco por hora por origem), não o DIREITO: cinco
   * empresas por hora continuam sendo cadastro público aberto.
   *
   * Então a abertura é uma DECISÃO, tomada uma vez, por quem responde pela
   * conta — e não um efeito colateral de um deploy. `ONBOARDING_ABERTO=sim`
   * abre; qualquer outro valor, e a ausência, mantém fechada.
   *
   * LIDA NO CONSTRUTOR, de propósito, igual a `GATEWAY_MODO`: assim o estado da
   * porta aparece no log de arranque e não muda no meio da vida do processo.
   * Trocar exige recriar o container (`up -d --no-build api`); `docker restart`
   * não serve, porque variável de ambiente é fixada na criação.
   */
  private readonly aberto = (process.env.ONBOARDING_ABERTO ?? '').trim().toLowerCase() === 'sim';


  constructor(private readonly svc: OnboardingService) {}

  // ------------------------------------------------------------------ público

  /**
   * Criar a conta. Sem token, sem convite, sem ninguém da ROOT no caminho.
   *
   * NÃO DEVOLVE O IDENTIFICADOR DA EMPRESA nem o dela no banco. Quem se
   * cadastrou não precisa: entra pelo login com a conta Google e cai na empresa
   * que acabou de nascer. Devolver o slug transformaria a resposta num canal
   * lateral sobre o que já existe no banco.
   */
  @Post('cadastro')
  async cadastro(@Body() body: unknown, @Req() req?: RequisicaoComEndereco) {
    /*
     * A TRANCA VEM ANTES DO TETO, e antes do Zod. Porta fechada não gasta o
     * balde de ninguém e não conta como tentativa: quem tenta cadastrar numa
     * instalação fechada não está atacando o teto, está batendo numa porta que
     * não abre.
     *
     * 404 e não 403: a rota FECHADA não confirma que existe. Um 403 diria "há
     * cadastro aqui, só não para você", que é exatamente a informação que não
     * interessa dar de graça a quem varre a internet por endpoint de cadastro.
     */
    if (!this.aberto) {
      this.log.warn(
        `cadastro RECUSADO: a instalação está FECHADA para cadastro (origem=${enderecoDeOrigem(req) ?? '?'}). ` +
          'Para abrir, ONBOARDING_ABERTO=sim no bloco environment do serviço api e recriar o container ' +
          '(up -d --no-build api). Nada foi criado.',
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.NOT_FOUND,
          message: 'Não encontrado.',
        },
        HttpStatus.NOT_FOUND,
      );
    }

    /*
     * O TETO VEM ANTES DO ZOD, e a ordem importa: corpo inválido também é
     * tentativa. Um contador que só medisse pedido bem formado seria contornado
     * com um campo a menos.
     */
    const origem = enderecoDeOrigem(req);
    const veredicto = this.teto.registrar(origem);
    if (!veredicto.permitido) {
      this.log.warn(
        `cadastro RECUSADO por teto de taxa (${veredicto.estourou}): origem=${origem ?? '?'}. ` +
          'Cinco por hora por origem, cem por hora na instalação inteira — ver teto-de-taxa.ts.',
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message:
            'Tentativas de cadastro demais. Espere alguns minutos e tente de novo — nada foi ' +
            'criado nesta chamada.',
          esperarSegundos: veredicto.esperarSegundos,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const entrada = CadastroSchema.parse(body);
    try {
      const cadastro = await this.svc.cadastrar({
        empresa: entrada.empresa,
        responsavel: { nome: entrada.nome, email: entrada.email },
      });
      await this.svc.auditarCadastro(cadastro.orgId, 'onboarding.cadastro.criado', {
        slug: cadastro.slug,
        colisoes: cadastro.colisoes,
        agentes: cadastro.roster?.criados ?? [],
        origem: 'http',
      });
      return RESPOSTA_DO_CADASTRO;
    } catch (e) {
      /*
       * TRÊS DESFECHOS, UMA RESPOSTA.
       *
       * `EmailJaTemCasaError` — quem chegou já tem conta em outra empresa. Dizer
       * isso confirmaria, para qualquer pessoa, que um e-mail é cliente da ROOT.
       * `CadastroSemSlugError` — colisão repetida de sufixo aleatório; é defeito
       * nosso, e o cliente não tem o que fazer com ele.
       * Qualquer outro erro — também não vira mensagem diferente.
       *
       * O log fica com a verdade, com nome de classe e mensagem.
       */
      const erro = e as Error;
      /*
       * A ÚNICA RECUSA QUE VOLTA COMO RECUSA é sobre o que ELE digitou — e ela
       * precisa virar `BadRequestException`, não subir crua. `CadastroInvalidoError`
       * é um `Error` comum: relançado assim, o Nest o traduzia para 500, e a tela
       * mostrava "erro interno" para um nome de empresa curto demais. Era uma das
       * duas exceções desta fatia que devolviam erro de servidor enquanto as
       * irmãs viravam recusa.
       */
      if (erro instanceof CadastroInvalidoError) {
        throw new BadRequestException({ message: erro.message, campo: erro.campo });
      }
      this.log.warn(
        `cadastro não criou empresa (${erro.name}): ${erro.message}` +
          (e instanceof EmailJaTemCasaError || e instanceof CadastroSemSlugError
            ? ''
            : ' — ESTE É INESPERADO, investigue.'),
      );
      return RESPOSTA_DO_CADASTRO;
    }
  }

  // ------------------------------------------------------------- autenticadas

  /**
   * Onde a entrada está. Derivado do banco a cada chamada — ver `passos.ts`.
   *
   * `dashboard.ver` porque é leitura de estado do próprio painel: quem entrou
   * precisa ver onde parou, mesmo sem poder editar a memória.
   */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Get('estado')
  @RequirePermissions('dashboard.ver')
  async estado(@CurrentUser() user: JwtUser) {
    return {
      ...(await this.svc.estado(user.orgId)),
      fontes: FONTES_DA_ENTRADA,
    };
  }

  /**
   * O roteiro do carregador, para a tela poder mostrar o caminho inteiro.
   *
   * Vem do PROCEDIMENTO do agente (`agents/roster/`), não de uma lista no
   * front: é o mesmo roteiro que a semente grava em `Sop` e que a tela de
   * Agentes mostra. Duas listas divergiriam no primeiro ajuste.
   */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Get('roteiro')
  @RequirePermissions('dashboard.ver')
  roteiro() {
    return {
      temas: TEMAS_DA_CARGA.map((t) => ({
        id: t.id,
        titulo: t.titulo,
        pergunta: t.pergunta,
        obrigatorio: t.obrigatorio,
        especie: t.kind,
      })),
    };
  }

  /**
   * A resposta de um tema. É o passo do procedimento que estrutura.
   *
   * `obsidian.editar` é a permissão da MEMÓRIA (a mesma de `POST /api/memoria`),
   * e é a certa: o que esta rota faz é escrever nota de contexto. Usar uma
   * permissão própria criaria uma segunda porta para a mesma escrita.
   */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Post('carga/resposta')
  @RequirePermissions('obsidian.editar')
  async responder(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const { tema, resposta } = RespostaSchema.parse(body);
    try {
      return await this.svc.responder(user.orgId, tema, resposta);
    } catch (e) {
      if (e instanceof TemaDesconhecidoError || e instanceof RespostaVaziaError) {
        throw new BadRequestException((e as Error).message);
      }
      throw e;
    }
  }

  /**
   * Fecha a carga: o OS lê de volta o que entendeu, citando cada nota.
   *
   * É a PRIMEIRA RESPOSTA do produto, e ela não tem como sair sem fonte —
   * `retrato.ts` explica por que ela é construída em vez de pedida ao modelo.
   */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Post('carga/fechar')
  @RequirePermissions('obsidian.editar')
  async fechar(@CurrentUser() user: JwtUser) {
    try {
      return await this.svc.fechar(user.orgId);
    } catch (e) {
      /*
       * A SEGUNDA EXCEÇÃO QUE SUBIA COMO 500. Pedir o retrato sem nota nenhuma
       * é pedido inválido, não defeito do servidor: quem chamou precisa saber
       * que o que falta é responder a carga — e a mensagem de
       * `RetratoSemFonteError` diz exatamente isso.
       */
      if (e instanceof RetratoSemFonteError) throw new BadRequestException(e.message);
      throw e;
    }
  }

  /**
   * A primeira pergunta livre, pelo laço de verdade.
   *
   * A permissão é a MESMA que `POST /api/agents/:slug/executar` exige
   * (`mcp.executar` + `admin.usuarios`): esta rota faz um agente rodar, e um
   * agente alcança a porta. Uma trava mais frouxa aqui seria uma segunda porta
   * para a execução de agente, contornando a decisão que aquele controller
   * documenta.
   */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Post('primeira-pergunta')
  @RequirePermissions('mcp.executar', 'admin.usuarios')
  async primeiraPergunta(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const { pergunta } = PerguntaSchema.parse(body);
    try {
      return await this.svc.primeiraPergunta(user.orgId, pergunta, {
        id: user.sub,
        rotulo: user.name || user.email || user.sub,
      });
    } catch (e) {
      /*
       * 409 e não 500: a empresa existe e a carga existe — o que falta é um
       * agente que o sistema devia ter criado, e o conserto já está disparado
       * (a leitura de estado re-semeia). Ver `AssistenteIncompletoError`.
       */
      if (e instanceof AssistenteIncompletoError) throw new ConflictException(e.message);
      throw e;
    }
  }
}
