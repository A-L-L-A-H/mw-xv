use bytes::{BufMut, BytesMut};
use md5::{Digest, Md5};
use std::net::Ipv4Addr;
use thiserror::Error;

pub mod codes {
    pub const ACCESS_REQUEST: u8 = 1;
    pub const ACCESS_ACCEPT: u8 = 2;
    pub const ACCESS_REJECT: u8 = 3;
    pub const ACCOUNTING_REQUEST: u8 = 4;
    pub const ACCOUNTING_RESPONSE: u8 = 5;
    #[allow(dead_code)]
    pub const DISCONNECT_REQUEST: u8 = 40;
    #[allow(dead_code)]
    pub const DISCONNECT_ACK: u8 = 41;
    #[allow(dead_code)]
    pub const DISCONNECT_NAK: u8 = 42;
    #[allow(dead_code)]
    pub const COA_REQUEST: u8 = 43;
    #[allow(dead_code)]
    pub const COA_ACK: u8 = 44;
    #[allow(dead_code)]
    pub const COA_NAK: u8 = 45;
}

#[allow(dead_code)]
pub mod attr_type {
    pub const USER_NAME: u8 = 1;
    pub const USER_PASSWORD: u8 = 2;
    pub const CHAP_PASSWORD: u8 = 3;
    pub const NAS_IP_ADDRESS: u8 = 4;
    pub const NAS_PORT: u8 = 5;
    pub const FRAMED_IP_ADDRESS: u8 = 8;
    pub const FILTER_ID: u8 = 11;
    pub const REPLY_MESSAGE: u8 = 18;
    pub const VENDOR_SPECIFIC: u8 = 26;
    pub const CALLED_STATION_ID: u8 = 30;
    pub const CALLING_STATION_ID: u8 = 31;
    pub const ACCT_STATUS_TYPE: u8 = 40;
    pub const ACCT_DELAY_TIME: u8 = 41;
    pub const ACCT_INPUT_OCTETS: u8 = 42;
    pub const ACCT_OUTPUT_OCTETS: u8 = 43;
    pub const ACCT_SESSION_ID: u8 = 44;
    pub const ACCT_SESSION_TIME: u8 = 46;
    pub const ACCT_TERMINATE_CAUSE: u8 = 49;
    pub const ACCT_INPUT_GIGAWORDS: u8 = 52;
    pub const ACCT_OUTPUT_GIGAWORDS: u8 = 53;
    pub const CHAP_CHALLENGE: u8 = 60;
}

#[allow(dead_code)]
pub mod acct_status {
    pub const START: u32 = 1;
    pub const STOP: u32 = 2;
    pub const INTERIM_UPDATE: u32 = 3;
    pub const ACCOUNTING_ON: u32 = 7;
    pub const ACCOUNTING_OFF: u32 = 8;
}

/// RADIUS VSA identity used by RouterOS for `MikroTik-Rate-Limit`.
pub mod mikrotik {
    pub const VENDOR_ID: u32 = 14988;
    pub const RATE_LIMIT_ATTR: u8 = 8;
    /// A VSA payload is type (1) + length (1) + vendor ID (4) + value, and the
    /// enclosing RADIUS attribute adds another type/length pair (RFC 2865 §5.26).
    /// A conforming value therefore cannot exceed 247 bytes.
    pub const MAX_VALUE_LEN: usize = 247;
    /// Maximum size for the built rate-limit string (kept well below the VSA bound).
    pub const MAX_FORMAT_LEN: usize = 64;
    /// Burst windows are bounded to avoid nonsensical long-duration bursts.
    pub const MAX_BURST_TIME_SECONDS: u64 = 600;
    /// Highest rate expressible with a `k` suffix (10 Gbps).
    pub const MAX_RATE_KBPS: u64 = 10_000_000;
}

/// Validation errors for values placed into a RADIUS attribute.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum AttributeValidationError {
    #[error("attribute value exceeds the RADIUS VSA bound")]
    Oversized,
    #[error("attribute value is malformed or out of range")]
    InvalidValue,
}

