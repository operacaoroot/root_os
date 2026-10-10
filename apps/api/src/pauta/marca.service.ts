import { PautaMarcaHumanoPainelSchema, type PautaMarcaHumanoPainel, type PautaMarcaSalvarHumanoInput, type PautaPilaresSalvarHumanoInput, type PautaEscritaHumanaResultado } from '@mktos/shared';
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ContextKind, ContextSource } from '@prisma/client';
import {
  PAUTA_CHAVE_DA_MARCA,
  lerPilaresDoTexto,
  PAUTA_CHAVE_DOS_PILARES,
  PAUTA_SECOES_DA_MARCA,
  type PautaMarcaPainel,
  type PautaMarcaAplicarInput,
  type PautaMarcaDestino,
  type PautaMarcaPrevia,
  type PautaMarcaVinculo,
  type PautaMarcaSalvarInput,
  type PautaPilar,
  type PautaPilaresSalvarInput,
} from '@mktos/shared';
import { AuditService } from '../audit/audit.service';
import { MemoriaService, type NotaDeContexto } from '../memory/memoria.service';
import { blocoDeMarca, marcaDaNota, pilaresDaNota, perfilParaPrompt, procedenciaDaMarca } from './marca-da-pauta';
import { lerReferenciaDaProjecao, proporMarcaDaFonte, referenciaDaProjecao } from './marca-projecao';
import { BrandbookService } from './brandbook.service';
import { textoDosPilares } from './brandbook-documento';

const TITULO_DA_MARCA = 'Marca (pauta)';
const TITULO_DOS_PILARES = 'Pilares de conteúdo (pauta)';
const CHAVE_DA_FONTE = 'editorial:marca:Root/40-marca-e-conteudo/root-fundamentos-da-marca-e-guia-de-expressao.md';

/*
 * O brandbook aprovado tem precedência. Sem ativo, preserva as duas notas
 * legadas; falha, acesso restrito ou arquivo inválido do livro interrompem a
 * leitura. O bloco mantém a neutralização e os consumidores existentes da Pauta.
 */
@Injectable()
export class MarcaService {
  private readonly log = new Logger('MarcaService');

  constructor(
    private readonly audit: AuditService,
    private readonly memoria: MemoriaService,
    private readonly brandbooks: BrandbookService,
  ) {}

  /**
   * A nota, ou nulo. Memória fora do ar NÃO TRAVA a geração: cai em nulo com o
   * aviso no log, e o prompt segue sem o bloco — a mesma escolha da voz, pelo
   * mesmo motivo (um roteiro que não sai é pior que um roteiro sem a marca).
   */
  private async nota(orgId: string, chave: string): Promise<NotaDeContexto | null> {
    try {
      return await this.memoria.porChave(orgId, chave);
    } catch (e) {
      this.log.warn(`marca de ${orgId}: memória indisponível ao ler ${chave} (${(e as Error).message})`);
      return null;
    }
  }

  /** O perfil da marca vigente, ou nulo. */
  async perfil(orgId: string): Promise<string | null> {
    const ativo = await this.brandbooks.ativoParaPauta(orgId);
    if (ativo) return ativo.documento.perfilParaPauta;
    return marcaDaNota(await this.nota(orgId, PAUTA_CHAVE_DA_MARCA)).perfil;
  }

  /** Os pilares vigentes. Lista vazia quando não há nota ou nenhuma linha vale. */
  async pilares(orgId: string): Promise<PautaPilar[]> {
    const ativo = await this.brandbooks.ativoParaPauta(orgId);
    if (ativo) return lerPilaresDoTexto(textoDosPilares(ativo.documento)).pilares;
    return pilaresDaNota(await this.nota(orgId, PAUTA_CHAVE_DOS_PILARES)).pilares;
  }

