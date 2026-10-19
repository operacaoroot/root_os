import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { ContextKind, ContextSource, type Prisma } from '@prisma/client';
import type { z } from 'zod';
import {
  BRANDBOOK_CHAVE,
  type BrandbookAtivo, type BrandbookAtivarInput, type BrandbookPainel, type BrandbookPrevia,
  type BrandbookReferenciaRoot, type BrandbookSalvarInput,
} from '@mktos/shared';
import { MemoriaService, type NotaDeContexto, type IdentidadeDaDerivacao, type LeitorFisicoDaDerivacao, type DescritorFisicoDaFonte } from '../memory/memoria.service';
import { PrismaService } from '../prisma/prisma.service';
import { contextoAtual } from '../common/contexto-execucao';
import { exigirAcessoAtual } from '../memory/acesso-memoria';
import { ESCRITA_DO_BRANDBOOK, BrandbookEnvelopeSchema } from '../memory/brandbook-escrita';
import { conferirLogo, conferirUrlDaMarca, hashDoBrandbook, pendenciasDaMarca, validarDocumento } from './brandbook-documento';
import referenciaRoot from './assets/brandbook-root.json';

type Envelope = z.infer<typeof BrandbookEnvelopeSchema>;
type Leitura = { nota: NotaDeContexto | null; documento: Envelope | null };
export interface BrandbookDaGeracao { fisica: DescritorFisicoDaFonte; envelope: Envelope | null; ativo: BrandbookAtivo | null }

@Injectable()
export class BrandbookService {
  constructor(private readonly memoria: MemoriaService, private readonly prisma: PrismaService) {}

  private async conferirLeitor(orgId: string): Promise<void> {
    const contexto = contextoAtual();
    if (contexto && contexto.orgId !== orgId) throw new ForbiddenException('A marca pertence a outra empresa.');
    if (contexto?.actorType === 'user' || contexto?.origem === 'http') {
      if (contexto.actorType !== 'user' || !contexto.actorId || !contexto.orgId) throw new ForbiddenException('Acesso insuficiente.');
      await exigirAcessoAtual(this.prisma, orgId, contexto.actorId, ['pauta.ver']);
    }
  }

  private async ler(orgId: string): Promise<Leitura> {
    await this.conferirLeitor(orgId);
    // Consulta de domínio limitada à chave aberta fixa; nunca lê conteúdo restrito.
    const metadata = () => this.prisma.contextItem.findFirst({
      where: { orgId, chave: BRANDBOOK_CHAVE },
      select: { id: true, acessoRestrito: true, arquivadoEm: true, versao: true, contentHash: true },
    });
    const antes = await metadata();
    if (antes?.acessoRestrito) throw new ForbiddenException('O brandbook tem acesso restrito. Revise a configuração de acesso.');
    const nota = await this.memoria.porChave(orgId, BRANDBOOK_CHAVE, null);
    const depois = await metadata();
    if (depois?.acessoRestrito) throw new ForbiddenException('O acesso ao brandbook mudou. Recarregue a página.');
    if (!nota && !antes && !depois) {
      await this.conferirLeitor(orgId);
      return { nota: null, documento: null };
    }
    if (!nota || !depois || nota.id !== depois.id || nota.versao !== depois.versao || nota.contentHash !== depois.contentHash || (nota.arquivadoEm ?? null) !== (depois.arquivadoEm?.toISOString() ?? null)) {
      throw new ConflictException('O brandbook mudou durante a leitura. Recarregue a página.');
    }
    const documento = this.conferirEnvelopeArmazenado(nota.body);
    await this.conferirLeitor(orgId);
    return { nota, documento };
  }

  private conferirEnvelopeArmazenado(body: string): Envelope {
    let documento: Envelope;
    try { documento = BrandbookEnvelopeSchema.parse(JSON.parse(body)); }
    catch { throw new ConflictException('O brandbook armazenado está inválido. Revise a nota antes de continuar.'); }
    if (documento.ativo) {
      conferirLogo(documento.ativo.documento.visual.logoDataUrl);
      if (documento.ativo.documento.origem.url) conferirUrlDaMarca(documento.ativo.documento.origem.url);
      if (hashDoBrandbook(documento.ativo.documento) !== documento.ativo.draftHash || pendenciasDaMarca(documento.ativo.documento).length) {
        throw new ConflictException('A marca ativa armazenada está inválida. Revise o brandbook.');
      }
    }
    return documento;
  }

  /** Reader interno de uma geração; usa o mesmo tx e a chave aberta fixa. */
  async lerParaGeracaoNoTx(tx: Prisma.TransactionClient, orgId: string, identidade: IdentidadeDaDerivacao,
    lerFonte: LeitorFisicoDaDerivacao): Promise<BrandbookDaGeracao> {
    const conferir = async () => {
      const c = contextoAtual(); const ator = identidade.tipo === 'humano'
        ? { actorType: 'user', actorId: identidade.actorId, correlationId: identidade.correlationId }
        : { ...identidade.ator, correlationId: identidade.ctx.correlationId };
      if (c?.orgId !== orgId || c.actorType !== ator.actorType || (c.actorId ?? null) !== ator.actorId
        || !ator.correlationId || c.correlationId !== ator.correlationId) throw new ForbiddenException('Acesso insuficiente.');
      if (ator.actorType === 'user') await exigirAcessoAtual(tx, orgId, ator.actorId, ['pauta.ver']);
    };
    await conferir();
    const fisica = await lerFonte({ chave: BRANDBOOK_CHAVE });
    if (fisica.estado === 'ausente_fisico') { await conferir(); return { fisica, envelope: null, ativo: null }; }
    if (fisica.nota.acessoRestrito) throw new ForbiddenException('O brandbook tem acesso restrito. Revise a configuração de acesso.');
    if (fisica.nota.arquivadoEm) throw new ConflictException('O brandbook foi arquivado. Revise sua situação no criador.');
    const envelope = this.conferirEnvelopeArmazenado(fisica.nota.body);
    await conferir();
    return { fisica, envelope, ativo: envelope.ativo };
  }

