import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ActorType, ApprovalState, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { impressaoDaSenha, lerAprovador, type AprovadorDoBanco } from './aprovador';

/*
 * REAUTENTICAÇÃO DE VERDADE.
 *
 * A escada diz que R4 e R5 "exigem reautenticação". Até 11/09/2026 o código
 * cumpria isso GRAVANDO `reautenticadoEm: new Date()` no momento da confirmação
 * — quer dizer, o sistema anotava que alguém tinha reautenticado sem nunca ter
 * pedido nada a ninguém. O campo era uma afirmação falsa escrita pelo próprio
 * programa, e ele ia para o RASTRO, que é o lugar onde as afirmações do sistema
 * deveriam valer como prova.
 *
 * O QUE CONTA COMO PROVA, E POR QUE NÃO É UM FATOR NOVO
 * O módulo de autenticação suporta hoje DOIS jeitos de alguém provar quem é:
 * senha local (bcrypt, `AuthService.login`) e a conta Google (OAuth). Segundo
 * fator TOTP, WebAuthn ou push não existem aqui e ligá-los seria dependência
 * nova — decisão humana, fora desta fatia. Então a prova é a SENHA do próprio
 * aprovador, conferida contra o `passwordHash` do banco no instante da
 * confirmação. É o mesmo material do login; o que muda é que ele é exigido de
 * novo, agora, para esta aprovação.
 *
 * DUAS FORMAS DE APRESENTAR A PROVA, e a diferença entre elas é só de interface:
 *
 *  - `{ senha }` — direto na confirmação. Uma viagem, nenhum estado.
 *  - `{ token }` — a tela pede a senha uma vez em `POST /auth/reautenticar`,
 *    recebe uma prova curta e a apresenta na confirmação. A senha não passa pelo
 *    corpo da rota de aprovação.
 *
 * A PROVA EM TOKEN É PRESA À APROVAÇÃO (`apr`), ao usuário (`sub`) e à SENHA
 * VIGENTE (`pwd`, a impressão do hash), e vale JANELA_SEGUNDOS. Sem o vínculo
 * com a aprovação ela seria um passe genérico de reautenticação; sem o vínculo
 * com a senha, trocar a senha depois de a sessão ter sido roubada não mataria a
 * prova já emitida — a vítima acharia que tinha resolvido e a janela seguiria
 * aberta.
 *
 * O QUE ELA AINDA NÃO É: uso único. Dentro da janela, a mesma prova reabre a
 * MESMA aprovação — o que, na prática, não repete efeito nenhum, porque a
 * aprovação em si é de uso único (`consumir`/`executarAprovada` usam escrita
 * condicional). Uso único de verdade pediria uma tabela de provas gastas, e
 * `prisma/` não é desta fatia; está no relatório.
 *
 * O BURACO DE PROPÓSITO DE TOKEN, fechado de passagem: esta prova é assinada
 * pelo MESMO assinador da sessão. Se o `JwtAuthGuard` continuasse conferindo só
 * a assinatura, ela seria aceita como token de sessão. Por isso todo token deste
 * sistema agora declara `typ`, e o guarda recusa o que não for `sessao`.
 */

/** Marca o token como prova de reautenticação — nunca como sessão. */
export const TIPO_DA_PROVA = 'reauth';

/** Quanto tempo uma prova em token vale. Curto de propósito: R4 expira em 600s. */
export const JANELA_DA_PROVA_SEGUNDOS = 300;

/*
 * A TRAVA DE TENTATIVA REPETIDA — o remendo barato, não o conserto.
 *
 * O revisor mediu: sessenta tentativas simultâneas contra a senha do titular
 * responderam em menos de quatro segundos, quinze por segundo, sem nenhuma
 * recusa por excesso. Duas agravantes: `bcryptjs` é JavaScript puro e roda na
 * MESMA fila do processo — atacar a senha era, junto, uma negação de serviço da
 * API inteira —, e cada falha gravava uma linha de auditoria sem teto, então
 * quem atacava escolhia o tamanho do rastro.
 *
 * O conserto definitivo é limite de taxa na borda, que não existe em lugar
 * nenhum desta API e é fatia própria (está no relatório). O que cabe aqui são
 * duas medidas locais:
 *
 *  1. FILA POR APROVAÇÃO — no máximo uma conferência de senha por vez para o
 *     mesmo par (pessoa, aprovação). Sessenta tentativas simultâneas deixam de
 *     ser sessenta bcrypts simultâneos e viram fila; o contador abaixo alcança o
 *     atacante antes da sexta. Sem isso o contador não pega ataque PARALELO:
 *     todas as tentativas leriam zero antes de a primeira recusa ser escrita.
 *  2. TETO POR JANELA — a partir de `LIMITE_DE_RECUSAS` recusas registradas no
 *     RASTRO para o mesmo par, recusa sem chamar bcrypt. E a trava grava UMA
 *     linha por janela, não uma por tentativa: o tamanho do rastro deixa de ser
 *     escolha de quem ataca.
 */
