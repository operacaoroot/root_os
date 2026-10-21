import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
  NOTA_DO_MODELO_DE_CONTRATO,
  PASTA_DOS_MODELOS_DE_CONTRATO,
  RECUSA_SEM_MODELO_DE_CONTRATO,
  SUBPASTA_DO_CONTRATO,
  type ApontamentoDoLaudo,
  type LaudoDoContrato,
  type MinutaDoContratoNaTela,
} from '@mktos/shared';
import { Prisma } from '@prisma/client';

import { ARQUIVISTA_DO_CLIENTE, type ArquivistaDoClientePort } from '../../clientes/portas';
import { PortaDoOperador } from '../../gateway/porta-do-operador.service';
import { ehLeituraDoArquivo, textoDaLeitura } from '../../google/drive-das-atas';
import { LLM_PROVIDER, type LlmProvider } from '../../llm/llm.provider';
import { MemoriaService } from '../../memory/memoria.service';
import { PrismaService } from '../../prisma/prisma.service';
import { copiaDoResultado } from '../assinado-na-pasta.service';
import type { AceiteDoLead } from '../dinheiro.service';
import { PROVEDOR_DA_MINUTA } from '../documentos';
import { hashDoConteudo, uuidDe } from '../eventos';
import { FechamentoService } from '../fechamento.service';
import { FioService } from '../fio.service';
import { parcelasDoValor } from '../proposta-construtor';
import {
  MinutaIlegivelError,
  TETO_DO_MODELO_DE_CONTRATO,
  conferirMinuta,
  contarMarcas,
  fatosDaMinuta,
  hashDaMinuta,
  preencherModelo,
  promptDaMinuta,
} from './minuta';
import { interpretarRevisao, promptDaRevisao, ranquear, regrasDoRevisor, type FichaParaRevisao } from './revisor';

/*
 * O CONTRATO DA ROOT: O CONSTRUTOR (CO-13) E O REVISOR (CO-14) — rodada dos agentes, 21/10/2026.
 *
 * O CONSTRUTOR parte da proposta ACEITA (o aceite da sala, ou o declarado de
 * quem fechou fora) e da ficha, e redige a minuta sobre o MODELO DE CONTRATO DA
 * ROOT, que mora no Drive da Root (`70-modelos/contratos`). O nome do arquivo é a
 * primeira linha da nota da memória `comercial.contrato.modelo` (a segunda,
 * opcional, é o id da pasta, para conferir que o arquivo é daquela pasta). Sem a
 * nota: recusa com a frase "[a decidir] O modelo de contrato da Root ainda não
 * foi cadastrado". O Drive é lido PELA PORTA (`contexto.arquivo.listar` e
 * `contexto.arquivo.ler`, R0) em nome de quem clicou.
 *
 * A minuta é RASCUNHO no OS: `ComercialDocumento` de provedor `minuta`, estado
 * `rascunho`, com o texto em `conteudo` (as marcas ⟦inserido⟧ e ⟦lacuna⟧ à vista)
 * e o fato `minuta.gerada` no fio. Uma cópia vai a `02-contrato` da pasta do
 * cliente pelo arquivista (origem `minuta`); sem pasta ou com o arquivista ainda
 * não ligado, o fato `documento.na_pasta` diz o estado e nada cai.
 *
 * O REVISOR roda logo depois (e pela rota "Revisar"): regras primeiro, modelo
 * depois, laudo ranqueado por gravidade em `ComercialDocumento.laudo` e o fato
 * `minuta.revisada` com as contagens. Ele não reescreve a minuta.
 *
 * As duas chamadas de modelo passam só a `funcao` (CO-13, CO-14): o modelo e o
 * esforço são do cadastro.
 */

const PASTA_DO_DRIVE = 'application/vnd.google-apps.folder';
const ID_DO_DRIVE = /^[A-Za-z0-9_-]{10,120}$/;

type P = Record<string, unknown>;

