/**
 * Migração dos dados de produção do root-bio (Postgres próprio, `root_bio-db`)
 * para o banco da plataforma. Roda uma vez, na virada.
 *
 *   BIO_DATABASE_URL=postgres://... \
 *   BIO_OLD_ENCRYPTION_KEY=<chave antiga, só se for diferente da atual> \
 *   pnpm db:migrate-bio [--dry]
 *
 * Preserva os IDs (uuid → uuid), então as FKs atravessam intactas e o script é
 * idempotente: rodar de novo não duplica nada.
 *
 * NÃO migra: Org/User/LoginToken/Session (a autenticação agora é a da
 * plataforma) nem Consent/OauthState (tabela morta e estado efêmero).
 */
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { cifrar, decifrar } from '../src/common/crypto';

const prisma = new PrismaClient();
const SECO = process.argv.includes('--dry');
const ORG_DESTINO = process.env.BIO_ORG_SLUG ?? 'root';

type Linha = Record<string, any>;

const contagem: Record<string, number> = {};
function conta(tabela: string, n = 1) {
  contagem[tabela] = (contagem[tabela] ?? 0) + n;
}

/** Decifra com a chave antiga e re-cifra com a atual. Chaves iguais → cópia. */
function recifrar(pacote: string | null, contexto: string): { valor: string | null; erro?: string } {
  if (!pacote) return { valor: null };
  const antiga = process.env.BIO_OLD_ENCRYPTION_KEY;
  if (!antiga || antiga === process.env.ENCRYPTION_KEY) return { valor: pacote };

  const atual = process.env.ENCRYPTION_KEY;
  try {
    process.env.ENCRYPTION_KEY = antiga;
    const claro = decifrar(pacote);
    process.env.ENCRYPTION_KEY = atual;
    return { valor: cifrar(claro) };
  } catch (e) {
    process.env.ENCRYPTION_KEY = atual;
    return { valor: pacote, erro: `${contexto}: ${(e as Error).message}` };
  }
}

