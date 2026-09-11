-- RODAR EM PRODUÇÃO ANTES DO MERGE DA ONDA 6
--
-- Por quê: a fatia 2.3 mudou, de propósito, o que acontece quando a janela horária de uma
-- política é ilegível. Antes o sinal ficava calado; agora ele acende. Acender sobe um degrau
-- e nunca bloqueia sozinho, mas sobe em TODA ação daquela empresa.
--
-- Como ler o resultado:
--   zero linhas          -> a mudança é inócua, pode seguir.
--   linha com orgId nulo -> é a política BASE: afeta todas as empresas.
--   qualquer outra linha -> aquela empresa passa a ter o sinal aceso em toda ação,
--                           um degrau a mais em cada uma.
--
-- Se aparecer alguma, a escolha é do Pedro: consertar o documento ou segurar a mudança.

SELECT v."orgId", o.slug, v.versao,
       v.documento->'limitesPadrao'->>'janelaHoraria' AS janela
  FROM "PolicyVersion" v
  LEFT JOIN "Org" o ON o.id = v."orgId"
 WHERE v."ativaAte" IS NULL
   AND ( v.documento->'limitesPadrao'->'janelaHoraria' IS NULL
      OR jsonb_typeof(v.documento->'limitesPadrao'->'janelaHoraria') <> 'array'
      OR jsonb_array_length(v.documento->'limitesPadrao'->'janelaHoraria') <> 2
      OR v.documento->'limitesPadrao'->'janelaHoraria'->>0 !~ '^(2[0-3]|[01]?[0-9]):[0-5][0-9]$'
      OR v.documento->'limitesPadrao'->'janelaHoraria'->>1 !~ '^(2[0-3]|[01]?[0-9]):[0-5][0-9]$' );
