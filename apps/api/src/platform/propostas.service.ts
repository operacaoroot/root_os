import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

/*
 * ============================================================================
 * PROPOSTAS COMERCIAIS DA ROOT — leitura do serviço de propostas
 * ============================================================================
 *
 * As páginas de proposta (proposta.operacaoroot.com) e o rastreio delas NÃO
 * moram no OS: são um serviço pequeno à parte, na mesma VPS, que guarda as
 * páginas e os eventos em arquivo. Esta classe só LÊ esse serviço, pela rota
 * interna `/proposta/_api/...`, com a senha de `PROPOSTAS_API_TOKEN`. Nada é
 * gravado aqui e nada é copiado para o banco do OS: a fonte da verdade da
 * proposta continua sendo o serviço, e o "pago" continua sendo o Asaas
 * (decisão de 16/09: dinheiro em dois lugares é a primeira coisa que diverge).
 *
 * Sem as duas variáveis (`PROPOSTAS_URL` e `PROPOSTAS_API_TOKEN`) a tela diz
 * que o painel não está ligado, em vez de quebrar.
 */

export interface PropostaNaLista {
  cliente: string;
  chave: string;
  titulo: string;
  estado: string;
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

const SEGMENTO = /^[A-Za-z0-9_-]{2,80}$/;

@Injectable()
export class PropostasService {
  private readonly base = (process.env.PROPOSTAS_URL ?? '').replace(/\/$/, '');
  private readonly token = process.env.PROPOSTAS_API_TOKEN ?? '';

  get configurado(): boolean {
    return Boolean(this.base && this.token);
  }

  lista(): Promise<ListaDePropostas> {
    return this.ler<ListaDePropostas>('/proposta/_api/propostas');
  }

  detalhe(cliente: string, chave: string): Promise<DetalheDaProposta> {
    // O caminho vai para outro serviço: só segmentos do formato que ele aceita.
    if (!SEGMENTO.test(cliente) || !SEGMENTO.test(chave)) throw new NotFoundException('Proposta não encontrada.');
    return this.ler<DetalheDaProposta>(`/proposta/_api/propostas/${cliente}/${chave}`);
  }

  private async ler<T>(caminho: string): Promise<T> {
    if (!this.configurado) {
      throw new ServiceUnavailableException(
        'O painel de propostas não está ligado nesta instância: faltam PROPOSTAS_URL e PROPOSTAS_API_TOKEN.',
      );
    }
    let res: Response;
    try {
      res = await fetch(`${this.base}${caminho}`, {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new ServiceUnavailableException('O serviço de propostas não respondeu. Tente de novo em instantes.');
    }
    if (res.status === 404) throw new NotFoundException('Proposta não encontrada.');
    if (res.status === 401) {
      throw new ServiceUnavailableException('O serviço de propostas recusou a senha (PROPOSTAS_API_TOKEN).');
    }
    if (!res.ok) throw new ServiceUnavailableException(`O serviço de propostas respondeu ${res.status}.`);
    return (await res.json()) as T;
  }
}
