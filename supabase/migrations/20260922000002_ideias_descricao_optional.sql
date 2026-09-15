-- A ideia agora pode ser só áudio: descrição em texto e áudio (audio_transcript)
-- são duas formas alternativas de registrar o conteúdo, não uma exigindo a outra.
-- A UI (CRM e Hub) continua exigindo pelo menos um dos dois no submit; o banco
-- só solta a obrigatoriedade de texto para permitir isso.
alter table ideias alter column descricao drop not null;
