import type { BotaoInterativo, EnvioFeito, FormularioInterativo, WhatsappPort } from './whatsapp.port';
import { ProvedorIndisponivelError } from './whatsapp.port';

/*
 * O PROVEDOR EVOLUTION — PENDENTE, e o motivo é uma catraca, não falta de tempo.
 *
 * O desenho da passagem previa este provedor entregando pelo
 * `TransporteDeCanalRegistry.entregar('whatsapp', destino, texto)`, o registro
 * em que a Evolution se inscreve. A catraca "mensagem de serviço do canal só
 * sai do canal" (`test/arquitetura.test.ts`) proíbe exatamente isso fora de
 * `src/gateway/canais/`: com o registro injetado, um serviço qualquer manda
 * texto arbitrário para número arbitrário pela instância da Root. Abrir exceção
 * na catraca seria afrouxar a régua; contornar o detector seria pior.
 *
 * E o transporte nem serviria inteiro: ele entrega só em conversa INDIVIDUAL
 * (o `jidDireto` do conector recusa grupo) e não expõe criar grupo.
 *
 * O CAMINHO CERTO, para quem pode mexer no conector: a Evolution inscrever ela
 * mesma o efeito de envio ao lead e o de grupo, no próprio
 * `pauta/evolution.service.ts`, como já faz com `whatsapp.mensagem.enviar`. A
 * C08 recomenda a Evolution só para grupos e avisos da mesa; o 1:1 com o lead é
 * a Cloud API, cujo custo a mesa ainda decide.
 *
 * Até lá: `configured = false`, e toda chamada lança com a frase abaixo. O
 * efeito da porta transforma isso em `falhou` na mensagem, com o motivo.
 */
export const EVOLUTION_PENDENTE =
  'envio pela Evolution: pendente. A Evolution só está ligada ao transporte de texto do canal de aprovação, ' +
  'e a catraca de arquitetura proíbe usá-lo fora de src/gateway/canais. Falta a Evolution inscrever o efeito ' +
  'de envio ao lead no próprio conector.';

export const EVOLUTION_GRUPO_PENDENTE =
  'criar grupo pela Evolution: pendente, a Evolution só está ligada ao transporte de texto.';

export class EvolutionProvider implements WhatsappPort {
  readonly provedor = 'evolution' as const;
  readonly configured = false;

  async enviarTexto(_destino: string, _texto: string): Promise<EnvioFeito> {
    throw new ProvedorIndisponivelError(EVOLUTION_PENDENTE);
  }

  async enviarFormulario(_destino: string, _texto: string, _formulario: FormularioInterativo): Promise<EnvioFeito> {
    throw new ProvedorIndisponivelError(EVOLUTION_PENDENTE);
  }

  async enviarBotoes(_destino: string, _texto: string, _botoes: BotaoInterativo[]): Promise<EnvioFeito> {
    throw new ProvedorIndisponivelError(EVOLUTION_PENDENTE);
  }

  async criarGrupo(_nome: string, _participantes: string[]): Promise<{ jid: string }> {
    throw new ProvedorIndisponivelError(EVOLUTION_GRUPO_PENDENTE);
  }

  async enviarNoGrupo(_jid: string, _texto: string): Promise<EnvioFeito> {
    throw new ProvedorIndisponivelError(EVOLUTION_GRUPO_PENDENTE);
  }
}
