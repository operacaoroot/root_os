import { Logger } from '@nestjs/common';
import { ActorType, type PrismaClient } from '@prisma/client';
import { comContexto, novaCorrelacao } from '../common/contexto-execucao';
import { decifrar } from '../common/crypto';
import type { CofreService } from './cofre.service';
import { NOMES_CONHECIDOS } from './segredo';

/*
 * ============================================================================
 * MIGRAR PARA O COFRE O QUE JÁ EXISTE — com caminho de volta
 * ============================================================================
 *
 * O QUE ESTÁ ESPALHADO HOJE, e em que estado:
 *
 *   GoogleAccount.accessToken / .refreshToken ......... TEXTO PURO no banco
 *   MetaAccount.userToken / .pageToken ................ TEXTO PURO no banco
 *   BioConexao.tokenCifrado / .refreshCifrado ......... cifrado (chave única)
 *   BioCredencialApp.segredoCifrado (com empresa) ..... cifrado (chave única)
 *   BioCredencialApp.segredoCifrado (orgId NULL) ...... cifrado, e é da ROOT
 *
 * As quatro primeiras vêm para o cofre. A quinta NÃO: `orgId` nulo é a
 * credencial do app GLOBAL da Root, e o cofre é por empresa — a coluna é
 * obrigatória e o isolamento por linha recorta por ela. Segredo de plataforma
 * continua em variável de ambiente, que é onde o operador o administra. O
 * relatório conta quantas ficaram para trás, para ninguém descobrir isso por
 * acaso seis meses depois.
 *
 * ----------------------------------------------------------------------------
 * O CAMINHO DE VOLTA, e por que ele é barato
 * ----------------------------------------------------------------------------
 * Este script COPIA. Ele não lê para apagar: nenhuma coluna de origem é
 * alterada, zerada ou removida. Enquanto a fatia que remove as colunas antigas
 * não chegar — e ela é outra fatia, com o seu próprio cuidado — desfazer é
 * apagar as linhas que este script criou, que são exatamente as que têm `origem`
 * começando em `migracao:`. Nada se perde porque nada saiu do lugar.
 *
 * Esse é também o motivo de a migração ser um SCRIPT de dados e não parte da
 * migration de SQL: migration aplicada é imutável e roda no arranque do
 * container. Uma cópia de credencial que falhasse no meio derrubaria a API — e
 * um `prisma migrate deploy` que aborta é a API não subir. Aqui a falha de uma
 * linha vira uma linha no relatório e o comando sai com código 1.
 *
 * ----------------------------------------------------------------------------
 * POR QUE ELE ENTRA PELA PORTA DA FRENTE DO COFRE
 * ----------------------------------------------------------------------------
 * Chama `CofreService.guardar` em vez de montar o `INSERT` na mão. Custa uma
 * transação a mais por linha e paga: a cifragem com dado associado, a escolha da
 * chave atual, o `versao`, a limpeza de revogação e o evento no RASTRO ficam num
 * lugar só. Migração que escreve direto na tabela é a migração que, seis meses
 * depois, gravou no formato que o serviço deixou de entender.
 */

/** Nomes de `origem` que este script grava. `--desfazer` casa por este prefixo. */
export const PREFIXO_DE_MIGRACAO = 'migracao:';

export interface ItemMigrado {
  orgId: string;
  conector: string;
  nome: string;
  origem: string;
}

export interface RelatorioDeMigracao {
  simulado: boolean;
  migrados: ItemMigrado[];
  /** Já havia linha no cofre para (empresa, conector, nome): não sobrescreve. */
  jaNoCofre: ItemMigrado[];
  /** Credencial de plataforma (BioCredencialApp com orgId nulo). */
  deixadosPorSerDePlataforma: number;
  falhas: Array<ItemMigrado & { erro: string }>;
  duracaoMs: number;
}

