// Cron de 5 campos avaliado em um fuso, sem dependência.
//
// Por que não `@nestjs/schedule`: as rotinas são editáveis pela tela, e registrar
// /desregistrar CronJob a cada edição vira contabilidade de estado. Aqui o
// agendador só pergunta a cada minuto "qual rotina bate agora?" — editar uma
// rotina passa a valer no minuto seguinte sem nenhum re-registro.
//
// Suporta: * · listas (1,3,5) · faixas (1-5) · passos (*/15, 1-9/2).
// Domingo é 0 e 7 (ambos), como no cron do Unix.

export interface CampoCron {
  min: Set<number>;
  hora: Set<number>;
  dia: Set<number>;
  mes: Set<number>;
  diaSemana: Set<number>;
  // "*" nos campos de dia importa: com os dois preenchidos o cron do Unix usa OU.
  diaCurringa: boolean;
  diaSemanaCurringa: boolean;
}

const LIMITES: Array<[number, number]> = [
  [0, 59], // minuto
  [0, 23], // hora
  [1, 31], // dia do mês
  [1, 12], // mês
  [0, 7], // dia da semana (0 e 7 = domingo)
];

function parseCampo(campo: string, [min, max]: [number, number]): Set<number> {
  const valores = new Set<number>();
  for (const parte of campo.split(',')) {
    const [faixa, passoCru] = parte.split('/');
    const passo = passoCru ? Number(passoCru) : 1;
    if (!Number.isInteger(passo) || passo < 1) throw new Error(`passo inválido em "${parte}"`);

    let ini: number;
    let fim: number;
    if (faixa === '*') {
      ini = min;
      fim = max;
    } else if (faixa.includes('-')) {
      const [a, b] = faixa.split('-').map(Number);
      ini = a;
      fim = b;
    } else {
      ini = Number(faixa);
      fim = Number(faixa);
    }
    if (!Number.isInteger(ini) || !Number.isInteger(fim) || ini < min || fim > max || ini > fim) {
      throw new Error(`valor fora da faixa em "${parte}" (esperado ${min}-${max})`);
    }
    for (let v = ini; v <= fim; v += passo) valores.add(v);
  }
  return valores;
}

export function parseCron(expr: string): CampoCron {
  const campos = expr.trim().split(/\s+/);
  if (campos.length !== 5) {
    throw new Error(`cron precisa de 5 campos (min hora dia mês diaDaSemana), veio ${campos.length}`);
  }
  const [min, hora, dia, mes, diaSemana] = campos.map((c, i) => parseCampo(c, LIMITES[i]));
  // domingo aceito como 0 ou 7
  if (diaSemana.has(7)) diaSemana.add(0);
  return {
    min,
    hora,
    dia,
    mes,
    diaSemana,
    diaCurringa: campos[2] === '*',
    diaSemanaCurringa: campos[4] === '*',
  };
}

/** Partes do instante `d` no fuso `tz` (sem depender do fuso do processo). */
export function partesNoFuso(d: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  const semana: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    min: Number(p.minute),
    hora: Number(p.hour),
    dia: Number(p.day),
    mes: Number(p.month),
    diaSemana: semana[p.weekday as string] ?? 0,
  };
}

export function combina(c: CampoCron, d: Date, tz: string): boolean {
  const p = partesNoFuso(d, tz);
  if (!c.min.has(p.min) || !c.hora.has(p.hora) || !c.mes.has(p.mes)) return false;
  // Regra do Unix: se os dois campos de dia são específicos, basta um bater.
  const bateDia = c.dia.has(p.dia);
  const bateSemana = c.diaSemana.has(p.diaSemana);
  if (c.diaCurringa && c.diaSemanaCurringa) return true;
  if (c.diaCurringa) return bateSemana;
  if (c.diaSemanaCurringa) return bateDia;
  return bateDia || bateSemana;
}

/** Próxima ocorrência depois de `desde`. Null se nada bater em ~1 ano. */
export function proximaOcorrencia(expr: string, tz: string, desde: Date): Date | null {
  const c = parseCron(expr);
  // começa no minuto seguinte, zerando segundos
  const d = new Date(desde.getTime() + 60_000);
  d.setSeconds(0, 0);
  const limite = 366 * 24 * 60;
  for (let i = 0; i < limite; i++) {
    if (combina(c, d, tz)) return new Date(d);
    d.setTime(d.getTime() + 60_000);
  }
  return null;
}

/** Valida sem lançar — para a tela dizer o que está errado antes de salvar. */
export function validarCron(expr: string): { ok: true } | { ok: false; erro: string } {
  try {
    parseCron(expr);
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
  }
}