  /**
   * O bloco de marca que os prompts da pauta recebem. Vazio quando não há marca
   * nem pilar: nesse caso o prompt fica exatamente como era antes da MK1.
   */
  async bloco(orgId: string): Promise<string> {
    const ativo = await this.brandbooks.ativoParaPauta(orgId);
    if (ativo) {
      const procedencia = `brandbook aprovado · sha256:${ativo.draftHash.slice(0, 12)}`;
      return blocoDeMarca(ativo.documento.perfilParaPauta, lerPilaresDoTexto(textoDosPilares(ativo.documento)).pilares, { procedencia, procedenciaPilares: procedencia });
    }
    const [notaMarca, notaPilares] = await Promise.all([
      this.nota(orgId, PAUTA_CHAVE_DA_MARCA),
      this.nota(orgId, PAUTA_CHAVE_DOS_PILARES),
    ]);
    const { perfil } = marcaDaNota(notaMarca);
    const { pilares } = pilaresDaNota(notaPilares);
    const [vinculoMarca, vinculoPilares] = await Promise.all([
      this.vinculoDaNota(orgId, notaMarca), this.vinculoDaNota(orgId, notaPilares),
    ]);
    return blocoDeMarca(perfil, pilares, {
      procedencia: notaMarca && perfil ? procedenciaDaMarca({
        ...notaMarca, sourceRef: vinculoMarca?.atual ? notaMarca.sourceRef : null,
      }) : undefined,
      procedenciaPilares: notaPilares && pilares.length && vinculoPilares?.atual
        ? procedenciaDaMarca(notaPilares) : undefined,
    });
  }


  async painelHumano(orgId: string, actorId: string): Promise<PautaMarcaHumanoPainel> {
    const r = await this.memoria.lerDestinosHumanos(orgId, actorId, { tipo: 'marca' });
    const notaMarca = r.notas.perfil; const notaPilares = r.notas.pilares;
    let painel: PautaMarcaPainel;
    if (r.livro?.ativo) {
      const d = r.livro.ativo.documento; const texto = textoDosPilares(d);
      const pilares = lerPilaresDoTexto(texto).pilares;
      const procedencia = `brandbook aprovado · sha256:${r.livro.ativo.draftHash.slice(0, 12)}`;
      painel = { perfil: d.perfilParaPauta, perfilVersao: r.livro.versao, perfilAtualizadoEm: r.livro.ativo.aprovadoEm,
        pilaresTexto: texto, pilaresVersao: r.livro.versao, pilares, avisos: [],
        bloco: blocoDeMarca(d.perfilParaPauta, pilares, { procedencia, procedenciaPilares: procedencia }), projecoes: { perfil: null, pilares: null } };
    } else {
      const m = marcaDaNota(notaMarca); const p = pilaresDaNota(notaPilares);
      const [perfil, pilares] = await Promise.all([this.vinculoDaNota(orgId, notaMarca), this.vinculoDaNota(orgId, notaPilares)]);
      painel = { perfil: m.perfil, perfilVersao: m.versao, perfilAtualizadoEm: notaMarca?.atualizadoEm ?? null,
        pilaresTexto: p.texto, pilaresVersao: p.versao, pilares: p.pilares, avisos: [...m.avisos, ...p.avisos],
        bloco: blocoDeMarca(m.perfil, p.pilares, { procedencia: notaMarca && m.perfil
          ? procedenciaDaMarca({ ...notaMarca, sourceRef: perfil?.atual ? notaMarca.sourceRef : null }) : undefined,
          procedenciaPilares: notaPilares && p.pilares.length && pilares?.atual ? procedenciaDaMarca(notaPilares) : undefined }),
        projecoes: { perfil, pilares } };
    }
    const final = await this.memoria.reconferirDestinosHumanos(orgId, actorId, { tipo: 'marca' }, r);
    return PautaMarcaHumanoPainelSchema.parse({ contrato: 1, escopo: final.escopo, autoridade: final.autoridade,
      observadoEm: final.observadoEm, painel, destinos: r.destinos, origemEfetiva: r.livro?.ativo
        ? { tipo: 'brandbook', brandbook: { id: r.livro.id, versao: r.livro.versao, draftHash: r.livro.ativo.draftHash } }
        : { tipo: 'legado', brandbook: null } });
  }

