import { describe, it, expect } from 'vitest';
import {
  NAV,
  NAV_DETALHE,
  ROTAS_ABSORVIDAS,
  ROLES,
  SECOES,
  MODULOS,
  navPorSecao,
  navEmArvore,
  moduloDaRotaDoWeb,
  type RoleKey,
} from '@mktos/shared';
import { ROTAS_ANTIGAS } from '../../rotas-antigas.mjs';
import { areasDaNota } from '@/app/contexto/grafo';

/*
 * Trava de não-regressão da reorganização do painel na lógica do ROOT OS.
 *
 * A promessa feita foi literal: "não perder nenhuma funcionalidade do painel".
 * Esta suíte é o que impede a promessa de virar boa intenção. Ela não congela a
 * aparência do menu — congela o que não pode se perder: toda tela que existia
 * continua alcançável, e nenhuma permissão foi afrouxada no caminho.
 */

/** O menu como estava antes da reorganização. Não editar sem motivo escrito. */
const ANTES: { key: string; href: string; permission: string }[] = [
  { key: 'dashboard', href: '/painel', permission: 'dashboard.ver' },
  { key: 'obsidian', href: '/obsidian', permission: 'obsidian.ver' },
  { key: 'documentos', href: '/documentos', permission: 'drive.ver' },
  { key: 'ia', href: '/ia', permission: 'mcp.ver' },
  { key: 'relatorios', href: '/relatorios', permission: 'relatorios.ver' },
  { key: 'trabalho', href: '/trabalho', permission: 'tarefas.ver' },
  { key: 'tarefas', href: '/tarefas', permission: 'tarefas.ver' },
  { key: 'automacoes', href: '/automacoes', permission: 'automacoes.ver' },
  { key: 'leads', href: '/leads', permission: 'leads.ver' },
  { key: 'funil', href: '/funil', permission: 'dashboard.ver' },
  { key: 'campanhas', href: '/campanhas', permission: 'campanhas.ver' },
  { key: 'pixels', href: '/pixels', permission: 'dashboard.ver' },
  { key: 'vendas', href: '/vendas', permission: 'dashboard.ver' },
  { key: 'conteudo', href: '/conteudo', permission: 'dashboard.ver' },
  { key: 'pauta', href: '/pauta', permission: 'pauta.ver' },
  { key: 'referencias', href: '/referencias', permission: 'pauta.ver' },
  { key: 'instagram', href: '/instagram', permission: 'instagram.ver' },
  { key: 'bio', href: '/bio', permission: 'bio.ver' },
  { key: 'metas', href: '/metas', permission: 'dashboard.ver' },
  { key: 'financeiro', href: '/financeiro', permission: 'financeiro.ver' },
  { key: 'whatsapp', href: '/whatsapp', permission: 'whatsapp.enviar' },
  { key: 'usuarios', href: '/usuarios', permission: 'admin.usuarios' },
  { key: 'auditoria', href: '/auditoria', permission: 'auditoria.ver' },
  { key: 'mcp', href: '/mcp', permission: 'mcp.ver' },
  { key: 'integracoes', href: '/integracoes', permission: 'dashboard.ver' },
  { key: 'google', href: '/google', permission: 'dashboard.ver' },
  { key: 'config', href: '/config', permission: 'dashboard.ver' },
];

/**
 * Para onde cada item de antes foi. `paraKey` é o item do NAV novo que assumiu
 * a função. `absorvido` marca o que virou conteúdo dentro de outra tela — e aí
 * a permissão do destino pode ser outra, o que é registrado no motivo.
 */
const DESTINO: Record<string, { paraKey: string; absorvido?: string }> = {
  dashboard: { paraKey: 'console' },
  obsidian: { paraKey: 'contexto' },
  documentos: {
    paraKey: 'contexto',
    absorvido: 'vira a aba Arquivos do Contexto; a aba é que exige drive.ver',
  },
  ia: { paraKey: 'sessoes' },
  relatorios: { paraKey: 'relatorios' },
  trabalho: { paraKey: 'trabalho' },
  tarefas: { paraKey: 'tarefas' },
  automacoes: { paraKey: 'rotinas' },
  leads: { paraKey: 'leads' },
  funil: { paraKey: 'funil' },
  campanhas: { paraKey: 'campanhas' },
  pixels: { paraKey: 'pixels' },
  vendas: {
    paraKey: 'pixels',
    absorvido: 'é o manual de instalação do pixel; a rota /vendas segue viva fora do menu',
  },
  conteudo: { paraKey: 'conteudo' },
  pauta: { paraKey: 'pauta' },
  referencias: { paraKey: 'referencias' },
  instagram: { paraKey: 'instagram' },
  bio: { paraKey: 'bio' },
  metas: { paraKey: 'metas' },
  financeiro: { paraKey: 'financeiro' },
  whatsapp: {
    paraKey: 'atendimento',
    absorvido:
      'o /whatsapp de antes era uma tela sem conector (o placeholder de módulo). O que está de ' +
      'pé em /atendimento é a FILA DE APROVAÇÃO, e ela não é de um canal: retém qualquer ' +
      'capacidade R2+ do catálogo. Por isso a permissão deixou de ser whatsapp.enviar (que só o ' +
      'Admin Master tem) e passou a ser aprovacoes.ver — a mesma que a API exige em ' +
      'approvals.controller.ts, fatia 3.10. A caixa de entrada por WhatsApp continua declarada ' +
      'em `parcial` e volta com o FinOps, com whatsapp.enviar na rota dela',
  },
  usuarios: {
    paraKey: 'regua',
    absorvido:
      'vira a aba "Quem autoriza" da Régua, e a aba é que exige admin.usuarios — ' +
      'users.controller.ts pede a permissão nas quatro rotas dela, e a tela esconde o botão ' +
      'de quem não tem. A Régua em si é painel de leitura e pede mcp.ver, como Agentes e ' +
      'Ferramentas: com admin.usuarios nenhum operador abriria o simulador, que é o critério ' +
      'da fatia 2.3',
  },
  auditoria: { paraKey: 'rastro' },
  mcp: { paraKey: 'ferramentas' },
  integracoes: { paraKey: 'conexoes' },
  google: {
    paraKey: 'conexoes',
    absorvido: 'o OAuth do Google é uma conexão; a rota /google segue viva como callback',
  },
  config: { paraKey: 'config' },
};

