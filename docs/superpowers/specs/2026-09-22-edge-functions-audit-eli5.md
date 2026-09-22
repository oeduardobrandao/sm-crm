# Auditoria das Edge Functions, explicada de forma simples

Versão ELI5 do relatório técnico (`2026-09-22-edge-functions-capacity-audit.md`).
Imagine que o backend do Mesaas é uma cozinha de restaurante. Cada edge function é um cozinheiro com regras rígidas: cada um tem 256 MB de "bancada" (memória), no máximo ~6 minutos de trabalho por pedido, e o banco de dados só entrega **1000 itens por vez** quando ninguém diz quantos quer.

Hoje o restaurante atende: 74 workspaces, 292 clientes, 217 contas de Instagram conectadas, 175 portais de cliente ativos.

---

## 1. Quais limites estamos mais perto de estourar?

### O limite dos "1000 itens" (o mais perigoso, porque é silencioso)

Quando uma função pede dados ao banco sem dizer "me dá tudo, em partes", o banco entrega só os primeiros 1000 e **não avisa que faltou coisa**. Achamos 7 lugares assim. O que acontece quando cada um estourar:

- **Painel de MRR do admin**: a receita mensal exibida fica **errada**, sem nenhum erro na tela.
- **Relatórios mensais de Instagram**: contas a partir da número 1001 simplesmente **nunca entram na fila** de relatório.
- **Renovação de tokens (Instagram e TikTok)**: contas além do limite não renovam o token e a conexão **expira sozinha**.
- **Cobrança (Pagar.me)**: uma das etapas do cron de cobrança **quebra para sempre** quando passar de 1000 registros.
- **Radar de retenção**: o alerta semanal de clientes em risco passa a olhar só uma parte arbitrária da base, sem avisar.
- **Limpeza de posts express**: a lista de candidatos só cresce (hoje tem 26, então esse é o mais distante).

**Solução sem pagar nada a mais:** ensinar essas funções a pedir os dados em páginas ("me dá 1000, depois os próximos 1000...") ou fazer a conta dentro do próprio banco. Já existe exemplo pronto no código (`admin_list_workspaces` faz certo).

### O zip de arquivos pode "explodir a bancada"

Quando alguém baixa uma pasta como .zip, a função carrega **cada arquivo inteiro na memória** antes de zipar. Um arquivo de 200 MB já é maior que a bancada de 256 MB. Além disso, ela comprime vídeo e foto de novo, o que gasta CPU à toa (vídeo já é comprimido). E se uma consulta falhar no meio, o usuário pode receber um **zip incompleto sem nenhum aviso**.

**Solução:** passar o arquivo direto para o zip como uma "esteira" (streaming), sem carregar tudo de uma vez, desligar a compressão (modo "guardar sem comprimir") e, se algo falhar no meio, avisar o que ficou de fora em vez de entregar um zip capenga em silêncio.

### A lixeira enche mais rápido do que esvazia

Arquivos deletados vão para uma "lixeira" no R2. A faxina apaga no máximo **200 por dia**, mas podem entrar até ~1650 por dia. Se atrasar, a lixeira cresce e a faxina fica cada vez mais lenta, porque ela sempre recomeça a olhar do início.

**Solução:** dar à faxina um "marcador de página" (já existe esse mecanismo pronto em outra parte do mesmo cron) e tirar o teto de 200.

### O Instagram pode nos "dar um chega pra lá" sem a gente perceber

A sincronização pode fazer até ~380 chamadas à API da Meta por conta, por hora. Se a Meta começar a recusar (limite de uso), o código de hoje **não percebe**: marca a conta como sincronizada mesmo assim e segue em frente. Já hoje, 6 contas postam mais de 50 itens por mês e **perdem dados silenciosamente**, porque o código só busca os 50 mais recentes e não vira a página.

**Solução:** um "detector de porta fechada" único e compartilhado: se a Meta recusar, não marcar como sincronizado (para tentar de novo na próxima hora) e parar o lote mais cedo quando o medidor de uso da Meta passar de 90%.

---

## 2. Onde dá para ganhar performance?

### No portal do cliente (Hub), o maior ganho de todos

