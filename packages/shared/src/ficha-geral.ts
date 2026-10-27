import { z } from 'zod';

import {
  COMERCIAL_CANAIS_DE_ENTRADA,
  COMERCIAL_PRODUTOS,
  COMERCIAL_TIPOS_DE_NEGOCIO,
  type ComercialEtapa,
  type FichaDoLead,
} from './comercial.js';

/*
 * A FICHA GERAL DO LEAD (leva 5, L4, 27/10/2026).
 *
 * A primeira tela do painel do lead passou a ser a aba "Geral": três cartões
 * (Quem · Origem · Negócio) com rótulo pequeno em cima e valor grande embaixo,
 * no modelo da ficha "Sessão Estratégica" do escritório (só a estrutura; nenhum
 * dado). Campo vazio aparece em cinza com "preencher" e vira editável no clique.
 * A aba "Pendências e sugestões" lista o que falta preencher e os próximos passos.
 *
 * Este arquivo é o contrato entre a API e a tela: a lista fechada de "como
 * conheceu", o tipo de pessoa, os campos da ficha geral (e quais estão vazios),
 * o corpo do PATCH da ficha, os passos sugeridos e a nota manual do fio.
 *
 * O que já existia na ficha (empresa, canal, vendedor, valor negociado, tipo do
 * negócio, parcelas) continua no mesmo lugar e muda pelos mesmos fatos do fio.
 * Só entraram colunas para o que faltava: tipo de pessoa, preferências de
 * atendimento e o link da proposta escrito à mão.
 */

// ---------------------------------------------------------------------------
// Listas fechadas
// ---------------------------------------------------------------------------

export const TIPOS_DE_PESSOA = ['PJ', 'PF'] as const;
export type TipoDePessoa = (typeof TIPOS_DE_PESSOA)[number];
export const ROTULO_DO_TIPO_DE_PESSOA: Record<TipoDePessoa, string> = { PJ: 'Pessoa jurídica', PF: 'Pessoa física' };

/** "Como conheceu": a lista fechada da reunião de 26/10. Vai na coluna `canal` da ficha. */
export const COMO_CONHECEU = ['indicacao_cliente', 'indicacao_parceiro', 'bni', 'evento', 'rede_social', 'site', 'comunidade', 'outro'] as const;
export type ComoConheceu = (typeof COMO_CONHECEU)[number];

/**
 * O rótulo de cada canal: os oito da lista nova e os três do C07 que já estão
 * gravados em fichas antigas (`conteudo`, `erp_parceiro`, `indicacao`). Os
 * antigos continuam legíveis; a tela só oferece os novos para escolher.
 */
export const ROTULO_DO_COMO_CONHECEU: Readonly<Record<string, string>> = {
  indicacao_cliente: 'Indicação de cliente',
  indicacao_parceiro: 'Indicação de parceiro',
  bni: 'BNI',
  evento: 'Evento',
  rede_social: 'Rede social',
  site: 'Site',
  comunidade: 'Comunidade',
  outro: 'Outro',
  conteudo: 'Conteúdo',
  erp_parceiro: 'ERP parceiro',
  indicacao: 'Indicação',
};

/** O que a API aceita na coluna `canal`: a lista nova e a antiga (um lead antigo relido não é recusado). */
export const CANAIS_ACEITOS_NA_FICHA: readonly string[] = [...new Set<string>([...COMO_CONHECEU, ...COMERCIAL_CANAIS_DE_ENTRADA])];

export function rotuloDoCanal(canal: string | null | undefined): string | null {
  if (!canal) return null;
  return ROTULO_DO_COMO_CONHECEU[canal] ?? canal;
}

/** A pessoa precisa dizer de quem veio a indicação? (os dois canais de indicação, novos e antigo) */
export function canalPedeOrigemDaIndicacao(canal: string | null | undefined): boolean {
  return canal === 'indicacao_cliente' || canal === 'indicacao_parceiro' || canal === 'indicacao';
}

// ---------------------------------------------------------------------------
// O que a API devolve a mais para a aba Geral (`GET /comercial/lead/:id/geral`)
// ---------------------------------------------------------------------------

