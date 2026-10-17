<p align="center">
  <img src="assets/icon.png" width="110" alt="GitPolvo" />
</p>

<h1 align="center">GitPolvo</h1>

<p align="center">
  Cliente Git visual, open source e multiplataforma.<br />
  Funciona 100% local, sem conta e sem telemetria, usando o <code>git</code> instalado na sua máquina.
</p>

<p align="center">
  <a href="https://github.com/leoomartinelli/gitpolvo/releases/latest"><b>⬇ Baixar a última versão</b></a>
</p>

---

## Funcionalidades

- **Grafo de commits** com linhas coloridas por branch, foto do autor em cada commit e etiquetas de branch/tag/remoto
- **Arrastar e soltar** uma branch sobre outra para merge, rebase, fast-forward, push ou abrir pull request
- **Área de trabalho (WIP)**: stage/unstage por arquivo **ou por trecho (hunk)**, descartar, ignorar
- **Commits** com título e descrição, amend e desfazer o último commit
- **Diff** de alterações locais e de qualquer commit, com visão em lista ou árvore de arquivos
- **Resolução de conflitos** bloco a bloco (meu / deles / ambos) com edição do resultado
- **Branches, tags, stashes e remotos**: criar, renomear, excluir, checkout, cherry-pick, revert, reset
- **Fetch, pull (merge, fast-forward ou rebase) e push**, com pedido de senha/token em janela própria
- **Fotos de perfil** dos autores via GitHub (usa o login do GitHub CLI `gh`, se houver) e Gravatar
- **Várias abas** de repositórios, paleta de comandos (`Ctrl+P`), busca de commits (`Ctrl+F`), tema claro e escuro
- **Atualizações opcionais**: o app avisa quando há versão nova e só atualiza se você quiser

## Instalação

Baixe o instalador do seu sistema na página de [Releases](https://github.com/leoomartinelli/gitpolvo/releases/latest).
O GitPolvo usa o `git` do sistema, então ele precisa estar instalado.

| Sistema | Arquivo | Como instalar |
|---|---|---|
| **Windows** 10/11 | `GitPolvo-Setup-<versão>.exe` | Execute o instalador. Requer o [Git para Windows](https://git-scm.com/download/win). |
| **macOS** Apple Silicon (M1/M2/M3/M4) | `GitPolvo-<versão>-arm64.dmg` | Abra o `.dmg` e arraste o GitPolvo para Aplicativos. |
| **macOS** Intel | `GitPolvo-<versão>-x64.dmg` | Igual ao anterior. |
| **Ubuntu / Debian / Mint** | `gitpolvo_<versão>_amd64.deb` | `sudo apt install ./gitpolvo_<versão>_amd64.deb` |
| **Fedora / RHEL / openSUSE** | `gitpolvo-<versão>.x86_64.rpm` | `sudo dnf install ./gitpolvo-<versão>.x86_64.rpm` |
| **Qualquer Linux** | `GitPolvo-<versão>-x86_64.AppImage` | `chmod +x GitPolvo-*.AppImage` e execute |
| **Linux (manual)** | `GitPolvo-<versão>-x64.tar.gz` | Extraia e execute `gitpolvo` |

### Avisos na primeira execução

Os instaladores ainda não são assinados digitalmente, então o sistema pode avisar na primeira vez:

- **Windows**: na tela "O Windows protegeu o computador", clique em **Mais informações → Executar assim mesmo**.
- **macOS**: se aparecer "GitPolvo está danificado" ou "não pode ser aberto", rode no Terminal:
  ```bash
  xattr -cr /Applications/GitPolvo.app
  ```
  ou clique com o botão direito no app → **Abrir**.

## Atualizações

A cada mudança na branch `main`, o GitHub Actions gera uma nova versão e publica os instaladores em
[Releases](https://github.com/leoomartinelli/gitpolvo/releases).

O GitPolvo verifica se há versão nova ao abrir e a cada 4 horas. Quando há, aparece um aviso com
**Atualizar** e **Agora não** — nada é baixado sem você pedir. Também dá para verificar em
**Ajuda → Verificar atualizações**.

- **Windows e Linux** (`.exe`, `.deb`, `.rpm`, AppImage): o app baixa e instala a atualização ao clicar em *Atualizar*.
  No `.deb`/`.rpm` o sistema pede a senha de administrador para instalar.
- **macOS**: como o app não é assinado pela Apple, o aviso abre a página de download da nova versão.

## Atalhos

| Atalho | Ação |
|---|---|
| `Ctrl+P` | Paleta de comandos |
| `Ctrl+O` / `Ctrl+N` / `Ctrl+I` | Abrir / clonar / iniciar repositório |
| `Ctrl+T` / `Ctrl+W` | Nova aba / fechar aba |
| `Ctrl+L` | Fetch |
| `Ctrl+B` | Nova branch |
| `Ctrl+Shift+S` / `Ctrl+Shift+U` | Stage / unstage em tudo |
| `Ctrl+Enter` | Commit (na mensagem) |
| `Ctrl+F` | Buscar commits |
| `↑ ↓` ou `j k` | Navegar no histórico |

No macOS, use `Cmd` no lugar de `Ctrl`.

## Desenvolvimento

Requer Node.js 22 e Git.

```bash
git clone https://github.com/leoomartinelli/gitpolvo.git
cd gitpolvo
npm install
npm start
```

Gerar instaladores localmente:

```bash
npm run dist:linux   # .deb, .rpm, AppImage e .tar.gz
npm run dist:win     # instalador .exe (no Windows)
npm run dist:mac     # .dmg e .zip (no macOS)
```

### Estrutura

```
src/main.js            processo principal: janela, menu, git, credenciais, observador de arquivos, atualizações
src/preload.js         API exposta à interface (window.polvo)
src/askpass.js         helper de credenciais chamado pelo git/ssh
src/renderer/git.js    leitura de log/status/diff e layout do grafo
src/renderer/ui.js     elementos, avisos, menus, diálogos e paleta
src/renderer/views.js  barra de ferramentas, painéis, grafo, diff e conflitos
src/renderer/app.js    abas, ações git, comandos e atalhos
.github/workflows/     build e publicação automática dos instaladores
```

O código é JavaScript puro rodando no [Electron](https://www.electronjs.org/), sem framework de interface.

## Contribuindo

Contribuições são bem-vindas! Abra uma [issue](https://github.com/leoomartinelli/gitpolvo/issues) para relatar
problemas ou sugerir ideias, ou envie um pull request. Os pull requests são compilados automaticamente para
Linux, Windows e macOS.

## Licença

[MIT](LICENSE) © Leonardo Martinelli
