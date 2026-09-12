import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { enderecoDeOrigem } from '../auth/endereco-de-origem';
import {
  AcessoDeSuporteService,
  type AcessoNaTela,
  type DiagnosticoDeSuporte,
} from './acesso-de-suporte.service';
import {
  ConsoleDaPlataformaService,
  type EmpresaNoConsole,
  type RegistroDeEmpresa,
  type ResumoDoConsole,
} from './console.service';
import { SessaoDaPlataformaGuard } from './sessao-da-plataforma.guard';
import {
  ALCADA_DA_AUTORIZACAO,
  AcessoDeSuporteNegadoError,
  AutorizacaoInvalidaError,
  ESCOPOS_DE_SUPORTE,
  EXIGE_REAUTENTICACAO,
  NIVEL_DA_AUTORIZACAO,
  PRAZO_MAXIMO_MINUTOS,
  PRAZO_MINIMO_MINUTOS,
  PRAZO_PADRAO_MINUTOS,
} from './plataforma';

/*
 * ============================================================================
 * AS ROTAS DO CONSOLE — e por que elas moram sob `tenants/`
 * ============================================================================
 *
 * O prefixo de rota da API é DECLARADO, e a função que resolve LANÇA para
 * prefixo que ninguém declarou (`moduloDoCaminho`, em `src/tenants/modulos.ts`).
 * A declaração tem dois lados possíveis: módulo de negócio, que se contrata, ou
 * espinha do OS, que nunca desliga.
 *
 * O console da plataforma não é nem um nem outro, e é aí que está a decisão:
 * ele não é módulo de empresa nenhuma (nenhum cliente contrata "ver os outros
 * clientes") e chamá-lo de espinha diria que ele faz parte do sistema que toda
 * empresa tem. A terceira categoria não existe naquele arquivo — e aquele
 * arquivo não é desta fatia, porque quatro agentes escrevem no mesmo worktree
 * agora e a última escrita venceria.
 *
 * Então as rotas entram na família `tenants`, que JÁ é espinha declarada e JÁ é
 * a família que fala de empresas ("quais módulos eu tenho", "provisionar"). Não
 * é gambiarra de nome: o console é a visão da plataforma sobre os tenants, e a
 * espinha não o expõe a ninguém — quem decide quem entra é
 * `SessaoDaPlataformaGuard`, não o gate de módulos.
 *
 * O caminho para promover isto a uma família própria (`plataforma`) está no
 * relatório da fatia, em FORA DO ESCOPO: é uma linha em `PREFIXOS_DA_ESPINHA` e
 * a troca do prefixo aqui.
 *
 * ----------------------------------------------------------------------------
 * DOIS CONTROLADORES, DOIS LADOS DO BALCÃO
 * ----------------------------------------------------------------------------
 * `PlataformaController` é o lado de QUEM OPERA a plataforma: exige a sessão da
 * empresa da plataforma — a de `SLUG_DA_PLATAFORMA` (`src/tenants/provisionar.ts`,
 * hoje `root`), a mesma que o provisionamento já usa.
 * `SuporteDoClienteController` é o lado do CLIENTE: é ele quem autoriza, vê e
 * revoga o acesso à casa dele. Nenhuma das rotas dele aceita "em que empresa" —
 * a empresa é a da sessão, sempre.
 */

/** A forma do corpo que autoriza um acesso. Sem `any`, e sem Zod novo. */
interface CorpoDaAutorizacao {
  operadorEmail?: unknown;
  operadorNome?: unknown;
  escopo?: unknown;
  motivo?: unknown;
  minutos?: unknown;
  /** A prova de presença de R4: a senha de quem assina. Nunca sai daqui. */
  senha?: unknown;
}

@UseGuards(JwtAuthGuard, SessaoDaPlataformaGuard, PermissionsGuard)
@Controller('tenants/plataforma')
export class PlataformaController {
  constructor(
    private readonly console: ConsoleDaPlataformaService,
    private readonly suporte: AcessoDeSuporteService,
  ) {}

