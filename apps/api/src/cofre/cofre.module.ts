import { Global, Module } from '@nestjs/common';
import { CofreService } from './cofre.service';

/*
 * O COFRE (RF-C-01..RF-C-04).
 *
 * ESTE MÓDULO PRECISA ESTAR NO `imports` DO `AppModule`, e está. `@Global()` não
 * registra nada sozinho: ele só diz que, UMA VEZ IMPORTADO, os `exports` ficam
 * visíveis sem re-importação. Sem a linha lá, o marcador é decoração e nenhum
 * módulo consegue injetar `CofreService` — nem hoje nem depois. Foi assim que a
 * primeira entrega desta fatia ficou inalcançável: código inteiro, correto e
 * fora do alcance de qualquer chamador.
 *
 * @Global pelo mesmo motivo da porta: quem precisa de credencial é todo módulo
 * que fala com conector — google, bio, meta, integrações, pauta — e fazer cada
 * um importar este módulo só multiplicaria a chance de alguém "resolver" a falta
 * de injeção lendo a credencial direto do banco, que é exatamente o que esta
 * fatia veio tirar do caminho.
 *
 * NADA DE CONTROLADOR AQUI, e é decisão. Uma rota de cofre seria uma rota que,
 * com um defeito de permissão, entrega credencial. O que a TELA precisa —
 * "quais conectores esta empresa tem guardados, e desde quando" — é
 * `CofreService.estado`, que não devolve valor nenhum, e a rota que a expõe
 * pertence ao módulo que já tem a tela de Conexões (`integrations/`). Ver
 * FORA DO ESCOPO no relatório da fatia 5.3.
 *
 * `RotacaoDeChaveService` NÃO É PROVIDER e não pode passar a ser: ela atravessa
 * todas as empresas, e o que a mantém fora do alcance de qualquer requisição é
 * não estar no injetor. Ver o cabeçalho de `rotacao.service.ts`.
 */
@Global()
@Module({
  providers: [CofreService],
  exports: [CofreService],
})
export class CofreModule {}
