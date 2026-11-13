//! GitHub issues and Projects for the Kanban, through the `gh` CLI: dummyPlane
//! stores no token, the user's own `gh auth login` is used.

use std::path::Path;
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::process::{hide_window, output_within};

/// Enough for a Kanban; `gh` stops at 30 by default. It is asked for one more, to know
/// when a list was cut.
const ISSUE_LIMIT: usize = 200;
const ITEM_LIMIT: usize = 500;

/// The issues of a sync, and whether GitHub had more open, or recently closed, ones than
/// it reads: the user is told, rather than left with a board quietly short.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueList {
    pub issues: Vec<Issue>,
    pub cut: bool,
}

/// The items of a Project, and how many it holds: more than `items` when the list was cut.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectItemList {
    pub items: Vec<ProjectItem>,
    pub total_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub number: u64,
    pub title: String,
    pub body: String,
    /// "open" or "closed".
    pub state: String,
    pub url: String,
    pub closed_at: Option<String>,
    pub labels: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemContent {
    /// "issue", "pullRequest" or "draft".
    pub kind: String,
    pub repo: Option<String>,
    pub number: Option<u64>,
    pub url: Option<String>,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectItem {
    pub id: String,
    pub title: String,
    pub status: Option<String>,
    pub content: ItemContent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedIssue {
    pub number: u64,
    pub url: String,
}

/// The Status field of a project: what `gh project item-edit` needs to move an item.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusField {
    pub id: String,
    pub options: Vec<(String, String)>,
}

/// "owner/name" of a github.com remote URL, in its https, ssh or scp form.
pub fn parse_remote(url: &str) -> Option<String> {
    let url = url.trim();
    let rest = ["https://", "http://", "ssh://", "git://"]
        .iter()
        .find_map(|scheme| url.strip_prefix(scheme))
        .map(|rest| rest.rsplit_once('@').map_or(rest, |(_, host)| host))
        .and_then(|rest| rest.strip_prefix("github.com/"))
        .or_else(|| url.split_once("@github.com:").map(|(_, path)| path))?;
    let rest = rest.trim_end_matches('/');
    let rest = rest.strip_suffix(".git").unwrap_or(rest);
    let mut parts = rest.split('/');
    let (owner, name) = (parts.next()?, parts.next()?);
    if owner.is_empty() || name.is_empty() || parts.next().is_some() {
        return None;
    }
    Some(format!("{owner}/{name}"))
}

/// `gh issue list --json number,title,body,state,url,closedAt,labels`.
pub fn parse_issues(json: &str) -> AppResult<Vec<Issue>> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Label {
        name: String,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Raw {
        number: u64,
        title: String,
        #[serde(default)]
        body: String,
        state: String,
        url: String,
        #[serde(default)]
        closed_at: Option<String>,
        #[serde(default)]
        labels: Vec<Label>,
    }
    let raw: Vec<Raw> = serde_json::from_str(json).map_err(unreadable)?;
    Ok(raw
        .into_iter()
        .map(|issue| Issue {
            number: issue.number,
            title: issue.title,
            body: issue.body,
            state: issue.state.to_lowercase(),
            url: issue.url,
            // gh writes the zero date for an open issue.
            closed_at: issue
                .closed_at
                .filter(|at| !at.is_empty() && !at.starts_with("0001-")),
            labels: issue.labels.into_iter().map(|label| label.name).collect(),
        })
        .collect())
}

/// `gh project item-list --format json`: `{ items: [{ id, title, status?, content }], totalCount }`.
/// `totalCount` should be all the Project holds, past `--limit` too (not checked against a
/// real Project that large); never fewer than the items listed.
/// The Status field comes as the lowercased field name.
pub fn parse_project_items(json: &str) -> AppResult<ProjectItemList> {
    let root: Value = serde_json::from_str(json).map_err(unreadable)?;
    let raw = root
        .get("items")
        .and_then(Value::as_array)
        .ok_or_else(|| unreadable("items"))?;
    let total_count = root
        .get("totalCount")
        .and_then(Value::as_u64)
        .unwrap_or(0)
        .max(raw.len() as u64);
    let text = |value: &Value, key: &str| value.get(key).and_then(Value::as_str).map(String::from);
    let items = raw
        .iter()
        .filter_map(|item| {
            let content = item.get("content").unwrap_or(&Value::Null);
            let kind = match content.get("type").and_then(Value::as_str) {
                Some("Issue") => "issue",
                Some("PullRequest") => "pullRequest",
                _ => "draft",
            };
            Some(ProjectItem {
                id: text(item, "id")?,
                title: text(item, "title")
                    .or_else(|| text(content, "title"))
                    .unwrap_or_default(),
                status: text(item, "status").filter(|status| !status.is_empty()),
                content: ItemContent {
                    kind: kind.into(),
                    repo: text(content, "repository"),
                    number: content.get("number").and_then(Value::as_u64),
                    url: text(content, "url"),
                    body: text(content, "body").unwrap_or_default(),
                },
            })
        })
        .collect();
    Ok(ProjectItemList { items, total_count })
}

/// The first `limit` of a list `gh` was asked one more of, and whether it had more.
fn within_limit<T>(mut listed: Vec<T>, limit: usize) -> (Vec<T>, bool) {
    let cut = listed.len() > limit;
    listed.truncate(limit);
    (listed, cut)
}

/// `gh project field-list --format json`: the single-select field named Status.
pub fn parse_status_field(json: &str) -> AppResult<Option<StatusField>> {
    let root: Value = serde_json::from_str(json).map_err(unreadable)?;
    let fields = root
        .get("fields")
        .and_then(Value::as_array)
        .ok_or_else(|| unreadable("fields"))?;
    Ok(fields
        .iter()
        .find(|field| {
            field.get("name").and_then(Value::as_str) == Some("Status")
                && field.get("options").is_some()
        })
        .and_then(|field| {
            let options = field.get("options")?.as_array()?;
            Some(StatusField {
                id: field.get("id")?.as_str()?.into(),
                options: options
                    .iter()
                    .filter_map(|option| {
                        Some((
                            option.get("id")?.as_str()?.into(),
                            option.get("name")?.as_str()?.into(),
                        ))
                    })
                    .collect(),
            })
        }))
}

/// `gh project view --format json`: the project's node id.
pub fn parse_project_id(json: &str) -> AppResult<String> {
    let root: Value = serde_json::from_str(json).map_err(unreadable)?;
    root.get("id")
        .and_then(Value::as_str)
        .map(String::from)
        .ok_or_else(|| unreadable("id"))
}

/// `gh issue create` prints the new issue's URL, which ends with its number.
pub fn parse_created_issue(stdout: &str) -> AppResult<CreatedIssue> {
    let url = stdout
        .lines()
        .map(str::trim)
        .rfind(|line| line.starts_with("https://"))
        .ok_or_else(|| unreadable(stdout))?;
    let number = url
        .rsplit('/')
        .next()
        .and_then(|n| n.parse().ok())
        .ok_or_else(|| unreadable(url))?;
    Ok(CreatedIssue {
        number,
        url: url.into(),
    })
}

/// YYYY-MM-DD of a Unix day count (Howard Hinnant's civil_from_days).
pub fn date_of_day(days: i64) -> String {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

fn unreadable(detail: impl std::fmt::Display) -> AppError {
    AppError::Github(format!("unreadable gh output: {detail}"))
}

/// Runs `gh` in `path`; a missing CLI, a missing login and a failed call each say so.
pub(crate) fn gh(path: &Path, args: &[&str]) -> AppResult<String> {
    let program = crate::pty::shell::which_locate("gh").ok_or_else(|| {
        AppError::Github("GitHub CLI (gh) not found: install it (https://cli.github.com) then run `gh auth login`.".to_string())
    })?;
    run(&program, path, args, GH_TIMEOUT)
}

/// How long one `gh` call may take: a board's moves reach GitHub one after the other, and a
/// call that never ends would hold every later one.
pub(crate) const GH_TIMEOUT: Duration = Duration::from_secs(60);

/// `gh` at `program`, run in `path`, stopped past `limit`.
pub(crate) fn run(
    program: &Path,
    path: &Path,
    args: &[&str],
    limit: Duration,
) -> AppResult<String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .current_dir(path)
        .env("GH_PROMPT_DISABLED", "1");
    if let Some(env_path) = crate::pty::env_path::current() {
        command.env("PATH", env_path);
    }
    let output = output_within(hide_window(&mut command), limit).map_err(|err| {
        if err.kind() == std::io::ErrorKind::TimedOut {
            AppError::Github(format!(
                "GitHub did not answer within {} s: gh was stopped.",
                limit.as_secs()
            ))
        } else {
            err.into()
        }
    })?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.contains("gh auth login") || stderr.contains("not logged") {
        return Err(AppError::Github(
            "GitHub CLI not authenticated: run `gh auth login` in a terminal.".to_string(),
        ));
    }
    if stderr.contains("missing required scopes") || stderr.contains("read:project") {
        return Err(AppError::Github(
            "Access to GitHub Projects denied: run `gh auth refresh -s project`.".to_string(),
        ));
    }
    Err(AppError::Github(format!("gh failed: {stderr}")))
}

/// "owner/name" of the project's `origin` remote; None when it is not on github.com.
pub fn detect_repo(path: &Path) -> Option<String> {
    let output = crate::git::command(path, crate::git::Asked::Unasked)
        .ok()?
        .args(["remote", "get-url", "origin"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_remote(&String::from_utf8_lossy(&output.stdout))
}

const ISSUE_FIELDS: &str = "number,title,body,state,url,closedAt,labels";

/// Open issues, then those closed within the last `closed_within_days` days.
pub fn list_issues(path: &Path, repo: &str, closed_within_days: u32) -> AppResult<IssueList> {
    let limit = (ISSUE_LIMIT + 1).to_string();
    let open = gh(
        path,
        &[
            "issue",
            "list",
            "--repo",
            repo,
            "--state",
            "open",
            "--limit",
            &limit,
            "--json",
            ISSUE_FIELDS,
        ],
    )?;
    let (mut issues, mut cut) = within_limit(parse_issues(&open)?, ISSUE_LIMIT);
    if closed_within_days > 0 {
        let today = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |since| since.as_secs() as i64 / 86_400);
        let search = format!(
            "closed:>={}",
            date_of_day(today - i64::from(closed_within_days))
        );
        let closed = gh(
            path,
            &[
                "issue",
                "list",
                "--repo",
                repo,
                "--state",
                "closed",
                "--search",
                &search,
                "--limit",
                &limit,
                "--json",
                ISSUE_FIELDS,
            ],
        )?;
        let (closed, more) = within_limit(parse_issues(&closed)?, ISSUE_LIMIT);
        issues.extend(closed);
        cut |= more;
    }
    Ok(IssueList { issues, cut })
}

/// The first `ITEM_LIMIT` items; `total_count` past them when the Project had more, which
/// the extra one asked for shows whatever `gh`'s `totalCount` means.
pub fn list_project_items(path: &Path, owner: &str, number: u32) -> AppResult<ProjectItemList> {
    let number = number.to_string();
    let limit = (ITEM_LIMIT + 1).to_string();
    let json = gh(
        path,
        &[
            "project",
            "item-list",
            &number,
            "--owner",
            owner,
            "--limit",
            &limit,
            "--format",
            "json",
        ],
    )?;
    Ok(within_item_limit(parse_project_items(&json)?, ITEM_LIMIT))
}

/// The first `limit` items of a list `gh` was asked one more of; its count stays past
/// them when it had more.
fn within_item_limit(list: ProjectItemList, limit: usize) -> ProjectItemList {
    let (items, _) = within_limit(list.items, limit);
    ProjectItemList {
        items,
        total_count: list.total_count,
    }
}

fn status_field(path: &Path, owner: &str, number: &str) -> AppResult<StatusField> {
    let json = gh(
        path,
        &[
            "project",
            "field-list",
            number,
            "--owner",
            owner,
            "--format",
            "json",
        ],
    )?;
    parse_status_field(&json)?
        .ok_or_else(|| AppError::NotFound("this GitHub Project has no Status field".to_string()))
}

/// The Status options of the project, in their order on GitHub.
pub fn project_statuses(path: &Path, owner: &str, number: u32) -> AppResult<Vec<String>> {
    let field = status_field(path, owner, &number.to_string())?;
    Ok(field.options.into_iter().map(|(_, name)| name).collect())
}

pub fn create_issue(path: &Path, repo: &str, title: &str, body: &str) -> AppResult<CreatedIssue> {
    let stdout = gh(
        path,
        &[
            "issue", "create", "--repo", repo, "--title", title, "--body", body,
        ],
    )?;
    parse_created_issue(&stdout)
}

pub fn set_issue_state(path: &Path, repo: &str, number: u64, state: &str) -> AppResult<()> {
    let verb = match state {
        "closed" => "close",
        "open" => "reopen",
        other => {
            return Err(AppError::InvalidInput(format!(
                "unknown issue state: {other}"
            )));
        }
    };
    gh(path, &["issue", verb, &number.to_string(), "--repo", repo])?;
    Ok(())
}

/// Sets the item's Status to the option named `status` (case-insensitive).
pub fn move_project_item(
    path: &Path,
    owner: &str,
    number: u32,
    item_id: &str,
    status: &str,
) -> AppResult<()> {
    let number = number.to_string();
    let field = status_field(path, owner, &number)?;
    let wanted = status.trim().to_lowercase();
    let option = field
        .options
        .iter()
        .find(|(_, name)| name.trim().to_lowercase() == wanted)
        .map(|(id, _)| id.clone())
        .ok_or_else(|| {
            AppError::NotFound(format!("status \"{status}\" not in the GitHub Project"))
        })?;
    let view = gh(
        path,
        &[
            "project", "view", &number, "--owner", owner, "--format", "json",
        ],
    )?;
    let project_id = parse_project_id(&view)?;
    gh(
        path,
        &[
            "project",
            "item-edit",
            "--id",
            item_id,
            "--project-id",
            &project_id,
            "--field-id",
            &field.id,
            "--single-select-option-id",
            &option,
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_github_remotes_in_every_form() {
        let repo = Some("acme/widget".to_string());
        assert_eq!(parse_remote("https://github.com/acme/widget.git\n"), repo);
        assert_eq!(parse_remote("https://github.com/acme/widget"), repo);
        assert_eq!(parse_remote("https://token@github.com/acme/widget/"), repo);
        assert_eq!(parse_remote("git@github.com:acme/widget.git"), repo);
        assert_eq!(parse_remote("ssh://git@github.com/acme/widget.git"), repo);
        assert_eq!(parse_remote("https://gitlab.com/acme/widget.git"), None);
        assert_eq!(parse_remote("https://github.com/acme"), None);
        assert_eq!(parse_remote(""), None);
    }

    #[test]
    fn reads_issues_with_lowercase_state_and_label_names() {
        let json = r#"[
          {"number":12,"title":"Crash","body":"steps","state":"OPEN","url":"https://github.com/a/b/issues/12",
           "closedAt":"0001-01-01T00:00:00Z","labels":[{"id":"x","name":"bug","color":"red"}]},
          {"number":3,"title":"Old","body":"","state":"CLOSED","url":"https://github.com/a/b/issues/3",
           "closedAt":"2026-10-20T10:00:00Z","labels":[]}
        ]"#;
        let issues = parse_issues(json).unwrap();
        assert_eq!(issues.len(), 2);
        assert_eq!(issues[0].state, "open");
        assert_eq!(issues[0].closed_at, None);
        assert_eq!(issues[0].labels, vec!["bug".to_string()]);
        assert_eq!(issues[1].state, "closed");
        assert_eq!(issues[1].closed_at.as_deref(), Some("2026-10-20T10:00:00Z"));
        assert!(parse_issues("[]").unwrap().is_empty());
        assert!(matches!(parse_issues("nope"), Err(AppError::Github(_))));
    }

    #[test]
    fn reads_project_items_and_their_status() {
        let json = r#"{"items":[
          {"id":"PVTI_1","title":"Crash","status":"In Progress","repository":"https://github.com/a/b",
           "content":{"type":"Issue","number":12,"repository":"a/b","title":"Crash","url":"https://github.com/a/b/issues/12","body":"steps"}},
          {"id":"PVTI_2","title":"Idea","content":{"type":"DraftIssue","title":"Idea","body":"maybe"}},
          {"id":"PVTI_3","title":"Fix","status":"","content":{"type":"PullRequest","number":4,"repository":"a/b","url":"https://github.com/a/b/pull/4"}}
        ],"totalCount":3}"#;
        let list = parse_project_items(json).unwrap();
        assert_eq!(list.total_count, 3);
        let items = list.items;
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].status.as_deref(), Some("In Progress"));
        assert_eq!(items[0].content.kind, "issue");
        assert_eq!(items[0].content.repo.as_deref(), Some("a/b"));
        assert_eq!(items[0].content.number, Some(12));
        assert_eq!(items[1].content.kind, "draft");
        assert_eq!(items[1].content.number, None);
        assert_eq!(items[1].status, None);
        assert_eq!(items[2].content.kind, "pullRequest");
        assert_eq!(items[2].status, None);
        assert!(parse_project_items("{}").is_err());
    }

    #[test]
    fn says_when_a_list_was_cut() {
        // A Project of 812 items, `gh` stopping at its limit.
        let cut = parse_project_items(r#"{"items":[{"id":"PVTI_1","title":"A","content":{"type":"DraftIssue"}}],"totalCount":812}"#).unwrap();
        assert_eq!((cut.items.len(), cut.total_count), (1, 812));
        // Asked for one more than it keeps: an extra one means more were left out.
        assert_eq!(within_limit(vec![1, 2, 3], 2), (vec![1, 2], true));
        assert_eq!(within_limit(vec![1, 2], 2), (vec![1, 2], false));
        // A `totalCount` that only counts what `gh` listed still leaves the count past the items kept.
        let item = r#"{"id":"PVTI","title":"A","content":{"type":"DraftIssue"}}"#;
        let json = format!(r#"{{"items":[{item},{item},{item}],"totalCount":3}}"#);
        let kept = within_item_limit(parse_project_items(&json).unwrap(), 2);
        assert_eq!((kept.items.len(), kept.total_count), (2, 3));
        let whole = within_item_limit(parse_project_items(&json).unwrap(), 3);
        assert_eq!((whole.items.len(), whole.total_count), (3, 3));
    }

    #[test]
    fn finds_the_status_field_and_its_options() {
        let json = r#"{"fields":[
          {"id":"F_title","name":"Title","type":"ProjectV2Field"},
          {"id":"F_status","name":"Status","type":"ProjectV2SingleSelectField",
           "options":[{"id":"o1","name":"Todo"},{"id":"o2","name":"Done"}]}
        ],"totalCount":2}"#;
        let field = parse_status_field(json).unwrap().unwrap();
        assert_eq!(field.id, "F_status");
        assert_eq!(
            field.options,
            vec![("o1".into(), "Todo".into()), ("o2".into(), "Done".into())]
        );
        assert_eq!(parse_status_field(r#"{"fields":[]}"#).unwrap(), None);
    }

    #[test]
    fn reads_the_project_id_and_the_created_issue() {
        assert_eq!(
            parse_project_id(r#"{"id":"PVT_9","number":1}"#).unwrap(),
            "PVT_9"
        );
        assert!(parse_project_id("{}").is_err());
        let created =
            parse_created_issue("\nCreating issue in a/b\n\nhttps://github.com/a/b/issues/42\n")
                .unwrap();
        assert_eq!(
            created,
            CreatedIssue {
                number: 42,
                url: "https://github.com/a/b/issues/42".into()
            }
        );
        assert!(parse_created_issue("nothing").is_err());
    }

    #[test]
    fn stops_a_gh_call_that_does_not_answer() {
        // A stand-in for a `gh` waiting on a network that never answers: it would run 30 s.
        let (program, args): (&str, &[&str]) = if cfg!(windows) {
            ("ping", &["-n", "30", "127.0.0.1"])
        } else {
            ("sleep", &["30"])
        };
        let started = std::time::Instant::now();
        let error = run(
            Path::new(program),
            &std::env::temp_dir(),
            args,
            Duration::from_millis(500),
        )
        .unwrap_err();
        assert!(started.elapsed() < Duration::from_secs(10));
        assert!(
            matches!(&error, AppError::Github(message) if message.contains("did not answer")),
            "{error}"
        );
    }

    #[test]
    fn converts_unix_days_to_dates() {
        assert_eq!(date_of_day(0), "1970-01-01");
        assert_eq!(date_of_day(19_782), "2024-02-29");
        assert_eq!(date_of_day(20_754), "2026-10-28");
    }
}
