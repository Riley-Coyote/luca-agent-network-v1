//! Strict input parsing and RFC 8785 canonical serialization.

use serde::de::{DeserializeSeed, Deserializer, MapAccess, SeqAccess, Visitor};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fmt;

/// Errors produced while parsing or canonicalizing Luca protocol JSON.
#[derive(Debug, thiserror::Error)]
pub enum CanonicalError {
    /// Input exceeded its caller-owned byte limit.
    #[error("JSON input exceeds {limit} bytes")]
    InputTooLarge { limit: usize },
    /// Input was not strict RFC 8259/I-JSON.
    #[error("invalid strict JSON: {0}")]
    InvalidJson(String),
    /// Canonical serialization failed.
    #[error("RFC 8785 serialization failed: {0}")]
    Serialization(#[from] serde_json::Error),
}

/// Parse JSON without accepting duplicate object members or trailing data.
pub fn parse_strict_json(bytes: &[u8], max_bytes: usize) -> Result<Value, CanonicalError> {
    if bytes.len() > max_bytes {
        return Err(CanonicalError::InputTooLarge { limit: max_bytes });
    }

    struct StrictValue;

    impl<'de> DeserializeSeed<'de> for StrictValue {
        type Value = Value;

        fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<Value, D::Error> {
            deserializer.deserialize_any(self)
        }
    }

    impl<'de> Visitor<'de> for StrictValue {
        type Value = Value;

        fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter.write_str("strict JSON with unique object member names")
        }

        fn visit_bool<E>(self, value: bool) -> Result<Value, E> {
            Ok(Value::Bool(value))
        }

        fn visit_i64<E>(self, value: i64) -> Result<Value, E> {
            Ok(Value::Number(value.into()))
        }

        fn visit_u64<E>(self, value: u64) -> Result<Value, E> {
            Ok(Value::Number(value.into()))
        }

        fn visit_f64<E: serde::de::Error>(self, value: f64) -> Result<Value, E> {
            serde_json::Number::from_f64(value)
                .map(Value::Number)
                .ok_or_else(|| E::custom("non-finite number"))
        }

        fn visit_str<E>(self, value: &str) -> Result<Value, E> {
            Ok(Value::String(value.to_owned()))
        }

        fn visit_string<E>(self, value: String) -> Result<Value, E> {
            Ok(Value::String(value))
        }

        fn visit_unit<E>(self) -> Result<Value, E> {
            Ok(Value::Null)
        }

        fn visit_none<E>(self) -> Result<Value, E> {
            Ok(Value::Null)
        }

        fn visit_some<D: Deserializer<'de>>(self, deserializer: D) -> Result<Value, D::Error> {
            deserializer.deserialize_any(self)
        }

        fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> Result<Value, A::Error> {
            let mut values = Vec::with_capacity(sequence.size_hint().unwrap_or(0));
            while let Some(value) = sequence.next_element_seed(StrictValue)? {
                values.push(value);
            }
            Ok(Value::Array(values))
        }

        fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Value, A::Error> {
            use serde::de::Error;

            let mut seen = HashSet::new();
            let mut values = serde_json::Map::new();
            while let Some(key) = map.next_key::<String>()? {
                if !seen.insert(key.clone()) {
                    return Err(A::Error::custom(format!(
                        "duplicate object member name: {key}"
                    )));
                }
                values.insert(key, map.next_value_seed(StrictValue)?);
            }
            Ok(Value::Object(values))
        }
    }

    let mut deserializer = serde_json::Deserializer::from_slice(bytes);
    let value = StrictValue
        .deserialize(&mut deserializer)
        .map_err(|error| CanonicalError::InvalidJson(error.to_string()))?;
    deserializer
        .end()
        .map_err(|error| CanonicalError::InvalidJson(error.to_string()))?;
    Ok(value)
}

/// Serialize a value as RFC 8785 UTF-8 bytes.
pub fn canonicalize<T: Serialize>(value: &T) -> Result<Vec<u8>, CanonicalError> {
    serde_json_canonicalizer::to_vec(value).map_err(CanonicalError::Serialization)
}

/// Strictly parse and RFC 8785-canonicalize raw JSON.
pub fn parse_and_canonicalize_strict(
    bytes: &[u8],
    max_bytes: usize,
) -> Result<Vec<u8>, CanonicalError> {
    canonicalize(&parse_strict_json(bytes, max_bytes)?)
}

/// Return lowercase SHA-256 of a value's RFC 8785 bytes.
pub fn canonical_sha256<T: Serialize>(value: &T) -> Result<String, CanonicalError> {
    let bytes = canonicalize(value)?;
    Ok(hex::encode(Sha256::digest(bytes)))
}
