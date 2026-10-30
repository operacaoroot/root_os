import {
  Body,
  Controller,
  Headers,
  Logger,
  NotFoundException,
  Optional,
  Param,
  Post,
} from '@nestjs/common';
import { comTenantPublico } from '../../common/tenant-publico';
import { PrismaService } from '../../prisma/prisma.service';
import { ehEmpresaDaCasa } from '../../tenants/empresa-da-casa';
import { CABECALHO_DO_SEGREDO, segredoDoWebhookConfere } from './configuracao-do-canal';
import { CanalDeAprovacaoService } from './canal-de-aprovacao.service';
import { EntradaDeGrupoRegistry } from './entrada-de-grupo.registry';
import { EntradaDiretaRegistry } from './entrada-direta.registry';
import { GravacaoDoWhatsappRegistry } from './gravacao-do-whatsapp.registry';
import { RepasseDoWhatsappRegistry } from './repasse.registry';

/*
 * ============================================================================
 * A ENTRADA DO CANAL — pública por necessidade, muda por desenho (RF-A-06)
 * ============================================================================
 *
 * ----------------------------------------------------------------------------
 * O PREFIXO É `approvals`, E ISSO FOI DECIDIDO, NÃO HERDADO
 * ----------------------------------------------------------------------------
 * `src/tenants/modulos.ts` exige que TODO prefixo de rota esteja declarado —
 * como módulo de negócio ou como espinha do OS —, e `moduloDoCaminho` LANÇA para
 * prefixo desconhecido: uma família de rota nova e não declarada falha em tempo
 * de execução, não só com teste vermelho.
 *
 * Esta rota mora sob `approvals/canal`, então o prefixo que o gate enxerga é
 * `approvals`, que JÁ é espinha (`PREFIXOS_DA_ESPINHA`). Isso é o que se quer, e
 * não um atalho para não mexer na tabela: decidir uma aprovação é espinha do OS
 * pela mesma razão que a fila é — não é produto que se contrata à parte, é como
 * o sistema pede licença para agir. Um prefixo próprio (`canal`, `webhooks`)
 * precisaria de uma decisão nova naquela tabela e diria, por acidente, que o
 * canal é outra coisa.
 *
 * ----------------------------------------------------------------------------
 * POR QUE NÃO TEM `JwtAuthGuard`, E O QUE FICA NO LUGAR
 * ----------------------------------------------------------------------------
 * Quem chama é a Evolution, que não tem token de sessão nenhum para apresentar.
 * A rota é pública no sentido de "não passa pelo guarda de sessão" — não no
 * sentido de aberta:
 *
 *   · o SEGREDO DE TRANSPORTE no cabeçalho, comparado em tempo constante, e
 *     DESTA empresa (Produção 22, M4): o derivado do `orgId` do caminho, ou o do
 *     processo só no caminho da casa (`segredoDoWebhookConfere`). Ele é
 *     o único que VIAJA, e é por isso que ele não é o mesmo que deriva o código
 *     das aprovações (ver `configuracao-do-canal.ts`): quem lê um cabeçalho não
 *     ganha com isso o poder de forjar código. Sem o canal configurado por
 *     inteiro, a rota responde 404 para todo mundo — desligado é o padrão;
 *   · a EMPRESA vem no caminho e abre o contexto de execução
 *     (`comTenantPublico`), então toda consulta daqui para baixo roda dentro
 *     dela e o isolamento por linha a contém como contém qualquer outra;
 *   · e o corpo NÃO AUTORIZA NADA. Mesmo com o segredo certo, o que chega é uma
 *     mensagem: quem decide se ela vale é `CanalDeAprovacaoService`, contra
 *     identidade cadastrada, permissão, alçada e vínculo de conteúdo — todos
 *     lidos do banco.
 *
 * ----------------------------------------------------------------------------
 * A RESPOSTA É SEMPRE A MESMA — no CORPO e no TEMPO
 * ----------------------------------------------------------------------------
 * `{ ok: true }`, para tudo o que passa do segredo: decisão executada, remetente
 * desconhecido, código inválido, mensagem de grupo, conversa fiada. Uma resposta
 * que variasse contaria de fora quais códigos existem e quais números estão
 * cadastrados — exatamente o que o silêncio no WhatsApp existe para não contar.
 * O desfecho de verdade vai para o log do servidor, com correlação.
 *
 * O CORPO CONSTANTE NÃO BASTAVA, e este é o conserto de um oráculo que a
 * primeira versão desta fatia deixou aberto. O trabalho de um número CONHECIDO é
 * caro e variável (varrer até duzentas aprovações pendentes com um HMAC por
 * linha, mais uma chamada externa à Evolution); o de um DESCONHECIDO é uma
 * consulta e uma escrita. Esperar o trabalho terminar para responder publicava
 * essa diferença como latência: bastava cronometrar para separar número
 * cadastrado de número qualquer, e depois para saber quais códigos existem.
 *
 * Então a rota RESPONDE ANTES DE PROCESSAR. O trabalho continua no mesmo
 * contexto de empresa (o `AsyncLocalStorage` acompanha a cadeia de promessas
 * independentemente de quem espera por ela), só que ninguém do lado de fora
 * espera por ele. O que se perde é a possibilidade de o webhook devolver erro —
 * e ele nunca devolvia: a resposta já era constante.
 *
 * A Evolution REENTREGA webhook que falha. Responder cedo é, de quebra, o que
 * evita reentrega por demora — e a reentrega da mesma decisão já era inofensiva,
 * porque a aprovação é de uso único por escrita condicional.
 *
 * 404 quando o segredo falha, e não 401/403, pela mesma razão do gate de
 * módulos: do lado de fora, canal desligado tem de ser indistinguível de rota
 * que não existe.
 *
 * ----------------------------------------------------------------------------
 * ESTA ROTA TAMBÉM É A PORTA DO GRUPO DE LINKS (MC1)
 * ----------------------------------------------------------------------------
 * A Evolution aceita UMA URL de webhook por instância, e é esta. Mensagem de um
 * grupo inscrito em `EntradaDeGrupoRegistry` sai para quem se inscreveu (hoje, a
 * pauta, pelo `EVOLUTION_LINKS_JID`) e NÃO chega ao canal; o resto segue para o
 * canal como sempre, e o canal continua descartando qualquer outro grupo. O
 * segredo, a resposta constante e o contexto de empresa valem igual para os
 * dois caminhos — a triagem acontece depois de tudo isso, em segundo plano.
 *
 * ----------------------------------------------------------------------------
 * E A PORTA DA CONVERSA DO LEAD (Produção 21, P8)
 * ----------------------------------------------------------------------------
 * Depois do grupo, a conversa INDIVIDUAL de um número que é lead do comercial
 * vai para a entrada do comercial (`EntradaDiretaRegistry`), por registro. Quem
 * é identidade cadastrada do canal nunca é desviado: o registro confere isso
 * antes de perguntar ao comercial. O resto segue para o canal como sempre.
 *
 * ----------------------------------------------------------------------------
 * E A GRAVAÇÃO (produção 22C, W1)
 * ----------------------------------------------------------------------------
 * Antes de qualquer leitor, o corpo passa pelo `GravacaoDoWhatsappRegistry`,
 * onde o módulo do WhatsApp (`whatsapp/gravador.service.ts`) se inscreve: toda
 * mensagem, 1:1 e grupo, inclusive `fromMe`, vira `WhatsAppMensagem` (só com a
 * instância desta empresa no corpo e o conector ligado), e o
 * `connection.update` faz Conexões medir o estado de novo. A gravação nunca
 * barra nem altera o que vem depois: o registro não lança, o gravador não mexe
 * no corpo, e os leitores recebem o MESMO corpo, na mesma ordem (grupo de links
 * → entrada do lead → canal). Sem inscrito, o webhook é o de antes.
 */
