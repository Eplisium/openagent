import chalk from '../utils/chalk-compat.js';

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
  const lang = language.toLowerCase();
  if (lang === 'javascript' || lang === 'typescript' || lang === 'js' || lang === 'ts' || lang === 'jsx' || lang === 'tsx') {
    return highlightJS(code);
  }
  if (lang === 'python' || lang === 'py') {
    return highlightPython(code);
  }
  if (lang === 'json') {
    return highlightJSON(code);
  }
  if (lang === 'bash' || lang === 'sh' || lang === 'shell' || lang === 'zsh') {
    return highlightBash(code);
  }
  if (lang === 'yaml' || lang === 'yml') {
    return highlightYAML(code);
  }
  if (lang === 'rust' || lang === 'rs') {
    return highlightRust(code);
  }
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

function highlightPython(code) {
  const lines = code.split('\n');
  return lines.map(line => {
    let result = line;
    result = result.replace(/(#.*)$/, match => TOKEN_COLORS.comment(match));
    result = result.replace(/(['"])(?:(?!\1|\\).|\\.)*\1/g, match => TOKEN_COLORS.string(match));
    result = result.replace(/('''[\s\S]*?'''|"""[\s\S]*?""")/g, match => TOKEN_COLORS.string(match));
    const kws = /\b(def|class|return|if|elif|else|for|while|import|from|as|with|try|except|finally|raise|yield|lambda|pass|break|continue|and|or|not|is|in|True|False|None|self|async|await|match|case)\b/g;
    result = result.replace(kws, match => TOKEN_COLORS.keyword(match));
    result = result.replace(/\b(\d+\.?\d*(?:e[+-]?\d+)?)\b/gi, match => TOKEN_COLORS.number(match));
    result = result.replace(/(\w+)\s*(?=\()/g, (match, fn) => TOKEN_COLORS.function(fn) + match.slice(fn.length));
    result = result.replace(/(@\w+)/g, match => TOKEN_COLORS.type(match));
    return result;
  }).join('\n');
}

function highlightJSON(code) {
  const lines = code.split('\n');
  return lines.map(line => {
    let result = line;
    result = result.replace(/("[^"]*")\s*:/g, (match, key) => TOKEN_COLORS.property(key) + ':');
    result = result.replace(/:\s*("[^"]*")/g, (match, val) => ': ' + TOKEN_COLORS.string(val));
    result = result.replace(/:\s*(\d+\.?\d*)\b/g, (match, num) => ': ' + TOKEN_COLORS.number(num));
    result = result.replace(/:\s*(true|false|null)\b/g, (match, kw) => ': ' + TOKEN_COLORS.keyword(kw));
    return result;
  }).join('\n');
}

function highlightBash(code) {
  const lines = code.split('\n');
  return lines.map(line => {
    let result = line;
    result = result.replace(/(#.*)$/, match => TOKEN_COLORS.comment(match));
    result = result.replace(/(['"])(?:(?!\1|\\).|\\.)*\1/g, match => TOKEN_COLORS.string(match));
    const kws = /\b(if|then|else|elif|fi|for|while|do|done|case|esac|function|return|exit|export|source|local|readonly|shift|unset|eval|exec|set|unset|trap|wait|cd|echo|printf|read|test)\b/g;
    result = result.replace(kws, match => TOKEN_COLORS.keyword(match));
    result = result.replace(/(\$\{?\w+\}?)/g, match => TOKEN_COLORS.number(match));
    return result;
  }).join('\n');
}

function highlightYAML(code) {
  const lines = code.split('\n');
  return lines.map(line => {
    let result = line;
    result = result.replace(/(#.*)$/, match => TOKEN_COLORS.comment(match));
    result = result.replace(/^([\s]*)([\w.-]+)(\s*:)/gm, (match, indent, key, colon) =>
      indent + TOKEN_COLORS.property(key) + colon);
    result = result.replace(/(['"])(?:(?!\1|\\).|\\.)*\1/g, match => TOKEN_COLORS.string(match));
    result = result.replace(/:\s*(true|false|null|~)\b/gi, (match, kw) => ': ' + TOKEN_COLORS.keyword(kw));
    result = result.replace(/(-\s)/, match => TOKEN_COLORS.operator(match));
    return result;
  }).join('\n');
}

function highlightRust(code) {
  const lines = code.split('\n');
  return lines.map(line => {
    let result = line;
    result = result.replace(/(\/\/.*$)/, match => TOKEN_COLORS.comment(match));
    result = result.replace(/(\/\*[\s\S]*?\*\/)/g, match => TOKEN_COLORS.comment(match));
    result = result.replace(/(['"])(?:(?!\1|\\).|\\.)*\1/g, match => TOKEN_COLORS.string(match));
    const kws = /\b(fn|let|mut|const|struct|enum|impl|trait|pub|use|mod|crate|self|super|if|else|for|while|loop|match|return|break|continue|async|await|move|ref|where|type|as|in|unsafe|extern)\b/g;
    result = result.replace(kws, match => TOKEN_COLORS.keyword(match));
    result = result.replace(/\b(i8|i16|i32|i64|i128|u8|u16|u32|u64|u128|f32|f64|bool|char|str|String|Vec|Option|Result|Box|Rc|Arc|HashMap)\b/g, match => TOKEN_COLORS.type(match));
    result = result.replace(/\b(\d+\.?\d*(?:e[+-]?\d+)?(?:f32|f64|u32|i32|u64|i64)?)\b/gi, match => TOKEN_COLORS.number(match));
    result = result.replace(/(\w+)\s*(?=\()/g, (match, fn) => TOKEN_COLORS.function(fn) + match.slice(fn.length));
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
