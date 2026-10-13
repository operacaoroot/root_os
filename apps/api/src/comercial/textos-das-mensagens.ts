import type { ComercialTemplate } from '@mktos/shared';

/*
 * O GANCHO DOS TEXTOS M1 A M8 (Lane A → Lane B).
 *
 * Os oito textos do WhatsApp (C08) são da lane B, em `comercial/mensagens.ts`,
 * com versão e data. A espinha PREPARA a mensagem (grava `ComercialMensagem`
 * em rascunho com o template) antes de o arquivo da lane B existir, então o
 * texto chega por REGISTRO e não por import: quem tem os textos chama
 * `registrarTextos` uma vez (no `onModuleInit` do serviço da lane B); sem
 * registro, sai o texto provisório abaixo, marcado como pendente, que a tela
 * e o simulador mostram como está. Nenhum texto provisório vai a um lead de
 * verdade: a mensagem nasce `rascunho` e quem envia é gente (R3), que vê a
 * marca "[texto pendente da lane B]" antes de tocar.
 */

export interface ContextoDoTexto {
  nome: string | null;
  empresa: string | null;
  /** Variáveis que cada template usa (link da sala, horário da reunião, versão da proposta...). */
  variaveis: Record<string, string | null | undefined>;
}

export type FonteDeTextos = (template: ComercialTemplate, ctx: ContextoDoTexto) => { texto: string; versao: string } | null;

let fonte: FonteDeTextos | null = null;
let dono: string | null = null;

/** A lane B inscreve a fonte dos textos. Segunda inscrição lança: um dono por texto. */
export function registrarTextos(f: FonteDeTextos, quem: string): void {
  if (fonte && dono !== quem) {
    throw new Error(`Textos do WhatsApp já inscritos por "${dono}"; "${quem}" tentou inscrever de novo.`);
  }
  fonte = f;
  dono = quem;
}

/** Só a suíte: desfaz a inscrição entre casos. */
export function limparTextosParaTeste(): void {
  fonte = null;
  dono = null;
}

export const MARCA_DE_TEXTO_PENDENTE = '[texto pendente da lane B]';

const PROVISORIO: Record<ComercialTemplate, string> = {
  M1: 'Oi{nome}. Recebemos a sua mensagem. Antes da conversa, quatro perguntas rápidas pelo link da sua sala: {sala}.',
  M2: 'Oi{nome}. Temos dois horários para a sessão estratégica: {horarios}. Qual fica melhor para você?',
  M3: 'Oi{nome}. Confirmando a nossa conversa de amanhã, {horario}. O link da chamada está na sua sala: {sala}.',
  M4: 'Oi{nome}. A proposta está publicada na sua sala, válida até {validade}: {sala}.',
  M5: 'Oi{nome}. Vi que a proposta foi aberta. Ficou alguma dúvida que eu possa responder até {data}?',
  M6: 'Oi{nome}. Passando com uma novidade: {novidade}. Se fizer sentido, a proposta segue na sua sala: {sala}.',
  M7: 'Oi{nome}. O contrato está pronto para assinatura: {link}.',
  M8: 'Oi{nome}. Bem-vindo. Este é o grupo da sua conta com a Root; o kickoff fica para {kickoff}.',
};

function preencher(modelo: string, ctx: ContextoDoTexto): string {
  const nome = ctx.nome ? `, ${ctx.nome.split(' ')[0]}` : '';
  return modelo
    .replace('{nome}', nome)
    .replace(/\{(\w+)\}/g, (_, chave: string) => {
      const v = ctx.variaveis[chave];
      return v == null || v === '' ? `[${chave}: a definir]` : v;
    });
}

/**
 * O texto de um template para este lead: o da lane B quando inscrito, senão o
 * provisório com a marca de pendente. Nunca lança: preparar a mensagem não
 * pode depender de a outra lane já ter entregado.
 */
export function textoDoTemplate(template: ComercialTemplate, ctx: ContextoDoTexto): { texto: string; versao: string; provisorio: boolean } {
  if (fonte) {
    try {
      const r = fonte(template, ctx);
      if (r && r.texto.trim()) return { texto: r.texto, versao: r.versao, provisorio: false };
    } catch {
      // cai no provisório: a mensagem fica em rascunho e a marca denuncia.
    }
  }
  return { texto: `${MARCA_DE_TEXTO_PENDENTE} ${preencher(PROVISORIO[template], ctx)}`, versao: 'provisorio-lane-a', provisorio: true };
}
