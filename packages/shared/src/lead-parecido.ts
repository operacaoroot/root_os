import { z } from 'zod';

import {
  COMERCIAL_ROTULO_DA_ETAPA,
  TABELA_DE_PRECO,
  ehSaida,
  type ComercialEtapa,
  type ComercialProduto,
} from './comercial.js';
import { normalizarNomeDeVinculo } from './whatsapp-caixa.js';

/*
 * O LEAD QUE JÁ EXISTE, NO "+ LEAD" (29/10/2026, pedido do Lucas depois da Custeio).
 *
 * O "+ lead" criava um lead novo a cada clique, sem olhar o que já estava no
 * funil. Em 26/10 a Imersão da Custeio virou o card "Custeio (Imersão)" solto,
 * sem o cadastro do cliente. Agora, enquanto a pessoa digita, a tela pergunta
 * à API (`GET /comercial/leads/parecidos`) se já há lead com o mesmo telefone,
 * o mesmo e-mail, a mesma empresa ou o mesmo contato, e oferece:
 *
 *   · abrir o card que já existe (follow-up é etapa do mesmo card, E7);
 *   · registrar uma venda nova de quem já é cliente
 *     (`POST /comercial/lead/:id/venda-nova`): lead novo, com a empresa do
 *     cliente, ligado ao MESMO cadastro (`ComercialFicha.partnerId`);
 *   · criar mesmo assim, quando é outra empresa de nome parecido.
 *
 * A comparação mora aqui (pura, testada sem banco); a API só lê os candidatos.
 */

/** O que a pessoa digitou no "+ lead". */
export const ProcuraDeLeadParecidoSchema = z.object({
  empresa: z.string().max(200).optional(),
  contato: z.string().max(120).optional(),
  telefone: z.string().max(40).optional(),
  email: z.string().max(254).optional(),
});
export type ProcuraDeLeadParecido = z.infer<typeof ProcuraDeLeadParecidoSchema>;

export type MotivoDoParecido = 'telefone' | 'email' | 'empresa' | 'contato';

export const ROTULO_DO_MOTIVO_DO_PARECIDO: Record<MotivoDoParecido, string> = {
  telefone: 'mesmo telefone',
  email: 'mesmo e-mail',
  empresa: 'mesma empresa',
  contato: 'mesmo contato',
};

/** Um lead do banco, como a procura o lê. */
export interface CandidatoAParecido {
  leadId: string;
  nome: string;
  empresa: string | null;
  telefone: string | null;
  email: string | null;
  etapa: ComercialEtapa;
  produto: ComercialProduto | null;
  /** O cadastro do cliente (`Partner`) a que a ficha aponta, quando já é cliente. */
  cadastroId: string | null;
}

/** O que volta para a tela. */
export interface LeadParecido {
  leadId: string;
  nome: string;
  empresa: string | null;
  etapa: ComercialEtapa;
  rotuloDaEtapa: string;
  produto: ComercialProduto | null;
  rotuloDoProduto: string | null;
  cadastroId: string | null;
  motivos: MotivoDoParecido[];
}

export interface LeadsParecidosResposta {
  parecidos: LeadParecido[];
}

/** A venda nova de quem já é cliente: a referência do clique (idempotência) e o contato desta venda. */
export const VendaNovaDoClienteSchema = z
  .object({
    ref: z.string().trim().min(8).max(80),
    contato: z.string().trim().max(120).optional(),
    telefone: z.string().trim().max(40).optional(),
    email: z.string().trim().toLowerCase().email('E-mail inválido.').max(254).optional(),
  })
  .strict();
export type VendaNovaDoCliente = z.infer<typeof VendaNovaDoClienteSchema>;

/** DDD + os 8 últimos dígitos: o mesmo celular com e sem o 9 na frente, com e sem o 55. */
export function chaveDoTelefone(telefone: string | null | undefined): string | null {
  let d = String(telefone ?? '').replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return null;
  return `${d.slice(0, 2)}:${d.slice(-8)}`;
}

/**
 * Os nomes do lead para comparar com a empresa digitada: a empresa da ficha, o
 * nome, o nome sem o parêntese ("Custeio (Imersão)"), sem o produto na frente
 * ("Imersão · Custeio") e a parte antes do " | " ("Custeio | Lucas").
 */
