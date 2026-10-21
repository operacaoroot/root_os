import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ContextKind, ContextSource } from '@prisma/client';
import {
  ATA_CHAVE_DO_DRIVE,
  arquivoDoDriveEhLegivel,
  idDaPastaDoDrive,
  linkDaPastaDoDrive,
  tipoDoArquivoDeAta,
  type TrabAtaDriveEstado,
  type TrabAtaTipo,
} from '@mktos/shared';

import { PortaDoOperador } from '../../gateway/porta-do-operador.service';
import { ehLeituraDoArquivo, textoDaLeitura } from '../../google/drive-das-atas';
import { MemoriaService } from '../../memory/memoria.service';
import { varrerSegredos } from '../../onboarding/trilho/segredos';

/*
 * A PASTA DO GOOGLE DRIVE COMO FONTE DE ATAS (produção 21, P7, 21/10/2026).
 *
 * A empresa escolhe UMA pasta (o link ou o id colado na tela de Atas). O id
 * mora na nota da memória `trabalho.atas.drive` (primeira linha), escrita só
 * pelo `MemoriaService`, o caminho da ADR-011, com versão e RASTRO.
 *
 * TUDO PELA PORTA, com as duas capacidades R0 do Drive:
 *   · `contexto.arquivo.listar` com `pasta` (e `texto`/`desde` da busca): a
 *     lista é o ÍNDICE (nome, data, tamanho, link), o que vai ao registro;
 *   · `contexto.arquivo.ler`: o texto de UM arquivo, que volta sigiloso (o
 *     registro guarda o resumo criptográfico e o tamanho, nunca o texto).
 * Nada do Drive é copiado para o banco: o texto vive só enquanto a ata está
 * aberta ou é usada para sugerir tarefas, e passa pela varredura de segredos
 * antes da tela, do modelo e do trecho guardado. O interruptor do Drive em
 * Conexões vale (a porta pergunta), e o arquivo que não está na pasta das
 * atas é "não encontrado", mesmo que o Drive o entregue.
 *
 * Quem lê o Drive daqui precisa de `drive.ver`, a permissão que lê o Drive em
 * toda a API: o banco de atas não alarga acesso (a regra PA-2 do vault).
 */

export const RECUSA_DO_DRIVE_NAS_ATAS =
  'As atas do Google Drive pedem a permissão de ler o Drive (drive.ver), que o seu perfil não tem.';
export const LIMITE_DA_LISTA_DO_DRIVE = 50;

export interface ArquivoDoDriveListado {
  id: string;
  nome: string;
  mimeType: string;
  tipo: TrabAtaTipo;
  modificadoEm: string | null;
  link: string | null;
  bytes: number | null;
}

export interface ArquivoDoDriveAberto extends ArquivoDoDriveListado {
  /** Já mascarado. Só em memória. */
  texto: string;
  segredosMascarados: number;
}

const ehRetida = (r: unknown) => (r as { status?: unknown } | null)?.status === 'aguardando_aprovacao';

/** O nome sem a extensão, para o título da ata. */
export function tituloDoArquivo(nome: string): string {
  return String(nome ?? '').replace(/\.(md|markdown|txt|pdf|vtt|srt)$/i, '').trim() || 'Arquivo sem nome';
}

@Injectable()
export class DriveDasAtasService {
  constructor(
    private readonly porta: PortaDoOperador,
    private readonly memoria: MemoriaService,
  ) {}

  /** O id da pasta escolhida, ou `null`. Nota restrita ou arquivada não vale como configuração. */
  async pasta(orgId: string): Promise<string | null> {
    const nota = await this.memoria.porChave(orgId, ATA_CHAVE_DO_DRIVE, null).catch(() => null);
    if (!nota || nota.arquivadoEm) return null;
    const linha = nota.body.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    return idDaPastaDoDrive(linha ?? null);
  }

  async estado(orgId: string, permitido: boolean): Promise<TrabAtaDriveEstado> {
    const pastaId = await this.pasta(orgId);
    return {
      configurada: !!pastaId,
      pastaId,
      permitido,
      motivo: !pastaId ? 'Nenhuma pasta do Drive escolhida para as atas.' : !permitido ? RECUSA_DO_DRIVE_NAS_ATAS : null,
      link: pastaId ? linkDaPastaDoDrive(pastaId) : null,
    };
  }

