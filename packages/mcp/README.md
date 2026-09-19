# @mktos/mcp — servidor MCP do ROOT OS

O modo padrão expõe somente memória autorizada por PAT individual de agente. Toda tool chama a
API do ROOT OS; o agente passa por escopo, grants exatos por fonte/campo, RLS e auditoria. Não há
fallback para JWT, login de usuário ou acesso direto ao banco.

## Catálogo

O modo padrão (`MCP_MODE=memoria`) anuncia apenas `memoria_buscar` e `memoria_ler`, ambas somente
leitura. O catálogo legado de 35 tools só é carregado com `MCP_MODE=legacy`, de forma explícita,
para compatibilidade. Nesse modo a conta de serviço é usada apenas no catálogo legado; `search_knowledge`
e `get_note` recusam-se e não abrem bypass para a vault.

## Rodar e testar

Em produção, use uma URL HTTPS e um PAT individual emitido no painel `/contexto`:

```bash
pnpm --filter @mktos/mcp build
pnpm --filter @mktos/mcp smoke:e2c
```

O smoke é determinístico: sobe mock loopback, usa PAT/fixtures sintéticos, valida catálogo,
401, redirect sem encaminhar bearer, timeout antes dos headers e com headers/corpo pendente,
retry legado limitado e timeout de login legado. Não importa `main.js` nem lê credenciais do host.

## Variáveis

| Variável | Default | Observação |
|---|---|---|
| `MCP_MODE` | `memoria` | `legacy` é opt-in explícito |
| `MCP_API_URL` | — | HTTPS obrigatório; HTTP somente localhost com `NODE_ENV=test/development` ou `MCP_ALLOW_INSECURE_LOCAL=1` |
| `MCP_AGENT_TOKEN` | — | PAT individual, nunca versionar |
| `MCP_TIMEOUT_MS` | `10000` | 100–60000 ms; cobre headers e corpo |
| `MCP_SERVICE_EMAIL` | `mcp@marketing-os.local` | somente `MCP_MODE=legacy` |
| `MCP_SERVICE_PASSWORD` | — | somente `MCP_MODE=legacy` |

No desenvolvimento local, HTTP em `http://127.0.0.1` exige o toggle explícito
`MCP_ALLOW_INSECURE_LOCAL=1`. Grants exatos e atuais continuam necessários; emitir token nunca
concede uma fonte automaticamente. Ver `.env.example`.

## Configuração de cliente MCP

Exemplo para Claude Desktop, usando placeholder e mantendo o PAT fora do repositório:

```json
{
  "mcpServers": {
    "root-os": {
      "command": "node",
      "args": ["/caminho/para/o/repositorio/packages/mcp/dist/index.js"],
      "env": {
        "MCP_MODE": "memoria",
        "MCP_API_URL": "https://homolog.example/api",
        "MCP_AGENT_TOKEN": "<PAT_INDIVIDUAL>"
      }
    }
  }
}
```

Para Claude Code, use o comando real do cliente com os mesmos valores locais:

```bash
claude mcp add root-os \
  --scope local \
  -e MCP_MODE=memoria \
  -e MCP_API_URL=https://homolog.example/api \
  -e MCP_AGENT_TOKEN="$MCP_AGENT_TOKEN" \
  -- node /caminho/para/o/repositorio/packages/mcp/dist/index.js
```

`claude mcp add --help` confirma `--scope local`; não use `--scope project` para evitar versionar
PAT em configuração compartilhada. O comando apenas configura a ponte: não substitui o aceite
humano de grants nem prova conexão com homologação.

O arquivo local do cliente pode guardar o valor em texto claro; mantenha-o fora do repositório e
rotacione o PAT pelo painel. Este pacote não faz chamadas a provedores externos.
