# Design system — Monjaro

App pessoal, **não** institucional. Não há marca corporativa a respeitar — a identidade é a do próprio app: **dark mode roxo, mobile-first, limpo**. Estes tokens vêm do protótipo aprovado no chat e são a referência para `app/css/style.css`.

> Não confundir com o framework herdado (que trazia uma marca verde/dourada institucional). Aqui é roxo escuro, e a fonte é a do sistema.

## Princípios visuais

- **Mobile first absoluto** — desenhado para a tela do celular, uma coluna, alvos de toque ≥ 44px.
- **Dois temas** (ADR-012): **claro por padrão** + escuro estilo Dracula, alternados por toggle no header (`html[data-theme]`, persistido em `localStorage['monjaro.theme']`, aplicado antes do primeiro paint por script inline no `<head>`).
- **Roxo como cor de marca** — destaques, navegação ativa, botões primários.
- **Cartões arredondados** (`border-radius` generoso) sobre fundo escuro.
- **Hierarquia por cor de status** — verde/amarelo/vermelho para pagamento, entrega e recompra.

## Paleta — CSS custom properties (dois temas)

Definidos em `app/css/style.css` sob `html[data-theme="light"]` (padrão, também em `:root`) e `html[data-theme="dark"]` (Dracula):

```css
:root, html[data-theme="light"] {
  --primary: #6C63FF;  --primary-dark: #5A52D5;  --on-primary: #FFFFFF;
  --success: #1FA85C;  --warning: #C07C10;       --danger: #D93025;   /* escurecidos p/ contraste */
  --dark: #F4F5FA;     --card: #FFFFFF;          --card2: #4E46C8;
  --text: #1E2235;     --text-muted: #6B7285;    --border: #E3E5F0;
  --shadow: 0 1px 3px rgba(30, 34, 53, .08);
}

html[data-theme="dark"] {  /* paleta Dracula — suave, sem quase-preto */
  --primary: #BD93F9;  --primary-dark: #A679F0;  --on-primary: #282A36;
  --success: #50FA7B;  --warning: #FFB86C;       --danger: #FF5555;
  --dark: #282A36;     --card: #343746;          --card2: #44475A;
  --text: #F8F8F2;     --text-muted: #9AA5CE;    --border: #44475A;
  --shadow: none;
}
```

Convenções: `--dark` segue sendo o nome do fundo da página (compat.); texto sobre `--primary` usa `--on-primary` (no dark o roxo Dracula é claro → texto escuro); cards levam `box-shadow: var(--shadow)` (só visível no claro).

### Badges de status (helpers prontos)
Fundos derivados por `color-mix` para funcionarem nos dois temas:
```css
.badge-green  { background: color-mix(in srgb, var(--success) 16%, transparent);    color: var(--success); }
.badge-yellow { background: color-mix(in srgb, var(--warning) 16%, transparent);    color: var(--warning); }
.badge-red    { background: color-mix(in srgb, var(--danger) 16%, transparent);     color: var(--danger);  }
.badge-purple { background: color-mix(in srgb, var(--primary) 16%, transparent);    color: var(--primary); }
.badge-gray   { background: color-mix(in srgb, var(--text-muted) 16%, transparent); color: var(--text-muted); }
```

### Mapa cor → significado (usar consistente em todo o app)
| Cor | Pagamento | Entrega | Recompra |
|---|---|---|---|
| Verde (`--success`) | pago | entregue | ok (> 10 dias) |
| Amarelo (`--warning`) | parcial | separado | alerta (≤ 10 dias) |
| Vermelho (`--danger`) | pendente | — | atrasado |
| Cinza (`--text-muted`) | — | aguardando | — |

## Tipografia

Fonte do sistema (sem dependência de CDN de fontes — performance no celular):

```css
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: var(--text);
  background: var(--dark);
}
```

| Uso | Tamanho | Peso |
|---|---|---|
| Título do header | 20px | 700 |
| Valor de KPI (summary card) | 22px | 700 |
| Título de item/card | 15px | 600 |
| Corpo | 14–15px | 400 |
| Label/caption/meta | 11–12px | 400 |
| Label de nav (bottom-nav) | 10px | 500 |

## Componentes (contrato visual)

### Header
- `position: sticky; top: 0`, gradiente `linear-gradient(135deg, var(--primary), var(--card2))`.
- Título (ex.: "Gestão Monjaro") + subtítulo curto em `rgba(255,255,255,.7)`.

### Bottom navigation (5 abas)
- `position: fixed; bottom: 0`, fundo `var(--card)`, borda-topo `var(--border)`.
- Itens: ícone (SVG 22px) + label 10px. Ativo = `var(--primary)`; inativo = `var(--text-muted)`.
- Respeitar `env(safe-area-inset-bottom)` (notch).

### Cards
- Fundo `var(--card)`, `border-radius: 16px`, borda `1px var(--border)`, `padding: 16px`.
- `.summary-card` (KPI): label 11px muted + valor 22px colorido por status.

### Botões
- `.btn-primary`: fundo `var(--primary)`, texto branco, largura total nos forms; `:active` usa `--primary-dark` + `scale(.98)`.
- `.btn-outline`: transparente, borda `var(--border)`.
- `.btn-danger`: fundo `var(--danger)` — sempre confirmar antes de ação destrutiva (que é soft delete).
- Toque mínimo 44px; `.btn-sm` para ações inline em listas.

### Formulários
- `.form-input`: fundo `var(--dark)`, borda `var(--border)`, `border-radius: 10px`, foco em `var(--primary)`.
- Labels em `var(--text-muted)`, 13px.

### Modais (cadastro/edição)
- Overlay `rgba(0,0,0,.7)`; modal ancorado embaixo (`align-items: flex-end`), `border-radius: 24px 24px 0 0`, animação `slideUp .3s`.
- "Handle" (barra de 40×4px) no topo do modal.

### Listas / itens
- `.list-item`: card com info à esquerda (título 15px + sub 12px muted) e ações à direita.
- `.tabs`: chips roláveis horizontais; ativa em `var(--primary)`.
- `.empty`: estado vazio centralizado, ícone 48px opacidade .4 + texto muted.

## Tom de voz na UI (PT-BR, pessoal e direto)

| Situação | Texto sugerido |
|---|---|
| Empty state — clientes | "Nenhum cliente ainda. Toque em + para cadastrar." |
| Empty state — alertas | "Ninguém para acionar nos próximos 10 dias. 🎉" |
| Confirmar exclusão | "Remover [nome]? Ele sai das listas, mas o histórico continua." |
| Sucesso ao salvar | "Salvo." (curto; sem floreio) |
| Erro de conexão | "Não consegui falar com o banco. Confere a conexão e tenta de novo." |
| Loading | "Carregando..." |

Pode usar emoji com parcimônia (é um app pessoal) — sem exageros em telas operacionais.

## WhatsApp
Botão verde (`--success`) abrindo `https://wa.me/<numero>` com mensagem pré-preenchida de recompra. Regra de montagem do número/mensagem em `business-rules.md`.

## Acessibilidade mínima
- Contraste de texto sobre `--dark`/`--card` confortável (texto claro sobre fundo escuro).
- Não comunicar status **só** por cor — acompanhar com label textual ("Pago", "Atrasado").
- `maximum-scale=1.0` no viewport para evitar zoom acidental em inputs (já no protótipo).
