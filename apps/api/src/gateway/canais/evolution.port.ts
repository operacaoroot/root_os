/*
 * AS DUAS PORTAS DA EVOLUTION DO COMERCIAL (Rodada de produção 1, 21/10/2026, P8).
 *
 * Quem fala HTTP com a Evolution é `pauta/evolution.service.ts`, e mais
 * ninguém: é o arquivo que a catraca de arquitetura conhece como o conector da
 * Evolution (CONECTORES) e o único que pode ler `EVOLUTION_*` (CREDENCIAIS). A
 * classe da empresa (`EvolutionDaEmpresaService`) mora lá, ao lado da do canal
 * de aprovação, e é provida por `canais.module.ts` (a pasta da porta pode
 * importar conector). Este arquivo só declara o que ela oferece, em DUAS portas:
 *
 *   · `ENVIO_PELA_EVOLUTION` manda texto a um número, cria o grupo do cliente e
 *     manda texto no grupo. Só o provedor do comercial
 *     (`comercial/canais/evolution.provider.ts`) a usa, e o provedor só é
 *     chamado pelo EFEITO de `comercial.whatsapp.enviar` (R3), que a porta
 *     dispara depois da assinatura de outra pessoa. A suíte
 *     `comercial-canal-evolution.test.ts` confere que nenhum outro arquivo de
 *     `src/` chama os métodos de envio.
 *   · `ADMINISTRACAO_DA_EVOLUTION` é o resto: o estado do cartão, guardar a
 *     credencial no cofre, sondar a instância, pedir o QR e responder qual
 *     instância a empresa usa. Nada disso manda mensagem a ninguém.
 *
 * O comercial importa daqui só os símbolos e os tipos, nunca o conector.
 */
import type { ConexaoDaEvolution, EstadoDaEvolution, QrDaEvolution } from '@mktos/shared';

export type { ConexaoDaEvolution, EstadoDaEvolution, OrigemDaCredencialEvolution, QrDaEvolution } from '@mktos/shared';

export interface CredencialDaEvolutionParaGuardar {
  url: string;
  chave?: string;
  instancia: string;
}

export interface EnvioPelaEvolution {
  /** Texto a um número (conversa individual), pela instância desta empresa. */
  enviarAoNumero(orgId: string, numero: string, texto: string): Promise<{ id: string }>;
  /** Cria o grupo do cliente e devolve o JID dele (termina em `@g.us`). */
  abrirGrupo(orgId: string, nome: string, numeros: string[], descricao?: string): Promise<{ jid: string }>;
  /** Texto num grupo que a instância desta empresa criou. */
  enviarAoGrupo(orgId: string, jidDoGrupo: string, texto: string): Promise<{ id: string }>;
}

/** O que o conector sabe da conexão; o provedor do comercial quem soma é a rota (ver `evolution.controller.ts`). */
export type ConexaoDoConectorEvolution = Omit<ConexaoDaEvolution, 'provedorDoComercial'>;

export interface AdministracaoDaEvolution {
  conexao(orgId: string): Promise<ConexaoDoConectorEvolution>;
  guardarCredencial(orgId: string, entrada: CredencialDaEvolutionParaGuardar, actorId: string | null): Promise<ConexaoDoConectorEvolution>;
  estadoDaInstancia(orgId: string): Promise<EstadoDaEvolution>;
  /** Pede o QR à Evolution (`instance/connect`). Instância já aberta não ganha QR. */
  gerarQr(orgId: string, actorId: string | null): Promise<QrDaEvolution>;
  /** O conector está ligado nesta empresa? */
  ligado(orgId: string): Promise<boolean>;
  /** A instância que esta empresa usa (para a entrada ignorar mensagem de outra instância). */
  instanciaDaEmpresa(orgId: string): Promise<string | null>;
}

export const ENVIO_PELA_EVOLUTION = Symbol('ENVIO_PELA_EVOLUTION');
export const ADMINISTRACAO_DA_EVOLUTION = Symbol('ADMINISTRACAO_DA_EVOLUTION');

/** A chave do conector da empresa no contrato, no cofre e no catálogo. */
export const CONECTOR_EVOLUTION = 'evolution';

/** O prefixo do "jid" de grupo que a Evolution do comercial criou (o resto é o JID `@g.us`). */
export const PREFIXO_DO_GRUPO_EVOLUTION = 'evolution:';
