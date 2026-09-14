/*
 * Semeia o roster. Idempotente: não sobrescreve dono, linha de base nem
 * estado — essas três são decisão de gente, e um seed rodando no deploy não
 * pode desfazer o que uma pessoa configurou.
 *
 *   pnpm --filter @mktos/api db:seed:tripulacao
 */
import { AgentTipo, EstadoDeAgente, PrismaClient, RiskLevel } from '@prisma/client';

const prisma = new PrismaClient();

interface Semente {
  slug: string;
  nome: string;
  iniciais: string;
  missao: string;
  pilar: string;
  tipo: AgentTipo;
  estado: EstadoDeAgente;
  autonomiaAte: RiskLevel;
  capacidades: string[];
  cron?: string;
  sop?: { proposito: string; gatilho: string; passos: string[]; definicaoDePronto: string };
}

// As seis primeiras JÁ RODAM hoje — são os setInterval que ninguém via. Virar
// agente, para elas, é ganhar dono, missão e execução registrada; não é ganhar
// um laço de modelo. Por isso tipo `conector` e autonomia R0.
const ROSTER: Semente[] = [
  {
    slug: 'sincronizador-clickup', nome: 'Sincronizador do ClickUp', iniciais: 'SC',
    missao: 'trazer tarefas e conteúdos do ClickUp para dentro da central, de hora em hora',
    pilar: 'Operação', tipo: AgentTipo.conector, estado: EstadoDeAgente.ativo,
    autonomiaAte: RiskLevel.R0, capacidades: [], cron: '0 * * * *',
  },
  {
    slug: 'indexador-vault', nome: 'Indexador do vault', iniciais: 'IV',
    missao: 'manter a base de conhecimento buscável — varre o vault e gera os embeddings',
    pilar: 'Contexto', tipo: AgentTipo.conector, estado: EstadoDeAgente.ativo,
    autonomiaAte: RiskLevel.R0, capacidades: [], cron: '*/30 * * * *',
  },
  {
    slug: 'conciliador-bancario', nome: 'Conciliador bancário', iniciais: 'CB',
    missao: 'puxar extrato e saldo dos bancos conectados e manter o caixa em dia',
    pilar: 'Financeiro', tipo: AgentTipo.conector, estado: EstadoDeAgente.ativo,
    autonomiaAte: RiskLevel.R0, capacidades: [], cron: '0 */6 * * *',
  },
  {
    slug: 'coletor-bio', nome: 'Coletor da bio', iniciais: 'CO',
    missao: 'coletar as métricas de Instagram e TikTok do desafio e renovar os tokens antes de vencerem',
    pilar: 'Presença', tipo: AgentTipo.conector, estado: EstadoDeAgente.ativo,
    autonomiaAte: RiskLevel.R0, capacidades: [], cron: '0 */6 * * *',
  },
  {
    slug: 'ponte-metas', nome: 'Ponte das metas', iniciais: 'PM',
    missao: 'recalcular os cliques da bio dentro da meta da semana',
    pilar: 'Presença', tipo: AgentTipo.conector, estado: EstadoDeAgente.ativo,
    autonomiaAte: RiskLevel.R0, capacidades: [], cron: '0 */12 * * *',
  },
  {
    slug: 'editor-de-pauta', nome: 'Editor de pauta', iniciais: 'EP',
    missao: 'coletar os feeds, curar a janela e derivar as peças de cada canal',
    pilar: 'Conteúdo', tipo: AgentTipo.conector, estado: EstadoDeAgente.ativo,
    autonomiaAte: RiskLevel.R1, capacidades: [], cron: '* * * * *',
  },
  {
    slug: 'briefing-diario', nome: 'Briefing diário', iniciais: 'BD',
    missao: 'contar em uma página o que aconteceu ontem e o que precisa de atenção hoje',
    pilar: 'Operação', tipo: AgentTipo.llm, estado: EstadoDeAgente.ativo,
    autonomiaAte: RiskLevel.R1, cron: '0 8 * * *',
    capacidades: [
      'numeros.painel.ler', 'numeros.funil.ler', 'operacao.tarefa.atrasada',
      'pecas.campanha.listar', 'financeiro.resumo.ler',
    ],
    sop: {
      proposito: 'dar ao operador o pulso do negócio antes de ele abrir o painel',
      gatilho: 'todo dia às 08:00, e sob demanda',
      passos: [
        'puxe o resumo do painel e do funil',
        'veja o que está atrasado e as campanhas em risco',
        'olhe o caixa',
        'escreva no máximo 15 linhas, começando pelo que exige decisão hoje',
      ],
      definicaoDePronto: 'o texto cabe numa tela de celular e cada número cita de onde veio',
    },
  },
  {
    slug: 'assistente', nome: 'Assistente da central', iniciais: 'AC',
    missao: 'responder perguntas sobre o negócio em português, sempre com a fonte do número',
    pilar: 'Contexto', tipo: AgentTipo.llm, estado: EstadoDeAgente.ativo,
    autonomiaAte: RiskLevel.R1,
    capacidades: [
      'contexto.memoria.buscar', 'numeros.painel.ler', 'numeros.funil.ler',
      'financeiro.resumo.ler', 'financeiro.kpi.ler', 'financeiro.pagavel.listar',
      'crm.lead.buscar', 'operacao.tarefa.listar', 'operacao.tarefa.atrasada',
      'pecas.campanha.listar',
      // Declaradas de propósito: é a régua funcionando à vista. A primeira é
      // retida em R3 e a segunda é bloqueada em R5, antes de existir efeito.
      'whatsapp.mensagem.enviar', 'financeiro.pagamento.baixar',
    ],
    sop: {
      proposito: 'ser o jeito mais rápido de saber algo sobre o negócio sem abrir tela nenhuma',
      gatilho: 'uma pergunta em português, por qualquer canal',
      passos: [
        'busque na base de conhecimento o que a empresa já decidiu sobre o assunto',
        'puxe os números com as ferramentas — nunca de memória',
        'responda em no máximo 10 linhas, citando a fonte de cada número',
      ],
      definicaoDePronto: 'a pergunta foi respondida com dado real e com procedência',
    },
  },
];

