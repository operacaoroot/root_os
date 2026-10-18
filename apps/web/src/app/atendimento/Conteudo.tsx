'use client';

/*
 * O CONTEÚDO EXATO QUE VAI SER EXECUTADO.
 *
 * Não é um resumo nem uma reconstrução: são os argumentos GRAVADOS na passagem
 * pela porta (`ToolCall.args`), os mesmos bytes que `executarAprovada` entrega
 * ao efeito. É por causa deles que a aprovação é presa a um hash — trocar o
 * texto entre o "sim" e o envio invalida a assinatura.
 *
 * Por isso a exibição é campo a campo, e não um JSON de uma linha só: quem
 * assina o envio de uma mensagem precisa LER a mensagem, e `{"corpo":"Oi,\n..."}`
 * não é leitura.
 */

/** O formato que a porta grava quando a capacidade é `restrita`. */
interface Redigido {
  redigido: true;
  chaves?: string[];
}

function ehRedigido(v: Record<string, unknown>): v is Record<string, unknown> & Redigido {
  return v.redigido === true;
}

export function Conteudo({
  valor,
  oculto,
}: {
  valor: Record<string, unknown> | null;
  /** O servidor reteve o conteúdo por permissão — não é ausência de conteúdo. */
  oculto: boolean;
}) {
  /*
   * RETIDO POR PERMISSÃO — e por que a frase é diferente de "não há conteúdo".
   *
   * O corpo exato de uma ação retida só vai para quem pode DECIDIR: é a
   * assinatura informada que justifica a exposição. Quem tem só `aprovacoes.ver`
   * acompanha a fila inteira — resumo, nível, gatilhos, prazo, quem assina — sem
   * o texto que vai sair. Dizer "a ação não leva argumento nenhum" aqui seria
   * mentir sobre o que existe do outro lado.
   */
  if (oculto) {
    return (
      <p className="text-sm text-muted" data-testid="conteudo-oculto">
        O conteúdo exato desta ação só aparece para quem pode <strong>decidir</strong> na fila:
        quem assina precisa ler o que assina, e essa é a única razão que justifica mostrar o texto.
        Seu perfil acompanha a fila sem ele.
      </p>
    );
  }

  if (valor === null) {
    return (
      <p className="text-sm text-muted">
        Esta aprovação é da superfície antiga (as rotas de escrita sensível): ela não retém uma
        ação, autoriza uma escrita que a própria rota faz com o token. Não há argumento gravado
        para mostrar.
      </p>
    );
  }

  if (ehRedigido(valor)) {
    return (
      <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
        O conteúdo desta ação é <strong>restrito</strong> e a porta o gravou redigido: nem o rastro
        nem esta tela guardam o valor.
        {valor.chaves?.length ? (
          <span> Os campos enviados são: {valor.chaves.join(', ')}.</span>
        ) : null}
      </div>
    );
  }

  const campos = Object.entries(valor);
  if (!campos.length) {
    return <p className="text-sm text-muted">A ação não leva argumento nenhum.</p>;
  }

  return (
    <dl className="space-y-2" data-testid="conteudo-exato">
      {campos.map(([chave, v]) => (
        <div key={chave} className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:gap-3">
          <dt className="font-mono text-[11px] text-muted">{chave}</dt>
          <dd className="min-w-0">
            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-surface-2 px-2 py-1 text-[12.5px] text-text">
              {typeof v === 'string' ? v : JSON.stringify(v, null, 2)}
            </pre>
          </dd>
        </div>
      ))}
    </dl>
  );
}
