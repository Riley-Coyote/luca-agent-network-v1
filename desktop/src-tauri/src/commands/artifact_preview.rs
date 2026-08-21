use std::{
    collections::HashMap,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs},
    sync::{Mutex, OnceLock},
    time::Duration,
};

use axum::{
    body::{to_bytes, Body},
    extract::{ws::WebSocketUpgrade, FromRequestParts, Request, State as AxumState},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Router,
};
use chrono::{SecondsFormat, Utc};
use futures_util::{SinkExt, StreamExt, TryStreamExt};
use luca_protocol::{ArtifactBrokerBindingV1, OpaqueId};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::{client_async, tungstenite};
use tokio_util::sync::CancellationToken;
use url::{Host, Url};

use crate::app_state::AppState;

const MAX_PREVIEW_SESSIONS: usize = 32;
const MAX_PROXY_REQUEST_BYTES: usize = 16 * 1024 * 1024;
const PREVIEW_HEALTH_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
/// Current reachability of an attached loopback application.
pub enum ArtifactPreviewStatus {
    /// The proxy is available and the first health result is pending.
    Starting,
    /// The pinned loopback server answered a health request.
    Ready,
    /// The pinned loopback server did not answer the last health request.
    Unreachable,
    /// Presentation was explicitly detached and its proxy has stopped.
    Stopped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
/// Bounded, body-free live-preview metadata returned to the desktop UI.
pub struct ArtifactPreviewSession {
    /// Ephemeral session identity.
    pub id: String,
    /// Durable application artifact presented by this session.
    pub artifact_id: String,
    /// Verified loopback URL supplied by the resident.
    pub display_url: String,
    /// Luca-owned loopback proxy URL used only by the Canvas frame.
    pub proxy_url: String,
    /// Current health state.
    pub status: ArtifactPreviewStatus,
    /// Conversation whose active turn attached the server.
    pub conversation_id: String,
    /// Resident whose active turn attached the server.
    pub resident_pubkey: String,
    /// Exact managed turn that attached the server.
    pub turn_id: String,
    /// RFC 3339 attachment timestamp.
    pub attached_at: String,
    /// RFC 3339 timestamp of the latest state check.
    pub checked_at: String,
}

#[derive(Clone)]
struct PinnedLoopbackTarget {
    base_url: Url,
    socket_addr: SocketAddr,
    client: reqwest::Client,
}

#[derive(Clone)]
struct PreviewProxyState {
    target: PinnedLoopbackTarget,
    proxy_origin: String,
}

struct StoredPreviewSession {
    owner_pubkey: String,
    view: ArtifactPreviewSession,
    target: PinnedLoopbackTarget,
    cancel: CancellationToken,
}

static PREVIEW_SESSIONS: OnceLock<Mutex<HashMap<String, StoredPreviewSession>>> = OnceLock::new();

fn preview_sessions() -> &'static Mutex<HashMap<String, StoredPreviewSession>> {
    PREVIEW_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn current_owner(state: &AppState) -> Result<String, String> {
    state.signing_keys().map(|keys| keys.public_key().to_hex())
}

fn parse_loopback_url(value: &str) -> Result<(Url, SocketAddr), String> {
    let url = Url::parse(value).map_err(|_| "preview URL is malformed".to_string())?;
    if url.scheme() != "http" {
        return Err("preview URL must use http".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("preview URL must not contain credentials".to_string());
    }
    let port = url
        .port_or_known_default()
        .filter(|port| *port != 0)
        .ok_or_else(|| "preview URL port is invalid".to_string())?;
    let socket_addr = match url
        .host()
        .ok_or_else(|| "preview URL host is missing".to_string())?
    {
        Host::Ipv4(address) if address == Ipv4Addr::LOCALHOST => {
            SocketAddr::new(IpAddr::V4(address), port)
        }
        Host::Ipv6(address) if address == Ipv6Addr::LOCALHOST => {
            SocketAddr::new(IpAddr::V6(address), port)
        }
        Host::Domain(domain) if domain.eq_ignore_ascii_case("localhost") => {
            let resolved = (domain, port)
                .to_socket_addrs()
                .map_err(|_| "localhost could not be resolved".to_string())?
                .collect::<Vec<_>>();
            if resolved.is_empty() || resolved.iter().any(|address| !address.ip().is_loopback()) {
                return Err("localhost resolved outside loopback".to_string());
            }
            resolved
                .iter()
                .copied()
                .find(SocketAddr::is_ipv4)
                .or_else(|| resolved.first().copied())
                .ok_or_else(|| "localhost could not be resolved".to_string())?
        }
        _ => {
            return Err("preview URL must use localhost, 127.0.0.1, or [::1]".to_string());
        }
    };
    Ok((url, socket_addr))
}

fn pinned_client(url: &Url, socket_addr: SocketAddr) -> Result<reqwest::Client, String> {
    let host = url
        .host_str()
        .ok_or_else(|| "preview URL host is missing".to_string())?;
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .resolve(host, socket_addr)
        .build()
        .map_err(|_| "preview HTTP client is unavailable".to_string())
}

fn upstream_url(target: &PinnedLoopbackTarget, request: &Request) -> Result<Url, String> {
    let mut url = target.base_url.clone();
    url.set_path(request.uri().path());
    url.set_query(request.uri().query());
    url.set_fragment(None);
    Ok(url)
}

fn forwarded_request_headers(source: &HeaderMap, upstream_origin: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    for name in [
        header::ACCEPT,
        header::ACCEPT_LANGUAGE,
        header::CACHE_CONTROL,
        header::CONTENT_TYPE,
        header::IF_MODIFIED_SINCE,
        header::IF_NONE_MATCH,
        header::RANGE,
        header::USER_AGENT,
        header::COOKIE,
    ] {
        if let Some(value) = source.get(&name) {
            headers.insert(name, value.clone());
        }
    }
    if let Ok(value) = HeaderValue::from_str(upstream_origin) {
        headers.insert(header::ORIGIN, value.clone());
        headers.insert(header::REFERER, value);
    }
    headers
}

fn same_origin(left: &Url, right: &Url) -> bool {
    left.scheme() == right.scheme()
        && left.host_str().map(str::to_ascii_lowercase)
            == right.host_str().map(str::to_ascii_lowercase)
        && left.port_or_known_default() == right.port_or_known_default()
}

fn rewrite_location(value: &HeaderValue, state: &PreviewProxyState) -> Option<HeaderValue> {
    let raw = value.to_str().ok()?;
    let resolved = state.target.base_url.join(raw).ok()?;
    if !same_origin(&resolved, &state.target.base_url) {
        return None;
    }
    let mut rewritten = Url::parse(&state.proxy_origin).ok()?;
    rewritten.set_path(resolved.path());
    rewritten.set_query(resolved.query());
    rewritten.set_fragment(resolved.fragment());
    HeaderValue::from_str(rewritten.as_str()).ok()
}

fn response_security_headers(headers: &mut HeaderMap, proxy_origin: &str) {
    let websocket_origin = proxy_origin.replacen("http://", "ws://", 1);
    let policy = format!(
        "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self' {websocket_origin}; worker-src 'self' blob:; child-src 'self' blob:; frame-src 'self' data: blob:; object-src 'none'; base-uri 'self'; form-action 'self'; navigate-to 'self'; frame-ancestors tauri://localhost http://tauri.localhost"
    );
    if let Ok(policy) = HeaderValue::from_str(&policy) {
        headers.insert(header::CONTENT_SECURITY_POLICY, policy);
    }
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
}

async fn proxy_http(state: PreviewProxyState, request: Request) -> Response {
    let upstream = match upstream_url(&state.target, &request) {
        Ok(url) => url,
        Err(message) => return (StatusCode::BAD_REQUEST, message).into_response(),
    };
    let method = request.method().clone();
    let upstream_origin = state.target.base_url.origin().ascii_serialization();
    let headers = forwarded_request_headers(request.headers(), &upstream_origin);
    let body = match to_bytes(request.into_body(), MAX_PROXY_REQUEST_BYTES).await {
        Ok(bytes) => bytes,
        Err(_) => {
            return (
                StatusCode::PAYLOAD_TOO_LARGE,
                "preview request is too large",
            )
                .into_response()
        }
    };
    let response = match state
        .target
        .client
        .request(method, upstream)
        .headers(headers)
        .body(body)
        .timeout(Duration::from_secs(120))
        .send()
        .await
    {
        Ok(response) => response,
        Err(_) => {
            return (StatusCode::BAD_GATEWAY, "preview server is unreachable").into_response()
        }
    };
    let status = StatusCode::from_u16(response.status().as_u16())
        .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let mut headers = HeaderMap::new();
    for name in [
        header::CONTENT_TYPE,
        header::CACHE_CONTROL,
        header::ETAG,
        header::LAST_MODIFIED,
        header::CONTENT_RANGE,
        header::ACCEPT_RANGES,
        header::SET_COOKIE,
    ] {
        if let Some(value) = response.headers().get(&name) {
            headers.insert(name, value.clone());
        }
    }
    if let Some(location) = response.headers().get(header::LOCATION) {
        let Some(location) = rewrite_location(location, &state) else {
            return (StatusCode::FORBIDDEN, "preview redirect left loopback").into_response();
        };
        headers.insert(header::LOCATION, location);
    }
    response_security_headers(&mut headers, &state.proxy_origin);
    let stream = response.bytes_stream().map_err(std::io::Error::other);
    (status, headers, Body::from_stream(stream)).into_response()
}

fn websocket_request(
    state: &PreviewProxyState,
    request: &Request,
) -> Result<tungstenite::http::Request<()>, String> {
    let mut url = upstream_url(&state.target, request)?;
    url.set_scheme("ws")
        .map_err(|_| "preview WebSocket URL is invalid".to_string())?;
    let authority = state
        .target
        .base_url
        .host_str()
        .map(|host| match state.target.base_url.port() {
            Some(port) => format!("{host}:{port}"),
            None => host.to_string(),
        })
        .ok_or_else(|| "preview WebSocket host is missing".to_string())?;
    let key = request
        .headers()
        .get(header::SEC_WEBSOCKET_KEY)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "preview WebSocket key is missing".to_string())?;
    let upstream_origin = state.target.base_url.origin().ascii_serialization();
    let mut builder = tungstenite::http::Request::builder()
        .method("GET")
        .uri(url.as_str())
        .header(header::HOST.as_str(), authority)
        .header(header::ORIGIN.as_str(), upstream_origin)
        .header(header::CONNECTION.as_str(), "Upgrade")
        .header(header::UPGRADE.as_str(), "websocket")
        .header(header::SEC_WEBSOCKET_VERSION.as_str(), "13")
        .header(header::SEC_WEBSOCKET_KEY.as_str(), key);
    if let Some(protocol) = request.headers().get(header::SEC_WEBSOCKET_PROTOCOL) {
        if let Ok(protocol) = protocol.to_str() {
            builder = builder.header(header::SEC_WEBSOCKET_PROTOCOL.as_str(), protocol);
        }
    }
    builder
        .body(())
        .map_err(|_| "preview WebSocket request is invalid".to_string())
}

fn to_upstream_message(message: axum::extract::ws::Message) -> tungstenite::Message {
    match message {
        axum::extract::ws::Message::Text(value) => {
            tungstenite::Message::Text(value.to_string().into())
        }
        axum::extract::ws::Message::Binary(value) => tungstenite::Message::Binary(value),
        axum::extract::ws::Message::Ping(value) => tungstenite::Message::Ping(value),
        axum::extract::ws::Message::Pong(value) => tungstenite::Message::Pong(value),
        axum::extract::ws::Message::Close(frame) => {
            tungstenite::Message::Close(frame.map(|frame| tungstenite::protocol::CloseFrame {
                code: tungstenite::protocol::frame::coding::CloseCode::from(frame.code),
                reason: frame.reason.to_string().into(),
            }))
        }
    }
}

fn to_canvas_message(message: tungstenite::Message) -> Option<axum::extract::ws::Message> {
    match message {
        tungstenite::Message::Text(value) => {
            Some(axum::extract::ws::Message::Text(value.to_string().into()))
        }
        tungstenite::Message::Binary(value) => Some(axum::extract::ws::Message::Binary(value)),
        tungstenite::Message::Ping(value) => Some(axum::extract::ws::Message::Ping(value)),
        tungstenite::Message::Pong(value) => Some(axum::extract::ws::Message::Pong(value)),
        tungstenite::Message::Close(frame) => {
            Some(axum::extract::ws::Message::Close(frame.map(|frame| {
                axum::extract::ws::CloseFrame {
                    code: u16::from(frame.code),
                    reason: frame.reason.to_string().into(),
                }
            })))
        }
        tungstenite::Message::Frame(_) => None,
    }
}

async fn bridge_websocket(
    canvas: axum::extract::ws::WebSocket,
    state: PreviewProxyState,
    request: Request,
) {
    let Ok(upstream_request) = websocket_request(&state, &request) else {
        return;
    };
    let Ok(stream) = TcpStream::connect(state.target.socket_addr).await else {
        return;
    };
    let Ok((upstream, _)) = client_async(upstream_request, stream).await else {
        return;
    };
    let (mut canvas_tx, mut canvas_rx) = canvas.split();
    let (mut upstream_tx, mut upstream_rx) = upstream.split();
    let canvas_to_upstream = async {
        while let Some(Ok(message)) = canvas_rx.next().await {
            if upstream_tx
                .send(to_upstream_message(message))
                .await
                .is_err()
            {
                break;
            }
        }
    };
    let upstream_to_canvas = async {
        while let Some(Ok(message)) = upstream_rx.next().await {
            let Some(message) = to_canvas_message(message) else {
                continue;
            };
            if canvas_tx.send(message).await.is_err() {
                break;
            }
        }
    };
    tokio::select! {
        _ = canvas_to_upstream => {},
        _ = upstream_to_canvas => {},
    }
}

async fn preview_proxy_handler(
    AxumState(state): AxumState<PreviewProxyState>,
    request: Request,
) -> Response {
    let is_websocket = request
        .headers()
        .get(header::UPGRADE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case("websocket"));
    if is_websocket {
        let (mut parts, body) = request.into_parts();
        let Ok(upgrade) = WebSocketUpgrade::from_request_parts(&mut parts, &state).await else {
            return (
                StatusCode::BAD_REQUEST,
                "preview WebSocket upgrade is invalid",
            )
                .into_response();
        };
        let request = Request::from_parts(parts, body);
        let bridge_state = state.clone();
        return upgrade
            .on_upgrade(move |socket| bridge_websocket(socket, bridge_state, request))
            .into_response();
    }
    proxy_http(state, request).await
}

async fn spawn_preview_proxy(
    target: PinnedLoopbackTarget,
) -> Result<(u16, CancellationToken), String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|_| "preview proxy could not bind loopback".to_string())?;
    let port = listener
        .local_addr()
        .map_err(|_| "preview proxy address is unavailable".to_string())?
        .port();
    let cancel = CancellationToken::new();
    let state = PreviewProxyState {
        target,
        proxy_origin: format!("http://127.0.0.1:{port}"),
    };
    let app = Router::new()
        .fallback(preview_proxy_handler)
        .with_state(state);
    let shutdown = cancel.clone();
    tauri::async_runtime::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(shutdown.cancelled_owned())
            .await;
    });
    Ok((port, cancel))
}

