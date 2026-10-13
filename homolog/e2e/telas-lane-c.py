"""
Screenshots das telas internas do cockpit (lane C) contra um `next dev` nativo.

Uso:  python -I homolog/e2e/telas-lane-c.py [WEB=http://127.0.0.1:3020] [API=http://127.0.0.1:4010] [filtro]

Entra pela API com o admin da semente (a senha é lida de homolog/.env.homolog em
tempo de execução e nunca escrita em lugar nenhum), põe a sessão no
localStorage como o login da tela faria e fotografa cada tela nos temas escuro
e claro, e no celular (390 px). Grava em homolog/provas/tela-NN-<nome>-<tema>.png.
"""
import json
import sys

from playwright.sync_api import sync_playwright

from telas_comum import PROVAS, RAIZ, WEB, get, login

FILTRO = sys.argv[1] if len(sys.argv) > 1 else ''


def main() -> None:
    token, user = login()

    funil = get('/comercial/funil', token)
    cartoes = [c for col in funil['colunas'] for c in col['cartoes']]
    alicerce = next((c['leadId'] for c in cartoes if c.get('empresa') == 'Construtora Alicerce'), cartoes[0]['leadId'])
    contratos = get('/comercial/contratos', token)
    fechado = contratos[0]['leadId'] if contratos else alicerce

    telas = [
        ('03', 'fila', '/comercial'),
        ('04', 'funil', '/comercial/funil'),
        ('05', 'fio', f'/comercial/lead/{alicerce}'),
        ('06', 'sessao', f'/comercial/lead/{fechado}/sessao'),
        ('06b', 'sessao-alicerce', f'/comercial/lead/{alicerce}/sessao'),
        ('10', 'fechamento', f'/comercial/lead/{fechado}/fechamento'),
        ('11a', 'contratos', '/comercial/contratos'),
        ('11', 'contrato', f'/comercial/contratos/{fechado}'),
        ('12', 'torre', '/comercial/torre'),
        ('13', 'relatorio', '/comercial/relatorio'),
    ]
    PROVAS.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        nav = p.chromium.launch()
        for tema, largura, sufixo in (('dark', 1440, 'escuro'), ('light', 1440, 'claro'), ('dark', 390, 'celular')):
            ctx = nav.new_context(viewport={'width': largura, 'height': 900}, device_scale_factor=1)
            ctx.add_init_script(
                f"localStorage.setItem('mktos_token', {json.dumps(token)});"
                f"localStorage.setItem('mktos_user', {json.dumps(json.dumps(user))});"
                f"localStorage.setItem('root-os:tema', '{tema}');"
            )
            pagina = ctx.new_page()
            for num, nome, caminho in telas:
                if FILTRO and FILTRO not in nome:
                    continue
                pagina.goto(f'{WEB}{caminho}', wait_until='networkidle', timeout=120_000)
                pagina.wait_for_selector('#root-os-main', timeout=60_000)
                pagina.wait_for_timeout(1200)
                if pagina.get_by_text('Runtime Error').count():
                    raise SystemExit(f'{caminho}: o next dev mostrou erro de execução; nada foi fotografado')
                arquivo = PROVAS / f'tela-{num}-{nome}-{sufixo}.png'
                pagina.screenshot(path=str(arquivo), full_page=True)
                print(arquivo.relative_to(RAIZ))
                if nome == 'funil':
                    # Tenta arrastar o cartão da Alicerce: a tela recusa e diz o motivo com o portão.
                    cartao = pagina.locator('[draggable=true]', has_text='Construtora Alicerce').filter(has_text='Marina Duarte').first
                    cartao.dispatch_event('dragstart')
                    pagina.get_by_text('não muda de etapa por arraste').first.wait_for(timeout=15_000)
                    pagina.wait_for_timeout(800)
                    arquivo = PROVAS / f'tela-{num}b-funil-arraste-bloqueado-{sufixo}.png'
                    pagina.screenshot(path=str(arquivo), full_page=False)
                    print(arquivo.relative_to(RAIZ))
            ctx.close()
        nav.close()


if __name__ == '__main__':
    main()
