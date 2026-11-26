//! Library target for the moonwitness-isp Rust runtime.
//!
//! Exposes the versioned Go-to-Rust control contract so integration tests
//! (apps/isp/tests/*) can validate JSON fixtures against the real serde
//! structs and validation rules without touching the binary entry point
//! (apps/isp/src/main.rs, which carries the only `mod control_contract;` edit).

pub mod control_contract;
