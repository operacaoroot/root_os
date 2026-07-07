const MAP: Record<string, string> = {
  novo: 'bg-brand/15 text-brand',
  qualificado: 'bg-brand/15 text-brand',
  oportunidade: 'bg-warn/15 text-warn',
  reuniao: 'bg-warn/15 text-warn',
  proposta: 'bg-warn/15 text-warn',
  ganho: 'bg-good/15 text-good',
  perdido: 'bg-bad/15 text-bad',
};

export function StatusChip({ status }: { status: string }) {
  const cls = MAP[status] ?? 'bg-surface-2 text-muted';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${cls}`}>
      {status}
    </span>
  );
}
