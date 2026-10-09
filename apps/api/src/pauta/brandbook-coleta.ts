import { BadRequestException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { BrandbookColeta } from '@mktos/shared';
import { conferirUrlDaMarca } from './brandbook-documento';

const TETO = 1024 * 1024;
const PRAZO = 10000;
const publica = (ip: string): boolean => {
  if (isIP(ip) !== 4) return false;
  const [a, b, c] = ip.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
};
async function resolver(host: string, prazo: number): Promise<string> {
  if (isIP(host)) {
    if (!publica(host)) throw new BadRequestException('O site deve usar um endereço IPv4 público.');
    return host;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const enderecos = await Promise.race([
      lookup(host, { all: true, family: 4, verbatim: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new BadRequestException('A resolução do site excedeu o prazo.')), Math.max(1, prazo)); }),
    ]);
    if (!enderecos.length || enderecos.some((e) => !publica(e.address))) throw new BadRequestException('O site deve resolver somente para IPv4 público.');
    return enderecos[0].address;
  } catch (e) {
    if (e instanceof BadRequestException) throw e;
    throw new BadRequestException('Não foi possível resolver o endereço público do site.');
  } finally { if (timer) clearTimeout(timer); }
}
function pedir(u: URL, address: string, prazo: number): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const executar = u.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = executar(u, {
      method: 'GET', agent: false, family: 4, autoSelectFamily: false,
      // O socket usa o IP conferido. Host e validação TLS continuam vinculados ao nome original.
      lookup: (_host, _options, callback) => callback(null, address, 4),
      headers: { 'User-Agent': 'ROOT-Brandbook/1.0', Accept: 'text/html,text/plain', 'Accept-Encoding': 'identity' },
    }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        clearTimeout(timer); resolve({ status, headers: res.headers, body: '' }); res.destroy(); return;
      }
      const mime = String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (status < 200 || status >= 300 || !['text/html', 'text/plain', 'application/xhtml+xml'].includes(mime) ||
        (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') || Number(res.headers['content-length'] ?? 0) > TETO) {
        clearTimeout(timer); reject(new BadRequestException('O site não respondeu com HTML ou texto permitido de até 1 MB.')); res.destroy(); return;
      }
      const partes: Buffer[] = []; let bytes = 0;
      res.on('data', (parte: Buffer) => {
        bytes += parte.length;
        if (bytes > TETO) { reject(new BadRequestException('A página excede 1 MB.')); req.destroy(); return; }
        partes.push(parte);
      });
      res.on('end', () => { clearTimeout(timer); resolve({ status, headers: res.headers, body: Buffer.concat(partes).toString('utf8') }); });
      res.on('error', () => { clearTimeout(timer); reject(new BadRequestException('A leitura da página não foi concluída.')); });
    });
    const timer = setTimeout(() => req.destroy(new Error('timeout')), Math.max(1, prazo));
    req.on('error', () => { clearTimeout(timer); reject(new BadRequestException('Não foi possível ler a página pública dentro do prazo.')); });
    req.end();
  });
}
const entidades: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const limpar = (v: string): string => v.replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, (m) => entidades[m.toLowerCase()] ?? ' ').replace(/\s+/g, ' ').trim();

