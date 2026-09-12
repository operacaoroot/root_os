/*
 * O SINAL DE "O AGENDADOR DE ROTINAS ESTÁ DE PÉ".
 *
 * Um módulo minúsculo, e não um provider do Nest, de propósito: quem PERGUNTA é
 * o que sobrou do agendador antigo (`src/pauta/scheduler.service.ts`), que vive
 * no `PautaModule`. Um provider obrigaria o `PautaModule` a importar o
 * `RoutinesModule` — e o `RoutinesModule` importa o `PautaModule` para alcançar
 * o `RodadaService`. Seria um ciclo de módulos por causa de um booleano.
 *
 * POR QUE O SINAL EXISTE. O agendamento da pauta MUDOU DE DONO nesta fatia. Se
 * o `RoutinesModule` não estiver registrado em `app.module.ts`, o tique novo não
 * existe e o antigo já não existe mais — e a rotina da pauta simplesmente pararia
 * de disparar, sem erro, sem log e sem tela mudando de cor. O que resta do
 * agendador antigo confere este sinal no `onApplicationBootstrap` e GRITA quando
 * ele está apagado. Barulho no arranque é a única coisa que separa "mudou de
 * dono" de "sumiu".
 */

let dePe = false;
let desde: Date | null = null;

/** Chamado pelo agendador de rotinas quando ele assume o tique. */
export function anunciarAgendadorDeRotinas(): void {
  dePe = true;
  desde = new Date();
}

/** O agendador de rotinas assumiu o tique neste processo? */
export function agendadorDeRotinasDePe(): boolean {
  return dePe;
}

export function agendadorDeRotinasDesde(): Date | null {
  return desde;
}

/** Só para a suíte: devolve o processo ao estado de antes do arranque. */
export function esquecerAgendadorDeRotinas(): void {
  dePe = false;
  desde = null;
}
