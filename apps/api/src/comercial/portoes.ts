import {
  COMERCIAL_ETAPAS,
  COMERCIAL_ROTULO_DA_ETAPA,
  ehSaida,
  ordemDaEtapa,
  proximaEtapa,
  type ComercialEtapa,
  type ComercialEtapaAtiva,
  type ComercialPortaoNaTela,
} from '@mktos/shared';

/* ==========================================================================
 * OS PORTÕES DO FUNIL (C04/C07) — a parte pura, no modelo de `onboarding/trilho/fases.ts`
 * ==========================================================================
 *
 * Cada passagem de etapa tem um portão: sem os campos daquela etapa, o OS
 * RECUSA o avanço e devolve a lista EXATA do que falta, escrita para a tela
 * ("cada linha é uma coisa que uma pessoa ou um evento cumpre"). A lista é a
 * coluna "obrigatório a partir de" da seção C07 do mapa.
 *
 * Quem move a etapa é a REAÇÃO a um evento (`reacoes.service.ts`), nunca um
 * PATCH de tela. Desde a rodada do painel (P5, 18/10/2026) uma PESSOA pode
 * mover o cartão adiante com pendência, pela mudança de etapa aprovada (ver o
 * fim do arquivo): executa e avisa, para gente; o agente segue recusado aqui.
 * Este arquivo só responde "pode?" e "o que falta?". Ele não conhece banco nem Nest.
 *
 * LIÇÃO DO ESCRITÓRIO, escrita na C07: "a trava funciona quando o sistema
 * recusa, e falha quando só lembra". Por isso `avancar()` recusa; não avisa.
 */

/** O que o portão olha: a projeção mínima da ficha. Tudo opcional: é o que já foi cumprido. */
export interface EstadoParaPortao {
  etapa: ComercialEtapa;
  nome?: string | null;
  telefone?: string | null;
  canal?: string | null;
  origemIndicacao?: string | null;
  perfil?: string | null;
  donoId?: string | null;
  sistemaErp?: string | null;
  baseDados?: boolean | null;
  produto?: string | null;
  /** E3: a reunião marcada (data e hora) e a confirmação enviada. */
  reuniaoEm?: string | Date | null;
  confirmacaoEnviadaEm?: string | Date | null;
  /** E4: a ata vinculada e a rota decidida. */
  ataHash?: string | null;
  rota?: 'diagnostico' | 'proposta_direta' | null;
  socioDaConta?: string | null;
  /** E5: o diagnóstico aprovado por sócio (ou liberado pela regra). */
  diagnosticoAprovadoEm?: string | Date | null;
  /** E6: a proposta publicada com tudo o que o portão pede. */
  valorCentavos?: number | null;
  parcelas?: number | null;
  forma?: string | null;
  quadroDeCustos?: boolean | null;
  validade?: string | Date | null;
  laudoDoRevisorOk?: boolean | null;
  /** E7: resposta do cliente (aceite) ou saída com motivo. */
  propostaAceitaEm?: string | Date | null;
  /** E8: o cadastro que a minuta consome e o contrato assinado pelos dois. */
  cnpj?: string | null;
  endereco?: string | null;
  quemAssina?: string | null;
  emailDeQuemAssina?: string | null;
  contratoAssinadoClienteEm?: string | Date | null;
  contratoAssinadoRootEm?: string | Date | null;
  /** E9: a cobrança configurada. */
  cobrancaCriadaEm?: string | Date | null;
}

const vazio = (v: unknown): boolean => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

interface Portao {
  chave: string;
  rotulo: string;
  cumprido: (e: EstadoParaPortao) => boolean;
}

/**
 * Os portões DE SAÍDA de cada etapa ativa (C04, "portão de saída"). A chave é
 * estável (a tela e o teste a usam); o rótulo é o que a pessoa lê.
 */
