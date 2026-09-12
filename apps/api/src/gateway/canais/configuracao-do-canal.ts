/*
 * ============================================================================
 * O INTERRUPTOR DO CANAL — desligado é o padrão (RF-A-06)
 * ============================================================================
 *
 * Um canal de DECISÃO que se liga sozinho é um canal que alguém liga sem
 * decidir. Sem os segredos no ambiente, este canal não existe: nenhum pedido
 * sai, nenhum webhook é aceito, nenhum código é gerado. A fila na tela continua
 * sendo a superfície de sempre.
 *
 * ----------------------------------------------------------------------------
 * SÃO DOIS SEGREDOS, E ISSO É CORREÇÃO DE UM DEFEITO — não preferência de estilo
 * ----------------------------------------------------------------------------
 * A primeira versão desta fatia usava UM segredo para as duas coisas, e a
 * justificativa escrita era "separá-los daria dois valores para rodar em
 * ambientes diferentes". Estava errada: um segredo que acumula papéis não pode
 * girar sem derrubar o outro papel, e ele mora — por necessidade — num cabeçalho
 * HTTP que atravessa a Evolution, que é justamente o sistema que esta fatia
 * trata como NÃO CONFIÁVEL (ver `envio-de-aprovacao.service.ts`). Quem conseguir
 * ler o cabeçalho de uma requisição do webhook passa a conseguir FORJAR o código
 * de qualquer aprovação pendente.
 *
 *  1. `CANAL_APROVACAO_SEGREDO` — AUTENTICA O WEBHOOK. A rota é pública por
 *     necessidade (a Evolution não carrega token de sessão nenhum), então o que
 *     separa o webhook de verdade de qualquer requisição da internet é este
 *     cabeçalho compartilhado. Ele viaja; é o que se gira quando vaza.
 *  2. `CANAL_APROVACAO_CODIGO_SEGREDO` — DERIVA O CÓDIGO de cada aprovação
 *     (`codigoDaAprovacao`). Este NUNCA sai do processo: nem no cabeçalho, nem na
 *     mensagem, nem no RASTRO. É o que impede que alguém produza o código de uma
 *     aprovação que não recebeu.
 *
 * OS DOIS PRECISAM SER DIFERENTES, e a conferência é explícita: preencher o
 * mesmo valor nos dois é voltar à versão colapsada com dois nomes, que é pior do
 * que um nome só — parece separado.
 *
 * ----------------------------------------------------------------------------
 * O TERCEIRO PAPEL, QUE **NÃO** DÁ PARA RESOLVER AQUI — e fica declarado
 * ----------------------------------------------------------------------------
 * Os dois segredos são do PROCESSO, não da empresa: quem os tem fala com o
 * webhook e deriva código em QUALQUER empresa que o processo atenda. O código
 * passou a levar o `orgId` na derivação (separação de domínio: o código da
 * empresa A não endereça a aprovação da empresa B nem por acidente de colisão),
 * mas isso não é o mesmo que segredo POR EMPRESA — e segredo por empresa exige
 * guardá-lo no cofre e lê-lo por tenant, que é decisão de produto, não de fatia.
 * Está no relatório como pergunta.
 *
 * ----------------------------------------------------------------------------
 * TAMANHO MÍNIMO, e a recusa é BARULHENTA
 * ----------------------------------------------------------------------------
 * Um segredo curto vira um segredo adivinhável. Vinte e quatro caracteres é o
 * piso; abaixo disso o canal se recusa a ligar. `diagnosticoDoCanal` existe para
 * que o ARRANQUE diga isso em voz alta (ver `EnvioDeAprovacaoService.onModuleInit`):
 * quem liga o canal pela metade recebia silêncio absoluto e concluía que estava
 * ligado.
 */

/** O piso de tamanho de cada segredo. Ver o cabeçalho. */
export const MINIMO_DO_SEGREDO = 24;

/** O cabeçalho que o webhook tem de trazer. */
export const CABECALHO_DO_SEGREDO = 'x-canal-segredo';

/** O nome das duas variáveis, num lugar só — o diagnóstico e o teste leem daqui. */
export const VARIAVEL_DO_TRANSPORTE = 'CANAL_APROVACAO_SEGREDO';
export const VARIAVEL_DO_CODIGO = 'CANAL_APROVACAO_CODIGO_SEGREDO';
export const VARIAVEL_DAS_CAPACIDADES = 'CANAL_APROVACAO_CAPACIDADES';

/**
 * A ÚNICA capacidade que o canal decide quando ninguém disse outra coisa.
 *
 * Ver `pode-decidir-no-canal.ts` para o porquê de a lista existir. Aqui só fica
 * o valor: a capacidade cujo conteúdo já ia sair por este mesmo WhatsApp.
 */
export const CAPACIDADES_PADRAO = ['whatsapp.mensagem.enviar'] as const;

/** Lê, apara e trata vazio/só-espaço como ausente. */
function bruto(ambiente: NodeJS.ProcessEnv, variavel: string): string {
  return (ambiente[variavel] ?? '').trim();
}

/** Um segredo válido, ou `null`. Curto demais é `null` — e `diagnosticoDoCanal` grita. */
function segredoValido(ambiente: NodeJS.ProcessEnv, variavel: string): string | null {
  const valor = bruto(ambiente, variavel);
  if (valor === '' || valor.length < MINIMO_DO_SEGREDO) return null;
  return valor;
}

