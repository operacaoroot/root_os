import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b0e14',
        surface: '#131823',
        'surface-2': '#1a2130',
        border: '#232c3d',
        muted: '#8a96ab',
        text: '#e6ebf4',
        brand: '#5b8cff',
        'brand-dim': '#3a5bb0',
        good: '#33d69f',
        warn: '#f5a623',
        bad: '#ff5c6c',
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
        'central-mono': ['var(--font-jetbrains)', 'JetBrains Mono', 'ui-monospace', 'monospace'],
        'central-sans': ['var(--font-space)', 'Space Grotesk', 'ui-sans-serif', 'system-ui'],
      },
      borderRadius: { xl: '14px', root: '3px' },
    },
  },
  plugins: [],
};

export default config;
