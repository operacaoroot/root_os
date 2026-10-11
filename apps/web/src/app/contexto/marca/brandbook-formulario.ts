import { BrandbookDocumentoSchema, BRANDBOOK_LOGO_MAX_CHARS, type BrandbookDocumento, type BrandbookColeta } from '@mktos/shared';

export function novoBrandbook(): BrandbookDocumento {
  const documento = BrandbookDocumentoSchema.parse({});
  documento.visual.cores = ['Primária', 'Fundo', 'Texto'].map((papel) => ({ papel, hex: '' }));
  documento.visual.fontes = ['Título', 'Corpo'].map((papel) => ({ papel, familia: '' }));
  documento.voz.eixos = [['formal', 'informal'], ['técnico', 'acessível'], ['sério', 'divertido'], ['próximo', 'distante']]
    .map(([de, para]) => ({ de, para, valor: null }));
  return documento;
}

export function copiarBrandbook(documento: BrandbookDocumento): BrandbookDocumento {
  return JSON.parse(JSON.stringify(documento)) as BrandbookDocumento;
}

export function linhas(texto: string): string[] {
  return texto.split('\n').map((linha) => linha.trim()).filter(Boolean);
}

export function perfilDasRespostas(d: BrandbookDocumento): string {
  return [
    ['Quem somos', [d.identidade.nome, d.identidade.descricao, d.respostas.posicionamento, d.respostas.diferencialPromessa]],
    ['Como falamos', [d.respostas.tomDeVoz, d.voz.descricao]],
    ['O que queremos', [d.respostas.desejo]],
    ['O que rejeitamos', d.voz.evitar],
    ['Público', [d.respostas.clienteIdeal, d.respostas.dor]],
    ['Diretrizes', [d.visual.regras]],
  ].map(([titulo, trechos]) => `## ${titulo}\n${(trechos as string[]).filter(Boolean).join('\n')}`).join('\n\n');
}

export function aplicarColeta(d: BrandbookDocumento, coleta: BrandbookColeta): BrandbookDocumento {
  return {
    ...d,
    origem: { tipo: 'site', url: coleta.url, arquivoNome: null, texto: coleta.texto },
    identidade: { ...d.identidade, nome: d.identidade.nome || coleta.titulo, descricao: d.identidade.descricao || coleta.descricao },
    visual: { ...d.visual,
      cores: [...d.visual.cores, ...coleta.cores.filter((c) => !d.visual.cores.some((atual) => atual.hex.toLowerCase() === c.hex.toLowerCase()))].slice(0, 16),
      fontes: [...d.visual.fontes, ...coleta.fontes.filter((f) => !d.visual.fontes.some((atual) => atual.familia.toLowerCase() === f.familia.toLowerCase()))].slice(0, 8) },
  };
}

export async function lerDocumentoLocal(arquivo: File): Promise<{ documento?: BrandbookDocumento; texto?: string; nome: string }> {
  if (arquivo.size > 64 * 1024) throw new Error('O documento precisa ter até 64 KB.');
  if (!/\.(?:txt|md|json)$/i.test(arquivo.name)) throw new Error('Selecione TXT, MD ou JSON. PDF pode ser usado após copiar o texto.');
  const texto = await arquivo.text();
  if (/\.json$/i.test(arquivo.name)) {
    const resultado = BrandbookDocumentoSchema.safeParse(JSON.parse(texto));
    if (!resultado.success) throw new Error(`O JSON não é um brandbook válido: ${resultado.error.issues.map((i) => i.message).join(' · ')}`);
    return { documento: resultado.data, nome: arquivo.name };
  }
  if (texto.length > 16000) throw new Error('O texto da referência precisa ter até 16 mil caracteres.');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(texto)) throw new Error('O arquivo contém caracteres que não são texto.');
  return { texto, nome: arquivo.name };
}

