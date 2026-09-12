'use client';

import type { PainelDaRegua } from './tipos';
import { Cartao, Etiqueta, Selo } from './ui';

/*
 * OS SEIS DEGRAUS E O QUE CADA UM EXIGE.
 *
 * Tudo abaixo chega pronto de `GET /api/policy/regua`, já com as sobrescritas
 * desta empresa aplicadas: os nomes, o que cada nível escreve, o bloco de
 * aprovação, a alçada mínima e a lista do que o rastro guarda. Nenhuma linha
 * desta tela conhece a escada — quem a conhece é `packages/policy/src/escada.ts`,
 * do outro lado.
 */
export function AbaEscada({ painel }: { painel: PainelDaRegua }) {
  return (
    <div className="space-y-5">
      <Cartao
        titulo="A escada de risco desta empresa"
        aviso={`${painel.politica.descricao} · versão ${painel.politica.versao} de ${painel.politica.atualizadoEm} · origem: ${painel.politica.origem}`}
      >
        <p className="text-sm text-muted">
          O nível de uma ação é o gatilho mais alto que ela aciona, nunca a média. Quanto mais alto
          o degrau, mais o sistema exige de quem manda a ação acontecer.
        </p>
      </Cartao>

      <div className="space-y-3">
        {painel.niveis.map((n) => (
          <section key={n.nivel} className="rounded-xl border border-border bg-surface p-5">
            <header className="flex flex-wrap items-center gap-2">
              <Selo nivel={n.nivel} grande />
              <h3 className="text-sm font-medium">{n.nome}</h3>
              {n.escreve ? (
                <Etiqueta>escreve fora do OS</Etiqueta>
              ) : (
                <Etiqueta>não escreve fora do OS</Etiqueta>
              )}
              {n.bloqueado && (
                <span className="rounded bg-bad/15 px-1.5 py-0.5 text-[10px] text-bad">
                  o OS nunca executa
                </span>
              )}
            </header>

            <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
              <div>
                <dt className="text-xs uppercase text-muted">Aprovação</dt>
                <dd className="mt-1">
                  {n.aprovacao.exigida === 'nunca' && 'não exige aprovação de ninguém'}
                  {n.aprovacao.exigida === 'configuravel' &&
                    'configurável por cliente — ligada, passa pela fila'}
                  {n.aprovacao.exigida === 'sempre' && 'sempre, antes de agir'}
                  {n.aprovacao.exigida !== 'nunca' && (
                    <span className="block text-xs text-muted">
                      alçada mínima {n.aprovacao.alcadaMinima} ·{' '}
                      {n.aprovacao.vinculo === 'conteudo'
                        ? 'presa ao conteúdo exato'
                        : 'sem vínculo com o conteúdo'}{' '}
                      · {n.aprovacao.usoUnico ? 'uso único' : 'reutilizável'} · vale{' '}
                      {n.aprovacao.validadeSegundos}s
                    </span>
                  )}
                </dd>
              </div>

              <div>
                <dt className="text-xs uppercase text-muted">Também exige</dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {n.exigeReautenticacao && <Etiqueta>reautenticação de quem aprova</Etiqueta>}
                  {n.exigeMotivo && <Etiqueta>motivo escrito</Etiqueta>}
                  {!n.exigeReautenticacao && !n.exigeMotivo && (
                    <span className="text-xs text-muted">nada além do registro</span>
                  )}
                </dd>
              </div>

              <div className="md:col-span-2">
                <dt className="text-xs uppercase text-muted">O rastro guarda</dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {n.rastro.length ? (
                    n.rastro.map((r) => <Etiqueta key={r}>{r}</Etiqueta>)
                  ) : (
                    <span className="text-xs text-muted">—</span>
                  )}
                </dd>
              </div>
            </dl>
          </section>
        ))}
      </div>

      <Cartao titulo="Invariantes" aviso="Valem em todos os degraus, sem exceção.">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          {painel.invariantes.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      </Cartao>
    </div>
  );
}