/**
 * O conector sob o qual a credencial do Google é guardada.
 *
 * É `google`, o GRUPO, e não `gmail`/`gcal`/`gdocs`/`drive`. A razão está em
 * `integrations/conectores.ts`: o catálogo lista quatro superfícies porque são
 * quatro telas, mas a CREDENCIAL é uma só (`GoogleAccount`, uma linha por
 * empresa). Guardar sob `gmail` faria o `gcal` procurar um segredo que não
 * existe. Quem lê o cofre para uma dessas quatro chaves precisa traduzir antes —
 * é o que `conectorDaCredencial` faz.
 */
export const CONECTOR_DO_GOOGLE = 'google';
export const CONECTOR_DA_META = 'meta';

/**
 * Traduz a chave de conector do catálogo na chave sob a qual a CREDENCIAL está
 * guardada. Hoje só o Google agrupa; o resto é identidade.
 *
 * Mora aqui e não em `integrations/conectores.ts` de propósito: aquele arquivo é
 * da fatia 3.7 e fala de DESLIGAMENTO, que é por superfície (dá para desligar só
 * o Gmail). Agrupar lá misturaria as duas perguntas.
 */
export function conectorDaCredencial(chave: string): string {
  return ['gmail', 'gcal', 'gdocs', 'drive'].includes(chave) ? CONECTOR_DO_GOOGLE : chave;
}

const log = new Logger('CofreMigracao');

/**
 * Copia para o cofre as credenciais que já existem.
 *
 * `forcar` sobrescreve o que já está no cofre. O padrão é NÃO sobrescrever:
 * depois da primeira passagem, quem manda é o cofre — uma segunda execução não
 * pode ressuscitar um token velho que ficou para trás numa coluna de origem que
 * ninguém mais atualiza.
 */