/** De onde vem o link da proposta mostrado na ficha. */
export type OrigemDoLinkDaProposta = 'manual' | 'servico' | 'sala';

export interface PropostaNaFichaGeral {
  /** Nula quando não há proposta de nenhum lado. */
  origem: OrigemDoLinkDaProposta | null;
  /** O link escrito à mão (`manual`), ou nulo. O da sala nunca sai aqui: ele é copiado por `POST .../sala/link`. */
  link: string | null;
  /** A referência da proposta do serviço vinculada (`servico:<cliente>/<chave>`), quando houver. */
  ref: string | null;
  /** A versão publicada na sala, quando houver. */
  versao: number | null;
}

export interface FichaGeralExtra {
  leadId: string;
  tipoDePessoa: TipoDePessoa | null;
  preferenciasDeAtendimento: string | null;
  /** A 1ª parcela em centavos (`ComercialFicha.parcelaCentavos`). */
  parcelaCentavos: number | null;
  proposta: PropostaNaFichaGeral;
  /** Depois do aceite, produto, parcelas e valor são do contrato: a ficha não os edita mais. */
  negocioTravado: boolean;
}

// ---------------------------------------------------------------------------
// Os campos da ficha geral, por cartão
// ---------------------------------------------------------------------------

export const BLOCOS_DA_FICHA_GERAL = ['quem', 'origem', 'negocio'] as const;
export type BlocoDaFichaGeral = (typeof BLOCOS_DA_FICHA_GERAL)[number];
export const ROTULO_DO_BLOCO: Record<BlocoDaFichaGeral, string> = { quem: 'Quem', origem: 'Origem', negocio: 'Negócio' };

export interface CampoDaFichaGeral {
  chave: ChaveDaFichaGeral;
  rotulo: string;
  bloco: BlocoDaFichaGeral;
  /** Campo que nunca conta como "falta preencher" (tem padrão, ou é só leitura). */
  semCobranca?: boolean;
}

export type ChaveDaFichaGeral =
  | 'empresa'
  | 'nome'
  | 'tipoDePessoa'
  | 'telefone'
  | 'email'
  | 'preferenciasDeAtendimento'
  | 'canal'
  | 'origemIndicacao'
  | 'vendedorId'
  | 'socioDaConta'
  | 'produto'
  | 'tipoNegocio'
  | 'valorNegociado'
  | 'parcelas'
  | 'parcela'
  | 'linkDaProposta'
  | 'etapa';

export const CAMPOS_DA_FICHA_GERAL: readonly CampoDaFichaGeral[] = [
  { chave: 'empresa', rotulo: 'Empresa', bloco: 'quem' },
  { chave: 'nome', rotulo: 'Contato', bloco: 'quem' },
  { chave: 'tipoDePessoa', rotulo: 'Tipo de pessoa', bloco: 'quem' },
  { chave: 'telefone', rotulo: 'WhatsApp', bloco: 'quem' },
  { chave: 'email', rotulo: 'E-mail', bloco: 'quem' },
  { chave: 'preferenciasDeAtendimento', rotulo: 'Preferências de atendimento', bloco: 'quem' },
  { chave: 'canal', rotulo: 'Como conheceu', bloco: 'origem' },
  { chave: 'origemIndicacao', rotulo: 'Origem da indicação', bloco: 'origem' },
  { chave: 'vendedorId', rotulo: 'Vendedor', bloco: 'origem' },
  { chave: 'socioDaConta', rotulo: 'Sócio responsável', bloco: 'origem' },
  { chave: 'produto', rotulo: 'Produto', bloco: 'negocio' },
  { chave: 'tipoNegocio', rotulo: 'Tipo do negócio', bloco: 'negocio', semCobranca: true },
  { chave: 'valorNegociado', rotulo: 'Valor negociado', bloco: 'negocio' },
  { chave: 'parcelas', rotulo: 'Quantidade de parcelas', bloco: 'negocio' },
  { chave: 'parcela', rotulo: '1ª parcela', bloco: 'negocio' },
  { chave: 'linkDaProposta', rotulo: 'Link da proposta', bloco: 'negocio' },
  { chave: 'etapa', rotulo: 'Etapa atual', bloco: 'negocio', semCobranca: true },
];