const porKey = new Map(NAV.map((n) => [n.key, n]));

describe('não se perdeu funcionalidade', () => {
  it('todo módulo de antes tem destino declarado, e o destino existe', () => {
    for (const velho of ANTES) {
      const destino = DESTINO[velho.key];
      expect(destino, `"${velho.key}" saiu do menu sem destino declarado`).toBeDefined();
      expect(porKey.has(destino.paraKey), `destino "${destino.paraKey}" não existe no NAV`).toBe(
        true,
      );
    }
  });

  it('nenhuma permissão foi afrouxada: quem herdou a tela exige a mesma coisa', () => {
    for (const velho of ANTES) {
      const { paraKey, absorvido } = DESTINO[velho.key];
      const novo = porKey.get(paraKey)!;
      if (absorvido) continue; // a exceção está escrita no próprio DESTINO
      expect(novo.permission, `${velho.key} → ${paraKey} mudou de permissão`).toBe(
        velho.permission,
      );
    }
  });

  it('toda rota antiga responde: ou continua no NAV, ou tem redirect, ou segue viva fora do menu', () => {
    const hrefsNovos = new Set(NAV.map((n) => n.href));
    const comRedirect = new Set(ROTAS_ANTIGAS.map((r: { de: string }) => r.de));
    const vivasForaDoMenu = new Set(ROTAS_ABSORVIDAS.map((r) => r.href));

    for (const velho of ANTES) {
      const ok =
        hrefsNovos.has(velho.href) || comRedirect.has(velho.href) || vivasForaDoMenu.has(velho.href);
      expect(ok, `${velho.href} ficaria sem resposta`).toBe(true);
    }
  });

  it('nenhum redirect aponta para uma rota que não existe', () => {
    const hrefsNovos = new Set(NAV.map((n) => n.href));
    for (const r of ROTAS_ANTIGAS as { de: string; para: string }[]) {
      const destino = r.para.split('?')[0];
      expect(hrefsNovos.has(destino), `${r.de} → ${r.para} aponta para rota inexistente`).toBe(
        true,
      );
    }
    for (const r of ROTAS_ABSORVIDAS) {
      expect(hrefsNovos.has(r.destino), `${r.href} → ${r.destino} não existe`).toBe(true);
    }
  });

  it('nenhuma rota absorvida aponta para fila duplicada: a fonte migrada do ClickUp é o Quadro interno', () => {
    const filasDuplicadas = new Set(['/tarefas', '/conteudo']);
    const hrefsNovos = new Set(NAV.map((n) => n.href));
    expect(hrefsNovos.has('/trabalho')).toBe(true);
    for (const r of ROTAS_ABSORVIDAS) {
      expect(filasDuplicadas.has(r.destino), `${r.href} → ${r.destino} é fila duplicada`).toBe(false);
    }
    // 18/10/2026 (rodada do painel P0): /conteudo saiu do menu e entrou como ORIGEM.
    // Ele continua item do NAV, oculto: a tela segue viva e a rota segue com dono.
    for (const h of filasDuplicadas) {
      const absorvida = ROTAS_ABSORVIDAS.some((r) => r.href === h);
      const item = NAV.find((n) => n.href === h);
      if (absorvida) expect(item?.oculto, `${h} absorvida precisa ser item oculto, tela viva`).toBe(true);
    }
  });

  it('redirect e página não disputam a mesma rota', () => {
    const hrefsNovos = new Set(NAV.map((n) => n.href));
    for (const r of ROTAS_ANTIGAS as { de: string }[]) {
      expect(hrefsNovos.has(r.de), `${r.de} tem redirect E item de menu — o redirect vence`).toBe(
        false,
      );
    }
  });
});

/*
 * O COCKPIT DO LEAD (módulo comercial, 13/10/2026): os destinos novos da seção
 * comercial, governados pelo módulo `leads`. Cada lane da passagem acrescenta
 * o seu aqui, e as contagens abaixo somam esta lista aos 39 da base.
 */
// Na ORDEM do menu (rodada do trabalho T6, 19/10/2026): cinco itens soltos e a
// fila de decisões oculta no fim, ainda dona de `/comercial`.
const COCKPIT: Record<string, { href: string; permission: string; label: string; oculto?: true }> = {
  'comercial-funil': { href: '/comercial/funil', permission: 'leads.ver', label: 'Funil vivo' },
  'comercial-contratos': { href: '/comercial/contratos', permission: 'leads.ver', label: 'Contratos vivos' },
  'comercial-simulador': { href: '/comercial/simulador', permission: 'leads.ver', label: 'Simulador de WhatsApp' },
  'comercial-torre': { href: '/comercial/torre', permission: 'leads.ver', label: 'Torre das automações' },
  'comercial-relatorio': { href: '/comercial/relatorio', permission: 'leads.ver', label: 'Relatório da semana' },
  'comercial-decisoes': { href: '/comercial', permission: 'leads.ver', label: 'Decisões do comercial', oculto: true },
};
const N_COCKPIT = Object.keys(COCKPIT).length;
const HREFS_DO_COCKPIT = Object.values(COCKPIT).map((c) => c.href);

/*
 * A RODADA DO PAINEL (18/10/2026): os destinos NOVOS que ela acrescenta, fora do
 * comercial. Somam às contagens como os do cockpit somaram. P3: o banco de atas,
 * pendurado no Trabalho, governado pelo módulo `trabalho`.
 */
const DA_RODADA_PAINEL: Record<string, { href: string; permission: string; label: string; secao: string; modulo: string; pai: string }> = {
  'trabalho-atas': { href: '/trabalho/atas', permission: 'tarefas.ver', label: 'Atas', secao: 'trabalho', modulo: 'trabalho', pai: 'trabalho' },
  // Rodada do trabalho T1 (19/10/2026): a implantação numa tela só, o kanban da lista Onboarding de cliente.
  implantacao: { href: '/trabalho/implantacao', permission: 'tarefas.ver', label: 'Implantação de clientes', secao: 'trabalho', modulo: 'trabalho', pai: 'trabalho' },
};
const N_DA_RODADA = Object.keys(DA_RODADA_PAINEL).length;
const HREFS_DA_RODADA = Object.values(DA_RODADA_PAINEL).map((c) => c.href);