  async salvarPerfilHumano(orgId: string, actorId: string, entrada: PautaMarcaSalvarHumanoInput): Promise<PautaEscritaHumanaResultado> {
    const corpo = entrada.perfil.replace(/\r\n?/g, '\n').trim();
    const r = await this.memoria.gravarPautaHumana(orgId, actorId, { acao: 'salvar_perfil_marca' }, entrada,
      { kind: ContextKind.definicao, title: TITULO_DA_MARCA, body: corpo, tags: ['pauta', 'marca'], sourceType: ContextSource.operador,
        sourceRef: 'pauta.marca · edição manual', motivo: 'perfil da marca editado à mão (MK1)' });
    await this.audit.log({ orgId, actorId, action: 'pauta.marca_salva', entityType: 'context_item', entityId: r.edicao.itemId,
      after: { versao: r.edicao.versao, caracteres: corpo.length } });
    return this.memoria.reconferirResultadoHumanoDoProdutor(orgId, actorId, r);
  }
  async salvarPilaresHumano(orgId: string, actorId: string, entrada: PautaPilaresSalvarHumanoInput): Promise<PautaEscritaHumanaResultado> {
    const corpo = entrada.pilares.replace(/\r\n?/g, '\n').trim();
    const r = await this.memoria.gravarPautaHumana(orgId, actorId, { acao: 'salvar_pilares' }, entrada,
      { kind: ContextKind.definicao, title: TITULO_DOS_PILARES, body: corpo, tags: ['pauta', 'marca', 'pilares'], sourceType: ContextSource.operador,
        sourceRef: 'pauta.marca.pilares · edição manual', motivo: 'pilares de conteúdo editados à mão (MK1)' });
    const p = lerPilaresDoTexto(corpo);
    await this.audit.log({ orgId, actorId, action: 'pauta.pilares_salvos', entityType: 'context_item', entityId: r.edicao.itemId,
      after: { versao: r.edicao.versao, pilares: p.pilares.map((v) => v.chave), avisos: p.avisos.length } });
    return this.memoria.reconferirResultadoHumanoDoProdutor(orgId, actorId, r);
  }

  async painel(orgId: string): Promise<PautaMarcaPainel> {
    const livro = await this.brandbooks.painelParaPauta(orgId);
    if (livro.ativo) {
      const d = livro.ativo.documento;
      const pilaresTexto = textoDosPilares(d);
      const pilares = lerPilaresDoTexto(pilaresTexto).pilares;
      const procedencia = `brandbook aprovado · sha256:${livro.ativo.draftHash.slice(0, 12)}`;
      return { perfil: d.perfilParaPauta, perfilVersao: livro.versao, perfilAtualizadoEm: livro.ativo.aprovadoEm,
        pilaresTexto, pilaresVersao: livro.versao, pilares, avisos: [],
        bloco: blocoDeMarca(d.perfilParaPauta, pilares, { procedencia, procedenciaPilares: procedencia }),
        projecoes: { perfil: null, pilares: null } };
    }
    const [notaMarca, notaPilares] = await Promise.all([
      this.nota(orgId, PAUTA_CHAVE_DA_MARCA),
      this.nota(orgId, PAUTA_CHAVE_DOS_PILARES),
    ]);
    const m = marcaDaNota(notaMarca);
    const p = pilaresDaNota(notaPilares);
    const [vinculoMarca, vinculoPilares] = await Promise.all([
      this.vinculoDaNota(orgId, notaMarca), this.vinculoDaNota(orgId, notaPilares),
    ]);
    return {
      perfil: m.perfil,
      perfilVersao: m.versao,
      perfilAtualizadoEm: notaMarca ? new Date(notaMarca.atualizadoEm).toISOString() : null,
      pilaresTexto: p.texto,
      pilaresVersao: p.versao,
      pilares: p.pilares,
      avisos: [...m.avisos, ...p.avisos],
      bloco: blocoDeMarca(m.perfil, p.pilares, {
        procedencia: notaMarca && m.perfil ? procedenciaDaMarca({
          ...notaMarca, sourceRef: vinculoMarca?.atual ? notaMarca.sourceRef : null,
        }) : undefined,
        procedenciaPilares: notaPilares && p.pilares.length && vinculoPilares?.atual
          ? procedenciaDaMarca(notaPilares) : undefined,
      }),
      projecoes: { perfil: vinculoMarca, pilares: vinculoPilares },
    };
  }

