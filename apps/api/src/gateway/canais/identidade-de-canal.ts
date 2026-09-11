/*
 * ============================================================================
 * QUEM É A PESSOA DO OUTRO LADO DO CANAL — o endereço, e só o endereço (RF-A-06)
 * ============================================================================
 *
 * Função pura, sem banco e sem Nest: entra o identificador que a Evolution
 * entrega, sai a chave EXATA que se procura em `ChannelIdentity.externalId` —
 * ou `null`, que quer dizer "este remetente não tem como ser ninguém aqui".
 *
 * O MODELO DE IDENTIDADE JÁ EXISTIA E ESTAVA MORTO. `ChannelIdentity` está no
 * schema desde 29/08/2026 (`model ChannelIdentity`, com `@@unique([orgId,
 * canal, externalId])`) e, até esta fatia, NENHUMA linha de código a lia — o
 * inventário de isolamento já a descrevia como "caminho de AUTENTICAÇÃO, não só
 * de dado" (`test/tenant-isolation.test.ts`). Esta fatia não cria tabela nova:
 * ela liga a que existe. É o que a fatia pede com todas as letras
 * ("reaproveite o modelo de identidade por canal que já existe") e é o que
 * 06-ESTADO-DA-BASE manda fazer.
 *
 * ----------------------------------------------------------------------------
 * O ATAQUE QUE ESTA FUNÇÃO EXISTE PARA IMPEDIR: O NÚMERO PARECIDO
 * ----------------------------------------------------------------------------
 * Um canal de DECISÃO casa remetente com pessoa. Toda folga no casamento é uma
 * folga na autoridade. Três folgas clássicas, e o que se faz com cada uma:
 *
 *  · O NOME. A Evolution manda `pushName` — o nome que a PRÓPRIA pessoa
 *    escolheu no aparelho dela. É texto livre de terceiro: qualquer um se chama
 *    "Pedro Magnago" em dez segundos. Nada aqui lê `pushName`, e a decisão está
 *    escrita para que ninguém o acrescente depois "para melhorar o log".
 *
 *  · O NONO DÍGITO. Um número de celular brasileiro aparece com e sem o 9 na
 *    frente. A tentação é normalizar os dois para a mesma chave — e isso faria
 *    DOIS NÚMEROS DIFERENTES colidirem numa identidade só. Aqui não se
 *    normaliza: o que a pessoa cadastrou é o que vale, e quem registrou o
 *    número na forma errada não aprova nada (falha fechada) em vez de aprovar
 *    no lugar de outro (falha aberta).
 *
 *  · O SUFIXO E O PREFIXO. A comparação no banco é por igualdade, nunca por
 *    `contains`/`startsWith`. Esta função só devolve a chave; quem consulta usa
 *    `findFirst` com igualdade (ver `canal-de-aprovacao.service.ts`).
 *
 * ----------------------------------------------------------------------------
 * SÓ ENDEREÇO DE TELEFONE — `@lid` E `@g.us` NÃO VIRAM IDENTIDADE
 * ----------------------------------------------------------------------------
 * O WhatsApp tem mais de um espaço de nomes:
 *
 *   · `<numero>@s.whatsapp.net` e `<numero>@c.us` — o telefone. É o único que
 *     uma pessoa consegue cadastrar de antemão, porque é o único que ela sabe;
 *   · `<opaco>@lid` — identificador ligado, opaco, que a Evolution passou a
 *     entregar em alguns cenários. Ninguém consegue pré-cadastrá-lo, então
 *     aceitá-lo só produziria "identidade não encontrada" com outro nome;
 *   · `<...>@g.us` — GRUPO. Grupo não é pessoa. Nunca.
 *   · `status@broadcast` — recado, não conversa.
 *
 * Tudo que não é telefone devolve `null`, e `null` é IGNORADO lá na frente —
 * nunca "aceito com ressalva".
 */

/** O sufixo do identificador de grupo. Grupo nunca decide nada — ver o topo. */
const SUFIXO_DE_GRUPO = '@g.us';

