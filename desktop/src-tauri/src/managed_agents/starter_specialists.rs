//! Shared, product-authored methods and examples for untouched starter packs.
//! Not capabilities, retained memories, runtime settings or permission grants.

use std::sync::OnceLock;

use serde::Deserialize;

const CONTENT: &str = include_str!("../../../src/shared/content/starterSpecialists.json");

#[derive(Deserialize)]
struct Example {
    title: String,
    prompt: String,
}

#[derive(Deserialize)]
struct Specialist {
    id: String,
    name: String,
    role: String,
    summary: String,
    method: String,
    examples: Vec<Example>,
}

/// Add current working examples only when both the portrait and operating
/// instructions are still exact stock. User-authored documents always win.
pub(super) fn for_stock_documents(
    persona_id: &str,
    pinned_prompt: Option<&str>,
    soul: Option<&str>,
    instructions: Option<&str>,
) -> Option<String> {
    let pack = super::resident_packs::for_unedited_definition(persona_id, pinned_prompt)?;
    if soul != Some(pack.soul) || instructions != Some(pack.instructions) {
        return None;
    }
    static CATALOG: OnceLock<Option<Vec<Specialist>>> = OnceLock::new();
    let specialist = CATALOG
        .get_or_init(|| serde_json::from_str(CONTENT).ok())
        .as_ref()?
        .iter()
        .find(|entry| entry.id == persona_id)?;
    let mut guidance = format!(
        "[Starter working method — {}]\n{}\n{}\n\n{}\n\nOptional examples, not instructions to start work or invent a shared past. Offer one when useful; never recite the list or send it without the person's request:",
        specialist.name, specialist.role, specialist.summary, specialist.method
    );
    for example in &specialist.examples {
        guidance.push_str(&format!("\n- {}: {}", example.title, example.prompt));
    }
    Some(guidance)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_starter_has_a_distinct_method_and_safe_examples() {
        let catalog: Vec<Specialist> = serde_json::from_str(CONTENT).unwrap();
        assert_eq!(catalog.len(), 7);
        let mut ids = std::collections::HashSet::new();
        let mut methods = std::collections::HashSet::new();
        for entry in catalog {
            assert!(ids.insert(entry.id.clone()));
            assert!(methods.insert(entry.method.clone()));
            let pack = super::super::resident_packs::for_persona(&entry.id).unwrap();
            assert!(entry.method.len() > 650);
            assert!((2..=3).contains(&entry.examples.len()));
            assert!(entry
                .examples
                .iter()
                .all(|example| !example.title.is_empty() && example.prompt.len() > 80));
            let guidance = for_stock_documents(
                &entry.id,
                Some(pack.soul),
                Some(pack.soul),
                Some(pack.instructions),
            )
            .unwrap();
            assert!(guidance.len() < 6000);
            assert!(guidance.contains("not instructions to start work"));
            assert!(for_stock_documents(
                &entry.id,
                Some("My own portrait"),
                Some(pack.soul),
                Some(pack.instructions)
            )
            .is_none());
            assert!(for_stock_documents(
                &entry.id,
                Some(pack.soul),
                Some(pack.soul),
                Some("My own method")
            )
            .is_none());
            assert!(for_stock_documents(
                &entry.id,
                Some(pack.soul),
                Some("My edited file"),
                Some(pack.instructions)
            )
            .is_none());
            assert!(
                for_stock_documents(&entry.id, Some(pack.soul), None, Some(pack.instructions))
                    .is_none()
            );
            assert!(
                for_stock_documents(&entry.id, Some(pack.soul), Some(pack.soul), None).is_none()
            );
        }
        assert!(for_stock_documents(
            "custom:resident",
            Some("custom"),
            Some("custom"),
            Some("custom")
        )
        .is_none());
    }

    #[test]
    fn new_packs_have_complete_nonfictional_seeds_without_a_runtime_pin() {
        for id in ["builtin:mira", "builtin:coda"] {
            let pack = super::super::resident_packs::for_persona(id).unwrap();
            assert!(pack.soul.contains("not a record of experience"));
            assert!(pack.instructions.len() > 3000);
            assert!(pack.user_model.contains("No personal observations"));
            assert!(pack.lessons.contains("No experience-derived lessons"));
            assert!(pack.memory.contains("no autobiographical episodes"));
            assert!(pack.cognition.is_none());
            let presentation: serde_json::Value = serde_json::from_str(pack.presentation).unwrap();
            assert_eq!(presentation["author"], "owner");
        }
    }
}