  /** A última projeção permanece visível após edição manual, mas deixa de ser a versão vigente. */
  private async vinculoDaNota(orgId: string, nota: NotaDeContexto | null): Promise<PautaMarcaVinculo | null> {
    if (!nota) return null;
    try {
      const historico = await this.memoria.historico(orgId, nota.id);
      const projetada = historico.find((v) => v.motivo?.startsWith('projeção revisada do guia') &&
        !!lerReferenciaDaProjecao(v.sourceRef));
      const ref = lerReferenciaDaProjecao(projetada?.sourceRef ?? null);
      if (!projetada || !ref) return null;
      return {
        versaoDestino: projetada.versao, fonteContextItemId: ref.id,
        fonteChave: ref.chave, fonteVersao: ref.versao, fonteHash: ref.hash,
        secoesUsadas: ref.secoes,
        atual: !nota.arquivadoEm && nota.versao === projetada.versao && nota.sourceRef === projetada.sourceRef,
      };
    } catch {
      return null;
    }
  }

  /** Prévia sem escrita: a pessoa confere trechos, destino e texto antes de aplicar. */
  async previa(orgId: string, destino: PautaMarcaDestino): Promise<PautaMarcaPrevia> {
    await this.brandbooks.exigirLegadoPermitido(orgId);
    const chaveDestino = destino === 'perfil' ? PAUTA_CHAVE_DA_MARCA : PAUTA_CHAVE_DOS_PILARES;
    const [fonte, nota] = await Promise.all([
      this.memoria.porChave(orgId, CHAVE_DA_FONTE),
      this.memoria.porChave(orgId, chaveDestino),
    ]);
    const base: PautaMarcaPrevia = {
      destino, fonteContextItemId: fonte?.id ?? null, fonteChave: CHAVE_DA_FONTE,
      fonteVersao: fonte?.versao ?? null, fonteHash: fonte?.contentHash ?? null,
      secoesUsadas: [], textoProposto: '',
      destinoContextItemId: nota?.id ?? null, destinoVersao: nota?.versao ?? null,
      destinoHash: nota?.contentHash ?? null, textoAtual: nota?.body ?? '',
      diferenca: false, estado: 'pronto', aviso: null,
    };
    if (!fonte) return { ...base, estado: 'fonte_ausente', aviso: 'O guia de marca não está na Memória desta empresa.' };
    if (fonte.arquivadoEm) return { ...base, estado: 'fonte_arquivada', aviso: 'O guia foi arquivado; a projeção está indisponível.' };
    const proposta = proporMarcaDaFonte(fonte.body, destino);
    const tamanhoEfetivo = destino === 'perfil' ? perfilParaPrompt(proposta.texto).length : 0;
    const erroDaProposta = proposta.erro ?? (tamanhoEfetivo > 4_000
      ? `Após a neutralização, a proposta tem ${tamanhoEfetivo.toLocaleString('pt-BR')} caracteres no prompt; o limite é 4.000. Revise antes de aplicar.`
      : null);
    const resposta: PautaMarcaPrevia = {
      ...base, secoesUsadas: proposta.secoesUsadas, textoProposto: proposta.texto,
      diferenca: proposta.texto !== (nota?.body ?? ''),
      estado: erroDaProposta ? 'excede_limite' : 'pronto', aviso: erroDaProposta,
    };
    if (nota?.arquivadoEm) return { ...resposta, estado: 'destino_alterado', aviso: 'O destino foi arquivado. Restaure-o explicitamente na Memória.' };
    if (erroDaProposta || !nota) return resposta;
    const vinculo = await this.vinculoDaNota(orgId, nota);
    if (vinculo?.atual && (vinculo.fonteContextItemId !== fonte.id || vinculo.fonteVersao !== fonte.versao || vinculo.fonteHash !== fonte.contentHash)) {
      return { ...resposta, estado: 'fonte_alterada', aviso: 'O guia mudou desde a última projeção. Revise a diferença antes de aplicar.' };
    }
    if (vinculo?.atual && !resposta.diferenca) return { ...resposta, estado: 'ja_aplicado' };
    if (vinculo && !vinculo.atual) {
      return { ...resposta, estado: 'destino_alterado', aviso: 'Houve edição manual depois da projeção. Aplicar criará uma nova versão.' };
    }
    return resposta;
  }

