/**
 * A catraca do isolamento — RF-T-01
 * =================================
 *
 * A regra do sistema é uma só: todo modelo carrega `orgId`. As exceções estão
 * declaradas em `src/common/modelos-globais.ts`. Este arquivo é o que cobra a
 * declaração: lê o `schema.prisma`, cruza com aquelas listas e REPROVA quando
 * schema e declaração contam histórias diferentes.
 *
 * POR QUE ELE NÃO MORA EM tenant-isolation.test.ts
 * Morava. E não reprovava nada. O arquivo de isolamento fica fora do `pnpm test`
 * padrão e, na integração contínua, roda com `continue-on-error` enquanto o
 * isolamento por linha não estiver ligado no banco — que é o certo para a linha
 * de base de RLS e o errado para uma catraca: ela acusava e o check ficava
 * verde. Aqui os casos entram no conjunto padrão e derrubam a suíte.
 *
 * POR QUE ELE NÃO ABRE CONEXÃO
 * De propósito. Tudo aqui se responde lendo o `schema.prisma` e as listas do
 * código, e é isso que permite rodar no `pnpm test` de qualquer máquina, sem
 * banco, sem variável de ambiente e sem pular sozinho — "pulou" e "passou" são
 * indistinguíveis num relatório, e é assim que catraca morre.
 * O que precisa de banco (existe a coluna? existe o gatilho? o valor gravado
 * bate com o do pai?) fica em `tenant-isolation.test.ts`.
 *
 * POR QUE LER O SCHEMA E NÃO O `Prisma.dmmf`
 * O client gerado pode estar velho — basta ninguém ter rodado `db:generate`. Um
 * teste que valida o schema contra uma cópia desatualizada dele não valida nada.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  FILHOS_COM_ORGID_REDUNDANTE,
  MODELOS_ESCOPO_OPCIONAL,
  MODELOS_GLOBAIS,
  paisDoFilho,
} from '../src/common/modelos-globais';

// ---------------------------------------------------------------------------
// Leitura do schema
// ---------------------------------------------------------------------------

/** Sobe até apps/api. Vitest roda com cwd lá, mas a CI pode invocar de fora. */
function acharRaizDaApi(): string {
  const marco = path.join('prisma', 'schema.prisma');
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, marco))) return dir;
    if (existsSync(path.join(dir, 'apps', 'api', marco))) return path.join(dir, 'apps', 'api');
    const pai = path.dirname(dir);
    if (pai === dir) break;
    dir = pai;
  }
  throw new Error(`Não encontrei apps/api/prisma/schema.prisma a partir de "${process.cwd()}".`);
}

interface CampoDoSchema {
  /** O token de tipo como está escrito: `String`, `String?`, `WorkTask[]`... */
  tipo: string;
  /** A linha inteira, para quando o que importa é um atributo (`@default("")`). */
  linha: string;
}

/** Modelo -> (campo -> tipo e linha crua), lido do PRÓPRIO schema.prisma. */
function modelosDoSchema(): Map<string, Map<string, CampoDoSchema>> {
  const texto = readFileSync(path.join(acharRaizDaApi(), 'prisma', 'schema.prisma'), 'utf8');
  const modelos = new Map<string, Map<string, CampoDoSchema>>();
  const bloco = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = bloco.exec(texto)) !== null) {
    const campos = new Map<string, CampoDoSchema>();
    for (const crua of m[2].split('\n')) {
      const linha = crua.trim();
      if (linha === '' || linha.startsWith('//') || linha.startsWith('@@')) continue;
      const partes = linha.split(/\s+/);
      campos.set(partes[0], { tipo: partes[1] ?? '', linha });
    }
    modelos.set(m[1], campos);
  }
  return modelos;
}

const modelos = modelosDoSchema();

/** Nomes de modelo que têm o campo, independentemente de tipo. */
function comCampo(campo: string): string[] {
  return [...modelos.entries()]
    .filter(([, campos]) => campos.has(campo))
    .map(([nome]) => nome)
    .sort();
}

function orgIdDe(modelo: string): CampoDoSchema | undefined {
  return modelos.get(modelo)?.get('orgId');
}

// ---------------------------------------------------------------------------
// 1. O teste que impede esta suíte de passar vazia
// ---------------------------------------------------------------------------

describe('leitura do schema', () => {
  it('o schema foi lido de verdade (senão o resto deste arquivo passaria vazio)', () => {
    expect(
      modelos.size,
      'A leitura do schema.prisma devolveu quase nada — a expressão de bloco quebrou com alguma mudança de formatação.',
    ).toBeGreaterThan(50);
    expect([...modelos.keys()]).toContain('Org');
    expect(orgIdDe('Lead')?.tipo, 'Lead perdeu o orgId? Mais provável: o parser de campos quebrou.').toBe('String');
  });
});

