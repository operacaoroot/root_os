# Formulário do site · CO-15 (rodada dos agentes, 21/10/2026)

O formulário de contato de operacaoroot.com cria o lead direto no funil do comercial do ROOT OS. Sem modelo, sem mensagem automática: a pessoa preenche, o lead aparece em Novo lead, e quem decide o primeiro contato é gente.

## O endereço

```
POST https://os.operacaoroot.com/api/publico/lead
```

- Rota anônima (o site não tem token). O CORS vale só para `https://operacaoroot.com` e `https://www.operacaoroot.com`, com o preflight (`OPTIONS`) incluído. Qualquer outra origem de navegador recebe 403 antes de o corpo ser lido. O CORS do resto da API não muda.
- Aceita `Content-Type: application/json` (o snippet abaixo) ou `application/x-www-form-urlencoded`.
- Corpo de até 16 KB. Acima disso, 413.

## Os campos

| Campo | Obrigatório | Regra |
|---|---|---|
| `k` | sim | A chave da empresa: o **id da empresa Root no OS** (o mesmo do pixel). Fica escondido no formulário. Não é segredo, mas sem ela o lead não sabe de quem é. |
| `nome` | sim | De 2 a 200 caracteres. |
| `email` | um dos dois | E-mail válido, até 254. |
| `telefone` | um dos dois | Com DDD, de 10 a 15 dígitos (pode ter `+`, espaço, parêntese e hífen). Vira o WhatsApp do lead. |
| `empresa` | não | Até 200. Vai para a ficha do lead quando ela ainda não tem empresa. |
| `mensagem` | não | Até 2.000. É dado: aparece no fio do lead e nunca vai a um modelo. |
| `website` | **deixe vazio** | O campo-isca. Fica invisível para quem usa o site; robô preenche. Preenchido, a resposta é a mesma do sucesso e nada é gravado. |

Campo vazio conta como ausente. Campo fora desta lista é recusado (400).

## As respostas

| Status | Quando | Corpo |
|---|---|---|
| 202 | Recebido (lead novo, o mesmo envio repetido, isca, ou retido pela régua) | `{"ok":true,"mensagem":"Recebemos o seu contato. A Root responde em breve."}` |
| 400 | Campo inválido | `{"message":"Formulário inválido.","erros":["email: E-mail inválido."]}` |
| 403 | Origem de navegador que não é o site | `{"statusCode":403,"message":"Origem não autorizada."}` |
| 404 | Chave `k` que não é de nenhuma empresa (ou empresa sem o módulo de leads) | `{"message":"Não encontrado."}` |
| 413 | Corpo acima de 16 KB | `{"statusCode":413,"message":"Formulário grande demais."}` |
| 429 | Mais de 10 envios por hora do mesmo endereço (ou 300 por hora no total) | `{"message":"Muitos envios. Tente de novo mais tarde."}` |
| 503 | O OS não conseguiu registrar agora | `{"message":"Não conseguimos registrar o contato agora. Tente de novo em instantes."}` |

A resposta nunca devolve o id do lead nem nada do lado de dentro.

## O que acontece no OS

1. O pedido passa pela porta com a capacidade `comercial.lead.criar` (R1: escreve só dentro do OS). Entre 08h e 20h de São Paulo, sem volume atípico, o lead nasce na hora. Fora da janela, a régua sobe para R2 e o pedido fica em Aprovações até uma pessoa liberar (o site ouve o mesmo 202).
2. O lead nasce pela entrada idempotente: o mesmo e-mail (ou telefone, sem e-mail) cai no mesmo lead, e o mesmo envio repetido não grava nada de novo. Um envio diferente do mesmo contato entra como mais um fato no fio.
3. A ficha do comercial nasce em Novo lead, canal `site`, com a empresa escrita. O fio ganha `lead.chegou` e `site.formulario`.
4. **Nenhuma mensagem, cobrança ou contrato nasce daqui.** A M1 (boas-vindas pelo WhatsApp) não é preparada: o número foi digitado por um anônimo, e o primeiro contato é decisão de quem atende.

## O snippet para o site

Troque `ID-DA-EMPRESA-ROOT` pelo id da empresa Root no OS (ver "Para publicar" no resultado da rodada). Nada mais muda.

```html
<form id="contato-root" novalidate>
  <label>Nome <input name="nome" required maxlength="200" autocomplete="name"></label>
  <label>E-mail <input name="email" type="email" maxlength="254" autocomplete="email"></label>
  <label>WhatsApp <input name="telefone" type="tel" maxlength="40" autocomplete="tel" placeholder="(32) 99999-0000"></label>
  <label>Empresa <input name="empresa" maxlength="200" autocomplete="organization"></label>
  <label>Mensagem <textarea name="mensagem" maxlength="2000" rows="4"></textarea></label>
  <!-- Campo-isca: fica fora da tela e fora do teclado. Não remova e não preencha. -->
  <div aria-hidden="true" style="position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden">
    <label>Site <input name="website" tabindex="-1" autocomplete="off"></label>
  </div>
  <input type="hidden" name="k" value="ID-DA-EMPRESA-ROOT">
  <button type="submit">Quero conversar</button>
  <p id="contato-root-status" role="status"></p>
</form>
<script>
  (function () {
    var form = document.getElementById('contato-root');
    var status = document.getElementById('contato-root-status');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var dados = {};
      new FormData(form).forEach(function (valor, campo) { dados[campo] = String(valor).trim(); });
      if (!dados.email && !dados.telefone) { status.textContent = 'Informe um e-mail ou um WhatsApp.'; return; }
      status.textContent = 'Enviando…';
      fetch('https://os.operacaoroot.com/api/publico/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados)
      })
        .then(function (r) { return r.json().then(function (c) { return { ok: r.ok, status: r.status, corpo: c }; }); })
        .then(function (r) {
          if (r.ok) { form.reset(); status.textContent = r.corpo.mensagem; return; }
          if (r.status === 400 && r.corpo.erros) { status.textContent = 'Confira os campos: ' + r.corpo.erros.join('; '); return; }
          if (r.status === 429) { status.textContent = 'Muitos envios agora. Tente de novo mais tarde.'; return; }
          status.textContent = 'Não deu para enviar agora. Tente de novo em instantes.';
        })
        .catch(function () { status.textContent = 'Não deu para enviar agora. Tente de novo em instantes.'; });
    });
  })();
</script>
```

O snippet não tem segredo nem cookie: a chave `k` aparece no HTML do site, como a do pixel, e o que segura a rota é o CORS, o teto por endereço, a isca e a régua.

## Como conferir depois de publicar

1. Abra o site, preencha com um e-mail de teste e envie: a tela mostra "Recebemos o seu contato".
2. No OS, em Comercial › Funil, o lead aparece em Novo lead com o canal "site" e a mensagem no fio.
3. Fora do horário (depois das 20h), o pedido aparece em Aprovações como `comercial.lead.criar` e o lead nasce quando alguém libera.
