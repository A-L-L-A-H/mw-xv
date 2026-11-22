use std::collections::HashMap;
use std::path::Path;

use anyhow::{Context, Result, bail};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::home::Home;
use crate::share::Net;
use crate::store::{Error, Store};

#[derive(Clone, Copy, Debug, clap::ValueEnum, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportMode {
    Upsert,
    Replace,
}

#[derive(Debug, Serialize, Clone)]
pub struct ImportSummary {
    pub projects: usize,
    pub tasks: usize,
    pub documents: usize,
}

#[derive(Deserialize)]
struct ImportProject {
    slug: String,
    name: String,
    #[serde(default)]
    repos: Vec<String>,
    #[serde(default)]
    color: Option<String>,
}

#[derive(Deserialize)]
struct ImportComment {
    author: String,
    body: String,
}

#[derive(Deserialize)]
struct ImportTask {
    code: String,
    project: String,
    #[serde(default)]
    series: String,
    #[serde(default)]
    milestone: Option<String>,
    #[serde(default)]
    horizon: Option<String>,
    title: String,
    #[serde(default)]
    summary: String,
    #[serde(default)]
    problem: String,
    #[serde(default, alias = "proposedSolution")]
    proposed_solution: String,
    #[serde(default)]
    category: String,
    #[serde(default, rename = "type", alias = "task_type", alias = "taskType")]
    task_type: String,
    #[serde(default)]
    priority: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    human: bool,
    #[serde(default)]
    owner: Option<String>,
    #[serde(default)]
    assignee: Option<String>,
    #[serde(default)]
    risk: Option<String>,
    #[serde(default)]
    effort: Option<String>,
    #[serde(default, alias = "dependsOn")]
    depends_on: Vec<String>,
    #[serde(default)]
    blocks: Vec<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    scope: Option<serde_json::Value>,
    #[serde(default, alias = "acceptanceCriteria")]
    acceptance_criteria: Vec<serde_json::Value>,
    #[serde(default)]
    validation: Option<serde_json::Value>,
    #[serde(default)]
    evidence: Option<serde_json::Value>,
    #[serde(default)]
    references: Vec<String>,
    #[serde(default, alias = "blockedReason")]
    blocked_reason: Option<String>,
    #[serde(default, alias = "sourceRef")]
    source_ref: Option<serde_json::Value>,
    #[serde(default)]
    url: String,
    #[serde(default)]
    comments: Vec<ImportComment>,
}

#[derive(Deserialize)]
struct ImportDocument {
    slug: String,
    layer: String,
    title: String,
    body: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    project: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default, alias = "linkedTasks")]
    linked_tasks: Vec<String>,
}

#[derive(Deserialize)]
struct ImportPayload {
    format: String,
    #[serde(default)]
    projects: Vec<ImportProject>,
    #[serde(default)]
    tasks: Vec<ImportTask>,
    #[serde(default)]
    documents: Vec<ImportDocument>,
}

pub fn import_tasks_file(home: &Home, path: &Path, mode: ImportMode) -> Result<ImportSummary> {
    if let Net::Joined(host) = Net::load(home) {
        bail!(
            "This computer uses the board at {host}: run moonwitness-dx import on that computer, or moonwitness-dx leave first."
        );
    }
    let content = std::fs::read_to_string(path).with_context(|| format!("cannot read {}", path.display()))?;
    let store = home.store()?;
    let summary = import_tasks_str(&store, &content, mode)?;
    eprintln!(
        "Imported {} projects, {} tasks, and {} documents from {}",
        summary.projects,
        summary.tasks,
        summary.documents,
        path.display()
    );
    Ok(summary)
}