/// Encodes RFC 2865 §5.26 Vendor-Specific attribute bytes (vendor type,
/// vendor length, vendor ID, then the vendor value).
pub fn encode_vsa(vendor_id: u32, vendor_type: u8, value: &[u8]) -> RadiusAttribute {
    let mut bytes = Vec::with_capacity(6 + value.len());
    bytes.push(vendor_type);
    bytes.push((2 + value.len()) as u8);
    bytes.extend_from_slice(&vendor_id.to_be_bytes());
    bytes.extend_from_slice(value);
    RadiusAttribute {
        attr_type: attr_type::VENDOR_SPECIFIC,
        value: bytes,
    }
}

/// Decodes a VSA value, rejecting malformed vendor-length fields.
#[allow(dead_code)]
pub fn decode_vsa_value(
    attr: &RadiusAttribute,
    vendor_id: u32,
    vendor_type: u8,
) -> Option<&[u8]> {
    if attr.attr_type != attr_type::VENDOR_SPECIFIC || attr.value.len() < 6 {
        return None;
    }
    if attr.value[0] != vendor_type {
        return None;
    }
    let vendor = &attr.value[2..6];
    if u32::from_be_bytes([vendor[0], vendor[1], vendor[2], vendor[3]]) != vendor_id {
        return None;
    }
    // Vendor-Length counts its own 2 bytes plus the 4-byte vendor ID; the
    // enclosing attribute adds 2 more bytes for type and length.
    let len = attr.value[1] as usize;
    if len < 6 || len != attr.value.len().saturating_sub(4) {
        return None;
    }
    Some(&attr.value[6..])
}

/// Canonical bandwidth profile in kbps. Burst values are optional; `burst_time_seconds`
/// is only meaningful when a burst rate is present.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct BandwidthProfile {
    pub download_kbps: u64,
    pub upload_kbps: u64,
    pub burst_download_kbps: Option<u64>,
    pub burst_upload_kbps: Option<u64>,
    pub burst_time_seconds: Option<u64>,
}

/// Builds a `MikroTik-Rate-Limit` string in RouterOS's documented order:
/// `rx-rate/tx-rate [rx-burst/tx-burst [rx-threshold/tx-threshold [rx-time/tx-time]]]`.
/// `rx` is the subscriber upload and `tx` the subscriber download (router view).
/// All rates are encoded with a `k` suffix (kbps as documented by RouterOS).
///
/// Returns `Err` for any value that is malformed, out of range, or too large
/// to encode safely in a RADIUS VSA; callers must fail closed.
pub fn format_mikrotik_rate_limit(
    profile: &BandwidthProfile,
) -> Result<String, AttributeValidationError> {
    let validate_rate = |rate: u64| {
        if (1..=mikrotik::MAX_RATE_KBPS).contains(&rate) {
            Ok(rate)
        } else {
            Err(AttributeValidationError::InvalidValue)
        }
    };

    let upload = validate_rate(profile.upload_kbps)?;
    let download = validate_rate(profile.download_kbps)?;
    let rx_rate = format!("{upload}k");
    let tx_rate = format!("{download}k");
    let mut fields = vec![format!("{rx_rate}/{tx_rate}")];

    let burst_upload = profile.burst_upload_kbps.map(validate_rate).transpose()?;
    let burst_download = profile.burst_download_kbps.map(validate_rate).transpose()?;
    if burst_upload.is_some() != burst_download.is_some() {
        // RouterOS accepts paired burst fields; a half-specified burst is
        // ambiguous and must fail closed rather than silently dropped.
        return Err(AttributeValidationError::InvalidValue);
    }
    if let (Some(rx_burst), Some(tx_burst)) = (burst_upload, burst_download) {
        let rx_burst_rate = format!("{rx_burst}k");
        let tx_burst_rate = format!("{tx_burst}k");
        fields.push(format!("{rx_burst_rate}/{tx_burst_rate}"));
        // With a burst rate and no explicit thresholds RouterOS uses rx/tx-rate
        // as the burst thresholds (documented default).
        let seconds = profile.burst_time_seconds.unwrap_or(1);
        if seconds == 0 || seconds > mikrotik::MAX_BURST_TIME_SECONDS {
            return Err(AttributeValidationError::InvalidValue);
        }
        fields.push(format!("{seconds}s/{seconds}s"));
    } else if profile.burst_time_seconds.is_some() {
        return Err(AttributeValidationError::InvalidValue);
    }

    let value = fields.join(" ");
    if value.len() > mikrotik::MAX_FORMAT_LEN || value.len() > mikrotik::MAX_VALUE_LEN {
        return Err(AttributeValidationError::Oversized);
    }
    if !value
        .bytes()
        .all(|b| b.is_ascii_digit() || b.is_ascii_lowercase() || b == b'/' || b == b' ')
    {
        return Err(AttributeValidationError::InvalidValue);
    }
    Ok(value)
}

