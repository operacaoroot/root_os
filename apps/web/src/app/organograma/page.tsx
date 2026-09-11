'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bot, User as UserIcon } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { KpiCard } from '@/components/KpiCard';
import { rotaNaoExiste } from '../agentes/rota-ausente';

/*
 * O ORGANOGRAMA (RF-N-06) — gente e agentes lado a lado, por pilar.
 *
 * QUATRO DECISÕES QUE VALE LER ANTES DE MEXER:
 *
 * 1. O PILAR DE UMA PESSOA É DERIVADO. `User` não tem coluna de pilar; o pilar
 *    de alguém é o dos agentes de que ela é dona. Quem não é dona de nenhum
 *    aparece em "ainda sem pilar" — que é informação verdadeira, e melhor do
 *    que inventar um quadrado para caber.
 *
 * 2. ESTA TELA MOSTRA GENTE, e o isolamento é da API. Os TRÊS métodos que
 *    expõem dono — `roster`, `detalhe` e `organograma` — resolvem o `donoId`
 *    contra a gente DESTA empresa, e não pela relação do Prisma (que não filtra
 *    relação para um e traria o nome de quem estiver do outro lado). Ponteiro
 *    atravessado aparece como "sem dono". A suíte prova nos três, por tentativa
 *    (`apps/api/test/sop.test.ts`). Aqui no web não há trava nenhuma: quem
 *    recusa é o servidor.
 *
 *    Isto importa mais do que parece: até 11/09/2026 o roster ainda resolvia o
 *    dono por relação, e a decisão escrita aqui não era verdade na produção.
 *
 * 3. O DESVIO, QUE HOJE É REDE DE SEGURANÇA. `GET /organograma` é a fonte boa
 *    (traz TODA a gente da empresa, com papel e estado) e está no ar desde a
 *    estabilização da onda 9. O caminho alternativo por `GET /agents` continua
 *    aqui e só acorda se a rota sumir outra vez — quando isso acontece a tela
 *    diz que a lista é parcial, em vez de mostrar menos gente sem avisar.
 *
 * 4. O QUE O DESVIO NÃO SABE, ELE NÃO AFIRMA. O roster não traz papel nem
 *    estado de ninguém, e não traz quem não é dono de agente. Então em modo
 *    parcial `papeis` e `ativo` vêm NULOS e a tela escreve "não vem desta
 *    fonte" — antes ela imprimia "sem papel declarado" para todo mundo, que é
 *    afirmar como fato o que ninguém mediu, e o contador de gente somava só os
 *    donos sem ressalva nenhuma.
 */

interface PessoaDto {
  id: string;
  nome: string;
  /** `null` = a fonte não informa (ver decisão 4), diferente de `false`. */
  ativo: boolean | null;
  /** `null` = a fonte não informa; `[]` = a pessoa realmente não tem papel. */
  papeis: string[] | null;
  pilares: string[];
  agentes: string[];
}

interface AgenteDto {
  slug: string;
  nome: string;
  iniciais: string;
  missao: string;
  pilar: string | null;
  tipo: string;
  estado: string;
  autonomiaAte: string;
  cron: string | null;
  dono: { id: string; nome: string } | null;
}

interface Organograma {
  pilares: { pilar: string; pessoas: PessoaDto[]; agentes: AgenteDto[] }[];
  semPilar: { pessoas: PessoaDto[]; agentes: AgenteDto[] };
  totais: { pessoas: number; agentes: number; agentesSemDono: number; pilares: number };
}

/** A forma que `GET /agents` devolve, no recorte que este desvio usa. */
interface ItemDoRoster {
  slug: string;
  nome: string;
  iniciais: string;
  missao: string;
  pilar: string | null;
  dono: { id: string; nome: string } | null;
  tipo: string;
  estado: string;
  autonomiaAte: string;
  cron: string | null;
}

