//! Desktop-derived authority inputs for one managed runtime session.

pub(super) fn next_managed_session_epoch() -> Result<luca_protocol::SafeU53, String> {
    let random = uuid::Uuid::new_v4().as_u128() as u64;
    let epoch = (random & luca_protocol::JSON_SAFE_INTEGER_MAX).max(1);
    luca_protocol::SafeU53::new(epoch).map_err(|error| error.to_string())
}

pub(super) fn managed_owner_attestation(
    auth_tag_json: Option<&str>,
) -> Result<Option<(luca_protocol::NipOaOwnerAttestationV1, String)>, String> {
    let Some(auth_tag_json) = auth_tag_json else {
        return Ok(None);
    };
    let value: serde_json::Value = serde_json::from_str(auth_tag_json)
        .map_err(|error| format!("invalid managed owner attestation JSON: {error}"))?;
    let values = value
        .as_array()
        .ok_or_else(|| "managed owner attestation must be a JSON tag array".to_string())?;
    if values.len() != 4 || values.first().and_then(serde_json::Value::as_str) != Some("auth") {
        return Err("managed owner attestation must be an exact four-field auth tag".into());
    }
    let typed: luca_protocol::NipOaOwnerAttestationV1 = serde_json::from_value(serde_json::json!({
        "owner_pubkey": values.get(1).and_then(serde_json::Value::as_str),
        "conditions": values.get(2).and_then(serde_json::Value::as_str),
        "signature": values.get(3).and_then(serde_json::Value::as_str),
    }))
    .map_err(|error| format!("invalid managed owner attestation: {error}"))?;
    let typed_json = serde_json::to_string(&typed)
        .map_err(|error| format!("failed to serialize managed owner attestation: {error}"))?;
    Ok(Some((typed, typed_json)))
}