export const PORTOES_DA_ETAPA: Record<ComercialEtapaAtiva, readonly Portao[]> = {
  novo_lead: [
    { chave: 'nome', rotulo: 'nome do contato', cumprido: (e) => !vazio(e.nome) },
    { chave: 'whatsapp', rotulo: 'WhatsApp do contato', cumprido: (e) => !vazio(e.telefone) },
    { chave: 'canal', rotulo: 'canal de entrada', cumprido: (e) => !vazio(e.canal) },
    {
      chave: 'origem_indicacao',
      rotulo: 'origem da indicação (canal = indicação)',
      cumprido: (e) => e.canal !== 'indicacao' || !vazio(e.origemIndicacao),
    },
    { chave: 'perfil', rotulo: 'perfil P1, P2 ou P3 pontuado', cumprido: (e) => !vazio(e.perfil) },
    { chave: 'dono', rotulo: 'dono do lead', cumprido: (e) => !vazio(e.donoId) },
  ],
  qualificacao: [
    { chave: 'perfil_confirmado', rotulo: 'perfil confirmado', cumprido: (e) => !vazio(e.perfil) },
    { chave: 'sistema', rotulo: 'sistema ou ERP em uso', cumprido: (e) => !vazio(e.sistemaErp) },
    { chave: 'base', rotulo: 'base de dados: sim ou não', cumprido: (e) => typeof e.baseDados === 'boolean' },
    { chave: 'produto_alvo', rotulo: 'produto-alvo proposto', cumprido: (e) => !vazio(e.produto) },
  ],
  reuniao_agendada: [
    { chave: 'reuniao', rotulo: 'evento na agenda com data e hora', cumprido: (e) => !vazio(e.reuniaoEm) },
    { chave: 'confirmacao', rotulo: 'confirmação de véspera enviada', cumprido: (e) => !vazio(e.confirmacaoEnviadaEm) },
  ],
  sessao: [
    { chave: 'ata', rotulo: 'ata vinculada ao lead', cumprido: (e) => !vazio(e.ataHash) },
    { chave: 'rota', rotulo: 'rota definida (diagnóstico ou proposta direta)', cumprido: (e) => !vazio(e.rota) },
    { chave: 'socio_da_conta', rotulo: 'sócio da conta (quem conduziu a sessão)', cumprido: (e) => !vazio(e.socioDaConta) },
  ],
  diagnostico: [
    { chave: 'diagnostico_aprovado', rotulo: 'diagnóstico aprovado por sócio', cumprido: (e) => !vazio(e.diagnosticoAprovadoEm) },
  ],
  proposta: [
    { chave: 'produto', rotulo: 'produto', cumprido: (e) => !vazio(e.produto) },
    { chave: 'valor', rotulo: 'valor integral', cumprido: (e) => typeof e.valorCentavos === 'number' && e.valorCentavos > 0 },
    { chave: 'parcelas', rotulo: 'parcelas', cumprido: (e) => typeof e.parcelas === 'number' && e.parcelas > 0 },
    { chave: 'quadro_de_custos', rotulo: 'quadro de custos de terceiros', cumprido: (e) => e.quadroDeCustos === true },
    { chave: 'validade', rotulo: 'validade escrita', cumprido: (e) => !vazio(e.validade) },
    { chave: 'laudo', rotulo: 'laudo do revisor limpo', cumprido: (e) => e.laudoDoRevisorOk === true },
  ],
  follow_up: [
    { chave: 'resposta', rotulo: 'resposta do cliente (aceite) ou saída com motivo', cumprido: (e) => !vazio(e.propostaAceitaEm) },
  ],
  contrato: [
    { chave: 'cnpj', rotulo: 'CNPJ ou CPF do contratante', cumprido: (e) => !vazio(e.cnpj) },
    { chave: 'endereco', rotulo: 'endereço', cumprido: (e) => !vazio(e.endereco) },
    { chave: 'quem_assina', rotulo: 'qualificação de quem assina', cumprido: (e) => !vazio(e.quemAssina) && !vazio(e.emailDeQuemAssina) },
    { chave: 'assinado_cliente', rotulo: 'contrato assinado pelo cliente', cumprido: (e) => !vazio(e.contratoAssinadoClienteEm) },
    { chave: 'assinado_root', rotulo: 'contrato assinado pela Root', cumprido: (e) => !vazio(e.contratoAssinadoRootEm) },
    { chave: 'cobranca', rotulo: 'cobrança configurada', cumprido: (e) => !vazio(e.cobrancaCriadaEm) },
  ],
  // E9 é terminal: não há portão de saída. Quem sai daqui é o contrato vivo.
  fechado: [],
};

