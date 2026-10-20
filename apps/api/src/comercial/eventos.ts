import { createHash } from 'node:crypto';
import {
  COMERCIAL_EVENTOS,
  ehEventoComercial,
  type ComercialEvento,
  type ComercialFonte,
  type LinhaDoFio,
} from '@mktos/shared';

import { rotuloDoHorario } from './agenda-de-homologacao';

/*
 * O FIO DO LEAD — a parte pura dos eventos do comercial (Lane 0).
 *
 * Todo fato do comercial é um `LeadEvent` com `type` do catálogo
 * `COMERCIAL_EVENTOS` e id DERIVADO: a mesma chave de idempotência cai no mesmo
 * id, e a chave primária do banco é o que impede a duplicata — a mesma
 * construção de `leads/entrada-de-lead.ts`. Quem repete um webhook, um clique
 * ou uma passagem do relógio não cria um segundo fato.
 *
 * Sem banco e sem Nest: a suíte mede tudo isto sem subir nada.
 */

/** UUID determinístico, a mesma construção de `leads/entrada-de-lead.ts`. */
export function uuidDe(partes: string[]): string {
  const bytes = createHash('sha256').update(partes.join('\0')).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** JSON canônico (chaves ordenadas, `undefined` fora) — a ordem das chaves não muda o hash. */
export function canonico(valor: unknown): string {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor ?? null);
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  const obj = valor as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonico(obj[k])}`)
    .join(',')}}`;
}

export function hashDoConteudo(valor: unknown): string {
  return createHash('sha256').update(canonico(valor)).digest('hex');
}

/**
 * O id de um evento do comercial.
 *
 * `chave` é a identidade do FATO, escolhida por quem grava: o id da mensagem no
 * provedor, o `(versao)` da proposta, o `(parcela, vencimento)` da cobrança, o
 * dia da passagem do relógio. Dois pedidos com a mesma chave são o mesmo fato.
 */
export function eventoIdComercial(orgId: string, leadId: string, type: ComercialEvento, chave: string): string {
  return uuidDe([orgId, 'comercial-evento', leadId, type, chave]);
}

/** O id de uma reação a um evento: `(eventoId, reacao)` é único. */
export function reacaoId(eventoId: string, reacao: string): string {
  return uuidDe(['comercial-reacao', eventoId, reacao]);
}

/** O id do lead que entra pelo WhatsApp: o telefone normalizado é a origem. */
export function leadIdDoTelefone(orgId: string, telefone: string): string {
  return uuidDe([orgId, 'lead', 'whatsapp', normalizarTelefone(telefone)]);
}

/** Só dígitos, com o DDI do Brasil quando vier sem. */
export function normalizarTelefone(telefone: string): string {
  const digitos = String(telefone ?? '').replace(/\D/g, '');
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  return digitos;
}

/** A fonte de cada tipo de evento (a etiqueta da linha do fio, tela 05). */
export const FONTE_DO_EVENTO: Record<ComercialEvento, ComercialFonte> = {
  'lead.chegou': 'whats',
  'cnpj.enriquecido': 'agente',
  'lead.pontuado': 'agente',
  'dono.atribuido': 'agente',
  'whats.recebida': 'whats',
  'whats.enviada': 'whats',
  'form.respondido': 'form',
  'agenda.escolhida': 'agenda',
  'agenda.confirmada': 'agenda',
  'reuniao.noshow': 'agenda',
  'sala.aberta': 'sala',
  'sala.visitada': 'sala',
  'sala.publicada': 'pessoa',
  'arquivo.enviado': 'sala',
  'ata.chegou': 'ata',
  'diagnostico.pronto': 'agente',
  'proposta.publicada': 'agente',
  'proposta.lida': 'sala',
  'proposta.duvida': 'sala',
  'proposta.ajuste_pedido': 'sala',
  'proposta.aceita': 'sala',
  'proposta.reagida': 'sala',
  'proposta.ideia': 'sala',
  'followup.enviado': 'whats',
  'aceite.dados': 'sala',
  'cobranca.criada': 'asaas',
  'pix.pago': 'asaas',
  'boleto.pago': 'asaas',
  'cartao.pago': 'asaas',
  'contrato.gerado': 'zapsign',
  'contrato.assinado_cliente': 'zapsign',
  'contrato.assinado_root': 'zapsign',
  'aceite.declarado': 'pessoa',
  'contrato.anexado': 'pessoa',
  'fechamento.escrita': 'sistema',
  'cliente.ativo': 'sistema',
  'implantacao.card_criado': 'sistema',
  'implantacao.iniciada_antes_do_fechamento': 'pessoa',
  'implantacao.fechamento_registrado': 'sistema',
  'cliente.a_conciliar': 'sistema',
  'kickoff.marcado': 'sala',
  'parcela.vence': 'relogio',
  'parcela.paga': 'asaas',
  'parcela.atrasada': 'relogio',
  'parcela.estornada': 'asaas',
  'marco.contrato': 'relogio',
  'contrato.concluido': 'pessoa',
  'contrato.desativado': 'pessoa',
  'decisao.aberta': 'decisao',
  'decisao.tomada': 'pessoa',
  'decisao.expirada': 'relogio',
  'veto.registrado': 'pessoa',
  'etapa.mudou': 'sistema',
  'etapa.movida_com_pendencia': 'pessoa',
  'etapa.movida_a_mao': 'pessoa',
  'saida.registrada': 'pessoa',
  'vigia.premissa': 'relogio',
};

