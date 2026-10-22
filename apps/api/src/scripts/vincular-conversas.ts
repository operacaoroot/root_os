/*
 * ============================================================================
 * VINCULAR AS CONVERSAS DO WHATSAPP (rodada de produção 4, W3, 22/10/2026)
 * ============================================================================
 *
 *   node dist/scripts/vincular-conversas.js --org <apelido|id> [--simular]
 *   node dist/scripts/vincular-conversas.js --org <apelido|id> --valer --como <e-mail> [--detalhe <arquivo fora do repositório>]
 *
 * Padrão: SIMULA (diz quantas conversas mudariam e os ids curtos). `--valer` grava.
 * Nunca imprime nome nem número: só contagens e os 8 primeiros caracteres de cada id.
 * `--detalhe` grava os NOMES (conversa e alvo) num arquivo que o operador escolhe,
 * recusado dentro de um repositório git.
 *
 * O QUE ELE FAZ, e só isso:
 *   1. roda o casamento automático (`casar`, o mesmo do gravador) em TODAS as
 *      conversas da empresa: 1:1 pelo telefone, equipe pelo nome ou número,
 *      sugestão de grupo pelo nome IGUAL. O que uma pessoa decidiu e as
 *      arquivadas ficam como estão;
 *   2. APLICA as sugestões de grupo por nome IGUAL (`como: 'nome_igual'`), em
 *      nome de `--como`, como se ela tivesse clicado "Vincular a <nome>?": a
 *      conversa e as mensagens dela ganham o cliente (ou o lead), com a linha de
 *      auditoria `whatsapp.conversa.vinculada` (`como: 'script'`).
 *   Nome PARECIDO não entra: só a busca da tela o oferece. Nada é apagado.
 *
 * `--como` é obrigatório para `--valer` e é relido no banco: usuário ativo desta
 * empresa, de gente (conta de máquina é recusada) e com `leads.editar`.
 * IDEMPOTENTE: a segunda `--valer` não muda nada e o `--simular` depois dá zero
 * (a conversa ligada é decisão de pessoa e o casamento não a toca).
 *
 * Roda COMPILADO, com a conexão dona (`DATABASE_URL`), como `restaurar-tarefas.ts`.
 * A escrita roda no contexto da empresa.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { ActorType, PrismaClient } from '@prisma/client';

import { temPapelDeMaquina } from '../approvals/alcada';
import { dentroDeGit } from '../comercial/importador-crm/detalhe';
import { comContexto } from '../common/contexto-execucao';
import type { PrismaService } from '../prisma/prisma.service';
import { comTenantNaSessao } from '../prisma/sessao-de-banco';
import { idCurtoDaConversa } from '../whatsapp/vinculo';
import { VinculoDoWhatsappService } from '../whatsapp/vinculo.service';

export interface PedidoDeVinculo {
  org: string;
  como: string | null;
  valer: boolean;
}

export interface LinhaDoDetalhe {
  id: string;
  conversa: string;
  grupo: boolean;
  acao: string;
  alvo: string | null;
}

export interface ResultadoDoVinculoEmLote {
  modo: 'simular' | 'valer';
  conversas: number;
  /** De decisão de pessoa ou arquivadas: o casamento não as toca. */
  manuais: number;
  /** 1:1 cujo casamento automático (telefone, equipe) mudou ou mudaria. */
  casamentos: number;
  /** Grupos com a sugestão de nome igual à espera do clique (antes do passo 2). */
  sugestoesDeNomeIgual: number;
  /** As sugestões aplicadas (ou que seriam). */
  aplicadas: number;
  equipe: number;
  ids: { casamentos: string[]; aplicadas: string[] };
  detalhe: LinhaDoDetalhe[];
}