  /** Cada destino é aplicado sozinho. Fonte e destino são conferidos de novo na transação da Memória. */
  async aplicar(orgId: string, destino: PautaMarcaDestino, pedido: PautaMarcaAplicarInput): Promise<PautaMarcaPainel> {
    await this.brandbooks.exigirLegadoPermitido(orgId);
    const fonte = await this.memoria.porChave(orgId, CHAVE_DA_FONTE);
    if (!fonte || fonte.arquivadoEm) throw new ConflictException('O guia não está ativo. Refaça a prévia.');
    const proposta = proporMarcaDaFonte(fonte.body, destino);
    if (!proposta.texto || !proposta.secoesUsadas.length) {
      throw new ConflictException(`${proposta.erro ?? 'A fonte não tem os trechos necessários.'} Refaça a prévia.`);
    }
    if (fonte.id !== pedido.fonteContextItemId || fonte.versao !== pedido.fonteVersao ||
        fonte.contentHash !== pedido.fonteHash || JSON.stringify(proposta.secoesUsadas) !== JSON.stringify(pedido.secoesUsadas)) {
      throw new ConflictException('A fonte ou os trechos mudaram. Refaça a prévia.');
    }
    const corpo = pedido.textoFinal.replace(/\r\n?/g, '\n').trim();
    if (destino === 'perfil') {
      if (corpo.length < 80 || corpo.length > 4_000) {
        throw new ConflictException(`O perfil deve ter de 80 a 4.000 caracteres; recebeu ${corpo.length}.`);
      }
      const tamanhoEfetivo = perfilParaPrompt(corpo).length;
      if (tamanhoEfetivo > 4_000) {
        throw new ConflictException(`Após a neutralização, o perfil teria ${tamanhoEfetivo.toLocaleString('pt-BR')} caracteres no prompt; o limite é 4.000. Revise o texto antes de aplicar.`);
      }
    } else {
      const esperado = pilaresDaNota({ body: proposta.texto }).pilares.map((p) => p.chave);
      const lido = pilaresDaNota({ body: corpo });
      if (corpo.length > 4_000 || lido.avisos.length ||
          JSON.stringify(lido.pilares.map((p) => p.chave)) !== JSON.stringify(esperado)) {
        throw new ConflictException('Os pilares devem preservar os cinco territórios válidos da fonte. Revise o texto.');
      }
    }
    const chaveDestino = destino === 'perfil' ? PAUTA_CHAVE_DA_MARCA : PAUTA_CHAVE_DOS_PILARES;
    await this.memoria.projetarCondicionado(orgId, {
      fonte: { id: fonte.id, chave: CHAVE_DA_FONTE, versao: fonte.versao, hash: fonte.contentHash },
      destino: {
        id: pedido.destinoContextItemId, chave: chaveDestino,
        versao: pedido.destinoVersao, hash: pedido.destinoHash,
      },
      title: destino === 'perfil' ? TITULO_DA_MARCA : TITULO_DOS_PILARES,
      body: corpo, tags: destino === 'perfil' ? ['pauta', 'marca'] : ['pauta', 'marca', 'pilares'],
      sourceRef: referenciaDaProjecao(fonte, proposta.secoesUsadas),
      motivo: `projeção revisada do guia para ${chaveDestino}; trechos e hashes na referência da fonte`,
    });
    return this.painel(orgId);
  }