describe('NAV — estrutura', () => {
  it('preserva as 33 rotas e acrescenta somente os seis destinos da frente MK', () => {
    const hrefsEsperados = new Set([
      '/caixa', '/atendimento', '/agenda', '/painel',
      '/contexto', '/organograma',
      '/tarefas', '/trabalho', '/onboarding',
      '/conteudo', '/pauta', '/referencias', '/instagram', '/bio',
      '/leads', '/funil', '/campanhas', '/pixels',
      '/relatorios', '/metas', '/financeiro', '/painel/custo-ia',
      '/agentes', '/rotinas', '/sessoes', '/fluxos',
      '/ferramentas', '/conexoes', '/regua', '/rastro',
      '/linha-do-tempo', '/assinatura', '/config',
    ]);
    expect(hrefsEsperados.size).toBe(33);
    const rotasMK = ['/contexto/marca', '/marketing', '/marketing/ideias',
      '/marketing/estrategia', '/marketing/performance', '/marketing/relatorio'];
    expect(NAV).toHaveLength(39 + N_COCKPIT + N_DA_RODADA);
    expect(new Set(NAV.map((n) => n.href))).toEqual(new Set([...hrefsEsperados, ...rotasMK, ...HREFS_DO_COCKPIT, ...HREFS_DA_RODADA]));
  });

  it('não repete chave nem rota', () => {
    expect(new Set(NAV.map((n) => n.key)).size).toBe(NAV.length);
    expect(new Set(NAV.map((n) => n.href)).size).toBe(NAV.length);
  });

  it('todo item tem rótulo, ícone, seção existente e módulo válido', () => {
    const secoes = new Set(SECOES.map((s) => s.key));
    const modulos = new Set<string>(MODULOS);
    for (const n of NAV) {
      expect(n.label.trim(), n.key).not.toBe('');
      expect(n.icon.trim(), n.key).not.toBe('');
      expect(secoes.has(n.secao), `${n.key}: seção inexistente`).toBe(true);
      if (n.modulo) expect(modulos.has(n.modulo), `${n.key}: módulo inexistente`).toBe(true);
    }
  });

  it('item marcado como parcial diz o que falta', () => {
    for (const n of NAV.filter((i) => i.estado === 'parcial')) {
      expect(n.parcial?.trim(), `${n.key} é parcial e não explica por quê`).toBeTruthy();
    }
  });

  it('agrupamento visual não altera a declaração individual dos módulos', () => {
    const modulosEsperados = new Map([
      ['tarefas', 'trabalho'], ['trabalho', 'trabalho'], ['onboarding', 'trabalho'],
      ['conteudo', 'conteudo'], ['pauta', 'pauta'], ['referencias', 'pauta'],
      ['instagram', 'instagram'], ['bio', 'bio'], ['leads', 'leads'],
      ['funil', 'leads'], ['campanhas', 'campanhas'], ['pixels', 'pixels'],
      ['relatorios', 'relatorios'], ['metas', 'metas'], ['financeiro', 'financeiro'],
      ['marca', 'pauta'], ['marketing', 'pauta'], ['marketing-ideias', 'pauta'],
      ['marketing-estrategia', 'pauta'], ['marketing-performance', 'pauta'], ['marketing-relatorio', 'pauta'],
      ...Object.keys(COCKPIT).map((k) => [k, 'leads'] as [string, string]),
      ...Object.entries(DA_RODADA_PAINEL).map(([k, v]) => [k, v.modulo] as [string, string]),
    ]);
    for (const n of NAV) expect(n.modulo).toBe(modulosEsperados.get(n.key));
  });

  it('as rotas de detalhe herdam a permissão do módulo pai', () => {
    for (const d of NAV_DETALHE) {
      const pai = porKey.get(d.parentKey);
      expect(pai, d.href).toBeDefined();
      expect(d.permission).toBe(pai!.permission);
    }
  });
});

describe('navPorSecao', () => {
  const todas = new Set(NAV.map((n) => n.permission));

  const visiveis = NAV.filter((n) => !n.oculto);

  it('com todas as permissões devolve todos os itens visíveis, sem repetir', () => {
    const itens = navPorSecao(todas).flatMap((g) => g.itens);
    expect(itens).toHaveLength(visiveis.length);
    expect(new Set(itens.map((i) => i.key)).size).toBe(visiveis.length);
  });

  it('preserva a ordem das seções e a ordem do NAV dentro de cada uma', () => {
    const ordem = SECOES.map((s) => s.key).filter((k) => visiveis.some((n) => n.secao === k));
    const grupos = navPorSecao(todas);
    expect(grupos.map((g) => g.secao.key)).toEqual(ordem);
    expect(grupos.flatMap((g) => g.itens.map((i) => i.key))).toEqual(
      ordem.flatMap((k) => visiveis.filter((n) => n.secao === k).map((n) => n.key)),
    );
  });

  it('destinos de apoio vêm depois dos grupos principais', () => {
    const tipos = navPorSecao(todas).map((g) => g.secao.tipo);
    expect(tipos.slice(0, 8)).toEqual(Array(8).fill('principal'));
    expect(tipos.slice(8)).toEqual(['apoio', 'apoio', 'apoio']);
  });

  it('sem permissão nenhuma não devolve seção nenhuma', () => {
    expect(navPorSecao(new Set())).toEqual([]);
  });

  it('mostra só o que a permissão libera e descarta a seção vazia', () => {
    const grupos = navPorSecao(new Set(['leads.ver']));
    expect(grupos).toHaveLength(1);
    expect(grupos[0].secao.key).toBe('comercial');
    // `leads` está oculto desde 18/10/2026: o cockpit absorve o MVP.
    // `comercial-decisoes` também, desde 19/10/2026: as decisões moram em Pendências.
    expect(grupos[0].itens.map((i) => i.key)).toEqual(Object.keys(COCKPIT).filter((k) => COCKPIT[k].permission === 'leads.ver' && !COCKPIT[k].oculto));
  });

  it('módulo desligado sai do menu; a espinha nunca sai', () => {
    const grupos = navPorSecao(todas, ['financeiro']);
    const chaves = grupos.flatMap((g) => g.itens.map((i) => i.key));
    expect(chaves).toContain('financeiro');
    expect(chaves).toContain('console'); // espinha
    expect(chaves).toContain('regua'); // espinha
    expect(chaves).not.toContain('leads');
    expect(chaves).not.toContain('pauta');
  });

  it('omitir a lista de módulos é o estado de hoje: todos ligados', () => {
    expect(navPorSecao(todas).flatMap((g) => g.itens)).toHaveLength(
      navPorSecao(todas, MODULOS).flatMap((g) => g.itens).length,
    );
  });

  it('aceita array, e não só Set', () => {
    // `auditoria.ver` abre as DUAS leituras do rastro desde a fatia A9: a prova
    // (`/rastro`) e a história (`/linha-do-tempo`). Na ordem do NAV.
    expect(navPorSecao(['auditoria.ver']).flatMap((g) => g.itens.map((i) => i.key))).toEqual([
      'rastro',
      'linha-do-tempo',
    ]);
  });

  /*
   * O CRITÉRIO DA FATIA 2.3 EM FORMA DE TESTE: "um operador submete uma ação
   * hipotética". Enquanto a Régua exigia `admin.usuarios`, ela aparecia para um
   * perfil só — o Admin Master. Nem o Diretor tinha. Este caso reprova se
   * alguém devolver a tela para uma permissão que operador nenhum carrega.
   */
  it('a Régua chega a quem opera, e não só ao Admin Master', () => {
    const regua = NAV.find((n) => n.key === 'regua')!;
    const veem = (Object.keys(ROLES) as RoleKey[]).filter((papel) =>
      (ROLES[papel].permissions as readonly string[]).includes(regua.permission),
    );
    expect(veem).toContain('gestor_marketing');
    expect(veem).toContain('analista');
    expect(veem).toContain('admin_master');
    expect(veem.length).toBeGreaterThan(3);
  });
});

