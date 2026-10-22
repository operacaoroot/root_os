import { z } from 'zod';
import { diaNoFuso } from './schemas.js';
import { tituloNormalizado } from './tarefas-do-dia.js';

/*
 * O PERFIL DA PESSOA (produção 22B, I6, 22/10/2026) — `/perfil`
 *
 * O cadastro de gente ganhou o que faltava: foto, data de nascimento, cargo,
 * cidade, fuso, apelido e o nome como está no vault (`nomeNoVault`, a ligação
 * da pessoa com as notas da Governança). O telefone já existia em `User.phone`.
 *
 * O WHATSAPP NÃO GANHOU COLUNA: o número da pessoa já mora na identidade de
 * canal que o canal de aprovação procura (`ChannelIdentity`, cadastrado pela
 * Equipe). O perfil mostra e edita AQUELE número, pela mesma rota da Equipe
 * (`PUT /organograma/pessoas/:id/whatsapp`). Uma coluna nova seria a segunda
 * verdade sobre o mesmo número.
 *
 * QUEM EDITA: a própria pessoa edita o seu; o de outra pessoa é de quem tem
 * `admin.usuarios`. A API relê os papéis no banco; conta de máquina não edita.
 *
 * QUEM VÊ O QUÊ: o nome, o cargo, a cidade, o fuso, o apelido, a foto e o
 * aniversário (só dia e mês) são da equipe inteira. A data com o ano, o
 * telefone e o WhatsApp inteiro só a própria pessoa e quem administra gente.
 */

/** Quem pode editar o perfil de OUTRA pessoa (o próprio, qualquer pessoa da casa). */
export const PERMISSAO_DE_EDITAR_PERFIL_DE_OUTRO = 'admin.usuarios';

/** A foto que chega: até 2 MB, JPG/PNG/WebP pela assinatura dos bytes, sem SVG. */
export const PERFIL_FOTO_MAX_BYTES_DO_ENVIO = 2 * 1024 * 1024;
/** A foto que fica guardada no banco: até 256 KB (a tela reduz para 256 px antes de enviar). */
export const PERFIL_FOTO_MAX_BYTES_GUARDADOS = 256 * 1024;
/** O lado que a tela gera. */
export const PERFIL_FOTO_LADO = 256;
/** O lado máximo aceito pelo servidor (que não redimensiona: não há biblioteca de imagem). */
export const PERFIL_FOTO_LADO_MAXIMO = 512;
export const PERFIL_FOTO_LADO_MINIMO = 16;

export const TIPOS_DA_FOTO = ['jpeg', 'png', 'webp'] as const;
export type TipoDaFoto = (typeof TIPOS_DA_FOTO)[number];
export const MIME_DA_FOTO: Readonly<Record<TipoDaFoto, string>> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const texto = (max: number) =>
  z
    .string()
    .max(max, `No máximo ${max} caracteres.`)
    .transform((s) => s.trim())
    .nullable();

/** Fuso IANA que o próprio motor de datas conhece (`America/Sao_Paulo`). */
export function fusoValido(fuso: string): boolean {
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(fuso)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

/** `AAAA-MM-DD` que existe no calendário, entre 1900 e hoje. */
export function dataDeNascimentoValida(dia: string, hoje = new Date()): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!m) return false;
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const data = new Date(Date.UTC(a, mes - 1, d));
  if (data.getUTCFullYear() !== a || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== d) return false;
  if (a < 1900) return false;
  return dia <= hoje.toISOString().slice(0, 10);
}

/**
 * O que a tela manda ao salvar. Campo ausente não muda; `null` limpa. A versão
 * (`esperado`, o `atualizadoEm` lido) barra a gravação por cima de outra aba (409).
 */
export const PerfilUpdateSchema = z
  .object({
    esperado: z.string().min(1),
    apelido: texto(40).optional(),
    cargo: texto(80).optional(),
    cidade: texto(80).optional(),
    fuso: texto(64)
      .refine((v) => v === null || v === '' || fusoValido(v), 'Fuso desconhecido. Use o nome do fuso, como America/Sao_Paulo.')
      .optional(),
    dataNascimento: z
      .string()
      .nullable()
      .refine((v) => v === null || v === '' || dataDeNascimentoValida(v), 'Data de nascimento inválida (AAAA-MM-DD, até hoje).')
      .optional(),
    telefone: texto(40).optional(),
    nomeNoVault: texto(80)
      .refine((v) => v === null || !/[\\/]|\.\./.test(v), 'O nome no vault é o nome da nota, sem barra nem "..".')
      .optional(),
  })
  .strict();
export type PerfilUpdateInput = z.infer<typeof PerfilUpdateSchema>;

export const CAMPOS_DO_PERFIL = ['apelido', 'cargo', 'cidade', 'fuso', 'dataNascimento', 'telefone', 'nomeNoVault'] as const;
export type CampoDoPerfil = (typeof CAMPOS_DO_PERFIL)[number];

