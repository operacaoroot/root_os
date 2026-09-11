import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, ROLES } from '@mktos/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { comContexto, novaCorrelacao } from '../src/common/contexto-execucao';
import { comTenantNaSessao, esquecerAvisos } from '../src/prisma/sessao-de-banco';
import {
  PAPEL_INICIAL,
  ProvisionamentoInvalidoError,
  ProvisionamentoSemPlataformaError,
  SLUG_DA_PLATAFORMA,
  provisionarTenant,
  type AuditoriaDeProvisionamento,
  type EntradaDeProvisionamento,
  type EventoDeProvisionamento,
  type OpcoesDeProvisionamento,
} from '../src/tenants/provisionar';
import { ProvisionamentoController } from '../src/tenants/provisionar.controller';
import type { AuditInput } from '../src/audit/audit.service';
import type { JwtUser } from '../src/auth/current-user.decorator';
import { exigirBancoDescartavel } from './banco-de-teste';
import { provisionarTenantDeTeste } from './tenant-provisionado';

/*
 * PROVISIONAR EMPRESA É IDEMPOTENTE — RF-T-07.
 *
 * A promessa em uma frase: rodar duas vezes com o mesmo slug produz o mesmo
 * estado, sem duplicata e sem erro. É isso que os casos abaixo medem contra um
 * banco de verdade — com Prisma, não com dublê, porque metade do que pode dar
 * errado aqui é do banco (índice único do slug, e-mail único global, transação
 * que tem de voltar inteira).
 *
 * E A PROMESSA TEM UM SEGUNDO LADO, que uma revisão adversarial cobrou e que o
 * bloco "a rota não escreve dentro de empresa alheia" cobre: rodar de novo não
 * pode ser porta de entrada em empresa que já existe. Ver `ModoDeProvisionamento`.
 *
 * COMO RODAR (Postgres descartável do host — inventário dos bancos em
 * `test/banco-de-teste.ts`; é `marketing_os_test`, o mesmo das outras):
 *   TEST_DATABASE_URL='postgresql://mkt:shadow@localhost:55432/marketing_os_test' \
 *     pnpm --filter @mktos/api exec vitest run test/provisionamento.test.ts
 *
 * Sem `TEST_DATABASE_URL` a suíte se PULA (não lança), pelo mesmo motivo de
 * `porta.test.ts`: ela precisa estar no conjunto padrão para que quem tem banco
 * de teste a veja rodar, e o conjunto padrão roda em máquina sem banco.
 */
const URL = process.env.TEST_DATABASE_URL;
if (URL) exigirBancoDescartavel(URL, 'ESCREVE nele (cria empresas de teste)');

/** O retrato do que existe para esta empresa — o que a segunda rodada não pode mexer. */
async function retrato(prisma: PrismaClient, orgId: string) {
  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { name: true, slug: true, modulos: true, isActive: true },
  });
  const papeis = await prisma.role.findMany({
    where: { orgId },
    select: { key: true, name: true, permissions: { select: { key: true } } },
    orderBy: { key: 'asc' },
  });
  const usuarios = await prisma.user.findMany({
    where: { orgId },
    select: { email: true, passwordHash: true, roles: { select: { key: true } } },
    orderBy: { email: 'asc' },
  });
  const politicas = await prisma.policyVersion.count({ where: { orgId } });
  const notas = await prisma.knowledgeNote.count({ where: { orgId } });
  return {
    org,
    papeis: papeis.map((p) => ({ ...p, permissions: p.permissions.map((x) => x.key).sort() })),
    usuarios,
    politicas,
    notas,
  };
}

