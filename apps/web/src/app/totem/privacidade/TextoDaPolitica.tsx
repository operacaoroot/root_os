import type { TotemPolitica } from '@mktos/shared';

/**
 * O texto da política, igual na página `/totem/privacidade` e na janela que o
 * cadastro do quiosque abre por cima do formulário. Herda a cor do texto de
 * quem o mostra; `grande` é a letra do quiosque, lido em pé a meio metro.
 */
export function TextoDaPolitica({ politica, grande = false }: { politica: TotemPolitica; grande?: boolean }) {
  const corpo = grande ? 'text-lg leading-relaxed' : 'text-base leading-relaxed';
  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <h1 className={grande ? 'text-3xl font-semibold' : 'text-2xl font-semibold'}>{politica.titulo}</h1>
        <p className="text-sm opacity-70">
          Versão {politica.versao}, publicada em {politica.publicadaEm}.
        </p>
        <p className={corpo}>{politica.abertura}</p>
      </header>
      {politica.secoes.map((s) => (
        <section key={s.titulo} className="space-y-2">
          <h2 className={grande ? 'text-2xl font-semibold' : 'text-lg font-semibold'}>{s.titulo}</h2>
          {s.paragrafos.map((p) => (
            <p key={p} className={corpo}>
              {p}
            </p>
          ))}
        </section>
      ))}
    </article>
  );
}
