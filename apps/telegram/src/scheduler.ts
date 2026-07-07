// Agendador diário simples e in-process (sem dep). Calcula o tempo até o próximo
// HH:MM num fuso e reagenda a cada disparo. Suficiente enquanto o bot roda como
// processo único; para 24/7 de verdade, containerizar (ou usar cron do sistema).

/** ms até a próxima ocorrência de `time` ("HH:MM") no fuso `tz`. */
export function msUntilNext(time: string, tz: string, now: Date = new Date()): number {
  const [hh, mm] = time.split(':').map((n) => parseInt(n, 10));
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  const val = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const nowSec = val('hour') * 3600 + val('minute') * 60 + val('second');
  const targetSec = hh * 3600 + mm * 60;
  let delta = targetSec - nowSec;
  if (delta <= 0) delta += 86400; // já passou hoje → amanhã
  return delta * 1000;
}

export function scheduleDaily(opts: {
  time: string;
  tz: string;
  onFire: () => Promise<void>;
  log?: (m: string) => void;
}): void {
  const arm = () => {
    const ms = msUntilNext(opts.time, opts.tz);
    opts.log?.(`próximo resumo em ~${Math.round(ms / 60000)} min (${opts.time} ${opts.tz})`);
    setTimeout(async () => {
      try {
        await opts.onFire();
      } catch (e) {
        console.error('[scheduler] erro ao disparar:', e);
      }
      arm(); // reagenda p/ o próximo dia
    }, ms);
  };
  arm();
}
