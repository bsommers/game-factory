//! Typed thin client for the game-factory HTTP API (`bin/factory serve`). Generated; edit the templates.
//! Blocking, std plus serde_json only. See README.md.

mod capabilities;
pub use capabilities::*;

use serde_json::Value;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

/// Where `factory serve` listens by default (loopback only).
pub const DEFAULT_BASE_URL: &str = "http://127.0.0.1:4790";
/// OpenAPI document version this client was generated from.
pub const API_VERSION: &str = "1.0.0";

/// Stable `error.code` values. TRANSPORT and BAD_RESPONSE are produced by this client, never by the server.
pub mod codes {
    pub const BAD_CONFIG: &str = "BAD_CONFIG";
    pub const BAD_INPUT: &str = "BAD_INPUT";
    pub const BAD_LOCK: &str = "BAD_LOCK";
    pub const BAD_RESPONSE: &str = "BAD_RESPONSE";
    pub const CONFIRM_REQUIRED: &str = "CONFIRM_REQUIRED";
    pub const CONFLICT: &str = "CONFLICT";
    pub const DUPLICATE: &str = "DUPLICATE";
    pub const EXISTS: &str = "EXISTS";
    pub const FAILED: &str = "FAILED";
    pub const FORBIDDEN: &str = "FORBIDDEN";
    pub const GH_FAILED: &str = "GH_FAILED";
    pub const GIT_FAILED: &str = "GIT_FAILED";
    pub const IMPORT_FAILED: &str = "IMPORT_FAILED";
    pub const INTEGRITY: &str = "INTEGRITY";
    pub const INTERNAL: &str = "INTERNAL";
    pub const INVALID: &str = "INVALID";
    pub const INVALID_THEME: &str = "INVALID_THEME";
    pub const LICENSE_BLOCKED: &str = "LICENSE_BLOCKED";
    pub const MISSING_TEMPLATE: &str = "MISSING_TEMPLATE";
    pub const NOT_FETCHED: &str = "NOT_FETCHED";
    pub const NOT_FOUND: &str = "NOT_FOUND";
    pub const NO_LOCK: &str = "NO_LOCK";
    pub const NO_PROJECT: &str = "NO_PROJECT";
    pub const REGISTRY_ERROR: &str = "REGISTRY_ERROR";
    pub const SECRETS_FOUND: &str = "SECRETS_FOUND";
    pub const STALE_INDEX: &str = "STALE_INDEX";
    pub const TAMPERED: &str = "TAMPERED";
    pub const TASK_FAILED: &str = "TASK_FAILED";
    pub const TRANSPORT: &str = "TRANSPORT";
    pub const UNKNOWN_CAPABILITY: &str = "UNKNOWN_CAPABILITY";
    pub const UNSAFE: &str = "UNSAFE";
}

#[derive(Debug, Clone, PartialEq)]
pub struct ErrorInfo {
    pub code: String,
    pub message: String,
    pub details: Value,
}

/// The `{ok,data,error,next}` envelope.
#[derive(Debug, Clone, PartialEq)]
pub struct Envelope {
    pub ok: bool,
    pub data: Value,
    pub error: Option<ErrorInfo>,
    pub next: Vec<String>,
}

impl Envelope {
    fn parse(v: &Value) -> Option<Envelope> {
        let o = v.as_object()?;
        let ok = o.get("ok")?.as_bool()?;
        let error = o.get("error").and_then(|e| e.as_object()).map(|e| ErrorInfo {
            code: e.get("code").and_then(Value::as_str).unwrap_or(codes::FAILED).to_string(),
            message: e.get("message").and_then(Value::as_str).unwrap_or("").to_string(),
            details: e.get("details").cloned().unwrap_or(Value::Null),
        });
        let next = o.get("next").and_then(Value::as_array).map(|a| a.iter().filter_map(|s| s.as_str().map(String::from)).collect()).unwrap_or_default();
        Some(Envelope { ok, data: o.get("data").cloned().unwrap_or(Value::Null), error, next })
    }
}

/// Failure: the factory said ok=false (`code` is one of `codes::*`), or the call itself failed.
#[derive(Debug, Clone, PartialEq)]
pub struct Error {
    pub code: String,
    pub message: String,
    /// HTTP status, 0 for transport errors.
    pub status: u16,
    pub details: Value,
    pub next: Vec<String>,
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "factory: {}: {}", self.code, self.message)
    }
}
impl std::error::Error for Error {}

fn local(code: &str, message: impl Into<String>, status: u16) -> Error {
    Error { code: code.to_string(), message: message.into(), status, details: Value::Null, next: vec![] }
}

/// One server-sent event.
#[derive(Debug, Clone, PartialEq)]
pub struct Event {
    pub name: String,
    pub data: Value,
}

pub struct Client {
    host: String,
    addr_text: String,
    timeout: Duration,
}

