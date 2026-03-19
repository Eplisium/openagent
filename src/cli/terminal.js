import inquirer from 'inquirer';

const TERMINAL_RESET_DELAY_MS = 10;

/**
 * Reset stdin after raw-mode widgets before launching other interactive prompts.
 * This helps prevent stray Enter/newline bytes from auto-submitting inquirer/readline flows.
 */
export async function resetTerminalInput(input = process.stdin) {
  if (!input) return;

  try {
    input.pause?.();
  } catch {}

  try {
    if (input.isTTY && typeof input.setRawMode === 'function') {
      input.setRawMode(false);
    }
  } catch {}

  try {
    input.resume?.();
  } catch {}

  if (typeof input.read === 'function') {
    while (input.read() !== null) {
      // Drain buffered input, including stray CR/LF from the previous raw-mode prompt.
    }
  }

  await new Promise((resolve) => setTimeout(resolve, TERMINAL_RESET_DELAY_MS));
}

export async function promptWithTerminalReset(questions, {
  input = process.stdin,
  output = process.stdout,
  promptModule = inquirer,
} = {}) {
  await resetTerminalInput(input);

  if (typeof globalThis.__OPENAGENT_TEST_PROMPT__ === 'function') {
    return globalThis.__OPENAGENT_TEST_PROMPT__(questions, { input, output, promptModule });
  }

  if (typeof promptModule.createPromptModule === 'function') {
    const prompt = promptModule.createPromptModule({ input, output });
    return prompt(questions);
  }

  return promptModule.prompt(questions);
}


/**
 * Create a readline interface after resetting terminal input state.
 */
export async function createReadlineInterfaceWithTerminalReset(readlineModule, {
  input = process.stdin,
  output = process.stdout,
  terminal = true,
  ...rest
} = {}) {
  await resetTerminalInput(input);
  return readlineModule.createInterface({ input, output, terminal, ...rest });
}
