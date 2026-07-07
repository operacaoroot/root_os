import { Global, Module } from '@nestjs/common';
import { LLM_PROVIDER } from './llm.provider';
import { OpenAiProvider } from './openai.provider';

// Escolhe o provider por env LLM_PROVIDER (default: openai — temporário).
// Trocar por Claude no futuro = registrar AnthropicProvider aqui, nada mais muda.
@Global()
@Module({
  providers: [
    OpenAiProvider,
    {
      provide: LLM_PROVIDER,
      useFactory: (openai: OpenAiProvider) => {
        const chosen = process.env.LLM_PROVIDER ?? 'openai';
        switch (chosen) {
          case 'openai':
          default:
            return openai;
        }
      },
      inject: [OpenAiProvider],
    },
  ],
  exports: [LLM_PROVIDER],
})
export class LlmModule {}
