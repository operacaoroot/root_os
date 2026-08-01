import type { Material } from "@/central/types";

/* Categorias "Começando" e "Claude Code" — conteúdo original da Root Central. */

export const materiaisComecando: Material[] = [
  {
    id: "m01",
    slug: "instale-o-claude-code",
    codigo: "PRIMEIRO",
    aliases: ["instalar", "instalacao", "claude code", "comecar", "setup inicial"],
    card: "Instale o Claude Code em 10 minutos",
    tagline:
      "Do download ao primeiro comando rodando no seu computador. Sem precisar saber programar.",
    titulo: "Instale o Claude Code e rode seu primeiro comando",
    resumo:
      "O caminho mais curto pra ter o Claude Code funcionando na sua máquina: instalar, entrar na conta e dar a primeira ordem. Termina com você operando, não assistindo.",
    categoriaId: "comecando",
    tipo: "tutorial",
    nivel: "iniciante",
    custo: "freemium",
    ferramentas: ["Claude Code"],
    plataformas: ["macOS", "Windows", "Linux"],
    tags: ["instalacao", "terminal", "primeiro-passo"],
    resolve: [
      "nunca usei o claude code e não sei por onde começar",
      "não sei programar e quero usar ia no computador",
      "como instalar o claude no meu pc",
    ],
    minutosEstimados: 10,
    blocos: [
      {
        tipo: "callout",
        variante: "info",
        titulo: "O que é o Claude Code:",
        conteudo:
          "Um assistente de IA que roda no seu computador e executa tarefas de verdade: cria arquivos, organiza pastas, escreve e roda código. Você fala em português, ele opera.",
      },
      {
        tipo: "passo",
        n: 1,
        titulo: "Baixe e instale",
        sub: "Site oficial, versão pro seu sistema",
        blocos: [
          {
            tipo: "link",
            label: "Página oficial do Claude Code",
            selo: "Tier free disponível",
            href: "https://claude.com/claude-code",
          },
          {
            tipo: "lista",
            estilo: "letras",
            itens: [
              "Entre no site oficial e siga a instrução de instalação do seu sistema (Mac, Windows ou Linux).",
              "Se aparecer opção de app de desktop e de terminal, escolha a que te deixar mais confortável — as duas fazem a mesma coisa.",
              "Abra depois de instalar e entre com a sua conta Claude (crie uma grátis se não tiver).",
            ],
          },
        ],
      },
      {
        tipo: "passo",
        n: 2,
        titulo: "Rode o primeiro comando",
        sub: "Uma ordem simples pra sentir o controle",
        blocos: [
          {
            tipo: "prompt",
            rotulo: "Primeira ordem — copie e cole",
            conteudo:
              "Cria uma pasta chamada operacao-root na minha área de trabalho com um arquivo LEIA-ME.md dentro explicando, em 3 linhas, o que você consegue fazer por mim.",
          },
          {
            tipo: "callout",
            variante: "nota",
            titulo: "O que observar:",
            conteudo:
              "Ele vai pedir permissão antes de mexer em qualquer arquivo. Isso é o comportamento certo — você aprova o que entra e o que sai.",
          },
        ],
      },
      {
        tipo: "passo",
        n: 3,
        titulo: "Aponte pra uma pasta sua",
        sub: "O Claude trabalha melhor dentro de um projeto",
        blocos: [
          {
            tipo: "texto",
            conteudo:
              "Abra o Claude Code dentro de uma pasta que importa pra você — trabalho, estudos, um projeto parado. A partir daí, toda conversa acontece com contexto real.",
          },
          {
            tipo: "prompt",
            rotulo: "Teste com contexto",
            conteudo:
              "Olha os arquivos desta pasta e me diz: o que tem aqui, o que parece bagunçado e o que você faria primeiro pra organizar. Não mude nada ainda — só o diagnóstico.",
          },
        ],
      },
      {
        tipo: "callout",
        variante: "atencao",
        titulo: "Não pule etapa:",
        conteudo:
          "Antes de dar acesso a pastas com documento sensível, leia o material SEGURO desta central. Permissão é poder — configure antes de acelerar.",
      },
    ],
    publicadoEm: "2026-07-05",
    verificadoEm: "2026-07-28",
    destaque: true,
    relacionados: ["m03", "m04", "m09"],
  },
  {
    id: "m02",
    slug: "mapa-de-quem-esta-comecando",
    codigo: "MAPA",
    aliases: ["mapa", "roteiro", "por onde comecar", "guia inicial"],
    card: "O mapa de quem tá começando com IA",
    tagline:
      "A ordem certa das peças: o que aprender primeiro, o que ignorar e onde cada material desta central se encaixa.",
    titulo: "O mapa: a ordem certa pra aprender IA operando",
    resumo:
      "Um checklist de rota pra quem está começando: a sequência que evita retrabalho, os desvios que fazem perder semana e o próximo passo concreto a partir de onde você está.",
    categoriaId: "comecando",
    tipo: "checklist",
    nivel: "iniciante",
    custo: "gratuito",
    ferramentas: ["Claude Code"],
    plataformas: ["qualquer"],
    tags: ["roteiro", "aprendizado", "fundamentos"],
    resolve: [
      "estou perdido com tanta ferramenta de ia",
      "por onde eu começo a estudar ia",
      "qual a ordem certa pra aprender isso tudo",
    ],
    minutosEstimados: 8,
    blocos: [
      {
        tipo: "texto",
        conteudo:
          "Quem começa por ferramenta da moda troca de ferramenta toda semana e não sai do lugar. Quem começa por fundamento monta uma base que serve pra qualquer ferramenta. Este mapa é a segunda rota.",
      },
      {
        tipo: "lista",
        estilo: "numeros",
        itens: [
          "Instale um assistente que executa (não só conversa) e rode a primeira ordem — material PRIMEIRO.",
          "Perca o medo do terminal: 6 comandos bastam — material TERMINAL.",
          "Dê contexto permanente ao assistente com um arquivo de projeto — material CLAUDEMD.",
          "Configure permissões antes de acelerar — material SEGURO.",
          "Monte a memória de verdade, fora do chat — material VAULT.",
          "Só depois disso: agentes, automação e integração. Nessa ordem.",
        ],
      },
      {
        tipo: "callout",
        variante: "nota",
        titulo: "O que ignorar por enquanto:",
        conteudo:
          "Comparativo de modelo, benchmark, thread de lançamento. Nada disso muda o seu primeiro mês. Ferramenta se troca em minutos; fundamento fica.",
      },
      {
        tipo: "callout",
        variante: "info",
        titulo: "Como saber que você avançou:",
        conteudo:
          "Não é certificado. É ter uma tarefa real do seu trabalho — uma que você fazia na mão — rodando com IA do começo ao fim.",
      },
    ],
    publicadoEm: "2026-07-08",
    verificadoEm: "2026-07-25",
    destaque: true,
    relacionados: ["m01", "m03", "m26"],
  },
  {
    id: "m03",
    slug: "perca-o-medo-do-terminal",
    codigo: "TERMINAL",
    aliases: ["terminal", "linha de comando", "shell", "medo do terminal"],
    card: "Perca o medo do terminal",
    tagline:
      "Os 6 comandos que cobrem 90% do que você precisa pra operar com IA — explicados pra quem nunca abriu a tela preta.",
    titulo: "Terminal sem medo: os 6 comandos de quem opera",
    resumo:
      "A tela preta assusta menos do que parece. Aqui você aprende só o necessário pra acompanhar o que a IA faz na sua máquina: navegar, olhar, criar e desfazer.",
    categoriaId: "comecando",
    tipo: "tutorial",
    nivel: "iniciante",
    custo: "gratuito",
    ferramentas: ["Terminal"],
    plataformas: ["macOS", "Windows", "Linux"],
    tags: ["terminal", "fundamentos", "comandos"],
    resolve: [
      "tenho medo de digitar comando errado e quebrar tudo",
      "não entendo o que a ia está fazendo no terminal",
      "o que significa cd ls mkdir",
    ],
    minutosEstimados: 15,
    blocos: [
      {
        tipo: "callout",
        variante: "info",
        titulo: "Por que aprender isso:",
        conteudo:
          "A IA opera no terminal. Você não precisa dominar — precisa ler o que ela está fazendo e conferir. Seis comandos dão essa leitura.",
      },
      {
        tipo: "passo",
        n: 1,
        titulo: "Onde estou e o que tem aqui",
        blocos: [
          { tipo: "comando", linguagem: "bash", conteudo: "pwd" },
          {
            tipo: "texto",
            conteudo: "Mostra a pasta em que você está. É o seu 'você está aqui' do mapa.",
          },
          { tipo: "comando", linguagem: "bash", conteudo: "ls" },
          {
            tipo: "texto",
            conteudo: "Lista o que existe na pasta. Rode sem medo: só olha, não muda nada.",
          },
        ],
      },
      {
        tipo: "passo",
        n: 2,
        titulo: "Andar entre pastas",
        blocos: [
          { tipo: "comando", linguagem: "bash", conteudo: "cd Documentos" },
          {
            tipo: "texto",
            conteudo:
              "Entra na pasta Documentos. Pra voltar um nível: cd .. (com espaço antes dos dois pontos finais).",
          },
        ],
      },
      {
        tipo: "passo",
        n: 3,
        titulo: "Criar e espiar",
        blocos: [
          {
            tipo: "comando",
            linguagem: "bash",
            conteudo: "mkdir teste-root",
            aviso: "Cria uma pasta nova na pasta atual.",
          },
          { tipo: "comando", linguagem: "bash", conteudo: "cat LEIA-ME.md" },
          {
            tipo: "texto",
            conteudo: "cat mostra o conteúdo de um arquivo de texto na tela. Só leitura.",
          },
        ],
      },
      {
        tipo: "callout",
        variante: "atencao",
        titulo: "A regra de ouro:",
        conteudo:
          "Comando que você não entende, você pergunta antes de rodar. Cole no assistente: 'o que este comando faz e qual o risco?'. Quem opera confere; quem assiste cola às cegas.",
      },
    ],
    publicadoEm: "2026-04-20",
    destaque: false,
    relacionados: ["m01", "m09"],
  },
  {
    id: "m04",
    slug: "claude-md-contexto-permanente",
    codigo: "CLAUDEMD",
    aliases: ["claude.md", "claudemd", "contexto do projeto", "arquivo de contexto"],
    card: "CLAUDE.md: contexto que não se perde",
    tagline:
      "Um arquivo na raiz do projeto e o assistente para de esquecer como o seu trabalho funciona.",
    titulo: "CLAUDE.md: o arquivo que dá contexto permanente ao projeto",
    resumo:
      "Toda sessão nova começa do zero — a menos que o projeto tenha um CLAUDE.md. Aqui você monta o seu: o que escrever, o que deixar de fora e o erro que todo mundo comete.",
    categoriaId: "claude-code",
    tipo: "tutorial",
    nivel: "iniciante",
    custo: "gratuito",
    ferramentas: ["Claude Code"],
    plataformas: ["qualquer"],
    tags: ["contexto", "configuracao", "claude-md"],
    resolve: [
      "toda conversa nova eu tenho que explicar tudo de novo",
      "a ia esquece as regras do meu projeto",
      "como fazer o claude lembrar das minhas preferências",
    ],
    minutosEstimados: 12,
    prerequisitos: ["Claude Code instalado (material PRIMEIRO)"],
    blocos: [
      {
        tipo: "callout",
        variante: "info",
        titulo: "Como funciona:",
        conteudo:
          "O Claude Code lê o arquivo CLAUDE.md da pasta do projeto no começo de toda sessão. O que está ali vale como instrução permanente — sem você repetir.",
      },
      {
        tipo: "passo",
        n: 1,
        titulo: "Peça pro próprio assistente criar",
        blocos: [
          {
            tipo: "prompt",
            rotulo: "Gerar o CLAUDE.md do projeto",
            conteudo:
              "Analisa esta pasta e cria um CLAUDE.md com: (1) o que é este projeto em 2 linhas; (2) como as pastas se organizam; (3) as convenções que você percebeu no que já existe; (4) o que NUNCA fazer aqui sem me perguntar. Curto e direto — máximo 40 linhas.",
          },
        ],
      },
      {
        tipo: "passo",
        n: 2,
        titulo: "Corte o excesso",
        sub: "Arquivo de contexto não é manual",
        blocos: [
          {
            tipo: "lista",
            estilo: "marcadores",
            itens: [
              "Fica: regra que muda decisão (padrão de nome, comando de build, o que não tocar).",
              "Sai: histórico, justificativa longa, tudo que a IA descobre sozinha lendo o código.",
              "Teste prático: se apagar a linha e nada muda no comportamento, a linha sobra.",
            ],
          },
          {
            tipo: "callout",
            variante: "atencao",
            titulo: "O erro clássico:",
            conteudo:
              "CLAUDE.md gigante. Contexto demais custa token em toda sessão e enterra as regras importantes. Menos de 60 linhas é um bom teto.",
          },
        ],
      },
      {
        tipo: "passo",
        n: 3,
        titulo: "Atualize quando corrigir",
        blocos: [
          {
            tipo: "texto",
            conteudo:
              "Corrigiu o assistente duas vezes pelo mesmo motivo? Vira linha no CLAUDE.md. É assim que o projeto aprende.",
          },
          {
            tipo: "exemplo",
            contexto: "Depois de corrigir uma resposta",
            prompt: "Adiciona no CLAUDE.md: relatórios deste projeto sempre em português, valores em R$.",
            resultado: "A regra passa a valer em toda sessão futura, sem repetir.",
          },
        ],
      },
    ],
    publicadoEm: "2026-07-10",
    verificadoEm: "2026-07-26",
    destaque: true,
    relacionados: ["m10", "m11", "m05"],
  },
  {
    id: "m05",
    slug: "skills-truques-reutilizaveis",
    codigo: "SKILLS1",
    aliases: ["skill", "skills", "truques", "comandos personalizados"],
    card: "Skills: ensine o truque uma vez só",
    tagline:
      "Tarefa que você repete toda semana vira uma skill: instrução empacotada que roda com um comando.",
    titulo: "Skills: empacote o processo e rode com um comando",
    resumo:
      "Skill é um arquivo de instruções que ensina o assistente a fazer uma tarefa do seu jeito. Aqui você cria a primeira: da tarefa repetida ao comando pronto.",
    categoriaId: "claude-code",
    tipo: "skill",
    nivel: "intermediario",
    custo: "gratuito",
    ferramentas: ["Claude Code"],
    plataformas: ["qualquer"],
    tags: ["skills", "produtividade", "reuso"],
    resolve: [
      "repito o mesmo pedido pra ia toda semana",
      "como criar um comando personalizado no claude",
      "quero padronizar como a ia faz uma tarefa",
    ],
    minutosEstimados: 20,
    prerequisitos: ["CLAUDE.md básico (material CLAUDEMD)"],
    blocos: [
      {
        tipo: "callout",
        variante: "info",
        titulo: "O que é uma skill:",
        conteudo:
          "Uma pasta com um arquivo de instruções (SKILL.md) descrevendo passo a passo como executar uma tarefa. Você invoca pelo nome e o assistente segue o roteiro — sempre do mesmo jeito.",
      },
      {
        tipo: "passo",
        n: 1,
        titulo: "Escolha a tarefa certa",
        blocos: [
          {
            tipo: "lista",
            estilo: "marcadores",
            itens: [
              "Repetida: acontece toda semana, não uma vez por ano.",
              "Com padrão claro: você sabe descrever o resultado bom.",
              "Chata: relatório, resumo de reunião, formatação, conferência.",
            ],
          },
        ],
      },
      {
        tipo: "passo",
        n: 2,
        titulo: "Peça pro assistente montar a skill",
        blocos: [
          {
            tipo: "prompt",
            rotulo: "Criar a primeira skill",
            conteudo:
              "Cria uma skill chamada resumo-semanal. Quando eu invocar, você: (1) lê os arquivos que eu indicar; (2) monta um resumo de no máximo 15 linhas com decisões, pendências e próximos passos; (3) salva em resumos/AAAA-MM-DD.md. Escreve o SKILL.md com essas instruções e me mostra antes de salvar.",
          },
          {
            tipo: "callout",
            variante: "nota",
            titulo: "Onde mora:",
            conteudo:
              "Skills do projeto ficam na pasta .claude/skills/ do próprio projeto; skills pessoais, na sua pasta de usuário. A documentação oficial detalha os caminhos.",
          },
          {
            tipo: "link",
            label: "Documentação oficial de skills",
            selo: "code.claude.com",
            href: "https://code.claude.com/docs",
          },
        ],
      },
      {
        tipo: "passo",
        n: 3,
        titulo: "Rode, corrija, congele",
        blocos: [
          {
            tipo: "texto",
            conteudo:
              "Use a skill numa tarefa real. Saiu torto? Corrija o SKILL.md, não o resultado. Duas rodadas de ajuste e o processo congela no padrão que você queria.",
          },
        ],
      },
    ],
    publicadoEm: "2026-07-15",
    verificadoEm: "2026-07-29",
    destaque: false,
    relacionados: ["m04", "m06", "m07"],
  },
  {
    id: "m06",
    slug: "subagentes-trabalho-em-paralelo",
    codigo: "SUB",
    aliases: ["subagente", "subagentes", "agentes paralelos", "delegar"],
    card: "Subagentes: delegue e receba pronto",
    tagline:
      "Tarefas longas rodando em paralelo enquanto você segue trabalhando — sem encher o contexto principal.",
    titulo: "Subagentes: o primeiro passo do trabalho em paralelo",
    resumo:
      "Subagente é um assistente auxiliar que recebe uma missão, trabalha sozinho e volta com o resultado. Aqui você aprende quando delegar, como escrever a missão e como conferir a entrega.",
    categoriaId: "claude-code",
    tipo: "tutorial",
    nivel: "intermediario",
    custo: "gratuito",
    ferramentas: ["Claude Code"],
    plataformas: ["qualquer"],
    tags: ["subagentes", "paralelo", "delegacao"],
    resolve: [
      "a conversa fica gigante e a ia se perde",
      "queria que a ia fizesse várias coisas ao mesmo tempo",
      "como delegar tarefa longa sem travar o chat",
    ],
    minutosEstimados: 18,
    prerequisitos: ["Confortável com o básico do Claude Code"],
    blocos: [
      {
        tipo: "callout",
        variante: "info",
        titulo: "A ideia:",
        conteudo:
          "Em vez de uma conversa gigante fazendo tudo, o assistente principal vira coordenador: despacha missões pra subagentes e integra os resultados. Contexto limpo, trabalho em paralelo.",
      },
      {
        tipo: "passo",
        n: 1,
        titulo: "Reconheça a tarefa delegável",
        blocos: [
          {
            tipo: "lista",
            estilo: "marcadores",
            itens: [
              "Tem começo e fim claros ('varre estes arquivos e lista os problemas').",
              "Não precisa de decisão sua no meio.",
              "O resultado cabe num relatório curto.",
            ],
          },
        ],
      },
      {
        tipo: "passo",
        n: 2,
        titulo: "Escreva a missão como ordem de serviço",
        blocos: [
          {
            tipo: "prompt",
            rotulo: "Despachar um subagente",
            conteudo:
              "Manda um subagente varrer a pasta contratos/ e voltar com uma tabela: arquivo, cliente, valor citado e qualquer inconsistência de data. Enquanto isso, a gente continua aqui no relatório.",
          },
          {
            tipo: "callout",
            variante: "atencao",
            titulo: "Missão vaga, entrega vaga:",
            conteudo:
              "Subagente não pergunta no meio do caminho. Se a missão não diz o formato da entrega, você recebe surpresa. Diga o que voltar e como.",
          },
        ],
      },
      {
        tipo: "passo",
        n: 3,
        titulo: "Confira antes de usar",
        blocos: [
          {
            tipo: "texto",
            conteudo:
              "Relatório de subagente é insumo, não veredito. Peça a fonte de cada achado ('em que arquivo você viu isso?') antes de decidir em cima.",
          },
        ],
      },
    ],
    publicadoEm: "2026-07-18",
    verificadoEm: "2026-07-30",
    destaque: false,
    relacionados: ["m13", "m15", "m05"],
  },
  {
    id: "m07",
    slug: "hooks-antes-e-depois",
    codigo: "HOOKS",
    aliases: ["hook", "hooks", "gatilhos", "automatizar verificacao"],
    card: "Hooks: o robô que confere o robô",
    tagline:
      "Ações automáticas antes e depois do que a IA faz: formatar, validar, bloquear o que não pode.",
    titulo: "Hooks: automatize o antes e o depois de cada ação",
    resumo:
      "Hook é uma regra que dispara sozinha quando o assistente age — pra formatar o que ele salvou, rodar teste ou barrar comando proibido. Confiança por construção, não por fé.",
    categoriaId: "claude-code",
    tipo: "tutorial",
    nivel: "avancado",
    custo: "gratuito",
    ferramentas: ["Claude Code"],
    plataformas: ["qualquer"],
    tags: ["hooks", "guardrails", "qualidade"],
    resolve: [
      "quero garantir que a ia sempre rode os testes",
      "como impedir a ia de rodar certos comandos",
      "padronizar o que acontece depois que a ia edita",
    ],
    minutosEstimados: 25,
    prerequisitos: ["Uso diário do Claude Code", "Noção de terminal (material TERMINAL)"],
    blocos: [
      {
        tipo: "callout",
        variante: "info",
        titulo: "A diferença pra instrução:",
        conteudo:
          "Instrução no CLAUDE.md a IA pode esquecer sob pressão de contexto. Hook não é lembrete — é o sistema executando a regra, sempre. Instrução educa; hook garante.",
      },
      {
        tipo: "passo",
        n: 1,
        titulo: "Escolha o gatilho",
        blocos: [
          {
            tipo: "lista",
            estilo: "marcadores",
            itens: [
              "Depois de editar arquivo → rodar formatador ou teste.",
              "Antes de executar comando → bloquear padrões proibidos (ex.: apagar em massa).",
              "Ao terminar a sessão → registrar um resumo do que mudou.",
            ],
          },
        ],
      },
      {
        tipo: "passo",
        n: 2,
        titulo: "Peça a configuração guiada",
        blocos: [
          {
            tipo: "prompt",
            rotulo: "Configurar um hook com ajuda",
            conteudo:
              "Quero um hook que rode o formatador toda vez que você editar um arquivo neste projeto. Me mostra a configuração antes de aplicar e me explica linha por linha o que ela faz.",
          },
          {
            tipo: "link",
            label: "Documentação oficial de hooks",
            selo: "code.claude.com",
            href: "https://code.claude.com/docs",
          },
        ],
      },
      {
        tipo: "callout",
        variante: "risco",
        titulo: "Hook ruim trava tudo:",
        conteudo:
          "Um hook que falha em silêncio ou demora demais degrada toda sessão. Comece com um só, observe uma semana, depois adicione o próximo.",
      },
    ],
    publicadoEm: "2026-07-20",
    verificadoEm: "2026-07-27",
    destaque: false,
    relacionados: ["m05", "m09"],
  },
  {
    id: "m08",
    slug: "modo-plano-pense-antes",
    codigo: "PLANO",
    aliases: ["plan mode", "modo plano", "planejar", "plano antes de executar"],
    card: "Planeje antes de deixar a IA mexer",
    tagline:
      "O hábito que evita retrabalho: exigir o plano por escrito antes de qualquer mudança grande.",
    titulo: "Modo plano: aprovar a rota antes de rodar",
    resumo:
      "Mudança grande sem plano vira bagunça com etapas puladas. O fluxo aqui é simples: pedir o plano, cortar o desnecessário, aprovar e só então executar.",
    categoriaId: "claude-code",
    tipo: "tutorial",
    nivel: "iniciante",
    custo: "gratuito",
    ferramentas: ["Claude Code"],
    plataformas: ["qualquer"],
    tags: ["plano", "processo", "controle"],
    resolve: [
      "a ia sai fazendo antes de eu entender o que ela vai fazer",
      "mudanças grandes sempre dão errado no meio",
      "como revisar o que a ia pretende fazer",
    ],
    minutosEstimados: 8,
    blocos: [
      {
        tipo: "texto",
        conteudo:
          "Executor rápido sem rota aprovada é risco, não produtividade. A regra da casa: mudança que toca mais de um arquivo começa com plano por escrito.",
      },
      {
        tipo: "passo",
        n: 1,
        titulo: "Peça o plano, não a execução",
        blocos: [
          {
            tipo: "prompt",
            rotulo: "Abrir pelo plano",
            conteudo:
              "Antes de mudar qualquer coisa: me apresenta um plano numerado do que você pretende fazer, com os arquivos que serão tocados e o que pode dar errado em cada etapa. Não executa nada até eu aprovar.",
          },
          {
            tipo: "callout",
            variante: "nota",
            titulo: "No Claude Code:",
            conteudo:
              "Existe um modo de planejamento nativo que segura edições até você aprovar. Se a sua versão tiver, use — é o mesmo fluxo com cinto de segurança do sistema.",
          },
        ],
      },
      {
        tipo: "passo",
        n: 2,
        titulo: "Corte o plano pela metade",
        blocos: [
          {
            tipo: "texto",
            conteudo:
              "Plano de IA vem gordo. Pergunte: 'qual etapa dá pra tirar sem perder o resultado?'. Aprovar plano enxuto é a parte do trabalho que continua sua.",
          },
        ],
      },
      {
        tipo: "passo",
        n: 3,
        titulo: "Execute por etapa com checkpoint",
        blocos: [
          {
            tipo: "exemplo",
            contexto: "Depois de aprovar",
            prompt: "Executa só as etapas 1 e 2 e para. Me mostra o resultado antes de seguir.",
            resultado:
              "Você confere cedo, corrige barato e nunca descobre o estrago na etapa 7.",
          },
        ],
      },
    ],
    publicadoEm: "2026-07-12",
    verificadoEm: "2026-07-24",
    destaque: false,
    relacionados: ["m06", "m09"],
  },
  {
    id: "m09",
    slug: "permissoes-sem-susto",
    codigo: "SEGURO",
    aliases: ["seguranca", "permissoes", "acesso", "riscos"],
    card: "Permissões sem susto",
    tagline:
      "O checklist de segurança de quem dá poder de verdade pra IA: o que liberar, o que travar e o que nunca expor.",
    titulo: "Permissões: o checklist antes de acelerar",
    resumo:
      "Assistente que executa é poder — e poder mal configurado vira incidente. Cinco verificações que separam operação profissional de acidente esperando hora.",
    categoriaId: "claude-code",
    tipo: "checklist",
    nivel: "iniciante",
    custo: "gratuito",
    ferramentas: ["Claude Code"],
    plataformas: ["qualquer"],
    tags: ["seguranca", "permissoes", "boas-praticas"],
    resolve: [
      "tenho medo do que a ia pode fazer na minha máquina",
      "que permissões devo dar pro claude",
      "como proteger meus arquivos e senhas da ia",
    ],
    minutosEstimados: 10,
    blocos: [
      {
        tipo: "lista",
        estilo: "numeros",
        itens: [
          "Trabalhe por pasta de projeto, nunca na raiz do usuário. O assistente enxerga o que precisa, não a sua vida inteira.",
          "Segredo não entra em conversa: chave de API, senha e token ficam em arquivo de ambiente fora do projeto — e fora de qualquer prompt.",
          "Aprovação por ação nas primeiras semanas. Liberar tudo de uma vez é pressa, não confiança.",
          "Comando destrutivo (apagar, sobrescrever, enviar) exige plano aprovado antes — material PLANO.",
          "Backup antes de operação grande. Quem tem cópia opera tranquilo; quem não tem opera rezando.",
        ],
      },
      {
        tipo: "callout",
        variante: "risco",
        titulo: "O golpe mais comum:",
        conteudo:
          "Copiar comando de internet e colar sem ler. Instrução maliciosa escondida em texto é real. Regra: comando que você não entende, o assistente explica antes de rodar.",
      },
      {
        tipo: "callout",
        variante: "info",
        titulo: "Sinal de maturidade:",
        conteudo:
          "Você sabe dizer, de cabeça, o que a sua IA pode fazer sem te perguntar. Se não sabe, a configuração está mandando em você.",
      },
    ],
    publicadoEm: "2026-07-06",
    verificadoEm: "2026-07-22",
    destaque: true,
    relacionados: ["m01", "m07", "m08"],
  },
];
