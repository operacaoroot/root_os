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
      },
      borderRadius: { xl: '14px' },
    },
  },
  plugins: [],
};

export default config;
