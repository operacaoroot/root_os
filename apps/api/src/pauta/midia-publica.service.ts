import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { PAUTA_MIDIA_PUBLICA_VALIDADE_MAXIMA_SEG, type PautaMidiaPublicaDaPeca } from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { ModulosService } from '../tenants/modulos.service';
import { comTenantPublico } from '../common/tenant-publico';
import { ehPecaDaSemana, lerMetaDaSemana, tipoDaImagem, type MetaDaSemana } from './derivacao-do-episodio';
import { assinar, conferir, origemDaMidiaPublica, rastroDoToken, segredoDaMidiaPublica } from './midia-publica';

/** O que a rota pública pode servir de uma peça: o JPEG de cada imagem e o mp4 do corte. */
function midiasServiveis(m: MetaDaSemana): Array<{ tipo: 'jpeg' | 'mp4'; n: number | null; chave: string; bytes: number; sha256: string | null }> {
  const jpegs = m.imagens
    .filter((i) => tipoDaImagem(i) === 'jpeg')
    .sort((a, b) => a.n - b.n)
    .map((i) => ({ tipo: 'jpeg' as const, n: i.n, chave: i.chave, bytes: i.bytes, sha256: i.sha256 ?? null }));
  const video = m.video?.chave
    ? [{ tipo: 'mp4' as const, n: null, chave: m.video.chave, bytes: m.video.bytes, sha256: m.video.sha256 ?? null }]
    : [];
  return [...jpegs, ...video];
}

const TIPO_POR_EXTENSAO: Record<string, string> = { jpg: 'image/jpeg', mp4: 'video/mp4' };

/*
 * A MÍDIA DA PEÇA NUMA URL PÚBLICA DE PRAZO CURTO (MD4).
 *
 * Duas pontas. `assinar` é autenticada (`pauta.publicar`) e só vale para a
 * peça APROVADA: monta as URLs da mídia que ela tem no storage — o JPEG de
 * cada imagem e o mp4 do corte —,
 * válidas por no máximo 1 h, e deixa no RASTRO só os 8 primeiros caracteres de
 * cada HMAC. `abrir` é da rota pública: confere o token SEM tocar no banco e só
 * então abre a empresa dele (`comTenantPublico` — a empresa vem do token
 * assinado, sem resolução sob a sentinela), confere que a chave ainda é da
 * peça e devolve o arquivo. Tudo o que não passa devolve nulo, e a rota
 * responde o mesmo 404.
 */
@Injectable()
export class MidiaPublicaService {
  private readonly log = new Logger('MidiaPublicaService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly modulos: ModulosService,
  ) {}

  async assinarDaPeca(
    orgId: string,
    pecaId: string,
    actorId: string,
    validadeSeg = PAUTA_MIDIA_PUBLICA_VALIDADE_MAXIMA_SEG,
  ): Promise<PautaMidiaPublicaDaPeca> {
    const segredo = segredoDaMidiaPublica();
    const origem = origemDaMidiaPublica();
    if (!segredo || !origem) {
      throw new ServiceUnavailableException(
        'A URL pública da mídia está desligada: defina PAUTA_MIDIA_PUBLICA_SEGREDO (32+ caracteres) e PUBLIC_BIO_ORIGIN ou PAUTA_MIDIA_PUBLICA_ORIGEM.',
      );
    }
    const p = await this.prisma.pautaPeca.findFirst({ where: { id: pecaId, orgId }, select: { id: true, status: true, meta: true } });
    if (!p || !ehPecaDaSemana(p.meta)) throw new NotFoundException('Peça da semana não encontrada.');
    // A URL pública é o passo da publicação (MD6), que só leva peça aprovada: o rascunho não sai do OS.
    if (p.status !== 'aprovada') throw new BadRequestException('Só a peça aprovada tem mídia pública: aprove antes.');
    const midias = midiasServiveis(lerMetaDaSemana(p.meta));
    if (!midias.length) {
      throw new BadRequestException('A peça ainda não tem mídia no OS (o JPEG das imagens ou o mp4 do corte): rode a /root-midia no Mac.');
    }
    const agora = Math.floor(Date.now() / 1000);
    const exp = agora + Math.min(Math.max(60, Math.floor(validadeSeg)), PAUTA_MIDIA_PUBLICA_VALIDADE_MAXIMA_SEG);
    const assinadas = midias.map((m) => {
      const token = assinar({ orgId, pecaId: p.id, chave: m.chave, exp }, segredo, agora);
      return { ...m, token, url: `${origem}/api/midia-publica/${token}` };
    });
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.midia_publica_assinada',
      entityType: 'pauta_peca',
      entityId: p.id,
      after: {
        exp: new Date(exp * 1000).toISOString(),
        midias: assinadas.map((m) => ({ tipo: m.tipo, n: m.n, hmac: rastroDoToken(m.token) })),
      },
    });
    return {
      pecaId: p.id,
      exp: new Date(exp * 1000).toISOString(),
      midias: assinadas.map(({ tipo, n, url, bytes, sha256 }) => ({ tipo, n, url, bytes, sha256 })),
    };
  }

  /** O arquivo que o token autoriza, ou nulo. Nulo antes de qualquer consulta quando o token não confere. */
  async abrir(token: string): Promise<{ stream: Readable; size: number; contentType: string } | null> {
    const autorizado = conferir(token, segredoDaMidiaPublica());
    if (!autorizado) return null;
    const contentType = TIPO_POR_EXTENSAO[autorizado.chave.split('.').pop() ?? ''];
    if (!contentType) return null;
    return comTenantPublico(autorizado.orgId, async () => {
      if (!(await this.modulos.modulosDaOrg(autorizado.orgId)).has('pauta')) return null;
      const p = await this.prisma.pautaPeca.findFirst({
        where: { id: autorizado.pecaId, orgId: autorizado.orgId },
        select: { status: true, meta: true },
      });
      // Aprovada, ou já publicada enquanto a Graph ainda baixa; a que voltou a rascunho perde a URL.
      if (!p || (p.status !== 'aprovada' && p.status !== 'publicada') || !ehPecaDaSemana(p.meta)) return null;
      // A chave assinada há meia hora pode ter deixado de ser da peça (render novo, trecho editado).
      if (!midiasServiveis(lerMetaDaSemana(p.meta)).some((m) => m.chave === autorizado.chave)) return null;
      try {
        const { stream, size } = await this.storage.get(autorizado.chave);
        this.log.log(`mídia pública servida: peça ${autorizado.pecaId}, token ${rastroDoToken(token)}…`);
        return { stream, size, contentType };
      } catch (e) {
        this.log.warn(`mídia pública da peça ${autorizado.pecaId} fora do storage: ${(e as Error).message}`);
        return null;
      }
    });
  }
}
