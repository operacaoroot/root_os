/*
 * A PASTA DO CLIENTE NO DRIVE (rodada dos agentes, 21/10/2026).
 *
 * A pasta do cliente é uma cópia de `_modelo-cliente` dentro da raiz da empresa
 * (`Root/10-clientes` na Root; a raiz é a nota da memória `clientes.pasta.raiz`,
 * primeira linha = id da pasta). As subpastas são estas, nesta ordem. O
 * arquivista (TR-05) põe cada arquivo numa delas, com o nome padrão
 * `AAAA-MM-DD - <tipo> - <título curto>.<ext>`; o que ele não sabe classificar
 * vai para `_fonte` e vira pendência "classificar à mão".
 */

export const SUBPASTAS_DO_CLIENTE = [
  '01-comercial',
  '02-contrato',
  '03-kickoff',
  '04-entrega',
  '05-acompanhamento',
  '06-financeiro',
  '07-evidencias',
  '99-arquivo',
  '_fonte',
] as const;
export type SubpastaDoCliente = (typeof SUBPASTAS_DO_CLIENTE)[number];

/** De onde o arquivo chegou (o mesmo enum do `drive.arquivo.enviar`). */
export const ORIGENS_DO_ARQUIVO = [
  'sala',
  'anexo-da-tarefa',
  'contrato-assinado',
  'whatsapp',
  'ata',
  'kit',
  'minuta',
  'manual',
] as const;
export type OrigemDoArquivo = (typeof ORIGENS_DO_ARQUIVO)[number];

/** Quem pediu a pasta (o mesmo enum do `drive.pasta.criar`). */
export const ORIGENS_DA_PASTA = ['fechamento', 'onboarding-antecipado', 'fechado-fora', 'manual', 'script'] as const;
export type OrigemDaPasta = (typeof ORIGENS_DA_PASTA)[number];

/** A nota da memória com o id da pasta raiz dos clientes (primeira linha). */
export const NOTA_DA_RAIZ_DOS_CLIENTES = 'clientes.pasta.raiz';
/** O nome da pasta-modelo dentro da raiz. */
export const PASTA_MODELO_DO_CLIENTE = '_modelo-cliente';

/**
 * O nome da pasta do cliente: o nome dele, sem CNPJ/CPF, sem barra nem caractere
 * que o Drive ou o sistema de arquivos estranhem, espaços colapsados, até 120.
 * Vazio depois da limpeza devolve `null` (quem chama não cria pasta sem nome).
 */
export function nomeDaPastaDoCliente(nome: string): string | null {
  const limpo = String(nome ?? '')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, ' ')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, ' ')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, 120)
    .trim();
  return limpo || null;
}

/** `AAAA-MM-DD - <tipo> - <título curto>.<ext>`, sem barra e com até 200 caracteres. */
export function nomePadraoDoArquivo(data: Date, tipo: string, titulo: string, extensao: string): string {
  const dia = data.toISOString().slice(0, 10);
  const limpar = (s: string) => String(s ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const ext = limpar(extensao).replace(/^\.+/, '').toLowerCase().slice(0, 10);
  const t = limpar(tipo).slice(0, 40) || 'arquivo';
  const tit = limpar(titulo).slice(0, 120) || 'sem título';
  const base = `${dia} - ${t} - ${tit}`.slice(0, 200 - (ext ? ext.length + 1 : 0));
  return ext ? `${base}.${ext}` : base;
}
