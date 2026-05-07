const BASH = `# squad bash completion. Source from ~/.bashrc:
#   source <(squad completion bash)
_squad() {
  local cur prev cmds
  cur="\${COMP_WORDS[COMP_CWORD]}"
  cmds="list show run runs logs new init install uninstall doctor demo validate export resume watch completion --help --version"
  if [[ \${COMP_CWORD} -eq 1 ]] ; then
    COMPREPLY=( $(compgen -W "\${cmds}" -- \${cur}) )
    return 0
  fi
}
complete -F _squad squad
`;

const ZSH = `# squad zsh completion. Source from .zshrc:
#   source <(squad completion zsh)
_squad() {
  local -a cmds
  cmds=(
    'list:List built-in recipes'
    'show:Print recipe DAG'
    'run:Execute a pipeline'
    'runs:List recent runs'
    'logs:Print artifacts from a past run'
    'resume:Resume a partial run'
    'watch:Re-run on file changes'
    'demo:Self-contained echo walkthrough'
    'install:Install /squad skill'
    'uninstall:Remove /squad skill'
    'doctor:Diagnose installation'
    'new:Scaffold custom recipe'
    'export:Export built-in to ~/.squad/recipes'
    'validate:Lint a recipe JSON'
    'completion:Print shell completion script'
  )
  _describe 'squad command' cmds
}
compdef _squad squad
`;

const FISH = `# squad fish completion. Save to ~/.config/fish/completions/squad.fish:
#   squad completion fish > ~/.config/fish/completions/squad.fish
complete -c squad -f
complete -c squad -n __fish_use_subcommand -a list -d 'List built-in recipes'
complete -c squad -n __fish_use_subcommand -a show -d 'Print recipe DAG'
complete -c squad -n __fish_use_subcommand -a run -d 'Execute a pipeline'
complete -c squad -n __fish_use_subcommand -a runs -d 'List recent runs'
complete -c squad -n __fish_use_subcommand -a logs -d 'Print artifacts from a past run'
complete -c squad -n __fish_use_subcommand -a resume -d 'Resume a partial run'
complete -c squad -n __fish_use_subcommand -a watch -d 'Re-run on file changes'
complete -c squad -n __fish_use_subcommand -a demo -d 'Echo walkthrough'
complete -c squad -n __fish_use_subcommand -a install -d 'Install /squad skill'
complete -c squad -n __fish_use_subcommand -a uninstall -d 'Remove /squad skill'
complete -c squad -n __fish_use_subcommand -a doctor -d 'Diagnose installation'
complete -c squad -n __fish_use_subcommand -a new -d 'Scaffold custom recipe'
complete -c squad -n __fish_use_subcommand -a export -d 'Export built-in'
complete -c squad -n __fish_use_subcommand -a validate -d 'Lint a recipe JSON'
complete -c squad -n __fish_use_subcommand -a completion -d 'Shell completion'
`;

export function emitCompletion(shell: string): void {
  switch (shell) {
    case 'bash': process.stdout.write(BASH); return;
    case 'zsh':  process.stdout.write(ZSH);  return;
    case 'fish': process.stdout.write(FISH); return;
    default:
      console.error(`unknown shell: ${shell}. Choose bash, zsh, or fish.`);
      process.exitCode = 2;
  }
}