export async function migrarCredenciaisParaOCofre(
  prisma: PrismaClient,
  cofre: CofreService,
  opcoes: { simular?: boolean; forcar?: boolean; orgId?: string; actorId?: string | null } = {},
): Promise<RelatorioDeMigracao> {
  const inicio = Date.now();
  const simulado = opcoes.simular === true;
  const rel: RelatorioDeMigracao = {
    simulado,
    migrados: [],
    jaNoCofre: [],
    deixadosPorSerDePlataforma: 0,
    falhas: [],
    duracaoMs: 0,
  };

  const filtroOrg = opcoes.orgId ? { orgId: opcoes.orgId } : {};

  /** Grava uma credencial no cofre, dentro do contexto da empresa dela. */
  async function levar(entrada: {
    orgId: string;
    conector: string;
    nome: string;
    valor: string;
    origem: string;
    escopo?: string[];
    expiraEm?: Date | null;
  }): Promise<void> {
    const item: ItemMigrado = {
      orgId: entrada.orgId,
      conector: entrada.conector,
      nome: entrada.nome,
      origem: entrada.origem,
    };
    try {
      if (!opcoes.forcar) {
        const existe = await prisma.segredoDeConector.findUnique({
          where: {
            orgId_conector_nome: {
              orgId: entrada.orgId,
              conector: entrada.conector,
              nome: entrada.nome,
            },
          },
          select: { id: true },
        });
        if (existe) {
          rel.jaNoCofre.push(item);
          return;
        }
      }
      if (simulado) {
        rel.migrados.push(item);
        return;
      }
      await comContexto(
        {
          orgId: entrada.orgId,
          actorType: ActorType.user,
          actorId: opcoes.actorId ?? null,
          correlationId: novaCorrelacao('cofre-migracao'),
          origem: 'script',
        },
        () =>
          cofre.guardar({
            orgId: entrada.orgId,
            conector: entrada.conector,
            nome: entrada.nome,
            valor: entrada.valor,
            escopo: entrada.escopo ?? [],
            origem: entrada.origem,
            expiraEm: entrada.expiraEm ?? null,
            actorId: opcoes.actorId ?? null,
          }),
      );
      rel.migrados.push(item);
    } catch (e) {
      rel.falhas.push({ ...item, erro: (e as Error).message });
    }
  }

  /** Escopos vêm como string separada por espaço (OAuth) em três tabelas. */
  const escoposDe = (s: string | null): string[] =>
    (s ?? '').split(/[\s,]+/).filter(Boolean);

  // ------------------------------------------------------------------ Google
  //
  // TEXTO PURO no banco até aqui. A cópia para o cofre é a primeira vez que
  // esses dois valores ficam cifrados em repouso — é o ganho mais direto desta
  // fatia, e vale mais que a rotação para quem tem um dump antigo por aí.
  for (const conta of await prisma.googleAccount.findMany({
    where: filtroOrg,
    select: { orgId: true, accessToken: true, refreshToken: true, scope: true, expiresAt: true },
  })) {
    const escopo = escoposDe(conta.scope);
    if (conta.accessToken) {
      await levar({
        orgId: conta.orgId,
        conector: CONECTOR_DO_GOOGLE,
        nome: NOMES_CONHECIDOS.acesso,
        valor: conta.accessToken,
        origem: `${PREFIXO_DE_MIGRACAO}google`,
        escopo,
        expiraEm: conta.expiresAt,
      });
    }
    if (conta.refreshToken) {
      await levar({
        orgId: conta.orgId,
        conector: CONECTOR_DO_GOOGLE,
        nome: NOMES_CONHECIDOS.renovacao,
        valor: conta.refreshToken,
        origem: `${PREFIXO_DE_MIGRACAO}google`,
        escopo,
        // O refresh token não vence junto com o access token. Gravar
        // `expiresAt` aqui faria a tela dizer que ele expirou em uma hora.
        expiraEm: null,
      });
    }
  }

  // -------------------------------------------------------------------- Meta
  for (const conta of await prisma.metaAccount.findMany({
    where: filtroOrg,
    select: { orgId: true, userToken: true, pageToken: true, scope: true, expiresAt: true },
  })) {
    const escopo = escoposDe(conta.scope);
    if (conta.userToken) {
      await levar({
        orgId: conta.orgId,
        conector: CONECTOR_DA_META,
        nome: NOMES_CONHECIDOS.acesso,
        valor: conta.userToken,
        origem: `${PREFIXO_DE_MIGRACAO}meta`,
        escopo,
        expiraEm: conta.expiresAt,
      });
    }
    if (conta.pageToken) {
      await levar({
        orgId: conta.orgId,
        conector: CONECTOR_DA_META,
        nome: NOMES_CONHECIDOS.tokenDePagina,
        valor: conta.pageToken,
        origem: `${PREFIXO_DE_MIGRACAO}meta`,
        escopo,
        expiraEm: conta.expiresAt,
      });
    }
  }

  // --------------------------------------------------------------------- bio
  //
  // Já estava cifrado, com a chave única. Abrir e regravar é o que o traz para o
  // chaveiro — e, a partir daqui, ele é rotacionável como todo o resto.
  for (const conexao of await prisma.bioConexao.findMany({
    where: filtroOrg,
    select: {
      id: true,
      orgId: true,
      plataforma: true,
      tokenCifrado: true,
      refreshCifrado: true,
      escopos: true,
      expiraEm: true,
    },
  })) {
    const escopo = escoposDe(conexao.escopos);
    /*
     * O `nome` carrega o id da conexão porque uma empresa pode ter DUAS contas
     * na mesma plataforma (dois perfis de Instagram), e a chave do cofre é
     * (empresa, conector, nome). Sem o id, a segunda conta sobrescreveria a
     * primeira em silêncio — e revogar uma revogaria a que sobrou.
     */
    const sufixo = `:${conexao.id}`;
    const abrir = (pacote: string | null, qual: string): string | null => {
      if (!pacote) return null;
      try {
        return decifrar(pacote);
      } catch (e) {
        rel.falhas.push({
          orgId: conexao.orgId,
          conector: conexao.plataforma,
          nome: qual,
          origem: `${PREFIXO_DE_MIGRACAO}bio`,
          erro:
            `não abriu com o chaveiro atual: ${(e as Error).message}. ` +
            'Token cifrado com uma ENCRYPTION_KEY que não está mais no ambiente — ' +
            'a conexão precisa ser refeita na tela.',
        });
        return null;
      }
    };

    const token = abrir(conexao.tokenCifrado, NOMES_CONHECIDOS.acesso + sufixo);
    if (token) {
      await levar({
        orgId: conexao.orgId,
        conector: conexao.plataforma,
        nome: NOMES_CONHECIDOS.acesso + sufixo,
        valor: token,
        origem: `${PREFIXO_DE_MIGRACAO}bio`,
        escopo,
        expiraEm: conexao.expiraEm,
      });
    }
    const refresh = abrir(conexao.refreshCifrado, NOMES_CONHECIDOS.renovacao + sufixo);
    if (refresh) {
      await levar({
        orgId: conexao.orgId,
        conector: conexao.plataforma,
        nome: NOMES_CONHECIDOS.renovacao + sufixo,
        valor: refresh,
        origem: `${PREFIXO_DE_MIGRACAO}bio`,
        escopo,
        expiraEm: null,
      });
    }
  }

  for (const cred of await prisma.bioCredencialApp.findMany({
    where: opcoes.orgId ? { orgId: opcoes.orgId } : {},
    select: { orgId: true, plataforma: true, segredoCifrado: true },
  })) {
    if (!cred.orgId) {
      // Credencial GLOBAL da Root. Ver o cabeçalho: o cofre é por empresa.
      rel.deixadosPorSerDePlataforma += 1;
      continue;
    }
    try {
      await levar({
        orgId: cred.orgId,
        conector: cred.plataforma,
        nome: NOMES_CONHECIDOS.segredoDoApp,
        valor: decifrar(cred.segredoCifrado),
        origem: `${PREFIXO_DE_MIGRACAO}bio`,
      });
    } catch (e) {
      rel.falhas.push({
        orgId: cred.orgId,
        conector: cred.plataforma,
        nome: NOMES_CONHECIDOS.segredoDoApp,
        origem: `${PREFIXO_DE_MIGRACAO}bio`,
        erro: `não abriu com o chaveiro atual: ${(e as Error).message}`,
      });
    }
  }

  rel.duracaoMs = Date.now() - inicio;
  log.log(
    `migração para o cofre${simulado ? ' (simulada)' : ''}: ${rel.migrados.length} copiada(s), ` +
      `${rel.jaNoCofre.length} já estava(m) lá, ${rel.deixadosPorSerDePlataforma} de plataforma, ` +
      `${rel.falhas.length} falha(s)`,
  );
  return rel;
}

