import { Injectable } from '@nestjs/common';
import { ContextKind, ContextSource } from '@prisma/client';
import { MemoriaService, type NotaDeContexto } from '../memory/memoria.service';
import fluxoDoCliente from './fluxo-do-cliente.json';
import {
  motivoDaCarga,
  notasDoFluxo,
  procedenciaDaCarga,
  situacaoDaNota,
  type FluxoDoCliente,
  type NotaDoFluxo,
  type SituacaoDaNota,
} from './fluxo-do-cliente-na-memoria';

/*
 * O FLUXO DO CLIENTE NA MEMÓRIA — quem grava (P-87, 02/11/2026).
 *
 * As notas saem de `fluxo-do-cliente-na-memoria.ts`; aqui só se lê a Memória e,
 * quando alguém aperta "Levar para a Memória", se grava pelo MESMO serviço da
 * tela da Memória: evento no RASTRO, versão, autor e cadeado por empresa. Nada
 * por fora do `MemoriaService`.
 *
 * O QUE O BOTÃO FAZ, NOTA POR NOTA:
 *   falta          → cria;
 *   desatualizada  → grava a versão nova (a anterior fica no histórico);
 *   em dia, editada à mão ou arquivada → fica como está.
 * Uma nota que falha não derruba as outras: ela volta em `falhas`, com o motivo.
 */

const FLUXO = fluxoDoCliente as FluxoDoCliente;

export interface NotaDoFluxoNaMemoria {
  chave: string;
  titulo: string;
  situacao: SituacaoDaNota;
  id: string | null;
  versao: number | null;
  temVetor: boolean;
  atualizadoEm: string | null;
}

export interface EstadoDoFluxoNaMemoria {
  versaoDoFluxo: string;
  dataDoFluxo: string;
  notas: NotaDoFluxoNaMemoria[];
  contagem: Record<SituacaoDaNota, number>;
}

export interface ResultadoDaCargaDoFluxo extends EstadoDoFluxoNaMemoria {
  criadas: number;
  atualizadas: number;
  falhas: { chave: string; titulo: string; motivo: string }[];
}

type Leitura = { gerada: NotaDoFluxo; atual: NotaDeContexto | null; situacao: SituacaoDaNota };

@Injectable()
export class FluxoNaMemoriaService {
  constructor(private readonly memoria: MemoriaService) {}

  async estado(orgId: string, userId: string): Promise<EstadoDoFluxoNaMemoria> {
    return this.resumir(await this.ler(orgId, userId));
  }

  async levar(orgId: string, userId: string): Promise<ResultadoDaCargaDoFluxo> {
    const motivo = motivoDaCarga(FLUXO);
    const sourceRef = procedenciaDaCarga(FLUXO);
    let criadas = 0;
    let atualizadas = 0;
    const falhas: ResultadoDaCargaDoFluxo['falhas'] = [];

    for (const { gerada, atual, situacao } of await this.ler(orgId, userId)) {
      const dados = {
        kind: ContextKind.regra,
        title: gerada.titulo,
        body: gerada.corpo,
        tags: gerada.tags,
        sourceType: ContextSource.upload,
        sourceRef,
        motivo,
      };
      try {
        if (situacao === 'falta') {
          await this.memoria.criar(orgId, { chave: gerada.chave, ...dados });
          criadas += 1;
        } else if (situacao === 'desatualizada' && atual) {
          await this.memoria.alterarHumano(orgId, userId, atual.id, { ...dados, versaoEsperada: atual.versao });
          atualizadas += 1;
        }
      } catch (e) {
        falhas.push({ chave: gerada.chave, titulo: gerada.titulo, motivo: (e as Error).message });
      }
    }

    return { ...(await this.estado(orgId, userId)), criadas, atualizadas, falhas };
  }

  /** A nota de cada chave e a situação dela diante do arquivo. O histórico só é lido quando o texto difere. */
  private async ler(orgId: string, userId: string): Promise<Leitura[]> {
    const leituras: Leitura[] = [];
    for (const gerada of notasDoFluxo(FLUXO)) {
      const atual = await this.memoria.porChave(orgId, gerada.chave, userId);
      let situacao = situacaoDaNota(gerada, atual);
      if (situacao === 'editada' && atual) {
        const [ultima] = await this.memoria.historico(orgId, atual.id, userId);
        situacao = situacaoDaNota(gerada, atual, ultima?.motivo ?? null);
      }
      leituras.push({ gerada, atual, situacao });
    }
    return leituras;
  }

  private resumir(leituras: Leitura[]): EstadoDoFluxoNaMemoria {
    const contagem: Record<SituacaoDaNota, number> = { falta: 0, em_dia: 0, desatualizada: 0, editada: 0, arquivada: 0 };
    for (const l of leituras) contagem[l.situacao] += 1;
    return {
      versaoDoFluxo: FLUXO.versao,
      dataDoFluxo: FLUXO.data,
      contagem,
      notas: leituras.map(({ gerada, atual, situacao }) => ({
        chave: gerada.chave,
        titulo: gerada.titulo,
        situacao,
        id: atual?.id ?? null,
        versao: atual?.versao ?? null,
        temVetor: atual?.temVetor ?? false,
        atualizadoEm: atual?.atualizadoEm ?? null,
      })),
    };
  }
}
