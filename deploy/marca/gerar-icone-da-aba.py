"""Ícone da aba do ROOT OS no estilo Asaas (29/10/2026, escolha do Lucas).

Quadrado de cantos arredondados em verde-limão (#9BDB1F) com o R preto-base (#070A08).
O R não é redigitado: sai do logo oficial (ROOT-logo-verde-TRANSPARENTE.png), recortado
pelo componente conectado da primeira letra e repintado com a cor da paleta.
Uso: python -I gerar_icone.py <logo-verde.png> <pasta-de-saida>
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

VERDE = (0x9B, 0xDB, 0x1F, 255)
PRETO = (0x07, 0x0A, 0x08)
LADO = 1024          # desenha grande e reduz (antisserrilhado)
RAIO = 0.22          # cantos arredondados, proporção do lado
ALTURA_DO_R = 0.62   # o R ocupa 62% da altura do quadrado


def recortar_r(logo: Image.Image) -> Image.Image:
    alfa = np.array(logo.getchannel('A'))
    rotulos, _ = ndimage.label(alfa > 8)
    # O R é o componente mais à esquerda na linha do ROOT (a metade de baixo do arquivo).
    linha = rotulos[int(alfa.shape[0] * 0.60)]
    candidatos = [r for r in np.unique(linha) if r]
    fatias = ndimage.find_objects(rotulos)
    r_id = min(candidatos, key=lambda r: fatias[r - 1][1].start)
    ys, xs = fatias[r_id - 1]
    mascara = np.where(rotulos[ys, xs] == r_id, alfa[ys, xs], 0).astype(np.uint8)
    return Image.fromarray(mascara, 'L')


def montar(mascara_r: Image.Image) -> Image.Image:
    base = Image.new('RGBA', (LADO, LADO), (0, 0, 0, 0))
    ImageDraw.Draw(base).rounded_rectangle((0, 0, LADO - 1, LADO - 1), radius=int(LADO * RAIO), fill=VERDE)
    alto = int(LADO * ALTURA_DO_R)
    largo = round(mascara_r.width * alto / mascara_r.height)
    r = mascara_r.resize((largo, alto), Image.LANCZOS)
    tinta = Image.new('RGBA', r.size, PRETO + (255,))
    tinta.putalpha(r)
    # Centro pela caixa do R; o itálico pesa à direita no alto, então desloca um pouco para a esquerda.
    x = (LADO - largo) // 2 - int(LADO * 0.01)
    y = (LADO - alto) // 2
    base.alpha_composite(tinta, (x, y))
    return base


def main() -> None:
    logo = Image.open(sys.argv[1]).convert('RGBA')
    saida = Path(sys.argv[2])
    saida.mkdir(parents=True, exist_ok=True)
    icone = montar(recortar_r(logo))
    for lado, nome in [(32, 'icone-32.png'), (192, 'icone-192.png'), (512, 'icone-512.png')]:
        icone.resize((lado, lado), Image.LANCZOS).save(saida / nome, optimize=True)
    # Apple: sem transparência (o iOS pinta o fundo de preto); o próprio iOS arredonda os cantos.
    apple = Image.new('RGBA', (LADO, LADO), VERDE)
    apple.alpha_composite(icone)
    apple.convert('RGB').resize((180, 180), Image.LANCZOS).save(saida / 'apple-touch-icon.png', optimize=True)
    icone.resize((256, 256), Image.LANCZOS).save(saida / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
    # Prévia lado a lado, no tamanho real da aba e ampliado.
    previa = Image.new('RGBA', (16 + 32 + 48 + 192 + 50, 200), (0xEC, 0xE7, 0xD8, 255))
    x = 10
    for lado in (16, 32, 48, 192):
        previa.alpha_composite(icone.resize((lado, lado), Image.LANCZOS), (x, 200 - lado - 4))
        x += lado + 10
    previa.save(saida / 'previa.png')


if __name__ == '__main__':
    main()
