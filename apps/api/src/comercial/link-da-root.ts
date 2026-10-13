import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/*
 * O LINK DE ASSINATURA DA ROOT, CIFRADO (conserto D-1 da revisão, 13/10/2026).
 *
 * O link que a ZapSign devolve para o signatário da Root ASSINA o contrato pela
 * empresa: quem o tiver obriga a Root. Ele não fica em claro em lugar nenhum:
 * `ComercialDocumento.linkRoot` guarda o link cifrado (AES-256-GCM, chave
 * derivada de `ENCRYPTION_KEY` com prefixo próprio, o id do documento como dado
 * associado: a cifra de uma linha não abre em outra), e só a rota
 * `POST /comercial/contratos/:leadId/assinar-pela-root` o decifra, para o
 * signatário cadastrado, titular relido no banco, depois da senha conferida.
 *
 * Sem chave no ambiente, o link não é guardado (o documento nasce com
 * `linkRoot` nulo e quem assina abre a ZapSign pelo e-mail de convite).
 */

const PREFIXO = 'v1.';

function chave(segredo: string): Buffer {
  return createHash('sha256').update(`comercial-assinatura-root:${segredo}`, 'utf8').digest();
}

export function cifrarLinkDaRoot(link: string, segredo: string, documentoId: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chave(segredo), iv);
  c.setAAD(Buffer.from(documentoId, 'utf8'));
  const corpo = Buffer.concat([c.update(link, 'utf8'), c.final()]);
  return `${PREFIXO}${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${corpo.toString('base64url')}`;
}

export function decifrarLinkDaRoot(cifrado: string, segredo: string, documentoId: string): string | null {
  try {
    const [v, iv, tag, corpo] = String(cifrado ?? '').split('.');
    if (`${v}.` !== PREFIXO || !iv || !tag || !corpo) return null;
    const d = createDecipheriv('aes-256-gcm', chave(segredo), Buffer.from(iv, 'base64url'));
    d.setAAD(Buffer.from(documentoId, 'utf8'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    const link = Buffer.concat([d.update(Buffer.from(corpo, 'base64url')), d.final()]).toString('utf8');
    return /^https?:\/\//.test(link) ? link : null;
  } catch {
    return null;
  }
}

/** O valor guardado já é a cifra (e não um link em claro de antes do conserto)? */
export function linkDaRootCifrado(valor: string | null | undefined): boolean {
  return typeof valor === 'string' && valor.startsWith(PREFIXO) && !/^https?:\/\//.test(valor);
}
