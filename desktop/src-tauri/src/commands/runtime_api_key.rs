//! Local Settings-only Claude API connection. No credential is returned over IPC.
use crate::{app_state::AppState, managed_agents::anthropic_auth as auth};
use serde::Serialize;
use tauri::{AppHandle, Manager};
use zeroize::Zeroizing;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeApiConnectionStatus {
    connected: bool,
}

#[tauri::command]
pub async fn get_claude_api_connection(
    app: AppHandle,
) -> Result<ClaudeApiConnectionStatus, String> {
    tokio::task::spawn_blocking(move || {
        Ok(ClaudeApiConnectionStatus {
            connected: auth::connection(&app, &auth::owner(&app)?)?.is_some(),
        })
    })
    .await
    .map_err(|_| "Could not read Claude API connection")?
}

#[tauri::command]
pub async fn connect_claude_api_key(
    app: AppHandle,
    api_key: String,
) -> Result<ClaudeApiConnectionStatus, String> {
    let api_key = Zeroizing::new(api_key);
    auth::validate_input(&api_key)?;
    let owner = auth::owner(&app)?;
    // Never follow a redirect, return a provider body, or include request errors
    // (which can contain headers) in IPC/logs. This probe generates no text.
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|_| "Could not create secure connection")?;
    let response = client
        .get("https://api.anthropic.com/v1/models?limit=1")
        .header("x-api-key", api_key.as_str())
        .header("anthropic-version", "2023-06-01")
        .send()
        .await
        .map_err(|_| "Could not reach Anthropic. Check your connection and try again.")?;
    validation_result(response.status().as_u16())?;
    let app_write = app.clone();
    let saved_owner = owner.clone();
    let generation = tokio::task::spawn_blocking(move || {
        if auth::owner(&app_write)? != saved_owner {
            return Err("Account changed. Connect again.".into());
        }
        auth::save(&app_write, &saved_owner, &api_key).map(|c| c.generation)
    })
    .await
    .map_err(|_| "Could not save Claude API connection")??;
    reconnect_managed_claude(app, owner, Some(generation));
    Ok(ClaudeApiConnectionStatus { connected: true })
}

#[tauri::command]
pub async fn disconnect_claude_api_key(
    app: AppHandle,
) -> Result<ClaudeApiConnectionStatus, String> {
    let owner = auth::owner(&app)?;
    let app_write = app.clone();
    let saved_owner = owner.clone();
    tokio::task::spawn_blocking(move || {
        if auth::owner(&app_write)? != saved_owner {
            return Err("Account changed. Try again.".into());
        }
        auth::disconnect(&app_write, &saved_owner)
    })
    .await
    .map_err(|_| "Could not disconnect Claude API billing")??;
    reconnect_managed_claude(app, owner, None);
    Ok(ClaudeApiConnectionStatus { connected: false })
}

fn validation_result(status: u16) -> Result<(), String> {
    match status {
        200..=299 => Ok(()),
        401 => Err("Anthropic didn’t accept that key. Check it and try again.".into()),
        402 => Err("This Anthropic account needs API credits.".into()),
        403 => Err("This key isn’t allowed to access the Anthropic API.".into()),
        429 => Err("Anthropic is rate-limiting requests. Try connecting again shortly.".into()),
        _ => {
            Err("Anthropic couldn’t verify the key. Your previous connection is unchanged.".into())
        }
    }
}

fn reconnect_managed_claude(app: AppHandle, owner: String, generation: Option<String>) {
    // The existing stop authority checks pending AND active dispatches under
    // the store lock. Never interrupt work to change billing. Restarting the
    // desktop also naturally applies the saved choice, without a durable queue.
    tauri::async_runtime::spawn(async move {
        let snapshot = {
            let records = crate::managed_agents::load_managed_agents(&app).unwrap_or_default();
            let personas = crate::managed_agents::load_personas(&app).unwrap_or_default();
            records
                .into_iter()
                .filter(|r| {
                    r.backend == crate::managed_agents::BackendKind::Local
                        && r.runtime_pid.is_some()
                        && auth::uses_claude(
                            &crate::managed_agents::record_agent_command(r, &personas),
                            r.native_runtime_binding.is_some(),
                        )
                })
                .filter_map(|r| r.runtime_pid.map(|pid| (r.pubkey, pid)))
                .collect::<Vec<_>>()
        };
        for (pubkey, pid) in snapshot {
            let app = app.clone();
            let owner = owner.clone();
            let generation = generation.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    let Ok(current) = auth::connection(&app, &owner) else {
                        break;
                    };
                    let current = current.map(|c| c.generation);
                    if auth::owner(&app).ok().as_deref() != Some(&owner) || current != generation {
                        break;
                    }
                    match super::agents::try_stop_managed_agent_for_connection(
                        pubkey.clone(),
                        app.clone(),
                        Some(pid),
                    )
                    .await
                    {
                        Ok(Some(_)) => {
                            let state = app.state::<AppState>();
                            if super::agents::start_local_agent_with_preflight(
                                &app, &state, &pubkey, &owner, false,
                            )
                            .await
                            .is_err()
                            {
                                luca_log!(warn, "Claude API connection saved; a managed agent could not reconnect. Its normal status reports the failure.");
                            }
                            break;
                        }
                        Ok(None) => tokio::time::sleep(std::time::Duration::from_secs(5)).await,
                        Err(_) => break,
                    }
                }
            });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validation_errors_are_bounded_and_do_not_echo_provider_content() {
        assert!(validation_result(200).is_ok());
        for status in [301, 400, 401, 402, 403, 429, 500] {
            let error = validation_result(status).unwrap_err();
            assert!(error.len() < 160);
            assert!(!error.contains("sk-ant"));
        }
    }
    #[test]
    fn ipc_status_has_no_secret_or_key_suffix() {
        assert_eq!(
            serde_json::to_string(&ClaudeApiConnectionStatus { connected: true }).unwrap(),
            r#"{"connected":true}"#
        );
    }
}