  /** A tela pergunta isto antes de montar: "esta sessão opera a plataforma?". */
  @Get('quem-sou')
  @RequirePermissions('dashboard.ver')
  quemSou(@CurrentUser() user: JwtUser): { plataforma: true; email: string; nome: string } {
    // Chegar aqui já é a resposta: o guarda recusou todo o resto.
    return { plataforma: true, email: user.email, nome: user.name };
  }

  @Get('resumo')
  @RequirePermissions('dashboard.ver')
  resumo(): Promise<ResumoDoConsole> {
    return this.console.resumo();
  }

  @Get('empresas')
  @RequirePermissions('dashboard.ver')
  empresas(): Promise<EmpresaNoConsole[]> {
    return this.console.empresas();
  }

  /*
   * O REGISTRO COMERCIAL DA PRÓPRIA PLATAFORMA. Escrita, e por isso pede a
   * permissão forte — mas repare que ela é a MESMA de "entrar na casa do
   * cliente", logo abaixo, e não mais forte.
   *
   * Na primeira versão desta fatia as duas estavam invertidas em sensibilidade:
   * mexer no plano e na mensalidade de um cliente pedia `admin.permissoes` e
   * ENTRAR NA CASA DELE pedia `dashboard.ver`, que todo papel tem, inclusive
   * `consulta_limitada`. Quer dizer: qualquer sessão da plataforma usava o
   * acesso de suporte, e só um administrador corrigia um valor de mensalidade.
   */
  @Put('empresas/:empresaId')
  @RequirePermissions('admin.permissoes')
  registrar(
    @Param('empresaId') empresaId: string,
    @Body() corpo: RegistroDeEmpresa,
  ): Promise<EmpresaNoConsole> {
    return this.console.registrar(empresaId, corpo ?? {});
  }

  /**
   * Entrar na casa do cliente, com a autorização dele.
   *
   * `POST` e não `GET` de propósito: isto não é uma leitura idempotente qualquer
   * — cada chamada gasta um uso, carimba a autorização e grava no RASTRO do
   * cliente. `GET` convida cache, prefetch do navegador e link compartilhável;
   * nenhum dos três combina com "cada acesso fica registrado".
   *
   * `admin.permissoes` E NÃO `dashboard.ver`. Esta é a rota mais sensível do
   * console: é a que atravessa a fronteira entre a plataforma e a empresa do
   * cliente. Ela não pode pedir menos do que a rota que edita um número
   * comercial. A permissão do catálogo que fala de ACESSO é esta.
   */
  @Post('empresas/:empresaId/suporte')
  @RequirePermissions('admin.permissoes')
  async usarSuporte(
    @Param('empresaId') empresaId: string,
    @Body() corpo: { escopo?: unknown },
    @CurrentUser() user: JwtUser,
  ): Promise<DiagnosticoDeSuporte> {
    const escopo = typeof corpo?.escopo === 'string' ? corpo.escopo : ESCOPOS_DE_SUPORTE[0];
    try {
      return await this.suporte.usar(
        empresaId,
        { id: user.sub, nome: user.name, email: user.email },
        escopo,
      );
    } catch (e) {
      if (e instanceof AcessoDeSuporteNegadoError) {
        // 403 com o motivo em vocabulário fechado: a tela distingue "nunca
        // autorizou" de "venceu" sem ler a frase em português.
        throw new ForbiddenException({ message: e.message, codigo: e.motivo });
      }
      throw traduzir(e);
    }
  }
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('tenants/suporte')
export class SuporteDoClienteController {
  constructor(private readonly suporte: AcessoDeSuporteService) {}