/// Builds the complete MikroTik-Rate-Limit VSA for a bandwidth profile.
pub fn mikrotik_rate_limit_vsa(
    profile: &BandwidthProfile,
) -> Result<RadiusAttribute, AttributeValidationError> {
    let value = format_mikrotik_rate_limit(profile)?;
    Ok(encode_vsa(
        mikrotik::VENDOR_ID,
        mikrotik::RATE_LIMIT_ATTR,
        value.as_bytes(),
    ))
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum RadiusError {
    #[error("Packet too short: {0} bytes")]
    PacketTooShort(usize),
    #[error("Invalid packet length {declared} for buffer of {actual} bytes")]
    InvalidLength { declared: usize, actual: usize },
    #[error("Invalid attribute at offset {0}")]
    InvalidAttribute(usize),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RadiusAttribute {
    pub attr_type: u8,
    pub value: Vec<u8>,
}

impl RadiusAttribute {
    pub fn string(attr_type: u8, value: &str) -> Self {
        Self {
            attr_type,
            value: value.as_bytes().to_vec(),
        }
    }

    pub fn ipv4(attr_type: u8, ip: Ipv4Addr) -> Self {
        Self {
            attr_type,
            value: ip.octets().to_vec(),
        }
    }

    #[allow(dead_code)]
    pub fn u32(attr_type: u8, value: u32) -> Self {
        Self {
            attr_type,
            value: value.to_be_bytes().to_vec(),
        }
    }

    pub fn as_str(&self) -> String {
        String::from_utf8_lossy(&self.value).to_string()
    }

    pub fn as_u32(&self) -> Option<u32> {
        if self.value.len() == 4 {
            Some(u32::from_be_bytes([
                self.value[0],
                self.value[1],
                self.value[2],
                self.value[3],
            ]))
        } else {
            None
        }
    }

    pub fn as_ipv4(&self) -> Option<Ipv4Addr> {
        if self.value.len() == 4 {
            Some(Ipv4Addr::new(
                self.value[0],
                self.value[1],
                self.value[2],
                self.value[3],
            ))
        } else {
            None
        }
    }

    pub fn encode(&self, buf: &mut BytesMut) {
        let len = (2 + self.value.len()).min(255);
        buf.put_u8(self.attr_type);
        buf.put_u8(len as u8);
        buf.extend_from_slice(&self.value[..len - 2]);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RadiusPacket {
    pub code: u8,
    pub identifier: u8,
    pub authenticator: [u8; 16],
    pub attributes: Vec<RadiusAttribute>,
}

impl RadiusPacket {
    pub fn attribute(&self, attr_type: u8) -> Option<&RadiusAttribute> {
        self.attributes
            .iter()
            .find(|attr| attr.attr_type == attr_type)
    }
}

pub fn decode_packet(data: &[u8]) -> Result<RadiusPacket, RadiusError> {
    if data.len() < 20 {
        return Err(RadiusError::PacketTooShort(data.len()));
    }
    let code = data[0];
    let identifier = data[1];
    let length = u16::from_be_bytes([data[2], data[3]]) as usize;
    if length < 20 || length > data.len() || length > 4096 {
        return Err(RadiusError::InvalidLength {
            declared: length,
            actual: data.len(),
        });
    }

    let mut authenticator = [0u8; 16];
    authenticator.copy_from_slice(&data[4..20]);

    let mut attributes = Vec::new();
    let mut offset = 20;
    while offset < length {
        if offset + 2 > length {
            return Err(RadiusError::InvalidAttribute(offset));
        }
        let attr_type = data[offset];
        let attr_len = data[offset + 1] as usize;
        if attr_len < 2 || offset + attr_len > length {
            return Err(RadiusError::InvalidAttribute(offset));
        }
        attributes.push(RadiusAttribute {
            attr_type,
            value: data[offset + 2..offset + attr_len].to_vec(),
        });
        offset += attr_len;
    }

    Ok(RadiusPacket {
        code,
        identifier,
        authenticator,
        attributes,
    })
}

/// RFC 2865 §3 / RFC 2866 §3 Response-Authenticator:
/// MD5(Code + ID + Length + RequestAuth + ResponseAttributes + Secret)
pub fn encode_response(
    code: u8,
    identifier: u8,
    request_authenticator: &[u8; 16],
    attributes: &[RadiusAttribute],
    secret: &[u8],
) -> Vec<u8> {
    let mut attr_bytes = BytesMut::new();
    for attr in attributes {
        attr.encode(&mut attr_bytes);
    }
    let total_len = (20 + attr_bytes.len()) as u16;

    let mut buf = BytesMut::with_capacity(total_len as usize);
    buf.put_u8(code);
    buf.put_u8(identifier);
    buf.put_u16(total_len);
    buf.extend_from_slice(request_authenticator);
    buf.extend_from_slice(&attr_bytes);

    let mut hasher = Md5::new();
    hasher.update(&buf);
    hasher.update(secret);
    let digest = hasher.finalize();
    buf[4..20].copy_from_slice(&digest);

    buf.to_vec()
}

/// RFC 2865 §5.2 PAP password decryption
pub fn decrypt_pap_password(
    encrypted: &[u8],
    request_authenticator: &[u8; 16],
    secret: &[u8],
) -> Option<String> {
    if encrypted.is_empty() || !encrypted.len().is_multiple_of(16) {
        return None;
    }
    let mut out = Vec::with_capacity(encrypted.len());
    let mut prev_block = request_authenticator.as_slice();

    for chunk in encrypted.as_chunks::<16>().0 {
        let mut hasher = Md5::new();
        hasher.update(secret);
        hasher.update(prev_block);
        let pad = hasher.finalize();
        for (idx, byte) in chunk.iter().enumerate() {
            out.push(byte ^ pad[idx]);
        }
        prev_block = chunk;
    }

    while out.last() == Some(&0) {
        out.pop();
    }
    Some(String::from_utf8_lossy(&out).to_string())
}

/// RFC 2865 §5.2 PAP password encryption (used by clients/tests)
#[allow(dead_code)]
pub fn encrypt_pap_password(
    password: &str,
    request_authenticator: &[u8; 16],
    secret: &[u8],
) -> Vec<u8> {
    let raw = password.as_bytes();
    let padded_len = raw.len().max(1).div_ceil(16) * 16;
    let mut padded = vec![0u8; padded_len];
    padded[..raw.len()].copy_from_slice(raw);

    let mut out = Vec::with_capacity(padded_len);
    let mut prev_block = *request_authenticator;
    for chunk in padded.as_chunks::<16>().0 {
        let mut hasher = Md5::new();
        hasher.update(secret);
        hasher.update(prev_block);
        let pad = hasher.finalize();
        let mut cipher = [0u8; 16];
        for (idx, byte) in chunk.iter().enumerate() {
            cipher[idx] = byte ^ pad[idx];
        }
        out.extend_from_slice(&cipher);
        prev_block = cipher;
    }
    out
}

/// RFC 2865 §5.3 CHAP verification: MD5(chap_id || password || challenge)
pub fn verify_chap_password(
    chap_password: &[u8],
    challenge: &[u8],
    expected_password: &str,
) -> bool {
    if chap_password.len() != 17 || challenge.is_empty() {
        return false;
    }
    let chap_id = chap_password[0];
    let supplied_digest = &chap_password[1..17];

    let mut hasher = Md5::new();
    hasher.update([chap_id]);
    hasher.update(expected_password.as_bytes());
    hasher.update(challenge);
    let expected = hasher.finalize();
    constant_time_eq(supplied_digest, &expected)
}

/// RFC 2866 §3 Accounting-Request Authenticator verification:
/// MD5(Code + ID + Length + 16*0 + Attributes + Secret)
pub fn verify_accounting_authenticator(raw_packet: &[u8], secret: &[u8]) -> bool {
    if raw_packet.len() < 20 {
        return false;
    }
    let declared_len = u16::from_be_bytes([raw_packet[2], raw_packet[3]]) as usize;
    if declared_len < 20 || declared_len > raw_packet.len() {
        return false;
    }
    let mut hasher = Md5::new();
    hasher.update(&raw_packet[0..4]);
    hasher.update([0u8; 16]);
    hasher.update(&raw_packet[20..declared_len]);
    hasher.update(secret);
    let expected = hasher.finalize();
    constant_time_eq(&raw_packet[4..20], &expected)
}

/// Normalizes a MAC address string (e.g. `AA:BB:CC:DD:EE:FF`, `aa-bb-cc-dd-ee-ff`,
/// `aabb.ccdd.eeff`, `aabbccddeeff`) into lowercase colon-separated `aa:bb:cc:dd:ee:ff`.
pub fn normalize_mac(raw: &str) -> Option<String> {
    let hex: String = raw
        .chars()
        .filter(|c| !matches!(c, ':' | '-' | '.' | ' '))
        .collect::<String>()
        .to_ascii_lowercase();
    if hex.len() != 12 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let mut out = String::with_capacity(17);
    for (idx, chunk) in hex.as_bytes().chunks_exact(2).enumerate() {
        if idx > 0 {
            out.push(':');
        }
        out.push(chunk[0] as char);
        out.push(chunk[1] as char);
    }
    Some(out)
}

/// RFC 5176 §3.2 Dynamic Authorization Request (CoA / Disconnect):
/// Request-Authenticator = MD5(Code + ID + Length + 16*0 + Attributes + Secret)
pub fn encode_rfc5176_request(
    code: u8,
    identifier: u8,
    attributes: &[RadiusAttribute],
    secret: &[u8],
) -> Vec<u8> {
    let mut attr_bytes = BytesMut::new();
    for attr in attributes {
        attr.encode(&mut attr_bytes);
    }
    let total_len = (20 + attr_bytes.len()) as u16;

    let mut buf = BytesMut::with_capacity(total_len as usize);
    buf.put_u8(code);
    buf.put_u8(identifier);
    buf.put_u16(total_len);
    buf.extend_from_slice(&[0u8; 16]);
    buf.extend_from_slice(&attr_bytes);

    let mut hasher = Md5::new();
    hasher.update(&buf);
    hasher.update(secret);
    let digest = hasher.finalize();
    buf[4..20].copy_from_slice(&digest);
    buf.to_vec()
}

pub fn encode_disconnect_request(
    identifier: u8,
    attributes: &[RadiusAttribute],
    secret: &[u8],
) -> Vec<u8> {
    encode_rfc5176_request(codes::DISCONNECT_REQUEST, identifier, attributes, secret)
}

pub fn encode_coa_request(
    identifier: u8,
    attributes: &[RadiusAttribute],
    secret: &[u8],
) -> Vec<u8> {
    encode_rfc5176_request(codes::COA_REQUEST, identifier, attributes, secret)
}

/// RFC 2865 §3 / RFC 5176 §3.3 Response-Authenticator verification:
/// MD5(Code + ID + Length + RequestAuth + ResponseAttributes + Secret)
pub fn verify_response_authenticator(
    raw_packet: &[u8],
    request_authenticator: &[u8; 16],
    secret: &[u8],
) -> bool {
    if raw_packet.len() < 20 {
        return false;
    }
    let declared_len = u16::from_be_bytes([raw_packet[2], raw_packet[3]]) as usize;
    if declared_len < 20 || declared_len > raw_packet.len() {
        return false;
    }
    let mut hasher = Md5::new();
    hasher.update(&raw_packet[0..4]);
    hasher.update(request_authenticator);
    hasher.update(&raw_packet[20..declared_len]);
    hasher.update(secret);
    let expected = hasher.finalize();
    constant_time_eq(&raw_packet[4..20], &expected)
}

#[allow(dead_code)]
pub fn sign_accounting_request(raw_packet: &mut [u8], secret: &[u8]) {
    if raw_packet.len() < 20 {
        return;
    }
    let mut hasher = Md5::new();
    hasher.update(&raw_packet[0..4]);
    hasher.update([0u8; 16]);
    hasher.update(&raw_packet[20..]);
    hasher.update(secret);
    let digest = hasher.finalize();
    raw_packet[4..20].copy_from_slice(&digest);
}

pub fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut diff = 0u8;
    for (a, b) in left.iter().zip(right.iter()) {
        diff |= a ^ b;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_mikrotik_rate_limit_vsa_in_routeros_order() {
        let profile = BandwidthProfile {
            download_kbps: 50_000,
            upload_kbps: 10_000,
            burst_download_kbps: Some(100_000),
            burst_upload_kbps: Some(20_000),
            burst_time_seconds: Some(10),
        };
        let attr = mikrotik_rate_limit_vsa(&profile).expect("valid profile");
        assert_eq!(attr.attr_type, attr_type::VENDOR_SPECIFIC);
        assert_eq!(attr.value[0], mikrotik::RATE_LIMIT_ATTR);
        assert_eq!(attr.value[1] as usize, attr.value.len() - 4);
        assert_eq!(&attr.value[2..6], &14988u32.to_be_bytes());
        assert_eq!(
            decode_vsa_value(&attr, mikrotik::VENDOR_ID, mikrotik::RATE_LIMIT_ATTR),
            Some(b"10000k/50000k 20000k/100000k 10s/10s".as_slice())
        );
        assert_eq!(
            format_mikrotik_rate_limit(&BandwidthProfile {
                download_kbps: 100_000,
                upload_kbps: 20_000,
                ..BandwidthProfile::default()
            })
            .unwrap(),
            "20000k/100000k"
        );
    }

    #[test]
    fn rejects_malformed_and_oversized_rate_limit_values() {
        assert_eq!(
            format_mikrotik_rate_limit(&BandwidthProfile::default()).unwrap_err(),
            AttributeValidationError::InvalidValue
        );
        assert_eq!(
            format_mikrotik_rate_limit(&BandwidthProfile {
                download_kbps: 100,
                upload_kbps: 0,
                ..BandwidthProfile::default()
            })
            .unwrap_err(),
            AttributeValidationError::InvalidValue
        );
        assert_eq!(
            format_mikrotik_rate_limit(&BandwidthProfile {
                download_kbps: 100,
                upload_kbps: 100,
                burst_download_kbps: Some(200),
                ..BandwidthProfile::default()
            })
            .unwrap_err(),
            AttributeValidationError::InvalidValue
        );
        assert_eq!(
            format_mikrotik_rate_limit(&BandwidthProfile {
                download_kbps: 100,
                upload_kbps: 100,
                burst_download_kbps: Some(200),
                burst_upload_kbps: Some(200),
                burst_time_seconds: Some(601),
            })
            .unwrap_err(),
            AttributeValidationError::InvalidValue
        );
        let max = mikrotik::MAX_RATE_KBPS;
        assert!(
            format_mikrotik_rate_limit(&BandwidthProfile {
                download_kbps: max,
                upload_kbps: max,
                ..BandwidthProfile::default()
            })
            .is_ok()
        );
        assert_eq!(
            format_mikrotik_rate_limit(&BandwidthProfile {
                download_kbps: max + 1,
                upload_kbps: max,
                ..BandwidthProfile::default()
            })
            .unwrap_err(),
            AttributeValidationError::InvalidValue
        );
        assert!(mikrotik::MAX_FORMAT_LEN <= mikrotik::MAX_VALUE_LEN);
    }

    #[test]
    fn rejects_malformed_vsa_decoding() {
        let attr = mikrotik_rate_limit_vsa(&BandwidthProfile {
            download_kbps: 1000,
            upload_kbps: 500,
            ..BandwidthProfile::default()
        })
        .unwrap();
        assert!(decode_vsa_value(&attr, 14988, 8).is_some());
        assert!(decode_vsa_value(&attr, 9, 8).is_none());
        assert!(decode_vsa_value(&attr, 14988, 1).is_none());
        let mut wrong_type = attr.clone();
        wrong_type.attr_type = attr_type::FILTER_ID;
        assert!(decode_vsa_value(&wrong_type, 14988, 8).is_none());
        let mut short = attr.clone();
        short.value.truncate(5);
        assert!(decode_vsa_value(&short, 14988, 8).is_none());
        let mut bad_len = attr.clone();
        bad_len.value[1] = 255;
        assert!(decode_vsa_value(&bad_len, 14988, 8).is_none());
    }

    #[test]
    fn roundtrips_pap_encryption_and_packet_decoding() {
        let secret = b"testing123";
        let req_auth = [7u8; 16];
        let encrypted = encrypt_pap_password("super-secret-pass-long", &req_auth, secret);
        assert_eq!(encrypted.len(), 32);

        let attrs = vec![
            RadiusAttribute::string(attr_type::USER_NAME, "alice"),
            RadiusAttribute {
                attr_type: attr_type::USER_PASSWORD,
                value: encrypted,
            },
        ];
        let raw = encode_response(codes::ACCESS_REQUEST, 42, &req_auth, &attrs, secret);
        let decoded = decode_packet(&raw).expect("packet decodes");
        assert_eq!(decoded.code, codes::ACCESS_REQUEST);
        assert_eq!(decoded.identifier, 42);
        assert_eq!(
            decoded
                .attribute(attr_type::USER_NAME)
                .map(RadiusAttribute::as_str),
            Some("alice".to_string())
        );

        let cipher = &decoded.attribute(attr_type::USER_PASSWORD).unwrap().value;
        let plain = decrypt_pap_password(cipher, &req_auth, secret);
        assert_eq!(plain.as_deref(), Some("super-secret-pass-long"));
    }

    #[test]
    fn verifies_chap_and_accounting_authenticators() {
        let challenge = b"random-challenge";
        let chap_id = 9u8;
        let mut hasher = Md5::new();
        hasher.update([chap_id]);
        hasher.update(b"chap-pass");
        hasher.update(challenge);
        let mut chap_password = vec![chap_id];
        chap_password.extend_from_slice(&hasher.finalize());

        assert!(verify_chap_password(&chap_password, challenge, "chap-pass"));
        assert!(!verify_chap_password(&chap_password, challenge, "wrong"));

        let secret = b"testing123";
        let mut acct = BytesMut::new();
        acct.put_u8(codes::ACCOUNTING_REQUEST);
        acct.put_u8(11);
        acct.put_u16(0);
        acct.extend_from_slice(&[0u8; 16]);
        RadiusAttribute::string(attr_type::USER_NAME, "alice").encode(&mut acct);
        RadiusAttribute::u32(attr_type::ACCT_STATUS_TYPE, acct_status::START).encode(&mut acct);
        let total = acct.len() as u16;
        acct[2..4].copy_from_slice(&total.to_be_bytes());
        sign_accounting_request(&mut acct, secret);

        assert!(verify_accounting_authenticator(&acct, secret));
        assert!(!verify_accounting_authenticator(&acct, b"bad-secret"));
    }

    #[test]
    fn encodes_disconnect_request_per_rfc5176() {
        let secret = b"testing123";
        let attrs = vec![
            RadiusAttribute::string(attr_type::USER_NAME, "alice"),
            RadiusAttribute::string(attr_type::ACCT_SESSION_ID, "sess-42"),
        ];
        let raw = encode_disconnect_request(9, &attrs, secret);

        assert_eq!(raw[0], codes::DISCONNECT_REQUEST);
        assert_eq!(raw[1], 9);
        let len = u16::from_be_bytes([raw[2], raw[3]]) as usize;
        assert_eq!(len, raw.len());

        let decoded = decode_packet(&raw).expect("disconnect packet decodes");
        assert_eq!(decoded.code, codes::DISCONNECT_REQUEST);
        assert_eq!(decoded.identifier, 9);
        assert_eq!(
            decoded
                .attribute(attr_type::USER_NAME)
                .map(RadiusAttribute::as_str),
            Some("alice".to_string())
        );

        // Recompute MD5(Code + ID + Length + 16*0 + Attributes + Secret)
        let mut hasher = Md5::new();
        hasher.update(&raw[0..4]);
        hasher.update([0u8; 16]);
        hasher.update(&raw[20..]);
        hasher.update(secret);
        let expected: [u8; 16] = hasher.finalize().into();
        assert!(constant_time_eq(&decoded.authenticator, &expected));
    }

    #[test]
    fn verifies_disconnect_ack_and_nak_response_authenticators() {
        let secret = b"testing123";
        let req_auth = [0xA5u8; 16];

        let build_signed_reply = |code: u8| {
            let mut buf = BytesMut::new();
            buf.put_u8(code);
            buf.put_u8(9);
            buf.put_u16(0);
            buf.extend_from_slice(&req_auth);
            RadiusAttribute::string(attr_type::REPLY_MESSAGE, "done").encode(&mut buf);
            let total = buf.len() as u16;
            buf[2..4].copy_from_slice(&total.to_be_bytes());
            let mut hasher = Md5::new();
            hasher.update(&buf[0..4]);
            hasher.update(&req_auth);
            hasher.update(&buf[20..]);
            hasher.update(secret);
            let digest: [u8; 16] = hasher.finalize().into();
            buf[4..20].copy_from_slice(&digest);
            buf.to_vec()
        };

        let ack = build_signed_reply(codes::DISCONNECT_ACK);
        let nak = build_signed_reply(codes::DISCONNECT_NAK);

        assert!(verify_response_authenticator(&ack, &req_auth, secret));
        assert!(verify_response_authenticator(&nak, &req_auth, secret));

        let decoded_ack = decode_packet(&ack).unwrap();
        assert_eq!(decoded_ack.code, codes::DISCONNECT_ACK);
        let decoded_nak = decode_packet(&nak).unwrap();
        assert_eq!(decoded_nak.code, codes::DISCONNECT_NAK);

        // Tampered authenticator / wrong secret / wrong request authenticator must fail.
        let mut tampered = ack.clone();
        tampered[4] ^= 0xFF;
        assert!(!verify_response_authenticator(&tampered, &req_auth, secret));
        assert!(!verify_response_authenticator(
            &ack,
            &req_auth,
            b"bad-secret"
        ));
        let wrong_req_auth = [0x5Au8; 16];
        assert!(!verify_response_authenticator(
            &ack,
            &wrong_req_auth,
            secret
        ));
        assert!(!verify_response_authenticator(
            &ack[..10],
            &req_auth,
            secret
        ));
    }
}
