import type { Material } from "@/central/types";

/* Categorias "Memória e contexto" e "Agentes e times". */

export const materiaisMemoriaAgentes: Material[] = [
  {
    id: "m10",
    slug: "memoria-permanente-com-obsidian",
    codigo: "VAULT",
    aliases: ["obsidian", "vault", "memoria", "segundo cerebro", "memoria permanente"],
    card: "Memória permanente com Obsidian",
    tagline:
      "Notas em texto simples que a IA lê e escreve: seus projetos, decisões e reuniões viram contexto que não se apaga.",
    titulo: "Monte a memória permanente da sua IA com Obsidian",
    resumo:
      "Chat esquece; arquivo fica. O fluxo aqui: instalar o Obsidian, deixar o assistente montar a estrutura de notas e criar o hábito de registrar — a partir daí, toda sessão começa sabendo de você.",
    categoriaId: "memoria",
    tipo: "tutorial",
    nivel: "iniciante",
    custo: "gratuito",
    ferramentas: ["Obsidian", "Claude Code"],
    plataformas: ["macOS", "Windows", "Linux"],
    tags: ["obsidian", "memoria", "notas", "vault"],
    resolve: [
      "a ia esquece tudo entre uma conversa e outra",
      "queria que o claude conhecesse meus projetos",
      "onde guardar o que decidimos nas reuniões",
    ],
    minutosEstimados: 30,
    prerequisitos: ["Claude Code instalado (material PRIMEIRO)"],
    blocos: [
      {
        tipo: "callout",
        variante: "info",
        titulo: "Por que Obsidian:",
        conteudo:
          "As notas são arquivos de texto comuns, guardados no seu computador. A IA lê e escreve neles direto — sem plataforma no meio, sem mensalidade, sem o seu conhecimento preso em serviço de terceiro.",
      },
      {
        tipo: "passo",
        n: 1,
        titulo: "Instale o Obsidian",
        blocos: [
          {
            tipo: "link",
            label: "Baixar o Obsidian",
            selo: "Grátis",
            href: "https://obsidian.md",
          },
          {
            tipo: "texto",
            conteudo:
              "Instale e abra uma vez. Ainda não crie nada — a estrutura quem monta é o assistente, no próximo passo.",
          },
        ],
      },
      {
        tipo: "passo",
        n: 2,
        titulo: "Deixe o assistente montar a estrutura",
        blocos: [
          {
            tipo: "prompt",
            rotulo: "Montar o vault",
            conteudo:
              "Cria um vault do Obsidian em Documentos/vault-root com esta estrutura: uma nota INICIO.md me apresentando o vault; pastas Projetos, Pessoas, Decisões e Diário; e um modelo de nota pra cada pasta. Depois me explica como você vai usar cada pasta quando eu te contar coisas.",
          },
          {
            tipo: "callout",
            variante: "nota",
            titulo: "O truque:",
            conteudo:
              "A estrutura importa menos que o combinado. O que vale é o assistente saber onde registrar cada tipo de informação — e isso ficou dito na resposta dele.",
          },
        ],
      },
      {
        tipo: "passo",
        n: 3,
        titulo: "Crie o hábito de 2 minutos",
        blocos: [
          {
            tipo: "prompt",
            rotulo: "Fim do dia",
            conteudo:
              "Registra no diário de hoje: o que a gente fez nesta sessão, o que decidimos e o que ficou pendente. Atualiza as notas de projeto que foram afetadas.",
          },
          {
            tipo: "prompt",
            rotulo: "Começo do dia",
            conteudo:
              "Lê o diário dos últimos 3 dias e as notas dos projetos ativos. Me diz em 5 linhas onde paramos e o que você sugere atacar primeiro.",
          },
          {
            tipo: "callout",
            variante: "info",
            titulo: "O efeito composto:",
            conteudo:
              "Duas semanas desse hábito e a pergunta 'como era mesmo aquilo?' passa a ter resposta instantânea — com fonte.",
          },
        ],
      },
    ],
    publicadoEm: "2026-06-28",
    verificadoEm: "2026-07-21",
    destaque: true,
    relacionados: ["m04", "m11", "m12"],
  },
  {
    id: "m11",
    slug: "contexto-enxuto",
    codigo: "CONTEXTO",
    aliases: ["contexto", "janela de contexto", "contexto cheio", "sessao longa"],
    card: "Contexto enxuto, respostas melhores",
    tagline:
      "A janela de contexto é um balcão, não um armazém. O que entra, o que fica de fora e quando reiniciar a sessão.",
    titulo: "Contexto enxuto: a arte de dar só o que importa",
    resumo:
      "Resposta ruim raramente é modelo ruim — costuma ser contexto lotado de coisa irrelevante. Três práticas pra manter a sessão afiada do começo ao fim.",
    categoriaId: "memoria",
    tipo: "tutorial",
    nivel: "intermediario",
    custo: "gratuito",
    ferramentas: ["Claude Code"],
    plataformas: ["qualquer"],
    tags: ["contexto", "qualidade", "sessao"],
    resolve: [
      "a ia começa bem e vai piorando na conversa",
      "respostas ficam confusas em sessão longa",
      "quando devo abrir uma conversa nova",
    ],
    minutosEstimados: 12,
    blocos: [
      {
        tipo: "callout",
        variante: "info",
        titulo: "O modelo mental:",
        conteudo:
          "Tudo que entra na conversa — arquivo, resposta antiga, tentativa errada — segue ocupando espaço e disputando atenção. Contexto não é estoque; é bancada de trabalho.",
      },
      {
        tipo: "lista",
        estilo: "numeros",
        itens: [
          "Abra sessão por missão, não por dia. Terminou a missão, encerre. Assunto novo, sessão nova.",
          "Aponte o arquivo certo em vez de despejar a pasta inteira. 'Lê o contrato X' ganha de 'lê tudo aí'.",
          "Tentativa errada suja a bancada: depois de dois erros seguidos, resuma o que aprendeu e recomece limpo.",
        ],
      },
      {
        tipo: "prompt",
        rotulo: "Troca de sessão sem perder o fio",
        conteudo:
          "Resume esta sessão em um bloco pra eu colar numa conversa nova: objetivo, o que já foi feito, decisões tomadas e o próximo passo. Sem histórico das tentativas — só o estado atual.",
      },
      {
        tipo: "callout",
        variante: "nota",
        titulo: "Ligação com a memória:",
        conteudo:
          "Sessão enxuta só funciona porque a memória de longo prazo mora fora dela — no vault (material VAULT) e no CLAUDE.md. Chat é bancada; arquivo é arquivo.",
      },
    ],
    publicadoEm: "2026-07-14",
    verificadoEm: "2026-07-28",
    destaque: false,
    relacionados: ["m10", "m04", "m19"],
  },
  {
    id: "m12",
    slug: "diario-de-projeto-automatico",
    codigo: "DIARIO",
    aliases: ["diario", "log de projeto", "historico", "registro"],
    card: "O diário de projeto que se escreve sozinho",
    tagline:
      "Um modelo de nota + um prompt de fechamento = histórico completo de cada projeto, sem esforço de escrita.",
    titulo: "Diário de projeto: o histórico que a IA mantém por você",
    resumo:
      "Template pronto de diário de projeto e o prompt que faz o assistente preenchê-lo ao fim de cada sessão de trabalho. Quem chega depois — inclusive você em 3 meses — entende tudo.",
    categoriaId: "memoria",
    tipo: "template",
    nivel: "iniciante",
    custo: "gratuito",
    ferramentas: ["Obsidian", "Claude Code"],
    plataformas: ["qualquer"],
    tags: ["diario", "template", "documentacao"],
    resolve: [
      "não lembro por que decidimos as coisas no projeto",
      "documentar dá trabalho e nunca sai",
      "como manter histórico das sessões de trabalho",
    ],
    minutosEstimados: 10,
    prerequisitos: ["Um lugar pra guardar notas (material VAULT ajuda)"],
    blocos: [
      {
        tipo: "passo",
        n: 1,
        titulo: "Copie o modelo",
        blocos: [
          {
            tipo: "prompt",
            rotulo: "Modelo de entrada de diário",
            conteudo:
              "# {data} — {projeto}\n\n**Feito hoje:**\n- \n\n**Decidido (e por quê):**\n- \n\n**Travou em:**\n- \n\n**Próxima sessão começa por:**\n- ",
          },
        ],
      },
      {
        tipo: "passo",
        n: 2,
        titulo: "Feche toda sessão com o mesmo prompt",
        blocos: [
          {
            tipo: "prompt",
            rotulo: "Fechamento de sessão",
            conteudo:
              "Preenche a entrada de hoje no diário deste projeto usando o modelo. Seja específico no 'por quê' das decisões — é a parte que eu esqueço. Se mudamos algo que contradiz entrada antiga, anota a mudança.",
          },
        ],
      },
      {
        tipo: "callout",
        variante: "info",
        titulo: "Onde isso paga:",
        conteudo:
          "Retomar projeto parado, passar trabalho pra outra pessoa, auditar decisão antiga. O diário transforma 'acho que foi assim' em registro com data.",
      },
    ],
    publicadoEm: "2026-06-05",
    verificadoEm: "2026-06-10",
    destaque: false,
    relacionados: ["m10", "m11"],
  },
  {
    id: "m13",
    slug: "time-de-agentes-revisores",
    codigo: "TIME",
    aliases: ["time de agentes", "revisores", "multiagente", "conselho"],
    card: "Um time de agentes revisando seu trabalho",
    tagline:
      "Três revisores independentes, cada um caçando um tipo de erro — e um veredito que não passa a mão na sua cabeça.",
    titulo: "Monte um time de agentes que revisa de verdade",
    resumo:
      "Um revisor só tende a concordar com você. O antídoto: agentes em paralelo com papéis opostos — um caça erro, um ataca a premissa, um confere fonte. Aqui está o roteiro pra montar o seu.",
    categoriaId: "agentes",
    tipo: "tutorial",
    nivel: "avancado",
    custo: "gratuito",
    ferramentas: ["Claude Code"],
    plataformas: ["qualquer"],
    tags: ["multiagente", "revisao", "qualidade"],
    resolve: [
      "a ia sempre concorda comigo",
      "como ter revisão crítica de verdade",
      "confiar no trabalho que a ia entrega",
    ],
    minutosEstimados: 25,
    prerequisitos: ["Subagentes básicos (material SUB)"],
    blocos: [
      {
        tipo: "callout",
        variante: "info",
        titulo: "Por que papéis opostos:",
        conteudo:
          "Três revisores com o mesmo prompt acham os mesmos problemas. Diversidade de lente — não quantidade — é o que aumenta a cobertura.",
      },
      {
        tipo: "passo",
        n: 1,
        titulo: "Defina os três papéis",
        blocos: [
          {
            tipo: "lista",
            estilo: "letras",
            itens: [
              "Caçador de erro: procura o que está factualmente errado ou quebrado. Proibido elogiar.",
              "Advogado do contra: ataca a premissa. 'E se a abordagem inteira estiver errada?'",
              "Auditor de fonte: confere se cada afirmação tem base — e marca as que não têm.",
            ],
          },
        ],
      },
      {
        tipo: "passo",
        n: 2,
        titulo: "Despache em paralelo",
        blocos: [
          {
            tipo: "prompt",
            rotulo: "Rodar o conselho",
            conteudo:
              "Pega o documento em rascunho/proposta.md e roda três subagentes em paralelo: (1) caçador de erro — lista só problemas concretos, sem elogio; (2) advogado do contra — ataca a premissa central e propõe a alternativa mais forte; (3) auditor — lista toda afirmação sem fonte. Depois consolida: o que os três concordam que precisa mudar?",
          },
        ],
      },
      {
        tipo: "passo",
        n: 3,
        titulo: "Regra de decisão",
        blocos: [
          {
            tipo: "texto",
            conteudo:
              "Achado que dois de três apontaram: corrija sem discutir. Achado de um só: avalie você. Elogio unânime: desconfie do prompt — aperte os papéis.",
          },
          {
            tipo: "callout",
            variante: "atencao",
            titulo: "Custo na mesa:",
            conteudo:
              "Três agentes custam três vezes mais tokens que um. Use o conselho no que vai pra fora — proposta, contrato, publicação — e revisor único no rascunho interno.",
          },
        ],
      },
    ],
    publicadoEm: "2026-07-22",
    verificadoEm: "2026-07-30",
    destaque: true,
    relacionados: ["m06", "m15"],
  },
  {
    id: "m14",
    slug: "seus-3-primeiros-mcps",
    codigo: "MCP",
    aliases: ["mcp", "model context protocol", "conectar ferramentas", "integracao"],
    card: "Seus 3 primeiros MCPs",
    tagline:
      "O protocolo que pluga a IA nas suas ferramentas — e os três tipos de conexão que valem a pena primeiro.",
    titulo: "MCP: conecte a IA às suas ferramentas (começando certo)",
    resumo:
      "MCP é o padrão aberto que deixa o assistente conversar com serviços externos — agenda, banco de dados, repositório. Aqui: como funciona, os três primeiros que fazem diferença e o critério de segurança pra escolher.",
    categoriaId: "agentes",
    tipo: "mcp",
    nivel: "intermediario",
    custo: "gratuito",
    ferramentas: ["Claude Code", "MCP"],
    plataformas: ["qualquer"],
    tags: ["mcp", "integracao", "ferramentas"],
    resolve: [
      "quero que a ia acesse minha agenda e meus dados",
      "o que é mcp e pra que serve",
      "como conectar o claude em outros serviços",
    ],
    minutosEstimados: 20,
    prerequisitos: ["Claude Code no dia a dia"],
    blocos: [
      {
        tipo: "callout",
        variante: "info",
        titulo: "MCP em uma frase:",
        conteudo:
          "Um padrão aberto (criado pela Anthropic, hoje usado por várias ferramentas) pra IA descobrir e usar serviços externos com permissão sua — em vez de você copiar e colar dado de um lado pro outro.",
      },
      {
        tipo: "passo",
        n: 1,
        titulo: "Os três primeiros que compensam",
        blocos: [
          {
            tipo: "lista",
            estilo: "letras",
            itens: [
              "O que você consulta toda hora: agenda ou e-mail. A IA passa a responder 'o que tenho hoje?' com dado real.",
              "Onde mora seu trabalho: repositório de código ou pasta de documentos do seu ofício.",
              "A fonte que você copia e cola: planilha, banco, sistema interno — o dado que você vive transportando na mão.",
            ],
          },
        ],
      },
      {
        tipo: "passo",
        n: 2,
        titulo: "Instale com critério",
        blocos: [
          {
            tipo: "texto",
            conteudo:
              "MCP roda com as suas credenciais. Antes de conectar qualquer servidor, responda três perguntas: quem publica (oficial ou desconhecido?), o que ele acessa (só leitura ou escrita?) e por onde a credencial passa.",
          },
          {
            tipo: "callout",
            variante: "risco",
            titulo: "Regra dura:",
            conteudo:
              "Servidor MCP de autor desconhecido com acesso de escrita é risco real — ele age em seu nome. Prefira conector oficial do serviço, comece em modo leitura e só amplie depois de confiar.",
          },
          {
            tipo: "link",
            label: "Documentação de MCP no Claude Code",
            selo: "code.claude.com",
            href: "https://code.claude.com/docs",
          },
        ],
      },
      {
        tipo: "passo",
        n: 3,
        titulo: "Teste com pergunta que você sabe a resposta",
        blocos: [
          {
            tipo: "exemplo",
            contexto: "Conector de agenda recém-instalado",
            prompt: "O que eu tenho na agenda amanhã de manhã?",
            resultado:
              "Se a resposta bater com o que você já sabe, a conexão está sã. Teste sempre com verdade conhecida antes de confiar no desconhecido.",
          },
        ],
      },
    ],
    publicadoEm: "2026-07-16",
    verificadoEm: "2026-07-29",
    destaque: false,
    relacionados: ["m06", "m09", "m16"],
  },
  {
    id: "m15",
    slug: "maquina-de-pesquisa-com-agentes",
    codigo: "PESQUISA",
    aliases: ["pesquisa", "pesquisa profunda", "investigacao", "levantamento"],
    card: "Sua máquina de pesquisa com agentes",
    tagline:
      "Levantamento que tomaria uma tarde: agentes varrem em paralelo, cruzam achados e entregam com fonte.",
    titulo: "Monte uma máquina de pesquisa com agentes em paralelo",
    resumo:
      "O padrão varredura → verificação → síntese aplicado a qualquer levantamento: mercado, concorrência, jurisprudência, fornecedor. Com o guarda-corpo que separa pesquisa de alucinação: fonte em tudo.",
    categoriaId: "agentes",
    tipo: "tutorial",
    nivel: "avancado",
    custo: "gratuito",
    ferramentas: ["Claude Code"],
    plataformas: ["qualquer"],
    tags: ["pesquisa", "multiagente", "sintese"],
    resolve: [
      "levantamento toma minha tarde inteira",
      "como pesquisar vários ângulos ao mesmo tempo",
      "resumo de ia sem fonte não dá pra confiar",
    ],
    minutosEstimados: 30,
    prerequisitos: ["Subagentes (material SUB)", "Time de revisão ajuda (material TIME)"],
    blocos: [
      {
        tipo: "passo",
        n: 1,
        titulo: "Quebre a pergunta em frentes",
        blocos: [
          {
            tipo: "texto",
            conteudo:
              "Pergunta grande não se pesquisa inteira — se quebra. 'Vale entrar nesse mercado?' vira: tamanho e tendência; quem já atua e como cobra; barreira de entrada; o que dá errado pra quem tentou.",
          },
        ],
      },
      {
        tipo: "passo",
        n: 2,
        titulo: "Uma frente por agente, fonte obrigatória",
        blocos: [
          {
            tipo: "prompt",
            rotulo: "Despacho de varredura",
            conteudo:
              "Roda 4 subagentes em paralelo, um por frente: [suas frentes aqui]. Regra pra todos: cada achado vem com a fonte (link ou documento). Achado sem fonte entra numa lista separada chamada 'a confirmar' — nunca misturado com o confirmado.",
          },
          {
            tipo: "callout",
            variante: "atencao",
            titulo: "O guarda-corpo:",
            conteudo:
              "A separação confirmado × a confirmar é o que torna o relatório utilizável. Sem ela, um número inventado no meio contamina a confiança no todo.",
          },
        ],
      },
      {
        tipo: "passo",
        n: 3,
        titulo: "Síntese com veredito",
        blocos: [
          {
            tipo: "prompt",
            rotulo: "Fechar o relatório",
            conteudo:
              "Consolida os achados das frentes num relatório: resposta em uma linha no topo; os 3 fatos que mais sustentam; os 3 maiores riscos; o que ficou sem confirmar. Uma página. Quem lê decide em 5 minutos.",
          },
        ],
      },
    ],
    publicadoEm: "2026-07-24",
    verificadoEm: "2026-07-31",
    destaque: false,
    relacionados: ["m13", "m06"],
  },
];
