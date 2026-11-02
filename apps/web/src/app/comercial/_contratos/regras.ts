/*
 * AS CONTAS DA TELA DE CONTRATOS (fase F4, 02/11/2026). Funções puras.
 *
 * Etapa e movimento vêm de `@mktos/shared` (`comercial-contratos.ts`), o contrato com
 * a API: aqui mora só o que é da tela, como o endereço da visão, a busca, os chips do
 * cartão e o passo que cada gesto abre. O gesto nunca grava nada: ele abre a aba
 * Contrato do painel do lead no passo certo.
 */
import {
  ETAPAS_DO_QUADRO,
  acaoDoMovimento,
  diasAteOFim,
  ROTULO_DA_MODALIDADE,
  type AcaoDoMovimento,
  type ContratoNoQuadro,
  type ContratoVivo,
  type EtapaDoQuadro,
} from '@mktos/shared';

export const CAMINHO_DO_QUADRO = '/comercial/contratos/quadro';
export const CAMINHO_DO_REGISTRO = '/comercial/contratos/registro';
export const CAMINHO_DO_LOTE = '/comercial/contratos/lote';

export const FRASE_SEM_ZAPSIGN = 'A ZapSign não está configurada nesta instância: nenhum contrato sai para assinatura.';
export const FRASE_RETIDA = 'Foi para Aprovações: outra pessoa precisa confirmar.';

export const VISOES_DOS_CONTRATOS = ['quadro', 'lista', 'vivos'] as const;
export type VisaoDosContratos = (typeof VISOES_DOS_CONTRATOS)[number];

/** A visão pedida no endereço. O quadro é o padrão e não ocupa a query. */
export function visaoDaUrl(busca: string): VisaoDosContratos {
  const v = new URLSearchParams(busca).get('visao');
  return v === 'lista' || v === 'vivos' ? v : 'quadro';
}

/** O endereço com a visão trocada, sem perder o resto da query (o painel aberto, por exemplo). */
export function urlComVisao(pathname: string, busca: string, visao: VisaoDosContratos): string {
  const q = new URLSearchParams(busca);
  if (visao === 'quadro') q.delete('visao');
  else q.set('visao', visao);
  const resto = q.toString();
  return resto ? `${pathname}?${resto}` : pathname;
}

/** O passo que o gesto abre na aba Contrato. Viaja no `campo` do painel. */
export type PassoDoContrato = 'minuta' | 'envio' | 'encerrar' | 'reabrir';

export const PASSO_DA_ACAO: Record<AcaoDoMovimento, PassoDoContrato> = {
  gerar_minuta: 'minuta',
  pedir_aprovacao: 'envio',
  encerrar: 'encerrar',
  reabrir: 'reabrir',
};

export const ROTULO_DA_ACAO: Record<AcaoDoMovimento, string> = {
  gerar_minuta: 'abre a minuta',
  pedir_aprovacao: 'abre o envio',
  encerrar: 'abre o encerramento',
  reabrir: 'abre a reabertura',
};

export function passoDoCampo(campo: string | null | undefined): PassoDoContrato | null {
  return campo === 'minuta' || campo === 'envio' || campo === 'encerrar' || campo === 'reabrir' ? campo : null;
}

/**
 * O movimento na tela: a regra do contrato compartilhado, menos reabrir o contrato
 * importado, que só tem as rotas antigas de encerrar (nenhuma reabre).
 */
export function acaoNaTela(item: ContratoNoQuadro, destino: EtapaDoQuadro): AcaoDoMovimento | null {
  const acao = acaoDoMovimento(item, destino);
  return acao === 'reabrir' && item.importado ? null : acao;
}

export function destinosDoCartao(item: ContratoNoQuadro): { etapa: EtapaDoQuadro; acao: AcaoDoMovimento }[] {
  return ETAPAS_DO_QUADRO.flatMap((etapa) => {
    const acao = acaoNaTela(item, etapa);
    return acao ? [{ etapa, acao }] : [];
  });
}

const soDigitos = (t: string) => t.replace(/\D/g, '');
const semAcento = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');

export interface FiltrosDosContratos {
  busca: string;
  dono: string;
  etapa: '' | EtapaDoQuadro;
}

/**
 * Busca por cliente, contato e número do contrato. O cartão não traz CNPJ: ele vem do
 * mapa dos contratos vivos, então só acha quem já tem contrato vivo.
 */
export function filtrarContratos(itens: readonly ContratoNoQuadro[], f: FiltrosDosContratos, cnpjs: ReadonlyMap<string, string> = new Map()): ContratoNoQuadro[] {
  const q = f.busca.trim();
  const digitos = soDigitos(q);
  return itens.filter((c) => {
    if (f.dono && c.dono !== f.dono) return false;
    if (f.etapa && c.etapa !== f.etapa) return false;
    if (!q) return true;
    const texto = semAcento([c.cliente, c.contato, c.numero].filter(Boolean).join(' '));
    if (texto.includes(semAcento(q))) return true;
    const cnpj = cnpjs.get(c.leadId);
    return !!digitos && !!cnpj && soDigitos(cnpj).includes(digitos);
  });
}

