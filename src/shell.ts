// Small POSIX-shell tokenizer: enough to find paths in simple commands. It does not expand
// variables, globs or substitutions; anything it cannot decide is simply not reported.

export type Token =
  | { kind: "word"; value: string }
  | { kind: "sep" } // && || ; | & newline ( )
  | { kind: "redirect" }; // > >> < >& &> (the next word is the target)

/** Split a command line into words, separators and redirect markers. Throws on an unbalanced quote. */
export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let cur = "";
  let hasWord = false;
  let quote: string | null = null;

  const flush = (): void => {
    if (hasWord || cur !== "") out.push({ kind: "word", value: cur });
    cur = "";
    hasWord = false;
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i] as string;
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < src.length) cur += src[++i];
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      hasWord = true;
      continue;
    }
    if (c === "\\" && i + 1 < src.length) {
      cur += src[++i];
      hasWord = true;
      continue;
    }
    if (c === "\n" || c === ";" || c === "(" || c === ")") {
      flush();
      out.push({ kind: "sep" });
      continue;
    }
    if (c === "&" || c === "|") {
      // "&>" is a redirect, "&&", "||", "|", "&" are separators.
      if (c === "&" && src[i + 1] === ">") {
        flush();
        out.push({ kind: "redirect" });
        i += src[i + 2] === ">" ? 2 : 1;
        continue;
      }
      flush();
      while (src[i + 1] === c) i++;
      out.push({ kind: "sep" });
      continue;
    }
    if (c === ">" || c === "<") {
      // Drop a file-descriptor prefix such as the "2" of "2>".
      if (/^\d+$/.test(cur) && !hasWord) cur = "";
      flush();
      while (src[i + 1] === c) i++;
      if (c === ">" && src[i + 1] === "&") i++;
      out.push({ kind: "redirect" });
      continue;
    }
    if (c === " " || c === "\t") {
      flush();
      continue;
    }
    cur += c;
  }
  if (quote) throw new Error("unbalanced quote");
  flush();
  return out;
}

/** Group tokens into commands separated by `sep`; each command keeps its redirect targets apart. */
export interface Command {
  words: string[];
  redirectTargets: string[];
}

export function splitCommands(tokens: Token[]): Command[] {
  const cmds: Command[] = [];
  let cur: Command = { words: [], redirectTargets: [] };
  let pendingRedirect = false;
  const push = (): void => {
    if (cur.words.length > 0 || cur.redirectTargets.length > 0) cmds.push(cur);
    cur = { words: [], redirectTargets: [] };
    pendingRedirect = false;
  };
  for (const tk of tokens) {
    if (tk.kind === "sep") push();
    else if (tk.kind === "redirect") pendingRedirect = true;
    else if (pendingRedirect) {
      cur.redirectTargets.push(tk.value);
      pendingRedirect = false;
    } else cur.words.push(tk.value);
  }
  push();
  return cmds;
}
