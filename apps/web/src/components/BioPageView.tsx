import type { BioPublicPage } from '@mktos/shared';

/**
 * Componente presentacional puro da página da bio. Usado pela rota pública
 * (/b/[handle]) e pela prévia dentro do painel — mesma renderização nos dois,
 * então o que o dono confere é exatamente o que o visitante vê.
 */
export function BioPageView({
  dados,
  previa = false,
  rascunho = false,
}: {
  dados: BioPublicPage;
  /** Desliga os links (o painel renderiza um retrato, não uma página navegável). */
  previa?: boolean;
  /** Só quando a página ainda NÃO está publicada — o aviso não vale para prévia de página no ar. */
  rascunho?: boolean;
}) {
  const { desafio } = dados;

  return (
    <main className="relative mx-auto max-w-[480px] px-6 pb-[12vh] pt-[10vh]">
      {rascunho && (
        <div className="mb-7 border border-bio-line bg-bio-primary/5 px-4 py-3 text-[13px] text-bio-soft">
          Prévia — esta página ainda não está publicada. Só você a enxerga.
        </div>
      )}

      <header className="mb-[34px] text-center">
        {dados.avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={dados.avatarUrl}
            alt=""
            width={84}
            height={84}
            className="mx-auto mb-[18px] h-[84px] w-[84px] rounded-full border-2 border-bio-primary object-cover"
          />
        )}
        <h1
          className="mb-2 text-[25px] font-extrabold leading-tight tracking-[-0.02em]"
          style={{ fontFamily: 'var(--fonte-mono), monospace' }}
        >
          {dados.titulo}
        </h1>
        {dados.subtitulo && (
          <p className="m-0 text-[15px] leading-[1.55] text-bio-soft">{dados.subtitulo}</p>
        )}
      </header>

      {desafio && (
        <section className="mb-[26px] rounded-[3px] border border-bio-line bg-bio-primary/5 px-5 py-[18px]">
          <p
            className="m-0 mb-3 text-[10.5px] tracking-[0.16em] text-bio-primary"
            style={{ fontFamily: 'var(--fonte-mono), monospace' }}
          >
            {desafio.diaAtual >= desafio.totalDias
              ? 'DESAFIO ENCERRADO'
              : `DIA ${desafio.diaAtual} DE ${desafio.totalDias}`}
          </p>

          <div
            className="mb-1 flex items-baseline gap-2"
            style={{ fontFamily: 'var(--fonte-mono), monospace' }}
          >
            <span className="text-[40px] font-extrabold leading-none tracking-[-0.03em]">
              {desafio.feitos}
            </span>
            <span className="text-[17px] text-bio-soft">/ {desafio.meta}</span>
          </div>

          <p className="m-0 mb-[14px] text-[13.5px] text-bio-soft">{desafio.titulo}</p>

          <div className="h-[5px] overflow-hidden rounded-[3px] bg-bio-text/10">
            <div
              className="h-full bg-bio-primary"
              style={{ width: `${Math.max(desafio.pctFeito, desafio.feitos > 0 ? 1.5 : 0)}%` }}
            />
          </div>

          {desafio.diaAtual < desafio.totalDias && (
            <p className="m-0 mt-3 text-[12px] leading-[1.5] text-bio-weak">
              {desafio.saldo >= 0 ? (
                <>
                  <span className="text-bio-primary">{desafio.saldo} adiantado</span> no ritmo
                </>
              ) : (
                <>
                  <span className="text-bio-accent">{Math.abs(desafio.saldo)} atrás</span> do ritmo
                </>
              )}
              {` · ${desafio.ritmoNecessario}/dia pra fechar`}
            </p>
          )}
        </section>
      )}

      {dados.links.length > 0 && (
        <nav className="grid gap-[11px]">
          {dados.links.map((link) => (
            <a
              key={link.id}
              // Sai pelo nosso domínio pra registrar o clique antes de redirecionar.
              href={previa ? '#' : `/api/bio/r/${link.id}`}
              rel="noopener noreferrer nofollow"
              target="_blank"
              className={`block rounded-[3px] border px-[18px] py-4 text-center text-[15px] font-semibold no-underline ${
                link.destaque
                  ? 'border-bio-primary bg-bio-primary text-bio-bg'
                  : 'border-bio-border bg-bio-text/[0.03] text-bio-text'
              }`}
            >
              {link.rotulo}
            </a>
          ))}
        </nav>
      )}

      <p
        className="mt-[46px] text-center text-[11px] tracking-[0.14em]"
        style={{ fontFamily: 'var(--fonte-mono), monospace' }}
      >
        <span className="text-bio-weak">root/bio</span>
      </p>
    </main>
  );
}
