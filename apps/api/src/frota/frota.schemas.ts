import { z } from 'zod';

/*
 * FROTA — os contratos de entrada.
 *
 * Dois lados falam com o módulo: o PAINEL (sessão da plataforma, pelo JWT) e o
 * RELATOR do kit-instalacao-vps (anônimo, pelo token da casa). Os dois passam
 * por aqui antes de tocar o banco. Todo texto tem teto: o relato chega de uma
 * máquina de cliente, e um campo sem limite é um convite a encher o banco.
 */

export const CASA_NOME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const texto = (max: number) => z.string().trim().max(max);
const textoOpc = (max: number) => texto(max).optional();

export const ETAPAS_DA_CASA = ['pre', 'preparar', 'subir', 'manter', 'acompanhar', 'encerrada', 'fora-do-kit'] as const;
export const TIPOS_DE_ORDEM = ['revogar_chave', 'desligar_automacao', 'rodar_verificar', 'pedir_backup'] as const;
export const TIPOS_DE_EVENTO = ['acesso', 'deploy', 'kit', 'sonda', 'painel'] as const;

export const CriarCasaSchema = z.object({
  casa: z.string().regex(CASA_NOME, 'nome curto: a-z, 0-9 e hífen'),
  cliente: texto(120).min(1),
  dono: textoOpc(120),
  responsavel: textoOpc(120),
  etapa: z.enum(ETAPAS_DA_CASA).optional(),
  provedor: textoOpc(160),
  hostname: textoOpc(120),
  ip: textoOpc(80),
  vpn: textoOpc(120),
  sistema: textoOpc(120),
  maquina: textoOpc(120),
  acesso: z.enum(['publico', 'vpn']).optional(),
  observacoes: textoOpc(2000),
  ficha: z.record(z.string().max(2000)).optional(),
  lgpd: z.record(z.string().max(2000)).optional(),
});
export type CriarCasaDto = z.infer<typeof CriarCasaSchema>;

export const EditarCasaSchema = CriarCasaSchema.omit({ casa: true })
  .partial()
  .extend({ arquivada: z.boolean().optional() });
export type EditarCasaDto = z.infer<typeof EditarCasaSchema>;

export const RevogarSchema = z.object({ motivo: texto(500).min(3, 'diga o motivo: entra no diário da casa') });

export const OrdemSchema = z.object({
  tipo: z.enum(['desligar_automacao', 'rodar_verificar', 'pedir_backup']),
  parametros: z.record(z.string().max(200)).optional(),
  motivo: textoOpc(500),
});

export const EventosConsultaSchema = z.object({
  casaId: z.string().uuid().optional(),
  tipo: z.enum(TIPOS_DE_EVENTO).optional(),
  limite: z.coerce.number().int().min(1).max(500).optional(),
});

/* ---------------------------------------------------------------- relato */

const dataIso = z.string().max(40);

/*
 * A jornada da casa (kit-jornada json, kit 2e8ba1d): o backlog do kit com a situação
 * desta casa em cada item. A fonte é o servidor, que prova o que diz; aqui só se lê.
 * Situação que o kit não conhecia vira 'afazer' em vez de derrubar o relato inteiro.
 */