// ---------------------------------------------------------------------------
// 2. Todo modelo tem empresa OU está declarado global
// ---------------------------------------------------------------------------

describe('modelos globais por desenho (lista versionada)', () => {
  it('todo modelo do schema tem orgId OU está declarado global', () => {
    const semColuna = [...modelos.entries()]
      .filter(([, campos]) => !campos.has('orgId'))
      .map(([nome]) => nome)
      .sort();
    const declarados = MODELOS_GLOBAIS.map((m) => m.modelo).sort();

    const naoDeclarados = semColuna.filter((n) => !declarados.includes(n));
    expect(
      naoDeclarados,
      '\nMODELO SEM orgId E SEM DECLARAÇÃO: ' + naoDeclarados.join(', ') + '\n' +
        '  Ou o modelo ganha orgId (é o padrão — inclusive filho de entidade de tenant carrega o do pai),\n' +
        '  ou entra em apps/api/src/common/modelos-globais.ts com o motivo e o que quebra se for escopado.\n' +
        '  "Esqueci a coluna" e "é global" não podem ser a mesma coisa aos olhos de quem lê o schema.\n',
    ).toEqual([]);

    const apodrecidos = declarados.filter((n) => !semColuna.includes(n));
    expect(
      apodrecidos,
      '\nDECLARADO GLOBAL MAS NÃO É MAIS: ' + apodrecidos.join(', ') + '\n' +
        '  O modelo ganhou orgId (ou sumiu do schema). Tire da lista — declaração que não corresponde\n' +
        '  ao schema é pior do que lista nenhuma: ela autoriza o que já não existe.\n',
    ).toEqual([]);
  });

  it.each(MODELOS_GLOBAIS.map((g) => [g.modelo, g] as const))(
    '%s tem justificativa escrita e o que quebra se for escopado',
    (_nome, global) => {
      expect(global.porQue.length, `A justificativa de ${global.modelo} está vazia.`).toBeGreaterThan(20);
      expect(
        global.quebraSe.length,
        `Ninguém escreveu o que quebra se ${global.modelo} for escopado — e é essa frase que separa ` +
          '"decidi que é global" de "esqueci a coluna".',
      ).toBeGreaterThan(20);
    },
  );
});

// ---------------------------------------------------------------------------
// 3. Nulidade: a catraca não pode conferir só a presença do nome do campo
//
// Um modelo novo com `orgId String?` e sem declaração nenhuma passava em tudo
// acima — o campo está lá, o nome bate. Só que linha com empresa nula escapa de
// `orgId = atual` em qualquer política de linha. Quem pode ser anulável é uma
// categoria fechada, com significado escrito para o nulo.
// ---------------------------------------------------------------------------

