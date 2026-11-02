import { z } from 'zod';
import { SOCIOS_DA_AGENDA } from '@mktos/shared';

/*
 * A VALIDAÇÃO DAS ROTAS DA RÉGUA (agenda v2, 29/10/2026, lane G2). Os limites são
 * os dos CHECKs da migration `20261029230000_agenda_v2`: o banco recusaria de
 * qualquer jeito, mas a frase do 400 é melhor que a do Postgres.
 */

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const Hora = z.string().regex(HORA, 'Hora no formato HH:MM (24 h).');
const Socio = z.enum(SOCIOS_DA_AGENDA);
const DIA = /^\d{4}-\d{2}-\d{2}$/;

export const DiaSchema = z
  .string()
  .regex(DIA, 'Dia no formato AAAA-MM-DD.')
  .refine((v) => {
    const [a, m, d] = v.split('-').map(Number);
    const dt = new Date(Date.UTC(a, m - 1, d));
    return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, 'Esse dia não existe.');

const BloqueioFixoSchema = z
  .object({ diaDaSemana: z.number().int().min(0).max(6), inicio: Hora, fim: Hora.nullable().optional() })
  .strict()
  .refine((b) => !b.fim || b.inicio < b.fim, 'O fim do bloqueio vem depois do início.');

export const PessoaAlterarSchema = z
  .object({
    area: z.string().trim().max(80).nullable().optional(),
    janela: z.object({ inicio: Hora, fim: Hora }).strict().refine((j) => j.inicio < j.fim, 'A janela termina depois de começar.').optional(),
    intervaloMin: z.number().int().min(0).max(240).optional(),
    trajetoMin: z.number().int().min(0).max(480).optional(),
    tetoPorDia: z.number().int().min(0).max(30).optional(),
    bloqueiosFixos: z.array(BloqueioFixoSchema).max(14).optional(),
    emailPessoal: z.string().trim().toLowerCase().email('E-mail inválido.').max(200).nullable().optional(),
    fechadoLigado: z.boolean().optional(),
    substituto: Socio.nullable().optional(),
  })
  .strict();
export type PessoaAlterar = z.infer<typeof PessoaAlterarSchema>;

export const RitoAlterarSchema = z
  .object({
    titulo: z.string().trim().min(1).max(120).optional(),
    diaDaSemana: z.number().int().min(0).max(6).optional(),
    ordinalNoMes: z.number().int().min(1).max(5).nullable().optional(),
    inicio: Hora.nullable().optional(),
    duracaoMin: z.number().int().min(5).max(1440).optional(),
    quem: z.enum(['Todos', 'Rodrigo', 'Lucas', 'Pedro']).optional(),
    politica: z.enum(['pergunta', 'bloqueia']).optional(),
    ligado: z.boolean().optional(),
    aDecidir: z.boolean().optional(),
  })
  .strict();
export type RitoAlterar = z.infer<typeof RitoAlterarSchema>;

export const FeriadoCriarSchema = z
  .object({
    data: DiaSchema,
    nome: z.string().trim().min(2).max(80),
    cidade: z.string().trim().min(2).max(80),
    ligado: z.boolean().optional(),
  })
  .strict();
export type FeriadoCriar = z.infer<typeof FeriadoCriarSchema>;

export const FeriadoAlterarSchema = z.object({ ligado: z.boolean() }).strict();

export const TextoCriarSchema = z.object({ frase: z.string().trim().min(3).max(300), ligada: z.boolean().optional() }).strict();
export const TextoAlterarSchema = z
  .object({ frase: z.string().trim().min(3).max(300).optional(), ligada: z.boolean().optional() })
  .strict();

const Instante = z.string().datetime({ offset: true });

export const PropostaSchema = z
  .object({
    tipo: z.enum(['cliente', 'interna', 'bloqueio', 'pessoal', 'fora']),
    modalidade: z.enum(['online', 'presencial']).nullable().optional(),
    responsaveis: z.array(Socio).min(1).max(3),
    inicio: Instante,
    fim: Instante,
    ignorarEventoId: z.string().min(1).max(1024).nullable().optional(),
  })
  .strict()
  .refine((p) => new Date(p.fim).getTime() > new Date(p.inicio).getTime(), 'O fim vem depois do início.')
  .refine((p) => new Date(p.fim).getTime() - new Date(p.inicio).getTime() <= 31 * 24 * 3600_000, 'Um compromisso de até 31 dias.');

export const LivresQuerySchema = z
  .object({
    socio: Socio,
    tipo: z.enum(['cliente', 'interna']).default('cliente'),
    modalidade: z.enum(['online', 'presencial']).default('online'),
    duracao: z.coerce.number().int().min(5).max(600).default(60),
    de: DiaSchema,
    ate: DiaSchema,
  })
  .refine((q) => q.ate >= q.de, 'O fim do período vem depois do começo.');

export const ConflitosQuerySchema = z.object({
  dias: z.coerce.number().int().min(1).max(120).default(60),
  tipo: z.enum(['choque', 'padrao', 'sem_meet', 'rito', 'feriado', 'janela', 'fora', 'teto']).optional(),
  socio: Socio.optional(),
});

export const RelatorioQuerySchema = z
  .object({ de: DiaSchema.optional(), ate: DiaSchema.optional() })
  .refine((q) => !q.de || !q.ate || q.ate >= q.de, 'O fim do período vem depois do começo.');
