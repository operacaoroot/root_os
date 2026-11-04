-- Metadado privado; não presume a origem de versões existentes.
ALTER TABLE "SalaVersao" ADD COLUMN "origemCliente" JSONB;
ALTER TABLE "SalaVersao" ADD CONSTRAINT "SalaVersao_origemCliente_formato" CHECK (
  "origemCliente" IS NULL OR (
    jsonb_typeof("origemCliente") = 'object'
    AND "origemCliente" ? 'versao'
    AND "origemCliente"->'versao' = '1'::jsonb
    AND "origemCliente" ? 'clienteId'
    AND jsonb_typeof("origemCliente"->'clienteId') IN ('string', 'null')
  )
);
