/*
 * Estado do lead na escala de estado do ROOT OS — quatro valores e só quatro.
 * O acento (limão) é a cor da INTERFACE: seleção, foco, botão primário. Se ele
 * também significasse "novo", a tela perderia a leitura de estado. Por isso
 * "novo" e "qualificado" são neutros: ainda não aconteceu nada com eles.
 *
 * O ponto antes do rótulo é de propósito — o estado tem que ler por forma
 * também, não só por cor (daltonismo, tema mono, impressão em preto e branco).
 */
type Escala = 'ok' | 'atencao' | 'erro' | 'neutro';

const MAP: Record<string, Escala> = {
  novo: 'neutro',
  qualificado: 'neutro',
  oportunidade: 'atencao',
  reuniao: 'atencao',
  proposta: 'atencao',
  ganho: 'ok',
  perdido: 'erro',
};

const CORES: Record<Escala, string> = {
  ok: 'bg-good/15 text-good',
  atencao: 'bg-warn/15 text-warn',
  erro: 'bg-bad/15 text-bad',
  neutro: 'bg-surface-3 text-muted',
};

export function StatusChip({ status }: { status: string }) {
  const cor = CORES[MAP[status] ?? 'neutro'];
  return (
    <span
      className={`inline-flex items-center gap-[5px] whitespace-nowrap rounded-root px-[6px] py-[2px] font-os-mono text-[10px] font-medium uppercase tracking-[0.1em] ${cor}`}
    >
      <span aria-hidden className="h-[5px] w-[5px] rounded-full bg-current" />
      {status}
    </span>
  );
}
