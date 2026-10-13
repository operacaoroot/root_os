"""Peças comuns dos roteiros de screenshot da lane C: endereços, sessão do admin e leitura da API."""
import json
import os
import pathlib
import urllib.request

RAIZ = pathlib.Path(__file__).resolve().parents[2]
PROVAS = RAIZ / 'homolog' / 'provas'
WEB = os.environ.get('WEB', 'http://127.0.0.1:3020')
API = os.environ.get('API', 'http://127.0.0.1:4010')


def senha() -> str:
    """A ADMIN_PASSWORD da homologação, lida em tempo de execução e nunca escrita em lugar nenhum."""
    for linha in (RAIZ / 'homolog' / '.env.homolog').read_text(encoding='utf-8').splitlines():
        if linha.startswith('ADMIN_PASSWORD='):
            return linha.split('=', 1)[1].strip().strip('"')
    raise SystemExit('ADMIN_PASSWORD ausente em homolog/.env.homolog')


def post(caminho: str, corpo: dict, token: str | None = None) -> dict:
    req = urllib.request.Request(f'{API}/api{caminho}', data=json.dumps(corpo).encode(), method='POST')
    req.add_header('Content-Type', 'application/json')
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def get(caminho: str, token: str):
    req = urllib.request.Request(f'{API}/api{caminho}')
    req.add_header('Authorization', f'Bearer {token}')
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def login() -> tuple[str, dict]:
    r = post('/auth/login', {'email': 'admin@marketing-os.local', 'password': senha()})
    return r.get('token') or r.get('accessToken'), r['user']
