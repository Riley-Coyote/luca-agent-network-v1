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

pub(crate) fn for_unedited_definition(
    persona_id: &str,
    pinned_prompt: Option<&str>,
) -> Option<&'static ResidentPack> {
    let pack = match persona_id {
        "builtin:fizz" => &LUCA,
        "builtin:fifty" => &FIFTY,
        "builtin:trinity" => &TRINITY,
        _ => return None,
    };
    (pinned_prompt == Some(pack.soul)).then_some(pack)
}
