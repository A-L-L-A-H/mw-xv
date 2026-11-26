mod radius_protocol;

use anyhow::Result;
use axum::{
    extract::{Path, Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::Response,
    routing::{get, post},
    Json, Router,
};
use clap::Parser;
use hmac::{Hmac, Mac};
use radius_protocol::{
    acct_status, attr_type, codes, constant_time_eq, decode_packet, decrypt_pap_password,
    encode_disconnect_request, encode_response, verify_accounting_authenticator,
    verify_chap_password, verify_response_authenticator, RadiusAttribute,
};
use radius_protocol::attr_type as at;
use sha2::Sha256;
use sqlx::Row;
use std::net::{Ipv4Addr, SocketAddr};
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::UdpSocket;
use tokio::signal;
use tracing::{debug, info, warn};

#[derive(Parser, Debug)]
#[command(name = "moonwitness-isp", version, about = "MoonWitness ISP & RADIUS Server")]
struct Cli {
    #[arg(long, default_value = "0.0.0.0:1812")]
    radius_addr: String,
    #[arg(long, default_value = "0.0.0.0:1813")]
    acct_addr: String,
    #[arg(long, default_value = "127.0.0.1:3000")]
    http_addr: String,
    #[arg(long, default_value = "isp.db")]
    db_path: String,
    #[arg(long)]
    migrate: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cli = Cli::parse();
    let cfg = load_config(&cli.db_path)?;
    let db = Database::new(&cfg.db_path).await?;
    db.migrate().await?;
    info!("SQLite database initialized at {}", cfg.db_path);

    if cli.migrate {
        return Ok(());
    }

    let radius_addr: SocketAddr = cli.radius_addr.parse()?;
    let acct_addr: SocketAddr = cli.acct_addr.parse()?;
    let http_addr: SocketAddr = cli.http_addr.parse()?;

    let radius_db = db.clone();
    let radius_handle = tokio::spawn(async move { run_radius_server(radius_addr, radius_db).await });

    let acct_db = db.clone();
    let acct_handle = tokio::spawn(async move { run_acct_server(acct_addr, acct_db).await });

    let http_db = db.clone();
    let admin_token = resolve_admin_token(cfg.admin_token.as_deref(), &cli.db_path)?;
    info!("Admin API bearer token resolved (source-verified, not logged)");
    let http_handle = tokio::spawn(async move { run_http_server(http_addr, http_db, admin_token).await });

    info!(
        "MoonWitness ISP server started (auth={}, acct={}, http={})",
        cli.radius_addr, cli.acct_addr, cli.http_addr
    );

    signal::ctrl_c().await?;
    info!("Shutdown signal received, stopping servers...");

    radius_handle.abort();
    acct_handle.abort();
    http_handle.abort();
    Ok(())
}

fn load_config(cli_db_path: &str) -> Result<Config> {
    let mut builder = config::Config::builder().set_default("db_path", cli_db_path)?;
    builder = builder.add_source(config::File::with_name("config").required(false));
    builder = builder.add_source(config::Environment::with_prefix("MW_ISP").separator("_"));
    Ok(builder.build()?.try_deserialize()?)
}

#[derive(Debug, Clone, serde::Deserialize)]
struct Config {
    db_path: String,
    admin_token: Option<String>,
}

const ADMIN_TOKEN_MESSAGE: &[u8] = b"moonwitness-isp-admin-v1";

/// M19.06: combine a 32-bit octet counter with its Gigawords attribute (RFC
/// 2869 attributes 52/53, counting 2^32-octet wraps) into the normalized
/// 64-bit total `gigawords * 2^32 + low32`. Both attributes are optional; a
/// missing Gigawords value means the counter never wrapped.
fn combine_gigawords(low32: u32, gigawords: Option<u32>) -> i64 {
    let wraps = gigawords.unwrap_or(0) as i64;
    (wraps << 32) + low32 as i64
}

/// Extract a normalized 64-bit input/output octet pair from an accounting
/// packet, preferring the Gigawords-extended counters when present.
fn extract_octet_counters(packet: &radius_protocol::RadiusPacket) -> (i64, i64) {
    let input_low = packet
        .attribute(at::ACCT_INPUT_OCTETS)
        .and_then(RadiusAttribute::as_u32)
        .unwrap_or(0);
    let output_low = packet
        .attribute(at::ACCT_OUTPUT_OCTETS)
        .and_then(RadiusAttribute::as_u32)
        .unwrap_or(0);
    let input_giga = packet
        .attribute(at::ACCT_INPUT_GIGAWORDS)
        .and_then(RadiusAttribute::as_u32);
    let output_giga = packet
        .attribute(at::ACCT_OUTPUT_GIGAWORDS)
        .and_then(RadiusAttribute::as_u32);
    (
        combine_gigawords(input_low, input_giga),
        combine_gigawords(output_low, output_giga),
    )
}

/// Resolve the runtime admin bearer token:
/// 1. explicit `MW_ISP_ADMIN_TOKEN` (config/env) when non-empty after trim;
/// 2. HMAC-SHA256(key = secret, msg = "moonwitness-isp-admin-v1") over
///    `MW_INTERNAL_SECRET` (falling back to `JWT_SECRET`) when set and non-empty;
/// 3. `<parent_dir(db_path)>/.admin-token` file: reuse if present, otherwise
///    generate 32 random hex-encoded bytes and persist (mode 0o600 on unix).
fn resolve_admin_token(configured: Option<&str>, db_path: &str) -> Result<String> {
    if let Some(token) = configured.map(str::trim).filter(|t| !t.is_empty()) {
        return Ok(token.to_string());
    }

    let internal_secret = std::env::var("MW_INTERNAL_SECRET")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .or_else(|| {
            std::env::var("JWT_SECRET")
                .ok()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        });
    if let Some(secret) = internal_secret {
        let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
            .expect("HMAC accepts any key length");
        mac.update(ADMIN_TOKEN_MESSAGE);
        return Ok(hex::encode(mac.finalize().into_bytes()));
    }

    let token_path = std::path::Path::new(db_path)
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(|p| p.join(".admin-token"))
        .unwrap_or_else(|| std::path::PathBuf::from(".admin-token"));
    if let Ok(existing) = std::fs::read_to_string(&token_path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    let token = hex::encode(bytes);
    write_admin_token_file(&token_path, &token)?;
    Ok(token)
}

fn write_admin_token_file(path: &std::path::Path, token: &str) -> Result<()> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)?;
        file.write_all(token.as_bytes())?;
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, token)?;
    }
    Ok(())
}

#[derive(Clone)]
struct AppState {
    db: Database,
    admin_token: String,
}

#[derive(Clone)]
struct Database {
    pool: sqlx::SqlitePool,
    /// Count of Access-Requests rejected due to quota exceeded
    quota_exceeded_rejects: Arc<AtomicU64>,
    /// Count of duplicate quota accumulations skipped (idempotent replay)
    quota_duplicate_accumulations: Arc<AtomicU64>,
    /// Count of Accounting-Requests for which the Accounting-Response was withheld
    /// because the durable write failed (M19.05 durable ACK contract).
    accounting_acks_withheld: Arc<AtomicU64>,
}

impl Database {
    async fn new(path: &str) -> Result<Self> {
        let options = sqlx::sqlite::SqliteConnectOptions::from_str(&format!("sqlite:{}", path))?
            .create_if_missing(true);
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;
        Ok(Self {
            pool,
            quota_exceeded_rejects: Arc::new(AtomicU64::new(0)),
            quota_duplicate_accumulations: Arc::new(AtomicU64::new(0)),
            accounting_acks_withheld: Arc::new(AtomicU64::new(0)),
        })
    }

    async fn migrate(&self) -> Result<()> {
        sqlx::migrate!("./migrations").run(&self.pool).await?;
        Ok(())
    }

