import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ProvedorExcluidoError,
  RECUSA_DO_PROVEDOR_EXCLUIDO,
  provedorDoAmbiente,
} from '../src/comercial/canais/whatsapp.port';
import { WhatsappComercialService } from '../src/comercial/whatsapp.service';

/*
 * A CATRACA DO WHATSAPP QUE SAIU — rodada dos agentes, lane A6 (21/10/2026).
 *
 * O DigiSac e o Zapfy foram EXCLUÍDOS do código, não escondidos: o WhatsApp do
 * OS é a Evolution. Esconder deixava o código vivo, as variáveis no compose e a
 * credencial no cofre, e bastava um `.env` antigo para o provedor voltar a
 * valer. Esta catraca procura os dois nomes, sem diferença de maiúscula, em todo
 * arquivo de texto de `apps/` e `packages/`, e falha se achar.
 *
 * O QUE FICA DE FORA, e por quê:
 *   · `prisma/migrations/` — o histórico do banco é imutável (as antigas criaram o
 *     que existiu; a `20261021360000_cofre_sem_digisac` apaga a credencial);
 *   · `node_modules`, `dist`, `.next`, `coverage` — não são fonte;
 *   · a lista `PODE_CITAR`, cada uma com o motivo e com um TETO de citações, para
 *     que a exceção não vire porta: quem citar o nome uma vez a mais lá dentro
 *     também deixa a catraca vermelha.
 */

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const PASTAS = ['apps', 'packages'];
const IGNORADAS = new Set(['node_modules', 'dist', '.next', 'coverage', '.turbo', 'build']);
const NOMES = /digisac|zapfy/gi;

/** Arquivo → quantas citações ele pode ter, e o motivo. */
const PODE_CITAR: Record<string, { teto: number; porque: string }> = {
  // A recusa do arranque precisa dizer o valor que ela recusa.
  'apps/api/src/comercial/canais/whatsapp.port.ts': {
    teto: 6,
    porque: 'a recusa de WHATSAPP_PROVEDOR=digisac no arranque, com a frase que diz o que trocar',
  },
  // O cadastro único (Lane 0) registra a função CA-01 como aposentada, e o teste dele confere isso.
  'packages/shared/src/agentes.ts': { teto: 3, porque: 'a função CA-01, aposentada, no cadastro único' },
  'apps/api/test/agentes-cadastro.test.ts': { teto: 4, porque: 'o teste do cadastro que exige a CA-01 aposentada' },
  // Esta própria catraca.
  'apps/api/test/sem-digisac.test.ts': { teto: 40, porque: 'a catraca' },
};

function ehMigration(rel: string): boolean {
  return /(^|\/)prisma\/migrations\//.test(rel);
}

function listar(): string[] {
  const saida: string[] = [];
  const andar = (dir: string) => {
    for (const entrada of readdirSync(dir)) {
      const completo = path.join(dir, entrada);
      const st = statSync(completo);
      if (st.isDirectory()) {
        if (IGNORADAS.has(entrada)) continue;
        andar(completo);
        continue;
      }
      const rel = path.relative(RAIZ, completo).split(path.sep).join('/');
      if (ehMigration(rel)) continue;
      saida.push(rel);
    }
  };
  for (const p of PASTAS) andar(path.join(RAIZ, p));
  return saida.sort();
}

function ehTexto(buf: Buffer): boolean {
  // Binário (imagem, fonte) tem byte nulo cedo; texto não.
  return !buf.subarray(0, 8000).includes(0);
}

const ARQUIVOS = listar();

