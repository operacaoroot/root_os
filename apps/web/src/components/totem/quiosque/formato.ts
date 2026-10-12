import type { TotemCatalogoConfig, TotemUnidadePreco } from '@mktos/shared';

/*
 * Formatos e regras pequenas do quiosque, puros para o teste.
 *
 * Datas de validade e de fabricação são dias de calendário gravados à meia-
 * noite UTC: lidas no fuso do aparelho (UTC-3), viravam o dia anterior. Por
 * isso saem pelas partes UTC. Reposição e sincronização são instantes e saem
 * no fuso local.
 */

const dois = (n: number) => String(n).padStart(2, '0');

export function dataDoCalendario(iso: string): string {
  const d = new Date(iso);
  return `${dois(d.getUTCDate())}/${dois(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

export function dataLocal(iso: string): string {
  const d = new Date(iso);
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function diaEMesLocal(iso: string): string {
  const d = new Date(iso);
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}`;
}

export function dataEHoraLocal(iso: string): string {
  const d = new Date(iso);
  return `${dataLocal(iso)} às ${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

const reais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const SUFIXO_DO_PRECO: Record<TotemUnidadePreco, string> = {
  kg: 'o quilo',
  '100g': 'a cada 100 g',
  un: 'a unidade',
};

export function textoDoPreco(centavos: number, unidade: TotemUnidadePreco): string {
  return `${reais.format(centavos / 100)} ${SUFIXO_DO_PRECO[unidade]}`;
}

export function numeroBr(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

/** `Porção de 30 g (1/2 fatia média)`, no mesmo formato da página pública do produto. Sem porção, `null`. */
export function textoDaPorcao(porcaoG: number | null, descricao: string | null): string | null {
  const texto = descricao?.trim() || null;
  if (porcaoG == null && !texto) return null;
  if (porcaoG == null) return `Porção: ${texto}`;
  const gramas = `Porção de ${numeroBr(porcaoG)} g`;
  return texto ? `${gramas} (${texto})` : gramas;
}

const CAMINHOS_DO_TOTEM = ['/totem', '/totem/quiosque', '/totem/privacidade'];

/**
 * O quiosque só navega dentro de `/totem`. Link para qualquer outro lugar
 * (outra origem, `/totem-gestao`, `/entrar`) é bloqueado no clique.
 */
export function linkPermitido(href: string, origem: string): boolean {
  let url: URL;
  try {
    url = new URL(href, origem);
  } catch {
    return false;
  }
  if (url.origin !== new URL(origem).origin) return false;
  const caminho = url.pathname.replace(/\/+$/, '') || '/';
  return CAMINHOS_DO_TOTEM.includes(caminho);
}

export function ehLinkDaPrivacidade(href: string, origem: string): boolean {
  if (!linkPermitido(href, origem)) return false;
  return new URL(href, origem).pathname.replace(/\/+$/, '') === '/totem/privacidade';
}

// --- Tema ---

/** Os tokens do design system do Senhor aGranel (v0.1) que o quiosque usa. */
export const TOTEM_CORES_DA_MARCA = {
  primaria: '#28371D',
  fundo: '#F5F3EC',
  cartao: '#FBFAF5',
  afundado: '#E7E4D8',
  linha: '#CFCFC2',
  linhaForte: '#7E8372',
  tinta: '#16200F',
  tintaSuave: '#5A6450',
  claro: '#F5F3EC',
  destaque: '#CB8139',
  destaqueTinta: '#9A5A1C',
  destaqueClaro: '#E39A5E',
  creme: '#EEEAC4',
  musgoClaro: '#C9CBB5',
  sucesso: '#3F6B2A',
  sucessoFundo: '#E3EBD8',
  atencao: '#93551A',
  atencaoFundo: '#F8EBDC',
  perigo: '#B3361A',
  perigoFundo: '#F8DED5',
} as const;

function luminancia(hex: string): number {
  const canal = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
}

export function ehCorEscura(hex: string): boolean {
  return luminancia(hex) < 0.18;
}

/**
 * As variáveis de cor do quiosque: os tokens da marca, com a cor primária e o
 * fundo da configuração por cima. A tinta sobre cada uma sai pela luminância,
 * para uma cor clara escolhida no painel não deixar o texto branco ilegível.
 */
export function temaDoQuiosque(config: Pick<TotemCatalogoConfig, 'corPrimaria' | 'corFundo'> | null): Record<string, string> {
  const m = TOTEM_CORES_DA_MARCA;
  const primaria = config?.corPrimaria ?? m.primaria;
  const fundo = config?.corFundo ?? m.fundo;
  return {
    '--q-primaria': primaria,
    '--q-sobre-primaria': ehCorEscura(primaria) ? m.claro : m.tinta,
    // Os tons de apoio sobre a primária: a chamada laranja e o creme dos posts
    // da marca só funcionam sobre cor escura.
    '--q-primaria-chamada': ehCorEscura(primaria) ? m.destaque : m.tinta,
    '--q-primaria-apoio': ehCorEscura(primaria) ? m.creme : m.tinta,
    '--q-primaria-rotulo': ehCorEscura(primaria) ? m.destaqueClaro : m.destaqueTinta,
    '--q-primaria-suave': ehCorEscura(primaria) ? m.musgoClaro : m.tintaSuave,
    '--q-fundo': fundo,
    '--q-sobre-fundo': ehCorEscura(fundo) ? m.claro : m.tinta,
    '--q-sobre-fundo-suave': ehCorEscura(fundo) ? m.linha : m.tintaSuave,
    '--q-cartao': m.cartao,
    '--q-afundado': m.afundado,
    '--q-linha': m.linha,
    '--q-linha-forte': m.linhaForte,
    '--q-tinta': m.tinta,
    '--q-tinta-suave': m.tintaSuave,
    '--q-destaque': m.destaque,
    '--q-destaque-tinta': m.destaqueTinta,
    '--q-sucesso': m.sucesso,
    '--q-sucesso-fundo': m.sucessoFundo,
    '--q-atencao': m.atencao,
    '--q-atencao-fundo': m.atencaoFundo,
    '--q-perigo': m.perigo,
    '--q-perigo-fundo': m.perigoFundo,
  };
}