/** O que falta para SAIR da etapa atual. Vazio = pode avançar. Saída e E9 não avançam. */
export function faltaParaSair(e: EstadoParaPortao): string[] {
  if (ehSaida(e.etapa)) return [`lead em saída (${COMERCIAL_ROTULO_DA_ETAPA[e.etapa]}) não avança: reabra com motivo`];
  if (e.etapa === 'fechado') return ['negócio fechado é etapa final'];
  return PORTOES_DA_ETAPA[e.etapa].filter((p) => !p.cumprido(e)).map((p) => p.rotulo);
}

/** Os portões da etapa, um a um, para a tela desenhar (cumprido ou não). */
export function portoesDaEtapa(e: EstadoParaPortao): ComercialPortaoNaTela[] {
  if (ehSaida(e.etapa) || e.etapa === 'fechado') return [];
  return PORTOES_DA_ETAPA[e.etapa].map((p) => ({ chave: p.chave, rotulo: p.rotulo, cumprido: p.cumprido(e) }));
}

export interface Veredicto {
  ok: boolean;
  de: ComercialEtapa;
  para: ComercialEtapa | null;
  faltando: string[];
}

/**
 * Pode ir de `e.etapa` para `para`?
 *
 * Só avança UM passo, e só com o portão da etapa atual cumprido. Pular etapa é
 * recusado com o motivo escrito; voltar é recusado (quem volta é a saída com
 * motivo, e a geladeira volta pela reação do relógio, não por aqui). Sem
 * `para`, pergunta pela próxima.
 */
export function avancar(e: EstadoParaPortao, para?: ComercialEtapaAtiva): Veredicto {
  const proxima = proximaEtapa(e.etapa);
  const alvo = para ?? proxima;
  if (!alvo) return { ok: false, de: e.etapa, para: null, faltando: faltaParaSair(e) };
  if (ehSaida(e.etapa)) return { ok: false, de: e.etapa, para: alvo, faltando: faltaParaSair(e) };

  const ordemDe = ordemDaEtapa(e.etapa) ?? 0;
  const ordemPara = ordemDaEtapa(alvo) ?? 0;
  if (ordemPara <= ordemDe) {
    return { ok: false, de: e.etapa, para: alvo, faltando: [`voltar de ${COMERCIAL_ROTULO_DA_ETAPA[e.etapa]} para ${COMERCIAL_ROTULO_DA_ETAPA[alvo]} não é avanço: registre uma saída com motivo`] };
  }
  if (ordemPara !== ordemDe + 1) {
    const puladas = COMERCIAL_ETAPAS.slice(ordemDe, ordemPara - 1).map((x) => COMERCIAL_ROTULO_DA_ETAPA[x]);
    return { ok: false, de: e.etapa, para: alvo, faltando: [`não se pula etapa: ${puladas.join(', ')} ${puladas.length === 1 ? 'fica' : 'ficam'} no meio`] };
  }
  const faltando = faltaParaSair(e);
  return { ok: faltando.length === 0, de: e.etapa, para: alvo, faltando };
}

/**
 * A rota depois da sessão decide o próximo passo: `proposta_direta` pula o
 * diagnóstico DE PROPÓSITO (C04, E4: "rota definida: diagnóstico ou proposta
 * direta"). É a única exceção ao "um passo", e ela só existe aqui, nomeada.
 */
export function avancarDepoisDaSessao(e: EstadoParaPortao): Veredicto {
  if (e.etapa !== 'sessao') return avancar(e);
  const faltando = faltaParaSair(e);
  if (faltando.length) return { ok: false, de: e.etapa, para: null, faltando };
  const alvo: ComercialEtapaAtiva = e.rota === 'proposta_direta' ? 'proposta' : 'diagnostico';
  return { ok: true, de: e.etapa, para: alvo, faltando: [] };
}

/** Saída é sempre possível de etapa ativa; de saída para saída só a geladeira muda (volta ou perde). */
export function podeSair(de: ComercialEtapa, saida: ComercialEtapa): { ok: boolean; motivo: string | null } {
  if (!ehSaida(saida)) return { ok: false, motivo: `${saida} não é uma saída` };
  if (de === 'fechado') return { ok: false, motivo: 'negócio fechado não sai pelo funil: é o contrato vivo que encerra' };
  if (ehSaida(de) && de !== 'geladeira') return { ok: false, motivo: `lead já está em ${COMERCIAL_ROTULO_DA_ETAPA[de]}` };
  return { ok: true, motivo: null };
}

