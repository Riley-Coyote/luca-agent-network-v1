use std::{
    io::Write,
    path::{Component, Path},
    process::{Command, Output, Stdio},
    thread,
    time::{Duration, Instant},
};

use luca_protocol::RepositoryToolOperationV1;
use serde::Deserialize;
use serde_json::Value;

use crate::luca::connected_brain::repository;

const MAX_TOOL_OUTPUT_BYTES: usize = 64 * 1024;
const MAX_SEARCH_RESULTS: usize = 200;
const MAX_READ_LINES: usize = 400;
const MAX_RUN_TIMEOUT_MS: u64 = 10 * 60 * 1_000;

pub(super) struct RepositoryOperationResultV1 {
    pub content: String,
    pub changed_path_count: usize,
}

pub(super) struct PreparedRepositoryOperationV1 {
    pub source_id: String,
    pub relative_paths: Vec<String>,
    pub display_summary: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceArgs {
    source_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TreeArgs {
    source_id: String,
    #[serde(default)]
    path: Option<String>,
    #[serde(default = "default_depth")]
    depth: usize,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SearchArgs {
    source_id: String,
    query: String,
    #[serde(default)]
    path: Option<String>,
    #[serde(default = "default_search_limit")]
    limit: usize,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReadArgs {
    source_id: String,
    path: String,
    #[serde(default)]
    offset: usize,
    #[serde(default = "default_read_limit")]
    limit: usize,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PatchArgs {
    source_id: String,
    patch: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RunArgs {
    source_id: String,
    executable: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default = "default_run_timeout")]
    timeout_ms: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DiffArgs {
    source_id: String,
    #[serde(default)]
    path: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CommitArgs {
    source_id: String,
    message: String,
}

fn default_depth() -> usize {
    4
}

fn default_search_limit() -> usize {
    50
}

fn default_read_limit() -> usize {
    200
}

fn default_run_timeout() -> u64 {
    120_000
}

pub(super) fn prepare(
    operation: RepositoryToolOperationV1,
    arguments: &Value,
) -> Result<PreparedRepositoryOperationV1, String> {
    match operation {
        RepositoryToolOperationV1::OperatorStatus => {
            Err("operator status is handled by the broker".into())
        }
        RepositoryToolOperationV1::ProposeRuntimeTask => {
            Err("runtime task proposals are handled by the broker".into())
        }
        RepositoryToolOperationV1::ReadRuntimeTaskResult => {
            Err("runtime task results are handled by the broker".into())
        }
        RepositoryToolOperationV1::List => {
            Err("repositories does not use a source operation".into())
        }
        RepositoryToolOperationV1::Tree => {
            let args: TreeArgs = decode(arguments)?;
            if args.depth == 0 || args.depth > 16 {
                return Err("repository tree depth is out of bounds".into());
            }
            let paths = optional_path(args.path)?;
            Ok(prepared(args.source_id, paths, "List repository files"))
        }
        RepositoryToolOperationV1::Search => {
            let args: SearchArgs = decode(arguments)?;
            if args.query.trim().is_empty()
                || args.query.len() > 512
                || args.limit == 0
                || args.limit > MAX_SEARCH_RESULTS
            {
                return Err("repository search request is out of bounds".into());
            }
            let paths = optional_path(args.path)?;
            Ok(prepared(args.source_id, paths, "Search repository text"))
        }
        RepositoryToolOperationV1::Read => {
            let args: ReadArgs = decode(arguments)?;
            if args.limit == 0 || args.limit > MAX_READ_LINES {
                return Err("repository read window is out of bounds".into());
            }
            let path = safe_path(&args.path)?;
            Ok(prepared(args.source_id, vec![path], "Read repository text"))
        }
        RepositoryToolOperationV1::ApplyPatch => {
            let args: PatchArgs = decode(arguments)?;
            if args.patch.is_empty() || args.patch.len() > 512 * 1024 {
                return Err("repository patch is out of bounds".into());
            }
            let paths = patch_paths(&args.patch)?;
            Ok(prepared(args.source_id, paths, "Apply a repository patch"))
        }
        RepositoryToolOperationV1::Run => {
            let args: RunArgs = decode(arguments)?;
            validate_run(&args)?;
            Ok(prepared(
                args.source_id,
                Vec::new(),
                "Run a local repository command",
            ))
        }
        RepositoryToolOperationV1::Status => {
            let args: SourceArgs = decode(arguments)?;
            Ok(prepared(
                args.source_id,
                Vec::new(),
                "Read repository status",
            ))
        }
        RepositoryToolOperationV1::Diff => {
            let args: DiffArgs = decode(arguments)?;
            let paths = optional_path(args.path)?;
            Ok(prepared(args.source_id, paths, "Read repository diff"))
        }
        RepositoryToolOperationV1::Commit => {
            let args: CommitArgs = decode(arguments)?;
            if args.message.trim().is_empty() || args.message.len() > 512 {
                return Err("repository commit message is out of bounds".into());
            }
            Ok(prepared(
                args.source_id,
                Vec::new(),
                "Create one local repository commit",
            ))
        }
    }
}

pub(super) fn execute(
    root: &Path,
    operation: RepositoryToolOperationV1,
    arguments: &Value,
) -> Result<RepositoryOperationResultV1, String> {
    match operation {
        RepositoryToolOperationV1::OperatorStatus => {
            Err("operator status is handled by the broker".into())
        }
        RepositoryToolOperationV1::ProposeRuntimeTask => {
            Err("runtime task proposals are handled by the broker".into())
        }
        RepositoryToolOperationV1::ReadRuntimeTaskResult => {
            Err("runtime task results are handled by the broker".into())
        }
        RepositoryToolOperationV1::List => Err("repositories is handled by the broker".into()),
        RepositoryToolOperationV1::Tree => tree(root, decode(arguments)?),
        RepositoryToolOperationV1::Search => search(root, decode(arguments)?),
        RepositoryToolOperationV1::Read => read(root, decode(arguments)?),
        RepositoryToolOperationV1::ApplyPatch => apply_patch(root, decode(arguments)?),
        RepositoryToolOperationV1::Run => run(root, decode(arguments)?),
        RepositoryToolOperationV1::Status => status(root),
        RepositoryToolOperationV1::Diff => diff(root, decode(arguments)?),
        RepositoryToolOperationV1::Commit => commit(root, decode(arguments)?),
    }
}

fn tree(root: &Path, args: TreeArgs) -> Result<RepositoryOperationResultV1, String> {
    let prefix = args.path.map(|path| safe_path(&path)).transpose()?;
    let base_depth = prefix
        .as_ref()
        .map_or(0, |prefix| prefix.split('/').count());
    let mut paths = Vec::new();
    let mut output_bytes = 0_usize;
    repository::visit_documents(root, |relative_path, _body| {
        if prefix
            .as_ref()
            .is_none_or(|prefix| relative_path.starts_with(prefix))
            && relative_path.split('/').count() <= base_depth.saturating_add(args.depth)
        {
            output_bytes = output_bytes.saturating_add(relative_path.len() + 1);
            paths.push(relative_path.to_owned());
        }
        Ok(output_bytes < MAX_TOOL_OUTPUT_BYTES)
    })?;
    paths.sort();
    ok(truncate(paths.join("\n")), 0)
}

fn search(root: &Path, args: SearchArgs) -> Result<RepositoryOperationResultV1, String> {
    let prefix = args.path.map(|path| safe_path(&path)).transpose()?;
    let query = args.query.to_lowercase();
    let mut results = Vec::new();
    repository::visit_documents(root, |relative_path, body| {
        if prefix
            .as_ref()
            .is_some_and(|prefix| !relative_path.starts_with(prefix))
        {
            return Ok(true);
        }
        for (index, line) in body.lines().enumerate() {
            if line.to_lowercase().contains(&query) {
                results.push(format!("{}:{}:{}", relative_path, index + 1, line.trim()));
                if results.len() >= args.limit {
                    return Ok(false);
                }
            }
        }
        Ok(true)
    })?;
    ok(sanitize_output(root, &results.join("\n")), 0)
}

fn read(root: &Path, args: ReadArgs) -> Result<RepositoryOperationResultV1, String> {
    let path = safe_path(&args.path)?;
    let body = repository::read_document(root, &path)?;
    let content = body
        .lines()
        .skip(args.offset)
        .take(args.limit)
        .enumerate()
        .map(|(index, line)| format!("{}:{}", args.offset + index + 1, line))
        .collect::<Vec<_>>()
        .join("\n");
    ok(sanitize_output(root, &content), 0)
}

fn apply_patch(root: &Path, args: PatchArgs) -> Result<RepositoryOperationResultV1, String> {
    let paths = patch_paths(&args.patch)?;
    run_git_with_input(
        root,
        &["apply", "--check", "--whitespace=nowarn", "-"],
        &args.patch,
    )?;
    run_git_with_input(root, &["apply", "--whitespace=nowarn", "-"], &args.patch)?;
    ok(
        format!("Applied patch to {} path(s).", paths.len()),
        paths.len(),
    )
}

fn run(root: &Path, args: RunArgs) -> Result<RepositoryOperationResultV1, String> {
    validate_run(&args)?;
    let mut command = Command::new(&args.executable);
    command.args(&args.args);
    let output = run_command(root, command, args.timeout_ms)?;
    let text = format_output(root, &output);
    if !output.status.success() {
        return Err(text);
    }
    ok(text, 0)
}

fn status(root: &Path) -> Result<RepositoryOperationResultV1, String> {
    let output = run_git(root, &["status", "--short"])?;
    ok(
        sanitize_output(root, &String::from_utf8_lossy(&output.stdout)),
        0,
    )
}

fn diff(root: &Path, args: DiffArgs) -> Result<RepositoryOperationResultV1, String> {
    let path = args.path.map(|path| safe_path(&path)).transpose()?;
    let mut command = Command::new("git");
    command.args(["diff", "--no-ext-diff", "--"]);
    if let Some(path) = path {
        command.arg(path);
    }
    let output = run_command(root, command, 30_000)?;
    if !output.status.success() {
        return Err(format_output(root, &output));
    }
    ok(
        sanitize_output(root, &String::from_utf8_lossy(&output.stdout)),
        0,
    )
}

fn commit(root: &Path, args: CommitArgs) -> Result<RepositoryOperationResultV1, String> {
    if args.message.trim().is_empty() || args.message.len() > 512 {
        return Err("repository commit message is out of bounds".into());
    }
    let changed = git_changed_paths(root)?;
    if changed.is_empty() {
        return Err("repository has no changes to commit".into());
    }
    let add = run_git(root, &["add", "-A"])?;
    if !add.status.success() {
        return Err(format_output(root, &add));
    }
    let mut command = Command::new("git");
    command.args(["commit", "-m", args.message.trim()]);
    let output = run_command(root, command, MAX_RUN_TIMEOUT_MS)?;
    if !output.status.success() {
        return Err(format_output(root, &output));
    }
    ok(format_output(root, &output), changed.len())
}

fn git_changed_paths(root: &Path) -> Result<Vec<String>, String> {
    let output = run_git(root, &["status", "--porcelain=v1", "-z"])?;
    if !output.status.success() {
        return Err(format_output(root, &output));
    }
    let entries = output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
        .collect::<Vec<_>>();
    let mut paths = Vec::new();
    let mut index = 0;
    while index < entries.len() {
        let entry = entries[index];
        if entry.len() < 4 || entry[2] != b' ' {
            return Err("repository Git status response is invalid".into());
        }
        let status = [entry[0], entry[1]];
        let path = std::str::from_utf8(&entry[3..])
            .map_err(|_| "repository Git status path is invalid".to_owned())?;
        paths.push(safe_path(path)?);
        if status.iter().any(|code| matches!(code, b'R' | b'C')) {
            index += 1;
            let origin = entries
                .get(index)
                .ok_or_else(|| "repository Git rename status is incomplete".to_owned())?;
            let origin = std::str::from_utf8(origin)
                .map_err(|_| "repository Git status path is invalid".to_owned())?;
            paths.push(safe_path(origin)?);
        }
        index += 1;
    }
    paths.sort();
    paths.dedup();
    if paths.len() > luca_protocol::MAX_REPOSITORY_TOOL_PATHS {
        return Err("repository commit changes too many paths".into());
    }
    Ok(paths)
}

fn run_git(root: &Path, args: &[&str]) -> Result<Output, String> {
    let mut command = Command::new("git");
    command.args(args);
    run_command(root, command, MAX_RUN_TIMEOUT_MS)
}

fn run_git_with_input(root: &Path, args: &[&str], input: &str) -> Result<(), String> {
    let mut command = Command::new("git");
    command.args(args).stdin(Stdio::piped());
    prepare_command(root, &mut command);
    let mut child = command
        .spawn()
        .map_err(|_| "repository Git operation could not start".to_owned())?;
    child
        .stdin
        .take()
        .ok_or_else(|| "repository Git input is unavailable".to_owned())?
        .write_all(input.as_bytes())
        .map_err(|_| "repository Git input failed".to_owned())?;
    let output = wait_with_timeout(child, MAX_RUN_TIMEOUT_MS)?;
    if !output.status.success() {
        return Err(format_output(root, &output));
    }
    Ok(())
}

fn run_command(root: &Path, mut command: Command, timeout_ms: u64) -> Result<Output, String> {
    prepare_command(root, &mut command);
    let child = command
        .spawn()
        .map_err(|_| "repository command could not start".to_owned())?;
    wait_with_timeout(child, timeout_ms)
}

fn prepare_command(root: &Path, command: &mut Command) {
    let path = std::env::var_os("PATH").unwrap_or_default();
    command
        .current_dir(root)
        .env_clear()
        .env("PATH", path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
}

fn wait_with_timeout(mut child: std::process::Child, timeout_ms: u64) -> Result<Output, String> {
    let deadline = Instant::now() + Duration::from_millis(timeout_ms.min(MAX_RUN_TIMEOUT_MS));
    loop {
        if child
            .try_wait()
            .map_err(|_| "repository command status failed".to_owned())?
            .is_some()
        {
            return child
                .wait_with_output()
                .map_err(|_| "repository command output failed".to_owned());
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("repository command timed out".into());
        }
        thread::sleep(Duration::from_millis(25));
    }
}

fn validate_run(args: &RunArgs) -> Result<(), String> {
    if args.executable.trim().is_empty()
        || args.executable.len() > 256
        || args.args.len() > 128
        || args.timeout_ms == 0
        || args.timeout_ms > MAX_RUN_TIMEOUT_MS
    {
        return Err("repository command is out of bounds".into());
    }
    let executable = Path::new(&args.executable)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if executable != args.executable.to_ascii_lowercase()
        || args.executable.contains('/')
        || args.executable.contains('\\')
    {
        return Err("repository command executable must be a PATH-resolved name".into());
    }
    if [
        "sh",
        "bash",
        "zsh",
        "fish",
        "cmd",
        "cmd.exe",
        "powershell",
        "pwsh",
        "env",
        "xargs",
        "ssh",
        "scp",
        "curl",
        "wget",
        "gh",
        "hub",
    ]
    .contains(&executable.as_str())
    {
        return Err("repository command executable is not permitted".into());
    }
    if executable == "git" {
        let subcommand = args.args.iter().find(|arg| !arg.starts_with('-'));
        if !matches!(
            subcommand.map(String::as_str),
            Some(
                "status"
                    | "diff"
                    | "log"
                    | "show"
                    | "grep"
                    | "ls-files"
                    | "rev-parse"
                    | "describe"
                    | "check-ignore"
            )
        ) {
            return Err("credentialed or mutating Git commands are not exposed".into());
        }
    }
    if args.args.iter().any(|arg| {
        arg.len() > 4096
            || arg.starts_with('/')
            || arg.contains("../")
            || arg.contains("..\\")
            || credential_marker(arg)
    }) {
        return Err("repository command arguments are unsafe".into());
    }
    Ok(())
}

fn credential_marker(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    [
        ".env",
        "credential",
        "secret",
        "api_key",
        "api-key",
        "token",
        "id_rsa",
        "id_ed25519",
        ".pem",
        ".key",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

fn patch_paths(patch: &str) -> Result<Vec<String>, String> {
    let mut paths = patch
        .lines()
        .filter_map(|line| {
            line.strip_prefix("+++ ")
                .or_else(|| line.strip_prefix("--- "))
                .or_else(|| line.strip_prefix("rename from "))
                .or_else(|| line.strip_prefix("rename to "))
        })
        .filter(|path| *path != "/dev/null")
        .map(|path| {
            path.strip_prefix("a/")
                .or_else(|| path.strip_prefix("b/"))
                .unwrap_or(path)
        })
        .map(safe_path)
        .collect::<Result<Vec<_>, _>>()?;
    paths.sort();
    paths.dedup();
    if paths.is_empty() || paths.len() > luca_protocol::MAX_REPOSITORY_TOOL_PATHS {
        return Err("repository patch paths are invalid".into());
    }
    Ok(paths)
}

fn optional_path(path: Option<String>) -> Result<Vec<String>, String> {
    path.map(|path| safe_path(&path).map(|path| vec![path]))
        .unwrap_or_else(|| Ok(Vec::new()))
}

fn safe_path(value: &str) -> Result<String, String> {
    let path = Path::new(value);
    if !repository::path_is_indexable(value)
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("repository path is unsafe or excluded".into());
    }
    Ok(value.replace('\\', "/"))
}

fn prepared(
    source_id: String,
    relative_paths: Vec<String>,
    display_summary: &str,
) -> PreparedRepositoryOperationV1 {
    PreparedRepositoryOperationV1 {
        source_id,
        relative_paths,
        display_summary: display_summary.to_owned(),
    }
}

fn decode<T: for<'de> Deserialize<'de>>(value: &Value) -> Result<T, String> {
    serde_json::from_value(value.clone())
        .map_err(|_| "repository tool arguments are invalid".into())
}

fn ok(content: String, changed_path_count: usize) -> Result<RepositoryOperationResultV1, String> {
    Ok(RepositoryOperationResultV1 {
        content: truncate(content),
        changed_path_count,
    })
}

fn format_output(root: &Path, output: &Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let text = format!(
        "exit code: {}\n{}{}",
        output.status.code().unwrap_or(-1),
        stdout,
        stderr
    );
    truncate(sanitize_output(root, &text))
}

fn sanitize_output(root: &Path, text: &str) -> String {
    let mut sanitized = text.replace(&root.to_string_lossy().to_string(), "<repository>");
    if let Some(home) = dirs::home_dir() {
        sanitized = sanitized.replace(&home.to_string_lossy().to_string(), "<home>");
    }
    sanitized
}

fn truncate(mut value: String) -> String {
    if value.len() <= MAX_TOOL_OUTPUT_BYTES {
        return value;
    }
    let mut boundary = MAX_TOOL_OUTPUT_BYTES;
    while !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    value.truncate(boundary);
    value.push_str("\n[output truncated]");
    value
}
