//! DA-1: Native Rust implementations of filesystem operations that previously
//! required spawning the Bun sidecar. These are pure filesystem scans with no
//! dependency on the Claude Agent SDK.

use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Serialize)]
pub struct SlashCommand {
    pub name: String,
    pub desc: String,
    pub source: String,
}

/// Extract a description from markdown frontmatter.
/// Looks for `description: <value>` between `---` fences.
fn extract_frontmatter_desc(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    // Must start with ---
    if !content.starts_with("---") {
        return None;
    }
    // Find closing ---
    let rest = &content[3..];
    let end = rest.find("---")?;
    let frontmatter = &rest[..end];

    for line in frontmatter.lines() {
        let trimmed = line.trim();
        if let Some(value) = trimmed.strip_prefix("description:") {
            let desc = value.trim().trim_matches(|c| c == '\'' || c == '"');
            if !desc.is_empty() {
                return Some(desc.to_string());
            }
        }
    }
    None
}

/// Recursively scan a directory for `.md` files and treat them as commands.
fn scan_command_dir(dir: &Path, prefix: &str, source: &str, out: &mut Vec<SlashCommand>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = entry.file_name();
        let name_str = file_name.to_string_lossy();

        if path.is_dir() {
            let new_prefix = if prefix.is_empty() {
                name_str.to_string()
            } else {
                format!("{}:{}", prefix, name_str)
            };
            scan_command_dir(&path, &new_prefix, source, out);
        } else if name_str.ends_with(".md") {
            let base = name_str.trim_end_matches(".md");
            let cmd_name = if prefix.is_empty() {
                format!("/{}", base)
            } else {
                format!("/{}:{}", prefix, base)
            };
            let desc = extract_frontmatter_desc(&path).unwrap_or_else(|| source.to_string());
            out.push(SlashCommand {
                name: cmd_name,
                desc,
                source: source.to_string(),
            });
        }
    }
}

/// Scan a skills directory: each subdirectory with a SKILL.md is a skill.
fn scan_skill_dir(dir: &Path, source: &str, plugin_prefix: Option<&str>, out: &mut Vec<SlashCommand>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let skill_md = path.join("SKILL.md");
        if !skill_md.exists() {
            continue;
        }
        let dir_name = entry.file_name();
        let dir_name_str = dir_name.to_string_lossy();
        let cmd_name = match plugin_prefix {
            Some(prefix) => format!("/{}:{}", prefix, dir_name_str),
            None => format!("/{}", dir_name_str),
        };
        let desc = extract_frontmatter_desc(&skill_md).unwrap_or_else(|| source.to_string());
        out.push(SlashCommand {
            name: cmd_name,
            desc,
            source: source.to_string(),
        });
    }
}

