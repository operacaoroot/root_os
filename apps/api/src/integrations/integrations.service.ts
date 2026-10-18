import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { CONNECTORS, ConexoesDeclarativasSchema, type ConexoesDeclarativas, type ConexaoDeclarativaLinha, type IntegrationCatalog, type IntegrationCatalogRow } from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { exigirAcessoAtual } from '../memory/acesso-memoria';
import { AuditService } from '../audit/audit.service';
import { ConectoresService } from './conectores.service';
import { ConectoresConfiguradosRegistry } from '../gateway/conectores-configurados.registry';
import { RegistroDeConectores } from './conectores.registry';
import {
  type ConectorDoContrato,
  type EscopoDaCredencial,
  type ResultadoDeAutorizacao,
  type ResultadoDeRevogacao,
  type ResultadoDeSincronizacao,
  type SaudeDeConector,
  VERBOS_DO_CONTRATO,
  type VerboDoContrato,
  naoVerificado,
} from './contrato-de-conector';
import {
  type AplicacaoDoDesligamento,
  TEXTO_DA_APLICACAO,
  aplicacaoDoDesligamento,
  grupoDoConector,
} from './conectores';

/*
 * O catálogo da tela de Conexões, com o DESLIGAMENTO por empresa junto (RF-G-06)
 * e a SAÚDE do contrato único por cima (RF-X-02, fatia 5.4).
 *
 * O tipo é local e é um SUPERCONJUNTO do de `@mktos/shared`: `IntegrationCatalog`
 * mora em `packages/shared`, que é de outra fatia, e acrescentar campo lá no meio
 * de uma onda com quatro agentes escrevendo é colisão garantida. Supertipo
 * resolve sem tocar em arquivo alheio — quem consome o tipo estreito continua
 * válido, e a tela de Conexões (o único consumidor) lê o largo.
 *
 * TRÊS CAMPOS, TRÊS PERGUNTAS, E NENHUM DELES RESPONDE PELOS OUTROS:
 *   · `status`    — "esta empresa tem a integração montada?" (registro no banco);
 *   · `desligado` — "alguém mandou o OS parar de usar isto agora?" (RF-G-06);
 *   · `saude`     — "esta empresa consegue usar isto AGORA?" (RF-X-02), e a
 *                   resposta só é verde depois de uma sonda contra a
 *                   dependência real.
 *
 * Um conector pode estar conectado E desligado — é o caso normal de uma
 * suspensão de emergência, e é exatamente aí que juntar os campos num só faria a
 * tela mentir.
 */
export interface LinhaDoCatalogo extends IntegrationCatalogRow {
  /** Desligado para esta empresa (RF-G-06). A credencial continua guardada. */
  desligado: boolean;
  desligadoEm: string | null;
  desligadoPor: string | null;
  motivoDesligado: string | null;
  /** `google` para gmail/gcal/gdocs/drive; `null` para os demais. */
  grupo: string | null;
  /*
   * O QUE O INTERRUPTOR FAZ NESTA LINHA, HOJE — e por que a tela não decide isto
   * sozinha.
   *
   * Oferecer o mesmo botão nas 16 linhas e afirmar, no aviso do topo, que toda
   * ferramenta do conector é recusada com motivo era verdade para UM deles. A
   * correção não foi esconder quinze: foi cada linha dizer qual das duas coisas
   * o botão faz ali. E dizer com o dado vindo DAQUI, do mesmo lado que cumpre a
   * promessa — texto no componente é a forma garantida de as duas voltarem a
   * divergir na próxima fatia.
   */
  aplicacaoDoDesligamento: AplicacaoDoDesligamento;
  /** A frase pronta, em português, do que o botão faz nesta linha. */
  textoDoDesligamento: string;

  /**
   * O conector do CONTRATO que responde por esta linha — `null` quando nenhum
   * responde (conector do catálogo sem serviço neste repositório, como `asana`
   * ou `zapier`).
   */
  contrato: {
    /** A unidade de CREDENCIAL: `google` para as quatro superfícies do Google. */
    chave: string;
    rotulo: string;
    escopoDaCredencial: EscopoDaCredencial;
    verbos: readonly VerboDoContrato[];
    /** As outras linhas do catálogo que compartilham esta credencial. */
    linhasIrmas: string[];
  } | null;

