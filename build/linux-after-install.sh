#!/bin/bash
# Script pós-instalação dos pacotes .deb e .rpm.

if type update-alternatives >/dev/null 2>&1; then
    # remove link antigo que não use update-alternatives
    if [ -L '/usr/bin/gitpolvo' -a -e '/usr/bin/gitpolvo' -a "$(readlink '/usr/bin/gitpolvo')" != '/etc/alternatives/gitpolvo' ]; then
        rm -f '/usr/bin/gitpolvo'
    fi
    update-alternatives --install '/usr/bin/gitpolvo' 'gitpolvo' '/opt/GitPolvo/gitpolvo' 100 || ln -sf '/opt/GitPolvo/gitpolvo' '/usr/bin/gitpolvo'
else
    ln -sf '/opt/GitPolvo/gitpolvo' '/usr/bin/gitpolvo'
fi

# O sandbox do Chromium precisa do helper com setuid root quando o sistema
# bloqueia user namespaces para usuários comuns (ex.: Ubuntu 23.10+ com
# AppArmor). Testar com `unshare` aqui não serve: este script roda como root,
# para quem o teste sempre passa. Por isso o setuid é aplicado sempre.
chown root:root '/opt/GitPolvo/chrome-sandbox' || true
chmod 4755 '/opt/GitPolvo/chrome-sandbox' || true

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi
