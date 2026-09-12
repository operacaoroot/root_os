import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Painel — ROOT OS. Os valores moram em globals.css como triplet RGB
        // e trocam com data-os-theme, então as 37 telas seguem o tema sem
        // que nenhuma precise ser editada. Triplet (e não hex ou var() puro)
        // porque é o que preserva `bg-bad/10`, `bg-brand/15`, `border-bad/40`.
        bg: 'rgb(var(--os-bg) / <alpha-value>)',
        bg2: 'rgb(var(--os-bg2) / <alpha-value>)',
        surface: 'rgb(var(--os-s1) / <alpha-value>)',
        'surface-2': 'rgb(var(--os-s2) / <alpha-value>)',
        'surface-3': 'rgb(var(--os-s3) / <alpha-value>)',
        border: 'rgb(var(--os-line) / <alpha-value>)',
        'border-strong': 'rgb(var(--os-line-strong) / <alpha-value>)',
        text: 'rgb(var(--os-tx) / <alpha-value>)',
        muted: 'rgb(var(--os-tx2) / <alpha-value>)',
        // Decorativo: rótulo, hint, moldura. Nunca dado.
        dim: 'rgb(var(--os-tx3) / <alpha-value>)',
        brand: 'rgb(var(--os-ac) / <alpha-value>)',
        'brand-2': 'rgb(var(--os-ac2) / <alpha-value>)',
        'brand-dim': 'rgb(var(--os-ac-dim) / <alpha-value>)',
        // Tinta que fica POR CIMA do acento. No mono o acento é branco, então
        // `text-white` sobre `bg-brand` some — é para isso que este token existe.
        ink: 'rgb(var(--os-ac-ink) / <alpha-value>)',
        // Escala de estado — quatro valores. O acento não entra aqui.
        good: 'rgb(var(--os-ok) / <alpha-value>)',
        warn: 'rgb(var(--os-warn) / <alpha-value>)',
        bad: 'rgb(var(--os-err) / <alpha-value>)',
        info: 'rgb(var(--os-cy) / <alpha-value>)',
        mag: 'rgb(var(--os-mag) / <alpha-value>)',
        // Identidade ROOT — usada só na superfície pública da bio (/b/*).
        // Espelha ~/.maquina-carrossel/marcas/root/brand.json (fonte canônica).
        'bio-bg': '#070a08',
        'bio-primary': '#9bdb1f',
        'bio-accent': '#ff1f6b',
        'bio-text': '#dfffe8',
        'bio-soft': 'rgba(223,255,232,0.62)',
        'bio-weak': 'rgba(223,255,232,0.38)',
        'bio-line': 'rgba(155,219,31,0.22)',
        'bio-border': 'rgba(223,255,232,0.14)',
        // Identidade ROOT na Central (/central/*). Mesma paleta da bio, mas
        // via CSS var porque ali o tema troca (claro/escuro) — ver globals.css.
        // Triplet RGB, e não hex, pra que `bg-central-bg/90` continue valendo.
        'central-lima': 'rgb(var(--central-lima) / <alpha-value>)',
        'central-lima-bright': 'rgb(var(--central-lima-bright) / <alpha-value>)',
        'central-magenta': 'rgb(var(--central-magenta) / <alpha-value>)',
        'central-ciano': 'rgb(var(--central-ciano) / <alpha-value>)',
        'central-bg': 'rgb(var(--central-bg) / <alpha-value>)',
        'central-painel': 'rgb(var(--central-painel) / <alpha-value>)',
        'central-painel2': 'rgb(var(--central-painel2) / <alpha-value>)',
        'central-linha': 'rgb(var(--central-linha) / <alpha-value>)',
        'central-tinta': 'rgb(var(--central-tinta) / <alpha-value>)',
        'central-tinta-suave': 'rgb(var(--central-tinta-suave) / <alpha-value>)',
        'central-tinta-fraca': 'rgb(var(--central-tinta-fraca) / <alpha-value>)',
        'central-acento': 'rgb(var(--central-acento) / <alpha-value>)',
        'central-alerta': 'rgb(var(--central-alerta) / <alpha-value>)',
        'central-ok': 'rgb(var(--central-acento) / <alpha-value>)',
        'central-erro': 'rgb(var(--central-magenta) / <alpha-value>)',
        // Translúcidas por definição — não recebem modificador de opacidade, e
        // o alpha muda com o tema (o claro precisa de mais para o mesmo peso).
        'central-acento-soft': 'var(--central-acento-soft)',
        'central-magenta-soft': 'var(--central-magenta-soft)',
      },
      fontFamily: {
        'os-mono': ['var(--os-mono)'],
        'os-sans': ['var(--os-sans)'],
        'central-mono': ['var(--font-jetbrains, "JetBrains Mono")', 'JetBrains Mono', 'ui-monospace', 'monospace'],
        'central-sans': ['var(--font-space, "Space Grotesk")', 'Space Grotesk', 'ui-sans-serif', 'system-ui'],
      },
      // O protótipo não tem canto redondo: 3px em tudo. Achatar a escala aqui
      // aplica a moldura ROOT nas 37 telas sem tocar em nenhuma das 211
      // ocorrências de rounded-lg/rounded-xl. `rounded-full` (avatar) não é
      // afetado — é chave própria. /central e /b não usam nenhuma delas.
      borderRadius: { DEFAULT: '3px', sm: '2px', md: '3px', lg: '3px', xl: '3px', '2xl': '4px', root: '3px' },
    },
  },
  plugins: [],
};

export default config;
