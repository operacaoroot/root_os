export default function Carregando() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-16" aria-busy="true" aria-label="Carregando">
      <div className="mx-auto mb-10 h-8 w-64 animate-pulse bg-central-painel" />
      <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i}>
            <div className="aspect-[4/5] animate-pulse border border-central-linha bg-central-painel" />
            <div className="mt-3 h-4 w-3/4 animate-pulse bg-central-painel" />
            <div className="mt-2 h-3 w-full animate-pulse bg-central-painel" />
          </div>
        ))}
      </div>
    </main>
  );
}
