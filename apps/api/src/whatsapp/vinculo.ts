import {
  ehGrupoDaEquipePeloNome,
  nomeDoGrupoSemPrefixo,
  normalizarNomeDeVinculo,
  type CandidatoDeVinculo,
  type SugestaoDeVinculo,
  type TipoDeVinculo,
} from '@mktos/shared';

/*
 * O VÍNCULO DA CONVERSA COM LEAD E CLIENTE: AS REGRAS PURAS (produção 22C, W3).
 *
 * Sem banco e sem Nest: o serviço (`vinculo.service.ts`) e o script
 * (`scripts/vincular-conversas.ts`) decidem pelas mesmas funções.
 *
 * AS TRÊS REGRAS QUE NÃO SE NEGOCIAM:
 *
 *   1. 1:1 casa SOZINHO só pelo TELEFONE, comparado por igualdade em dígitos com
 *      o DDI. O nono dígito NÃO é mexido (como na Equipe e no canal de
 *      aprovação: dois números diferentes colidiriam); o único acréscimo é o 55
 *      quando o número gravado veio só com DDD + número. Dois candidatos com o
 *      mesmo telefone = não casa (nem sugere: não há UM para sugerir).
 *   2. GRUPO NUNCA LIGA SOZINHO. O nome sem o prefixo da casa (`ROOT | `,
 *      `Root | `, `ROOT - `), normalizado, IGUAL ao de UM cliente (e, sem
 *      cliente, de UM lead) vira SUGESTÃO, que espera um clique. Parecido não
 *      sugere: aparece só na busca. Empate não sugere.
 *   3. O que a pessoa decidiu (`vinculadoPorId` preenchido: ligou, desligou ou
 *      marcou como equipe) nunca é refeito pelo casamento automático.
 *      Layout 26/10: a conversa marcada como comunidade também (é sempre decisão de pessoa).
 */

