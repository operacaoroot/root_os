/*
 * O CLIENTE DO YOUTUBE QUE A PAUTA RECEBE (MD10).
 *
 * O HTTP e a credencial moram em `youtube/youtube.service.ts`, o único arquivo
 * com o endereço do YouTube. O serviço da pauta (`envio-ao-youtube.service.ts`)
 * não importa o conector: recebe este cliente por injeção, montado em
 * `youtube/youtube.module.ts` — o `*.module.ts` da pasta do conector, que é a
 * fiação que a catraca de arquitetura permite. O token de injeção só pode
 * aparecer nesses três arquivos (`arquitetura.test.ts`, "o cliente do YouTube
 * tem um dono").
 *
 * O que escreve no YouTube (abrir a sessão, a thumb, a playlist, o `publishAt`)
 * só é chamado DENTRO dos efeitos de `youtube.video.enviar` e
 * `youtube.video.publicar`, que a porta dispara com o item do lote. Fora deles,
 * só o token curto da sessão já aberta, para o Mac — pedido com o escopo só de
 * envio.
 */

export const CLIENTE_DO_YOUTUBE = Symbol('CLIENTE_DO_YOUTUBE');

/** O que vai no `snippet` do vídeo. O status é sempre privado — quem decide isso é o conector, não quem chama. */
export interface MetadadosDoVideo {
  titulo: string;
  descricao: string;
  categoria: string;
}

/** O vídeo como o `videos.list` o devolve, só com o que o OS confere. */
export interface VideoNoYoutube {
  id: string;
  titulo: string | null;
  descricao: string | null;
  categoria: string | null;
  privacidade: string | null;
  publishAt: string | null;
  uploadStatus: string | null;
  /**
   * `fileDetails.fileSize`: o tamanho do arquivo que subiu, visível só para o
   * dono do vídeo. O YouTube não expõe o sha256: o tamanho e a sessão aberta
   * pelo OS são a amarra possível entre o vídeo do canal e o arquivo assinado.
   * Ausente quando o YouTube não informou.
   */
  tamanho?: number | null;
}

/** O que a sessão resumable aberta pelo OS recebeu: o id do vídeo, quando o upload terminou. */
export interface ResultadoDaSessao {
  videoId: string | null;
  /** Quantos bytes a sessão confirmou (o total, quando terminou). */
  recebidos: number;
}

/** Um vídeo da playlist de uploads do canal, como a conferência pós-envio o lê. */
export interface UploadDoCanal {
  videoId: string;
  privacidade: string | null;
  enviadoEm: string | null;
}

export interface ClienteDoYoutube {
  /** Há credencial desta empresa no cofre (sem sair da casa). */
  conectado(orgId: string): Promise<boolean>;
  /**
   * O token curto (~1 h) que o MAC recebe para mandar os bytes: renovado pelo
   * refresh token do cofre (que nunca sai dele) pedindo SÓ `youtube.upload`.
   * `soEnvio` diz se o Google devolveu mesmo o escopo estreito — sem ele, o
   * token também serve para `videos.update` e `videos.delete`. `forcar` descarta
   * o token guardado (o Mac pediu outro porque o YouTube respondeu 401).
   */
  tokenDoEnvio(orgId: string, o?: { forcar?: boolean }): Promise<{ token: string; expiraEm: Date; soEnvio: boolean }>;
  /** O id do canal que a autorização desta empresa alcança (gravado na conexão), ou nulo. */
  canalConectado(orgId: string): Promise<string | null>;
  /** O link de exibição do vídeo: o endereço do YouTube mora no conector. */
  urlDoVideo(videoId: string): string;
  /** Abre a sessão de envio resumable, sempre privada e sem `publishAt`. Devolve a URI da sessão. */
  abrirSessao(orgId: string, e: { bytes: number; mime: string; metadados: MetadadosDoVideo }): Promise<string>;
  /**
   * Pergunta à sessão resumable que o OS abriu qual vídeo ela criou (`PUT`
   * vazio com `Content-Range: bytes * /<total>`). É por ela, e não pelo id que o
   * Mac informa, que o vídeo do canal fica amarrado ao arquivo assinado.
   */
  resultadoDaSessao(orgId: string, uri: string, bytes: number): Promise<ResultadoDaSessao>;
  /** O vídeo do canal desta empresa, ou nulo quando o id não existe (ou é de outro canal). */
  lerVideo(orgId: string, videoId: string): Promise<VideoNoYoutube | null>;
  /** Os vídeos da playlist de uploads do canal (`mine`), dos mais novos, até 50. */
  uploadsDoCanal(orgId: string): Promise<UploadDoCanal[]>;
  definirThumb(orgId: string, videoId: string, png: Buffer): Promise<void>;
  /** Põe o vídeo na playlist e devolve o id do item; se ele já está lá, devolve o item que existe (o insert não é idempotente). */
  inserirNaPlaylist(orgId: string, playlistId: string, videoId: string): Promise<string>;
  /** `videos.update` com `part=status`: privado + `publishAt`. Nada do snippet é enviado. */
  agendar(orgId: string, videoId: string, publishAt: Date): Promise<VideoNoYoutube>;
}

/** A falha de uma chamada ao YouTube: `status` nulo quando não houve resposta (rede, prazo). */
export class ErroDoYoutube extends Error {
  constructor(
    readonly status: number | null,
    mensagem: string,
    readonly razao: string | null = null,
  ) {
    super(mensagem);
    this.name = 'ErroDoYoutube';
  }
}
