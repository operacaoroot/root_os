# Totem de consulta: como travar o aparelho na loja

Passo a passo para quem instala o totem. O totem é uma página do ROOT OS que
abre em tela cheia e funciona sem internet depois da primeira sincronização.
Não há aplicativo do ROOT OS para instalar.

Endereço do totem (troque pelo domínio da instância do cliente):

```
https://sragranel.operacaoroot.com/totem/quiosque
```

Use sempre `/totem/quiosque`. O endereço `/totem` também leva até lá, mas só
com internet: quem abre sem rede é `/totem/quiosque`.

## Antes de qualquer opção

1. No painel, abra **Totem › Totens**, cadastre o aparelho e gere o
   código de ativação. O código tem 8 caracteres, aparece uma vez só e vale
   por 30 minutos.
2. Ligue o aparelho na rede da loja e abra o endereço do totem.
3. Digite o código no teclado da tela. O totem baixa o catálogo e já fica
   pronto para uso.
4. Deixe a data e a hora do aparelho em automático. Sem rede, é a data do
   aparelho que decide se um lote aparece como vencido.
5. Não use aba anônima nem limpe os dados do navegador: a ativação e o
   catálogo guardado ficam ali. Se forem apagados, o totem volta para a tela
   de ativação e precisa de um código novo.

O gesto de manutenção do totem é tocar 5 vezes seguidas, em até 3 segundos,
no canto superior esquerdo da tela. Ele mostra a loja, o nome do aparelho, a
última sincronização, a versão do catálogo e o botão "Sincronizar agora".

## Opção A: sem instalar nada

Serve para começar no mesmo dia. Trava menos que as opções B e C: quem
conhece o atalho consegue sair.

**Android (tablet ou tela com Android)**

1. Abra o Chrome no endereço do totem e ative com o código.
2. Toque em **Mais** (os três pontos) › **Instalar e criar atalho** ›
   **Instalar**. Em versões mais antigas do Chrome, a opção se chama
   **Adicionar à tela inicial**. O ícone do Sr. aGranel aparece na tela
   inicial e abre o totem em tela cheia.
3. Ligue a fixação de tela: **Configurações › Segurança** (ou **Segurança e
   local**) **› Avançado › Fixação de app**. Ative também a opção de pedir o
   PIN para liberar. O nome do menu muda conforme o fabricante.
4. Abra o totem pelo ícone, deslize de baixo para cima até o meio da tela e
   segure, toque no ícone do app no alto da miniatura e escolha **Fixar**.
5. Para liberar: na navegação por gestos, deslize de baixo para cima e
   segure; com três botões, segure **Voltar** e **Visão geral** juntos. O
   aparelho pede o PIN.

**Windows**

1. Crie uma conta local só para o totem, sem senha de administrador.
2. Nessa conta, crie um atalho com este destino (o caminho do Chrome pode
   variar):

   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk "https://sragranel.operacaoroot.com/totem/quiosque" --no-first-run
   ```

3. Feche todas as janelas do Chrome antes de testar: com o Chrome aberto em
   segundo plano, o modo quiosque não abre.
4. Para abrir sozinho ao ligar, copie o atalho para a pasta de inicialização:
   tecle Windows + R, digite `shell:startup` e cole o atalho lá. Ligue a
   entrada automática da conta do totem.
5. Para sair: Alt + F4.

Use o Chrome nesta opção. O modo quiosque do Edge abre sempre numa sessão
InPrivate (fonte 2): a ativação e o catálogo somem toda vez que o Edge fecha.

## Opção B: Windows com Acesso Atribuído e Edge em modo quiosque

O Windows entra direto na conta do totem, abre só o Edge em tela cheia e
reabre o Edge se alguém fechar.

**Edições que têm o recurso:** Windows 10 ou 11 **Pro**, **Enterprise**
(e Enterprise LTSC), **Education** e **IoT Enterprise** (e IoT Enterprise
LTSC). O Windows **Home** não tem. O controle de conta de usuário (UAC)
precisa estar ligado, e a configuração é feita no próprio aparelho, não por
área de trabalho remota (fonte 1).

1. Entre como administrador e abra **Configurações › Contas › Outros
   usuários**.
2. Em **Configurar um quiosque**, toque em **Introdução** (em algumas versões,
   **Começar**).
3. Em **Criar uma conta**, dê um nome à conta do totem e toque em
   **Avançar**.
4. Em **Escolher um aplicativo de quiosque**, escolha **Microsoft Edge** e
   toque em **Avançar**.
5. Escolha **Sinalização digital/interativa**, para o site ocupar a tela
   inteira, e toque em **Avançar**.
6. Digite o endereço do totem (`.../totem/quiosque`) e feche as
   **Configurações** para aplicar.
7. Saia da conta de administrador e entre na conta do totem. Ative o totem com
   o código.

Para sair do quiosque: Ctrl + Alt + Del. Para desfazer: **Configurações ›
Contas › Outros usuários › Quiosque › Remover quiosque**.

**Atenção:** nesta opção o Edge roda em InPrivate (fonte 2). Toda vez que o
computador reinicia ou fica sem energia, o totem volta para a tela de
ativação e precisa de um código novo, com internet. Ligue o totem num
nobreak e combine com a loja quem gera o código no painel. Se isso não
servir, fique com a opção A no Windows ou use a opção C.

## Opção C: Android com FreeKiosk

FreeKiosk é um aplicativo de quiosque de código aberto, com licença MIT
(Copyright (c) 2025 Rushb), para Android 8.0 ou mais novo. O APK sai da
página **Releases** do repositório no GitHub (fonte 4). Ele reabre sozinho
quando o tablet liga.

1. Baixe o APK em `https://github.com/RushB-fr/freekiosk/releases` e instale
   no tablet.
