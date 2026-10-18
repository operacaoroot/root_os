import { CAPACIDADE_DE_APROVAR_A_SEMANA, COMERCIAL_ROTULO_DA_ETAPA } from '@mktos/shared';
import type { ItemDaFila } from './tipos';

/*
 * O QUE O PEDIDO FAZ, EM PORTUGUÊS — verbo + objeto (rodada do painel P4).
 *
 * A linha compacta da fila diz "Enviar WhatsApp para Marina Duarte" em vez de
 * `comercial.whatsapp.enviar`. A frase é montada SÓ do que a listagem já traz:
 * a capacidade, os argumentos gravados (quando quem olha pode lê-los), o nome
 * do lead (`alvo`, que segue a mesma régua dos argumentos) e o resumo que o
 * servidor escreveu. Nada aqui decide nada: é rótulo. O conteúdo exato continua
 * no item aberto, campo a campo.
 *
 * Capacidade que esta tabela não conhece cai no caso honesto, "Executar
 * <capacidade>": inventar um verbo para o que não se sabe o que faz seria a
 * frase que mente na hora de assinar.
 */

type Item = Pick<ItemDaFila, 'capacidade' | 'conteudo' | 'resumo' | 'recurso'> & {
  alvo?: string | null;
  destinoConferido?: ItemDaFila['destinoConferido'];
};

const TETO_DO_TRECHO = 60;