export interface FotoDoPerfil {
  /** A rota autenticada da foto (sem o `/api`), com a versão na query: muda quando a foto muda. */
  url: string;
  tipo: TipoDaFoto;
  largura: number;
  altura: number;
  bytes: number;
  enviadaEm: string;
}

export interface PerfilDaPessoa {
  id: string;
  nome: string;
  email: string;
  apelido: string | null;
  cargo: string | null;
  cidade: string | null;
  fuso: string | null;
  /** `MM-DD`, para todos da equipe. */
  aniversario: string | null;
  /** `AAAA-MM-DD`, só para a própria pessoa e quem administra gente. */
  dataNascimento: string | null;
  /** Só para a própria pessoa e quem administra gente. */
  telefone: string | null;
  nomeNoVault: string | null;
  foto: FotoDoPerfil | null;
  /** O WhatsApp da identidade de canal (o mesmo da Equipe): o final para todos, o número inteiro só para quem edita. */
  whatsapp: { cadastrado: boolean; final: string | null; numero: string | null };
  /** O vault da Root, para conferir e sugerir o nome no vault. */
  vault: { disponivel: boolean; frase: string | null; socios: string[]; sugestao: string | null };
  /** Quem está vendo pode editar este perfil. */
  podeEditar: boolean;
  /** Quem está vendo é a própria pessoa. */
  proprio: boolean;
  /** A versão para o `esperado` do salvar. */
  atualizadoEm: string;
}

/** A pessoa como as telas precisam para o avatar do responsável. */
export interface AvatarDaEmpresa {
  id: string;
  nome: string;
  /** A rota da foto (sem o `/api`), ou nulo: aí a tela desenha as iniciais. */
  fotoUrl: string | null;
  /** `MM-DD` (só dia e mês), ou nulo. */
  aniversario: string | null;
  cargo: string | null;
}

export interface AvataresDaEmpresa {
  pessoas: AvatarDaEmpresa[];
}

/** A rota da foto, com 12 caracteres do sha256 como versão (a URL muda quando a foto muda). */
export function rotaDaFoto(userId: string, sha256: string): string {
  return `/perfil/${encodeURIComponent(userId)}/foto?v=${sha256.slice(0, 12)}`;
}

/** As iniciais do nome: primeira letra do primeiro e do último nome, maiúsculas. */
export function iniciaisDoNome(nome: string): string {
  const partes = nome
    .trim()
    .split(/\s+/)
    .filter((p) => /\p{L}|\d/u.test(p));
  if (!partes.length) return '?';
  const letra = (p: string) => (p.match(/[\p{L}\d]/u)?.[0] ?? '').toLocaleUpperCase('pt-BR');
  if (partes.length === 1) return letra(partes[0]) || '?';
  return `${letra(partes[0])}${letra(partes[partes.length - 1])}` || '?';
}

/** O `MM-DD` de uma data `AAAA-MM-DD`. */
export function aniversarioDaData(dia: string | null): string | null {
  if (!dia) return null;
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(dia);
  return m ? `${m[1]}-${m[2]}` : null;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "12 de março", para a tela. */
export function rotuloDoAniversario(mmdd: string): string {
  const [m, d] = mmdd.split('-').map(Number);
  return `${d} de ${MESES[m - 1] ?? '?'}`;
}

/**
 * Quem faz aniversário no dia civil de São Paulo. Quem nasceu em 29 de
 * fevereiro comemora no 28 nos anos que não são bissextos.
 */
export function aniversariantesDoDia<P extends { aniversario: string | null }>(
  pessoas: readonly P[],
  agora = new Date(),
  fuso = 'America/Sao_Paulo',
): P[] {
  const dia = diaNoFuso(agora, fuso);
  const ano = Number(dia.slice(0, 4));
  const mmdd = dia.slice(5);
  const bissexto = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
  return pessoas.filter((p) => p.aniversario === mmdd || (!bissexto && mmdd === '02-28' && p.aniversario === '02-29'));
}

/**
 * A sugestão do nome no vault pelo PRIMEIRO NOME: só quando o primeiro nome da
 * pessoa casa com exatamente um sócio do vault e nenhuma outra pessoa da equipe
 * tem o mesmo primeiro nome. Fora disso, nulo: fica [a decidir] no perfil.
 */
export function sugerirNomeNoVault(
  nomeDaPessoa: string,
  sociosDoVault: readonly string[],
  nomesDaEquipe: readonly string[],
): string | null {
  const primeiro = (n: string) => tituloNormalizado(n).split(' ')[0] ?? '';
  const alvo = primeiro(nomeDaPessoa);
  if (!alvo) return null;
  if (nomesDaEquipe.filter((n) => primeiro(n) === alvo).length > 1) return null;
  const casam = sociosDoVault.filter((s) => primeiro(s) === alvo);
  return casam.length === 1 ? casam[0] : null;
}
