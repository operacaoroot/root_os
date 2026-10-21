/*
 * O WHATSAPP DE CADA PESSOA DA EQUIPE (rodada dos agentes, 21/10/2026, A7 · CA-02)
 *
 * O canal de aprovação pelo WhatsApp (fatia 5.5) só reconhece quem tem uma
 * identidade cadastrada em `ChannelIdentity` (canal `whatsapp`). Até aqui não
 * havia tela para cadastrá-la: o vínculo só nascia escrevendo no banco. A Equipe
 * passa a cadastrar, e esta é a regra do número, a mesma na tela e na API.
 *
 * FORMA GRAVADA: só os dígitos, com o DDI (`5532999998888`), que é a forma
 * canônica que o canal procura (`identidade-de-canal.ts`, `formasDaChave`).
 *
 * O NONO DÍGITO NÃO É MEXIDO. O canal casa por IGUALDADE e não normaliza o 9 de
 * propósito (dois números diferentes colidiriam). Então a regra aceita as duas
 * formas de celular (com o 9: 9 dígitos começando por 9; sem: 8 dígitos) e grava
 * EXATAMENTE a que a pessoa digitou. Quem cadastrou na forma errada não aprova
 * nada pelo canal (falha fechada), e a tela diz para cadastrar como o WhatsApp
 * mostra o número.
 *
 * O ÚNICO ACRÉSCIMO é o DDI 55 quando a pessoa digita só DDD + número (10 ou 11
 * dígitos): o país é fixo, e o 55 não muda de quem é o número.
 */

/** Os DDDs válidos do Brasil (Anatel). */
export const DDDS_DO_BRASIL: readonly number[] = [
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
];

export type LeituraDoWhatsapp =
  | { ok: true; digitos: string; formatado: string }
  | { ok: false; motivo: string };

/**
 * Lê o número digitado (com ou sem `+`, espaço, parêntese, hífen) e devolve a
 * forma gravada, ou o motivo da recusa em português.
 */
export function lerWhatsappBr(entrada: unknown): LeituraDoWhatsapp {
  if (typeof entrada !== 'string' || !entrada.trim()) return { ok: false, motivo: 'Informe o número com DDD.' };
  const cru = entrada.trim();
  if (!/^\+?[\d\s().-]+$/.test(cru)) return { ok: false, motivo: 'Use só números (pode ter +, espaço, parêntese e hífen).' };
  let d = cru.replace(/\D/g, '');
  if (cru.startsWith('+') && !d.startsWith('55')) return { ok: false, motivo: 'Só número do Brasil (+55).' };
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!d.startsWith('55') || (d.length !== 12 && d.length !== 13)) {
    return { ok: false, motivo: 'Número do Brasil com DDD: +55, DDD e 8 ou 9 dígitos.' };
  }
  const ddd = Number(d.slice(2, 4));
  if (!DDDS_DO_BRASIL.includes(ddd)) return { ok: false, motivo: `DDD ${d.slice(2, 4)} não existe.` };
  const local = d.slice(4);
  if (local.length === 9 && local[0] !== '9') return { ok: false, motivo: 'Celular com 9 dígitos começa por 9.' };
  if (local.length === 8 && !/^[2-9]/.test(local)) return { ok: false, motivo: 'Número local inválido.' };
  return { ok: true, digitos: d, formatado: formatarWhatsappBr(d) };
}

/** `5532999998888` → `+55 (32) 99999-8888`. Fora da forma, devolve como veio. */
export function formatarWhatsappBr(digitos: string): string {
  if (!/^55\d{10,11}$/.test(digitos)) return digitos;
  const ddd = digitos.slice(2, 4);
  const local = digitos.slice(4);
  const meio = local.length === 9 ? 5 : 4;
  return `+55 (${ddd}) ${local.slice(0, meio)}-${local.slice(meio)}`;
}

/** Só o final, para quem não é a pessoa nem administra gente: `…8888`. */
export function finalDoWhatsapp(digitos: string): string {
  return `…${digitos.slice(-4)}`;
}
