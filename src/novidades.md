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

## Stash aparece no grafo depois de trocar de branch

- Ao guardar o WIP no stash e trocar de branch, o stash fica visível no topo do grafo (e na lista da esquerda), como no GitKraken

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