/*
 * O SUBMENU (fatia A1 do docs/PLANO-CONTROLE-DE-AGENTES.md).
 *
 * Aninhar item de menu é mexer em ACESSO por acidente: o filho tem permissão e
 * módulo próprios, e a tentação é fazê-lo depender do pai. Estes casos travam
 * as duas coisas que não podem quebrar — nada desaparece, e o desenho não
 * inventa hierarquia onde o NAV não declarou.
 */
describe('navEmArvore', () => {
  const todas = new Set(NAV.map((n) => n.permission));
  const planos = (ps: Iterable<string>, mods?: Iterable<string>) =>
    navEmArvore(ps, mods).flatMap((g) => g.itens.flatMap((no) => [no.item, ...no.filhos]));

  it('não perde nem repete item nenhum em relação à lista plana', () => {
    const arvore = planos(todas).map((i) => i.key);
    const plana = navPorSecao(todas)
      .flatMap((g) => g.itens)
      .map((i) => i.key);
    expect(new Set(arvore)).toEqual(new Set(plana));
    expect(arvore).toHaveLength(plana.length);
  });

  it('o filho vem dentro do pai, e não no topo da seção', () => {
    const conteudo = navEmArvore(todas).find((g) => g.secao.key === 'conteudo')!;
    expect(conteudo.itens.map((no) => no.item.key)).not.toContain('referencias');
    const pauta = conteudo.itens.find((no) => no.item.key === 'pauta')!;
    expect(pauta.filhos.map((f) => f.key)).toEqual(['referencias']);
  });

  /*
   * O CASO QUE CUSTA ACESSO SE FOR ESQUECIDO, e que é real: `marca` pede
   * `pauta.ver` e o pai dele, `contexto`, pede `obsidian.ver`. Quem opera sem
   * `obsidian.ver` TEM a Marca — se o filho caísse com o pai, a tela sumiria do
   * menu sem nada acusar. (Até 18/10/2026 o exemplo era `funil` sob `leads`;
   * os dois saíram do menu, ocultos, na rodada do painel.)
   */
  it('filho cujo pai foi filtrado sobe para o primeiro nível, e não desaparece', () => {
    const grupos = navEmArvore(new Set(['pauta.ver']));
    const contexto = grupos.find((g) => g.secao.key === 'empresa')!;
    expect(contexto.itens.map((no) => no.item.key)).toContain('marca');
    expect(contexto.itens.every((no) => no.filhos.length === 0)).toBe(true);
  });

  it('módulo desligado tira pai e filho juntos', () => {
    const chaves = planos(todas, ['financeiro']).map((i) => i.key);
    expect(chaves).not.toContain('trabalho');
    expect(chaves).not.toContain('tarefas');
    expect(chaves).toContain('financeiro');
  });

  it('preserva a ordem do NAV dentro de cada seção', () => {
    const conteudo = navEmArvore(todas).find((g) => g.secao.key === 'conteudo')!;
    const pauta = conteudo.itens.find((no) => no.item.key === 'pauta')!;
    expect(pauta.filhos.map((f) => f.key)).toEqual(['referencias']);
    expect(conteudo.itens.map((no) => no.item.key)).toEqual(
      NAV.filter((n) => n.secao === 'conteudo' && !n.pai).map((n) => n.key),
    );
  });

  /*
   * Trava de DADO, não de desenho: pai que não existe, ou que mora em outra
   * seção, faz o filho ser tratado como órfão — ele aparece, mas fora do lugar
   * pretendido, e ninguém descobre olhando a tela. Aqui descobre.
   */
  it('todo pai declarado existe e vive na mesma seção do filho', () => {
    for (const n of NAV.filter((i) => i.pai)) {
      const pai = NAV.find((i) => i.key === n.pai);
      expect(pai, `pai '${n.pai}' de '${n.key}' não existe no NAV`).toBeDefined();
      expect(pai!.secao, `'${n.key}' e o pai dele estão em seções diferentes`).toBe(n.secao);
      expect(pai!.pai, `menu é de dois níveis: '${n.pai}' não pode ser filho`).toBeUndefined();
    }
  });
});

/*
 * O BLOCO MARKETING (MK7, frente MK).
 *
 * A decisão do Pedro de 28/09/2026 manda o bloco seguir a organização do app do
 * Lucas. O que esta suíte guarda não é a aparência do menu — é o desenho que a
 * decisão fixou, e que se perde calado numa refatoração: o bloco fica no
 * Motor de Marketing (chave `conteudo`), a marca fica em Contexto (chave `empresa`), e a agenda do mês não vira item
 * próprio porque a aba Semana da Pauta já é a agenda.
 */