  /**
   * As regras que a tela do cliente precisa mostrar ANTES do formulário.
   *
   * Sai da API e não do componente pelo mesmo motivo do endereço da fila de
   * aprovação: prazo máximo escrito na tela é a forma garantida de os dois lados
   * divergirem na próxima fatia — e aqui a divergência apareceria como um
   * formulário que aceita 7 dias e uma API que recusa.
   */
  @Get('regras')
  @RequirePermissions('dashboard.ver')
  regras(): {
    escopos: readonly string[];
    minutosMinimo: number;
    minutosMaximo: number;
    minutosPadrao: number;
    nivel: string;
    alcada: string;
    exigeSenha: boolean;
  } {
    // Os valores saem das MESMAS constantes que o serviço compara — a tela
    // afirmava "só quem tem alçada titular assina" enquanto a API media a
    // alçada do token; agora as duas frases falam do mesmo mecanismo.
    return {
      escopos: ESCOPOS_DE_SUPORTE,
      minutosMinimo: PRAZO_MINIMO_MINUTOS,
      minutosMaximo: PRAZO_MAXIMO_MINUTOS,
      minutosPadrao: PRAZO_PADRAO_MINUTOS,
      nivel: NIVEL_DA_AUTORIZACAO,
      alcada: ALCADA_DA_AUTORIZACAO,
      exigeSenha: EXIGE_REAUTENTICACAO,
    };
  }

  @Get()
  @RequirePermissions('dashboard.ver')
  listar(): Promise<AcessoNaTela[]> {
    return this.suporte.listar();
  }

  /**
   * O cliente autoriza.
   *
   * `admin.permissoes` é a permissão que o catálogo já dá a quem mexe em acesso
   * (`usuario.permissao.alterar`, R4). Ela é NECESSÁRIA e não suficiente: a
   * alçada `titular` é conferida no serviço, contra o papel LIDO DO BANCO, e
   * junto dela vem a reautenticação — as duas coisas que R4 exige e que o token
   * de oito horas não consegue afirmar.
   *
   * A SENHA CHEGA NO CORPO e não sai deste método: vai direto para
   * `ReauthService`, que a compara com o hash. Ela nunca entra no RASTRO, nunca
   * entra no log e nunca volta na resposta.
   */
  @Post()
  @RequirePermissions('admin.permissoes')
  async autorizar(
    @Body() corpo: CorpoDaAutorizacao,
    @CurrentUser() user: JwtUser,
    @Req() req: unknown,
  ): Promise<AcessoNaTela> {
    try {
      return await this.suporte.autorizar(
        {
          operadorEmail: texto(corpo?.operadorEmail),
          operadorNome: texto(corpo?.operadorNome),
          escopo: texto(corpo?.escopo) || ESCOPOS_DE_SUPORTE[0],
          motivo: texto(corpo?.motivo),
          minutos: typeof corpo?.minutos === 'number' ? corpo.minutos : undefined,
          senha: texto(corpo?.senha) || undefined,
        },
        {
          id: user.sub,
          nome: user.name,
          email: user.email,
          papeis: user.roles ?? [],
          ip: enderecoDeOrigem(req as { ip?: string; ips?: string[] }),
        },
      );
    } catch (e) {
      throw traduzir(e);
    }
  }

  @Delete(':id')
  @RequirePermissions('admin.permissoes')
  async revogar(@Param('id') id: string, @CurrentUser() user: JwtUser): Promise<AcessoNaTela> {
    try {
      return await this.suporte.revogar(id, {
        id: user.sub,
        nome: user.name,
        email: user.email,
        papeis: user.roles ?? [],
      });
    } catch (e) {
      throw traduzir(e);
    }
  }
}

/* ---------------------------------------------------------------- ajudantes */

function texto(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Erro de pedido vira 400; o resto sobe como está.
 *
 * `AutorizacaoInvalidaError` carrega a frase que a pessoa precisa ler ("escreva
 * o motivo", "o prazo precisa ficar entre…"). Deixá-lo subir daria 500 e
 * esconderia a frase atrás de "Internal server error".
 */
function traduzir(e: unknown): unknown {
  if (e instanceof AutorizacaoInvalidaError) return new BadRequestException(e.message);
  return e;
}
