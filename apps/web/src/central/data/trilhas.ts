import type { Trilha } from "@/central/types";

export const trilhas: Trilha[] = [
  {
    id: "t1",
    slug: "comecando-do-zero",
    titulo: "Começando do zero",
    descricao:
      "Da instalação ao primeiro projeto com contexto e permissões no lugar. A base que evita retrabalho em tudo que vem depois.",
    paraQuem: "Quem nunca operou uma IA que executa — só conversou com chat.",
    nivel: "iniciante",
    itens: [
      { materialId: "m01", nota: "Instale e rode a primeira ordem." },
      { materialId: "m03", nota: "Aprenda a ler o que a IA faz no terminal." },
      { materialId: "m09", nota: "Configure as permissões antes de acelerar." },
      { materialId: "m04", nota: "Dê contexto permanente ao primeiro projeto." },
      { materialId: "m02", nota: "Feche com o mapa: saiba o próximo passo." },
    ],
  },
  {
    id: "t2",
    slug: "memoria-e-contexto",
    titulo: "Memória e contexto",
    descricao:
      "O fim do 'explica tudo de novo': memória permanente fora do chat, sessões enxutas e histórico que se escreve sozinho.",
    paraQuem: "Quem já usa IA todo dia e cansou de repetir contexto.",
    nivel: "iniciante",
    prerequisitos: ["Trilha Começando do zero (ou equivalente)"],
    itens: [
      { materialId: "m10", nota: "Monte o vault — a memória de verdade." },
      { materialId: "m11", nota: "Aprenda o que entra e o que fica fora da sessão." },
      { materialId: "m12", nota: "Ative o diário que se escreve sozinho." },
      { materialId: "m19", nota: "Colha o bônus: contexto enxuto também é custo baixo." },
    ],
  },
  {
    id: "t3",
    slug: "primeiro-time-de-agentes",
    titulo: "Primeiro time de agentes",
    descricao:
      "De um assistente pra um time: delegação em paralelo, conexões com suas ferramentas e revisão que não passa a mão na sua cabeça.",
    paraQuem: "Quem domina o básico e quer escala sem perder o controle.",
    nivel: "avancado",
    prerequisitos: ["Uso diário do Claude Code", "Memória montada (trilha Memória e contexto)"],
    itens: [
      { materialId: "m06", nota: "Delegue a primeira missão a um subagente." },
      { materialId: "m14", nota: "Conecte a IA às suas ferramentas com critério." },
      { materialId: "m13", nota: "Monte o conselho de revisores independentes." },
      { materialId: "m15", nota: "Feche com a máquina de pesquisa completa." },
    ],
  },
  {
    id: "t4",
    slug: "automacao-na-pratica",
    titulo: "Automação na prática",
    descricao:
      "Tarefas com hora marcada rodando sem você: fluxos no n8n, rotinas agendadas e atendimento com aprovação humana.",
    paraQuem: "Quem repete tarefa toda semana e quer o tempo de volta.",
    nivel: "intermediario",
    prerequisitos: ["Base do Claude Code (trilha Começando do zero)"],
    itens: [
      { materialId: "m16", nota: "Primeiro fluxo girando sozinho." },
      { materialId: "m18", nota: "Rotinas que chegam prontas de manhã." },
      { materialId: "m17", nota: "Atendimento com IA — e você no comando." },
      { materialId: "m21", nota: "Feche a conta: modelo certo em cada engrenagem." },
    ],
  },
];
