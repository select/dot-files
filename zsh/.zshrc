# Add deno completions to search path
if [[ ":$FPATH:" != *":$HOME/.zsh/completions:"* ]]; then export FPATH="$HOME/.zsh/completions:$FPATH"; fi
export DISABLE_AUTO_TITLE='true'
export CHROME_BIN='/usr/bin/chromium-browser'
export NODE_ENV='development'
export JIRA_BRANCH_REGEX='s/.*([A-Z0-9]{2}-[0-9]+).*/\1/p'
export NODE_PATH=$HOME/.npm-global/lib/node_modules
export PYTHONPATH=$HOME/.local/lib/python3.10/site-packages
export TMPDIR=~/tmp/
export GH_TELEMETRY=false
export EDITOR='vim'

# ========= PATH =========
export GOPATH=$HOME/go
export PATH=$PATH:$HOME/.bun/bin:$GOPATH/bin:$HOME/.cargo/bin
# If you come from bash you might have to change your $PATH.
export PATH=$HOME/bin:$HOME/.local/bin:/usr/local/bin:$HOME/.npm-global/bin:$PATH
# LM Studio CLI (lms)
export PATH="$PATH:$HOME/.lmstudio/bin"
export PATH="$HOME/.pixi/bin:$PATH"
export PATH="$HOME/.poetry/bin:$HOME/snap/bun-js/81/.bun/bin:$PATH"
# AGS/Astal typelibs (meson installs under /usr/local; AstalTray under ~/.local)
export GI_TYPELIB_PATH="/usr/local/lib/x86_64-linux-gnu/girepository-1.0:$HOME/.local/lib/x86_64-linux-gnu/girepository-1.0${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}"
export LD_LIBRARY_PATH="$HOME/.local/lib/x86_64-linux-gnu:/usr/local/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
# pnpm
export PNPM_HOME="$HOME/.local/share/pnpm"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac
# pnpm end
# tabtab source for packages
# uninstall by removing these lines
[[ -f ~/.config/tabtab/zsh/__tabtab.zsh ]] && . ~/.config/tabtab/zsh/__tabtab.zsh || true

# only unlock the ssh keys once, the use them in every shell
# eval $(ssh-agent)
# keychain -q

export PYENV_ROOT="$HOME/.pyenv"
[[ -d $PYENV_ROOT/bin ]] && export PATH="$PYENV_ROOT/bin:$PATH"
eval "$(pyenv init -)"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

# place this after nvm initialization!
autoload -U add-zsh-hook
load-nvmrc() {
  local node_version="$(nvm version)"
  local nvmrc_path="$(nvm_find_nvmrc)"

  if [ -n "$nvmrc_path" ]; then
    local nvmrc_node_version=$(nvm version "$(cat "${nvmrc_path}")")

    if [ "$nvmrc_node_version" = "N/A" ]; then
      nvm install
    elif [ "$nvmrc_node_version" != "$node_version" ]; then
      nvm use
    fi
  elif [ "$node_version" != "$(nvm version default)" ]; then
    echo "Reverting to nvm default version"
    nvm use default
  fi
}
add-zsh-hook chpwd load-nvmrc
load-nvmrc
fpath+=~/.zfunc; autoload -Uz compinit; compinit
source "$HOME/.deno/env"

# ========= Oh My Zsh =========
export ZSH=$HOME/.oh-my-zsh
ZSH_THEME="frisk"
export FZF_BASE='/usr/bin/fzf'
plugins=(pnpm task ansible aws jira colorize colored-man-pages emoji-clock terraform pip git npm sudo docker command-not-found extract copypath cp history fzf zsh-autosuggestions z)
source $ZSH/oh-my-zsh.sh
bindkey '^ ' autosuggest-execute

# ========= Aliases & Sources =========
source $HOME/.aliases
[ -f $HOME/.env-private ] && source $HOME/.env-private
source ~/.fzf-key-bindings.zsh

# AsyncAPI CLI Autocomplete
ASYNCAPI_AC_ZSH_SETUP_PATH=$HOME/.cache/@asyncapi/cli/autocomplete/zsh_setup && test -f $ASYNCAPI_AC_ZSH_SETUP_PATH && source $ASYNCAPI_AC_ZSH_SETUP_PATH; # asyncapi autocomplete setup

# bun completions
[ -s "$HOME/.bun/_bun" ] && source "$HOME/.bun/_bun"


# Import pywal colors
if [ -f ~/.cache/wal/sequences ]; then
  cat ~/.cache/wal/sequences
fi

# Alias to refresh pywal colors in current shell
walrefresh() {
  cat ~/.cache/wal/sequences
  bash ~/.config/wal/postrun/wal-gnome.sh 2>/dev/null
  bash ~/.config/wal/postrun/pywalfox-update.sh 2>/dev/null
}

# Function to run wal and refresh all tmux panes
walset() {
  wal -s "$@" && cat ~/.cache/wal/sequences
  # Generate pi-theme.json from pywal colors
  python3 ~/.config/wal/postrun/pi-theme.py 2>/dev/null
  # Apply wal colors to GNOME Shell top bar
  bash ~/.config/wal/postrun/wal-gnome.sh 2>/dev/null
  # Send updated colors to Firefox via pywalfox
  bash ~/.config/wal/postrun/pywalfox-update.sh 2>/dev/null
  # Reload tmux config and colors
  tmux source-file ~/.cache/wal/colors-tmux.conf 2>/dev/null
  tmux source-file ~/.config/tmux/tmux.conf 2>/dev/null
  if [ -n "$TMUX" ]; then
    # Refresh all tmux panes
    tmux list-panes -s -F '#{session_name}:#{window_index}.#{pane_index}' | \
    xargs -I PANE tmux send-keys -t PANE 'walrefresh' Enter
  fi
}

# # Restore KITTY_WINDOW_ID inside tmux (lost when tmux session predates kitty launch)
# if [[ -z "$KITTY_WINDOW_ID" && -n "$TMUX" ]]; then
#   _kwid=$(tmux show-environment KITTY_WINDOW_ID 2>/dev/null | cut -d= -f2)
#   [[ -n "$_kwid" ]] && export KITTY_WINDOW_ID="$_kwid"
#   unset _kwid
# fi
