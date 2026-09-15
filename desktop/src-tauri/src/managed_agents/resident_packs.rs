//! Reviewed, bundled document sets for the three starter residents.
//!
//! A pack is eligible only while the linked definition still pins its exact
//! bundled soul. A user-edited definition must not regain stock identity files.

pub(crate) struct ResidentPack {
    pub soul: &'static str,
    pub convictions: &'static str,
    pub self_model: &'static str,
    pub user_model: &'static str,
    pub lessons: &'static str,
    pub instructions: &'static str,
    pub identity: &'static str,
    pub agents: &'static str,
    pub memory: &'static str,
    pub relationship: &'static str,
    pub examples: &'static str,
    pub presentation: &'static str,
    pub cognition: Option<&'static str>,
}

pub(crate) const LUCA: ResidentPack = ResidentPack {
    soul: include_str!("../../resident-packs/luca/soul.md"),
    convictions: include_str!("../../resident-packs/luca/convictions.md"),
    self_model: include_str!("../../resident-packs/luca/self-model.md"),
    user_model: include_str!("../../resident-packs/luca/user-model.md"),
    lessons: include_str!("../../resident-packs/luca/lessons.md"),
    instructions: include_str!("../../resident-packs/luca/instructions.md"),
    identity: include_str!("../../resident-packs/luca/IDENTITY.md"),
    agents: include_str!("../../resident-packs/luca/AGENTS.md"),
    memory: include_str!("../../resident-packs/luca/MEMORY.md"),
    relationship: include_str!("../../resident-packs/luca/relationship.md"),
    examples: include_str!("../../resident-packs/luca/examples.md"),
    presentation: include_str!("../../resident-packs/luca/presentation.json"),
    cognition: None,
};

pub(crate) const FIFTY: ResidentPack = ResidentPack {
    soul: include_str!("../../resident-packs/fifty/soul.md"),
    convictions: include_str!("../../resident-packs/fifty/convictions.md"),
    self_model: include_str!("../../resident-packs/fifty/self-model.md"),
    user_model: include_str!("../../resident-packs/fifty/user-model.md"),
    lessons: include_str!("../../resident-packs/fifty/lessons.md"),
    instructions: include_str!("../../resident-packs/fifty/instructions.md"),
    identity: include_str!("../../resident-packs/fifty/IDENTITY.md"),
    agents: include_str!("../../resident-packs/fifty/AGENTS.md"),
    memory: include_str!("../../resident-packs/fifty/MEMORY.md"),
    relationship: include_str!("../../resident-packs/fifty/relationship.md"),
    examples: include_str!("../../resident-packs/fifty/examples.md"),
    presentation: include_str!("../../resident-packs/fifty/presentation.json"),
    cognition: None,
};

pub(crate) const TRINITY: ResidentPack = ResidentPack {
    soul: include_str!("../../resident-packs/trinity/soul.md"),
    convictions: include_str!("../../resident-packs/trinity/convictions.md"),
    self_model: include_str!("../../resident-packs/trinity/self-model.md"),
    user_model: include_str!("../../resident-packs/trinity/user-model.md"),
    lessons: include_str!("../../resident-packs/trinity/lessons.md"),
    instructions: include_str!("../../resident-packs/trinity/instructions.md"),
    identity: include_str!("../../resident-packs/trinity/IDENTITY.md"),
    agents: include_str!("../../resident-packs/trinity/AGENTS.md"),
    memory: include_str!("../../resident-packs/trinity/MEMORY.md"),
    relationship: include_str!("../../resident-packs/trinity/relationship.md"),
    examples: include_str!("../../resident-packs/trinity/examples.md"),
    presentation: include_str!("../../resident-packs/trinity/presentation.json"),
    cognition: Some(include_str!("../../resident-packs/trinity/cognition.md")),
};

/// One earlier edition of a built-in's founding documents — the four files
/// that say who a resident is, as some previous build shipped them.
///
/// They are kept verbatim because recognition needs the exact bytes: while a
/// resident's `IDENTITY.md` still matches one of these, nobody has written
/// into it and a newer edition may replace it. One word of difference and
/// the file belongs to whoever wrote that word.
pub(crate) struct FoundingEdition {
    pub soul: &'static str,
    pub convictions: &'static str,
    pub self_model: &'static str,
    pub identity: &'static str,
}

/// 2026-09-13 — the owner-authored founding portraits, superseded on
/// 2026-09-15 by documents each resident wrote for itself in the first
/// person.
pub(crate) const LUCA_2026_09_13: FoundingEdition = FoundingEdition {
    soul: include_str!("../../resident-packs/luca/archive/soul-2026-09-13.md"),
    convictions: include_str!("../../resident-packs/luca/archive/convictions-2026-09-13.md"),
    self_model: include_str!("../../resident-packs/luca/archive/self-model-2026-09-13.md"),
    identity: include_str!("../../resident-packs/luca/archive/IDENTITY-2026-09-13.md"),
};

pub(crate) const FIFTY_2026_09_13: FoundingEdition = FoundingEdition {
    soul: include_str!("../../resident-packs/fifty/archive/soul-2026-09-13.md"),
    convictions: include_str!("../../resident-packs/fifty/archive/convictions-2026-09-13.md"),
    self_model: include_str!("../../resident-packs/fifty/archive/self-model-2026-09-13.md"),
    identity: include_str!("../../resident-packs/fifty/archive/IDENTITY-2026-09-13.md"),
};

pub(crate) const TRINITY_2026_09_13: FoundingEdition = FoundingEdition {
    soul: include_str!("../../resident-packs/trinity/archive/soul-2026-09-13.md"),
    convictions: include_str!("../../resident-packs/trinity/archive/convictions-2026-09-13.md"),
    self_model: include_str!("../../resident-packs/trinity/archive/self-model-2026-09-13.md"),
    identity: include_str!("../../resident-packs/trinity/archive/IDENTITY-2026-09-13.md"),
};

const LUCA_PREVIOUS: &[FoundingEdition] = &[LUCA_2026_09_13];
const FIFTY_PREVIOUS: &[FoundingEdition] = &[FIFTY_2026_09_13];
const TRINITY_PREVIOUS: &[FoundingEdition] = &[TRINITY_2026_09_13];

/// The pack this build bundles for a built-in persona, whatever the stored
/// definition currently pins. [`for_unedited_definition`] asks the stricter
/// question — whether the definition is still the one we shipped.
pub(crate) fn for_persona(persona_id: &str) -> Option<&'static ResidentPack> {
    match persona_id {
        "builtin:fizz" => Some(&LUCA),
        "builtin:fifty" => Some(&FIFTY),
        "builtin:trinity" => Some(&TRINITY),
        _ => None,
    }
}

/// Every earlier edition of a built-in's founding documents, oldest first.
pub(crate) fn previous_editions(persona_id: &str) -> &'static [FoundingEdition] {
    match persona_id {
        "builtin:fizz" => LUCA_PREVIOUS,
        "builtin:fifty" => FIFTY_PREVIOUS,
        "builtin:trinity" => TRINITY_PREVIOUS,
        _ => &[],
    }
}

pub(crate) fn for_unedited_definition(
    persona_id: &str,
    pinned_prompt: Option<&str>,
) -> Option<&'static ResidentPack> {
    let pack = for_persona(persona_id)?;
    (pinned_prompt == Some(pack.soul)).then_some(pack)
}
