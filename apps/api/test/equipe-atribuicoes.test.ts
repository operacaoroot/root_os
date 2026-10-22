import { describe, expect, it } from 'vitest';

import {
  atribuicoesDaPessoa,
  celulasDaLinha,
  donoDoFrontmatter,
  funcoesDaSecaoDono,
  lerVault,
  mesmoNome,
  nomesDaCelula,
  sociosDoVault,
} from '../src/agents/atribuicoes-do-vault';
import { notasDoDuble } from './perfil-dubles';

/*
 * AS ATRIBUIÇÕES DA EQUIPE LIDAS DO VAULT (produção 22B, I6), contra o MESMO
 * dublê que a homologação copia para o volume do vault
 * (`homolog/fixtures/vault-equipe/`): sócios fictícios Alice, Bruno e Clara.
 */

describe('as peças da leitura', () => {
  it('células da tabela não partem no | de dentro do link', () => {
    expect(celulasDaLinha('| [[Alice]] | Comercial | [[Função — Comercial\\|Comercial]], [[Função — Produto|Produto]] |')).toEqual([
      '[[Alice]]',
      'Comercial',
      '[[Função — Comercial|Comercial]], [[Função — Produto|Produto]]',
    ]);
  });

  it('nomes da célula: link, "e", vírgula, "os três"', () => {
    expect(nomesDaCelula('[[Alice]] e Bruno')).toEqual(['Alice', 'Bruno']);
    expect(nomesDaCelula('Clara, Bruno')).toEqual(['Clara', 'Bruno']);
    expect(nomesDaCelula('os três')).toBe('todos');
    expect(nomesDaCelula('—')).toEqual([]);
  });

  it('o mesmo nome: igual, ou um é só o primeiro nome do outro', () => {
    expect(mesmoNome('Alice', 'Alice Exemplo')).toBe(true);
    expect(mesmoNome('alice exemplo', 'Alice Exemplo')).toBe(true);
    expect(mesmoNome('Alice Um', 'Alice Dois')).toBe(false);
    expect(mesmoNome('Ali', 'Alice')).toBe(false);
  });

  it('dono no frontmatter: link, texto, lista YAML e "os três"', () => {
    expect(donoDoFrontmatter('---\ndono: "[[Alice]]"\n---\n')).toBe('[[Alice]]');
    expect(donoDoFrontmatter('---\ndono: Bruno\n---\n')).toBe('Bruno');
    expect(donoDoFrontmatter('---\ndono:\n  - Bruno\n  - Clara\n---\n')).toBe('Bruno, Clara');
    expect(donoDoFrontmatter('---\ndono: [Alice, Bruno]\n---\n')).toBe('Alice, Bruno');
    expect(donoDoFrontmatter('sem frontmatter')).toBeNull();
  });

  it('a seção "## Dono das funções" para no próximo título do mesmo nível', () => {
    const nota = '# X\n\n## Dono das funções\n\n- [[Função — Comercial]]\n- Produto\n\n## Contato\n\n- [[Função — Outra]]\n';
    expect(funcoesDaSecaoDono(nota)).toEqual(['Função — Comercial', 'Produto']);
  });
});

describe('o dublê do vault', () => {
  const leitura = lerVault(notasDoDuble());

  it('acha a Governança, os três sócios e as seis funções', () => {
    expect(leitura.temGovernanca).toBe(true);
    expect(sociosDoVault(leitura).sort()).toEqual(['Alice', 'Bruno', 'Clara']);
    expect(leitura.funcoes.map((f) => f.nome)).toEqual(['Comercial', 'Conteúdo', 'Financeiro', 'Governança', 'Implantação', 'Produto']);
  });

  it('Alice: conduz, é dona (com a ficha para o Contexto) e é substituta', () => {
    const a = atribuicoesDaPessoa(leitura, 'Alice', 'perfil');
    expect(a.conduz).toBe('Comercial e relacionamento');
    expect(a.dona.map((f) => f.nome)).toEqual(['Comercial', 'Governança', 'Implantação']);
    expect(a.substituta.map((f) => f.nome)).toEqual(['Produto']);
    const comercial = a.dona.find((f) => f.nome === 'Comercial')!;
    expect(comercial).toMatchObject({
      caminho: '30-Organizacao/Função — Comercial.md',
      notaId: 'nota:30-Organizacao/Função — Comercial.md',
      estado: 'ativo',
      agentes: 'Qualificador, Agendador',
    });
    expect(a.nota).toEqual({ caminho: '20-Governanca/Alice.md', notaId: 'nota:20-Governanca/Alice.md' });
  });

  it('"os três" vale para cada sócio da tabela; substituta não repete o que já é dona', () => {
    for (const nome of ['Alice', 'Bruno', 'Clara']) {
      expect(atribuicoesDaPessoa(leitura, nome, 'perfil').dona.map((f) => f.nome)).toContain('Governança');
    }
    const clara = atribuicoesDaPessoa(leitura, 'Clara', 'sugerido');
    expect(clara.dona.map((f) => f.nome)).toEqual(['Financeiro', 'Governança']);
    expect(clara.substituta.map((f) => f.nome)).toEqual(['Conteúdo', 'Implantação']);
    expect(clara.origemDoNome).toBe('sugerido');
  });

  it('quem não é sócio do vault não ganha nada, nem o "os três"; sem nome, [a decidir]', () => {
    const davi = atribuicoesDaPessoa(leitura, 'Davi', 'perfil');
    expect(davi.dona).toEqual([]);
    expect(davi.substituta).toEqual([]);
    expect(atribuicoesDaPessoa(leitura, null, 'a_decidir')).toMatchObject({ nomeNoVault: null, origemDoNome: 'a_decidir', dona: [] });
  });

  it('sem as notas da Governança e da Organização, a leitura diz que não achou', () => {
    expect(lerVault([{ caminho: '10-Outra/Nota.md', conteudo: '# nada', notaId: null }]).temGovernanca).toBe(false);
  });
});