impl Client {
    /// `base_url` like `http://127.0.0.1:4790`; None means [`DEFAULT_BASE_URL`]. Only plain http is supported.
    pub fn new(base_url: Option<&str>) -> Result<Client, Error> {
        let b = base_url.unwrap_or(DEFAULT_BASE_URL).trim_end_matches('/');
        let rest = b.strip_prefix("http://").ok_or_else(|| local(codes::BAD_INPUT, "base url must start with http://", 0))?;
        if rest.is_empty() || rest.contains('/') {
            return Err(local(codes::BAD_INPUT, "base url must be http://host:port", 0));
        }
        let addr_text = if rest.contains(':') { rest.to_string() } else { format!("{rest}:80") };
        Ok(Client { host: rest.to_string(), addr_text, timeout: Duration::from_secs(30) })
    }

    /// Per-request connect, read and write timeout (default 30s).
    pub fn with_timeout(mut self, t: Duration) -> Client {
        self.timeout = t;
        self
    }

    fn open(&self, method: &str, path: &str, body: Option<&str>) -> Result<TcpStream, Error> {
        let addr = self.addr_text.to_socket_addrs().map_err(|e| local(codes::TRANSPORT, e.to_string(), 0))?.next().ok_or_else(|| local(codes::TRANSPORT, "no address", 0))?;
        let mut s = TcpStream::connect_timeout(&addr, self.timeout).map_err(|e| local(codes::TRANSPORT, e.to_string(), 0))?;
        let t = Some(self.timeout);
        let _ = (s.set_read_timeout(t), s.set_write_timeout(t));
        let b = body.unwrap_or("");
        let mut req = format!("{method} {path} HTTP/1.0\r\nHost: {}\r\nAccept: */*\r\nConnection: close\r\n", self.host);
        if body.is_some() {
            req += &format!("Content-Type: application/json\r\nContent-Length: {}\r\n", b.len());
        }
        req += "\r\n";
        req += b;
        s.write_all(req.as_bytes()).map_err(|e| local(codes::TRANSPORT, e.to_string(), 0))?;
        Ok(s)
    }

    fn request(&self, method: &str, path: &str, body: Option<&str>) -> Result<(u16, Vec<u8>), Error> {
        let s = self.open(method, path, body)?;
        let mut r = BufReader::new(s);
        let (status, chunked) = read_head(&mut r)?;
        let mut buf = Vec::new();
        r.take(64 << 20).read_to_end(&mut buf).map_err(|e| local(codes::TRANSPORT, e.to_string(), status))?;
        Ok((status, if chunked { dechunk(&buf).ok_or_else(|| local(codes::BAD_RESPONSE, "bad chunked body", status))? } else { buf }))
    }

    fn envelope(status: u16, body: &[u8]) -> Result<Envelope, Error> {
        let v: Value = serde_json::from_slice(body).map_err(|e| local(codes::BAD_RESPONSE, format!("HTTP {status}: not JSON: {e}"), status))?;
        let env = Envelope::parse(&v).ok_or_else(|| local(codes::BAD_RESPONSE, format!("HTTP {status}: not an envelope"), status))?;
        if env.ok {
            return Ok(env);
        }
        let e = env.error.clone().unwrap_or(ErrorInfo { code: codes::FAILED.into(), message: String::new(), details: Value::Null });
        Err(Error { code: e.code, message: e.message, status, details: e.details, next: env.next })
    }

    /// Invoke any capability by name (`POST /api/<name>`). Input is a JSON object.
    pub fn call(&self, name: &str, input: &Value) -> Result<Envelope, Error> {
        let (status, body) = self.request("POST", &format!("/api/{name}"), Some(&input.to_string()))?;
        Self::envelope(status, &body)
    }

    /// `GET /capabilities`.
    pub fn capabilities(&self) -> Result<Envelope, Error> {
        let (status, body) = self.request("GET", "/capabilities", None)?;
        Self::envelope(status, &body)
    }

    /// Raw `GET /openapi.json`.
    pub fn openapi(&self) -> Result<Value, Error> {
        let (status, body) = self.request("GET", "/openapi.json", None)?;
        serde_json::from_slice(&body).map_err(|e| local(codes::BAD_RESPONSE, e.to_string(), status))
    }

    /// `GET /events?project=<dir>[&since=ISO]` as an iterator of progress events. Ends when the server closes
    /// the stream; a read that stays silent longer than the timeout yields a TRANSPORT error (the server pings every second).
    pub fn events(&self, project: &str, since: Option<&str>) -> Result<EventStream, Error> {
        let mut path = format!("/events?project={}", urlencode(project));
        if let Some(s) = since {
            path += &format!("&since={}", urlencode(s));
        }
        let s = self.open("GET", &path, None)?;
        let mut r = BufReader::new(s);
        let (status, _) = read_head(&mut r)?;
        if status != 200 {
            return Err(local(codes::TRANSPORT, format!("events: HTTP {status}"), status));
        }
        Ok(EventStream { r, done: false })
    }
}