export function campoDaFichaGeral(chave: ChaveDaFichaGeral): CampoDaFichaGeral {
  return CAMPOS_DA_FICHA_GERAL.find((c) => c.chave === chave)!;
}

/** O que a tela precisa da ficha para saber o que está vazio. */
export type FichaParaOsCampos = Pick<
  FichaDoLead,
  'nome' | 'empresa' | 'telefone' | 'email' | 'canal' | 'origemIndicacao' | 'vendedor' | 'socioDaConta' | 'produto' | 'tipoNegocio' | 'valorNegociadoCentavos' | 'parcelas' | 'etapa'
>;

/** Os valores crus de cada campo, nulos quando vazios. O `extra` pode ainda não ter chegado (nulo). */
export function valoresDaFichaGeral(f: FichaParaOsCampos, extra: FichaGeralExtra | null): Record<ChaveDaFichaGeral, string | number | null> {
  const texto = (v: string | null | undefined) => (v && v.trim() ? v : null);
  // O `extra` pode chegar pela metade (dublê, versão antiga da API): nada aqui lança.
  const proposta = extra?.proposta ?? null;
  const linkDaProposta = proposta ? proposta.link ?? proposta.ref ?? (proposta.versao ? `v${proposta.versao}` : null) : null;
  return {
    empresa: texto(f.empresa),
    nome: texto(f.nome),
    tipoDePessoa: extra?.tipoDePessoa ?? null,
    telefone: texto(f.telefone),
    email: texto(f.email),
    preferenciasDeAtendimento: texto(extra?.preferenciasDeAtendimento),
    canal: texto(f.canal),
    origemIndicacao: texto(f.origemIndicacao),
    vendedorId: f.vendedor?.id ?? null,
    socioDaConta: texto(f.socioDaConta?.nome),
    produto: texto(f.produto),
    tipoNegocio: f.tipoNegocio ?? 'pagante',
    valorNegociado: f.valorNegociadoCentavos ?? null,
    parcelas: f.parcelas ?? null,
    parcela: extra?.parcelaCentavos ?? null,
    linkDaProposta,
    etapa: f.etapa,
  };
}

/**
 * Os campos vazios da aba Geral, na ordem dos cartões. "Origem da indicação" só
 * conta quando o canal é indicação; os campos com padrão (tipo do negócio) e os
 * só de leitura (etapa) nunca contam. Sem o `extra`, os campos dele não contam
 * (a tela não cobra o que ainda não leu).
 */
export function camposVazios(f: FichaParaOsCampos, extra: FichaGeralExtra | null): CampoDaFichaGeral[] {
  const v = valoresDaFichaGeral(f, extra);
  const doExtra = new Set<ChaveDaFichaGeral>(['tipoDePessoa', 'preferenciasDeAtendimento', 'parcela', 'linkDaProposta']);
  return CAMPOS_DA_FICHA_GERAL.filter((c) => {
    if (c.semCobranca) return false;
    if (!extra && doExtra.has(c.chave)) return false;
    if (c.chave === 'origemIndicacao' && !canalPedeOrigemDaIndicacao(v.canal as string | null)) return false;
    return v[c.chave] == null;
  });
}

// ---------------------------------------------------------------------------
// O PATCH da ficha (`PATCH /comercial/lead/:id/ficha`)
// ---------------------------------------------------------------------------

const Texto = (max: number) => z.string().trim().max(max);
/** Vazio vira nulo: a tela manda "" quando a pessoa apaga o campo. */
const TextoOuNulo = (max: number) => Texto(max).transform((s) => (s === '' ? null : s)).nullable();
const Reais = z.number().finite().min(0, 'O valor não pode ser negativo.').max(100_000_000, 'Valor acima do teto.');