describe('nulidade do orgId', () => {
  const anulaveisNoSchema = [...modelos.entries()]
    .filter(([, campos]) => campos.get('orgId')?.tipo.endsWith('?'))
    .map(([nome]) => nome)
    .sort();
  const declaradosOpcionais = MODELOS_ESCOPO_OPCIONAL.map((m) => m.modelo).sort();

  it('orgId ANULÁVEL só em modelo declarado em MODELOS_ESCOPO_OPCIONAL', () => {
    const clandestinos = anulaveisNoSchema.filter((n) => !declaradosOpcionais.includes(n));
    expect(
      clandestinos,
      '\norgId ANULÁVEL SEM DECLARAÇÃO: ' + clandestinos.join(', ') + '\n' +
        '  Linha com empresa nula não é filtrada por `orgId = atual`: ela escapa da política de linha\n' +
        '  e aparece para todo mundo. Ou o campo vira obrigatório, ou o modelo entra em\n' +
        '  MODELOS_ESCOPO_OPCIONAL dizendo o que o nulo significa ali.\n' +
        '  Conferir só o NOME do campo deixaria isto passar — é por isso que este caso existe.\n',
    ).toEqual([]);
  });

  it('todo modelo de MODELOS_ESCOPO_OPCIONAL realmente tem orgId anulável', () => {
    for (const declarado of MODELOS_ESCOPO_OPCIONAL) {
      const campo = orgIdDe(declarado.modelo);
      expect(
        campo,
        `\n"${declarado.modelo}" está em MODELOS_ESCOPO_OPCIONAL mas não tem orgId no schema (sumiu ou foi renomeado).\n`,
      ).toBeDefined();
      expect(
        campo?.tipo.endsWith('?'),
        `\n"${declarado.modelo}"."orgId" deixou de ser anulável no schema.\n` +
          `  O nulo ali significava: ${declarado.nuloSignifica}\n` +
          '  Se a mudança foi de propósito, tire o modelo da lista e reveja a política de linha daquela tabela.\n',
      ).toBe(true);
    }
  });

  it('nenhum modelo aparece em duas categorias ao mesmo tempo', () => {
    const conjuntos: Array<[string, string[]]> = [
      ['MODELOS_GLOBAIS', MODELOS_GLOBAIS.map((m) => m.modelo)],
      ['MODELOS_ESCOPO_OPCIONAL', declaradosOpcionais],
      ['FILHOS_COM_ORGID_REDUNDANTE', FILHOS_COM_ORGID_REDUNDANTE.map((f) => f.modelo)],
    ];
    const repetidos: string[] = [];
    for (let i = 0; i < conjuntos.length; i++) {
      for (let j = i + 1; j < conjuntos.length; j++) {
        for (const nome of conjuntos[i][1]) {
          if (conjuntos[j][1].includes(nome)) {
            repetidos.push(`${nome} (${conjuntos[i][0]} e ${conjuntos[j][0]})`);
          }
        }
      }
    }
    expect(
      repetidos,
      '\nMODELO EM DUAS CATEGORIAS: ' + repetidos.join(', ') + '\n' +
        '  As três listas são excludentes: global (sem coluna), escopo opcional (coluna anulável) e\n' +
        '  filho com orgId derivado (coluna obrigatória + gatilho). Estar em duas é declaração contraditória.\n',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. A lista de filhos bate com o schema
//
// Sem isto, `FILHOS_COM_ORGID_REDUNDANTE` pode apodrecer em silêncio: um campo
// renomeado no schema não quebra nada, só faz o teste de isolamento conferir uma
// relação que não existe mais.
// ---------------------------------------------------------------------------

describe('filhos com orgId derivado do pai', () => {
  it.each(FILHOS_COM_ORGID_REDUNDANTE.map((f) => [f.modelo, f] as const))(
    '%s existe no schema, tem orgId obrigatório e todos os pais declarados existem',
    (_nome, filho) => {
      const campos = modelos.get(filho.modelo);
      expect(campos, `"${filho.modelo}" está declarado como filho mas não existe no schema.`).toBeDefined();

      const orgId = campos?.get('orgId');
      expect(orgId, `"${filho.modelo}" está declarado como filho e não tem orgId.`).toBeDefined();
      expect(
        orgId?.tipo,
        `\n"${filho.modelo}"."orgId" é anulável. Filho de tenant sem empresa é linha fora de qualquer política.\n`,
      ).toBe('String');

      for (const pai of paisDoFilho(filho)) {
        expect(
          campos?.has(pai.fk),
          `\n"${filho.modelo}" não tem o campo "${pai.fk}" que levaria ao pai "${pai.modelo}".\n` +
            '  Ou o campo foi renomeado no schema, ou a declaração em modelos-globais.ts está velha —\n' +
            '  e o gatilho do banco aponta para uma coluna que não existe mais.\n',
        ).toBe(true);
        expect(
          orgIdDe(pai.modelo),
          `\nO pai "${pai.modelo}" de "${filho.modelo}" não tem orgId no schema — não há de onde derivar.\n`,
        ).toBeDefined();
      }
    },
  );

  it('a sentinela @default("") aparece em EXATAMENTE os filhos declarados', () => {
    // A catraca contra quem copia o padrão sem registrar. `@default("")` no
    // orgId é a marca da sentinela: ela só faz sentido acompanhada do gatilho
    // que a substitui pelo orgId do pai. Modelo com a sentinela e sem declaração
    // é uma tabela que grava string vazia em produção até a FK derrubar a escrita.
    const comSentinela = comCampo('orgId')
      .filter((nome) => /@default\(\s*""\s*\)/.test(orgIdDe(nome)?.linha ?? ''))
      .sort();
    const declarados = FILHOS_COM_ORGID_REDUNDANTE.map((f) => f.modelo).sort();
    expect(
      comSentinela,
      '\nA sentinela @default("") e a lista de filhos divergiram.\n' +
        `  No schema: ${comSentinela.join(', ') || '(nenhum)'}\n` +
        `  Declarados: ${declarados.join(', ')}\n` +
        '  Quem copia o padrão do campo sem entrar na lista não ganha gatilho: a escrita grava a\n' +
        '  sentinela e a chave estrangeira contra Org derruba a operação — em produção, a cada escrita.\n' +
        '  A varredura do catálogo do banco, em tenant-isolation.test.ts, cobra o outro lado (o gatilho).\n',
    ).toEqual(declarados);
  });
});
