#!/usr/bin/env python3
# Inventário COMPLETO do espaço `root` no ClickUp (API v2): hierarquia, statuses
# por lista, campos personalizados (definições com ids/opções/cores), tags do
# espaço, membros, views, todas as tarefas (com valores dos campos) e comentários.
# Uso: python3 tools/clickup-inventario.py [dir_saida]   (default: ./clickup-inventario)
# Credencial: CLICKUP_API_TOKEN do ambiente, do .env do repo ou de
# ~/.config/root/clickup.env — o que existir primeiro. Só LÊ o ClickUp.
import json, os, sys, time, urllib.request, urllib.parse

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = {}
for caminho in (os.path.join(RAIZ, ".env"),
                os.path.expanduser("~/.config/root/clickup.env")):
    if not os.path.isfile(caminho):
        continue
    with open(caminho) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                ENV.setdefault(k.strip(), v.strip().strip("\"'"))

ENV = {**ENV, **{k: v for k, v in os.environ.items() if k.startswith("CLICKUP_")}}
TOKEN = ENV.get("CLICKUP_API_TOKEN")
if not TOKEN:
    sys.exit("CLICKUP_API_TOKEN não encontrado (ambiente, .env do repo ou ~/.config/root/clickup.env)")
SPACE = ENV.get("CLICKUP_SPACE_ID", "901313864063")
OUT = sys.argv[1] if len(sys.argv) > 1 else "clickup-inventario"
os.makedirs(OUT, exist_ok=True)

def api(path, params=None):
    url = "https://api.clickup.com/api/v2" + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": TOKEN})
    for tentativa in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:  # rate limit: 100 req/min no plano free
                time.sleep(15 * (tentativa + 1)); continue
            sys.stderr.write(f"HTTP {e.code} em {path}\n")
            return {"_error": e.code, "_path": path}
        except Exception as e:
            sys.stderr.write(f"ERRO {path}: {e}\n"); time.sleep(3)
    return {"_error": "esgotou", "_path": path}

def save(nome, dados):
    with open(os.path.join(OUT, nome), "w") as f:
        json.dump(dados, f, ensure_ascii=False, indent=1)
    print(f"[ok] {nome}")

save("teams.json", api("/team"))
save("space.json", api(f"/space/{SPACE}"))          # features ligadas no espaço
save("space_tags.json", api(f"/space/{SPACE}/tag"))
folders = api(f"/space/{SPACE}/folder", {"archived": "false"})
save("folders.json", folders)
folderless = api(f"/space/{SPACE}/list", {"archived": "false"})
save("folderless_lists.json", folderless)
save("space_views.json", api(f"/space/{SPACE}/view"))

lists = []
for fo in folders.get("folders", []):
    for li in fo.get("lists", []):
        lists.append({"id": li["id"], "name": li["name"], "folder": fo["name"]})
for li in folderless.get("lists", []):
    lists.append({"id": li["id"], "name": li["name"], "folder": None})
save("_lists_index.json", lists)

for li in lists:
    lid = li["id"]
    save(f"list_{lid}_detail.json", api(f"/list/{lid}"))       # statuses da lista
    save(f"list_{lid}_fields.json", api(f"/list/{lid}/field")) # custom fields (definições)
    save(f"list_{lid}_members.json", api(f"/list/{lid}/member"))
    save(f"list_{lid}_views.json", api(f"/list/{lid}/view"))
    tasks, page = [], 0
    while True:
        chunk = api(f"/list/{lid}/task", {
            "archived": "false", "include_closed": "true",
            "subtasks": "true", "page": str(page),
        })
        got = chunk.get("tasks", [])
        tasks.extend(got)
        if chunk.get("last_page") or not got or len(got) < 100 or page > 20:
            break
        page += 1
    save(f"list_{lid}_tasks.json", {"count": len(tasks), "tasks": tasks})
    # comentários de cada tarefa da lista (é aqui que mora a conversa da equipe)
    for t in tasks:
        c = api(f"/task/{t['id']}/comment")
        if c.get("comments"):
            save(f"comments_{t['id']}.json", c)

print("FIM — inventário em", OUT)