export const SITUACOES_DA_JORNADA = ['afazer', 'andamento', 'esperando', 'feito', 'na', 'regrediu'] as const;
const situacao = z.enum(SITUACOES_DA_JORNADA).catch('afazer');
export const JornadaSchema = z.object({
  versao: z.literal(1),
  arquivo: z.boolean().default(false),
  kit: textoOpc(80),
  geradoEm: textoOpc(40),
  pct: z.number().min(0).max(100).default(0),
  feitos: z.number().int().min(0).max(1000).default(0),
  validos: z.number().int().min(0).max(1000).default(0),
  faseAtual: z.number().int().min(0).max(20).nullable().default(null),
  fases: z
    .array(
      z.object({
        n: z.number().int().min(0).max(20),
        nome: texto(120),
        total: z.number().int().min(0).max(500),
        feito: z.number().int().min(0).max(500).default(0),
        na: z.number().int().min(0).max(500).default(0),
        andamento: z.number().int().min(0).max(500).default(0),
        esperando: z.number().int().min(0).max(500).default(0),
        regrediu: z.number().int().min(0).max(500).default(0),
        afazer: z.number().int().min(0).max(500).default(0),
      }),
    )
    .max(20)
    .default([]),
  itens: z
    .array(
      z.object({
        id: texto(20),
        fase: z.number().int().min(0).max(20),
        item: texto(300),
        quem: textoOpc(80),
        projeto: z.boolean().default(false),
        situacao,
        marcada: situacao.optional(),
        espera: textoOpc(80),
        quando: textoOpc(20),
        nota: textoOpc(300),
        auto: z.enum(['ok', 'falha', 'na']).optional().catch(undefined),
        autoTexto: textoOpc(200),
      }),
    )
    .max(400)
    .default([]),
});
export type Jornada = z.infer<typeof JornadaSchema>;

export const RelatoSchema = z.object({
  versao: z.literal(1),
  casa: z.string().regex(CASA_NOME),
  quando: dataIso,
  maquina: z
    .object({
      hostname: textoOpc(120),
      sistema: textoOpc(120),
      vcpu: z.number().int().min(0).max(1024).optional(),
      memoriaGb: z.number().min(0).max(100000).optional(),
      discoGb: z.number().min(0).max(1000000).optional(),
      discoLivreGb: z.number().min(0).max(1000000).optional(),
      discoUsoPct: z.number().min(0).max(100).optional(),
      cpuPct: z.number().min(0).max(100).optional(),
      memPct: z.number().min(0).max(100).optional(),
      carga: z.array(z.number()).max(3).optional(),
      uptimeS: z.number().min(0).optional(),
      kitVersao: textoOpc(80),
      acesso: z.enum(['publico', 'vpn']).optional(),
      dominio: textoOpc(200),
      vpnIp: textoOpc(60),
      dono: textoOpc(120),
      reboot: z.boolean().optional(),
    })
    .default({}),
  verificar: z.array(z.object({ n: z.enum(['ok', 'av', 'fa']), t: texto(400) })).max(200).default([]),
  sonda: z.object({ estado: texto(600), ultima: textoOpc(40) }).optional(),
  backup: z.object({ ultimoOk: z.string().max(40).nullable().optional(), remoto: z.boolean().default(false) }).optional(),
  containers: z
    .array(z.object({ nome: texto(120), imagem: texto(300), estado: texto(40), saude: textoOpc(40), criado: textoOpc(60) }))
    .max(100)
    .default([]),
  chaves: z
    .array(z.object({ fingerprint: texto(120), tipo: textoOpc(40), comentario: textoOpc(120), restricoes: textoOpc(400) }))
    .max(100)
    .default([]),
  logins: z
    .array(z.object({ quando: dataIso, fingerprint: textoOpc(120), de: textoOpc(80), usuario: textoOpc(60) }))
    .max(300)
    .default([]),
  timers: z
    .array(z.object({ unidade: texto(120), proxima: textoOpc(60), ultima: textoOpc(60), ativo: z.boolean().optional() }))
    .max(50)
    .default([]),
  diario: z.array(z.object({ quando: texto(40), quem: texto(120), texto: texto(600) })).max(60).default([]),
  // jornada que não passa no esquema não derruba o relato: a casa continua relatando a saúde
  jornada: JornadaSchema.optional().catch(undefined),
});
export type Relato = z.infer<typeof RelatoSchema>;

export const ResultadosSchema = z.object({
  casa: z.string().regex(CASA_NOME),
  resultados: z
    .array(z.object({ ordemId: z.string().uuid(), ok: z.boolean(), mensagem: textoOpc(1000) }))
    .min(1)
    .max(20),
});