/** Um trecho entre aspas, cortado sem partir palavra no meio quando dá. */
export function trecho(v: unknown, teto = TETO_DO_TRECHO): string | null {
  if (typeof v !== 'string') return null;
  const limpo = v.replace(/\s+/g, ' ').trim();
  if (!limpo) return null;
  if (limpo.length <= teto) return `“${limpo}”`;
  const corte = limpo.slice(0, teto);
  const espaco = corte.lastIndexOf(' ');
  return `“${(espaco > teto / 2 ? corte.slice(0, espaco) : corte).trimEnd()}…”`;
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function reais(centavos: unknown): string | null {
  if (typeof centavos !== 'number' || !Number.isFinite(centavos)) return null;
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const FORMATO: Record<string, string> = { carrossel: 'o carrossel', story: 'o story', corte: 'o corte' };

/** "E6 · Proposta" vira "Proposta"; "Saída · Geladeira" vira "Geladeira". */
function etapaCurta(rotulo: string): string {
  const i = rotulo.indexOf(' · ');
  return i >= 0 ? rotulo.slice(i + 3) : rotulo;
}

/** O nome no resumo do servidor ("Mover <quem> de <etapa> para …"), casado pelos rótulos do shared. */
function quemNoResumo(resumo: string): string | null {
  if (!resumo.startsWith('Mover ')) return null;
  const rotulos = Object.values(COMERCIAL_ROTULO_DA_ETAPA);
  for (const de of rotulos) {
    const i = resumo.indexOf(` de ${de} para `);
    if (i > 'Mover '.length) return resumo.slice('Mover '.length, i);
  }
  return null;
}

/**
 * O pedido de mover do funil (P5) é da superfície antiga: não tem argumento
 * gravado. O DESTINO vem de `destinoConferido`, que o servidor tira do hash que
 * a assinatura prende (revisão PA-1), nunca do texto do resumo: o texto é de
 * quem pediu, e era por ele que "para E3" podia assinar uma ida a E7. Do resumo
 * só sai o nome, e só quando o `alvo` (lido do banco) não veio.
 */
function fraseDoMover(item: Item): string | null {
  const conferido = item.destinoConferido;
  const ehMover = !!conferido || item.resumo.startsWith('Mover ');
  if (!ehMover) return null;
  const quem = texto(item.alvo) ?? quemNoResumo(item.resumo) ?? 'o lead';
  return conferido ? `Mover ${quem} para ${etapaCurta(conferido.rotulo)}` : `Mover ${quem}: destino não conferido`;
}

function doLead(item: Item, semNome = 'o lead'): string {
  return texto(item.alvo) ?? semNome;
}

export function fraseDoPedido(item: Item): string {
  const a = (item.conteudo ?? {}) as Record<string, unknown>;
  const cap = item.capacidade;

  if (!cap) {
    // Superfície antiga: quem escreveu a frase foi o servidor, no resumo.
    if (item.recurso.tipo === 'lead') {
      const mover = fraseDoMover(item);
      if (mover) return mover;
    }
    return texto(item.resumo) ?? `Autorizar ${item.recurso.tipo}`;
  }

  switch (cap) {
    case 'whatsapp.mensagem.enviar': {
      const t = trecho(a.titulo);
      return item.alvo ? `Enviar WhatsApp para ${item.alvo}` : t ? `Enviar WhatsApp ${t}` : 'Enviar WhatsApp';
    }
    case 'comercial.whatsapp.enviar':
      return a.destino === 'grupo'
        ? `Enviar WhatsApp ao grupo sobre ${doLead(item)}`
        : `Enviar WhatsApp para ${doLead(item)}`;
    case 'email.enviar': {
      const para = Array.isArray(a.para) ? a.para.filter((x) => typeof x === 'string').join(', ') : texto(a.para);
      const assunto = trecho(a.assunto, 40);
      return `Enviar e-mail${para ? ` para ${para}` : ''}${assunto ? `: ${assunto}` : ''}`;
    }
    case 'email.rascunhar': {
      const assunto = trecho(a.assunto);
      return `Rascunhar e-mail${assunto ? ` ${assunto}` : ''}`;
    }
    case 'agenda.evento.criar': {
      const t = trecho(a.titulo);
      return `Criar evento na agenda${t ? ` ${t}` : ''}`;
    }
    case 'agenda.reuniao.marcar': {
      const cliente = texto(a.cliente);
      return `Marcar reunião${cliente ? ` com ${cliente}` : ''}`;
    }
    case 'documento.criar': {
      const t = trecho(a.titulo);
      return `Criar documento${t ? ` ${t}` : ''}`;
    }
    case 'documento.anexar':
      return 'Acrescentar texto a um documento';
    case 'instagram.post.publicar': {
      const formato = typeof a.formato === 'string' ? (FORMATO[a.formato] ?? `o ${a.formato}`) : 'a peça';
      const legenda = trecho(a.legenda, 40);
      return `Publicar no Instagram ${formato}${legenda ? ` ${legenda}` : ''}`;
    }
    case 'instagram.resposta_privada.enviar': {
      const palavra = texto(a.palavra);
      return palavra ? `Responder no direct quem comentar ${palavra}` : 'Responder no direct quem comentar';
    }
    case 'youtube.video.enviar': {
      const t = trecho(a.titulo, 50);
      return `Enviar ao YouTube o vídeo${t ? ` ${t}` : ''}`;
    }
    case 'youtube.video.publicar': {
      const t = trecho(a.titulo, 50);
      return `Agendar no YouTube o vídeo${t ? ` ${t}` : ''}`;
    }
    case CAPACIDADE_DE_APROVAR_A_SEMANA: {
      const ep = /\bep-0*(\d+)/.exec(item.resumo);
      return ep ? `Aprovar a semana do episódio ${ep[1]}` : 'Aprovar a semana de posts';
    }
    case 'conteudo.publicar':
      return 'Publicar conteúdo';
    case 'comercial.proposta.publicar': {
      const v = typeof a.versao === 'number' ? ` v${a.versao}` : '';
      return `Publicar a proposta${v} para ${doLead(item)}`;
    }
    case 'comercial.cobranca.criar': {
      const valor = reais(a.valorCentavos);
      const parcelas = typeof a.parcelas === 'number' && a.parcelas > 1 ? ` em ${a.parcelas}×` : '';
      return `Criar a cobrança${valor ? ` de ${valor}${parcelas}` : ''} para ${doLead(item)}`;
    }
    case 'comercial.contrato.enviar':
      return `Enviar o contrato para assinatura de ${doLead(item, texto(a.signatarioEmail) ?? 'o lead')}`;
    case 'comercial.fechamento.executar':
      return `Fechar o negócio de ${doLead(item)}`;
    case 'clickup.tarefa.criar': {
      const t = trecho(a.titulo);
      return `Criar tarefa no ClickUp${t ? ` ${t}` : ''}`;
    }
    case 'clickup.tarefa.alterar': {
      const s = texto(a.status);
      return `Mudar uma tarefa do ClickUp${s ? ` para ${s}` : ''}`;
    }
    case 'crm.lead.criar':
      return 'Criar um lead';
    case 'crm.lead.alterar': {
      const s = texto(a.status);
      return `Mudar ${doLead(item)}${s ? ` para ${s}` : ''}`;
    }
    case 'financeiro.pagamento.baixar': {
      const t = trecho(a.titulo);
      return `Dar baixa no pagamento${t ? ` ${t}` : ''}`;
    }
    case 'financeiro.lancamento.criar':
      return 'Criar um lançamento financeiro';
    case 'financeiro.lancamento.excluir':
      return 'Excluir um lançamento financeiro';
    case 'registro.excluir':
      return 'Excluir um registro';
    case 'usuario.permissao.alterar':
      return 'Alterar a permissão de um usuário';
    case 'credencial.rotacionar':
      return 'Trocar uma credencial';
    case 'conector.desligar':
      return 'Desligar um conector';
    case 'conector.religar':
      return 'Religar um conector';
    case 'nfe.emitir':
      return 'Emitir nota fiscal';
    default:
      return `Executar ${cap}`;
  }
}
