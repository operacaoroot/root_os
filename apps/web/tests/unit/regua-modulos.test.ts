import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { NAV } from '@mktos/shared';
import baseRoot from '../../../../packages/policy/politica-root.json';
import deltaMktos from '../../../../packages/policy/politica-marketing-os.json';
import {
  lerDelta,
  lerPolitica,
  resolverPolitica,
  type Politica,
} from '../../../../packages/policy/src/index.js';
import { simularAcao } from '../../../api/src/policy/simulador.js';
import {
  MODULO_POR_PREFIXO,
  PREFIXOS_DA_ESPINHA,
  PrefixoNaoDeclaradoError,
  catalogoVisivel,
  moduloDaCapacidade,
} from '../../../api/src/tenants/modulos.js';

/*
 * A RÉGUA E OS MÓDULOS DA EMPRESA — fatia 2.3 sobre a fatia de módulos (RF-T-06).
 *
 * Duas coisas são provadas aqui, e as duas foram reprovação de revisão:
 *
 *  1. O PREFIXO DA RÉGUA ESTÁ DECLARADO. Enquanto `policy` não estava em
 *     `PREFIXOS_DA_ESPINHA` nem em `MODULO_POR_PREFIXO`, a suíte da API ficava
 *     vermelha e o interceptor liberava a rota com erro no log. A régua é
 *     espinha: ela não desliga para empresa nenhuma.
 *
 *  2. O CATÁLOGO QUE O PAINEL ENTREGA É O DA EMPRESA. Ele saía inteiro — os
 *     identificadores, as rotas e os nomes de ferramenta de financeiro, pauta,
 *     leads, instagram, metas e pixels — para qualquer empresa autenticada,
 *     inclusive a que não contratou nada disso. É exatamente a superfície que a
 *     fatia de módulos por empresa existe para não mostrar.
 *
 * Estes módulos são puros (`modulos.ts` não conhece Nest nem Prisma), e é por
 * isso que dá para prová-los daqui, sem subir aplicação nenhuma.
 */

const RAIZ = join(__dirname, '..', '..', '..', '..');

const BASE: Politica = resolverPolitica(
  lerPolitica(baseRoot, 'politica-root.json'),
  lerDelta(deltaMktos, 'politica-marketing-os.json'),
);

