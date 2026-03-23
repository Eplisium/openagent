import chalk from 'chalk';

const TOKEN_COLORS = {
  keyword: chalk.magenta,      // const, let, function, if, return, import, export, class, async, await
  string: chalk.green,         // '...', "...", `...`
  number: chalk.cyan,          // 123, 0xff, 1e10
  comment: chalk.gray,         // // ..., /* ... */
  function: chalk.yellow,      // function calls: foo()
  operator: chalk.white,       // +, -, =, =>, ===
  type: chalk.blue,            // TypeScript types, class names
  property: chalk.blue,        // object.property
  punctuation: chalk.dim.white,// {, }, (, ), [, ]
};

export function highlightCode(code, language = 'javascript') {
  if (language === 'javascript' || language === 'typescript' || language === 'js' || language === 'ts') {
    return highlightJS(code);
  }
  // Default: return as-is
  return code;
}

function highlightJS(code) {
  const lines = code.split('\n');
  return lines.map(line => {
    let result = line;

    // Comments first (so they override other matches)
    result = result.replace(/(\/\/.*)$/, match => TOKEN_COLORS.comment(match));
    result = result.replace(/(\/\*[\s\S]*?\*\/)/g, match => TOKEN_COLORS.comment(match));

    // Strings
    result = result.replace(/(['"`])(?:(?!\1|\\).|\\.)*\1/g, match => TOKEN_COLORS.string(match));

    // Keywords
    const keywords = /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|delete|typeof|instanceof|in|of|class|extends|super|this|import|export|from|default|async|await|try|catch|finally|throw|yield|static|get|set)\b/g;
    result = result.replace(keywords, match => TOKEN_COLORS.keyword(match));

    // Numbers
    result = result.replace(/\b(\d+\.?\d*(?:e[+-]?\d+)?)\b/gi, match => TOKEN_COLORS.number(match));

    // Function calls
    result = result.replace(/\b([a-zA-Z_$][\w$]*)\s*(?=\()/g, match => TOKEN_COLORS.function(match));

    return result;
  }).join('\n');
}

export function renderCodeBlock(code, language, theme) {
  const highlighted = highlightCode(code, language);
  const lines = highlighted.split('\n');
  // Default theme fallback using chalk directly
  const muted = theme?.muted || chalk.dim.gray;
  const numbered = lines.map((line, i) => {
    const num = String(i + 1).padStart(4);
    return `${muted(num)} │ ${line}`;
  });

  const border = muted('┌' + '─'.repeat(60) + '┐');
  const bottom = muted('└' + '─'.repeat(60) + '┘');
  const langLabel = muted(` ${language} `);

  return `${border}\n${langLabel}\n${numbered.join('\n')}\n${bottom}`;
}
