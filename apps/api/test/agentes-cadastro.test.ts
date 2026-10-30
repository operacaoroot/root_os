import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

import {
  AREAS_DA_RODADA_DOS_AGENTES,
  CADASTRO_DE_FUNCOES,
  CAPACIDADES_DA_RODADA_DOS_AGENTES,
  DONOS_DO_CADASTRO,
  ESFORCOS_DO_CADASTRO,
  MODELOS_DO_CADASTRO,
  escolherModelo,
  funcaoPorId,
  funcaoPorSlug,
  funcoesDaSemente,
  variavelDoModelo,
} from '@mktos/shared';

import { COMPLEMENTOS_DOS_AGENTES, ROSTER_DE_ENTRADA, ROSTER_DO_ONBOARDING, agenteDaFuncao } from '../src/agents/roster';

/*
 * O cadastro único (rodada dos agentes, 21/10/2026, Lane 0). É o contrato de que
 * as outras lanes dependem: o provedor escolhe o modelo pelo `id`, os seeds
 * semeiam pelos slugs daqui e a tela lê os três tipos. Este teste é a catraca.
 */

function raizDoRepo(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error(`não achei a raiz do repositório a partir de ${process.cwd()}`);
}

const RAIZ = raizDoRepo();
const json = <T>(rel: string): T => JSON.parse(readFileSync(path.join(RAIZ, rel), 'utf8')) as T;

const CAPACIDADES = new Set([
  ...json<{ capacidades: { id: string }[] }>('packages/policy/politica-root.json').capacidades.map((c) => c.id),
  ...json<{ capacidades: { id: string }[] }>('packages/policy/politica-marketing-os.json').capacidades.map((c) => c.id),
]);

/** Os slugs que o seed da tripulação cria (o seed é script de terminal, não exporta nada). */
function slugsDaTripulacao(): string[] {
  const texto = readFileSync(path.join(RAIZ, 'apps/api/prisma/seed-tripulacao.ts'), 'utf8');
  const literais = [...texto.matchAll(/slug:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]);
  if (literais.length) return literais;
  // Depois da A1 o seed lê do cadastro: não há literal, e a fonte é a semente.
  expect(texto).toMatch(/funcoesDaSemente\(\s*'tripulacao'\s*\)/);
  return funcoesDaSemente('tripulacao').map((f) => f.slug);
}