/// Scan the plugin cache directory for commands and skills.
fn scan_plugin_cache(cache_dir: &Path, out: &mut Vec<SlashCommand>) {
    let vendors = match fs::read_dir(cache_dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for vendor_entry in vendors.flatten() {
        if !vendor_entry.path().is_dir() {
            continue;
        }
        let plugins = match fs::read_dir(vendor_entry.path()) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for plugin_entry in plugins.flatten() {
            if !plugin_entry.path().is_dir() {
                continue;
            }
            let plugin_name = plugin_entry.file_name().to_string_lossy().to_string();

            // Find latest version directory
            let mut versions: Vec<String> = match fs::read_dir(plugin_entry.path()) {
                Ok(entries) => entries
                    .flatten()
                    .filter(|e| e.path().is_dir())
                    .map(|e| e.file_name().to_string_lossy().to_string())
                    .collect(),
                Err(_) => continue,
            };
            versions.sort();
            let latest = match versions.last() {
                Some(v) => v.clone(),
                None => continue,
            };
            let latest_dir = plugin_entry.path().join(&latest);
            let plugin_label = format!("plugin: {}", plugin_name);

            // Scan commands/ subdirectory
            let commands_dir = latest_dir.join("commands");
            if commands_dir.is_dir() {
                if let Ok(entries) = fs::read_dir(&commands_dir) {
                    for entry in entries.flatten() {
                        let name_str = entry.file_name().to_string_lossy().to_string();
                        if name_str.ends_with(".md") {
                            let base = name_str.trim_end_matches(".md");
                            let cmd_name = format!("/{}:{}", plugin_name, base);
                            let desc = extract_frontmatter_desc(&entry.path())
                                .unwrap_or_else(|| plugin_label.clone());
                            out.push(SlashCommand {
                                name: cmd_name,
                                desc,
                                source: plugin_label.clone(),
                            });
                        }
                    }
                }
            }

            // Scan skills/ subdirectory
            let skills_dir = latest_dir.join("skills");
            if skills_dir.is_dir() {
                scan_skill_dir(&skills_dir, &plugin_label, Some(&plugin_name), out);
            }
        }
    }
}

/// List all available slash commands and skills by scanning the filesystem.
/// Replaces the sidecar's `listCommands` handler.
#[tauri::command]
pub async fn list_commands(project_path: Option<String>) -> Vec<SlashCommand> {
    // Run the potentially slow FS scan on a blocking thread
    tauri::async_runtime::spawn_blocking(move || {
        let mut commands = Vec::new();
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));

        // 1. User-level commands and skills
        let user_commands = home.join(".claude").join("commands");
        scan_command_dir(&user_commands, "", "user command", &mut commands);

        let user_skills = home.join(".claude").join("skills");
        scan_skill_dir(&user_skills, "user skill", None, &mut commands);

        // 2. Project-level commands and skills
        if let Some(ref project_dir) = project_path {
            let project = PathBuf::from(project_dir);
            let proj_commands = project.join(".claude").join("commands");
            scan_command_dir(&proj_commands, "", "project command", &mut commands);

            let proj_skills = project.join(".claude").join("skills");
            scan_skill_dir(&proj_skills, "project skill", None, &mut commands);
        }

        // 3. Plugin cache
        let cache_dir = home.join(".claude").join("plugins").join("cache");
        if cache_dir.is_dir() {
            scan_plugin_cache(&cache_dir, &mut commands);
        }

        // 4. Deduplicate by name (keep first occurrence)
        let mut seen = HashSet::new();
        commands.retain(|c| seen.insert(c.name.clone()));

        commands
    })
    .await
    .unwrap_or_default()
}

/// Return how many commits the given branch is ahead of / behind a base branch.
/// Runs `git rev-list --left-right --count <base>...<branch>` in `repo_path`.
/// Returns `{ ahead: u32, behind: u32, branch: String, base: String }`.
/// `branch` defaults to the current HEAD branch when omitted.
/// `base`   defaults to the first of main/master/trunk that exists.
#[tauri::command]
pub async fn git_branch_status(
    repo_path: String,
    branch: Option<String>,
    base: Option<String>,
) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move || {
        // Resolve the working branch name
        let branch_name = match branch {
            Some(b) if !b.is_empty() => b,
            _ => {
                // Ask git for the current symbolic ref
                let out = std::process::Command::new("git")
                    .args(["-C", &repo_path, "symbolic-ref", "--short", "HEAD"])
                    .output();
                match out {
                    Ok(o) if o.status.success() => {
                        String::from_utf8_lossy(&o.stdout).trim().to_string()
                    }
                    _ => return serde_json::json!({ "error": "cannot determine current branch" }),
                }
            }
        };

        // Resolve the base branch
        let base_name = match base {
            Some(b) if !b.is_empty() => b,
            _ => {
                // Try common principal branch names
                let candidates = ["main", "master", "trunk", "develop"];
                let mut found = String::new();
                for c in &candidates {
                    let check = std::process::Command::new("git")
                        .args(["-C", &repo_path, "rev-parse", "--verify", c])
                        .output();
                    if check.map(|o| o.status.success()).unwrap_or(false) {
                        found = c.to_string();
                        break;
                    }
                }
                if found.is_empty() {
                    return serde_json::json!({ "error": "cannot determine base branch" });
                }
                found
            }
        };

        // Skip count if branch == base (trivially 0/0)
        if branch_name == base_name {
            return serde_json::json!({
                "ahead": 0, "behind": 0,
                "branch": branch_name, "base": base_name
            });
        }

        // git rev-list --left-right --count <base>...<branch>
        // Output: "<behind>\t<ahead>\n"
        let triple_dot = format!("{}...{}", base_name, branch_name);
        let result = std::process::Command::new("git")
            .args(["-C", &repo_path, "rev-list", "--left-right", "--count", &triple_dot])
            .output();

        match result {
            Ok(o) if o.status.success() => {
                let stdout = String::from_utf8_lossy(&o.stdout);
                let parts: Vec<&str> = stdout.trim().split('\t').collect();
                if parts.len() == 2 {
                    let behind: u32 = parts[0].parse().unwrap_or(0);
                    let ahead:  u32 = parts[1].parse().unwrap_or(0);
                    serde_json::json!({
                        "ahead": ahead, "behind": behind,
                        "branch": branch_name, "base": base_name
                    })
                } else {
                    serde_json::json!({ "error": "unexpected git output", "raw": stdout.trim() })
                }
            }
            Ok(o) => {
                let stderr = String::from_utf8_lossy(&o.stderr);
                serde_json::json!({ "error": stderr.trim() })
            }
            Err(e) => serde_json::json!({ "error": e.to_string() }),
        }
    })
    .await
    .unwrap_or_else(|e| serde_json::json!({ "error": e.to_string() }))
}

