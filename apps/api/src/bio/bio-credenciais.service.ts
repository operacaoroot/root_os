import { Injectable, Logger, Optional } from '@nestjs/common';
import { BioPlataforma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { cifrar, decifrar } from '../common/crypto';
import { CofreService, SegredoIndisponivelError } from '../cofre/cofre.service';
import { NOMES_CONHECIDOS } from '../cofre/segredo';

export type Credencial = {
  appId: string;
  secret: string;
  origem: 'perfil' | 'global' | 'ambiente';
  /** Onde o segredo foi lido de fato. Diagnóstico — nunca decisão de negócio. */
  fonte?: 'cofre' | 'coluna' | 'ambiente';
};

/*
 * ============================================================================
 * O PRIMEIRO CONSUMIDOR REAL DO COFRE (RF-C-01), com queda para a coluna antiga
 * ============================================================================
 *
 * POR QUE ESTE SERVIÇO, E NÃO OUTRO. Uma migração que ninguém lê não migrou
 * nada: enquanto nenhum consumidor pedisse ao cofre, a tabela nova era um
 * depósito paralelo e as credenciais em uso continuavam inteiramente nas colunas
 * de origem. É também o que torna verificável, de ponta a ponta, a recusa de
 * rotação que protege as credenciais herdadas — sem leitor, aquela recusa seria
 * um argumento sobre um caminho que ninguém percorre.
 *
 * Este é o candidato natural pela divisão de trabalho da onda: a fatia vizinha
 * (3.3) governa as ROTAS E SERVIÇOS DE ESCRITA; leitura de credencial é desta
 * fatia. `resolver` é leitura pura, não é rota de escrita e é o único ponto por
 * onde o segredo do app das plataformas da bio sai do banco.
 *
 * ----------------------------------------------------------------------------
 * A ORDEM, E O QUE CADA DEGRAU SIGNIFICA
 * ----------------------------------------------------------------------------
 *   1. COFRE (`<plataforma>/app_secret` da empresa) — o que manda depois da
 *      migração. É a única fonte cifrada com o CHAVEIRO, isto é, a única
 *      rotacionável;
 *   2. COLUNA DE ORIGEM (`BioCredencialApp.segredoCifrado`) — a queda, e ela é
 *      indispensável: a migração COPIA e não apaga nada, então até alguém rodar
 *      `cofre.cli.js migrar` esta é a única fonte que existe. Remover a queda
 *      antes disso derrubaria a bio de todo mundo;
 *   3. GLOBAL da Root (`orgId` nulo) e depois o AMBIENTE — inalterados. O cofre
 *      é por empresa e não guarda nenhum dos dois.
 *
 * ----------------------------------------------------------------------------
 * REVOGADO NÃO CAI PARA A COLUNA — e é a parte que mais importa
 * ----------------------------------------------------------------------------
 * Uma queda escrita como "qualquer erro do cofre → usa a coluna" transformaria
 * a REVOGAÇÃO numa sugestão: revogar o segredo no cofre e continuar lendo a
 * coluna antiga é não ter revogado. Então os dois desfechos são separados com
 * todas as letras:
 *
 *   · o cofre diz REVOGADO   → devolve `null`. Não há credencial, ponto;
 *   · o cofre não tem, ou não pôde responder → cai para a coluna.
 *
 * "Não pôde responder" é real e não é defeito: `CofreService` exige que a
 * empresa do argumento seja a mesma do contexto de execução, e há chamadores
 * legítimos fora de requisição HTTP (o `BioSyncService`, que varre conexões de
 * várias empresas). Falhar ali derrubaria a sincronização inteira por causa de
 * um depósito que ainda pode estar vazio.
 *
 * ----------------------------------------------------------------------------
 * POR QUE `resolver` DEVOLVE STRING, e não a credencial emprestada
 * ----------------------------------------------------------------------------
 * Porque os três chamadores (`bio.service.ts`, `bio-oauth.controller.ts`,
 * `bio-sync.service.ts`) pertencem à fatia vizinha e não podem ser tocados nesta.
 * A assinatura fica de pé; o valor é extraído de dentro de `usar` aqui e o
 * empréstimo é devolvido na mesma expressão (`envolver`), de modo que nada
 * atravessa camada carregando o objeto. A troca da assinatura por uma capacidade
 * com escopo está em FORA DO ESCOPO no relatório — e vale a pena: é o troco final
 * do RF-C-02 neste caminho.
 */
@Injectable()
export class BioCredenciaisService {
  private readonly log = new Logger('BioCredenciais');

  constructor(
    private readonly prisma: PrismaService,
    /**
     * `@Optional()` porque a suíte constrói este serviço à mão, e porque um
     * cofre ausente tem de significar "use a coluna de origem" e não "a bio
     * parou" — é o mesmo raciocínio da queda descrita acima.
     */
    @Optional() private readonly cofre?: CofreService,
  ) {}

  /** Fallback de ambiente — para quem já tinha env configurado na VPS. */
  private doAmbiente(plataforma: BioPlataforma): Credencial | null {
    const appId =
      plataforma === 'instagram' ? process.env.INSTAGRAM_APP_ID : process.env.TIKTOK_CLIENT_KEY;
    const secret =
      plataforma === 'instagram'
        ? process.env.INSTAGRAM_APP_SECRET
        : process.env.TIKTOK_CLIENT_SECRET;
    if (!appId || !secret) return null;
    return { appId, secret, origem: 'ambiente', fonte: 'ambiente' };
  }

  /**
   * Pergunta ao cofre. Três desfechos, e eles NÃO se confundem:
   *   · string  → o cofre tem, e é ela que vale;
   *   · 'revogado' → tem linha, e ela foi queimada. Não há queda.
   *   · null    → não há linha, ou o cofre não pôde responder. Cai para a coluna.
   */
  private async doCofre(
    plataforma: BioPlataforma,
    orgId: string,
  ): Promise<string | 'revogado' | null> {
    if (!this.cofre) return null;
    try {
      return await this.cofre.envolver(
        { orgId, conector: plataforma, nome: NOMES_CONHECIDOS.segredoDoApp },
        (c) => c.usar((s) => s),
      );
    } catch (e) {
      if (e instanceof SegredoIndisponivelError) {
        // O cofre carrega a distinção num CAMPO, não na mensagem: comparar texto
        // para decidir se a revogação vale seria uma trava presa a uma redação.
        return e.revogado ? 'revogado' : null;
      }
      this.log.debug(
        `cofre não respondeu por ${plataforma} da empresa ${orgId} (${(e as Error).message}); ` +
          'usando a coluna de origem.',
      );
      return null;
    }
  }

  /**
   * Ordem: credencial do próprio perfil → credencial global da Root → ambiente.
   * Assim o normal é todo mundo usar o app da Root, e quem tiver motivo pra usar
   * o próprio app sobrescreve sem afetar ninguém.
   *
   * Dentro do degrau "do perfil", o COFRE vem antes da coluna. Ver o cabeçalho.
   */
  async resolver(plataforma: BioPlataforma, orgId?: string): Promise<Credencial | null> {
    if (orgId) {
      const doPerfil = await this.prisma.bioCredencialApp.findFirst({ where: { plataforma, orgId } });

      const noCofre = await this.doCofre(plataforma, orgId);
      if (noCofre === 'revogado') {
        this.log.warn(
          `credencial de app de ${plataforma} da empresa ${orgId} está REVOGADA no cofre: ` +
            'a bio não vai autenticar com ela. Reautorize em Conexões — revogação não tem volta, ' +
            'e cair para a coluna antiga seria não ter revogado.',
        );
        return null;
      }
      if (noCofre && doPerfil) {
        return { appId: doPerfil.appId, secret: noCofre, origem: 'perfil', fonte: 'cofre' };
      }

      if (doPerfil) {
        return {
          appId: doPerfil.appId,
          secret: decifrar(doPerfil.segredoCifrado),
          origem: 'perfil',
          fonte: 'coluna',
        };
      }
    }

    const global = await this.prisma.bioCredencialApp.findFirst({
      where: { plataforma, orgId: null },
    });
    if (global) {
      /*
       * O app GLOBAL da Root não passa pelo cofre e não vai passar: o cofre é
       * por empresa (a coluna `orgId` é obrigatória e o isolamento por linha
       * recorta por ela), e esta linha não tem empresa. Consequência operacional
       * que precisa estar escrita em algum lugar, e este é o lugar: enquanto ela
       * existir, `ENCRYPTION_KEY` não pode ser aposentada.
       */
      return {
        appId: global.appId,
        secret: decifrar(global.segredoCifrado),
        origem: 'global',
        fonte: 'coluna',
      };
    }

    return this.doAmbiente(plataforma);
  }

  async salvar(
    plataforma: BioPlataforma,
    orgId: string | null,
    appId: string,
    secret: string,
    quem: string,
  ): Promise<void> {
    const existente = await this.prisma.bioCredencialApp.findFirst({ where: { plataforma, orgId } });
    const dados = {
      appId: appId.trim(),
      segredoCifrado: cifrar(secret.trim()),
      atualizadaPor: quem,
    };

    if (existente) {
      await this.prisma.bioCredencialApp.update({ where: { id: existente.id }, data: dados });
    } else {
      await this.prisma.bioCredencialApp.create({ data: { plataforma, orgId, ...dados } });
    }

    /*
     * ESCREVE NOS DOIS LUGARES enquanto a coluna de origem existir.
     *
     * Gravar só no cofre deixaria a coluna com o valor VELHO, e ela ainda é a
     * queda de `resolver` — um rollback do código, ou um contexto em que o cofre
     * não responde, ressuscitaria a credencial anterior sem aviso. Gravar só na
     * coluna deixaria o cofre desatualizado pelo mesmo motivo, ao contrário.
     *
     * A cópia no cofre é BEST-EFFORT: falhar aqui não pode desfazer o que a tela
     * acabou de salvar com sucesso. O que se perde sai no log, e a próxima
     * passagem de `cofre.cli.js migrar --forcar` reconcilia.
     */
    if (this.cofre && orgId) {
      try {
        await this.cofre.guardar({
          orgId,
          conector: plataforma,
          nome: NOMES_CONHECIDOS.segredoDoApp,
          valor: secret.trim(),
          origem: 'tela',
          actorId: quem,
        });
      } catch (e) {
        this.log.error(
          `credencial de ${plataforma} salva na coluna mas NÃO no cofre ` +
            `(empresa ${orgId}): ${(e as Error).message}. Reconcilie com ` +
            '`cofre.cli.js migrar --forcar --empresa ' +
            `${orgId}\`.`,
        );
      }
    }
  }

  async remover(plataforma: BioPlataforma, orgId: string | null): Promise<void> {
    await this.prisma.bioCredencialApp.deleteMany({ where: { plataforma, orgId } });

    /*
     * Tirar da tela tem de tirar do cofre também — senão `resolver` continuaria
     * achando o segredo no degrau de cima depois de a pessoa ter apagado a
     * credencial, que é o pior desfecho possível de um botão "remover".
     *
     * `nome` explícito, e não revogação de conector inteiro: aqui só se está
     * removendo o segredo do APP, e o par de tokens de OAuth da empresa naquela
     * plataforma não tem nada com isso.
     */
    if (this.cofre && orgId) {
      try {
        await this.cofre.revogar({
          orgId,
          conector: plataforma,
          nome: NOMES_CONHECIDOS.segredoDoApp,
          motivo: 'credencial de app removida na tela',
        });
      } catch (e) {
        this.log.error(
          `credencial de ${plataforma} removida da coluna mas NÃO revogada no cofre ` +
            `(empresa ${orgId}): ${(e as Error).message}. Revogue à mão antes de considerar feito.`,
        );
      }
    }
  }

  /** Para a tela: o que está configurado, sem devolver segredo nenhum. */
  async estado(orgId?: string) {
    const linhas = await this.prisma.bioCredencialApp.findMany({
      where: { OR: [{ orgId: null }, ...(orgId ? [{ orgId }] : [])] },
      select: { plataforma: true, orgId: true, appId: true, atualizadaEm: true },
    });

    const ler = (plataforma: BioPlataforma) => {
      const doPerfil = linhas.find((l) => l.plataforma === plataforma && l.orgId);
      const global = linhas.find((l) => l.plataforma === plataforma && !l.orgId);
      const escolhida = doPerfil ?? global;
      const ambiente = this.doAmbiente(plataforma);
      return {
        plataforma,
        configurada: !!escolhida || !!ambiente,
        origem: doPerfil ? 'perfil' : global ? 'global' : ambiente ? 'ambiente' : null,
        // Só o prefixo: suficiente pra conferir se é o app certo, inútil pra copiar.
        appIdParcial: escolhida ? `${escolhida.appId.slice(0, 6)}…` : ambiente ? 'via ambiente' : null,
        atualizadaEm: escolhida?.atualizadaEm ?? null,
        temGlobal: !!global,
        temDoPerfil: !!doPerfil,
      };
    };

    return {
      items: [ler(BioPlataforma.instagram), ler(BioPlataforma.tiktok)],
      total: 2,
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }
}