@Controller('approvals/canal')
export class CanalDeAprovacaoController {
  private readonly log = new Logger('CanalDeAprovacao.webhook');

  /**
   * A última entrega ainda em voo.
   *
   * Existe para o TESTE poder esperar o que a ROTA de propósito não espera (e,
   * um dia, para um desligamento gracioso não cortar uma decisão no meio). Nunca
   * rejeita: `emSegundoPlano` já trata.
   */
  trabalhoEmCurso: Promise<void> = Promise.resolve();

  constructor(
    private readonly canal: CanalDeAprovacaoService,
    /*
     * `@Optional()` porque a suíte do canal monta este controlador à mão com um
     * argumento só. Sem o registro, nenhum grupo é desviado — o canal recebe
     * tudo, como antes do MC1.
     */
    @Optional() private readonly grupos?: EntradaDeGrupoRegistry,
    /** P8: sem o registro (a suíte do canal), nenhuma conversa é desviada. */
    @Optional() private readonly diretas?: EntradaDiretaRegistry,
    /*
     * Produção 22, M4: só para perguntar se a empresa do caminho é a CASA, e só
     * quando o cabeçalho é o segredo do processo. Sem o banco (as suítes que
     * montam à mão), o segredo do processo não vale em empresa nenhuma; só o
     * derivado de cada empresa.
     */
    @Optional() private readonly prisma?: PrismaService,
    /** Produção 22C (W1): sem o registro (as suítes que montam à mão), nada é gravado e o webhook é o de antes. */
    @Optional() private readonly gravacao?: GravacaoDoWhatsappRegistry,
    /*
     * 30/10/2026 (A9): a CÓPIA para fora (a Rootinha). Não consome: roda ao lado
     * da cadeia de sempre, e a cadeia não espera por ela. Sem o registro (as
     * suítes que montam à mão) ou sem inscrito, nada muda.
     */
    @Optional() private readonly repasses?: RepasseDoWhatsappRegistry,
  ) {}

