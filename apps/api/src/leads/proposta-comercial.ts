import { createHash } from 'node:crypto';
import {
  ehValorMonetarioCanonico,
  type LeadCondicaoCampo,
  type LeadCondicoes,
  type LeadDecisao,
  type LeadDiferencaDeCondicao,
  type LeadEvidencia,
  type LeadPropostaDocumento,
  type LeadPropostaEstado,
} from '@mktos/shared';

/*
 * A PARTE PURA DA PROPOSTA E DO ACEITE COMERCIAL (ROOT-49, C-03): condições
 * lidas do card, hash, diferença, identidade dos eventos e estado. Sem banco e
 * sem Nest, para a suíte medir sem subir nada.
 */

/** Tipos de evento da timeline do lead que este percurso escreve. */
export const TIPO_DO_EVENTO_DE_PROPOSTA = 'proposta';
export const TIPOS_DE_DECISAO: readonly LeadDecisao[] = ['aceite', 'recusa'];

/** UUID determinístico, a mesma construção de `entrada-de-lead.ts` (e de `idNativo` do importador). */
function uuidDe(partes: string[]): string {
  const bytes = createHash('sha256').update(partes.join('\0')).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function canonico(valor: unknown): string {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor ?? null);
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  const obj = valor as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonico(obj[k])}`)
    .join(',')}}`;
}

const sha256 = (valor: unknown) => createHash('sha256').update(canonico(valor)).digest('hex');

// ---------- Condições ----------

/** O que a leitura do card entrega: só o que decide as condições. */
export interface CardParaCondicoes {
  id: string;
  startDate: Date | null;
  dueDate: Date | null;
}

export interface ValorDeCampoDoCard {
  campoId: string;
  campoNome: string;
  campoTipo: string;
  /** `WorkFieldValue.value` (texto). */
  valor: string | null;
  /** Nome da opção, quando o campo é de lista (a periodicidade costuma ser). */
  opcao: string | null;
}

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

/**
 * Condições do card, na ordem estável: início e vencimento do card, os campos
 * de valor (`moeda`), os campos de data e o campo "Periodicidade" (por nome,
 * sem acento nem caixa — o ClickUp não tem tipo próprio para ela). Cada campo
 * leva o `campoId`, então renomear o campo não muda a identidade, e a ordem
 * por `campoId` não depende da ordem em que o banco devolve as linhas.
 */
export function condicoesDoCard(card: CardParaCondicoes, valores: ValorDeCampoDoCard[]): LeadCondicoes {
  const campos: LeadCondicaoCampo[] = [];
  for (const v of valores) {
    const ehPeriodicidade = semAcento(v.campoNome) === 'periodicidade';
    const tipo = v.campoTipo === 'moeda' ? 'moeda' : v.campoTipo === 'data' ? 'data' : ehPeriodicidade ? 'periodicidade' : null;
    if (!tipo) continue;
    const valor = (tipo === 'periodicidade' ? (v.opcao ?? v.valor) : v.valor)?.trim() || null;
    campos.push({ campoId: v.campoId, nome: v.campoNome, tipo, valor });
  }
  campos.sort((a, b) => (a.campoId < b.campoId ? -1 : a.campoId > b.campoId ? 1 : 0));
  return {
    cardId: card.id,
    inicio: card.startDate ? card.startDate.toISOString() : null,
    vencimento: card.dueDate ? card.dueDate.toISOString() : null,
    campos,
  };
}

export function hashDasCondicoes(condicoes: LeadCondicoes): string {
  return sha256(condicoes);
}

/**
 * Sem valor em negociação preenchido, o hash seria o de "nenhuma condição", e
 * aceitar isso é aceitar nada. O motivo vai ao 409 em português; `null` = serve.
 */
export function motivoDeCondicoesInsuficientes(condicoes: LeadCondicoes): string | null {
  const valores = condicoes.campos.filter((c) => c.tipo === 'moeda' && c.valor !== null);
  if (valores.length === 0) {
    return 'O card não tem o valor em negociação preenchido; preencha o valor antes de registrar a proposta ou o aceite';
  }
  if (valores.some((c) => !ehValorMonetarioCanonico(c.valor))) {
    return 'O valor em negociação do card está fora do formato (ex.: BRL 1500.00); corrija o card antes';
  }
  return null;
}

