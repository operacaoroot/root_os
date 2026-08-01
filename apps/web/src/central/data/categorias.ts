import type { Categoria } from "@/central/types";

export const categorias: Categoria[] = [
  {
    id: "comecando",
    slug: "comecando",
    nome: "Começando",
    descricao: "Do zero ao primeiro comando. Sem pré-requisito, sem enrolação.",
    ordem: 1,
  },
  {
    id: "claude-code",
    slug: "claude-code",
    nome: "Claude Code",
    descricao: "Configuração, skills, subagentes e o dia a dia de quem opera no terminal.",
    ordem: 2,
  },
  {
    id: "memoria",
    slug: "memoria-e-contexto",
    nome: "Memória e contexto",
    descricao: "Fazer a IA lembrar do seu trabalho — e parar de reexplicar tudo.",
    ordem: 3,
  },
  {
    id: "agentes",
    slug: "agentes",
    nome: "Agentes e times",
    descricao: "De um assistente pra um time inteiro trabalhando em paralelo.",
    ordem: 4,
  },
  {
    id: "automacao",
    slug: "automacao",
    nome: "Automação",
    descricao: "Rotinas, integrações e fluxos que rodam sem você apertar botão.",
    ordem: 5,
  },
  {
    id: "custo",
    slug: "custo-e-tokens",
    nome: "Custo e tokens",
    descricao: "Operar barato: modelo certo, contexto enxuto, cache ligado.",
    ordem: 6,
  },
  {
    id: "criacao",
    slug: "criacao",
    nome: "Criação",
    descricao: "Sites, apps, imagens e texto — feitos com IA, com acabamento de gente.",
    ordem: 7,
  },
  {
    id: "formacao",
    slug: "formacao",
    nome: "Formação",
    descricao: "Estudo com fonte primária e prova prática. Nada de colecionador de curso.",
    ordem: 8,
  },
];