/**
 * O CAMINHO DE VOLTA: apaga do cofre o que a migração copiou.
 *
 * Casa por `origem LIKE 'migracao:%'`, então uma credencial que tenha sido
 * REGRAVADA pelo produto depois da migração (um OAuth refeito, que grava
 * `origem: 'oauth'`) NÃO é apagada — desfazer a migração não pode levar junto o
 * que passou a nascer no cofre.
 *
 * Não restaura nada porque não há o que restaurar: as colunas de origem nunca
 * foram tocadas. Se um dia elas passarem a ser esvaziadas, esta função deixa de
 * ser suficiente e quem fizer aquela fatia tem de escrever a restauração aqui.
 */
export async function desfazerMigracaoDoCofre(
  prisma: PrismaClient,
  opcoes: { simular?: boolean; orgId?: string } = {},
): Promise<{ apagados: number; simulado: boolean }> {
  const where = {
    origem: { startsWith: PREFIXO_DE_MIGRACAO },
    ...(opcoes.orgId ? { orgId: opcoes.orgId } : {}),
  };
  if (opcoes.simular) {
    return { apagados: await prisma.segredoDeConector.count({ where }), simulado: true };
  }
  const r = await prisma.segredoDeConector.deleteMany({ where });
  log.warn(`desfeita a migração para o cofre: ${r.count} linha(s) apagada(s)`);
  return { apagados: r.count, simulado: false };
}
