mod radius_protocol;

use anyhow::Result;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use clap::Parser;
use radius_protocol::{
    acct_status, attr_type, codes, constant_time_eq, decode_packet, decrypt_pap_password,
    encode_response, verify_accounting_authenticator, verify_chap_password, RadiusAttribute,
};
use std::net::{Ipv4Addr, SocketAddr};
use std::str::FromStr;
use tokio::net::UdpSocket;
use tokio::signal;
use tracing::{info, warn};

#[derive(Parser, Debug)]
#[command(name = "moonwitness-isp", version, about = "MoonWitness ISP & RADIUS Server")]
struct Cli {
    #[arg(long, default_value = "0.0.0.0:1812")]
    radius_addr: String,
    #[arg(long, default_value = "0.0.0.0:1813")]
    acct_addr: String,
    #[arg(long, default_value = "0.0.0.0:3000")]
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
    let http_handle = tokio::spawn(async move { run_http_server(http_addr, http_db).await });

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
    let mut builder = config::Config::builder()
        .set_default("db_path", cli_db_path)?
        .set_default("admin_token", "moonwitness-isp-admin")?;
    builder = builder.add_source(config::File::with_name("config").required(false));
    builder = builder.add_source(config::Environment::with_prefix("MW_ISP").separator("_"));
    Ok(builder.build()?.try_deserialize()?)
}

#[derive(Debug, Clone, serde::Deserialize)]
struct Config {
    db_path: String,
    #[allow(dead_code)]
    admin_token: String,
}

#[derive(Clone)]
struct Database {
    pool: sqlx::SqlitePool,
}

impl Database {
    async fn new(path: &str) -> Result<Self> {
        let options = sqlx::sqlite::SqliteConnectOptions::from_str(&format!("sqlite:{}", path))?
            .create_if_missing(true);
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;
        Ok(Self { pool })
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
        }
        Ok(client)
    }

    async fn find_subscriber(&self, username: &str) -> Result<Option<SubscriberRow>> {
        let row = sqlx::query_as(
            "SELECT id, username, password, connection_type, framed_ip, download_kbps, upload_kbps, status
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
            acct_status::INTERIM_UPDATE => {
                sqlx::query(
                    "INSERT INTO radius_sessions (session_id, username, nas_ip, nas_port, framed_ip, calling_station_id, acct_input_octets, acct_output_octets, acct_session_time, status)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'active')
                     ON CONFLICT(session_id) DO UPDATE SET
                       acct_input_octets = excluded.acct_input_octets,
                       acct_output_octets = excluded.acct_output_octets,
                       acct_session_time = excluded.acct_session_time,
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
                    "INSERT INTO radius_sessions (session_id, username, nas_ip, nas_port, framed_ip, calling_station_id, acct_input_octets, acct_output_octets, acct_session_time, status, terminate_cause, stopped_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'closed', ?10, datetime('now'))
                     ON CONFLICT(session_id) DO UPDATE SET
                       acct_input_octets = excluded.acct_input_octets,
                       acct_output_octets = excluded.acct_output_octets,
                       acct_session_time = excluded.acct_session_time,
                       status = 'closed',
                       terminate_cause = excluded.terminate_cause,
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
                    acct_input_octets, acct_output_octets, acct_session_time, status, terminate_cause,
                    started_at, updated_at, stopped_at
             FROM radius_sessions ORDER BY id DESC LIMIT 100",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
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
        _ => return None,
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
    let input_octets = packet
        .attribute(attr_type::ACCT_INPUT_OCTETS)
        .and_then(RadiusAttribute::as_u32)
        .unwrap_or(0) as i64;
    let output_octets = packet
        .attribute(attr_type::ACCT_OUTPUT_OCTETS)
        .and_then(RadiusAttribute::as_u32)
        .unwrap_or(0) as i64;
    let session_time = packet
        .attribute(attr_type::ACCT_SESSION_TIME)
        .and_then(RadiusAttribute::as_u32)
        .unwrap_or(0) as i64;
    let terminate_cause = packet
        .attribute(attr_type::ACCT_TERMINATE_CAUSE)
        .and_then(RadiusAttribute::as_u32)
        .map(|v| v as i64);

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
        warn!("Failed to record RADIUS accounting session {}: {}", session_id, err);
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

async fn run_http_server(addr: SocketAddr, db: Database) -> Result<()> {
    let app = Router::new()
        .route("/health", get(health))
        .route("/api/clients", get(list_clients).post(create_client))
        .route("/api/clients/{ip}/rotate-secret", post(rotate_secret))
        .route("/api/subscribers", get(list_subscribers).post(upsert_subscriber))
        .route("/api/subscribers/{username}/suspend", post(suspend_subscriber))
        .route("/api/sessions", get(list_sessions))
        .route("/api/stats", get(get_stats))
        .with_state(db);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!("HTTP admin API listening on {}", addr);
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({"status": "ok"}))
}

async fn list_clients(State(db): State<Database>) -> Result<Json<Vec<NasClient>>, StatusCode> {
    let clients = db
        .get_clients()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(clients))
}

async fn create_client(
    State(db): State<Database>,
    Json(payload): Json<CreateClientRequest>,
) -> Result<Json<NasClient>, StatusCode> {
    let client = db
        .upsert_client(&payload.name, &payload.ip_address, &payload.secret)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(client))
}

async fn rotate_secret(
    State(db): State<Database>,
    Path(ip): Path<String>,
    Json(payload): Json<RotateSecretRequest>,
) -> Result<Json<NasClient>, StatusCode> {
    if payload.secret.len() < 12 {
        return Err(StatusCode::BAD_REQUEST);
    }
    let client = db
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
    State(db): State<Database>,
) -> Result<Json<Vec<SubscriberSummary>>, StatusCode> {
    let rows = db
        .list_subscribers()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(rows))
}

async fn upsert_subscriber(
    State(db): State<Database>,
    Json(payload): Json<UpsertSubscriberRequest>,
) -> Result<Json<SubscriberSummary>, StatusCode> {
    let sub = db
        .upsert_subscriber(&payload)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(sub))
}

async fn suspend_subscriber(
    State(db): State<Database>,
    Path(username): Path<String>,
) -> Result<Json<SubscriberSummary>, StatusCode> {
    let sub = db
        .update_subscriber_status(&username, "suspended")
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(sub))
}

async fn list_sessions(
    State(db): State<Database>,
) -> Result<Json<Vec<RadiusSessionRow>>, StatusCode> {
    let rows = db
        .list_sessions()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(rows))
}

async fn get_stats(State(db): State<Database>) -> Result<Json<AuthStats>, StatusCode> {
    let total_clients: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM nas_clients")
        .fetch_one(&db.pool)
        .await
        .unwrap_or(0);
    let enabled_clients: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM nas_clients WHERE enabled = 1")
            .fetch_one(&db.pool)
            .await
            .unwrap_or(0);
    let total_subscribers: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM subscribers")
        .fetch_one(&db.pool)
        .await
        .unwrap_or(0);
    let active_sessions: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM radius_sessions WHERE status = 'active'")
            .fetch_one(&db.pool)
            .await
            .unwrap_or(0);

    Ok(Json(AuthStats {
        total_clients,
        enabled_clients,
        total_subscribers,
        active_sessions,
    }))
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
}
