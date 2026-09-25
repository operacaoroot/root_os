import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient, ActorType } from '@prisma/client';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import { ApprovalsService } from '../src/approvals/approvals.service';
import { AuditService } from '../src/audit/audit.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { AcoesService } from '../src/gateway/acoes.service';
import { PortaDoOperador, type AcaoRetida } from '../src/gateway/porta-do-operador.service';
import { InterruptoresRegistry } from '../src/gateway/interruptores.registry';
import { ConectoresService } from '../src/integrations/conectores.service';
import {
  ConectoresConfiguradosRegistry,
  CONECTORES_QUE_DEVEM_RESPONDER,
} from '../src/gateway/conectores-configurados.registry';
import { CONECTOR_DA_CAPACIDADE } from '../src/integrations/conectores';
import { comContexto } from '../src/common/contexto-execucao';
import { exigirBancoDescartavel } from './banco-de-teste';
import type { PrismaService } from '../src/prisma/prisma.service';

/*
 * ============================================================================
 * FATIA 3.3 — TODA ESCRITA EXISTENTE PASSA PELA PORTA (RF-G-01, RF-A-01)
 * ============================================================================
 *
 * O QUE ESTA SUÍTE PROVA, e por que ela existe separada da `porta.test.ts`.
 *
 * `porta.test.ts` mede a porta pelo caminho do AGENTE: o modelo pede uma
 * ferramenta, a régua classifica, a ação é retida. O buraco que esta fatia
 * fechou é o OUTRO caminho, o de uma PESSOA clicando na tela — e ele não tinha
 * teste nenhum porque não passava pela porta: `POST /google/gmail/send`,
 * `POST /google/calendar/event`, `POST /google/docs` e
 * `POST /google/docs/:id/append` chamavam o conector direto, protegidas só por
 * JWT mais permissão de papel.
 *
 * Quatro escritas externas vivas em produção sem classificação de risco, sem
 * retenção por aprovação, sem RASTRO e fora do alcance do interruptor de
 * conector. Era item de SEGURANÇA, e é por isso que cada uma tem caso próprio
 * aqui em vez de um caso genérico "a porta funciona".
 *
 * SÃO DOIS BLOCOS:
 *
 *   1. SEM BANCO — lê o catálogo empacotado e o código-fonte. Roda sempre, no
 *      `pnpm test` padrão, e é a rede que pega o desfazimento silencioso: uma
 *      rota que volte a chamar o conector, uma capacidade que perca o nível.
 *   2. COM BANCO (`TEST_DATABASE_URL`) — exercita a porta de verdade, com
 *      `PortaDoOperador`, aprovação e execução pós-aprovação.
 *
 * O bloco 2 usa EFEITOS FALSOS no lugar do `GoogleService`: o que está sendo
 * medido é a fronteira, não o cliente HTTP do Google. Um efeito falso que
 * REGISTRA se foi chamado prova a coisa mais importante de todas — que numa
 * ação R3 nada sai antes de uma pessoa confirmar.
 */

// ---------------------------------------------------------------------------
// As quatro escritas do Google, e o que cada uma deve ser no catálogo
// ---------------------------------------------------------------------------

interface EscritaMigrada {
  capacidade: string;
  /** A rota HTTP que era o caminho direto para o conector. */
  rota: string;
  /** A chave de conector que o interruptor precisa alcançar. */
  conector: string;
  /** Argumentos válidos, nos nomes do CATÁLOGO (não os do corpo HTTP). */
  args: Record<string, unknown>;
  /** Argumentos que o `argsSchema` tem de recusar. */
  argsInvalidos: Record<string, unknown>;
}

const ESCRITAS: EscritaMigrada[] = [
  {
    capacidade: 'email.enviar',
    rota: 'POST /google/gmail/send',
    conector: 'gmail',
    args: { para: 'cliente@exemplo.com', assunto: 'Proposta', corpo: 'Segue em anexo.' },
    // Falta `corpo`, que é obrigatório. Recusar ANTES do efeito é o que permite
    // ao modelo (ou à tela) corrigir sem queimar uma aprovação.
    argsInvalidos: { para: 'cliente@exemplo.com', assunto: 'Proposta' },
  },
  {
    capacidade: 'agenda.evento.criar',
    rota: 'POST /google/calendar/event',
    conector: 'gcal',
    args: { titulo: 'Reunião de kickoff', inicio: '2026-09-20T14:00:00-03:00' },
    argsInvalidos: { inicio: '2026-09-20T14:00:00-03:00' }, // sem título
  },
  {
    capacidade: 'documento.criar',
    rota: 'POST /google/docs',
    conector: 'gdocs',
    args: { titulo: 'Ata da reunião' },
    argsInvalidos: { conteudo: 'só o corpo, sem título' },
  },
  {
    capacidade: 'documento.anexar',
    rota: 'POST /google/docs/:id/append',
    conector: 'gdocs',
    args: { documentoId: 'doc-123', texto: 'mais um parágrafo' },
    argsInvalidos: { texto: 'sem dizer em qual documento' },
  },
];

/** A quinta escrita da fatia: já ia pela porta, e mudou de DONO nesta fatia. */
const WHATSAPP = 'whatsapp.mensagem.enviar';

// ---------------------------------------------------------------------------
// Bloco 1 — sem banco
// ---------------------------------------------------------------------------

function acharRaizDaApi(): string {
  const marco = path.join('src', 'gateway', 'tool-gateway.service.ts');
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, marco))) return dir;
    if (existsSync(path.join(dir, 'apps', 'api', marco))) return path.join(dir, 'apps', 'api');
    const pai = path.dirname(dir);
    if (pai === dir) break;
    dir = pai;
  }
  throw new Error(`Não encontrei apps/api a partir de "${process.cwd()}".`);
}

const RAIZ = acharRaizDaApi();
const ler = (rel: string): string => readFileSync(path.join(RAIZ, rel), 'utf8');

interface CapacidadeDoCatalogo {
  id: string;
  nivel?: string;
  rota?: string;
  argsSchema?: { additionalProperties?: boolean; required?: string[] };
  efeito?: { escreveForaDoOS?: boolean; sensibilidade?: string };
}

const CATALOGO: CapacidadeDoCatalogo[] = (() => {
  const raizDoRepo = path.resolve(RAIZ, '..', '..');
  const arquivo = path.join(raizDoRepo, 'packages', 'policy', 'politica-marketing-os.json');
  return (JSON.parse(readFileSync(arquivo, 'utf8')) as { capacidades: CapacidadeDoCatalogo[] })
    .capacidades;
})();

