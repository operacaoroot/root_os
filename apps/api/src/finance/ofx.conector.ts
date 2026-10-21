import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { RegistroDeConectores } from '../integrations/conectores.registry';
import {
  type ConectorDoContrato,
  type ResultadoDeAutorizacao,
  type ResultadoDeRevogacao,
  type ResultadoDeSincronizacao,
  type SaudeDeConector,
  conectado,
  erroDeConector,
} from '../integrations/contrato-de-conector';
import { parseOfx } from './ofx';

/*
 * O EXTRATO OFX NO CONTRATO ÚNICO — rodada dos agentes, lane A6 (21/10/2026).
 *
 * O OFX não é fornecedor externo: é o arquivo que a pessoa exporta do banco e
 * sobe no Financeiro, lido pelo parser da casa (`ofx.ts`). Ele entra no
 * registro para a tela de Conexões ter UM padrão só: o cartão do OFX mostra o
 * mesmo estado medido, a mesma hora e as mesmas ações que os outros.
 *
 * A SONDA É DE VERDADE, e é local: o parser lê um extrato mínimo e precisa
 * achar o lançamento certo (valor, sentido e identificador). É a dependência
 * real deste conector, então o verde nasce de uma tentativa medida (RF-X-02),
 * e nada sai da casa. Sem credencial, não há o que autorizar nem revogar.
 */
const EXTRATO_DE_PROVA = [
  'OFXHEADER:100',
  '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>',
  '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261021<TRNAMT>-12,34<FITID>sonda-1<MEMO>sonda do OFX</STMTTRN>',
  '</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>',
].join('\n');

@Injectable()
export class OfxConector implements OnModuleInit {
  constructor(@Optional() private readonly contrato?: RegistroDeConectores) {}

  onModuleInit(): void {
    this.contrato?.registrar(this.descritor(), 'OfxConector');
  }

  descritor(): ConectorDoContrato {
    return {
      chave: 'ofx',
      rotulo: 'Extrato OFX (upload)',
      escopoDaCredencial: 'processo',
      autorizar: async (): Promise<ResultadoDeAutorizacao> => ({
        tipo: 'pronto',
        detalhe: 'O OFX não tem credencial: o arquivo exportado do banco sobe em Financeiro › Importar extrato.',
      }),
      sincronizar: async (): Promise<ResultadoDeSincronizacao> => ({
        tipo: 'nao_se_aplica',
        motivo: 'Cada extrato entra quando alguém sobe o arquivo no Financeiro; não há nada para buscar fora.',
      }),
      saude: async (): Promise<SaudeDeConector> => {
        const comecou = Date.now();
        try {
          const [t, ...resto] = parseOfx(EXTRATO_DE_PROVA);
          if (!t || resto.length || t.externalId !== 'sonda-1' || t.type !== 'saida' || Math.abs(t.amount - 12.34) > 1e-9) {
            return erroDeConector('o leitor de OFX não leu o extrato de prova como devia.', Date.now() - comecou);
          }
          return conectado(Date.now() - comecou, 'leitor de OFX da casa; nada sai do sistema');
        } catch (e) {
          return erroDeConector(`o leitor de OFX falhou: ${(e as Error).message}`, Date.now() - comecou);
        }
      },
      revogar: async (): Promise<ResultadoDeRevogacao> => ({
        tipo: 'nao_se_aplica',
        motivo: 'O OFX não guarda credencial: não há nada para revogar.',
      }),
    };
  }
}
