import type { Readable } from 'node:stream';

import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ActorType, Prisma } from '@prisma/client';
import { classificar, type Efeito } from '@mktos/policy';
import {
  A_DECIDIR,
  LigarReguaDoImportadoSchema,
  ORIGEM_DO_CONTRATO_IMPORTADO,
  PROCEDENCIA_DO_CONTRATO_IMPORTADO,
  ParcelasDoImportadoSchema,
  fraseDeLigarARegua,
  linhasDoLancamento,
  somaDasParcelas,
  type ParcelaManual,
  type ResultadoDoContratoImportado,
} from '@mktos/shared';

import { temPapelDeMaquina } from '../approvals/alcada';
import { lerAprovador } from '../auth/aprovador';
import { exigirAcessoAtual } from '../memory/acesso-memoria';
import { PrismaService } from '../prisma/prisma.service';
import { ARMAZEM_DO_ANEXO, armazemDisponivel, conferirPdfRecebido, nomeDoPdf, sha256DoArquivo, type ArmazemDoAnexo, type ArquivoRecebido } from './anexo-do-contrato';
import { chaveDasParcelas, chaveDoAnexoImportado, linhasDoFato } from './contrato-importado';
import { ContratoVivoService } from './contrato-vivo.service';
import { hojeEmSP } from './dinheiro.service';
import { canonico, eventoIdComercial } from './eventos';
import { chaveDoAnexo } from './fechado-fora';
import { FioService } from './fio.service';

/*
 * O CONTRATO IMPORTADO DO CRM ANTIGO: O PDF E AS PARCELAS À MÃO (rodada de
 * produção 2, 22/10/2026, M2; sugestões 6 e 7 de SUGESTOES-IMPLANTACAO.md).
 *
 * FATO PASSADO, NÃO ATO COMERCIAL NOVO (decisão do dono do produto, 21/10):
 * nada aqui vai à porta, nada cria cobrança no Asaas, contrato do Financeiro,
 * mensagem ou aprovação. Três escritas de GENTE, cada uma com a pessoa relida
 * no banco (ativa, desta empresa, sem papel de máquina, com `leads.editar`
 * agora), uma linha na auditoria e o fato no fio, numa transação sob o cadeado
 * do contrato (`contrato-importado:<empresa>:<lead>:<origem>`):
 *
 *   1. ANEXAR O PDF: o mesmo armazém (pela mesma chave de conteúdo) e o mesmo
 *      fato `contrato.anexado` do "Registrar cliente já fechado", com
 *      `procedencia: 'importado'` e a origem do contrato. O mesmo PDF de novo
 *      não grava nada; outro PDF é a versão seguinte, e o anterior fica no fio.
 *   2. LANÇAR AS PARCELAS: série mensal ou linha a linha, centavos inteiros,
 *      dias de São Paulo. Cada lançamento é uma versão nova de
 *      `contrato.parcelas_lancadas`, condicionada à versão que a tela leu (outra
 *      aba salvou no meio, 409). Com a régua ligada, recusa: a régua é dona.
 *   3. LIGAR A RÉGUA: a régua de cobrança de hoje é a tarefa `dinheiro.regua`
 *      do relógio comercial, que nasce ligada para o contrato novo sem passar
 *      pela porta (quem passa pela porta é a cobrança no Asaas, no fechamento,
 *      R4). Ela grava avisos no fio e abre uma decisão no D+10; não manda nada
 *      ao cliente (os textos são [a decidir]). Ligar a do importado é, portanto,
 *      escrita interna de gente, auditada, com a frase na tela dizendo o que vai
 *      acontecer; o nível sai do efeito pela escada (R0), como o encerrar do T8,
 *      e se o efeito mudar a conta sobe sozinha e a rota recusa.
 */

/** O efeito das três escritas: dentro do OS, sem artefato, sem dinheiro, sem nada para fora. R0 pela escada. */
export const EFEITO_DO_CONTRATO_IMPORTADO: Efeito = {
  escreveForaDoOS: false,
  produzArtefato: false,
  reversibilidade: 'manual',
  exposicaoExterna: false,
  impactoFinanceiro: 'nenhum',
  sensibilidade: 'interna',
  destruicao: false,
  obrigacaoLegal: false,
};