fn proxy_url(port: u16, display_url: &Url) -> String {
    let mut value = format!("http://127.0.0.1:{port}{}", display_url.path());
    if let Some(query) = display_url.query() {
        value.push('?');
        value.push_str(query);
    }
    if let Some(fragment) = display_url.fragment() {
        value.push('#');
        value.push_str(fragment);
    }
    value
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewStateEvent<'a> {
    preview_session_id: &'a str,
    artifact_id: &'a str,
    conversation_id: &'a str,
    status: ArtifactPreviewStatus,
    checked_at: &'a str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CanvasPresentEvent<'a> {
    artifact_id: &'a str,
    version: Option<u64>,
    preview_session_id: Option<&'a str>,
    conversation_id: &'a str,
    resident_pubkey: Option<&'a str>,
    turn_id: Option<&'a str>,
}

fn emit_preview_state(app: &AppHandle, view: &ArtifactPreviewSession) {
    let _ = app.emit(
        "luca://preview-state",
        PreviewStateEvent {
            preview_session_id: &view.id,
            artifact_id: &view.artifact_id,
            conversation_id: &view.conversation_id,
            status: view.status,
            checked_at: &view.checked_at,
        },
    );
}

fn emit_canvas_present(app: &AppHandle, view: &ArtifactPreviewSession) {
    let _ = app.emit(
        "luca://canvas-present",
        CanvasPresentEvent {
            artifact_id: &view.artifact_id,
            version: None,
            preview_session_id: Some(&view.id),
            conversation_id: &view.conversation_id,
            resident_pubkey: Some(&view.resident_pubkey),
            turn_id: Some(&view.turn_id),
        },
    );
}

fn session_for_owner(
    owner_pubkey: &str,
    session_id: &str,
) -> Result<ArtifactPreviewSession, String> {
    let sessions = preview_sessions()
        .lock()
        .map_err(|_| "preview session state is unavailable".to_string())?;
    let session = sessions
        .get(session_id)
        .ok_or_else(|| "preview session was not found".to_string())?;
    if session.owner_pubkey != owner_pubkey {
        return Err("preview session was not found".to_string());
    }
    Ok(session.view.clone())
}

async fn update_preview_health(
    app: &AppHandle,
    owner_pubkey: &str,
    session_id: &str,
) -> Result<ArtifactPreviewSession, String> {
    let (target, stopped) = {
        let sessions = preview_sessions()
            .lock()
            .map_err(|_| "preview session state is unavailable".to_string())?;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| "preview session was not found".to_string())?;
        if session.owner_pubkey != owner_pubkey {
            return Err("preview session was not found".to_string());
        }
        (
            session.target.clone(),
            session.view.status == ArtifactPreviewStatus::Stopped,
        )
    };
    let status = if stopped {
        ArtifactPreviewStatus::Stopped
    } else {
        match target
            .client
            .get(target.base_url.clone())
            .timeout(PREVIEW_HEALTH_TIMEOUT)
            .send()
            .await
        {
            Ok(_) => ArtifactPreviewStatus::Ready,
            Err(_) => ArtifactPreviewStatus::Unreachable,
        }
    };
    let view = {
        let mut sessions = preview_sessions()
            .lock()
            .map_err(|_| "preview session state is unavailable".to_string())?;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| "preview session was not found".to_string())?;
        if session.owner_pubkey != owner_pubkey {
            return Err("preview session was not found".to_string());
        }
        session.view.status = status;
        session.view.checked_at = now();
        session.view.clone()
    };
    emit_preview_state(app, &view);
    Ok(view)
}