    async fn get_clients(&self) -> Result<Vec<NasClient>> {
        let rows = sqlx::query_as(
            "SELECT id, name, ip_address, enabled, created_at FROM nas_clients ORDER BY created_at DESC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn upsert_client(&self, name: &str, ip_address: &str, secret: &str) -> Result<NasClient> {
        let row = sqlx::query_as(
            "INSERT INTO nas_clients (name, ip_address, secret, enabled)
             VALUES (?1, ?2, ?3, 1)
             ON CONFLICT(ip_address) DO UPDATE SET
               name = excluded.name,
               secret = excluded.secret,
               enabled = 1
             RETURNING id, name, ip_address, enabled, created_at",
        )
        .bind(name)
        .bind(ip_address)
        .bind(secret)
        .fetch_one(&self.pool)
        .await?;
        Ok(row)
    }

    async fn find_client_with_secret(&self, ip_address: &str) -> Result<Option<NasClientSecret>> {
        let row = sqlx::query_as(
            "SELECT id, name, ip_address, secret, enabled FROM nas_clients WHERE ip_address = ?1 AND enabled = 1",
        )
        .bind(ip_address)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    async fn rotate_client_secret(
        &self,
        ip_address: &str,
        new_secret: &str,
        reason: &str,
    ) -> Result<Option<NasClient>> {
        let client = sqlx::query_as::<_, NasClient>(
            "UPDATE nas_clients SET secret = ?1 WHERE ip_address = ?2
             RETURNING id, name, ip_address, enabled, created_at",
        )
        .bind(new_secret)
        .bind(ip_address)
        .fetch_optional(&self.pool)
        .await?;

        if let Some(ref c) = client {
            sqlx::query("INSERT INTO nas_secret_rotations (client_id, reason) VALUES (?1, ?2)")
                .bind(c.id)
                .bind(reason)
                .execute(&self.pool)
                .await?;
            // Sessions established under the previous secret are no longer
            // trusted: the NAS must re-authenticate with the new credential.
            // Terminate cause 6 = Admin-Reset per RFC 2866 §5.4.6.
            sqlx::query(
                "UPDATE radius_sessions
                 SET status = 'terminated', terminate_cause = 6, stopped_at = datetime('now'), updated_at = datetime('now')
                 WHERE nas_ip = ?1 AND status = 'active'",
            )
            .bind(ip_address)
            .execute(&self.pool)
            .await?;
        }
        Ok(client)
    }

    async fn find_subscriber(&self, username: &str) -> Result<Option<SubscriberRow>> {
        let row = sqlx::query_as(
            "SELECT id, username, password, connection_type, framed_ip, download_kbps, upload_kbps, status,
                    quota_bytes, quota_reset_cadence, quota_used_bytes, last_quota_reset_at
             FROM subscribers WHERE username = ?1",
        )
        .bind(username)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    async fn upsert_subscriber(&self, req: &UpsertSubscriberRequest) -> Result<SubscriberSummary> {
        let row = sqlx::query_as(
            "INSERT INTO subscribers (username, password, connection_type, framed_ip, download_kbps, upload_kbps, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(username) DO UPDATE SET
               password = excluded.password,
               connection_type = excluded.connection_type,
               framed_ip = excluded.framed_ip,
               download_kbps = excluded.download_kbps,
               upload_kbps = excluded.upload_kbps,
               status = excluded.status,
               updated_at = datetime('now')
             RETURNING id, username, connection_type, framed_ip, download_kbps, upload_kbps, status, created_at",
        )
        .bind(&req.username)
        .bind(&req.password)
        .bind(req.connection_type.as_deref().unwrap_or("pppoe"))
        .bind(req.framed_ip.as_deref())
        .bind(req.download_kbps.unwrap_or(20480))
        .bind(req.upload_kbps.unwrap_or(10240))
        .bind(req.status.as_deref().unwrap_or("active"))
        .fetch_one(&self.pool)
        .await?;
        Ok(row)
    }

    async fn update_subscriber_status(
        &self,
        username: &str,
        status: &str,
    ) -> Result<Option<SubscriberSummary>> {
        let row = sqlx::query_as(
            "UPDATE subscribers SET status = ?1, updated_at = datetime('now') WHERE username = ?2
             RETURNING id, username, connection_type, framed_ip, download_kbps, upload_kbps, status, created_at",
        )
        .bind(status)
        .bind(username)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    async fn list_subscribers(&self) -> Result<Vec<SubscriberSummary>> {
        let rows = sqlx::query_as(
            "SELECT id, username, connection_type, framed_ip, download_kbps, upload_kbps, status, created_at
             FROM subscribers ORDER BY username ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn log_auth(
        &self,
        client_id: Option<i64>,
        username: &str,
        success: bool,
        nas_ip: &str,
        reply: &str,
    ) -> Result<()> {
        sqlx::query(
            "INSERT INTO radius_auth_log (client_id, username, nas_ip, success, reply_message, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))",
        )
        .bind(client_id)
        .bind(username)
        .bind(nas_ip)
        .bind(success)
        .bind(reply)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn record_accounting(
        &self,
        session_id: &str,
        username: &str,
        nas_ip: &str,
        nas_port: Option<String>,
        framed_ip: Option<String>,
        calling_station_id: Option<String>,
        status_type: u32,
        input_octets: i64,
        output_octets: i64,
        session_time: i64,
        terminate_cause: Option<i64>,
    ) -> Result<()> {
        match status_type {
            acct_status::START => {
                sqlx::query(
                    "INSERT INTO radius_sessions (session_id, username, nas_ip, nas_port, framed_ip, calling_station_id, status)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active')
                     ON CONFLICT(session_id) DO UPDATE SET
                       nas_ip = excluded.nas_ip,
                       framed_ip = COALESCE(excluded.framed_ip, radius_sessions.framed_ip),
                       status = 'active',
                       updated_at = datetime('now')",
                )
                .bind(session_id)
                .bind(username)
                .bind(nas_ip)
                .bind(nas_port)
                .bind(framed_ip)
                .bind(calling_station_id)
                .execute(&self.pool)
                .await?;
            }
            // M19.06: accept only forward progress. A duplicate or out-of-order
            // interim brings older totals; with MAX() those packets are durably
            // recorded as a no-op instead of regressing counters that quota and
            // billing already consumed. A NAS reboot or session restart uses a
            // new Acct-Session-Id and therefore inserts a fresh row.
            acct_status::INTERIM_UPDATE => {
                sqlx::query(
                    "INSERT INTO radius_sessions (session_id, username, nas_ip, nas_port, framed_ip, calling_station_id, acct_input_octets, acct_output_octets, acct_input_octets64, acct_output_octets64, acct_session_time, status)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?7, ?8, ?9, 'active')
                     ON CONFLICT(session_id) DO UPDATE SET
                       acct_input_octets = MAX(radius_sessions.acct_input_octets, excluded.acct_input_octets),
                       acct_output_octets = MAX(radius_sessions.acct_output_octets, excluded.acct_output_octets),
                       acct_input_octets64 = MAX(radius_sessions.acct_input_octets64, excluded.acct_input_octets64),
                       acct_output_octets64 = MAX(radius_sessions.acct_output_octets64, excluded.acct_output_octets64),
                       acct_session_time = MAX(radius_sessions.acct_session_time, excluded.acct_session_time),
                       framed_ip = COALESCE(excluded.framed_ip, radius_sessions.framed_ip),
                       updated_at = datetime('now')",
                )
                .bind(session_id)
                .bind(username)
                .bind(nas_ip)
                .bind(nas_port)
                .bind(framed_ip)
                .bind(calling_station_id)
                .bind(input_octets)
                .bind(output_octets)
                .bind(session_time)
                .execute(&self.pool)
                .await?;
            }
            acct_status::STOP => {
                sqlx::query(
                    "INSERT INTO radius_sessions (session_id, username, nas_ip, nas_port, framed_ip, calling_station_id, acct_input_octets, acct_output_octets, acct_input_octets64, acct_output_octets64, acct_session_time, status, terminate_cause, stopped_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?7, ?8, ?9, 'closed', ?10, datetime('now'))
                     ON CONFLICT(session_id) DO UPDATE SET
                       acct_input_octets = MAX(radius_sessions.acct_input_octets, excluded.acct_input_octets),
                       acct_output_octets = MAX(radius_sessions.acct_output_octets, excluded.acct_output_octets),
                       acct_input_octets64 = MAX(radius_sessions.acct_input_octets64, excluded.acct_input_octets64),
                       acct_output_octets64 = MAX(radius_sessions.acct_output_octets64, excluded.acct_output_octets64),
                       acct_session_time = MAX(radius_sessions.acct_session_time, excluded.acct_session_time),
                       status = 'closed',
                       terminate_cause = COALESCE(excluded.terminate_cause, radius_sessions.terminate_cause),
                       stopped_at = datetime('now'),
                       updated_at = datetime('now')",
                )
                .bind(session_id)
                .bind(username)
                .bind(nas_ip)
                .bind(nas_port)
                .bind(framed_ip)
                .bind(calling_station_id)
                .bind(input_octets)
                .bind(output_octets)
                .bind(session_time)
                .bind(terminate_cause)
                .execute(&self.pool)
                .await?;
            }
            _ => {}
        }
        Ok(())
    }

    async fn list_sessions(&self) -> Result<Vec<RadiusSessionRow>> {
        let rows = sqlx::query_as(
            "SELECT id, session_id, username, nas_ip, nas_port, framed_ip, calling_station_id,
                    acct_input_octets, acct_output_octets, acct_input_octets64, acct_output_octets64,
                    acct_session_time, status, terminate_cause,
                    started_at, updated_at, stopped_at
             FROM radius_sessions ORDER BY id DESC LIMIT 100",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    fn pool(&self) -> &sqlx::SqlitePool {
        &self.pool
    }

    /// Find the most recent active session for a username, optionally narrowed
    /// by NAS IP or framed IP. Used to resolve nas_ip / session_id for CoA.
    async fn find_active_session(
        &self,
        username: &str,
        nas_ip: Option<&str>,
        framed_ip: Option<&str>,
    ) -> Result<Option<RadiusSessionRow>> {
        let row = sqlx::query_as(
            "SELECT id, session_id, username, nas_ip, nas_port, framed_ip, calling_station_id,
                    acct_input_octets, acct_output_octets, acct_input_octets64, acct_output_octets64,
                    acct_session_time, status, terminate_cause,
                    started_at, updated_at, stopped_at
             FROM radius_sessions
             WHERE username = ?1 AND status = 'active'
               AND (?2 IS NULL OR nas_ip = ?2)
               AND (?3 IS NULL OR framed_ip = ?3)
             ORDER BY id DESC LIMIT 1",
        )
        .bind(username)
        .bind(nas_ip)
        .bind(framed_ip)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    /// Mark matching active sessions as terminated after a successful RFC 5176
    /// Disconnect-ACK (terminate cause 6 = Admin-Reset per RFC 2866 §5.4.6).
    async fn mark_sessions_terminated(&self, username: &str, session_id: Option<&str>) -> Result<()> {
        sqlx::query(
            "UPDATE radius_sessions
             SET status = 'terminated', terminate_cause = 6, stopped_at = datetime('now'), updated_at = datetime('now')
             WHERE username = ?1 AND status = 'active' AND (?2 IS NULL OR session_id = ?2)",
        )
        .bind(username)
        .bind(session_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Reset quota_used_bytes to 0 and update last_quota_reset_at if the cadence window has elapsed.
    async fn maybe_reset_quota(&self, username: &str) -> Result<()> {
        let row = sqlx::query(
            "SELECT quota_reset_cadence, last_quota_reset_at FROM subscribers WHERE username = ?1",
        )
        .bind(username)
        .fetch_optional(&self.pool)
        .await?;
        let Some(r) = row else { return Ok(()) };
        let cadence: String = r.try_get("quota_reset_cadence")?;
        if cadence == "never" {
            return Ok(());
        }
        let reset_sql = match cadence.as_str() {
            "daily" => "date('now', '-1 day')",
            "weekly" => "date('now', '-7 day')",
            "monthly" => "date('now', '-1 month')",
            _ => return Ok(()),
        };
        let updated = sqlx::query(&format!(
            "UPDATE subscribers
             SET quota_used_bytes = 0, last_quota_reset_at = datetime('now')
             WHERE username = ?1
               AND quota_reset_cadence = ?2
               AND date(last_quota_reset_at) < {reset_sql}",
        ))
        .bind(username)
        .bind(cadence)
        .execute(&self.pool)
        .await?;
        if updated.rows_affected() > 0 {
            debug!("Quota reset for {}", username);
        }
        Ok(())
    }

    /// Delta-accumulate session octets into subscribers.quota_used_bytes.
    ///
    /// Each session keeps a high-water mark (`quota_accumulated_octets`); only
    /// the growth of `acct_input_octets + acct_output_octets` since the last
    /// accumulation is added. This makes repeated Access-Requests, interim
    /// updates, and retries idempotent: replaying the same counters must not
    /// inflate the subscriber's usage (AUD/TAUD-08).
    async fn accumulate_quota_usage(&self, username: &str) -> Result<()> {
        // 1. Add each active session's growth since its high-water mark.
        //    M19.06: consumption uses the normalized 64-bit totals so
        //    Gigawords-extended counters are not truncated at 2^32.
        let rows = sqlx::query(
            "SELECT (acct_input_octets64 + acct_output_octets64) - quota_accumulated_octets AS delta
             FROM radius_sessions
             WHERE username = ?1 AND status = 'active'
               AND (acct_input_octets64 + acct_output_octets64) > quota_accumulated_octets",
        )
        .bind(username)
        .fetch_all(&self.pool)
        .await?;

        let total_delta: i64 = rows.iter().map(|r| r.get::<i64, _>("delta")).sum();
        if total_delta > 0 {
            sqlx::query(
                "UPDATE subscribers
                 SET quota_used_bytes = quota_used_bytes + ?1
                 WHERE username = ?2",
            )
            .bind(total_delta)
            .bind(username)
            .execute(&self.pool)
            .await?;
        } else if rows.is_empty() {
            // No deltas to apply - this is a replay of an already-accumulated request
            self.quota_duplicate_accumulations.fetch_add(1, Ordering::Relaxed);
        }

        // 2. Raise the high-water mark to the counters just accounted for.
        sqlx::query(
            "UPDATE radius_sessions
             SET quota_accumulated_octets = acct_input_octets64 + acct_output_octets64
             WHERE username = ?1 AND status = 'active'
               AND (acct_input_octets64 + acct_output_octets64) > quota_accumulated_octets",
        )
        .bind(username)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Mark quota-disconnect flag on active sessions for this subscriber.
    async fn mark_quota_disconnect(&self, username: &str) -> Result<()> {
        sqlx::query(
            "UPDATE radius_sessions
             SET quota_disconnect_sent = 1
             WHERE username = ?1 AND status = 'active' AND quota_disconnect_sent = 0",
        )
        .bind(username)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

#[derive(sqlx::FromRow, serde::Serialize, Debug)]
struct NasClient {
    id: i64,
    name: String,
    ip_address: String,
    enabled: bool,
    created_at: String,
}

#[derive(sqlx::FromRow, Debug)]
struct NasClientSecret {
    id: i64,
    #[allow(dead_code)]
    name: String,
    #[allow(dead_code)]
    ip_address: String,
    secret: String,
    #[allow(dead_code)]
    enabled: bool,
}

#[derive(sqlx::FromRow, Debug)]
struct SubscriberRow {
    #[allow(dead_code)]
    id: i64,
    #[allow(dead_code)]
    username: String,
    password: String,
    #[allow(dead_code)]
    connection_type: String,
    framed_ip: Option<String>,
    download_kbps: i64,
    upload_kbps: i64,
    status: String,
    quota_bytes: i64,
    #[allow(dead_code)]
    quota_reset_cadence: String,
    #[allow(dead_code)]
    quota_used_bytes: i64,
    #[allow(dead_code)]
    last_quota_reset_at: String,
}

#[derive(sqlx::FromRow, serde::Serialize, Debug)]
struct SubscriberSummary {
    id: i64,
    username: String,
    connection_type: String,
    framed_ip: Option<String>,
    download_kbps: i64,
    upload_kbps: i64,
    status: String,
    created_at: String,
}

#[derive(sqlx::FromRow, serde::Serialize, Debug)]
struct RadiusSessionRow {
    id: i64,
    session_id: String,
    username: String,
    nas_ip: Option<String>,
    nas_port: Option<String>,
    framed_ip: Option<String>,
    calling_station_id: Option<String>,
    acct_input_octets: i64,
    acct_output_octets: i64,
    #[serde(rename = "acct_input_octets64")]
    acct_input_octets64: i64,
    #[serde(rename = "acct_output_octets64")]
    acct_output_octets64: i64,
    acct_session_time: i64,
    status: String,
    terminate_cause: Option<i64>,
    started_at: String,
    updated_at: String,
    stopped_at: Option<String>,
}

#[derive(serde::Deserialize)]
struct CreateClientRequest {
    name: String,
    ip_address: String,
    secret: String,
}

#[derive(serde::Deserialize)]
struct RotateSecretRequest {
    secret: String,
    reason: Option<String>,
}

#[derive(serde::Deserialize)]
struct UpsertSubscriberRequest {
    username: String,
    password: String,
    connection_type: Option<String>,
    framed_ip: Option<String>,
    download_kbps: Option<i64>,
    upload_kbps: Option<i64>,
    status: Option<String>,
}

#[derive(serde::Serialize)]
struct AuthStats {
    total_clients: i64,
    enabled_clients: i64,
    total_subscribers: i64,
    active_sessions: i64,
}

async fn process_access_request(db: &Database, raw: &[u8], src_ip: &str) -> Option<Vec<u8>> {
    let packet = match decode_packet(raw) {
        Ok(p) => p,
        Err(err) => {
            warn!("Malformed RADIUS auth packet from {}: {}", src_ip, err);
            return None;
        }
    };
    if packet.code != codes::ACCESS_REQUEST {
        return None;
    }

    let nas = match db.find_client_with_secret(src_ip).await {
        Ok(Some(c)) => c,
        Ok(None) => {
            let username = packet
                .attribute(attr_type::USER_NAME)
                .map(RadiusAttribute::as_str)
                .unwrap_or_else(|| "unknown".to_string());
            let _ = db
                .log_auth(None, &username, false, src_ip, "Unknown or disabled NAS client")
                .await;
            return None;
        }
        Err(err) => {
            warn!("DB error looking up NAS {}: {}", src_ip, err);
            return None;
        }
    };

    let secret = nas.secret.as_bytes();
    let username = packet
        .attribute(attr_type::USER_NAME)
        .map(RadiusAttribute::as_str)
        .unwrap_or_default();

    if username.is_empty() {
        let _ = db
            .log_auth(Some(nas.id), "unknown", false, src_ip, "Missing User-Name")
            .await;
        return Some(encode_response(
            codes::ACCESS_REJECT,
            packet.identifier,
            &packet.authenticator,
            &[RadiusAttribute::string(attr_type::REPLY_MESSAGE, "Missing User-Name")],
            secret,
        ));
    }

    let subscriber = match db.find_subscriber(&username).await {
        Ok(Some(sub)) => sub,
        Ok(None) => {
            let _ = db
                .log_auth(Some(nas.id), &username, false, src_ip, "Unknown subscriber")
                .await;
            return Some(encode_response(
                codes::ACCESS_REJECT,
                packet.identifier,
                &packet.authenticator,
                &[RadiusAttribute::string(
                    attr_type::REPLY_MESSAGE,
                    "Invalid credentials",
                )],
                secret,
            ));
        }
        Err(err) => {
            warn!("DB error reading subscriber {}: {}", username, err);
            return Some(encode_response(
                codes::ACCESS_REJECT,
                packet.identifier,
                &packet.authenticator,
                &[RadiusAttribute::string(attr_type::REPLY_MESSAGE, "Internal error")],
                secret,
            ));
        }
    };

    if subscriber.status != "active" {
        let _ = db
            .log_auth(
                Some(nas.id),
                &username,
                false,
                src_ip,
                &format!("Subscriber {}", subscriber.status),
            )
            .await;
        return Some(encode_response(
            codes::ACCESS_REJECT,
            packet.identifier,
            &packet.authenticator,
            &[RadiusAttribute::string(
                attr_type::REPLY_MESSAGE,
                "Account suspended or terminated",
            )],
            secret,
        ));
    }

    let authenticated = if let Some(pap_attr) = packet.attribute(attr_type::USER_PASSWORD) {
        decrypt_pap_password(&pap_attr.value, &packet.authenticator, secret)
            .map(|plain| constant_time_eq(plain.as_bytes(), subscriber.password.as_bytes()))
            .unwrap_or(false)
    } else if let Some(chap_attr) = packet.attribute(attr_type::CHAP_PASSWORD) {
        let challenge = packet
            .attribute(attr_type::CHAP_CHALLENGE)
            .map(|c| c.value.as_slice())
            .unwrap_or(&packet.authenticator);
        verify_chap_password(&chap_attr.value, challenge, &subscriber.password)
    } else {
        false
    };

    if !authenticated {
        let _ = db
            .log_auth(Some(nas.id), &username, false, src_ip, "Authentication failed")
            .await;
        return Some(encode_response(
            codes::ACCESS_REJECT,
            packet.identifier,
            &packet.authenticator,
            &[RadiusAttribute::string(
                attr_type::REPLY_MESSAGE,
                "Invalid credentials",
            )],
            secret,
        ));
    }

    // Quota enforcement: reset if cadence window elapsed, then check limit.
    db.maybe_reset_quota(&username).await.ok()?;
    db.accumulate_quota_usage(&username).await.ok()?;
    let fresh_usage: Option<i64> = sqlx::query_scalar(
        "SELECT quota_used_bytes FROM subscribers WHERE username = ?1",
    )
    .bind(&username)
    .fetch_optional(&db.pool)
    .await
    .ok()?;
    let quota_limit = subscriber.quota_bytes;
    if quota_limit > 0 && fresh_usage.unwrap_or(0) >= quota_limit {
        db.quota_exceeded_rejects.fetch_add(1, Ordering::Relaxed);
        let _ = db
            .mark_quota_disconnect(&username)
            .await;
        let _ = db
            .log_auth(
                Some(nas.id),
                &username,
                false,
                src_ip,
                "Monthly quota exceeded",
            )
            .await;
        return Some(encode_response(
            codes::ACCESS_REJECT,
            packet.identifier,
            &packet.authenticator,
            &[RadiusAttribute::string(
                attr_type::REPLY_MESSAGE,
                "Monthly quota exceeded",
            )],
            secret,
        ));
    }

    let mut reply_attrs = vec![
        RadiusAttribute::string(attr_type::REPLY_MESSAGE, "Access-Accept"),
        RadiusAttribute::string(
            attr_type::FILTER_ID,
            &format!("{}k/{}k", subscriber.download_kbps, subscriber.upload_kbps),
        ),
    ];
    if let Some(ip_str) = subscriber.framed_ip.as_deref() {
        if let Ok(ip) = ip_str.parse::<Ipv4Addr>() {
            reply_attrs.push(RadiusAttribute::ipv4(attr_type::FRAMED_IP_ADDRESS, ip));
        }
    }

    let _ = db
        .log_auth(Some(nas.id), &username, true, src_ip, "Access-Accept")
        .await;
    Some(encode_response(
        codes::ACCESS_ACCEPT,
        packet.identifier,
        &packet.authenticator,
        &reply_attrs,
        secret,
    ))
}

async fn process_accounting_request(db: &Database, raw: &[u8], src_ip: &str) -> Option<Vec<u8>> {
    let packet = match decode_packet(raw) {
        Ok(p) => p,
        Err(err) => {
            warn!("Malformed RADIUS acct packet from {}: {}", src_ip, err);
            return None;
        }
    };
    if packet.code != codes::ACCOUNTING_REQUEST {
        return None;
    }

    let nas = match db.find_client_with_secret(src_ip).await {
        Ok(Some(c)) => c,
        Ok(None) => return None,
        // M19.05: a lookup failure means we cannot durably resolve the event's
        // identity, so withhold the Accounting-Response and let the NAS retry.
        Err(err) => {
            warn!(
                "NAS lookup failed; withholding Accounting-Response for {} from {}: {}",
                packet.identifier, src_ip, err
            );
            db.accounting_acks_withheld.fetch_add(1, Ordering::Relaxed);
            return None;
        }
    };

    let secret = nas.secret.as_bytes();
    if !verify_accounting_authenticator(raw, secret) {
        warn!("Invalid RADIUS accounting authenticator from {}", src_ip);
        return None;
    }

    let status_type = packet
        .attribute(attr_type::ACCT_STATUS_TYPE)
        .and_then(RadiusAttribute::as_u32)
        .unwrap_or(0);
    let session_id = packet
        .attribute(attr_type::ACCT_SESSION_ID)
        .map(RadiusAttribute::as_str)
        .unwrap_or_else(|| format!("anon-{}", packet.identifier));
    let username = packet
        .attribute(attr_type::USER_NAME)
        .map(RadiusAttribute::as_str)
        .unwrap_or_else(|| "unknown".to_string());
    let nas_port = packet
        .attribute(attr_type::NAS_PORT)
        .and_then(RadiusAttribute::as_u32)
        .map(|v| v.to_string());
    let framed_ip = packet
        .attribute(attr_type::FRAMED_IP_ADDRESS)
        .and_then(RadiusAttribute::as_ipv4)
        .map(|ip| ip.to_string());
    let calling_station_id = packet
        .attribute(attr_type::CALLING_STATION_ID)
        .map(RadiusAttribute::as_str);
    // M19.06: normalized 64-bit counters, Gigawords-aware.
    let (input_octets, output_octets) = extract_octet_counters(&packet);
    let session_time = packet
        .attribute(attr_type::ACCT_SESSION_TIME)
        .and_then(RadiusAttribute::as_u32)
        .unwrap_or(0) as i64;
    let terminate_cause = packet
        .attribute(attr_type::ACCT_TERMINATE_CAUSE)
        .and_then(RadiusAttribute::as_u32)
        .map(|v| v as i64);

    // M19.05 durable ACK contract: the Accounting-Response is sent only after the
    // accounting event has been durably persisted. On write failure we deliberately
    // send no response so the NAS retransmits and we do not acknowledge an event we
    // may lose. A bounded counter tracks withheld ACKs for diagnostics.
    if let Err(err) = db
        .record_accounting(
            &session_id,
            &username,
            src_ip,
            nas_port,
            framed_ip,
            calling_station_id,
            status_type,
            input_octets,
            output_octets,
            session_time,
            terminate_cause,
        )
        .await
    {
        warn!(
            "Accounting write failed; withholding Accounting-Response for session {} from {}: {}",
            session_id, src_ip, err
        );
        db.accounting_acks_withheld
            .fetch_add(1, Ordering::Relaxed);
        return None;
    }

    Some(encode_response(
        codes::ACCOUNTING_RESPONSE,
        packet.identifier,
        &packet.authenticator,
        &[],
        secret,
    ))
}

async fn run_radius_server(addr: SocketAddr, db: Database) -> Result<()> {
    let socket = UdpSocket::bind(addr).await?;
    info!("RADIUS auth server listening on {}", addr);
    let mut buf = [0u8; 4096];

    loop {
        match socket.recv_from(&mut buf).await {
            Ok((len, src)) => {
                let src_ip = src.ip().to_string();
                if let Some(response) = process_access_request(&db, &buf[..len], &src_ip).await {
                    let _ = socket.send_to(&response, src).await;
                }
            }
            Err(e) => warn!("RADIUS socket error: {}", e),
        }
    }
}

async fn run_acct_server(addr: SocketAddr, db: Database) -> Result<()> {
    let socket = UdpSocket::bind(addr).await?;
    info!("RADIUS accounting server listening on {}", addr);
    let mut buf = [0u8; 4096];

    loop {
        match socket.recv_from(&mut buf).await {
            Ok((len, src)) => {
                let src_ip = src.ip().to_string();
                if let Some(response) = process_accounting_request(&db, &buf[..len], &src_ip).await {
                    let _ = socket.send_to(&response, src).await;
                }
            }
            Err(e) => warn!("RADIUS acct socket error: {}", e),
        }
    }
}

fn build_http_router(db: Database, admin_token: String) -> Router {
    let state = AppState { db, admin_token };
    let protected = Router::new()
        .route("/api/clients", get(list_clients).post(create_client))
        .route("/api/clients/{ip}/rotate-secret", post(rotate_secret))
        .route("/api/subscribers", get(list_subscribers).post(upsert_subscriber))
        .route("/api/subscribers/{username}/suspend", post(suspend_subscriber))
        .route("/api/sessions", get(list_sessions))
        .route("/api/sessions/disconnect", post(disconnect_session))
        .route("/api/stats", get(get_stats))
        .route("/metrics", get(get_metrics))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_bearer_auth));
    Router::new()
        .route("/health", get(health))
        .merge(protected)
        .with_state(state)
}

async fn run_http_server(addr: SocketAddr, db: Database, admin_token: String) -> Result<()> {
    let app = build_http_router(db, admin_token);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!("HTTP admin API listening on {}", addr);
    axum::serve(listener, app).await?;
    Ok(())
}

async fn require_bearer_auth(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let authorized = req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(|token| constant_time_eq(token.as_bytes(), state.admin_token.as_bytes()))
        .unwrap_or(false);
    if authorized {
        Ok(next.run(req).await)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({"status": "ok"}))
}

async fn list_clients(State(state): State<AppState>) -> Result<Json<Vec<NasClient>>, StatusCode> {
    let clients = state
        .db
        .get_clients()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(clients))
}

async fn create_client(
    State(state): State<AppState>,
    Json(payload): Json<CreateClientRequest>,
) -> Result<Json<NasClient>, StatusCode> {
    let client = state
        .db
        .upsert_client(&payload.name, &payload.ip_address, &payload.secret)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(client))
}

async fn rotate_secret(
    State(state): State<AppState>,
    Path(ip): Path<String>,
    Json(payload): Json<RotateSecretRequest>,
) -> Result<Json<NasClient>, StatusCode> {
    if payload.secret.len() < 12 {
        return Err(StatusCode::BAD_REQUEST);
    }
    let client = state
        .db
        .rotate_client_secret(
            &ip,
            &payload.secret,
            payload.reason.as_deref().unwrap_or("api_rotation"),
        )
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(client))
}

async fn list_subscribers(
    State(state): State<AppState>,
) -> Result<Json<Vec<SubscriberSummary>>, StatusCode> {
    let rows = state
        .db
        .list_subscribers()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(rows))
}

async fn upsert_subscriber(
    State(state): State<AppState>,
    Json(payload): Json<UpsertSubscriberRequest>,
) -> Result<Json<SubscriberSummary>, StatusCode> {
    let sub = state
        .db
        .upsert_subscriber(&payload)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(sub))
}

async fn suspend_subscriber(
    State(state): State<AppState>,
    Path(username): Path<String>,
) -> Result<Json<SubscriberSummary>, StatusCode> {
    let sub = state
        .db
        .update_subscriber_status(&username, "suspended")
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(sub))
}

async fn list_sessions(
    State(state): State<AppState>,
) -> Result<Json<Vec<RadiusSessionRow>>, StatusCode> {
    let rows = state
        .db
        .list_sessions()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(rows))
}

#[derive(serde::Deserialize)]
struct DisconnectRequest {
    username: String,
    nas_ip: Option<String>,
    acct_session_id: Option<String>,
    framed_ip: Option<String>,
    coa_port: Option<u16>,
}

#[derive(serde::Serialize)]
struct DisconnectResponse {
    sent: bool,
    ack: bool,
    nas_ip: Option<String>,
    error: Option<String>,
}

async fn disconnect_session(
    State(state): State<AppState>,
    Json(payload): Json<DisconnectRequest>,
) -> Result<Json<DisconnectResponse>, StatusCode> {
    let (db, admin_token_unused) = (state.db, state.admin_token.clone());
    let _ = admin_token_unused;

    // Resolve nas_ip / session id from matching active sessions when omitted.
    let (nas_ip, session_id) = match (&payload.nas_ip, &payload.acct_session_id) {
        (Some(ip), Some(sid)) => (Some(ip.clone()), Some(sid.clone())),
        _ => {
            let session = db
                .find_active_session(&payload.username, payload.nas_ip.as_deref(), payload.framed_ip.as_deref())
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            match session {
                Some(row) => (
                    payload.nas_ip.clone().or(row.nas_ip.clone()),
                    payload.acct_session_id.clone().or(Some(row.session_id.clone())),
                ),
                None => (payload.nas_ip.clone(), payload.acct_session_id.clone()),
            }
        }
    };

    let Some(nas_ip) = nas_ip else {
        return Ok(Json(DisconnectResponse {
            sent: false,
            ack: false,
            nas_ip: None,
            error: Some("no active session or nas_ip provided".to_string()),
        }));
    };

    let nas = match db.find_client_with_secret(&nas_ip).await {
        Ok(Some(c)) => c,
        Ok(None) => return Err(StatusCode::NOT_FOUND),
        Err(_) => return Err(StatusCode::INTERNAL_SERVER_ERROR),
    };

    let coa_port = payload.coa_port.unwrap_or(3799);
    let target: SocketAddr = match format!("{}:{}", nas_ip, coa_port).parse() {
        Ok(addr) => addr,
        Err(err) => {
            return Ok(Json(DisconnectResponse {
                sent: false,
                ack: false,
                nas_ip: Some(nas_ip),
                error: Some(format!("invalid target address: {}", err)),
            }));
        }
    };

    match send_disconnect_request(target, &nas_ip, &nas.secret, session_id.as_deref(), &payload).await {
        Ok(ack) => {
            if ack {
                if let Err(err) = db
                    .mark_sessions_terminated(&payload.username, session_id.as_deref())
                    .await
                {
                    warn!(
                        "Disconnect acknowledged but failed to mark sessions terminated for {}: {}",
                        payload.username, err
                    );
                }
            }
            Ok(Json(DisconnectResponse {
                sent: true,
                ack,
                nas_ip: Some(nas_ip),
                error: None,
            }))
        }
        Err(err) => Ok(Json(DisconnectResponse {
            sent: false,
            ack: false,
            nas_ip: Some(nas_ip),
            error: Some(err.to_string()),
        })),
    }
}

async fn send_disconnect_request(
    target: SocketAddr,
    nas_ip: &str,
    secret: &str,
    session_id: Option<&str>,
    payload: &DisconnectRequest,
) -> anyhow::Result<bool> {
    let bind_addr = if target.ip().is_loopback() {
        "127.0.0.1:0"
    } else {
        "0.0.0.0:0"
    };
    let socket = UdpSocket::bind(bind_addr).await?;
    socket.connect(target).await?;

    let mut attributes = vec![RadiusAttribute::string(attr_type::USER_NAME, &payload.username)];
    if let Some(session_id) = session_id {
        attributes.push(RadiusAttribute::string(attr_type::ACCT_SESSION_ID, session_id));
    }
    if let Some(framed_ip) = payload.framed_ip.as_deref() {
        if let Ok(ip) = framed_ip.parse::<Ipv4Addr>() {
            attributes.push(RadiusAttribute::ipv4(attr_type::FRAMED_IP_ADDRESS, ip));
        }
    }

    let packet = encode_disconnect_request(1, &attributes, secret.as_bytes());
    socket.send(&packet).await?;

    let request_authenticator: [u8; 16] = packet[4..20].try_into().expect("authenticator is 16 bytes");
    let mut buf = [0u8; 4096];
    let (len, _src) = tokio::time::timeout(Duration::from_millis(1500), socket.recv_from(&mut buf))
        .await
        .map_err(|_| anyhow::anyhow!("timed out waiting for Disconnect-ACK/NAK from {}", nas_ip))??;

    let reply = &buf[..len];
    let decoded = decode_packet(reply)
        .map_err(|e| anyhow::anyhow!("malformed RADIUS reply from {}: {}", nas_ip, e))?;
    if !verify_response_authenticator(reply, &request_authenticator, secret.as_bytes()) {
        return Err(anyhow::anyhow!(
            "invalid Response-Authenticator from NAS {}",
            nas_ip
        ));
    }
    Ok(decoded.code == codes::DISCONNECT_ACK)
}

async fn get_stats(State(state): State<AppState>) -> Result<Json<AuthStats>, StatusCode> {
    let db = &state.db;
    let total_clients: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM nas_clients")
        .fetch_one(db.pool())
        .await
        .unwrap_or(0);
    let enabled_clients: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM nas_clients WHERE enabled = 1")
            .fetch_one(db.pool())
            .await
            .unwrap_or(0);
    let total_subscribers: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM subscribers")
        .fetch_one(db.pool())
        .await
        .unwrap_or(0);
    let active_sessions: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM radius_sessions WHERE status = 'active'")
            .fetch_one(db.pool())
            .await
            .unwrap_or(0);

    Ok(Json(AuthStats {
        total_clients,
        enabled_clients,
        total_subscribers,
        active_sessions,
    }))
}

async fn get_metrics(State(state): State<AppState>) -> String {
    let db = &state.db;
    let quota_exceeded = db.quota_exceeded_rejects.load(Ordering::Relaxed);
    let quota_duplicates = db.quota_duplicate_accumulations.load(Ordering::Relaxed);
    let acks_withheld = db.accounting_acks_withheld.load(Ordering::Relaxed);

    format!(
        r#"# HELP moonwitness_isp_quota_exceeded_rejects_total Total number of Access-Requests rejected due to quota exceeded
# TYPE moonwitness_isp_quota_exceeded_rejects_total counter
moonwitness_isp_quota_exceeded_rejects_total {quota_exceeded}
# HELP moonwitness_isp_quota_duplicate_accumulations_total Total number of duplicate quota accumulation attempts skipped (idempotent replay)
# TYPE moonwitness_isp_quota_duplicate_accumulations_total counter
moonwitness_isp_quota_duplicate_accumulations_total {quota_duplicates}
# HELP moonwitness_isp_accounting_acks_withheld_total Number of Accounting-Responses withheld because the durable write failed
# TYPE moonwitness_isp_accounting_acks_withheld_total counter
moonwitness_isp_accounting_acks_withheld_total {acks_withheld}
"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::{BufMut, BytesMut};
    use md5::{Digest, Md5};
    use radius_protocol::{encrypt_pap_password, sign_accounting_request};

    async fn test_db() -> (tempfile::TempDir, Database) {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("isp_test.db");
        let db = Database::new(db_path.to_str().unwrap()).await.unwrap();
        db.migrate().await.unwrap();
        (dir, db)
    }

    fn build_accounting_request(
        id: u8,
        username: &str,
        session_id: &str,
        status_type: u32,
        input_octets: u32,
        output_octets: u32,
        session_time: u32,
        secret: &[u8],
    ) -> Vec<u8> {
        let mut pkt = BytesMut::new();
        pkt.put_u8(codes::ACCOUNTING_REQUEST);
        pkt.put_u8(id);
        pkt.put_u16(0);
        pkt.extend_from_slice(&[0u8; 16]);
        RadiusAttribute::string(attr_type::USER_NAME, username).encode(&mut pkt);
        RadiusAttribute::string(attr_type::ACCT_SESSION_ID, session_id).encode(&mut pkt);
        RadiusAttribute::u32(attr_type::ACCT_STATUS_TYPE, status_type).encode(&mut pkt);
        RadiusAttribute::u32(attr_type::ACCT_INPUT_OCTETS, input_octets).encode(&mut pkt);
        RadiusAttribute::u32(attr_type::ACCT_OUTPUT_OCTETS, output_octets).encode(&mut pkt);
        RadiusAttribute::u32(attr_type::ACCT_SESSION_TIME, session_time).encode(&mut pkt);
        let total = pkt.len() as u16;
        pkt[2..4].copy_from_slice(&total.to_be_bytes());
        sign_accounting_request(&mut pkt, secret);
        pkt.to_vec()
    }

    fn build_pap_access_request(
        id: u8,
        username: &str,
        password: &str,
        secret: &[u8],
    ) -> Vec<u8> {
        let req_auth = [0x11u8; 16];
        let encrypted = encrypt_pap_password(password, &req_auth, secret);
        let mut attrs = BytesMut::new();
        RadiusAttribute::string(attr_type::USER_NAME, username).encode(&mut attrs);
        RadiusAttribute {
            attr_type: attr_type::USER_PASSWORD,
            value: encrypted,
        }
        .encode(&mut attrs);
        let total = (20 + attrs.len()) as u16;
        let mut pkt = BytesMut::with_capacity(total as usize);
        pkt.put_u8(codes::ACCESS_REQUEST);
        pkt.put_u8(id);
        pkt.put_u16(total);
        pkt.extend_from_slice(&req_auth);
        pkt.extend_from_slice(&attrs);
        pkt.to_vec()
    }

    fn build_chap_access_request(
        id: u8,
        username: &str,
        password: &str,
        chap_id: u8,
        challenge: &[u8],
    ) -> Vec<u8> {
        let req_auth = [0x22u8; 16];
        let mut hasher = Md5::new();
        hasher.update([chap_id]);
        hasher.update(password.as_bytes());
        hasher.update(challenge);
        let mut chap_pw = vec![chap_id];
        chap_pw.extend_from_slice(&hasher.finalize());

        let mut attrs = BytesMut::new();
        RadiusAttribute::string(attr_type::USER_NAME, username).encode(&mut attrs);
        RadiusAttribute {
            attr_type: attr_type::CHAP_PASSWORD,
            value: chap_pw,
        }
        .encode(&mut attrs);
        RadiusAttribute {
            attr_type: attr_type::CHAP_CHALLENGE,
            value: challenge.to_vec(),
        }
        .encode(&mut attrs);

        let total = (20 + attrs.len()) as u16;
        let mut pkt = BytesMut::with_capacity(total as usize);
        pkt.put_u8(codes::ACCESS_REQUEST);
        pkt.put_u8(id);
        pkt.put_u16(total);
        pkt.extend_from_slice(&req_auth);
        pkt.extend_from_slice(&attrs);
        pkt.to_vec()
    }

    #[tokio::test]
    async fn authenticates_pap_and_chap_subscribers_and_rejects_suspended_or_wrong_password() {
        let (_dir, db) = test_db().await;
        db.upsert_client("Local NAS", "127.0.0.1", "nas-secret-1234")
            .await
            .unwrap();
        db.upsert_subscriber(&UpsertSubscriberRequest {
            username: "acme-fiber-01".to_string(),
            password: "correct-horse-password".to_string(),
            connection_type: Some("pppoe".to_string()),
            framed_ip: Some("100.64.0.42".to_string()),
            download_kbps: Some(102400),
            upload_kbps: Some(102400),
            status: Some("active".to_string()),
        })
        .await
        .unwrap();

        let pap_ok = build_pap_access_request(
            1,
            "acme-fiber-01",
            "correct-horse-password",
            b"nas-secret-1234",
        );
        let resp_ok = decode_packet(
            &process_access_request(&db, &pap_ok, "127.0.0.1")
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(resp_ok.code, codes::ACCESS_ACCEPT);
        assert_eq!(
            resp_ok
                .attribute(attr_type::FRAMED_IP_ADDRESS)
                .and_then(RadiusAttribute::as_ipv4),
            Some(Ipv4Addr::new(100, 64, 0, 42))
        );

        let chap_ok = build_chap_access_request(
            2,
            "acme-fiber-01",
            "correct-horse-password",
            5,
            b"chap-challenge-bytes",
        );
        let resp_chap = decode_packet(
            &process_access_request(&db, &chap_ok, "127.0.0.1")
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(resp_chap.code, codes::ACCESS_ACCEPT);

        let pap_bad =
            build_pap_access_request(3, "acme-fiber-01", "wrong-password", b"nas-secret-1234");
        let resp_bad = decode_packet(
            &process_access_request(&db, &pap_bad, "127.0.0.1")
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(resp_bad.code, codes::ACCESS_REJECT);

        db.update_subscriber_status("acme-fiber-01", "suspended")
            .await
            .unwrap();
        let resp_suspended = decode_packet(
            &process_access_request(&db, &pap_ok, "127.0.0.1")
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(resp_suspended.code, codes::ACCESS_REJECT);
    }

    #[tokio::test]
    async fn processes_udp_radius_auth_and_accounting_sessions_end_to_end() {
        let (_dir, db) = test_db().await;
        db.upsert_client("Loopback NAS", "127.0.0.1", "udp-secret-12345")
            .await
            .unwrap();
        db.upsert_subscriber(&UpsertSubscriberRequest {
            username: "udp-user".to_string(),
            password: "udp-password".to_string(),
            connection_type: Some("pppoe".to_string()),
            framed_ip: Some("100.64.1.10".to_string()),
            download_kbps: Some(51200),
            upload_kbps: Some(25600),
            status: Some("active".to_string()),
        })
        .await
        .unwrap();

        let auth_sock = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let auth_addr = auth_sock.local_addr().unwrap();
        let acct_sock = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let acct_addr = acct_sock.local_addr().unwrap();

        let auth_db = db.clone();
        let auth_task = tokio::spawn(async move {
            let mut buf = [0u8; 4096];
            let (len, src) = auth_sock.recv_from(&mut buf).await.unwrap();
            if let Some(resp) =
                process_access_request(&auth_db, &buf[..len], &src.ip().to_string()).await
            {
                let _ = auth_sock.send_to(&resp, src).await;
            }
        });

        let acct_db = db.clone();
        let acct_task = tokio::spawn(async move {
            let mut buf = [0u8; 4096];
            for _ in 0..2 {
                let (len, src) = acct_sock.recv_from(&mut buf).await.unwrap();
                if let Some(resp) =
                    process_accounting_request(&acct_db, &buf[..len], &src.ip().to_string()).await
                {
                    let _ = acct_sock.send_to(&resp, src).await;
                }
            }
        });

        let client_sock = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let auth_req =
            build_pap_access_request(77, "udp-user", "udp-password", b"udp-secret-12345");
        client_sock.send_to(&auth_req, auth_addr).await.unwrap();
        let mut reply_buf = [0u8; 1024];
        let (n, _) = client_sock.recv_from(&mut reply_buf).await.unwrap();
        let auth_resp = decode_packet(&reply_buf[..n]).unwrap();
        assert_eq!(auth_resp.code, codes::ACCESS_ACCEPT);

        for (id, status_type, octets_in, octets_out, secs) in [
            (78u8, acct_status::START, 0u32, 0u32, 0u32),
            (79u8, acct_status::STOP, 102400u32, 204800u32, 3600u32),
        ] {
            let mut pkt = BytesMut::new();
            pkt.put_u8(codes::ACCOUNTING_REQUEST);
            pkt.put_u8(id);
            pkt.put_u16(0);
            pkt.extend_from_slice(&[0u8; 16]);
            RadiusAttribute::string(attr_type::USER_NAME, "udp-user").encode(&mut pkt);
            RadiusAttribute::string(attr_type::ACCT_SESSION_ID, "sess-udp-001").encode(&mut pkt);
            RadiusAttribute::u32(attr_type::ACCT_STATUS_TYPE, status_type).encode(&mut pkt);
            RadiusAttribute::ipv4(attr_type::FRAMED_IP_ADDRESS, Ipv4Addr::new(100, 64, 1, 10))
                .encode(&mut pkt);
            RadiusAttribute::u32(attr_type::ACCT_INPUT_OCTETS, octets_in).encode(&mut pkt);
            RadiusAttribute::u32(attr_type::ACCT_OUTPUT_OCTETS, octets_out).encode(&mut pkt);
            RadiusAttribute::u32(attr_type::ACCT_SESSION_TIME, secs).encode(&mut pkt);
            let total = pkt.len() as u16;
            pkt[2..4].copy_from_slice(&total.to_be_bytes());
            sign_accounting_request(&mut pkt, b"udp-secret-12345");

            client_sock.send_to(&pkt, acct_addr).await.unwrap();
            let (an, _) = client_sock.recv_from(&mut reply_buf).await.unwrap();
            let acct_resp = decode_packet(&reply_buf[..an]).unwrap();
            assert_eq!(acct_resp.code, codes::ACCOUNTING_RESPONSE);
        }

        auth_task.await.unwrap();
        acct_task.await.unwrap();

        let sessions = db.list_sessions().await.unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, "sess-udp-001");
        assert_eq!(sessions[0].status, "closed");
        assert_eq!(sessions[0].acct_input_octets, 102400);
        assert_eq!(sessions[0].acct_output_octets, 204800);
        assert_eq!(sessions[0].acct_session_time, 3600);
    }

    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn resolves_admin_token_with_precedence() {
        let _guard = ENV_LOCK.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("isp.db");
        let db_str = db_path.to_str().unwrap();

        let prev_internal = std::env::var("MW_INTERNAL_SECRET").ok();
        let prev_jwt = std::env::var("JWT_SECRET").ok();

        // SAFETY: serialized across tests via ENV_LOCK.
        unsafe {
            std::env::set_var("MW_INTERNAL_SECRET", "internal-secret-abc");
            std::env::set_var("JWT_SECRET", "jwt-secret-xyz");
        }

        // 1. Explicit configured token wins over secrets and token file.
        let explicit = resolve_admin_token(Some("  explicit-token-123  "), db_str).unwrap();
        assert_eq!(explicit, "explicit-token-123");

        // 2. MW_INTERNAL_SECRET wins over JWT_SECRET when configured is None/empty.
        let from_internal = resolve_admin_token(Some("   "), db_str).unwrap();
        assert_eq!(from_internal.len(), 64);

        // 3. JWT_SECRET fallback derives deterministic HMAC-SHA256 hex digest.
        // SAFETY: serialized across tests via ENV_LOCK.
        unsafe {
            std::env::remove_var("MW_INTERNAL_SECRET");
        }
        let from_jwt = resolve_admin_token(None, db_str).unwrap();
        let mut expected_mac = Hmac::<Sha256>::new_from_slice(b"jwt-secret-xyz").unwrap();
        expected_mac.update(ADMIN_TOKEN_MESSAGE);
        let expected_hex = hex::encode(expected_mac.finalize().into_bytes());
        assert_eq!(from_jwt, expected_hex);
        assert_ne!(from_jwt, from_internal);

        // 4. Standalone fallback generates and persists .admin-token file.
        // SAFETY: serialized across tests via ENV_LOCK.
        unsafe {
            std::env::remove_var("JWT_SECRET");
        }
        let token_file = dir.path().join(".admin-token");
        assert!(!token_file.exists());
        let generated = resolve_admin_token(None, db_str).unwrap();
        assert_eq!(generated.len(), 64);
        assert!(token_file.exists());
        let reused = resolve_admin_token(None, db_str).unwrap();
        assert_eq!(reused, generated);

        // Restore prior env state.
        // SAFETY: serialized across tests via ENV_LOCK.
        unsafe {
            match prev_internal {
                Some(v) => std::env::set_var("MW_INTERNAL_SECRET", v),
                None => std::env::remove_var("MW_INTERNAL_SECRET"),
            }
            match prev_jwt {
                Some(v) => std::env::set_var("JWT_SECRET", v),
                None => std::env::remove_var("JWT_SECRET"),
            }
        }
    }

    #[tokio::test]
    async fn http_router_enforces_bearer_auth_and_allows_health() {
        use axum::body::Body;
        use axum::http::{header, Request};
        use tower::ServiceExt;

        let (_dir, db) = test_db().await;
        let token = "test-admin-token-64chars-0000000000000000000000000000000000000";
        let app = build_http_router(db, token.to_string());

        // /health is unauthenticated.
        let health_res = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(health_res.status(), StatusCode::OK);

        // /api/clients without Authorization returns 401.
        let unauth_res = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/clients")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(unauth_res.status(), StatusCode::UNAUTHORIZED);

        // /api/clients with wrong Bearer token returns 401.
        let bad_auth_res = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/clients")
                    .header(header::AUTHORIZATION, "Bearer wrong-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(bad_auth_res.status(), StatusCode::UNAUTHORIZED);

        // /api/clients with valid Bearer token returns 200.
        let ok_res = app
            .oneshot(
                Request::builder()
                    .uri("/api/clients")
                    .header(header::AUTHORIZATION, format!("Bearer {}", token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(ok_res.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn disconnect_session_sends_rfc5176_packet_and_marks_session_terminated() {
        use axum::body::{to_bytes, Body};
        use axum::http::{header, Method, Request};
        use tower::ServiceExt;

        let (_dir, db) = test_db().await;
        let nas_secret = "coa-shared-secret-123";
        db.upsert_client("Loopback CoA NAS", "127.0.0.1", nas_secret)
            .await
            .unwrap();
        db.record_accounting(
            "sess-coa-900",
            "fiber-cust-9",
            "127.0.0.1",
            Some("1".to_string()),
            Some("100.64.9.9".to_string()),
            None,
            acct_status::START,
            0,
            0,
            0,
            None,
        )
        .await
        .unwrap();

        let nas_sock = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let coa_port = nas_sock.local_addr().unwrap().port();
        let nas_task = tokio::spawn(async move {
            let mut buf = [0u8; 4096];
            let (len, src) = nas_sock.recv_from(&mut buf).await.unwrap();
            let req = decode_packet(&buf[..len]).unwrap();
            assert_eq!(req.code, codes::DISCONNECT_REQUEST);
            assert_eq!(
                req.attribute(attr_type::USER_NAME).map(RadiusAttribute::as_str),
                Some("fiber-cust-9".to_string())
            );
            assert_eq!(
                req.attribute(attr_type::ACCT_SESSION_ID).map(RadiusAttribute::as_str),
                Some("sess-coa-900".to_string())
            );
            let ack = encode_response(
                codes::DISCONNECT_ACK,
                req.identifier,
                &req.authenticator,
                &[],
                nas_secret.as_bytes(),
            );
            nas_sock.send_to(&ack, src).await.unwrap();
        });

        let token = "disconnect-test-token";
        let app = build_http_router(db.clone(), token.to_string());
        let body = serde_json::json!({
            "username": "fiber-cust-9",
            "coa_port": coa_port
        });
        let res = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/sessions/disconnect")
                    .header(header::AUTHORIZATION, format!("Bearer {}", token))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);

        let bytes = to_bytes(res.into_body(), 16 * 1024).await.unwrap();
        let payload: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(payload["sent"], true);
        assert_eq!(payload["ack"], true);
        assert_eq!(payload["nas_ip"], "127.0.0.1");
        assert!(payload["error"].is_null());

        nas_task.await.unwrap();

        let sessions = db.list_sessions().await.unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, "sess-coa-900");
        assert_eq!(sessions[0].status, "terminated");
        assert_eq!(sessions[0].terminate_cause, Some(6));
        assert!(sessions[0].stopped_at.is_some());
    }

    #[tokio::test]
    async fn repeated_access_requests_do_not_double_count_quota() {
        let (_dir, db) = test_db().await;
        db.upsert_client("Replay NAS", "127.0.0.1", "replay-secret-123")
            .await
            .unwrap();
        db.upsert_subscriber(&UpsertSubscriberRequest {
            username: "replay-user".to_string(),
            password: "replay-pass".to_string(),
            connection_type: Some("pppoe".to_string()),
            framed_ip: Some("100.64.5.1".to_string()),
            download_kbps: Some(102400),
            upload_kbps: Some(51200),
            status: Some("active".to_string()),
        })
        .await
        .unwrap();

        // Quota limit of 2GB; the session reports 1GB of traffic.
        sqlx::query(
            "UPDATE subscribers SET quota_bytes = 2147483648 WHERE username = 'replay-user'",
        )
        .execute(db.pool())
        .await
        .unwrap();

        // One active session with cumulative counters of 1GB (as a NAS would
        // report on every interim update / re-acknowledged session).
        db.record_accounting(
            "sess-replay-001",
            "replay-user",
            "127.0.0.1",
            None,
            Some("100.64.5.1".to_string()),
            None,
            acct_status::INTERIM_UPDATE,
            536870912,
            536870912,
            3600,
            None,
        )
        .await
        .unwrap();

        // Ten repeated Access-Requests (NAS retries / duplicate packets):
        // with the old code each added the full 1GB again; delta accounting
        // must count the 1GB exactly once.
        for _ in 0..10 {
            let req =
                build_pap_access_request(12, "replay-user", "replay-pass", b"replay-secret-123");
            let resp = decode_packet(
                &process_access_request(&db, &req, "127.0.0.1")
                    .await
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(resp.code, codes::ACCESS_ACCEPT);
        }

        let usage: i64 = sqlx::query_scalar(
            "SELECT quota_used_bytes FROM subscribers WHERE username = 'replay-user'",
        )
        .fetch_one(db.pool())
        .await
        .unwrap();
        assert_eq!(usage, 1073741824);
    }

    #[tokio::test]
    async fn interim_octet_growth_accumulates_only_the_delta() {
        let (_dir, db) = test_db().await;
        db.upsert_client("Delta NAS", "127.0.0.1", "delta-secret-123")
            .await
            .unwrap();
        db.upsert_subscriber(&UpsertSubscriberRequest {
            username: "delta-user".to_string(),
            password: "delta-pass".to_string(),
            connection_type: Some("pppoe".to_string()),
            framed_ip: Some("100.64.6.1".to_string()),
            download_kbps: Some(102400),
            upload_kbps: Some(51200),
            status: Some("active".to_string()),
        })
        .await
        .unwrap();
        sqlx::query("UPDATE subscribers SET quota_bytes = 1000000 WHERE username = 'delta-user'")
            .execute(db.pool())
            .await
            .unwrap();

        let octets = [(50_000u64, 50_000u64), (100_000, 100_000), (200_000, 200_000)];
        for (i, (input, output)) in octets.iter().enumerate() {
            let status_type = if i == 0 { acct_status::START } else { acct_status::INTERIM_UPDATE };
            db.record_accounting(
                "sess-delta-001",
                "delta-user",
                "127.0.0.1",
                None,
                Some("100.64.6.1".to_string()),
                None,
                status_type,
                *input as i64,
                *output as i64,
                60 * (i as i64 + 1),
                None,
            )
            .await
            .unwrap();
            db.accumulate_quota_usage("delta-user").await.unwrap();
        }

        let usage: i64 = sqlx::query_scalar(
            "SELECT quota_used_bytes FROM subscribers WHERE username = 'delta-user'",
        )
        .fetch_one(db.pool())
        .await
        .unwrap();
        // Total traffic is 200KB + 200KB = 400,000 bytes, counted once.
        assert_eq!(usage, 400_000);
    }

    #[tokio::test]
    async fn quota_exceeded_rejects_access_request() {
        let (_dir, db) = test_db().await;
        db.upsert_client("Quota NAS", "127.0.0.1", "quota-secret-123")
            .await
            .unwrap();
        db.upsert_subscriber(&UpsertSubscriberRequest {
            username: "quota-user".to_string(),
            password: "quota-pass".to_string(),
            connection_type: Some("pppoe".to_string()),
            framed_ip: Some("100.64.2.1".to_string()),
            download_kbps: Some(102400),
            upload_kbps: Some(51200),
            status: Some("active".to_string()),
        })
        .await
        .unwrap();

        // Set quota to 100KB (102400 bytes)
        sqlx::query(
            "UPDATE subscribers SET quota_bytes = 102400, quota_used_bytes = 102400, quota_reset_cadence = 'monthly', last_quota_reset_at = datetime('now') WHERE username = 'quota-user'",
        )
        .execute(db.pool())
        .await
        .unwrap();

        let req = build_pap_access_request(10, "quota-user", "quota-pass", b"quota-secret-123");
        let resp = decode_packet(
            &process_access_request(&db, &req, "127.0.0.1")
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(resp.code, codes::ACCESS_REJECT);
        let msg = resp
            .attribute(attr_type::REPLY_MESSAGE)
            .map(RadiusAttribute::as_str)
            .unwrap();
        assert_eq!(msg, "Monthly quota exceeded");
    }

    #[tokio::test]
    async fn quota_cadence_reset_allows_access_after_window() {
        let (_dir, db) = test_db().await;
        db.upsert_client("Cadence NAS", "127.0.0.1", "cadence-secret-123")
            .await
            .unwrap();
        db.upsert_subscriber(&UpsertSubscriberRequest {
            username: "cadence-user".to_string(),
            password: "cadence-pass".to_string(),
            connection_type: Some("pppoe".to_string()),
            framed_ip: Some("100.64.3.1".to_string()),
            download_kbps: Some(102400),
            upload_kbps: Some(51200),
            status: Some("active".to_string()),
        })
        .await
        .unwrap();

        // Set quota to 100KB, usage already at limit, but last reset was 8 days ago (weekly cadence)
        sqlx::query(
            "UPDATE subscribers SET quota_bytes = 102400, quota_used_bytes = 102400, quota_reset_cadence = 'weekly', last_quota_reset_at = datetime('now', '-8 day') WHERE username = 'cadence-user'",
        )
        .execute(db.pool())
        .await
        .unwrap();

        // First request triggers reset, should accept
        let req = build_pap_access_request(11, "cadence-user", "cadence-pass", b"cadence-secret-123");
        let resp = decode_packet(
            &process_access_request(&db, &req, "127.0.0.1")
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(resp.code, codes::ACCESS_ACCEPT);

        // Usage should be reset to 0
        let usage: i64 = sqlx::query_scalar("SELECT quota_used_bytes FROM subscribers WHERE username = 'cadence-user'")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(usage, 0);
    }

    #[tokio::test]
    async fn rotate_client_secret_terminates_active_sessions() {
        let (_dir, db) = test_db().await;
        db.upsert_client("Rotate NAS", "127.0.0.1", "rotate-secret-old")
            .await
            .unwrap();
        db.upsert_subscriber(&UpsertSubscriberRequest {
            username: "rotate-user".to_string(),
            password: "rotate-pass".to_string(),
            connection_type: Some("pppoe".to_string()),
            framed_ip: Some("100.64.4.1".to_string()),
            download_kbps: Some(102400),
            upload_kbps: Some(51200),
            status: Some("active".to_string()),
        })
        .await
        .unwrap();

        // Create an active session for this NAS
        db.record_accounting(
            "sess-rotate-001",
            "rotate-user",
            "127.0.0.1",
            Some("1".to_string()),
            Some("100.64.4.1".to_string()),
            None,
            acct_status::START,
            0,
            0,
            0,
            None,
        )
        .await
        .unwrap();

        let sessions_before = db.list_sessions().await.unwrap();
        assert_eq!(sessions_before.len(), 1);
        assert_eq!(sessions_before[0].status, "active");

        // Rotate the secret
        let rotated = db
            .rotate_client_secret("127.0.0.1", "rotate-secret-new", "admin-rotation")
            .await
            .unwrap();
        assert!(rotated.is_some());

        // Session should be terminated
        let sessions_after = db.list_sessions().await.unwrap();
        assert_eq!(sessions_after.len(), 1);
        assert_eq!(sessions_after[0].status, "terminated");
        assert_eq!(sessions_after[0].terminate_cause, Some(6));

        // Subsequent auth from same NAS with OLD secret should fail
        let req_old = build_pap_access_request(12, "rotate-user", "rotate-pass", b"rotate-secret-old");
        let resp_old = decode_packet(
            &process_access_request(&db, &req_old, "127.0.0.1")
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(resp_old.code, codes::ACCESS_REJECT, "Old secret should not authenticate");

        // Auth with NEW secret should work
        let req_new = build_pap_access_request(13, "rotate-user", "rotate-pass", b"rotate-secret-new");
        let resp_new = decode_packet(
            &process_access_request(&db, &req_new, "127.0.0.1")
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(resp_new.code, codes::ACCESS_ACCEPT);
    }

    #[tokio::test]
    async fn accounting_request_with_db_failure_does_not_ack() {
        let (_dir, db) = test_db().await;
        db.upsert_client("test-nas", "127.0.0.1", "secret").await.unwrap();

        // Simulate a durable-write failure by closing the underlying pool so
        // every write path errors at the connection layer.
        db.pool.close().await;

        let req = build_accounting_request(
            1,
            "user1",
            "sess-dbfail-001",
            acct_status::START,
            0,
            0,
            0,
            b"secret",
        );

        let resp = process_accounting_request(&db, &req, "127.0.0.1").await;
        assert!(
            resp.is_none(),
            "No Accounting-Response may be sent when the durable write fails"
        );
        assert_eq!(
            db.accounting_acks_withheld.load(Ordering::Relaxed),
            1,
            "Withheld ACK counter must record the failure"
        );
    }

    #[tokio::test]
    async fn accounting_retransmission_persists_once_after_recovery() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("isp_retrans.db");
        let db = Database::new(db_path.to_str().unwrap()).await.unwrap();
        db.migrate().await.unwrap();
        db.upsert_client("test-nas", "127.0.0.1", "secret").await.unwrap();

        // 1. DB unavailable: NAS sends Accounting-Request, server must not ACK.
        db.pool.close().await;
        let req = build_accounting_request(
            2,
            "user2",
            "sess-retrans-001",
            acct_status::START,
            0,
            0,
            0,
            b"secret",
        );
        let resp = process_accounting_request(&db, &req, "127.0.0.1").await;
        assert!(resp.is_none(), "Withheld ACK while DB is unavailable");

        // 2. Recovery: reopen the database at the same path.
        let recovered = Database::new(db_path.to_str().unwrap()).await.unwrap();
        assert!(
            recovered.migrate().await.is_ok(),
            "Recovered database must be usable"
        );

        // 3. NAS retransmits the identical request (same id/session identity).
        let resp2 = process_accounting_request(&recovered, &req, "127.0.0.1").await;
        assert!(
            resp2.is_some(),
            "Retransmitted request must be ACKed after durable write succeeds"
        );

        // 4. Idempotent replay: retransmitting the identical request again must
        //    not create a duplicate session row.
        let resp3 = process_accounting_request(&recovered, &req, "127.0.0.1").await;
        assert!(resp3.is_some());

        let sessions = recovered.list_sessions().await.unwrap();
        assert_eq!(
            sessions.iter().filter(|s| s.session_id == "sess-retrans-001").count(),
            1,
            "Retransmission must persist exactly one session row"
        );
        assert_eq!(
            recovered.accounting_acks_withheld.load(Ordering::Relaxed),
            0,
            "Recovered server must not carry over withheld counters"
        );
    }

    // ---- M19.06: 64-bit counters and Gigawords ----

    #[test]
    fn combine_gigawords_normalizes_64_bit_totals() {
        // No Gigawords attribute: plain 32-bit value.
        assert_eq!(combine_gigawords(102_400, None), 102_400);
        // One wrap: 1 * 2^32 + low bits.
        assert_eq!(combine_gigawords(0, Some(1)), 1i64 << 32);
        assert_eq!(combine_gigawords(7, Some(1)), (1i64 << 32) + 7);
        // Multi-GiB session: 3 wraps + 1_500_000_000 low octets.
        assert_eq!(
            combine_gigawords(1_500_000_000, Some(3)),
            3i64 * (1i64 << 32) + 1_500_000_000
        );
    }

    #[test]
    fn gigawords_attributes_decode_to_64_bit_counters() {
        let mut pkt = BytesMut::new();
        pkt.put_u8(codes::ACCOUNTING_REQUEST);
        pkt.put_u8(9);
        pkt.put_u16(0);
        pkt.extend_from_slice(&[0u8; 16]);
        RadiusAttribute::string(at::ACCT_SESSION_ID, "sess-giga").encode(&mut pkt);
        RadiusAttribute::u32(at::ACCT_STATUS_TYPE, acct_status::INTERIM_UPDATE).encode(&mut pkt);
        RadiusAttribute::u32(at::ACCT_INPUT_OCTETS, 2_000_000_000).encode(&mut pkt);
        RadiusAttribute::u32(at::ACCT_OUTPUT_OCTETS, 3_000_000_000).encode(&mut pkt);
        RadiusAttribute::u32(at::ACCT_INPUT_GIGAWORDS, 2).encode(&mut pkt);
        RadiusAttribute::u32(at::ACCT_OUTPUT_GIGAWORDS, 5).encode(&mut pkt);
        let total = pkt.len() as u16;
        pkt[2..4].copy_from_slice(&total.to_be_bytes());

        let decoded = decode_packet(&pkt).unwrap();
        let (input64, output64) = extract_octet_counters(&decoded);
        assert_eq!(input64, 2i64 * (1i64 << 32) + 2_000_000_000);
        assert_eq!(output64, 5i64 * (1i64 << 32) + 3_000_000_000);
    }

    #[tokio::test]
    async fn gigaword_extended_accounting_persists_64_bit_totals() {
        let (_dir, db) = test_db().await;
        db.upsert_client("giga-nas", "127.0.0.1", "giga-secret-12")
            .await
            .unwrap();
        db.upsert_subscriber(&UpsertSubscriberRequest {
            username: "giga-user".to_string(),
            password: "giga-pass".to_string(),
            connection_type: Some("pppoe".to_string()),
            framed_ip: Some("100.64.7.1".to_string()),
            download_kbps: Some(1024),
            upload_kbps: Some(1024),
            status: Some("active".to_string()),
        })
        .await
        .unwrap();

        // START
        let req = build_accounting_request(21, "giga-user", "sess-giga-001", acct_status::START, 0, 0, 0, b"giga-secret-12");
        assert!(process_accounting_request(&db, &req, "127.0.0.1").await.is_some());

        // INTERIM: input wrapped twice (2 GiGa + 2e9 low), output 5 GiGa + 3e9.
        let mut pkt = BytesMut::new();
        pkt.put_u8(codes::ACCOUNTING_REQUEST);
        pkt.put_u8(22);
        pkt.put_u16(0);
        pkt.extend_from_slice(&[0u8; 16]);
        RadiusAttribute::string(attr_type::USER_NAME, "giga-user").encode(&mut pkt);
        RadiusAttribute::string(attr_type::ACCT_SESSION_ID, "sess-giga-001").encode(&mut pkt);
        RadiusAttribute::u32(attr_type::ACCT_STATUS_TYPE, acct_status::INTERIM_UPDATE).encode(&mut pkt);
        RadiusAttribute::u32(attr_type::ACCT_INPUT_OCTETS, 2_000_000_000).encode(&mut pkt);
        RadiusAttribute::u32(attr_type::ACCT_OUTPUT_OCTETS, 3_000_000_000).encode(&mut pkt);
        RadiusAttribute::u32(attr_type::ACCT_INPUT_GIGAWORDS, 2).encode(&mut pkt);
        RadiusAttribute::u32(attr_type::ACCT_OUTPUT_GIGAWORDS, 5).encode(&mut pkt);
        RadiusAttribute::u32(attr_type::ACCT_SESSION_TIME, 7200).encode(&mut pkt);
        let total = pkt.len() as u16;
        pkt[2..4].copy_from_slice(&total.to_be_bytes());
        sign_accounting_request(&mut pkt, b"giga-secret-12");
        assert!(process_accounting_request(&db, &pkt, "127.0.0.1").await.is_some());

        // STOP at >2^32 total each direction, advancing past the interim totals:
        // input 6 GiGa + 5e9 low, output 5 GiGa + 3e9 low. Low 32-bit values are
        // reduced modulo 2^32 because RADIUS carries 32-bit counters.
        let mut stop = BytesMut::new();
        stop.put_u8(codes::ACCOUNTING_REQUEST);
        stop.put_u8(23);
        stop.put_u16(0);
        stop.extend_from_slice(&[0u8; 16]);
        RadiusAttribute::string(attr_type::USER_NAME, "giga-user").encode(&mut stop);
        RadiusAttribute::string(attr_type::ACCT_SESSION_ID, "sess-giga-001").encode(&mut stop);
        RadiusAttribute::u32(attr_type::ACCT_STATUS_TYPE, acct_status::STOP).encode(&mut stop);
        // Low 32 bits of the input counter: 5_000_000_000 mod 2^32 = 705_032_704.
        RadiusAttribute::u32(attr_type::ACCT_INPUT_OCTETS, 705_032_704).encode(&mut stop);
        RadiusAttribute::u32(attr_type::ACCT_OUTPUT_OCTETS, 3_000_000_000).encode(&mut stop);
        RadiusAttribute::u32(attr_type::ACCT_INPUT_GIGAWORDS, 6).encode(&mut stop);
        RadiusAttribute::u32(attr_type::ACCT_OUTPUT_GIGAWORDS, 5).encode(&mut stop);
        RadiusAttribute::u32(attr_type::ACCT_SESSION_TIME, 9000).encode(&mut stop);
        let total = stop.len() as u16;
        stop[2..4].copy_from_slice(&total.to_be_bytes());
        sign_accounting_request(&mut stop, b"giga-secret-12");
        assert!(process_accounting_request(&db, &stop, "127.0.0.1").await.is_some());

        let sessions = db.list_sessions().await.unwrap();
        assert_eq!(sessions.len(), 1);
        let sess = &sessions[0];
        // 6 * 2^32 + 5e9 low bits (the low u32 is 5_000_000_000 mod 2^32 = 705_032_704).
        let expected_input = 6i64 * (1i64 << 32) + 705_032_704i64;
        assert_eq!(sess.acct_input_octets64, expected_input);
        assert_eq!(sess.acct_output_octets64, 5i64 * (1i64 << 32) + 3_000_000_000i64);
        assert_eq!(sess.status, "closed");
    }

    #[tokio::test]
    async fn quota_consumes_gigaword_normalized_counters() {
        let (_dir, db) = test_db().await;
        db.upsert_subscriber(&UpsertSubscriberRequest {
            username: "giga-quota".to_string(),
            password: "pass".to_string(),
            connection_type: Some("pppoe".to_string()),
            framed_ip: Some("100.64.7.2".to_string()),
            download_kbps: Some(1024),
            upload_kbps: Some(1024),
            status: Some("active".to_string()),
        })
        .await
        .unwrap();
        sqlx::query("UPDATE subscribers SET quota_bytes = 10000000000 WHERE username = 'giga-quota'")
            .execute(db.pool())
            .await
            .unwrap();

        // Interim with 1 GiGa wrap in each direction + 100MB low bits each.
        db.record_accounting(
            "sess-giga-quota",
            "giga-quota",
            "127.0.0.1",
            None,
            Some("100.64.7.2".to_string()),
            None,
            acct_status::INTERIM_UPDATE,
            combine_gigawords(100_000_000, Some(1)),
            combine_gigawords(100_000_000, Some(1)),
            600,
            None,
        )
        .await
        .unwrap();
        db.accumulate_quota_usage("giga-quota").await.unwrap();

        let usage: i64 =
            sqlx::query_scalar("SELECT quota_used_bytes FROM subscribers WHERE username = 'giga-quota'")
                .fetch_one(db.pool())
                .await
                .unwrap();
        // Must include the wrapped high bits: (2^32 + 1e8) * 2, not 2e8.
        assert_eq!(usage, 2i64 * ((1i64 << 32) + 100_000_000));
    }

    #[tokio::test]
    async fn stale_and_duplicate_interim_do_not_regress_counters() {
        let (_dir, db) = test_db().await;
        let session = "sess-ordering-001";
        let user = "ordering-user";

        // A newer interim advances both directions and session time.
        db.record_accounting(
            session,
            user,
            "127.0.0.1",
            None,
            None,
            None,
            acct_status::INTERIM_UPDATE,
            5_000_000_000,
            3_000_000_000,
            3600,
            None,
        )
        .await
        .unwrap();

        // A replayed older interim, then an exact duplicate, must be no-ops.
        for (input, output, time) in [(1_000_000_000i64, 500_000_000i64, 1200i64), (5_000_000_000, 3_000_000_000, 3600)] {
            db.record_accounting(
                session,
                user,
                "127.0.0.1",
                None,
                None,
                None,
                acct_status::INTERIM_UPDATE,
                input,
                output,
                time,
                None,
            )
            .await
            .unwrap();
        }

        let rows = db.list_sessions().await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].acct_input_octets64, 5_000_000_000);
        assert_eq!(rows[0].acct_output_octets64, 3_000_000_000);
        assert_eq!(rows[0].acct_session_time, 3600);
    }

    #[tokio::test]
    async fn nas_reboot_with_new_session_id_keeps_separate_counter_history() {
        let (_dir, db) = test_db().await;
        let user = "reboot-user";
        db.record_accounting(
            "sess-before-reboot",
            user,
            "127.0.0.1",
            None,
            None,
            None,
            acct_status::INTERIM_UPDATE,
            9_000_000_000,
            9_000_000_000,
            5000,
            None,
        )
        .await
        .unwrap();
        // Counters restart near zero after a NAS reboot; a new Acct-Session-Id
        // represents a new session and must not be clamped to the old totals.
        db.record_accounting(
            "sess-after-reboot",
            user,
            "127.0.0.1",
            None,
            None,
            None,
            acct_status::INTERIM_UPDATE,
            100,
            200,
            10,
            None,
        )
        .await
        .unwrap();

        let rows = db.list_sessions().await.unwrap();
        assert_eq!(rows.len(), 2);
        let fresh = rows
            .iter()
            .find(|row| row.session_id == "sess-after-reboot")
            .expect("new session row exists");
        assert_eq!(fresh.acct_input_octets64, 100);
        assert_eq!(fresh.acct_output_octets64, 200);
    }
}