  /** A sonda de saúde POR EMPRESA. `null` quando ninguém responde pela linha. */
  saude: SaudeDeConector | null;
}

export interface CatalogoDeConexoes extends IntegrationCatalog {
  items: LinhaDoCatalogo[];
}

// Conectores que dá para ligar/desligar manualmente (têm credencial via env/API key).
// Os OAuth (Instagram/Gmail/Drive) exigem o fluxo de OAuth + credencial própria do root
// e ficam como "requer credencial" até isso existir.
function isManaged(authType: string): boolean {
  return authType !== 'oauth2';
}

/**
 * O status legado, derivado da SAÚDE do contrato.
 *
 * Existe para os dois campos nunca se contradizerem na tela: enquanto `status`
 * vinha só do banco e `saude` da sonda, dava para um dizer "conectado" e o outro
 * "erro" na mesma linha, e quem lê não tem como saber qual acreditar.
 *
 * `nao_verificado` devolve `null` de propósito — quer dizer "não mexa no que
 * estava lá". É o caso do conector desligado, em que não houve sonda: inventar
 * `disconnected` seria afirmar que a integração foi desmontada, e afirmar
 * `connected` seria o verde sem sonda que esta fatia veio matar.
 */
function statusDaSaude(saude: SaudeDeConector): 'connected' | 'disconnected' | 'error' | null {
  switch (saude.estado) {
    case 'conectado':
      return 'connected';
    case 'nao_configurado':
      return 'disconnected';
    case 'erro':
      return 'error';
    default:
      return null;
  }
}

