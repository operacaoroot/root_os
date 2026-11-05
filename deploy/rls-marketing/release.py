"""Publicação controlada da API. O lock só coordena processos que o utilizam.

Manifests privados registram evidências fornecidas pelo operador; não são assinaturas
criptográficas. Executar na VPS somente após ensaio e revisão da cadeia Compose.
"""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
import pathlib
import re
import secrets
import subprocess as sp
import tempfile
from urllib.parse import urlparse, urlunparse, quote

LOCK = '/run/lock/root-os-publish.lock'
BASE_KEYS = ('image', 'compose', 'workdir', 'container', 'started', 'runtime_sha256', 'compose_sha256')
OWNER_ENV = ('DB_PASSWORD', 'DB_USER', 'DB_APP_USER', 'DB_APP_PASSWORD', 'PLATFORM_DATABASE_URL', 'OWNER_DATABASE_URL', 'DIRECT_DATABASE_URL')


def conferir_base(atual, esperada):
    if any(k not in atual or k not in esperada or atual[k] != esperada[k] for k in BASE_KEYS):
        raise RuntimeError('Produção avançou: reconciliar a release antes de publicar.')


def ambiente_restrito(env, password):
    e = dict(env)
    u = urlparse(e['DATABASE_URL'])
    if not u.hostname or not password:
        raise RuntimeError('URL ou senha de aplicação inválida.')
    authority = 'mktos_app:' + quote(password, safe='') + '@' + u.hostname + ((':' + str(u.port)) if u.port else '')
    e['DATABASE_URL'] = urlunparse(u._replace(netloc=authority))
    e['APP_DATABASE_URL'] = e['DATABASE_URL']
    e['TENANT_MODO'] = 'impor'
    for key in OWNER_ENV:
        e[key] = ''
    return e


def conferir_runtime(env):
    if env.get('TENANT_MODO') != 'impor':
        raise RuntimeError('Runtime exige impor.')
    a, b = (env.get(k, '') for k in ('DATABASE_URL', 'APP_DATABASE_URL'))
    if not a or a != b or urlparse(a).username != 'mktos_app' or not urlparse(a).hostname:
        raise RuntimeError('Runtime exige uma única URL de mktos_app para o mesmo banco.')
    if any(env.get(k) for k in OWNER_ENV):
        raise RuntimeError('Credencial dona no runtime.')
    for k, value in env.items():
        if value and ('DATABASE_URL' in k or k in ('DIRECT_URL', 'SHADOW_DATABASE_URL')) and k not in ('DATABASE_URL', 'APP_DATABASE_URL'):
            raise RuntimeError('URL adicional de banco no runtime exige revisão.')


def conferir_owner(env):
    base = env.get('DATABASE_URL', '')
    if not base or (env.get('APP_DATABASE_URL') and env['APP_DATABASE_URL'] != base):
        raise RuntimeError('A conexão efetiva da API difere da URL usada na migration.')
    if env.get('DB_APP_USER') or env.get('DB_APP_PASSWORD'):
        raise RuntimeError('A API já tem uma conexão restrita; reconcilie antes da primeira virada.')


def escapar_compose(env):
    return {k: v.replace('$', '$$') for k, v in env.items()}


def criar_overlay(pasta, image_id, env):
    # Arquivo permanece na cadeia do container; nunca substituir nem apagar.
    with tempfile.NamedTemporaryFile(mode='w', dir=pasta, prefix='runtime-restricted-', suffix='.json', delete=False) as f:
        caminho = pathlib.Path(f.name)
        json.dump({'services': {'api': {'image': image_id, 'command': ['node', 'dist/main.js'], 'environment': escapar_compose(env)}}}, f)
    caminho.chmod(0o400)
    return caminho


def validar_evidencias(manifesto, pasta):
    arquivos = manifesto.get('evidence_files', {})
    if not isinstance(arquivos, dict) or not arquivos:
        raise RuntimeError('Evidências ausentes ou inválidas.')
    for nome, esperado in arquivos.items():
        if not isinstance(nome, str) or pathlib.Path(nome).name != nome or not isinstance(esperado, str):
            raise RuntimeError('Evidência fora da rodada ou hash inválido.')
        arquivo = pasta / nome
        if arquivo.is_symlink() or not arquivo.is_file() or not arquivo.stat().st_size or sha(arquivo) != esperado:
            raise RuntimeError('Evidência ausente, vazia ou alterada.')


