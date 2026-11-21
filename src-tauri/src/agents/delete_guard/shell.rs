//! The words of a shell command, as the guard reads them: a statement at a time, with the
//! quotes and escapes taken off as the shell does (an unquoted `\t` is `t` in Bash), the
//! redirections and comments left out, and what a `$( )`, a backtick pair or a PowerShell
//! `( )` holds read as statements of its own, before the one that holds it.

use super::Shell;

/// How deep `$( )` inside `$( )` is read; deeper, its parenthesis ends the statement.
const MAX_NEST: u8 = 4;

/// One command of a script: its words, and whether a pipe fed it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Statement {
    pub words: Vec<String>,
    /// The statement before it ended with a `|`: its output is this one's input.
    pub piped: bool,
}

/// The statements of `command`, in the order they run.
pub(super) fn statements(shell: Shell, command: &str) -> Vec<Statement> {
    statements_in(shell, command, 0)
}

// The last `end_statement!` resets what is never read again.
#[allow(unused_assignments)]
fn statements_in(shell: Shell, command: &str, nest: u8) -> Vec<Statement> {
    let stripped;
    let command = if shell == Shell::Bash {
        stripped = without_heredocs(command);
        stripped.as_str()
    } else {
        command
    };
    let mut statements: Vec<Statement> = Vec::new();
    let mut words: Vec<String> = Vec::new();
    let mut word = String::new();
    let mut in_word = false;
    // The word after a redirection is a file, not an argument.
    let mut skip = false;
    // What the words in progress hold between `$( )`, backticks or parentheses: read before them.
    let mut inner: Vec<String> = Vec::new();
    // The statement being read was fed by a pipe.
    let mut piped = false;
    let mut chars = command.chars().peekable();
    let (escape, backslash_escapes) = match shell {
        Shell::Bash => ('\\', true),
        Shell::PowerShell => ('`', false),
        Shell::Cmd => ('^', false),
    };
    // `nest` allows a group to be read as a script of its own.
    let groups = nest < MAX_NEST;
    macro_rules! end_word {
        () => {
            if in_word {
                let done = std::mem::take(&mut word);
                if std::mem::take(&mut skip) {
                    // dropped
                } else {
                    words.push(done);
                }
                in_word = false;
            }
        };
    }
    macro_rules! end_statement {
        ($pipe:expr) => {
            end_word!();
            for script in inner.drain(..) {
                statements.extend(statements_in(shell, &script, nest + 1));
            }
            if !words.is_empty() {
                statements.push(Statement {
                    words: std::mem::take(&mut words),
                    piped,
                });
                piped = $pipe;
            } else if $pipe {
                piped = true;
            }
        };
    }
    while let Some(c) = chars.next() {
        match c {
            '\'' if shell != Shell::Cmd => {
                in_word = true;
                while let Some(q) = chars.next() {
                    if q != '\'' {
                        word.push(q);
                    } else if shell == Shell::PowerShell && chars.peek() == Some(&'\'') {
                        chars.next();
                        word.push('\'');
                    } else {
                        break;
                    }
                }
            }
            '"' => {
                in_word = true;
                while let Some(q) = chars.next() {
                    match q {
                        '"' if shell == Shell::PowerShell && chars.peek() == Some(&'"') => {
                            chars.next();
                            word.push('"');
                        }
                        '"' => break,
                        '$' if groups && shell != Shell::Cmd && chars.peek() == Some(&'(') => {
                            chars.next();
                            let script = group(&mut chars);
                            word.push_str("$(");
                            word.push_str(&script);
                            word.push(')');
                            inner.push(script);
                        }
                        '`' if groups && shell == Shell::Bash => {
                            let script = until_backtick(&mut chars);
                            word.push('`');
                            word.push_str(&script);
                            word.push('`');
                            inner.push(script);
                        }
                        q if q == escape && shell != Shell::Cmd => match chars.peek().copied() {
                            Some('\n') => {
                                chars.next();
                            }
                            Some(next)
                                if !backslash_escapes || matches!(next, '$' | '`' | '"' | '\\') =>
                            {
                                chars.next();
                                // A backtick before `$` keeps the dollar literal in PowerShell.
                                word.push(next);
                            }
                            _ => word.push(q),
                        },
                        q => word.push(q),
                    }
                }
            }
            '$' if groups && shell != Shell::Cmd && chars.peek() == Some(&'(') => {
                chars.next();
                in_word = true;
                let script = group(&mut chars);
                word.push_str("$(");
                word.push_str(&script);
                word.push(')');
                inner.push(script);
            }
            // PowerShell's parentheses group an argument (`-Path (Join-Path $a b)`); they do not end a statement.
            '(' if groups && shell == Shell::PowerShell => {
                in_word = true;
                let script = group(&mut chars);
                word.push('(');
                word.push_str(&script);
                word.push(')');
                inner.push(script);
            }
            '`' if groups && shell == Shell::Bash => {
                in_word = true;
                let script = until_backtick(&mut chars);
                word.push('`');
                word.push_str(&script);
                word.push('`');
                inner.push(script);
            }
            c if c == escape => match chars.next() {
                Some('\n') | None => {}
                Some(next) => {
                    in_word = true;
                    word.push(next);
                }
            },
            '#' if !in_word && shell != Shell::Cmd => {
                for q in chars.by_ref() {
                    if q == '\n' {
                        break;
                    }
                }
                end_statement!(false);
            }
            '>' | '<' => {
                // A file descriptor before the operator is not a word.
                if in_word && !word.is_empty() && word.chars().all(|d| d.is_ascii_digit()) {
                    word.clear();
                    in_word = false;
                } else {
                    end_word!();
                }
                while matches!(chars.peek(), Some('>' | '<')) {
                    chars.next();
                }
                if matches!(chars.peek(), Some('&' | '|')) {
                    chars.next();
                }
                skip = true;
            }
            '|' => {
                // `||` is a choice, `|&` and `|` a pipe.
                let pipe = match chars.peek() {
                    Some('|') => {
                        chars.next();
                        false
                    }
                    Some('&') => {
                        chars.next();
                        true
                    }
                    _ => true,
                };
                end_statement!(pipe);
            }
            ';' if shell == Shell::Cmd => {
                in_word = true;
                word.push(';');
            }
            '\n' | ';' | '&' | '(' | ')' => {
                end_statement!(false);
            }
            '{' | '}' if shell == Shell::PowerShell => {
                end_statement!(false);
            }
            c if c.is_whitespace() => {
                end_word!();
            }
            c => {
                in_word = true;
                word.push(c);
            }
        }
    }
    end_statement!(false);
    statements
}

