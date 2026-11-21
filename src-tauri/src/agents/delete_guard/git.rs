//! How a `git` command line is read: where it works (`-C`, `--work-tree`, `--git-dir`), which
//! subcommand it runs, and whether that subcommand changes the repository it works in.
//!
//! A text reading like the rest of the guard, not git: an alias, a `-c` that rewrites a command, or
//! a script that runs `git` is not followed.

/// A `git` command line: what comes before its subcommand, and the subcommand with its arguments.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct GitCall<'a> {
    /// Every `-C <path>`, in order: each is relative to the one before it.
    pub dirs: Vec<&'a str>,
    pub git_dir: Option<&'a str>,
    pub work_tree: Option<&'a str>,
    /// The subcommand, as written.
    pub sub: &'a str,
    /// What follows the subcommand.
    pub args: &'a [String],
}

/// The options of git itself that take a value as the next word.
fn takes_next(option: &str) -> bool {
    matches!(
        option,
        "-C" | "-c"
            | "--git-dir"
            | "--work-tree"
            | "--namespace"
            | "--super-prefix"
            | "--config-env"
            | "--exec-path"
    )
}

/// `args` (what follows `git`) as a call, or none when it names no subcommand (`git --version`).
pub(super) fn git_call(args: &[String]) -> Option<GitCall<'_>> {
    let mut call = GitCall {
        dirs: Vec::new(),
        git_dir: None,
        work_tree: None,
        sub: "",
        args: &[],
    };
    let mut at = 0;
    while at < args.len() {
        let word = args[at].as_str();
        at += 1;
        if !word.starts_with('-') {
            call.sub = word;
            call.args = &args[at..];
            return Some(call);
        }
        if let Some((name, value)) = word.split_once('=') {
            match name {
                "--git-dir" => call.git_dir = Some(value),
                "--work-tree" => call.work_tree = Some(value),
                _ => {}
            }
        } else if takes_next(word) {
            let value = args.get(at).map(String::as_str)?;
            at += 1;
            match word {
                "-C" => call.dirs.push(value),
                "--git-dir" => call.git_dir = Some(value),
                "--work-tree" => call.work_tree = Some(value),
                _ => {}
            }
        }
    }
    None
}

/// Whether `word` is one of `flags`, or a bundle of short flags (`-vv`, `-fd`) holding one of the short ones.
fn has(args: &[String], flags: &[&str]) -> bool {
    args.iter().any(|arg| {
        let arg = arg.as_str();
        if flags.contains(&arg) {
            return true;
        }
        let long = arg.starts_with("--");
        // `--set-upstream-to=origin/x`
        if long {
            return arg
                .split_once('=')
                .is_some_and(|(name, _)| flags.contains(&name));
        }
        arg.len() > 2
            && arg.starts_with('-')
            && arg[1..]
                .chars()
                .any(|c| flags.contains(&format!("-{c}").as_str()))
    })
}

/// The first of `args` that is not an option: the action of `git stash`, `git worktree`, `git remote`.
fn action(args: &[String]) -> Option<&str> {
    args.iter()
        .map(String::as_str)
        .find(|arg| !arg.starts_with('-'))
}

/// Whether `args` of `git branch` or `git tag` (`listing`: the flags that list instead; `valued`: the
/// options that take the next word) make or change a ref: a delete, a move, a copy, a force, an upstream, or
/// a name with nothing that lists.
fn names_a_ref(args: &[String], changing: &[&str], listing: &[&str], valued: &[&str]) -> bool {
    if has(args, changing) {
        return true;
    }
    let mut lists = has(args, listing);
    let mut named = false;
    let mut skip = false;
    for arg in args {
        if skip {
            skip = false;
        } else if valued.contains(&arg.as_str()) {
            lists = true;
            skip = true;
        } else if !arg.starts_with('-') {
            named = true;
        }
    }
    named && !lists
}