/** Data absoluta com o ano: "14/12/2026". Aceita AAAA-MM-DD e instante; instante é lido em São Paulo. */
export function dataCompleta(data: string | null | undefined): string {
  if (!data) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(data);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

/** A resposta foi retida pela política? Aí não houve efeito nenhum, e a tela nunca diz que deu certo. */
export function foiParaAprovacoes(r: unknown): boolean {
  return !!r && typeof r === 'object' && (r as { status?: unknown }).status === 'aguardando_aprovacao';
}

export type TomDoChip = 'neutro' | 'alerta';

/** Os chips do cartão: cada estado tem palavra. Verde não entra: assinado não é sinal de sucesso. */
export function chipsDoCartao(c: ContratoNoQuadro, hoje: string): { texto: string; tom: TomDoChip }[] {
  if (c.fantasma) return [{ texto: 'sem contrato', tom: 'alerta' }];
  const chips: { texto: string; tom: TomDoChip }[] = [];
  const vigente = c.etapa === 'ativo' || c.etapa === 'renovar' || c.etapa === 'a_encerrar';
  if (c.importado) chips.push({ texto: 'importado', tom: 'neutro' });
  if (vigente && !c.temPdf) chips.push({ texto: 'sem PDF', tom: 'alerta' });
  if (vigente && !c.vigenciaFim) chips.push({ texto: 'sem vigência', tom: 'neutro' });
  if (c.assinaturas && c.etapa === 'em_assinatura') chips.push({ texto: `${c.assinaturas.feitas} de ${c.assinaturas.total} assinaram`, tom: 'neutro' });
  if (c.lacunas) chips.push({ texto: c.lacunas === 1 ? '1 lacuna' : `${c.lacunas} lacunas`, tom: 'alerta' });
  if (c.aditivos > 0) chips.push({ texto: c.aditivos === 1 ? '1 aditivo' : `${c.aditivos} aditivos`, tom: 'neutro' });
  if (c.etapa === 'renovar' && c.vigenciaFim) {
    const dias = diasAteOFim(c.vigenciaFim, hoje);
    chips.push({ texto: dias < 0 ? `venceu há ${-dias} dias` : dias === 0 ? 'vence hoje' : `faltam ${dias} dias`, tom: 'alerta' });
  }
  if (c.etapa === 'a_encerrar') chips.push({ texto: 'decidir', tom: 'alerta' });
  return chips;
}

export function linhaDoCartao(c: ContratoNoQuadro): string {
  const partes: string[] = [];
  if (c.fantasma && c.contato) partes.push(c.contato);
  if (c.modalidade) partes.push(ROTULO_DA_MODALIDADE[c.modalidade]);
  if (c.numero) partes.push(`nº ${c.numero}`);
  if (c.vigenciaFim) partes.push(`${c.etapa === 'encerrado' ? 'vigência até' : c.etapa === 'renovar' ? 'vence em' : 'vigente até'} ${dataCompleta(c.vigenciaFim)}`);
  return partes.join(' · ');
}

/** Quantas parcelas seguem em aberto: as da cobrança e as lançadas à mão nos importados. */
export function parcelasEmAberto(v: Pick<ContratoVivo, 'parcelas' | 'importados'>): number {
  const daCobranca = v.parcelas.filter((p) => p.estado !== 'paga').length;
  const lancadas = (v.importados ?? []).reduce((soma, c) => soma + (c.parcelasManuais?.linhas ?? []).filter((p) => p.estado !== 'paga').length, 0);
  return daCobranca + lancadas;
}

export const ETAPAS_DA_FICHA = ['A emitir', 'Minuta', 'Em assinatura', 'Ativo', 'Encerrado'] as const;

/** Em que degrau da linha da ficha o contrato está. Renovar e A encerrar seguem vigentes. */
export function degrauDaFicha(etapa: EtapaDoQuadro): number {
  switch (etapa) {
    case 'a_emitir':
      return 0;
    case 'minuta':
      return 1;
    case 'em_assinatura':
      return 2;
    case 'ativo':
    case 'renovar':
    case 'a_encerrar':
      return 3;
    case 'encerrado':
      return 4;
  }
}

/** Qual contrato do lead a aba mostra: o que o gesto pediu, senão o primeiro que não terminou. */
export function contratoDoPasso(reais: readonly ContratoNoQuadro[], passo: PassoDoContrato | null): ContratoNoQuadro | null {
  const achar = (etapas: EtapaDoQuadro[]) => reais.find((c) => etapas.includes(c.etapa));
  const pedido =
    passo === 'encerrar' ? achar(['ativo', 'renovar', 'a_encerrar'])
    : passo === 'reabrir' ? achar(['encerrado'])
    : passo === 'envio' ? achar(['minuta'])
    : passo === 'minuta' ? achar(['a_emitir', 'minuta'])
    : null;
  return pedido ?? reais.find((c) => c.etapa !== 'encerrado') ?? reais[0] ?? null;
}
