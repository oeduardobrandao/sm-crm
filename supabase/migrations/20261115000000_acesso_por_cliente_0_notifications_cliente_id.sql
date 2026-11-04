-- Acesso por cliente, Migração 0: o cliente da notificação (só a coluna).
-- Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md
--
-- Sozinha de propósito. ADD COLUMN pega ACCESS EXCLUSIVE em notifications e só
-- o solta no commit; nullable e sem default é só catálogo (instantâneo), então
-- a trava dura o tempo de conseguir a fila de locks. O backfill (UPDATE em
-- lotes, 20261115000013) e o índice (20261115000014) vêm depois, cada um na
-- sua transação, para nenhum dos dois correr sob essa trava nem sob a de
-- workspace_members da 20261115000001.
-- Linhas com cliente_id NULL seguem visíveis a todo destinatário (é o
-- comportamento de hoje); só passam a ser filtradas quando o backfill grava o
-- cliente. Ninguém é restrito antes de a flag ser ligada, então a janela entre
-- as migrações não expõe nada.

-- Sem FK: excluir o cliente deixa o id, inofensivo (nenhum cliente o terá).
ALTER TABLE public.notifications ADD COLUMN cliente_id bigint NULL;