describe('cadastro único de agentes', () => {
  it('tem uma linha por linha do levantamento, mais o vigia da agenda', () => {
    const levantamento = json<{ rows: { id: string }[] }>('docs/agentes/catalogo-levantamento-20261021.json').rows.map((r) => r.id);
    const ids = CADASTRO_DE_FUNCOES.map((f) => f.id);
    // AG-01 é o vigia da agenda (a ata pede); TR-11 é a segunda leitura do arquivista (a lane do Drive pediu).
    // CT-20 a CT-22: Memória, Triagem e Redator pela régua da aba Marketing no jeito do Estúdio (26/10/2026).
    // CE-07: a Rootinha, o agente que roda fora do OS, no Hermes (30/10/2026).
    expect(ids).toEqual([...levantamento, 'AG-01', 'TR-11', 'TR-12', 'CT-20', 'CT-21', 'CT-22', 'CE-07']);
  });

  it('id e slug são únicos, e o slug é minúsculo com hífen', () => {
    const ids = CADASTRO_DE_FUNCOES.map((f) => f.id);
    const slugs = CADASTRO_DE_FUNCOES.map((f) => f.slug);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    for (const i of ids) expect(i).toMatch(/^[A-Z]{2}-\d{2}$/);
  });

  it('todo agente tem modelo; toda rotina e automação tem modelo nulo', () => {
    for (const f of CADASTRO_DE_FUNCOES) {
      if (f.tipo === 'agente') {
        expect(f.modelo ?? f.modeloExterno, `${f.id} é agente e não tem modelo`).toBeTruthy();
      } else {
        expect(f.modelo, `${f.id} é ${f.tipo} e tem modelo`).toBeNull();
      }
      if (f.modelo) {
        expect(MODELOS_DO_CADASTRO).toContain(f.modelo);
        expect(ESFORCOS_DO_CADASTRO, `${f.id} sem esforço`).toContain(f.esforco);
      }
    }
  });

  it('nenhuma linha usa o Fable 5.1', () => {
    expect(JSON.stringify(CADASTRO_DE_FUNCOES)).not.toMatch(/fable/i);
  });

  it('toda capacidade citada existe na política (base + delta)', () => {
    for (const f of CADASTRO_DE_FUNCOES) {
      for (const c of f.capacidades) expect(CAPACIDADES.has(c), `${f.id} cita ${c}, que não está na política`).toBe(true);
    }
    for (const c of CAPACIDADES_DA_RODADA_DOS_AGENTES) expect(CAPACIDADES.has(c), c).toBe(true);
  });

  it('dono, estado e área são os da lista', () => {
    for (const f of CADASTRO_DE_FUNCOES) {
      expect(DONOS_DO_CADASTRO).toContain(f.dono);
      expect(['ativo', 'desligado', 'so-homologacao', 'aposentado']).toContain(f.estado);
      expect(f.paraQueServe.length, f.id).toBeGreaterThan(10);
    }
    for (const a of AREAS_DA_RODADA_DOS_AGENTES) expect(CADASTRO_DE_FUNCOES.some((f) => f.area === a), a).toBe(true);
  });

  it('o dono padrão segue a área (a Equipe troca no banco)', () => {
    const esperado: Record<string, string> = {
      Comercial: 'lucas',
      Implantação: 'pedro',
      'Trabalho e pastas': 'rodrigo',
      'Rotinas da casa': 'pedro',
      'Canais e integrações': 'pedro',
      Agenda: 'rodrigo',
    };
    for (const f of CADASTRO_DE_FUNCOES) if (esperado[f.area]) expect(f.dono, f.id).toBe(esperado[f.area]);
  });

  it('nenhum slug de seed sem entrada no cadastro, e vice-versa', () => {
    const porSemente = {
      entrada: ROSTER_DE_ENTRADA.map((a) => a.slug),
      onboarding: ROSTER_DO_ONBOARDING.map((a) => a.slug),
      tripulacao: slugsDaTripulacao(),
    } as const;
    for (const [semente, slugs] of Object.entries(porSemente)) {
      const doCadastro = funcoesDaSemente(semente as keyof typeof porSemente).map((f) => f.slug);
      expect([...slugs].sort(), semente).toEqual([...doCadastro].sort());
      for (const s of slugs) expect(funcaoPorSlug(s), `${semente}: ${s}`).toBeTruthy();
    }
  });

  it('o DigiSac e o Zapfy não são função viva', () => {
    for (const f of CADASTRO_DE_FUNCOES) {
      if (/digisac|zapfy/i.test(`${f.nome} ${f.paraQueServe}`)) expect(f.estado, f.id).toBe('aposentado');
    }
  });
});

describe('modelo por função', () => {
  const PADRAO = { modelo: 'claude-opus-5-5', esforco: 'high' as const };

  it('o cadastro manda quando a função tem modelo', () => {
    const f = funcaoPorId('CO-11')!;
    expect(escolherModelo('CO-11', PADRAO)).toEqual({ modelo: f.modelo, esforco: f.esforco, origem: 'cadastro' });
  });

  it('LLM_MODELO_<ID> sobrescreve, e valor torto é ignorado', () => {
    expect(variavelDoModelo('CO-03')).toBe('LLM_MODELO_CO_03');
    expect(escolherModelo('CO-11', PADRAO, { LLM_MODELO_CO_11: 'claude-sonnet-5-5' }).modelo).toBe('claude-sonnet-5-5');
    expect(escolherModelo('CO-11', PADRAO, { LLM_MODELO_CO_11: 'claude-sonnet-5-5' }).origem).toBe('variavel');
    expect(escolherModelo('CO-11', PADRAO, { LLM_MODELO_CO_11: 'gpt-9' }).origem).toBe('cadastro');
    expect(escolherModelo('CO-11', PADRAO, { LLM_ESFORCO_CO_11: 'high' }).esforco).toBe('high');
  });

  it('sem função, função desconhecida ou sem modelo: o padrão do provedor', () => {
    expect(escolherModelo(undefined, PADRAO).origem).toBe('padrao');
    expect(escolherModelo('XX-99', PADRAO).origem).toBe('padrao');
    expect(escolherModelo('RO-04', PADRAO)).toEqual({ ...PADRAO, origem: 'padrao' });
  });
});

