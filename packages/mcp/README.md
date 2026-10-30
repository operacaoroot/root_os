# @mktos/mcp — servidor MCP do ROOT OS

Servidor **MCP (Model Context Protocol)** que expõe ferramentas padronizadas para qualquer IA
(Claude Desktop, Claude Code, ou qualquer cliente MCP) consultar o ROOT OS **com segurança**.

## Princípios (ver `docs/MCP_TOOLS.md` e `docs/ISOLATION.md`)
- A IA **nunca** toca o banco direto. Toda tool chama a **API** do ROOT OS.
- Autentica com uma **conta de serviço só-leitura** (`ia_servico`) → passa por **RBAC + auditoria**.
- **Todas as tools são `read_only`** (menor privilégio). O cliente (`src/client.ts`) exporta uma
  única função de acesso, `apiGet`, e o único `POST` que ele faz é o login da conta de serviço:
  não existe caminho de escrita neste pacote.
- A escrita entra pelo **Tool Gateway** (ADR-004), com a régua R0–R5 de `packages/policy` —
  nunca por um caminho paralelo aqui dentro. Desde 30/10/2026 ela existe só no **modo catálogo**
  (abaixo), e só pela rota de execução do agente, que passa pela porta.
- Toda resposta inclui o campo `source` da API → a IA **cita a fonte** e não inventa.

## Ferramentas

São **35**, todas `read_only`. O catálogo completo (nome, endpoint, permissão exigida e argumentos)
vive em **`docs/MCP_TOOLS.md`** — é lá que se olha, e não aqui, para não haver duas listas
divergindo. Este README já trouxe uma tabela de 10 ferramentas por bastante tempo depois de o
servidor ter 35.

O número é contável a partir do código, e o código é que manda:

```bash
grep -c 'registerTool(' packages/mcp/src/server.ts
```

## Modo catálogo (`MCP_MODO=catalogo`, 30/10/2026)

O modo de sempre (as 35 acima, `MCP_MODO=leitura`, o padrão) fica intacto. O modo catálogo serve
a um **agente externo** (a Rootinha, no Hermes Agent): as ferramentas são as capacidades que o
agente do token declarou, geradas no arranque de `GET /agents/:slug/catalogo-externo` — nome = id da
capacidade, esquema = o `argsSchema` que a porta valida. R0 com rota GET sai pela rota de sempre;
o resto, por `POST /agents/:slug/capacidades/:id/executar` (a porta devolve executado, aguardando
aprovação ou recusado). Mais `<slug>_definicao` (ferramenta e recurso `rootos://agentes/<slug>/definicao`):
missão, procedimento e voz. A origem do pedido (mensagem de WhatsApp, quem pediu, texto de terceiro)
vai no `_meta` da chamada, em `root/origem`, e não nos argumentos.

| Variável | Observação |
|---|---|
| `MCP_MODO` | `catalogo` |
| `MCP_CORPO_TOKEN` | o token do corpo (`rcx.<empresa>.<segredo>`), criado em `POST /agents/:slug/corpos` por quem tem `admin.usuarios`; não usa a conta de serviço |
| `MCP_AGENTE` | o slug do agente (padrão `rootinha`) |

Prova: `pnpm --filter @mktos/mcp build && node packages/mcp/test/catalogo.mjs`.

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

Gere a senha (`openssl rand -base64 24`), ponha no `.env` e, **só em desenvolvimento**, rode
`pnpm db:seed` para alinhar a conta — **nunca em produção**: o seed não é idempotente e apaga dados
do org, então rodá-lo lá destrói dado real. **Rotacionar a senha em produção** (por vazamento ou por
prazo) exige um script próprio, que **ainda não existe**: até ele existir, a troca é manual e a
combinar com quem cuida do banco. Ver `.env.example`.

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
