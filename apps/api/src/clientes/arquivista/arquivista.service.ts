import { BadRequestException, Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ActorType, ApprovalState, type ArquivoDoCliente, type Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import {
  SUBPASTAS_DO_CLIENTE,
  extensaoDoNome,
  funcaoPorId,
  nomePadraoDoArquivo,
  type SubpastaDoCliente,
} from '@mktos/shared';

import { AuditService } from '../../audit/audit.service';
import { EfeitosRegistry, type ContextoDoEfeito } from '../../gateway/efeitos.registry';
import { PortaDoOperador } from '../../gateway/porta-do-operador.service';
import { DRIVE_DO_CLIENTE, MIME_DA_PASTA, type DriveDoCliente } from '../../google/drive-do-cliente';
import { LLM_PROVIDER, type LlmProvider } from '../../llm/llm.provider';
import { MemoriaService } from '../../memory/memoria.service';
import { PendenciasRegistry, type RespostaDaPendencia } from '../../pendencias/pendencias.registry';
import { PendenciasService } from '../../pendencias/pendencias.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { naEmpresa, PastaDoClienteService } from '../pasta-do-cliente/pasta-do-cliente.service';
import { FRASE_SEM_RAIZ, idDaRaizDosClientes } from '../pasta-do-cliente/raiz';
import type { ArquivistaDoClientePort, PedidoDeArquivo, ResultadoDoArquivo } from '../portas';
import {
  FUNCAO_DA_SEGUNDA_LEITURA,
  FUNCAO_DO_ARQUIVISTA,
  SLUG_DA_SEGUNDA_LEITURA,
  classificacaoSegura,
  lerClassificacao,
  promptDaClassificacao,
  textoParaClassificar,
  type Classificacao,
} from './classificador';

/*
 * TR-05 · O ARQUIVISTA DO CLIENTE (rodada dos agentes, 21/10/2026, lane A4).
 *
 * Todo arquivo que chega para um cliente passa por aqui: o binário fica no
 * storage do OS, o registro em `ArquivoDoCliente`, e a cópia vai à subpasta
 * certa da pasta do cliente pela porta (`drive.arquivo.enviar`, R3: retém e
 * espera a segunda pessoa). As seis saídas:
 *
 *   · `so_no_os`             cliente interno, ou nem cliente nem lead;
 *   · `na_fila`              sem pasta do cliente (ou só o lead): espera, e sai
 *                            quando a pasta nascer (`PastaDoClienteService`
 *                            avisa e `esvaziarFila` propõe cada um);
 *   · `classificar_a_mao`    confiança baixa: vira pendência (TR-05,
 *                            `arquivo.classificar`) com as subpastas de opção; o
 *                            tratador manda pela porta para a escolhida. Nada vai
 *                            ao Drive antes da escolha (nada no Drive se apaga, e
 *                            uma cópia em `_fonte` mais outra na subpasta seria
 *                            lixo que ninguém pode limpar);
 *   · `aguardando_aprovacao` foi à porta e espera a segunda pessoa;
 *   · `enviado`              está no Drive (o efeito grava o link);
 *   · `erro`                 com o motivo.
 *
 * ARQUIVO DE A NUNCA VAI PARA A PASTA DE B: a porta recebe o cliente
 * (`clienteId`), nunca uma pasta; o efeito acha o registro do arquivo NESTA
 * empresa e DESTE cliente (com a mesma chave e o mesmo hash), lê a pasta do
 * ponteiro DESTE cliente, confere que ela e a subpasta estão dentro da raiz, e
 * confere o hash do binário contra o que a aprovação assinou antes de enviar.
 *
 * O MODELO (TR-05, Haiku) classifica; com confiança baixa, uma segunda leitura
 * (`TR-11`, Sonnet) quando o cadastro a tiver. Falha do modelo não derruba:
 * vira "classificar à mão".
 */

/** O proponente quando quem manda o arquivo não é uma pessoa da casa (a sala, uma rotina). O slug do TR-05. */
export const ATOR_DO_ARQUIVISTA = 'arquivista-do-cliente';
export const TIPO_DA_PENDENCIA = 'arquivo.classificar';
const TETO_DO_BINARIO = 100 * 1024 * 1024;

const motivoDe = (e: unknown): string => {
  const r = (e as { response?: { message?: unknown } })?.response?.message;
  const m = typeof r === 'string' ? r : (e as Error)?.message;
  return String(m || 'falha desconhecida').slice(0, 500);
};

const ehRetida = (r: unknown): r is { status: 'aguardando_aprovacao'; approvalId: string } =>
  (r as { status?: unknown } | null)?.status === 'aguardando_aprovacao';

export interface ArmazemDoArquivista {
  put(chave: string, corpo: Buffer, tipo: string): Promise<void>;
  get(chave: string): Promise<{ stream: NodeJS.ReadableStream; size: number }>;
}

@Injectable()
export class ArquivistaService implements ArquivistaDoClientePort, OnModuleInit {
  private readonly log = new Logger('Arquivista');

  constructor(
    private readonly prisma: PrismaService,
    private readonly porta: PortaDoOperador,
    private readonly efeitos: EfeitosRegistry,
    private readonly audit: AuditService,
    private readonly pendencias: PendenciasService,
    private readonly registroDePendencias: PendenciasRegistry,
    private readonly pastas: PastaDoClienteService,
    private readonly memoria: MemoriaService,
    @Inject(DRIVE_DO_CLIENTE) private readonly drive: DriveDoCliente,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    @Optional() private readonly storage?: StorageService,
  ) {}

  /** O storage (a suíte troca por um dublê). */
  private armazem: ArmazemDoArquivista | null = null;
  usarArmazem(a: ArmazemDoArquivista): void {
    this.armazem = a;
  }
  private get deposito(): ArmazemDoArquivista | null {
    if (this.armazem) return this.armazem;
    if (this.storage?.configured) return this.storage as unknown as ArmazemDoArquivista;
    return null;
  }

  onModuleInit(): void {
    this.efeitos.registrar(
      { 'drive.arquivo.enviar': (a, org, ctx) => this.efeitoEnviar(a, org, ctx) },
      'ArquivistaService',
    );
    this.registroDePendencias.aoResponder(TIPO_DA_PENDENCIA, (r) => this.aoClassificarAMao(r), 'ArquivistaService');
    this.pastas.quandoAPastaNascer(async (orgId, partnerId) => {
      await this.esvaziarFila(orgId, partnerId);
    }, 'ArquivistaService');
  }

  // -------------------------------------------------------------------------
  // A porta do arquivista
  // -------------------------------------------------------------------------

  async arquivar(pedido: PedidoDeArquivo): Promise<ResultadoDoArquivo> {
    return naEmpresa(pedido.orgId, pedido.atorId ?? null, async () => {
      try {
        return await this.arquivarNaEmpresa(pedido);
      } catch (e) {
        this.log.warn(`arquivo não arquivado: ${motivoDe(e)}`);
        return { estado: 'erro', motivo: motivoDe(e) };
      }
    });
  }

  private async arquivarNaEmpresa(pedido: PedidoDeArquivo): Promise<ResultadoDoArquivo> {
    const { orgId } = pedido;
    let partnerId = pedido.partnerId ?? null;
    if (!partnerId && pedido.leadId) {
      const ficha = await this.prisma.comercialFicha.findFirst({ where: { orgId, leadId: pedido.leadId }, select: { partnerId: true } });
      partnerId = ficha?.partnerId ?? null;
    }
    const partner = partnerId
      ? await this.prisma.partner.findFirst({ where: { id: partnerId, orgId }, select: { id: true, isCliente: true, interno: true, pastaDriveId: true } })
      : null;
    if (partnerId && (!partner || !partner.isCliente)) return { estado: 'erro', motivo: 'cliente não encontrado nesta empresa.' };
    if (partner?.interno) return { estado: 'so_no_os', motivo: 'tarefa do cliente interno da casa: o arquivo fica só no OS.' };
    if (!partner && !pedido.leadId) return { estado: 'so_no_os', motivo: 'sem cliente: o arquivo fica só no OS.' };

    // O binário no storage do OS, antes de qualquer coisa.
    let buffer: Buffer | null = null;
    let conteudo: { chave: string; sha256: string; bytes: number };
    if ('buffer' in pedido.conteudo) {
      buffer = pedido.conteudo.buffer;
      if (!buffer.length) return { estado: 'erro', motivo: 'o arquivo está vazio.' };
      const deposito = this.deposito;
      if (!deposito) return { estado: 'erro', motivo: 'o storage do OS está indisponível: o arquivo não foi guardado.' };
      const sha256 = createHash('sha256').update(buffer).digest('hex');
      conteudo = { chave: `clientes/arquivos/${orgId}/${sha256}`, sha256, bytes: buffer.length };
      await deposito.put(conteudo.chave, buffer, pedido.tipoMime || 'application/octet-stream');
    } else {
      conteudo = pedido.conteudo;
      if (!/^[a-f0-9]{64}$/.test(conteudo.sha256) || !(conteudo.bytes > 0)) return { estado: 'erro', motivo: 'o arquivo do storage veio sem hash ou sem tamanho.' };
    }

    // Idempotência: o mesmo anexo (ref), ou o mesmo conteúdo para o mesmo dono, cai no mesmo registro.
    const ja = await this.prisma.arquivoDoCliente.findFirst({
      where: pedido.ref
        ? { orgId, refTipo: pedido.ref.tipo, refId: pedido.ref.id }
        : { orgId, sha256: conteudo.sha256, ...(partner ? { partnerId: partner.id } : { leadId: pedido.leadId ?? undefined }), estado: { not: 'erro' } },
      orderBy: { criadoEm: 'desc' },
    });
    // Pedido antigo cuja aprovação venceu ou foi recusada: propõe de novo (o mesmo registro).
    if (ja && ja.estado === 'aguardando_aprovacao') return this.proporEnvio(ja, pedido.atorId ?? ja.atorId);
    if (ja && ja.estado !== 'erro') return this.resultadoDe(ja);

    // A classificação: a do chamador, ou a do modelo.
    let classificacao: Classificacao | null;
    if (pedido.subpasta) {
      classificacao = {
        subpasta: pedido.subpasta,
        tipo: pedido.tipo?.trim() || 'Arquivo',
        titulo: pedido.titulo?.trim() || pedido.nomeOriginal.replace(/\.[^.]{1,10}$/, ''),
        confianca: 1,
      };
    } else {
      if (!buffer && ['pdf', 'txt', 'md', 'csv'].includes(extensaoDoNome(pedido.nomeOriginal)) && conteudo.bytes <= 15 * 1024 * 1024) {
        buffer = await this.lerBinario(conteudo.chave).catch(() => null);
      }
      const texto = pedido.texto ?? textoParaClassificar(pedido.nomeOriginal, pedido.tipoMime, buffer);
      classificacao = await this.classificar(orgId, { nomeOriginal: pedido.nomeOriginal, tipoMime: pedido.tipoMime, origem: pedido.origem, texto });
    }
    const segura = classificacaoSegura(classificacao);
    const subpasta: SubpastaDoCliente = segura ? classificacao!.subpasta : '_fonte';
    const nome = nomePadraoDoArquivo(
      pedido.data ?? new Date(),
      classificacao?.tipo ?? 'Arquivo',
      classificacao?.titulo ?? pedido.nomeOriginal.replace(/\.[^.]{1,10}$/, ''),
      extensaoDoNome(pedido.nomeOriginal),
    );

    const dados = {
      orgId,
      partnerId: partner?.id ?? null,
      leadId: pedido.leadId ?? null,
      origem: pedido.origem,
      nomeOriginal: pedido.nomeOriginal.slice(0, 300),
      tipoMime: (pedido.tipoMime || 'application/octet-stream').slice(0, 120),
      chave: conteudo.chave,
      sha256: conteudo.sha256,
      bytes: conteudo.bytes,
      subpasta,
      nome,
      tipo: classificacao?.tipo ?? null,
      titulo: classificacao?.titulo ?? null,
      confianca: classificacao?.confianca ?? null,
      atorId: pedido.atorId ?? null,
      refTipo: pedido.ref?.tipo ?? null,
      refId: pedido.ref?.id ?? null,
      estado: 'na_fila',
      motivo: null,
      approvalId: null,
    };
    const linha = ja
      ? await this.prisma.arquivoDoCliente.update({ where: { id: ja.id }, data: dados })
      : await this.prisma.arquivoDoCliente.create({ data: dados });

    if (!segura) return this.pedirClassificacaoAMao(linha);
    return this.proporEnvio(linha, pedido.atorId ?? null);
  }

  /** A primeira leitura (TR-05) e, com confiança baixa, a segunda (TR-11), se o cadastro a tiver. */
  private async classificar(
    orgId: string,
    a: { nomeOriginal: string; tipoMime: string; origem: string; texto: string },
  ): Promise<Classificacao | null> {
    const { system, user } = promptDaClassificacao(a);
    const ler = async (funcao: string): Promise<Classificacao | null> => {
      try {
        return lerClassificacao(await this.llm.complete({ funcao, system, user, orgId, maxTokens: 300 }));
      } catch (e) {
        this.log.warn(`o modelo não classificou o arquivo (${funcao}): ${motivoDe(e)}`);
        return null;
      }
    };
    const primeira = await ler(FUNCAO_DO_ARQUIVISTA);
    if (classificacaoSegura(primeira)) return primeira;
    const revisao = funcaoPorId(FUNCAO_DA_SEGUNDA_LEITURA);
    if (!revisao || revisao.slug !== SLUG_DA_SEGUNDA_LEITURA || !revisao.modelo) return primeira;
    const segunda = await ler(FUNCAO_DA_SEGUNDA_LEITURA);
    return classificacaoSegura(segunda) ? segunda : (segunda ?? primeira);
  }

  private async pedirClassificacaoAMao(linha: ArquivoDoCliente): Promise<ResultadoDoArquivo> {
    const p = await this.pendencias.abrir(linha.orgId, {
      funcao: FUNCAO_DO_ARQUIVISTA,
      tipo: TIPO_DA_PENDENCIA,
      chave: `arquivo:${linha.id}`,
      titulo: `Classificar à mão: ${linha.nomeOriginal}`.slice(0, 300),
      contexto: 'O arquivista não teve certeza da subpasta. Escolha onde o arquivo fica na pasta do cliente; a cópia no Drive sai pela fila de aprovação.',
      opcoes: SUBPASTAS_DO_CLIENTE.map((s) => ({ chave: s, rotulo: s === '_fonte' ? '_fonte (deixar sem classificar)' : s })),
      // Para quem mandou o arquivo, quando é gente da casa; senão, para qualquer pessoa.
      paraUsuarioId: linha.atorId && (await this.ehPessoaDaEmpresa(linha.orgId, linha.atorId)) ? linha.atorId : null,
      refTipo: 'ArquivoDoCliente',
      refId: linha.id,
    });
    await this.prisma.arquivoDoCliente.updateMany({
      where: { id: linha.id, orgId: linha.orgId },
      data: { estado: 'classificar_a_mao', pendenciaId: p.id, motivo: 'confiança baixa: espera uma pessoa escolher a subpasta.' },
    });
    return { estado: 'classificar_a_mao', pendenciaId: p.id };
  }

  /** O tratador da pendência: a subpasta escolhida, e a cópia pela porta em nome de quem escolheu. */
  private async aoClassificarAMao(r: RespostaDaPendencia): Promise<void> {
    if (r.refTipo !== 'ArquivoDoCliente' || !r.refId) return;
    if (!(SUBPASTAS_DO_CLIENTE as readonly string[]).includes(r.escolha)) throw new BadRequestException('subpasta desconhecida.');
    const linha = await this.prisma.arquivoDoCliente.findFirst({ where: { id: r.refId, orgId: r.orgId } });
    if (!linha) throw new BadRequestException('o arquivo desta pendência não existe mais.');
    if (linha.estado === 'enviado') return;
    const atualizada = await this.prisma.arquivoDoCliente.update({
      where: { id: linha.id },
      data: { subpasta: r.escolha, confianca: 1, estado: 'na_fila', motivo: null, approvalId: null },
    });
    await this.proporEnvio(atualizada, r.usuarioId);
  }

  /**
   * Manda à porta o envio de UM arquivo já classificado. Sem pasta do cliente,
   * fica `na_fila`. Pedido ainda vivo na fila de aprovação: devolve o mesmo.
   */
  private async proporEnvio(linha: ArquivoDoCliente, atorId: string | null): Promise<ResultadoDoArquivo> {
    const { orgId } = linha;
    if (!linha.partnerId) return this.marcarNaFila(linha, 'o lead ainda não virou cliente: o arquivo espera a pasta do cliente.');
    const partner = await this.prisma.partner.findFirst({ where: { id: linha.partnerId, orgId }, select: { pastaDriveId: true, interno: true } });
    if (!partner) return this.marcarErro(linha, 'cliente não encontrado nesta empresa.');
    if (partner.interno) return this.marcarSoNoOs(linha);
    if (!partner.pastaDriveId) return this.marcarNaFila(linha, 'a pasta do cliente ainda não existe: o arquivo sai quando ela nascer.');
    if (linha.approvalId) {
      const viva = await this.prisma.approval.findFirst({
        where: { id: linha.approvalId, orgId, status: { in: [ApprovalState.pendente, ApprovalState.confirmada] }, expiraEm: { gt: new Date() } },
        select: { id: true },
      });
      if (viva) return { estado: 'aguardando_aprovacao', approvalId: viva.id, subpasta: linha.subpasta as SubpastaDoCliente, nome: linha.nome ?? '' };
    }
    const ator = atorId && (await this.ehPessoaDaEmpresa(orgId, atorId)) ? atorId : null;
    try {
      const r = await this.porta.executar<{ arquivoId: string; url: string; nome: string; subpasta: SubpastaDoCliente }>({
        orgId,
        actorId: ator ?? ATOR_DO_ARQUIVISTA,
        actorType: ator ? ActorType.user : ActorType.system,
        capabilityId: 'drive.arquivo.enviar',
        args: {
          clienteId: linha.partnerId,
          subpasta: linha.subpasta,
          nome: linha.nome,
          chave: linha.chave,
          sha256: linha.sha256,
          bytes: linha.bytes,
          tipoMime: linha.tipoMime.slice(0, 120),
          origem: linha.origem,
        },
        resource: { type: 'arquivo-do-cliente', id: linha.id },
      });
      if (ehRetida(r)) {
        await this.prisma.arquivoDoCliente.updateMany({
          where: { id: linha.id, orgId, estado: { not: 'enviado' } },
          data: { estado: 'aguardando_aprovacao', approvalId: r.approvalId, motivo: null },
        });
        return { estado: 'aguardando_aprovacao', approvalId: r.approvalId, subpasta: linha.subpasta as SubpastaDoCliente, nome: linha.nome ?? '' };
      }
      return { estado: 'enviado', subpasta: r.subpasta, nome: r.nome, arquivoId: r.arquivoId, url: r.url };
    } catch (e) {
      return this.marcarErro(linha, motivoDe(e));
    }
  }

  private async ehPessoaDaEmpresa(orgId: string, id: string): Promise<boolean> {
    if (!id || id.length > 64) return false;
    return !!(await this.prisma.user.findFirst({ where: { id, orgId, isActive: true }, select: { id: true } }));
  }

  private async marcarNaFila(linha: ArquivoDoCliente, motivo: string): Promise<ResultadoDoArquivo> {
    await this.prisma.arquivoDoCliente.updateMany({ where: { id: linha.id, orgId: linha.orgId }, data: { estado: 'na_fila', motivo } });
    return { estado: 'na_fila', motivo };
  }
  private async marcarSoNoOs(linha: ArquivoDoCliente): Promise<ResultadoDoArquivo> {
    const motivo = 'cliente interno da casa: o arquivo fica só no OS.';
    await this.prisma.arquivoDoCliente.updateMany({ where: { id: linha.id, orgId: linha.orgId }, data: { estado: 'so_no_os', motivo } });
    return { estado: 'so_no_os', motivo };
  }
  private async marcarErro(linha: ArquivoDoCliente, motivo: string): Promise<ResultadoDoArquivo> {
    await this.prisma.arquivoDoCliente.updateMany({ where: { id: linha.id, orgId: linha.orgId, estado: { not: 'enviado' } }, data: { estado: 'erro', motivo } });
    return { estado: 'erro', motivo };
  }

  /** O resultado de um registro que já existia (a idempotência). */
  resultadoDe(l: ArquivoDoCliente): ResultadoDoArquivo {
    const subpasta = (l.subpasta ?? '_fonte') as SubpastaDoCliente;
    switch (l.estado) {
      case 'enviado':
        return { estado: 'enviado', subpasta, nome: l.nome ?? '', arquivoId: l.driveArquivoId ?? '', url: l.driveUrl ?? '' };
      case 'aguardando_aprovacao':
        return { estado: 'aguardando_aprovacao', approvalId: l.approvalId ?? '', subpasta, nome: l.nome ?? '' };
      case 'classificar_a_mao':
        return { estado: 'classificar_a_mao', pendenciaId: l.pendenciaId ?? '' };
      case 'so_no_os':
        return { estado: 'so_no_os', motivo: l.motivo ?? 'o arquivo fica só no OS.' };
      case 'na_fila':
        return { estado: 'na_fila', motivo: l.motivo ?? 'espera a pasta do cliente.' };
      default:
        return { estado: 'erro', motivo: l.motivo ?? 'falha desconhecida' };
    }
  }

  /**
   * A pasta do cliente nasceu: cada arquivo que esperava por ela (do cliente,
   * ou do lead que virou este cliente) vai à porta. Idempotente: o que já foi
   * proposto não é proposto de novo.
   */
  async esvaziarFila(orgId: string, partnerId: string): Promise<{ propostos: number }> {
    const fichas = await this.prisma.comercialFicha.findMany({ where: { orgId, partnerId }, select: { leadId: true } });
    const leads = fichas.map((f) => f.leadId);
    const onde: Prisma.ArquivoDoClienteWhereInput = {
      orgId,
      estado: 'na_fila',
      OR: [{ partnerId }, ...(leads.length ? [{ partnerId: null, leadId: { in: leads } }] : [])],
    };
    const linhas = await this.prisma.arquivoDoCliente.findMany({ where: onde, orderBy: { criadoEm: 'asc' }, take: 200 });
    let propostos = 0;
    for (const l of linhas) {
      const ligada = l.partnerId ? l : await this.prisma.arquivoDoCliente.update({ where: { id: l.id }, data: { partnerId } });
      const r = await this.proporEnvio(ligada, ligada.atorId);
      if (r.estado === 'aguardando_aprovacao' || r.estado === 'enviado') propostos++;
    }
    return { propostos };
  }

  // -------------------------------------------------------------------------
  // O efeito de `drive.arquivo.enviar`: roda pela porta, depois da confirmação
  // -------------------------------------------------------------------------

  async efeitoEnviar(args: Record<string, unknown>, orgId: string, ctx: ContextoDoEfeito) {
    const clienteId = String(args.clienteId ?? '');
    const subpasta = String(args.subpasta ?? '') as SubpastaDoCliente;
    const nome = String(args.nome ?? '');
    const chave = String(args.chave ?? '');
    const sha256 = String(args.sha256 ?? '');
    if (!(SUBPASTAS_DO_CLIENTE as readonly string[]).includes(subpasta)) throw new BadRequestException('subpasta desconhecida.');

    // O registro do arquivo NESTA empresa e DESTE cliente, com a mesma chave e o mesmo hash.
    const linha = await this.prisma.arquivoDoCliente.findFirst({
      where: {
        orgId,
        partnerId: clienteId,
        chave,
        sha256,
        ...(ctx.approvalId ? { approvalId: ctx.approvalId } : { estado: { in: ['aguardando_aprovacao', 'erro', 'na_fila'] } }),
      },
      orderBy: { criadoEm: 'desc' },
    });
    if (!linha) throw new BadRequestException('este arquivo não é deste cliente nesta empresa: nada foi enviado.');
    if (linha.estado === 'enviado' && linha.driveArquivoId) {
      return { arquivoId: linha.driveArquivoId, url: linha.driveUrl ?? '', nome: linha.nome ?? nome, subpasta, jaEstava: true };
    }
    try {
      if (linha.subpasta !== subpasta || linha.nome !== nome) {
        throw new BadRequestException('o arquivo mudou de subpasta ou de nome depois do pedido: nada foi enviado.');
      }
      const partner = await this.prisma.partner.findFirst({
        where: { id: clienteId, orgId, isCliente: true },
        select: { pastaDriveId: true, interno: true },
      });
      if (!partner || partner.interno) throw new BadRequestException('cliente não encontrado nesta empresa.');
      if (!partner.pastaDriveId) throw new BadRequestException('a pasta do cliente ainda não existe: nada foi enviado.');

      const raizConfigurada = await idDaRaizDosClientes(this.memoria, orgId);
      if (!raizConfigurada) throw new BadRequestException(FRASE_SEM_RAIZ);
      const raiz = await this.drive.pastaReal(orgId, raizConfigurada);
      if (!raiz) throw new BadRequestException('a pasta raiz dos clientes não é uma pasta que a conta Google da empresa enxerga.');
      if (!(await this.drive.dentroDaRaiz(orgId, partner.pastaDriveId, raiz.id))) {
        throw new BadRequestException('a pasta deste cliente está fora da raiz dos clientes: nada foi enviado.');
      }

      // A subpasta: a que existe dentro da pasta do cliente, ou criada ali (a estrutura do modelo).
      const filhos = await this.drive.filhosDaPasta(orgId, partner.pastaDriveId, { soPastas: true });
      let destino = filhos.find((f) => f.nome === subpasta && f.mimeType === MIME_DA_PASTA);
      if (!destino) destino = await this.drive.criarPasta(orgId, partner.pastaDriveId, subpasta);
      // O pai da escrita, conferido ANTES de escrever.
      if (!(await this.drive.dentroDaRaiz(orgId, destino.id, raiz.id))) {
        throw new BadRequestException('a subpasta de destino está fora da raiz dos clientes: nada foi enviado.');
      }

      const binario = await this.lerBinario(chave);
      const conferido = createHash('sha256').update(binario).digest('hex');
      if (conferido !== sha256) throw new BadRequestException('o conteúdo do arquivo não é o que a aprovação assinou: nada foi enviado.');

      const item = await this.drive.enviarArquivo(orgId, {
        paiId: destino.id,
        nome,
        tipoMime: String(args.tipoMime ?? linha.tipoMime ?? 'application/octet-stream'),
        conteudo: binario,
      });
      await this.prisma.arquivoDoCliente.update({
        where: { id: linha.id },
        data: { estado: 'enviado', driveArquivoId: item.id, driveUrl: item.url, nome: item.nome, motivo: null },
      });
      await this.audit.log({
        orgId,
        actorType: ctx.actorType ?? undefined,
        actorId: ctx.actorId ?? undefined,
        action: 'clientes.arquivo.enviado',
        entityType: 'arquivo-do-cliente',
        entityId: linha.id,
        after: { partnerId: clienteId, subpasta, bytes: linha.bytes, sha256, origem: linha.origem },
        metadata: ctx.approvalId ? { approvalId: ctx.approvalId } : undefined,
      });
      return { arquivoId: item.id, url: item.url ?? '', nome: item.nome, subpasta };
    } catch (e) {
      await this.prisma.arquivoDoCliente.updateMany({
        where: { id: linha.id, orgId, estado: { not: 'enviado' } },
        data: { estado: 'erro', motivo: motivoDe(e) },
      });
      throw e;
    }
  }

  private async lerBinario(chave: string): Promise<Buffer> {
    const deposito = this.deposito;
    if (!deposito) throw new BadRequestException('o storage do OS está indisponível.');
    const { stream } = await deposito.get(chave);
    const partes: Buffer[] = [];
    let total = 0;
    for await (const p of stream as AsyncIterable<Buffer | string>) {
      const b = typeof p === 'string' ? Buffer.from(p) : p;
      total += b.length;
      if (total > TETO_DO_BINARIO) throw new BadRequestException('o arquivo passa de 100 MB.');
      partes.push(b);
    }
    return Buffer.concat(partes);
  }
}