function nomesDoCandidato(c: CandidatoAParecido): string[] {
  const nomes = new Set<string>();
  const somar = (v: string | null | undefined) => {
    const n = normalizarNomeDeVinculo(v);
    if (n.length >= 3) nomes.add(n);
  };
  somar(c.empresa);
  somar(c.nome);
  somar(c.nome.replace(/\([^)]*\)/g, ' '));
  if (c.nome.includes(' · ')) somar(c.nome.slice(c.nome.lastIndexOf(' · ') + 3));
  if (c.nome.includes(' | ')) somar(c.nome.slice(0, c.nome.indexOf(' | ')));
  return [...nomes];
}

/** A pessoa do lead: o nome, ou a parte depois do " | ". */
function pessoasDoCandidato(c: CandidatoAParecido): string[] {
  const pessoas = [normalizarNomeDeVinculo(c.nome)];
  if (c.nome.includes(' | ')) pessoas.push(normalizarNomeDeVinculo(c.nome.slice(c.nome.indexOf(' | ') + 3)));
  return pessoas;
}

/**
 * A empresa digitada bate com o nome: igual; um começa pelo outro em palavra
 * inteira ("Custeio" e "Custeio Technology"); ou, enquanto digita, o nome
 * começa pelo que já foi digitado (a partir de 4 letras).
 */
function empresaBate(digitada: string, nome: string): boolean {
  if (digitada === nome) return true;
  if (nome.startsWith(`${digitada} `) || digitada.startsWith(`${nome} `)) return true;
  return digitada.length >= 4 && nome.startsWith(digitada);
}

/**
 * Os leads parecidos com o que foi digitado, no máximo `max`. Mais motivos
 * primeiro; no empate, o funil ativo antes das saídas e, depois, a ordem dos
 * candidatos (a API manda o mais novo primeiro). O contato só conta com nome e
 * sobrenome: "Lucas" sozinho acharia meio funil.
 */
export function acharLeadsParecidos(
  procura: ProcuraDeLeadParecido,
  candidatos: readonly CandidatoAParecido[],
  max = 5,
): { candidato: CandidatoAParecido; motivos: MotivoDoParecido[] }[] {
  const telefone = chaveDoTelefone(procura.telefone);
  const email = (procura.email ?? '').trim().toLowerCase();
  const empresa = normalizarNomeDeVinculo(procura.empresa);
  const contato = normalizarNomeDeVinculo(procura.contato);
  const contatoConta = contato.split(' ').length >= 2;
  const achados: { candidato: CandidatoAParecido; motivos: MotivoDoParecido[]; ordem: number }[] = [];
  candidatos.forEach((c, ordem) => {
    const motivos: MotivoDoParecido[] = [];
    if (telefone && chaveDoTelefone(c.telefone) === telefone) motivos.push('telefone');
    if (email.includes('@') && (c.email ?? '').trim().toLowerCase() === email) motivos.push('email');
    if (empresa.length >= 3 && nomesDoCandidato(c).some((n) => empresaBate(empresa, n))) motivos.push('empresa');
    if (contatoConta && pessoasDoCandidato(c).includes(contato)) motivos.push('contato');
    if (motivos.length) achados.push({ candidato: c, motivos, ordem });
  });
  return achados
    .sort((a, b) => b.motivos.length - a.motivos.length || Number(ehSaida(a.candidato.etapa)) - Number(ehSaida(b.candidato.etapa)) || a.ordem - b.ordem)
    .slice(0, max)
    .map(({ candidato, motivos }) => ({ candidato, motivos }));
}

/** O que vai para a tela, com os rótulos da etapa e do produto. */
export function paraLeadParecido(c: CandidatoAParecido, motivos: MotivoDoParecido[]): LeadParecido {
  return {
    leadId: c.leadId,
    nome: c.nome,
    empresa: c.empresa,
    etapa: c.etapa,
    rotuloDaEtapa: COMERCIAL_ROTULO_DA_ETAPA[c.etapa],
    produto: c.produto,
    rotuloDoProduto: c.produto ? (TABELA_DE_PRECO[c.produto]?.rotulo ?? c.produto) : null,
    cadastroId: c.cadastroId,
    motivos,
  };
}
