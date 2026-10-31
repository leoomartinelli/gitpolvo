<!--
  Notas de atualização do GitPolvo.

  Sempre que for publicar algo que o usuário precisa ver:
  1. Acrescente um bloco ## no TOPO, logo abaixo do título "# Novidades".
  2. Use um título curto — é o que o app usa para saber o que é novo.
  3. Liste as mudanças em bullets.

  Depois que o usuário atualizar, o GitPolvo abre uma guia temporária
  só com os blocos ## que ele ainda não viu. Ajuda → O que há de novo
  mostra o arquivo inteiro. A release do GitHub usa o bloco ## mais recente.
-->

# Novidades

## Auto-stash ao trocar de branch

- Em Preferências → Troca de branch, ligue "Guardar alterações no stash automaticamente" e a troca de branch com alterações sem commit não pergunta mais nada: tudo vai para um stash com o nome da branch de origem
- Com "Reaplicar o stash ao voltar para a branch", as alterações reaparecem quando você volta. Se der conflito, o stash fica na lista e nada se perde

## Árvore de pastas na hora de commitar

- O painel de commit ganhou o seletor Caminho / Árvore, como na navegação dos commits. Na árvore, cada pasta tem um botão para fazer stage ou unstage de tudo dentro dela
- No diff, os sinais + e - não saem mais do lugar ao rolar: ficam presos à linha deles

## Mensagem do commit em tamanho compacto

- A mensagem do commit no painel da direita abre sempre num tamanho compacto (arraste o canto para aumentar) e não mostra mais "null" em commits sem CI

## Projetos e abas que mudam de lugar

- Projetos: agrupe repositórios (ex.: trabalho, pessoal) pelo botão "🗂" à esquerda das abas. Trocar de projeto fecha as abas do atual e abre as do outro, do jeito que estavam: mesma ordem e mesma aba ativa
- Repositório aberto com um projeto ativo entra nele; "Gerenciar projetos..." renomeia, exclui e tira repositórios (nada é apagado do disco)
- O último projeto usado volta ao abrir o GitPolvo. Os workspaces salvos viraram projetos
- Arraste as abas para mudar a ordem, ou use o botão direito na aba ("Mover para a esquerda/direita") e Ctrl+Shift+PageUp/PageDown

## Não trava mais quando o repositório é apagado

- Apagar a pasta do repositório ou a pasta .git com a aba aberta não trava mais o GitPolvo: a aba avisa "Repositório não encontrado" e oferece fechar ou tentar de novo
- O app não abre mais a pasta pai no lugar (por exemplo, a home versionada com dotfiles), o que travava a tela até ao reabrir

## GitHub dentro do GitPolvo: pull requests, issues e CI

- Seções "Pull requests" e "Issues" na esquerda: abra, comente, aprove, peça mudanças, faça merge, crie PR da branch atual e crie issues sem sair do app
- Status do CI (GitHub Actions) com um pontinho ao lado dos commits e a lista de checagens nos detalhes
- "#123" na mensagem do commit abre a issue ou o PR no próprio app
- Clonar escolhendo da lista de repositórios da sua conta
- Adicionar remoto de um fork ou do repositório original, pelo "+" do Remoto
- Chave SSH: gerar uma nova ou cadastrar a existente no GitHub (paleta → "Chave SSH para o GitHub")
- Conta do GitHub nas Preferências: usa o login do GitHub CLI (gh) ou um token colado ali, guardado criptografado

## Imagens no diff, Git Flow, workspaces e histórico de operações

- Imagens (PNG, JPG, GIF, SVG, WebP...) aparecem lado a lado no diff, antes e depois, com o tamanho de cada uma
- Passar o mouse numa branch (no grafo ou na lista) destaca os commits da linha dela
- Commits assinados (GPG ou SSH) mostram um selo no painel de detalhes, dizendo se a assinatura confere
- "Salvar como patch..." no menu do commit (ou de vários marcados) e "Aplicar patch..." no menu Repositório
- Stash: renomear e criar uma branch a partir dele, pelo botão direito
- Fixar branches favoritas no topo da lista (botão direito → "Fixar no topo da lista")
- O painel de commit mostra os hooks do repositório (ex.: pre-commit) e permite pular nesse commit
- Modelo de mensagem de commit: "Modelo" no painel de commit, já respeitando o commit.template do Git
- Ferramenta externa de merge e de diff (meld, kdiff3...), escolhida nas Preferências
- Exibir → Histórico de operações: o que o GitPolvo fez e os comandos do Git de cada operação, com os erros
- As notificações agora aparecem embaixo, no centro, e não cobrem mais o botão de commit
- Assinar commits: chave GPG ou SSH nas Preferências e "Assinar este commit" no painel de commit
- Git Flow em "⋯" na seção Local: iniciar e finalizar feature, release (com tag) e hotfix, compatível com o git-flow
- Git LFS: seção mostrando os tipos de arquivo guardados no LFS, com rastrear, parar de rastrear e baixar; avisa se o git-lfs não estiver instalado
- Workspaces: salve as abas abertas como um grupo e abra todas juntas depois, pela tela inicial ou pela paleta

## Worktrees, submódulos, perfis e merge com opções