describe('o DigiSac e o Zapfy não existem mais no código', () => {
  it('a varredura entrou em apps/ e em packages/ (a catraca não pode passar por não ler nada)', () => {
    expect(ARQUIVOS.some((a) => a.startsWith('apps/api/src/'))).toBe(true);
    expect(ARQUIVOS.some((a) => a.startsWith('apps/web/src/'))).toBe(true);
    expect(ARQUIVOS.some((a) => a.startsWith('packages/shared/src/'))).toBe(true);
    expect(ARQUIVOS.length).toBeGreaterThan(500);
  });

  it('nenhum arquivo tem o nome no caminho', () => {
    const comNome = ARQUIVOS.filter((a) => /digisac|zapfy/i.test(a) && !(a in PODE_CITAR));
    expect(comNome, 'arquivos que deviam ter sido apagados').toEqual([]);
  });

  it('nenhum arquivo de apps/ ou packages/ cita o nome, fora das exceções com teto', () => {
    const achados: string[] = [];
    for (const rel of ARQUIVOS) {
      const buf = readFileSync(path.join(RAIZ, rel));
      if (!ehTexto(buf)) continue;
      const texto = buf.toString('utf8');
      const n = texto.match(NOMES)?.length ?? 0;
      if (!n) continue;
      const excecao = PODE_CITAR[rel];
      if (excecao && n <= excecao.teto) continue;
      achados.push(excecao ? `${rel}: ${n} citações (teto ${excecao.teto}: ${excecao.porque})` : `${rel}: ${n} citação(ões)`);
    }
    expect(achados, 'o DigiSac e o Zapfy foram excluídos em 21/10/2026; o WhatsApp é a Evolution').toEqual([]);
  });

  it('as exceções existem de verdade (exceção para arquivo que não existe é exceção esquecida)', () => {
    for (const rel of Object.keys(PODE_CITAR)) expect(ARQUIVOS, rel).toContain(rel);
  });

  it('o compose não declara mais nenhuma variável DIGISAC_*', () => {
    const compose = readFileSync(path.join(RAIZ, 'docker-compose.yml'), 'utf8');
    expect(compose).not.toMatch(/DIGISAC_/);
    expect(compose).not.toMatch(/zapfy/i);
  });
});

describe('WHATSAPP_PROVEDOR=digisac é recusado no arranque', () => {
  const antes = process.env.WHATSAPP_PROVEDOR;
  afterEach(() => {
    if (antes === undefined) delete process.env.WHATSAPP_PROVEDOR;
    else process.env.WHATSAPP_PROVEDOR = antes;
  });

  it('a frase diz o que aconteceu e o que trocar', () => {
    expect(RECUSA_DO_PROVEDOR_EXCLUIDO).toMatch(/o DigiSac foi excluído em 21\/10\/2026: use WHATSAPP_PROVEDOR=evolution ou simulado/i);
  });

  it('provedorDoAmbiente lança com o valor antigo, sem diferença de maiúscula nem espaço', () => {
    for (const v of ['digisac', 'DigiSac', '  DIGISAC ']) {
      expect(() => provedorDoAmbiente(v)).toThrow(ProvedorExcluidoError);
      expect(() => provedorDoAmbiente(v)).toThrow(RECUSA_DO_PROVEDOR_EXCLUIDO);
    }
  });

  it('os valores que valem continuam valendo', () => {
    expect(provedorDoAmbiente('evolution')).toBe('evolution');
    expect(provedorDoAmbiente('simulado')).toBe('simulado');
    expect(provedorDoAmbiente('')).toBe('simulado');
    expect(provedorDoAmbiente(undefined)).toBe('simulado');
  });

  it('o serviço do WhatsApp do comercial NÃO é construído com o valor antigo (é isso que derruba o arranque)', () => {
    process.env.WHATSAPP_PROVEDOR = 'digisac';
    const nada = {} as never;
    expect(() => new WhatsappComercialService(nada, nada, nada, nada, nada, nada, nada)).toThrow(RECUSA_DO_PROVEDOR_EXCLUIDO);
    process.env.WHATSAPP_PROVEDOR = 'simulado';
    expect(new WhatsappComercialService(nada, nada, nada, nada, nada, nada, nada).porta.provedor).toBe('simulado');
  });
});