/// Delete a Claude session's JSONL files from ~/.claude/projects/.
/// Replaces the sidecar's `deleteSession` handler.
#[tauri::command]
pub async fn delete_session(session_id: String) -> bool {
    tauri::async_runtime::spawn_blocking(move || {
        let home = match dirs::home_dir() {
            Some(h) => h,
            None => return false,
        };
        let projects_dir = home.join(".claude").join("projects");
        if !projects_dir.is_dir() {
            return false;
        }

        let mut deleted = false;
        if let Ok(entries) = fs::read_dir(&projects_dir) {
            for entry in entries.flatten() {
                if !entry.path().is_dir() {
                    continue;
                }
                let jsonl_path = entry.path().join(format!("{}.jsonl", session_id));
                if jsonl_path.exists() {
                    if fs::remove_file(&jsonl_path).is_ok() {
                        deleted = true;
                    }
                }
            }
        }
        deleted
    })
    .await
    .unwrap_or(false)
}

/// Return the git status of specific files within a repository.
/// Runs `git -C <repo_path> status --porcelain -- <file1> <file2> ...`.
/// For each file returns one of: "clean", "modified", "missing".
/// Files that appear in porcelain output (M, A, ??, etc.) → "modified".
/// Files absent from output → check disk: exists → "clean", else → "missing".
#[tauri::command]
pub async fn git_file_status(
    repo_path: String,
    file_paths: Vec<String>,
) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move || {
        let repo = Path::new(&repo_path);

        // Build git command: git -C <repo> status --porcelain -- file1 file2 ...
        let mut cmd = std::process::Command::new("git");
        cmd.args(["-C", &repo_path, "status", "--porcelain", "--"]);
        for fp in &file_paths {
            cmd.arg(fp);
        }

        let output = match cmd.output() {
            Ok(o) if o.status.success() => o,
            Ok(o) => {
                let stderr = String::from_utf8_lossy(&o.stderr);
                return serde_json::json!({ "error": stderr.trim() });
            }
            Err(e) => return serde_json::json!({ "error": e.to_string() }),
        };

        let stdout = String::from_utf8_lossy(&output.stdout);

        // Parse porcelain output: lines like "XY <path>" or "XY <path> -> <path>"
        let mut modified_files: HashSet<String> = HashSet::new();
        for line in stdout.lines() {
            if line.len() < 4 {
                continue;
            }
            // Skip the 2-char status + space, take the path
            let path_part = &line[3..];
            // Handle renames: "old -> new"
            let file_path = if let Some(pos) = path_part.find(" -> ") {
                &path_part[pos + 4..]
            } else {
                path_part
            };
            modified_files.insert(file_path.to_string());
        }

        // Build result for each requested file
        let mut result = serde_json::Map::new();
        for fp in &file_paths {
            let status = if modified_files.contains(fp.as_str()) {
                "modified"
            } else if repo.join(fp).exists() {
                "clean"
            } else {
                "missing"
            };
            result.insert(fp.clone(), serde_json::json!(status));
        }

        serde_json::Value::Object(result)
    })
    .await
    .unwrap_or_else(|e| serde_json::json!({ "error": e.to_string() }))
}