/// What a `(` opened, up to its matching `)`, which is taken off: quotes hide a parenthesis.
fn group(chars: &mut std::iter::Peekable<std::str::Chars>) -> String {
    let mut out = String::new();
    let mut depth = 1usize;
    while let Some(c) = chars.next() {
        match c {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            '\'' | '"' => {
                out.push(c);
                for q in chars.by_ref() {
                    out.push(q);
                    if q == c {
                        break;
                    }
                }
                continue;
            }
            _ => {}
        }
        out.push(c);
    }
    out
}

/// What a backtick opened, up to the one that closes it.
fn until_backtick(chars: &mut std::iter::Peekable<std::str::Chars>) -> String {
    let mut out = String::new();
    while let Some(c) = chars.next() {
        match c {
            '`' => break,
            '\\' => {
                out.push(c);
                if let Some(next) = chars.next() {
                    out.push(next);
                }
            }
            _ => out.push(c),
        }
    }
    out
}

/// A heredoc's body is text for its command (a script being written), not commands to run.
fn without_heredocs(command: &str) -> String {
    let mut out = String::with_capacity(command.len());
    let mut ending: Option<String> = None;
    for line in command.lines() {
        if let Some(delimiter) = &ending {
            if line.trim() == delimiter {
                ending = None;
            }
            continue;
        }
        ending = heredoc_delimiter(line);
        out.push_str(line);
        out.push('\n');
    }
    out
}

/// The word `<<EOF`, `<<-EOF`, `<<'EOF'` or `<< "EOF"` of a line ends its body with; not `<<<`'s, nor `1<<2`'s.
fn heredoc_delimiter(line: &str) -> Option<String> {
    let mut rest = line;
    while let Some(at) = rest.find("<<") {
        let after = &rest[at + 2..];
        if let Some(here_string) = after.strip_prefix('<') {
            rest = here_string;
            continue;
        }
        let word = after
            .trim_start_matches('-')
            .trim_start()
            .trim_start_matches(['\'', '"', '\\']);
        let name: String = word
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
            .collect();
        if name.chars().next().is_some_and(|c| !c.is_ascii_digit()) {
            return Some(name);
        }
        rest = after;
    }
    None
}