  /**
   * Escolhe (ou tira, com `null`) a pasta. A pasta nova é conferida PELA PORTA
   * antes de gravar: a lista de um arquivo só, o que diz se o Google está
   * conectado e se a pasta existe para esta conta.
   */
  async configurar(orgId: string, actorId: string, colado: string | null): Promise<TrabAtaDriveEstado> {
    const atual = await this.memoria.porChave(orgId, ATA_CHAVE_DO_DRIVE, null).catch(() => null);
    if (colado === null || !colado.trim()) {
      if (atual && !atual.arquivadoEm) await this.memoria.arquivar(orgId, atual.id, 'a pasta do Drive das atas foi tirada na tela de Atas');
      return this.estado(orgId, true);
    }
    const pastaId = idDaPastaDoDrive(colado);
    if (!pastaId) throw new BadRequestException('Isso não parece o link nem o id de uma pasta do Google Drive. Cole o endereço da pasta.');
    await this.listarNaPorta(orgId, actorId, pastaId, { limite: 1 });
    const corpo = `${pastaId}\n\nA pasta do Google Drive de onde o Trabalho lê as atas e as transcrições. Escolhida na tela de Atas.`;
    if (atual) {
      if (atual.arquivadoEm) await this.memoria.restaurar(orgId, atual.id, 'a pasta do Drive das atas voltou a ser escolhida');
      if (idDaPastaDoDrive(atual.body.split(/\r?\n/)[0]) !== pastaId || atual.arquivadoEm) {
        await this.memoria.alterar(orgId, atual.id, { body: corpo, motivo: 'a pasta do Drive das atas foi trocada na tela de Atas' });
      }
    } else {
      await this.memoria.criar(orgId, {
        chave: ATA_CHAVE_DO_DRIVE,
        kind: ContextKind.definicao,
        title: 'Pasta do Drive das atas',
        body: corpo,
        tags: ['ata', 'trabalho', 'configuracao'],
        sourceType: ContextSource.operador,
        sourceRef: 'escolhida em Trabalho › Atas',
        motivo: 'a pasta do Drive das atas foi escolhida na tela de Atas',
      });
    }
    return this.estado(orgId, true);
  }

  /** A lista da pasta (o índice), mais nova primeiro, só com o que o banco de atas lê. */
  async listar(orgId: string, actorId: string, pastaId: string, busca: { q?: string; desde?: string }): Promise<ArquivoDoDriveListado[]> {
    const bruto = await this.listarNaPorta(orgId, actorId, pastaId, { texto: busca.q, desde: busca.desde, limite: LIMITE_DA_LISTA_DO_DRIVE });
    return bruto
      .filter((f) => arquivoDoDriveEhLegivel(f.name, f.mimeType))
      .map((f) => ({
        id: f.id,
        nome: f.name,
        mimeType: f.mimeType,
        tipo: tipoDoArquivoDeAta(f.name),
        modificadoEm: f.modifiedTime ?? null,
        link: f.link ?? null,
        bytes: typeof f.size === 'number' ? f.size : null,
      }));
  }

  /** Um arquivo da pasta das atas, com o texto (mascarado). Fora da pasta = não encontrado. */
  async abrir(orgId: string, actorId: string, pastaId: string, fileId: string): Promise<ArquivoDoDriveAberto> {
    const r = await this.porta.executar({
      orgId,
      actorId,
      capabilityId: 'contexto.arquivo.ler',
      args: { id: fileId },
      resource: { type: 'drive', id: fileId },
    });
    if (ehRetida(r)) throw new ForbiddenException('A leitura deste arquivo ficou retida pela política. Veja em Aprovações.');
    if (!ehLeituraDoArquivo(r)) throw new BadRequestException('O Drive não devolveu o arquivo.');
    if (!r.pastas.includes(pastaId)) throw new NotFoundException('Ata não encontrada.');
    const varredura = varrerSegredos(textoDaLeitura(r.texto).replace(/\r\n/g, '\n').trim());
    return {
      id: r.id,
      nome: r.nome,
      mimeType: r.mimeType,
      tipo: tipoDoArquivoDeAta(r.nome),
      modificadoEm: r.modificadoEm,
      link: r.link,
      bytes: r.bytes,
      texto: varredura.texto,
      segredosMascarados: varredura.removidos,
    };
  }

  private async listarNaPorta(
    orgId: string,
    actorId: string,
    pasta: string,
    o: { texto?: string; desde?: string; limite: number },
  ): Promise<Array<{ id: string; name: string; mimeType: string; modifiedTime?: string; link?: string | null; size?: number | null }>> {
    const r = await this.porta.executar({
      orgId,
      actorId,
      capabilityId: 'contexto.arquivo.listar',
      args: { pasta, limite: o.limite, ...(o.texto ? { texto: o.texto } : {}), ...(o.desde ? { desde: o.desde } : {}) },
      resource: { type: 'drive.pasta', id: pasta },
    });
    if (ehRetida(r)) throw new ForbiddenException('A leitura da pasta ficou retida pela política. Veja em Aprovações.');
    if (!Array.isArray(r)) throw new BadRequestException('O Drive não devolveu a lista da pasta.');
    return r.filter((f): f is { id: string; name: string; mimeType: string } => !!f && typeof f.id === 'string' && typeof f.name === 'string');
  }
}
