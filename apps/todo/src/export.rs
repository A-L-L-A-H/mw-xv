use std::fmt::Write as _;
use std::path::Path;

use anyhow::{Context, Result, bail};
use serde::Serialize;

use crate::home::Home;
use crate::share::Net;
use crate::store::{self, Comment, Project, Store, Task, short_time};

#[derive(Clone, Copy, clap::ValueEnum)]
pub enum Format {
    Markdown,
    Json,
    #[value(name = "tasks-json")]
    TasksJson,
}

#[derive(Serialize)]
struct Board {
    exported_at: String,
    statuses: Vec<String>,
    projects: Vec<ProjectOut>,
}

#[derive(Serialize)]
struct ProjectOut {
    #[serde(flatten)]
    project: Project,
    tasks: Vec<TaskOut>,
}

#[derive(Serialize)]
struct TaskOut {
    id: i64,
    key: String,
    title: String,
    description: String,
    tags: Vec<String>,
    url: String,
    human: bool,
    waits_on: Vec<String>,
    images: Vec<String>,
    status: String,
    created_at: String,
    updated_at: String,
    comments: Vec<Comment>,
}

impl TaskOut {
    fn new(task: Task, comments: Vec<Comment>, images: Vec<String>, waits_on: Vec<String>) -> Self {
        Self {
            key: task.key(),
            id: task.id,
            title: task.title,
            description: task.description,
            tags: task.tags,
            url: task.url,
            human: task.human,
            waits_on,
            images,
            status: task.status,
            created_at: task.created_at,
            updated_at: task.updated_at,
            comments,
        }
    }
}

pub fn export(home: &Home, format: Format, project: Option<&str>, output: Option<&Path>) -> Result<()> {
    if let Net::Joined(host) = Net::load(home) {
        bail!(
            "This computer uses the board at {host}: run moonwitness-dx export on that computer, or moonwitness-dx leave first."
        );
    }
    let store = home.store()?;

    match format {
        Format::TasksJson => {
            let tasks_json = collect_tasks_json(&store, project)?;
            let text = serde_json::to_string_pretty(&tasks_json)? + "\n";
            match output {
                Some(path) => {
                    std::fs::write(path, text).with_context(|| format!("cannot write {}", path.display()))?;
                    let task_count = tasks_json["tasks"].as_array().map_or(0, Vec::len);
                    let proj_count = tasks_json["projects"].as_array().map_or(0, Vec::len);
                    eprintln!("Exported {proj_count} projects and {task_count} tasks to {}", path.display());
                }
                None => print!("{text}"),
            }
        }
        Format::Markdown | Format::Json => {
            let board = collect(&store, project, &home.images())?;
            let text = match format {
                Format::Json => serde_json::to_string_pretty(&board)? + "\n",
                Format::Markdown => markdown(&board),
                _ => unreachable!(),
            };
            match output {
                Some(path) => {
                    std::fs::write(path, text).with_context(|| format!("cannot write {}", path.display()))?;
                    let tasks: usize = board.projects.iter().map(|p| p.tasks.len()).sum();
                    eprintln!("Exported {} projects and {tasks} tasks to {}", board.projects.len(), path.display());
                }
                None => print!("{text}"),
            }
        }
    }
    Ok(())
}

fn collect(store: &Store, only: Option<&str>, images: &Path) -> Result<Board> {
    let projects = match only {
        Some(slug) => vec![store.find_project(slug)?],
        None => store.list_projects()?,
    };
    let mut out = Vec::new();
    for project in projects {
        let mut tasks = Vec::new();
        for task in store.list_tasks(Some(project.id), None)? {
            let comments = store.list_comments(task.id)?;
            let paths = store.list_images(task.id)?.into_iter().map(|i| images.join(i.file).display().to_string());
            let waits = store.task_links(task.id, false)?.into_iter().map(|t| format!("{}#{}", t.project, t.id));
            tasks.push(TaskOut::new(task, comments, paths.collect(), waits.collect()));
        }
        out.push(ProjectOut { project, tasks });
    }
    Ok(Board { exported_at: store.now()?, statuses: store.statuses().to_vec(), projects: out })
}

