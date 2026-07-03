# Segurança — Mounjaro

App pessoal, single-user, estático + Supabase. O modelo de segurança é diferente do framework herdado (que tinha backend, credenciais privilegiadas de AD/SQL e rede corporativa). Aqui o ponto sensível é: **a `anon key` e o `APP_TOKEN` vão para o browser**. Este documento explica o que isso significa e como proteger os dados.

## Dados em jogo

- Nomes e contatos (WhatsApp) de clientes, valores de venda, frequência de compra, financeiro. É **PII** e informação comercial sensível (revenda de medicamento a conhecidos). Vazamento é constrangedor e potencialmente prejudicial — tratar com cuidado, mesmo sendo "pessoal".

## Modelo de ameaça (resumido)

| Ameaça | Vetor | Mitigação |
|---|---|---|
| Vazamento da `anon key` | Está no JS do browser (inevitável em app estático) | **RLS** no schema `monjaro`: a anon key sozinha não deve poder ler/escrever sem passar pela policy. Ver abaixo. |
| `APP_TOKEN` exposto | Vai para `env.js` no browser | É um portão de conveniência, **não** um segredo de servidor. Não dá acesso ao banco por si só — quem protege o dado é a RLS. Rotacionável. |
| Acesso não autorizado à URL do app | Alguém abre a URL | Login por `APP_TOKEN` + (produção) HTTPS + rede restrita/URL não pública. |
| `.env` / `env.js` commitados | Erro de git | Ambos gitignored; conferir antes do primeiro commit. |
| Abuso da API do Supabase | Requisições diretas com a anon key | RLS + (Supabase) rate limiting do plano; monitorar logs/uso no dashboard. |
| XSS injetando script | Conteúdo do usuário renderizado sem escape | Escapar tudo que vem do banco ao renderizar no DOM (sem `innerHTML` de dado cru). |

## A verdade sobre `anon key` + `APP_TOKEN` no browser

- App **estático** não tem como esconder segredos do cliente. A `anon key` é projetada para ser pública **desde que** a RLS proteja as linhas.
- O `APP_TOKEN` aqui **não** é um segredo criptográfico de servidor — é uma trava simples para evitar que alguém que abriu a URL use o app. Não confie nele como única defesa dos dados.
- **A defesa real dos dados é a RLS no Postgres.** Se a RLS estiver permissiva ("anon pode tudo"), qualquer um com a anon key (que está no browser de qualquer visitante) lê o banco inteiro. Isso é o erro a evitar.

## RLS — estratégia para single-user

Como não há Supabase Auth, não há `auth.uid()` para amarrar policies a um usuário. Opções, em ordem de robustez:

1. **(Recomendado p/ dados sensíveis) Não usar a anon key para dados.** Mover o acesso a dados para uma função/endpoint que valide o `APP_TOKEN` no servidor (Edge Function do Supabase) e use a `service_role` apenas lá. O browser só fala com a Edge Function passando o token. Assim a anon key não dá acesso direto às tabelas.
2. **(MVP simples) RLS com gate por header/claim.** Manter RLS ativa e escrever policies que só liberam quando uma condição controlada é satisfeita (ex.: um `request.header` / config setada via PostgREST). Mais frágil que (1), mas melhor que liberar geral.
3. **(Aceitável só para protótipo descartável)** anon com policies de leitura/escrita amplas + URL privada + HTTPS. **Não usar com dados reais de clientes** sem ao menos avaliar (1).

> Decisão para o MVP: ativar RLS em todas as tabelas no `001_schema.sql` (negar por padrão) e **decidir entre (1) e (2) antes de colocar dados reais**. Não publicar com RLS aberta. Registrar a escolha como ADR quando feita.

```sql
-- 001_schema.sql — RLS ligada, default deny (policies definidas conforme a estratégia escolhida)
ALTER TABLE monjaro.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE monjaro.compras  ENABLE ROW LEVEL SECURITY;
ALTER TABLE monjaro.pedidos  ENABLE ROW LEVEL SECURITY;
-- Sem policy = ninguém acessa. Adicionar policies conforme estratégia (Edge Function/service_role ou gate).
```

## Controles no código

- **Único ponto de acesso ao banco**: `app/js/db.js`. Facilita auditar e, se migrar para Edge Function, troca-se só esse arquivo.
- **Comparação do token em tempo constante**: não usar `digitado === APP_TOKEN` direto (timing). Usar comparação de tamanho fixo / `crypto.subtle` digest dos dois lados e comparar os hashes.
- **Sem segredos no código**: tudo via `.env` → `env.js` → `config.js`. Nada hardcoded.
- **Nunca logar** `APP_TOKEN`, `SUPABASE_ANON_KEY` (nem em `console.log` em produção).
- **Escapar saída**: ao renderizar nome/contato/observações no DOM, usar `textContent` (não `innerHTML`) ou escapar — evita XSS via dado do cliente.
- **HTTPS em produção**: token e dados não devem trafegar em claro fora da rede local.

## Configuração segura

| Item | Default seguro | Verificar |
|---|---|---|
| `.env` no repo | ❌ nunca | `.gitignore` + `git check-ignore .env` |
| `env.js` no repo | ❌ nunca | gitignored; é gerado em runtime |
| RLS nas tabelas | ✅ ligada (deny) | policies definidas pela estratégia escolhida |
| Schema `monjaro` exposto | só o necessário | API → Exposed schemas = `monjaro` |
| Container | não-root, `cap_drop:[ALL]`, `read_only`, `no-new-privileges` | `docker-compose.yml` |
| TLS | obrigatório em produção | proxy/cert |

## Container hardening (`docker-compose.yml`)

```yaml
cap_drop: [ALL]
security_opt: [no-new-privileges:true]
read_only: true
tmpfs: [/tmp, /var/cache/nginx, /var/run]
```
nginx:alpine roda como não-root por padrão nas imagens recentes; se servir em :80 exigir root, mapear porta alta interna (ex.: 8080) e expor via host.

## Checklist pré-produção

- [ ] `.env` e `env.js` ausentes do repo (conferir `git check-ignore`)
- [ ] RLS ligada em `clientes`, `compras`, `pedidos` com policies **não** abertas
- [ ] Estratégia de acesso decidida: Edge Function + service_role **ou** gate controlado (registrar ADR)
- [ ] `APP_TOKEN` forte (`openssl rand -hex 32`) e comparação em tempo constante
- [ ] HTTPS ativo; app não exposto publicamente sem necessidade
- [ ] Saída renderizada com escape (sem `innerHTML` de dado cru)
- [ ] Backup/export do schema antes de migrations grandes
- [ ] Monitorar uso/logs do projeto no dashboard do Supabase

## Pendências / dívidas

- [ ] Decidir e implementar a estratégia RLS definitiva (Edge Function recomendada para dados reais).
- [ ] Avaliar mover toda escrita/leitura para Edge Function validando `APP_TOKEN` — tira a anon key do caminho dos dados.
- [ ] Rate limiting / alerta de uso anômalo no Supabase.