/** O código-fonte sem comentário: a explicação não pode satisfazer a catraca. */
const fonte = (caminho: string) =>
  readFileSync(join(RAIZ, caminho), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

describe('o prefixo da régua está declarado', () => {
  it('`policy` é espinha do OS — não desliga para empresa nenhuma', () => {
    expect(PREFIXOS_DA_ESPINHA).toContain('policy');
    expect(Object.keys(MODULO_POR_PREFIXO)).not.toContain('policy');
  });

  it('e é mesmo o prefixo que o controller publica', () => {
    // Prefixo declarado que não existe no código é gate apontando para o vazio;
    // rota que existe sem prefixo declarado é a suíte da API vermelha. As duas
    // pontas têm de casar, e é esta linha que casa.
    const src = fonte('apps/api/src/policy/policy.controller.ts');
    expect(src).toContain("@Get('policy/regua')");
    expect(src).toContain("@Post('policy/simular')");
  });
});

describe('quem pode ver a régua', () => {
  /*
   * O CRITÉRIO DA FATIA: "um operador submete uma ação hipotética". Com
   * `admin.usuarios` — herdada da tela de usuários que virou aba — nenhum
   * operador conseguia: a permissão existe num perfil só. A convenção da casa
   * para painel de leitura é a permissão de VER do assunto da tela.
   */
  it('o menu e a API exigem a MESMA permissão, e ela é de ver', () => {
    const doMenu = NAV.find((n) => n.key === 'regua')!.permission;
    expect(doMenu).toBe('mcp.ver');

    const src = fonte('apps/api/src/policy/policy.controller.ts');
    const exigencias = [...src.matchAll(/@RequirePermissions\('([^']+)'\)/g)].map((m) => m[1]);
    expect(exigencias).toEqual([doMenu, doMenu]);
    expect(exigencias).not.toContain('admin.usuarios');
  });

  it('a aba de gente continua exigindo administrar gente — nas rotas dela', () => {
    // O afrouxamento da Régua não pode ter afrouxado a tela de usuários junto.
    // Quem protege aquela aba são as rotas que ela consome.
    const src = fonte('apps/api/src/users/users.controller.ts');
    const exigencias = [...src.matchAll(/@RequirePermissions\('([^']+)'\)/g)].map((m) => m[1]);
    expect(exigencias.length).toBeGreaterThanOrEqual(4);
    expect(new Set(exigencias)).toEqual(new Set(['admin.usuarios']));
  });
});

describe('o módulo de cada capacidade sai da rota declarada', () => {
  it('lê o caminho, ignorando o verbo e a query', () => {
    expect(moduloDaCapacidade('GET /finance/summary')).toBe('financeiro');
    expect(moduloDaCapacidade('PATCH /leads/:id')).toBe('leads');
    expect(moduloDaCapacidade('GET /tasks?overdue=1')).toBe('trabalho');
    expect(moduloDaCapacidade('POST /pauta/pecas/:id/publicar')).toBe('pauta');
    expect(moduloDaCapacidade('GET /meta/instagram/media')).toBe('instagram');
  });

  it('devolve nulo para espinha do OS e para capacidade sem rota', () => {
    expect(moduloDaCapacidade('GET /knowledge/search')).toBeNull();
    expect(moduloDaCapacidade('PUT /integrations/:key')).toBeNull();
    expect(moduloDaCapacidade('PATCH /users/:id')).toBeNull();
    // a maior parte do catálogo herdado da ROOT não declara rota HTTP nenhuma
    expect(moduloDaCapacidade(null)).toBeNull();
    expect(moduloDaCapacidade(undefined)).toBeNull();
    expect(moduloDaCapacidade('')).toBeNull();
  });

  it('prefixo não declarado LANÇA — quem chama decide o que fazer', () => {
    expect(() => moduloDaCapacidade('GET /inventado/x')).toThrow(PrefixoNaoDeclaradoError);
  });
});

describe('o painel não entrega o catálogo do que a empresa não contratou', () => {
  /** Uma empresa cliente enxuta: só o quadro de trabalho. */
  const SO_TRABALHO = new Set(['trabalho']);
  const visiveis = catalogoVisivel(BASE.capacidades, SO_TRABALHO);
  const ids = new Set(visiveis.map((c) => c.id));

  it('esconde as capacidades dos módulos desligados', () => {
    for (const escondida of [
      'financeiro.dre.ler',
      'financeiro.lancamento.criar',
      'financeiro.lancamento.excluir',
      'crm.lead.buscar',
      'pecas.campanha.listar',
      'social.instagram.resumo',
      'numeros.meta.ler',
      'numeros.evento.resumo',
      'whatsapp.mensagem.enviar', // publica por /pauta
      'relatorio.gerar',
    ]) {
      expect(ids.has(escondida), `"${escondida}" não podia aparecer`).toBe(false);
    }
    expect(visiveis.length).toBeLessThan(BASE.capacidades.length);
  });

  it('mantém o que é do módulo contratado e o que é espinha do OS', () => {
    for (const visivel of [
      'operacao.tarefa.listar', // /tasks -> trabalho
      'operacao.tarefa.alterar',
      'operacao.trabalho.estrutura',
      'contexto.memoria.buscar', // /knowledge -> espinha
      'comunicacao.email.buscar', // /google -> espinha
      'usuario.permissao.alterar', // /users -> espinha
      'credencial.rotacionar', // /integrations -> espinha
      'nfe.emitir', // sem rota declarada
    ]) {
      expect(ids.has(visivel), `"${visivel}" precisava aparecer`).toBe(true);
    }
  });

  it('empresa com tudo ligado continua vendo tudo', () => {
    const tudo = new Set(Object.values(MODULO_POR_PREFIXO));
    expect(catalogoVisivel(BASE.capacidades, tudo)).toHaveLength(BASE.capacidades.length);
  });

  /*
   * O SIMULADOR TAMBÉM. Sem isto, o filtro do painel seria fachada: bastava
   * pedir a simulação de `financeiro.dre.ler` para descobrir que ela existe, em
   * que degrau está e o que o efeito dela toca.
   */
  it('a capacidade escondida responde como uma inventada: bloqueada, sem vazar nada', () => {
    const doCliente: Politica = { ...BASE, capacidades: visiveis };

    const escondida = simularAcao(doCliente, { capabilityId: 'financeiro.dre.ler' });
    const inventada = simularAcao(doCliente, { capabilityId: 'nao.existe.mesmo' });

    expect(escondida.nivel).toBe(inventada.nivel);
    expect(escondida.permitido).toBe(false);
    expect(escondida.acao.origem).toBe('desconhecida');
    expect(escondida.acao.efeito).toBeNull();
    expect(escondida.gatilhos).toEqual([]);
    // e o texto não conta o que a capacidade seria
    expect(escondida.avisos.join(' ')).not.toContain('R0');
    expect(escondida.avisos.join(' ')).toContain('não está no catálogo desta empresa');

    // a mesma pergunta, na empresa que contratou financeiro, responde de verdade
    const comFinanceiro = catalogoVisivel(BASE.capacidades, new Set(['financeiro']));
    const r = simularAcao({ ...BASE, capacidades: comFinanceiro }, {
      capabilityId: 'financeiro.dre.ler',
    });
    expect(r.acao.origem).toBe('catalogo');
    expect(r.permitido).toBe(true);
  });

  it('prefixo não declarado mantém a capacidade visível, e grita', () => {
    // A mesma escolha do interceptor: sumir com metade do catálogo por causa de
    // uma linha esquecida na tabela seria trocar um vazamento possível por uma
    // tela quebrada certa.
    const gritos: string[] = [];
    const lista = [{ id: 'x', rota: 'GET /inventado/x' }, { id: 'y', rota: 'GET /leads' }];
    const vistos = catalogoVisivel(lista, new Set(['trabalho']), (e, c) =>
      gritos.push(`${c.id}: ${e.prefixo}`),
    );
    expect(vistos.map((c) => c.id)).toEqual(['x']);
    expect(gritos).toEqual(['x: inventado']);
  });
});
