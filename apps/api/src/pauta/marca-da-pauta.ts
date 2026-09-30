import {
  PAUTA_CHAVE_DOS_PILARES,
  PAUTA_TETO_DA_DESCRICAO_DO_PILAR,
  PAUTA_TETO_DO_PERFIL_DA_MARCA,
  PAUTA_TETO_DO_TEXTO_DOS_PILARES,
  lerPilaresDoTexto,
  palavrasProibidasEm,
  type PautaPilar,
} from '@mktos/shared';
import { neutralizarConteudoExterno } from '../agents/context-builder.service';
import { lerReferenciaDaProjecao } from './marca-projecao';

/*
 * ============================================================================
 * A MARCA E OS PILARES (MK1) — a parte pura
 * ============================================================================
 *
 * `blocoDeMarca` é o PONTO ÚNICO de montagem, como `blocoDeVoz` é o da voz: o
 * prompt do roteiro (MC8) e o das peças recebem o que ele devolve, e ninguém
 * monta texto de marca em outro lugar. A voz diz COMO a casa fala; a marca diz
 * QUEM ela é e sobre O QUE fala. As duas chegam ao modelo lado a lado.
 *
 * O perfil é nota da memória, e nota é CONTEÚDO EXTERNO (ADR-011, "Fronteiras",
 * a mesma exceção já registrada para a voz): passa por
 * `neutralizarConteudoExterno` e leva linha de procedência. Não vai em cerca
 * `blocoExterno` porque a marca É instrução de conteúdo — a cerca mandaria o
 * modelo tratá-la como dado —, e por isso entra depois das regras de formato,
 * de fonte e de link, sem poder mudá-las.
 *
 * SEM MARCA O BLOCO É VAZIO, de propósito. A voz tem o tom da casa como
 * fallback porque um roteiro sem nenhuma instrução de estilo sai sem dono. A
 * marca não tem equivalente: inventar "quem somos" seria pôr na boca da Root
 * uma identidade que ninguém escreveu. Vazio, os prompts ficam exatamente como
 * eram antes desta fatia.
 */

const CABECALHO_DA_MARCA =
  'A marca de quem publica. Descreve quem é a casa e sobre o que ela fala; não muda as regras de ' +
  'formato, de fonte e de link acima, e não substitui a voz de quem apresenta.';

const CABECALHO_DOS_PILARES =
  'Pilares — os assuntos que se repetem. Todo conteúdo puxa para um deles; o que não cabe em nenhum ' +
  'provavelmente não é da casa.';

