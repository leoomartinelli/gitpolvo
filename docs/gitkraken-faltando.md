# O que o GitKraken tem e o GitPolvo ainda não

Levantamento feito em 22/10/2026, comparando o código do GitPolvo com os recursos do GitKraken Desktop.
Prioridade: **Alta** = usado no dia a dia, **Média** = faz falta de vez em quando, **Baixa** = nicho ou recurso pago/de equipe.

## Já existe no GitPolvo (para referência)

Abas de repositório, clonar/iniciar/abrir, grafo com fotos dos autores, fetch automático, pull (merge/rebase/ff), push e push forçado com
`--force-with-lease`, perguntar o remoto no primeiro push, criar/renomear/excluir branch, checkout de commit, merge/rebase/fast-forward/reset
arrastando uma branch sobre a outra, abrir pull request no navegador, tags (criar, push, excluir local), stash (com mensagem, apply, pop, drop),
stage/unstage/descartar por arquivo e por hunk, `.gitignore` pelo menu, amend, desfazer último commit, cherry-pick, revert, reset
soft/mixed/hard, resolução de conflito por bloco (meu/deles), continuar/pular/abortar merge, rebase, cherry-pick e revert, busca de commits,
paleta de comandos, atalhos, tema claro/escuro, zoom, remotos (adicionar/remover), terminal e pasta externos, atualização automática.

## Histórico e grafo

| Recurso | Prioridade | Observação |
|---|---|---|
| Carregar mais commits ao rolar | Alta | Hoje o log para em 3000 commits (`LOG_LIMIT`); o GitKraken pagina sob demanda |
| Esconder/mostrar branches no grafo (ícone de olho) e "solo" de uma branch | Alta | Ajuda muito em repositórios com centenas de branches remotas |
| Filtrar a lista da esquerda e o grafo por remoto | Média | |
| Selecionar vários commits (Shift/Ctrl+clique) | Alta | Base para cherry-pick, revert e squash em lote e para comparar dois commits |
| Comparar dois commits ou duas branches quaisquer | Alta | Diff entre A e B, com a lista de arquivos |
| Destacar os commits da branch ao passar o mouse | Baixa | |
| Mostrar que o commit é assinado (GPG/SSH, "Verified") | Baixa | |
| Copiar o link do commit no GitHub / abrir o commit no GitHub | Média | Já existe detecção do GitHub para as fotos |

## Rebase interativo e reescrita de histórico

| Recurso | Prioridade | Observação |
|---|---|---|
| Rebase interativo visual | Alta | Arrastar para reordenar, pick/squash/fixup/reword/drop por commit |
| Squash de commits selecionados | Alta | |
| Editar a mensagem de um commit antigo (reword) | Média | Hoje só o último, via amend |
| Desfazer/refazer várias ações (checkout, commit, discard, reset, excluir branch) | Alta | O botão "Desfazer" hoje só desfaz o último commit; não há "Refazer" |

## Diff e arquivos

| Recurso | Prioridade | Observação |
|---|---|---|
| Stage/unstage/descartar por linha | Alta | Hoje só por hunk |
| Diff lado a lado (split) além do unificado | Alta | |
| Realce de sintaxe no diff | Média | |
| Ignorar espaços em branco / diff por palavra | Média | |
| Diff de imagens (antes/depois) | Baixa | |
| Histórico de um arquivo (`log --follow`) | Alta | |
| Blame (quem alterou cada linha) | Alta | |
| Editor embutido para editar o arquivo direto no app | Média | O GitKraken edita e salva pelo próprio diff |
| Abrir o arquivo no editor externo (VS Code etc.) | Média | |
| Ver a árvore completa de arquivos do commit, não só os alterados | Baixa | |
| Criar patch de um commit / aplicar um arquivo `.patch` | Baixa | |

## Conflitos

| Recurso | Prioridade | Observação |
|---|---|---|
| Editor de merge de três painéis com escolha linha a linha e saída editável | Alta | Hoje a escolha é por bloco (meu/deles) |
| Configurar ferramenta de merge/diff externa | Baixa | |
| Aviso de conflito antes de acontecer (Team View / conflict prevention) | Baixa | Recurso de equipe do GitKraken |

## Branches, tags, stash e remotos

| Recurso | Prioridade | Observação |
|---|---|---|
| Merge com opções (`--no-ff`, `--squash`) | Média | |
| Excluir branch local e remota de uma vez / excluir várias | Média | |
| Excluir tag no remoto e enviar todas as tags | Média | |
| Stash só dos arquivos selecionados / só do que está preparado | Média | Hoje sempre guarda tudo com `--include-untracked` |
| Editar a mensagem de um stash / criar branch a partir de um stash | Baixa | |
| Editar a URL de um remoto e fazer fetch com `--prune` | Média | |
| Adicionar remoto a partir de um fork do GitHub (lista de forks) | Baixa | |
| Fixar branches favoritas no topo da lista | Baixa | |

## Integrações com GitHub/GitLab/Bitbucket/Azure

| Recurso | Prioridade | Observação |
|---|---|---|
| Login com a conta do serviço (OAuth) | Média | Hoje usa o token do `gh` só para as fotos |
| Painel de pull requests: listar, ver, criar, revisar e fazer merge sem sair do app | Média | Hoje só abre o navegador |
| Clonar escolhendo o repositório da lista da conta | Média | |
| Gerar chave SSH e cadastrar no GitHub pelo app | Baixa | |
| Issues (GitHub Issues, Jira, Trello) e Launchpad | Baixa | |
| Status do CI (checks) ao lado do commit | Média | |

## Recursos avançados do Git

| Recurso | Prioridade | Observação |
|---|---|---|
| Submódulos (listar, atualizar, abrir) | Média | |
| Git LFS (status, track, pull) | Baixa | |
| Worktrees (criar, listar, abrir em aba) | Média | |
| Git Flow (feature/release/hotfix) | Baixa | |
| Assinar commits com GPG/SSH | Baixa | |
| Indicar e respeitar hooks do Git | Baixa | |

## Configurações e organização

| Recurso | Prioridade | Observação |
|---|---|---|
| Tela de preferências | Alta | Nome/e-mail do Git, intervalo do fetch automático, editor externo, fonte, branch padrão |
| Perfis (várias identidades, ex.: trabalho e pessoal) | Média | |
| Configuração de usuário por repositório pela interface | Média | |
| Workspaces (grupos de repositórios) | Baixa | Hoje existem abas e recentes |
| Terminal embutido no app | Média | Hoje abre um terminal externo |
| Histórico das operações e dos comandos Git executados | Baixa | Ajuda a entender erros |
| Template de mensagem de commit | Baixa | |

## IA e nuvem (pagos no GitKraken)

| Recurso | Prioridade | Observação |
|---|---|---|
| Gerar a mensagem de commit com IA | Média | |
| Explicar um commit ou stash com IA | Baixa | |
| Cloud Patches / Code Suggest (compartilhar alterações sem push) | Baixa | |

## Sugestão de ordem

1. Carregar mais commits e esconder branches no grafo (repositórios grandes como o `api_consultasdeveiculos`)
2. Stage por linha, diff lado a lado, histórico de arquivo e blame
3. Seleção múltipla de commits, rebase interativo e squash
4. Desfazer/refazer de verdade
5. Tela de preferências
