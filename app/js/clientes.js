// clientes.js — CRUD de clientes + alertas de recompra. STUB: spec abaixo.
//
// Dados: monjaro.clientes (nome, contato, frequencia[dias], dose?). Soft delete.
// Acesso ao banco SEMPRE via ./db.js. Telas/fluxo em ui.md → Clientes e Início.
//
// Responsabilidades:
//   - listar()            → clientes ativos (is_active = true), ordenáveis por nome.
//   - salvar(cliente)     → insert/update (modal). Campos: nome*, contato*, frequencia*, dose?.
//   - remover(id)         → soft delete (is_active=false), com confirmação na UI.
//   - statusRecompra(c)   → calcula { ultimo_pedido, proxima_recompra, dias_restantes, status }
//                           status ∈ atrasado|alerta|ok|sem_pedido (regra em business-rules.md §1).
//                           Pode usar a view monjaro.v_cliente_recompra + data LOCAL do device.
//   - alertas()           → clientes com status ∈ {atrasado, alerta}, ordenados por
//                           proxima_recompra asc (consumido pela tela Início).
//   - whatsappLink(c)     → monta https://wa.me/<numero>?text=<msg> (business-rules.md §5).
//
// Render: usar textContent (não innerHTML de dado cru) — XSS. Ver security.md.

import { db } from './db.js';

// TODO: implementar conforme spec acima. Ver business-rules.md §1 e §5, ui.md.
export {};