- Worktrees: seção nova na esquerda para abrir outra branch numa pasta separada, cada uma na sua aba ("+" ou "Abrir num worktree novo..." no menu da branch)
- Submódulos: seção nova na esquerda mostrando quais estão em dia, desatualizados ou ainda não baixados, com baixar/atualizar e abrir em nova aba
- O painel de commit mostra com qual nome e e-mail o commit vai sair; clique para trocar de perfil só neste repositório ou gerenciar os perfis (ex.: trabalho e pessoal)
- "Merge com opções..." no menu da branch: sempre criar commit de merge (--no-ff), só avançar (--ff-only) ou squash, que deixa as mudanças preparadas com a mensagem sugerida
- Excluir local e remota de uma vez, e "⋯ → Excluir várias branches" na seção Local, mostrando quais já estão mescladas
- Tags: "Excluir tag no remoto" e "⋯ → Enviar todas as tags"
- Stash só do que está preparado, só de um arquivo (botão direito) ou de arquivos escolhidos, pela setinha do botão Stash
- Remotos: editar a URL e renomear pelo botão direito

## Realce de sintaxe, editor embutido e mensagem de commits antigos

- O diff tem realce de sintaxe (PHP, JavaScript/TypeScript, Python, Java, C#, Go, SQL, CSS, HTML, JSON, shell e outras) e destaca as palavras que mudaram dentro da linha
- Botão "Ignorar espaços" no diff para esconder mudanças que são só indentação
- "Editar mensagem..." no menu do commit troca a mensagem do último commit ou de um commit antigo
- Editor embutido: "Editar arquivo" no menu do arquivo ou em "Arquivo ▾" no diff, com Ctrl+S para salvar; o que não foi salvo volta ao reabrir
- "Abrir no editor externo" abre o arquivo no VS Code ou no editor escolhido nas Preferências

## Blame, editor de conflitos e preferências

- Blame: veja quem alterou cada linha de um arquivo (botão no diff, no histórico ou botão direito no arquivo); clique no trecho para ir ao commit
- Editor de conflitos com os dois lados lado a lado: marque linha por linha o que fica, ou use Meu/Deles/Ambos/Nenhum; o resultado embaixo continua editável
- Tela de preferências (engrenagem ao lado da busca ou Ctrl+,): nome e e-mail do Git (geral ou só do repositório), fetch automático e intervalo, tema, diff, fotos e nome da branch inicial
- No ⚙ do grafo e no olho do "Remoto", escolha quais remotos aparecem no grafo ou deixe só as branches locais
- Abrir o commit no GitHub, GitLab ou Bitbucket, ou copiar o link, pelo menu do commit ou pelo painel de detalhes

## Desfazer de verdade, stage por linha e histórico do arquivo

- Desfazer e Refazer (Ctrl+Z / Ctrl+Shift+Z) valem para commit, amend, checkout, criar/renomear/excluir branch e tag, descartes, reset, merge, rebase, pull, cherry-pick e revert, enquanto o GitPolvo estiver aberto
- No diff, clique nas linhas para fazer stage, unstage ou descartar só elas (Shift+clique marca um intervalo)
- Diff lado a lado, além do unificado; a escolha fica salva
- Histórico do arquivo (botão no diff ou botão direito no arquivo), seguindo renomeações, com o diff de cada commit
- Juntar (squash) commits seguidos marcados com Ctrl/Shift+clique, escolhendo a mensagem final

## Grafo sem limite, filtros, seleção múltipla e rebase interativo

- O grafo carrega mais commits ao chegar no fim da rolagem, em vez de parar nos 3000 primeiros
- Olho na lista da esquerda para esconder uma branch (ou um remoto inteiro) do grafo, e "Solo" no menu para ver só as branches escolhidas; a escolha fica salva por repositório
- Ctrl+clique e Shift+clique marcam vários commits, para cherry-pick ou revert de todos de uma vez
- Com dois commits marcados, o painel da direita mostra os arquivos que mudam entre eles; nas branches, "Comparar com..." faz o mesmo entre duas branches ou tags
- Rebase interativo pelo menu do commit: reordenar, editar a mensagem, juntar ou remover commits numa janela só
- A faixa de "Rebase em andamento" não aparece mais depois que o rebase já terminou

## Stash aparece no grafo depois de trocar de branch

- Ao guardar o WIP no stash e trocar de branch, o stash fica visível no grafo (e na lista da esquerda), como no GitKraken
- Cada stash aparece logo acima do commit de onde saiu, ligado a ele por uma linha tracejada, em vez de todos empilhados no topo

## Polvo na branch enquanto carrega

- Operações Git (pull, push, fetch, checkout…) mostram o polvo animado ao lado da branch, com o nome do que está acontecendo
- As notificações no canto da tela ficaram maiores e mais fáceis de ler

## Guia de novidades só lista o que mudou agora

- Depois de atualizar, a guia temporária mostra apenas as notas novas, não o histórico inteiro
- O histórico continua em Ajuda → O que há de novo

## Push pergunta o remoto quando a branch ainda não existe lá

- Ao fazer push de uma branch nova, aparece a barra para escolher o remoto e o nome no servidor, como no GitKraken

## Troca de branch não leva o WIP no automático

- Ao trocar de branch com arquivos sem commit, o GitPolvo pergunta se você quer levar as alterações, guardar no stash, ou cancelar
- O Push envia só a branch atual, nunca as outras locais de uma vez

## Splash, ícones e pull ao trocar de branch

- Tela de abertura com o polvo puxando os bloquinhos coloridos
- Ícones SVG na barra (Pull, Push, Branch, Stash, Pop, Terminal)
- Duplo clique numa branch atrasada troca para ela e faz pull, para o local ficar igual ao remoto
- Menu de opções de pull na setinha ao lado do botão Pull

## Fetch automático

- Fetch em segundo plano a cada 5 segundos enquanto a guia está em foco, sem travar a barra
- Duplo clique na branch atual, se o remoto estiver à frente, faz pull