/// Whether `git <sub> <args>` changes the repository it works in: its working tree, its index, its HEAD,
/// its branches, tags or stash, or its worktrees. Reading (`status`, `log`, `diff`, `show`, `rev-parse`,
/// `branch --list`, `stash list`, `worktree list`) does not.
pub(super) fn mutates(sub: &str, args: &[String]) -> bool {
    match sub.to_ascii_lowercase().as_str() {
        "checkout" | "switch" | "restore" | "merge" | "rebase" | "reset" | "commit" | "pull"
        | "cherry-pick" | "revert" | "am" | "apply" | "add" | "rm" | "mv" | "clean"
        | "update-ref" | "read-tree" | "checkout-index" | "sparse-checkout" | "bisect"
        | "filter-branch" => true,
        "stash" => !matches!(action(args), Some("list" | "show")),
        "worktree" => matches!(
            action(args),
            Some("add" | "remove" | "prune" | "move" | "lock" | "unlock" | "repair")
        ),
        "branch" => names_a_ref(
            args,
            &[
                "-d",
                "-D",
                "--delete",
                "-m",
                "-M",
                "--move",
                "-c",
                "-C",
                "--copy",
                "-f",
                "--force",
                "-u",
                "--set-upstream-to",
                "--unset-upstream",
                "--edit-description",
                "-t",
                "--track",
            ],
            &[
                "--list",
                "-l",
                "-a",
                "--all",
                "-r",
                "--remotes",
                "--show-current",
            ],
            &[
                "--contains",
                "--no-contains",
                "--merged",
                "--no-merged",
                "--points-at",
                "--format",
                "--sort",
                "--abbrev",
                "--column",
            ],
        ),
        "tag" => names_a_ref(
            args,
            &[
                "-d", "--delete", "-f", "--force", "-a", "-s", "-m", "-F", "-u",
            ],
            &["--list", "-l", "-n", "-v", "--verify"],
            &[
                "--contains",
                "--no-contains",
                "--merged",
                "--no-merged",
                "--points-at",
                "--format",
                "--sort",
                "--column",
            ],
        ),
        "symbolic-ref" => {
            action(args).is_some() && args.iter().filter(|a| !a.starts_with('-')).count() >= 2
        }
        "submodule" => !matches!(action(args), None | Some("status" | "summary" | "foreach")),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(line: &str) -> Vec<String> {
        line.split_whitespace().map(str::to_string).collect()
    }

    fn call(line: &str) -> (Vec<String>, bool) {
        let args = words(line);
        let found = git_call(&args).expect("a subcommand");
        let changes = mutates(found.sub, found.args);
        (words(found.sub), changes)
    }

    #[test]
    fn the_options_before_the_subcommand_are_read() {
        let args =
            words("-C ../a -c core.x=1 -C b --git-dir=/g --work-tree /w --no-pager checkout main");
        let found = git_call(&args).unwrap();
        assert_eq!(found.dirs, vec!["../a", "b"]);
        assert_eq!(found.git_dir, Some("/g"));
        assert_eq!(found.work_tree, Some("/w"));
        assert_eq!((found.sub, found.args), ("checkout", &args[11..]));
        assert_eq!(git_call(&words("--version")), None);
        assert_eq!(git_call(&words("-C")), None);
    }

    #[test]
    fn what_changes_the_repository_is_told_from_what_only_reads_it() {
        for line in [
            "checkout main",
            "switch -c x",
            "restore .",
            "merge x",
            "rebase main",
            "reset --hard",
            "commit -am x",
            "pull",
            "cherry-pick abc",
            "revert abc",
            "am x.patch",
            "apply x.patch",
            "add -A",
            "rm -r x",
            "mv a b",
            "clean -fdx",
            "stash",
            "stash push -m x",
            "stash pop",
            "stash drop",
            "stash clear",
            "branch -D x",
            "branch -d x",
            "branch -fD x",
            "branch -m old new",
            "branch -M x",
            "branch -c a b",
            "branch -f x HEAD",
            "branch newname",
            "branch newname main",
            "branch --set-upstream-to=origin/x",
            "branch -u origin/x",
            "branch --unset-upstream",
            "branch --delete x",
            "worktree add ../w",
            "worktree remove w",
            "worktree prune",
            "worktree move a b",
            "worktree lock w",
            "tag v1",
            "tag -a v1 -m x",
            "tag -d v1",
            "tag -f v1",
            "update-ref -d refs/heads/x",
            "symbolic-ref HEAD refs/heads/x",
            "submodule update --init",
            "bisect start",
            "CHECKOUT main",
        ] {
            assert!(call(line).1, "{line} changes the repository");
        }
        for line in [
            "status",
            "status -sb",
            "log --oneline -5",
            "diff HEAD~1",
            "show HEAD",
            "rev-parse --show-toplevel",
            "rev-list --count HEAD",
            "branch",
            "branch --list",
            "branch -l",
            "branch --list dummyplane/*",
            "branch -a",
            "branch -r",
            "branch -vv",
            "branch --show-current",
            "branch --contains abc",
            "branch --merged main",
            "branch --no-merged main",
            "branch --format=%(refname)",
            "branch -a --contains abc",
            "tag",
            "tag -l",
            "tag --list v*",
            "tag --contains abc",
            "stash list",
            "stash show -p",
            "worktree list",
            "worktree list --porcelain",
            "ls-files",
            "cat-file -p HEAD",
            "blame x",
            "grep foo",
            "for-each-ref refs/heads",
            "merge-base a b",
            "remote -v",
            "config --get user.name",
            "fetch",
            "describe --tags",
            "symbolic-ref HEAD",
            "submodule status",
            "reflog",
            "help",
        ] {
            assert!(!call(line).1, "{line} only reads");
        }
    }
}