/// Attach a host-validated exact managed turn to a pinned loopback proxy.
pub(crate) async fn attach_preview_session(
    app: &AppHandle,
    binding: &ArtifactBrokerBindingV1,
    artifact_id: &OpaqueId,
    value: &str,
) -> Result<ArtifactPreviewSession, String> {
    let (display_url, socket_addr) = parse_loopback_url(value)?;
    let target = PinnedLoopbackTarget {
        client: pinned_client(&display_url, socket_addr)?,
        base_url: display_url.clone(),
        socket_addr,
    };
    let (port, cancel) = spawn_preview_proxy(target.clone()).await?;
    let timestamp = now();
    let view = ArtifactPreviewSession {
        id: uuid::Uuid::new_v4().to_string(),
        artifact_id: artifact_id.as_str().to_string(),
        display_url: display_url.to_string(),
        proxy_url: proxy_url(port, &display_url),
        status: ArtifactPreviewStatus::Starting,
        conversation_id: binding.conversation_id.as_str().to_string(),
        resident_pubkey: binding.resident_pubkey.as_str().to_string(),
        turn_id: binding.turn_id.as_str().to_string(),
        attached_at: timestamp.clone(),
        checked_at: timestamp,
    };
    let evicted = {
        let mut sessions = preview_sessions()
            .lock()
            .map_err(|_| "preview session state is unavailable".to_string())?;
        let evicted = if sessions.len() >= MAX_PREVIEW_SESSIONS {
            sessions
                .iter()
                .min_by(|left, right| left.1.view.attached_at.cmp(&right.1.view.attached_at))
                .map(|(id, _)| id.clone())
                .and_then(|id| sessions.remove(&id))
        } else {
            None
        };
        sessions.insert(
            view.id.clone(),
            StoredPreviewSession {
                owner_pubkey: binding.owner_pubkey.as_str().to_string(),
                view: view.clone(),
                target,
                cancel,
            },
        );
        evicted
    };
    if let Some(evicted) = evicted {
        evicted.cancel.cancel();
    }
    emit_preview_state(app, &view);
    emit_canvas_present(app, &view);
    let health_app = app.clone();
    let owner = binding.owner_pubkey.as_str().to_string();
    let session_id = view.id.clone();
    tauri::async_runtime::spawn(async move {
        let _ = update_preview_health(&health_app, &owner, &session_id).await;
    });
    Ok(view)
}

