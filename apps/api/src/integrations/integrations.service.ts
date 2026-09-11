import { BadRequestException, Injectable } from '@nestjs/common';
import { CONNECTORS, type IntegrationCatalog, type IntegrationCatalogRow } from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConectoresService } from './conectores.service';
import { ConectoresConfiguradosRegistry } from '../gateway/conectores-configurados.registry';
import {
  type AplicacaoDoDesligamento,
  TEXTO_DA_APLICACAO,
  aplicacaoDoDesligamento,
  grupoDoConector,
} from './conectores';

/*
 * O catálogo da tela de Conexões, com o DESLIGAMENTO por empresa junto (RF-G-06).
 *
 * O tipo é local e é um SUPERCONJUNTO do de `@mktos/shared`: `IntegrationCatalog`
 * mora em `packages/shared`, que é de outra fatia, e acrescentar campo lá no meio
 * de uma onda com quatro agentes escrevendo é colisão garantida. Supertipo
 * resolve sem tocar em arquivo alheio — quem consome o tipo estreito continua
 * válido, e a tela de Conexões (o único consumidor) lê o largo.
 *
 * `desligado` é DIFERENTE de `status: 'disconnected'`, e a tela precisa mostrar
 * os dois:
 *   · `status` responde "esta empresa tem a integração montada?";
 *   · `desligado` responde "alguém mandou o OS parar de usar isto agora?".
 * Um conector pode estar conectado E desligado — é o caso normal de uma
 * suspensão de emergência, e é exatamente aí que juntar os dois campos num só
 * faria a tela mentir.
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

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly conectores: ConectoresService,
    private readonly conectoresConfigurados: ConectoresConfiguradosRegistry,
  ) {}

  async catalog(orgId: string): Promise<CatalogoDeConexoes> {
    const [accounts, desligados] = await Promise.all([
      this.prisma.integrationAccount.findMany({ where: { orgId }, include: { health: true } }),
      this.conectores.desligados(orgId),
    ]);
    const byKey = new Map(accounts.map((a) => [a.key, a]));

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
     * `obsidian` SAIU DAQUI na estabilização da onda 7. Ele era a última das
     * quatro linhas de status derivado de credencial: lia `OBSIDIAN_VAULT_PATH`
     * porque faltava a linha de inscrição no `onModuleInit` do
     * `ObsidianService`. Agora ela existe, e ele responde por si — inclusive
     * melhor do que esta leitura respondia, porque `configured` do lado de lá
     * também confere se o caminho EXISTE no disco, e não só se a variável está
     * preenchida.
     *
     * O que sobrou em `semDono` não tem conector neste repositório (`openai`,
     * `telegram`) ou não depende de credencial nenhuma (`ofx`, builtin).
     */
    const env = process.env;
    const semDono: Record<string, boolean> = {
      openai: !!env.OPENAI_API_KEY,
      telegram: !!env.TELEGRAM_BOT_TOKEN,
      ofx: true, // builtin — importação de extrato sempre disponível
    };

    const derivado = (chave: string): boolean | null =>
      this.conectoresConfigurados.configurado(chave) ?? (chave in semDono ? semDono[chave] : null);

    const items: LinhaDoCatalogo[] = CONNECTORS.map((c) => {
      const acc = byKey.get(c.key);
      // status: registro do banco tem precedência (OAuth/toggle); senão, deriva da config.
      let status = acc?.status ?? 'disconnected';
      const configurado = acc ? null : derivado(c.key);
      if (configurado !== null) status = configurado ? 'connected' : 'disconnected';

      const off = desligados.get(c.key);
      return {
        key: c.key,
        label: c.label,
        category: c.category,
        phase: c.phase,
        authType: c.authType,
        requires: c.requires,
        status,
        health: acc?.health?.status ?? null,
        connectedAt: acc?.connectedAt?.toISOString() ?? null,
        lastSyncAt: acc?.health?.lastSyncAt?.toISOString() ?? null,
        lastError: acc?.health?.lastError ?? null,
        managed: isManaged(c.authType),
        // RF-G-06 — o desligamento é uma CAMADA por cima do status, nunca o
        // próprio status: o conector segue conectado e com credencial guardada.
        desligado: !!off,
        desligadoEm: off?.desligadoEm.toISOString() ?? null,
        desligadoPor: off?.desligadoPor ?? null,
        motivoDesligado: off?.motivo ?? null,
        grupo: grupoDoConector(c.key),
        aplicacaoDoDesligamento: aplicacaoDoDesligamento(c.key),
        textoDoDesligamento: TEXTO_DA_APLICACAO[aplicacaoDoDesligamento(c.key)],
      };
    });

    return { items, source: { tool: 'banco-interno', generatedAt: new Date().toISOString() } };
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
