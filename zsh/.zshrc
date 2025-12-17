# Add deno completions to search path
if [[ ":$FPATH:" != *":$HOME/.zsh/completions:"* ]]; then export FPATH="$HOME/.zsh/completions:$FPATH"; fi
export DISABLE_AUTO_TITLE='true'
export CHROME_BIN='/usr/bin/chromium-browser'
export NODE_ENV='development'
export JIRA_BRANCH_REGEX='s/.*([A-Z0-9]{2}-[0-9]+).*/\1/p'
export GOPATH=$HOME/go
export PATH=$PATH:$HOME/.bun/bin:$GOPATH/bin:$HOME/.cargo/bin
export NODE_PATH=$HOME/.npm-global/lib/node_modules
export PYTHONPATH=$HOME/.local/lib/python3.10/site-packages
export AIDER_MODEL=gpt-4-1106-preview
export TMPDIR=~/tmp/

# export ANTHROPIC_MODEL="eu.anthropic.claude-3-7-sonnet-20250219-v1:0"
# export ANTHROPIC_MODEL="eu.anthropic.claude-sonnet-4-20250514-v1:0"
# export ANTHROPIC_MODEL="anthropic.claude-haiku-4-5-20251001-v1:0"
export ANTHROPIC_MODEL="eu.anthropic.claude-sonnet-4-5-20250929-v1:0"
# export ANTHROPIC_MODEL="eu.anthropic.claude-haiku-4-5-20251001-v1:0"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="eu.anthropic.claude-haiku-4-5-20251001-v1:0"
export AWS_REGION=eu-central-1
export CLAUDE_CODE_AWS_PROFILE=test-sso
export CLAUDE_CODE_USE_BEDROCK=1
export OPENAI_API_KEY=your-openai-key

source $HOME/.aliases
source $HOME/.env-private

[ -x /usr/bin/lesspipe ] && eval "$(SHELL=/bin/sh lesspipe)"

#-*-shell-script-*-
autoload predict-on
autoload predict-off

# you may also wish to bind it to some keys...
zle -N predict-on
zle -N predict-off
bindkey '^Xp' predict-on
bindkey '^Xo' predict-off

# If you come from bash you might have to change your $PATH.
export PATH=$HOME/bin:$HOME/.local/bin:/usr/local/bin:$HOME/.npm-global/bin:$PATH

# Path to your oh-my-zsh installation.
export ZSH=$HOME/.oh-my-zsh
export EDITOR='vim'

# Set name of the theme to load. Optionally, if you set this to "random"
# it'll load a random theme each time that oh-my-zsh is loaded.
# See https://github.com/robbyrussell/oh-my-zsh/wiki/Themes
# ZSH_THEME="robbyrussell"
ZSH_THEME="frisk"

export FZF_BASE='/usr/bin/fzf'

# Which plugins would you like to load? (plugins can be found in ~/.oh-my-zsh/plugins/*)
# Custom plugins may be added to ~/.oh-my-zsh/custom/plugins/
# Example format: plugins=(rails git textmate ruby lighthouse)
# Add wisely, as too many plugins slow down shell startup.

plugins=(pnpm task ansible aws jira colorize colored-man-pages emoji-clock terraform pip git npm sudo docker command-not-found extract copypath cp history fzf zsh-autosuggestions z)

autoload -U compinit && compinit

zstyle ':completion:*' menu select
# zstyle ':autocomplete:list-choices:*' min-input 4
# zstyle ':autocomplete:*' frecent-dirs off
export BAT_THEME="Monokai Extended Light"
source $ZSH/oh-my-zsh.sh
# export TERM="xterm-256color"
# ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE="fg=250"
bindkey '^ ' autosuggest-execute

if type ag &> /dev/null; then
    export FZF_DEFAULT_COMMAND='ag -p ~/.gitignore -g ""'
fi
# User configuration



export FZF_DEFAULT_OPTS=$FZF_DEFAULT_OPTS'
--color=light
--color=fg:-1,bg:-1,hl:#5fff87,fg+:-1,bg+:-1,hl+:#ffaf5f
--color=info:#af87ff,prompt:#5fff87,pointer:#ff87d7,marker:#ff87d7,spinner:#ff87d7
'
source ~/.fzf-key-bindings.zsh

# # Use ~~ as the trigger sequence instead of the default **
# export FZF_COMPLETION_TRIGGER='~~'

# # Options to fzf command
# export FZF_COMPLETION_OPTS='+c -x'

# Use fd (https://github.com/sharkdp/fd) instead of the default find
# command for listing path candidates.
# - The first argument to the function ($1) is the base path to start traversal
# - See the source code (completion.{bash,zsh}) for the details.
_fzf_compgen_path() {
  fd --hidden --follow --exclude ".git" . "$1"
}

# Use fd to generate the list for directory completion
_fzf_compgen_dir() {
  fd --type d --hidden --follow --exclude ".git" . "$1"
}
# source /home/select/.config/broot/launcher/bash/br

[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh


export PATH="$HOME/.poetry/bin:$HOME/snap/bun-js/81/.bun/bin:$PATH"

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
. "$HOME/.deno/env"
# AsyncAPI CLI Autocomplete

ASYNCAPI_AC_ZSH_SETUP_PATH=$HOME/.cache/@asyncapi/cli/autocomplete/zsh_setup && test -f $ASYNCAPI_AC_ZSH_SETUP_PATH && source $ASYNCAPI_AC_ZSH_SETUP_PATH; # asyncapi autocomplete setup

# bun completions
[ -s "$HOME/.bun/_bun" ] && source "$HOME/.bun/_bun"