/** Monta o organograma possível a partir do roster. Ver as decisões 3 e 4 acima. */
function doRoster(items: ItemDoRoster[]): Organograma {
  const agentes: AgenteDto[] = items.map((a) => ({ ...a }));

  const porPessoa = new Map<string, PessoaDto>();
  for (const a of agentes) {
    if (!a.dono) continue;
    const p =
      porPessoa.get(a.dono.id) ??
      // `ativo` e `papeis` NULOS: o roster não informa nenhum dos dois, e
      // chutar `true`/`[]` aqui era o que fazia a tela afirmar o que não sabia.
      { id: a.dono.id, nome: a.dono.nome, ativo: null, papeis: null, pilares: [], agentes: [] };
    p.agentes.push(a.slug);
    if (a.pilar && !p.pilares.includes(a.pilar)) p.pilares.push(a.pilar);
    porPessoa.set(a.dono.id, p);
  }
  const pessoas = [...porPessoa.values()].sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));

  const nomes = [...new Set(agentes.map((a) => a.pilar).filter((p): p is string => !!p))].sort(
    (x, y) => x.localeCompare(y, 'pt-BR'),
  );

  return {
    pilares: nomes.map((pilar) => ({
      pilar,
      pessoas: pessoas.filter((p) => p.pilares.includes(pilar)),
      agentes: agentes.filter((a) => a.pilar === pilar),
    })),
    semPilar: {
      pessoas: pessoas.filter((p) => p.pilares.length === 0),
      agentes: agentes.filter((a) => !a.pilar),
    },
    totais: {
      pessoas: pessoas.length,
      agentes: agentes.length,
      agentesSemDono: agentes.filter((a) => !a.dono).length,
      pilares: nomes.length,
    },
  };
}