/** Os payloads esperados por tipo. Só o que a projeção lê; o resto é livre. */
export interface PayloadsComerciais {
  'lead.chegou': { telefone: string; texto: string; canal?: string | null; palavraChave?: string | null; nome?: string | null };
  'cnpj.enriquecido': { cnpj: string; razaoSocial?: string | null; cidade?: string | null; funcionarios?: number | null; endereco?: string | null; fonte: string };
  'lead.pontuado': { pontuacao: number; perfil: 'P1' | 'P2' | 'P3' | null; criterios: Record<string, number | boolean | string | null> };
  'dono.atribuido': { donoId: string | null; donoNome: string | null; regra: string };
  'whats.recebida': { texto: string; mensagemId?: string | null; provedor: string };
  'whats.enviada': { template: string | null; texto: string; provedor: string; mensagemDbId?: string | null; aprovadaPor?: string | null };
  'form.respondido': { sistema: string; baseOrganizada: boolean; maiorDor: string; equipeFinanceiro: number; nome?: string | null; empresa?: string | null; cnpj?: string | null };
  'agenda.escolhida': { horario: string; oferecidos: string[] };
  'agenda.confirmada': { horario: string; via: string };
  'reuniao.noshow': { horario: string; tipo: 'remarcou' | 'sumiu' | 'cancelou' };
  'sala.aberta': { salaId: string; slug: string; validoAte: string };
  'sala.visitada': { salaId: string; estagio: string };
  'sala.publicada': { versao: number; hash: string; liberadaPor?: string | null };
  'arquivo.enviado': { nome: string; bytes: number; tipo: string };
  /** `por`: o nome de quem conduziu a sessão e subiu a ata (vira o sócio da conta). Acréscimo da lane A. */
  'ata.chegou': { hash: string; caracteres: number; fonte: string; referencia?: string | null; por?: string | null; porId?: string | null };
  /** `aprovadoEm`/`aprovadoPor`: o diagnóstico aprovado por sócio (portão de E5) é o MESMO evento gravado de novo com outra chave. Acréscimo da lane A. */
  'diagnostico.pronto': { dores: { n: number; texto: string; minuto: string | null; trecho?: string | null }[]; objecoes: string[]; produtoSugerido: string | null; modelo: string; custoUsd: number; custoDesconhecido: boolean; aprovadoEm?: string | null; aprovadoPor?: string | null };
  /** `quadroDeCustos`: o quadro de custos de terceiros (portão de E6). Sem ele o portão recusa. Acréscimo da lane A. */
  'proposta.publicada': { versao: number; produto: string; valorCentavos: number; parcelas: number; parcelaCentavos: number; formas: string[]; validaAte: string | null; dentroDaTabela: boolean; laudo: { ok: boolean; apontamentos: string[] }; descontoPct?: number | null; hash: string; quadroDeCustos?: { mesNormalCentavos: number | null; piorMesCentavos: number | null } | null };
  /** `secao`: a seção da página da proposta (I4) que registrou a leitura do bloco; ausente quando veio da sala. */
  'proposta.lida': { versao: number; bloco: string; visita: number; secao?: string | null };
  /** `secao`: quando a dúvida veio da barra de reação da página da proposta (I4). */
  'proposta.duvida': { versao: number; pergunta: string; resposta?: string | null; secao?: string | null };
  'proposta.ajuste_pedido': { versao: number; pedido: string; descontoPct?: number | null; decisaoId?: string | null };
  'proposta.aceita': { versao: number; produto: string; valorCentavos: number; parcelas: number; forma: string; hash: string };
  /** I4: "faz sentido" numa seção, um por visita. Só a seção e a visita: o fato não carrega texto. */
  'proposta.reagida': { versao: number; secao: string; reacao: 'faz_sentido'; visita: number; reacaoId: string };
  /** I4: a ideia anotada pelo cliente, já mascarada. Texto de cliente: dado, nunca instrução. */
  'proposta.ideia': { versao: number; secao: string; texto: string; visita: number; reacaoId: string };
  'followup.enviado': { qual: 'M5' | 'M6'; versao: number; mensagemDbId?: string | null };
  'aceite.dados': { cnpj: string; razaoSocial: string; endereco: string; quemAssina: string; email: string };
  'cobranca.criada': { provedor: string; externoId: string; parcelas: number; forma: string; valorCentavos: number; primeiraVence: string };
  'pix.pago': { provedor: string; externoId: string; parcela: number; valorCentavos: number; pagoEm: string };
  /** D-10: a 1ª parcela paga por boleto ou cartão tem o nome da forma; o payload é o do Pix. */
  'boleto.pago': { provedor: string; externoId: string; parcela: number; valorCentavos: number; pagoEm: string };
  'cartao.pago': { provedor: string; externoId: string; parcela: number; valorCentavos: number; pagoEm: string };
  'contrato.gerado': { provedor: string; externoId: string; hash: string };
  'contrato.assinado_cliente': { provedor: string; externoId: string; em: string };
  'contrato.assinado_root': { provedor: string; externoId: string; em: string; por?: string | null };
  /**
   * T1b: o aceite que uma PESSOA declarou para quem fechou fora do sistema. Nunca é o aceite do cliente
   * na sala: a procedência vai escrita. `hash` cobre tudo isto e o PDF anexado (é o que a titular assina).
   */
  'aceite.declarado': {
    versao: number;
    hash: string;
    produto: string;
    valorCentavos: number;
    parcelas: number;
    forma: string;
    cnpj: string;
    razaoSocial: string;
    endereco: string;
    quemAssina: string;
    email: string;
    assinadoEm: string;
    primeiroVencimento: string;
    criarCobranca: boolean;
    motivoSemCobranca: string | null;
    arquivoSha256: string;
    procedencia: string;
    por: string | null;
    porId: string;
  };
  /** T1b: o contrato já assinado, anexado em PDF (guardado no storage pela chave, nunca o conteúdo no fio). */
  'contrato.anexado': { nome: string; bytes: number; tipo: string; sha256: string; chave: string; assinadoEm: string; procedencia: string; por: string | null };
  'fechamento.escrita': { chave: string; escrita: string; estado: string; ref?: string | null; ms?: number | null };
  'cliente.ativo': { chave: string; partnerId?: string | null; contractId?: string | null; trilhoId?: string | null };
  'implantacao.card_criado': { chave: string; cardId: string; listId: string; lista: string; etapa: string };
  /** A2: uma pessoa abriu o card da implantação com o lead ainda no funil (`etapaDoLead` é a do funil). */
  'implantacao.iniciada_antes_do_fechamento': { cardId: string; listId: string; lista: string; etapa: string; etapaDoLead: string; trilhoId: string | null; partnerId: string | null; por: string | null; porId: string };
  /** A2: o fechamento reaproveitou o card iniciado antes dele e registrou o fechamento no card. */
  'implantacao.fechamento_registrado': { chave: string; cardId: string };
  /** Revisão A2: o Partner da ficha não conferia com o CNPJ do aceite; o fechamento ficou com outro e avisa. */
  'cliente.a_conciliar': { chave: string; partnerDaFicha: string; partnerDoFechamento: string; motivo: string };
  'kickoff.marcado': { horario: string };
  'parcela.vence': { parcela: number; vence: string; aviso: 'D-3' | 'D0' | 'D+1' | 'D+5' | 'D+10' };
  'parcela.paga': { parcela: number; pagoEm: string; valorCentavos: number };
  'parcela.atrasada': { parcela: number; vence: string; dias: number };
  /** D-10: estorno ou chargeback no provedor. A parcela volta a não paga; `evento` é o nome cru do provedor. */
  'parcela.estornada': { parcela: number; externoId: string; evento: string; em: string; valorCentavos: number };
  'marco.contrato': { marco: 'dia_15_indicacao' | 'd_30_continuidade' | 'primeiro_valor'; quando: string };
  'contrato.concluido': { motivo: string; por: string; porNome: string | null; parcelasEmAberto: number; nivel: string };
  'contrato.desativado': { motivo: string; por: string; porNome: string | null; parcelasEmAberto: number; nivel: string };
  'decisao.aberta': { decisaoId: string; tipo: string; padrao: string; expiraEm: string };
  'decisao.tomada': { decisaoId: string; tipo: string; escolha: string; por: string | null; canal: string };
  'decisao.expirada': { decisaoId: string; tipo: string; padraoAplicado: string };
  'veto.registrado': { sobre: string; por: string | null; canal: string };
  'etapa.mudou': { de: string; para: string; motivo: string; eventoGatilho?: string | null };
  /** P5: uma pessoa moveu o cartão com portão em aberto. `pendencias` é a lista exata do momento; `atravessadas`, as etapas cujo portão ficou para trás. */
  'etapa.movida_com_pendencia': { de: string; para: string; pendencias: string[]; atravessadas: string[]; por: string | null; porId: string | null };
  /** U4 (20/10/2026): uma PESSOA moveu o cartão à mão, para qualquer etapa. `pendencias` e `atravessadas` só quando ficou portão para trás; `motivo` só na saída. */
  'etapa.movida_a_mao': { de: string; para: string; pendencias: string[]; atravessadas: string[]; por: string | null; porId: string | null; motivo?: string | null; semMotivo?: boolean };
  'saida.registrada': { saida: string; motivo: string; detalhe?: string | null; voltaEm?: string | null; parceiro?: string | null; por: string | null };
  'vigia.premissa': { automacao: string; premissa: string; ok: boolean; detalhe?: string | null };
}