function ehRetida(r: unknown): boolean {
  return !!r && typeof r === 'object' && (r as P).status === 'aguardando_aprovacao';
}

function nomeComparavel(v: string): string {
  return String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** O mesmo arquivo pelo nome: igual, ou igual sem a extensão (o Documento Google não tem extensão). */
export function mesmoNomeDeArquivo(noDrive: string, daNota: string): boolean {
  const a = nomeComparavel(noDrive);
  const b = nomeComparavel(daNota);
  const sem = (x: string) => x.replace(/\.[a-z0-9]{1,5}$/, '');
  return a === b || sem(a) === sem(b);
}

/** A nota do modelo: primeira linha = nome do arquivo; segunda (opcional) = id da pasta no Drive. */
export function lerNotaDoModelo(corpo: string | null | undefined): { nome: string; pastaId: string | null } | null {
  const linhas = String(corpo ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!linhas[0]) return null;
  const pasta = linhas[1] && ID_DO_DRIVE.test(linhas[1]) ? linhas[1] : null;
  return { nome: linhas[0].slice(0, 200), pastaId: pasta };
}

export interface ModeloLido {
  nome: string;
  id: string;
  texto: string;
  pastaConferida: boolean;
}

@Injectable()
export class ContratoDaRootService {
  private readonly log = new Logger('ComercialContratoDaRoot');

  constructor(
    private readonly prisma: PrismaService,
    private readonly fio: FioService,
    private readonly memoria: MemoriaService,
    private readonly porta: PortaDoOperador,
    private readonly fechamento: FechamentoService,
    @Optional() @Inject(LLM_PROVIDER) private readonly llm?: LlmProvider,
    @Optional() @Inject(ARQUIVISTA_DO_CLIENTE) private readonly arquivista?: ArquivistaDoClientePort,
  ) {}

  // -------------------------------------------------------------------------
  // O modelo, do Drive da Root, pela porta
  // -------------------------------------------------------------------------

  /** Lê o modelo do Drive. Sem a nota: a recusa do roteiro. Fora da pasta ou ambíguo: o motivo. */
  async lerModelo(orgId: string, actorId: string): Promise<ModeloLido> {
    // Nota de configuração lida pelo sistema (não é a memória que a pessoa abre): sem conferir `obsidian.ver`.
    const nota = await this.memoria.porChave(orgId, NOTA_DO_MODELO_DE_CONTRATO, null);
    const cfg = lerNotaDoModelo(nota?.body);
    if (!cfg) throw new BadRequestException(RECUSA_SEM_MODELO_DE_CONTRATO);

    const lista = await this.porta.executar({
      orgId,
      actorId,
      capabilityId: 'contexto.arquivo.listar',
      args: cfg.pastaId ? { pasta: cfg.pastaId, q: cfg.nome, limite: 10 } : { q: cfg.nome, limite: 10 },
      resource: cfg.pastaId ? { type: 'drive.pasta', id: cfg.pastaId } : { type: 'drive', id: 'modelo-de-contrato' },
    });
    if (ehRetida(lista)) throw new ForbiddenException('A leitura do Drive ficou retida pela política. Veja em Aprovações.');
    if (!Array.isArray(lista)) throw new BadRequestException('O Drive não devolveu a lista de arquivos.');
    const candidatos = (lista as P[]).filter(
      (f) => typeof f.id === 'string' && typeof f.name === 'string' && f.mimeType !== PASTA_DO_DRIVE && mesmoNomeDeArquivo(String(f.name), cfg.nome),
    );
    if (!candidatos.length) {
      throw new NotFoundException(`O modelo de contrato "${cfg.nome}" não foi achado no Drive da Root${cfg.pastaId ? ` (pasta ${PASTA_DOS_MODELOS_DE_CONTRATO})` : ''}. Confira o nome na nota ${NOTA_DO_MODELO_DE_CONTRATO}.`);
    }
    if (!cfg.pastaId && candidatos.length > 1) {
      throw new ConflictException(`Há mais de um arquivo "${cfg.nome}" no Drive da Root: ponha o id da pasta ${PASTA_DOS_MODELOS_DE_CONTRATO} na segunda linha da nota ${NOTA_DO_MODELO_DE_CONTRATO}.`);
    }
    const id = String(candidatos[0].id);
    const lido = await this.porta.executar({ orgId, actorId, capabilityId: 'contexto.arquivo.ler', args: { id }, resource: { type: 'drive', id } });
    if (ehRetida(lido)) throw new ForbiddenException('A leitura do modelo ficou retida pela política. Veja em Aprovações.');
    if (!ehLeituraDoArquivo(lido)) throw new BadRequestException('O Drive não devolveu o texto do modelo de contrato.');
    if (cfg.pastaId && !lido.pastas.includes(cfg.pastaId)) throw new NotFoundException(`O modelo "${cfg.nome}" não está na pasta ${PASTA_DOS_MODELOS_DE_CONTRATO} configurada.`);
    const texto = textoDaLeitura(lido.texto).replace(/\r\n/g, '\n').trim();
    if (!texto) throw new BadRequestException('O modelo de contrato do Drive está vazio.');
    if (texto.length > TETO_DO_MODELO_DE_CONTRATO) throw new BadRequestException(`O modelo de contrato passa de ${TETO_DO_MODELO_DE_CONTRATO} caracteres: corte o arquivo antes de usar.`);
    return { nome: lido.nome, id: lido.id, texto, pastaConferida: Boolean(cfg.pastaId) };
  }

  // -------------------------------------------------------------------------
  // CO-13 · a minuta
  // -------------------------------------------------------------------------

  private async aceite(orgId: string, leadId: string): Promise<AceiteDoLead> {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { id: true } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');
    const a = await this.fechamento.aceiteParaFechar(orgId, leadId);
    if (!a) throw new ConflictException('O lead ainda não tem proposta aceita com os dados do contratante: a minuta parte do aceite.');
    return a;
  }

  /** Redige a minuta, grava como rascunho, manda a cópia para `02-contrato` e revisa. */
  async gerar(orgId: string, leadId: string, quem: { id: string; nome: string | null }): Promise<MinutaDoContratoNaTela> {
    const a = await this.aceite(orgId, leadId);
    const modelo = await this.lerModelo(orgId, quem.id);
    const fatos = fatosDaMinuta({
      razaoSocial: a.dados.razaoSocial,
      cnpj: a.dados.cnpj,
      endereco: a.dados.endereco,
      quemAssina: a.dados.quemAssina,
      email: a.dados.email,
      produto: a.produto,
      valorCentavos: a.valorCentavos,
      parcelas: a.parcelas,
      forma: a.forma,
      propostaVersao: a.versao,
      propostaHash: a.hash,
      aceitoEm: a.em,
    });
    const preenchido = preencherModelo(modelo.texto, fatos);

    let conteudo = preenchido;
    let origem: 'modelo' | 'sistema' = 'sistema';
    const avisos: string[] = [];
    if (this.llm) {
      try {
        const { system, user } = promptDaMinuta(preenchido, fatos);
        const saida = await this.llm.complete({ funcao: 'CO-13', system, user, orgId, maxTokens: 16_000 });
        const c = conferirMinuta(saida, fatos, preenchido);
        conteudo = c.conteudo;
        avisos.push(...c.avisos);
        origem = 'modelo';
      } catch (e) {
        const msg = e instanceof MinutaIlegivelError ? e.message : `o modelo não respondeu (${(e as Error).message.slice(0, 160)})`;
        avisos.push(`${msg}: a minuta é a que o sistema preencheu sozinho`);
      }
    } else {
      avisos.push('sem modelo nesta instância: a minuta é a que o sistema preencheu sozinho');
    }

    const hash = hashDaMinuta(conteudo);
    const documentoId = uuidDe([orgId, 'comercial-minuta', leadId, hash]);
    await this.prisma.comercialDocumento.createMany({
      data: [{ id: documentoId, leadId, provedor: PROVEDOR_DA_MINUTA, externoId: `minuta:${leadId}:${hash.slice(0, 24)}`, estado: 'rascunho', hashConteudo: hash, conteudo }],
      skipDuplicates: true,
    });
    const marcas = contarMarcas(conteudo);
    await this.fio.registrar(orgId, leadId, 'minuta.gerada', hash, {
      documentoId,
      versao: a.versao,
      hash,
      inseridos: marcas.inseridos,
      lacunas: marcas.lacunas.length,
      origem,
      modelo: modelo.nome.slice(0, 200),
      por: quem.nome,
    });
    await this.copiarParaPasta(orgId, leadId, documentoId, conteudo, a, quem.id);
    const laudo = await this.revisarDocumento(orgId, leadId, documentoId, conteudo, a);
    return {
      documentoId,
      versaoDaProposta: a.versao,
      hash,
      conteudo,
      inseridos: marcas.inseridos,
      lacunas: marcas.lacunas,
      origem,
      avisos,
      modeloDoDrive: { nome: modelo.nome, id: modelo.id, pastaConferida: modelo.pastaConferida },
      geradaEm: new Date().toISOString(),
      laudo,
    };
  }

  /** A cópia da minuta em `02-contrato` (arquivista, origem `minuta`). Nunca lança: o estado vai ao fio. */
  private async copiarParaPasta(orgId: string, leadId: string, documentoId: string, conteudo: string, a: AceiteDoLead, atorId: string): Promise<void> {
    let estado: ReturnType<typeof copiaDoResultado>;
    if (!this.arquivista) {
      estado = { estado: 'so_no_os', motivo: 'o arquivista do cliente não está disponível nesta instância', subpasta: null, nome: null, approvalId: null, url: null, sha256: null };
    } else {
      const buffer = Buffer.from(conteudo, 'utf8');
      const sha = hashDoConteudo(conteudo);
      try {
        const ficha = await this.prisma.comercialFicha.findFirst({ where: { leadId, orgId }, select: { partnerId: true } });
        const r = await this.arquivista.arquivar({
          orgId,
          partnerId: ficha?.partnerId ?? null,
          leadId,
          origem: 'minuta',
          nomeOriginal: `minuta-contrato-v${a.versao}.md`,
          tipoMime: 'text/markdown',
          conteudo: { buffer },
          subpasta: SUBPASTA_DO_CONTRATO,
          tipo: 'Minuta do contrato',
          titulo: `${a.dados.razaoSocial} v${a.versao}`,
          atorId,
        });
        estado = copiaDoResultado(r, sha);
      } catch (e) {
        estado = { estado: 'erro', motivo: (e as Error).message.slice(0, 400), subpasta: null, nome: null, approvalId: null, url: null, sha256: sha };
      }
    }
    await this.fio
      .registrar(orgId, leadId, 'documento.na_pasta', `minuta:${documentoId}:${estado.estado}`, {
        origem: 'minuta',
        ref: documentoId,
        estado: estado.estado,
        subpasta: estado.subpasta,
        nome: estado.nome,
        motivo: estado.motivo,
        approvalId: estado.approvalId,
        url: estado.url,
        sha256: estado.sha256,
      })
      .catch((e: Error) => this.log.warn(`minuta do lead ${leadId}: o fato da cópia não foi gravado (${e.message})`));
  }

  /** A minuta mais recente do lead, com o laudo (ou `null`). */
  async doLead(orgId: string, leadId: string): Promise<MinutaDoContratoNaTela | null> {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { id: true } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');
    const doc = await this.prisma.comercialDocumento.findFirst({ where: { leadId, orgId, provedor: PROVEDOR_DA_MINUTA }, orderBy: { criadoEm: 'desc' } });
    if (!doc || !doc.conteudo) return null;
    const fato = await this.prisma.leadEvent.findFirst({ where: { leadId, orgId, type: 'minuta.gerada' }, orderBy: { occurredAt: 'desc' }, select: { payload: true, occurredAt: true } });
    const p = (fato?.payload ?? {}) as P;
    const marcas = contarMarcas(doc.conteudo);
    return {
      documentoId: doc.id,
      versaoDaProposta: Number(p.versao ?? 0),
      hash: doc.hashConteudo,
      conteudo: doc.conteudo,
      inseridos: marcas.inseridos,
      lacunas: marcas.lacunas,
      origem: p.origem === 'modelo' ? 'modelo' : 'sistema',
      avisos: [],
      modeloDoDrive: { nome: String(p.modelo ?? ''), id: '', pastaConferida: false },
      geradaEm: (fato?.occurredAt ?? doc.criadoEm).toISOString(),
      laudo: (doc.laudo as LaudoDoContrato | null) ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // CO-14 · o laudo
  // -------------------------------------------------------------------------

  /** Revisa a minuta mais recente do lead (a rota "Revisar"). */
  async revisar(orgId: string, leadId: string): Promise<LaudoDoContrato> {
    const a = await this.aceite(orgId, leadId);
    const doc = await this.prisma.comercialDocumento.findFirst({ where: { leadId, orgId, provedor: PROVEDOR_DA_MINUTA }, orderBy: { criadoEm: 'desc' }, select: { id: true, conteudo: true } });
    if (!doc?.conteudo) throw new NotFoundException('Este lead ainda não tem minuta do contrato: gere a minuta primeiro.');
    return this.revisarDocumento(orgId, leadId, doc.id, doc.conteudo, a);
  }

  private async revisarDocumento(orgId: string, leadId: string, documentoId: string, conteudo: string, a: AceiteDoLead): Promise<LaudoDoContrato> {
    const { parcelaCentavos, ultimaParcelaCentavos } = a.parcelas > 0 ? parcelasDoValor(a.valorCentavos, a.parcelas) : { parcelaCentavos: a.valorCentavos, ultimaParcelaCentavos: a.valorCentavos };
    const ficha: FichaParaRevisao = { razaoSocial: a.dados.razaoSocial, cnpj: a.dados.cnpj, valorCentavos: a.valorCentavos, parcelas: a.parcelas, parcelaCentavos, ultimaParcelaCentavos };
    const regras = regrasDoRevisor(conteudo, ficha);
    const avisos: string[] = [];
    let doModelo: ApontamentoDoLaudo[] = [];
    let porModelo = false;
    if (this.llm) {
      try {
        const { system, user } = promptDaRevisao(conteudo, regras);
        const saida = await this.llm.complete({ funcao: 'CO-14', system, user, orgId, maxTokens: 3_000 });
        const r = interpretarRevisao(saida, conteudo, regras);
        doModelo = r.apontamentos;
        avisos.push(...r.avisos);
        porModelo = true;
      } catch (e) {
        avisos.push(`a revisão do modelo não veio (${(e as Error).message.slice(0, 160)}): o laudo fica com as regras`);
      }
    }
    const hash = hashDaMinuta(conteudo);
    const laudo: LaudoDoContrato = { apontamentos: ranquear([...regras, ...doModelo]), geradoEm: new Date().toISOString(), porModelo, avisos, hashDaMinuta: hash };
    await this.prisma.comercialDocumento.updateMany({ where: { id: documentoId, leadId, provedor: PROVEDOR_DA_MINUTA }, data: { laudo: laudo as unknown as Prisma.InputJsonValue } });
    const conta = (g: string) => laudo.apontamentos.filter((x) => x.gravidade === g).length;
    await this.fio.registrar(orgId, leadId, 'minuta.revisada', `${hash}:${hashDoConteudo(laudo.apontamentos)}`, {
      documentoId,
      hash,
      criticas: conta('critica'),
      altas: conta('alta'),
      medias: conta('media'),
      baixas: conta('baixa'),
      porModelo,
    });
    return laudo;
  }
}
