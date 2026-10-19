// Formatos devolvidos por GET /api/tenants/plataforma/propostas (apps/api/src/platform/propostas.service.ts):
// as propostas antigas do serviço de propostas da ROOT, só na sessão da plataforma.
// As propostas publicadas pela sala vêm de GET /api/comercial/propostas (tipos em @mktos/shared).

export interface PropostaNaLista {
  cliente: string;
  chave: string;
  titulo: string;
  estado: string;
  /** 0 não abriu · 1 abriu · 2 leu o investimento · 3 clicou em pagar */
  etapa: number;
  aberturas: number;
  pessoas: number;
  ultimaAtividade: string | null;
  criadaEm: string;
  link: string;
}

export interface AparelhoDaEquipe {
  nome: string;
  aparelho: string;
  descricao: string | null;
  desde: string;
}

export interface ListaDePropostas {
  propostas: PropostaNaLista[];
  aparelhosDaEquipe: AparelhoDaEquipe[];
}

export interface DetalheDaProposta {
  cliente: string;
  chave: string;
  titulo: string;
  estado: string;
  etapa: number;
  link: string;
  aberturas: number;
  pessoas: number;
  tempoTotalMs: number;
  ultimaAtividade: string | null;
  maisVista: string | null;
  tempoPorParte: { id: string; nome: string; ms: number; aberturasQueViram: number }[];
  audios: { id: string; plays: number; aberturas: number }[];
  visitas: {
    quando: string;
    pessoa: number;
    aparelho: string;
    descricao: string | null;
    tempoMs: number;
    leuAte: string;
    plays: number;
    clicouEmPagar: boolean;
  }[];
  visitasDaEquipeIgnoradas: number;
}

/** As etapas do leitor do serviço de propostas. Na sala, a última é o aceite. */
export const ETAPAS = ['Enviada', 'Abriu', 'Leu o investimento', 'Clicou em pagar'] as const;
export const ETAPAS_DA_SALA = ['Publicada', 'Abriu', 'Leu o investimento', 'Aceitou'] as const;

export function tempo(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

export function quando(iso: string | null): string {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