/** Os dois espaços de nomes que correspondem a um telefone de verdade. */
const SUFIXOS_DE_TELEFONE = ['@s.whatsapp.net', '@c.us'] as const;

/**
 * Quantos dígitos um número de telefone pode ter, com DDI e sem `+`.
 *
 * O mínimo do E.164 é 8 (alguns países) e o máximo é 15. Fora disso não é
 * telefone: é lixo, ou é um identificador de outro espaço de nomes que chegou
 * aqui sem sufixo.
 */
const MINIMO_DE_DIGITOS = 8;
const MAXIMO_DE_DIGITOS = 15;

/** O identificador é de um GRUPO? */
export function ehGrupoDeWhatsapp(jid: unknown): boolean {
  return typeof jid === 'string' && jid.trim().toLowerCase().endsWith(SUFIXO_DE_GRUPO);
}

/**
 * A chave de identidade deste remetente, ou `null`.
 *
 * O que ela tira, e por que cada corte é seguro:
 *
 *  · o SUFIXO de espaço de nomes (`@s.whatsapp.net`, `@c.us`) — é constante,
 *    não é informação sobre quem está falando;
 *  · o SUFIXO DE APARELHO (`:12`) — o WhatsApp o acrescenta para distinguir
 *    celular de web do MESMO número. Duas sessões da mesma pessoa não são duas
 *    pessoas, e mantê-lo faria a identidade cadastrada parar de casar assim que
 *    alguém respondesse pelo computador.
 *
 * O que ela NÃO tira: dígito nenhum do número. Ver "o nono dígito" no topo.
 */
export function chaveDeIdentidadeWhatsapp(jid: unknown): string | null {
  if (typeof jid !== 'string') return null;
  const cru = jid.trim().toLowerCase();
  if (cru === '') return null;
  if (ehGrupoDeWhatsapp(cru)) return null;

  const sufixo = SUFIXOS_DE_TELEFONE.find((s) => cru.endsWith(s));
  // Sem sufixo conhecido: pode ser `@lid`, `status@broadcast` ou um número cru.
  // Só o número cru passa — e ele passa pela mesma peneira de dígitos abaixo.
  if (!sufixo && cru.includes('@')) return null;

  const semSufixo = sufixo ? cru.slice(0, -sufixo.length) : cru;
  const semAparelho = semSufixo.split(':')[0] ?? '';
  // `_` e `-` não existem em telefone; se aparecerem, não é telefone.
  if (!/^\+?\d+$/.test(semAparelho)) return null;

  const digitos = semAparelho.replace(/^\+/, '');
  if (digitos.length < MINIMO_DE_DIGITOS || digitos.length > MAXIMO_DE_DIGITOS) return null;
  return digitos;
}

/**
 * As DUAS formas exatas com que a chave pode estar gravada em
 * `ChannelIdentity.externalId`, para a consulta poder casar as duas por
 * IGUALDADE.
 *
 * A forma canônica é só o número (`5511999999999`). A segunda existe porque a
 * tabela nasceu sem nenhum código que a escrevesse, então não há convenção
 * estabelecida e alguém pode ter colado o JID inteiro ao cadastrar. Aceitar as
 * duas por igualdade NÃO é casamento frouxo: são dois valores literais, não um
 * padrão.
 */
export function formasDaChave(chave: string): string[] {
  return [chave, `${chave}@s.whatsapp.net`, `${chave}@c.us`];
}

/**
 * Os quatro últimos dígitos — para o registro poder dizer QUAL número tentou,
 * sem gravar o número inteiro no RASTRO, que é append-only por cinco anos.
 *
 * O identificador completo entra no evento marcado como sigiloso (resumo
 * criptográfico): quem investigar consegue CONFERIR um número suspeito sem que
 * o log tenha guardado a lista de telefones de ninguém.
 */
export function sufixoVisivel(chave: string): string {
  return chave.slice(-4);
}