pub fn import_tasks_str(store: &Store, content: &str, mode: ImportMode) -> Result<ImportSummary> {
    let payload: ImportPayload = serde_json::from_str(content).context("invalid moonwitness-tasks/v2 JSON")?;
    if payload.format != "moonwitness-tasks/v2" {
        bail!("Unsupported format {:?}; expected \"moonwitness-tasks/v2\"", payload.format);
    }

    if payload.tasks.iter().any(|t| t.status == "backlog") {
        let _ = store.set_backlog(true);
    }

    let mut project_ids: HashMap<String, i64> = HashMap::new();
    for ip in &payload.projects {
        let project = match store.find_project(&ip.slug) {
            Ok(p) => p,
            Err(Error::NotFound(_)) => store.create_project(&ip.slug, &ip.name, ip.repos.first().map(String::as_str))?,
            Err(e) => return Err(e.into()),
        };
        if let Some(color) = &ip.color {
            let _ = store.set_project_color(&ip.slug, color);
        }
        project_ids.insert(ip.slug.clone(), project.id);
    }

    for it in &payload.tasks {
        if !project_ids.contains_key(&it.project) {
            let project = match store.find_project(&it.project) {
                Ok(p) => p,
                Err(Error::NotFound(_)) => store.create_project(&it.project, &it.project, None)?,
                Err(e) => return Err(e.into()),
            };
            project_ids.insert(it.project.clone(), project.id);
        }
    }

    store.with_write(|c| {
        if matches!(mode, ImportMode::Replace) {
            for &pid in project_ids.values() {
                c.execute("DELETE FROM tasks WHERE project_id = ?1", [pid])?;
            }
        }

        let mut code_to_id: HashMap<String, i64> = HashMap::new();
        let mut position_by_status: HashMap<String, f64> = HashMap::new();

        for (idx, it) in payload.tasks.iter().enumerate() {
            let project_id = *project_ids
                .get(&it.project)
                .ok_or_else(|| Error::NotFound(format!("project {} not found", it.project)))?;
            let status = if it.status.trim().is_empty() { "todo" } else { it.status.trim() };
            let next_pos = position_by_status
                .entry(status.to_string())
                .and_modify(|p| *p += 1.0)
                .or_insert((idx + 1) as f64);

            let existing_id: Option<i64> = c
                .query_row("SELECT id FROM tasks WHERE code = ?1", [&it.code], |r| r.get(0))
                .optional()?;

            let ac_json = serde_json::to_string(&it.acceptance_criteria).unwrap_or_else(|_| "[]".into());
            let val_json = it
                .validation
                .as_ref()
                .and_then(|v| serde_json::to_string(v).ok())
                .unwrap_or_else(|| "{\"commands\":[],\"expected\":\"\"}".into());
            let ev_json = it
                .evidence
                .as_ref()
                .and_then(|v| serde_json::to_string(v).ok())
                .unwrap_or_else(|| "{\"paths\":[],\"detailFile\":null,\"commitSha\":null}".into());
            let sc_json = it
                .scope
                .as_ref()
                .and_then(|v| serde_json::to_string(v).ok())
                .unwrap_or_else(|| "{\"packages\":[],\"files\":[]}".into());
            let sr_json = it
                .source_ref
                .as_ref()
                .and_then(|v| serde_json::to_string(v).ok())
                .unwrap_or_else(|| "{\"file\":\"\",\"legacyId\":null}".into());
            let dep_json = serde_json::to_string(&it.depends_on).unwrap_or_else(|_| "[]".into());
            let blk_json = serde_json::to_string(&it.blocks).unwrap_or_else(|_| "[]".into());
            let ref_json = serde_json::to_string(&it.references).unwrap_or_else(|_| "[]".into());
            let tags = it.tags.join(",");
            let owner = it.owner.as_deref().or(it.assignee.as_deref());
            let description = if !it.problem.is_empty() { &it.problem } else { &it.summary };

            let task_id = if let Some(id) = existing_id {
                c.execute(
                    "UPDATE tasks SET
                        project_id = ?1, title = ?2, description = ?3, status = ?4,
                        tags = ?5, human = ?6, url = ?7, series = ?8, milestone = ?9,
                        horizon = ?10, category = ?11, priority = ?12, effort = ?13,
                        risk = ?14, owner = ?15, summary = ?16, problem = ?17,
                        proposed_solution = ?18, acceptance_criteria_json = ?19,
                        validation_json = ?20, evidence_json = ?21, blocked_reason = ?22,
                        source_ref_json = ?23, scope_json = ?24, depends_on = ?25,
                        blocks_json = ?26, refs_json = ?27, task_type = ?28,
                        updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
                     WHERE id = ?29",
                    params![
                        project_id,
                        it.title,
                        description,
                        status,
                        tags,
                        it.human,
                        it.url,
                        it.series,
                        it.milestone,
                        it.horizon,
                        it.category,
                        it.priority,
                        it.effort,
                        it.risk,
                        owner,
                        it.summary,
                        it.problem,
                        it.proposed_solution,
                        ac_json,
                        val_json,
                        ev_json,
                        it.blocked_reason,
                        sr_json,
                        sc_json,
                        dep_json,
                        blk_json,
                        ref_json,
                        it.task_type,
                        id
                    ],
                )?;
                id
            } else {
                c.execute(
                    "INSERT INTO tasks (
                        project_id, title, description, status, position, tags,
                        human, url, code, series, milestone, horizon, category,
                        priority, effort, risk, owner, summary, problem,
                        proposed_solution, acceptance_criteria_json,
                        validation_json, evidence_json, blocked_reason,
                        source_ref_json, scope_json, depends_on, blocks_json, refs_json, task_type
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30)",
                    params![
                        project_id,
                        it.title,
                        description,
                        status,
                        *next_pos,
                        tags,
                        it.human,
                        it.url,
                        it.code,
                        it.series,
                        it.milestone,
                        it.horizon,
                        it.category,
                        it.priority,
                        it.effort,
                        it.risk,
                        owner,
                        it.summary,
                        it.problem,
                        it.proposed_solution,
                        ac_json,
                        val_json,
                        ev_json,
                        it.blocked_reason,
                        sr_json,
                        sc_json,
                        dep_json,
                        blk_json,
                        ref_json,
                        it.task_type
                    ],
                )?;
                c.last_insert_rowid()
            };

            code_to_id.insert(it.code.clone(), task_id);

            let existing_comments: i64 = c.query_row(
                "SELECT count(*) FROM comments WHERE task_id = ?1",
                [task_id],
                |r| r.get(0),
            )?;
            if existing_comments == 0 {
                for comment in &it.comments {
                    if !comment.body.trim().is_empty() {
                        c.execute(
                            "INSERT INTO comments (task_id, author, body) VALUES (?1, ?2, ?3)",
                            params![task_id, comment.author, comment.body],
                        )?;
                    }
                }
            }
        }

        // Second pass: wire task_waits edges after all task codes exist
        for it in &payload.tasks {
            let Some(&task_id) = code_to_id.get(&it.code) else { continue };
            c.execute("DELETE FROM task_waits WHERE task_id = ?1", [task_id])?;
            for dep_code in &it.depends_on {
                let target_id = match code_to_id.get(dep_code).copied() {
                    Some(id) => Some(id),
                    None => c
                        .query_row("SELECT id FROM tasks WHERE code = ?1", [dep_code], |r| r.get(0))
                        .optional()?,
                };
                if let Some(target_id) = target_id
                    && target_id != task_id
                {
                    let loops: bool = c.query_row(
                        "WITH RECURSIVE chain(id) AS (
                             SELECT ?1 UNION SELECT w.waits_on_id FROM task_waits w JOIN chain ON w.task_id = chain.id
                         ) SELECT EXISTS (SELECT 1 FROM chain WHERE id = ?2)",
                        [target_id, task_id],
                        |r| r.get(0),
                    )?;
                    if !loops {
                        c.execute(
                            "INSERT OR IGNORE INTO task_waits (task_id, waits_on_id) VALUES (?1, ?2)",
                            params![task_id, target_id],
                        )?;
                    }
                }
            }
        }

        for idoc in &payload.documents {
            let project_id = idoc.project.as_ref().and_then(|p| project_ids.get(p).copied());
            let tags = idoc.tags.join(",");
            let status = idoc.status.as_deref().unwrap_or("draft");
            let existing: Option<i64> = c
                .query_row("SELECT id FROM documents WHERE slug = ?1", [&idoc.slug], |r| r.get(0))
                .optional()?;
            let doc_id = if let Some(id) = existing {
                c.execute(
                    "UPDATE documents SET layer = ?1, title = ?2, body = ?3, tags = ?4,
                       project_id = ?5, status = ?6, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
                     WHERE id = ?7",
                    params![idoc.layer, idoc.title, idoc.body, tags, project_id, status, id],
                )?;
                id
            } else {
                c.execute(
                    "INSERT INTO documents (slug, layer, title, body, tags, project_id, status)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![idoc.slug, idoc.layer, idoc.title, idoc.body, tags, project_id, status],
                )?;
                c.last_insert_rowid()
            };
            store.set_document_links(c, doc_id, &idoc.linked_tasks)?;
        }

        c.execute("UPDATE meta SET value = value + 1 WHERE key = 'changes'", [])?;
        Ok(())
    })?;

    Ok(ImportSummary {
        projects: project_ids.len(),
        tasks: payload.tasks.len(),
        documents: payload.documents.len(),
    })
}