async function main() {
  const orgs = await prisma.org.findMany({ select: { id: true, slug: true } });
  if (!orgs.length) {
    console.error('nenhuma empresa no banco — rode o seed principal antes');
    process.exit(1);
  }

  for (const org of orgs) {
    let criados = 0;
    let mantidos = 0;
    for (const s of ROSTER) {
      const existe = await prisma.agent.findUnique({
        where: { orgId_slug: { orgId: org.id, slug: s.slug } },
      });
      if (existe) {
        // Missão, capacidades e cron acompanham o código. Dono, estado e
        // linha de base são de gente — o seed não toca.
        await prisma.agent.update({
          where: { id: existe.id },
          data: {
            nome: s.nome, iniciais: s.iniciais, missao: s.missao, pilar: s.pilar,
            tipo: s.tipo, capacidades: s.capacidades, cron: s.cron ?? null,
          },
        });
        mantidos++;
        continue;
      }
      const criado = await prisma.agent.create({
        data: {
          orgId: org.id, slug: s.slug, nome: s.nome, iniciais: s.iniciais,
          missao: s.missao, pilar: s.pilar, tipo: s.tipo, estado: s.estado,
          autonomiaAte: s.autonomiaAte, capacidades: s.capacidades, cron: s.cron ?? null,
        },
      });
      if (s.sop) {
        await prisma.sop.create({ data: { orgId: org.id, agentId: criado.id, ...s.sop } });
      }
      criados++;
    }
    console.log(`${org.slug}: ${criados} agente(s) criado(s), ${mantidos} atualizado(s)`);
  }

  const semDono = await prisma.agent.count({ where: { donoId: null } });
  if (semDono) {
    console.warn(
      `\n${semDono} agente(s) sem dono humano. Um agente sem dono não escala para ninguém — ` +
        'defina o dono na tela de Agentes.',
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
