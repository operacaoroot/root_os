/*
 * A LOGO DO ROOT OS no topo do menu (rodada da interface, 20/10/2026, U1).
 *
 * A peça é a logo oficial do pacote de marca, nunca redigitada em fonte: os
 * caminhos abaixo saem de `public/marca/ROOT-logo-principal-TRANSPARENTE.svg`,
 * separados em duas partes da MESMA palavra. O "R" (o primeiro glifo, nas três
 * camadas) e o resto ("OOT"). A palavra pequena "OPERAÇÃO" da logo principal
 * fica de fora: no tamanho do menu ela teria uns 4 px de altura e não se lê.
 *
 * As duas formas são a mesma peça com a mesma escala. Aberta, a palavra inteira.
 * Recolhida, a moldura encolhe até a largura do R e o resto apaga: o R não sai do
 * lugar, então a transição não pula. A forma recolhida só vale de 820 px para
 * cima, como o menu recolhido (no celular a gaveta abre sempre inteira).
 *
 * As cores vêm do tema, não do arquivo:
 * - a camada verde é `currentColor` (quem usa põe `text-brand`, o `--os-ac` de
 *   cada tema, que no escuro é o #9bdb1f da marca);
 * - as camadas do glitch (magenta à direita, ciano à esquerda) usam `--os-mag` e
 *   `--os-cy`, e seguem o `--os-logo-shadow` de cada tema: no escuro as duas, no
 *   contraste ("claro", `mono`) só a magenta, no papel (`light`) nenhuma.
 *
 * O SVG é decorativo (`aria-hidden`): o nome acessível fica no link que o envolve.
 */

// Coordenadas finais do desenho (depois do transform do arquivo de origem).
const ESQUERDA = 841;
const TOPO = 656;
const ALTURA_DO_DESENHO = 460;
const LARGURA_DA_PALAVRA = 1555;
const LARGURA_DO_R = 439;

/** Altura da logo no menu, em px (a ata pede de 28 a 32). */
export const ALTURA_DA_LOGO = 30;
export const LARGURA_DA_LOGO_ABERTA = Math.round((LARGURA_DA_PALAVRA * ALTURA_DA_LOGO) / ALTURA_DO_DESENHO);
export const LARGURA_DA_LOGO_RECOLHIDA = Math.round((LARGURA_DO_R * ALTURA_DA_LOGO) / ALTURA_DO_DESENHO);
// As classes de largura abaixo (h-[30px], w-[101px], min-[820px]:w-[29px]) são
// estes três números escritos à mão, porque o Tailwind só gera classe literal.
// O teste do componente confere que continuam batendo.

