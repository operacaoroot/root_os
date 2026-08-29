import { Global, Module } from '@nestjs/common';
import { LLM_PROVIDER } from './llm.provider';
import { OpenAiProvider } from './openai.provider';
import { AnthropicProvider } from './anthropic.provider';
import { OpenRouterProvider } from './openrouter.provider';
import { env } from './env';

// Escolhe o provider por env LLM_PROVIDER: anthropic | openrouter | openai.
//
// O default segue `anthropic` (Claude pela API própria). O `openrouter` existe
// porque a operação já tem chave e crédito lá, e ele é a mesma API de Chat
// Completions com nome e custo próprios — ver openrouter.provider.ts.
//
// O OpenAI continua sendo quem gera embeddings: não há endpoint de embedding
// na Anthropic, e trocar isso mudaria os vetores já gravados.
//
// Provider escolhido sem credencial NÃO derruba o boot: `configured` fica
// falso e a chamada falha com mensagem clara, na hora do uso. Derrubar a API
// inteira por falta de chave de IA deixaria o painel fora do ar por causa de
// um recurso opcional.
@Global()
@Module({
  providers: [
    OpenAiProvider,
    AnthropicProvider,
    OpenRouterProvider,
    {
      provide: LLM_PROVIDER,
      useFactory: (
        openai: OpenAiProvider,
        anthropic: AnthropicProvider,
        openrouter: OpenRouterProvider,
      ) => {
        const escolhido = env('LLM_PROVIDER', 'anthropic');
        switch (escolhido) {
          case 'openai':
            return openai;
          case 'openrouter':
            return openrouter;
          case 'anthropic':
          default:
            return anthropic;
        }
      },
      inject: [OpenAiProvider, AnthropicProvider, OpenRouterProvider],
    },
  ],
  exports: [LLM_PROVIDER, OpenAiProvider],
})
export class LlmModule {}
