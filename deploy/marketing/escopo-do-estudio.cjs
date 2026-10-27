// Prende o CSS do Estúdio V1 à classe .estudio (só vale dentro do Marketing do OS).
const fs = require('fs');
const postcss = require(require.resolve('postcss', { paths: [process.argv[2]] }));
const src = process.argv[3];
const files = ['styles.css', 'v1.css', 'css/a.css', 'css/b.css', 'css/c.css', 'css/d.css', 'css/e.css'];
let out = '';
for (const f of files) {
  const root = postcss.parse(fs.readFileSync(`${src}/${f}`, 'utf8'));
  root.walkRules((r) => {
    if (r.parent && r.parent.type === 'atrule' && /keyframes/i.test(r.parent.name)) return;
    r.selectors = r.selectors.map((s) => {
      s = s.trim();
      if (/^(:root|html|body)$/.test(s)) return '.estudio';
      if (/^(html|body)\s+/.test(s)) return s.replace(/^(html|body)\s+/, '.estudio ');
      if (s === '*') return '.estudio, .estudio *';
      // A casca do Estúdio (barra lateral, login) não entra: o OS tem a dele.
      return `.estudio ${s}`;
    });
  });
  root.walkAtRules('keyframes', (a) => { a.params = `estudio-${a.params}`; });
  root.walkDecls(/^animation/, (d) => { d.value = d.value.replace(/\b([a-z][\w-]*)\b/g, (m) => (fs.readFileSync(`${src}/${f}`, 'utf8').includes(`@keyframes ${m}`) ? `estudio-${m}` : m)); });
  out += `/* ${f} */\n${root.toString()}\n`;
}
process.stdout.write(out);