def validar_manifesto(manifesto, release_id, image_id, codigos, checks):
    if not isinstance(manifesto, dict) or manifesto.get('status') != 'passed' or manifesto.get('release_id') != release_id or manifesto.get('image_id') != image_id:
        raise RuntimeError('Manifesto não corresponde à rodada e imagem ensaiadas.')
    exits, resultados = manifesto.get('exit_codes'), manifesto.get('checks')
    if not isinstance(exits, dict) or any(type(exits.get(k)) is not int or exits[k] != 0 for k in codigos):
        raise RuntimeError('Ensaio sem todos os códigos de sucesso.')
    if not isinstance(resultados, dict) or any(resultados.get(k) is not True for k in checks):
        raise RuntimeError('Ensaio sem todas as verificações obrigatórias.')


def validar_homolog(manifesto, release_id, image_id):
    validar_manifesto(manifesto, release_id, image_id, ('boot', 'tests'), ('restricted_role', 'authenticated_http', 'rls_verified'))


def validar_restore(manifesto, release_id, image_id, backup_sha256):
    validar_manifesto(manifesto, release_id, image_id, ('restore', 'migrate', 'checks'), ('restore_completed', 'migrations_applied', 'integrity_verified'))
    if manifesto.get('backup_sha256') != backup_sha256:
        raise RuntimeError('O backup não corresponde ao restaurado e validado.')


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def conferir_pasta_privada(p):
    if p.is_symlink() or not p.is_dir():
        raise RuntimeError('A rodada exige diretório privado real.')
    s = p.stat()
    if s.st_uid != os.geteuid() or s.st_mode & 0o077:
        raise RuntimeError('O diretório da rodada deve pertencer ao operador e ter permissão 0700.')


def out(args):
    return sp.check_output(args, text=True)


def run(args, **kwargs):
    return sp.run(args, check=True, **kwargs)


def processo_de_publicacao(linha):
    return bool(re.search(r'(?:^|[\s/])publicar[^/\s]*\.sh(?:\s|$)', linha) or
                re.search(r'(?:^|[\s/])(?:docker\s+compose|docker-compose)\s+.*\bup\b', linha))


def conferir_publicadores():
    for linha in out(['ps', '-eo', 'pid=,args=']).splitlines():
        if processo_de_publicacao(linha):
            raise RuntimeError('Há outro processo de publicação ativo; aguarde e reconcilie.')


def inspect(container):
    return json.loads(out(['docker', 'inspect', container]))[0]


