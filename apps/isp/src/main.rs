use anyhow::Result;
use clap::Parser;
use std::net::{SocketAddr};
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

    // Load configuration
    let _config = load_config().await?;
    info!("Configuration loaded");

    // Initialize SQLite database (completely separate from main moonwitness PostgreSQL DB)
    let db = Database::new(&cli.db_path).await?;
    db.migrate().await?;
    info!("SQLite database initialized at {}", cli.db_path);

    // Start RADIUS authentication server (port 1812)
    let radius_addr: SocketAddr = cli.radius_addr.parse()?;
    let radius_db = db.clone();
    let radius_handle = tokio::spawn(async move {
        run_radius_server(radius_addr, radius_db).await
    });

    // Start RADIUS accounting server (port 1813)
    let acct_addr: SocketAddr = cli.acct_addr.parse()?;
    let acct_db = db.clone();
    let acct_handle = tokio::spawn(async move {
        run_acct_server(acct_addr, acct_db).await
    });

    // Start HTTP admin API (port 3000)
    let http_addr: SocketAddr = cli.http_addr.parse()?;
    let http_db = db.clone();
    let http_handle = tokio::spawn(async move {
        run_http_server(http_addr, http_db).await
    });

    info!("MoonWitness ISP server started");
    info!("  RADIUS auth: {}", cli.radius_addr);
    info!("  RADIUS acct: {}", cli.acct_addr);
    info!("  HTTP admin: {}", cli.http_addr);

    // Wait for shutdown signal
    signal::ctrl_c().await?;
    info!("Shutdown signal received, stopping servers...");

    radius_handle.abort();
    acct_handle.abort();
    http_handle.abort();

    Ok(())
}

async fn load_config() -> Result<Config> {
    let mut builder = config::Config::builder();
    builder = builder
        .set_default("db_path", "isp.db")?
        .set_default("radius_secret", "testing123")?
        .set_default("admin_token", "moonwitness-isp-admin")?;

    builder = builder.add_source(config::File::with_name("config").required(false));
    builder = builder.add_source(config::Environment::with_prefix("MW_ISP").separator("_"));

    Ok(builder.build()?.try_deserialize()?)
}

#[derive(Debug, Clone, serde::Deserialize)]
struct Config {
    db_path: String,
    radius_secret: String,
    admin_token: String,
}

#[derive(Clone)]
struct Database {
    pool: sqlx::SqlitePool,
}

impl Database {
    async fn new(path: &str) -> Result<Self> {
        let url = format!("sqlite:{}", path);
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(5)
            .connect(&url)
            .await?;
        Ok(Self { pool })
    }

    async fn migrate(&self) -> Result<()> {
        sqlx::migrate!("./migrations").run(&self.pool).await?;
        Ok(())
    }

