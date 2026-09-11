import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, Alcada, ApprovalState, RiskLevel } from '@prisma/client';
import { MINIMO_DO_MOTIVO, motivoEscrito, type Decisao } from '@mktos/policy';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { lerAprovador } from '../auth/aprovador';
import { ReauthService, type ProvaDeReauth } from '../auth/reauth.service';
import {
  alcadaConhecida,
  alcadaDe,
  atendeAlcada,
  descreverAlcada,
  exigeMotivo,
  temPapelDeMaquina,
} from './alcada';

// Recursos da superfície ANTIGA (as 5 rotas com @SensitiveWrite). A porta usa
// o id da capacidade como resourceType, então esta lista não a limita.
export type ResourceType = 'lead' | 'task' | 'campaign' | 'content';

// Chaves que entram no hash de cada recurso legado. Para as capacidades novas,
// quem manda são as hashKeys do catálogo.
const ALLOWED_KEYS: Record<ResourceType, string[]> = {
  lead: ['status', 'nextAction'],
  task: ['status'],
  campaign: ['status'],
  content: ['status'],
};

export function isResourceType(v: unknown): v is ResourceType {
  return typeof v === 'string' && v in ALLOWED_KEYS;
}

/**
 * Normaliza o corpo da mutação e devolve um hash estável — o bind da aprovação
 * à mudança exata.
 *
 * `chaves` vazio significa O CORPO INTEIRO, e isso é falha fechada de propósito:
 * capacidade que esqueceu de declarar hashKeys prende a aprovação a tudo, o que
 * é estrito, não frouxo.
 */
export function canonicalHash(
  escopo: string,
  body: Record<string, unknown>,
  chaves?: string[],
): string {
  const usar = chaves && chaves.length > 0 ? chaves : Object.keys(body ?? {});
  const norm: Record<string, unknown> = {};
  for (const k of usar.slice().sort()) {
    const val = body?.[k];
    if (val !== undefined && val !== null) norm[k] = val;
  }
  const stable = JSON.stringify(norm, Object.keys(norm).sort());
  return createHash('sha256').update(`${escopo}:${stable}`).digest('hex');
}

const hashDoToken = (t: string) => createHash('sha256').update(t).digest('hex');

/**
 * QUEM APROVA — e não é mais só um identificador solto.
 *
 * Até 11/09/2026 `confirm` recebia `actorId: string` e decidia com isso: dava
 * para aprovar em nome de qualquer string. Agora o aprovador chega descrito —
 * papéis (é o que vira alçada) e, quando o nível exige, a prova de que ele
 * reautenticou.
 */
export interface QuemAprova {
  /** O `sub` da sessão — o id do usuário, não o nome dele. */
  id: string;
  /** Papéis do token de sessão (mesmo RBAC do `PermissionsGuard`). */
  papeis?: readonly string[];
  /** Como a pessoa provou que é ela, quando o nível exige reautenticação. */
  reauth?: ProvaDeReauth;
  ip?: string;
}

/** As duas decisões de gente sobre um item da fila. Entra no nome do evento. */
type Operacao = 'confirm' | 'reject';

/** Os campos da linha de aprovação que as travas leem. */
interface DecisaoEmCurso {
  id: string;
  resourceType: string;
  resourceId: string;
  nivelExigido: RiskLevel;
  alcadaMinima: Alcada;
}

/*
 * APROVADOR NÃO É UM NOME — e por que a recusa é dupla, no tipo E em execução.
 *
 * Até 11/09/2026 `confirm` recebia `actorId: string` e gravava isso em
 * `aprovadoPorId` e no RASTRO: dava para aprovar em nome de qualquer palavra, e
 * nenhuma trava de alçada tinha em quem se apoiar. `src/scripts/aprovar.ts`
 * mandava o `--como "Pedro"` do terminal, e era o caminho mais curto para uma
 * ação de R4 sair carimbada por ninguém.
 *
 * O tipo agora recusa: `quem` é `QuemAprova`, e `confirm(org, id, 'Pedro')` NÃO
 * COMPILA. O script foi corrigido na mesma onda — ele resolve o e-mail para um
 * usuário do banco e, em R4/R5, pede a senha no terminal.
 *
 * A GUARDA DE EXECUÇÃO FICA MESMO ASSIM, e não é cinto e suspensório: este
 * serviço é chamado de dentro de scripts e de testes, onde um `as never` ou um
 * `any` atravessa o compilador sem barulho. Sem ela, um texto que chegasse aqui
 * viraria `quem.id === undefined`, `lerAprovador` não acharia ninguém, e a
 * recusa sairia como "usuário não existe" — verdadeira, e a três passos de
 * distância da causa. A mensagem abaixo diz a causa.
 */