const CAMADAS_DO_R = {
  magenta: 'M11665 9310 c483 -55 782 -265 891 -625 24 -80 27 -106 27 -240 1 -178 -18 -283 -89 -487 -100 -288 -232 -502 -448 -726 -211 -219 -452 -385 -692 -477 -61 -24 -70 -31 -67 -49 2 -11 61 -411 132 -888 70 -477 130 -870 133 -873 3 -3 34 -5 70 -3 l64 3 -88 595 c-48 327 -107 729 -131 892 l-44 298 36 11 c74 23 281 131 377 195 363 244 639 591 782 980 138 376 143 680 16 924 -147 282 -486 454 -934 474 -107 5 -109 4 -35 -4z M10455 7973 c-104 -312 -191 -573 -193 -580 -3 -10 14 -13 65 -13 l68 0 193 573 c106 314 192 575 192 580 0 4 -30 7 -67 7 l-68 0 -190 -567z M9996 6581 c-3 -5 -129 -376 -280 -825 l-275 -817 71 3 70 3 274 814 c151 448 274 818 274 823 0 11 -127 10 -134 -1z',
  ciano: 'M9186 7143 c-401 -1198 -731 -2184 -734 -2190 -3 -9 10 -13 45 -13 l50 0 731 2183 c403 1201 732 2186 732 2190 0 4 -21 7 -48 7 l-47 0 -729 -2177z M11224 8524 c302 -60 389 -312 231 -669 -98 -224 -316 -402 -555 -454 -68 -16 -77 -19 -45 -20 84 -2 226 37 332 89 214 107 358 293 424 549 57 219 -2 386 -163 465 -58 28 -184 56 -253 55 -34 -1 -29 -3 29 -15z M10320 6573 c0 -10 45 -380 98 -823 l98 -805 51 -3 c48 -3 50 -2 47 20 -7 40 -194 1600 -194 1614 0 10 -14 14 -50 14 -41 0 -50 -3 -50 -17z',
  verde: 'M9286 7142 c-401 -1197 -731 -2183 -734 -2189 -3 -10 89 -13 441 -13 l445 0 76 223 c42 122 167 494 279 827 l204 605 209 -4 c115 -2 210 -4 211 -5 0 0 44 -361 97 -801 53 -440 99 -810 101 -822 l5 -23 460 0 c450 0 460 0 460 20 0 17 -242 1675 -254 1740 -4 24 1 28 87 64 369 153 720 454 936 804 192 308 304 716 271 979 -56 446 -385 710 -950 762 -69 7 -414 11 -865 11 l-750 0 -729 -2178z m2012 1388 c298 -49 401 -255 292 -583 -47 -139 -101 -228 -205 -333 -78 -79 -103 -97 -195 -143 -161 -79 -219 -88 -607 -94 -230 -3 -323 -1 -323 7 0 6 86 269 192 584 l192 572 295 0 c163 0 324 -5 359 -10z',
} as const;

