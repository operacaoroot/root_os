"""
A tela 06 de ponta a ponta pela própria tela (lane C): sobe a ata fictícia da
Alicerce num lead de teste da jornada (o primeiro "Construtora Alicerce Homolog"
em E3), espera o leitor de ata, aprova o diagnóstico, gera a proposta e
fotografa o estado "aguardando aprovação" que leva a /atendimento.

Uso:  python homolog/e2e/sessao-lane-c.py   (WEB e API como no telas-lane-c.py)
Mexe só em lead de teste da jornada; nunca nas oito empresas da semente.
"""
import json
import sys

from playwright.sync_api import sync_playwright

from telas_comum import PROVAS, RAIZ, WEB, get, login


def main() -> None:
    token, user = login()
    funil = get('/comercial/funil', token)
    alvo = next(
        (c for col in funil['colunas'] for c in col['cartoes']
         if c['etapa'] in ('reuniao_agendada', 'sessao', 'diagnostico', 'proposta') and (c.get('empresa') or '').startswith('Construtora Alicerce Homolog')),
        None,
    )
    if not alvo:
        raise SystemExit('nenhum lead de teste da jornada em E3/E4; rode a jornada antes')
    lead = alvo['leadId']
    print('lead de teste:', alvo['empresa'], lead)
    # Também serve a quem já passou por aqui: lead em E5/E6 com a proposta na porta.
    with sync_playwright() as p:
        nav = p.chromium.launch()
        ctx = nav.new_context(viewport={'width': 1440, 'height': 900})
        ctx.add_init_script(
            f"localStorage.setItem('mktos_token', {json.dumps(token)});"
            f"localStorage.setItem('mktos_user', {json.dumps(json.dumps(user))});"
            "localStorage.setItem('root-os:tema', 'dark');"
        )
        pg = ctx.new_page()
        pg.goto(f'{WEB}/comercial/lead/{lead}/sessao', wait_until='networkidle', timeout=120_000)
        pg.wait_for_selector('#root-os-main')
        if pg.get_by_role('button', name='aprovar diagnóstico').count() == 0 and pg.get_by_text('Ainda não há diagnóstico').count():
            pg.set_input_files('input[type=file]', str(RAIZ / 'homolog' / 'fixtures' / 'ata-alicerce.md'))
            pg.get_by_role('button', name='subir ata').click()
            pg.get_by_text('Ata recebida').wait_for(timeout=30_000)
        if pg.get_by_text('aguardando aprovação', exact=True).count() == 0:
            pg.get_by_role('button', name='aprovar diagnóstico').wait_for(timeout=90_000)
            pg.screenshot(path=str(PROVAS / 'tela-06c-sessao-diagnostico-montado-escuro.png'), full_page=True)
            # Aprovar o diagnóstico solta o construtor sozinho (reação): a proposta vai à porta sem outro toque.
            pg.get_by_role('button', name='aprovar diagnóstico').click()
        pg.get_by_text('aguardando aprovação', exact=True).first.wait_for(timeout=60_000)
        pg.wait_for_timeout(800)
        pg.screenshot(path=str(PROVAS / 'tela-06d-sessao-aguardando-aprovacao-escuro.png'), full_page=True)
        print('ok: aguardando aprovação com link para /atendimento')
        nav.close()


if __name__ == '__main__':
    sys.exit(main())
