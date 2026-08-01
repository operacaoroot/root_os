import type { Material } from "@/central/types";

/* Categorias "Automação" e "Custo e tokens". */

export const materiaisAutomacaoCusto: Material[] = [
  {
    id: "m16",
    slug: "n8n-automacao-de-verdade",
    codigo: "N8N",
    aliases: ["n8n", "automacao", "workflow", "fluxo automatico"],
    card: "n8n + IA: automação de verdade",
    tagline:
      "O construtor visual de fluxos, open source e auto-hospedável — com a IA desenhando o fluxo por você.",
    titulo: "n8n: monte sua primeira automação com ajuda da IA",
    resumo:
      "O n8n conecta serviços em fluxos visuais: chegou e-mail, cria tarefa; sexta 18h, gera relatório. Aqui você instala, monta o primeiro fluxo e aprende a usar o assistente pra desenhar os próximos.",
    categoriaId: "automacao",
    tipo: "automacao",
    nivel: "intermediario",
    custo: "freemium",
    ferramentas: ["n8n", "Claude Code"],
    plataformas: ["web", "self-hosted"],
    tags: ["n8n", "automacao", "integracao"],
    resolve: [
      "faço a mesma tarefa manual toda semana",
      "como conectar meus aplicativos entre si",
      "automatizar sem saber programar",
    ],
    minutosEstimados: 40,
    blocos: [
      {
        tipo: "callout",
        variante: "info",
        titulo: "O que é o n8n:",
        conteudo:
          "Ferramenta de automação em que você liga blocos numa tela: gatilho (algo aconteceu) → ações (faça isso com aquilo). Código aberto, com opção gratuita rodando na sua máquina e planos pagos na nuvem deles.",
      },
      {
        tipo: "passo",
        n: 1,
        titulo: "Escolha onde rodar",
        blocos: [
          {
            tipo: "link",
            label: "Site oficial do n8n",
            selo: "Open source",
            href: "https://n8n.io",
          },
          {
            tipo: "lista",
            estilo: "letras",
            itens: [
              "Nuvem deles: zero instalação, tem custo mensal após o teste.",
              "Sua máquina: grátis pra sempre, mas o fluxo só roda com o computador ligado.",
              "Servidor próprio: grátis e 24/7 — o passo natural depois que a automação provar valor.",
            ],
          },
        ],
      },
      {
        tipo: "passo",
        n: 2,
        titulo: "Primeiro fluxo: um gatilho, uma ação",
        blocos: [
          {
            tipo: "texto",
            conteudo:
              "Comece ridículo de simples: 'toda segunda 8h, me mande um lembrete com a lista de pendências'. Fluxo de dois blocos. O objetivo é ver a engrenagem girar sozinha uma vez — o resto é repetição.",
          },
        ],
      },
      {
        tipo: "passo",
        n: 3,
        titulo: "Use a IA como projetista",
        blocos: [
          {
            tipo: "prompt",
            rotulo: "Desenhar o fluxo antes de montar",
            conteudo:
              "Quero automatizar isto no n8n: [descreva a tarefa manual]. Me entrega: (1) o desenho do fluxo bloco a bloco, com o nome de cada nó do n8n; (2) o que configurar em cada nó; (3) onde esse fluxo pode falhar e como criar o aviso de falha. Não presume integração que eu não citei.",
          },
          {
            tipo: "callout",
            variante: "atencao",
            titulo: "Automação sem aviso de falha é bomba silenciosa:",
            conteudo:
              "Fluxo que quebra calado te deixa semanas achando que está rodando. Todo fluxo seu merece um nó final de 'deu errado? me avisa'.",
          },
        ],
      },
    ],
    publicadoEm: "2026-07-11",
    verificadoEm: "2026-07-27",
    destaque: true,
    relacionados: ["m18", "m17", "m14"],
  },
  {
    id: "m17",
    slug: "whatsapp-com-aprovacao-humana",
    codigo: "ZAP",
    aliases: ["whatsapp", "atendimento", "zap", "mensagens automaticas"],
    card: "IA no WhatsApp — com você no comando",
    tagline:
      "O desenho honesto: a IA rascunha, você aprova, o cliente recebe. Sem resposta automática falando em seu nome.",
    titulo: "WhatsApp com IA: rascunho automático, envio humano",
    resumo:
      "Automação de WhatsApp dá errado quando a IA responde sozinha. O desenho que funciona: ela lê, classifica e rascunha; você aprova em um clique. Aqui está a arquitetura e os cuidados de conta.",
    categoriaId: "automacao",
    tipo: "automacao",
    nivel: "avancado",
    custo: "pago",
    ferramentas: ["n8n", "WhatsApp"],
    plataformas: ["web", "self-hosted"],
    tags: ["whatsapp", "atendimento", "aprovacao"],
    resolve: [
      "não dou conta das mensagens de cliente",
      "quero ia no whatsapp sem perder o controle",
      "resposta automática que não queime minha marca",
    ],
    minutosEstimados: 60,
    prerequisitos: ["n8n funcionando (material N8N)"],
    blocos: [
      {
        tipo: "callout",
        variante: "risco",
        titulo: "Antes de tudo — a regra do jogo:",
        conteudo:
          "Automação de WhatsApp fora da API oficial (WhatsApp Business API, via provedor autorizado) viola os termos da plataforma e arrisca banir o número. Número de trabalho banido é prejuízo real. Use a via oficial.",
      },
      {
        tipo: "passo",
        n: 1,
        titulo: "O desenho: três estações",
        blocos: [
          {
            tipo: "lista",
            estilo: "letras",
            itens: [
              "Entrada: mensagem chega pela API oficial e cai no fluxo.",
              "Preparo: a IA classifica (urgente? orçamento? dúvida comum?) e escreve um rascunho de resposta com base no seu material.",
              "Aprovação: o rascunho chega pra você (painel ou chat interno). Um clique aprova e envia; outro edita.",
            ],
          },
          {
            tipo: "callout",
            variante: "info",
            titulo: "Por que o humano fica:",
            conteudo:
              "O gargalo real de atendimento não é digitar — é decidir o que dizer. O rascunho corta 80% do esforço e o clique final mantém a sua palavra sendo sua.",
          },
        ],
      },
      {
        tipo: "passo",
        n: 2,
        titulo: "Monte a base de respostas",
        blocos: [
          {
            tipo: "prompt",
            rotulo: "Extrair a base do seu histórico",
            conteudo:
              "Analisa estas conversas antigas de atendimento [exportadas por você] e monta uma base de conhecimento: as 20 perguntas mais comuns e a melhor resposta que eu já dei pra cada uma, no meu tom. É essa base que você vai usar pra rascunhar respostas novas.",
          },
        ],
      },
      {
        tipo: "passo",
        n: 3,
        titulo: "Uma semana em modo sombra",
        blocos: [
          {
            tipo: "texto",
            conteudo:
              "Primeira semana: a IA só rascunha, você envia tudo manualmente e anota onde o rascunho errou. Corrija a base, não o rascunho. Só depois disso vale acelerar a aprovação.",
          },
        ],
      },
    ],
    publicadoEm: "2026-07-19",
    verificadoEm: "2026-07-26",
    destaque: false,
    relacionados: ["m16", "m18"],
  },
  {
    id: "m18",
    slug: "rotinas-agendadas",
    codigo: "ROTINA",
    aliases: ["rotina", "agendado", "cron", "tarefa recorrente"],
    card: "Rotinas: a IA trabalha enquanto você dorme",
    tagline:
      "Resumo diário às 7h, conferência toda sexta, relatório todo dia 1º — tarefas agendadas que chegam prontas.",
    titulo: "Rotinas agendadas: o turno da madrugada da sua IA",
    resumo:
      "Toda tarefa com hora marcada é candidata a rodar sozinha. O critério pra escolher a primeira, o desenho do agendamento e a regra que evita rotina apodrecida.",
    categoriaId: "automacao",
    tipo: "automacao",
    nivel: "intermediario",
    custo: "gratuito",
    ferramentas: ["Claude Code", "n8n"],
    plataformas: ["qualquer"],
    tags: ["agendamento", "rotina", "cron"],
    resolve: [
      "começo o dia caçando informação em vários lugares",
      "esqueço tarefas recorrentes",
      "queria relatório pronto sem pedir",
    ],
    minutosEstimados: 20,
    prerequisitos: ["Alguma automação de base (material N8N) ou Claude Code com agendamento"],
    blocos: [
      {
        tipo: "passo",
        n: 1,
        titulo: "Escolha a rotina certa",
        blocos: [
          {
            tipo: "lista",
            estilo: "marcadores",
            itens: [
              "Tem hora certa (toda manhã, toda sexta, todo dia 1º).",
              "O insumo é acessível sem você (arquivo, agenda, sistema conectado).",
              "O resultado é leitura, não decisão — rotina informa; decidir segue sendo seu.",
            ],
          },
        ],
      },
      {
        tipo: "passo",
        n: 2,
        titulo: "Escreva a rotina como encomenda",
        blocos: [
          {
            tipo: "prompt",
            rotulo: "Exemplo: resumo da manhã",
            conteudo:
              "Toda manhã às 7h: lê minha agenda de hoje, as pendências do diário de projeto e o que chegou de novo nas pastas que eu indiquei. Me entrega em uma mensagem: 3 compromissos, 3 prioridades e 1 alerta se algo estiver estourando prazo. Máximo 12 linhas.",
          },
          {
            tipo: "callout",
            variante: "nota",
            titulo: "Formato fixo importa:",
            conteudo:
              "Rotina com formato fixo você lê em 30 segundos e percebe na hora quando algo mudou. Rotina em texto livre vira e-mail que você para de abrir.",
          },
        ],
      },
      {
        tipo: "passo",
        n: 3,
        titulo: "A regra dos 14 dias",
        blocos: [
          {
            tipo: "texto",
            conteudo:
              "Rotina que você não leu por duas semanas seguidas morre — desligue sem culpa. Rotina boa é a que você sente falta quando falha. As outras são ruído com hora marcada.",
          },
        ],
      },
    ],
    publicadoEm: "2026-07-21",
    verificadoEm: "2026-07-28",
    destaque: false,
    relacionados: ["m16", "m10"],
  },
  {
    id: "m19",
    slug: "corte-tokens-sem-cortar-qualidade",
    codigo: "TOKENS",
    aliases: ["tokens", "custo", "economizar", "reduzir tokens", "conta alta"],
    card: "Corte tokens sem cortar qualidade",
    tagline:
      "As quatro alavancas de quem opera barato: contexto enxuto, modelo certo, cache ligado e sessão que termina.",
    titulo: "Tokens: onde o custo nasce e as 4 alavancas pra cortar",
    resumo:
      "Conta alta de IA quase nunca é preço de modelo — é desperdício de contexto. Entenda o que realmente consome e aplique as quatro alavancas, da mais barata pra mais técnica.",
    categoriaId: "custo",
    tipo: "tutorial",
    nivel: "intermediario",
    custo: "gratuito",
    ferramentas: ["Claude Code", "API"],
    plataformas: ["qualquer"],
    tags: ["tokens", "custo", "economia"],
    resolve: [
      "minha conta de ia está alta demais",
      "bato no limite de uso toda hora",
      "como gastar menos token sem piorar o resultado",
    ],
    minutosEstimados: 15,
    blocos: [
      {
        tipo: "callout",
        variante: "info",
        titulo: "De onde vem o custo:",
        conteudo:
          "Você paga pelo que entra (todo o contexto da conversa, de novo a cada mensagem) e pelo que sai. Conversa longa com arquivo grande dentro é a conta subindo em silêncio a cada turno.",
      },
      {
        tipo: "lista",
        estilo: "numeros",
        itens: [
          "Contexto enxuto: aponte arquivos específicos, encerre sessão concluída, recomece limpo depois de erros (material CONTEXTO). É a alavanca gratuita que mais paga.",
          "Modelo certo por tarefa: tarefa mecânica em modelo leve, raciocínio pesado em modelo forte (material MODELO). Usar o topo de linha pra formatar texto é dinheiro no lixo.",
          "Cache de prompt: contexto repetido (instruções, base de conhecimento) pode custar fração do preço nas chamadas seguintes (material CACHE).",
          "Delegação com retorno curto: subagente que devolve relatório de uma página em vez de despejar tudo que leu no contexto principal.",
        ],
      },
      {
        tipo: "prompt",
        rotulo: "Auditoria do seu uso",
        conteudo:
          "Analisa como eu venho usando você nesta semana: onde o contexto ficou grande sem necessidade, que tarefas cabiam num modelo mais leve e que instrução repetida merecia virar arquivo permanente. Me devolve as 3 mudanças de maior impacto no custo.",
      },
      {
        tipo: "callout",
        variante: "nota",
        titulo: "O que NÃO fazer:",
        conteudo:
          "Cortar contexto necessário pra economizar. Resposta errada por falta de informação custa mais caro que os tokens que você poupou — retrabalho é o token mais caro que existe.",
      },
    ],
    publicadoEm: "2026-07-09",
    verificadoEm: "2026-07-25",
    destaque: true,
    relacionados: ["m11", "m20", "m21"],
  },
  {
    id: "m20",
    slug: "prompt-caching-pague-menos",
    codigo: "CACHE",
    aliases: ["cache", "prompt caching", "cache de prompt", "api barata"],
    card: "Cache: pague uma vez pelo contexto",
    tagline:
      "Pra quem usa a API: o contexto que se repete entre chamadas pode custar uma fração do preço. Entenda quando liga.",
    titulo: "Prompt caching: o desconto de quem repete contexto",
    resumo:
      "Se as suas chamadas de API repetem o mesmo bloco grande — instruções, base de conhecimento, poucos-exemplos — o caching cobra caro uma vez e barato nas repetições. Quando vale, quando não vale e como conferir se está funcionando.",
    categoriaId: "custo",
    tipo: "tutorial",
    nivel: "avancado",
    custo: "gratuito",
    ferramentas: ["API", "Claude"],
    plataformas: ["api"],
    tags: ["cache", "api", "custo"],
    resolve: [
      "uso a api e o custo escala com o volume",
      "mando o mesmo contexto em toda chamada",
      "como funciona o prompt caching",
    ],
    minutosEstimados: 20,
    prerequisitos: ["Usar a API diretamente (não se aplica a quem usa só o app)"],
    blocos: [
      {
        tipo: "callout",
        variante: "info",
        titulo: "A mecânica:",
        conteudo:
          "Você marca o trecho estável do prompt como cacheável. A primeira chamada grava (custa um pouco mais); as seguintes, dentro da janela de validade, leem do cache por fração do preço de entrada. O ganho aparece quando há repetição de verdade.",
      },
      {
        tipo: "passo",
        n: 1,
        titulo: "Separe o estável do variável",
        blocos: [
          {
            tipo: "lista",
            estilo: "marcadores",
            itens: [
              "Estável (cacheável): instruções do sistema, base de conhecimento, exemplos fixos.",
              "Variável (fora do cache): a pergunta do usuário, o dado do dia.",
              "Regra de estrutura: estável primeiro, variável no fim — cache casa por prefixo.",
            ],
          },
        ],
      },
      {
        tipo: "passo",
        n: 2,
        titulo: "Confira na resposta da API",
        blocos: [
          {
            tipo: "texto",
            conteudo:
              "A resposta da API informa quanto veio do cache e quanto foi cobrado cheio. Se o campo de leitura de cache está zerado nas chamadas repetidas, algo no seu prefixo está mudando — timestamp, id de sessão, qualquer byte diferente quebra o casamento.",
          },
          {
            tipo: "link",
            label: "Documentação oficial da API",
            selo: "Anthropic",
            href: "https://code.claude.com/docs",
          },
        ],
      },
      {
        tipo: "callout",
        variante: "atencao",
        titulo: "Quando NÃO compensa:",
        conteudo:
          "Chamada esporádica (o cache expira entre uma e outra) ou prefixo pequeno. Cache é desconto de volume com repetição — não é desconto universal.",
      },
    ],
    publicadoEm: "2026-07-23",
    verificadoEm: "2026-07-30",
    destaque: false,
    relacionados: ["m19", "m21"],
  },
  {
    id: "m21",
    slug: "modelo-certo-para-cada-tarefa",
    codigo: "MODELO",
    aliases: ["modelo", "qual modelo usar", "modelo certo", "escolher modelo"],
    card: "O modelo certo pra cada tarefa",
    tagline:
      "Forte pra pensar, leve pra executar: o critério simples que corta custo sem perder qualidade.",
    titulo: "Escolha de modelo: o critério de quem paga a conta",
    resumo:
      "Não existe melhor modelo — existe modelo certo por tarefa. Um checklist honesto pra decidir quando o topo de linha se paga e quando o leve entrega igual por muito menos.",
    categoriaId: "custo",
    tipo: "checklist",
    nivel: "iniciante",
    custo: "gratuito",
    ferramentas: ["Claude"],
    plataformas: ["qualquer"],
    tags: ["modelos", "custo", "criterio"],
    resolve: [
      "não sei qual modelo escolher",
      "pago modelo caro pra tarefa boba",
      "quando vale usar o modelo mais forte",
    ],
    minutosEstimados: 8,
    blocos: [
      {
        tipo: "lista",
        estilo: "marcadores",
        itens: [
          "Modelo forte quando: a decisão é cara se errar, o problema exige juntar muitas pontas, o texto vai pra fora com o seu nome.",
          "Modelo leve quando: formatar, extrair, classificar, resumir com padrão claro — tarefa com resposta verificável no olho.",
          "Padrão orquestrador: o forte planeja e revisa; o leve executa o miolo. É o desenho que segura qualidade com custo baixo.",
          "Teste cego de 10 minutos: rode a mesma tarefa nos dois. Se você não distingue o resultado, o leve venceu.",
        ],
      },
      {
        tipo: "callout",
        variante: "nota",
        titulo: "Preços mudam — o critério não:",
        conteudo:
          "Tabela de preço e nome de modelo mudam a cada trimestre; consulte sempre a página oficial. O que não muda: pagar raciocínio premium pra tarefa mecânica é desperdício em qualquer tabela.",
      },
      {
        tipo: "link",
        label: "Modelos e preços atuais",
        selo: "claude.com",
        href: "https://claude.com",
      },
    ],
    publicadoEm: "2026-07-13",
    verificadoEm: "2026-07-29",
    destaque: false,
    relacionados: ["m19", "m20"],
  },
];