def atual():
    d = inspect('mktos_api')
    labels = d['Config']['Labels']
    files = labels['com.docker.compose.project.config_files']
    workdir = labels['com.docker.compose.project.working_dir']
    hashes = {}
    for name in files.split(','):
        path = pathlib.Path(name)
        if not path.is_absolute():
            path = pathlib.Path(workdir) / path
        hashes[name] = sha(path)
    runtime = {k: d.get(k) for k in ('Config', 'HostConfig', 'Mounts')}
    fingerprint = hashlib.sha256(json.dumps(runtime, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return {'image': d['Image'], 'compose': files, 'workdir': workdir, 'container': d['Id'],
            'started': d['State']['StartedAt'], 'runtime_sha256': fingerprint, 'compose_sha256': hashes, 'inspect': d}


def snapshot(meta):
    return {k: meta[k] for k in BASE_KEYS}


def compose(meta, overlay=None):
    args = ['docker', 'compose', '-p', 'root_marketing-os']
    for f in meta['compose'].split(','):
        args += ['-f', f]
    return args + (['-f', str(overlay)] if overlay else [])


def rede_do_banco(api, db, url):
    u = urlparse(url)
    db_env = dict(x.split('=', 1) for x in db['Config']['Env'] if '=' in x)
    if u.scheme not in ('postgres', 'postgresql') or u.path != '/marketing_os' or u.username != db_env.get('POSTGRES_USER', 'mkt'):
        raise RuntimeError('A URL de migration não identifica o banco dono esperado.')
    if db_env.get('POSTGRES_DB', 'marketing_os') != 'marketing_os' or u.username == 'mktos_app':
        raise RuntimeError('Banco ou papel da migration divergente.')
    redes_api = api['NetworkSettings']['Networks']
    redes_db = db['NetworkSettings']['Networks']
    for rede in sorted(set(redes_api) & set(redes_db)):
        aliases = set(redes_db[rede].get('Aliases') or []) | {db['Name'].lstrip('/')}
        if u.hostname in aliases:
            return rede
    raise RuntimeError('Host do banco não é alias do container em rede comum.')


def comprovar_cluster():
    # A consulta da API usa o ambiente já instalado no container; não imprime URL.
    js = "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.$queryRawUnsafe(\"select (pg_control_system()).system_identifier::text as id,current_database() as db,current_user as usuario\").then(x=>{process.stdout.write(JSON.stringify(x[0]));return p.$disconnect()}).catch(()=>{process.exitCode=1;return p.$disconnect()})"
    api = json.loads(out(['docker', 'exec', '-w', '/app/apps/api', 'mktos_api', 'node', '-e', js]))
    query = "SELECT json_build_object('id',(pg_control_system()).system_identifier::text,'db',current_database(),'usuario',current_user)::text"
    db = json.loads(out(['docker', 'exec', 'mktos_db', 'psql', '-U', 'mkt', '-d', 'marketing_os', '-X', '-A', '-t', '-c', query]).strip())
    if api != db or api.get('db') != 'marketing_os' or api.get('usuario') != 'mkt' or not re.fullmatch(r'\d+', str(api.get('id', ''))):
        raise RuntimeError('API e backup não apontam ao mesmo cluster/banco proprietário.')
    return api['id']


def conferir_config(meta, overlay, env, image_id):
    def config(extra=None):
        resultado = sp.run(compose(meta, extra) + ['config', '--format', 'json'], cwd=meta['workdir'], capture_output=True, text=True, check=True)
        return json.loads(resultado.stdout)
    anterior, novo = config(), config(overlay)
    a, b = anterior['services']['api'], novo['services']['api']
    # `compose config` serializa dólares como `$$`, para nova interpolação segura.
    if b.get('image') != image_id or b.get('command') != ['node', 'dist/main.js'] or b.get('environment') != escapar_compose(env):
        raise RuntimeError('Configuração efetiva difere do ambiente ou imagem esperados.')
    for servico in (a, b):
        for chave in ('image', 'command', 'environment'):
            servico.pop(chave, None)
    if anterior != novo:
        raise RuntimeError('Overlay modificaria outras partes da cadeia Compose.')


@contextlib.contextmanager
def lock_publicacao():
    fd = os.open(LOCK, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(fd)


def publicar(p, image, expected, rollback=False, apply=False):
    if rollback and apply:
        raise RuntimeError('Escolha aplicar ou rollback.')
    os.umask(0o077)
    p = pathlib.Path(p)
    p.mkdir(mode=0o700, parents=True, exist_ok=True)
    conferir_pasta_privada(p)
    with lock_publicacao():
        conferir_publicadores()
        meta = atual()
        conferir_base(meta, json.loads(pathlib.Path(expected).read_text()))
        image_id = out(['docker', 'image', 'inspect', image, '--format', '{{.Id}}']).strip()
        env = dict(x.split('=', 1) for x in meta['inspect']['Config']['Env'])
        db = inspect('mktos_db')
        if not rollback and not apply:
            conferir_owner(env)
            rede_do_banco(meta['inspect'], db, env['DATABASE_URL'])
            cluster_id = comprovar_cluster()
            backup = p / 'pre-publish.dump'
            if backup.exists():
                raise RuntimeError('Backup já existe: use outra rodada.')
            with backup.open('xb') as f:
                run(['docker', 'exec', 'mktos_db', 'pg_dump', '-U', 'mkt', '-d', 'marketing_os', '-Fc'], stdout=f)
            if backup.stat().st_size < 1024:
                raise RuntimeError('Dump inválido.')
            (p / 'pre-publish-meta.json').write_text(json.dumps({**snapshot(meta), 'cluster_id': cluster_id, 'backup_sha256': sha(backup)}))
            print('Backup gerado. Restaure e valide o dump antes de aplicar a virada.')
            return
        proof = json.loads((p / 'homolog-approved.json').read_text())
        validar_homolog(proof, p.name, image_id)
        validar_evidencias(proof, p)
        if rollback:
            conferir_runtime(env)
            overlay = criar_overlay(p, image_id, env)
        else:
            conferir_owner(env)
            backup = p / 'pre-publish.dump'
            prep = json.loads((p / 'pre-publish-meta.json').read_text())
            conferir_base(meta, prep)
            rede = rede_do_banco(meta['inspect'], db, env['DATABASE_URL'])
            if comprovar_cluster() != prep.get('cluster_id') or sha(backup) != prep.get('backup_sha256'):
                raise RuntimeError('Cluster ou backup divergente da preparação.')
            restore = json.loads((p / 'restore-approved.json').read_text())
            validar_restore(restore, p.name, image_id, sha(backup))
            validar_evidencias(restore, p)
            password_path = p / 'prod-app-password'
            if not password_path.exists():
                password_path.write_text(secrets.token_hex(32))
            if password_path.is_symlink() or password_path.stat().st_uid != os.geteuid() or password_path.stat().st_mode & 0o077:
                raise RuntimeError('Arquivo de senha da aplicação não é privado.')
            password = password_path.read_text().strip()
            if not re.fullmatch(r'[0-9a-f]{64}', password):
                raise RuntimeError('Senha de aplicação inválida.')
            env_restrito = ambiente_restrito(env, password)
            conferir_runtime(env_restrito)
            overlay = criar_overlay(p, image_id, env_restrito)
            conferir_config(meta, overlay, env_restrito, image_id)
            conferir_publicadores()
            conferir_base(atual(), meta)
            migration_env = None
            try:
                with tempfile.NamedTemporaryFile(mode='w', dir=p, prefix='migration-', suffix='.private.env', delete=False) as f:
                    migration_env = pathlib.Path(f.name)
                    f.write('DATABASE_URL=' + env['DATABASE_URL'] + '\n')
                with (p / 'migration.log').open('w') as log:
                    run(['docker', 'run', '--rm', '--network', rede, '--env-file', str(migration_env), image_id,
                         'pnpm', 'exec', 'prisma', 'migrate', 'deploy'], stdout=log, stderr=log)
            finally:
                if migration_env:
                    migration_env.unlink(missing_ok=True)
            run(['docker', 'exec', '-i', 'mktos_db', 'psql', '-U', 'mkt', '-d', 'marketing_os', '-X', '-v', 'ON_ERROR_STOP=1'],
                input=("ALTER ROLE mktos_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '" + password + "';").encode(), stdout=sp.DEVNULL)
            env = env_restrito
        conferir_config(meta, overlay, env, image_id)
        conferir_publicadores()
        conferir_base(atual(), meta)
        with (p / 'compose-up.log').open('w') as log:
            run(compose(meta, overlay) + ['up', '-d', '--no-deps', 'api'], cwd=meta['workdir'], stdout=log, stderr=log)
        novo = atual()
        actual_env = dict(x.split('=', 1) for x in novo['inspect']['Config']['Env'])
        conferir_runtime(actual_env)
        if novo['image'] != image_id or actual_env != env or not novo['inspect']['State']['Running']:
            raise RuntimeError('Container recriado não corresponde à imagem ou ao ambiente ensaiado.')
        if novo['inspect'].get('Mounts') != meta['inspect'].get('Mounts') or novo['inspect'].get('HostConfig') != meta['inspect'].get('HostConfig'):
            raise RuntimeError('Montagens ou configuração do container divergiram após recriação.')
        print('API recriada; verificar saúde e HTTP autenticado antes de aceitar.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('release_dir')
    parser.add_argument('--image')
    parser.add_argument('--expected')
    parser.add_argument('--snapshot', action='store_true')
    parser.add_argument('--rollback', action='store_true')
    parser.add_argument('--apply', action='store_true')
    a = parser.parse_args()
    if a.snapshot:
        if a.image or a.expected or a.apply or a.rollback:
            parser.error('--snapshot não aceita outras opções')
        with lock_publicacao():
            print(json.dumps(snapshot(atual())))
    else:
        if not a.image or not a.expected:
            parser.error('--image e --expected são obrigatórios')
        publicar(a.release_dir, a.image, a.expected, a.rollback, a.apply)
