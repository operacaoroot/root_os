'use client';

/*
 * O BLOCO "TAREFAS" DO PAINEL DO LEAD (adendo de 21/10/2026, §A1): as tarefas
 * do comercial ligadas a este lead, as abertas primeiro e as concluídas
 * recolhidas. "+ tarefa" já nasce ligada ao lead. A mais antiga aberta também
 * aparece no cartão do funil (como a próxima ação quando vem antes da da ficha);
 * por isso, depois de mudar uma tarefa, a tela de trás relê o funil.
 */
import type { TarefasDoComercial } from '@mktos/shared';

import { CARTAO, Erro, Rotulo, useCarregar } from '../_ui';
import { ListaDeTarefasDoComercial, caminhoDasTarefas } from '../_funil/TarefasDoComercial';
import { usePainel } from './provedor';

export function TarefasDoLead({ leadId }: { leadId: string }) {
  const painel = usePainel();
  const { dados, erro, recarregar } = useCarregar<TarefasDoComercial>(caminhoDasTarefas({ leadId }), 60_000);
  const abertas = Array.isArray(dados?.tarefas) ? dados.tarefas.filter((t) => t.status.tipo !== 'concluida').length : 0;
  return (
    <section className={CARTAO} aria-label="tarefas do lead" data-testid="painel-tarefas">
      <Rotulo>tarefas{abertas ? ` · ${abertas} ${abertas === 1 ? 'aberta' : 'abertas'}` : ''}</Rotulo>
      <div className="mt-2">
        <Erro erro={erro} aoTentar={() => void recarregar()} />
        <ListaDeTarefasDoComercial
          dados={dados}
          leadId={leadId}
          testId="painel-tarefas-lista"
          aoMudar={async () => {
            await recarregar();
            painel.mudou();
          }}
          vazio="Nenhuma tarefa aberta para este lead."
        />
      </div>
    </section>
  );
}
