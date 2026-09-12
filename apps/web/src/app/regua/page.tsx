'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AbaCapacidades } from './AbaCapacidades';
import { AbaEscada } from './AbaEscada';
import { AbaPessoas } from './AbaPessoas';
import { AbaSimulador } from './AbaSimulador';
import { AbaSinais } from './AbaSinais';
import { AbaSobrescritas } from './AbaSobrescritas';
import type { PainelDaRegua } from './tipos';

/*
 * A TELA DA RÉGUA — RF-P-09 e RF-B-01.
 *
 * Seis abas: a escada com o que cada degrau exige, os sinais de escalonamento e
 * quando acendem, o catálogo de capacidades com os agentes que declararam cada
 * uma, as sobrescritas desta empresa com data e responsável, o simulador, e
 * quem autoriza (a antiga tela de usuários, absorvida aqui).
 *
 * A ABA VIVE NA URL (`?aba=`) porque `/usuarios` redireciona para
 * `/regua?aba=pessoas` (apps/web/rotas-antigas.mjs): sem ler o parâmetro, todo
 * link antigo cairia na escada e a pessoa acharia que a tela de usuários sumiu.
 *
 * TUDO O QUE APARECE VEM DE `GET /api/policy/regua`, já resolvido para a
 * empresa de quem está olhando — com as sobrescritas dela aplicadas. Não há
 * exemplo fixo em lugar nenhum desta pasta, e não há uma segunda cópia da
 * escada: o front desenha o que recebeu.
 *
 * QUEM VÊ ESTA TELA: `packages/shared/src/nav.ts` declara o item `regua` com
 * `permission: 'mcp.ver'`, e é a MESMA permissão que as duas rotas da API
 * exigem. Menu e API dizendo coisas diferentes é como `/atendimento` acabou
 * visível para quem recebe 403 ao usá-la.
 *
 * A ABA "QUEM AUTORIZA" É A EXCEÇÃO, e ela se protege sozinha: lê `/api/users`
 * e `/api/roles`, que continuam exigindo `admin.usuarios`. Por isso ela só
 * aparece para quem tem essa permissão — oferecer o botão a quem vai levar 403
 * é a mesma armadilha do `/atendimento`, invertida.
 */

type AbaChave =
  | 'escada'
  | 'sinais'
  | 'capacidades'
  | 'sobrescritas'
  | 'simulador'
  | 'pessoas';

/** `exige` ausente = basta a permissão da própria tela (`mcp.ver`). */
const ABAS: { chave: AbaChave; rotulo: string; exige?: string }[] = [
  { chave: 'escada', rotulo: 'A escada' },
  { chave: 'sinais', rotulo: 'Sinais e limites' },
  { chave: 'capacidades', rotulo: 'Capacidades' },
  { chave: 'sobrescritas', rotulo: 'Sobrescritas' },
  { chave: 'simulador', rotulo: 'Simulador' },
  { chave: 'pessoas', rotulo: 'Quem autoriza', exige: 'admin.usuarios' },
];

const ehAba = (v: string | null): v is AbaChave =>
  ABAS.some((a) => a.chave === v);

export default function ReguaPage() {
  return (
    <Suspense fallback={<div className="text-muted">Carregando…</div>}>
      <Regua />
    </Suspense>
  );
}

function Regua() {
  const { token, ready, can } = useAuth();
  const params = useSearchParams();
  const daUrl = params.get('aba');

  /*
   * A aba de gente some para quem não administra gente. O redirect antigo de
   * `/usuarios` aponta para `?aba=pessoas`: quem chegar por ele sem a permissão
   * cai na escada, em vez de olhar uma aba que só sabe devolver 403.
   */
  const abas = ABAS.filter((a) => !a.exige || can(a.exige));
  const inicial: AbaChave = ehAba(daUrl) && abas.some((a) => a.chave === daUrl) ? daUrl : 'escada';

  const [aba, setAba] = useState<AbaChave>(inicial);
  const [painel, setPainel] = useState<PainelDaRegua | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !token) return;
    apiGet<PainelDaRegua>('/policy/regua', token)
      .then((p) => {
        setPainel(p);
        setErro(null);
      })
      .catch((e: Error) => setErro(e.message));
  }, [ready, token]);

  const trocar = (nova: AbaChave) => {
    setAba(nova);
    // `replaceState` e não `router.replace`: trocar de aba não é navegação e
    // não pode empilhar histórico nem refazer a busca do painel. O link
    // continua compartilhável, que é o que o redirect de /usuarios precisa.
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('aba', nova);
      window.history.replaceState(null, '', url.toString());
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-muted">
          A régua de risco R0–R5 desta empresa: o que cada degrau exige, o que faz um nível subir,
          quem alcança o quê, e o que a sua operação mudou na régua que herdou.
        </p>
        {painel && (
          <p className="mt-1 text-xs text-muted">
            política v{painel.politica.versao} de {painel.politica.atualizadoEm}
            {painel.politica.versaoDaEmpresa !== null
              ? ` · sobrescrita desta empresa na versão ${painel.politica.versaoDaEmpresa}`
              : ' · sem sobrescrita: esta empresa herda a régua da ROOT'}
          </p>
        )}
      </header>

      <nav className="flex flex-wrap gap-2" aria-label="Seções da régua">
        {abas.map((a) => (
          <button
            key={a.chave}
            onClick={() => trocar(a.chave)}
            aria-pressed={aba === a.chave}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              aba === a.chave
                ? 'border-brand-dim bg-brand/15 text-brand'
                : 'border-border text-muted hover:text-text'
            }`}
          >
            {a.rotulo}
          </button>
        ))}
      </nav>

      {erro && (
        <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">
          {erro}
        </div>
      )}

      {aba === 'pessoas' ? (
        <AbaPessoas />
      ) : !painel ? (
        <p className="text-sm text-muted">{erro ? 'Não foi possível carregar a régua.' : 'Carregando a régua…'}</p>
      ) : aba === 'escada' ? (
        <AbaEscada painel={painel} />
      ) : aba === 'sinais' ? (
        <AbaSinais painel={painel} />
      ) : aba === 'capacidades' ? (
        <AbaCapacidades painel={painel} />
      ) : aba === 'sobrescritas' ? (
        <AbaSobrescritas painel={painel} />
      ) : (
        <AbaSimulador painel={painel} token={token} />
      )}
    </div>
  );
}
