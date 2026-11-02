// Gera o inventário das rotas da API do ROOT OS a partir dos controllers (apps/api/src), para o MCP:
//   - src/rotas.gen.ts: a lista fechada que `os_api` aceita e `os_rotas` pesquisa (nunca editar à mão);
//   - docs/mcp/INVENTARIO-ROTAS.md: o mesmo inventário para gente ler, com cobertura das ferramentas curadas.
// Uso: pnpm --filter @mktos/mcp gerar-rotas   (rodar sempre que a API ganhar ou perder rota; o teste confere a sincronia)
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const RAIZ_REPO = resolve(here, '../../..');
const RAIZ_API = join(RAIZ_REPO, 'apps/api/src');

export interface RotaGerada {
  m: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  r: string;
  p: string[];
  /** g = só gente · u = upload · a = devolve arquivo/stream · s = SensitiveWrite · pub = sem sessão */
  f: string[];
  d: string;
}

function arquivosTs(dir: string): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) { if (nome !== 'test' && nome !== 'node_modules') out.push(...arquivosTs(caminho)); continue; }
    if (nome.endsWith('.ts') && !nome.endsWith('.spec.ts') && !nome.endsWith('.test.ts')) out.push(caminho);
  }
  return out;
}

const HTTP = /@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/;
const CTRL = /^@Controller\(\s*(?:'([^']*)'|"([^"]*)"|\{[^}]*path:\s*'([^']*)'[^}]*\})?\s*\)/;
const PERM = /@RequirePermissions\(([^)]*)\)/g;
const GUARD = /@UseGuards\(([^)]*)\)/g;
const SENS = /@SensitiveWrite\(\s*'([^']*)'/;
const METODO = /^\s*(?:public\s+|private\s+)?(?:async\s+)?([a-zA-Z_]\w*)\s*(?:<[^>]*>)?\s*\(/;
const lista = (re: RegExp, texto: string) => [...texto.matchAll(re)].flatMap((mm) => mm[1].split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean));