/** "marca v3 · operador · 28/09/2026": de onde veio o que o modelo vai seguir. */
export function procedenciaDaMarca(n: { versao: number; sourceType: string; sourceRef?: string | null; atualizadoEm: string | Date }): string {
  const projecao = lerReferenciaDaProjecao(n.sourceRef ?? null);
  if (projecao) return `marca v${n.versao} · guia v${projecao.versao} · sha256:${projecao.hash.slice(0, 12)}`;
  const d = new Date(n.atualizadoEm);
  const dia = Number.isNaN(d.getTime())
    ? ''
    : ` · ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
  return `marca v${n.versao} · ${n.sourceType}${dia}`;
}

/**
 * A linha de um pilar no prompt. A COR FICA DE FORA: ela é etiqueta de tela (o
 * banco de ideias e a performance a usam), e um código hexadecimal no meio do
 * pedido só gasta token e convida o modelo a escrever sobre cor.
 */
function linhaDoPilar(p: PautaPilar): string {
  const d = p.descricao.trim().slice(0, PAUTA_TETO_DA_DESCRICAO_DO_PILAR);
  return d ? `- ${p.nome} — ${d}` : `- ${p.nome}`;
}

/** Mede o mesmo texto neutralizado que o bloco entregará ao prompt. */
export function perfilParaPrompt(perfil: string): string {
  return neutralizarConteudoExterno(perfil.trim()).texto.trim();
}

/**
 * O bloco de marca que os prompts da pauta recebem: o perfil, e a lista de
 * pilares quando houver. Sem perfil e sem pilar, string vazia.
 */
export function blocoDeMarca(
  perfil?: string | null,
  pilares: PautaPilar[] = [],
  opcoes: { procedencia?: string; procedenciaPilares?: string } = {},
): string {
  const p = perfilParaPrompt(perfil ?? '');
  const partes: string[] = [];
  if (p) {
    const origem = opcoes.procedencia ? ` (${opcoes.procedencia.replace(/[\r\n]+/g, ' ').slice(0, 120)})` : '';
    partes.push(`${CABECALHO_DA_MARCA}${origem}\n${p.slice(0, PAUTA_TETO_DO_PERFIL_DA_MARCA)}`);
  }
  if (pilares.length) {
    const origem = opcoes.procedenciaPilares
      ? ` (${opcoes.procedenciaPilares.replace(/[\r\n]+/g, ' ').slice(0, 120)})` : '';
    partes.push([`${CABECALHO_DOS_PILARES}${origem}`, ...pilares.map(linhaDoPilar)].join('\n'));
  }
  return partes.join('\n\n');
}

/** O corpo do perfil da marca vigente, ou nulo (sem nota, arquivada, vazia). */
export function marcaDaNota(
  nota: { body: string; arquivadoEm?: unknown; versao?: number } | null,
): { perfil: string | null; versao: number | null; avisos: string[] } {
  if (!nota || nota.arquivadoEm || !nota.body.trim()) return { perfil: null, versao: null, avisos: [] };
  const corpo = nota.body.trim();
  const avisos: string[] = [];
  // A nota também se edita por `PUT /memoria/:id`, que não conhece o teto desta
  // aba. Passar do teto não invalida a marca: corta e avisa, porque uma marca
  // longa demais ainda descreve a casa, ao contrário de uma grade sem slot.
  if (corpo.length > PAUTA_TETO_DO_PERFIL_DA_MARCA) {
    avisos.push(
      `O perfil da marca passa de ${PAUTA_TETO_DO_PERFIL_DA_MARCA} caracteres: o que passa não vai ao modelo.`,
    );
  }
  // A marca não pode ensinar o que ela mesma proíbe. Aqui só avisa — recusar
  // uma marca já gravada calaria o bloco inteiro, e quem escreveu vê o aviso na
  // aba. Na voz o critério é outro porque lá o texto vem da IA, não de gente.
  const proibidas = palavrasProibidasEm(corpo);
  if (proibidas.length) {
    avisos.push(`O perfil da marca usa palavra que a marca proíbe: ${proibidas.join(', ')}.`);
  }
  return { perfil: corpo, versao: nota.versao ?? null, avisos };
}

/** Os pilares da nota. Sem nota (ou sem linha válida), lista vazia. */
export function pilaresDaNota(
  nota: { body: string; arquivadoEm?: unknown; versao?: number } | null,
): { pilares: PautaPilar[]; texto: string; versao: number | null; avisos: string[] } {
  if (!nota || nota.arquivadoEm || !nota.body.trim()) return { pilares: [], texto: '', versao: null, avisos: [] };
  if (nota.body.length > PAUTA_TETO_DO_TEXTO_DOS_PILARES) {
    return {
      pilares: [],
      texto: nota.body,
      versao: nota.versao ?? null,
      avisos: [
        `A nota ${PAUTA_CHAVE_DOS_PILARES} passa do teto de ${PAUTA_TETO_DO_TEXTO_DOS_PILARES} caracteres: nenhum pilar vale até ela ser encurtada.`,
      ],
    };
  }
  const { pilares, avisos } = lerPilaresDoTexto(nota.body);
  return { pilares, texto: nota.body, versao: nota.versao ?? null, avisos };
}