describe.skipIf(!URL)('provisionar empresa (RF-T-07)', () => {
  let prisma: PrismaClient;
  /** Marca desta rodada: a limpeza é por id, mas o slug precisa não colidir. */
  const MARCA = randomUUID().slice(0, 8);
  const criadas: string[] = [];
  const slug = (sufixo: string) => `prov-${MARCA}-${sufixo}`;
  const email = (sufixo: string) => `${sufixo}.${MARCA}@provisionamento.local`;

  /**
   * A empresa que faz o papel da PLATAFORMA nesta suíte.
   *
   * Existe porque o evento de INTENÇÃO precisa de uma empresa onde caber
   * (`EventLog.orgId` aponta para `Org`) e porque a auditoria de operação de
   * plataforma mora nela. Em produção é a `root`; aqui é uma empresa
   * descartável, criada pelo mesmo caminho.
   */
  let plataformaId = '';

  /** Provisiona e anota a empresa para a limpeza do fim. */
  const nascer = async (
    entrada: EntradaDeProvisionamento,
    opcoes?: OpcoesDeProvisionamento,
  ) => {
    const r = await provisionarTenant(prisma, entrada, {
      ordenante: plataformaId || undefined,
      ...opcoes,
    });
    if (!criadas.includes(r.orgId)) criadas.push(r.orgId);
    return r;
  };

  /** Um registrador de RASTRO de mentira, que devolve sequência crescente. */
  const rastroFalso = () => {
    let seq = 0n;
    return vi.fn(async (_: EventoDeProvisionamento) => {
      seq += 1n;
      return { id: `ev${seq}`, seq, hash: 'h' };
    });
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: URL });
    const plataforma = await provisionarTenant(prisma, {
      slug: `prov-${MARCA}-plataforma`,
      nome: 'Plataforma (teste)',
    });
    plataformaId = plataforma.orgId;
    criadas.push(plataformaId);
  });

  afterAll(async () => {
    /*
     * Limpeza cirúrgica pelos ids desta rodada, na ordem das chaves
     * estrangeiras. `Permission` fica: é catálogo global, e apagá-lo derrubaria
     * outra suíte rodando ao mesmo tempo.
     */
    for (const orgId of criadas) {
      await prisma.auditLog.deleteMany({ where: { orgId } });
      await prisma.user.deleteMany({ where: { orgId } });
      await prisma.role.deleteMany({ where: { orgId } });
      await prisma.org.deleteMany({ where: { id: orgId } });
    }
    await prisma.$disconnect();
  });

  describe('a primeira rodada', () => {
    it('cria a empresa, os papéis e liga os módulos pedidos', async () => {
      const r = await nascer({ slug: slug('a'), nome: 'Acme', modulos: ['financeiro', 'leads'] });

      expect(r.criada).toBe(true);
      expect(r.mudou).toBe(true);
      expect(r.nome).toBe('Acme');
      expect(r.ativa).toBe(true);
      expect(r.modo).toBe('criar');
      expect(r.ignorado).toEqual([]);
      // Ordem canônica de MODULOS, não a ordem em que vieram.
      expect(r.modulos).toEqual(['leads', 'financeiro']);
      expect(r.papelInicial).toMatchObject({
        key: PAPEL_INICIAL,
        criado: true,
        permissoes: PERMISSIONS.length,
        esperadas: PERMISSIONS.length,
      });
      expect(r.papeis.criados).toHaveLength(Object.keys(ROLES).length);
      expect(r.papeis.jaExistiam).toEqual([]);
      expect(r.papeis.total).toBe(Object.keys(ROLES).length);
      expect(r.papeis.foraDoCatalogo).toEqual([]);
      expect(r.papeis.incompletos).toEqual([]);

      const noBanco = await retrato(prisma, r.orgId);
      expect(noBanco.org).toMatchObject({ slug: slug('a'), name: 'Acme', isActive: true });
      expect(noBanco.papeis).toHaveLength(Object.keys(ROLES).length);

      // O papel inicial manda em tudo: é ele que faz a empresa ter dono.
      const inicial = noBanco.papeis.find((p) => p.key === PAPEL_INICIAL);
      expect(inicial?.permissions).toEqual([...PERMISSIONS].sort());
    });

    it('empresa sem ninguém no papel inicial é DENUNCIADA, não celebrada', async () => {
      const r = await nascer({ slug: slug('sem-dono') });
      expect(r.papelInicial.usuarios).toBe(0);
      expect(r.avisos.map((a) => a.codigo)).toContain('papel-inicial-sem-ninguem');
    });

    it('o catálogo global de permissões fica completo', async () => {
      const total = await prisma.permission.count({ where: { key: { in: [...PERMISSIONS] } } });
      expect(total).toBe(PERMISSIONS.length);
    });

    it('a empresa nasce sem módulo nenhum quando ninguém informa', async () => {
      const r = await nascer({ slug: slug('espinha') });
      expect(r.criada).toBe(true);
      expect(r.modulos).toEqual([]);
      expect(r.modulosAlterados).toBe(false);
    });

    it('herda a política da ROOT sem abrir versão própria', async () => {
      const r = await nascer({ slug: slug('politica') });

      expect(r.politica.sobrescritaPropria).toBeNull();
      expect(await prisma.policyVersion.count({ where: { orgId: r.orgId } })).toBe(0);
      // O banco de teste tem a base semeada; se não tivesse, o resultado diria
      // 'empacotada' — e é justamente essa diferença que ele existe para contar.
      if (r.politica.heranca === 'base-root') {
        expect(typeof r.politica.versaoBase).toBe('number');
      } else {
        expect(r.politica.versaoBase).toBeNull();
      }
    });

    it('o contexto nasce vazio', async () => {
      const r = await nascer({ slug: slug('contexto') });
      expect(r.contexto).toEqual({ notas: 0, vazio: true });
    });
  });

  describe('a segunda rodada', () => {
    it('não duplica nada, não erra e deixa o banco exatamente como estava', async () => {
      const entrada = { slug: slug('a'), nome: 'Acme', modulos: ['financeiro', 'leads'] };
      const primeira = await nascer(entrada);
      const antes = await retrato(prisma, primeira.orgId);
      /*
       * CONTAGEM DA MARCA, NÃO DA TABELA — e isto é conserto de teste instável,
       * medido na estabilização da onda 4 (11/09/2026). `prisma.org.count()`
       * sem `where` conta as empresas de TODO mundo, e o vitest roda os
       * arquivos em paralelo contra o MESMO banco: enquanto este caso corria,
       * o `afterAll` de outra suíte apagava as empresas dela e a contagem caía
       * sozinha ("expected 8 to be 12"). O caso reprovava por causa da vizinha,
       * não do código sob teste — e passava ou falhava conforme o relógio.
       *
       * O que este caso quer afirmar é "a segunda rodada não criou empresa
       * nova". Isso se pergunta dentro da marca desta rodada, que é a única
       * fatia do banco que pertence a este arquivo.
       */
      const daMarca = { slug: { startsWith: `prov-${MARCA}-` } };
      const orgsAntes = await prisma.org.count({ where: daMarca });

      const segunda = await nascer(entrada);

      expect(segunda.orgId).toBe(primeira.orgId);
      expect(segunda.criada).toBe(false);
      expect(segunda.mudou).toBe(false);
      expect(segunda.papeis.criados).toEqual([]);
      expect(segunda.permissoes.criadas).toBe(0);
      expect(segunda.papelInicial.criado).toBe(false);
      expect(segunda.papelInicial.id).toBe(primeira.papelInicial.id);

      expect(await retrato(prisma, primeira.orgId)).toEqual(antes);
      expect(await prisma.org.count({ where: daMarca })).toBe(orgsAntes);
      expect(await prisma.org.count({ where: { slug: entrada.slug } })).toBe(1);
    });

    it('sem lista informada, não desliga módulo que alguém ligou depois', async () => {
      const r = await nascer({ slug: slug('liga'), modulos: ['leads'] });
      // Alguém ligou mais um módulo pela tela (ou pela mão, hoje).
      await prisma.org.update({ where: { id: r.orgId }, data: { modulos: ['leads', 'pauta'] } });

      const denovo = await nascer({ slug: slug('liga') });

      expect(denovo.modulos).toEqual(['leads', 'pauta']);
      expect(denovo.modulosAlterados).toBe(false);
      expect(denovo.mudou).toBe(false);
    });

    it('a intenção declarada vale — inclusive para desligar — no modo reconfigurar', async () => {
      await nascer({ slug: slug('desliga'), modulos: ['leads', 'pauta'] });

      const denovo = await nascer({
        slug: slug('desliga'),
        modulos: [],
        modo: 'reconfigurar',
      });

      expect(denovo.modulos).toEqual([]);
      expect(denovo.modulosAlterados).toBe(true);
      expect(denovo.mudou).toBe(true);
    });
  });

  /*
   * O ATAQUE QUE REPROVOU A PRIMEIRA VERSÃO DESTA FATIA.
   *
   * Provisiona-se um cliente com dono e dois módulos. Depois chama-se de novo,
   * com o MESMO identificador, um e-mail novo e lista de módulos vazia. Na
   * versão antiga isso criava um SEGUNDO administrador dentro da empresa do
   * cliente e zerava os módulos dela — e, como usuário que já existe entra pelo
   * login com Google sem passar por lista de permissão, o administrador da
   * plataforma ganhava acesso total à empresa de qualquer cliente em dois
   * passos, sem autorização, sem prazo e sem aprovação.
   */
  describe('a rota não escreve dentro de empresa que já existe (escalada de privilégio)', () => {
    it('administrador novo e módulos zerados são IGNORADOS, e o retrato conta', async () => {
      const cliente = slug('cliente');
      const dono = email('dono-do-cliente');
      const intruso = email('intruso');

      const original = await nascer({
        slug: cliente,
        nome: 'Cliente',
        modulos: ['leads', 'financeiro'],
        admin: { email: dono, nome: 'Dona do Cliente' },
      });
      const antes = await retrato(prisma, original.orgId);

      const ataque = await nascer({
        slug: cliente,
        nome: 'Sequestrada',
        modulos: [],
        admin: { email: intruso, nome: 'Intruso' },
      });

      // 1. nada foi escrito
      expect(ataque.mudou).toBe(false);
      expect(ataque.modulos).toEqual(['leads', 'financeiro']);
      expect(ataque.nome).toBe('Cliente');
      expect(ataque.admin).toBeUndefined();
      expect(await retrato(prisma, original.orgId)).toEqual(antes);

      // 2. o intruso não virou usuário em lugar nenhum
      expect(await prisma.user.count({ where: { email: intruso } })).toBe(0);

      // 3. a empresa continua com UM dono
      const donos = await prisma.user.findMany({
        where: { orgId: original.orgId, roles: { some: { key: PAPEL_INICIAL } } },
        select: { email: true },
      });
      expect(donos.map((d) => d.email)).toEqual([dono]);

      // 4. o retrato DIZ o que ignorou — silêncio aqui seria a outra armadilha
      expect(ataque.ignorado.sort()).toEqual(['admin', 'modulos', 'nome']);
      expect(ataque.avisos.map((a) => a.codigo)).toContain('configuracao-ignorada');
    });

    it('slug digitado errado não desliga os módulos de um cliente em produção', async () => {
      const vitima = await nascer({ slug: slug('vitima'), modulos: ['bio', 'pauta'] });
      // Ordem canônica de MODULOS, não a ordem em que vieram.
      const gravados = ['pauta', 'bio'];

      // O operador queria criar uma empresa nova e repetiu um slug que já existe.
      const engano = await nascer({ slug: slug('vitima'), modulos: [] });

      expect(engano.modulos).toEqual(gravados);
      expect(engano.modulosAlterados).toBe(false);
      const org = await prisma.org.findUnique({ where: { id: vitima.orgId } });
      expect(org?.modulos).toEqual(gravados);
    });

    it('o comando de terminal (modo reconfigurar) continua podendo — e diz isso', async () => {
      const alvo = slug('terminal');
      await nascer({ slug: alvo, modulos: ['leads'] });

      const r = await nascer({
        slug: alvo,
        modulos: ['leads', 'metas'],
        admin: { email: email('operador'), nome: 'Operador' },
        modo: 'reconfigurar',
      });

      expect(r.modo).toBe('reconfigurar');
      expect(r.ignorado).toEqual([]);
      expect(r.modulos).toEqual(['leads', 'metas']);
      expect(r.admin).toMatchObject({ criado: true, papelVinculado: true });
      expect(r.mudou).toBe(true);
    });
  });

  describe('o primeiro administrador', () => {
    it('nasce sem senha utilizável e já com o papel inicial', async () => {
      const alvo = email('maria');
      const r = await nascer({ slug: slug('admin'), admin: { email: alvo, nome: 'Maria' } });

      expect(r.admin).toMatchObject({ email: alvo, criado: true, papelVinculado: true });
      expect(r.papelInicial.usuarios).toBe(1);
      expect(r.avisos.map((a) => a.codigo)).not.toContain('papel-inicial-sem-ninguem');

      const user = await prisma.user.findUnique({
        where: { email: alvo },
        select: { orgId: true, name: true, passwordHash: true, roles: { select: { key: true } } },
      });
      expect(user?.orgId).toBe(r.orgId);
      expect(user?.roles.map((x) => x.key)).toContain(PAPEL_INICIAL);
      // Hash de bytes aleatórios: ninguém guardou, imprimiu nem devolveu a senha.
      expect(user?.passwordHash.startsWith('$2')).toBe(true);
      expect(JSON.stringify(r)).not.toContain(user!.passwordHash);
    });

    it('na segunda rodada o mesmo e-mail não vira usuário novo', async () => {
      const alvo = email('maria');
      const r = await nascer(
        { slug: slug('admin'), admin: { email: alvo, nome: 'Maria' }, modo: 'reconfigurar' },
      );

      expect(r.admin).toMatchObject({ criado: false, papelVinculado: false });
      expect(r.mudou).toBe(false);
      expect(await prisma.user.count({ where: { email: alvo } })).toBe(1);
    });

    it('e-mail em caixa diferente é a mesma pessoa', async () => {
      const alvo = email('maria');
      const r = await nascer({
        slug: slug('admin'),
        admin: { email: alvo.toUpperCase() },
        modo: 'reconfigurar',
      });
      expect(r.admin?.criado).toBe(false);
      expect(await prisma.user.count({ where: { email: alvo } })).toBe(1);
    });

    it('e-mail que já é de outra empresa recusa a operação INTEIRA', async () => {
      const alvo = email('maria');

      await expect(
        nascer({ slug: slug('roubo'), admin: { email: alvo } }),
      ).rejects.toBeInstanceOf(ProvisionamentoInvalidoError);

      // A transação voltou: a empresa não ficou pela metade, com o slug ocupado
      // e sem papel nenhum.
      expect(await prisma.org.count({ where: { slug: slug('roubo') } })).toBe(0);
      const ainda = await prisma.user.findUnique({ where: { email: alvo }, select: { orgId: true } });
      expect(criadas).toContain(ainda!.orgId);
    });
  });

  describe('entrada inválida', () => {
    it('módulo que não existe recusa antes de escrever qualquer coisa', async () => {
      await expect(
        nascer({ slug: slug('lixo'), modulos: ['finaceiro'] }),
      ).rejects.toMatchObject({ motivo: 'modulo-desconhecido' });
      expect(await prisma.org.count({ where: { slug: slug('lixo') } })).toBe(0);
    });

    it('slug com maiúscula é recusado, nunca normalizado em silêncio', async () => {
      await expect(
        nascer({ slug: `Prov-${MARCA}-X` }),
      ).rejects.toMatchObject({ motivo: 'slug' });
    });

    it('e-mail que não é e-mail é recusado', async () => {
      await expect(
        nascer({ slug: slug('email'), admin: { email: 'maria' } }),
      ).rejects.toMatchObject({ motivo: 'email' });
    });
  });

  /*
   * 02-CONSTRAINTS §5: "nunca executar ação sem evento registrado. O registro é
   * pré-condição, não relatório."
   *
   * A versão antiga gravava o RASTRO só DEPOIS do commit: com o registrador
   * falhando, a empresa ficava criada no banco com zero eventos e o chamador
   * recebia erro. Os casos abaixo são a prova de que isso não acontece mais.
   */
  describe('o RASTRO é pré-condição, não relatório', () => {
    it('registrador falhando ANTES da escrita = empresa NÃO criada', async () => {
      const rastro = vi.fn(async (_: EventoDeProvisionamento) => {
        throw new Error('banco do RASTRO fora do ar');
      });

      await expect(
        provisionarTenant(
          prisma,
          { slug: slug('sem-rastro') },
          { ordenante: plataformaId, rastro },
        ),
      ).rejects.toThrow('banco do RASTRO fora do ar');

      expect(rastro).toHaveBeenCalledTimes(1);
      expect(rastro.mock.calls[0][0].tipo).toBe('tenant.provisionamento.iniciado');
      // O que importa: a empresa não existe.
      expect(await prisma.org.count({ where: { slug: slug('sem-rastro') } })).toBe(0);
    });

    it('a intenção vem antes e mora na plataforma; o nascimento vem depois e mora na empresa nova', async () => {
      const rastro = rastroFalso();
      const r = await nascer({ slug: slug('rastro'), modulos: ['bio'] }, { rastro });

      expect(rastro).toHaveBeenCalledTimes(2);
      const [intencao, nascimento] = rastro.mock.calls.map((c) => c[0]);

      expect(intencao.tipo).toBe('tenant.provisionamento.iniciado');
      expect(intencao.orgId).toBe(plataformaId);
      expect(intencao.payload).toMatchObject({ slug: slug('rastro'), criaEmpresa: true });

      expect(nascimento.tipo).toBe('tenant.provisionado');
      expect(nascimento.orgId).toBe(r.orgId);
      expect(nascimento.payload).toMatchObject({ slug: slug('rastro'), criada: true });

      expect(r.rastro).toEqual({ intencao: '1', conclusao: '2', falhaNaConclusao: null });
    });

    it('rodada de conferência não escreve no RASTRO — quem guarda isso é a auditoria', async () => {
      await nascer({ slug: slug('conferencia') });
      const rastro = rastroFalso();

      const segunda = await nascer({ slug: slug('conferencia') }, { rastro });

      expect(rastro).not.toHaveBeenCalled();
      expect(segunda.rastro).toEqual({ intencao: null, conclusao: null, falhaNaConclusao: null });
      expect(segunda.mudou).toBe(false);
    });

    it('o evento carrega a correlação — todos os outros chamadores passam', async () => {
      const rastro = rastroFalso();
      await nascer({ slug: slug('correlacao') }, { rastro, correlacao: 'corr-do-teste' });

      for (const chamada of rastro.mock.calls) {
        expect(chamada[0].correlationId).toBe('corr-do-teste');
      }
    });

    it('o evento não carrega segredo', async () => {
      const rastro = rastroFalso();
      await nascer(
        { slug: slug('rastro-admin'), admin: { email: email('joao'), nome: 'João' } },
        { rastro },
      );

      const texto = JSON.stringify(rastro.mock.calls.map((c) => c[0]));
      expect(texto).toContain(email('joao'));
      expect(texto).not.toContain('$2'); // prefixo de hash bcrypt
      expect(texto).not.toContain('passwordHash');
    });

    it('falha no registro do NASCIMENTO não some e não vira erro sobre empresa criada', async () => {
      const rastro = vi.fn(async (evento: EventoDeProvisionamento) => {
        if (evento.tipo === 'tenant.provisionado') throw new Error('caiu no meio');
        return { id: 'ev1', seq: 1n, hash: 'h' };
      });

      const r = await nascer({ slug: slug('meio-rastro') }, { rastro });

      expect(r.criada).toBe(true);
      expect(r.rastro.intencao).toBe('1');
      expect(r.rastro.conclusao).toBeNull();
      expect(r.rastro.falhaNaConclusao).toContain('caiu no meio');
      expect(r.avisos.map((a) => a.codigo)).toContain('rastro-da-conclusao-falhou');
    });

    it('sem empresa ordenante (banco novo), a intenção fica sem casa e o retrato avisa', async () => {
      const rastro = rastroFalso();
      const r = await provisionarTenant(
        prisma,
        { slug: slug('bootstrap') },
        { rastro },
      );
      criadas.push(r.orgId);

      expect(r.avisos.map((a) => a.codigo)).toContain('rastro-sem-ordenante');
      expect(r.rastro.intencao).toBeNull();
      // O nascimento, esse, continua registrado na empresa nova.
      expect(r.rastro.conclusao).toBe('1');
    });
  });

  /*
   * Auditoria: uma linha por CHAMADA. É o que responde "quantas vezes tentaram
   * provisionar", "quem tentou e foi recusado" e "quem rodou sem mudar nada" —
   * perguntas que antes só tinham a linha de log da aplicação, que não é retida
   * nem encadeada.
   */
  describe('toda chamada é auditada', () => {
    it('a que cria, a que não muda nada e a que é recusada', async () => {
      const linhas: AuditoriaDeProvisionamento[] = [];
      const auditar = vi.fn(async (l: AuditoriaDeProvisionamento) => void linhas.push(l));

      await nascer({ slug: slug('auditada') }, { auditar });
      await nascer({ slug: slug('auditada') }, { auditar });
      await expect(
        nascer({ slug: 'MAIUSCULA' }, { auditar }),
      ).rejects.toMatchObject({ motivo: 'slug' });

      expect(linhas.map((l) => l.action)).toEqual([
        'tenant.provisionar.criado',
        'tenant.provisionar.sem-mudanca',
        'tenant.provisionar.recusado',
      ]);
      // A trilha de operação de plataforma mora na plataforma.
      expect(linhas.every((l) => l.orgId === plataformaId)).toBe(true);
      expect(linhas[2].metadata).toMatchObject({ slug: 'MAIUSCULA', motivo: 'slug' });
    });

    it('a rodada que foi congelada aparece com o que ignorou', async () => {
      const linhas: AuditoriaDeProvisionamento[] = [];
      const auditar = vi.fn(async (l: AuditoriaDeProvisionamento) => void linhas.push(l));

      await nascer({ slug: slug('aud-congela'), modulos: ['leads'] });
      await nascer({ slug: slug('aud-congela'), modulos: [] }, { auditar });

      expect(linhas).toHaveLength(1);
      expect(linhas[0].action).toBe('tenant.provisionar.sem-mudanca');
      expect(linhas[0].metadata).toMatchObject({ ignorado: ['modulos'] });
    });

    it('a auditoria chega mesmo ao banco quando é o AuditService de verdade', async () => {
      const r = await nascer(
        { slug: slug('aud-banco') },
        {
          auditar: async (l) => {
            await prisma.auditLog.create({
              data: {
                orgId: l.orgId,
                actorType: 'system',
                action: l.action,
                entityType: 'org',
                entityId: l.entityId,
                metadata: l.metadata as object,
              },
            });
          },
        },
      );

      const gravadas = await prisma.auditLog.findMany({
        where: { orgId: plataformaId, entityId: r.orgId },
        select: { action: true },
      });
      expect(gravadas.map((g) => g.action)).toEqual(['tenant.provisionar.criado']);
    });
  });

  /*
   * O retrato precisa DENUNCIAR. Cada caso aqui é um estado em que a versão
   * antiga devolvia "nada mudou" e um relatório verde.
   */
  describe('o retrato denuncia o que não corrige', () => {
    it('empresa DESATIVADA não passa por "nada mudou"', async () => {
      const r = await nascer({ slug: slug('desligada') });
      await prisma.org.update({ where: { id: r.orgId }, data: { isActive: false } });

      const denovo = await nascer({ slug: slug('desligada') });

      expect(denovo.ativa).toBe(false);
      expect(denovo.avisos.map((a) => a.codigo)).toContain('empresa-desativada');
      // E continua desligada: religar é decisão de contrato.
      expect(
        (await prisma.org.findUnique({ where: { id: r.orgId } }))?.isActive,
      ).toBe(false);
    });

    it('religar exige bandeira explícita, e só no modo reconfigurar', async () => {
      const r = await nascer({ slug: slug('religar') });
      await prisma.org.update({ where: { id: r.orgId }, data: { isActive: false } });

      // Pedir sem poder: a rota ignora e conta.
      const negado = await nascer({ slug: slug('religar'), reativar: true });
      expect(negado.ativa).toBe(false);
      expect(negado.ignorado).toContain('reativar');

      const ligado = await nascer({
        slug: slug('religar'),
        reativar: true,
        modo: 'reconfigurar',
      });
      expect(ligado.ativa).toBe(true);
      expect(ligado.mudou).toBe(true);
      expect(ligado.avisos.map((a) => a.codigo)).not.toContain('empresa-desativada');
    });

    it('papel inicial esvaziado é CONFERIDO e denunciado — sem ser reescrito', async () => {
      const r = await nascer({ slug: slug('papel-vazio'), admin: { email: email('vazio') } });
      await prisma.role.update({
        where: { id: r.papelInicial.id },
        data: { permissions: { set: [] } },
      });

      const denovo = await nascer({ slug: slug('papel-vazio') });

      expect(denovo.mudou).toBe(false);
      expect(denovo.papelInicial.permissoes).toBe(0);
      expect(denovo.papelInicial.esperadas).toBe(PERMISSIONS.length);
      expect(denovo.papeis.incompletos.map((p) => p.key)).toContain(PAPEL_INICIAL);
      expect(denovo.avisos.map((a) => a.codigo)).toContain('papel-incompleto');

      // Conferido, NÃO corrigido: quem corrige é `db:sync-permissions`.
      const noBanco = await prisma.role.findUnique({
        where: { id: r.papelInicial.id },
        select: { permissions: { select: { key: true } } },
      });
      expect(noBanco?.permissions).toEqual([]);
    });

    it('papel inicial renomeado faz nascer um segundo — e o retrato avisa', async () => {
      const r = await nascer({ slug: slug('renomeado') });
      await prisma.role.update({
        where: { id: r.papelInicial.id },
        data: { key: `${PAPEL_INICIAL}_antigo` },
      });

      const denovo = await nascer({ slug: slug('renomeado') });

      expect(denovo.papeis.criados).toEqual([PAPEL_INICIAL]);
      expect(denovo.papeis.total).toBe(Object.keys(ROLES).length + 1);
      expect(denovo.papeis.foraDoCatalogo).toEqual([`${PAPEL_INICIAL}_antigo`]);
      expect(denovo.avisos.map((a) => a.codigo)).toContain('papeis-alem-do-catalogo');
      // Dois administradores na mesma empresa: é exatamente o que o aviso conta.
      const admins = await prisma.role.count({
        where: { orgId: r.orgId, key: { startsWith: PAPEL_INICIAL } },
      });
      expect(admins).toBe(2);
    });
  });

  describe('duas rodadas ao mesmo tempo', () => {
    it('cinco rodadas simultâneas: uma empresa completa e NENHUM erro', async () => {
      const alvo = slug('corrida');
      const resultados = await Promise.all(
        Array.from({ length: 5 }, () => nascer({ slug: alvo, modulos: ['leads'] })),
      );

      const ids = new Set(resultados.map((r) => r.orgId));
      expect(ids.size).toBe(1);
      expect(resultados.filter((r) => r.criada)).toHaveLength(1);
      // O ponto do conserto: as quatro perdedoras releem e devolvem o retrato.
      expect(resultados.filter((r) => !r.criada)).toHaveLength(4);
      for (const r of resultados) {
        expect(r.papeis.total).toBe(Object.keys(ROLES).length);
        expect(r.modulos).toEqual(['leads']);
      }
      expect(await prisma.org.count({ where: { slug: alvo } })).toBe(1);
      expect(await prisma.role.count({ where: { orgId: [...ids][0] } })).toBe(
        Object.keys(ROLES).length,
      );
    }, 60_000);
  });

  describe('sob a sessão de banco com empresa declarada', () => {
    it('sem empresa resolvida, a busca pelo slug falha com nome próprio', async () => {
      esquecerAvisos();
      const restrito = comTenantNaSessao(prisma, { modo: 'impor', avisar: () => undefined });

      await expect(
        provisionarTenant(restrito, { slug: slug('impor') }),
      ).rejects.toBeInstanceOf(ProvisionamentoSemPlataformaError);
    });

    it('com contexto de plataforma por fora, o trabalho roda no contexto da empresa nova', async () => {
      esquecerAvisos();
      const restrito = comTenantNaSessao(prisma, { modo: 'impor', avisar: () => undefined });

      const r = await comContexto(
        { orgId: plataformaId, correlationId: novaCorrelacao('teste'), origem: 'script' },
        () =>
          provisionarTenant(
            restrito,
            { slug: slug('contextado'), modulos: ['metas'] },
            {
              emContexto: (orgId, fn) =>
                comContexto({ orgId, correlationId: novaCorrelacao('prov'), origem: 'script' }, fn),
            },
          ),
      );
      criadas.push(r.orgId);

      expect(r.criada).toBe(true);
      expect(r.orgId).not.toBe(plataformaId);
      expect(r.modulos).toEqual(['metas']);
    });
  });

  describe('a fixture da suíte de isolamento', () => {
    it('nasce do provisionamento e diz o que precisa ser apagado', async () => {
      const t = await provisionarTenantDeTeste(prisma, {
        slug: slug('fixture'),
        nome: 'Empresa B',
        admin: { email: email('fixture') },
      });
      criadas.push(t.provisionamento.orgId);

      expect(t.provisionamento.criada).toBe(true);
      expect(t.orgId).toBe(t.provisionamento.orgId);
      expect(t.chaves.Org).toEqual([t.orgId]);
      expect(t.chaves.Role).toHaveLength(Object.keys(ROLES).length);
      expect(t.chaves.User).toEqual([t.provisionamento.admin!.userId]);
      expect(t.adminUserId).toBe(t.provisionamento.admin!.userId);
      expect(t.papelInicialId).toBe(t.provisionamento.papelInicial.id);
      expect(t.ordemDeLimpeza).toEqual(['Org', 'Role', 'User']);

      // Sem RASTRO nem auditoria: o EventLog é append-only e as chaves da
      // auditoria não passariam pelo registro de limpeza da suíte.
      expect(t.provisionamento.rastro.intencao).toBeNull();
      expect(t.provisionamento.rastro.conclusao).toBeNull();
      expect(await prisma.eventLog.count({ where: { orgId: t.orgId } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { orgId: t.orgId } })).toBe(0);
    });
  });
});

