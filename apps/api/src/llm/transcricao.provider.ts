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
    // O navegador manda `audio/webm;codecs=opus`: o tipo é o que vem antes do `;`.
    const tipo = String(p.mimetype ?? '').split(';')[0].trim().toLowerCase();
    if (!TIPOS_DE_AUDIO[tipo]) {
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
      new Blob([new Uint8Array(p.audio)], { type: tipo }),
      p.nome ?? `audio.${TIPOS_DE_AUDIO[tipo]}`,
    );
    form.append('model', this.modelo);
    form.append('language', p.idioma ?? 'pt');
    form.append('response_format', 'json');

    /*
     * DUAS TENTATIVAS, e a mensagem certa para quem está do outro lado. O 429 da
     * OpenAI tem duas caras: "sem crédito" (a conta zerou — ninguém do lado do
     * cliente resolve, e repetir não adianta) e "ocupado" (limite de taxa, que
     * uma segunda tentativa costuma vencer). Nenhum código de status vai para
     * a tela do cliente: ele lê o que fazer, e o log diz à Root o que houve.
     */
    let res: Response | null = null;
    let corpo = '';
    for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
      res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
      });
      if (res.ok) break;
      corpo = await res.text().catch(() => '');
      this.log.warn(`transcrição falhou (${res.status}, tentativa ${tentativa}): ${corpo.slice(0, 300)}`);
      const semCredito = res.status === 429 && /credit|quota|billing/i.test(corpo);
      if (semCredito) {
        this.log.error(
          'OpenAI SEM CRÉDITO: a transcrição de áudio do onboarding está parada até alguém adicionar crédito em ' +
            'platform.openai.com/settings/organization/billing. O cliente foi orientado a responder por texto.',
        );
        throw new TranscricaoIndisponivelError(
          'a transcrição por áudio está indisponível agora. Responda por texto — ou tente o áudio mais tarde.',
        );
      }
      const passageiro = res.status === 429 || res.status >= 500;
      if (!passageiro || tentativa === 2) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (!res || !res.ok) {
      throw new TranscricaoIndisponivelError(
        'o serviço de transcrição não respondeu. Tente o áudio de novo em instantes, ou responda por texto.',
      );
    }
    const json = (await res.json()) as { text?: string };
    const texto = String(json.text ?? '').trim();
    if (!texto) throw new TranscricaoIndisponivelError('a transcrição voltou vazia. Fale mais perto do microfone.');

    return { texto, modelo: this.modelo, custoUsd, custoEstimado: true, segundosEstimados: segundos };
  }
}
