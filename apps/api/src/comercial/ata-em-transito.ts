/*
 * A ATA EM TRÂNSITO (lane E, 13/10/2026).
 *
 * A transcrição bruta da sessão NÃO é gravada, como no onboarding: o fio guarda
 * só o hash (`ata.chegou`). Só que o leitor de ata é uma REAÇÃO a `ata.chegou`,
 * e a reação precisa do texto. O texto fica aqui, na memória do processo, preso
 * a `(empresa, lead, hash)`, pelo tempo de a reação rodar: quem grava a ata põe
 * (`guardarAtaEmTransito`, em `FichaService.registrarAta`, antes de gravar o
 * fato) e a reação tira (`tirarAtaEmTransito`), apagando. Sobra que ninguém
 * tirou vence em `PRAZO_MS`.
 *
 * Processo que cai entre gravar e reagir perde o texto, e a reação registra
 * `sem_texto` em vez de errar: refazer é subir a ata de novo pela rota de
 * diagnóstico (`POST /comercial/lead/:id/diagnostico/gerar`). Gravar a
 * transcrição para não perder esse caso seria trocar a regra da casa por
 * conveniência.
 */

const PRAZO_MS = 15 * 60_000;
const MAXIMO = 200;

const emTransito = new Map<string, { texto: string; ate: number }>();

function chave(orgId: string, leadId: string, hash: string): string {
  return `${orgId}\0${leadId}\0${hash}`;
}

function varrer(agora: number): void {
  for (const [k, v] of emTransito) if (v.ate <= agora) emTransito.delete(k);
  while (emTransito.size > MAXIMO) {
    const primeira = emTransito.keys().next().value;
    if (primeira === undefined) break;
    emTransito.delete(primeira);
  }
}

export function guardarAtaEmTransito(orgId: string, leadId: string, hash: string, texto: string): void {
  const agora = Date.now();
  varrer(agora);
  emTransito.set(chave(orgId, leadId, hash), { texto, ate: agora + PRAZO_MS });
}

/** Tira (e apaga) o texto da ata. `null` quando ele não está mais aqui. */
export function tirarAtaEmTransito(orgId: string, leadId: string, hash: string): string | null {
  const k = chave(orgId, leadId, hash);
  const v = emTransito.get(k);
  emTransito.delete(k);
  if (!v || v.ate <= Date.now()) return null;
  return v.texto;
}