/*
 * A ROOTINHA (CE-07, 30/10/2026): o agente que roda fora do OS, no Hermes, e
 * opera só pelas portas dele. O que ela pode é o que este caso trava: as
 * leituras de contexto, números, tarefas, agenda, e-mail, leads e conteúdo, as
 * nove capacidades da central (política 1.13.0), mudar status de tarefa e
 * rascunhar e-mail — e, RETIDAS para aprovação, as quatro que saem da casa ou
 * criam lead. Nada de dinheiro, exclusão, permissão ou credencial.
 */
describe('a Rootinha (CE-07)', () => {
  const f = funcaoPorSlug('rootinha')!;
  const porId = new Map(
    [
      ...json<{ capacidades: Array<{ id: string; nivel: string; efeito: Record<string, unknown> }> }>('packages/policy/politica-root.json').capacidades,
      ...json<{ capacidades: Array<{ id: string; nivel: string; efeito: Record<string, unknown> }> }>('packages/policy/politica-marketing-os.json').capacidades,
    ].map((c) => [c.id, c]),
  );

  it('está no cadastro como agente externo da central, do Pedro, semeado na tripulação', () => {
    expect(f).toMatchObject({ id: 'CE-07', area: 'Central e contexto', tipo: 'agente', dono: 'pedro', modelo: null });
    expect(f.modeloExterno).toMatch(/hermes/i);
    expect(f.semente).toEqual(['tripulacao']);
  });

  it('nasce pausada, com teto R2, só na empresa da casa, com procedimento e voz', () => {
    const a = agenteDaFuncao(f);
    expect(a.estado).toBe('pausado');
    expect(a.autonomiaAte).toBe('R2');
    expect(a.soNaCasa).toBe(true);
    expect(a.sop?.passos.length).toBeGreaterThan(2);
    expect(COMPLEMENTOS_DOS_AGENTES.rootinha.voz).toBeTruthy();
  });

  it('declara as nove da central, alterar tarefa e rascunhar e-mail', () => {
    for (const c of [
      'operacao.tarefa.criar', 'operacao.tarefa.comentar', 'caixa.pendencia.listar', 'caixa.pendencia.criar',
      'aprovacao.listar', 'agente.invocar', 'briefing.ler', 'contexto.memoria.sugerir', 'whatsapp.conversa.responder',
      'operacao.tarefa.alterar', 'email.rascunhar',
    ]) {
      expect(f.capacidades, c).toContain(c);
    }
  });

  it('as leituras são de contexto, números, tarefas, agenda, e-mail, leads e conteúdo — nenhuma do financeiro', () => {
    const r0 = f.capacidades.filter((c) => porId.get(c)?.nivel === 'R0');
    for (const c of r0) expect(c, c).toMatch(/^(contexto|numeros|operacao|comunicacao|crm|pecas|caixa|aprovacao|briefing)\./);
    for (const c of ['contexto.memoria.buscar', 'numeros.painel.ler', 'operacao.tarefa.listar', 'comunicacao.agenda.listar', 'comunicacao.email.buscar', 'crm.lead.buscar', 'pecas.conteudo.listar']) {
      expect(r0, c).toContain(c);
    }
  });

  it('o que sai da casa fica retido: as R3 declaradas são exatamente estas', () => {
    const r3 = f.capacidades.filter((c) => ['R3', 'R4', 'R5'].includes(porId.get(c)?.nivel ?? 'R5'));
    expect(r3.sort()).toEqual(['agenda.reuniao.marcar', 'email.enviar', 'whatsapp.conversa.responder', 'whatsapp.mensagem.enviar']);
    // comercial.lead.criar é R1 no catálogo: declarada, mas a porta NÃO a retém sozinha (ver o relatório da rodada).
    expect(f.capacidades).toContain('comercial.lead.criar');
    expect(porId.get('comercial.lead.criar')?.nivel).toBe('R1');
  });

  it('nada de dinheiro, exclusão, permissão ou credencial', () => {
    for (const c of f.capacidades) {
      const e = porId.get(c)!.efeito;
      expect(e.impactoFinanceiro, c).toBe('nenhum');
      expect(e.destruicao, c).toBe(false);
      expect(c, c).not.toMatch(/^(financeiro|usuario\.permissao|credencial|conector)\./);
    }
  });
});