describe('o bloco Marketing (MK7)', () => {
  const item = (k: string) => NAV.find((n) => n.key === k);

  it('o bloco vive no Motor de Marketing, governado pelo módulo pauta', () => {
    const m = item('marketing');
    expect(m).toBeDefined();
    expect(m!.href).toBe('/marketing');
    expect(m!.secao).toBe('conteudo');
    expect(m!.modulo).toBe('pauta');
    expect(m!.pai, 'o bloco é raiz, não filho da Pauta').toBeUndefined();
  });

  it('Performance e Relatório do mês penduram no bloco; Ideias e Estratégia moram em Trabalho', () => {
    for (const k of ['marketing-performance', 'marketing-relatorio']) {
      const n = item(k);
      expect(n, `${k} sumiu do menu`).toBeDefined();
      expect(n!.pai).toBe('marketing');
      expect(n!.secao).toBe('conteudo');
      expect(n!.permission).toBe('pauta.ver');
    }
    for (const k of ['marketing-ideias', 'marketing-estrategia']) {
      const n = item(k);
      expect(n, `${k} sumiu do menu`).toBeDefined();
      expect(n!.secao, `${k}: documento 38 manda para Trabalho`).toBe('trabalho');
      expect(n!.pai, `${k}: o pai estaria em outra seção`).toBeUndefined();
      expect(n!.permission).toBe('pauta.ver');
      expect(n!.modulo).toBe('pauta');
    }
  });

  it('a MARCA não mora no bloco: ela é contexto da empresa', () => {
    const marca = item('marca');
    expect(marca).toBeDefined();
    expect(marca!.pai, 'marca dentro de Marketing a esconde de quem escreve').toBe('contexto');
    expect(marca!.secao).toBe('empresa'); // seção Contexto
    expect(marca!.modulo).toBe('pauta');
    // A permissão é a da rota da API, e não a do Contexto: quem abre a tela
    // precisa poder ler a pauta, senão vê um erro em vez do conteúdo.
    expect(marca!.permission).toBe('pauta.ver');
  });

  it('a agenda do mês NÃO vira item próprio: a aba Semana da Pauta já é a agenda', () => {
    const agendaDoBloco = NAV.filter((n) => n.pai === 'marketing').find((n) => /agenda/i.test(n.label));
    expect(agendaDoBloco, 'duplicar a agenda cria a segunda verdade que a decisão manda evitar').toBeUndefined();
    expect(item('pauta')!.href).toBe('/pauta');
  });

  it('quem enxerga a Pauta enxerga o bloco inteiro, e sem o módulo nada aparece', () => {
    const perms = new Set(['pauta.ver']);
    const comModulo = navEmArvore(perms, ['pauta']);
    const conteudo = comModulo.find((g) => g.secao.key === 'conteudo');
    const bloco = conteudo?.itens.find((i) => i.item.key === 'marketing');
    expect(bloco, 'o bloco não apareceu para quem tem pauta.ver').toBeDefined();
    expect(bloco!.filhos.map((f) => f.key).sort()).toEqual([
      'marketing-performance',
      'marketing-relatorio',
    ]);
    // Ideias e Estratégia saíram do menu em 18/10/2026 (ocultas, telas vivas).
    const trabalho = comModulo.find((g) => g.secao.key === 'trabalho');
    expect(trabalho?.itens.map((i) => i.item.key) ?? []).not.toContain('marketing-ideias');
    expect(trabalho?.itens.map((i) => i.item.key) ?? []).not.toContain('marketing-estrategia');

    // Sem o módulo, a seção inteira some (nenhum item dela sobra) — o que
    // importa é que o bloco não aparece por nenhum caminho.
    const semModulo = navEmArvore(perms, []);
    const todosSemModulo = semModulo.flatMap((g) => g.itens.map((i) => i.item.key));
    expect(todosSemModulo).not.toContain('marketing');
    expect(todosSemModulo).not.toContain('marketing-estrategia');
    expect(todosSemModulo).not.toContain('marca');
  });
});


/*
 * A ORGANIZAÇÃO DA ROOT-07 (C-16): agrupamento, ordem, seção, hub e marca de
 * oculto. Nenhuma rota, permissão, módulo ou rótulo de item mudou — as tabelas
 * abaixo são a prova, copiadas da base 43b034d e da matriz-nav-empresa.json
 * (SHA256 626bf1a4…819e).
 */