const RECUSA_DE_MAQUINA = 'Contrato importado é de gente: conta de serviço (IA) não anexa PDF, não lança parcela e não liga a régua.';

export interface QuemNoContrato {
  id: string;
  nome: string | null;
  papeis: readonly string[];
}

@Injectable()
export class ContratoImportadoService {
  private readonly log = new Logger('ComercialContratoImportado');

  constructor(
    private readonly prisma: PrismaService,
    private readonly fio: FioService,
    private readonly contratos: ContratoVivoService,
    @Optional() private readonly moduleRef?: ModuleRef,
    @Optional() @Inject(ARMAZEM_DO_ANEXO) private readonly armazem?: ArmazemDoAnexo,
  ) {}

  /** Gente de verdade, relida no banco: ativa, desta empresa, sem papel de máquina e com `leads.editar` agora. */
  private async exigirGente(orgId: string, quem: QuemNoContrato): Promise<{ id: string; nome: string | null }> {
    if (!quem.id || temPapelDeMaquina(quem.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA);
    const doBanco = await lerAprovador(this.prisma, quem.id, orgId);
    if (!doBanco || !doBanco.ativo) throw new ForbiddenException('Só gente ativa da empresa mexe no contrato importado.');
    if (temPapelDeMaquina(doBanco.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA);
    await exigirAcessoAtual(this.prisma, orgId, quem.id, ['leads.editar']);
    const u = await this.prisma.user.findFirst({ where: { id: quem.id, orgId }, select: { name: true } });
    return { id: quem.id, nome: u?.name ?? quem.nome };
  }

  private nivel(): string {
    const nivel = classificar(EFEITO_DO_CONTRATO_IMPORTADO);
    if (nivel !== 'R0' && nivel !== 'R1') throw new ForbiddenException(`O contrato importado ficou ${nivel} pela escada: precisa de capacidade no catálogo antes de valer.`);
    return nivel;
  }

  private origemValida(origem: unknown): string {
    const o = typeof origem === 'string' ? origem.trim() : '';
    if (!ORIGEM_DO_CONTRATO_IMPORTADO.test(o)) throw new BadRequestException('Origem do contrato importado inválida.');
    return o;
  }

  /** O contrato importado existe neste lead, nesta empresa (senão 404, igual para "não existe" e "é de outra empresa"). */
  private async exigirContrato(orgId: string, leadId: string, origem: string): Promise<{ fechadoEm: string | null }> {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { id: true } });
    const fato = lead ? await this.prisma.leadEvent.findUnique({ where: { id: eventoIdComercial(orgId, leadId, 'contrato.importado', origem) }, select: { leadId: true, payload: true } }) : null;
    if (!fato || fato.leadId !== leadId) throw new NotFoundException('Contrato importado não encontrado.');
    const p = (fato.payload ?? {}) as Record<string, unknown>;
    return { fechadoEm: typeof p.fechadoEm === 'string' && p.fechadoEm ? p.fechadoEm : null };
  }

