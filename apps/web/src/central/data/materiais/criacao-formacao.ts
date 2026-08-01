import type { Material } from "@/central/types";

/* Categorias "Criação" e "Formação" + um material descontinuado de exemplo. */

export const materiaisCriacaoFormacao: Material[] = [
  {
    id: "m22",
    slug: "landing-page-em-uma-tarde",
    codigo: "LANDING",
    aliases: ["landing", "landing page", "site", "pagina de vendas"],
    card: "Landing page com IA em uma tarde",
    tagline:
      "Do briefing ao site no ar: o fluxo que produz página com cara de estúdio, não de template de IA.",
    titulo: "Landing page: o fluxo de uma tarde, com acabamento",
    resumo:
      "O que separa página boa de página genérica não é a ferramenta — é o briefing e a direção de arte. O fluxo completo: briefing forte, geração dirigida, revisão em tela pequena e publicação.",
    categoriaId: "criacao",
    tipo: "tutorial",
    nivel: "intermediario",
    custo: "gratuito",
    ferramentas: ["Claude Code"],
    plataformas: ["web"],
    tags: ["landing", "site", "design"],
    resolve: [
      "preciso de uma página pro meu produto sem pagar agência",
      "site feito por ia fica com cara de ia",
      "como publicar uma landing page",
    ],
    minutosEstimados: 180,
    prerequisitos: ["Claude Code instalado (material PRIMEIRO)"],
    blocos: [
      {
        tipo: "passo",
        n: 1,
        titulo: "Briefing antes de tela",
        blocos: [
          {
            tipo: "prompt",
            rotulo: "Briefing de uma página",
            conteudo:
              "Me entrevista pra montar o briefing desta landing page. Pergunta uma coisa por vez: quem é o público, que problema dói, qual a oferta, qual a UMA ação que a página pede, que objeção trava a compra e que prova eu tenho (depoimento, número real, caso). No fim, resume o briefing em 10 linhas e me pede aprovação.",
          },
          {
            tipo: "callout",
            variante: "info",
            titulo: "Por que a entrevista:",
            conteudo:
              "Página genérica nasce de pedido genérico. A entrevista arranca de você o que a IA não tem como saber — e é isso que diferencia a página.",
          },
        ],
      },
      {
        tipo: "passo",
        n: 2,
        titulo: "Gere com direção de arte explícita",
        blocos: [
          {
            tipo: "prompt",
            rotulo: "Geração dirigida",
            conteudo:
              "Com o briefing aprovado, monta a landing em um arquivo HTML único, mobile primeiro. Direção de arte: máximo 2 fontes e 3 cores (eu escolho a paleta), espaço em branco generoso, uma seção por ideia. Proibido: gradiente arco-íris, emoji em título, parágrafo com mais de 3 linhas, jargão de startup. Prova social só com o que existe no briefing — não inventa depoimento nem número.",
          },
          {
            tipo: "callout",
            variante: "risco",
            titulo: "Linha dura:",
            conteudo:
              "Depoimento inventado e número falso não são atalho de marketing — são mentira que derruba a confiança (e podem dar problema de verdade). Sem prova real, a página vive sem essa seção.",
          },
        ],
      },
      {
        tipo: "passo",
        n: 3,
        titulo: "Revise onde o cliente vai ver",
        blocos: [
          {
            tipo: "lista",
            estilo: "letras",
            itens: [
              "Abra no celular primeiro — é onde a maioria vê. Título cortado ou botão apertado reprova.",
              "Leia em voz alta. Frase que embola falando, embola lendo.",
              "Peça revisão cruzada: 'aponta as 3 partes mais fracas desta página e por quê'.",
            ],
          },
        ],
      },
      {
        tipo: "passo",
        n: 4,
        titulo: "Publique",
        blocos: [
          {
            tipo: "texto",
            conteudo:
              "Um arquivo HTML sobe em qualquer hospedagem de página estática com plano gratuito. Peça ao assistente o passo a passo da que você escolher — e o domínio próprio na frente é o acabamento que muda a percepção.",
          },
        ],
      },
    ],
    publicadoEm: "2026-07-17",
    verificadoEm: "2026-07-28",
    destaque: true,
    relacionados: ["m24", "m25"],
  },
  {
    id: "m23",
    slug: "prompts-de-imagem-que-funcionam",
    codigo: "IMAGEM",
    aliases: ["imagem", "prompt de imagem", "gerar imagem", "foto ia"],
    card: "Prompts de imagem que funcionam",
    tagline:
      "A anatomia do prompt visual: assunto, cena, luz, lente e estilo — e o truque de deixar a IA escrever o prompt por você.",
    titulo: "Imagem: a anatomia do prompt que acerta de primeira",
    resumo:
      "Prompt de imagem ruim desperdiça crédito em tentativa. A estrutura de cinco partes que os geradores entendem, exemplos prontos e o fluxo onde o assistente de texto vira seu engenheiro de prompt.",
    categoriaId: "criacao",
    tipo: "prompt",
    nivel: "iniciante",
    custo: "gratuito",
    ferramentas: ["Claude", "geradores de imagem"],
    plataformas: ["web"],
    tags: ["imagem", "prompt", "criacao"],
    resolve: [
      "minhas imagens de ia saem tortas",
      "gasto crédito demais até acertar uma imagem",
      "como descrever a imagem que tenho na cabeça",
    ],
    minutosEstimados: 15,
    blocos: [
      {
        tipo: "callout",
        variante: "info",
        titulo: "A anatomia (5 partes):",
        conteudo:
          "Assunto (quem/o quê) + cena (onde, fazendo o quê) + luz (dourada, dura, neon…) + câmera (retrato 85mm, aérea, macro…) + estilo (fotorrealista, ilustração chapada, 3D…). Prompt sem essas partes deixa o gerador decidir — e ele decide clichê.",
      },
      {
        tipo: "prompt",
        rotulo: "Exemplo — retrato profissional",
        conteudo:
          "Retrato profissional de uma advogada de 40 anos, escritório com estante de livros desfocada ao fundo, luz de janela suave vinda da esquerda, lente 85mm, profundidade de campo rasa, fotorrealista, cores sóbrias.",
      },
      {
        tipo: "prompt",
        rotulo: "Exemplo — produto",
        conteudo:
          "Foto de produto de um pote de cerâmica artesanal sobre mesa de madeira clara, fundo neutro bege, luz difusa de estúdio sem sombra dura, ângulo levemente acima, estilo catálogo minimalista.",
      },
      {
        tipo: "passo",
        n: 1,
        titulo: "Deixe o assistente engenheirar",
        blocos: [
          {
            tipo: "prompt",
            rotulo: "IA escrevendo o prompt",
            conteudo:
              "Vou descrever uma imagem em português corrido e você devolve o prompt estruturado nas 5 partes (assunto, cena, luz, câmera, estilo), pronto pro gerador. Se faltar informação de alguma parte, pergunta antes. Minha descrição: [descreva].",
          },
          {
            tipo: "callout",
            variante: "nota",
            titulo: "Itere barato:",
            conteudo:
              "Errou? Não jogue o prompt fora — mude UMA parte por vez (só a luz, só o ângulo). É assim que você descobre o que o gerador entendeu errado sem queimar crédito em tiro aleatório.",
          },
        ],
      },
      {
        tipo: "callout",
        variante: "atencao",
        titulo: "Pessoas reais:",
        conteudo:
          "Gerar imagem de pessoa real identificável sem consentimento é problema ético e jurídico — não faça. Pra retrato de cliente, fotografe o cliente.",
      },
    ],
    publicadoEm: "2026-07-07",
    verificadoEm: "2026-07-24",
    destaque: false,
    relacionados: ["m22", "m25"],
  },
  {
    id: "m24",
    slug: "primeiro-app-com-ia",
    codigo: "APP1",
    aliases: ["app", "aplicativo", "primeiro app", "criar aplicativo"],
    card: "Seu primeiro app, do zero ao uso real",
    tagline:
      "Não é 'app em 5 minutos' — é o caminho honesto: uma ferramenta pequena que resolve um problema seu, rodando de verdade.",
    titulo: "Primeiro app com IA: pequeno, seu e em uso",
    resumo:
      "O erro de estreia é mirar no app dos sonhos. O caminho que funciona: uma ferramenta de uma tela pra um incômodo seu, construída por conversa, usada por você na semana seguinte. Daí se cresce.",
    categoriaId: "criacao",
    tipo: "tutorial",
    nivel: "intermediario",
    custo: "gratuito",
    ferramentas: ["Claude Code"],
    plataformas: ["web"],
    tags: ["app", "desenvolvimento", "mvp"],
    resolve: [
      "quero criar um aplicativo mas não sei programar",
      "por onde começar um app com ia",
      "meu projeto de app nunca sai do papel",
    ],
    minutosEstimados: 120,
    prerequisitos: ["Claude Code (material PRIMEIRO)", "Modo plano (material PLANO)"],
    blocos: [
      {
        tipo: "passo",
        n: 1,
        titulo: "Escolha um incômodo, não uma ideia",
        blocos: [
          {
            tipo: "texto",
            conteudo:
              "Ideia de app é abstrata; incômodo é concreto. 'Controlar as horas que dedico a cada cliente' é incômodo. Se você usaria na próxima semana, é o app certo pra começar.",
          },
          {
            tipo: "callout",
            variante: "atencao",
            titulo: "Teto da primeira versão:",
            conteudo:
              "Uma tela. Um dado que entra. Uma coisa útil que sai. Login, pagamento e app de loja ficam pra depois que a versão de uma tela provar que você usa.",
          },
        ],
      },
      {
        tipo: "passo",
        n: 2,
        titulo: "Construa por conversa, com plano",
        blocos: [
          {
            tipo: "prompt",
            rotulo: "Abertura do projeto",
            conteudo:
              "Quero uma ferramenta web de uma tela pra [seu incômodo]. Requisitos: funciona no meu navegador, salva os dados localmente, sem login, sem servidor. Me apresenta o plano em etapas pequenas — cada etapa termina com algo que eu consigo abrir e testar. Não avança de etapa sem eu validar a anterior.",
          },
          {
            tipo: "callout",
            variante: "info",
            titulo: "O critério de progresso:",
            conteudo:
              "Etapa boa termina com você TESTANDO algo no navegador. Se passou uma hora sem você abrir e clicar, a etapa está grande demais — peça pra fatiar.",
          },
        ],
      },
      {
        tipo: "passo",
        n: 3,
        titulo: "Use por uma semana antes de crescer",
        blocos: [
          {
            tipo: "texto",
            conteudo:
              "O uso real é que diz o próximo recurso — nunca a empolgação do primeiro dia. Anote o que faltou enquanto usa; na sexta, escolha UM item da lista e implemente. Esse ciclo é desenvolvimento de produto de verdade.",
          },
        ],
      },
    ],
    publicadoEm: "2026-07-25",
    verificadoEm: "2026-07-31",
    destaque: true,
    relacionados: ["m22", "m08"],
  },
  {
    id: "m25",
    slug: "tire-a-cara-de-ia-do-texto",
    codigo: "ESCRITA",
    aliases: ["escrita", "texto de ia", "humanizar", "revisar texto"],
    card: "Tire a cara de IA dos seus textos",
    tagline:
      "Os tiques que entregam texto de máquina — e o prompt de revisão que devolve a sua voz ao que a IA escreveu.",
    titulo: "Escrita: os tiques de IA e como cortá-los",
    resumo:
      "Texto de IA se entrega pelos cacoetes: simetria artificial, adjetivo inflado, conclusão que resume o que acabou de dizer. A lista dos tiques mais comuns e o fluxo de revisão que devolve naturalidade.",
    categoriaId: "criacao",
    tipo: "prompt",
    nivel: "iniciante",
    custo: "gratuito",
    ferramentas: ["Claude"],
    plataformas: ["qualquer"],
    tags: ["escrita", "revisao", "conteudo"],
    resolve: [
      "meu texto parece escrito por robô",
      "como deixar o texto da ia com a minha voz",
      "revisar conteúdo gerado antes de publicar",
    ],
    minutosEstimados: 12,
    blocos: [
      {
        tipo: "callout",
        variante: "info",
        titulo: "Os tiques que entregam:",
        conteudo:
          "Trio de adjetivos em toda frase; 'não é só X, é Y'; parágrafos todos do mesmo tamanho; conclusão que repete a introdução; entusiasmo uniforme do início ao fim — gente de verdade varia o tom.",
      },
      {
        tipo: "prompt",
        rotulo: "Revisão anti-tique",
        conteudo:
          "Revisa este texto cortando cacoete de IA: elimina trio de adjetivos, quebra a simetria dos parágrafos, troca generalidade por detalhe concreto, corta a conclusão que só resume. Mantém minhas expressões e o meu ritmo — a revisão é pra soar MAIS como eu, não mais polido. Texto: [cole]",
      },
      {
        tipo: "passo",
        n: 1,
        titulo: "Dê amostra da sua voz",
        blocos: [
          {
            tipo: "prompt",
            rotulo: "Calibrar a voz",
            conteudo:
              "Aqui vão 3 textos que EU escrevi sem IA: [cole]. Descreve minha voz em 5 características observáveis (tamanho de frase, vocabulário, humor, pontuação, ritmo). Guarda como referência: toda revisão minha daqui em diante mira essa voz.",
          },
          {
            tipo: "callout",
            variante: "nota",
            titulo: "A ordem certa:",
            conteudo:
              "Rascunho seu + revisão de IA preserva a voz. Rascunho de IA + retoque seu preserva o tique. Quando o texto importa, escreva o esqueleto você mesmo.",
          },
        ],
      },
    ],
    publicadoEm: "2026-07-26",
    verificadoEm: "2026-07-30",
    destaque: false,
    relacionados: ["m22", "m23"],
  },
  {
    id: "m26",
    slug: "14-dias-de-base",
    codigo: "DIAS14",
    aliases: ["14 dias", "calendario", "plano de estudo", "duas semanas"],
    card: "14 dias pra sair do zero operando",
    tagline:
      "Um compromisso por dia, 30 minutos cada, usando os materiais desta central na ordem certa. No 14º dia tem sistema rodando.",
    titulo: "O calendário de 14 dias: do zero ao primeiro sistema",
    resumo:
      "Estudar sem sequência vira coleção de aba aberta. Este calendário fecha a sequência: cada dia um material desta central e uma entrega concreta de 30 minutos. Termina com uma automação sua no ar.",
    categoriaId: "formacao",
    tipo: "checklist",
    nivel: "iniciante",
    custo: "gratuito",
    ferramentas: ["Claude Code", "Obsidian"],
    plataformas: ["qualquer"],
    tags: ["plano", "estudo", "sequencia"],
    resolve: [
      "não tenho constância pra estudar ia",
      "quero um plano dia a dia",
      "quanto tempo leva pra aprender o básico",
    ],
    minutosEstimados: 30,
    blocos: [
      {
        tipo: "lista",
        estilo: "numeros",
        itens: [
          "Dias 1–2: instalar e rodar as primeiras ordens (PRIMEIRO) + perder o medo do terminal (TERMINAL).",
          "Dias 3–4: permissões configuradas (SEGURO) + contexto permanente do primeiro projeto (CLAUDEMD).",
          "Dias 5–7: memória de verdade — vault montado (VAULT), hábito de diário (DIARIO), sessões enxutas (CONTEXTO).",
          "Dias 8–10: primeira skill (SKILLS1), primeiro subagente (SUB), plano antes de executar (PLANO).",
          "Dias 11–12: custo sob controle — as 4 alavancas (TOKENS) e o modelo certo (MODELO).",
          "Dias 13–14: a primeira automação de verdade (N8N) e a rotina agendada que chega pronta (ROTINA).",
        ],
      },
      {
        tipo: "callout",
        variante: "info",
        titulo: "A regra do dia perdido:",
        conteudo:
          "Perdeu um dia? Continua de onde parou — não recomeça do dia 1. Recomeçar do zero é o jeito mais garantido de nunca passar do dia 3.",
      },
      {
        tipo: "prompt",
        rotulo: "Contrato de 14 dias",
        conteudo:
          "Sou seu acompanhante de 14 dias. Hoje é meu dia [N]. Me cobra: o que era pra eu ter feito até aqui, me pede a prova (arquivo, print, comando rodando) e me passa a missão de hoje em no máximo 30 minutos de trabalho.",
      },
    ],
    publicadoEm: "2026-07-27",
    verificadoEm: "2026-07-31",
    destaque: true,
    relacionados: ["m02", "m01", "m28"],
  },
  {
    id: "m27",
    slug: "estude-pela-fonte-primaria",
    codigo: "FONTES",
    aliases: ["fontes", "documentacao", "estudar de graca", "fonte primaria"],
    card: "Estude IA pela fonte primária (de graça)",
    tagline:
      "Documentação oficial, papers e changelogs — o material que os cursos resumem, disponível de graça e sempre mais atual.",
    titulo: "Fonte primária: estude onde os cursos copiam",
    resumo:
      "Todo curso de IA é resumo de fonte que você acessa de graça. O mapa das fontes que valem sua atenção, o hábito de leitura que substitui curso raso e o prompt que transforma doc técnica em aula sob medida.",
    categoriaId: "formacao",
    tipo: "curso",
    nivel: "intermediario",
    custo: "gratuito",
    ferramentas: ["Claude"],
    plataformas: ["web"],
    tags: ["estudo", "documentacao", "fontes"],
    resolve: [
      "curso de ia fica desatualizado em 3 meses",
      "onde estudar sem pagar caro",
      "documentação técnica é difícil de ler",
    ],
    minutosEstimados: 20,
    blocos: [
      {
        tipo: "lista",
        estilo: "marcadores",
        itens: [
          "Documentação oficial da ferramenta que você usa — sempre a fonte mais atual, por definição.",
          "Notas de versão (changelog): 10 minutos por semana e você fica na frente de quem espera o vídeo de novidade.",
          "Guias de engenharia dos próprios laboratórios (prompting, agentes, segurança) — de graça, direto de quem constrói.",
        ],
      },
      {
        tipo: "link",
        label: "Documentação do Claude Code",
        selo: "Fonte primária",
        href: "https://code.claude.com/docs",
      },
      {
        tipo: "prompt",
        rotulo: "Doc técnica virando aula",
        conteudo:
          "Vou te passar um link de documentação. Lê e me devolve: (1) o que isso me permite fazer que eu não conseguia, em português simples; (2) um exemplo aplicado ao MEU contexto [descreva seu trabalho]; (3) o menor experimento pra testar hoje em 15 minutos. Link: [cole]",
      },
      {
        tipo: "callout",
        variante: "nota",
        titulo: "Curso ainda vale quando:",
        conteudo:
          "Te dá sequência e cobrança (que fonte solta não dá) ou acesso a quem revisa seu trabalho. O que não vale é pagar por resumo desatualizado do que a doc diz melhor — e de graça.",
      },
    ],
    publicadoEm: "2026-07-04",
    verificadoEm: "2026-07-20",
    destaque: false,
    relacionados: ["m26", "m28"],
  },
  {
    id: "m28",
    slug: "portfolio-de-operador",
    codigo: "PROVA",
    aliases: ["portfolio", "provar", "mostrar trabalho", "carreira"],
    card: "Prove que você opera: portfólio real",
    tagline:
      "Certificado diz que você assistiu. Portfólio de operador mostra sistema rodando — e é isso que convence cliente e chefia.",
    titulo: "Portfólio de operador: a prova que substitui certificado",
    resumo:
      "O mercado não pergunta o que você estudou — pergunta o que você já fez rodar. Como documentar 3 operações reais (antes, como, depois) num formato que vende seu trabalho por você.",
    categoriaId: "formacao",
    tipo: "tutorial",
    nivel: "intermediario",
    custo: "gratuito",
    ferramentas: ["Claude Code"],
    plataformas: ["qualquer"],
    tags: ["portfolio", "carreira", "prova"],
    resolve: [
      "como provar que sei usar ia no trabalho",
      "certificado de ia vale alguma coisa",
      "montar portfólio sem ser programador",
    ],
    minutosEstimados: 45,
    blocos: [
      {
        tipo: "passo",
        n: 1,
        titulo: "O formato: antes → como → depois",
        blocos: [
          {
            tipo: "lista",
            estilo: "letras",
            itens: [
              "Antes: a tarefa como era — tempo que tomava, onde errava. Números honestos ('3h toda sexta'), não inflados.",
              "Como: o desenho da solução em linguagem de gente + 1 print ou vídeo curto do sistema rodando.",
              "Depois: o que mudou de verdade — inclusive o que NÃO melhorou. Honestidade diferencia mais que perfeição.",
            ],
          },
        ],
      },
      {
        tipo: "passo",
        n: 2,
        titulo: "Três casos bastam",
        blocos: [
          {
            tipo: "texto",
            conteudo:
              "Um caso de organização (memória, rotina), um de produção (documento, página, app pequeno) e um de automação (fluxo que roda sozinho). Três casos documentados valem mais que dez badges de curso.",
          },
          {
            tipo: "prompt",
            rotulo: "Documentar um caso",
            conteudo:
              "Me entrevista sobre uma automação que eu fiz e escreve o caso no formato antes/como/depois, em 1 página, tom direto e sem inflar resultado. Onde eu não tiver número, escreve sem número — não inventa.",
          },
        ],
      },
      {
        tipo: "passo",
        n: 3,
        titulo: "Publique onde te acham",
        blocos: [
          {
            tipo: "texto",
            conteudo:
              "Uma página simples com os 3 casos (material LANDING resolve) ou os casos direto no seu perfil profissional. O critério: quem pesquisar seu nome encontra prova de operação, não lista de curso.",
          },
        ],
      },
    ],
    publicadoEm: "2026-07-29",
    verificadoEm: "2026-07-31",
    destaque: false,
    relacionados: ["m26", "m22", "m27"],
  },
  {
    id: "m29",
    slug: "flags-antigas-do-cli",
    codigo: "LEGADO",
    aliases: ["flags", "versao antiga", "comandos antigos", "migracao"],
    card: "Flags antigas do CLI que mudaram",
    tagline:
      "Material histórico: opções de linha de comando que tutoriais antigos ainda citam e que já não funcionam como descrito.",
    titulo: "Arquivo: flags e comandos que mudaram de nome",
    resumo:
      "Guia mantido por transparência: reunia atalhos de linha de comando de versões antigas. As ferramentas mudaram e parte das instruções não vale mais — consulte sempre a documentação atual.",
    categoriaId: "claude-code",
    tipo: "tutorial",
    nivel: "avancado",
    custo: "gratuito",
    ferramentas: ["Claude Code"],
    plataformas: ["qualquer"],
    tags: ["legado", "historico", "migracao"],
    resolve: ["tutorial antigo cita comando que não existe mais"],
    minutosEstimados: 5,
    blocos: [
      {
        tipo: "callout",
        variante: "risco",
        titulo: "Este material foi descontinuado:",
        conteudo:
          "As versões que ele cobria saíram de circulação. Fica no ar porque link antigo não deve quebrar — mas não siga estas instruções em versão atual.",
      },
      {
        tipo: "texto",
        conteudo:
          "Se você chegou aqui por um tutorial antigo: o caminho seguro é a documentação oficial atual, que lista os comandos vigentes. Em caso de dúvida, pergunte ao próprio assistente qual é a forma atual do comando que o tutorial cita.",
      },
      {
        tipo: "link",
        label: "Documentação atual",
        selo: "Sempre vigente",
        href: "https://code.claude.com/docs",
      },
    ],
    publicadoEm: "2026-05-02",
    descontinuado: true,
    destaque: false,
    relacionados: ["m01"],
  },
];
