import { Injectable, Logger } from '@nestjs/common';

import { env, envOpcional } from './env';
import { TetoDeCustoIaService } from './teto-diario.service';

/* ==========================================================================
 * TRANSCRIÇÃO DE ÁUDIO — o cliente fala, o OS escreve
 * ==========================================================================
 *
 * Decisão 4 de 23/09: o cliente responde o onboarding por texto OU áudio. A
 * Anthropic não transcreve; quem faz é a OpenAI (`gpt-4o-transcribe`, com
 * queda para `whisper-1` por variável). Mora em `src/llm/` porque a catraca de
 * arquitetura exige que o modelo tenha uma casa só — e porque é aqui que o teto
 * de custo por empresa consegue ao menos RECUSAR quando o dia já fechou.
 *
 * O QUE NÃO ENTRA NO LIVRO DO DIA, e está dito: a transcrição é cobrada por
 * minuto, não por token, e `TetoDeCustoIaService.reservar` só sabe reservar
 * por token de um modelo da tabela de preço. Então este serviço pergunta
 * `motivoDeCorte` antes (dia fechado recusa) e devolve a ESTIMATIVA de custo
 * para quem chama gravar no marco. Passar a somar no livro pede um item de
 * preço por minuto em `preco.ts` — está no relatório, não escondido.
 *
 * A estimativa de duração é por tamanho do arquivo (~32 kbps, o que o celular
 * grava em opus/aac). Ela existe para o custo aparecer na tela como "≈", não
 * para cobrar ninguém.
 */

/** gpt-4o-transcribe e whisper-1: US$ 0,006 por minuto (tabela pública, 09/2026). */
export const PRECO_TRANSCRICAO_USD_POR_MINUTO = 0.006;
const BYTES_POR_SEGUNDO_ESTIMADO = 4000;
/** O limite da API de transcrição. */
export const MAX_BYTES_DE_AUDIO = 25 * 1024 * 1024;

export const TIPOS_DE_AUDIO: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'video/webm': 'webm',
  'video/mp4': 'mp4',
};

export interface Transcricao {
  texto: string;
  modelo: string;
  custoUsd: number;
  custoEstimado: boolean;
  segundosEstimados: number;
}

export class TranscricaoIndisponivelError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'TranscricaoIndisponivelError';
  }
}

@Injectable()
export class TranscricaoService {
  private readonly log = new Logger('Transcricao');
  private readonly apiKey = envOpcional('OPENAI_API_KEY');
  private readonly baseUrl = env('OPENAI_BASE_URL', 'https://api.openai.com/v1').replace(/\/$/, '');
  readonly modelo = env('TRANSCRICAO_MODELO', 'gpt-4o-transcribe');

  constructor(private readonly teto: TetoDeCustoIaService) {}

  get configured(): boolean {
    return this.apiKey.length > 0;
  }

  async transcrever(p: {
    orgId: string;
    audio: Buffer;
    mimetype: string;
    nome?: string;
    idioma?: string;
  }): Promise<Transcricao> {
    if (!this.configured) {
      throw new TranscricaoIndisponivelError(
        'a transcrição de áudio não está configurada (OPENAI_API_KEY ausente). O cliente pode ' +
          'responder por texto.',
      );
    }
    if (!TIPOS_DE_AUDIO[p.mimetype]) {
      throw new TranscricaoIndisponivelError(`formato de áudio não aceito: ${p.mimetype}`);
    }
    if (p.audio.length > MAX_BYTES_DE_AUDIO) {
      throw new TranscricaoIndisponivelError('o áudio passa de 25 MB. Grave em partes menores.');
    }
    const corte = await this.teto.motivoDeCorte(p.orgId);
    if (corte) throw new TranscricaoIndisponivelError(`teto de custo de IA da empresa: ${corte}`);

    const segundos = Math.max(1, Math.round(p.audio.length / BYTES_POR_SEGUNDO_ESTIMADO));
    const custoUsd = Number(((segundos / 60) * PRECO_TRANSCRICAO_USD_POR_MINUTO).toFixed(6));

    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(p.audio)], { type: p.mimetype }),
      p.nome ?? `audio.${TIPOS_DE_AUDIO[p.mimetype]}`,
    );
    form.append('model', this.modelo);
    form.append('language', p.idioma ?? 'pt');
    form.append('response_format', 'json');

    const res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const corpo = await res.text().catch(() => '');
      this.log.warn(`transcrição falhou (${res.status}): ${corpo.slice(0, 300)}`);
      throw new TranscricaoIndisponivelError(
        `a transcrição falhou (${res.status}). Tente de novo ou responda por texto.`,
      );
    }
    const json = (await res.json()) as { text?: string };
    const texto = String(json.text ?? '').trim();
    if (!texto) throw new TranscricaoIndisponivelError('a transcrição voltou vazia. Fale mais perto do microfone.');

    return { texto, modelo: this.modelo, custoUsd, custoEstimado: true, segundosEstimados: segundos };
  }
}
