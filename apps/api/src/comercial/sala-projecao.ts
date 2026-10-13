import {
  SALA_BLOCOS_DA_PROPOSTA,
  SALA_ESTAGIOS,
  SALA_ROTULO_DO_ESTAGIO,
  TABELA_DE_PRECO,
  type AceiteNaSala,
  type ComercialFormaDePagamento,
  type ComercialProduto,
  type EstadoDaSala,
  type OfertaNaSala,
  type PropostaNaSala,
  type SalaBlocoDaProposta,
  type SalaEstagio,
} from '@mktos/shared';

import { DURACAO_DA_CONVERSA_MIN } from './agenda-de-homologacao';
import { hashDoConteudo } from './eventos';

/*
 * A SALA COMO PROJEÇÃO — o que o lead vê, montado do fio (Lane B, 13/10/2026).
 *
 * Nenhum campo da sala é digitado: tudo sai dos eventos do lead, da ficha
 * (quando a espinha já a criou), das cobranças e dos documentos (quando o
 * dinheiro já os criou). O que não chegou fica `null` ou vazio. Nada aqui
 * inventa número: a oferta é a do evento `proposta.publicada`, e a
 * alternativa só aparece quando o evento a nomeia (o preço dela é o da tabela
 * de 04/10, que mora no shared).
 *
 * Pura, sem banco: a suíte mede o estágio e o plano de ação sem subir nada.
 */

export interface EventoDaSala {
  type: string;
  payload: unknown;
  occurredAt: Date;
}

export interface FichaParaSala {
  etapa: string;
  empresa: string | null;
  reuniaoEm: Date | null;
  quadroDeCustos: unknown;
  grupoJid: string | null;
  kickoffEm: Date | null;
  clienteAtivoEm: Date | null;
  trilhoId: string | null;
}

export interface CobrancaParaSala {
  parcela: number;
  estado: string;
  valorCentavos: number;
  linkPagamento: string | null;
  pixCopiaECola: string | null;
}

export interface DocumentoParaSala {
  estado: string;
  linkCliente: string | null;
  assinadoClienteEm: Date | null;
  assinadoRootEm: Date | null;
  criadoEm: Date;
}

export interface DadosDaSala {
  horariosOferecidos?: string[];
  /** As respostas às dúvidas da proposta, pela chave da dúvida (`chaveDaDuvida`). Quem responde é o assistente (lane E) ou gente. */
  respostas?: Record<string, { resposta: string; em: string; por?: string | null }>;
  linkDoTrilho?: string | null;
}

export interface EntradaDaProjecao {
  slug: string;
  nomeDoLead: string;
  validoAte: Date;
  dados: DadosDaSala;
  ficha: FichaParaSala | null;
  eventos: readonly EventoDaSala[];
  cobrancas: readonly CobrancaParaSala[];
  documentos: readonly DocumentoParaSala[];
  agora?: Date;
}

type P = Record<string, unknown>;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

function ultimo(eventos: readonly EventoDaSala[], type: string, filtro?: (p: P) => boolean): EventoDaSala | null {
  for (let i = eventos.length - 1; i >= 0; i--) {
    const e = eventos[i];
    if (e.type === type && (!filtro || filtro((e.payload ?? {}) as P))) return e;
  }
  return null;
}

function ehProduto(v: unknown): v is ComercialProduto {
  return typeof v === 'string' && v in TABELA_DE_PRECO;
}

function ofertaDoEvento(p: P): OfertaNaSala | null {
  const produto = p.produto;
  if (!ehProduto(produto)) return null;
  const valor = num(p.valorCentavos);
  const parcelas = num(p.parcelas);
  const parcela = num(p.parcelaCentavos);
  if (valor === null || parcelas === null || parcela === null) return null;
  const linha = TABELA_DE_PRECO[produto];
  const formas = Array.isArray(p.formas) ? (p.formas.filter((f) => typeof f === 'string') as ComercialFormaDePagamento[]) : [];
  return {
    produto,
    rotulo: linha?.rotulo ?? produto,
    valorCentavos: valor,
    parcelas,
    parcelaCentavos: parcela,
    formas,
    descricao: linha?.descricao ?? '',
    descontoPct: num(p.descontoPct),
  };
}

/** A alternativa só existe quando o evento a nomeia; o preço é o da tabela. */
function alternativaDoEvento(p: P, recomendada: ComercialProduto): OfertaNaSala | null {
  const nome = p.alternativa;
  if (!ehProduto(nome) || nome === recomendada) return null;
  const linha = TABELA_DE_PRECO[nome];
  if (!linha) return null;
  return {
    produto: nome,
    rotulo: linha.rotulo,
    valorCentavos: linha.valorCentavos,
    parcelas: linha.parcelas,
    parcelaCentavos: linha.parcelaCentavos,
    formas: [...linha.formas],
    descricao: linha.descricao,
    descontoPct: null,
  };
}

function custosDe(v: unknown): PropostaNaSala['custosDeTerceiros'] {
  if (!v || typeof v !== 'object') return null;
  const q = v as P;
  const normal = num(q.mesNormalCentavos);
  const pior = num(q.piorMesCentavos);
  if (normal === null && pior === null) return null;
  return { mesNormalCentavos: normal, piorMesCentavos: pior };
}