export const FichaGeralPatchSchema = z
  .object({
    nome: Texto(120).min(1, 'O nome do contato não pode ficar vazio.').optional(),
    empresa: TextoOuNulo(200).optional(),
    email: TextoOuNulo(200)
      .refine((v) => v == null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'E-mail inválido.')
      .optional(),
    tipoDePessoa: z.enum(TIPOS_DE_PESSOA).nullable().optional(),
    preferenciasDeAtendimento: TextoOuNulo(400).optional(),
    canal: TextoOuNulo(40).optional(),
    origemIndicacao: TextoOuNulo(200).optional(),
    vendedorId: TextoOuNulo(64).optional(),
    socioDaConta: TextoOuNulo(120).optional(),
    produto: z.enum(COMERCIAL_PRODUTOS).nullable().optional(),
    tipoNegocio: z.enum(COMERCIAL_TIPOS_DE_NEGOCIO).optional(),
    /** Em reais (a tela digita reais; a ficha guarda centavos). */
    valorNegociado: Reais.nullable().optional(),
    parcelas: z.number().int().min(1, 'Ao menos uma parcela.').max(120, 'Até 120 parcelas.').nullable().optional(),
    /** A 1ª parcela, em reais. */
    parcela: Reais.nullable().optional(),
    linkDaProposta: TextoOuNulo(500)
      .refine((v) => v == null || /^https:\/\/[^\s]+$/i.test(v), 'O link da proposta precisa começar com https://.')
      .optional(),
  })
  .strict();
export type FichaGeralPatch = z.infer<typeof FichaGeralPatchSchema>;

// ---------------------------------------------------------------------------
// Pendências e sugestões (`GET /comercial/lead/:id/pendencias`)
// ---------------------------------------------------------------------------

/** De onde o passo veio: a próxima ação da ficha, o portão da etapa, uma decisão aberta, uma automação que falhou, um fato de pendência. */
export type OrigemDoPasso = 'proxima_acao' | 'portao' | 'decisao' | 'automacao' | 'fato';

/** O que o botão "fazer" faz: troca de aba no painel (com o campo a focar) ou abre um endereço. */
export type AcaoDoPasso = { tipo: 'aba'; aba: string; campo?: string | null } | { tipo: 'link'; href: string };

export interface PassoSugerido {
  /** A identidade do passo: é o que "marcar como feito" grava na nota e o que a lista esconde depois. */
  chave: string;
  titulo: string;
  detalhe: string | null;
  origem: OrigemDoPasso;
  /** O prazo, quando houver. */
  quando: string | null;
  vencido: boolean;
  /** Desde quando o passo existe: a nota "feito" só vale se for posterior. */
  desde: string;
  acao: AcaoDoPasso | null;
  /** Só na automação que falhou: fazer à mão e subir o documento que ela não entregou. */
  podeFazerAMao: boolean;
  podeSubirDocumento: boolean;
}

export interface PendenciasDoLead {
  leadId: string;
  etapa: ComercialEtapa;
  passos: PassoSugerido[];
  /** Os passos marcados como feitos (escondidos) desde a última leitura, para a tela poder dizer "N feitos". */
  feitos: number;
  geradoEm: string;
}

/** A nota manual do fio (`POST /comercial/lead/:id/fio/nota`): o texto e, quando marca um passo como feito, a chave dele. */
export const NotaManualSchema = z
  .object({
    texto: Texto(1000).min(1, 'Escreva a nota.'),
    feito: Texto(160).min(1).optional(),
    referencia: Texto(200).optional(),
  })
  .strict();
export type NotaManual = z.infer<typeof NotaManualSchema>;

// ---------------------------------------------------------------------------
// A variante do painel (A ou B), guardada no navegador
// ---------------------------------------------------------------------------

export const VARIANTES_DO_PAINEL = ['A', 'B'] as const;
export type VarianteDoPainel = (typeof VARIANTES_DO_PAINEL)[number];
export const CHAVE_DA_VARIANTE_DO_PAINEL = 'painel.variante';
export const VARIANTE_PADRAO_DO_PAINEL: VarianteDoPainel = 'A';

export function lerVariante(valor: unknown): VarianteDoPainel {
  return (VARIANTES_DO_PAINEL as readonly unknown[]).includes(valor) ? (valor as VarianteDoPainel) : VARIANTE_PADRAO_DO_PAINEL;
}
