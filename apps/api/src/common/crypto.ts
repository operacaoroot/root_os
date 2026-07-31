import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Segredos em repouso (tokens OAuth, credenciais de app). AES-256-GCM: além de
 * cifrar, o GCM autentica — valor adulterado no banco falha na abertura em vez
 * de virar lixo silencioso.
 */
function chave(): Buffer {
  const bruta = process.env.ENCRYPTION_KEY;
  if (!bruta) throw new Error('ENCRYPTION_KEY ausente');
  const buf = Buffer.from(bruta, 'base64');
  if (buf.length !== 32) throw new Error('ENCRYPTION_KEY precisa ter 32 bytes em base64');
  return buf;
}

export function temChaveDeCriptografia(): boolean {
  try {
    chave();
    return true;
  } catch {
    return false;
  }
}

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chave(), iv);
  const dados = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  // iv.tag.dados — tudo junto, pra não precisar de coluna extra
  return `${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${dados.toString('base64')}`;
}

export function decifrar(pacote: string): string {
  const [iv, tag, dados] = pacote.split('.');
  if (!iv || !tag || !dados) throw new Error('pacote cifrado malformado');
  const d = createDecipheriv('aes-256-gcm', chave(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(dados, 'base64')), d.final()]).toString('utf8');
}
