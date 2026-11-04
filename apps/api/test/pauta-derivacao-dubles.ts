import { createHash } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { chaveDaEstrategia, chaveDaPerformance, chaveDoRelatorio } from '@mktos/shared';
import { chaveDoDossie } from '../src/pauta/concorrentes.service';
import { comContexto } from '../src/common/contexto-execucao';
import type {
  CausaDaDerivacao, DadosDerivadosDaNota, IdentidadeDaDerivacao, LeitorFisicoDaDerivacao,
  PlanoInternoDeFontesDaDerivacao, VersaoAplicadaDaDerivacao,
} from '../src/memory/memoria.service';

export const atuarNaPauta = <T>(orgId: string, actorId: string, fn: () => T): T =>
  comContexto({ orgId, actorId, actorType: 'user', origem: 'http', correlationId: 'teste-pauta-humana' }, fn);

export const PERMISSOES_DERIVACAO_PAUTA = ['obsidian.ver', 'pauta.ver', 'pauta.editar', 'automacoes.executar'];

function chave(causa: CausaDaDerivacao) {
  switch (causa.tipo) {
    case 'A4-DOSSIE': return chaveDoDossie(causa.fonteId);
    case 'A4-ESTRATEGIA': return chaveDaEstrategia(causa.mes);
    case 'A4-PERF': return chaveDaPerformance(causa.mes);
    case 'A4-RELATORIO-HUMANO':
    case 'A4-RELATORIO-ROTINA': return chaveDoRelatorio(causa.mes);
    case 'A4-VOZ': return causa.chave;
    default: throw new Error(`Derivação inesperada no teste: ${causa.tipo}`);
  }
}

type Nota = { id: string; chave: string; body: string; versao?: number; arquivadoEm: string | null };
type Escrita = {
  criar: (orgId: string, entrada: Record<string, unknown>) => Promise<Nota>;
  alterar: (orgId: string, id: string, entrada: Record<string, unknown>) => Promise<Nota>;
};

const hash = (texto: string) => createHash('sha256').update(texto).digest('hex');
const criadoEm = new Date('2026-09-28T12:00:00.000Z');

// Exercita os planos reais de cada produtor. O dublê substitui apenas a
// persistência da Memória, incluindo a conferência da seleção no apply.
export function derivacaoDaPauta(notas: Map<string, Nota>, escrita: Escrita) {
  const versoes = new Map<string, { id: string; criadoEm: Date } & VersaoAplicadaDaDerivacao>();
  return {
    contextItem: { findFirst: async ({ where }: { where: { chave: string } }) => notas.get(where.chave) ?? null },
    contextItemVersion: { findFirst: async ({ where }: { where: { id: string } }) => versoes.get(where.id) ?? null },
    user: { findFirst: async () => ({ roles: [{ permissions: PERMISSOES_DERIVACAO_PAUTA.map(key => ({ key })) }] }) },
    $queryRaw: async () => [],
    async observarDestinoDaDerivacaoNoTx<M, S>(tx: Prisma.TransactionClient, orgId: string,
      _identidade: IdentidadeDaDerivacao, causa: CausaDaDerivacao, plano: PlanoInternoDeFontesDaDerivacao<M, S>) {
      const ler: LeitorFisicoDaDerivacao = async seletor => {
        if (!('chave' in seletor)) throw new Error('Seleção física inesperada no teste.');
        const nota = notas.get(seletor.chave);
        const base = { orgId, chave: seletor.chave };
        return nota
          ? { ...base, estado: 'existente', nota: { ...nota }, versao: { versao: nota.versao } } as Awaited<ReturnType<LeitorFisicoDaDerivacao>>
          : { ...base, estado: 'ausente_fisico' };
      };
      const destino = chave(causa);
      const base = JSON.stringify(notas.get(destino) ?? null);
      const observada = await plano.observar(tx, ler);
      const capsula = {
        orgId, destino, base,
        conferir: async (db: Prisma.TransactionClient) => {
          const relida = await plano.reconferir(db, ler, observada.selecao);
          return JSON.stringify(relida.descritores) === JSON.stringify(observada.descritores);
        },
      };
      return { material: observada.material, capsula };
    },
    async aplicarDerivacaoCondicionadaNoTx(tx: Prisma.TransactionClient,
      capsula: { orgId: string; destino: string; base: string; conferir: (db: Prisma.TransactionClient) => Promise<boolean> },
      dados: DadosDerivadosDaNota) {
      const { orgId, destino } = capsula;
      const anterior = notas.get(destino);
      if (!await capsula.conferir(tx) || JSON.stringify(anterior ?? null) !== capsula.base) throw new ConflictException('A base da derivação mudou.');
      const nota = anterior
        ? await escrita.alterar(orgId, anterior.id, { ...dados, versaoEsperada: anterior.versao })
        : await escrita.criar(orgId, { ...dados, chave: destino });
      const versao = nota.versao ?? 1;
      const versionId = `${nota.id}:${versao}`;
      const aplicada = { orgId, itemId: nota.id, versionId, versao, chave: destino,
        kind: dados.kind ?? 'definicao', title: dados.title, body: dados.body, contentHash: hash(dados.body),
        sourceType: dados.sourceType, sourceRef: dados.sourceRef ?? null };
      versoes.set(versionId, { ...aplicada, id: versionId, criadoEm });
      return { aplicada };
    },
    async concluirEntregaDaDerivacao(compromisso: { aplicada: VersaoAplicadaDaDerivacao }) {
      const nota = notas.get(compromisso.aplicada.chave);
      if (!nota || !versoes.has(compromisso.aplicada.versionId)) throw new ConflictException('A versão aplicada não foi encontrada.');
      return { ...compromisso, disponibilidadeAtual: { arquivada: Boolean(nota.arquivadoEm) } };
    },
  };
}

export function prismaDaDerivacao<T extends object>(repositorios: T) {
  return { ...repositorios, $transaction: async <R>(fn: (tx: T) => Promise<R>) => fn(repositorios) };
}