/** O que mudou entre as condições que a pessoa viu e as do card agora. Vazio = as mesmas. */
export function diferencaDasCondicoes(vistas: LeadCondicoes, atuais: LeadCondicoes): LeadDiferencaDeCondicao[] {
  const dif: LeadDiferencaDeCondicao[] = [];
  const confere = (chave: string, rotulo: string, vista: string | null, atual: string | null) => {
    if (vista !== atual) dif.push({ chave, rotulo, vista, atual });
  };
  confere('inicio', 'Início', vistas.inicio, atuais.inicio);
  confere('vencimento', 'Vencimento', vistas.vencimento, atuais.vencimento);
  const antes = new Map(vistas.campos.map((c) => [c.campoId, c]));
  const agora = new Map(atuais.campos.map((c) => [c.campoId, c]));
  for (const id of [...new Set([...antes.keys(), ...agora.keys()])].sort()) {
    const a = antes.get(id);
    const b = agora.get(id);
    confere(`campo:${id}`, (b ?? a)!.nome, a?.valor ?? null, b?.valor ?? null);
  }
  if (vistas.cardId !== atuais.cardId) dif.unshift({ chave: 'card', rotulo: 'Card', vista: vistas.cardId, atual: atuais.cardId });
  return dif;
}

// ---------- Identidade dos eventos ----------

/** O registro da proposta é o conteúdo: o mesmo documento nas mesmas condições cai no mesmo id. */
export function hashDoRegistroDaProposta(registro: { documento: LeadPropostaDocumento; cardId: string; condicoesHash: string }): string {
  return sha256(registro);
}

export function eventoIdDaProposta(orgId: string, leadId: string, hashDoRegistro: string): string {
  return uuidDe([orgId, 'lead-evento-proposta', leadId, hashDoRegistro]);
}

/**
 * C-03: o id do aceite é `(lead, "aceite", hash das condições)`. A recusa usa a
 * mesma conta com o próprio tipo: sem isso, recusar e depois aceitar as mesmas
 * condições cairia no mesmo id e o segundo seria engolido como "repetição".
 */
export function eventoIdDaDecisao(orgId: string, leadId: string, decisao: LeadDecisao, condicoesHash: string): string {
  return uuidDe([orgId, `lead-evento-${decisao}`, leadId, condicoesHash]);
}

export function hashDaEvidencia(evidencia: LeadEvidencia): string {
  return sha256(evidencia);
}

/** O endereço sem caminho nem parâmetro (o link pode carregar um token de acesso): o que o RASTRO guarda. */
export function origemDoLink(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return 'link-invalido';
  }
}

/** A evidência no nível do RASTRO: o tipo e um resumo criptográfico, nunca o texto da mensagem nem o link inteiro. */
export function evidenciaParaORastro(evidencia: LeadEvidencia): Record<string, string> {
  const base = { tipo: evidencia.tipo, hash: hashDaEvidencia(evidencia) };
  if (evidencia.tipo === 'link') return { ...base, origem: origemDoLink(evidencia.url) };
  if (evidencia.tipo === 'arquivo') return { ...base, sha256: evidencia.sha256 };
  return { ...base, canal: evidencia.canal };
}

// ---------- Estado ----------

export interface EventoDeProposta {
  id: string;
  type: string;
  occurredAt: Date;
}

/**
 * O estado é o último fato da timeline entre proposta, aceite e recusa. Num
 * empate de instante, a decisão vale sobre a proposta (a decisão é sempre
 * posterior ao registro que ela decide).
 */
export function estadoDaProposta(eventos: EventoDeProposta[]): LeadPropostaEstado {
  const peso = (tipo: string) => (tipo === TIPO_DO_EVENTO_DE_PROPOSTA ? 0 : 1);
  const ultimo = eventos
    .filter((e) => e.type === TIPO_DO_EVENTO_DE_PROPOSTA || (TIPOS_DE_DECISAO as readonly string[]).includes(e.type))
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || peso(a.type) - peso(b.type))
    .at(-1);
  if (!ultimo) return 'sem_proposta';
  if (ultimo.type === 'aceite') return 'aceite_registrado';
  if (ultimo.type === 'recusa') return 'recusa_registrada';
  return 'proposta_registrada';
}
