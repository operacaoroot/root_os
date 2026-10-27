import {
  COMERCIAL_ETAPAS,
  SALA_BLOCOS_DA_PROPOSTA,
  SALA_ESTAGIOS,
  SALA_ROTULO_DO_ESTAGIO,
  TABELA_DE_PRECO,
  ehSaida,
  ordemDaEtapa,
  type AceiteNaSala,
  type ComercialEtapa,
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
  /** L6 (leva 5): `zapsign`, `anexo`... A minuta (`minuta`) nunca chega aqui (o filtro é na consulta), mas a lista confere de novo. */
  provedor?: string;
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
  // Número de exemplo só aparece com a marca (revisão E-3).
  return { mesNormalCentavos: normal, piorMesCentavos: pior, ...(q.exemplo === true ? { exemplo: true } : {}) };
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

/**
 * O estágio da sala. O Começo (e com ele o kickoff que o cliente marca) abre só
 * com o cliente ativo de verdade: a data na ficha ou o fato `cliente.ativo`,
 * que o fechamento grava. Nunca pela etapa: desde o mover livre (Interface
 * 20/10), gente leva o cartão a "Negócio fechado" sem fechamento, e esse gesto
 * é só a etapa. A sala fica no estágio que os fatos sustentam.
 */
export function estagioDaSala(e: EntradaDaProjecao): SalaEstagio {
  const tem = (t: string) => e.eventos.some((x) => x.type === t);
  if (e.ficha?.clienteAtivoEm || tem('cliente.ativo')) return 'comeco';
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
  // B-5: o cliente só lê o diagnóstico que a mesa aprovou. A saída crua do leitor
  // de ata (`aprovadoEm: null`) é rascunho interno, e não marca o passo como feito.
  const diag = ultimo(e.eventos, 'diagnostico.pronto', (p) => Boolean(str(p.aprovadoEm)));
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

/*
 * O ACOMPANHAMENTO DO CLIENTE (leva 5, L6, 27/10/2026): "o cliente acompanha
 * tudo pela sala".
 *
 * Quatro blocos DERIVADOS em tempo de leitura, a partir do que a projeção já
 * tem (a ficha, o fio, as cobranças, os documentos) e nunca gravados em
 * `SalaVersao`: a sala antiga ganha os blocos sem republicar, e o conteúdo das
 * versões publicadas não muda.
 *
 *   · ETAPA ATUAL: a etapa da ficha em palavras de cliente (nunca o enum nem o
 *     "E3"). A etapa é o que a equipe move no funil; a posição da sala
 *     (`estagio`) continua vindo dos fatos, e os dois convivem.
 *   · PRÓXIMOS PASSOS: o que vem agora, de quem (você ou a Root) e quando há
 *     data gravada. Sai do estágio e do que o estágio ainda pede; nenhuma data é
 *     inventada.
 *   · DOCUMENTOS TROCADOS: a proposta (por versão), o contrato (só os de
 *     assinatura; a minuta é rascunho interno e fica fora), o diagnóstico
 *     aprovado e os arquivos que o cliente mandou. Link só o que o cliente já
 *     tem direito de abrir (a página da proposta e o link de assinatura dele).
 *   · CONTATO: o WhatsApp da Root, quando a mesa o escreveu na nota
 *     `comercial.whatsapp.numero`; sem a nota, nulo (a tela mostra o marcador,
 *     nunca um número inventado).
 */

export interface EtapaParaOCliente {
  /** A etapa do funil (o enum fica aqui só para a tela do painel casar; o cliente lê `rotulo`). */
  chave: ComercialEtapa;
  rotulo: string;
  descricao: string;
  /** Posição no funil (1 a 9) e o total; nulo nas saídas. */
  ordem: number | null;
  total: number;
  saida: boolean;
}

export interface PassoParaOCliente {
  texto: string;
  /** ISO, só quando há data gravada (horário escolhido, validade da proposta, kickoff). */
  quando: string | null;
  /** `em` = horário marcado (a tela mostra dia e hora); `ate` = prazo (a tela mostra "até dd/mm"). Nulo sem `quando`. */
  quandoTipo: 'em' | 'ate' | null;
  deQuem: 'voce' | 'root';
}

export interface DocumentoParaOCliente {
  tipo: 'proposta' | 'contrato' | 'diagnostico' | 'arquivo';
  titulo: string;
  estado: string;
  /** Quem entregou. */
  de: 'voce' | 'root';
  em: string;
  /** A versão da proposta (a página monta o link `/s/<token>/proposta` com o token que já tem). */
  versao?: number;
  /** Link que o cliente pode abrir agora (o de assinatura dele). Nunca link interno da Root. */
  link?: string | null;
}

export interface AcompanhamentoDaSala {
  etapa: EtapaParaOCliente | null;
  proximosPassos: PassoParaOCliente[];
  documentos: DocumentoParaOCliente[];
  contato: { whatsapp: string | null; rotulo: string };
}

/** O rótulo do contato quando a mesa ainda não escreveu o número (a nota `comercial.whatsapp.numero`). */
export const CONTATO_SEM_NUMERO = 'WhatsApp da Root: o número chega em breve nesta sala';

/** A etapa do funil em palavras de cliente. Sem "E3", sem enum, sem travessão. */
export const ETAPA_PARA_O_CLIENTE: Record<ComercialEtapa, { rotulo: string; descricao: string }> = {
  novo_lead: { rotulo: 'Primeiro contato', descricao: 'Recebemos o seu contato e estamos organizando a conversa.' },
  qualificacao: { rotulo: 'Entendendo o seu cenário', descricao: 'Estamos conhecendo a sua operação para a conversa começar pelos seus números.' },
  reuniao_agendada: { rotulo: 'Conversa marcada', descricao: 'A conversa com um dos sócios está marcada.' },
  sessao: { rotulo: 'Sessão estratégica', descricao: 'A conversa com um dos sócios é a base do seu diagnóstico.' },
  diagnostico: { rotulo: 'Diagnóstico em preparo', descricao: 'A Root está escrevendo o diagnóstico com o que ouviu de você.' },
  proposta: { rotulo: 'Proposta publicada', descricao: 'A proposta está nesta sala para você ler.' },
  follow_up: { rotulo: 'Proposta em avaliação', descricao: 'A proposta está com você. A Root acompanha e responde dúvidas por aqui.' },
  contrato: { rotulo: 'Contrato', descricao: 'Aceite feito: cobrança e contrato estão sendo preparados ou assinados.' },
  fechado: { rotulo: 'Negócio fechado', descricao: 'Bem-vindo. O começo da operação se organiza aqui.' },
  desqualificado: { rotulo: 'Conversa encerrada', descricao: 'Esta conversa foi encerrada pela Root.' },
  geladeira: { rotulo: 'Conversa pausada', descricao: 'Combinamos retomar mais adiante.' },
  perdido: { rotulo: 'Conversa encerrada', descricao: 'Esta conversa foi encerrada.' },
  parceiro: { rotulo: 'Encaminhado a um parceiro', descricao: 'A Root indicou um parceiro para o seu caso.' },
};

function ehEtapa(v: unknown): v is ComercialEtapa {
  return typeof v === 'string' && v in ETAPA_PARA_O_CLIENTE;
}

export function etapaParaOCliente(etapa: unknown): EtapaParaOCliente | null {
  if (!ehEtapa(etapa)) return null;
  const t = ETAPA_PARA_O_CLIENTE[etapa];
  return { chave: etapa, rotulo: t.rotulo, descricao: t.descricao, ordem: ordemDaEtapa(etapa), total: COMERCIAL_ETAPAS.length, saida: ehSaida(etapa) };
}

const kb = (bytes: unknown): string => {
  const b = num(bytes);
  if (b === null) return '';
  return b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
};

/**
 * O que vem agora, para o cliente. Sai do estágio dos fatos e do que ele ainda
 * pede; a etapa de saída fala por si (a geladeira volta na data gravada, as
 * outras não têm passo). Até três linhas.
 */
export function proximosPassosParaOCliente(estado: EstadoDaSala, e: Pick<EntradaDaProjecao, 'ficha' | 'agora'> & { voltaEm?: Date | null }): PassoParaOCliente[] {
  const etapa = e.ficha?.etapa;
  if (ehEtapa(etapa) && ehSaida(etapa)) {
    return etapa === 'geladeira' ? [{ texto: 'Retomamos a conversa', quando: e.voltaEm ? e.voltaEm.toISOString() : null, quandoTipo: e.voltaEm ? 'em' : null, deQuem: 'root' }] : [];
  }
  const agora = (e.agora ?? new Date()).getTime();
  const passo = (deQuem: 'voce' | 'root', texto: string, quando: string | null = null, quandoTipo: 'em' | 'ate' = 'em'): PassoParaOCliente => ({ texto, quando, quandoTipo: quando ? quandoTipo : null, deQuem });
  const voce = (texto: string, quando: string | null = null, quandoTipo: 'em' | 'ate' = 'em') => passo('voce', texto, quando, quandoTipo);
  const root = (texto: string, quando: string | null = null, quandoTipo: 'em' | 'ate' = 'em') => passo('root', texto, quando, quandoTipo);
  const passos: PassoParaOCliente[] = [];
  switch (estado.estagio) {
    case 'conversa': {
      const c = estado.conversa;
      if (!c.oQueContou.length) passos.push(voce('Responder as quatro perguntas aqui na sala'));
      else if (!c.horario) passos.push(c.horariosOferecidos.length ? voce('Escolher um horário para a conversa com um dos sócios') : root('A Root oferece os horários da conversa'));
      else passos.push(new Date(c.horario).getTime() > agora ? voce('Conversa com um dos sócios', c.horario) : root('A Root prepara o seu diagnóstico'));
      break;
    }
    case 'diagnostico':
      passos.push(estado.diagnostico ? root('A Root publica a proposta') : root('A Root prepara o seu diagnóstico'));
      break;
    case 'proposta': {
      const p = estado.proposta;
      if (p?.ajustePendente) passos.push(root('A Root responde ao seu pedido de ajuste'));
      const abertas = (p?.duvidas ?? []).filter((d) => !d.resposta).length;
      if (abertas) passos.push(root(abertas === 1 ? 'A Root responde a sua dúvida' : `A Root responde as suas ${abertas} dúvidas`));
      passos.push(p && p.blocosLidos.length === 0 ? voce('Ler a proposta', p.validaAte, 'ate') : voce('Aceitar a proposta ou pedir um ajuste', p?.validaAte ?? null, 'ate'));
      break;
    }
    case 'contrato': {
      const a = estado.aceite;
      if (!a?.forma) {
        passos.push(voce('Confirmar os seus dados e aceitar a forma de pagamento'));
        break;
      }
      if (!a.cobranca) passos.push(root('A Root gera a cobrança da primeira parcela'));
      else if (a.cobranca.estado !== 'paga') passos.push(voce('Pagar a primeira parcela'));
      if (!a.contrato) passos.push(root('A Root gera o contrato com os seus dados'));
      else if (!a.contrato.assinadoClienteEm) passos.push(voce('Assinar o contrato pelo celular'));
      else if (!a.contrato.assinadoRootEm) passos.push(root('A Root assina o contrato'));
      if (!passos.length) passos.push(root('A Root confirma o pagamento e abre o começo'));
      break;
    }
    case 'comeco': {
      const c = estado.comeco;
      if (!c?.kickoffEm) passos.push(voce('Escolher o horário do kickoff'));
      else if (new Date(c.kickoffEm).getTime() > agora) passos.push(voce('Kickoff com a Root', c.kickoffEm));
      else passos.push(root('A Root monta o seu kit de implantação'));
      if (c && !c.grupoCriado) passos.push(root('A Root cria o grupo da sua empresa no WhatsApp'));
      break;
    }
  }
  return passos.slice(0, 3);
}

/** Os documentos trocados, do mais novo ao mais antigo. A minuta nunca entra. */
export function documentosParaOCliente(e: Pick<EntradaDaProjecao, 'eventos' | 'documentos'>, estado: EstadoDaSala): DocumentoParaOCliente[] {
  const out: DocumentoParaOCliente[] = [];
  const aceitaV = new Set(e.eventos.filter((x) => x.type === 'proposta.aceita').map((x) => num(((x.payload ?? {}) as P).versao)));
  for (const ev of e.eventos) {
    const p = (ev.payload ?? {}) as P;
    if (ev.type === 'proposta.publicada') {
      const versao = num(p.versao) ?? 1;
      const vigente = estado.proposta?.versao === versao;
      out.push({
        tipo: 'proposta',
        titulo: `Proposta v${versao}`,
        estado: aceitaV.has(versao) ? 'aceita por você' : vigente ? 'publicada para você ler' : 'substituída por uma versão mais nova',
        de: 'root',
        em: ev.occurredAt.toISOString(),
        versao,
      });
    } else if (ev.type === 'arquivo.enviado') {
      const nome = str(p.nome) ?? 'arquivo';
      const tamanho = kb(p.bytes);
      out.push({ tipo: 'arquivo', titulo: nome, estado: tamanho ? `${tamanho}, recebido pela Root` : 'recebido pela Root', de: 'voce', em: ev.occurredAt.toISOString() });
    } else if (ev.type === 'diagnostico.pronto' && str(p.aprovadoEm)) {
      out.push({ tipo: 'diagnostico', titulo: 'O seu diagnóstico', estado: 'publicado nesta sala', de: 'root', em: ev.occurredAt.toISOString() });
    }
  }
  for (const d of e.documentos) {
    if (d.provedor === 'minuta') continue;
    const assinadoPorVoce = Boolean(d.assinadoClienteEm);
    const assinadoPelaRoot = Boolean(d.assinadoRootEm);
    const anexo = d.provedor === 'anexo';
    out.push({
      tipo: 'contrato',
      titulo: 'Contrato',
      estado: anexo
        ? 'assinado, guardado pela Root'
        : assinadoPorVoce && assinadoPelaRoot
          ? 'assinado pelos dois'
          : assinadoPorVoce
            ? 'assinado por você, falta a Root'
            : 'aguardando a sua assinatura',
      de: 'root',
      em: d.criadoEm.toISOString(),
      link: !anexo && !assinadoPorVoce ? d.linkCliente : null,
    });
  }
  return out.sort((a, b) => b.em.localeCompare(a.em)).slice(0, 12);
}

export function acompanhamentoDaSala(
  e: Pick<EntradaDaProjecao, 'ficha' | 'eventos' | 'documentos' | 'agora'> & { voltaEm?: Date | null; whatsappDaRoot?: string | null },
  estado: EstadoDaSala,
): AcompanhamentoDaSala {
  const numero = e.whatsappDaRoot && /^\d{10,15}$/.test(e.whatsappDaRoot) ? e.whatsappDaRoot : null;
  return {
    etapa: etapaParaOCliente(e.ficha?.etapa),
    proximosPassos: proximosPassosParaOCliente(estado, e),
    documentos: documentosParaOCliente(e, estado),
    contato: { whatsapp: numero, rotulo: numero ? 'Falar com a Root no WhatsApp' : CONTATO_SEM_NUMERO },
  };
}
