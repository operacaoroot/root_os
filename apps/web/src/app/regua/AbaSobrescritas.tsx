'use client';

import type { DiffDePolitica, PainelDaRegua, VersaoDaPolitica } from './tipos';
import { Cartao, Etiqueta, Vazio } from './ui';

/*
 * O QUE ESTA EMPRESA MUDOU NA RÉGUA HERDADA — RF-P-04 e RF-P-06.
 *
 * Cada versão traz data e responsável, que é o que o documento normativo cobra.
 * Responsável nulo é seed ou script, e a tela diz isso em vez de mostrar um id
 * cru que ninguém reconhece.
 *
 * OS DOIS DIFFS TÊM A REFERÊNCIA NO NOME, e isso não é preciosismo: uma queda
 * de R4 para R3 aparece como `sobe` contra a base (que é R2) e como `desce`
 * contra o que estava valendo para a empresa. Chamar qualquer um dos dois de
 * "o diff" faz quem lê entender a direção ao contrário.
 */
export function AbaSobrescritas({ painel }: { painel: PainelDaRegua }) {
  const { sobrescritas } = painel;

  return (
    <div className="space-y-5">
      <Cartao titulo="A trava do rebaixamento" aviso={sobrescritas.trava.regra}>
        <p className="text-sm text-muted">
          O motivo escrito precisa ter pelo menos {sobrescritas.trava.minimoDoMotivo} caracteres. A
          sobrescrita que afrouxa e não vem assinada é recusada inteira — não pela metade.
        </p>
      </Cartao>

      {sobrescritas.herdaTudo ? (
        <Cartao titulo="Esta empresa herda a régua da ROOT">
          <Vazio>
            Nenhuma sobrescrita registrada: cada mudança na política da ROOT chega aqui sozinha.
          </Vazio>
        </Cartao>
      ) : (
        <Cartao
          titulo={`Em vigor: versão ${sobrescritas.emVigor?.versao}`}
          aviso={carimbo(sobrescritas.emVigor)}
        >
          <p className="text-sm">{sobrescritas.emVigor?.motivo}</p>
          <div className="mt-4">
            <Diff
              titulo="O que difere da base herdada da ROOT"
              diff={sobrescritas.emVigor?.diffDaBase ?? null}
            />
          </div>
        </Cartao>
      )}

      {sobrescritas.historico.length > 0 && (
        <Cartao titulo="Histórico" aviso="Da mais nova para a mais antiga. Nada é sobrescrito.">
          <div className="space-y-4">
            {sobrescritas.historico.map((v) => (
              <article key={v.versao} className="border-b border-border pb-4 last:border-0 last:pb-0">
                <header className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-medium">v{v.versao}</span>
                  {v.emVigor && (
                    <span className="rounded bg-good/15 px-1.5 py-0.5 text-[10px] text-good">
                      em vigor
                    </span>
                  )}
                  <span className="text-xs text-muted">{carimbo(v)}</span>
                </header>
                <p className="mt-1 text-sm">{v.motivo}</p>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <Diff titulo="contra a base da ROOT" diff={v.diffDaBase} compacto />
                  <Diff titulo="contra a versão anterior" diff={v.diffDaVersaoAnterior} compacto />
                </div>
              </article>
            ))}
          </div>
        </Cartao>
      )}
    </div>
  );
}

function carimbo(v: VersaoDaPolitica | null | undefined): string {
  if (!v) return '';
  const quando = new Date(v.ativaDe).toLocaleString('pt-BR');
  const quem = v.responsavel
    ? v.responsavel.nome
    : 'sem responsável identificado (seed ou script)';
  const ate = v.ativaAte ? ` · encerrada em ${new Date(v.ativaAte).toLocaleString('pt-BR')}` : '';
  return `${quando} · por ${quem}${ate}`;
}

function Diff({
  titulo,
  diff,
  compacto = false,
}: {
  titulo: string;
  diff: DiffDePolitica | null;
  compacto?: boolean;
}) {
  if (!diff) {
    return (
      <div>
        <div className="text-xs uppercase text-muted">{titulo}</div>
        <p className="mt-1 text-xs text-muted">—</p>
      </div>
    );
  }

  const nada =
    diff.capacidades.length === 0 && diff.limites.length === 0 && diff.secoes.length === 0;

  return (
    <div>
      <div className="text-xs uppercase text-muted">{titulo}</div>
      {nada ? (
        <p className="mt-1 text-xs text-muted">nada mudou</p>
      ) : (
        <ul className={`mt-1 space-y-1 ${compacto ? 'text-[11px]' : 'text-xs'}`}>
          {diff.capacidades.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-1">
              <span className="font-mono">{c.id}</span>
              <Direcao d={c.direcao} afrouxa={c.afrouxa} />
              <span className="text-muted">
                {c.de ?? 'não classificada'} → {c.para}
              </span>
              {c.campos.filter((x) => x !== 'nivel' && x !== '(nova)').map((x) => (
                <Etiqueta key={x}>{x}</Etiqueta>
              ))}
            </li>
          ))}
          {diff.limites.map((l) => (
            <li key={l.campo} className="flex flex-wrap items-center gap-1">
              <span className="font-mono">limite {l.campo}</span>
              <Direcao d={l.direcao} afrouxa={l.afrouxa} />
              <span className="text-muted">
                {JSON.stringify(l.de)} → {JSON.stringify(l.para)}
              </span>
            </li>
          ))}
          {diff.secoes.map((s) => (
            <li key={s.secao} className="flex flex-wrap items-center gap-1">
              <span className="font-mono">{s.secao}</span>
              <Direcao d={s.direcao} afrouxa={s.afrouxa} />
              <span className="text-muted">{s.itens.join(' · ') || 'mudou'}</span>
            </li>
          ))}
        </ul>
      )}
      {diff.ilegivel && (
        <p className="mt-1 text-[11px] text-warn">
          este diff é de um formato que o servidor não sabe ler: tudo aparece como afrouxamento
          porque não dá para provar o contrário.
        </p>
      )}
    </div>
  );
}

/**
 * Afrouxar é o lado que exige assinatura. A TELA NÃO DECIDE QUAL É.
 *
 * `afrouxa` vem do servidor, de `afrouxamentosDoDiff()` — a mesma função que a
 * trava do RF-P-06 consome. Aqui havia a dedução `d === 'desce' || d === 'nova'
 * || d === 'afrouxa'`, e ela já estava errada: uma capacidade que mantém o
 * nível e DESLIGA a validação de argumentos afrouxa sem mudar de direção, e
 * saía pintada de verde. `direcao` continua no rótulo porque é o que descreve a
 * mudança; a cor é a consequência dela.
 */
function Direcao({ d, afrouxa }: { d: string; afrouxa: boolean }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] ${
        afrouxa ? 'bg-warn/15 text-warn' : 'bg-good/15 text-good'
      }`}
      title={afrouxa ? 'afrouxa: exige responsável e motivo escrito' : 'não afrouxa'}
    >
      {d}
    </span>
  );
}
