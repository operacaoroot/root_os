import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { NAV, PERMISSIONS, ROLES, type RoleKey } from '@mktos/shared';
import { alcadaDe, temPapelDeMaquina } from '../../../api/src/approvals/alcada.js';

/*
 * O DESENCONTRO DE PERMISSÃO DA FILA DE APROVAÇÃO — fatia 3.10, RF-A-05.
 *
 * O defeito era literal: `packages/shared/src/nav.ts` declarava `/atendimento`
 * com `whatsapp.enviar` e `apps/api/src/approvals/approvals.controller.ts`
 * exigia `mcp.executar`. Quem via a tela levava 403 ao usá-la, e quem podia
 * usá-la não via a tela.
 *
 * Esta suíte é a catraca dos DOIS lados do conserto, e ela prova três coisas
 * que, juntas, são a fatia:
 *
 *  1. menu e API pedem a MESMA chave, e ela é de aprovação — não de canal
 *     (`whatsapp.enviar`) nem de execução de ferramenta (`mcp.executar`);
 *  2. NENHUMA conta de máquina alcança a fila. `ia_servico` (read-only por
 *     desenho) e `ia_acao` carregam `mcp.executar`: alinhar o menu nela teria
 *     dado às duas o alcance da tela que mostra o conteúdo exato de toda ação
 *     retida. Este caso reprova se alguém devolver a permissão para lá;
 *  3. quem pode DECIDIR na tela é exatamente quem tem ALÇADA para assinar. As
 *     duas listas moram em arquivos diferentes (`permissions.ts` e
 *     `approvals/alcada.ts`) e é aqui que elas ficam presas uma à outra — sem
 *     isto, o Diretor continuaria sendo o único papel com alçada `titular` sem
 *     conseguir abrir a fila que só ele libera.
 */

const RAIZ = join(__dirname, '..', '..', '..', '..');

/** O código-fonte sem comentário: a explicação não pode satisfazer a catraca. */
const fonte = (caminho: string) =>
  readFileSync(join(RAIZ, caminho), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

const CONTROLLER = 'apps/api/src/approvals/approvals.controller.ts';
const papeis = Object.keys(ROLES) as RoleKey[];
const tem = (papel: RoleKey, chave: string) =>
  (ROLES[papel].permissions as readonly string[]).includes(chave);
const quemTem = (chave: string) => papeis.filter((p) => tem(p, chave));

describe('as chaves existem no catálogo', () => {
  it('`aprovacoes.ver` e `aprovacoes.decidir` estão em PERMISSIONS', () => {
    // Sem isto `@RequirePermissions('aprovacoes.ver')` nem compila — o decorator
    // é tipado pela união de PERMISSIONS.
    expect(PERMISSIONS).toContain('aprovacoes.ver');
    expect(PERMISSIONS).toContain('aprovacoes.decidir');
  });
});

describe('o menu e a API pedem a mesma coisa', () => {
  it('o item /atendimento exige `aprovacoes.ver`', () => {
    const item = NAV.find((n) => n.key === 'atendimento')!;
    expect(item.href).toBe('/atendimento');
    expect(item.permission).toBe('aprovacoes.ver');
  });

  it('a rota que LISTA a fila exige a mesma chave do menu', () => {
    const src = fonte(CONTROLLER);
    // As duas constantes do controller, lidas do próprio arquivo: se alguém
    // trocar o valor delas, este caso cai junto.
    expect(src).toMatch(/const VER = 'aprovacoes\.ver'/);
    expect(src).toMatch(/const DECIDIR = 'aprovacoes\.decidir'/);

    const item = NAV.find((n) => n.key === 'atendimento')!;
    expect(src).toContain(`const VER = '${item.permission}'`);
    // e a rota da fila é a que a tela chama
    expect(src).toContain("@Get('fila')");
  });

  it('confirmar e rejeitar exigem DECIDIR, e não mais `mcp.executar`', () => {
    const src = fonte(CONTROLLER);
    const linhas = src.split('\n');
    const exigenciaDe = (rota: string) => {
      const i = linhas.findIndex((l) => l.includes(rota));
      expect(i, `rota ${rota} sumiu do controller`).toBeGreaterThan(-1);
      return linhas[i + 1].match(/@RequirePermissions\(([^)]+)\)/)?.[1] ?? null;
    };
    expect(exigenciaDe("@Post(':id/confirm')")).toBe('DECIDIR');
    expect(exigenciaDe("@Post(':id/reject')")).toBe('DECIDIR');
    expect(exigenciaDe("@Get(':id')")).toBe('VER');
  });

  it('PROPOR continua sendo `mcp.executar` — pedir não é assinar', () => {
    // `/pauta` propõe pela superfície antiga e executa com o token. Se propor
    // passasse a pedir `aprovacoes.*`, a conta que AGE viraria a que autoriza —
    // o contrário do que a fatia separou.
    const src = fonte(CONTROLLER);
    expect(src).toMatch(/@Post\(\)\n\s*@RequirePermissions\('mcp\.executar'\)/);
  });
});

describe('nenhuma conta de máquina alcança a fila', () => {
  it('`ia_servico` e `ia_acao` não têm ver nem decidir', () => {
    for (const maquina of ['ia_servico', 'ia_acao'] as RoleKey[]) {
      expect(temPapelDeMaquina([maquina]), `${maquina} deveria ser máquina`).toBe(true);
      expect(tem(maquina, 'aprovacoes.ver'), `${maquina} não pode VER a fila`).toBe(false);
      expect(tem(maquina, 'aprovacoes.decidir'), `${maquina} não pode DECIDIR`).toBe(false);
    }
  });

  it('e o motivo de o desencontro ser perigoso continua verdadeiro', () => {
    // Este caso existe para o dia em que alguém pensar "é só usar mcp.executar":
    // ela mora nas duas contas de serviço, e é isso que torna a escolha errada.
    expect(tem('ia_servico', 'mcp.executar')).toBe(true);
    expect(tem('ia_acao', 'mcp.executar')).toBe(true);
  });

  it('quem decide, segundo o catálogo de papéis, é sempre gente com alçada', () => {
    for (const papel of quemTem('aprovacoes.decidir')) {
      expect(temPapelDeMaquina([papel]), `${papel} é conta de máquina`).toBe(false);
      expect(alcadaDe([papel]), `${papel} decide sem alçada nenhuma`).not.toBeNull();
    }
  });
});