pub fn collect_tasks_json(store: &Store, only: Option<&str>) -> Result<serde_json::Value> {
    let projects = match only {
        Some(slug) => vec![store.find_project(slug)?],
        None => store.list_projects()?,
    };

    let mut all_tasks = Vec::new();
    for project in &projects {
        let tasks = store.list_tasks(Some(project.id), None)?;
        for task in tasks {
            let comments = store.list_comments(task.id)?;
            let acceptance_criteria: serde_json::Value = task
                .acceptance_criteria_json
                .as_deref()
                .filter(|s| !s.is_empty())
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_else(|| serde_json::json!([]));

            let validation: serde_json::Value = task
                .validation_json
                .as_deref()
                .filter(|s| !s.is_empty())
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_else(|| serde_json::json!({"commands": [], "expected": ""}));

            let evidence: serde_json::Value = task
                .evidence_json
                .as_deref()
                .filter(|s| !s.is_empty())
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_else(|| serde_json::json!({"paths": [], "detailFile": null, "commitSha": null}));

            let scope: serde_json::Value = task
                .scope_json
                .as_deref()
                .filter(|s| !s.is_empty())
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_else(|| serde_json::json!({"packages": [], "files": []}));

            let source_ref: serde_json::Value = task
                .source_ref_json
                .as_deref()
                .filter(|s| !s.is_empty())
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_else(|| serde_json::json!({"file": "moonwitness-dx", "legacyId": null}));

            let depends_on: serde_json::Value = task
                .depends_on
                .as_deref()
                .filter(|s| !s.is_empty())
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_else(|| serde_json::json!([]));

            let blocks: serde_json::Value = task
                .blocks_json
                .as_deref()
                .filter(|s| !s.is_empty())
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_else(|| serde_json::json!([]));

            let references: serde_json::Value = task
                .refs_json
                .as_deref()
                .filter(|s| !s.is_empty())
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_else(|| serde_json::json!([]));

            let code = task.code.clone().unwrap_or_else(|| format!("TASK-{}", task.id));
            let series = task.series.clone().filter(|s| !s.is_empty()).unwrap_or_else(|| "TASK".into());
            let category = task
                .category
                .clone()
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "other".into());
            let task_type = task
                .task_type
                .clone()
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "feature".into());
            let priority = task
                .priority
                .clone()
                .filter(|s| ["p0", "p1", "p2", "p3"].contains(&s.as_str()))
                .unwrap_or_else(|| "p2".into());
            let horizon = task
                .horizon
                .clone()
                .filter(|s| ["now", "next", "later", "experiment"].contains(&s.as_str()));
            let risk = task
                .risk
                .clone()
                .filter(|s| ["low", "medium", "high"].contains(&s.as_str()));
            let effort = task
                .effort
                .clone()
                .filter(|s| ["xs", "s", "m", "l", "xl"].contains(&s.as_str()));
            let milestone = task.milestone.clone().filter(|s| !s.is_empty());
            let owner = task.owner.clone().filter(|s| !s.is_empty());
            let blocked_reason = task.blocked_reason.clone().filter(|s| !s.is_empty());

            let task_json = serde_json::json!({
                "code": code,
                "project": task.project,
                "series": series,
                "milestone": milestone,
                "horizon": horizon,
                "title": task.title,
                "summary": task.summary.unwrap_or_default(),
                "problem": task.problem.unwrap_or(task.description),
                "proposedSolution": task.proposed_solution.unwrap_or_default(),
                "category": category,
                "type": task_type,
                "priority": priority,
                "status": task.status,
                "human": task.human,
                "owner": owner,
                "assignee": owner,
                "risk": risk,
                "effort": effort,
                "scores": serde_json::Value::Null,
                "dependsOn": depends_on,
                "blocks": blocks,
                "tags": task.tags,
                "scope": scope,
                "acceptanceCriteria": acceptance_criteria,
                "validation": validation,
                "evidence": evidence,
                "references": references,
                "blockedReason": blocked_reason,
                "sourceRef": source_ref,
                "url": task.url,
                "comments": comments.into_iter().map(|c| serde_json::json!({
                    "author": c.author,
                    "body": c.body,
                    "createdAt": c.created_at
                })).collect::<Vec<_>>()
            });
            all_tasks.push(task_json);
        }
    }

    let docs = store.list_documents(None, None)?;
    let docs_json: Vec<serde_json::Value> = docs
        .into_iter()
        .map(|d| {
            serde_json::json!({
                "slug": d.slug,
                "layer": d.layer,
                "title": d.title,
                "body": d.body,
                "tags": d.tags,
                "project": d.project.unwrap_or_else(|| "moonwitness".into()),
                "status": d.status,
                "linkedTasks": d.linked_tasks,
                "createdAt": d.created_at,
                "updatedAt": d.updated_at
            })
        })
        .collect();

    let mut statuses = store.statuses().to_vec();
    if !statuses.iter().any(|s| s == "blocked") {
        statuses.push("blocked".into());
    }

    Ok(serde_json::json!({
        "schemaVersion": "2.0.0",
        "format": "moonwitness-tasks/v2",
        "generatedAt": chrono::Utc::now().to_rfc3339(),
        "projects": projects.iter().map(|p| serde_json::json!({
            "slug": p.slug,
            "name": p.name,
            "repos": p.repos,
            "color": p.color.clone().unwrap_or_else(|| "blue".into()),
            "statuses": statuses,
        })).collect::<Vec<_>>(),
        "tasks": all_tasks,
        "documents": docs_json
    }))
}