/// Detach a preview only when its resident, conversation, and turn still match.
pub(crate) fn detach_preview_session_for_binding(
    app: &AppHandle,
    binding: &ArtifactBrokerBindingV1,
    preview_session_id: &OpaqueId,
) -> Result<ArtifactPreviewSession, String> {
    let view = {
        let mut sessions = preview_sessions()
            .lock()
            .map_err(|_| "preview session state is unavailable".to_string())?;
        let session = sessions
            .get_mut(preview_session_id.as_str())
            .ok_or_else(|| "preview session was not found".to_string())?;
        if session.owner_pubkey != binding.owner_pubkey.as_str()
            || session.view.resident_pubkey != binding.resident_pubkey.as_str()
            || session.view.conversation_id != binding.conversation_id.as_str()
            || session.view.turn_id != binding.turn_id.as_str()
        {
            return Err("preview session authority no longer matches".to_string());
        }
        session.cancel.cancel();
        session.view.status = ArtifactPreviewStatus::Stopped;
        session.view.checked_at = now();
        session.view.clone()
    };
    emit_preview_state(app, &view);
    Ok(view)
}

/// Return one owner-scoped live preview session.
#[tauri::command]
pub fn get_preview_session(
    preview_session_id: String,
    state: State<'_, AppState>,
) -> Result<ArtifactPreviewSession, String> {
    session_for_owner(&current_owner(&state)?, &preview_session_id)
}

