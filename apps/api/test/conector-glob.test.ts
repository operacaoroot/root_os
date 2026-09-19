import { describe, expect, it } from 'vitest';
import { corresponde } from '../src/conector/conector-remessa.service';

describe('filtros literais de fonte do conector', () => {
  it('globstar aceita raiz e subpasta sem corromper os demais curingas', () => {
    expect(corresponde('**/*.md', 'a.md')).toBe(true);
    expect(corresponde('**/*.md', 'docs/sub/a.md')).toBe(true);
    expect(corresponde('docs/*.md', 'docs/a.md')).toBe(true);
    expect(corresponde('docs/*.md', 'docs/sub/a.md')).toBe(false);
    expect(corresponde('docs/?.md', 'docs/a.md')).toBe(true);
    expect(corresponde('docs/?.md', 'docs/ab.md')).toBe(false);
  });

  it('escapa regex e não interpreta sentinelas como operadores', () => {
    expect(corresponde('__GLOBSTAR__', '__GLOBSTAR__')).toBe(true);
    expect(corresponde('__GLOBSTAR__', 'qualquer')).toBe(false);
    expect(corresponde('literal.+[x].md', 'literal.+[x].md')).toBe(true);
    expect(corresponde('literal.+[x].md', 'literalZZx.md')).toBe(false);
  });
});