pub struct EventStream {
    r: BufReader<TcpStream>,
    done: bool,
}

impl Iterator for EventStream {
    type Item = Result<Event, Error>;
    fn next(&mut self) -> Option<Self::Item> {
        if self.done {
            return None;
        }
        let (mut name, mut data) = (String::new(), String::new());
        loop {
            let mut line = String::new();
            match self.r.read_line(&mut line) {
                Ok(0) => {
                    self.done = true;
                    return None;
                }
                Err(e) => {
                    self.done = true;
                    return Some(Err(local(codes::TRANSPORT, e.to_string(), 0)));
                }
                Ok(_) => {}
            }
            let line = line.trim_end_matches(['\r', '\n']);
            if line.is_empty() {
                if !data.is_empty() {
                    return Some(serde_json::from_str(&data).map(|d| Event { name, data: d }).map_err(|e| local(codes::BAD_RESPONSE, e.to_string(), 0)));
                }
                name.clear();
            } else if let Some(v) = line.strip_prefix("event:") {
                name = v.trim().to_string();
            } else if let Some(v) = line.strip_prefix("data:") {
                if !data.is_empty() {
                    data.push('\n');
                }
                data += v.strip_prefix(' ').unwrap_or(v);
            }
        }
    }
}

fn read_head(r: &mut BufReader<TcpStream>) -> Result<(u16, bool), Error> {
    let mut line = String::new();
    r.read_line(&mut line).map_err(|e| local(codes::TRANSPORT, e.to_string(), 0))?;
    let status: u16 = line.split_whitespace().nth(1).and_then(|s| s.parse().ok()).ok_or_else(|| local(codes::BAD_RESPONSE, format!("bad status line {line:?}"), 0))?;
    let mut chunked = false;
    loop {
        let mut h = String::new();
        if r.read_line(&mut h).map_err(|e| local(codes::TRANSPORT, e.to_string(), status))? == 0 || h.trim().is_empty() {
            break;
        }
        let h = h.to_ascii_lowercase();
        if h.starts_with("transfer-encoding:") && h.contains("chunked") {
            chunked = true;
        }
    }
    Ok((status, chunked))
}

fn dechunk(mut b: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    loop {
        let i = b.windows(2).position(|w| w == b"\r\n")?;
        let n = usize::from_str_radix(std::str::from_utf8(&b[..i]).ok()?.split(';').next()?.trim(), 16).ok()?;
        b = &b[i + 2..];
        if n == 0 {
            return Some(out);
        }
        out.extend_from_slice(b.get(..n)?);
        b = b.get(n + 2..)?;
    }
}

fn urlencode(s: &str) -> String {
    let mut o = String::new();
    for c in s.bytes() {
        if c.is_ascii_alphanumeric() || b"-_.~/".contains(&c) {
            o.push(c as char);
        } else {
            o += &format!("%{c:02X}");
        }
    }
    o
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    fn serve_once(reply: &'static str) -> String {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = l.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let mut buf = [0u8; 4096];
            let _ = s.read(&mut buf);
            s.write_all(reply.as_bytes()).unwrap();
        });
        format!("http://{addr}")
    }

    #[test]
    fn ok_envelope() {
        let url = serve_once("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"ok\":true,\"data\":{\"a\":1},\"error\":null,\"next\":[\"x\"]}");
        let env = Client::new(Some(&url)).unwrap().call("kits.list", &serde_json::json!({})).unwrap();
        assert!(env.ok && env.data["a"] == 1 && env.next == vec!["x".to_string()]);
    }

    #[test]
    fn error_code_and_chunked() {
        let url = serve_once("HTTP/1.1 404 Not Found\r\nTransfer-Encoding: chunked\r\n\r\n4e\r\n{\"ok\":false,\"data\":null,\"error\":{\"code\":\"NOT_FOUND\",\"message\":\"no\"},\"next\":[]}\r\n0\r\n\r\n");
        let e = Client::new(Some(&url)).unwrap().call("kits.show", &serde_json::json!({})).unwrap_err();
        assert_eq!((e.code.as_str(), e.status), (codes::NOT_FOUND, 404));
    }

    #[test]
    fn not_an_envelope_and_transport() {
        let url = serve_once("HTTP/1.1 502 Bad Gateway\r\n\r\n<html>");
        let e = Client::new(Some(&url)).unwrap().capabilities().unwrap_err();
        assert_eq!(e.code, codes::BAD_RESPONSE);
        let e = Client::new(Some("http://127.0.0.1:1")).unwrap().with_timeout(Duration::from_millis(500)).capabilities().unwrap_err();
        assert_eq!(e.code, codes::TRANSPORT);
        assert!(Client::new(Some("https://x")).is_err());
    }
}