const CAMADAS_DO_RESTO = {
  magenta: 'M15320 9360 c359 -57 601 -210 720 -455 94 -194 110 -430 45 -685 -47 -185 -702 -2127 -755 -2237 -118 -247 -269 -446 -474 -623 -296 -254 -653 -412 -1051 -464 -129 -16 -74 -21 76 -6 718 73 1320 496 1604 1126 64 143 729 2144 755 2273 46 230 16 491 -74 645 -144 247 -380 383 -744 431 -62 8 -136 15 -165 14 -43 -1 -31 -4 63 -19z M18875 9369 c301 -37 555 -163 691 -342 155 -205 198 -495 119 -807 -47 -185 -702 -2127 -755 -2237 -189 -396 -492 -701 -895 -899 -205 -100 -437 -166 -680 -193 l-90 -10 125 4 c605 21 1189 340 1533 840 143 207 164 262 546 1407 221 666 358 1091 371 1157 46 230 16 491 -74 645 -43 73 -113 160 -162 201 -171 141 -417 225 -699 239 -108 5 -109 5 -30 -5z M23645 8908 c-77 -226 -141 -415 -143 -420 -2 -4 28 -8 67 -8 39 0 71 1 71 3 0 1 63 187 140 411 77 225 140 413 140 417 0 5 -30 9 -67 9 l-68 0 -140 -412z M14655 8590 c-158 -23 -275 -80 -380 -185 -156 -155 -142 -122 -599 -1492 -276 -828 -291 -883 -276 -994 22 -160 130 -237 355 -253 l80 -6 -60 18 c-120 37 -178 80 -213 162 -28 64 -35 135 -21 215 14 79 651 1996 697 2098 104 228 271 373 489 426 78 19 78 19 28 19 -27 0 -73 -4 -100 -8z M18255 8590 c-250 -37 -431 -177 -550 -425 -32 -67 -659 -1926 -691 -2050 -23 -86 -21 -211 3 -266 53 -119 147 -169 338 -183 l80 -6 -60 18 c-120 37 -178 80 -213 162 -28 64 -35 135 -21 215 14 79 651 1996 697 2098 104 228 271 373 489 426 78 19 78 19 28 19 -27 0 -73 -4 -100 -8z M22327 8288 c-137 -406 -1117 -3342 -1117 -3345 0 -2 31 -3 69 -3 l69 0 590 1770 590 1770 -68 0 -68 0 -65 -192z',
  ciano: 'M14823 9373 c15 -2 37 -2 50 0 12 2 0 4 -28 4 -27 0 -38 -2 -22 -4z M18428 9373 c12 -2 32 -2 45 0 12 2 2 4 -23 4 -25 0 -35 -2 -22 -4z M14665 9363 c-16 -2 -86 -15 -154 -29 -663 -135 -1191 -585 -1430 -1216 -71 -189 -680 -2032 -696 -2108 -22 -105 -31 -334 -16 -423 47 -274 209 -482 467 -597 121 -55 295 -94 459 -103 94 -6 89 -4 -35 14 -410 58 -686 274 -777 609 -25 92 -25 370 0 490 10 47 173 551 363 1121 376 1129 397 1184 542 1400 103 153 250 314 387 424 258 207 572 345 930 409 63 11 70 14 35 14 -25 -1 -58 -3 -75 -5z M18205 9354 c-328 -51 -673 -202 -930 -409 -259 -208 -471 -503 -594 -827 -71 -189 -680 -2032 -696 -2108 -22 -105 -31 -334 -16 -423 55 -322 271 -553 605 -647 102 -28 213 -47 321 -53 94 -6 89 -4 -35 14 -341 48 -595 208 -714 451 -70 143 -81 194 -81 393 0 125 5 192 18 255 10 47 173 551 363 1121 376 1129 397 1184 542 1400 103 153 250 314 387 424 258 207 572 345 930 409 65 12 72 14 35 14 -25 0 -85 -6 -135 -14z M20425 8908 c-77 -226 -141 -415 -143 -420 -2 -4 19 -8 46 -8 l50 0 26 73 c49 136 256 751 256 759 0 4 -21 8 -47 8 l-48 0 -140 -412z M14880 8575 c163 -54 228 -167 201 -346 -14 -95 -651 -2009 -710 -2135 -105 -223 -260 -358 -470 -409 l-56 -13 44 -1 c25 -1 74 6 110 15 208 52 360 180 461 389 57 117 690 1997 716 2127 10 48 14 101 11 130 -7 59 -40 134 -74 170 -40 41 -136 80 -212 84 l-66 4 45 -15z M18480 8575 c163 -54 228 -167 201 -346 -8 -52 -122 -408 -342 -1066 -345 -1033 -382 -1130 -473 -1245 -86 -108 -229 -200 -362 -232 l-59 -14 45 -1 c25 0 73 6 106 14 204 48 363 181 464 390 57 117 690 1997 716 2127 10 48 14 101 11 130 -7 59 -40 134 -74 170 -40 41 -136 80 -212 84 l-66 4 45 -15z M21385 8468 c-14 -37 -1175 -3520 -1175 -3524 0 -2 21 -4 48 -4 l47 0 592 1770 592 1770 -50 0 c-31 0 -51 -5 -54 -12z',
  verde: 'M14820 9369 c-47 -5 -141 -20 -210 -35 -664 -137 -1191 -585 -1429 -1216 -70 -187 -680 -2031 -696 -2108 -22 -102 -31 -342 -16 -422 64 -340 274 -559 624 -652 160 -43 232 -51 442 -51 214 1 332 15 516 61 442 110 828 368 1097 732 72 97 158 247 203 352 17 41 188 541 379 1110 380 1134 390 1169 390 1382 0 251 -73 433 -236 587 -82 78 -175 135 -294 180 -198 76 -498 107 -770 80z m85 -779 c88 -13 189 -62 228 -111 15 -20 35 -63 44 -95 30 -117 30 -118 -332 -1203 -200 -601 -351 -1037 -378 -1095 -120 -254 -303 -386 -573 -417 -117 -13 -214 -5 -304 24 -50 16 -77 33 -117 73 -75 75 -97 173 -69 310 20 102 666 2024 707 2106 65 131 181 264 279 321 143 83 326 113 515 87z M18420 9369 c-47 -5 -141 -20 -210 -35 -665 -138 -1190 -585 -1429 -1216 -70 -186 -679 -2031 -696 -2108 -9 -41 -19 -142 -22 -225 -4 -129 -2 -164 16 -245 67 -303 284 -516 614 -604 158 -42 232 -51 427 -50 536 1 963 155 1343 484 209 180 385 418 488 660 17 41 188 541 379 1110 380 1134 390 1169 390 1382 0 237 -65 412 -209 561 -119 124 -266 203 -469 252 -171 42 -413 55 -622 34z m85 -779 c88 -13 189 -62 228 -111 15 -20 35 -63 44 -95 30 -117 30 -118 -332 -1203 -202 -607 -351 -1037 -379 -1096 -62 -131 -126 -214 -221 -285 -127 -94 -249 -131 -440 -134 -113 -1 -140 2 -205 23 -167 55 -236 191 -196 387 21 103 666 2025 707 2106 91 181 219 306 376 367 119 47 271 61 418 41z M20523 8900 l-142 -420 554 0 553 0 -589 -1767 c-324 -972 -589 -1769 -589 -1770 0 -2 202 -3 448 -3 l448 0 591 1768 591 1767 555 3 555 2 18 53 c9 28 73 214 141 412 67 198 123 363 123 367 0 5 -701 8 -1557 8 l-1558 0 -142 -420z',
} as const;
const TRANSFORM_DA_ORIGEM = 'translate(0 1600) scale(0.1 -0.1)';