fn markdown(board: &Board) -> String {
    let mut md = format!("# moonwitness-dx board\n\nExported {}.\n", short_time(&board.exported_at));
    for p in &board.projects {
        let links: Vec<String> = p.project.repos.iter().map(|r| format!("[{r}](https://github.com/{r})")).collect();
        let repo = if links.is_empty() { String::new() } else { format!(" ({})", links.join(", ")) };
        let _ = write!(
            md,
            "\n## {} `{}`{repo}\n\n{} open of {} {}.\n",
            p.project.name,
            p.project.slug,
            p.project.open,
            p.project.total,
            store::tasks(p.project.total)
        );
        let mut statuses = board.statuses.clone();
        for t in &p.tasks {
            if !statuses.contains(&t.status) {
                statuses.push(t.status.clone());
            }
        }
        for status in &statuses {
            let tasks: Vec<_> = p.tasks.iter().filter(|t| t.status == *status).collect();
            if tasks.is_empty() {
                continue;
            }
            let _ = write!(md, "\n### {status}\n");
            for t in tasks {
                let _ = write!(
                    md,
                    "\n#### {} {}\n\nCreated {}, updated {}.\n",
                    t.key,
                    t.title,
                    short_time(&t.created_at),
                    short_time(&t.updated_at)
                );
                if t.human {
                    md.push_str("Human task.\n");
                }
                if !t.tags.is_empty() {
                    let _ = writeln!(md, "Tags: {}.", t.tags.join(", "));
                }
                if !t.waits_on.is_empty() {
                    let _ = writeln!(md, "Waits on: {}.", t.waits_on.join(", "));
                }
                if !t.url.is_empty() {
                    let _ = writeln!(md, "URL: <{}>", t.url);
                }
                if !t.images.is_empty() {
                    let _ = writeln!(md, "Images: {}.", t.images.join(", "));
                }
                if !t.description.is_empty() {
                    let _ = write!(md, "\n{}\n", t.description);
                }
                if !t.comments.is_empty() {
                    md.push_str("\nComments:\n\n");
                    for c in &t.comments {
                        let body = c.body.replace('\n', "\n  ");
                        let _ = writeln!(md, "- **{}**, {}: {body}", c.author, short_time(&c.created_at));
                    }
                }
            }
        }
    }
    md
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::{ImportMode, import_tasks_file};

    #[test]
    fn exports_everything() {
        let tmp = tempfile::tempdir().unwrap();
        let home = Home::open(tmp.path().to_path_buf()).unwrap();
        let store = home.store().unwrap();
        let api = store.create_project("api", "API", Some("me/api")).unwrap();
        store.create_project("web", "Web", None).unwrap();
        let t = store.create_task(api.id, "Fix login", "Steps:\n1. log in").unwrap();
        store.add_comment(t.id, "claude-code", "Found it\nin auth.rs", &[]).unwrap();
        let done = store.create_task(api.id, "Old work", "").unwrap();
        store.move_task(done.id, "done", None).unwrap();
        let waits = store::TaskPatch { waits_on: Some(done.key()), ..Default::default() };
        store.update_task(t.id, waits).unwrap();

        let board = collect(&store, None, Path::new("/k/images")).unwrap();
        let md = markdown(&board);
        assert!(md.contains("## API `api` ([me/api](https://github.com/me/api))"), "{md}");
        assert!(md.contains("### todo\n\n#### api#1 Fix login"), "{md}");
        assert!(md.contains("Steps:\n1. log in"), "{md}");
        assert!(md.contains("Waits on: api#2."), "{md}");
        assert!(md.contains("- **claude-code**, ") && md.contains("Found it\n  in auth.rs"), "{md}");
        assert!(md.contains("### done\n\n#### api#2 Old work"), "{md}");
        assert!(md.contains("## Web `web`"), "{md}");

        let json: serde_json::Value = serde_json::to_value(&board).unwrap();
        assert_eq!(json["statuses"][0], "todo");
        assert_eq!(json["projects"][0]["slug"], "api");
        assert_eq!(json["projects"][0]["tasks"][0]["key"], "api#1");
        assert_eq!(json["projects"][0]["tasks"][0]["waits_on"][0], "api#2");
        assert_eq!(json["projects"][0]["tasks"][0]["comments"][0]["author"], "claude-code");

        let only = collect(&store, Some("web"), Path::new("/k/images")).unwrap();
        assert_eq!(only.projects.len(), 1);
        assert!(collect(&store, Some("nope"), Path::new("/k/images")).is_err());
    }

    #[test]
    fn refuses_a_joined_board() {
        let tmp = tempfile::tempdir().unwrap();
        let home = Home::open(tmp.path().to_path_buf()).unwrap();
        home.store().unwrap().create_project("local", "Local", None).unwrap();
        let out = tmp.path().join("board.json");

        std::fs::write(home.dir.join("network"), "join 192.168.0.12:4242\n").unwrap();
        let err = export(&home, Format::Json, None, Some(&out)).unwrap_err().to_string();
        assert!(err.contains("192.168.0.12:4242") && err.contains("moonwitness-dx leave"), "{err}");
        assert!(!out.exists());

        std::fs::write(home.dir.join("network"), "share\n").unwrap();
        export(&home, Format::Json, None, Some(&out)).unwrap();
        assert!(std::fs::read_to_string(&out).unwrap().contains("\"slug\": \"local\""));
    }

    #[test]
    fn import_export_roundtrip_preserves_all_fields() {
        let tmp = tempfile::tempdir().unwrap();
        let home1 = Home::open(tmp.path().join("home1")).unwrap();
        let store1 = home1.store().unwrap();
        let project = store1.create_project("moonwitness", "MoonWitness", Some("A-L-L-A-H/mw-xv")).unwrap();

        store1
            .create_task_in(
                project.id,
                "Base Dependency Task",
                store::TaskPatch {
                    code: Some("DEP-001".into()),
                    series: Some("AUD".into()),
                    priority: Some("p0".into()),
                    status: Some("done".into()),
                    ..Default::default()
                },
            )
            .unwrap();

        store1
            .create_task_in(
                project.id,
                "Roundtrip Task",
                store::TaskPatch {
                    code: Some("RT-001".into()),
                    series: Some("AUD".into()),
                    milestone: Some("AUDIT-NOW".into()),
                    horizon: Some("now".into()),
                    category: Some("security".into()),
                    task_type: Some("feature".into()),
                    priority: Some("p0".into()),
                    effort: Some("m".into()),
                    risk: Some("low".into()),
                    owner: Some("dev-team".into()),
                    summary: Some("Short card summary".into()),
                    problem: Some("Detailed problem description".into()),
                    proposed_solution: Some("Detailed proposed solution".into()),
                    acceptance_criteria: Some(vec![
                        serde_json::json!({"id": "ac-1", "text": "First criterion", "done": true}),
                        serde_json::json!({"id": "ac-2", "text": "Second criterion", "done": false}),
                    ]),
                    validation: Some(serde_json::json!({"commands": ["pnpm verify"], "expected": "Pass 100%"})),
                    evidence: Some(
                        serde_json::json!({"paths": ["docs/roadmap/evidence/M0.01.md"], "detailFile": "docs/roadmap/00-baseline.md", "commitSha": "abc1234"}),
                    ),
                    scope: Some(serde_json::json!({"packages": ["@moonwitness/api"], "files": ["package.json"]})),
                    depends_on: Some(vec!["DEP-001".into()]),
                    blocks: Some(vec!["NEXT-001".into()]),
                    references: Some(vec!["ROADMAP.md#M0.01".into()]),
                    tags: Some("security,audit".into()),
                    ..Default::default()
                },
            )
            .unwrap();

        store1
            .upsert_document(
                "wiki/architecture-overview",
                "wiki",
                "Architecture Overview",
                "# Architecture\nCore design.",
                "architecture,wiki",
                Some(project.id),
                Some("accepted"),
                &["RT-001".to_string()],
            )
            .unwrap();

        let out_path = tmp.path().join("tasks-v2.json");
        export(&home1, Format::TasksJson, None, Some(&out_path)).unwrap();

        let home2 = Home::open(tmp.path().join("home2")).unwrap();
        let summary = import_tasks_file(&home2, &out_path, ImportMode::Upsert).unwrap();
        assert_eq!(summary.projects, 1);
        assert_eq!(summary.tasks, 2);
        assert_eq!(summary.documents, 1);

        let store2 = home2.store().unwrap();
        let imported = store2.find_task("RT-001").unwrap();
        assert_eq!(imported.code.as_deref(), Some("RT-001"));
        assert_eq!(imported.series.as_deref(), Some("AUD"));
        assert_eq!(imported.milestone.as_deref(), Some("AUDIT-NOW"));
        assert_eq!(imported.horizon.as_deref(), Some("now"));
        assert_eq!(imported.priority.as_deref(), Some("p0"));
        assert_eq!(imported.summary.as_deref(), Some("Short card summary"));
        assert_eq!(imported.problem.as_deref(), Some("Detailed problem description"));
        assert_eq!(imported.proposed_solution.as_deref(), Some("Detailed proposed solution"));

        let doc2 = store2.find_document_by_slug("wiki/architecture-overview").unwrap().unwrap();
        assert_eq!(doc2.title, "Architecture Overview");
        assert_eq!(doc2.layer, "wiki");
        assert_eq!(doc2.linked_tasks, vec!["RT-001".to_string()]);
    }
}