/** A geladeira volta para a etapa em que estava quando saiu (gravada na saída). */
export function etapaDeVolta(etapaAntesDaSaida: string | null | undefined): ComercialEtapaAtiva {
  const e = String(etapaAntesDaSaida ?? '');
  return (COMERCIAL_ETAPAS as readonly string[]).includes(e) ? (e as ComercialEtapaAtiva) : 'qualificacao';
}

/* ==========================================================================
 * MOVER COM PENDÊNCIA (rodada do painel P5, 18/10/2026) — só para GENTE
 * ==========================================================================
 *
 * Uma pessoa pode mover o cartão adiante com portão em aberto: a mudança
 * EXECUTA e o cartão ganha um balão com a lista exata do que falta. O agente
 * não passa por aqui: as reações continuam em `avancar`, que recusa. Quem
 * decide se o destino é possível é `destinoDoMover` (shared); este arquivo só
 * diz O QUE FICOU PARA TRÁS.
 */

/** O rótulo curto da etapa ("E2") para a linha da pendência. */
const curtoDaEtapa = (e: ComercialEtapa): string => COMERCIAL_ROTULO_DA_ETAPA[e].split(' · ')[0];

/**
 * As etapas cujo portão de saída a pessoa atravessa indo de `de` a `para`: de
 * `de` (inclusive) até a anterior a `para`. Com a rota de proposta direta, o
 * diagnóstico não é etapa do caminho e fica de fora (C04, E4).
 */
export function etapasAtravessadas(e: EstadoParaPortao, de: ComercialEtapa, para: ComercialEtapa): ComercialEtapaAtiva[] {
  const ordemDe = ordemDaEtapa(de);
  const ordemPara = ordemDaEtapa(para);
  if (!ordemDe || !ordemPara || ordemPara <= ordemDe) return [];
  return COMERCIAL_ETAPAS.slice(ordemDe - 1, ordemPara - 1).filter((s) => !(s === 'diagnostico' && s !== de && e.rota === 'proposta_direta'));
}

/** O que falta, hoje, nos portões das etapas `atravessadas`, escrito para a tela ("sistema ou ERP em uso (E2)"). Sem repetição. */
export function pendenciasDasEtapas(e: EstadoParaPortao, atravessadas: readonly ComercialEtapa[]): string[] {
  const linhas: string[] = [];
  for (const s of atravessadas) {
    if (ehSaida(s) || s === 'fechado') continue;
    for (const p of PORTOES_DA_ETAPA[s]) {
      if (p.cumprido({ ...e, etapa: s })) continue;
      const linha = `${p.rotulo} (${curtoDaEtapa(s)})`;
      if (!linhas.includes(linha)) linhas.push(linha);
    }
  }
  return linhas;
}

/** O mover de uma pessoa: as etapas atravessadas e o que falta nelas agora. Lista vazia = sem balão. */
export function pendenciasDoMover(e: EstadoParaPortao, de: ComercialEtapa, para: ComercialEtapa): { atravessadas: ComercialEtapaAtiva[]; pendencias: string[] } {
  const atravessadas = etapasAtravessadas(e, de, para);
  return { atravessadas, pendencias: pendenciasDasEtapas(e, atravessadas) };
}

/**
 * O BALÃO, calculado ao projetar: das etapas que alguma pessoa atravessou com
 * pendência, as que ainda estão ATRÁS da etapa atual, e o que os portões delas
 * pedem hoje. Sanou, a linha some; zerou, o balão some. Lead em saída ou
 * fechado não tem balão (saiu do funil ativo; o fechamento tem as próprias
 * pré-condições).
 */
export function pendenciasQueRestam(e: EstadoParaPortao, atravessadasPorPessoas: readonly string[]): string[] {
  if (ehSaida(e.etapa) || e.etapa === 'fechado') return [];
  const atual = ordemDaEtapa(e.etapa) ?? 0;
  const atras = COMERCIAL_ETAPAS.filter((s) => atravessadasPorPessoas.includes(s) && (ordemDaEtapa(s) ?? 0) < atual);
  return pendenciasDasEtapas(e, atras);
}
