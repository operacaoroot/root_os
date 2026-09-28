/**
 * Onde a fila de aprovação mora na web.
 *
 * Sai daqui, e não do componente, pelo mesmo motivo do texto do interruptor em
 * `integrations/conectores.ts`: caminho escrito na tela é a forma garantida de
 * os dois lados divergirem na próxima fatia. A tela desta rota ainda é o
 * placeholder do menu — quem a constrói é a fatia 3.10 —, e é justamente por
 * isso que o endereço precisa vir de um lugar só.
 */
export const FILA_DE_APROVACAO = '/atendimento';