/// Refresh server reachability without reading or retaining its response body.
#[tauri::command]
pub async fn refresh_preview_health(
    preview_session_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ArtifactPreviewSession, String> {
    update_preview_health(&app, &current_owner(&state)?, &preview_session_id).await
}

/// Stop presentation of a preview without attempting to stop the agent-owned server.
#[tauri::command]
pub fn detach_preview_session(
    preview_session_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let owner = current_owner(&state)?;
    let view = {
        let mut sessions = preview_sessions()
            .lock()
            .map_err(|_| "preview session state is unavailable".to_string())?;
        let session = sessions
            .get_mut(&preview_session_id)
            .ok_or_else(|| "preview session was not found".to_string())?;
        if session.owner_pubkey != owner {
            return Err("preview session was not found".to_string());
        }
        session.cancel.cancel();
        session.view.status = ArtifactPreviewStatus::Stopped;
        session.view.checked_at = now();
        session.view.clone()
    };
    emit_preview_state(&app, &view);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{extract::ws::WebSocket, response::Html, routing::get};

    #[test]
    fn accepts_only_the_three_explicit_loopback_host_forms() {
        for value in [
            "http://localhost:4173/",
            "http://127.0.0.1:3000/app",
            "http://[::1]:8080/",
        ] {
            assert!(parse_loopback_url(value).is_ok(), "{value}");
        }
    }

    #[test]
    fn rejects_remote_lan_credentials_and_non_http_urls() {
        for value in [
            "https://localhost:4173/",
            "http://192.168.1.20:4173/",
            "http://127.0.0.2:4173/",
            "http://user:secret@127.0.0.1:4173/",
            "http://example.com:4173/",
            "not a url",
        ] {
            assert!(parse_loopback_url(value).is_err(), "{value}");
        }
    }

    #[test]
    fn redirect_rewriting_never_leaves_the_pinned_origin() {
        let (base_url, socket_addr) = parse_loopback_url("http://127.0.0.1:4173/app").unwrap();
        let state = PreviewProxyState {
            target: PinnedLoopbackTarget {
                client: pinned_client(&base_url, socket_addr).unwrap(),
                base_url,
                socket_addr,
            },
            proxy_origin: "http://127.0.0.1:50000".into(),
        };
        assert_eq!(
            rewrite_location(&HeaderValue::from_static("/next"), &state)
                .and_then(|value| value.to_str().ok().map(str::to_string)),
            Some("http://127.0.0.1:50000/next".into())
        );
        assert!(rewrite_location(
            &HeaderValue::from_static("https://example.com/steal"),
            &state
        )
        .is_none());
    }

    async fn echo_socket(mut socket: WebSocket) {
        while let Some(Ok(message)) = socket.recv().await {
            if socket.send(message).await.is_err() {
                break;
            }
        }
    }

    #[tokio::test]
    async fn proxy_preserves_http_and_same_server_websockets() {
        let upstream = Router::new()
            .route("/", get(|| async { Html("<main>preview ready</main>") }))
            .route(
                "/socket",
                get(|upgrade: WebSocketUpgrade| async move { upgrade.on_upgrade(echo_socket) }),
            );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let upstream_port = listener.local_addr().unwrap().port();
        let upstream_task = tokio::spawn(async move {
            let _ = axum::serve(listener, upstream).await;
        });
        let (base_url, socket_addr) =
            parse_loopback_url(&format!("http://127.0.0.1:{upstream_port}/")).unwrap();
        let target = PinnedLoopbackTarget {
            client: pinned_client(&base_url, socket_addr).unwrap(),
            base_url,
            socket_addr,
        };
        let (proxy_port, cancel) = spawn_preview_proxy(target).await.unwrap();

        let response = reqwest::get(format!("http://127.0.0.1:{proxy_port}/"))
            .await
            .unwrap();
        let policy = response
            .headers()
            .get(header::CONTENT_SECURITY_POLICY)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string();
        assert!(policy.contains("default-src 'self'"));
        assert!(!policy.contains("https:"));
        assert!(!policy.contains(" ws:;"));
        assert!(policy.contains(&format!("ws://127.0.0.1:{proxy_port}")));
        assert_eq!(response.text().await.unwrap(), "<main>preview ready</main>");

        let (mut socket, _) =
            tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{proxy_port}/socket"))
                .await
                .unwrap();
        socket
            .send(tungstenite::Message::Text("hot reload".into()))
            .await
            .unwrap();
        assert_eq!(
            socket.next().await.unwrap().unwrap(),
            tungstenite::Message::Text("hot reload".into())
        );
        cancel.cancel();
        upstream_task.abort();
    }
}