/** O que o lead contou no formulário, em frases curtas (tela 02). */
export function oQueContou(p: P | null): string[] {
  if (!p) return [];
  const out: string[] = [];
  if (str(p.sistema)) out.push(String(p.sistema));
  if (typeof p.baseOrganizada === 'boolean') out.push(p.baseOrganizada ? 'base organizada' : 'base ainda solta');
  if (str(p.maiorDor)) out.push(String(p.maiorDor));
  const equipe = num(p.equipeFinanceiro);
  if (equipe !== null) out.push(`${equipe} ${equipe === 1 ? 'pessoa' : 'pessoas'} no financeiro`);
  return out;
}

/** A identidade de uma dúvida: a mesma chave do evento `proposta.duvida`. */
export function chaveDaDuvida(versao: number, pergunta: string): string {
  return hashDoConteudo({ versao, pergunta });
}

export function estagioDaSala(e: EntradaDaProjecao): SalaEstagio {
  const tem = (t: string) => e.eventos.some((x) => x.type === t);
  if (e.ficha?.clienteAtivoEm || e.ficha?.etapa === 'fechado' || tem('cliente.ativo')) return 'comeco';
  if (tem('proposta.aceita') || tem('aceite.dados')) return 'contrato';
  if (tem('proposta.publicada')) return 'proposta';
  const agora = (e.agora ?? new Date()).getTime();
  const horario = horarioEscolhido(e);
  if (tem('ata.chegou') || tem('diagnostico.pronto') || (horario && new Date(horario).getTime() + DURACAO_DA_CONVERSA_MIN * 60_000 <= agora)) {
    return 'diagnostico';
  }
  return 'conversa';
}

function horarioEscolhido(e: EntradaDaProjecao): string | null {
  const ag = ultimo(e.eventos, 'agenda.escolhida');
  const h = ag ? str((ag.payload as P).horario) : null;
  return h ?? (e.ficha?.reuniaoEm ? e.ficha.reuniaoEm.toISOString() : null);
}

