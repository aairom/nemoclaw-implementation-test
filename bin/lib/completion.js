// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * bin/lib/completion.js
 * Shell completion script generation for NemoClaw CLI.
 * Generates Bash, Zsh, and Fish completions.
 */

'use strict';

/**
 * Generate a tab-completion script for the given shell.
 * @param {string} shell - 'bash' | 'zsh' | 'fish'
 * @param {import('commander').Command} program
 */
function generate(shell, program) {
  const shellName = (shell || 'bash').toLowerCase();

  const commands = program.commands.map((c) => c.name());
  const cmdList = commands.join(' ');

  switch (shellName) {
    case 'bash':
      console.log(generateBash(cmdList));
      break;
    case 'zsh':
      console.log(generateZsh(cmdList));
      break;
    case 'fish':
      console.log(generateFish(commands));
      break;
    default:
      console.error(`Unsupported shell: ${shell}. Use bash, zsh, or fish.`);
      process.exitCode = 1;
  }
}

function generateBash(cmdList) {
  return `# nemoclaw bash completion
# Source this file: source <(nemoclaw completion bash)
_nemoclaw_completions() {
  local cur prev words
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  words="${cmdList}"
  COMPREPLY=( $(compgen -W "\${words}" -- "\${cur}") )
  return 0
}
complete -F _nemoclaw_completions nemoclaw`;
}

function generateZsh(cmdList) {
  return `# nemoclaw zsh completion
# Source this file: source <(nemoclaw completion zsh)
#compdef nemoclaw
_nemoclaw() {
  local -a commands
  commands=(${cmdList.split(' ').map((c) => `'${c}'`).join(' ')})
  _describe 'nemoclaw commands' commands
}
compdef _nemoclaw nemoclaw`;
}

function generateFish(commands) {
  return commands
    .map((cmd) => `complete -c nemoclaw -f -a '${cmd}' -d 'nemoclaw ${cmd}'`)
    .join('\n');
}

module.exports = { generate };