describe('fatia 3.3: o catálogo declara cada escrita migrada', () => {
  it.each(ESCRITAS)('$capacidade é R3, sai da casa e tem conector', ({ capacidade, rota, conector }) => {
    const cap = CATALOGO.find((c) => c.id === capacidade);
    expect(cap, `"${capacidade}" sumiu de politica-marketing-os.json`).toBeDefined();

    // R3 é o degrau da RETENÇÃO POR APROVAÇÃO. Rebaixar qualquer uma destas
    // para R2 devolveria o envio ao mesmo estado de antes da fatia: sai sozinho.
    expect(cap!.nivel, `"${capacidade}" deixou de ser R3`).toBe('R3');
    expect(cap!.efeito?.escreveForaDoOS).toBe(true);
    expect(cap!.rota).toBe(rota);

    // Sem entrada no mapa, desligar o conector na tela de Conexões não alcança
    // esta capacidade — o botão de emergência viraria decoração para ela.
    expect(CONECTOR_DA_CAPACIDADE[capacidade]).toBe(conector);
  });

  it.each(ESCRITAS)('$capacidade tem argsSchema fechado', ({ capacidade, args }) => {
    const cap = CATALOGO.find((c) => c.id === capacidade)!;
    expect(
      cap.argsSchema,
      `"${capacidade}" sem argsSchema: a porta não valida nada e a aprovação assina um corpo livre`,
    ).toBeDefined();
    // `additionalProperties: false` é o que impede um campo clandestino de
    // viajar até o conector sem passar por revisão.
    expect(cap.argsSchema!.additionalProperties).toBe(false);
    for (const obrigatorio of cap.argsSchema!.required ?? []) {
      expect(Object.keys(args), `o caso de teste não manda "${obrigatorio}"`).toContain(obrigatorio);
    }
  });

  it('o e-mail continua confidencial — o RASTRO redige o corpo', () => {
    // Sensibilidade não é enfeite: é ela que faz o EventLogService trocar o
    // conteúdo por resumo criptográfico (RF-R-04). Um e-mail gravado em claro
    // no rastro seria vazamento com cinco anos de retenção.
    expect(CATALOGO.find((c) => c.id === 'email.enviar')!.efeito?.sensibilidade).toBe('confidencial');
    expect(CATALOGO.find((c) => c.id === WHATSAPP)!.efeito?.sensibilidade).toBe('confidencial');
  });
});

