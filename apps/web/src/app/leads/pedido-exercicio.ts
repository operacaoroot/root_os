export async function pedidoDeExercicio(chave: string, payload: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
  const fingerprint = Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2,'0')).join('');
  try {
    const salvo = JSON.parse(localStorage.getItem(chave) ?? 'null') as { fingerprint?: string; requestId?: string } | null;
    if (salvo?.fingerprint === fingerprint && /^[a-f0-9-]{36}$/i.test(salvo.requestId ?? '')) return salvo!.requestId!;
  } catch { /* Um pedido inválido não é reutilizado. */ }
  const requestId = crypto.randomUUID();
  localStorage.setItem(chave,JSON.stringify({ fingerprint,requestId }));
  return requestId;
}
