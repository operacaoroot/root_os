export const DIAS_DA_COLETA = [
  'Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira',
  'Quinta-feira', 'Sexta-feira', 'Sábado',
];

export function cronSemanal(dia: string, horario: string): string | null {
  if (!/^[0-6]$/.test(dia) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(horario)) return null;
  const [hora, minuto] = horario.split(':').map(Number);
  return `${minuto} ${hora} * * ${dia}`;
}

/** Só converte expressões semanais que o formulário representa sem perda. */
export function horarioSemanal(cron: string): { dia: string; horario: string } | null {
  const campos = cron.trim().split(/\s+/);
  if (campos.length !== 5) return null;
  const [minuto, hora, diaDoMes, mes, dia] = campos;
  if (!/^\d{1,2}$/.test(minuto) || +minuto > 59 || !/^\d{1,2}$/.test(hora) || +hora > 23 ||
    diaDoMes !== '*' || mes !== '*' || !/^[0-6]$/.test(dia)) return null;
  return { dia, horario: `${hora.padStart(2, '0')}:${minuto.padStart(2, '0')}` };
}
