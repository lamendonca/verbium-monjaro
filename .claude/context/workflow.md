# Workflow de desenvolvimento — Monjaro

Convenção de branches, commits e merges. Aplicável por Claude em cada feature. Herdado do framework original e adaptado aos escopos do Monjaro.

> Nota: o projeto ainda **não é um repositório git** (`git init` quando for versionar). Até lá, "branch/merge" não se aplica; commits semânticos passam a valer no primeiro `git init`.

## Branches

- **`main`**: estável. Sem commits diretos (exceto bootstrap/docs) — só via merge.
- **Feature**: `<tipo>/<slug>`:

| Prefixo | Quando usar | Exemplo |
|---|---|---|
| `feat/` | nova funcionalidade | `feat/tela-clientes` |
| `fix/` | correção de bug | `fix/estoque-decremento` |
| `chore/` | docs, refactor, deps | `chore/atualiza-supabase-js` |
| `security/` | correção de segurança | `security/rls-clientes` |

Slug kebab-case, 4–5 palavras.

## O que conta como "feature relevante" (cria branch)

- Nova tela/módulo (`clientes`, `pedidos`, `compras`, `financeiro`).
- Migration SQL (`sql/NNN_*.sql`).
- Bug fix com > 5 linhas.
- Mudança em `docker-compose.yml`, `nginx.conf` ou injeção de env.
- Mudança na estratégia de RLS/auth.

**Não** cria branch (commit direto com aprovação): typo em docs, atualizar `Estado atual` no `CLAUDE.md`, ajuste de comentário.

## Fluxo padrão

```bash
git checkout main && git pull --ff-only
git checkout -b feat/<slug>

# implementar + commits semânticos
git add <arquivos-específicos>
git commit -m "feat(<escopo>): descrição curta"

git push -u origin feat/<slug>

# merge squash em main
git checkout main
git merge --squash feat/<slug>
git commit -m "feat(<escopo>): descrição agregada"
git push origin main

git push origin --delete feat/<slug>
git branch -D feat/<slug>
```

## Commits (Conventional Commits)

Formato: `<tipo>(<escopo>): <descrição>`. Escopos típicos: `clientes`, `pedidos`, `compras`/`estoque`, `financeiro`, `auth`, `ui`, `db`, `nginx`, `docker`, `sql`.

```
feat(clientes): adiciona cadastro e status de recompra
feat(pedidos): vincula pedido ao lote e baixa estoque
feat(financeiro): lucro por lote e por cliente
fix(estoque): corrige devolução de qtd_disp no soft delete
security(auth): comparação de token em tempo constante
chore(sql): adiciona view v_lucro_por_lote
```

**Sem emoji nos commits.** Sem co-author Claude (a menos que pedido).

## Antes de commitar — checklist

- [ ] `.env` e `app/env.js` **não** estão no stage (`git status` / `git check-ignore`).
- [ ] Nenhuma credencial hardcoded no código (URL/anon key/token só via `config.js`).
- [ ] Acesso ao banco passa por `app/js/db.js`.
- [ ] Migration nova é numerada e idempotente (se houver mudança de schema).
- [ ] `Estado atual` no `CLAUDE.md` atualizado se fechou feature.

## Sem CI no MVP

Não há pipeline (sem toolchain Python/JS de build). Verificação é manual: abrir o app, testar o fluxo, conferir o checklist acima. Se um dia houver lint/format JS, registrar aqui.

## Para o Claude assistente

- Implementação relevante: **branch antes** de editar (quando o projeto já for git).
- Commits semânticos, um por unidade lógica (não "wip").
- Atualizar `Estado atual` no `CLAUDE.md` ao fechar feature.
- Se `gh` disponível: `gh pr create`; senão, squash-merge local + push.