export const LIMITE_DE_RECUSAS = 5;
const JANELA_DA_TRAVA_SEGUNDOS = 900;

/** Como quem aprova demonstra que é ele mesmo, agora. */
export type ProvaDeReauth = { senha: string } | { token: string };

export interface ProvaConferida {
  /** O instante em que a pessoa de fato provou — vai para `reautenticadoEm`. */
  em: Date;
  /** Papéis do aprovador SEGUNDO O BANCO, não segundo o token de sessão. */
  papeis: string[];
  /** Como ela provou. Entra no RASTRO. */
  forma: 'senha' | 'prova';
}

interface ClaimsDaProva {
  typ?: string;
  sub?: string;
  org?: string;
  apr?: string;
  pwd?: string;
  iat?: number;
}

@Injectable()
export class ReauthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  /** A fila da medida (1): uma conferência de senha por vez, por par. */
  private readonly filaPorAprovacao = new Map<string, Promise<unknown>>();

  /**
   * Troca a senha do próprio usuário por uma prova curta, presa a UMA aprovação.
   *
   * Chamada por `POST /auth/reautenticar`, já autenticado: quem pede a prova é
   * sempre o dono da sessão (`sub` vem do token, nunca do corpo).
   */
  async provar(input: {
    userId: string;
    orgId: string;
    senha: string;
    aprovacaoId: string;
    ip?: string;
  }): Promise<{ token: string; expiraEm: string }> {
    /*
     * A APROVAÇÃO TEM DE EXISTIR. Sem esta conferência a rota emitia prova para
     * identificador inventado: um oráculo de senha desacoplado de qualquer fila
     * — dava para descobrir a senha de alguém sem nunca tocar numa aprovação de
     * verdade, e sem deixar rastro preso a nada que alguém fosse olhar.
     */
    const aprovacao = await this.prisma.approval.findFirst({
      where: { id: input.aprovacaoId, orgId: input.orgId },
      select: { id: true, status: true, expiraEm: true },
    });
    if (!aprovacao) throw new NotFoundException('Aprovação não encontrada');
    if (aprovacao.status !== ApprovalState.pendente || aprovacao.expiraEm < new Date()) {
      throw new ForbiddenException('Esta aprovação não está mais esperando decisão.');
    }

    const usuario = await this.conferirSenha(
      input.userId,
      input.orgId,
      input.senha,
      input.aprovacaoId,
      input.ip,
    );

    const token = await this.jwt.signAsync(
      {
        typ: TIPO_DA_PROVA,
        sub: input.userId,
        org: input.orgId,
        apr: input.aprovacaoId,
        pwd: impressaoDaSenha(usuario.passwordHash),
      },
      { expiresIn: JANELA_DA_PROVA_SEGUNDOS },
    );
    return {
      token,
      expiraEm: new Date(Date.now() + JANELA_DA_PROVA_SEGUNDOS * 1000).toISOString(),
    };
  }

  /**
   * Confere a prova apresentada na confirmação de uma aprovação.
   *
   * Devolve também os PAPÉIS DO BANCO — mas a releitura do banco já não depende
   * daqui: desde 11/09/2026 quem confirma é relido em TODO nível, antes da trava
   * de alçada (`ApprovalsService.confirm`), porque R2 e R3 não passam por esta
   * função e decidiam a alçada com um token de oito horas.
   *
   * Lança sempre que não conferir. Nunca devolve "não deu, siga em frente".
   */
  async conferir(input: {
    userId: string;
    orgId: string;
    aprovacaoId: string;
    prova?: ProvaDeReauth;
    ip?: string;
  }): Promise<ProvaConferida> {
    if (!input.prova) {
      /*
       * Não é recusa de credencial: é a porta dizendo o que falta. Fica fora do
       * contador da trava de propósito — quem clica "confirmar" antes de digitar
       * a senha não pode se trancar sozinho fora da própria aprovação.
       */
      await this.registrar(
        'auth.reautenticacao.exigida',
        input.orgId,
        input.userId,
        input.aprovacaoId,
        { motivo: 'prova-ausente' },
        input.ip,
      );
      throw new ForbiddenException(
        'Esta ação exige reautenticação: confirme sua senha para aprovar.',
      );
    }

    if ('senha' in input.prova) {
      const usuario = await this.conferirSenha(
        input.userId,
        input.orgId,
        input.prova.senha,
        input.aprovacaoId,
        input.ip,
      );
      return { em: new Date(), papeis: usuario.papeis, forma: 'senha' };
    }

    return this.conferirToken(
      input.userId,
      input.orgId,
      input.aprovacaoId,
      input.prova.token,
      input.ip,
    );
  }

  /**
   * O aprovador, do BANCO, ativo, na empresa da aprovação — ou recusa.
   *
   * Pública porque `ApprovalsService.confirm` a chama em todo nível. A consulta
   * em si mora em `aprovador.ts`: uma cópia só.
   */
  async exigirAprovadorAtivo(
    userId: string,
    orgId: string,
    aprovacaoId: string,
    ip?: string,
  ): Promise<AprovadorDoBanco> {
    const usuario = await lerAprovador(this.prisma, userId, orgId);
    if (!usuario || !usuario.ativo) {
      await this.registrarRecusa(
        orgId,
        userId,
        aprovacaoId,
        usuario ? 'usuario-inativo' : 'usuario-inexistente',
        ip,
      );
      throw new ForbiddenException('Quem aprova precisa ser um usuário ativo desta empresa.');
    }
    return usuario;
  }

  // ------------------------------------------------------------------ senha

  /** Confere a senha contra o hash do banco. Devolve o aprovador do banco. */
  private async conferirSenha(
    userId: string,
    orgId: string,
    senha: string,
    aprovacaoId: string,
    ip?: string,
  ): Promise<AprovadorDoBanco> {
    return this.emFila(`${orgId}|${userId}|${aprovacaoId}`, async () => {
      await this.exigirAbaixoDoTeto(orgId, userId, aprovacaoId, ip);

      const usuario = await this.exigirAprovadorAtivo(userId, orgId, aprovacaoId, ip);

      const ok =
        typeof senha === 'string' && senha.length > 0
          ? await bcrypt.compare(senha, usuario.passwordHash)
          : false;
      if (!ok) {
        await this.registrarRecusa(orgId, userId, aprovacaoId, 'senha-incorreta', ip);
        /*
         * 401 e não 403: o que falhou foi provar quem é, não a autorização. A
         * mensagem não distingue "senha errada" de "esta conta não tem senha
         * local" — e a segunda EXISTE: quem entrou pelo login com Google recebeu
         * um hash de bytes aleatórios (`GoogleLoginService.provision`) e nunca vai
         * acertar. Está no relatório como pergunta: hoje essa pessoa não consegue
         * aprovar R4 por nenhum caminho.
         */
        throw new UnauthorizedException('Senha incorreta — a aprovação não foi confirmada.');
      }

      await this.registrar(
        'auth.reautenticacao',
        orgId,
        userId,
        aprovacaoId,
        { forma: 'senha' },
        ip,
      );
      return usuario;
    });
  }

  // ------------------------------------------------------------------ token

  private async conferirToken(
    userId: string,
    orgId: string,
    aprovacaoId: string,
    token: string,
    ip?: string,
  ): Promise<ProvaConferida> {
    let claims: ClaimsDaProva;
    try {
      claims = await this.jwt.verifyAsync<ClaimsDaProva>(token);
    } catch {
      await this.registrarRecusa(orgId, userId, aprovacaoId, 'prova-invalida', ip);
      throw new ForbiddenException('Prova de reautenticação inválida ou expirada.');
    }

    // Cada condição é uma recusa diferente e todas terminam igual: a prova só
    // vale para QUEM a pediu, na empresa em que a pediu, para a aprovação que a
    // pediu. Token de sessão apresentado aqui morre na primeira (`typ`).
    const motivo =
      claims.typ !== TIPO_DA_PROVA
        ? 'prova-de-outro-tipo'
        : claims.sub !== userId
          ? 'prova-de-outra-pessoa'
          : claims.org !== orgId
            ? 'prova-de-outra-empresa'
            : claims.apr !== aprovacaoId
              ? 'prova-de-outra-aprovacao'
              : null;
    if (motivo) {
      await this.registrarRecusa(orgId, userId, aprovacaoId, motivo, ip);
      throw new ForbiddenException('Prova de reautenticação não vale para esta aprovação.');
    }

    // O usuário é relido mesmo com a prova válida: entre pedir a prova e
    // confirmar, a conta pode ter sido desativada ou ter mudado de papel.
    const usuario = await this.exigirAprovadorAtivo(userId, orgId, aprovacaoId, ip);

    // E a senha pode ter sido trocada — que é justamente o que a vítima de uma
    // sessão roubada faz primeiro. Prova emitida com a senha antiga morre aqui.
    if (claims.pwd !== impressaoDaSenha(usuario.passwordHash)) {
      await this.registrarRecusa(orgId, userId, aprovacaoId, 'prova-de-senha-antiga', ip);
      throw new ForbiddenException(
        'A senha mudou desde que esta prova foi emitida: reautentique de novo.',
      );
    }

    await this.registrar('auth.reautenticacao', orgId, userId, aprovacaoId, { forma: 'prova' }, ip);
    return {
      em: claims.iat ? new Date(claims.iat * 1000) : new Date(),
      papeis: usuario.papeis,
      forma: 'prova',
    };
  }

  // ------------------------------------------------------------ a trava

  /** Uma conferência de senha por vez para o mesmo par (pessoa, aprovação). */
  private async emFila<T>(chave: string, tarefa: () => Promise<T>): Promise<T> {
    const anterior = this.filaPorAprovacao.get(chave) ?? Promise.resolve();
    const atual = anterior.then(() => tarefa());
    // O que fica no mapa nunca rejeita: uma recusa não pode derrubar a tentativa
    // seguinte da fila (nem virar rejeição sem dono).
    const cauda = atual.then(
      () => undefined,
      () => undefined,
    );
    this.filaPorAprovacao.set(chave, cauda);
    void cauda.then(() => {
      // Só quem AINDA é a cauda limpa — senão apagaria a fila de outra tentativa.
      if (this.filaPorAprovacao.get(chave) === cauda) this.filaPorAprovacao.delete(chave);
    });
    return atual;
  }

  /** Recusa antes do bcrypt quando já há recusas demais na janela. */
  private async exigirAbaixoDoTeto(
    orgId: string,
    userId: string,
    aprovacaoId: string,
    ip?: string,
  ): Promise<void> {
    const desde = new Date(Date.now() - JANELA_DA_TRAVA_SEGUNDOS * 1000);
    const chave = {
      orgId,
      actorId: userId,
      entityType: 'approval',
      entityId: aprovacaoId,
      createdAt: { gte: desde },
    };
    const recusas = await this.prisma.auditLog.count({
      where: { ...chave, action: 'auth.reautenticacao.recusada' },
    });
    if (recusas < LIMITE_DE_RECUSAS) return;

    // UMA linha de trava por janela: o tamanho do rastro deixa de ser escolha de
    // quem ataca. A primeira é a que interessa — a partir dela o padrão já está
    // no RASTRO e as seguintes não acrescentam nada.
    const jaRegistrada = await this.prisma.auditLog.findFirst({
      where: { ...chave, action: 'auth.reautenticacao.travada' },
      select: { id: true },
    });
    if (!jaRegistrada) {
      await this.registrar(
        'auth.reautenticacao.travada',
        orgId,
        userId,
        aprovacaoId,
        { recusas, janelaSegundos: JANELA_DA_TRAVA_SEGUNDOS },
        ip,
      );
    }
    throw new HttpException(
      'Tentativas demais nesta aprovação. Espere alguns minutos antes de tentar de novo.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  // ----------------------------------------------------------------- comuns

  /**
   * Toda recusa de reautenticação vira linha. É o que permite ver tentativa
   * repetida de senha contra uma aprovação de R4 — que é exatamente o desenho de
   * um insider tentando carimbar uma ação em nome de outro — e é o que a trava
   * acima CONTA.
   */
  private registrarRecusa(
    orgId: string,
    userId: string,
    aprovacaoId: string,
    motivo: string,
    ip?: string,
  ): Promise<void> {
    return this.registrar(
      'auth.reautenticacao.recusada',
      orgId,
      userId,
      aprovacaoId,
      { motivo },
      ip,
    );
  }

  private async registrar(
    action: string,
    orgId: string,
    userId: string,
    aprovacaoId: string,
    depois: Prisma.InputJsonObject,
    ip?: string,
  ): Promise<void> {
    // Não pode derrubar a recusa: o caminho de erro é o que mais precisa chegar
    // até o `throw` de quem chamou.
    try {
      await this.audit.log({
        orgId,
        actorType: ActorType.user,
        actorId: userId,
        action,
        entityType: 'approval',
        entityId: aprovacaoId,
        ip,
        after: depois,
      });
    } catch {
      /* auditoria indisponível não vira permissão */
    }
  }
}