// Varredura progressiva: não tenta novamente todos os sufixos de HTML malformado.
function atributos(tag: string): Record<string, string> {
  const resultado: Record<string, string> = Object.create(null);
  let i = 0;
  while (i < tag.length) {
    while (i < tag.length && (tag[i] === '/' || /\s/.test(tag[i]))) i++;
    const inicio = i;
    while (i < tag.length && !/[\s=/]/.test(tag[i])) i++;
    const nome = tag.slice(inicio, i).toLowerCase();
    while (i < tag.length && /\s/.test(tag[i])) i++;
    if (tag[i] !== '=') { if (i === inicio) i++; continue; }
    i++;
    while (i < tag.length && /\s/.test(tag[i])) i++;
    const aspas = tag[i] === '"' || tag[i] === "'" ? tag[i++] : null;
    const valorInicio = i;
    if (aspas) {
      const fim = tag.indexOf(aspas, i);
      if (fim < 0) throw new BadRequestException('A página contém atributo HTML sem fechamento.');
      i = fim; resultado[nome] = tag.slice(valorInicio, i); i++;
    } else {
      while (i < tag.length && !/\s/.test(tag[i])) i++;
      resultado[nome] = tag.slice(valorInicio, i);
    }
  }
  return resultado;
}
function extrair(url: string, html: string): BrandbookColeta {
  const minusculo = html.replace(/[A-Z]/g, (letra) => letra.toLowerCase());
  const textos: string[] = [], estilos: string[] = [];
  let titulo = '', descricao = '', cursor = 0, tamanhoCss = 0, quantidadeTags = 0;
  const juntarCss = (valor: string) => {
    tamanhoCss += valor.length;
    if (tamanhoCss > 64 * 1024) throw new BadRequestException('O CSS embutido excede o limite de coleta de 64 KB.');
    estilos.push(valor);
  };
  while (cursor < html.length) {
    const abre = html.indexOf('<', cursor);
    if (abre < 0) { textos.push(html.slice(cursor)); break; }
    textos.push(html.slice(cursor, abre));
    if (html.startsWith('<!--', abre)) {
      const fechaComentario = html.indexOf('-->', abre + 4);
      if (fechaComentario < 0) throw new BadRequestException('A página contém comentário HTML sem fechamento.');
      cursor = fechaComentario + 3; continue;
    }
    const fecha = html.indexOf('>', abre + 1);
    const outroAbre = html.indexOf('<', abre + 1);
    if (fecha < 0 || fecha - abre > 4096 || (outroAbre >= 0 && outroAbre < fecha) || ++quantidadeTags > 10000) {
      throw new BadRequestException('A página contém HTML malformado ou excede o limite de tags da coleta.');
    }
    const tag = html.slice(abre + 1, fecha).trim();
    const nome = /^([a-z][a-z0-9:-]*)\b/i.exec(tag)?.[1]?.toLowerCase();
    cursor = fecha + 1;
    if (!nome) continue;
    if (['script', 'style', 'noscript', 'title'].includes(nome)) {
      const fechamento = minusculo.indexOf(`</${nome}`, cursor);
      if (fechamento < 0) throw new BadRequestException('A página contém bloco HTML sem fechamento.');
      const conteudo = html.slice(cursor, fechamento);
      if (nome === 'style') juntarCss(conteudo);
      else if (nome === 'title' && !titulo) titulo = limpar(conteudo).slice(0, 200);
      cursor = fechamento; continue;
    }
    const attrs = atributos(tag.slice(nome.length));
    if (attrs.style) juntarCss(attrs.style);
    if (nome === 'meta' && !descricao && ['description', 'og:description'].includes((attrs.name ?? attrs.property ?? '').toLowerCase())) {
      descricao = limpar(attrs.content ?? '').slice(0, 2000);
    }
  }
  const css = estilos.join('\n');
  const cores = [...new Set((css.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) ?? []).map((v) => v.toLowerCase()))].slice(0, 16).map((hex) => ({ papel: 'proposta', hex }));
  const fontes = [...new Set([...css.matchAll(/font-family\s*:\s*([^;}]+)/gi)].flatMap((m) => m[1].split(',')).map((v) => v.trim().replace(/^["']|["']$/g, '')).filter((v) => /^[\p{L}\p{N} _-]{1,120}$/u.test(v)))].slice(0, 8).map((familia) => ({ papel: 'proposta', familia }));
  const textoCompleto = limpar(textos.join(' '));
  const avisos = ['Cores e fontes são declarações encontradas no CSS embutido e propostas para revisão. Não há leitura de folhas externas, execução de scripts ou análise de logo, voz ou personas.'];
  if (textoCompleto.length > 16000) avisos.push('O texto foi limitado aos primeiros 16.000 caracteres.');
  return { url, titulo, descricao, texto: textoCompleto.slice(0, 16000), cores, fontes, avisos };
}

/** Somente chamada explícita do criador; não agenda coleta nem aciona modelo ou provedor pago. */
export async function coletarSiteDaMarca(valor: string): Promise<BrandbookColeta> {
  const limite = Date.now() + PRAZO;
  let u = conferirUrlDaMarca(valor);
  for (let salto = 0; salto <= 3; salto++) {
    if (Date.now() >= limite) throw new BadRequestException('A coleta excedeu 10 segundos.');
    const address = await resolver(u.hostname, limite - Date.now());
    if (Date.now() >= limite) throw new BadRequestException('A coleta excedeu 10 segundos.');
    const r = await pedir(u, address, limite - Date.now());
    if (r.status >= 300 && r.status < 400) {
      if (salto === 3 || !r.headers.location) throw new BadRequestException('A página excedeu três redirecionamentos ou não informou o destino.');
      let destino: string;
      try { destino = new URL(r.headers.location, u).toString(); } catch { throw new BadRequestException('O redirecionamento não contém um endereço válido.'); }
      u = conferirUrlDaMarca(destino); continue;
    }
    if (String(r.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() === 'text/plain') {
      const texto = limpar(r.body);
      return { url: u.toString(), titulo: '', descricao: '', texto: texto.slice(0, 16000), cores: [], fontes: [], avisos: ['Fonte de texto simples; sem extração de CSS ou identidade.' , ...(texto.length > 16000 ? ['O texto foi limitado aos primeiros 16.000 caracteres.'] : [])] };
    }
    return extrair(u.toString(), r.body);
  }
  throw new BadRequestException('A coleta não foi concluída.');
}