describe('organização da navegação (ROOT-07)', () => {
  /** Permissão de cada item na base. Fixa: reorganizar não toca o acesso. */
  const PERMISSAO_DA_BASE: Record<string, string> = {
    caixa: 'dashboard.ver', atendimento: 'aprovacoes.ver', agenda: 'dashboard.ver', console: 'dashboard.ver',
    contexto: 'obsidian.ver', marca: 'pauta.ver', organograma: 'dashboard.ver',
    tarefas: 'tarefas.ver', trabalho: 'tarefas.ver', onboarding: 'tarefas.ver',
    conteudo: 'dashboard.ver', pauta: 'pauta.ver', referencias: 'pauta.ver', marketing: 'pauta.ver',
    'marketing-ideias': 'pauta.ver', 'marketing-estrategia': 'pauta.ver', 'marketing-performance': 'pauta.ver',
    'marketing-relatorio': 'pauta.ver', instagram: 'instagram.ver', bio: 'bio.ver',
    leads: 'leads.ver', funil: 'dashboard.ver', campanhas: 'campanhas.ver', pixels: 'dashboard.ver',
    relatorios: 'relatorios.ver', metas: 'dashboard.ver', financeiro: 'financeiro.ver', 'custo-ia': 'dashboard.ver',
    agentes: 'mcp.ver', rotinas: 'automacoes.ver', sessoes: 'mcp.ver', fluxos: 'automacoes.ver',
    ferramentas: 'mcp.ver', conexoes: 'dashboard.ver', regua: 'mcp.ver', rastro: 'auditoria.ver',
    'linha-do-tempo': 'auditoria.ver', assinatura: 'dashboard.ver', config: 'dashboard.ver',
  };

  /** Rótulo de cada item na base (e5 765f00). A ROOT-08 muda um só: `console`, abaixo. */
  const ROTULO_DA_BASE: Record<string, string> = {
    caixa: 'Pendências', atendimento: 'Aprovações', agenda: 'Agenda', console: 'Visão geral',
    contexto: 'Conhecimento da empresa', marca: 'Marca e pilares', organograma: 'Equipe',
    tarefas: 'Lista de tarefas', trabalho: 'Quadro interno', onboarding: 'Implantação de clientes',
    conteudo: 'Temas do ClickUp', pauta: 'Produção de conteúdo', referencias: 'Referências', marketing: 'Marketing',
    'marketing-ideias': 'Banco de ideias', 'marketing-estrategia': 'Estratégia do mês',
    'marketing-performance': 'Performance', 'marketing-relatorio': 'Relatório do mês',
    instagram: 'Instagram', bio: 'Página de links', leads: 'Leads', funil: 'Funil de vendas',
    campanhas: 'Campanhas', pixels: 'Eventos do site', relatorios: 'Relatórios', metas: 'Metas',
    financeiro: 'Financeiro', 'custo-ia': 'Custos de IA', agentes: 'Agentes de IA',
    rotinas: 'Rotinas automáticas', sessoes: 'Sessões de IA', fluxos: 'Processos',
    ferramentas: 'Ferramentas disponíveis', conexoes: 'Integrações', regua: 'Regras e permissões',
    rastro: 'Registro de ações', 'linha-do-tempo': 'Atividade', assinatura: 'Plano e assinatura',
    config: 'Configurações da conta',
  };

  /** matriz-nav-empresa.json: href → grupo proposto, traduzido para a chave da seção. */
  const SECAO_DA_MATRIZ: Record<string, string> = {
    '/caixa': 'dia', '/atendimento': 'dia', '/agenda': 'dia', '/painel': 'dia',
    '/contexto': 'empresa', '/contexto/marca': 'empresa',
    '/organograma': 'controle',
    '/tarefas': 'trabalho', '/trabalho': 'trabalho', '/onboarding': 'trabalho', '/conteudo': 'trabalho',
    '/marketing/ideias': 'trabalho', '/marketing/estrategia': 'trabalho',
    '/pauta': 'conteudo', '/referencias': 'conteudo', '/marketing': 'conteudo',
    '/marketing/performance': 'conteudo', '/marketing/relatorio': 'conteudo',
    '/instagram': 'conteudo', '/bio': 'conteudo', '/campanhas': 'conteudo', '/pixels': 'conteudo',
    '/leads': 'comercial', '/funil': 'comercial',
    '/relatorios': 'resultados', '/metas': 'resultados',
    '/financeiro': 'financeiro',
    '/painel/custo-ia': 'automacoes', '/agentes': 'automacoes', '/rotinas': 'automacoes',
    '/sessoes': 'automacoes', '/fluxos': 'automacoes',
    '/ferramentas': 'controle', '/conexoes': 'controle', '/regua': 'controle',
    '/rastro': 'registros', '/linha-do-tempo': 'registros',
    '/assinatura': 'controle', // "Oculto na navegação interna": a seção é só a casa do dado
    '/config': 'conta',
  };

  it('os 39 destinos mantêm chave, rótulo e permissão da base', () => {
    expect(NAV).toHaveLength(39 + N_COCKPIT + N_DA_RODADA);
    expect(Object.keys(PERMISSAO_DA_BASE)).toHaveLength(39);
    for (const n of NAV) {
      if (COCKPIT[n.key]) {
        expect(n).toMatchObject({ href: COCKPIT[n.key].href, permission: COCKPIT[n.key].permission, label: COCKPIT[n.key].label, secao: 'comercial', modulo: 'leads' });
        expect(!!n.oculto, `${n.key}: oculto`).toBe(!!COCKPIT[n.key].oculto);
        continue;
      }
      if (DA_RODADA_PAINEL[n.key]) {
        expect(n).toMatchObject(DA_RODADA_PAINEL[n.key]);
        continue;
      }
      expect(n.permission, `${n.key}: permissão mudou`).toBe(PERMISSAO_DA_BASE[n.key]);
      expect(n.label, `${n.key}: rótulo fora da tabela da ROOT-08`).toBe(
        ROTULOS_DA_RODADA_PAINEL[n.key] ?? ROTULOS_DA_ROOT_08[n.key] ?? ROTULO_DA_BASE[n.key],
      );
    }
  });

  /*
   * ROOT-08: o que mudou de rótulo, e por quê. Doc 38 ("Dia a dia"): "A visão da
   * empresa continua disponível conforme permissão", ao lado das entradas da
   * pessoa. O rótulo diz de quem é a visão. Os outros 38 já coincidiam com o doc
   * 22 §4 e o doc 38; "Lista de tarefas" fica porque /tarefas lê `Task` nativa
   * (o doc 38 proíbe anunciá-la como ClickUp ou como outra visão do quadro).
   */
  const ROTULOS_DA_ROOT_08: Record<string, string> = { console: 'Visão geral da empresa' };

  /*
   * Rodada do painel P2 (18/10/2026): quadro e lista viraram uma tela só, com a
   * troca Quadro · Lista sobre a mesma fonte (WorkTask). "Quadro interno" passou a
   * dizer só metade do que a tela faz; o rótulo virou "Tarefas". A chave e a rota
   * não mudam. "Lista de tarefas" (/tarefas) segue com o rótulo, oculta.
   */
  const ROTULOS_DA_RODADA_PAINEL: Record<string, string> = { trabalho: 'Tarefas', onboarding: 'Bancada de onboarding' };

  it('rótulos conforme a matriz da ROOT-08: um item muda, o resto fica, nada promete função ausente', () => {
    expect(Object.keys(ROTULOS_DA_ROOT_08)).toEqual(['console']);
    expect(NAV.find((n) => n.key === 'console')?.label).toBe('Visão geral da empresa');
    // "Minhas pendências/aprovações/agenda" só entram com o filtro pessoal pronto (doc 38).
    for (const n of NAV) expect(n.label, n.key).not.toMatch(/^minh[ao]s?\b/i);
    // nenhum rótulo anuncia a fonte ClickUp na tela que lê tarefa nativa
    expect(NAV.find((n) => n.key === 'tarefas')?.label).toBe('Lista de tarefas');
    // as telas ainda não entregues dizem isso no próprio item
    expect(NAV.find((n) => n.key === 'fluxos')).toMatchObject({ label: 'Processos', estado: 'parcial' });
    // rótulo de item não repete o de uma seção (a barra leria duas vezes a mesma palavra)
    const rotulosDeSecao = new Set<string>(SECOES.map((s) => s.label));
    const repetidos = NAV.filter((n) => rotulosDeSecao.has(n.label)).map((n) => n.key);
    expect(repetidos).toEqual(['config']); // "Configurações da conta": a seção tem um item só, o mesmo destino
  });

  it('o texto de apoio de Trabalho não cita as ideias, que saíram do menu em 18/10/2026', () => {
    expect(SECOES.find((s) => s.key === 'trabalho')?.hint).toBe('tarefas, quadro e implantação');
  });

  it('cada destino cai na seção da matriz, e a matriz cobre exatamente os 39 href', () => {
    expect(new Set([...Object.keys(SECAO_DA_MATRIZ), ...HREFS_DO_COCKPIT, ...HREFS_DA_RODADA])).toEqual(new Set(NAV.map((n) => n.href)));
    const secaoDaRodada = (href: string) => Object.values(DA_RODADA_PAINEL).find((c) => c.href === href)?.secao;
    for (const n of NAV) expect(n.secao, `${n.key} (${n.href})`).toBe(SECAO_DA_MATRIZ[n.href] ?? (HREFS_DO_COCKPIT.includes(n.href) ? 'comercial' : secaoDaRodada(n.href)));
  });

  // Ordem de 18/10/2026 (rodada do painel P0): Contexto desce para depois do Motor de IA.
  it('SECOES: ordem, rótulos e tipos do contrato C-16, com a ordem de 18/10/2026', () => {
    expect(SECOES.map((s) => [s.key, s.label, s.tipo])).toEqual([
      ['dia', 'Dia a dia', 'principal'],
      ['trabalho', 'Trabalho', 'principal'],
      ['conteudo', 'Motor de Marketing', 'principal'],
      ['comercial', 'Motor Comercial', 'principal'],
      ['financeiro', 'Motor Financeiro', 'principal'],
      ['automacoes', 'Motor de IA', 'principal'],
      ['empresa', 'Contexto', 'principal'],
      ['resultados', 'Resultados', 'principal'],
      ['controle', 'Configurações da empresa', 'apoio'],
      ['registros', 'Registros', 'apoio'],
      ['conta', 'Configurações da conta', 'apoio'],
    ]);
    const secaoDe = (k: string) => SECOES.find((s) => s.key === k) as { dentroDe?: string } | undefined;
    expect(secaoDe('registros')?.dentroDe, 'Registros fica dentro de Configurações').toBe('controle');
    expect(SECOES.filter((s) => 'dentroDe' in s)).toHaveLength(1);
  });

  it('filho na seção do pai, ou de primeiro nível', () => {
    for (const n of NAV.filter((i) => i.pai)) {
      expect(NAV.find((i) => i.key === n.pai)?.secao, n.key).toBe(n.secao);
    }
    // Ideias e Estratégia continuam na seção Trabalho, ocultas (18/10/2026).
    const trabalho = navEmArvore(new Set(NAV.map((n) => n.permission))).find((g) => g.secao.key === 'trabalho')!;
    expect(trabalho.itens.map((no) => no.item.key)).not.toContain('marketing-ideias');
    expect(NAV.find((n) => n.key === 'marketing-ideias')?.secao).toBe('trabalho');
  });

  /*
   * Os cortes de 18/10/2026 (rodada do painel P0): cada item sai do menu marcado
   * como oculto, com a rota em ROTAS_ABSORVIDAS e o mesmo módulo de antes.
   */
  it('os cortes de 18/10/2026 saem do menu, ficam no NAV e dizem para onde a função foi', () => {
    const cortes: Record<string, string> = {
      conteudo: '/trabalho', 'marketing-ideias': '/trabalho', 'marketing-estrategia': '/trabalho',
      // 19/10/2026 (rodada do trabalho T6): /comercial deixou de ser a fila; o Funil vivo é a entrada.
      leads: '/comercial/funil', funil: '/comercial/funil',
    };
    const todas = new Set(NAV.map((n) => n.permission));
    const noMenu = navPorSecao(todas).flatMap((g) => g.itens.map((i) => i.key));
    for (const [k, destino] of Object.entries(cortes)) {
      const n = NAV.find((i) => i.key === k)!;
      expect(n.oculto, k).toBe(true);
      expect(noMenu, k).not.toContain(k);
      expect(ROTAS_ABSORVIDAS.find((r) => r.href === n.href)?.destino, k).toBe(destino);
      expect(ROTAS_ABSORVIDAS.find((r) => r.href === n.href)?.porque.trim(), k).toBeTruthy();
    }
  });

  /*
   * Rodada do trabalho T6 (19/10/2026): o Motor Comercial são cinco itens soltos,
   * nesta ordem, sem pai. A fila de decisões sai do menu oculta, absorvida por
   * Pendências, e continua dona de `/comercial` (que redireciona para o Funil
   * vivo): é ela que mantém `/comercial/decisoes` e `/comercial/lead/...` sob o
   * módulo `leads`.
   */
  it('Motor Comercial sem Decisões: cinco itens soltos, decisões absorvidas por Pendências', () => {
    const todas = new Set(NAV.map((n) => n.permission));
    const comercial = navEmArvore(todas).find((g) => g.secao.key === 'comercial')!;
    expect(comercial.itens.map((no) => no.item.label)).toEqual([
      'Funil vivo', 'Contratos vivos', 'Simulador de WhatsApp', 'Torre das automações', 'Relatório da semana',
    ]);
    for (const no of comercial.itens) {
      expect(no.item.pai, no.item.key).toBeUndefined();
      expect(no.filhos, no.item.key).toEqual([]);
    }
    const decisoes = NAV.find((n) => n.key === 'comercial-decisoes')!;
    expect(decisoes).toMatchObject({ href: '/comercial', oculto: true, modulo: 'leads', permission: 'leads.ver', secao: 'comercial' });
    expect(NAV.filter((n) => n.pai === 'comercial-decisoes')).toEqual([]);
    const absorvida = ROTAS_ABSORVIDAS.find((r) => r.href === '/comercial');
    expect(absorvida?.destino).toBe('/caixa');
    expect(absorvida?.porque).toMatch(/Pendências/);
    expect(absorvida?.porque).toMatch(/segue viva/);
    expect(moduloDaRotaDoWeb('/comercial')).toBe('leads');
    expect(moduloDaRotaDoWeb('/comercial/decisoes')).toBe('leads');
    expect(moduloDaRotaDoWeb('/comercial/lead/abc')).toBe('leads');
    expect(navPorSecao(todas, ['trabalho']).flatMap((g) => g.itens.map((i) => i.key))).not.toContain('comercial-funil');
  });

  /*
   * Rodada do painel P2 (18/10/2026): a Lista de tarefas virou a visão Lista do
   * Trabalho. `/tarefas` sai do menu oculta, absorvida por /trabalho, e a página
   * redireciona (na página, não em rotas-antigas.mjs: item do NAV com redirect de
   * configuração reprova o teste de disputa de rota). A Implantação de clientes
   * fica pendurada no Trabalho, mesma seção.
   */
  it('quadro e lista são uma tela só: /tarefas oculta e absorvida, Implantação sob o Trabalho abrindo o kanban', () => {
    const tarefas = NAV.find((n) => n.key === 'tarefas')!;
    expect(tarefas).toMatchObject({ href: '/tarefas', oculto: true, modulo: 'trabalho', permission: 'tarefas.ver' });
    const absorvida = ROTAS_ABSORVIDAS.find((r) => r.href === '/tarefas');
    expect(absorvida?.destino).toBe('/trabalho');
    expect(absorvida?.porque).toMatch(/uma tela só/);
    expect(NAV.find((n) => n.key === 'trabalho')).toMatchObject({ label: 'Tarefas', href: '/trabalho' });
    // Rodada do trabalho T1 (19/10/2026): a bancada antiga deixa de ser porta, oculta e absorvida pelo kanban.
    expect(NAV.find((n) => n.key === 'onboarding')).toMatchObject({ pai: 'trabalho', secao: 'trabalho', href: '/onboarding', oculto: true });
    expect(ROTAS_ABSORVIDAS.find((r) => r.href === '/onboarding')?.destino).toBe('/trabalho/implantacao');
    expect(NAV.find((n) => n.key === 'implantacao')).toMatchObject({ pai: 'trabalho', secao: 'trabalho', href: '/trabalho/implantacao', label: 'Implantação de clientes' });
    const todas = new Set(NAV.map((n) => n.permission));
    const trabalho = navEmArvore(todas).find((g) => g.secao.key === 'trabalho')!;
    const raiz = trabalho.itens.find((no) => no.item.key === 'trabalho')!;
    // Rodada do painel P3: as Atas também ficam penduradas no Trabalho, depois da Implantação.
    expect(raiz.filhos.map((f) => f.key)).toEqual(['implantacao', 'trabalho-atas']);
    expect(navPorSecao(todas).flatMap((g) => g.itens.map((i) => i.key))).not.toContain('tarefas');
    expect(moduloDaRotaDoWeb('/tarefas')).toBe('trabalho');
  });

  /*
   * Rodada do painel P3 (18/10/2026): o banco de atas da operação mora no Trabalho,
   * pendurado no item Tarefas, com a permissão de ler o quadro. É item vivo, não
   * oculto, e a rota resolve para o módulo `trabalho` (o gate de módulos da API
   * confere o mesmo primeiro segmento).
   */
  it('as Atas ficam no Trabalho, sob Tarefas, com tarefas.ver e o módulo trabalho', () => {
    const atas = NAV.find((n) => n.key === 'trabalho-atas')!;
    expect(atas).toMatchObject({ label: 'Atas', href: '/trabalho/atas', icon: 'NotebookText', permission: 'tarefas.ver', secao: 'trabalho', modulo: 'trabalho', pai: 'trabalho' });
    expect(atas.oculto).toBeFalsy();
    expect(moduloDaRotaDoWeb('/trabalho/atas')).toBe('trabalho');
    const soVer = navEmArvore(new Set(['tarefas.ver'])).find((g) => g.secao.key === 'trabalho')!;
    expect(soVer.itens.find((no) => no.item.key === 'trabalho')!.filhos.map((f) => f.key)).toContain('trabalho-atas');
    expect(navPorSecao(new Set(['dashboard.ver'])).flatMap((g) => g.itens.map((i) => i.key))).not.toContain('trabalho-atas');
  });

  it('/assinatura sai da barra e da busca por marca, e continua no NAV', () => {
    const a = NAV.find((n) => n.key === 'assinatura')!;
    expect(a.oculto).toBe(true);
    expect(NAV.filter((n) => n.oculto).map((n) => n.key).sort()).toEqual(
      ['assinatura', 'comercial-decisoes', 'conteudo', 'funil', 'leads', 'marketing-estrategia', 'marketing-ideias', 'onboarding', 'tarefas'],
    );
    const todas = new Set(NAV.map((n) => n.permission));
    expect(navPorSecao(todas).flatMap((g) => g.itens.map((i) => i.key))).not.toContain('assinatura');
    expect(
      navEmArvore(todas).flatMap((g) => g.itens.flatMap((no) => [no.item.key, ...no.filhos.map((f) => f.key)])),
    ).not.toContain('assinatura');
    expect(navPorSecao(todas, MODULOS).flatMap((g) => g.itens.map((i) => i.key))).not.toContain('assinatura');
    // a rota segue com dono: permissão e módulo preservados
    expect(a.href).toBe('/assinatura');
    expect(a.permission).toBe('dashboard.ver');
    expect(a.modulo).toBeUndefined();
  });

  /*
   * B1 (ROOT-06-REV): toda tag `area:<chave>` publicada na base continua
   * resolvendo para uma área do mapa. As chaves antigas ficaram e só mudaram de
   * rótulo; as novas somam.
   */
  it('as tags area:<chave> da base continuam resolvendo no mapa', () => {
    for (const chave of ['empresa', 'conteudo', 'comercial', 'automacoes', 'dia', 'trabalho', 'resultados', 'controle']) {
      expect(areasDaNota([`area:${chave}`]), `area:${chave} ficou sem área`).toEqual([chave]);
    }
    expect(areasDaNota(['area:empresa', 'area:conteudo', 'area:comercial', 'area:automacoes']))
      .toEqual(['conteudo', 'comercial', 'automacoes', 'empresa']); // na ordem das SECOES (Contexto desceu em 18/10/2026)
    expect(areasDaNota(['area:nao-existe'])).toEqual([]);
  });
});