// O glitch some ou fica conforme o tema, pelo atributo que o Sidebar põe no <html>.
const SOME_NO_PAPEL = "[[data-os-theme='light']_&]:hidden";
const SOME_NO_CONTRASTE = "[[data-os-theme='mono']_&]:hidden";

function Camadas({ d }: { d: { magenta: string; ciano: string; verde: string } }) {
  return (
    <>
      <path data-camada="magenta" className={SOME_NO_PAPEL} style={{ fill: 'rgb(var(--os-mag))' }} fillRule="evenodd" d={d.magenta} />
      <path data-camada="ciano" className={`${SOME_NO_PAPEL} ${SOME_NO_CONTRASTE}`} style={{ fill: 'rgb(var(--os-cy))' }} fillRule="evenodd" d={d.ciano} />
      <path data-camada="verde" fill="currentColor" fillRule="evenodd" d={d.verde} />
    </>
  );
}

export function LogoRoot({ recolhida = false, className = '' }: { recolhida?: boolean; className?: string }) {
  return (
    <span
      data-logo-root
      data-forma={recolhida ? 'recolhida' : 'aberta'}
      aria-hidden
      className={`block h-[30px] w-[101px] shrink-0 overflow-hidden transition-[width] duration-200 motion-reduce:transition-none ${recolhida ? 'min-[820px]:w-[29px]' : ''} ${className}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`${ESQUERDA} ${TOPO} ${LARGURA_DA_PALAVRA} ${ALTURA_DO_DESENHO}`}
        width={LARGURA_DA_LOGO_ABERTA}
        height={ALTURA_DA_LOGO}
        focusable="false"
        className="block max-w-none"
      >
        <g transform={TRANSFORM_DA_ORIGEM}>
          <g data-parte="r">
            <Camadas d={CAMADAS_DO_R} />
          </g>
          <g data-parte="resto" className={`transition-opacity duration-200 motion-reduce:transition-none ${recolhida ? 'min-[820px]:opacity-0' : ''}`}>
            <Camadas d={CAMADAS_DO_RESTO} />
          </g>
        </g>
      </svg>
    </span>
  );
}
