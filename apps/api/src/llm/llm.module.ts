import { Global, Module } from '@nestjs/common';
import { LLM_PROVIDER } from './llm.provider';
import { OpenAiProvider } from './openai.provider';
import { AnthropicProvider } from './anthropic.provider';

// Escolhe o provider por env LLM_PROVIDER. O default é `anthropic` (Claude) —
// era a meta declarada desde a Fase 2; o OpenAI segue disponível e continua
// sendo quem gera embeddings (não há endpoint de embedding na Anthropic).
@Global()
@Module({
  providers: [
    OpenAiProvider,
    AnthropicProvider,
    {
      provide: LLM_PROVIDER,
      useFactory: (openai: OpenAiProvider, anthropic: AnthropicProvider) => {
        const escolhido = process.env.LLM_PROVIDER ?? 'anthropic';
        switch (escolhido) {
          case 'openai':
            return openai;
          case 'anthropic':
          default:
            return anthropic;
        }
      },
      inject: [OpenAiProvider, AnthropicProvider],
    },
  ],
  exports: [LLM_PROVIDER],
})
export class LlmModule {}
