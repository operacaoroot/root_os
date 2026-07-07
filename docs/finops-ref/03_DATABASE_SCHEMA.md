# FullBPO FinOps OS — Schema do Banco de Dados (Supabase/PostgreSQL)

## Princípios do Schema

1. **Toda tabela tem `company_id`** — isolamento multi-tenant obrigatório
2. **RLS ativo em 100%** das tabelas via `user_can_access_company(uid, company_id)`
3. **Soft delete** — nunca deletar dados financeiros, usar `deleted_at` ou mudança de status
4. **Audit log automático** — triggers em todas as tabelas financeiras
5. **TypeScript strict** — tipos gerados via `supabase gen types typescript`

---

## Função de Segurança (Base de Tudo)

```sql
CREATE OR REPLACE FUNCTION user_can_access_company(uid UUID, company_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = uid
    AND company_id = $2
    AND active = true
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

---

## Tabelas

### `companies` — Tenants
```sql
CREATE TABLE companies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  razao_social  TEXT NOT NULL,
  nome_fantasia TEXT,
  cnpj          TEXT UNIQUE NOT NULL,
  email         TEXT,
  telefone      TEXT,
  logo_url      TEXT,
  status        TEXT DEFAULT 'trial' 
                CHECK (status IN ('trial','ativo','suspenso','inativo','arquivado')),
  segmento      TEXT,
  config        JSONB DEFAULT '{}',
  -- config inclui: limite_aprovacao (default 5000), dias_inadimplencia (default 3)
  -- (credenciais Omie NÃO ficam aqui — usam Vault, ver colunas abaixo)

  -- Credenciais Omie ERP (Vault — migration 20260512142839_omie_credentials.sql)
  omie_vault_key_id    UUID,   -- vault.secrets.id do app_key (oculto por GRANT)
  omie_vault_secret_id UUID,   -- vault.secrets.id do app_secret (oculto por GRANT)
  omie_status          JSONB DEFAULT '{}',
  -- omie_status: { ativo: bool, ultimo_teste: timestamptz, ultimo_erro: text|null }

  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
```

**RPCs Omie (acesso a credenciais — nunca SELECT direto nos vault_ids):**
```sql
-- Admin grava/rotaciona credenciais (verifica role admin_fullbpo/super_admin)
SELECT set_omie_credentials(p_company_id UUID, p_app_key TEXT, p_app_secret TEXT);

-- Edge Function (service_role) lê credenciais decriptadas para chamar a Omie
SELECT * FROM get_omie_credentials(p_company_id UUID);  -- service_role only

-- Edge Function persiste resultado do teste de conexão (ativo / ultimo_teste / ultimo_erro)
SELECT test_omie_connection_result(p_company_id UUID, p_ok BOOLEAN, p_erro TEXT);
```

**Ciclo de vida do status:**
`trial → ativo → suspenso → inativo` (90 dias preservação) `→ arquivado`

---

### `user_roles` — Fonte Única de Verdade de Permissões
```sql
CREATE TABLE user_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role        TEXT NOT NULL 
              CHECK (role IN ('super_admin','admin_fullbpo','supervisor','operador','cliente')),
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, company_id)
);
```

---

### `plano_contas` — Plano de Contas Hierárquico
```sql
CREATE TABLE plano_contas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id),
  parent_id   UUID REFERENCES plano_contas(id),
  codigo      TEXT NOT NULL,        -- ex: 1.1.01
  nome        TEXT NOT NULL,
  tipo        TEXT NOT NULL 
              CHECK (tipo IN ('receita','despesa','ativo','passivo','neutro')),
  nivel       INTEGER NOT NULL      -- 1=Grupo, 2=Subgrupo, 3=Conta Folha
              CHECK (nivel BETWEEN 1 AND 3),
  permite_lancamento BOOLEAN DEFAULT false, -- true apenas no nível 3
  dre_conta   TEXT,                 -- mapeamento para DRE
  tipo_gasto  TEXT,                 -- mapeamento fiscal
  ativo       BOOLEAN DEFAULT true,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, codigo)
);
```

**Regras:** Lançamentos só em nível 3. Conta com lançamentos não pode ser deletada (apenas desativada).

**Prefixos de código:**
- `1.x.x` — Receitas
- `2.x.x` — Despesas
- `3.x.x` — Ativos
- `4.x.x` — Passivos

---

### `fornecedores_clientes` — Cadastro Unificado
```sql
CREATE TABLE fornecedores_clientes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id),
  tipo            TEXT[] DEFAULT '{}',  -- ['cliente'], ['fornecedor'], ou ambos
  razao_social    TEXT NOT NULL,
  nome_fantasia   TEXT,
  cnpj_cpf        TEXT,
  email           TEXT,
  telefone        TEXT,
  contato         TEXT,
  cidade          TEXT,
  estado          TEXT,
  endereco        TEXT,
  bairro          TEXT,
  cep             TEXT,
  banco           TEXT,
  agencia         TEXT,
  conta_corrente  TEXT,
  tags            TEXT[],
  ativo           BOOLEAN DEFAULT true,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