/** Os dígitos do telefone na forma da casa: só dígitos, com o 55 quando veio com DDD + número (10 ou 11). */
export function digitosDoTelefone(telefone: string | null | undefined): string {
  const d = String(telefone ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

/**
 * O telefone gravado (livre: "(32) 9 9999-8888", "+55 32 99999-8888",
 * "5532999998888") é o número da conversa? Igualdade exata depois de
 * `digitosDoTelefone`: com e sem 55 casam; com e sem o 9 NÃO casam.
 */
export function telefoneCasa(gravado: string | null | undefined, numeroDaConversa: string | null | undefined): boolean {
  const a = digitosDoTelefone(gravado);
  const b = digitosDoTelefone(numeroDaConversa);
  return a.length >= 12 && a === b;
}

/** As formas em que o número pode estar gravado em dígitos (com e sem o 55), para a consulta no banco. */
export function formasEmDigitos(numero: string): string[] {
  const d = digitosDoTelefone(numero);
  if (!d) return [];
  return d.startsWith('55') && (d.length === 12 || d.length === 13) ? [d, d.slice(2)] : [d];
}

export interface NomesDoAlvo {
  tipo: TipoDeVinculo;
  id: string;
  /** O nome que a tela mostra. */
  nome: string;
  /** Todos os nomes pelos quais o alvo pode ser chamado (lead: nome e empresa; cliente: fantasia e razão social). */
  nomes: readonly (string | null | undefined)[];
}

/** Os alvos cujo nome normalizado é IGUAL a `nome` (um por id). */
export function alvosComNomeIgual(nome: string, alvos: readonly NomesDoAlvo[]): NomesDoAlvo[] {
  const chave = normalizarNomeDeVinculo(nome);
  if (!chave) return [];
  const vistos = new Set<string>();
  const iguais: NomesDoAlvo[] = [];
  for (const a of alvos) {
    if (vistos.has(a.id)) continue;
    if (a.nomes.some((n) => normalizarNomeDeVinculo(n) === chave)) {
      vistos.add(a.id);
      iguais.push(a);
    }
  }
  return iguais;
}

export interface DecisaoDoGrupo {
  equipe: boolean;
  sugestao: SugestaoDeVinculo | null;
}

/**
 * O grupo: equipe pelo nome (sem vínculo), senão a sugestão por nome IGUAL a
 * UM cliente e, sem cliente igual nenhum, a UM lead. Nunca o vínculo.
 */
export function decidirGrupo(assunto: string | null | undefined, clientes: readonly NomesDoAlvo[], leads: readonly NomesDoAlvo[]): DecisaoDoGrupo {
  if (ehGrupoDaEquipePeloNome(assunto)) return { equipe: true, sugestao: null };
  const sem = nomeDoGrupoSemPrefixo(assunto);
  if (!sem) return { equipe: false, sugestao: null };
  const c = alvosComNomeIgual(sem, clientes);
  if (c.length === 1) return { equipe: false, sugestao: { tipo: 'cliente', id: c[0].id, nome: c[0].nome, como: 'nome_igual' } };
  if (c.length > 1) return { equipe: false, sugestao: null }; // empate: ninguém é sugerido
  const l = alvosComNomeIgual(sem, leads);
  if (l.length === 1) return { equipe: false, sugestao: { tipo: 'lead', id: l[0].id, nome: l[0].nome, como: 'nome_igual' } };
  return { equipe: false, sugestao: null };
}

export interface DecisaoDoUmAUm {
  equipe: boolean;
  leadId: string | null;
  clienteId: string | null;
}

/**
 * O 1:1: número da equipe = equipe (sem vínculo); senão o cliente ou, sem
 * cliente, o lead que tem o telefone, cada um só quando é ÚNICO. Nunca os dois.
 */
export function decidirUmAUm(ehDaEquipe: boolean, leadsComONumero: readonly string[], clientesComONumero: readonly string[]): DecisaoDoUmAUm {
  if (ehDaEquipe) return { equipe: true, leadId: null, clienteId: null };
  const unico = (ids: readonly string[]) => {
    const s = [...new Set(ids)];
    return s.length === 1 ? s[0] : null;
  };
  // Revisão 22C (A2): o lead que fechou vira cliente com o MESMO telefone (`cliente-do-lead.ts`
  // copia o número para o `Partner`), e a conversa só pode ter um vínculo (CHECK no banco).
  // Achando os dois, vale o cliente: é a relação que segue depois do fechamento.
  const clienteId = unico(clientesComONumero);
  return { equipe: false, leadId: clienteId ? null : unico(leadsComONumero), clienteId };
}

/** Os pares de letras de um nome normalizado (sem espaço). */
function pares(s: string): string[] {
  const t = s.replace(/ /g, '');
  if (t.length < 2) return t ? [t] : [];
  const r: string[] = [];
  for (let i = 0; i < t.length - 1; i++) r.push(t.slice(i, i + 2));
  return r;
}

/**
 * Quanto dois nomes se parecem, de 0 a 1 (coeficiente de Dice sobre os pares de
 * letras do nome normalizado). Serve SÓ para ordenar a busca: nenhuma decisão
 * de vínculo usa esta conta.
 */
export function semelhanca(a: string | null | undefined, b: string | null | undefined): number {
  const x = normalizarNomeDeVinculo(a);
  const y = normalizarNomeDeVinculo(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const px = pares(x);
  const py = pares(y);
  if (!px.length || !py.length) return 0;
  const conta = new Map<string, number>();
  for (const p of px) conta.set(p, (conta.get(p) ?? 0) + 1);
  let comum = 0;
  for (const p of py) {
    const n = conta.get(p) ?? 0;
    if (n > 0) {
      comum++;
      conta.set(p, n - 1);
    }
  }
  const dice = (2 * comum) / (px.length + py.length);
  // Um nome contido no outro ("cafe serra" em "cafe serra ltda") pesa um pouco mais.
  const contido = x.includes(y) || y.includes(x) ? 0.15 : 0;
  return Math.min(0.99, dice + contido);
}

export const TETO_DE_CANDIDATOS = 20;
/** Abaixo disto, sem busca digitada, o nome não é "parecido" o bastante para aparecer. */
export const PISO_DE_SEMELHANCA = 0.3;

export interface AlvoDaBusca extends NomesDoAlvo {
  detalhe: string | null;
}

/**
 * A lista da busca de vínculo: o IGUAL ao nome da conversa primeiro, depois o
 * mais parecido (com a busca digitada, o mais parecido com ela; sem ela, com o
 * nome da conversa e só acima do piso). Teto de 20.
 */
export function ordenarCandidatos(
  alvos: readonly AlvoDaBusca[],
  opcoes: { nomeDaConversa: string | null; busca: string | null; teto?: number },
): CandidatoDeVinculo[] {
  const base = normalizarNomeDeVinculo(opcoes.nomeDaConversa);
  const q = normalizarNomeDeVinculo(opcoes.busca);
  const teto = opcoes.teto ?? TETO_DE_CANDIDATOS;
  const vistos = new Set<string>();
  const pontuados: { c: CandidatoDeVinculo; igual: boolean; nota: number }[] = [];
  for (const a of alvos) {
    const chave = `${a.tipo}:${a.id}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const nomes = a.nomes.map((n) => normalizarNomeDeVinculo(n)).filter(Boolean);
    const igual = !!base && nomes.includes(base);
    let nota: number;
    if (q) {
      if (!nomes.some((n) => n.includes(q))) continue;
      nota = Math.max(...nomes.map((n) => semelhanca(n, q)));
    } else {
      nota = base ? Math.max(0, ...nomes.map((n) => semelhanca(n, base))) : 0;
      if (base && !igual && nota < PISO_DE_SEMELHANCA) continue;
    }
    pontuados.push({ c: { tipo: a.tipo, id: a.id, nome: a.nome, detalhe: a.detalhe, igual }, igual, nota });
  }
  pontuados.sort((x, y) => Number(y.igual) - Number(x.igual) || y.nota - x.nota || x.c.nome.localeCompare(y.c.nome, 'pt-BR'));
  return pontuados.slice(0, teto).map((p) => p.c);
}

/** O id curto (8 caracteres) que o script imprime: nunca nome nem número. */
export function idCurtoDaConversa(id: string): string {
  return id.slice(0, 8);
}

/** As ações da auditoria do vínculo (uma constante, para a suíte e o script falarem igual). */
export const ACAO_DE_AUDITORIA = {
  vinculada: 'whatsapp.conversa.vinculada',
  desvinculada: 'whatsapp.conversa.desvinculada',
  equipe: 'whatsapp.conversa.equipe',
  // Layout 26/10: marcar ou tirar da comunidade.
  comunidade: 'whatsapp.conversa.comunidade',
  telefoneDoLead: 'lead.telefone.definido',
  telefoneDoCliente: 'cliente.telefone.definido',
} as const;

/** As frases das recusas (a tela mostra como vieram). */
export const FRASE = {
  jaLigada: 'Esta conversa já está ligada a outro lead ou cliente. Desvincule antes de ligar a outro.',
  mudou: 'A conversa mudou enquanto você vinculava. Recarregue e tente de novo.',
  semSugestao: 'Esta conversa não tem sugestão de vínculo para aceitar.',
  equipeLigada: 'Esta conversa está ligada a um lead ou cliente. Desvincule antes de marcar como equipe.',
  comunidadeLigada: 'Esta conversa está ligada a um lead ou cliente. Desvincule antes de marcar como comunidade.',
  naoEUmAUm: 'Só a conversa 1:1 com número conhecido põe o telefone no lead.',
  leadComOutroTelefone: 'Este lead já tem outro telefone. Confirme a troca para gravar o número desta conversa.',
  numeroDeOutroLead: 'Este número já está em outro lead. Um número em dois leads deixaria a conversa sem dono.',
} as const;