/**
 * O segredo de TRANSPORTE (o cabeçalho do webhook), ou `null`.
 *
 * Trata string vazia e só-espaço como ausente — é o que o docker-compose entrega
 * para toda variável declarada `${X:-}` e não preenchida (ver `llm/env.ts` e o
 * caso que quebrou o motor em produção com a credencial certa no lugar).
 *
 * Devolve `null` também quando o canal está MAL configurado (segredo do código
 * faltando, ou os dois iguais): metade ligado é pior do que desligado, porque
 * abre a rota e não fecha o código.
 */
export function segredoDoCanal(ambiente: NodeJS.ProcessEnv = process.env): string | null {
  return canalConfigurado(ambiente) ? segredoValido(ambiente, VARIAVEL_DO_TRANSPORTE) : null;
}

/** O segredo de DERIVAÇÃO do código, ou `null`. Mesma regra de tudo-ou-nada. */
export function segredoDoCodigo(ambiente: NodeJS.ProcessEnv = process.env): string | null {
  return canalConfigurado(ambiente) ? segredoValido(ambiente, VARIAVEL_DO_CODIGO) : null;
}

/** Os dois segredos existem, têm tamanho e são DIFERENTES? */
export function canalConfigurado(ambiente: NodeJS.ProcessEnv = process.env): boolean {
  const transporte = segredoValido(ambiente, VARIAVEL_DO_TRANSPORTE);
  const codigo = segredoValido(ambiente, VARIAVEL_DO_CODIGO);
  return transporte !== null && codigo !== null && transporte !== codigo;
}

/** O que há de errado com a configuração do canal. Vazio = ou está desligado, ou está certo. */
export type QueixaDoCanal =
  | 'transporte-curto'
  | 'codigo-curto'
  | 'codigo-faltando'
  | 'transporte-faltando'
  | 'segredos-iguais';

/**
 * O DIAGNÓSTICO DO ARRANQUE — a função que era código morto.
 *
 * Devolve a lista de queixas. Vazia quer dizer uma de duas coisas, e as duas são
 * aceitáveis: ninguém preencheu nada (canal desligado, que é o padrão) ou está
 * tudo certo. `ligado` separa os dois casos.
 *
 * Quem chama é `EnvioDeAprovacaoService.onModuleInit`. Sem isso, "liguei pela
 * metade" e "não liguei" eram indistinguíveis do lado de fora — e o primeiro é
 * um defeito, não uma escolha.
 */
export function diagnosticoDoCanal(ambiente: NodeJS.ProcessEnv = process.env): {
  ligado: boolean;
  queixas: QueixaDoCanal[];
} {
  const t = bruto(ambiente, VARIAVEL_DO_TRANSPORTE);
  const c = bruto(ambiente, VARIAVEL_DO_CODIGO);
  if (t === '' && c === '') return { ligado: false, queixas: [] };

  const queixas: QueixaDoCanal[] = [];
  if (t === '') queixas.push('transporte-faltando');
  else if (t.length < MINIMO_DO_SEGREDO) queixas.push('transporte-curto');
  if (c === '') queixas.push('codigo-faltando');
  else if (c.length < MINIMO_DO_SEGREDO) queixas.push('codigo-curto');
  if (t !== '' && t === c) queixas.push('segredos-iguais');

  return { ligado: queixas.length === 0, queixas };
}

/** A frase de cada queixa, em português, para o log do arranque. */
export const FRASE_DA_QUEIXA: Record<QueixaDoCanal, string> = {
  'transporte-faltando': `${VARIAVEL_DO_TRANSPORTE} não está preenchida: o webhook não tem como se autenticar.`,
  'codigo-faltando': `${VARIAVEL_DO_CODIGO} não está preenchida: não há como derivar o código de uma aprovação.`,
  'transporte-curto': `${VARIAVEL_DO_TRANSPORTE} tem menos de ${MINIMO_DO_SEGREDO} caracteres.`,
  'codigo-curto': `${VARIAVEL_DO_CODIGO} tem menos de ${MINIMO_DO_SEGREDO} caracteres.`,
  'segredos-iguais': `${VARIAVEL_DO_TRANSPORTE} e ${VARIAVEL_DO_CODIGO} têm o MESMO valor: um deles viaja no cabeçalho do webhook, então os dois viajam.`,
};

/**
 * AS CAPACIDADES QUE ESTE CANAL PODE DECIDIR.
 *
 * Lista de permissão, separada por vírgula. Ausente quer dizer o PADRÃO
 * (`CAPACIDADES_PADRAO`), nunca "todas" — e não existe curinga: o dia em que
 * alguém escrever `*` aqui, ele recebe a lista vazia, que não decide nada.
 *
 * Vazia por escrito (`CANAL_APROVACAO_CAPACIDADES=`) é ausente, então volta ao
 * padrão. Quem quer o canal só notificando desliga o canal.
 */
export function capacidadesDoCanal(ambiente: NodeJS.ProcessEnv = process.env): string[] {
  const valor = bruto(ambiente, VARIAVEL_DAS_CAPACIDADES);
  if (valor === '') return [...CAPACIDADES_PADRAO];
  const itens = valor
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '' && s !== '*');
  return [...new Set(itens)];
}
