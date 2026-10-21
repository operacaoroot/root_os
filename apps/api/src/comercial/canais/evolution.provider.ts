import { contextoAtual } from '../../common/contexto-execucao';
import { PREFIXO_DO_GRUPO_EVOLUTION, type EnvioPelaEvolution } from '../../gateway/canais/evolution.port';
import { normalizarTelefone } from '../eventos';
import { textoComBotoes, textoComFormulario } from './texto-numerado';
import type { BotaoInterativo, EnvioFeito, FormularioInterativo, WhatsappPort } from './whatsapp.port';
import { ProvedorIndisponivelError } from './whatsapp.port';

/*
 * O PROVEDOR EVOLUTION (`WHATSAPP_PROVEDOR=evolution`) — Rodada de produção 1,
 * 21/10/2026, P8.
 *
 * Até esta rodada ele era um esqueleto que lançava `EVOLUTION_PENDENTE`: a
 * catraca de arquitetura proíbe entregar pelo transporte do canal de aprovação
 * fora de `src/gateway/canais/`, e o transporte nem sabia criar grupo. O
 * caminho certo, que o próprio esqueleto descrevia, foi o que se fez: a
 * Evolution oferece, no próprio conector (`pauta/evolution.service.ts`, classe
 * `EvolutionDaEmpresaService`), o envio ao lead e o grupo, e este provedor só
 * TRADUZ, recebendo o conector pela porta `ENVIO_PELA_EVOLUTION`
 * (`gateway/canais/evolution.port.ts`), como o DigiSac. O transporte do canal
 * continua só do canal.
 *
 * Quem chama este provedor é só o EFEITO de `comercial.whatsapp.enviar` (R3):
 * o provedor é transporte, não régua. A capacidade e a porta não mudaram.
 *
 * BOTÕES E FORMULÁRIO VIRAM TEXTO NUMERADO (`texto-numerado.ts`, o mesmo do
 * DigiSac); a resposta numerada é lida na entrada (`evolution-entrada.service.ts`).
 *
 * GRUPO: a Evolution cria o grupo (`group/create`) e devolve o JID `@g.us`; o
 * jid que volta ao comercial leva o prefixo `evolution:` para o envio no grupo
 * recusar grupo que outro provedor criou (o do simulado, por exemplo).
 */

export const EVOLUTION_SEM_EMPRESA = 'envio pela Evolution sem empresa no contexto: nada foi enviado.';
export const EVOLUTION_SEM_CONECTOR = 'o conector da Evolution não está carregado nesta API: nada foi enviado.';
export const EVOLUTION_GRUPO_DE_OUTRO_PROVEDOR =
  'o grupo não foi criado pela Evolution (o jid não começa com evolution:): crie o grupo de novo com a Evolution configurada.';

export class EvolutionProvider implements WhatsappPort {
  readonly provedor = 'evolution' as const;
  readonly configured: boolean;

  constructor(private readonly envio: EnvioPelaEvolution | null = null) {
    this.configured = !!envio;
  }

  private orgId(): string {
    const id = contextoAtual()?.orgId;
    if (!id) throw new ProvedorIndisponivelError(EVOLUTION_SEM_EMPRESA);
    return id;
  }

  private exigirEnvio(): EnvioPelaEvolution {
    if (!this.envio) throw new ProvedorIndisponivelError(EVOLUTION_SEM_CONECTOR);
    return this.envio;
  }

  private async mandar(destino: string, texto: string): Promise<EnvioFeito> {
    const envio = this.exigirEnvio();
    const r = await envio.enviarAoNumero(this.orgId(), normalizarTelefone(destino), texto);
    return { mensagemExternaId: r.id, provedor: 'evolution' };
  }

  enviarTexto(destino: string, texto: string): Promise<EnvioFeito> {
    return this.mandar(destino, texto);
  }

  enviarFormulario(destino: string, texto: string, formulario: FormularioInterativo): Promise<EnvioFeito> {
    return this.mandar(destino, textoComFormulario(texto, formulario));
  }

  enviarBotoes(destino: string, texto: string, botoes: BotaoInterativo[]): Promise<EnvioFeito> {
    return this.mandar(destino, textoComBotoes(texto, botoes));
  }

  async criarGrupo(nome: string, participantes: string[]): Promise<{ jid: string }> {
    const envio = this.exigirEnvio();
    const r = await envio.abrirGrupo(this.orgId(), nome, participantes.map(normalizarTelefone));
    return { jid: `${PREFIXO_DO_GRUPO_EVOLUTION}${r.jid}` };
  }

  async enviarNoGrupo(jid: string, texto: string): Promise<EnvioFeito> {
    if (!jid.startsWith(PREFIXO_DO_GRUPO_EVOLUTION)) throw new ProvedorIndisponivelError(EVOLUTION_GRUPO_DE_OUTRO_PROVEDOR);
    const envio = this.exigirEnvio();
    const r = await envio.enviarAoGrupo(this.orgId(), jid.slice(PREFIXO_DO_GRUPO_EVOLUTION.length), texto);
    return { mensagemExternaId: r.id, provedor: 'evolution' };
  }
}