export async function vincularConversas(prisma: PrismaClient, p: PedidoDeVinculo): Promise<ResultadoDoVinculoEmLote> {
  if (p.valer && !p.como) throw new Error('falta --como <e-mail>: o vínculo fica registrado em nome de uma pessoa da casa.');
  const empresa = await prisma.org.findFirst({ where: { OR: [{ id: p.org }, { slug: p.org }] }, select: { id: true } });
  if (!empresa) throw new Error('a empresa de --org não existe neste banco.');
  const orgId = empresa.id;
  const svc = new VinculoDoWhatsappService(prisma as unknown as PrismaService);

  return comContexto(
    { orgId, actorType: ActorType.user, actorId: null, correlationId: `terminal-vincular-conversas-${orgId}-${Date.now()}`, origem: 'script' },
    async () => {
      let pessoaId: string | null = null;
      if (p.como) {
        const pessoa = await prisma.user.findFirst({
          where: { orgId, isActive: true, OR: [{ email: p.como.toLowerCase() }, { email: p.como }, { id: p.como }] },
          select: { id: true, roles: { where: { orgId }, select: { key: true, permissions: { select: { key: true } } } } },
        });
        if (!pessoa) throw new Error('a pessoa de --como não é um usuário ativo desta empresa.');
        if (temPapelDeMaquina(pessoa.roles.map((r) => r.key))) throw new Error('--como é conta de máquina: vincular é de gente.');
        if (!pessoa.roles.some((r) => r.permissions.some((x) => x.key === 'leads.editar'))) throw new Error('a pessoa de --como não tem leads.editar.');
        pessoaId = pessoa.id;
      }

      const conversas = await prisma.whatsAppConversa.findMany({ where: { orgId }, select: { id: true, nome: true, grupo: true }, orderBy: { id: 'asc' } });
      const r: ResultadoDoVinculoEmLote = {
        modo: p.valer ? 'valer' : 'simular',
        conversas: conversas.length,
        manuais: 0,
        casamentos: 0,
        sugestoesDeNomeIgual: 0,
        aplicadas: 0,
        equipe: 0,
        ids: { casamentos: [], aplicadas: [] },
        detalhe: [],
      };
      for (const c of conversas) {
        const d = await svc.casar(orgId, c.id, { simular: !p.valer });
        if (d.manual) {
          r.manuais++;
          continue;
        }
        if (d.equipe) r.equipe++;
        if (d.mudou && !c.grupo) {
          r.casamentos++;
          r.ids.casamentos.push(idCurtoDaConversa(c.id));
          r.detalhe.push({ id: c.id, conversa: c.nome ?? '', grupo: false, acao: d.equipe ? 'equipe' : d.leadId || d.clienteId ? 'casou pelo telefone' : 'sem vínculo', alvo: d.leadId ?? d.clienteId });
        }
        if (c.grupo && d.sugestao?.como === 'nome_igual') {
          r.sugestoesDeNomeIgual++;
          const alvo = { tipo: d.sugestao.tipo, id: d.sugestao.id };
          if (p.valer) {
            const ligou = await prisma.$transaction((tx) => svc.vincularNaTransacao(tx, orgId, c.id, alvo, pessoaId!, 'script'));
            if (!ligou) continue;
          }
          r.aplicadas++;
          r.ids.aplicadas.push(idCurtoDaConversa(c.id));
          r.detalhe.push({ id: c.id, conversa: c.nome ?? '', grupo: true, acao: `vincular a ${d.sugestao.tipo}`, alvo: d.sugestao.nome });
        }
      }
      return r;
    },
  );
}

function opcao(args: string[], nome: string): string | undefined {
  const i = args.indexOf(`--${nome}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}

function celula(s: string | null): string {
  return String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
}

function markdownDoDetalhe(r: ResultadoDoVinculoEmLote, quando: string): string {
  return [
    `# Vincular conversas do WhatsApp (${r.modo}) · ${quando}`,
    '',
    'Arquivo com nomes de clientes: não versionar, não colar em lugar nenhum.',
    '',
    '| conversa | grupo | ação | alvo | id |',
    '| --- | --- | --- | --- | --- |',
    ...r.detalhe.map((l) => `| ${celula(l.conversa)} | ${l.grupo ? 'sim' : 'não'} | ${celula(l.acao)} | ${celula(l.alvo)} | ${l.id} |`),
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const valer = args.includes('--valer');
  if (valer && args.includes('--simular')) throw new Error('escolha um: --simular (padrão) ou --valer.');
  const org = opcao(args, 'org');
  const como = opcao(args, 'como') ?? null;
  const detalhe = opcao(args, 'detalhe');
  if (!org) throw new Error('falta --org <apelido|id>: o comando nunca escolhe a empresa sozinho.');
  if (valer && !como) throw new Error('falta --como <e-mail>: o vínculo fica registrado em nome de uma pessoa da casa.');
  if (detalhe && dentroDeGit(detalhe)) throw new Error('o arquivo de --detalhe tem nome de cliente: grave fora de repositório git.');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL vazia. Nunca passe a URL na linha de comando.');

  const base = new PrismaClient();
  const prisma = comTenantNaSessao(base, { modo: 'observar', avisar: () => undefined });
  try {
    const r = await vincularConversas(prisma, { org, como, valer });
    if (detalhe) {
      mkdirSync(path.dirname(path.resolve(detalhe)), { recursive: true });
      writeFileSync(detalhe, markdownDoDetalhe(r, new Date().toISOString()), { encoding: 'utf8', mode: 0o600 });
    }
    // Só contagens e ids curtos. Nada de nome nem número.
    const { detalhe: _nomes, ...resumo } = r;
    console.log(JSON.stringify({ ...resumo, detalheGravado: !!detalhe }, null, 2));
    if (r.modo === 'simular') {
      const total = r.casamentos + r.aplicadas;
      console.log(total ? `${r.aplicadas} grupo(s) seriam ligados e ${r.casamentos} conversa(s) 1:1 mudariam. Nada foi escrito; rode com --valer --como <e-mail>.` : 'Zero a fazer.');
    } else {
      console.log(r.casamentos + r.aplicadas ? `${r.aplicadas} grupo(s) ligado(s) (auditoria whatsapp.conversa.vinculada) e ${r.casamentos} conversa(s) 1:1 casada(s). Nada foi apagado.` : 'Zero a fazer: nada mudou.');
    }
  } finally {
    await base.$disconnect();
  }
}

// Só quando o arquivo compilado é executado: a suíte importa `vincularConversas` sem disparar a linha de comando.
if (/vincular-conversas\.js$/.test(process.argv[1] ?? '')) {
  main().catch((e) => {
    console.error('\nfalhou:', (e as Error).message);
    process.exit(1);
  });
}
