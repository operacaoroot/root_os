# Etiqueta com QR do totem

A etiqueta leva o nome do produto, o código, o lote, a validade e um QR que abre
`https://<endereço do painel>/p/<código da etiqueta>` no celular do cliente.
Embaixo do QR vai o mesmo endereço sem `https://`, para quem prefere digitar.
Ela sai pela impressão do navegador, sem programa extra no computador da loja.

## Como gerar e imprimir

1. Em `/totem-gestao/etiquetas`, escolha a loja, o produto e o lote. Sem lote, a
   etiqueta é de gôndola: o QR mostra o lote vigente da loja no momento da
   leitura. Com lote, ela vale para aquele lote até ser revogada.
2. Clique em **Imprimir as etiquetas geradas**, ou marque etiquetas na lista e
   clique em **Imprimir N escolhida(s)**. Cabem até 200 por vez.
3. Na página de impressão, escolha o tamanho: **60 x 40 mm** ou **100 x 50 mm**.
   O painel guarda a escolha neste navegador.
4. Clique em **Imprimir N etiqueta(s)** e, depois que a impressora soltar as etiquetas, em
   **Marcar como impressas**. A lista passa a mostrar a data da impressão.

Etiqueta perdida, rasgada ou com dado errado: revogue na lista. O QR revogado
abre a página "Etiqueta não encontrada".

## Configuração da impressora térmica

Vale para qualquer impressora térmica de etiqueta que o sistema operacional
reconheça como impressora comum (Elgin, Argox, Zebra e similares).

1. **Driver**: instale o driver do fabricante para o sistema da loja (Windows ou
   macOS). Imprima a página de teste do próprio driver antes de abrir o painel.
2. **Papel no driver**: crie um tamanho personalizado igual ao rolo, 60 x 40 mm
   ou 100 x 50 mm, com orientação retrato, e deixe-o como padrão da impressora.
   Ajuste no driver o sensor de etiqueta (gap ou marca preta) e a escuridão.
3. **Diálogo do navegador** (Chrome ou Edge, que respeitam o `@page` da página):
   - Destino: a impressora térmica.
   - Tamanho do papel: o mesmo tamanho personalizado do passo 2.
   - Margens: **Nenhuma**.
   - Escala: **100%** (ou "Tamanho real"), nunca "Ajustar à página".
   - Cabeçalhos e rodapés: **desligados**.
   - Gráficos de plano de fundo: tanto faz, a etiqueta é preto no branco.
4. Cada etiqueta sai numa página. Se a impressora pular uma etiqueta em branco
   entre duas impressas, o tamanho do papel no driver está maior que o rolo; se
   cortar o fim, está menor.

Teste com uma etiqueta antes de mandar o lote inteiro, e leia o QR impresso com
o celular. Ele precisa abrir a ficha na primeira tentativa.

## Daqui para a frente: a etiquetadora do Director

O Director (ERP/PDV da Processa) tem etiquetadora própria. A integração fica
para depois do ingestor do Director, e o caminho previsto é este:

- O produto do totem já tem o campo `codigoDirector`. O ingestor liga cada
  produto do Director ao produto do totem por esse código.
- A etiquetadora do Director passa a imprimir o QR com o endereço
  `https://<endereço do painel>/p/<código da etiqueta>`. O código da etiqueta
  continua nascendo no totem; o Director recebe a lista por arquivo exportado
  do painel ou por uma rota de leitura, a decidir com a Processa.
- Impressão direta em ESC/POS ou ZPL está fora do escopo desta entrega
  (CONTRATO.md, seção 1).
