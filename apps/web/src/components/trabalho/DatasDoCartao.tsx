import {
  ROTULO_DA_ORIGEM_DA_DATA, diaComSemana, diaCurto, instanteComSemana, proximaDataDoCartao,
} from '@/lib/datas-do-cartao';

/*
 * AS DATAS DO CARTÃO E DO BALÃO (rodada de produção 1, 21/10/2026). A próxima data real
 * (o prazo da tarefa ou o do próximo passo) em `dd/mm`, com o dia da semana no `title`;
 * sem data, nada. A régua de fuso mora em `lib/datas-do-cartao.ts`.
 */

/** A próxima data no rodapé do cartão. */
export function ProximaDataNoCartao({ dueDate, proximoPassoEm, concluida }: { dueDate: string | null; proximoPassoEm?: string | null; concluida?: boolean }) {
  const p = proximaDataDoCartao({ dueDate, proximoPassoEm });
  const curto = p ? diaCurto(p.iso) : null;
  if (!p || !curto) return null;
  const atrasada = p.passou && !concluida;
  return (
    <span
      data-testid="cartao-proxima-data"
      data-origem={p.origem}
      className={atrasada ? 'text-bad' : ''}
      title={`${diaComSemana(p.iso)} · ${ROTULO_DA_ORIGEM_DA_DATA[p.origem]}${atrasada ? ' · passou' : ''}`}
    >
      {curto}
    </span>
  );
}

/** As duas linhas de data do balão: desde quando na etapa e a próxima data, com o dia da semana. */
export function DatasNoBalao({ statusDesde, dueDate, proximoPassoEm }: { statusDesde: string | null | undefined; dueDate: string | null; proximoPassoEm?: string | null }) {
  const desde = instanteComSemana(statusDesde ?? null);
  const p = proximaDataDoCartao({ dueDate, proximoPassoEm });
  const proxima = p ? diaComSemana(p.iso) : null;
  if (!desde && !proxima) return null;
  return (
    <div className="mt-1.5 space-y-0.5" data-testid="balao-datas">
      {desde && <p><span className="text-muted">na etapa desde</span> {desde}</p>}
      {p && proxima && <p><span className="text-muted">próxima data</span> {proxima} <span className="text-muted">· {ROTULO_DA_ORIGEM_DA_DATA[p.origem]}{p.passou ? ' · passou' : ''}</span></p>}
    </div>
  );
}
