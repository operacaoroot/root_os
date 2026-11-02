# @mktos/mcp — servidor MCP do ROOT OS

Servidor **MCP (Model Context Protocol)** que expõe ferramentas padronizadas para qualquer IA
(Claude Desktop, Claude Code, ou qualquer cliente MCP) consultar o ROOT OS **com segurança**.

## Princípios (ver `docs/MCP_TOOLS.md` e `docs/ISOLATION.md`)
- A IA **nunca** toca o banco direto. Toda tool chama a **API** do ROOT OS.
- **Duas identidades** (desde 02/11/2026). A **conta de serviço só-leitura** (`ia_servico`) responde pelas
  35 ferramentas de consulta, como sempre. O **operador** (uma PESSOA do OS, com e-mail e senha) responde
  pelas 7 ferramentas marcadas `[operador]`: a bancada da área do cliente e as duas escritas dela
  (`area_rascunho`, `area_publicar`). As rotas dessas escritas recusam conta de máquina (`SoGenteGuard`),
  então elas só existem em nome de gente, e tudo o que a pessoa faria na tela vale igual aqui: RBAC,
  auditoria e, no publicar, a **porta** (R3: cai em Aprovações e outra pessoa libera). Não há caminho
  paralelo: o cliente (`src/client.ts`) só fala com a API.
- Sem `MCP_OPERADOR_EMAIL`/`MCP_OPERADOR_SENHA`, as ferramentas `[operador]` recusam com a frase do que
  configurar; as 35 de consulta seguem funcionando.
- Toda resposta inclui o campo `source` da API → a IA **cita a fonte** e não inventa.

## Ferramentas

São **42**: 35 `read_only` pela conta de serviço e 7 `[operador]` (5 de leitura, 2 de escrita). O catálogo completo (nome, endpoint, permissão exigida e argumentos)
vive em **`docs/MCP_TOOLS.md`** — é lá que se olha, e não aqui, para não haver duas listas
divergindo. Este README já trouxe uma tabela de 10 ferramentas por bastante tempo depois de o
servidor ter 35.

O número é contável a partir do código, e o código é que manda:

```bash
grep -c 'registerTool(' packages/mcp/src/server.ts
```

## Rodar
```bash
# 1) API do ROOT OS precisa estar no ar (http://localhost:4001) com o seed aplicado
# 2) build
pnpm --filter @mktos/mcp build
# 3) teste end-to-end (sobe o server, lista e chama tools)
pnpm --filter @mktos/mcp smoke
```

## Variáveis

| Variável | Default | Observação |
|---|---|---|
| `MCP_API_URL` | `http://localhost:4001/api` | |
| `MCP_SERVICE_EMAIL` | `mcp@marketing-os.local` | conta de serviço só-leitura |
| `MCP_SERVICE_PASSWORD` | — | **obrigatória, sem default no código**: o processo não sobe sem ela |
| `MCP_OPERADOR_EMAIL` | — | e-mail de uma PESSOA do OS; liga as ferramentas `[operador]` |
| `MCP_OPERADOR_SENHA` | — | a senha dessa pessoa no OS (login por e-mail e senha, a saída de emergência da tela de login) |
| `MCP_ENV_FILE` | `~/.config/root/mcp.env` | arquivo `CHAVE=valor` lido no arranque; variável já no ambiente vence o arquivo; só os NOMES das chaves vão ao stderr |

Gere a senha (`openssl rand -base64 24`), ponha no `.env` e, **só em desenvolvimento**, rode
`pnpm db:seed` para alinhar a conta — **nunca em produção**: o seed não é idempotente e apaga dados
do org, então rodá-lo lá destrói dado real. **Rotacionar a senha em produção** (por vazamento ou por
prazo) exige um script próprio, que **ainda não existe**: até ele existir, a troca é manual e a
combinar com quem cuida do banco. Ver `.env.example`.

## Chamar uma ferramenta pela linha de comando
```bash
pnpm --filter @mktos/mcp chamar listar
pnpm --filter @mktos/mcp chamar quem_sou
pnpm --filter @mktos/mcp chamar area_bancada '{"lead_id":"<id>"}'
```
Fala com o servidor pelo mesmo protocolo que o Claude (stdio), usando o `dist/` se existir.

## Plugar no **Claude Desktop**
Edite `~/Library/Application Support/Claude/claude_desktop_config.json`, trocando o caminho pelo
do seu clone e a senha pela da sua conta de serviço:
```json
{
  "mcpServers": {
    "root-os": {
      "command": "node",
      "args": ["/caminho/para/o/repositorio/packages/mcp/dist/index.js"],
      "env": {
        "MCP_API_URL": "http://localhost:4001/api",
        "MCP_SERVICE_EMAIL": "mcp@marketing-os.local",
        "MCP_SERVICE_PASSWORD": "<SENHA_DA_CONTA_DE_SERVICO>"
      }
    }
  }
}
```
Reinicie o Claude Desktop. Pergunte: *"Use o root-os: o que aconteceu hoje?"*

## Plugar no **Claude Code**
```bash
claude mcp add root-os \
  -e MCP_API_URL=http://localhost:4001/api \
  -e MCP_SERVICE_EMAIL=mcp@marketing-os.local \
  -e MCP_SERVICE_PASSWORD="$MCP_SERVICE_PASSWORD" \
  -- node /caminho/para/o/repositorio/packages/mcp/dist/index.js
```

> ⚠️ **Senha nenhuma entra neste arquivo, nem em qualquer arquivo versionado.** No Claude Code,
> prefira exportar `MCP_SERVICE_PASSWORD` no shell (como acima) a digitar o valor na linha de
> comando, que fica no histórico. O `claude_desktop_config.json` guarda o valor em texto claro no
> seu disco — é config local, mantenha fora do repositório.
>
> Em produção, senha forte para a conta de serviço e rede restrita.
> Este MCP é **exclusivo do ROOT OS (root)** — não tem qualquer relação com o MCP do escritório.