/*
 * A ROTA, sem banco e sem Nest.
 *
 * O controller é uma classe comum: construí-lo à mão com dublês é o que permite
 * cobrar dele as três coisas que ele, e só ele, decide — quem pode chamar, em
 * que modo a operação roda, e o que vai para a auditoria quando a chamada nem
 * chega à operação. Nada aqui depende de injeção (que não funciona sob o
 * vitest) nem de `TEST_DATABASE_URL`.
 */
describe('a rota de provisionamento (RF-T-07)', () => {
  const usuario = (orgId: string): JwtUser => ({
    sub: 'u1',
    orgId,
    email: 'operador@root.local',
    name: 'Operador',
    roles: [PAPEL_INICIAL],
    permissions: [...PERMISSIONS],
  });

  /** Monta o controller com dublês e devolve o que cada um recebeu. */
  const montar = (slugDaOrgDoChamador: string) => {
    const chamadas: EntradaDeProvisionamento[] = [];
    const auditadas: AuditInput[] = [];
    const provisionamento = {
      provisionar: vi.fn(async (entrada: EntradaDeProvisionamento) => {
        chamadas.push(entrada);
        return { orgId: 'nova', slug: entrada.slug } as never;
      }),
    };
    const auditoria = { log: vi.fn(async (a: AuditInput) => void auditadas.push(a)) };
    const prisma = {
      org: { findUnique: vi.fn(async () => ({ slug: slugDaOrgDoChamador })) },
    };
    const controller = new ProvisionamentoController(
      provisionamento as never,
      auditoria as never,
      prisma as never,
    );
    return { controller, chamadas, auditadas };
  };

  it('força o modo "criar" — o corpo não escolhe', async () => {
    const { controller, chamadas } = montar(SLUG_DA_PLATAFORMA);

    await controller.provisionar(usuario('org-da-plataforma'), {
      slug: 'cliente-novo',
      // Tentativa explícita de pedir o modo que escreve dentro de empresa alheia.
      modo: 'reconfigurar',
      admin: { email: 'intruso@exemplo.com' },
    });

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].modo).toBe('criar');
  });

  it('empresa que não é a plataforma é recusada — e a recusa é AUDITADA', async () => {
    const { controller, chamadas, auditadas } = montar('cliente-qualquer');

    await expect(
      controller.provisionar(usuario('org-do-cliente'), { slug: 'vitima' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(chamadas).toHaveLength(0);
    expect(auditadas).toHaveLength(1);
    expect(auditadas[0]).toMatchObject({
      // Na empresa de QUEM TENTOU: a empresa alvo pode nem existir.
      orgId: 'org-do-cliente',
      action: 'tenant.provisionar.recusado',
    });
    expect(auditadas[0].metadata).toMatchObject({ slug: 'vitima', motivo: 'nao-e-a-plataforma' });
  });

  it('corpo inválido também deixa rastro na auditoria', async () => {
    const { controller, chamadas, auditadas } = montar(SLUG_DA_PLATAFORMA);

    await expect(
      controller.provisionar(usuario('org-da-plataforma'), { slug: 'x' }),
    ).rejects.toThrow();

    expect(chamadas).toHaveLength(0);
    expect(auditadas[0].metadata).toMatchObject({ motivo: 'corpo-invalido' });
  });
});