async function main() {
  const url = process.env.BIO_DATABASE_URL;
  if (!url) throw new Error('BIO_DATABASE_URL ausente (banco de origem do root-bio)');

  const org = await prisma.org.findUnique({ where: { slug: ORG_DESTINO } });
  if (!org) throw new Error(`org destino "${ORG_DESTINO}" não existe — rode o seed antes`);

  const origem = new Client({ connectionString: url });
  await origem.connect();
  const ler = async (sql: string): Promise<Linha[]> => (await origem.query(sql)).rows;

  console.log(`→ origem: root-bio · destino: org "${ORG_DESTINO}" (${org.id})${SECO ? ' · ENSAIO' : ''}`);

  // ---------- Páginas e botões ----------
  // Todas as orgs da origem colapsam na org da plataforma: o handle já era
  // @unique global, então não há colisão possível.
  const pages = await ler('select * from "Page"');
  const orgsDaOrigem = new Set(pages.map((p) => p.orgId));
  if (orgsDaOrigem.size > 1) {
    console.log(`  ⚠ ${orgsDaOrigem.size} orgs na origem → todas remapeadas para "${ORG_DESTINO}"`);
  }
  const orgDaPage = new Map<string, string>();
  for (const p of pages) {
    orgDaPage.set(p.id, org.id);
    if (!SECO) {
      await prisma.bioPage.upsert({
        where: { id: p.id },
        update: {},
        create: {
          id: p.id,
          orgId: org.id,
          handle: p.handle,
          titulo: p.titulo,
          subtitulo: p.subtitulo,
          avatarUrl: p.avatarUrl,
          tema: p.tema ?? {},
          publicada: p.publicada,
          criadaEm: p.criadaEm,
          atualizadaEm: p.atualizadaEm,
        },
      });
    }
    conta('BioPage');
  }

  for (const l of await ler('select * from "Link"')) {
    if (!SECO) {
      await prisma.bioLink.upsert({
        where: { id: l.id },
        update: {},
        create: {
          id: l.id,
          pageId: l.pageId,
          ordem: l.ordem,
          tipo: l.tipo,
          rotulo: l.rotulo,
          destino: l.destino,
          icone: l.icone,
          destaque: l.destaque,
          ativo: l.ativo,
          criadoEm: l.criadoEm,
        },
      });
    }
    conta('BioLink');
  }

  // ---------- Conexões e credenciais (com re-cifragem) ----------
  const avisos: string[] = [];
  for (const c of await ler('select * from "Conexao"')) {
    const token = recifrar(c.tokenCifrado, `conexão ${c.plataforma}/@${c.handle}`);
    const refresh = recifrar(c.refreshCifrado, `refresh ${c.plataforma}/@${c.handle}`);
    if (token.erro) avisos.push(token.erro);
    if (refresh.erro) avisos.push(refresh.erro);

    if (!SECO) {
      await prisma.bioConexao.upsert({
        where: { id: c.id },
        update: {},
        create: {
          id: c.id,
          orgId: org.id,
          plataforma: c.plataforma,
          externalId: c.externalId,
          handle: c.handle,
          tokenCifrado: token.valor!,
          refreshCifrado: refresh.valor,
          expiraEm: c.expiraEm,
          escopos: c.escopos,
          // Token ilegível = precisa reconectar; melhor dizer isso na tela do que
          // deixar o sync descobrir sozinho daqui a 6 horas.
          status: token.erro ? 'token_expirado' : c.status,
          ultimoErro: token.erro ?? c.ultimoErro,
          conectadaEm: c.conectadaEm,
          atualizadaEm: c.atualizadaEm,
        },
      });
    }
    conta('BioConexao');
  }

  for (const c of await ler('select * from "CredencialApp"')) {
    const segredo = recifrar(c.segredoCifrado, `credencial ${c.plataforma}`);
    if (segredo.erro) avisos.push(segredo.erro);
    if (!SECO) {
      await prisma.bioCredencialApp.upsert({
        where: { id: c.id },
        update: {},
        create: {
          id: c.id,
          plataforma: c.plataforma,
          orgId: c.orgId ? org.id : null, // null = credencial global, preservar
          appId: c.appId,
          segredoCifrado: segredo.valor!,
          atualizadaPor: c.atualizadaPor,
        },
      });
    }
    conta('BioCredencialApp');
  }

  // ---------- Desafio ----------
  for (const d of await ler('select * from "Challenge"')) {
    if (!SECO) {
      await prisma.bioChallenge.upsert({
        where: { id: d.id },
        update: {},
        create: {
          id: d.id,
          orgId: orgDaPage.get(d.pageId) ?? org.id,
          pageId: d.pageId,
          titulo: d.titulo,
          inicio: d.inicio,
          fim: d.fim,
          metaPosts: d.metaPosts,
          exibir: d.exibir,
          criadoEm: d.criadoEm,
        },
      });
    }
    conta('BioChallenge');
  }

  for (const c of await ler('select * from "ChallengeAccount"')) {
    if (!SECO) {
      await prisma.bioChallengeAccount.upsert({
        where: { id: c.id },
        update: {},
        create: {
          id: c.id,
          challengeId: c.challengeId,
          plataforma: c.plataforma,
          handle: c.handle,
          modo: c.modo,
          externalId: c.externalId,
          conexaoId: c.conexaoId,
          baselineCount: c.baselineCount,
          baselineEm: c.baselineEm,
          status: c.status,
          ultimaColeta: c.ultimaColeta,
          ultimoErro: c.ultimoErro,
        },
      });
    }
    conta('BioChallengeAccount');
  }

  await emLotes('ChallengePost', ler, async (posts) => {
    if (SECO) return;
    await prisma.bioChallengePost.createMany({
      data: posts.map((p) => ({
        id: p.id,
        contaId: p.contaId,
        externalId: p.externalId,
        publicadoEm: p.publicadoEm,
        permalink: p.permalink,
        tipo: p.tipo,
        vistoEm: p.vistoEm,
        sumiuEm: p.sumiuEm,
      })),
      skipDuplicates: true,
    });
  });

  // Append-only por princípio: o histórico sobrevive a mudança de fórmula.
  await emLotes('ChallengeSnapshot', ler, async (snaps) => {
    if (SECO) return;
    await prisma.bioChallengeSnapshot.createMany({
      data: snaps.map((s) => ({
        id: s.id,
        contaId: s.contaId,
        coletadoEm: s.coletadoEm,
        totalCount: s.totalCount,
        countNaJanela: s.countNaJanela,
        ok: s.ok,
        erro: s.erro,
        bruto: s.bruto ?? undefined,
      })),
      skipDuplicates: true,
    });
  });

  // ---------- Rastreio ----------
  await emLotes('Visitor', ler, async (vs) => {
    if (SECO) return;
    await prisma.bioVisitor.createMany({
      data: vs.map((v) => ({
        id: v.id,
        primeiroVisto: v.primeiroVisto,
        ultimoVisto: v.ultimoVisto,
      })),
      skipDuplicates: true,
    });
  });

  await emLotes('Visit', ler, async (vs) => {
    if (SECO) return;
    await prisma.bioVisit.createMany({
      data: vs.map((v) => ({
        id: v.id,
        orgId: orgDaPage.get(v.pageId) ?? org.id,
        visitorId: v.visitorId,
        pageId: v.pageId,
        iniciadaEm: v.iniciadaEm,
        referrer: v.referrer,
        utmSource: v.utmSource,
        utmMedium: v.utmMedium,
        utmCampaign: v.utmCampaign,
        utmContent: v.utmContent,
        utmTerm: v.utmTerm,
        fbclid: v.fbclid,
        ttclid: v.ttclid,
        gclid: v.gclid,
        device: v.device,
        os: v.os,
        browser: v.browser,
        pais: v.pais,
        cidade: v.cidade,
      })),
      skipDuplicates: true,
    });
  });

  // Eventos entram nas duas pontas: BioEvent (analytics da bio) e PixelEvent
  // (funil genérico), com o MESMO eventId — o @unique de lá deduplica sozinho
  // o que a bio já tiver empurrado por /events/track no passado.
  const visitaPorId = new Map<string, Linha>();
  for (const v of await ler('select * from "Visit"')) visitaPorId.set(v.id, v);

  await emLotes('Event', ler, async (evs) => {
    if (SECO) return;
    await prisma.bioEvent.createMany({
      data: evs.map((e) => ({
        id: e.id,
        eventId: e.eventId,
        orgId: orgDaPage.get(e.pageId) ?? org.id,
        pageId: e.pageId,
        visitId: e.visitId,
        visitorId: e.visitorId,
        nome: e.nome,
        linkId: e.linkId,
        url: e.url,
        metadata: e.metadata ?? undefined,
        ocorridoEm: e.ocorridoEm,
      })),
      skipDuplicates: true,
    });

    await prisma.pixelEvent.createMany({
      data: evs.map((e) => {
        const v = e.visitId ? visitaPorId.get(e.visitId) : undefined;
        return {
          orgId: orgDaPage.get(e.pageId) ?? org.id,
          eventId: e.eventId,
          sessionId: e.visitId ?? e.eventId,
          anonymousId: e.visitorId ?? 'anon',
          eventName: e.nome,
          url: e.url,
          referrer: v?.referrer ?? null,
          utmSource: v?.utmSource ?? null,
          utmMedium: v?.utmMedium ?? null,
          utmCampaign: v?.utmCampaign ?? null,
          utmContent: v?.utmContent ?? null,
          utmTerm: v?.utmTerm ?? null,
          device: v?.device ?? null,
          metadata: { fonte: 'bio', pageId: e.pageId, ...(e.linkId ? { linkId: e.linkId } : {}) },
          occurredAt: e.ocorridoEm,
        };
      }),
      skipDuplicates: true,
    });
    conta('PixelEvent', evs.length);
  });

  await origem.end();

  console.log('\n— migrado —');
  for (const [t, n] of Object.entries(contagem)) console.log(`  ${t.padEnd(22)} ${n}`);

  if (avisos.length) {
    console.log('\n⚠ tokens que não abriram com BIO_OLD_ENCRYPTION_KEY (reconectar na tela):');
    for (const a of new Set(avisos)) console.log(`  · ${a}`);
  }

  if (!SECO) {
    console.log('\nPróximo passo: POST /api/bio/bridge/goals para recalcular bioClicks.');
  }
}

/** Lê e grava em lotes — a tabela de eventos pode ter muita linha. */
async function emLotes(
  tabela: string,
  ler: (sql: string) => Promise<Linha[]>,
  gravar: (linhas: Linha[]) => Promise<void>,
  tamanho = 1000,
) {
  const linhas = await ler(`select * from "${tabela}"`);
  for (let i = 0; i < linhas.length; i += tamanho) {
    await gravar(linhas.slice(i, i + tamanho));
  }
  conta(`Bio${tabela}`, linhas.length);
}

main()
  .catch((e) => {
    console.error(`\n✖ ${(e as Error).message}`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
