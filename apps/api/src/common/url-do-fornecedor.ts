/**
 * O endereço de um fornecedor sobrescrito por ambiente (o dublê local) só vale
 * em https, ou em http na própria máquina (loopback): o token, o código do
 * OAuth e o segredo do app iriam em claro pela rede. Vazio vale o padrão de
 * produção. Inválido lança no USO, e não no boot, para o erro dizer qual
 * chamada ficou sem destino.
 */
export function urlSeguraDoFornecedor(valor: string | undefined, padrao: string, fornecedor: string): string {
  const v = (valor ?? '').trim().replace(/\/+$/, '');
  if (!v) return padrao.replace(/\/+$/, '');
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new Error(`URL ${fornecedor} inválida: "${v}".`);
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const loopback = host === 'localhost' || host === '::1' || /^127\./.test(host);
  if (u.protocol === 'https:' || (u.protocol === 'http:' && loopback)) return v;
  throw new Error(`URL ${fornecedor} "${v}" é http fora desta máquina: o token iria em claro. Use https://.`);
}
