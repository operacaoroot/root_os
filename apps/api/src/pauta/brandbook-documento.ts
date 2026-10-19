import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { BrandbookDocumentoSchema, lerPilaresDoTexto, type BrandbookDocumento } from '@mktos/shared';
import { perfilParaPrompt } from './marca-da-pauta';

export const hashDoBrandbook = (d: BrandbookDocumento): string => createHash('sha256').update(JSON.stringify(d)).digest('hex');
const papel = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const normalizarHex = (v: string) => v.length === 4 ? '#' + [...v.slice(1).toLowerCase()].map((c) => c + c).join('') : v.toLowerCase();
const luminancia = (hex: string) => {
  const h = normalizarHex(hex).slice(1);
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
};

export function conferirLogo(dataUrl: string | null): void {
  if (!dataUrl) return;
  if (dataUrl.length > 24 * 1024) throw new BadRequestException('Use logo PNG, JPG ou WebP de até 24 KB.');
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!m) throw new BadRequestException('Use logo PNG, JPG ou WebP de até 24 KB.');
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.toString('base64') !== m[2]) throw new BadRequestException('O logo não tem base64 válido.');
  const png = bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.subarray(12, 16).equals(Buffer.from('IHDR')) && bytes.subarray(bytes.length - 8, bytes.length - 4).equals(Buffer.from('IEND'));
  const jpeg = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217;
  const webp = bytes.length >= 20 && bytes.subarray(0, 4).equals(Buffer.from('RIFF')) && bytes.subarray(8, 12).equals(Buffer.from('WEBP')) && bytes.readUInt32LE(4) + 8 === bytes.length;
  if (!(m[1] === 'png' ? png : m[1] === 'jpeg' ? jpeg : webp)) throw new BadRequestException('Os bytes do logo não correspondem ao formato declarado.');
}

export function conferirUrlDaMarca(valor: string): URL {
  let u: URL;
  try { u = new URL(valor); } catch { throw new BadRequestException('Informe um endereço http ou https válido.'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.hash || (u.port && u.port !== (u.protocol === 'https:' ? '443' : '80'))) {
    throw new BadRequestException('Use uma página http ou https sem credenciais, fragmento ou porta alternativa.');
  }
  for (const chave of u.searchParams.keys()) {
    if (/^(?:token|access_token|id_token|refresh_token|api_key|apikey|key|secret|client_secret|auth_token|auth|authorization|password|senha|code|signature|sig|credential|x-amz-.*)$/i.test(chave)) {
      throw new BadRequestException('Não use links com tokens, credenciais ou assinaturas.');
    }
  }
  return u;
}

export function validarDocumento(valor: unknown): BrandbookDocumento {
  const documento = BrandbookDocumentoSchema.parse(valor);
  conferirLogo(documento.visual.logoDataUrl);
  if (documento.origem.url) conferirUrlDaMarca(documento.origem.url);
  return documento;
}

export function pendenciasDaMarca(d: BrandbookDocumento): string[] {
  const pendencias: string[] = [];
  if (!d.identidade.nome || !d.identidade.descricao) pendencias.push('Preencha nome e descrição da identidade.');
  const perguntas: Array<[keyof BrandbookDocumento['respostas'], string]> = [
    ['posicionamento', 'posicionamento'], ['clienteIdeal', 'cliente ideal'], ['dor', 'dor'], ['desejo', 'desejo'],
    ['diferencialPromessa', 'diferencial e promessa'], ['tomDeVoz', 'tom de voz'], ['corPrimaria', 'cor primária'],
  ];
  for (const [key, rotulo] of perguntas) if (!d.respostas[key]) pendencias.push(`Responda: ${rotulo}.`);
  const cores = (aliases: string[]) => d.visual.cores.filter((c) => aliases.includes(papel(c.papel)) && c.hex);
  const primaria = cores(['primaria', 'primary', 'principal']);
  const fundo = cores(['fundo', 'background']);
  const texto = cores(['texto', 'text']);
  if (primaria.length !== 1 || fundo.length !== 1 || texto.length !== 1) pendencias.push('Defina exatamente uma cor primária, uma de fundo e uma de texto.');
  if (primaria.length === 1 && d.respostas.corPrimaria && normalizarHex(primaria[0].hex) !== normalizarHex(d.respostas.corPrimaria)) pendencias.push('A cor primária da resposta deve coincidir com a paleta.');
  if (fundo.length === 1 && texto.length === 1) {
    const a = luminancia(fundo[0].hex), b = luminancia(texto[0].hex);
    if ((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) < 4.5) pendencias.push('O texto e o fundo precisam de contraste mínimo de 4,5:1.');
  }
  const fontes = d.visual.fontes.filter((f) => f.familia);
  if (!fontes.some((f) => ['titulo', 'heading'].includes(papel(f.papel))) || !fontes.some((f) => ['corpo', 'body'].includes(papel(f.papel)))) pendencias.push('Defina fontes de título e corpo.');
  const perfil = perfilParaPrompt(d.perfilParaPauta);
  if (perfil.length < 80 || perfil.length > 4000) pendencias.push('Revise o perfil para a Pauta: entre 80 e 4.000 caracteres após a neutralização.');
  if (d.pilares.some((p) => !p.nome || !p.cor || /[|\r\n]/.test(p.nome))) pendencias.push('Cada pilar precisa de nome em uma linha e cor declarada.');
  const lidos = lerPilaresDoTexto(textoDosPilares(d));
  if (lidos.avisos.length || lidos.pilares.length !== d.pilares.length) pendencias.push('Revise os pilares: nomes válidos e únicos, sem linhas descartadas.');
  return pendencias;
}

export const textoDosPilares = (d: BrandbookDocumento): string => d.pilares.map((p) => `${p.nome} | ${p.cor} | ${p.descricao.replace(/\s+/g, ' ')}`).join('\n');
