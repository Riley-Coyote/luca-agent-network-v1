import type { Page } from "@playwright/test";

/**
 * A huddle staged in the mock bridge, for the huddle bar's frame spec
 * (SHELL_BUILD.md, WP-08e). The bridge answers no huddle command, so the bar
 * never shows in a browser; this stands in for the Rust huddle in the page
 * itself, before the app boots, so the base build (which has none of this
 * package's code) can be staged the same way for the hash comparison.
 *
 * It wraps `__TAURI_INTERNALS__.invoke` (which `@tauri-apps/api/core` reads
 * on every call) the moment the bridge installs it: the huddle's commands
 * are answered here, as the Rust side would, and every other command goes on
 * to the bridge. State changes are announced as `huddle-state-changed`, the
 * event the bar listens to. Every huddle command is recorded in
 * `window.__HUDDLE_STAGE__.calls`.
 */

export type StagedHuddleState = {
  phase:
    | "idle"
    | "creating"
    | "connecting"
    | "connected"
    | "active"
    | "leaving";
  parent_channel_id: string | null;
  ephemeral_channel_id: string | null;
  participants: string[];
  agent_pubkeys: string[];
  tts_enabled: boolean;
  transcription_enabled: boolean;
  is_creator: boolean;
  voice_input_mode: "push_to_talk" | "voice_activity";
};

export type HuddleStage = {
  state: StagedHuddleState;
  /** Who is in the huddle the moment it starts, before the member list. */
  participantsOnJoin: string[];
  calls: { command: string; payload: unknown }[];
};

declare global {
  interface Window {
    __HUDDLE_STAGE__?: HuddleStage;
  }
}

export async function installHuddleStage(page: Page) {
  await page.addInitScript(() => {
    const idle = {
      phase: "idle",
      parent_channel_id: null,
      ephemeral_channel_id: null,
      participants: [],
      agent_pubkeys: [],
      tts_enabled: true,
      transcription_enabled: false,
      is_creator: false,
      voice_input_mode: "voice_activity",
    } as StagedHuddleState;
    const stage: HuddleStage = {
      state: { ...idle },
      participantsOnJoin: [],
      calls: [],
    };
    window.__HUDDLE_STAGE__ = stage;

    type Invoke = (
      command: string,
      payload?: unknown,
      options?: unknown,
    ) => Promise<unknown>;

    const announce = (real: Invoke) =>
      real("plugin:event|emit", {
        event: "huddle-state-changed",
        payload: { ...stage.state },
      });

    const answer = async (
      real: Invoke,
      command: string,
      payload: unknown,
    ): Promise<{ handled: boolean; value?: unknown }> => {
      const args = (payload ?? {}) as Record<string, unknown>;
      switch (command) {
        case "get_huddle_state":
          return { handled: true, value: { ...stage.state } };
        case "start_huddle":
        case "join_huddle": {
          const ephemeral =
            (args.ephemeralChannelId as string | undefined) ??
            "4f1d7a8e-0b9c-4c2a-9d3e-5a6b7c8d9e0f";
          const members = (args.memberPubkeys as string[] | undefined) ?? [];
          stage.state = {
            ...stage.state,
            phase: "connected",
            participants: [...stage.participantsOnJoin, ...members],
            parent_channel_id: (args.parentChannelId as string) ?? null,
            ephemeral_channel_id: ephemeral,
            is_creator: command === "start_huddle",
          };
          return { handled: true, value: { ephemeral_channel_id: ephemeral } };
        }
        case "confirm_huddle_active":
          stage.state = { ...stage.state, phase: "active" };
          void announce(real);
          return { handled: true, value: null };
        case "leave_huddle":
        case "end_huddle":
          stage.state = { ...idle };
          void announce(real);
          return { handled: true, value: null };
        case "set_tts_enabled":
          stage.state = { ...stage.state, tts_enabled: Boolean(args.enabled) };
          return { handled: true, value: null };
        case "set_huddle_transcription_enabled":
          stage.state = {
            ...stage.state,
            transcription_enabled: Boolean(args.enabled),
          };
          return { handled: true, value: null };
        case "get_huddle_agent_pubkeys":
          return { handled: true, value: [...stage.state.agent_pubkeys] };
        case "get_model_status":
          return { handled: true, value: { stt: "ready", tts: "ready" } };
        case "add_agent_to_huddle": {
          const pubkey = String(args.agentPubkey ?? "");
          stage.state = {
            ...stage.state,
            agent_pubkeys: [...stage.state.agent_pubkeys, pubkey],
            participants: [...stage.state.participants, pubkey],
          };
          return {
            handled: true,
            value: {
              ephemeral_added: true,
              parent_added: true,
              parent_error: null,
            },
          };
        }
        case "get_voice_input_mode":
          return { handled: true, value: stage.state.voice_input_mode };
        case "set_voice_input_mode":
          stage.state = {
            ...stage.state,
            voice_input_mode:
              args.mode as StagedHuddleState["voice_input_mode"],
          };
          return { handled: true, value: null };
        case "list_audio_output_devices":
          return {
            handled: true,
            value: [{ name: "MacBook Pro Speakers", is_default: true }],
          };
        case "get_audio_output_device":
          return { handled: true, value: "MacBook Pro Speakers" };
        case "set_audio_output_device":
        case "push_audio_pcm":
        case "check_pipeline_hotstart":
        case "reconnect_huddle_audio":
          return { handled: true, value: null };
        default:
          return { handled: false };
      }
    };

    const wrap = (internals: Record<string, unknown>) => {
      let real: Invoke | undefined;
      const wrapper: Invoke = async (command, payload, options) => {
        if (!real) throw new Error("no invoke yet");
        const result = await answer(real, command, payload);
        if (result.handled) {
          if (command !== "push_audio_pcm") {
            stage.calls.push({ command, payload });
          }
          return result.value;
        }
        return real(command, payload, options);
      };
      Object.defineProperty(internals, "invoke", {
        configurable: true,
        enumerable: true,
        get: () => (real ? wrapper : undefined),
        set: (value: Invoke) => {
          real = value;
        },
      });
    };

    let internals: Record<string, unknown> | undefined;
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      get: () => internals,
      set: (value: Record<string, unknown>) => {
        internals = value;
        if (value && typeof value === "object") wrap(value);
      },
    });
  });
}

/** A live huddle, as the Rust side announces one: the bar shows on it. */
export async function announceHuddle(
  page: Page,
  state: Partial<StagedHuddleState>,
) {
  await page.evaluate((state) => {
    const stage = window.__HUDDLE_STAGE__;
    if (!stage) throw new Error("no huddle stage");
    stage.state = { ...stage.state, ...state };
    void (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (command: string, payload: unknown) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__.invoke("plugin:event|emit", {
      event: "huddle-state-changed",
      payload: { ...stage.state },
    });
  }, state);
}