const COMO_CHAMAR_PELO_TERMINAL =
  'Aprovar exige um USUÁRIO, não um nome: `confirm` recebe { id, papeis } — o `sub` e os ' +
  'papéis de quem está na sessão. Pela linha de comando, `node dist/scripts/aprovar.js <id> ' +
  '--como <e-mail>` resolve a pessoa no banco antes de chamar.';

/**
 * O que `consumir` devolve à porta — a aprovação que acabou de ser queimada.
 *
 * Só os campos que alguém do outro lado precisa: os três primeiros para conferir
 * o casamento com a ação, os três últimos porque são PALAVRAS DA POLÍTICA que a
 * linha de desfecho do RASTRO tem de carregar (`aprovador`, `aprovadoEm`,
 * `motivo` — ver `niveis.R3.rastro` e `niveis.R4.rastro`).
 */
export interface AprovacaoConsumida {
  id: string;
  resourceType: string;
  resourceId: string;
  contentHash: string;
  resumo: string;
  propostoPorId: string;
  /** Quem assinou. É pessoa — `exigirGente` recusa conta de máquina. */
  aprovadoPorId: string | null;
  /** Quando assinou. */
  aprovadoEm: Date | null;
  /** O que a pessoa escreveu ao aprovar. R4 e R5 exigem; R2/R3 não. */
  motivo: string | null;
  /** Por qual canal a ação sai, gravado pela porta ao propor. */
  canal: string | null;
}

