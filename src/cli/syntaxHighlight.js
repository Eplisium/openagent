import chalk from '../utils/chalk-compat.js';

const FALLBACK_TOKEN_COLORS = {
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

function themeColor(theme, role, fallback) {
  const value = theme?.[role];
  if (typeof value === 'function') return value;
  if (typeof value === 'string' && value) return chalk.hex(value);
  return fallback;
}

function resolveTokenColors(theme) {
  return {
    keyword: themeColor(theme, 'syntaxKeyword', FALLBACK_TOKEN_COLORS.keyword),
    string: themeColor(theme, 'syntaxString', FALLBACK_TOKEN_COLORS.string),
    number: themeColor(theme, 'syntaxNumber', FALLBACK_TOKEN_COLORS.number),
    comment: themeColor(theme, 'syntaxComment', FALLBACK_TOKEN_COLORS.comment),
    function: themeColor(theme, 'syntaxFunction', FALLBACK_TOKEN_COLORS.function),
    operator: themeColor(theme, 'syntaxOperator', FALLBACK_TOKEN_COLORS.operator),
    type: themeColor(theme, 'syntaxType', FALLBACK_TOKEN_COLORS.type),
    property: themeColor(theme, 'syntaxProperty', FALLBACK_TOKEN_COLORS.property),
    punctuation: themeColor(theme, 'syntaxPunctuation', FALLBACK_TOKEN_COLORS.punctuation),
  };
}

export function highlightCode(code, language = 'javascript', theme = null) {
  const colors = resolveTokenColors(theme);
  const lang = String(language || 'text').toLowerCase();
  if (lang === 'javascript' || lang === 'typescript' || lang === 'js' || lang === 'ts' || lang === 'jsx' || lang === 'tsx') {
    return highlightJS(code, colors);
  }
  if (lang === 'python' || lang === 'py') {
    return highlightPython(code, colors);
  }
  if (lang === 'json') {
    return highlightJSON(code, colors);
  }
  if (lang === 'bash' || lang === 'sh' || lang === 'shell' || lang === 'zsh') {
    return highlightBash(code, colors);
  }
  if (lang === 'yaml' || lang === 'yml') {
    return highlightYAML(code, colors);
  }
  if (lang === 'rust' || lang === 'rs') {
    return highlightRust(code, colors);
  }
  return code;
}

function globalRegex(regex) {
  return regex.global ? regex : new RegExp(regex.source, `${regex.flags}g`);
}

function applyPatterns(line, patterns) {
  let segments = [{ text: line, protected: false }];
  for (const { regex, color, replace } of patterns) {
    const next = [];
    const re = globalRegex(regex);
    for (const segment of segments) {
      if (segment.protected || !segment.text) {
        next.push(segment);
        continue;
      }
      let lastIndex = 0;
      re.lastIndex = 0;
      for (const match of segment.text.matchAll(re)) {
        const index = match.index ?? 0;
        if (index > lastIndex) {
          next.push({ text: segment.text.slice(lastIndex, index), protected: false });
        }
        const raw = match[0];
        const styled = replace ? replace(match, color) : color(raw);
        next.push({ text: styled, protected: true });
        lastIndex = index + raw.length;
        if (raw.length === 0) re.lastIndex++;
      }
      if (lastIndex < segment.text.length) {
        next.push({ text: segment.text.slice(lastIndex), protected: false });
      }
    }
    segments = next;
  }
  return segments.map(segment => segment.text).join('');
}

function highlightJS(code, colors) {
  const lines = code.split('\n');
  const keywords = /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|delete|typeof|instanceof|in|of|class|extends|super|this|import|export|from|default|async|await|try|catch|finally|throw|yield|static|get|set)\b/g;
  return lines.map(line => applyPatterns(line, [
    { regex: /(\/\/.*)$/, color: colors.comment },
    { regex: /(\/\*[\s\S]*?\*\/)/g, color: colors.comment },
    { regex: /(['"`])(?:(?!\1|\\).|\\.)*\1/g, color: colors.string },
    { regex: keywords, color: colors.keyword },
    { regex: /\b(\d+\.?\d*(?:e[+-]?\d+)?)\b/gi, color: colors.number },
    { regex: /\b([a-zA-Z_$][\w$]*)\s*(?=\()/g, color: colors.function },
  ])).join('\n');
}

function highlightPython(code, colors) {
  const lines = code.split('\n');
  const kws = /\b(def|class|return|if|elif|else|for|while|import|from|as|with|try|except|finally|raise|yield|lambda|pass|break|continue|and|or|not|is|in|True|False|None|self|async|await|match|case)\b/g;
  return lines.map(line => applyPatterns(line, [
    { regex: /(#.*)$/, color: colors.comment },
    { regex: /('''[\s\S]*?'''|"""[\s\S]*?""")/g, color: colors.string },
    { regex: /(['"])(?:(?!\1|\\).|\\.)*\1/g, color: colors.string },
    { regex: kws, color: colors.keyword },
    { regex: /\b(\d+\.?\d*(?:e[+-]?\d+)?)\b/gi, color: colors.number },
    { regex: /(\w+)\s*(?=\()/g, color: colors.function },
    { regex: /(@\w+)/g, color: colors.type },
  ])).join('\n');
}

function highlightJSON(code, colors) {
  const lines = code.split('\n');
  return lines.map(line => applyPatterns(line, [
    { regex: /("[^"]*")\s*:/g, color: colors.property, replace: (match, color) => color(match[1]) + ':' },
    { regex: /:\s*("[^"]*")/g, color: colors.string, replace: (match, color) => ': ' + color(match[1]) },
    { regex: /:\s*(\d+\.?\d*)\b/g, color: colors.number, replace: (match, color) => ': ' + color(match[1]) },
    { regex: /:\s*(true|false|null)\b/g, color: colors.keyword, replace: (match, color) => ': ' + color(match[1]) },
  ])).join('\n');
}

function highlightBash(code, colors) {
  const lines = code.split('\n');
  const kws = /\b(if|then|else|elif|fi|for|while|do|done|case|esac|function|return|exit|export|source|local|readonly|shift|unset|eval|exec|set|unset|trap|wait|cd|echo|printf|read|test)\b/g;
  return lines.map(line => applyPatterns(line, [
    { regex: /(#.*)$/, color: colors.comment },
    { regex: /(['"])(?:(?!\1|\\).|\\.)*\1/g, color: colors.string },
    { regex: kws, color: colors.keyword },
    { regex: /(\$\{?\w+\}?)/g, color: colors.number },
  ])).join('\n');
}

function highlightYAML(code, colors) {
  const lines = code.split('\n');
  return lines.map(line => applyPatterns(line, [
    { regex: /(#.*)$/, color: colors.comment },
    { regex: /^([\s]*)([\w.-]+)(\s*:)/gm, color: colors.property, replace: (match, color) => match[1] + color(match[2]) + match[3] },
    { regex: /(['"])(?:(?!\1|\\).|\\.)*\1/g, color: colors.string },
    { regex: /:\s*(true|false|null|~)\b/gi, color: colors.keyword, replace: (match, color) => ': ' + color(match[1]) },
    { regex: /(-\s)/, color: colors.operator },
  ])).join('\n');
}

function highlightRust(code, colors) {
  const lines = code.split('\n');
  const kws = /\b(fn|let|mut|const|struct|enum|impl|trait|pub|use|mod|crate|self|super|if|else|for|while|loop|match|return|break|continue|async|await|move|ref|where|type|as|in|unsafe|extern)\b/g;
  return lines.map(line => applyPatterns(line, [
    { regex: /(\/\/.*$)/, color: colors.comment },
    { regex: /(\/\*[\s\S]*?\*\/)/g, color: colors.comment },
    { regex: /(['"])(?:(?!\1|\\).|\\.)*\1/g, color: colors.string },
    { regex: kws, color: colors.keyword },
    { regex: /\b(i8|i16|i32|i64|i128|u8|u16|u32|u64|u128|f32|f64|bool|char|str|String|Vec|Option|Result|Box|Rc|Arc|HashMap)\b/g, color: colors.type },
    { regex: /\b(\d+\.?\d*(?:e[+-]?\d+)?(?:f32|f64|u32|i32|u64|i64)?)\b/gi, color: colors.number },
    { regex: /(\w+)\s*(?=\()/g, color: colors.function },
  ])).join('\n');
}

export function renderCodeBlock(code, language, theme) {
  const highlighted = highlightCode(code, language, theme);
  const lines = highlighted.split('\n');
  const muted = themeColor(theme, 'muted', chalk.dim.gray);
  const numbered = lines.map((line, i) => {
    const num = String(i + 1).padStart(4);
    return `${muted(num)} │ ${line}`;
  });

  const border = muted('┌' + '─'.repeat(60) + '┐');
  const bottom = muted('└' + '─'.repeat(60) + '┘');
  const langLabel = muted(` ${language} `);

  return `${border}\n${langLabel}\n${numbered.join('\n')}\n${bottom}`;
}
