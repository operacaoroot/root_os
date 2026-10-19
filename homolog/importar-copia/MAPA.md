# Contrato dos mapas da cópia (19/10/2026)

Os classificadores escrevem `homolog/copia/mapa-crm.json` e `homolog/copia/mapa-gestao.json`
(fora do git: têm nome de cliente). O importador (`importar.mjs`) lê os dois e não decide nada
que o mapa já decidiu. Este arquivo é só o formato; nenhum dado de cliente mora aqui.

```jsonc
{
  "geradoEm": "2026-10-19T16:40:00-03:00",
  "fonte": "mapa-crm" | "mapa-gestao",
  // Clientes que este mapa conhece. A mesma chave pode aparecer nos dois mapas
  // (o importador junta por chave; CNPJ igual com chave diferente é erro).
  "clientes": [
    {
      "chave": "cli:<slug do nome normalizado>",   // "cli:root-interno" = o cliente da casa
      "nome": "Nome do cliente como vai ao Partner",
      "cnpj": "14 dígitos" | null,                  // só se estiver escrito no staging
      "origemId": "<WorkTask.id do cartão cadastro>" | null,
      "motivo": "curto: de onde veio (cartão cadastro, conteúdo da tarefa X, ...)"
    }
  ],
  "tarefas": [
    {
      "origemId": "<WorkTask.id da produção>",
      "listaOrigem": "nome da lista de origem",
      "paiOrigemId": "<WorkTask.id do pai>" | null,  // subtarefa: o importador cria depois do pai
      "destino": {
        "tipo": "tarefa" | "lead" | "cliente" | "fora",
        // tarefa: pasta/lista/etapa do NOSSO modelo
        "pasta": "Administrativa" | "Gestão" | "Clientes",
        "lista": "Execução" | "Onboarding de cliente" | "Esteira de clientes" | "<lista nova dentro da pasta, ex.: Administrativo, Financeiro, Comercial, Operação interna>",
        "etapa": "nome exato de uma etapa da lista de destino",
        // lead: etapa do Funil vivo (ComercialEtapa do shared/comercial.ts)
        "etapaFunil": "novo_lead|qualificacao|reuniao_agendada|sessao|diagnostico|proposta|follow_up|contrato|fechado|desqualificado|geladeira|perdido|parceiro"
        // cliente: o cartão é o próprio cliente (lista cadastro); vira Partner, sem tarefa
        // fora: não copia (teste, marketing, vazio); motivo obrigatório
      },
      "cliente": "cli:..." | null,     // obrigatório em tarefa e lead (T4); null só em cliente/fora
      "etapaOrigem": "nome do status de origem",
      "concluida": true | false,       // status de origem do tipo closed/done
      "motivo": "curto"
    }
  ]
}
```

Etapas das listas de destino que já existem:

- Clientes / Execução: A fazer · Em andamento · Concluída
- Clientes / Onboarding de cliente: Fechado no comercial · Kickoff marcado · Kit montado · Contexto carregado · Imersão · Operação assistida · Encerrado
- Clientes / Esteira de clientes: Qualificação · Diagnóstico · Contrato · Onboarding · Implantação · Operação · Encerrado

Lista nova (Administrativa/Gestão) nasce com as etapas padrão: A fazer · Em andamento · Concluída.