  private resposta(l: Leitura): BrandbookPainel {
    return { id: l.nota?.id ?? null, versao: l.nota?.versao ?? null, hash: l.nota?.contentHash ?? null,
      estado: !l.nota ? 'ausente' : l.nota.arquivadoEm ? 'arquivado' : l.documento?.ativo ? 'ativo' : 'rascunho',
      rascunho: l.documento?.rascunho ?? null, ativo: l.documento?.ativo ?? null };
  }
  async painel(orgId: string): Promise<BrandbookPainel> { return this.resposta(await this.ler(orgId)); }

  async painelParaPauta(orgId: string): Promise<BrandbookPainel> {
    const l = await this.ler(orgId);
    if (l.nota?.arquivadoEm) throw new ConflictException('O brandbook foi arquivado. Revise sua situação no criador.');
    return this.resposta(l);
  }
  async ativoParaPauta(orgId: string): Promise<BrandbookAtivo | null> {
    return (await this.painelParaPauta(orgId)).ativo;
  }
  async exigirLegadoPermitido(orgId: string): Promise<void> {
    if (await this.ativoParaPauta(orgId)) throw new ConflictException('Há um brandbook ativo. Edite e aprove um rascunho no criador de marca.');
  }
  private conferirVersao(l: Leitura, versao: number | null): void {
    if ((l.nota?.versao ?? null) !== versao) throw new ConflictException('O brandbook mudou desde a leitura. Recarregue antes de salvar.');
    if (l.nota?.arquivadoEm) throw new ConflictException('O brandbook está arquivado. Nenhuma alteração foi aplicada.');
  }
  private async gravar(orgId: string, l: Leitura, envelope: Envelope, versao: number | null, motivo: string): Promise<BrandbookPainel> {
    this.conferirVersao(l, versao);
    const entrada = { kind: ContextKind.definicao, title: 'Livro da marca', body: JSON.stringify(envelope), tags: ['marca', 'pauta', 'brandbook'], sourceType: ContextSource.operador, sourceRef: `brandbook · ${motivo}`, motivo };
    if (l.nota) await this.memoria.alterar(orgId, l.nota.id, { ...entrada, versaoEsperada: versao! }, ESCRITA_DO_BRANDBOOK);
    else await this.memoria.criar(orgId, { ...entrada, chave: BRANDBOOK_CHAVE, acessoRestrito: false }, ESCRITA_DO_BRANDBOOK);
    return this.painel(orgId);
  }
  async salvar(orgId: string, pedido: BrandbookSalvarInput): Promise<BrandbookPainel> {
    const documento = validarDocumento(pedido.documento);
    const l = await this.ler(orgId);
    return this.gravar(orgId, l, { schemaVersion: 1, rascunho: documento, ativo: l.documento?.ativo ?? null }, pedido.versaoEsperada, 'rascunho salvo; marca ativa preservada');
  }
  async previa(orgId: string, versao: number | null): Promise<BrandbookPrevia> {
    const l = await this.ler(orgId);
    this.conferirVersao(l, versao);
    if (!l.nota || !l.documento?.rascunho) throw new ConflictException('Salve um rascunho antes de pedir a prévia.');
    const documento = validarDocumento(l.documento.rascunho);
    return { versao: l.nota.versao, draftHash: hashDoBrandbook(documento), documento, pendencias: pendenciasDaMarca(documento) };
  }
  async ativar(orgId: string, actorId: string, pedido: BrandbookAtivarInput): Promise<BrandbookPainel> {
    const l = await this.ler(orgId);
    this.conferirVersao(l, pedido.versaoEsperada);
    if (!l.documento?.rascunho) throw new ConflictException('Salve e confira o rascunho antes de ativar.');
    const documento = validarDocumento(l.documento.rascunho);
    const draftHash = hashDoBrandbook(documento);
    if (draftHash !== pedido.draftHash || pedido.aprovacao !== true) throw new ConflictException('A prévia mudou ou não foi aprovada. Confira o rascunho novamente.');
    const pendencias = pendenciasDaMarca(documento);
    if (pendencias.length) throw new ConflictException({ message: 'Resolva as pendências antes de ativar.', pendencias });
    return this.gravar(orgId, l, { schemaVersion: 1, rascunho: documento, ativo: { documento, aprovadoPor: actorId, aprovadoEm: new Date().toISOString(), draftHash } }, pedido.versaoEsperada, 'marca aprovada e ativada');
  }
  async desativar(orgId: string, versao: number | null): Promise<BrandbookPainel> {
    const l = await this.ler(orgId);
    this.conferirVersao(l, versao);
    if (!l.nota || !l.documento) throw new ConflictException('Não há brandbook salvo para desativar.');
    if (!l.documento.ativo) return this.resposta(l);
    return this.gravar(orgId, l, { ...l.documento, ativo: null }, versao, 'marca desativada; notas legadas preservadas');
  }
  referenciaRoot(): BrandbookReferenciaRoot {
    return { documento: validarDocumento(referenciaRoot.documento), fonte: { ...referenciaRoot.fonte } };
  }
}