2. Abra o FreeKiosk, toque 5 vezes no botão escondido do **canto inferior
   direito** e defina um PIN.
3. Informe o endereço do totem (`.../totem/quiosque`) e inicie o modo
   quiosque.
4. Ative o totem com o código.
5. Para travar de verdade (sem notificações e sem botão de voltar), coloque o
   FreeKiosk como proprietário do aparelho. Antes, remova todas as contas do
   tablet (Google, Samsung, Microsoft) e ligue a depuração USB. Com o tablet
   ligado num computador, rode:

   ```
   adb shell dpm set-device-owner com.freekiosk/.DeviceAdminReceiver
   ```

   A resposta esperada é `Success: Device owner set to package com.freekiosk`.

Para sair: 5 toques no canto inferior direito e o PIN. O canto superior
esquerdo continua sendo o gesto de manutenção do totem; os dois não se
atrapalham.

**Teste obrigatório antes de entregar:** com o totem ativado, desligue o
Wi-Fi, reinicie o tablet e confira se o catálogo abre. Se o totem pedir
ativação de novo, o navegador interno daquele aparelho não está guardando
dados. Nesse caso, instale o totem pelo Chrome (opção A, passo 2) e use o
FreeKiosk no modo de aplicativo externo, apontando para o ícone do totem.

## Hardware padrão de mercado

| Item | O que pedir |
|---|---|
| Tela | De 21,5" a 32", sensível ao toque (capacitiva, multitoque), Full HD (1920 × 1080). Em pé ou deitada, o totem se ajusta. |
| Sistema | Android 8.0 ou mais novo (o FreeKiosk exige 8.0), ou Windows 10/11. Para a opção B, Windows **Pro** ou superior, nunca Home. |
| Memória | 4 GB de RAM. |
| Armazenamento | 32 GB ou mais. O catálogo ocupa pouco; a folga é para as atualizações do sistema. |
| Rede | Wi-Fi da loja ou cabo de rede. Cabo é mais estável. |
| Energia | Tomada dedicada e, na opção B, nobreak. |
| Navegador | Chrome atualizado (opções A e C) ou Edge atualizado (opção B). |

## Quando o totem perde a rede

O totem continua funcionando com o catálogo guardado. O que muda:

- Aparece no alto o aviso discreto "Sem internet: mostrando o catálogo
  guardado".
- O botão "Ganhe seu cupom" some e dá lugar a "Para se cadastrar, aponte o
  celular para o QR da etiqueta".
- Buscas e produtos vistos ficam guardados no aparelho e sobem quando a rede
  volta. Nada se perde.
- Lote e validade são os da última sincronização. A situação da validade
  ("vencido", "vence em breve") é recalculada com a data do aparelho.

O que fazer, em ordem:

1. Confira se o roteador da loja está ligado e se outro aparelho navega.
2. Abra a manutenção (5 toques no canto superior esquerdo) e veja a última
   sincronização.
3. Com a rede de volta, toque em **Sincronizar agora**. O totem também tenta
   sozinho a cada 5 minutos e assim que percebe a rede.
4. Se a manutenção disser que a loja foi desativada, ou se o totem voltar
   para a tela de ativação, o problema está no painel: confira em **Totem ›
   Totens** se o aparelho foi revogado e, se for o caso, gere um código
   novo.
5. Se o totem foi ligado pela primeira vez sem rede, ele mostra "O totem
   ainda não tem o catálogo da loja guardado". Ele precisa de internet uma
   vez para baixar o catálogo.

## Fontes

Todas consultadas em 11/10/2026.

1. Microsoft Learn, "Configurar um quiosque Single-App com acesso atribuído":
   edições, requisitos, caminho nas Configurações, saída com Ctrl + Alt + Del
   e remoção. <https://learn.microsoft.com/pt-br/windows/configuration/assigned-access/configure-single-app-kiosk>
2. Microsoft Learn, "Configurar o modo de quiosque do Microsoft Edge": as duas
   experiências (sinalização digital/interativa e navegação pública), a
   sessão InPrivate e as opções `--kiosk`, `--edge-kiosk-type` e
   `--no-first-run`. <https://learn.microsoft.com/pt-br/deployedge/microsoft-edge-configure-kiosk-mode>
3. Ajuda do Android, "Fixar e liberar telas": caminho da fixação de app e
   como liberar. <https://support.google.com/android/answer/9455138?hl=pt-BR>
4. FreeKiosk no GitHub: licença MIT, Android 8.0 ou mais novo, APK em
   Releases, botão escondido, PIN e o comando de proprietário do aparelho.
   <https://github.com/RushB-fr/freekiosk>,
   <https://github.com/RushB-fr/freekiosk/blob/main/LICENSE> e
   <https://github.com/RushB-fr/freekiosk/blob/main/docs/installation.md>
5. Ajuda do Google Chrome, "Usar apps da Web" (Android): **Mais › Instalar e
   criar atalho › Instalar**. <https://support.google.com/chrome/answer/9658361?hl=pt-BR&co=GENIE.Platform%3DAndroid>
6. Revisão de código do Chromium 244003, que criou a opção `--kiosk` (tela
   cheia sem barras, revisão 31412, 2009). <https://codereview.chromium.org/244003/>