@Injectable()
export class IntegrationsService {
  private readonly log = new Logger('Integrations');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly conectores: ConectoresService,
    private readonly conectoresConfigurados: ConectoresConfiguradosRegistry,
    /** O contrato único de conector — fatia 5.4. Ver `contrato-de-conector.ts`. */
    private readonly contrato: RegistroDeConectores,
  ) {}

  async verificarPessoaAtual(orgId: string, pessoaId: string, permissoes: string[]) {
    await exigirAcessoAtual(this.prisma, orgId, pessoaId, permissoes);
  }

  /** Configuração declarada e registros da empresa; não faz sondas. */
  async catalogoDeclarativo(orgId: string, pessoaId: string): Promise<ConexoesDeclarativas> {
    await exigirAcessoAtual(this.prisma, orgId, pessoaId, ['dashboard.ver']);
    return this.prisma.$transaction(async tx => {
      await exigirAcessoAtual(tx, orgId, pessoaId, ['dashboard.ver']);
      await tx.$queryRaw`SELECT id FROM "Org" WHERE id=${orgId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "IntegrationAccount" WHERE "orgId"=${orgId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "ConectorDesligado" WHERE "orgId"=${orgId} FOR SHARE`;
      const casa = await tx.org.findFirst({ where: { id: orgId, slug: 'root' }, select: { id: true } });
      const accounts = await tx.integrationAccount.findMany({ where: { orgId }, select: { key: true, status: true } });
      const offRows = await tx.conectorDesligado.findMany({ where: { orgId }, select: { conector: true, desligadoEm: true } });
      const desligados = new Map(offRows.map(a => [a.conector, a]));
      const doContrato = this.contrato.listar();
      const templates: Array<Pick<IntegrationCatalogRow, 'key' | 'label' | 'category' | 'phase' | 'authType' | 'requires'>> = CONNECTORS.map(c => ({ ...c }));
      const listed = new Set(templates.map(c => c.key));
      for (const c of doContrato) for (const key of this.linhasDe(c)) {
        if (listed.has(key)) continue;
        listed.add(key); templates.push({ key, label: key === c.chave ? c.rotulo : `${c.rotulo} · ${key}`,
          category: c.categoria ?? 'outros', phase: 0, authType: c.escopoDaCredencial === 'empresa' ? 'oauth2' : 'api_key',
          requires: c.exige ?? 'Configuração declarada pelo conector.' });
      }
      const pureProcess = new Set(['clickup', 'pluggy', 'asaas', 'whatsapp']);
      const items: ConexaoDeclarativaLinha[] = templates.map(c => {
        const registros = accounts.filter(a => a.key === c.key);
        const registro = { estado: registros.length > 1 ? 'ambiguo' as const : registros.length === 1 ? 'unico' as const : 'ausente' as const,
          status: registros.length === 1 ? registros[0].status : null };
        let configuracao: ConexaoDeclarativaLinha['configuracao'] = { estado: 'desconhecida', origem: 'indisponivel' };
        if (registros.length === 1) configuracao = { estado: registros[0].status === 'disconnected' ? 'nao_configurada' : 'declarada_sem_verificacao', origem: 'registro_empresa' };
        else if (registros.length > 1) configuracao = { estado: 'desconhecida', origem: 'registro_empresa' };
        else if (c.authType === 'oauth2') configuracao = { estado: 'nao_configurada', origem: 'registro_empresa' };
        else if (c.key === 'ofx') configuracao = { estado: 'declarada_sem_verificacao', origem: 'embutido' };
        else if (pureProcess.has(c.key)) {
          if (!casa) configuracao = { estado: 'nao_se_aplica', origem: 'nao_se_aplica' };
          else {
            // Whitelist conferida: esses quatro getters só leem strings já carregadas.
            // Obsidian fica fora: seu configured legado acessa o sistema de arquivos.
            const declarada = this.conectoresConfigurados.configurado(c.key);
            configuracao = { estado: declarada === null ? 'desconhecida' : declarada ? 'declarada_sem_verificacao' : 'nao_configurada', origem: 'declaracao_processo' };
          }
        }
        const dono = this.contrato.donoDaLinha(c.key), off = desligados.get(c.key);
        return { ...c, status: registro.status ?? (registros.length > 1 ? 'error' : 'disconnected'),
          health: null, connectedAt: null, lastSyncAt: null, lastError: null, managed: isManaged(c.authType),
          registro, configuracao, desligado: !!off, desligadoEm: off?.desligadoEm.toISOString() ?? null,
          desligadoPor: null, motivoDesligado: null, grupo: grupoDoConector(c.key),
          aplicacaoDoDesligamento: aplicacaoDoDesligamento(c.key), textoDoDesligamento: TEXTO_DA_APLICACAO[aplicacaoDoDesligamento(c.key)],
          contrato: dono ? { chave: dono.chave, rotulo: dono.rotulo, escopoDaCredencial: dono.escopoDaCredencial,
            verbos: [...VERBOS_DO_CONTRATO], linhasIrmas: this.linhasDe(dono).filter(k => k !== c.key) } : null,
          saude: null, recibo: null };
      });
      const pessoa = await tx.user.findFirst({ where: { id: pessoaId, orgId, isActive: true },
        select: { roles: { where: { orgId }, select: { permissions: { select: { key: true } } } } } });
      const permissoes = new Set(pessoa?.roles.flatMap(r => r.permissions.map(p => p.key)) ?? []);
      await exigirAcessoAtual(tx, orgId, pessoaId, ['dashboard.ver']);
      return ConexoesDeclarativasSchema.parse({ escopo: { orgId, userId: pessoaId }, sondado: false,
        autoridadeGerenciar: permissoes.has('admin.usuarios'), items: items.sort((a,b) => a.key.localeCompare(b.key)),
        source: { tool: 'banco-interno', generatedAt: new Date().toISOString() } });
    }, { timeout: 20000 });
  }

  /**
   * A tela de Conexões.
   *
   * `sondar: false` desliga as sondas desta chamada e devolve `nao_verificado`
   * em todas as linhas, com o motivo escrito. Serve a quem só quer a LISTA (um
   * seletor, um script) sem pagar cinco chamadas externas — e, por ser explícito
   * em vez de padrão, ninguém acaba mostrando estado velho por acidente.
   */
  async catalog(
    orgId: string,
    /** `prazoDeSondaMs` existe só para a suíte — ver `RegistroDeConectores.sondar`. */
    opcoes: { sondar?: boolean; prazoDeSondaMs?: number } = {},
  ): Promise<CatalogoDeConexoes> {
    const sondar = opcoes.sondar !== false;
    const [accounts, desligados] = await Promise.all([
      this.prisma.integrationAccount.findMany({ where: { orgId }, include: { health: true } }),
      this.conectores.desligados(orgId),
    ]);
    const byKey = new Map(accounts.map((a) => [a.key, a]));

    /*
     * UMA SONDA POR CREDENCIAL, não por linha.
     *
     * O Google ocupa quatro linhas do catálogo e tem UM par de tokens: sondar
     * por linha bateria quatro vezes na mesma API a cada abertura da tela, com
     * quatro chances de estourar cota, para responder a mesma coisa. A sonda é
     * por conector do contrato e o resultado é espalhado nas linhas que ele
     * cobre — que é também a razão de `linhasIrmas` existir na resposta: a tela
     * precisa poder dizer "o erro do Gmail é o mesmo erro do Drive".
     */
    const doContrato = this.contrato.listar();
    const pedidos = doContrato.map((c) => ({
      orgId,
      chave: c.chave,
      prazoMs: opcoes.prazoDeSondaMs,
      desligadoPorque: sondar ? this.porqueDesligado(c, desligados) : null,
      /*
       * DISPENSAR A SONDA NÃO É DESLIGAR — e os dois motivos viajam em campos
       * separados por causa disso. Enquanto compartilhavam um campo só, quem
       * pedia a lista com `sondar=0` recebia, numa tela de diagnóstico, a frase
       * do desligamento: "religue em Conexões para voltar a medir", sobre um
       * conector que ninguém desligou. Instrução errada numa tela cujo trabalho
       * é dizer o que fazer.
       */
      motivoDeNaoSondar: sondar
        ? null
        : 'A lista foi pedida SEM sonda (`sondar=0`): nada foi chamado, e nenhum estado aqui ' +
          'foi medido agora. Peça "verificar agora" — ou recarregue sem `sondar=0` — para medir.',
    }));
    const saudes = await this.contrato.sondarVarios(pedidos);

    /*
     * O STATUS DERIVADO, quando não há registro no banco.
     *
     * ------------------------------------------------------------------------
     * QUEM RESPONDE SE UM CONECTOR ESTÁ CONFIGURADO — fatia 3.3, frente 4
     * ------------------------------------------------------------------------
     * Até 11/09/2026 esta tela lia a CREDENCIAL de cada conector direto do
     * ambiente (`CLICKUP_API_TOKEN`, `PLUGGY_CLIENT_ID`, `ASAAS_API_KEY`,
     * `OBSIDIAN_VAULT_PATH`) para derivar o selo "conectado". O nome da variável
     * virava um contrato duplicado entre a tela e o conector: renomear do lado
     * de lá — ou passar a ler do cofre por tenant — fazia esta tela afirmar
     * "desconectado" sobre um conector que estava funcionando, sem nenhum erro
     * de compilação e sem nada no log.
     *
     * Agora ela PERGUNTA. Cada conector se inscreve no arranque e responde por
     * si (`gateway/conectores-configurados.registry.ts`, que explica por que a
     * resposta vem por registro e não por injeção — importar o conector aqui
     * seria a frente 1 da mesma catraca).
     *
     * `null` do registro quer dizer "ninguém respondeu por esta chave", que é
     * diferente de "não configurado": conector builtin, conector que ainda não
     * se inscreveu, chave do catálogo sem serviço atrás. Por isso a derivação só
     * acontece quando a resposta é booleana.
     *
     * O QUE CONTINUA AQUI, e é de propósito: `ofx` é builtin (importar extrato
     * não depende de credencial nenhuma) e `openai`/`telegram` não têm serviço
     * de conector neste repositório — não há a quem perguntar. As duas variáveis
     * também não estão no catálogo de credenciais da catraca, justamente porque
     * não há conector dono delas.
     *
     * O QUE NÃO ENTRA NEM AQUI NEM NO REGISTRO: as quatro chaves do Google
     * (`gmail`, `gcal`, `gdocs`, `drive`) e o `instagram`. São de AUTORIZAÇÃO
     * POR EMPRESA, e o estado verdadeiro delas é a linha de `IntegrationAccount`
     * que o retorno do OAuth cria — que é justamente o `acc` lido acima, o
     * caminho que tem precedência. Uma versão desta fatia chegou a inscrevê-las
     * no registro respondendo `GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET`, que é
     * verdadeiro em produção para todo mundo: empresa que nunca autorizou nada
     * passou a ver o Google como conectado. Sem resposta em canto nenhum,
     * `derivado` devolve `null`, o `status` fica com o do banco (`disconnected`
     * quando não há linha) e a tela volta a dizer a verdade.
     *
     * A SONDA DO CONTRATO PASSA NA FRENTE DE TUDO ISTO quando existe, e é a
     * razão de esta fatia não ter apagado nada daqui: ela cobre cinco conectores
     * e esta derivação cobre o resto, incluindo os que nunca terão contrato.
     */
    const env = process.env;
    const semDono: Record<string, boolean> = {
      openai: !!env.OPENAI_API_KEY,
      telegram: !!env.TELEGRAM_BOT_TOKEN,
      ofx: true, // builtin — importação de extrato sempre disponível
    };

    const derivado = (chave: string): boolean | null =>
      this.conectoresConfigurados.configurado(chave) ?? (chave in semDono ? semDono[chave] : null);

    const montar = (base: IntegrationCatalogRow): LinhaDoCatalogo => {
      const acc = byKey.get(base.key);
      // status: sonda do contrato > registro do banco (OAuth/toggle) > config.
      let status: IntegrationCatalogRow['status'] = acc?.status ?? base.status;
      const configurado = acc ? null : derivado(base.key);
      if (configurado !== null) status = configurado ? 'connected' : 'disconnected';

      const dono = this.contrato.donoDaLinha(base.key);
      const saude = dono ? (saudes.get(dono.chave) ?? null) : null;
      if (saude) {
        const derivadoDaSonda = statusDaSaude(saude);
        if (derivadoDaSonda) status = derivadoDaSonda;
      }

      const off = desligados.get(base.key);
      return {
        ...base,
        status,
        health: acc?.health?.status ?? null,
        connectedAt: acc?.connectedAt?.toISOString() ?? null,
        lastSyncAt: acc?.health?.lastSyncAt?.toISOString() ?? null,
        /*
         * O erro da SONDA tem precedência sobre o último erro gravado.
         *
         * `IntegrationHealth.lastError` é o erro da última SINCRONIZAÇÃO, que
         * pode ser de semanas atrás. Mostrar o velho ao lado de uma sonda que
         * acabou de falhar por outro motivo é pedir para alguém investigar a
         * causa errada.
         */
        lastError: saude?.estado === 'erro' ? saude.mensagem : (acc?.health?.lastError ?? null),
        managed: isManaged(base.authType),
        // RF-G-06 — o desligamento é uma CAMADA por cima do status, nunca o
        // próprio status: o conector segue conectado e com credencial guardada.
        desligado: !!off,
        desligadoEm: off?.desligadoEm.toISOString() ?? null,
        desligadoPor: off?.desligadoPor ?? null,
        motivoDesligado: off?.motivo ?? null,
        grupo: grupoDoConector(base.key),
        aplicacaoDoDesligamento: aplicacaoDoDesligamento(base.key),
        textoDoDesligamento: TEXTO_DA_APLICACAO[aplicacaoDoDesligamento(base.key)],
        contrato: dono
          ? {
              chave: dono.chave,
              rotulo: dono.rotulo,
              escopoDaCredencial: dono.escopoDaCredencial,
              verbos: VERBOS_DO_CONTRATO,
              linhasIrmas: this.linhasDe(dono).filter((l) => l !== base.key),
            }
          : null,
        saude,
      };
    };

    const items: LinhaDoCatalogo[] = CONNECTORS.map((c) =>
      montar({
        key: c.key,
        label: c.label,
        category: c.category,
        phase: c.phase,
        authType: c.authType,
        requires: c.requires,
        status: 'disconnected',
        health: null,
        connectedAt: null,
        lastSyncAt: null,
        lastError: null,
        managed: isManaged(c.authType),
      }),
    );

    /*
     * ========================================================================
     * CONECTOR NOVO APARECE NO CATÁLOGO SEM TOCAR NO NÚCLEO — RF-X-06
     * ========================================================================
     *
     * `CONNECTORS` mora em `packages/shared/src/schemas.ts`: é um pacote
     * compartilhado, compilado junto do web, e mexer nele para cada conector
     * novo é exatamente o "alterar o núcleo" que a fatia proíbe. Um conector que
     * implemente o contrato e se inscreva no registro ganha linha aqui a partir
     * do que ELE declara — rótulo, categoria, o que exige — e nada precisa ser
     * editado em `packages/`, nem nesta função, nem no registro.
     *
     * A prova de que isto funciona é o conector fictício de `test/`, que aparece
     * no catálogo e não é mencionado em NENHUM arquivo de `src/` (a suíte
     * confere isso por varredura, para não bastar a palavra de quem escreveu).
     *
     * O `authType` é DERIVADO do escopo da credencial e não pedido ao conector:
     * quem guarda credencial por empresa faz isso por OAuth neste produto, quem
     * usa credencial do processo faz por chave de API. Pedir o campo abriria a
     * chance de ele discordar do escopo declarado, e aí a tela ofereceria
     * "revogar" num conector cuja credencial não é de ninguém em particular.
     */
    const jaListadas = new Set(items.map((i) => i.key));
    for (const c of doContrato) {
      for (const linha of this.linhasDe(c)) {
        if (jaListadas.has(linha)) continue;
        jaListadas.add(linha);
        items.push(
          montar({
            key: linha,
            label: linha === c.chave ? c.rotulo : `${c.rotulo} · ${linha}`,
            category: c.categoria ?? 'outros',
            // Fase 0 = "declarado pelo conector, fora do catálogo estático".
            phase: 0,
            authType: c.escopoDaCredencial === 'empresa' ? 'oauth2' : 'api_key',
            requires: c.exige ?? 'declarado pelo próprio conector',
            status: 'disconnected',
            health: null,
            connectedAt: null,
            lastSyncAt: null,
            lastError: null,
            managed: c.escopoDaCredencial !== 'empresa',
          }),
        );
      }
    }

    return {
      items: items.sort((a, b) => a.key.localeCompare(b.key)),
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }

  /** As linhas do catálogo que um conector do contrato cobre. */
  private linhasDe(c: ConectorDoContrato): string[] {
    return c.linhasDoCatalogo?.length ? [...c.linhasDoCatalogo] : [c.chave];
  }

  /**
   * Este conector está desligado para esta empresa? A frase, ou `null`.
   *
   * FALHA FECHADO — basta UMA superfície desligada. Desligar só o Gmail e deixar
   * o Drive ligado não separa credencial nenhuma: os quatro compartilham o mesmo
   * par de tokens, e uma sonda de saúde do conector `google` tocaria a
   * autorização que alguém acabou de mandar parar de usar. Entre sondar a mais e
   * sondar a menos, num botão de emergência, sondar a menos é o lado certo de
   * errar.
   */
  private porqueDesligado(
    c: ConectorDoContrato,
    desligados: Map<string, { motivo: string | null; desligadoPor: string | null; desligadoEm: Date }>,
  ): string | null {
    for (const linha of this.linhasDe(c)) {
      const off = desligados.get(linha);
      if (!off) continue;
      const quando = off.desligadoEm.toLocaleString('pt-BR');
      return (
        `"${c.rotulo}" está desligado para esta empresa desde ${quando}` +
        (off.motivo ? ` (motivo: "${off.motivo}")` : '') +
        '.'
      );
    }
    return null;
  }

  // ------------------------------------------------------------ os quatro verbos

  /**
   * AUTORIZAR — o consentimento que torna a ação possível.
   *
   * NÃO PERGUNTA AO INTERRUPTOR, e a ausência é a decisão. É o mesmo raciocínio
   * das quatro capacidades administrativas que `conectores.ts` deixa de fora do
   * desligamento (`credencial.rotacionar`, `conector.religar`…): são as rotas
   * que CONSERTAM a situação, e recusá-las faria desligar um conector trancar a
   * porta por dentro. Autorizar também não sai da casa — devolve uma URL ou uma
   * instrução; quem sai é o navegador da pessoa, com o consentimento dela.
   */
  async autorizar(orgId: string, chave: string, actorId: string): Promise<ResultadoDeAutorizacao> {
    const r = await this.contrato.autorizar(chave, { orgId, actorId });
    await this.registrar(orgId, actorId, 'conector.autorizar', chave, { tipo: r.tipo });
    return r;
  }

  /**
   * SINCRONIZAR — traz o estado do fornecedor para dentro, ou renova a ligação.
   *
   * PERGUNTA AO INTERRUPTOR ANTES, porque isto SAI DA CASA. A recusa vem com o
   * código estável que a tela já sabe traduzir (`CODIGO_CONECTOR_DESLIGADO`).
   *
   * E CONFERE A PERMISSÃO QUE O CONECTOR EXIGE A MAIS. A rota genérica pede
   * `admin.usuarios`; sincronizar o ClickUp sempre pediu `tarefas.editar` e
   * reindexar o Obsidian sempre pediu `obsidian.editar`. São permissões
   * DIFERENTES, não menores — sem esta conferência, o verbo único viraria uma
   * segunda porta para as mesmas duas operações, com a trava antiga intacta e
   * inútil ao lado dela. Ver `permissaoParaSincronizar` no contrato.
   */
  async sincronizar(
    orgId: string,
    chave: string,
    actorId: string,
    permissoesDeQuemPediu: readonly string[] = [],
  ): Promise<ResultadoDeSincronizacao> {
    const conector = this.contrato.exigir(chave);
    const exigida = conector.permissaoParaSincronizar;
    await exigirAcessoAtual(this.prisma, orgId, actorId, ['admin.usuarios', ...(exigida ? [exigida] : [])]);
    if (exigida && !permissoesDeQuemPediu.includes(exigida)) {
      throw new ForbiddenException(
        `Sincronizar "${conector.rotulo}" exige a permissão "${exigida}", que é a mesma que a ` +
          'rota própria deste conector sempre exigiu. O verbo do contrato é outro caminho para ' +
          'a mesma operação, não uma permissão a menos.',
      );
    }
    for (const linha of this.linhasDe(conector)) {
      await this.conectores.exigirLigado({ orgId, conector: linha });
    }
    const r = await this.contrato.sincronizar(chave, { orgId, actorId });
    await this.registrar(orgId, actorId, 'conector.sincronizar', chave, r);
    return r;
  }

  /**
   * A sonda de UM conector, sob demanda — o botão "verificar" da tela.
   *
   * PASSA PELA MEMÓRIA CURTA como o catálogo passa, e isso é decisão. Esta rota
   * exige `dashboard.ver`, a permissão mais fraca que existe: sem memória,
   * qualquer usuário de qualquer empresa dispara, sem limite, chamadas contra
   * credenciais DO PROCESSO (ClickUp, Evolution), que são compartilhadas por
   * todas as empresas e têm cota do outro lado. A resposta carrega
   * `verificadoEm`, e a tela imprime esse horário — guardar por trinta segundos
   * sem esconder a idade é honesto; o que não seria honesto é dizer "sondado
   * agora" sobre uma medição de meia hora atrás.
   *
   * O que muda estado esquece a linha na hora (os verbos, o desligamento, o
   * retorno do OAuth), então "verificar" logo depois de agir SEMPRE mede de
   * novo.
   */
  async saude(orgId: string, chave: string): Promise<SaudeDeConector> {
    const conector = this.contrato.exigir(chave);
    const desligados = await this.conectores.desligados(orgId);
    const porque = this.porqueDesligado(conector, desligados);
    if (porque) return naoVerificado(`${porque} Nada foi chamado.`);
    return this.contrato.sondar({ orgId, chave });
  }

  /**
   * Esquece a sonda guardada de um conector desta empresa.
   *
   * Existe para o DESLIGAMENTO e o RELIGAMENTO, que mudam o estado da ligação
   * por fora do contrato (são do registro da fatia 3.7) e, sem isto, deixariam a
   * tela mostrando por até trinta segundos a saúde de antes do clique. A chave
   * pode ser a de uma LINHA (`gmail`) — quem responde por ela é resolvido aqui,
   * porque é o conector inteiro que precisa ser esquecido.
   */
  esquecerSonda(orgId: string, chaveDaLinha: string): void {
    const dono = this.contrato.donoDaLinha(chaveDaLinha);
    this.contrato.esquecer(orgId, dono?.chave ?? chaveDaLinha);
  }

  /**
   * REVOGAR — QUEIMA a credencial desta empresa. Não é desligar.
   *
   * NÃO PERGUNTA AO INTERRUPTOR: revogar é mais restritivo que desligar, e um
   * conector desligado é justamente o caso em que revogar é a próxima coisa que
   * alguém quer fazer (desligou por suspeita de vazamento, confirmou, agora
   * queima). Recusar aqui obrigaria a RELIGAR o conector para poder queimar a
   * credencial dele — a sequência mais perigosa possível.
   */
  async revogar(
    orgId: string,
    chave: string,
    actorId: string,
    motivo?: string | null,
  ): Promise<ResultadoDeRevogacao> {
    const r = await this.contrato.revogar(chave, { orgId, actorId, motivo: motivo ?? null });
    await this.registrar(orgId, actorId, 'conector.revogar', chave, { ...r, motivo: motivo ?? null });
    if (r.tipo === 'revogado') {
      this.log.warn(
        `credencial de "${chave}" REVOGADA na empresa ${orgId}: ${r.segredos.join(', ') || '(nada)'}` +
          (motivo ? ` — ${motivo}` : ''),
      );
    }
    return r;
  }

  /**
   * A linha de auditoria dos verbos.
   *
   * PROTEGIDA: a falha de registro não desfaz o que já aconteceu. Mesmo
   * princípio de `ConectoresService.registrarMudanca` — o estado real é o que
   * vale, e o que se perde sai no log com o bastante para reconstruir à mão.
   */
  private async registrar(
    orgId: string,
    actorId: string,
    acao: string,
    chave: string,
    depois: unknown,
  ): Promise<void> {
    try {
      await this.audit.log({
        orgId,
        actorId,
        action: acao,
        entityType: 'conector',
        entityId: chave,
        after: depois as never,
      });
    } catch (e) {
      this.log.error(
        `${acao} de "${chave}" (empresa ${orgId}) NÃO foi auditado: ${(e as Error).message} — ` +
          `a ação JÁ ACONTECEU. Conteúdo perdido: ${JSON.stringify(depois)}`,
      );
    }
  }

  async toggle(orgId: string, key: string, status: string, actorId: string) {
    const connector = CONNECTORS.find((c) => c.key === key);
    if (!connector) throw new BadRequestException(`Conector desconhecido: ${key}`);
    if (!isManaged(connector.authType)) {
      throw new BadRequestException(
        `"${connector.label}" usa ${connector.authType.toUpperCase()} — precisa do fluxo de OAuth + credencial própria do root. Ainda não disponível.`,
      );
    }

    const existing = await this.prisma.integrationAccount.findFirst({ where: { orgId, key } });
    const connectedAt = status === 'connected' ? new Date() : null;
    const row = existing
      ? await this.prisma.integrationAccount.update({
          where: { id: existing.id },
          data: { status: status as any, connectedAt },
        })
      : await this.prisma.integrationAccount.create({
          data: { orgId, key, label: connector.label, status: status as any, connectedAt },
        });

    await this.audit.log({
      orgId,
      actorId,
      action: 'integration.toggle',
      entityType: 'integration',
      entityId: key,
      after: { status },
    });
    return { ok: true, key, status: row.status };
  }
}
