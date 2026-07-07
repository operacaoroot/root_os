// Parser OFX mínimo (sem dependência). OFX é SGML; extraímos os blocos
// <STMTTRN> do extrato bancário. Cobre os OFX de bancos brasileiros comuns.
// Um lançamento OFX vira um FinanceTransaction (dedup por FITID = externalId).

export interface OfxTransaction {
  externalId: string; // FITID
  date: Date; // DTPOSTED
  amount: number; // sempre positivo
  type: 'entrada' | 'saida'; // sinal do TRNAMT
  description: string; // MEMO || NAME || TRNTYPE
}

function tag(block: string, name: string): string | null {
  // OFX é SGML: tags podem não ter fechamento. Captura até a próxima tag ou fim de linha.
  const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i'));
  return m ? m[1].trim() : null;
}

// DTPOSTED: YYYYMMDD[HHMMSS][.xxx][tz] → Date (usa só a data).
function parseOfxDate(raw: string | null): Date | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return isNaN(dt.getTime()) ? null : dt;
}

export function parseOfx(content: string): OfxTransaction[] {
  const out: OfxTransaction[] = [];
  const blocks = content.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? [];
  let seq = 0;
  for (const block of blocks) {
    seq += 1;
    const amtRaw = tag(block, 'TRNAMT');
    if (amtRaw === null) continue;
    // Aceita "-123.45" e o formato pt-BR "-123,45".
    const value = Number(amtRaw.replace(/\s/g, '').replace(',', '.'));
    if (!isFinite(value) || value === 0) continue;
    const amount = Math.abs(value);
    const date = parseOfxDate(tag(block, 'DTPOSTED')) ?? new Date();
    const description = tag(block, 'MEMO') || tag(block, 'NAME') || tag(block, 'TRNTYPE') || 'Lançamento OFX';
    const fitid = tag(block, 'FITID');
    out.push({
      externalId: fitid || `ofx-${date.toISOString().slice(0, 10)}-${seq}-${Math.round(amount * 100)}`,
      date,
      amount,
      type: value < 0 ? 'saida' : 'entrada',
      description,
    });
  }
  return out;
}
