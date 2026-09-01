-- Ícone opcional por status customizado.
--
-- O valor é o nome kebab-case de um ícone lucide, curado por uma whitelist no
-- frontend (apps/crm/src/pages/entregas/statusIcons.ts); nomes fora da lista e
-- NULL caem no fallback existente, o dot da cor do status. Nenhum trigger ou
-- policy lê esta coluna.
--
-- Prefixo 20260831000010: 20260831000001/2 são das migrations do KB
-- (renumeradas no fix da colisão com 20260830000001..4 de posts avulsos).

ALTER TABLE post_status_definitions ADD COLUMN icone text;
