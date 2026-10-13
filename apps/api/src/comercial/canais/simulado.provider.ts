import { randomUUID } from 'node:crypto';

import type { BotaoInterativo, EnvioFeito, EntradaDeWhatsapp, EventoDeEntrada, FormularioInterativo, WhatsappPort } from './whatsapp.port';

/*
 * O PROVEDOR SIMULADO — o padrão da homologação. Nada sai da máquina.
 *
 * O "celular" do lead é a própria tabela `ComercialMensagem`: a linha nasce em
 * `WhatsappComercialService.preparar` (com o formulário e os botões em
 * `interativo`), e o efeito da porta a marca `enviada` com o id que este
 * provedor devolve. Quem grava é o serviço, dentro do efeito; o provedor só
 * "entrega", e no simulado entregar é não sair da máquina. A tela
 * `/comercial/simulador` lê a tabela e mostra a conversa; o que o lead
 * "responde" entra pelo `SimuladorController`, pelo mesmo formato que um
 * webhook de provedor entraria (`receber`).
 *
 * O ENVIO CONTINUA PASSANDO PELA PORTA. O simulado não é atalho da régua: a
 * capacidade é R3 com qualquer provedor, e a homologação roda com um segundo
 * usuário com alçada para confirmar na fila. O que muda é só o destino final.
 */
export class SimuladoProvider implements WhatsappPort, EntradaDeWhatsapp {
  readonly provedor = 'simulado' as const;
  readonly configured = true;

  private feito(): EnvioFeito {
    return { mensagemExternaId: `sim-${randomUUID()}`, provedor: 'simulado' };
  }

  async enviarTexto(_destino: string, _texto: string): Promise<EnvioFeito> {
    return this.feito();
  }

  async enviarFormulario(_destino: string, _texto: string, _formulario: FormularioInterativo): Promise<EnvioFeito> {
    return this.feito();
  }

  async enviarBotoes(_destino: string, _texto: string, _botoes: BotaoInterativo[]): Promise<EnvioFeito> {
    return this.feito();
  }

  async criarGrupo(nome: string, _participantes: string[]): Promise<{ jid: string }> {
    const base =
      nome
        .toLowerCase()
        .normalize('NFD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 30) || 'grupo';
    return { jid: `sim-${base}-${randomUUID().slice(0, 8)}@g.us` };
  }

  async enviarNoGrupo(_jid: string, _texto: string): Promise<EnvioFeito> {
    return this.feito();
  }

  /** O que a tela do simulador manda: `{ telefone, texto, mensagemId?, formulario?, botao? }`. */
  receber(corpo: unknown): EventoDeEntrada | null {
    const c = (corpo ?? {}) as Record<string, unknown>;
    const telefone = typeof c.telefone === 'string' ? c.telefone : null;
    if (!telefone) return null;
    const texto = typeof c.texto === 'string' ? c.texto : '';
    const formulario = c.formulario && typeof c.formulario === 'object' ? (c.formulario as Record<string, unknown>) : undefined;
    const botao = typeof c.botao === 'string' ? c.botao : undefined;
    return {
      telefone,
      texto,
      mensagemId: typeof c.mensagemId === 'string' ? c.mensagemId : null,
      interativo: formulario || botao ? { formulario, botao } : null,
    };
  }
}
