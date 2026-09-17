/*
 * Horas e idade de cartão — a esteira de clientes do quadro de Trabalho.
 *
 * Moram aqui, e não em `app/trabalho/page.tsx`, porque página do App Router só
 * pode exportar o componente padrão: função exportada de lá derruba o `build`.
 */

/** 90 → "1h30", 45 → "45min", 120 → "2h". */
export function formatarHoras(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

/**
 * "1,5", "1.5" e "1:30" → 90 minutos. `null` para o que não é hora válida
 * (vazio, zero, negativo, mais de 24h). A API só aceita minutos inteiros, então
 * a conversão acontece aqui, arredondando para o minuto.
 */
export function minutosDeTexto(texto: string): number | null {
  const t = texto.trim();
  if (!t) return null;
  let minutos: number;
  const hm = /^(\d{1,2}):([0-5]\d)$/.exec(t);
  if (hm) {
    minutos = Number(hm[1]) * 60 + Number(hm[2]);
  } else {
    const n = Number(t.replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    minutos = Math.round(n * 60);
  }
  return minutos >= 1 && minutos <= 1440 ? minutos : null;
}

/**
 * Dias inteiros desde `iso` — a idade do cartão na etapa. `null` quando a data
 * não existe (tarefa anterior à esteira): a tela não mostra idade inventada.
 */
export function diasDesde(iso: string | null | undefined, agora: Date = new Date()): number | null {
  if (!iso) return null;
  const ms = agora.getTime() - new Date(iso).getTime();
  return ms < 0 ? 0 : Math.floor(ms / 86_400_000);
}

/** Hoje em Brasília (AAAA-MM-DD) — o mesmo dia que a API usa como padrão. */
export function hojeEmBrasilia(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(agora);
}