export function projetarSala(e: EntradaDaProjecao): EstadoDaSala {
  const agora = e.agora ?? new Date();
  const estagio = estagioDaSala(e);
  const iAtual = SALA_ESTAGIOS.indexOf(estagio);
  const form = ultimo(e.eventos, 'form.respondido');
  const formP = form ? ((form.payload ?? {}) as P) : null;
  const horario = horarioEscolhido(e);
  const diag = ultimo(e.eventos, 'diagnostico.pronto');
  const pub = ultimo(e.eventos, 'proposta.publicada');
  const ata = ultimo(e.eventos, 'ata.chegou');

  // --- diagnóstico -------------------------------------------------------
  let diagnostico: EstadoDaSala['diagnostico'] = null;
  if (diag) {
    const p = (diag.payload ?? {}) as P;
    const dores = Array.isArray(p.dores) ? (p.dores as P[]) : [];
    diagnostico = {
      dores: dores
        .map((d, i) => ({ n: num(d.n) ?? i + 1, texto: String(d.texto ?? ''), minuto: str(d.minuto) }))
        .filter((d) => d.texto.trim()),
      // As objeções são leitura interna da Root: a sala não as mostra ao lead.
      objecoes: [],
      prontoEm: diag.occurredAt.toISOString(),
    };
  }

  // --- proposta ----------------------------------------------------------
  let proposta: PropostaNaSala | null = null;
  if (pub) {
    const p = (pub.payload ?? {}) as P;
    const recomendada = ofertaDoEvento(p);
    const versao = num(p.versao) ?? 1;
    if (recomendada) {
      const daVersao = (t: string) => e.eventos.filter((x) => x.type === t && num(((x.payload ?? {}) as P).versao) === versao);
      const lidos = new Set<SalaBlocoDaProposta>();
      for (const l of daVersao('proposta.lida')) {
        const b = ((l.payload ?? {}) as P).bloco;
        if (typeof b === 'string' && (SALA_BLOCOS_DA_PROPOSTA as readonly string[]).includes(b)) lidos.add(b as SalaBlocoDaProposta);
      }
      const ajustes = daVersao('proposta.ajuste_pedido');
      const ultimoAjuste = ajustes.length ? ajustes[ajustes.length - 1] : null;
      const decididoDepois =
        ultimoAjuste &&
        e.eventos.some(
          (x) =>
            (x.type === 'decisao.tomada' || x.type === 'decisao.expirada') &&
            ((x.payload ?? {}) as P).tipo === 'pedido_de_ajuste' &&
            x.occurredAt.getTime() >= ultimoAjuste.occurredAt.getTime(),
        );
      const dores = diagnostico?.dores.map((d) => d.texto) ?? [];
      proposta = {
        versao,
        publicadaEm: pub.occurredAt.toISOString(),
        validaAte: str(p.validaAte),
        ouvimos: dores.length ? dores : oQueContou(formP),
        recomendada,
        alternativa: alternativaDoEvento(p, recomendada.produto),
        custosDeTerceiros: custosDe(p.quadroDeCustos) ?? custosDe(e.ficha?.quadroDeCustos),
        blocosLidos: SALA_BLOCOS_DA_PROPOSTA.filter((b) => lidos.has(b)),
        ajustePendente: Boolean(ultimoAjuste && !decididoDepois),
        duvidas: daVersao('proposta.duvida').map((d) => {
          const q = (d.payload ?? {}) as P;
          const pergunta = String(q.pergunta ?? '');
          const respondida = e.dados.respostas?.[chaveDaDuvida(versao, pergunta)];
          return { pergunta, resposta: respondida?.resposta ?? str(q.resposta), em: d.occurredAt.toISOString() };
        }),
      };
    }
  }

  // --- aceite ------------------------------------------------------------
  let aceite: AceiteNaSala | null = null;
  const aceita = ultimo(e.eventos, 'proposta.aceita');
  const dados = ultimo(e.eventos, 'aceite.dados');
  if (aceita || dados) {
    const a = aceita ? ((aceita.payload ?? {}) as P) : null;
    const base = a ?? (proposta ? { produto: proposta.recomendada.produto, valorCentavos: proposta.recomendada.valorCentavos, parcelas: proposta.recomendada.parcelas } : null);
    if (base && ehProduto(base.produto)) {
      const d = dados ? ((dados.payload ?? {}) as P) : null;
      const cobrancas = [...e.cobrancas].sort((x, y) => x.parcela - y.parcela);
      const primeira = cobrancas[0] ?? null;
      const doc = [...e.documentos].sort((x, y) => y.criadoEm.getTime() - x.criadoEm.getTime())[0] ?? null;
      aceite = {
        produto: base.produto,
        valorCentavos: num(base.valorCentavos) ?? 0,
        parcelas: num(base.parcelas) ?? 1,
        forma: a && typeof a.forma === 'string' ? (a.forma as ComercialFormaDePagamento) : null,
        dados: d
          ? {
              cnpj: String(d.cnpj ?? ''),
              razaoSocial: String(d.razaoSocial ?? ''),
              endereco: String(d.endereco ?? ''),
              quemAssina: String(d.quemAssina ?? ''),
              email: String(d.email ?? ''),
            }
          : null,
        cobranca: primeira
          ? { estado: primeira.estado, linkPagamento: primeira.linkPagamento, pixCopiaECola: primeira.pixCopiaECola, primeiraParcelaCentavos: primeira.valorCentavos }
          : null,
        contrato: doc
          ? {
              estado: doc.estado,
              linkAssinatura: doc.linkCliente,
              assinadoClienteEm: doc.assinadoClienteEm?.toISOString() ?? null,
              assinadoRootEm: doc.assinadoRootEm?.toISOString() ?? null,
            }
          : null,
      };
    }
  }

  // --- começo ------------------------------------------------------------
  const kick = ultimo(e.eventos, 'kickoff.marcado');
  const comeco: EstadoDaSala['comeco'] =
    iAtual >= SALA_ESTAGIOS.indexOf('contrato')
      ? {
          grupoCriado: Boolean(e.ficha?.grupoJid),
          kickoffEm: (kick ? str((kick.payload as P).horario) : null) ?? e.ficha?.kickoffEm?.toISOString() ?? null,
          linkDoTrilho: e.dados.linkDoTrilho ?? null,
        }
      : null;

  // --- plano de ação (tela 02) -------------------------------------------
  const conversaFeita = Boolean(ata) || Boolean(diag) || iAtual >= SALA_ESTAGIOS.indexOf('proposta');
  const planoDeAcao = [
    { texto: 'Você responde quatro perguntas', feito: Boolean(form) },
    { texto: `Conversa de ${DURACAO_DA_CONVERSA_MIN} minutos com um dos sócios`, feito: conversaFeita },
    { texto: 'Diagnóstico com os seus números', feito: Boolean(diag) },
    { texto: 'Proposta com os custos de terceiros no seu nome', feito: Boolean(pub) },
  ];

  return {
    slug: e.slug,
    empresa: e.ficha?.empresa ?? (formP && str(formP.empresa)) ?? e.nomeDoLead,
    contato: (formP && str(formP.nome)) ?? e.nomeDoLead,
    estagio,
    estagios: SALA_ESTAGIOS.map((chave, i) => ({
      chave,
      rotulo: SALA_ROTULO_DO_ESTAGIO[chave],
      estado: i < iAtual ? ('passou' as const) : i === iAtual ? ('atual' as const) : ('vem' as const),
    })),
    conversa: {
      horario,
      horariosOferecidos: horario ? [] : form ? (e.dados.horariosOferecidos ?? []).filter((h) => new Date(h).getTime() > agora.getTime()) : [],
      duracaoMin: DURACAO_DA_CONVERSA_MIN,
      oQueContou: oQueContou(formP),
    },
    planoDeAcao,
    diagnostico,
    proposta,
    aceite,
    comeco,
    validoAte: e.validoAte.toISOString(),
  };
}