describe('a permissão e a alçada não podem divergir', () => {
  /*
   * A REGRA, E A DIREÇÃO DELA — que mudou na correção da fatia.
   *
   * Alçada é condição NECESSÁRIA para decidir, nunca suficiente: quem tem o
   * verbo `aprovacoes.decidir` precisa ter alçada que alcance R3, senão o botão
   * existe e a trava de `confirm` o recusa. O contrário NÃO vale — ter alçada
   * não concede o verbo. Quem assina o quê é decisão de operação.
   *
   * A primeira versão desta suíte cobrava a ida e a volta ("todo papel com
   * alçada decide"), e com isso a catraca CONCEDIA permissão sozinha: bastou
   * `financeiro` ter alçada `responsavel` para ele ganhar o direito de autorizar
   * envio externo — uma escolha nova, tomada por um teste, no meio de uma fatia
   * que era só para consertar um desencontro. Ver o bloco "QUEM RECEBE
   * `aprovacoes.decidir`" em `packages/shared/src/permissions.ts`.
   */
  it('quem decide tem alçada que alcança R3 — a condição necessária', () => {
    for (const papel of quemTem('aprovacoes.decidir')) {
      const alcada = alcadaDe([papel]);
      expect(
        alcada === 'responsavel' || alcada === 'titular',
        `${papel} decide na fila com alçada "${alcada}": o botão apareceria e confirm recusaria`,
      ).toBe(true);
      expect(tem(papel, 'aprovacoes.ver'), `${papel} decide e não vê a fila`).toBe(true);
    }
  });

  it('e ter alçada NÃO concede o verbo: o Financeiro é o caso, e é pergunta em aberto', () => {
    /*
     * `financeiro` tem alçada `responsavel` (alcança R3) e NÃO decide na fila.
     * Não é esquecimento: dar-lhe a assinatura o faria autorizar saída externa
     * — hoje, mensagem de WhatsApp — que ele próprio não executa. É decisão do
     * Pedro, está no relatório da fatia, e este caso existe para que ela seja
     * TOMADA em vez de aparecer de lado num `for`.
     */
    expect(alcadaDe(['financeiro'])).toBe('responsavel');
    expect(tem('financeiro', 'aprovacoes.ver')).toBe(true);
    expect(tem('financeiro', 'aprovacoes.decidir')).toBe(false);
  });

  it('os papéis que o desencontro quebrou decidem: Admin Master, Diretor e Gestor', () => {
    for (const papel of ['admin_master', 'diretor', 'gestor_marketing'] as RoleKey[]) {
      expect(tem(papel, 'aprovacoes.ver'), `${papel} não vê a fila`).toBe(true);
      expect(tem(papel, 'aprovacoes.decidir'), `${papel} não decide na fila`).toBe(true);
    }
  });

  it('o Diretor, que é titular, enfim alcança a fila', () => {
    expect(alcadaDe(['diretor'])).toBe('titular');
    expect(tem('diretor', 'aprovacoes.ver')).toBe(true);
    expect(tem('diretor', 'aprovacoes.decidir')).toBe(true);
    // e continua sem a permissão que a rota exigia antes — é essa a prova de
    // que o conserto não foi "dar mcp.executar para mais gente"
    expect(tem('diretor', 'mcp.executar')).toBe(false);
  });

  it('quem decide também vê: decidir sem ver seria um botão sem tela', () => {
    for (const papel of quemTem('aprovacoes.decidir')) {
      expect(tem(papel, 'aprovacoes.ver'), `${papel}`).toBe(true);
    }
  });

  it('operador vê a fila e não assina — a alçada dele só alcança R2', () => {
    for (const papel of ['analista', 'social_media'] as RoleKey[]) {
      expect(alcadaDe([papel])).toBe('operador');
      expect(tem(papel, 'aprovacoes.ver')).toBe(true);
      expect(tem(papel, 'aprovacoes.decidir')).toBe(false);
    }
  });

  it('consulta limitada não vê a fila: ela mostra o conteúdo do que vai sair', () => {
    expect(alcadaDe(['consulta_limitada'])).toBeNull();
    expect(tem('consulta_limitada', 'aprovacoes.ver')).toBe(false);
    expect(tem('consulta_limitada', 'aprovacoes.decidir')).toBe(false);
  });
});

describe('a fila deixou de ser tela de um perfil só', () => {
  it('mais de um papel abre /atendimento — antes era só o Admin Master', () => {
    const item = NAV.find((n) => n.key === 'atendimento')!;
    const veem = quemTem(item.permission);
    expect(veem).toContain('admin_master');
    expect(veem).toContain('diretor');
    expect(veem).toContain('gestor_marketing');
    expect(veem.length).toBeGreaterThan(3);
    // `whatsapp.enviar` era a permissão antiga do item, e ela segue existindo
    // (a rota de publicação da pauta a usa) — só não governa mais esta tela.
    expect(PERMISSIONS).toContain('whatsapp.enviar');
    expect(quemTem('whatsapp.enviar')).toEqual(['admin_master']);
  });
});