describe('MD6: a publicação no Instagram é escrita pela porta desde o primeiro dia', () => {
  it('instagram.post.publicar é R3, pública, com conector e argsSchema fechado', () => {
    const cap = CATALOGO.find((c) => c.id === 'instagram.post.publicar');
    expect(cap, 'instagram.post.publicar sumiu de politica-marketing-os.json').toBeDefined();
    expect(cap!.nivel).toBe('R3');
    expect(cap!.efeito?.escreveForaDoOS).toBe(true);
    expect(cap!.efeito?.sensibilidade).toBe('publica');
    expect(cap!.rota).toBe('POST /pauta/pecas/:id/publicar-instagram');
    expect(CONECTOR_DA_CAPACIDADE['instagram.post.publicar']).toBe('instagram');
    expect(cap!.argsSchema!.additionalProperties).toBe(false);
  });

  it('a rota nova entrega à porta e não conhece a Graph; a rota antiga ficou como estava', () => {
    const rota = ler('src/pauta/publicacao-instagram.controller.ts');
    expect(rota).not.toMatch(/plataformas\/instagram|GRAPH_DE_PUBLICACAO/);
    const servico = ler('src/pauta/publicacao-instagram.service.ts');
    expect(servico).toMatch(/this\.porta\.executar\(/);
    // A rota antiga (WhatsApp/ClickUp) e a dívida que ela mede não mudaram de lugar.
    expect(ler('src/pauta/rodada.controller.ts')).toMatch(/'pecas\/:id\/publicar'/);
  });
});

describe('MD9: a leitura dos comentários passa pela porta, e a fila não conhece a Graph', () => {
  it('instagram.comentario.ler é R0, sem ferramenta, com conector e argsSchema fechado', () => {
    const cap = CATALOGO.find((c) => c.id === 'instagram.comentario.ler');
    expect(cap, 'instagram.comentario.ler sumiu de politica-marketing-os.json').toBeDefined();
    expect(cap!.nivel).toBe('R0');
    expect(cap!.efeito?.escreveForaDoOS).toBe(false);
    expect((cap as { ferramenta?: string }).ferramenta).toBeUndefined();
    expect(CONECTOR_DA_CAPACIDADE['instagram.comentario.ler']).toBe('instagram');
    expect(cap!.argsSchema!.additionalProperties).toBe(false);
  });

  it('a rotina lê pela porta; as rotas da fila não chamam a Graph nem a porta', () => {
    const servico = ler('src/pauta/comentarios.service.ts');
    expect(servico).toMatch(/this\.porta\.executar\(/);
    const rota = ler('src/pauta/comentarios.controller.ts');
    expect(rota).not.toMatch(/plataformas\/instagram|GRAPH_DE_COMENTARIOS|PortaDoOperador|this\.porta/);
  });
});

describe('MD10: o YouTube é escrita pela porta desde o primeiro dia, só pelo lote', () => {
  it('youtube.video.enviar e youtube.video.publicar são R3, públicas, sob o lote, com conector e argsSchema fechado', () => {
    for (const id of ['youtube.video.enviar', 'youtube.video.publicar']) {
      const cap = CATALOGO.find((c) => c.id === id);
      expect(cap, `${id} sumiu de politica-marketing-os.json`).toBeDefined();
      expect(cap!.nivel).toBe('R3');
      expect(cap!.efeito?.escreveForaDoOS).toBe(true);
      expect(cap!.efeito?.sensibilidade).toBe('publica');
      expect((cap as { ferramenta?: string }).ferramenta).toBeUndefined();
      expect((cap as { aprovacao?: unknown }).aprovacao).toEqual({ modo: 'sob_lote', lote: 'pauta.semana.aprovar' });
      expect(CONECTOR_DA_CAPACIDADE[id]).toBe('youtube');
      expect(cap!.argsSchema!.additionalProperties).toBe(false);
    }
  });

  it('as rotas entregam à porta e não conhecem o conector; o retorno do OAuth não toca a porta', () => {
    const rota = ler('src/pauta/envio-ao-youtube.controller.ts');
    expect(rota).not.toMatch(/youtube\/youtube\.service|CLIENTE_DO_YOUTUBE|PortaDoOperador|this\.porta/);
    const servico = ler('src/pauta/envio-ao-youtube.service.ts');
    expect(servico).toMatch(/this\.porta\.executar\(/);
    const callback = ler('src/youtube/youtube-conexao.controller.ts');
    expect(callback).not.toMatch(/PortaDoOperador|this\.porta|\.\/youtube\.service/);
  });
});

describe('fatia 3.3: o caminho HTTP não alcança mais o conector', () => {
  const controlador = ler('src/google/google.controller.ts');

  it('o controlador das ações do Google não conhece o GoogleService', () => {
    /*
     * A catraca de arquitetura já vigia isto de forma genérica. Aqui a
     * afirmação é específica e diz o PORQUÊ para quem mexer neste arquivo: as
     * quatro escritas eram o pior caso do levantamento da fatia 3.2.
     */
    expect(controlador).not.toContain("from './google.service'");
    expect(controlador).toContain('PortaDoOperador');
  });

  it.each(ESCRITAS)('a rota de $capacidade cita a capacidade', ({ capacidade }) => {
    expect(
      controlador,
      `o controlador do Google não menciona "${capacidade}": a rota voltou a chamar o conector?`,
    ).toContain(`'${capacidade}'`);
  });

  it('o mapa de efeitos do agente não declara mais capacidade de conector', () => {
    const efeitosDoAgente = ler('src/agents/efeitos.service.ts');
    /*
     * As duas conferências olham a DECLARAÇÃO, não a menção: os dois nomes
     * aparecem em comentário naquele arquivo, explicando para onde o efeito
     * mudou, e um `toContain` seco proibiria justamente a explicação. A entrada
     * do mapa é `'<capacidade>':` e o import é uma linha começando em `import`.
     */
    expect(efeitosDoAgente, 'o efeito do WhatsApp voltou para o mapa do agente').not.toMatch(
      new RegExp(`['"]${WHATSAPP.replace(/\./g, '\\.')}['"]\\s*:`),
    );
    expect(efeitosDoAgente, 'o runtime voltou a importar o conector').not.toMatch(
      /^import[\s\S]{0,200}?evolution\.service/m,
    );
    // E o efeito existe do lado de lá: quem declara é o conector.
    expect(ler('src/pauta/evolution.service.ts')).toContain(WHATSAPP);
  });

  it('as escritas do ClickUp deixaram de ser capacidade sem efeito', () => {
    /*
     * `clickup.tarefa.criar` e `clickup.tarefa.alterar` são R3 no catálogo desde
     * sempre e não tinham efeito ligado: o agente propunha, a régua classificava,
     * uma pessoa aprovava — e a execução respondia "classificada e aprovada, mas
     * o efeito não está ligado nesta versão". A régua funcionava e a ação não
     * acontecia, que é o jeito mais silencioso de um produto não fazer o que
     * promete.
     */
    const conector = ler('src/integrations/clickup.service.ts');
    expect(conector).toMatch(/['"]clickup\.tarefa\.criar['"]\s*:/);
    expect(conector).toMatch(/['"]clickup\.tarefa\.alterar['"]\s*:/);
    expect(CONECTOR_DA_CAPACIDADE['clickup.tarefa.criar']).toBe('clickup');
    expect(CONECTOR_DA_CAPACIDADE['clickup.tarefa.alterar']).toBe('clickup');
  });

  it('o passa-tudo do Google está fechado', () => {
    const conector = ler('src/google/google.service.ts');
    /*
     * `api(orgId, url, init)` aceita URL e método ARBITRÁRIOS. Enquanto fosse
     * público, mover o import não moveria a fronteira: qualquer arquivo montava
     * o endereço por fora e entregava pronto — foi o que o espelho da Pauta fez
     * durante meses. Público de novo, a fatia se desfaz em silêncio.
     */
    expect(conector).toContain('private async api<T = any>');
    expect(ler('src/pauta/espelho.service.ts')).toContain('gravarArquivoNoDrive');
  });

  it('as duas escritas do ClickUp têm argsSchema fechado', () => {
    /*
     * A suíte exigia schema fechado das quatro do Google e não aplicava a mesma
     * régua às duas do ClickUp, que ganharam efeito ligado nesta fatia. Sem
     * `argsSchema` a porta não valida NADA: a aprovação assina um corpo livre, e
     * um `titulo` vazio só vira erro lá no ClickUp, com a aprovação já queimada.
     *
     * `clickup.tarefa.criar` vinha só de `politica-root.json` — cópia byte a
     * byte do anexo normativo, que não se edita aqui. O delta sobrescreve a
     * entrada inteira, então foi para lá que ela foi, com o mesmo nível e o
     * mesmo efeito.
     */
    for (const id of ['clickup.tarefa.criar', 'clickup.tarefa.alterar']) {
      const cap = CATALOGO.find((c) => c.id === id);
      expect(cap, `"${id}" não está no delta: sem sobrescrever, ela fica sem argsSchema`).toBeDefined();
      expect(cap!.nivel, `"${id}" deixou de ser R3`).toBe('R3');
      expect(
        cap!.argsSchema,
        `"${id}" sem argsSchema: a porta não valida nada e a aprovação assina um corpo livre`,
      ).toBeDefined();
      expect(cap!.argsSchema!.additionalProperties).toBe(false);
      expect(cap!.argsSchema!.required?.length, `"${id}" sem campo obrigatório nenhum`).toBeGreaterThan(0);
    }
  });

  it('a tela do Google trata a RETENÇÃO — não existe mais sucesso falso', () => {
    /*
     * ------------------------------------------------------------------------
     * O SUCESSO FALSO, e por que ele é caso de teste e não revisão de código
     * ------------------------------------------------------------------------
     * As quatro escritas viraram R3 e a rota passou a responder 200 com
     * `{status:'aguardando_aprovacao'}` — aceita e retida, que não é erro. Os
     * três tratadores da tela tratavam qualquer 200 como envio feito e
     * escreviam "✅ E-mail enviado". A pessoa fechava a tela achando que o
     * e-mail saiu, e ele estava numa fila esperando OUTRA pessoa.
     *
     * A catraca é de FONTE porque o web não tem suíte de componente nesta
     * branch. Ela mede o mínimo que não dá para fazer por acidente: a tela
     * reconhece o estado e menciona a fila.
     */
    const raizDoRepo = path.resolve(RAIZ, '..', '..');
    const tela = readFileSync(
      path.join(raizDoRepo, 'apps', 'web', 'src', 'app', 'google', 'page.tsx'),
      'utf8',
    );
    expect(tela, 'a tela não reconhece a resposta de retenção da porta').toContain(
      'aguardando_aprovacao',
    );
    // Os três tratadores desviam ANTES do "✅": um `foiRetida` por handler.
    expect([...tela.matchAll(/foiRetida\(r\)/g)], 'algum tratador ainda dá sucesso em cima de retenção').toHaveLength(3);
    expect(tela, 'a tela não manda a pessoa para a fila').toMatch(/\/atendimento/);
    expect(tela, 'a tela não diz que precisa de outra pessoa').toMatch(/outra pessoa/i);
  });
});

// ---------------------------------------------------------------------------
// Bloco 1-bis — as catracas de DONO dos dois registros novos
// ---------------------------------------------------------------------------

describe('fatia 3.3: os registros novos têm catraca de dono', () => {
  it('o registro de efeitos RECUSA reinscrição — sequestro de efeito não passa calado', () => {
    /*
     * ------------------------------------------------------------------------
     * O FURO: `mapa.set()` seco, e a segunda inscrição vencia em silêncio
     * ------------------------------------------------------------------------
     * Qualquer serviço podia registrar qualquer identificador, inclusive um já
     * registrado por outro conector. O que isso valia: um arquivo de um módulo
     * qualquer inscreve `email.enviar` e passa a executar código dele com a
     * CLASSIFICAÇÃO ALHEIA — a porta continua vendo um R3 do Google, continua
     * retendo para aprovação, continua escrevendo "e-mail enviado" no RASTRO, e
     * quem sai é outro código. Nada no log, nada no rastro, nada na tela. O
     * registro irmão (conectores configurados) ao menos avisava.
     */
    const reg = new EfeitosRegistry();
    reg.registrar({ 'email.enviar': async () => ({ ok: true }) }, 'GoogleService');
    expect(reg.donoDe('email.enviar')).toBe('GoogleService');

    expect(() =>
      reg.registrar({ 'email.enviar': async () => ({ ok: 'sequestrado' }) }, 'ModuloQualquer'),
    ).toThrow(/inscrito duas vezes/i);

    // E o dono não mudou: a recusa é antes da escrita, não depois.
    expect(reg.donoDe('email.enviar')).toBe('GoogleService');
    expect(reg.tamanho).toBe(1);
  });

  it('toda capacidade com efeito ligado existe no catálogo', () => {
    /*
     * O OUTRO LADO DA MESMA CATRACA. Registrar um identificador FORA do catálogo
     * não abre caminho — a porta recusa capacidade sem classificação antes de
     * qualquer efeito (vale R5, que é bloqueio). Mas ele fica no registro sem
     * nunca poder rodar, e `temEfeito` responde `true` sobre uma coisa que a
     * porta nunca vai deixar acontecer: dívida silenciosa, com cara de
     * funcionalidade.
     *
     * A varredura é de FONTE porque os efeitos só existem em tempo de execução,
     * dentro dos `onModuleInit` dos conectores — instanciá-los aqui pediria o
     * Nest inteiro. O que ela lê são as chaves declaradas nos quatro arquivos
     * que inscrevem, e cruza com a união do catálogo.
     */
    const uniao = new Set<string>([
      ...CATALOGO.map((c) => c.id),
      ...(
        JSON.parse(
          readFileSync(
            path.join(path.resolve(RAIZ, '..', '..'), 'packages', 'policy', 'politica-root.json'),
            'utf8',
          ),
        ) as { capacidades: { id: string }[] }
      ).capacidades.map((c) => c.id),
    ]);

    const QUEM_INSCREVE = [
      'src/agents/efeitos.service.ts',
      'src/google/google.service.ts',
      'src/integrations/clickup.service.ts',
      'src/pauta/evolution.service.ts',
      // MD6: o publicador do Instagram inscreve `instagram.post.publicar`.
      'src/pauta/publicacao-instagram.service.ts',
      // MD9: o coletor da fila da DM inscreve `instagram.comentario.ler`.
      'src/pauta/comentarios.service.ts',
      // MD10: o envio ao YouTube inscreve `youtube.video.enviar` e `youtube.video.publicar`.
      'src/pauta/envio-ao-youtube.service.ts',
    ];

    /** As chaves de um bloco `this.efeitos.registrar({ 'x.y': …, 'a.b': … })`. */
    const chavesDe = (rel: string): string[] => {
      const fonte = ler(rel);
      const inicio = fonte.search(/\.registrar\(\{/);
      if (inicio < 0) return [];
      return [...fonte.slice(inicio).matchAll(/^\s{6}'([a-z][\w.]+)':/gm)].map((m) => m[1]);
    };

    /*
     * CADA UM DOS QUATRO TEM DE CONTRIBUIR. Sem isto, uma mudança de formatação
     * num arquivo só (o bloco recuado de outro jeito, o mapa quebrado em duas
     * chamadas) faria a varredura devolver menos chaves e o caso passar por não
     * ter achado nada para reclamar — catraca que cala quando cega é pior que
     * catraca nenhuma.
     */
    for (const arq of QUEM_INSCREVE) {
      expect(chavesDe(arq).length, `a varredura não achou efeito em ${arq}: o formato do bloco mudou?`).toBeGreaterThan(0);
    }
    const inscritas = QUEM_INSCREVE.flatMap(chavesDe);
    expect(
      inscritas.length,
      'a varredura achou menos efeitos do que os 23 que existem: ou alguém apagou inscrição, ou o padrão do arquivo mudou',
    ).toBeGreaterThanOrEqual(23);

    const foraDoCatalogo = inscritas.filter((id) => !uniao.has(id));
    expect(
      foraDoCatalogo,
      '\nEFEITO LIGADO PARA CAPACIDADE QUE NÃO EXISTE NO CATÁLOGO:\n' +
        foraDoCatalogo.map((c) => `  - ${c}`).join('\n') +
        '\n\n  A porta recusa capacidade sem classificação (vale R5 = bloqueio), então isto não\n' +
        '  abre caminho nenhum — mas `temEfeito` passa a responder `true` sobre uma ação que\n' +
        '  nunca vai poder sair. Ou declare a capacidade no catálogo, ou apague a inscrição.\n',
    ).toEqual([]);

    // E ninguém inscreve a mesma capacidade duas vezes — a catraca de dono
    // derrubaria o arranque, mas aqui a violação é apontada com o nome.
    const repetidas = inscritas.filter((id, i) => inscritas.indexOf(id) !== i);
    expect(repetidas, `capacidade inscrita por dois serviços: ${repetidas.join(', ')}`).toEqual([]);
  });

  it('o registro de conectores configurados RECUSA SUBIR sem quem tem dono de segredo', () => {
    /*
     * A catraca que faltava, e a assimetria que ela corrige: o
     * `InterruptoresRegistry` ao lado recusa subir se ninguém se inscrever nele;
     * este não tinha nada. Um conector que esquecesse a linha de inscrição
     * voltaria a aparecer como DESCONECTADO na tela — com credencial no lugar,
     * funcionando — e ninguém saberia por quê. É a mesma mentira que o registro
     * existe para consertar, chegando por omissão.
     */
    const reg = new ConectoresConfiguradosRegistry();
    expect(() => reg.onApplicationBootstrap()).toThrow(/sem dono/i);

    for (const chave of CONECTORES_QUE_DEVEM_RESPONDER) reg.registrar(chave, () => true);
    expect(() => reg.onApplicationBootstrap()).not.toThrow();

    // Um a menos volta a derrubar, e a mensagem nomeia quem falta.
    const faltandoUm = new ConectoresConfiguradosRegistry();
    for (const chave of CONECTORES_QUE_DEVEM_RESPONDER.slice(1)) faltandoUm.registrar(chave, () => true);
    expect(() => faltandoUm.onApplicationBootstrap()).toThrow(
      new RegExp(CONECTORES_QUE_DEVEM_RESPONDER[0]),
    );
  });

  it('conector de OAuth NÃO se inscreve — senão a tela mente sobre quem nunca autorizou', () => {
    /*
     * ------------------------------------------------------------------------
     * A TELA DE CONEXÕES FICOU MENOS HONESTA, e era o que a fatia queria consertar
     * ------------------------------------------------------------------------
     * As quatro superfícies do Google são de AUTORIZAÇÃO POR EMPRESA: o estado
     * verdadeiro delas é a linha de `IntegrationAccount` que o retorno do OAuth
     * cria. A primeira versão desta fatia as inscreveu no registro respondendo
     * `() => this.configured`, que é `GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET`
     * — verdadeiro em produção para TODO mundo. Para uma empresa que nunca
     * autorizou nada não existe linha, a tela caía na derivação, recebia `true`
     * e passava a exibir o Google como CONECTADO.
     *
     * Sem inscrição, o registro devolve `null` ("ninguém respondeu por esta
     * chave"), `IntegrationsService` mantém o status do banco e a tela volta a
     * dizer a verdade — que é o comportamento que ela tinha ANTES da fatia.
     */
    const conector = ler('src/google/google.service.ts');
    for (const chave of ['gmail', 'gcal', 'gdocs', 'drive']) {
      expect(
        conector,
        `o GoogleService voltou a inscrever "${chave}" em ConectoresConfigurados: a tela passa a ` +
          'dizer "conectado" para empresa que nunca autorizou',
      ).not.toMatch(new RegExp(`registrar\\(\\s*'${chave}'`));
      expect(CONECTORES_QUE_DEVEM_RESPONDER).not.toContain(chave);
    }

    /*
     * E a tela não voltou a LER a credencial do Google por conta própria — era
     * a frente 4 da catraca de arquitetura.
     *
     * A asserção procura a LEITURA (`process.env.GOOGLE_…`), não a menção:
     * explicar por escrito por que aquelas variáveis não servem para derivar o
     * status é justamente o que impede a volta do defeito, e proibir a palavra
     * proibiria a explicação. É a mesma distinção que a catraca de arquitetura
     * faz ao varrer o código sem os comentários.
     */
    const tela = ler('src/integrations/integrations.service.ts');
    expect(tela).not.toMatch(/process\.env\.GOOGLE_/);
    expect(tela).not.toMatch(/env\.GOOGLE_/);
  });
});

// ---------------------------------------------------------------------------
// Bloco 2 — com banco: a porta de verdade
// ---------------------------------------------------------------------------

const URL = process.env.TEST_DATABASE_URL;
if (URL) exigirBancoDescartavel(URL, 'escreve propostas, aprovações e RASTRO');

const ORG = 'org-escritas-porta';

/*
 * ---------------------------------------------------------------------------
 * DOIS ATORES, E NÃO É DETALHE DE ARRANJO DE SUÍTE
 * ---------------------------------------------------------------------------
 * A primeira versão desta suíte propunha e confirmava com a MESMA pessoa, e
 * `ApprovalsService.confirm` recusa isso (invariante 7 da escada: quem propôs a
 * ação não pode aprová-la). Seis dos doze casos com banco falhavam — e os seis
 * eram justamente a metade que prova o item de SEGURANÇA da fatia: que o efeito
 * roda uma vez, e só depois da confirmação. O que passava era a retenção e o
 * interruptor; a execução pós-aprovação não estava provada por comportamento
 * nenhum.
 *
 * A separação de funções não se contorna — ela é o ponto. O conserto é medir o
 * caminho REAL: PEDRO clica (vira proponente, porque neste caminho o ator da
 * porta é quem clicou) e LUCAS confirma.
 *
 * LUCAS É `gestor_marketing` DE PROPÓSITO, e não um segundo admin: R3 exige
 * alçada `responsavel`, que é o piso da regra, e medir com o papel mais baixo
 * que ainda serve é o que prova que o caminho funciona para gente que não é
 * dona da empresa.
 */
const PEDRO = { id: 'pedro-escritas', papeis: ['admin_master'] };
const LUCAS = { id: 'lucas-escritas', papeis: ['gestor_marketing'] };

describe.skipIf(!URL)('fatia 3.3: a escrita de quem clica na tela passa pela porta', () => {
  let prisma: PrismaClient;
  let policy: PolicyService;
  let approvals: ApprovalsService;
  let eventos: EventLogService;
  let registro: EfeitosRegistry;
  let gateway: ToolGateway;
  let acoes: AcoesService;
  let porta: PortaDoOperador;
  let conectores: ConectoresService;
  /** Quantas vezes CADA efeito falso foi chamado, e com quê. */
  let chamadas: Array<{ capacidade: string; args: Record<string, unknown>; ator: string | null }>;

  /*
   * O contexto que a aplicação abre por requisição. `ConectoresService` exige
   * que a empresa do contexto case com a do argumento (ver `empresaDaConsulta`),
   * e sem isto o interruptor falha FECHADO — recusaria tudo, e a suíte mediria
   * a trava errada.
   */
  const naEmpresa = <T>(fn: () => Promise<T>): Promise<T> =>
    comContexto({ orgId: ORG, correlationId: 'clique-1', origem: 'http' }, fn);

  const pedir = (e: EscritaMigrada, args?: Record<string, unknown>) =>
    naEmpresa(() =>
      porta.executar({
        orgId: ORG,
        actorId: PEDRO.id,
        capabilityId: e.capacidade,
        args: args ?? e.args,
        resource: { type: e.capacidade, id: 'alvo-1' },
      }),
    );

  beforeAll(async () => {
    // Relógio preso às 14:00: o sinal `fora_da_janela` sobe todo nível um
    // degrau e transformaria R3 em R4, que pede motivo escrito na confirmação.
    vi.setSystemTime(new Date('2026-09-01T14:00:00-03:00'));
    process.env.GATEWAY_MODO = 'impor';

    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    await prisma.org.upsert({
      where: { id: ORG },
      create: { id: ORG, name: 'Escritas pela porta', slug: 'escritas-porta' },
      update: {},
    });
    const papel = await prisma.role.upsert({
      where: { orgId_key: { orgId: ORG, key: 'admin_master' } },
      create: { orgId: ORG, key: 'admin_master', name: 'Admin Master' },
      update: {},
      select: { id: true },
    });
    // O papel de LUCAS. `gestor_marketing` concede alçada `responsavel`, que é
    // exatamente o que R3 exige — ver o bloco sobre os dois atores, acima.
    const papelDoLucas = await prisma.role.upsert({
      where: { orgId_key: { orgId: ORG, key: 'gestor_marketing' } },
      create: { orgId: ORG, key: 'gestor_marketing', name: 'Gestor de Marketing' },
      update: {},
      select: { id: true },
    });
    await prisma.user.upsert({
      where: { id: PEDRO.id },
      create: {
        id: PEDRO.id,
        orgId: ORG,
        email: 'pedro@escritas.teste',
        name: 'Pedro',
        passwordHash: 'sem-senha-util',
        roles: { connect: { id: papel.id } },
      },
      update: { isActive: true, roles: { set: [{ id: papel.id }] } },
    });
    // O aprovador precisa EXISTIR e estar ATIVO: `confirm` relê o banco antes de
    // comparar alçada, e um `QuemAprova` montado à mão não substitui a linha.
    await prisma.user.upsert({
      where: { id: LUCAS.id },
      create: {
        id: LUCAS.id,
        orgId: ORG,
        email: 'lucas@escritas.teste',
        name: 'Lucas',
        passwordHash: 'sem-senha-util',
        roles: { connect: { id: papelDoLucas.id } },
      },
      update: { isActive: true, roles: { set: [{ id: papelDoLucas.id }] } },
    });

    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    policy = new PolicyService(p);
    await policy.onModuleInit();
    approvals = new ApprovalsService(p, audit);
    eventos = new EventLogService(p);

    /*
     * OS EFEITOS SÃO FALSOS, e é o desenho certo para esta suíte: o que está
     * sob teste é a FRONTEIRA, não o cliente HTTP do Google. Cada um anota que
     * foi chamado — e é justamente a AUSÊNCIA dessa anotação que prova a
     * afirmação mais importante daqui: numa ação R3 nada sai antes de alguém
     * confirmar.
     */
    chamadas = [];
    registro = new EfeitosRegistry();
    const falso = (capacidade: string) => async (
      args: Record<string, unknown>,
      _org: string,
      ctx: { actorId?: string | null },
    ) => {
      chamadas.push({ capacidade, args, ator: ctx.actorId ?? null });
      return { ok: true, capacidade };
    };
    registro.registrar(
      Object.fromEntries(ESCRITAS.map((e) => [e.capacidade, falso(e.capacidade)])),
    );

    const interruptores = new InterruptoresRegistry();
    conectores = new ConectoresService(p, audit, eventos, interruptores);
    conectores.onModuleInit();

    gateway = new ToolGateway(
      p,
      policy,
      new SinaisService(p, policy),
      approvals,
      eventos,
      undefined,
      interruptores,
      registro,
    );
    acoes = new AcoesService(p, gateway, eventos, interruptores, policy);
    porta = new PortaDoOperador(gateway, registro);
  });

  afterAll(async () => {
    vi.useRealTimers();
    /*
     * A FAXINA DO RASTRO VAI NUMA TRANSAÇÃO SÓ — e isso não é estilo.
     *
     * `EventLog` é do BANCO INTEIRO, compartilhado com os outros arquivos de
     * teste, que o vitest roda EM PARALELO contra o mesmo Postgres. Em três
     * comandos soltos, a RULE de append-only fica desligada para TODO MUNDO
     * durante a janela entre eles: se `rastro-retencao.test.ts` medir o
     * append-only nesse instante, ele vê o DELETE passar e sai vermelho por um
     * defeito que não existe. Foi medido piscando uma vez em três rodadas com as
     * duas suítes juntas (11/09/2026).
     *
     * Dentro de uma transação, o `ALTER TABLE` segura ACCESS EXCLUSIVE até o
     * commit: enquanto a RULE está desligada, nenhuma outra sessão consegue
     * sequer LER a tabela. E worker morto no meio derruba a transação e devolve
     * a RULE ligada — em vez de deixar o banco sem append-only para sempre.
     *
     * É o mesmo conserto que a onda 6 fez em `apagarRastroDeTeste`, em
     * `rastro-retencao.test.ts`. O `$transaction` com lista de comandos é o que
     * garante a mesma conexão para os três.
     */
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
      prisma.$executeRawUnsafe('DELETE FROM "EventLog" WHERE "orgId" = $1', ORG),
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
    ]);
    await prisma.approval.deleteMany({ where: { orgId: ORG } });
    await prisma.toolCall.deleteMany({ where: { orgId: ORG } });
    await prisma.policyDecision.deleteMany({ where: { orgId: ORG } });
    await prisma.conectorDesligado.deleteMany({ where: { orgId: ORG } });
    /*
     * A AUDITORIA TAMBÉM, e ela só apareceu quando a suíte passou a CONFIRMAR de
     * verdade: `propor` e `confirm` escrevem em `AuditLog`, que tem chave
     * estrangeira para `Org`. Enquanto a confirmação falhava por separação de
     * funções, a tabela ficava vazia e a limpeza passava por acidente.
     *
     * `AuditLog` não é o RASTRO (`EventLog`, append-only por RULE): é o log
     * administrativo, e apagar as linhas de uma empresa de teste não fere
     * constraint nenhuma do produto.
     */
    await prisma.auditLog.deleteMany({ where: { orgId: ORG } });
    await prisma.user.deleteMany({ where: { orgId: ORG } });
    await prisma.role.deleteMany({ where: { orgId: ORG } });
    await prisma.org.deleteMany({ where: { id: ORG } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    chamadas = [];
    await prisma.conectorDesligado.deleteMany({ where: { orgId: ORG } });
    /*
     * O HISTÓRICO DE CHAMADAS DESTA EMPRESA, ZERADO ENTRE CASOS — e não é
     * higiene, é o que mantém o que está sendo medido.
     *
     * `SinaisService` acende `volume_atipico` quando as chamadas da última hora
     * passam do triplo da média por hora dos últimos 30 dias. Com o relógio
     * preso às 14:00, o SEGUNDO caso a pedir a mesma capacidade já estoura esse
     * limite — e o sinal sobe a ação de R3 para R4, que exige alçada `titular`.
     * Efeito prático: a partir do segundo caso, a suíte deixaria de medir a
     * separação de funções em R3 e passaria a medir escalonamento, exigindo um
     * aprovador titular por um motivo que não tem nada a ver com o assunto
     * daqui. Escalonamento tem suíte própria.
     *
     * Só `ToolCall`, e só desta empresa: é a única tabela que os dois lados do
     * sinal leem. `toolCallId` é uma coluna solta em `Approval` e em `EventLog`
     * (sem chave estrangeira no schema), então apagar aqui não arrasta nem
     * quebra nada — e o RASTRO, que é append-only, continua intacto.
     */
    await prisma.toolCall.deleteMany({ where: { orgId: ORG } });
  });

  it.each(ESCRITAS)('$capacidade é RETIDA: nada sai antes de alguém confirmar', async (e) => {
    const r = (await pedir(e)) as AcaoRetida;

    expect(r.status, `"${e.capacidade}" executou na hora — a retenção de R3 sumiu`).toBe(
      'aguardando_aprovacao',
    );
    expect(r.approvalId).toBeTruthy();
    expect(r.nivel).toBe('R3');
    // A prova de que a fatia funcionou: o efeito NÃO rodou.
    expect(chamadas, 'o efeito rodou sem aprovação nenhuma').toEqual([]);

    // E ficou tudo registrado — era isto que a rota antiga não fazia.
    const chamada = await prisma.toolCall.findFirst({
      where: { orgId: ORG, capabilityId: e.capacidade },
      orderBy: { criadoEm: 'desc' },
    });
    expect(chamada?.status).toBe('aguardando_aprovacao');
    expect(chamada?.actorType, 'o ator tem de ser GENTE neste caminho').toBe(ActorType.user);
    expect(chamada?.actorId).toBe(PEDRO.id);
    expect(chamada?.decisionId, 'sem decisão de política gravada').toBeTruthy();

    const proposta = await prisma.eventLog.findFirst({
      where: { orgId: ORG, tipo: 'tool.proposta', capabilityId: e.capacidade },
      orderBy: { seq: 'desc' },
    });
    expect(proposta, 'a proposta não entrou no RASTRO').toBeTruthy();
  });

  it('quem clicou NÃO pode confirmar a própria ação', async () => {
    /*
     * A consequência mais visível de a escrita passar pela porta, medida em vez
     * de suposta: o proponente desta aprovação é quem CLICOU, e a escada proíbe
     * que ele assine o próprio pedido. As quatro escritas do Google, que antes
     * saíam no clique, passam a exigir uma segunda pessoa.
     *
     * O caso existe para que ninguém "conserte" isso um dia rebaixando a regra:
     * se alguém fizer a porta gravar outro proponente, ou afrouxar `confirm`,
     * este caso fica vermelho e diz o porquê.
     */
    const r = (await pedir(ESCRITAS[0])) as AcaoRetida;
    expect(r.precisaDeOutraPessoa, 'o bilhete da fila deixou de avisar que precisa de outra pessoa').toBe(true);
    expect(r.mensagem).toMatch(/outra pessoa/i);
    expect(r.fila, 'o bilhete não diz onde a fila mora').toBeTruthy();

    const proposta = await prisma.approval.findUnique({
      where: { id: r.approvalId },
      select: { propostoPorId: true, alcadaMinima: true },
    });
    expect(proposta?.propostoPorId, 'o proponente tem de ser quem clicou').toBe(PEDRO.id);
    // R3 exige `responsavel`: é por isso que LUCAS (gestor_marketing) serve.
    expect(proposta?.alcadaMinima).toBe('responsavel');

    await expect(naEmpresa(() => approvals.confirm(ORG, r.approvalId, PEDRO))).rejects.toThrow(
      /não pode aprová-la/i,
    );
    expect(chamadas, 'a recusa de separação de funções deixou o efeito rodar').toEqual([]);

    // E a outra pessoa consegue: a ação está retida, não travada.
    await naEmpresa(() => approvals.confirm(ORG, r.approvalId, LUCAS));
    await naEmpresa(() => acoes.executarAprovada(ORG, r.approvalId, LUCAS.id));
    expect(chamadas).toHaveLength(1);
  });

  it.each(ESCRITAS)('$capacidade só chega no conector depois da confirmação', async (e) => {
    const r = (await pedir(e)) as AcaoRetida;
    await naEmpresa(() => approvals.confirm(ORG, r.approvalId, LUCAS));
    const exec = await naEmpresa(() => acoes.executarAprovada(ORG, r.approvalId, LUCAS.id));

    expect(exec.status).toBe('executado');
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].capacidade).toBe(e.capacidade);
    // Os argumentos são os GRAVADOS na proposta, não os da confirmação.
    for (const [k, v] of Object.entries(e.args)) expect(chamadas[0].args[k]).toEqual(v);
    /*
     * O ATOR DO EFEITO É QUEM APROVOU, e aqui isso deixa de ser afirmação de
     * comentário: o proponente é PEDRO e o efeito recebe LUCAS. É o executor
     * que responde pelo que saiu.
     */
    expect(chamadas[0].ator).toBe(LUCAS.id);

    const desfecho = await prisma.eventLog.findFirst({
      where: { orgId: ORG, tipo: 'acao.executada', capabilityId: e.capacidade },
      orderBy: { seq: 'desc' },
    });
    expect(desfecho, 'a execução não entrou no RASTRO').toBeTruthy();
  });

  it('confirmar duas vezes não manda o e-mail duas vezes', async () => {
    const e = ESCRITAS[0];
    const r = (await pedir(e)) as AcaoRetida;
    await naEmpresa(() => approvals.confirm(ORG, r.approvalId, LUCAS));
    await naEmpresa(() => acoes.executarAprovada(ORG, r.approvalId, LUCAS.id));
    await expect(
      naEmpresa(() => acoes.executarAprovada(ORG, r.approvalId, LUCAS.id)),
    ).rejects.toThrow(/já foi executada|uso único/i);
    expect(chamadas).toHaveLength(1);
  });

  it('recusa DEPOIS de confirmar não queima a aprovação — ela volta a executar', async () => {
    /*
     * ------------------------------------------------------------------------
     * O LIMBO DA ONDA 6, INVERTIDO — e por que a ordem das duas metades importa
     * ------------------------------------------------------------------------
     * `AcoesService.executarAprovada` pergunta à porta se a régua de HOJE ainda
     * deixa a ação sair (`conferirAprovado`), e a primeira versão desta fatia
     * fazia essa pergunta DEPOIS de marcar a aprovação como `consumida` —
     * porque conferir e disparar eram o mesmo método.
     *
     * Consequência: régua reclassificou para bloqueio, capacidade saiu do
     * catálogo ou `argsSchema` apertou, e a ação não saía com a aprovação já em
     * estado TERMINAL. `consumida` se lê como "executada": some da fila,
     * `confirm` recusa o que não está pendente, `executarAprovada` recusa o que
     * não está `confirmada`. Ninguém reexecuta, ninguém repropõe — e a mensagem
     * ainda afirmava que a aprovação "continua registrada".
     *
     * Este caso mede o conserto pelo comportamento: o conector desligado é o
     * gatilho mais fácil de produzir, e ele cai na MESMA posição da conferência
     * de régua. Recusado, o estado tem de continuar `confirmada`, e religar +
     * chamar de novo tem de EXECUTAR, sem nova autorização.
     */
    const r = (await pedir(ESCRITAS[0])) as AcaoRetida;
    await naEmpresa(() => approvals.confirm(ORG, r.approvalId, LUCAS));
    await naEmpresa(() => conectores.desligar(ORG, 'google', { motivo: 'incidente' }));

    await expect(
      naEmpresa(() => acoes.executarAprovada(ORG, r.approvalId, LUCAS.id)),
    ).rejects.toThrow(/desligado/i);
    expect(chamadas, 'recusou e mandou assim mesmo').toEqual([]);

    const depoisDaRecusa = await prisma.approval.findUnique({
      where: { id: r.approvalId },
      select: { status: true, consumidoEm: true },
    });
    expect(
      depoisDaRecusa?.status,
      'a aprovação foi QUEIMADA numa recusa: estado terminal do qual não se reexecuta nem se repropõe',
    ).toBe('confirmada');
    expect(depoisDaRecusa?.consumidoEm).toBeNull();

    // Religar e chamar de novo executa — que é exatamente o que a frase da
    // recusa promete a quem opera.
    await naEmpresa(() => conectores.religar(ORG, 'google'));
    const exec = await naEmpresa(() => acoes.executarAprovada(ORG, r.approvalId, LUCAS.id));
    expect(exec.status).toBe('executado');
    expect(chamadas).toHaveLength(1);
  });

  it('desligar o Google na tela de Conexões para o envio de e-mail', async () => {
    /*
     * O FURO QUE ESTA FATIA FECHOU, dito em um caso. O interruptor por empresa
     * existia desde a onda 6, mas só alcançava ferramenta de agente: a rota
     * HTTP do Google não perguntava a ninguém. Quem clicasse em "desligar o
     * Google" durante um incidente continuava conseguindo mandar e-mail pela
     * tela — e pararia de procurar outro jeito de parar a máquina.
     */
    await naEmpresa(() => conectores.desligar(ORG, 'google', { motivo: 'incidente' }));

    await expect(pedir(ESCRITAS[0])).rejects.toThrow(/desligado/i);
    expect(chamadas, 'o conector estava desligado e o efeito rodou assim mesmo').toEqual([]);
  });

  it('capacidade sem efeito ligado não vira item na fila que ninguém executa', async () => {
    /*
     * Deixar a porta classificar, registrar e criar aprovação para uma ação que
     * nunca vai poder sair produziria uma linha na fila que só se revela quebrada
     * quando alguém confirma. Falha cedo, com a frase inteira.
     *
     * A ASSERÇÃO MEDE A DIFERENÇA, e não o total. A primeira versão contava
     * TODAS as pendentes da empresa e exigia zero — o que só passava por acaso,
     * num arquivo cujos outros casos deixam pendências para trás de propósito
     * (os quatro de retenção). A pergunta aqui é uma só: ESTA chamada criou
     * aprovação? Contar antes e depois é o jeito de respondê-la sem depender do
     * que os vizinhos fizeram.
     */
    const contar = () =>
      prisma.approval.count({
        where: { orgId: ORG, capabilityId: 'email.enviar', status: 'pendente' },
      });
    const antes = await contar();

    const semEfeito = new PortaDoOperador(gateway, new EfeitosRegistry());
    await expect(
      naEmpresa(() =>
        semEfeito.executar({
          orgId: ORG,
          actorId: PEDRO.id,
          capabilityId: 'email.enviar',
          args: ESCRITAS[0].args,
        }),
      ),
    ).rejects.toThrow(/não tem efeito ligado/i);

    expect(
      (await contar()) - antes,
      'criou aprovação para uma ação que não tem como executar',
    ).toBe(0);
  });

  it('o registro de conectores configurados responde null para quem não se inscreveu', () => {
    /*
     * `null` não é `false`, e a tela de Conexões precisa dos dois: `false` é "o
     * conector diz que não tem credencial"; `null` é "ninguém respondeu por esta
     * chave". Apagar a diferença faria a tela afirmar "desconectado" sobre
     * conector builtin, que nunca precisou de credencial.
     */
    const reg = new ConectoresConfiguradosRegistry();
    expect(reg.configurado('clickup')).toBeNull();
    reg.registrar('clickup', () => false);
    expect(reg.configurado('clickup')).toBe(false);
    reg.registrar('gmail', () => true);
    expect(reg.configurado('gmail')).toBe(true);
    expect(reg.inscritos).toEqual(['clickup', 'gmail']);
    // Conector que estoura ao responder não pode derrubar a tela de Conexões.
    reg.registrar('asaas', () => {
      throw new Error('conector quebrado');
    });
    expect(reg.configurado('asaas')).toBeNull();
  });
});