/*
 * A fila de aprovação, em TABELA.
 *
 * Saiu do Map em memória por dois motivos, e o segundo é o que mordia:
 *
 *  1. Restart da API perdia toda pendência. Com a fila virando superfície de
 *     trabalho — alguém vê a notificação e volta dez minutos depois — isso
 *     deixa de ser aceitável.
 *  2. No Map o uso único era seguro POR ACIDENTE: um processo, JS
 *     single-threaded. Em tabela, duas requisições simultâneas leem
 *     'confirmada' e ambas consomem — e a mensagem sai duas vezes. Quem impede
 *     é o updateMany condicional em `consumir`, não um if.
 *
 * O token cru é devolvido UMA vez e nunca persistido: guardamos só o sha256.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    /*
     * Opcional no TypeScript, presente na aplicação: o `ApprovalsModule` importa
     * o `AuthModule` e o Nest injeta. O opcional existe para as suítes que
     * montam o serviço na mão sem precisar de todo o módulo de autenticação —
     * e, quando ele falta, a reautenticação NÃO é pulada: ela falha fechada
     * (ver `confirm`). Ausência de verificador nunca vira dispensa.
     */
    private readonly reauth?: ReauthService,
  ) {}

  // ---------------------------------------------------------------- proposta

  /** Usada pela porta. Prende a aprovação ao conteúdo exato da capacidade. */
  async propor(input: {
    orgId: string;
    propostoPorId: string;
    propostoPorTipo: ActorType;
    capabilityId: string | null;
    decisionId?: string | null;
    toolCallId?: string | null;
    resourceType: string;
    resourceId: string;
    args: Record<string, unknown>;
    hashKeys: string[];
    decisao: Decisao;
    canal?: string;
    resumo?: string;
  }): Promise<{ approvalId: string; token: string; resumo: string; expiraEm: string }> {
    const token = randomBytes(24).toString('base64url');
    const resumo = input.resumo ?? `${input.resourceType} ${input.resourceId}`;
    // A validade encurta conforme o risco sobe — 900s em R2/R3, 600 em R4,
    // 300 em R5. Vem da própria decisão, não de uma constante.
    const expiraEm = new Date(Date.now() + input.decisao.aprovacao.validadeSegundos * 1000);

    const linha = await this.prisma.approval.create({
      data: {
        orgId: input.orgId,
        decisionId: input.decisionId ?? null,
        toolCallId: input.toolCallId ?? null,
        capabilityId: input.capabilityId,
        propostoPorId: input.propostoPorId,
        propostoPorTipo: input.propostoPorTipo,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        contentHash: canonicalHash(input.resourceType, input.args ?? {}, input.hashKeys),
        resumo,
        nivelExigido: input.decisao.nivel as RiskLevel,
        alcadaMinima: input.decisao.aprovacao.alcadaMinima as Alcada,
        exigeReauth: input.decisao.exigeReautenticacao,
        canal: input.canal ?? null,
        tokenHash: hashDoToken(token),
        expiraEm,
      },
      select: { id: true },
    });

    await this.audit.log({
      orgId: input.orgId,
      actorType: input.propostoPorTipo,
      actorId: input.propostoPorId,
      action: 'approval.propose',
      entityType: input.resourceType,
      entityId: input.resourceId,
      after: { approvalId: linha.id, resumo, nivel: input.decisao.nivel },
    });

    return { approvalId: linha.id, token, resumo, expiraEm: expiraEm.toISOString() };
  }

  /** Superfície antiga: as 5 rotas com @SensitiveWrite. */
  async create(input: {
    orgId: string;
    actorId: string;
    resourceType: ResourceType;
    resourceId: string;
    changes: Record<string, unknown>;
    summary?: string;
  }): Promise<{ approvalId: string; token: string; summary: string; expiresAt: string }> {
    if (!isResourceType(input.resourceType)) {
      throw new BadRequestException(`resourceType inválido: ${input.resourceType}`);
    }
    if (!input.resourceId) throw new BadRequestException('resourceId ausente');

    const token = randomBytes(24).toString('base64url');
    const summary = input.summary ?? `${input.resourceType} ${input.resourceId}`;
    const expiraEm = new Date(Date.now() + 10 * 60 * 1000);

    const linha = await this.prisma.approval.create({
      data: {
        orgId: input.orgId,
        capabilityId: null,
        propostoPorId: input.actorId,
        propostoPorTipo: ActorType.ai,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        contentHash: canonicalHash(
          input.resourceType,
          input.changes ?? {},
          ALLOWED_KEYS[input.resourceType],
        ),
        resumo: summary,
        tokenHash: hashDoToken(token),
        expiraEm,
      },
      select: { id: true },
    });

    await this.audit.log({
      orgId: input.orgId,
      actorType: ActorType.ai,
      actorId: input.actorId,
      action: 'approval.propose',
      entityType: input.resourceType,
      entityId: input.resourceId,
      after: { approvalId: linha.id, summary },
    });

    return {
      approvalId: linha.id,
      token,
      summary,
      expiresAt: expiraEm.toISOString(),
    };
  }

  // ------------------------------------------------------- decisão do humano

  /**
   * A CONFIRMAÇÃO — o único lugar por onde uma ação retida vira executável.
   *
   * São seis travas, nesta ordem, e todas falham fechadas:
   *
   *  1. ESTADO — existe, não expirou, ainda está pendente.
   *  2. NUNCA QUEM PROPÔS — invariante 7 da escada.
   *  3. É GENTE — `ia_servico` e `ia_acao` têm `mcp.executar`, a permissão que a
   *     rota exige, então bastava um SEGUNDO token de serviço para um agente
   *     aprovar o que outro agente propôs. Conferido no token E no banco.
   *  4. EXISTE E ESTÁ ATIVO — releitura do banco, em TODO nível.
   *  5. ALÇADA — `alcadaMinima` era gravada em cada aprovação e nunca comparada
   *     com ninguém. Agora é comparada com o papel DO BANCO.
   *  6. MOTIVO e REAUTENTICAÇÃO — em R4/R5 a decisão precisa de uma frase escrita
   *     e a pessoa prova de novo que é ela. Antes o código só ESCREVIA
   *     `reautenticadoEm`, sem pedir nada, e o motivo nunca saía de `null`.
   *
   * A RELEITURA VALE EM TODO NÍVEL, e é a correção que mais importa aqui.
   * Na primeira versão desta fatia ela existia, mas presa ao caminho de
   * reautenticação — quer dizer, só em R4/R5. Em R3, que é onde mora a única
   * capacidade com efeito ligado de verdade (`whatsapp.mensagem.enviar`), a
   * alçada saía do TOKEN: o revisor confirmou saída externa com usuário
   * desativado, com usuário rebaixado no banco (token antigo dizendo o papel
   * alto) e com um `sub` que não existe na tabela de usuários. Demitido,
   * rebaixado ou apagado aprovava por até oito horas.
   *
   * E A ALÇADA DO BANCO MANDA SEMPRE. O token entra só na trava 3 — papel de
   * máquina no token recusa mesmo que o banco diga outra coisa, porque um token
   * de serviço nunca deveria estar nesta rota. Para autoridade, quem responde é
   * a linha do banco, lida agora.
   */
  async confirm(
    orgId: string,
    id: string,
    quem: QuemAprova,
    motivo?: string,
  ): Promise<{ ok: true; resourceType: string; resourceId: string; summary: string }> {
    // A guarda que o tipo já faz, repetida para quem chega por `any`/`as never`
    // (script, teste, JavaScript). Ver `COMO_CHAMAR_PELO_TERMINAL`.
    if (typeof (quem as unknown) === 'string' || !quem?.id) {
      throw new BadRequestException(COMO_CHAMAR_PELO_TERMINAL);
    }
    const actorId = quem.id;

    const rec = await this.prisma.approval.findFirst({ where: { id, orgId } });
    if (!rec) throw new NotFoundException('Aprovação não encontrada');
    if (rec.expiraEm < new Date()) {
      await this.prisma.approval.updateMany({
        where: { id, status: ApprovalState.pendente },
        data: { status: ApprovalState.expirada },
      });
      throw new BadRequestException('Aprovação expirada');
    }
    if (rec.status !== ApprovalState.pendente) {
      throw new BadRequestException(`Aprovação já ${rec.status}`);
    }
    // Invariante 7 da escada: quem aprova é gente, e nunca quem propôs.
    if (rec.propostoPorId === actorId) {
      await this.recusarConfirmacao(orgId, rec, actorId, 'proponente', { ip: quem.ip });
      throw new ForbiddenException('Quem propôs a ação não pode aprová-la.');
    }

    await this.exigirGente(orgId, rec, actorId, quem.papeis ?? [], 'sessao', 'confirm', quem.ip);

    // A releitura. Em todo nível, antes da alçada.
    const doBanco = await this.exigirAprovadorAtivo(orgId, rec, actorId, quem.ip);
    await this.exigirGente(orgId, rec, actorId, doBanco.papeis, 'banco', 'confirm', quem.ip);
    await this.exigirAlcada(orgId, rec, actorId, alcadaDe(doBanco.papeis), quem.ip);

    /*
     * O motivo e a reautenticação acontecem ANTES da escrita condicional, e isso
     * importa: se rodassem depois, a aprovação passaria a `confirmada` e só
     * então seria recusada — e `confirmada` é o estado que `executarAprovada`
     * aceita.
     */
    const motivoEscritoAgora = await this.exigirMotivo(orgId, rec, actorId, motivo, quem.ip);

    let reautenticadoEm: Date | null = null;
    if (rec.exigeReauth) {
      if (!this.reauth) {
        await this.recusarConfirmacao(orgId, rec, actorId, 'sem-verificador', { ip: quem.ip });
        throw new ForbiddenException(
          'Esta ação exige reautenticação e o verificador não está disponível nesta instância.',
        );
      }
      const prova = await this.reauth.conferir({
        userId: actorId,
        orgId,
        aprovacaoId: id,
        prova: quem.reauth,
        ip: quem.ip,
      });
      // A prova relê o usuário de novo — entre a trava 5 e aqui houve uma
      // conferência de senha, que leva tempo. A alçada é reconferida com o que
      // ela leu.
      await this.exigirGente(orgId, rec, actorId, prova.papeis, 'banco', 'confirm', quem.ip);
      await this.exigirAlcada(orgId, rec, actorId, alcadaDe(prova.papeis), quem.ip);
      reautenticadoEm = prova.em;
    }

    const { count } = await this.prisma.approval.updateMany({
      where: { id, orgId, status: ApprovalState.pendente },
      data: {
        status: ApprovalState.confirmada,
        aprovadoPorId: actorId,
        aprovadoEm: new Date(),
        // Só são escritos quando aconteceram de verdade. Os dois campos voltaram
        // a ser afirmações verdadeiras sobre o mundo.
        ...(reautenticadoEm ? { reautenticadoEm } : {}),
        ...(motivoEscritoAgora ? { motivo: motivoEscritoAgora } : {}),
      },
    });
    if (count !== 1) throw new BadRequestException('Aprovação já decidida por outro caminho');

    await this.audit.log({
      orgId,
      actorType: ActorType.user,
      actorId,
      action: 'approval.confirm',
      entityType: rec.resourceType,
      entityId: rec.resourceId,
      ip: quem.ip,
      after: {
        approvalId: id,
        summary: rec.resumo,
        nivel: rec.nivelExigido,
        alcadaMinima: rec.alcadaMinima,
        reautenticado: reautenticadoEm ? reautenticadoEm.toISOString() : null,
        motivo: motivoEscritoAgora,
      },
    });
    return { ok: true, resourceType: rec.resourceType, resourceId: rec.resourceId, summary: rec.resumo };
  }

  /** Quem decide é gente — conferido no token de sessão E nos papéis do banco. */
  private async exigirGente(
    orgId: string,
    rec: DecisaoEmCurso,
    actorId: string,
    papeis: readonly string[],
    fonte: 'sessao' | 'banco',
    operacao: Operacao = 'confirm',
    ip?: string,
  ): Promise<void> {
    if (!temPapelDeMaquina(papeis)) return;
    await this.recusarConfirmacao(orgId, rec, actorId, `conta-de-maquina:${fonte}`, { ip }, operacao);
    throw new ForbiddenException(
      'Quem decide é gente: conta de serviço (IA) não confirma nem rejeita aprovação.',
    );
  }

  /**
   * A RELEITURA DO BANCO — a mesma consulta que o serviço de reautenticação faz,
   * porque as duas chamam `lerAprovador` (`src/auth/aprovador.ts`).
   *
   * Ela não passa pelo `ReauthService` de propósito, por duas razões: o
   * verificador é opcional no construtor (as suítes montam o serviço sem ele) e
   * uma trava não pode depender de um serviço opcional; e a recusa aqui é de
   * APROVAÇÃO, não de reautenticação — misturar as duas no RASTRO faria uma
   * confirmação de R3 recusada contar no teto de tentativa de senha.
   */
  private async exigirAprovadorAtivo(
    orgId: string,
    rec: DecisaoEmCurso,
    actorId: string,
    ip?: string,
    operacao: Operacao = 'confirm',
  ): Promise<{ papeis: string[] }> {
    const usuario = await lerAprovador(this.prisma, actorId, orgId);
    if (!usuario || !usuario.ativo) {
      await this.recusarConfirmacao(
        orgId,
        rec,
        actorId,
        usuario ? 'usuario-inativo' : 'usuario-inexistente',
        { ip },
        operacao,
      );
      throw new ForbiddenException('Quem decide precisa ser um usuário ativo desta empresa.');
    }
    return usuario;
  }

  /** Compara a alçada exigida com a que o aprovador tem; recusa e registra. */
  private async exigirAlcada(
    orgId: string,
    rec: DecisaoEmCurso,
    actorId: string,
    tem: ReturnType<typeof alcadaDe>,
    ip?: string,
  ): Promise<void> {
    const minima = rec.alcadaMinima;
    if (atendeAlcada(minima, tem)) return;
    /*
     * Duas recusas diferentes com a mesma resposta. `alcada-desconhecida` é a
     * que não pode acontecer: significa que a linha guarda um degrau que esta
     * versão do código não conhece — e nesse caso ninguém aprova, em vez de
     * todo mundo aprovar, que era o efeito do `indexOf` de antes.
     */
    const motivo = alcadaConhecida(minima) ? 'alcada-insuficiente' : 'alcada-desconhecida';
    await this.recusarConfirmacao(orgId, rec, actorId, motivo, {
      ip,
      exigida: String(minima),
      tem: descreverAlcada(tem),
    });
    throw new ForbiddenException(
      `Alçada insuficiente para aprovar ${rec.nivelExigido}: esta ação exige "${minima}" e ` +
        `quem aprova tem "${descreverAlcada(tem)}".`,
    );
  }

  /**
   * MOTIVO ESCRITO — a terceira perna de RF-A-03, que faltava inteira.
   *
   * O requisito pede reautenticação, motivo escrito e alçada. A coluna
   * `Approval.motivo` existia e nunca saía de `null`: o cálculo que a régua já
   * faz (`Decisao.exigeMotivo`) não era lido em lugar nenhum e o schema do corpo
   * da confirmação RECUSAVA quem tentasse mandar um.
   *
   * O mínimo e o verificador são os do pacote de política (`MINIMO_DO_MOTIVO`,
   * `motivoEscrito`) — os mesmos que já guardam a sobrescrita de política, para
   * que "motivo escrito" queira dizer a mesma coisa nos dois lugares.
   *
   * Nos níveis que não exigem, um motivo mandado assim mesmo é GRAVADO: quem
   * quis explicar por que aprovou não deve ter a frase descartada.
   */
  private async exigirMotivo(
    orgId: string,
    rec: DecisaoEmCurso,
    actorId: string,
    motivo: string | undefined,
    ip?: string,
  ): Promise<string | null> {
    const texto = typeof motivo === 'string' ? motivo.trim() : '';
    if (!exigeMotivo(rec.nivelExigido)) return texto === '' ? null : texto;

    if (!motivoEscrito(texto)) {
      await this.recusarConfirmacao(orgId, rec, actorId, 'motivo-ausente', {
        ip,
        minimo: MINIMO_DO_MOTIVO,
      });
      throw new BadRequestException(
        `Aprovar ${rec.nivelExigido} exige motivo escrito: descreva em pelo menos ` +
          `${MINIMO_DO_MOTIVO} caracteres por que esta ação deve sair.`,
      );
    }
    return texto;
  }

  /** Recusa de decisão também é evento. Fila que só registra o "sim" mente. */
  private async recusarConfirmacao(
    orgId: string,
    rec: DecisaoEmCurso,
    actorId: string,
    motivo: string,
    extra?: Record<string, unknown>,
    operacao: Operacao = 'confirm',
  ): Promise<void> {
    const { ip, ...resto } = extra ?? {};
    try {
      await this.audit.log({
        orgId,
        actorType: ActorType.user,
        actorId,
        action: `approval.${operacao}.recusada`,
        entityType: rec.resourceType,
        entityId: rec.resourceId,
        ip: typeof ip === 'string' ? ip : undefined,
        after: { approvalId: rec.id, nivel: rec.nivelExigido, motivo, ...resto },
      });
    } catch {
      /* auditoria indisponível não vira permissão */
    }
  }

  /**
   * A REJEIÇÃO — e por que ela também tem trava.
   *
   * As travas da confirmação existiam só para o "sim". Rejeitar não executa
   * nada, então a tentação é deixar passar; o revisor mostrou o que isso custa:
   * uma conta de MÁQUINA rejeitou um item pendente proposto por uma pessoa. Não
   * dispara efeito nenhum, mas apaga a proposta de um humano por decisão de
   * máquina — e uma fila em que o robô pode descartar o que o robô não gostou é
   * o mesmo problema da invariante 7, de trás para frente.
   *
   * Aqui vai o mínimo: é gente (no token e no banco) e é usuário ativo desta
   * empresa. Não vai alçada — negar nunca é mais arriscado do que deixar como
   * está, e exigir titular para rejeitar emperraria a fila. Está no relatório
   * como pergunta, porque é decisão de produto.
   */
  async reject(orgId: string, id: string, quem: QuemAprova): Promise<{ ok: true }> {
    const actorId = quem.id;
    const rec = await this.prisma.approval.findFirst({ where: { id, orgId } });
    if (!rec) throw new NotFoundException('Aprovação não encontrada');

    await this.exigirGente(orgId, rec, actorId, quem.papeis ?? [], 'sessao', 'reject', quem.ip);
    const doBanco = await this.exigirAprovadorAtivo(orgId, rec, actorId, quem.ip, 'reject');
    await this.exigirGente(orgId, rec, actorId, doBanco.papeis, 'banco', 'reject', quem.ip);

    await this.prisma.approval.updateMany({
      where: { id, orgId, status: { in: [ApprovalState.pendente, ApprovalState.confirmada] } },
      data: { status: ApprovalState.rejeitada },
    });
    await this.audit.log({
      orgId,
      actorType: ActorType.user,
      actorId,
      action: 'approval.reject',
      entityType: rec.resourceType,
      entityId: rec.resourceId,
      ip: quem.ip,
      after: { approvalId: id },
    });
    return { ok: true };
  }

  async get(orgId: string, id: string) {
    const rec = await this.prisma.approval.findFirst({ where: { id, orgId } });
    if (!rec) throw new NotFoundException('Aprovação não encontrada');
    return {
      id: rec.id,
      status: rec.status,
      summary: rec.resumo,
      expiresAt: rec.expiraEm.toISOString(),
    };
  }

  /** A FILA. É a superfície de trabalho do Atendimento e do Console. */
  async listar(orgId: string, status: ApprovalState = ApprovalState.pendente) {
    const agora = new Date();
    const linhas = await this.prisma.approval.findMany({
      where: { orgId, status, ...(status === ApprovalState.pendente ? { expiraEm: { gt: agora } } : {}) },
      orderBy: { criadoEm: 'asc' },
      take: 200,
    });
    return {
      items: linhas.map((a) => ({
        id: a.id,
        resumo: a.resumo,
        nivel: a.nivelExigido,
        capacidade: a.capabilityId,
        recurso: { tipo: a.resourceType, id: a.resourceId },
        exigeReauth: a.exigeReauth,
        alcadaMinima: a.alcadaMinima,
        propostaEm: a.criadoEm.toISOString(),
        expiraEm: a.expiraEm.toISOString(),
        // Tempo de espera é o que faz a fila ser uma fila e não uma lista.
        esperandoMs: agora.getTime() - a.criadoEm.getTime(),
      })),
      total: linhas.length,
    };
  }

  // -------------------------------------------------------------- o consumo

  /**
   * O uso único de verdade. `updateMany` condicional em vez de ler-e-escrever:
   * duas requisições simultâneas com o mesmo token dão exatamente UM sucesso.
   */
  private async consumirToken(orgId: string, token: string): Promise<AprovacaoConsumida> {
    const rec = await this.prisma.approval.findUnique({
      where: { tokenHash: hashDoToken(token) },
    });
    if (!rec || rec.orgId !== orgId) throw new ForbiddenException('Token de aprovação inválido.');
    if (rec.expiraEm < new Date()) throw new ForbiddenException('Aprovação expirada.');
    if (rec.status === ApprovalState.consumida) {
      throw new ForbiddenException('Aprovação já utilizada (uso único).');
    }
    if (rec.status !== ApprovalState.confirmada) {
      throw new ForbiddenException('Aprovação não confirmada pelo humano.');
    }

    const { count } = await this.prisma.approval.updateMany({
      where: { id: rec.id, status: ApprovalState.confirmada, expiraEm: { gt: new Date() } },
      data: { status: ApprovalState.consumida, consumidoEm: new Date() },
    });
    if (count !== 1) throw new ForbiddenException('Aprovação já utilizada (uso único).');

    /*
     * A LINHA É RECORTADA, e não devolvida inteira. `rec` é o registro cru do
     * Prisma e carrega `tokenHash` — o sha256 do token de uso único. Devolvê-lo
     * daqui o põe ao alcance de quem for montar um payload de RASTRO com um
     * espalhamento distraído, e o RASTRO é append-only por cinco anos. O tipo já
     * esconderia o campo do compilador; o recorte o tira do objeto.
     */
    return {
      id: rec.id,
      resourceType: rec.resourceType,
      resourceId: rec.resourceId,
      contentHash: rec.contentHash,
      resumo: rec.resumo,
      propostoPorId: rec.propostoPorId,
      aprovadoPorId: rec.aprovadoPorId,
      aprovadoEm: rec.aprovadoEm,
      motivo: rec.motivo,
      canal: rec.canal,
    };
  }

  /**
   * Usada pela porta. DEVOLVE A APROVAÇÃO CONSUMIDA — e isso não é conveniência.
   *
   * A política cobra da linha de DESFECHO de um R3 `aprovador` e `aprovadoEm`, e
   * de um R4 também `motivo` (`niveis.<R>.rastro`). Até 11/09/2026 este método
   * devolvia `void`: os três eram lidos aqui, conferidos aqui, e jogados fora —
   * então `tool.resultado` saía SEM eles, declarando lacuna em
   * `payload.rastro.faltando` numa ação que teve gente no caminho. Era dívida
   * contada onde não havia dívida nenhuma.
   *
   * Devolver em vez de a porta reler é o que garante que a linha do RASTRO fale
   * da MESMA aprovação que foi queimada: uma segunda leitura por id poderia, em
   * teoria, pegar outro estado.
   */
  async consumir(input: {
    orgId: string;
    token: string;
    resourceType: string;
    resourceId: string;
    args: Record<string, unknown>;
    hashKeys: string[];
    actorId: string;
  }): Promise<AprovacaoConsumida> {
    const rec = await this.consumirToken(input.orgId, input.token);
    if (rec.resourceType !== input.resourceType || rec.resourceId !== input.resourceId) {
      throw new ForbiddenException('Aprovação não corresponde ao recurso desta ação.');
    }
    if (rec.contentHash !== canonicalHash(input.resourceType, input.args ?? {}, input.hashKeys)) {
      throw new ForbiddenException('A mudança difere do que foi aprovado.');
    }
    await this.audit.log({
      orgId: input.orgId,
      actorType: ActorType.ai,
      actorId: input.actorId,
      action: 'approval.consume',
      entityType: rec.resourceType,
      entityId: rec.resourceId,
      after: { approvalId: rec.id, resumo: rec.resumo },
    });
    return rec;
  }

  /** Gate da escrita nas 5 rotas antigas. Comportamento idêntico ao de antes. */
  async consumeForWrite(input: {
    orgId: string;
    token: string | undefined;
    resourceType: ResourceType;
    resourceId: string;
    body: Record<string, unknown>;
    actorId: string;
  }): Promise<void> {
    if (!input.token) {
      throw new ForbiddenException(
        'Ação sensível requer aprovação humana confirmada (x-approval-token ausente).',
      );
    }
    await this.consumir({
      orgId: input.orgId,
      token: input.token,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      args: input.body ?? {},
      hashKeys: ALLOWED_KEYS[input.resourceType],
      actorId: input.actorId,
    });
  }

  /** Marca expiradas. Chamado pelo agendador — não é mais um setInterval solto. */
  async expirarVencidas(): Promise<number> {
    const { count } = await this.prisma.approval.updateMany({
      where: { status: ApprovalState.pendente, expiraEm: { lt: new Date() } },
      data: { status: ApprovalState.expirada },
    });
    return count;
  }
}
