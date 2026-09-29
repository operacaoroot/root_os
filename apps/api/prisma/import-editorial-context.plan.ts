import { createHash } from 'node:crypto';
import { ContextKind, ContextSource } from '@prisma/client';
import { hashDoCorpo } from '../src/memory/procedencia';

export const CAMINHO_DA_MARCA = 'Root/40-marca-e-conteudo/root-fundamentos-da-marca-e-guia-de-expressao.md';
export const CHAVE_DA_MARCA_NA_VAULT = `vault:${CAMINHO_DA_MARCA}`;
export const CHAVE_DA_MARCA_IMPORTADA = `editorial:marca:${CAMINHO_DA_MARCA}`;
const DOC_ID = '8ckpuuy-36293';
const WORKSPACE_ID = '9013259102';
const PAGINAS = ['8ckpuuy-30113', '8ckpuuy-30133', '8ckpuuy-30153',
  '8ckpuuy-30173', '8ckpuuy-30193', '8ckpuuy-30213', '8ckpuuy-30233'];

export type OrigemSelecionada = 'clickup' | 'marca' | 'ambos';
export type EntradaEditorial = {
  chave: string;
  kind: ContextKind;
  title: string;
  body: string;
  tags: string[];
  sourceType: ContextSource;
  sourceRef: string;
  motivo: string;
  contentHash: string;
  origem: 'clickup' | 'marca';
};
export type PlanoEditorial = {
  arquivos: { clickupSha256?: string; marcaSha256?: string };
  entradas: EntradaEditorial[];
};

export function sha256(texto: string): string {
  return createHash('sha256').update(texto).digest('hex');
}

function objeto(valor: unknown, campo: string): Record<string, unknown> {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new Error(`${campo}: objeto inválido`);
  return valor as Record<string, unknown>;
}
function texto(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || !valor.trim()) throw new Error(`${campo}: texto vazio ou inválido`);
  return valor;
}
function dataDeMilissegundos(valor: unknown, campo: string): string {
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor <= 0) throw new Error(`${campo}: data inválida`);
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) throw new Error(`${campo}: data inválida`);
  return data.toISOString();
}

export function entradasClickUp(raw: string): EntradaEditorial[] {
  const exportado = objeto(JSON.parse(raw), 'exportação');
  const source = objeto(exportado.source, 'source');
  if (source.provider !== 'ClickUp' || String(source.workspace_id) !== WORKSPACE_ID ||
      source.document_id !== DOC_ID || source.content_format !== 'text/md') {
    throw new Error('Exportação ClickUp fora do documento editorial selecionado');
  }
  texto(source.exported_at, 'source.exported_at');
  if (Number.isNaN(Date.parse(String(source.exported_at)))) throw new Error('source.exported_at inválido');
  if (!Array.isArray(exportado.pages) || exportado.pages.length !== PAGINAS.length) {
    throw new Error(`Documento editorial deve ter ${PAGINAS.length} páginas`);
  }
  const ids = new Set<string>();
  const entradas = exportado.pages.map((item: unknown): EntradaEditorial => {
    const pagina = objeto(item, 'página');
    const id = texto(pagina.id, 'page.id');
    if (!PAGINAS.includes(id) || ids.has(id)) throw new Error(`Página fora do conjunto ou repetida: ${id}`);
    ids.add(id);
    if (pagina.doc_id !== DOC_ID || String(pagina.workspace_id) !== WORKSPACE_ID ||
        pagina.archived !== false || pagina.deleted !== false) {
      throw new Error(`Página ${id}: documento, workspace ou estado divergente`);
    }
    const title = texto(pagina.name, `page.${id}.name`).trim();
    const body = texto(pagina.content, `page.${id}.content`);
    const atualizado = dataDeMilissegundos(pagina.date_edited ?? pagina.date_updated, `page.${id}.date_edited`);
    const contentHash = hashDoCorpo(body);
    return {
      chave: `editorial:clickup:${DOC_ID}:${id}`,
      kind: ContextKind.nota,
      title,
      body,
      tags: ['root', 'editorial', 'clickup'],
      sourceType: ContextSource.conector,
      sourceRef: `clickup:${WORKSPACE_ID}/${DOC_ID}/${id}@${atualizado}#sha256:${contentHash}`,
      motivo: `importação seletiva do documento editorial ClickUp; página editada em ${atualizado}; corpo sha256:${contentHash}`,
      contentHash,
      origem: 'clickup',
    };
  });
  if (PAGINAS.some((id) => !ids.has(id))) throw new Error('Faltam páginas do documento selecionado');
  return entradas;
}

export function entradaMarca(raw: string): EntradaEditorial {
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fm) throw new Error('Guia de marca sem frontmatter');
  const tipo = fm[1].match(/^tipo:\s*(.+)$/m)?.[1]?.trim();
  const versao = fm[1].match(/^versao:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim();
  if (tipo !== 'documento-mestre-de-marca' || versao !== '2.0') {
    throw new Error('Guia de marca fora da versão selecionada (2.0)');
  }
  // O indexador da vault remove o frontmatter e guarda o corpo aparado.
  // Repetir a mesma forma permite reconhecer a cópia existente pelo hash.
  const body = texto(raw.slice(fm[0].length).trim(), 'corpo do guia');
  const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (!title) throw new Error('Guia de marca sem título H1');
  const tagsInline = fm[1].match(/^tags:\s*\[([^\]]*)\]/m)?.[1] ?? '';
  const tags = tagsInline.split(',').map((tag) => tag.trim().replace(/["']/g, '')).filter(Boolean);
  const contentHash = hashDoCorpo(body);
  return {
    chave: CHAVE_DA_MARCA_IMPORTADA,
    kind: ContextKind.nota,
    title,
    body,
    tags,
    sourceType: ContextSource.conector,
    sourceRef: `obsidian:${CAMINHO_DA_MARCA}@v${versao}#sha256:${contentHash}`,
    motivo: `importação seletiva do guia de marca v${versao}; corpo sha256:${contentHash}`,
    contentHash,
    origem: 'marca',
  };
}

export function prepararPlano(opcoes: {
  only: OrigemSelecionada;
  docsRaw?: string;
  marcaRaw?: string;
}): PlanoEditorial {
  const entradas: EntradaEditorial[] = [];
  const arquivos: PlanoEditorial['arquivos'] = {};
  if (opcoes.only === 'clickup' || opcoes.only === 'ambos') {
    if (opcoes.docsRaw === undefined) throw new Error('Falta a exportação ClickUp');
    arquivos.clickupSha256 = sha256(opcoes.docsRaw);
    entradas.push(...entradasClickUp(opcoes.docsRaw));
  }
  if (opcoes.only === 'marca' || opcoes.only === 'ambos') {
    if (opcoes.marcaRaw === undefined) throw new Error('Falta o guia de marca');
    arquivos.marcaSha256 = sha256(opcoes.marcaRaw);
    entradas.push(entradaMarca(opcoes.marcaRaw));
  }
  return { arquivos, entradas };
}