/// Whether `word` is `NAME=value` as Bash reads an assignment.
pub(super) fn assignment(word: &str) -> Option<(&str, &str)> {
    let (name, value) = word.split_once('=')?;
    let name = name.strip_suffix('+').unwrap_or(name);
    (name.chars().next().is_some_and(|c| !c.is_ascii_digit())
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'))
    .then_some((name, value))
}

/// Words that run what follows: assignments, `sudo`, keywords. The index of the command itself.
pub(super) fn command_at(shell: Shell, words: &[String]) -> Option<usize> {
    match shell {
        Shell::Bash => bash_command_at(words),
        Shell::PowerShell => (!words.is_empty()).then_some(0),
        Shell::Cmd => cmd_command_at(words),
    }
}

fn bash_command_at(words: &[String]) -> Option<usize> {
    // The wrapper being read (`sudo`, `timeout`), and what it takes after its flags: `timeout 5`.
    let mut wrapper = String::new();
    let mut owed = 0usize;
    let mut at = 0;
    while at < words.len() {
        let word = &words[at];
        at += 1;
        let name = command_name(word);
        let keyword = matches!(
            word.as_str(),
            "if" | "then" | "else" | "elif" | "do" | "while" | "until" | "!" | "{"
        );
        if assignment(word).is_some() || keyword {
            wrapper.clear();
            owed = 0;
        } else if wrapper.is_empty() && is_wrapper(&name) {
            owed = usize::from(name == "timeout");
            wrapper = name;
        } else if !wrapper.is_empty() && word.starts_with('-') {
            // sudo -n, env -i; `sudo -u root`, `nice -n 5` and `timeout -s KILL 5` take a value.
            if takes_value(&wrapper, word) {
                at += 1;
            }
        } else if !wrapper.is_empty() && owed > 0 {
            owed -= 1;
        } else if !wrapper.is_empty() && is_wrapper(&name) {
            // sudo env rm, nohup nice rm
            owed = usize::from(name == "timeout");
            wrapper = name;
        } else {
            return Some(at - 1);
        }
    }
    None
}

/// Commands that run the command that follows them.
fn is_wrapper(name: &str) -> bool {
    matches!(
        name,
        "sudo"
            | "doas"
            | "command"
            | "builtin"
            | "exec"
            | "time"
            | "nohup"
            | "nice"
            | "env"
            | "setsid"
            | "stdbuf"
            | "busybox"
            | "timeout"
    )
}

/// The flags of a wrapper that are followed by their value.
fn takes_value(wrapper: &str, flag: &str) -> bool {
    match wrapper {
        "nice" => flag == "-n",
        "timeout" => matches!(flag, "-s" | "-k"),
        "sudo" | "doas" => matches!(flag, "-u" | "-g" | "-C" | "-D" | "-h" | "-p" | "-r" | "-t"),
        "env" => matches!(flag, "-u" | "-C"),
        _ => false,
    }
}

/// `cmd`'s own prefixes: `@`, `call`, `do`, `else`, and the test of an `if`.
fn cmd_command_at(words: &[String]) -> Option<usize> {
    let mut at = 0;
    while at < words.len() {
        let word = words[at].trim_start_matches('@').to_ascii_lowercase();
        at += 1;
        match word.as_str() {
            "" | "call" | "do" | "else" => {}
            "if" => {
                while words
                    .get(at)
                    .is_some_and(|w| w.eq_ignore_ascii_case("/i") || w.eq_ignore_ascii_case("not"))
                {
                    at += 1;
                }
                let test = words.get(at).map(|w| w.to_ascii_lowercase());
                at += match test.as_deref() {
                    Some("exist" | "defined" | "errorlevel" | "cmdextversion") => 2,
                    Some(t) if t.contains("==") => 1,
                    _ => 3,
                };
            }
            _ => return Some(at - 1),
        }
    }
    None
}

/// The name of a command: no folder, no `.exe`, lower case.
pub(super) fn command_name(word: &str) -> String {
    let name = word.rsplit(['/', '\\']).next().unwrap_or(word);
    let name = name.trim_start_matches('@').to_ascii_lowercase();
    name.strip_suffix(".exe")
        .map(str::to_string)
        .unwrap_or(name)
}