  @Post('whatsapp/:orgId')
  async whatsapp(
    @Param('orgId') orgId: string,
    @Headers(CABECALHO_DO_SEGREDO) apresentado: string | undefined,
    @Body() corpo: unknown,
  ): Promise<{ ok: true }> {
    if (!orgId || orgId.trim() === '') throw new NotFoundException('Não encontrado');
    if (!(await this.segredoConfere(apresentado, orgId.trim()))) throw new NotFoundException('Não encontrado');

    /*
     * A empresa abre o contexto ANTES da primeira consulta — RF-T-04. Rota sem
     * sessão entra com `orgId: null` (o interceptor a abre assim de propósito),
     * e uma consulta com empresa indefinida é um filtro que o Prisma ignora.
     * `comTenantPublico` recusa vazio e recusa a sentinela de resolução, então
     * não há como este caminho rodar "em todas as empresas".
     *
     * A empresa NÃO é validada contra a tabela `Org` de propósito: validar
     * exigiria uma consulta sem empresa resolvida (a sentinela de resolução
     * pública, cujo conjunto de chamadas é congelado por teste) e daria de graça
     * um oráculo de "esta empresa existe". Empresa inexistente simplesmente não
     * tem identidade cadastrada nem aprovação nenhuma: o caminho morre na
     * primeira consulta, do mesmo jeito silencioso.
     */
    this.trabalhoEmCurso = this.emSegundoPlano(orgId.trim(), corpo);
    return { ok: true };
  }

  /**
   * Toca o trabalho e NÃO espera por ele — ver "no CORPO e no TEMPO" acima.
   *
   * Método separado, e não um `void` solto na rota, para que a promessa solta
   * tenha um `catch` de verdade: uma rejeição sem tratamento derrubaria o
   * processo em Node (`unhandledRejection`), e `receber` chama banco e rede.
   */
  private emSegundoPlano(orgId: string, corpo: unknown): Promise<void> {
    return comTenantPublico(orgId, async () => {
      // Produção 22C (W1): grava PRIMEIRO, e nunca barra os leitores (o registro não lança).
      const gravada = await this.gravacao?.gravar(orgId, corpo);
      if (gravada) this.log.debug(`webhook do canal (${orgId}): gravação ${gravada}`);
      // A9: a cópia sai DEPOIS da gravação (o corpo de fora responde citando a
      // mensagem gravada) e AO LADO da cadeia, que não espera por ela.
      const repasse = this.repasses?.quantos
        ? this.repasses.repassar(orgId, corpo).catch(() => [] as string[])
        : Promise.resolve([] as string[]);
      const desfecho = await (async () => {
        const doGrupo = await this.grupos?.despachar(orgId, corpo);
        if (doGrupo != null) return { desfecho: `grupo:${doGrupo}` };
        const doLead = await this.diretas?.despachar(orgId, corpo);
        if (doLead != null) return { desfecho: `direta:${doLead}` };
        return this.canal.receber(orgId, corpo);
      })();
      const repassada = await repasse;
      return repassada.length ? { desfecho: `${desfecho.desfecho} · repasse:${repassada.join(',')}` } : desfecho;
    })
      .then(({ desfecho }) => {
        // O desfecho vai para o log do servidor, nunca para a resposta.
        this.log.debug(`webhook do canal (${orgId}): ${desfecho}`);
      })
      .catch((e: unknown) => {
        this.log.warn(`webhook do canal falhou (${orgId}): ${(e as Error).message}`);
      });
  }

  /**
   * O segredo do webhook DESTA empresa, em tempo constante, e recusa quando o
   * canal está desligado (`segredoDoWebhookConfere`, Produção 22, M4): o
   * derivado da empresa do caminho, ou o segredo do processo só se a empresa do
   * caminho for a casa.
   *
   * `timingSafeEqual` exige buffers do MESMO tamanho — comparar o tamanho antes
   * vaza o tamanho do segredo, e é o vazamento que se aceita: saber que o
   * segredo tem 40 caracteres não ajuda a adivinhá-lo, e a alternativa (padding)
   * introduziria um caminho novo para errar.
   */
  private segredoConfere(apresentado: string | undefined, orgId: string): Promise<boolean> {
    const prisma = this.prisma;
    return segredoDoWebhookConfere(apresentado, orgId, async (id) =>
      prisma ? comTenantPublico(id, () => ehEmpresaDaCasa(prisma, id)) : false,
    );
  }
}