export async function normalizarLogo(arquivo: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(arquivo.type)) throw new Error('Selecione um logo PNG, JPG ou WebP.');
  if (arquivo.size > 5 * 1024 * 1024) throw new Error('O logo de entrada precisa ter até 5 MB.');
  const cabecalho = new Uint8Array(await arquivo.slice(0, 12).arrayBuffer());
  const png = cabecalho.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => cabecalho[i] === n);
  const jpeg = cabecalho[0] === 255 && cabecalho[1] === 216 && cabecalho[2] === 255;
  const webp = cabecalho.length >= 12 && String.fromCharCode(...cabecalho.slice(0, 4)) === 'RIFF' && String.fromCharCode(...cabecalho.slice(8, 12)) === 'WEBP';
  if (!(arquivo.type === 'image/png' && png || arquivo.type === 'image/jpeg' && jpeg || arquivo.type === 'image/webp' && webp)) {
    throw new Error('O conteúdo do arquivo não corresponde a uma imagem PNG, JPG ou WebP.');
  }
  const url = URL.createObjectURL(arquivo);
  try {
    const imagem = new Image();
    const carregada = new Promise<void>((resolve, reject) => {
      imagem.onload = () => resolve();
      imagem.onerror = () => reject(new Error('Não foi possível ler esta imagem.'));
    });
    imagem.src = url;
    await carregada;
    if (!imagem.naturalWidth || !imagem.naturalHeight || imagem.naturalWidth * imagem.naturalHeight > 40_000_000) {
      throw new Error('A imagem tem dimensões excessivas. Exporte uma versão menor.');
    }
    let escala = Math.min(1, 320 / imagem.naturalWidth, 200 / imagem.naturalHeight);
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(imagem.naturalWidth * escala));
      canvas.height = Math.max(1, Math.round(imagem.naturalHeight * escala));
      const contexto = canvas.getContext('2d');
      if (!contexto) throw new Error('Este navegador não conseguiu preparar o logo.');
      contexto.drawImage(imagem, 0, 0, canvas.width, canvas.height);
      const resultado = canvas.toDataURL('image/webp', 0.8 - tentativa * 0.1);
      if (resultado.length <= BRANDBOOK_LOGO_MAX_CHARS && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(resultado)) return resultado;
      escala *= 0.72;
    }
    throw new Error('Não foi possível reduzir o logo a 24 KB. Use uma imagem mais simples.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function escaparHtml(valor: string): string {
  return valor.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function nomeDoArquivo(d: BrandbookDocumento): string {
  return `brandbook-${d.identidade.nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'marca'}`;
}

export function htmlDoBrandbook(d: BrandbookDocumento, origem: string): string {
  const e = escaparHtml;
  const p = (v: string) => `<p>${e(v || 'Não preenchido').replace(/\n/g, '<br>')}</p>`;
  const lista = (v: string[]) => v.length ? `<ul>${v.map((s) => `<li>${e(s)}</li>`).join('')}</ul>` : p('');
  const secao = (titulo: string, corpo: string) => `<section><h2>${e(titulo)}</h2>${corpo}</section>`;
  const campo = (titulo: string, valor: string) => `<h3>${e(titulo)}</h3>${p(valor)}`;
  const logo = d.visual.logoDataUrl ? `<img class="logo" src="${e(d.visual.logoDataUrl)}" alt="Logo de ${e(d.identidade.nome)}">` : '';
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(d.identidade.nome || 'Livro da marca')}</title><style>body{max-width:1000px;margin:40px auto;padding:0 24px;font-family:system-ui,sans-serif;color:#17201a;line-height:1.6}header,section{border-bottom:1px solid #d8ded9;padding:20px 0}h1{font-size:32px}h2{font-size:22px}h3{font-size:15px;margin-bottom:4px}p{white-space:normal;margin-top:4px}.logo{max-width:240px;max-height:150px}.cores{display:flex;flex-wrap:wrap;gap:12px}.cor{border:1px solid #bbb;padding:12px;min-width:120px}.sw{height:48px;border:1px solid #bbb}small{color:#526057}@media print{body{margin:0;max-width:none}section{break-inside:avoid}}</style><header>${logo}<small>${e(origem)}</small><h1>${e(d.identidade.nome || 'Livro da marca')}</h1>${p(d.identidade.descricao)}${p([d.identidade.handle, d.identidade.nicho, d.identidade.assinatura].filter(Boolean).join(' · '))}</header>` +
    secao('Estratégia', campo('Posicionamento', d.respostas.posicionamento) + campo('Cliente ideal', d.respostas.clienteIdeal) + campo('Dor', d.respostas.dor) + campo('Desejo', d.respostas.desejo) + campo('Diferencial e promessa', d.respostas.diferencialPromessa) + campo('Tom de voz', d.respostas.tomDeVoz) + campo('Cor primária', d.respostas.corPrimaria)) +
    secao('Voz', p(d.voz.descricao) + lista(d.voz.eixos.map((v) => `${v.de} → ${v.para}: ${v.valor === null ? 'não definido' : v.valor + '/100'}`)) + campo('Palavras permitidas', d.voz.permitidas.join(', ')) + campo('Palavras a evitar', d.voz.evitar.join(', '))) +
    secao('Cor e tipografia', `<div class="cores">${d.visual.cores.map((c) => `<div class="cor"><div class="sw" style="background:${/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(c.hex) ? e(c.hex) : 'transparent'}"></div><b>${e(c.papel)}</b>${p(c.hex)}</div>`).join('')}</div>` + lista(d.visual.fontes.map((f) => `${f.papel}: ${f.familia || 'não preenchida'}`))) +
    secao('Assinatura visual', campo('Regras de uso', d.visual.regras) + campo('Texturas e fundos', d.visual.texturas) + campo('Capas', d.visual.capas)) +
    secao('Personas', d.personas.length ? d.personas.map((v) => campo(v.nome, v.descricao)).join('') : p('')) +
    secao('Pilares de conteúdo', d.pilares.length ? d.pilares.map((v) => campo(v.nome, [v.cor, v.descricao].filter(Boolean).join(' · '))).join('') : p('')) +
    secao('Modelos de peça', d.modelos.length ? d.modelos.map((v) => campo(v.nome, v.estrutura)).join('') : p('')) +
    secao('Perfil para a Pauta', p(d.perfilParaPauta)) +
    secao('Referência de origem', campo('Tipo', d.origem.tipo) + campo('URL / arquivo', d.origem.url || d.origem.arquivoNome || '') + p(d.origem.texto)) + '</html>';
}

export function coresDaAmostra(d: BrandbookDocumento): { fundo: string; texto: string; acento: string } | null {
  const buscar = (papeis: string[]) => d.visual.cores.find((c) => papeis.includes(c.papel.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()) && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(c.hex))?.hex;
  const fundo = buscar(['fundo', 'background']);
  const texto = buscar(['texto', 'text']);
  const acento = buscar(['primaria', 'primary', 'principal']);
  return fundo && texto && acento ? { fundo, texto, acento } : null;
}

export function contraste(a: string, b: string): number {
  const luminancia = (hex: string) => {
    const completa = hex.length === 4 ? '#' + hex.slice(1).split('').map((s) => s + s).join('') : hex;
    const rgb = [1, 3, 5].map((i) => parseInt(completa.slice(i, i + 2), 16) / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const x = luminancia(a), y = luminancia(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