  /** A edição à mão do perfil. `versao` velha é outra aba mexendo junto (409). */
  async salvarPerfil(orgId: string, actorId: string, entrada: PautaMarcaSalvarInput): Promise<PautaMarcaPainel> {
    await this.brandbooks.exigirLegadoPermitido(orgId);
    const corpo = entrada.perfil.replace(/\r\n?/g, '\n').trim();
    const nota = await this.gravar(orgId, PAUTA_CHAVE_DA_MARCA, {
      titulo: TITULO_DA_MARCA,
      corpo,
      tags: ['pauta', 'marca'],
      sourceRef: 'pauta.marca · edição manual',
      motivo: 'perfil da marca editado à mão (MK1)',
      versaoEsperada: entrada.versao,
      aoRestaurar: 'a marca voltou a valer com a versão nova',
    });
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.marca_salva',
      entityType: 'context_item',
      entityId: nota.id,
      after: { versao: nota.versao, caracteres: corpo.length },
    });
    return this.painel(orgId);
  }

  /**
   * A edição à mão dos pilares. Grava o TEXTO como a pessoa escreveu, não a
   * lista lida: a nota é o original, e o que a leitura não entendeu volta em
   * `avisos` para ela corrigir — apagar a linha ruim ao gravar perderia o que
   * ela quis dizer.
   */
  async salvarPilares(orgId: string, actorId: string, entrada: PautaPilaresSalvarInput): Promise<PautaMarcaPainel> {
    await this.brandbooks.exigirLegadoPermitido(orgId);
    const corpo = entrada.pilares.replace(/\r\n?/g, '\n').trim();
    const nota = await this.gravar(orgId, PAUTA_CHAVE_DOS_PILARES, {
      titulo: TITULO_DOS_PILARES,
      corpo,
      tags: ['pauta', 'marca', 'pilares'],
      sourceRef: 'pauta.marca.pilares · edição manual',
      motivo: 'pilares de conteúdo editados à mão (MK1)',
      versaoEsperada: entrada.versao,
      aoRestaurar: 'os pilares voltaram a valer com a versão nova',
    });
    const painel = await this.painel(orgId);
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.pilares_salvos',
      entityType: 'context_item',
      entityId: nota.id,
      after: { versao: nota.versao, pilares: painel.pilares.map((p) => p.chave), avisos: painel.avisos.length },
    });
    return painel;
  }

  /** O modelo do perfil, para a aba oferecer as seções em vez de uma folha em branco. */
  static modeloDoPerfil(): string {
    return PAUTA_SECOES_DA_MARCA.map((s) => `## ${s}\n`).join('\n');
  }

  private async gravar(
    orgId: string,
    chave: string,
    d: {
      titulo: string;
      corpo: string;
      tags: string[];
      sourceRef: string;
      motivo: string;
      versaoEsperada?: number;
      aoRestaurar: string;
    },
  ): Promise<NotaDeContexto> {
    const existente = await this.memoria.porChave(orgId, chave);
    if (!existente) {
      if (d.versaoEsperada) {
        // A aba partiu de uma versão que não existe mais: a nota foi apagada
        // entre a leitura e o salvar. Criar aqui esconderia a remoção.
        throw new ConflictException('A nota mudou desde a leitura — recarregue e tente de novo.');
      }
      return this.memoria.criar(orgId, {
        chave,
        kind: ContextKind.definicao,
        title: d.titulo,
        body: d.corpo,
        tags: d.tags,
        sourceType: ContextSource.operador,
        sourceRef: d.sourceRef,
        motivo: d.motivo,
      });
    }
    let nota = await this.memoria.alterar(orgId, existente.id, {
      kind: ContextKind.definicao,
      title: d.titulo,
      body: d.corpo,
      sourceType: ContextSource.operador,
      sourceRef: d.sourceRef,
      motivo: d.motivo,
      versaoEsperada: d.versaoEsperada,
    });
    if (nota.arquivadoEm) nota = await this.memoria.restaurar(orgId, nota.id, d.aoRestaurar);
    return nota;
  }
}
