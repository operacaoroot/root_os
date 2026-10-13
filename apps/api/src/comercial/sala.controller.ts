import { Body, Controller, Get, NotImplementedException, Param, Post } from '@nestjs/common';

/*
 * A SALA DO CLIENTE — rotas ANÔNIMAS do link (`/api/sala/:token`), Lane 0 → Lane B.
 *
 * O mesmo contrato de `tenants/onboarding/link`: não há sessão, a empresa é
 * achada pelo HASH do token (sentinela pública) e o resto do pedido roda em
 * `comTenantPublico`. Token inexistente, expirado e revogado respondem a MESMA
 * coisa (404 sem detalhe). Teto de taxa por origem como o do onboarding.
 *
 * O prefixo `sala` está declarado em `tenants/modulos.ts` como módulo `leads`.
 */
const PENDENTE = (oQue: string) =>
  new NotImplementedException(`${oQue}: ainda não implementado nesta versão (lane B da passagem).`);

@Controller('sala')
export class SalaController {
  /** O estado da sala: estágio, plano de ação, proposta, aceite, começo. */
  @Get(':token')
  estado(@Param('token') _token: string) {
    throw PENDENTE('o estado da sala');
  }

  /** O formulário de qualificação (tela 01). */
  @Post(':token/form')
  form(@Param('token') _token: string, @Body() _body: unknown) {
    throw PENDENTE('o formulário');
  }

  /** A escolha de horário entre os oferecidos (tela 01/02). */
  @Post(':token/agenda')
  agenda(@Param('token') _token: string, @Body() _body: unknown) {
    throw PENDENTE('a escolha de horário');
  }

  /** O arquivo opcional (tela 02: "deixe pronto um relatório de fechamento"). */
  @Post(':token/arquivo')
  arquivo(@Param('token') _token: string) {
    throw PENDENTE('o envio de arquivo');
  }

  /** Leitura rastreada por bloco (tela 07): o termômetro do follow-up. */
  @Post(':token/proposta/lida')
  propostaLida(@Param('token') _token: string, @Body() _body: unknown) {
    throw PENDENTE('a leitura da proposta');
  }

  /** "Tirar uma dúvida": o assistente responde só a partir da proposta e da ata (R0). */
  @Post(':token/proposta/duvida')
  duvida(@Param('token') _token: string, @Body() _body: unknown) {
    throw PENDENTE('a dúvida sobre a proposta');
  }

  /** "Pedir ajuste": cai na fila de decisões. */
  @Post(':token/proposta/ajuste')
  ajuste(@Param('token') _token: string, @Body() _body: unknown) {
    throw PENDENTE('o pedido de ajuste');
  }

  /** Tela 08, passo 1: os dados do contratante (vêm do CNPJ; o lead confere). */
  @Post(':token/aceite/dados')
  aceiteDados(@Param('token') _token: string, @Body() _body: unknown) {
    throw PENDENTE('os dados do aceite');
  }

  /** Tela 08, passo 2: aceitar a oferta e escolher a forma — gera a cobrança (lane D). */
  @Post(':token/aceite/pagamento')
  aceitePagamento(@Param('token') _token: string, @Body() _body: unknown) {
    throw PENDENTE('o aceite e o pagamento');
  }

  /** Tela 08, passo 3: o contrato para assinar (lane D). */
  @Post(':token/aceite/contrato')
  aceiteContrato(@Param('token') _token: string) {
    throw PENDENTE('o contrato do aceite');
  }

  /** O começo: o horário do kickoff. */
  @Post(':token/kickoff/horario')
  kickoff(@Param('token') _token: string, @Body() _body: unknown) {
    throw PENDENTE('o horário do kickoff');
  }
}