---

### `contas_bancarias` — Contas do Cliente
```sql
CREATE TABLE contas_bancarias (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id),
  nome        TEXT NOT NULL,
  banco       TEXT NOT NULL,
  agencia     TEXT,
  conta       TEXT,
  tipo        TEXT DEFAULT 'corrente'
              CHECK (tipo IN ('corrente','poupanca','investimento','caixa')),
  saldo_atual NUMERIC(15,2) DEFAULT 0,  -- atualizado via conciliação
  ativo       BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

> **Importante:** `saldo_atual` não é editável manualmente — atualizado via conciliação.

---

### `contratos` — Contratos e Recorrência
```sql
CREATE TABLE contratos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  tipo              TEXT NOT NULL CHECK (tipo IN ('pagar','receber')),
  contraparte_id    UUID REFERENCES fornecedores_clientes(id),
  descricao         TEXT,
  valor             NUMERIC(15,2) NOT NULL,
  dia_vencimento    INTEGER CHECK (dia_vencimento BETWEEN 1 AND 28),
  periodicidade     TEXT DEFAULT 'mensal'
                    CHECK (periodicidade IN ('semanal','quinzenal','mensal','bimestral','trimestral','semestral','anual')),
  data_inicio       DATE NOT NULL,
  data_fim          DATE,
  proximo_vencimento DATE,
  categoria_id      UUID REFERENCES plano_contas(id),
  conta_bancaria_id UUID REFERENCES contas_bancarias(id),
  indexador         TEXT DEFAULT 'fixo'
                    CHECK (indexador IN ('fixo','igpm','ipca','cdi')),
  status            TEXT DEFAULT 'ativo'
                    CHECK (status IN ('ativo','pausado','encerrado')),
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
```

---

### `contas_pagar` — AP (Accounts Payable)
```sql
CREATE TABLE contas_pagar (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  fornecedor_id     UUID REFERENCES fornecedores_clientes(id),
  contrato_id       UUID REFERENCES contratos(id),
  numero_documento  TEXT,
  parcela           TEXT,              -- ex: "003/012"
  descricao         TEXT,
  valor             NUMERIC(15,2) NOT NULL,
  valor_pago        NUMERIC(15,2) DEFAULT 0,
  desconto          NUMERIC(15,2) DEFAULT 0,
  juros_multa       NUMERIC(15,2) DEFAULT 0,
  data_emissao      DATE,
  data_vencimento   DATE NOT NULL,
  data_pagamento    DATE,
  categoria_id      UUID REFERENCES plano_contas(id),
  conta_bancaria_id UUID REFERENCES contas_bancarias(id),
  tipo_documento    TEXT,
  nota_fiscal       TEXT,
  comprovante_url   TEXT,
  status            TEXT DEFAULT 'a_vencer'
                    CHECK (status IN ('a_vencer','vencido','pago','cancelado')),
  aprovacao_status  TEXT DEFAULT 'aprovado'
                    CHECK (aprovacao_status IN ('aprovado','aguardando_aprovacao','rejeitado')),
  aprovado_por      UUID REFERENCES auth.users(id),
  aprovado_em       TIMESTAMPTZ,
  motivo_rejeicao   TEXT,
  observacao        TEXT,
  tags              TEXT[],
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
```

**Regras de negócio:**
- Títulos com `valor > config.limite_aprovacao` (padrão R$5.000) → `aprovacao_status = 'aguardando_aprovacao'`
- Bloqueio de duplicidade: mesmo fornecedor + valor ±0.01 + vencimento ±3 dias
- Cancelamento via soft delete com `deleted_at`
- Auto-aprovação após 48h pendente (via workflow n8n)

---

### `contas_receber` — AR (Accounts Receivable)
```sql
CREATE TABLE contas_receber (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  cliente_id        UUID REFERENCES fornecedores_clientes(id),
  contrato_id       UUID REFERENCES contratos(id),
  numero_documento  TEXT,
  parcela           TEXT,
  descricao         TEXT,
  valor             NUMERIC(15,2) NOT NULL,
  valor_recebido    NUMERIC(15,2) DEFAULT 0,
  desconto          NUMERIC(15,2) DEFAULT 0,
  juros_multa       NUMERIC(15,2) DEFAULT 0,
  data_emissao      DATE,
  data_vencimento   DATE NOT NULL,
  data_recebimento  DATE,
  categoria_id      UUID REFERENCES plano_contas(id),
  conta_bancaria_id UUID REFERENCES contas_bancarias(id),
  tipo_documento    TEXT,
  numero_boleto     TEXT,
  chave_pix         TEXT,           -- para conciliação automática
  comprovante_url   TEXT,
  forma_recebimento TEXT
                    CHECK (forma_recebimento IN ('pix','boleto','ted','dinheiro','cartao_debito','cartao_credito')),
  inadimplente      BOOLEAN DEFAULT false,
  dias_atraso       INTEGER DEFAULT 0,
  status            TEXT DEFAULT 'a_vencer'
                    CHECK (status IN ('a_vencer','vencido','recebido','cancelado')),
  observacao        TEXT,
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
```

**Régua de Cobrança (via n8n):**
- D-3: lembrete ao cliente
- D+1: notificação de vencido
- D+5: cobrança urgente
- D+15: tarefa de cobrança formal para operador

---

### `movimentos_bancarios` — Extrato Importado
```sql
CREATE TABLE movimentos_bancarios (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  conta_bancaria_id UUID NOT NULL REFERENCES contas_bancarias(id),
  fitid             TEXT,           -- ID único do OFX para anti-duplicidade
  data_movimento    DATE NOT NULL,
  valor             NUMERIC(15,2) NOT NULL,
  tipo              TEXT CHECK (tipo IN ('credito','debito')),
  descricao         TEXT,
  conciliado        BOOLEAN DEFAULT false,
  conciliacao_id    UUID REFERENCES conciliacoes(id),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
```

---

### `conciliacoes` — Registros de Conciliação
```sql
CREATE TABLE conciliacoes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID NOT NULL REFERENCES companies(id),
  movimento_bancario_id UUID REFERENCES movimentos_bancarios(id),
  titulo_tipo           TEXT CHECK (titulo_tipo IN ('pagar','receber')),
  titulo_id             UUID,       -- referência genérica ao título
  score_match           NUMERIC(4,3), -- 0.000 a 1.000
  tipo_match            TEXT 
                        CHECK (tipo_match IN ('automatico','manual')),
  conciliado_por        UUID REFERENCES auth.users(id),
  data_conciliacao      TIMESTAMPTZ DEFAULT NOW(),
  company_id            UUID NOT NULL REFERENCES companies(id)
);
```

**Algoritmo de score:**
- Valor exato: +0.40
- Data exata: +0.30
- Contraparte match: +0.20
- Descrição similar: +0.10
- **Score ≥ 0.85 → conciliação automática**

---

### `docs_inbox` — Inbox de Documentos
```sql
CREATE TABLE docs_inbox (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id),
  nome_arquivo    TEXT NOT NULL,
  storage_path    TEXT NOT NULL,  -- bucket: inbox/{company_id}/{ano}/{mes}/
  tipo_doc        TEXT,           -- classificado por IA
                                  -- boleto, nfe_entrada, nfe_saida, extrato, comprovante, contrato
  valor           NUMERIC(15,2),  -- extraído por IA
  vencimento      DATE,           -- extraído por IA
  contraparte     TEXT,           -- extraído por IA
  score_confianca NUMERIC(4,3),   -- confiança da classificação IA
  status          TEXT DEFAULT 'pendente'
                  CHECK (status IN ('pendente','processado','rejeitado')),
  processado_por  UUID REFERENCES auth.users(id),
  processado_em   TIMESTAMPTZ,
  origem          TEXT DEFAULT 'upload'
                  CHECK (origem IN ('upload','email','whatsapp')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

**Roteamento automático por tipo:**
- `boleto` → contas_pagar
- `nfe_entrada` → contas_pagar
- `nfe_saida` → contas_receber
- `extrato` → conciliação bancária
- `comprovante` → baixa de título

---

### `tarefas` — Kanban de Operações
```sql
CREATE TABLE tarefas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id),
  titulo        TEXT NOT NULL,
  descricao     TEXT,
  tipo          TEXT,             -- conciliacao, pagamento, cobrança, rotina, etc.
  status        TEXT DEFAULT 'inbox'
                CHECK (status IN ('inbox','a_fazer','em_andamento','aguardando_cliente','aguardando_terceiro','concluido')),
  prioridade    TEXT DEFAULT 'normal'
                CHECK (prioridade IN ('urgente','alta','normal','baixa')),
  responsavel_id UUID REFERENCES auth.users(id),
  prazo         TIMESTAMPTZ,
  checklist     JSONB DEFAULT '[]',
  comentarios   JSONB DEFAULT '[]',
  anexos        TEXT[],
  created_by    UUID REFERENCES auth.users(id),
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
```

**Algoritmo de priorização (dashboard):**
1. Vencendo hoje
2. SLA < 2h
3. Aprovação > 48h
4. Conciliação > 2 dias
5. Inbox pendente

---

### `rotinas` — Checklist de Rotinas Cadenciadas
```sql
CREATE TABLE rotinas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id),
  tipo          TEXT NOT NULL CHECK (tipo IN ('diaria','semanal','mensal')),
  data_rotina   DATE NOT NULL,
  itens         JSONB NOT NULL,   -- [{id, titulo, concluido, concluido_em, concluido_por}]
  status        TEXT DEFAULT 'pendente'
                CHECK (status IN ('pendente','em_andamento','concluida','atrasada')),
  responsavel_id UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
```

**Geração automática (n8n, 08:00):**
- Diária (seg-sex): 6 itens padrão
- Semanal (segunda): 4 itens padrão
- Mensal (último dia útil): 6 itens padrão

---

### `acuracidade_snapshots` — Histórico do Índice
```sql
CREATE TABLE acuracidade_snapshots (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                UUID NOT NULL REFERENCES companies(id),
  data_snapshot             DATE NOT NULL,
  pct_contas_conciliadas    NUMERIC(5,2),
  pct_previsao_vs_orcado    NUMERIC(5,2),
  pct_bancos_sem_pendencia  NUMERIC(5,2),
  indice_acuracidade        NUMERIC(5,2),  -- média das 3 métricas
  total_titulos             INTEGER,
  titulos_conciliados       INTEGER,
  bancos_totais             INTEGER,
  bancos_sem_pendencia      INTEGER,
  created_at                TIMESTAMPTZ DEFAULT NOW()
);
```

---

### `audit_logs` — Logs Imutáveis (Insert Only)
```sql
CREATE TABLE audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID,
  user_id     UUID REFERENCES auth.users(id),
  tabela      TEXT NOT NULL,
  registro_id UUID,
  acao        TEXT NOT NULL CHECK (acao IN ('INSERT','UPDATE','DELETE','APPROVE','REJECT')),
  old_data    JSONB,
  new_data    JSONB,
  ip_address  INET,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Política de imutabilidade: apenas INSERT permitido
-- Retenção: 5 anos
```

---

## Views Úteis

### `v_indice_acuracidade_atual`
```sql
CREATE VIEW v_indice_acuracidade_atual AS
SELECT 
  company_id,
  -- % contas conciliadas
  ROUND(
    100.0 * SUM(CASE WHEN mb.conciliado THEN 1 ELSE 0 END) / NULLIF(COUNT(mb.id), 0), 2
  ) as pct_conciliadas,
  -- % bancos sem pendência
  ROUND(
    100.0 * COUNT(DISTINCT CASE WHEN NOT EXISTS (
      SELECT 1 FROM movimentos_bancarios mb2 
      WHERE mb2.conta_bancaria_id = mb.conta_bancaria_id 
      AND NOT mb2.conciliado
    ) THEN mb.conta_bancaria_id END) / NULLIF(COUNT(DISTINCT mb.conta_bancaria_id), 0), 2
  ) as pct_bancos_ok
FROM movimentos_bancarios mb
WHERE mb.data_movimento >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY company_id;
```

### `v_vencimentos_proximos`
Títulos CPA e CRE vencendo nos próximos 7 dias, ordenados por data.

### `v_inadimplencia`
Contas a receber com `inadimplente = true`, agrupadas por cliente com aging (0-30, 31-60, 61-90, 90+ dias).

---

## Triggers de Auditoria

```sql
-- Trigger genérico para audit_logs (aplicar em contas_pagar, contas_receber, 
-- movimentos_bancarios, conciliacoes)
CREATE OR REPLACE FUNCTION audit_trigger_fn()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (company_id, user_id, tabela, registro_id, acao, old_data, new_data)
  VALUES (
    COALESCE(NEW.company_id, OLD.company_id),
    auth.uid(),
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE row_to_json(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE row_to_json(NEW) END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## Exemplo de RLS Policy

```sql
-- Padrão para todas as tabelas financeiras
CREATE POLICY "company_isolation" ON contas_pagar
  FOR ALL USING (
    user_can_access_company(auth.uid(), company_id)
  );

-- Restrição adicional para admin
CREATE POLICY "admin_only_delete" ON companies
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
      AND role IN ('super_admin', 'admin_fullbpo')
      AND active = true
    )
  );
```

---

## Tipos TypeScript (gerados do Supabase)

Após criar o schema, gerar com:
```bash
supabase gen types typescript --project-id <project-id> > src/types/supabase.ts
```

Usar **sempre** os tipos gerados — nunca `any`.
