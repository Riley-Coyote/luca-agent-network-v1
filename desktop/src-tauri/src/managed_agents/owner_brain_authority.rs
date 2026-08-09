use tauri::AppHandle;

pub(super) fn managed_runtime_configuration_sha256(
    spawn_config_hash: u64,
) -> Result<luca_protocol::Hex64, String> {
    use sha2::{Digest, Sha256};
    luca_protocol::Hex64::parse(hex::encode(Sha256::digest(spawn_config_hash.to_be_bytes())))
        .map_err(|error| error.to_string())
}

/// Resolve the exact current managed runtime/model binding used by Brain
/// grants. This is recomputed from trusted native state so renderer input can
/// never choose a provider, model, binding, or egress classification.
pub(crate) fn current_owner_brain_runtime_authority(
    app: &AppHandle,
    resident_pubkey: &luca_protocol::Hex64,
) -> Result<(luca_protocol::Sha256Ref, luca_protocol::ProviderEgressV1), String> {
    use tauri::Manager;

    let records = super::load_managed_agents(app)?;
    let matches = records
        .iter()
        .filter(|record| record.pubkey.eq_ignore_ascii_case(resident_pubkey.as_str()))
        .collect::<Vec<_>>();
    let [record] = matches.as_slice() else {
        return Err(if matches.is_empty() {
            "managed resident is unavailable".to_owned()
        } else {
            "managed resident identity is ambiguous".to_owned()
        });
    };
    let personas = super::load_personas(app)?;
    let teams = super::load_teams(app)?;
    let global = super::load_global_agent_config(app)?;
    let state = app.state::<crate::app_state::AppState>();
    let relay_url = crate::relay::effective_agent_relay_url(
        &record.relay_url,
        &crate::relay::relay_ws_url_with_override(&state),
    );
    let spawn_hash =
        super::spawn_hash::spawn_config_hash(record, &personas, &teams, &relay_url, &global);
    let fingerprint = managed_runtime_configuration_sha256(spawn_hash)?;
    let binding_ref = luca_protocol::Sha256Ref::parse(format!("sha256:{}", fingerprint.as_str()))
        .map_err(|error| format!("invalid managed runtime binding: {error}"))?;

    // V1.2 has no trusted proof that a native/model provider is wholly local.
    // The contract therefore classifies every unknown destination as remote.
    Ok((binding_ref, luca_protocol::ProviderEgressV1::Remote))
}