export function gerar(): RotaGerada[] {
  const rotas: RotaGerada[] = [];
  for (const arquivo of arquivosTs(RAIZ_API).sort()) {
    const texto = readFileSync(arquivo, 'utf8');
    if (!texto.includes('@Controller(')) continue;
    const partes = texto.split(/(?=@Controller\()/).slice(1);
    for (const parte of partes) {
      const mc = CTRL.exec(parte);
      const prefixo = mc ? (mc[1] ?? mc[2] ?? mc[3] ?? '') : '';
      const linhas = parte.split('\n');
      const cab: string[] = [];
      for (const l of linhas.slice(1)) { if (/^\s*(export\s+)?class\s/.test(l)) break; cab.push(l); }
      const cabtxt = cab.join('\n');
      const permsClasse = lista(PERM, cabtxt);
      const guardsClasse = lista(GUARD, cabtxt);
      let pend: { http: [string, string] | null; perms: string[]; guards: string[]; sens: boolean; upload: boolean; doc: string | null; res: boolean } = { http: null, perms: [], guards: [], sens: false, upload: false, doc: null, res: false };
      let emDoc = false; let docBuf: string[] = []; let ultimoDoc: string | null = null;
      const reset = () => { pend = { http: null, perms: [], guards: [], sens: false, upload: false, doc: null, res: false }; };
      for (const l of linhas) {
        const s = l.trim();
        if (s.startsWith('/**')) {
          emDoc = true; docBuf = [s.replace(/^\/\*+/, '').trim()];
          if (s.endsWith('*/')) { emDoc = false; ultimoDoc = docBuf[0].replace(/\*+\/$/, '').trim(); }
          continue;
        }
        if (emDoc) {
          if (s.endsWith('*/')) { emDoc = false; const t = s.replace(/\*+\/$/, '').trim().replace(/^\*\s?/, '').trim(); if (t) docBuf.push(t); ultimoDoc = docBuf.filter(Boolean).join(' ').trim(); }
          else docBuf.push(s.replace(/^\*\s?/, '').trim());
          continue;
        }
        const h = HTTP.exec(s);
        if (h && s.startsWith('@')) { pend.http = [h[1].toUpperCase(), h[2] ?? h[3] ?? '']; pend.doc = ultimoDoc; ultimoDoc = null; continue; }
        if (s.startsWith('@')) {
          pend.perms.push(...lista(PERM, s)); pend.guards.push(...lista(GUARD, s));
          if (SENS.test(s)) pend.sens = true;
          if (/FileInterceptor|FilesInterceptor|AnyFilesInterceptor/.test(s)) pend.upload = true;
          continue;
        }
        const mt = METODO.exec(l);
        if (mt && pend.http) {
          if (/@Res\(/.test(l) || /@Sse\(/.test(l)) pend.res = true;
          const [metodo, caminho] = pend.http;
          const rota = '/api/' + `${prefixo}/${caminho}`.split('/').filter(Boolean).join('/');
          const perms = [...permsClasse, ...pend.perms];
          const guards = [...guardsClasse, ...pend.guards];
          const f: string[] = [];
          if (guards.some((g) => g.includes('Gente'))) f.push('g');
          if (pend.upload) f.push('u');
          if (pend.res) f.push('a');
          if (pend.sens) f.push('s');
          if (!guards.includes('JwtAuthGuard') && perms.length === 0) f.push('pub');
          rotas.push({ m: metodo as RotaGerada['m'], r: rota, p: perms, f, d: (pend.doc ?? '').slice(0, 160) });
          reset(); ultimoDoc = null;
        } else if (mt && !s.startsWith('@') && !s.startsWith('//')) {
          ultimoDoc = null;
        }
      }
    }
  }
  rotas.sort((a, b) => (a.r === b.r ? a.m.localeCompare(b.m) : a.r.localeCompare(b.r)));
  return rotas;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rotas = gerar();
  const hoje = new Date().toISOString().slice(0, 10);
  const ts = `// GERADO por scripts/gerar-rotas.ts em ${hoje} a partir de apps/api/src. NÃO EDITAR À MÃO: rode \`pnpm --filter @mktos/mcp gerar-rotas\`.\n` +
    `// m = método · r = rota · p = permissões · f = marcas (g só gente, u upload, a devolve arquivo, s SensitiveWrite, pub sem sessão) · d = comentário do código.\n` +
    `export interface RotaDaApi { m: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; r: string; p: string[]; f: string[]; d: string }\n` +
    `export const GERADO_EM = '${hoje}';\n` +
    `export const ROTAS: RotaDaApi[] = ${JSON.stringify(rotas)};\n`;
  writeFileSync(resolve(here, '../src/rotas.gen.ts'), ts);
  const gets = rotas.filter((r) => r.m === 'GET').length;
  const pub = rotas.filter((r) => r.f.includes('pub')).length;
  const md: string[] = [
    '# Inventário das rotas da API do ROOT OS', '',
    `> Gerado em ${hoje} por \`packages/mcp/scripts/gerar-rotas.ts\` a partir de \`apps/api/src\`. **${rotas.length} rotas**: ${gets} de leitura e ${rotas.length - gets} de escrita; ${pub} sem sessão (sala do cliente por token, link do onboarding, webhooks, callbacks, login, saúde), que o MCP não alcança. As demais estão todas ao alcance de \`os_api\`; a coluna Curada diz quais têm ferramenta própria.`, '',
    'Marcas: `gente` recusa conta de máquina · `upload` recebe arquivo · `arquivo` devolve arquivo · `sens` escrita sensível (vira aprovação) · `pub` sem sessão.', '',
  ];
  let curadas: Record<string, string> = {};
  try {
    const srv = readFileSync(resolve(here, '../src/ferramentas/curadas.ts'), 'utf8');
    for (const mm of srv.matchAll(/nome:\s*'([a-z_]+)'[\s\S]*?metodo:\s*'([A-Z]+)'[\s\S]*?rota:\s*(?:'([^']*)'|`([^`]*)`)/g)) {
      const rota = (mm[3] ?? mm[4] ?? '').replace(/\$\{[^}]*\}/g, ':p');
      curadas[`${mm[2]} /api${rota}`] = mm[1];
    }
  } catch { /* sem curadas ainda */ }
  const norm = (r: string) => r.replace(/:[^/]+/g, ':p');
  let modulo = '';
  for (const r of rotas) {
    const m = r.r.split('/')[2];
    if (m !== modulo) { modulo = m; md.push(`## \`${m}\``, '', '| Método | Rota | Permissão | Marcas | O que faz | Curada |', '|---|---|---|---|---|---|'); }
    const marcas = r.f.map((x) => ({ g: 'gente', u: 'upload', a: 'arquivo', s: 'sens', pub: 'pub' })[x] ?? x).join(' ');
    const curada = curadas[`${r.m} ${norm(r.r)}`];
    md.push(`| ${r.m} | \`${r.r}\` | ${r.p.join(', ') || (r.f.includes('pub') ? 'pública' : 'sessão')} | ${marcas} | ${r.d.replace(/\|/g, '\\|')} | ${curada ? '`' + curada + '`' : ''} |`);
  }
  mkdirSync(join(RAIZ_REPO, 'docs/mcp'), { recursive: true });
  writeFileSync(join(RAIZ_REPO, 'docs/mcp/INVENTARIO-ROTAS.md'), md.join('\n') + '\n');
  console.error(`rotas: ${rotas.length} (GET ${gets}, públicas ${pub}) → src/rotas.gen.ts e ${relative(RAIZ_REPO, join(RAIZ_REPO, 'docs/mcp/INVENTARIO-ROTAS.md'))}`);
}