    async fn get_clients(&self) -> Result<Vec<NasClient>> {
        let rows = sqlx::query_as(
            "SELECT id, name, ip_address, secret, enabled, created_at FROM nas_clients ORDER BY created_at DESC"
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn create_client(&self, name: &str, ip_address: &str, secret: &str) -> Result<NasClient> {
        let row = sqlx::query_as(
            "INSERT INTO nas_clients (name, ip_address, secret, enabled) VALUES (?1, ?2, ?3, 1) RETURNING id, name, ip_address, secret, enabled, created_at"
        )
        .bind(name)
        .bind(ip_address)
        .bind(secret)
        .fetch_one(&self.pool)
        .await?;
        Ok(row)
    }

    async fn find_client(&self, ip_address: &str) -> Result<Option<NasClient>> {
        let row = sqlx::query_as(
            "SELECT id, name, ip_address, secret, enabled, created_at FROM nas_clients WHERE ip_address = ?1 AND enabled = 1"
        )
        .bind(ip_address)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    async fn log_auth(&self, client_id: i64, username: &str, success: bool, nas_ip: Option<&str>, reply: &str) -> Result<()> {
        sqlx::query(
            "INSERT INTO radius_auth_log (client_id, username, nas_ip, success, reply_message, created_at) VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))"
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
}

#[derive(sqlx::FromRow, serde::Serialize, Debug)]
struct NasClient {
    id: i64,
    name: String,
    ip_address: String,
    secret: String,
    enabled: bool,
    created_at: String,
}

#[derive(serde::Deserialize)]
struct CreateClientRequest {
    name: String,
    ip_address: String,
    secret: String,
}

#[derive(serde::Serialize)]
struct AuthStats {
    total_clients: i64,
    enabled_clients: i64,
}

async fn run_radius_server(addr: SocketAddr, db: Database) -> Result<()> {
    let socket = std::net::UdpSocket::bind(addr)?;
    socket.set_nonblocking(true)?;
    info!("RADIUS auth server listening on {}", addr);

    let mut buf = [0u8; 4096];
    let radius_secret = db.get_radius_secret().await.unwrap_or_else(|_| "testing123".to_string());

    loop {
        match socket.recv_from(&mut buf) {
            Ok((len, src)) => {
                let request_bytes = &buf[..len];
                info!("Received {} bytes from {}", len, src);

                // Minimal RADIUS packet decode
                if let Some((code, identifier)) = decode_radius_header(request_bytes) {
                    if code == 1 {
                        // Access-Request (Code=1)
                        let username = extract_username(request_bytes);
                        let src_ip = src.ip().to_string();

                        // Find NAS client by source IP
                        let client = db.find_client(&src_ip).await;

                        let (success, reply_msg) = match client {
                            Ok(Some(c)) => {
                                let secret_match = c.secret == radius_secret;
                                if secret_match {
                                    (true, "Access-Accept".to_string())
                                } else {
                                    (false, "Access-Reject: Invalid secret".to_string())
                                }
                            }
                            Ok(None) => (false, "Access-Reject: Unknown client".to_string()),
                            Err(e) => {
                                warn!("DB error looking up client: {}", e);
                                (false, "Access-Reject: DB error".to_string())
                            }
                        };

                        // Log auth attempt
                        if let Ok(Some(c)) = db.find_client(&src_ip).await {
                            let _ = db.log_auth(c.id, &username, success, Some(&src_ip), &reply_msg).await;
                        }

                        // Build response: Code=2 (Accept) or Code=3 (Reject)
                        let mut response = Vec::with_capacity(20);
                        response.push(if success { 2 } else { 3 }); // Access-Accept / Access-Reject
                        response.push(identifier);
                        response.extend_from_slice(&20u16.to_be_bytes()); // Length
                        response.extend_from_slice(&[0u8; 16]); // Authenticator

                        let _ = socket.send_to(&response, src);
                        info!("RADIUS auth: user={} success={} from={}", username, success, src_ip);
                    } else {
                        // Unknown code, send reject
                        let mut response = Vec::with_capacity(20);
                        response.push(3); // Access-Reject
                        response.push(code);
                        response.extend_from_slice(&20u16.to_be_bytes());
                        response.extend_from_slice(&[0u8; 16]);
                        let _ = socket.send_to(&response, src);
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
            Err(e) => {
                warn!("RADIUS socket error: {}", e);
            }
        }
    }
}

async fn run_acct_server(addr: SocketAddr, _db: Database) -> Result<()> {
    let socket = std::net::UdpSocket::bind(addr)?;
    socket.set_nonblocking(true)?;
    info!("RADIUS accounting server listening on {}", addr);

    let mut buf = [0u8; 4096];
    loop {
        match socket.recv_from(&mut buf) {
            Ok((len, src)) => {
                info!("Received {} accounting bytes from {}", len, src);
                // Accounting-Request (Code=4) -> Accounting-Response (Code=5)
                if let Some((_, identifier)) = decode_radius_header(&buf[..len]) {
                    let mut response = Vec::with_capacity(20);
                    response.push(5); // Accounting-Response
                    response.push(identifier);
                    response.extend_from_slice(&20u16.to_be_bytes());
                    response.extend_from_slice(&[0u8; 16]);
                    let _ = socket.send_to(&response, src);
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
            Err(e) => {
                warn!("RADIUS acct socket error: {}", e);
            }
        }
    }
}

async fn run_http_server(addr: SocketAddr, db: Database) -> Result<()> {
    use axum::{routing::{get}, Router, Json};

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/clients", get(list_clients).post(create_client))
        .route("/api/stats", get(get_stats))
        .with_state(db.clone());

    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!("HTTP admin API listening on {}", addr);
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({"status": "ok"}))
}

async fn list_clients(
    axum::extract::State(db): axum::extract::State<Database>,
) -> Result<Json<Vec<NasClient>>, axum::http::StatusCode> {
    let clients = db.get_clients().await
        .map_err(|_| axum::http::StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(clients))
}

async fn create_client(
    axum::extract::State(db): axum::extract::State<Database>,
    Json(payload): Json<CreateClientRequest>,
) -> Result<Json<NasClient>, axum::http::StatusCode> {
    let client = db.create_client(&payload.name, &payload.ip_address, &payload.secret).await
        .map_err(|_| axum::http::StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(client))
}

async fn get_stats(
    axum::extract::State(db): axum::extract::State<Database>,
) -> Result<Json<AuthStats>, axum::http::StatusCode> {
    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM nas_clients")
        .fetch_one(&db.pool)
        .await
        .unwrap_or(0);
    let enabled: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM nas_clients WHERE enabled = 1")
        .fetch_one(&db.pool)
        .await
        .unwrap_or(0);

    Ok(Json(AuthStats {
        total_clients: total,
        enabled_clients: enabled,
    }))
}

// Minimal RADIUS packet header decoding
fn decode_radius_header(data: &[u8]) -> Option<(u8, u8)> {
    if data.len() < 2 {
        return None;
    }
    Some((data[0], data[1]))
}

fn extract_username(data: &[u8]) -> String {
    // Attribute Type 1 = User-Name
    let mut i = 20; // Skip header
    while i + 2 <= data.len() {
        let attr_type = data[i];
        let attr_len = data[i + 1] as usize;
        if attr_len < 2 || i + attr_len > data.len() {
            break;
        }
        if attr_type == 1 {
            return String::from_utf8_lossy(&data[i + 2..i + attr_len]).to_string();
        }
        i += attr_len;
    }
    "unknown".to_string()
}

impl Database {
    async fn get_radius_secret(&self) -> Result<String> {
        Ok("testing123".to_string())
    }
}

use axum::Json;