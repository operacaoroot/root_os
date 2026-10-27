// Tipos da tela da Frota: espelho das respostas de /api/frota/*. A fonte é a API
// (apps/api/src/frota); aqui só o que a tela lê.

export type Estado = 'ok' | 'at' | 'er' | 'ne';
export type EstadoDaPolitica = Estado | 'manual';

export interface Pendencia { n: 'at' | 'er' | 'ne'; t: string; b: string }

export interface Container { nome: string; imagem: string; estado: string; saude?: string; criado?: string }
export interface Timer { unidade: string; proxima?: string; ultima?: string; ativo?: boolean }
export interface LinhaDoVerificar { n: 'ok' | 'av' | 'fa'; t: string }

export interface CasaResumo {
  id: string;
  casa: string;
  cliente: string;
  dono: string | null;
  responsavel: string | null;
  etapa: string;
  provedor: string | null;
  hostname: string | null;
  ip: string | null;
  vpn: string | null;
  sistema: string | null;
  maquina: string | null;
  kitVersao: string | null;
  acesso: string;
  estado: Estado;
  estadoTexto: string;
  ultimoRelatoEm: string | null;
  relatando: boolean;
  sonda: { estado: string; ultima: string | null } | null;
  backup: { ultimoOk: string | null; remoto: boolean } | null;
  disco: number | null;
  cpuPct: number | null;
  memPct: number | null;
  carga: number[] | null;
  apps: { total: number; rodando: number };
  containers: Container[];
  timers: Timer[];
  verificar: LinhaDoVerificar[];
  falhas: number;
  avisos: number;
  chaves: number;
  pessoas: string[];
  pedidos: number;
  ordensPendentes: number;
  pendencias: Pendencia[];
  politicas: { ok: number; at: number; er: number };
  observacoes: string | null;
}

export interface Acesso {
  id: string;
  pessoa: string;
  fingerprint: string | null;
  tipo: string | null;
  via: string | null;
  desde: string | null;
  ultimoLogin: string | null;
  estado: string;
  revogadoEm: string | null;
  revogadoPor: string | null;
  motivo: string | null;
}

export interface Ordem {
  id: string;
  casaId: string;
  tipo: string;
  parametros: Record<string, unknown> | null;
  estado: string;
  criadaPor: string;
  motivo: string | null;
  criadaEm: string;
  entregueEm: string | null;
  concluidaEm: string | null;
  resultado: { ok?: boolean; mensagem?: string | null } | null;
}

export interface Evento {
  id: string;
  casaId: string | null;
  casa: string | null;
  quando: string;
  quem: string;
  acao: string;
  origem: string;
  tipo: string;
  dados: unknown;
}

export interface PoliticaAvaliada { cod: string; nome: string; texto: string; base: string; estado: EstadoDaPolitica; detalhe: string }

export interface CasaDetalhe extends CasaResumo {
  relato: unknown;
  ficha: Record<string, string>;
  lgpd: Record<string, string>;
  arquivadaEm: string | null;
  acessos: Acesso[];
  ordens: Ordem[];
  eventos: Evento[];
  politicasAvaliadas: PoliticaAvaliada[];
}

export interface Resumo {
  atualizadoEm: string;
  tiles: {
    servidores: number; casas: number; comKit: number; relatando: number; sondaOk: number;
    chaves: number; pessoas: number; semDono: number; backupFora: number;
    pendenciasDePolitica: number; precisaDeGente: number; ordensPendentes: number;
  };
  acoes: (Pendencia & { casaId: string; casa: string })[];
  totalDeAcoes: number;
  casas: CasaResumo[];
  eventos: Evento[];
}

export interface Politicas {
  politicas: { cod: string; nome: string; texto: string; base: string }[];
  casas: { id: string; casa: string; cliente: string; etapa: string; lgpd: Record<string, string>; estados: { cod: string; estado: EstadoDaPolitica; detalhe: string }[] }[];
}

export const ROTULO: Record<EstadoDaPolitica, string> = { ok: 'ok', at: 'atenção', er: 'erro', ne: 'sem dado', manual: 'manual' };
export const TOM: Record<EstadoDaPolitica, 'good' | 'warn' | 'bad' | 'muted'> = { ok: 'good', at: 'warn', er: 'bad', ne: 'muted', manual: 'muted' };
export const ETAPA: Record<string, string> = { pre: 'pré-implantação', preparar: 'preparar', subir: 'subir', manter: 'manter no ar', acompanhar: 'acompanhar', encerrada: 'encerrada', 'fora-do-kit': 'fora do kit' };
export const TIPO_DE_EVENTO: Record<string, string> = { acesso: 'acessos', deploy: 'deploys', kit: 'kit e config', sonda: 'sonda e backup', painel: 'ações do painel' };

export const dh = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
export const d = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
export const haQuanto = (iso: string | null | undefined): string => {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (min < 48 * 60) return `há ${Math.round(min / 60)} h`;
  return `há ${Math.round(min / 1440)} d`;
};

export const CAMPOS_DA_FICHA: { k: string; label: string; dica?: string }[] = [
  { k: 'contrato', label: 'Contrato', dica: 'assinado em · etapas · prazo' },
  { k: 'contaDoProvedor', label: 'Conta do provedor', dica: 'de quem é a conta (sempre do cliente)' },
  { k: 'dominios', label: 'Domínios e DNS' },
  { k: 'custos', label: 'Custos de terceiros', dica: 'serviço · valor · aprovado em' },
  { k: 'contatoIncidente', label: 'Contato de incidente (cliente)', dica: 'quem a ROOT avisa em até 48 h' },
  { k: 'contatoRoot', label: 'Contato de incidente (ROOT)' },
];
export const CAMPOS_LGPD: { k: string; label: string; dica?: string }[] = [
  { k: 'controlador', label: 'Controlador', dica: 'o cliente; a ROOT é a operadora' },
  { k: 'dados', label: 'Dados tratados' },
  { k: 'finalidade', label: 'Finalidade' },
  { k: 'baseLegal', label: 'Base legal', dica: 'ex.: execução de contrato (art. 7º, V)' },
  { k: 'retencao', label: 'Retenção', dica: 'ex.: contrato + backups 14/8/6' },
  { k: 'encarregado', label: 'Encarregado (DPO) do cliente' },
  { k: 'ia', label: 'IA sobre os dados', dica: 'o que roda no servidor, o que sai para API e em que conta' },
];