export type PayloadDe<T extends ComercialEvento> = PayloadsComerciais[T];

/** Um evento pronto para gravar: id derivado, tipo do catálogo, payload tipado. */
export interface EventoParaGravar<T extends ComercialEvento = ComercialEvento> {
  id: string;
  leadId: string;
  type: T;
  payload: PayloadDe<T>;
  occurredAt?: Date;
}

export function montarEvento<T extends ComercialEvento>(
  orgId: string,
  leadId: string,
  type: T,
  chave: string,
  payload: PayloadDe<T>,
  occurredAt?: Date,
): EventoParaGravar<T> {
  return { id: eventoIdComercial(orgId, leadId, type, chave), leadId, type, payload, occurredAt };
}

function reais(c: number): string {
  const inteiro = Math.trunc(Math.abs(c) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${inteiro},${(Math.abs(c) % 100).toString().padStart(2, '0')}`;
}

/**
 * O horário de agenda como a tela 05 mostra ("qui 16/10 · 10h", em São Paulo).
 * Texto que não é data volta como veio: o fio nunca inventa um horário.
 */
export function horarioLegivel(iso: unknown): string {
  const t = String(iso ?? '');
  if (!t || Number.isNaN(new Date(t).getTime())) return t;
  const r = rotuloDoHorario(t);
  return r.charAt(0).toLowerCase() + r.slice(1);
}

function curto(s: unknown, max = 90): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * A linha do fio para um evento — o RESUMO legível que a tela 05 mostra.
 *
 * Nunca inventa: o que não está no payload não aparece. Evento de tipo
 * desconhecido (os antigos: `entrada`, `status_change`, `dono`, os da proposta
 * do ROOT-49) vira linha com fonte `sistema` e o próprio tipo como resumo.
 */
export function resumoDoEvento(type: string, payload: unknown): { fonte: ComercialFonte; resumo: string } {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (!ehEventoComercial(type)) {
    if (type === 'entrada') return { fonte: 'sistema', resumo: 'entrada registrada' };
    if (type === 'status_change') return { fonte: 'sistema', resumo: `status ${String(p.from ?? '?')} → ${String(p.to ?? '?')}` };
    if (type === 'dono') return { fonte: 'pessoa', resumo: 'troca de dono' };
    return { fonte: 'sistema', resumo: type };
  }
  const fonte = FONTE_DO_EVENTO[type];
  switch (type) {
    case 'lead.chegou':
      return { fonte, resumo: `${p.texto ? `“${curto(p.texto, 70)}”` : 'lead chegou pelo WhatsApp'}${p.palavraChave ? ` · palavra-chave ${String(p.palavraChave)}` : ''}` };
    case 'cnpj.enriquecido':
      return { fonte, resumo: `CNPJ conferido${p.razaoSocial ? ` · ${curto(p.razaoSocial, 50)}` : ''}${p.funcionarios ? ` · ${String(p.funcionarios)} funcionários` : ''}` };
    case 'lead.pontuado':
      return { fonte, resumo: `pontuado ${String(p.pontuacao)}${p.perfil ? ` · ${String(p.perfil)}` : ''}` };
    case 'dono.atribuido':
      return { fonte, resumo: `dono: ${String(p.donoNome ?? 'agente qualificador')}` };
    case 'whats.recebida':
      return { fonte, resumo: p.texto ? `“${curto(p.texto, 80)}”` : 'mensagem recebida' };
    case 'whats.enviada':
      return { fonte, resumo: `${p.template ? `${String(p.template)} enviada` : 'mensagem enviada'}${p.aprovadaPor ? ` · liberada por ${String(p.aprovadaPor)}` : ''}` };
    case 'form.respondido':
      return { fonte, resumo: `4 respostas · ${curto(p.sistema, 30)} · base ${p.baseOrganizada ? 'organizada' : 'solta'}` };
    case 'agenda.escolhida':
      return { fonte, resumo: p.horario ? `escolheu ${horarioLegivel(p.horario)}` : 'escolheu um horário' };
    case 'agenda.confirmada':
      return { fonte, resumo: `confirmação de véspera (${String(p.via)})` };
    case 'reuniao.noshow':
      return { fonte, resumo: `no-show: ${String(p.tipo)}` };
    case 'sala.aberta':
      return { fonte, resumo: `sala criada (/s/…)` };
    case 'sala.visitada':
      return { fonte, resumo: `visitou a sala · ${String(p.estagio)}` };
    case 'sala.publicada':
      return { fonte, resumo: `sala publicada · versão ${String(p.versao)} no ar para o cliente` };
    case 'arquivo.enviado':
      return { fonte, resumo: `enviou ${curto(p.nome, 40)}` };
    case 'ata.chegou': {
      // O tamanho só aparece quando o fato o traz como número: "undefined caracteres" nunca vai à tela.
      const partes = ['ata recebida'];
      if (typeof p.caracteres === 'number' && Number.isFinite(p.caracteres)) partes.push(`${p.caracteres.toLocaleString('pt-BR')} caracteres`);
      if (p.fonte) partes.push(String(p.fonte));
      return { fonte, resumo: partes.join(' · ') };
    }
    case 'diagnostico.pronto': {
      const dores = Array.isArray(p.dores) ? p.dores.length : 0;
      return { fonte, resumo: `diagnóstico: ${dores} ${dores === 1 ? 'dor' : 'dores'} com minuto` };
    }
    case 'proposta.publicada':
      return { fonte, resumo: `proposta v${String(p.versao)} publicada na sala (${p.dentroDaTabela ? 'dentro' : 'fora'} da tabela) · ${reais(Number(p.valorCentavos ?? 0))}` };
    case 'proposta.lida':
      return { fonte, resumo: `proposta v${String(p.versao)} lida · bloco ${String(p.bloco)}${p.secao ? ` · seção ${String(p.secao)}` : ''}` };
    case 'proposta.duvida':
      return { fonte, resumo: `dúvida${p.secao ? ` em ${String(p.secao)}` : ''}: “${curto(p.pergunta, 60)}”` };
    case 'proposta.reagida':
      return { fonte, resumo: `proposta v${String(p.versao)} · “faz sentido” em ${String(p.secao)}` };
    case 'proposta.ideia':
      return { fonte, resumo: `ideia em ${String(p.secao)}: “${curto(p.texto, 60)}”` };
    case 'proposta.ajuste_pedido':
      return { fonte, resumo: `pediu ajuste${p.descontoPct ? ` (${String(p.descontoPct)}%)` : ''} → fila de decisões` };
    case 'proposta.aceita':
      return { fonte, resumo: `aceitou v${String(p.versao)} · ${reais(Number(p.valorCentavos ?? 0))} em ${String(p.parcelas)}× · ${String(p.forma)}` };
    case 'followup.enviado':
      return { fonte, resumo: `${String(p.qual)} enviado` };
    case 'aceite.dados':
      return { fonte, resumo: `dados conferidos · assina ${curto(p.quemAssina, 40)}` };
    case 'cobranca.criada':
      return { fonte, resumo: `cobrança criada · ${String(p.parcelas)}× · ${String(p.forma)}` };
    case 'pix.pago':
      return { fonte, resumo: `parcela ${String(p.parcela)} paga · ${reais(Number(p.valorCentavos ?? 0))}` };
    case 'boleto.pago':
      return { fonte, resumo: `parcela ${String(p.parcela)} paga no boleto · ${reais(Number(p.valorCentavos ?? 0))}` };
    case 'cartao.pago':
      return { fonte, resumo: `parcela ${String(p.parcela)} paga no cartão · ${reais(Number(p.valorCentavos ?? 0))}` };
    case 'contrato.gerado':
      return { fonte, resumo: 'contrato gerado para assinatura' };
    case 'contrato.assinado_cliente':
      return { fonte, resumo: 'cliente assinou' };
    case 'contrato.assinado_root':
      return { fonte, resumo: `Root assinou${p.por ? ` (${String(p.por)})` : ''}` };
    case 'aceite.declarado':
      return { fonte, resumo: `fechado fora do sistema, registrado à mão${p.por ? ` por ${String(p.por)}` : ''} · ${reais(Number(p.valorCentavos ?? 0))} em ${String(p.parcelas)}× · ${p.criarCobranca ? 'cobrança nova pedida' : 'sem cobrança nova'}` };
    case 'contrato.anexado':
      return { fonte, resumo: `contrato assinado fora anexado · ${curto(p.nome, 40)}` };
    case 'fechamento.escrita':
      return { fonte, resumo: `fechamento · ${String(p.escrita)}: ${String(p.estado)}` };
    case 'cliente.ativo':
      return { fonte, resumo: 'cliente ativo · fechamento concluído' };
    case 'implantacao.card_criado':
      return { fonte, resumo: `card da implantação aberto · ${curto(p.lista, 40)} · ${curto(p.etapa, 30)}` };
    case 'implantacao.iniciada_antes_do_fechamento':
      return { fonte, resumo: `onboarding iniciado antes do fechamento${p.por ? ` por ${String(p.por)}` : ''} · card em ${curto(p.etapa, 30)}` };
    case 'implantacao.fechamento_registrado':
      return { fonte, resumo: 'fechamento registrado no card da implantação iniciado antes' };
    case 'cliente.a_conciliar':
      return { fonte, resumo: `cliente a conciliar: ${curto(p.motivo, 120)}` };
    case 'kickoff.marcado':
      return { fonte, resumo: `kickoff marcado · ${horarioLegivel(p.horario)}` };
    case 'parcela.vence':
      return { fonte, resumo: `aviso ${String(p.aviso)} da parcela ${String(p.parcela)}` };
    case 'parcela.paga':
      return { fonte, resumo: `parcela ${String(p.parcela)} paga` };
    case 'parcela.atrasada':
      return { fonte, resumo: `parcela ${String(p.parcela)} atrasada há ${String(p.dias)} dia(s)` };
    case 'parcela.estornada':
      return { fonte, resumo: `parcela ${String(p.parcela)} estornada · volta a não paga` };
    case 'marco.contrato':
      return { fonte, resumo: `marco: ${String(p.marco)}` };
    case 'contrato.concluido':
    case 'contrato.desativado':
      return { fonte, resumo: `contrato ${type === 'contrato.concluido' ? 'concluído' : 'desativado'} por ${String(p.porNome ?? 'alguém da casa')}: ${String(p.motivo)}${Number(p.parcelasEmAberto) > 0 ? ` · ${String(p.parcelasEmAberto)} parcela(s) em aberto, cobrança mantida` : ''}` };
    case 'decisao.aberta':
      return { fonte, resumo: `decisão aberta: ${String(p.tipo)} · padrão ${String(p.padrao)}` };
    case 'decisao.tomada':
      return { fonte, resumo: `decisão: ${String(p.escolha)}${p.por ? ` · ${String(p.por)}` : ''} (${String(p.canal)})` };
    case 'decisao.expirada':
      return { fonte, resumo: `decisão venceu · padrão aplicado: ${String(p.padraoAplicado)}` };
    case 'veto.registrado':
      return { fonte, resumo: `VETO sobre ${String(p.sobre)}` };
    case 'etapa.mudou':
      return { fonte, resumo: `${String(p.de)} → ${String(p.para)} · ${curto(p.motivo, 60)}` };
    case 'etapa.movida_com_pendencia': {
      const lista = Array.isArray(p.pendencias) ? p.pendencias.map(String) : [];
      return { fonte, resumo: `movido à mão ${String(p.de)} → ${String(p.para)}${p.por ? ` por ${String(p.por)}` : ''} · com pendências: ${curto(lista.join('; '), 120)}` };
    }
    case 'etapa.movida_a_mao': {
      const lista = Array.isArray(p.pendencias) ? p.pendencias.map(String) : [];
      const sem = p.semMotivo ? ' · sem motivo informado' : p.motivo ? ` · ${curto(p.motivo, 60)}` : '';
      return { fonte, resumo: `movido à mão ${String(p.de)} → ${String(p.para)}${p.por ? ` por ${String(p.por)}` : ''}${lista.length ? ` · sem as conclusões: ${curto(lista.join('; '), 120)}` : ''}${sem}` };
    }
    case 'saida.registrada':
      return { fonte, resumo: `saída: ${String(p.saida)} · ${String(p.motivo)}` };
    case 'vigia.premissa':
      return { fonte, resumo: `vigia · ${String(p.automacao)}: ${p.ok ? 'ok' : 'QUEBRADA'} · ${curto(p.premissa, 50)}` };
  }
}

/** O dia relativo à entrada (D1 = o dia em que o lead chegou). */
export function diaRelativo(entrada: Date, em: Date): number {
  const DIA = 86_400_000;
  const base = Date.UTC(entrada.getUTCFullYear(), entrada.getUTCMonth(), entrada.getUTCDate());
  const alvo = Date.UTC(em.getUTCFullYear(), em.getUTCMonth(), em.getUTCDate());
  return Math.max(1, Math.floor((alvo - base) / DIA) + 1);
}

/** Os eventos lidos do banco, na ordem, virando as linhas do fio. */
export function linhasDoFio(
  eventos: readonly { id: string; type: string; payload: unknown; occurredAt: Date }[],
  entrada: Date,
): LinhaDoFio[] {
  return [...eventos]
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
    .map((e) => {
      const { fonte, resumo } = resumoDoEvento(e.type, e.payload);
      return { eventoId: e.id, type: e.type, fonte, resumo, em: e.occurredAt.toISOString(), dia: diaRelativo(entrada, e.occurredAt) };
    });
}

/** O catálogo, para a suíte afirmar que nenhum tipo ficou sem fonte. */
export const TIPOS_DO_CATALOGO: readonly ComercialEvento[] = COMERCIAL_EVENTOS;