  private async travar(tx: Prisma.TransactionClient, orgId: string, leadId: string, origem: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`contrato-importado:${orgId}:${leadId}:${origem}`}))`;
  }

  private async auditar(tx: Prisma.TransactionClient, orgId: string, quemId: string, acao: string, leadId: string, before: unknown, after: unknown): Promise<void> {
    await tx.auditLog.create({
      data: {
        orgId, actorType: ActorType.user, actorId: quemId, action: acao, entityType: 'lead', entityId: leadId,
        before: (before ?? Prisma.JsonNull) as Prisma.InputJsonValue, after: after as Prisma.InputJsonValue,
      },
    });
  }

  private async resultado(orgId: string, leadId: string, novo: boolean, versao: number, agora: Date): Promise<ResultadoDoContratoImportado> {
    return { novo, versao, contrato: await this.contratos.doLead(orgId, leadId, agora) };
  }

  // -------------------------------------------------------------------------
  // 1. O PDF
  // -------------------------------------------------------------------------

  async anexar(orgId: string, leadId: string, origemBruta: unknown, quem: QuemNoContrato, arquivo: ArquivoRecebido | undefined, agora: Date = new Date()): Promise<ResultadoDoContratoImportado> {
    if (temPapelDeMaquina(quem.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA);
    conferirPdfRecebido(arquivo);
    const origem = this.origemValida(origemBruta);
    const nivel = this.nivel();
    const armazem = armazemDisponivel(this.armazem, this.moduleRef);
    if (!armazem) throw new ServiceUnavailableException('O envio de arquivo está indisponível agora: nada foi anexado.');
    const pessoa = await this.exigirGente(orgId, quem);
    const contrato = await this.exigirContrato(orgId, leadId, origem);

    const sha = sha256DoArquivo(arquivo.buffer);
    const chaveDoFato = chaveDoAnexoImportado(origem, sha);
    const idDoFato = eventoIdComercial(orgId, leadId, 'contrato.anexado', chaveDoFato);
    const ja = await this.prisma.leadEvent.findUnique({ where: { id: idDoFato }, select: { payload: true } });
    if (ja) return this.resultado(orgId, leadId, false, Number(((ja.payload ?? {}) as Record<string, unknown>).versao ?? 1), agora);

    // O armazém é por conteúdo: gravar o mesmo arquivo de novo cai na mesma chave.
    const chave = chaveDoAnexo(leadId, sha);
    const nome = nomeDoPdf(arquivo.originalname);
    await armazem.put(chave, arquivo.buffer, 'application/pdf');

    const r = await this.prisma.$transaction(async (tx) => {
      await this.travar(tx, orgId, leadId, origem);
      const anteriores = (await tx.leadEvent.findMany({ where: { leadId, type: 'contrato.anexado' }, select: { id: true, payload: true } }))
        .filter((e) => {
          const p = (e.payload ?? {}) as Record<string, unknown>;
          return p.procedencia === PROCEDENCIA_DO_CONTRATO_IMPORTADO && p.contratoImportado === origem;
        });
      const mesmo = anteriores.find((e) => e.id === idDoFato);
      if (mesmo) return { novo: false, versao: Number(((mesmo.payload ?? {}) as Record<string, unknown>).versao ?? 1) };
      const versao = anteriores.length + 1;
      const anterior = anteriores
        .map((e) => (e.payload ?? {}) as Record<string, unknown>)
        .sort((a, b) => Number(b.versao ?? 0) - Number(a.versao ?? 0))[0];
      const g = await this.fio.gravarNaTransacao(tx, orgId, leadId, 'contrato.anexado', chaveDoFato, {
        nome,
        bytes: arquivo.size,
        tipo: 'application/pdf',
        sha256: sha,
        chave,
        assinadoEm: contrato.fechadoEm ?? A_DECIDIR,
        procedencia: PROCEDENCIA_DO_CONTRATO_IMPORTADO,
        por: pessoa.nome,
        porId: pessoa.id,
        contratoImportado: origem,
        versao,
      }, agora);
      await this.auditar(tx, orgId, pessoa.id, 'comercial.contrato_importado.pdf_anexado', leadId,
        anterior ? { versao: Number(anterior.versao ?? 0), sha256: String(anterior.sha256 ?? '') } : null,
        { contrato: origem, versao, sha256: sha, bytes: arquivo.size, nivel, eventoId: g.evento.eventoId });
      return { novo: g.novo, versao };
    });
    if (r.novo) this.log.log(`PDF do contrato importado anexado (lead ${leadId}, versão ${r.versao}, ${arquivo.size} bytes)`);
    return this.resultado(orgId, leadId, r.novo, r.versao, agora);
  }

  /** O PDF anexado a um contrato importado (sem `sha`, o mais novo), para baixar. */
  async anexo(orgId: string, leadId: string, origemBruta: unknown, sha?: string): Promise<{ stream: Readable; contentType: string; size: number; nome: string }> {
    const origem = this.origemValida(origemBruta);
    await this.exigirContrato(orgId, leadId, origem);
    const fatos = (await this.prisma.leadEvent.findMany({ where: { leadId, type: 'contrato.anexado' }, select: { payload: true } }))
      .map((e) => (e.payload ?? {}) as Record<string, unknown>)
      .filter((p) => p.procedencia === PROCEDENCIA_DO_CONTRATO_IMPORTADO && p.contratoImportado === origem)
      .sort((a, b) => Number(b.versao ?? 0) - Number(a.versao ?? 0));
    const alvo = sha && /^[0-9a-f]{64}$/.test(sha) ? fatos.find((p) => p.sha256 === sha) : fatos[0];
    if (!alvo) throw new NotFoundException('Este contrato importado não tem PDF anexado.');
    const armazem = armazemDisponivel(this.armazem, this.moduleRef);
    if (!armazem) throw new ServiceUnavailableException('O storage de arquivos está indisponível agora.');
    const obj = await armazem.get(String(alvo.chave ?? ''));
    return { ...obj, nome: String(alvo.nome ?? 'contrato.pdf') };
  }

  // -------------------------------------------------------------------------
  // 2. As parcelas
  // -------------------------------------------------------------------------

  async lancarParcelas(orgId: string, leadId: string, corpo: unknown, quem: QuemNoContrato, agora: Date = new Date()): Promise<ResultadoDoContratoImportado> {
    if (temPapelDeMaquina(quem.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA);
    const r0 = ParcelasDoImportadoSchema.safeParse(corpo ?? {});
    if (!r0.success) throw new BadRequestException({ message: 'Parcelas inválidas.', erros: r0.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    const input = r0.data;
    const nivel = this.nivel();
    const pessoa = await this.exigirGente(orgId, quem);
    await this.exigirContrato(orgId, leadId, input.origem);
    const hoje = hojeEmSP(agora);
    const linhas = linhasDoLancamento(input);
    const futura = linhas.find((l) => l.pagaEm && l.pagaEm > hoje);
    if (futura) throw new BadRequestException(`A parcela ${futura.n} está marcada como paga em ${futura.pagaEm}, que ainda não chegou.`);
    const soma = somaDasParcelas(linhas);

    const r = await this.prisma.$transaction(async (tx) => {
      await this.travar(tx, orgId, leadId, input.origem);
      const ligada = await tx.leadEvent.findUnique({ where: { id: eventoIdComercial(orgId, leadId, 'contrato.regua_ligada', input.origem) }, select: { id: true } });
      if (ligada) throw new ConflictException('A régua de cobrança deste contrato já está ligada: as parcelas não se editam mais por aqui.');
      const versoes = (await tx.leadEvent.findMany({ where: { leadId, type: 'contrato.parcelas_lancadas' }, select: { payload: true } }))
        .map((e) => (e.payload ?? {}) as Record<string, unknown>)
        .filter((p) => p.origem === input.origem)
        .sort((a, b) => Number(b.versao ?? 0) - Number(a.versao ?? 0));
      const atual = versoes[0];
      const versaoAtual = atual ? Number(atual.versao ?? 0) : 0;
      if (input.versaoEsperada !== versaoAtual) {
        throw new ConflictException('Outra pessoa salvou as parcelas deste contrato agora há pouco. Recarregue para ver a versão nova antes de salvar.');
      }
      const anteriores: ParcelaManual[] = atual ? linhasDoFato(atual) : [];
      if (atual && canonico(anteriores) === canonico(linhas)) return { novo: false, versao: versaoAtual };
      const versao = versaoAtual + 1;
      const g = await this.fio.gravarNaTransacao(tx, orgId, leadId, 'contrato.parcelas_lancadas', chaveDasParcelas(input.origem, versao), {
        origem: input.origem,
        versao,
        linhas,
        somaCentavos: soma,
        por: pessoa.nome,
        porId: pessoa.id,
      }, agora);
      await this.auditar(tx, orgId, pessoa.id, 'comercial.contrato_importado.parcelas_lancadas', leadId,
        atual ? { versao: versaoAtual, parcelas: anteriores.length, somaCentavos: somaDasParcelas(anteriores) } : null,
        { contrato: input.origem, versao, parcelas: linhas.length, somaCentavos: soma, modo: input.serie ? 'serie' : 'linhas', nivel, eventoId: g.evento.eventoId });
      return { novo: g.novo, versao };
    });
    return this.resultado(orgId, leadId, r.novo, r.versao, agora);
  }

  // -------------------------------------------------------------------------
  // 3. A régua
  // -------------------------------------------------------------------------

  async ligarRegua(orgId: string, leadId: string, corpo: unknown, quem: QuemNoContrato, agora: Date = new Date()): Promise<ResultadoDoContratoImportado> {
    if (temPapelDeMaquina(quem.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA);
    const r0 = LigarReguaDoImportadoSchema.safeParse(corpo ?? {});
    if (!r0.success) throw new BadRequestException({ message: 'Confirme o que acontece ao ligar a régua.', erros: r0.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    const input = r0.data;
    const nivel = this.nivel();
    const pessoa = await this.exigirGente(orgId, quem);
    await this.exigirContrato(orgId, leadId, input.origem);
    const encerrado = await this.prisma.leadEvent.findFirst({ where: { leadId, type: { in: ['contrato.concluido', 'contrato.desativado'] } }, select: { id: true } });
    if (encerrado) throw new ConflictException('Este contrato já foi encerrado: a régua não liga.');
    const hoje = hojeEmSP(agora);

    const r = await this.prisma.$transaction(async (tx) => {
      await this.travar(tx, orgId, leadId, input.origem);
      const idDoFato = eventoIdComercial(orgId, leadId, 'contrato.regua_ligada', input.origem);
      const ja = await tx.leadEvent.findUnique({ where: { id: idDoFato }, select: { payload: true } });
      if (ja) return { novo: false, versao: Number(((ja.payload ?? {}) as Record<string, unknown>).versaoDasParcelas ?? 0) };
      const atual = (await tx.leadEvent.findMany({ where: { leadId, type: 'contrato.parcelas_lancadas' }, select: { payload: true } }))
        .map((e) => (e.payload ?? {}) as Record<string, unknown>)
        .filter((p) => p.origem === input.origem)
        .sort((a, b) => Number(b.versao ?? 0) - Number(a.versao ?? 0))[0];
      if (!atual) throw new BadRequestException('Lance as parcelas antes de ligar a régua.');
      const versao = Number(atual.versao ?? 0);
      if (versao !== input.versaoDasParcelas) throw new ConflictException('As parcelas mudaram depois que você abriu a tela. Recarregue e confira antes de ligar a régua.');
      const linhas = linhasDoFato(atual);
      const abertas = linhas.filter((l) => !l.pagaEm);
      const vencidas = abertas.filter((l) => l.vence < hoje).length;
      const frase = fraseDeLigarARegua(linhas, hoje);
      const g = await this.fio.gravarNaTransacao(tx, orgId, leadId, 'contrato.regua_ligada', input.origem, {
        origem: input.origem, versaoDasParcelas: versao, parcelasEmAberto: abertas.length, vencidas, frase, nivel, por: pessoa.nome, porId: pessoa.id,
      }, agora);
      await this.auditar(tx, orgId, pessoa.id, 'comercial.contrato_importado.regua_ligada', leadId, { regua: 'desligada' },
        { regua: 'ligada', contrato: input.origem, versaoDasParcelas: versao, parcelasEmAberto: abertas.length, vencidas, nivel, frase, eventoId: g.evento.eventoId });
      return { novo: g.novo, versao };
    });
    if (r.novo) this.log.log(`régua do contrato importado ligada (lead ${leadId}, parcelas v${r.versao})`);
    return this.resultado(orgId, leadId, r.novo, r.versao, agora);
  }
}