- Quando o cliente abre "Postagens", o servidor manda **todos os posts que ele já teve na vida**, com texto completo e 2-3 links assinados por mídia. E enquanto um post está publicando, a tela **rebaixa esse pacotão inteiro a cada 15 segundos**. É como pedir um copo d'água e receber a caixa d'água. Solução: mandar só o mês visível e buscar o texto completo só quando o post é aberto. (Não é troca de uma linha: as telas do Hub hoje leem tudo desse pacotão, então o contrato entre servidor e telas muda junto.)
- Cada requisição do Hub pergunta ao banco "esse plano tem tal recurso?" usando uma função cara. O `hub-bootstrap` pergunta **4 vezes na mesma requisição** e ainda faz 10 idas ao banco em fila indiana. Solução: perguntar uma vez só e fazer as idas independentes em paralelo.
- O "porteiro" (rate limit) só confere o crachá **depois** de já ter feito o trabalho caro, e quando o porteiro passa mal, ele **libera todo mundo**. Solução: conferir primeiro e, para tokens inválidos, fechar a porta em vez de abrir.
- Três tabelas do Hub não têm índice na coluna mais consultada: é como procurar um nome numa agenda **sem ordem alfabética**, a cada visita. Solução: criar 3 índices (uma linha de SQL cada).

### No CRM

- A aba de portfólio busca **todos os posts de Instagram do workspace, desde sempre**, a cada carregamento, só para descobrir a data do **último** post de cada conta (o "Último Post" da tela). Solução: perguntar direto ao banco "qual o post mais recente de cada conta?" (uma consulta agregada) e guardar em cache. O mesmo padrão está duplicado no próprio app do CRM e precisa do mesmo conserto.
- Se a Meta recusar uma chamada, a tela de analytics **fica 2 minutos parada esperando** (dorme 60s, tenta, dorme mais 60s). Solução: devolver o dado do cache na hora.
- Ao conectar uma conta de Instagram, o usuário espera no redirect enquanto o servidor faz ~150-200 idas ao banco **uma por uma**. O mesmo arquivo já tem a versão rápida (em lotes de 10); é só usar ela.

### Em todo lugar: chamadas sem "prazo de validade"

11 funções falam com o banco e ~30 chamadas falam com serviços externos (Stripe, Gemini, Gotenberg...) **sem timeout**. Se o outro lado travar, a função fica pendurada até morrer, sem log e sem alerta. O pior caso: o webhook do Stripe pode esperar **80 segundos** numa chamada. Solução: trabalho mecânico de copiar o padrão de timeout que já existe em outras funções.

---

## 3. Qual é o próximo grande gargalo quando a base crescer?

**A sincronização de Instagram, quando tivermos ~3-4x mais contas conectadas (600-800).**

Hoje o cron de sync processa 20-47 contas por hora tranquilamente. Mas ele é **um cozinheiro só, numa cozinha só**: quando os lotes ficarem cheios (100 contas), uma rodada vai levar mais tempo do que a plataforma permite para uma função (limite de ~2,5 a 6,5 min), e a rodada morre no meio. Aumentar os "dials" (variáveis de ambiente) não resolve: só deixa a rodada mais longa. É um teto que nenhuma configuração move.

**Solução (só lógica, sem upgrade):** transformar em "um chef + vários cozinheiros":

1. O cron (chef) só escolhe e carimba quais contas sincronizar.
2. Depois chama a função de novo várias vezes, cada chamada com uma **lista fixa de ~10 contas** para processar (sem escolher de novo, senão os cozinheiros brigam pelo mesmo pedido).
3. Cada chamada ganha sua própria bancada e seu próprio relógio: a capacidade passa a crescer junto com o número de contas.

E três ajudas baratas no mesmo pacote:

- **Buscar métricas de dias fechados 1x por dia** em vez de a cada hora (24x menos chamadas à Meta, mesmíssimo resultado).
- **Backfill de histórico**: hoje ele processa 3 conta-meses por hora, e se 3 contas problemáticas travarem, **ninguém mais avança, para sempre**. Dar a elas um contador de tentativas, um estado final com alerta e seguir a fila.
- **Fila de relatórios**: o worker processa 1 relatório por minuto (máximo 60/hora). Com 1000 contas, o lote mensal levaria ~17h. Deixar ele pegar 3-5 por vez (com controle de erro por item) sobe para ~200/hora sem mudar nada de infra.

---

## Resumo em uma frase

Nada está pegando fogo hoje: os problemas são **armadilhas silenciosas** (dados errados sem erro na tela) e **tetos estruturais** que aparecem com 2-5x de crescimento, e todos têm solução de lógica: paginar as consultas, dar timeout a tudo, mandar menos dados ao portal e dividir a sincronização em pedaços paralelos.
