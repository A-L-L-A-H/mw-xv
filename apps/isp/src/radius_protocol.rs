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
    pub const CALLED_STATION_ID: u8 = 30;
    pub const CALLING_STATION_ID: u8 = 31;
    pub const ACCT_STATUS_TYPE: u8 = 40;
    pub const ACCT_INPUT_OCTETS: u8 = 42;
    pub const ACCT_OUTPUT_OCTETS: u8 = 43;
    pub const ACCT_SESSION_ID: u8 = 44;
    pub const ACCT_SESSION_TIME: u8 = 46;
    pub const ACCT_TERMINATE_CAUSE: u8 = 49;
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
        self.attributes.iter().find(|attr| attr.attr_type == attr_type)
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
    if encrypted.is_empty() || encrypted.len() % 16 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(encrypted.len());
    let mut prev_block = request_authenticator.as_slice();

    for chunk in encrypted.chunks_exact(16) {
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
pub fn encrypt_pap_password(
    password: &str,
    request_authenticator: &[u8; 16],
    secret: &[u8],
) -> Vec<u8> {
    let raw = password.as_bytes();
    let padded_len = ((raw.len().max(1) + 15) / 16) * 16;
    let mut padded = vec![0u8; padded_len];
    padded[..raw.len()].copy_from_slice(raw);

    let mut out = Vec::with_capacity(padded_len);
    let mut prev_block = *request_authenticator;
    for chunk in padded.chunks_exact(16) {
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
            decoded.attribute(attr_type::USER_NAME).map(RadiusAttribute::as_str),
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
}