export default function OrganogramaPage() {
  const { token, ready } = useAuth();
  const [data, setData] = useState<Organograma | null>(null);
  const [parcial, setParcial] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let vivo = true;
    apiGet<Organograma>('/organograma', token)
      .then((r) => {
        if (!vivo) return;
        setData(r);
        setParcial(false);
      })
      .catch((e) => {
        if (!vivo) return;
        // Pela CAUSA, não pelo código: ver `agentes/rota-ausente.ts`. Um 404 de
        // empresa vazia, no dia em que a rota existir, não pode virar "a rota
        // não está ligada".
        if (rotaNaoExiste(e, 'GET', '/organograma')) {
          apiGet<{ items: ItemDoRoster[] }>('/agents', token)
            .then((r) => {
              if (!vivo) return;
              setData(doRoster(r.items));
              setParcial(true);
            })
            .catch((e2) => vivo && setErro((e2 as Error).message));
          return;
        }
        setErro((e as Error).message);
      });
    return () => {
      vivo = false;
    };
  }, [ready, token]);

  const grupos = data
    ? [
        ...data.pilares,
        ...(data.semPilar.pessoas.length || data.semPilar.agentes.length
          ? [{ pilar: '', pessoas: data.semPilar.pessoas, agentes: data.semPilar.agentes }]
          : []),
      ]
    : [];

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        Quem trabalha aqui, gente e agente na mesma coluna, agrupados pelo pilar que cada um
        sustenta. O pilar de uma pessoa vem dos agentes de que ela é dona — não há coluna de pilar
        em ninguém.
      </p>

      {erro && (
        <div className="rounded-root border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{erro}</div>
      )}

      {parcial && (
        <p className="rounded-root border border-warn/40 bg-warn/10 p-3 text-[12px] leading-[1.6] text-warn">
          Lista parcial: <span className="font-os-mono">GET /organograma</span> não respondeu e a
          tela caiu no roster de agentes, então só aparece quem é dono de pelo menos um — e desta
          fonte não vêm papel nem estado de ninguém, que por isso aparecem como não informados em vez
          de em branco. A rota existe desde a onda 9: se esta tarja apareceu, ela saiu do ar.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard
          label={parcial ? 'Gente (parcial)' : 'Gente'}
          value={data?.totais.pessoas ?? '—'}
          hint={parcial ? 'só quem é dono de agente — o resto não vem desta fonte' : undefined}
          icon="Users"
          tone="brand"
        />
        <KpiCard label="Agentes" value={data?.totais.agentes ?? '—'} icon="Bot" />
        <KpiCard label="Pilares" value={data?.totais.pilares ?? '—'} icon="Share2" />
        <KpiCard
          label="Agentes sem dono"
          value={data?.totais.agentesSemDono ?? '—'}
          hint="sem dono não há para quem escalar"
          tone={data && data.totais.agentesSemDono > 0 ? 'warn' : 'default'}
          icon="UserX"
        />
      </div>

      {!data && !erro && <p className="text-sm text-muted">Carregando…</p>}

      {data && grupos.length === 0 && (
        <p className="rounded-root border border-border bg-surface p-4 text-sm text-muted">
          Nenhum agente e nenhum pilar declarado ainda. O organograma aparece quando alguém escrever
          o primeiro.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {grupos.map((g) => (
          <section key={g.pilar || 'sem-pilar'} className="rounded-root border border-border bg-surface p-4">
            <header className="flex items-baseline justify-between gap-2 border-b border-border pb-2">
              <h2 className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-brand">
                {g.pilar || <span className="text-dim">ainda sem pilar</span>}
              </h2>
              <span className="font-os-mono text-[9px] text-dim">
                {g.pessoas.length} gente · {g.agentes.length} agente(s)
              </span>
            </header>

            <div className="mt-3 space-y-1.5">
              {g.pessoas.map((p) => (
                <div key={p.id} className="flex items-start gap-2">
                  <UserIcon size={12} className="mt-[3px] flex-none text-muted" />
                  <div className="min-w-0">
                    {/* `ativo === false` risca; `null` (fonte não informa) não. */}
                    <p
                      className={`text-[12px] ${
                        p.ativo === false ? 'text-dim line-through' : 'text-text'
                      }`}
                    >
                      {p.nome}
                    </p>
                    <p className="font-os-mono text-[9px] leading-[1.6] text-dim">
                      {p.papeis === null
                        ? 'papel não vem desta fonte'
                        : p.papeis.length
                          ? p.papeis.join(' · ')
                          : 'sem papel declarado'}
                      {p.agentes.length > 0 && ` · ${p.agentes.length} agente(s)`}
                    </p>
                  </div>
                </div>
              ))}
              {g.pessoas.length === 0 && (
                <p className="font-os-mono text-[9.5px] text-warn">
                  nenhuma pessoa neste pilar — os agentes daqui não têm dono
                </p>
              )}
            </div>

            <div className="mt-3 space-y-1.5 border-t border-border pt-3">
              {g.agentes.map((a) => (
                <div key={a.slug} className="flex items-start gap-2">
                  <span className="mt-[1px] grid h-5 w-5 flex-none place-items-center rounded-root border border-brand/30 bg-brand/10 font-os-mono text-[8px] font-bold text-brand">
                    {a.iniciais || <Bot size={10} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] text-text">{a.nome}</p>
                    <p className="font-os-mono text-[9px] leading-[1.6] text-dim">
                      {a.tipo} · {a.estado} · até {a.autonomiaAte} ·{' '}
                      {a.dono ? (
                        a.dono.nome
                      ) : (
                        <span className="text-warn">sem dono</span>
                      )}
                    </p>
                  </div>
                </div>
              ))}
              {g.agentes.length === 0 && (
                <p className="font-os-mono text-[9.5px] text-dim">nenhum agente neste pilar</p>
              )}
            </div>
          </section>
        ))}
      </div>

      <Link
        href="/agentes"
        className="inline-flex font-os-mono text-[9.5px] uppercase tracking-[0.16em] text-muted hover:text-text"
      >
        ver o roster completo e os procedimentos →
      </Link>
    </div>
  );
}
