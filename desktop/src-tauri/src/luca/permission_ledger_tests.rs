use luca_protocol::{
    ManagedPermissionOptionV1, SafeU53, MANAGED_PERMISSION_PROTOCOL, PERMISSION_RULE_PROTOCOL,
};

use super::*;

fn resident() -> Hex64 {
    Hex64::parse("11".repeat(32)).unwrap()
}

fn request() -> ManagedPermissionRequestV1 {
    ManagedPermissionRequestV1 {
        protocol: MANAGED_PERMISSION_PROTOCOL.into(),
        resident_pubkey: resident(),
        session_epoch: SafeU53::new(4).unwrap(),
        turn_id: OpaqueId::parse("turn-a").unwrap(),
        conversation_id: OpaqueId::parse("conversation-a").unwrap(),
        acp_request_id: "acp-1".into(),
        title: "Synthetic permission".into(),
        tool_call_id: None,
        action_preview: None,
        options: vec![ManagedPermissionOptionV1 {
            option_id: "runtime-allow".into(),
            name: "Allow".into(),
            kind: "allow_once".into(),
        }],
        dispatch_receipt_id: None,
        tool_kind: None,
        activity_kind: None,
        tool_name: None,
        mcp_server: None,
        mcp_tool: None,
        command_token: None,
        command_argv_prefix: Vec::new(),
        command_segments: Vec::new(),
        path: None,
        domain: None,
        write: None,
    }
}

fn project(id: &str, root: &str) -> ProjectRef {
    ProjectRef::Source {
        source_id: OpaqueId::parse(id).unwrap(),
        canonical_root: PathBuf::from(root),
        label: root.rsplit('/').next().unwrap_or(root).to_owned(),
    }
}

/// Build a subject the way [`subject`] does, without the `AppHandle` the
/// project resolution needs: the classification and matcher derivation under
/// test are exactly the ones the real call uses.
fn subject_for(
    request: &ManagedPermissionRequestV1,
    project: Option<ProjectRef>,
) -> PermissionSubject {
    let identity = mcp_identity(request);
    let is_pre_allowed = identity.as_ref().is_some_and(|(family, tool)| {
        inventory_contains(POLYPHONIC_PRE_ALLOWED_TOOLS, family, tool)
    });
    let is_broker_guarded = identity.as_ref().is_some_and(|(family, tool)| {
        inventory_contains(POLYPHONIC_BROKER_GUARDED_TOOLS, family, tool)
    });
    let matchers = derive_matchers(request, identity.as_ref());
    let matcher_names: Vec<String> = matchers
        .iter()
        .map(|matcher| matcher_display_name(request, matcher, is_pre_allowed))
        .collect();
    let inside_project = match (project.as_ref(), request.path.as_deref()) {
        (Some(project), Some(path)) => is_inside(project.canonical_root(), Path::new(path)),
        _ => false,
    };
    // No `AppHandle` here, so there is no app data directory to exclude —
    // exactly what the real `subject()` does when it cannot resolve one.
    let is_free_read = matches!(
        matchers.as_slice(),
        [PermissionMatcherV1::Path { write: false }]
    ) && request
        .path
        .as_deref()
        .is_some_and(|raw| is_free_read_path(Path::new(raw), None));
    PermissionSubject {
        resident: request.resident_pubkey.clone(),
        project,
        display_name: subject_display_name(request, &matcher_names),
        matchers,
        matcher_names,
        is_door: is_door(request, identity.as_ref()),
        is_destructive: is_destructive(request),
        is_free_read,
        is_pre_allowed,
        is_broker_guarded,
        inside_project,
    }
}

fn mcp_request(server: &str, tool: &str) -> ManagedPermissionRequestV1 {
    let mut request = request();
    request.mcp_server = Some(server.into());
    request.mcp_tool = Some(tool.into());
    request.tool_name = Some(tool.into());
    request
}

fn command_request(token: &str, argv_prefix: &[&str]) -> ManagedPermissionRequestV1 {
    let mut request = request();
    request.tool_name = Some("Bash".into());
    request.tool_kind = Some("execute".into());
    request.command_token = Some(token.into());
    request.command_argv_prefix = argv_prefix.iter().map(|word| (*word).to_owned()).collect();
    request
}

/// The shape the harness sends for `ls -la /x; echo "exit=$?"`: several
/// segments and, by the protocol's own rule, no single command token.
fn compound_request(segments: &[(&str, &[&str])]) -> ManagedPermissionRequestV1 {
    let mut request = request();
    request.tool_name = Some("Bash".into());
    request.tool_kind = Some("execute".into());
    request.command_segments = segments
        .iter()
        .map(|(token, argv_prefix)| luca_protocol::CommandSegmentV1 {
            token: (*token).to_owned(),
            argv_prefix: argv_prefix.iter().map(|word| (*word).to_owned()).collect(),
        })
        .collect();
    // The protocol keeps the single-command fields in step with the segments:
    // one segment repeats itself, several leave them empty.
    if let [only] = request.command_segments.as_slice() {
        request.command_token = Some(only.token.clone());
        request.command_argv_prefix = only.argv_prefix.clone();
    }
    request.validate().expect("a bounded compound request");
    request
}

fn command_matcher_of(token: &str, argv_prefix: &[&str]) -> PermissionMatcherV1 {
    PermissionMatcherV1::Command {
        token: token.to_owned(),
        argv_prefix: argv_prefix.iter().map(|word| (*word).to_owned()).collect(),
    }
}

fn path_request(path: &str, write: bool) -> ManagedPermissionRequestV1 {
    let mut request = request();
    request.tool_name = Some("Edit".into());
    request.path = Some(path.into());
    request.write = Some(write);
    request
}

fn rule(
    rule_id: &str,
    scope: PermissionRuleScopeV1,
    matcher: PermissionMatcherV1,
    effect: PermissionEffectV1,
) -> PermissionRuleV1 {
    PermissionRuleV1 {
        protocol: PERMISSION_RULE_PROTOCOL.into(),
        rule_id: OpaqueId::parse(rule_id).unwrap(),
        resident_pubkey: resident(),
        scope,
        matcher,
        effect,
        display_name: "Remembered answer".into(),
        created_at: "2026-09-16T00:00:00Z".into(),
        revoked_at: None,
        last_used_at: None,
        use_count: 0,
    }
}

fn here() -> PermissionRuleScopeV1 {
    PermissionRuleScopeV1::Project {
        source_id: OpaqueId::parse("source-a").unwrap(),
    }
}

fn ask(verdict: &Verdict) -> &PermissionOfferV1 {
    match verdict {
        Verdict::Ask { offer } => offer,
        other => panic!("expected a card, got {other:?}"),
    }
}

#[test]
fn pre_allowed_polyphonic_reads_never_ask() {
    for (family, tool) in POLYPHONIC_PRE_ALLOWED_TOOLS {
        let request = mcp_request(family, tool);
        let subject = subject_for(&request, Some(project("source-a", "/tmp/luca")));
        assert!(subject.is_pre_allowed, "{family} {tool}");
        assert_eq!(
            decide_with(&[], &[], &subject, false),
            Verdict::Allow(AllowReason::PreAllowed),
            "{family} {tool} must never raise a card"
        );
    }
    // The per-install suffix does not change the answer.
    let suffixed = mcp_request("luca-artifacts-0123abcdef45", "artifact_read");
    assert_eq!(
        decide_with(&[], &[], &subject_for(&suffixed, None), false),
        Verdict::Allow(AllowReason::PreAllowed)
    );
}

#[test]
fn broker_guarded_tools_never_raise_a_runtime_card() {
    for (family, tool) in POLYPHONIC_BROKER_GUARDED_TOOLS {
        let request = mcp_request(family, tool);
        let subject = subject_for(&request, Some(project("source-a", "/tmp/luca")));
        assert!(subject.is_broker_guarded, "{family} {tool}");
        assert!(
            !subject.is_pre_allowed,
            "{family} {tool} is not a free read"
        );
        assert_eq!(
            decide_with(&[], &[], &subject, false),
            Verdict::Allow(AllowReason::BrokerGuarded),
            "{family} {tool} is gated by the broker's own confirmation"
        );
    }
}

#[test]
fn destructive_doors_offer_only_once_and_deny() {
    let mut doors = vec![];
    let mut deleting = request();
    deleting.tool_kind = Some("delete".into());
    deleting.tool_name = Some("Delete".into());
    doors.push(deleting);
    for token in DESTRUCTIVE_COMMAND_TOKENS {
        doors.push(command_request(token, &[]));
    }

    for request in &doors {
        let subject = subject_for(request, Some(project("source-a", "/tmp/luca")));
        assert!(subject.is_door, "{:?} is a door", request.tool_name);
        assert!(
            subject.is_destructive,
            "{:?} is destructive",
            request.tool_name
        );
        let verdict = decide_with(&[], &[], &subject, false);
        let offer = ask(&verdict);
        assert!(offer.once && offer.deny);
        assert!(
            !offer.task && !offer.always_here,
            "a destructive door is never remembered"
        );
        assert_eq!(offer.note.as_deref(), Some("This one always asks."));
    }

    // Not remembered even when the owner already answered its matcher for
    // this turn, or wrote a rule naming it — that is the whole point of
    // `is_destructive`.
    let rm = command_request("rm", &[]);
    let subject = subject_for(&rm, Some(project("source-a", "/tmp/luca")));
    let remembered = subject
        .matchers
        .first()
        .cloned()
        .expect("a destructive command still has a matcher");
    let rules = vec![rule(
        "rule-1",
        here(),
        remembered.clone(),
        PermissionEffectV1::Allow,
    )];
    assert!(matches!(
        decide_with(&rules, &[remembered], &subject, false),
        Verdict::Ask { .. }
    ));
}

/// Since beta.13, a door that is not destructive asks the first time, same as
/// anything else, but can be answered "Always" and then stops asking — a
/// resident's own shell, browsing, and messaging someone on the owner's
/// behalf all read the same way once approved.
#[test]
fn non_destructive_doors_ask_first_but_can_be_remembered() {
    let mut doors = vec![
        mcp_request("buzz", "shell"),
        mcp_request("polyphonic-browser", "browse"),
        mcp_request("luca-communications", "communications_send"),
    ];
    let mut view_image = mcp_request("buzz", "view_image");
    view_image.domain = Some("example.com".into());
    doors.push(view_image);

    for request in &doors {
        let subject = subject_for(request, Some(project("source-a", "/tmp/luca")));
        assert!(subject.is_door, "{:?} is a door", request.tool_name);
        assert!(
            !subject.is_destructive,
            "{:?} is not destructive",
            request.tool_name
        );
        let verdict = decide_with(&[], &[], &subject, false);
        let offer = ask(&verdict);
        assert!(offer.once && offer.deny);
        assert!(!offer.task, "\"for this task\" is retired everywhere");
        assert!(
            offer.always_here,
            "{:?} can still be remembered, with a project in view",
            request.tool_name
        );

        // Once the owner says "Always", the same door stops asking.
        let remembered = subject
            .matchers
            .first()
            .cloned()
            .expect("a door still has a matcher");
        let rules = vec![rule(
            "rule-1",
            here(),
            remembered,
            PermissionEffectV1::Allow,
        )];
        assert!(
            matches!(
                decide_with(&rules, &[], &subject, false),
                Verdict::Allow(AllowReason::Rule { .. })
            ),
            "{:?} should stop asking once remembered",
            request.tool_name
        );
    }
}

/// beta.13 P4: "Don't ask me" means every door stops asking too — a
/// destructive one, and one with no matcher a rule could ever be written
/// from — not only the non-destructive, rememberable ones above.
#[test]
fn full_access_silences_even_a_destructive_door() {
    let mut doors = vec![];
    let mut deleting = request();
    deleting.tool_kind = Some("delete".into());
    deleting.tool_name = Some("Delete".into());
    doors.push(deleting);
    for token in DESTRUCTIVE_COMMAND_TOKENS {
        doors.push(command_request(token, &[]));
    }

    for request in &doors {
        let subject = subject_for(request, Some(project("source-a", "/tmp/luca")));
        assert!(subject.is_door, "{:?} is a door", request.tool_name);
        assert!(
            subject.is_destructive,
            "{:?} is destructive",
            request.tool_name
        );
        assert_eq!(
            decide_with(&[], &[], &subject, true),
            Verdict::Allow(AllowReason::FullAccess),
            "{:?} should be silent at Full access",
            request.tool_name
        );
    }
}

/// The non-destructive, rememberable doors are silenced by Full access too —
/// without needing an "Always" rule at all.
#[test]
fn full_access_silences_a_non_destructive_door_without_a_remembered_rule() {
    let doors = vec![
        mcp_request("buzz", "shell"),
        mcp_request("polyphonic-browser", "browse"),
        mcp_request("luca-communications", "communications_send"),
    ];

    for request in &doors {
        let subject = subject_for(request, Some(project("source-a", "/tmp/luca")));
        assert!(subject.is_door, "{:?} is a door", request.tool_name);
        assert_eq!(
            decide_with(&[], &[], &subject, true),
            Verdict::Allow(AllowReason::FullAccess),
            "{:?} should be silent at Full access with no rule remembered",
            request.tool_name
        );
    }
}

/// The one thing Full access does not override: an explicit `Deny` rule.
/// "Don't ask me" silences the asking, never a standing refusal.
#[test]
fn full_access_never_overrides_an_explicit_deny_rule() {
    let asked = mcp_request("buzz", "shell");
    let subject = subject_for(&asked, Some(project("source-a", "/tmp/luca")));
    let denied_matcher = subject
        .matchers
        .first()
        .cloned()
        .expect("shell has a matcher");
    let rules = vec![rule(
        "rule-1",
        here(),
        denied_matcher,
        PermissionEffectV1::Deny,
    )];
    assert!(matches!(
        decide_with(&rules, &[], &subject, true),
        Verdict::Deny { .. }
    ));
}

#[test]
fn native_shell_is_not_a_door_and_never_offers_task() {
    // A runtime's own shell is not a door: it is the ask-once-then-remembered
    // rung, which is the whole point of the ledger.
    let native = command_request("git", &["status"]);
    let native = subject_for(&native, Some(project("source-a", "/tmp/luca")));
    assert!(!native.is_door);
    let verdict = decide_with(&[], &[], &native, false);
    let offer = ask(&verdict);
    assert!(!offer.task && offer.always_here);
}

#[test]
fn command_rule_matches_token_and_argv_prefix_only() {
    let asked = command_request("git", &["status"]);
    let subject = subject_for(&asked, Some(project("source-a", "/tmp/luca")));
    let allow = |matcher| {
        decide_with(
            &[rule("rule-1", here(), matcher, PermissionEffectV1::Allow)],
            &[],
            &subject,
            false,
        )
    };

    // The bare token, and a prefix of the words asked for, both answer.
    for argv_prefix in [Vec::new(), vec!["status".to_owned()]] {
        assert!(matches!(
            allow(PermissionMatcherV1::Command {
                token: "git".into(),
                argv_prefix,
            }),
            Verdict::Allow(AllowReason::Rule { .. })
        ));
    }
    // A different word, a longer prefix, or a different command do not.
    for matcher in [
        PermissionMatcherV1::Command {
            token: "git".into(),
            argv_prefix: vec!["push".into()],
        },
        PermissionMatcherV1::Command {
            token: "git".into(),
            argv_prefix: vec!["status".into(), "--short".into()],
        },
        PermissionMatcherV1::Command {
            token: "gitk".into(),
            argv_prefix: Vec::new(),
        },
        PermissionMatcherV1::Path { write: false },
    ] {
        assert!(
            matches!(allow(matcher.clone()), Verdict::Ask { .. }),
            "{matcher:?} must not answer `git status`"
        );
    }
}

#[test]
fn project_rule_does_not_cross_projects() {
    let asked = command_request("git", &["status"]);
    let matcher = PermissionMatcherV1::Command {
        token: "git".into(),
        argv_prefix: vec!["status".into()],
    };
    let rules = vec![rule("rule-1", here(), matcher, PermissionEffectV1::Allow)];

    let inside = subject_for(&asked, Some(project("source-a", "/tmp/luca")));
    assert!(matches!(
        decide_with(&rules, &[], &inside, false),
        Verdict::Allow(AllowReason::Rule { .. })
    ));

    let elsewhere = subject_for(&asked, Some(project("source-b", "/tmp/other")));
    assert!(
        matches!(
            decide_with(&rules, &[], &elsewhere, false),
            Verdict::Ask { .. }
        ),
        "a rule minted in one project cannot answer a card in another"
    );

    let nowhere = subject_for(&asked, None);
    let verdict = decide_with(&rules, &[], &nowhere, false);
    assert!(matches!(verdict, Verdict::Ask { .. }));
    let offer = ask(&verdict);
    assert!(
        !offer.always_here,
        "with no project there is no here to remember"
    );
    assert!(!offer.task, "\"for this task\" is retired everywhere");
    assert_eq!(
        offer.note.as_deref(),
        Some("There's no project here to remember this in, so Polyphonic can only answer once.")
    );
}

#[test]
fn everywhere_never_allows_commands_or_writes() {
    let everywhere = PermissionRuleScopeV1::Everywhere;

    let running = command_request("git", &["status"]);
    let running = subject_for(&running, Some(project("source-a", "/tmp/luca")));
    assert!(matches!(
        decide_with(
            &[rule(
                "rule-1",
                everywhere.clone(),
                PermissionMatcherV1::Command {
                    token: "git".into(),
                    argv_prefix: Vec::new(),
                },
                PermissionEffectV1::Allow,
            )],
            &[],
            &running,
            false,
        ),
        Verdict::Ask { .. }
    ));

    let temporary = tempfile::tempdir().unwrap();
    let root = std::fs::canonicalize(temporary.path()).unwrap();
    let file = root.join("notes.md");
    let writing = path_request(&file.to_string_lossy(), true);
    let inside = ProjectRef::Source {
        source_id: OpaqueId::parse("source-a").unwrap(),
        canonical_root: root.clone(),
        label: "project".into(),
    };
    let writing = subject_for(&writing, Some(inside.clone()));
    assert!(writing.inside_project);
    assert!(
        matches!(
            decide_with(
                &[rule(
                    "rule-2",
                    everywhere.clone(),
                    PermissionMatcherV1::Path { write: true },
                    PermissionEffectV1::Allow,
                )],
                &[],
                &writing,
                false,
            ),
            Verdict::Ask { .. }
        ),
        "a write may never be remembered everywhere"
    );

    // Reading is the one thing an everywhere rule may say. An ordinary file
    // would already be a free read on its own (see P2), which would prove
    // nothing about the rule under test, so this one is a secret path —
    // never free — to force the decision through the rule instead.
    let secret_file = root.join(".env");
    let reading = path_request(&secret_file.to_string_lossy(), false);
    let reading = subject_for(&reading, Some(inside));
    assert!(matches!(
        decide_with(
            &[rule(
                "rule-3",
                everywhere,
                PermissionMatcherV1::Path { write: false },
                PermissionEffectV1::Allow,
            )],
            &[],
            &reading,
            false,
        ),
        Verdict::Allow(AllowReason::Rule { .. })
    ));
}

#[test]
fn deny_rule_beats_pre_allow() {
    let request = mcp_request("luca-repositories", "repo_read");
    let subject = subject_for(&request, Some(project("source-a", "/tmp/luca")));
    assert!(subject.is_pre_allowed);
    let deny = rule(
        "rule-1",
        here(),
        PermissionMatcherV1::McpTool {
            server_family: "luca-repositories".into(),
            tool: "repo_read".into(),
        },
        PermissionEffectV1::Deny,
    );
    assert_eq!(
        decide_with(std::slice::from_ref(&deny), &[], &subject, false),
        Verdict::Deny {
            reason: "Remembered answer".into()
        }
    );

    // It also beats the turn map and an allow rule for the same matcher.
    let allow = rule(
        "rule-2",
        here(),
        deny.matcher.clone(),
        PermissionEffectV1::Allow,
    );
    let turn = vec![deny.matcher.clone()];
    assert!(matches!(
        decide_with(&[allow, deny.clone()], &turn, &subject, false),
        Verdict::Deny { .. }
    ));

    // A revoked deny is not a deny.
    let mut revoked = deny;
    revoked.revoked_at = Some("2026-09-16T01:00:00Z".into());
    assert_eq!(
        decide_with(&[revoked], &[], &subject, false),
        Verdict::Allow(AllowReason::PreAllowed)
    );
}

#[test]
fn path_rule_requires_inside_project_on_component_boundary() {
    let temporary = tempfile::tempdir().unwrap();
    let root = std::fs::canonicalize(temporary.path()).unwrap();
    let inside_root = root.join("luca");
    let sibling_root = root.join("luca-secrets");
    std::fs::create_dir_all(&inside_root).unwrap();
    std::fs::create_dir_all(&sibling_root).unwrap();

    let project = ProjectRef::Source {
        source_id: OpaqueId::parse("source-a").unwrap(),
        canonical_root: inside_root.clone(),
        label: "luca".into(),
    };
    let rules = vec![rule(
        "rule-1",
        here(),
        PermissionMatcherV1::Path { write: true },
        PermissionEffectV1::Allow,
    )];

    // A file that does not exist yet still resolves lexically.
    let inside = path_request(&inside_root.join("new/notes.md").to_string_lossy(), true);
    let inside = subject_for(&inside, Some(project.clone()));
    assert!(inside.inside_project);
    assert!(matches!(
        decide_with(&rules, &[], &inside, false),
        Verdict::Allow(AllowReason::Rule { .. })
    ));

    // A sibling folder whose name merely starts with the project's does not.
    let sibling = path_request(&sibling_root.join("keys.txt").to_string_lossy(), true);
    let sibling = subject_for(&sibling, Some(project.clone()));
    assert!(
        !sibling.inside_project,
        "containment is measured on component boundaries"
    );
    let verdict = decide_with(&rules, &[], &sibling, false);
    assert!(matches!(verdict, Verdict::Ask { .. }));
    assert!(
        !ask(&verdict).always_here,
        "a path outside the project cannot be remembered here"
    );

    // A path that climbs back out is outside, whatever it spells.
    let climbing = path_request(
        &inside_root
            .join("../luca-secrets/keys.txt")
            .to_string_lossy(),
        true,
    );
    assert!(!subject_for(&climbing, Some(project.clone())).inside_project);

    // A rule that remembers writing also answers reading; the reverse is not
    // true. A secret path, so an ordinary free read (P2) does not mask what
    // this is actually testing.
    let reading = path_request(&inside_root.join(".env").to_string_lossy(), false);
    let reading = subject_for(&reading, Some(project.clone()));
    assert!(matches!(
        decide_with(&rules, &[], &reading, false),
        Verdict::Allow(AllowReason::Rule { .. })
    ));
    let read_only = vec![rule(
        "rule-2",
        here(),
        PermissionMatcherV1::Path { write: false },
        PermissionEffectV1::Allow,
    )];
    assert!(matches!(
        decide_with(&read_only, &[], &inside, false),
        Verdict::Ask { .. }
    ));
}

#[test]
fn mcp_family_matches_across_suffixes() {
    let plain = mcp_request("luca-artifacts", "artifact_update");
    let suffixed = mcp_request("luca-artifacts-0123abcdef45", "artifact_update");
    let reprovisioned = mcp_request("luca-artifacts-ffffffffffff", "artifact_update");
    let expected = PermissionMatcherV1::McpTool {
        server_family: "luca-artifacts".into(),
        tool: "artifact_update".into(),
    };
    for request in [&plain, &suffixed, &reprovisioned] {
        assert_eq!(
            subject_for(request, None).matchers.as_slice(),
            std::slice::from_ref(&expected),
            "the per-install suffix is not part of the family"
        );
    }

    let rules = vec![rule("rule-1", here(), expected, PermissionEffectV1::Allow)];
    let subject = subject_for(&reprovisioned, Some(project("source-a", "/tmp/luca")));
    assert!(matches!(
        decide_with(&rules, &[], &subject, false),
        Verdict::Allow(AllowReason::Rule { .. })
    ));

    // A suffix that is not twelve lowercase hex characters is part of the name.
    let other = mcp_request("luca-artifacts-prod", "artifact_update");
    assert!(matches!(
        decide_with(
            &rules,
            &[],
            &subject_for(&other, Some(project("source-a", "/tmp/luca"))),
            false
        ),
        Verdict::Ask { .. }
    ));
}

#[test]
fn turn_rule_dies_with_session() {
    let _guard = test_global_state_guard();
    let resident = "aa".repeat(32);
    let matcher = PermissionMatcherV1::Command {
        token: "cargo".into(),
        argv_prefix: vec!["test".into()],
    };
    clear_all();

    remember_for_turn(&resident, 4, "turn-a", matcher.clone());
    assert_eq!(turn_hits(&resident, 4, "turn-a"), vec![matcher.clone()]);
    // A different turn, epoch or resident never inherits the answer.
    assert!(turn_hits(&resident, 4, "turn-b").is_empty());
    assert!(turn_hits(&resident, 5, "turn-a").is_empty());
    assert!(turn_hits(&"bb".repeat(32), 4, "turn-a").is_empty());

    let asked = command_request("cargo", &["test"]);
    let subject = subject_for(&asked, Some(project("source-a", "/tmp/luca")));
    assert_eq!(
        decide_with(&[], &turn_hits(&resident, 4, "turn-a"), &subject, false),
        Verdict::Allow(AllowReason::TurnRule)
    );

    end_turn(&resident, 4, "turn-a");
    assert!(turn_hits(&resident, 4, "turn-a").is_empty());

    remember_for_turn(&resident, 4, "turn-c", matcher.clone());
    clear_session(&resident, 4);
    assert!(
        turn_hits(&resident, 4, "turn-c").is_empty(),
        "a replaced session forgets every turn it answered"
    );

    remember_for_turn(&resident, 6, "turn-d", matcher);
    clear_all();
    assert!(turn_hits(&resident, 6, "turn-d").is_empty());
}

#[test]
fn no_matcher_means_once_or_deny_only() {
    let bare = request();
    let subject = subject_for(&bare, Some(project("source-a", "/tmp/luca")));
    assert!(subject.matchers.is_empty());
    let verdict = decide_with(&[], &[], &subject, false);
    let offer = ask(&verdict);
    assert!(offer.once && offer.deny);
    assert!(!offer.task && !offer.always_here);
    assert_eq!(offer.project_label.as_deref(), Some("luca"));
    assert_eq!(
        offer.note.as_deref(),
        Some("Polyphonic can only answer this one once.")
    );

    // A rule can never answer a request with nothing to match on.
    let rules = vec![rule(
        "rule-1",
        here(),
        PermissionMatcherV1::Path { write: false },
        PermissionEffectV1::Allow,
    )];
    assert!(matches!(
        decide_with(&rules, &[], &subject, false),
        Verdict::Ask { .. }
    ));
    // The offer is camelCase on the wire and carries no path, command or host.
    let wire = serde_json::to_value(offer).unwrap();
    assert_eq!(
        wire,
        serde_json::json!({
            "once": true,
            "task": false,
            "alwaysHere": false,
            "deny": true,
            "projectLabel": "luca",
            "note": "Polyphonic can only answer this one once.",
        })
    );
}

#[test]
fn compound_command_needs_every_segment_remembered() {
    let asked = compound_request(&[("ls", &[]), ("echo", &[])]);
    let subject = subject_for(&asked, Some(project("source-a", "/tmp/luca")));
    assert_eq!(
        subject.matchers,
        vec![
            command_matcher_of("ls", &[]),
            command_matcher_of("echo", &[]),
        ]
    );

    // One segment remembered is not the line remembered.
    let only_ls = vec![rule(
        "rule-1",
        here(),
        command_matcher_of("ls", &[]),
        PermissionEffectV1::Allow,
    )];
    let verdict = decide_with(&only_ls, &[], &subject, false);
    assert!(
        matches!(verdict, Verdict::Ask { .. }),
        "a remembered `ls` may not carry an unseen `echo`"
    );
    let offer = ask(&verdict);
    assert!(!offer.task && offer.always_here);
    assert_eq!(offer.remembers, vec!["ls".to_string(), "echo".to_string()]);

    // Both remembered, and the line goes through with no card at all.
    let mut both = only_ls.clone();
    both.push(rule(
        "rule-2",
        here(),
        command_matcher_of("echo", &[]),
        PermissionEffectV1::Allow,
    ));
    match decide_with(&both, &[], &subject, false) {
        Verdict::Allow(AllowReason::Rule {
            rule_ids,
            display_name,
        }) => {
            assert_eq!(rule_ids, vec!["rule-1".to_string(), "rule-2".to_string()]);
            assert_eq!(display_name, "ls and echo");
        }
        other => panic!("expected both rules to answer, got {other:?}"),
    }

    // A turn answer covers one segment and a durable rule the other.
    match decide_with(
        &only_ls,
        &[command_matcher_of("echo", &[])],
        &subject,
        false,
    ) {
        Verdict::Allow(AllowReason::Rule { rule_ids, .. }) => {
            assert_eq!(rule_ids, vec!["rule-1".to_string()]);
        }
        other => panic!("expected a mixed answer, got {other:?}"),
    }
    assert_eq!(
        decide_with(
            &[],
            &[
                command_matcher_of("ls", &[]),
                command_matcher_of("echo", &[]),
            ],
            &subject,
            false,
        ),
        Verdict::Allow(AllowReason::TurnRule)
    );

    // A remembered `git status` still does not answer `git push` in a line.
    let pushing = compound_request(&[("git", &["status"]), ("git", &["push"])]);
    let pushing = subject_for(&pushing, Some(project("source-a", "/tmp/luca")));
    assert!(matches!(
        decide_with(
            &[rule(
                "rule-3",
                here(),
                command_matcher_of("git", &["status"]),
                PermissionEffectV1::Allow,
            )],
            &[],
            &pushing,
            false,
        ),
        Verdict::Ask { .. }
    ));
}

#[test]
fn deny_on_any_segment_wins() {
    let asked = compound_request(&[("ls", &[]), ("curl", &[])]);
    let subject = subject_for(&asked, Some(project("source-a", "/tmp/luca")));
    let rules = vec![
        rule(
            "rule-1",
            here(),
            command_matcher_of("ls", &[]),
            PermissionEffectV1::Allow,
        ),
        rule(
            "rule-2",
            here(),
            command_matcher_of("echo", &[]),
            PermissionEffectV1::Allow,
        ),
        rule(
            "rule-3",
            here(),
            command_matcher_of("curl", &[]),
            PermissionEffectV1::Deny,
        ),
    ];
    assert_eq!(
        decide_with(&rules, &[], &subject, false),
        Verdict::Deny {
            reason: "Remembered answer".into()
        }
    );
    // Even with every segment answered for this turn.
    assert_eq!(
        decide_with(
            &rules,
            &[
                command_matcher_of("ls", &[]),
                command_matcher_of("curl", &[]),
            ],
            &subject,
            false,
        ),
        Verdict::Deny {
            reason: "Remembered answer".into()
        }
    );
}

#[test]
fn single_segment_unchanged() {
    // One segment is exactly the beta.11 single command: same matcher, same
    // offer, same sentence, and the legacy fields still answer on their own.
    let segmented = compound_request(&[("git", &["status"])]);
    let mut legacy = command_request("git", &["status"]);
    legacy.command_segments.clear();

    for asked in [&segmented, &legacy] {
        let subject = subject_for(asked, Some(project("source-a", "/tmp/luca")));
        assert_eq!(
            subject.matchers,
            vec![command_matcher_of("git", &["status"])]
        );
        assert_eq!(subject.display_name, "git status");

        let verdict = decide_with(&[], &[], &subject, false);
        let offer = ask(&verdict);
        assert!(offer.once && offer.deny && !offer.task && offer.always_here);
        assert_eq!(offer.remembers, vec!["git status".to_string()]);
        assert_eq!(offer.note, None);

        let rules = vec![rule(
            "rule-1",
            here(),
            command_matcher_of("git", &[]),
            PermissionEffectV1::Allow,
        )];
        assert_eq!(
            decide_with(&rules, &[], &subject, false),
            Verdict::Allow(AllowReason::Rule {
                rule_ids: vec!["rule-1".into()],
                display_name: "Remembered answer".into(),
            }),
            "one rule answering one thing still reads as that rule"
        );
    }

    // A destructive word anywhere in a line is still a door.
    for asked in [
        compound_request(&[("rm", &[])]),
        compound_request(&[("ls", &[]), ("rm", &[])]),
    ] {
        let subject = subject_for(&asked, Some(project("source-a", "/tmp/luca")));
        assert!(subject.is_door);
        let verdict = decide_with(&[], &[], &subject, false);
        let offer = ask(&verdict);
        assert!(!offer.task && !offer.always_here);
        assert!(offer.remembers.is_empty());
    }
}

#[test]
fn a_remembered_answer_reads_as_a_sentence() {
    /// Every sentence this subject would store, one per thing remembered.
    fn sentences(subject: &PermissionSubject) -> Vec<String> {
        subject
            .asks()
            .map(|(matcher, name)| rule_display_name(subject, matcher, name))
            .collect()
    }

    let running = command_request("git", &["status"]);
    let running = subject_for(&running, Some(project("source-a", "/tmp/luca")));
    assert_eq!(running.display_name, "git status");
    assert_eq!(sentences(&running), vec!["Run git status in luca"]);

    let browsing = {
        let mut request = request();
        request.domain = Some("docs.rs".into());
        subject_for(&request, None)
    };
    assert_eq!(sentences(&browsing), vec!["Visit docs.rs"]);

    let writing = path_request("/tmp/luca/src/main.rs", true);
    let writing = subject_for(&writing, Some(project("source-a", "/tmp/luca")));
    assert_eq!(writing.display_name, "main.rs");
    assert_eq!(sentences(&writing), vec!["Edit main.rs in luca"]);

    // A compound command reads as a list, and stores one plain sentence per
    // segment rather than one sentence naming the whole line.
    let compound = compound_request(&[("ls", &[]), ("echo", &[]), ("cat", &["notes.md"])]);
    let compound = subject_for(&compound, Some(project("source-a", "/tmp/luca")));
    assert_eq!(compound.display_name, "ls, echo and cat notes.md");
    assert_eq!(
        sentences(&compound),
        vec![
            "Run ls in luca",
            "Run echo in luca",
            "Run cat notes.md in luca",
        ]
    );

    // Nothing display-unsafe survives into a sentence a rule would store.
    let mut smuggled = request();
    smuggled.title = "Line\u{202e}one".into();
    smuggled.domain = Some("docs.rs".into());
    let smuggled = subject_for(&smuggled, None);
    for sentence in sentences(&smuggled) {
        assert!(!sentence.contains('\u{202e}'));
        assert!(sentence.len() <= MAX_PERMISSION_RULE_DISPLAY_BYTES);
    }
}

// ── P2: reads are free, except secrets ──────────────────────────────────────

#[test]
fn an_ordinary_read_outside_the_project_never_raises_a_card() {
    let temporary = tempfile::tempdir().unwrap();
    let root = std::fs::canonicalize(temporary.path()).unwrap();
    let file = root.join("README.md");

    // No project at all.
    let reading = path_request(&file.to_string_lossy(), false);
    let subject = subject_for(&reading, None);
    assert!(subject.is_free_read);
    assert_eq!(
        decide_with(&[], &[], &subject, false),
        Verdict::Allow(AllowReason::FreeRead)
    );

    // A project exists, but this file is outside it.
    let elsewhere = ProjectRef::Source {
        source_id: OpaqueId::parse("source-a").unwrap(),
        canonical_root: root.join("other-project"),
        label: "other-project".into(),
    };
    let subject = subject_for(&reading, Some(elsewhere));
    assert!(subject.is_free_read);
    assert_eq!(
        decide_with(&[], &[], &subject, false),
        Verdict::Allow(AllowReason::FreeRead)
    );

    // Writing the very same path is not free.
    let writing = path_request(&file.to_string_lossy(), true);
    let subject = subject_for(&writing, None);
    assert!(!subject.is_free_read);
    assert!(matches!(
        decide_with(&[], &[], &subject, false),
        Verdict::Ask { .. }
    ));
}

#[test]
fn secret_reads_still_raise_a_card_with_once_and_always() {
    let temporary = tempfile::tempdir().unwrap();
    let root = std::fs::canonicalize(temporary.path()).unwrap();
    let ssh_dir = root.join(".ssh");
    std::fs::create_dir_all(&ssh_dir).unwrap();

    for secret in [
        root.join(".env"),
        root.join(".env.local"),
        ssh_dir.join("id_ed25519"),
        root.join("service.pem"),
        root.join("notes").join("team-secrets").join("plan.md"),
    ] {
        let reading = path_request(&secret.to_string_lossy(), false);
        let subject = subject_for(&reading, None);
        assert!(
            !subject.is_free_read,
            "{} should not be a free read",
            secret.display()
        );
        assert!(matches!(
            decide_with(&[], &[], &subject, false),
            Verdict::Ask { .. }
        ));
    }

    // Ordinary files whose names merely resemble a secret are not swept in —
    // matching is on whole path components, not a substring of the joined
    // path.
    for ordinary in [root.join("environment.rs"), root.join("valid_rsa_notes.md")] {
        let reading = path_request(&ordinary.to_string_lossy(), false);
        let subject = subject_for(&reading, None);
        assert!(
            subject.is_free_read,
            "{} should still be a free read",
            ordinary.display()
        );
    }

    // With a project in view, a secret read can still offer Once and Always
    // like any other card — it just is not free.
    let project_ref = ProjectRef::Source {
        source_id: OpaqueId::parse("source-a").unwrap(),
        canonical_root: root.clone(),
        label: "project".into(),
    };
    let reading = path_request(&root.join(".env").to_string_lossy(), false);
    let subject = subject_for(&reading, Some(project_ref));
    assert!(subject.inside_project);
    let verdict = decide_with(&[], &[], &subject, false);
    let offer = ask(&verdict);
    assert!(offer.once && offer.deny && offer.always_here);
    assert_eq!(offer.note, None);
}

#[test]
fn an_unresolvable_path_fails_closed_rather_than_reading_free() {
    // A path with more `..` segments than it has components cannot be
    // resolved lexically; that must never be treated as a safe free read.
    let unresolvable = path_request("../../../escape.txt", false);
    let subject = subject_for(&unresolvable, None);
    assert!(!subject.is_free_read);
}

// ── P3: doors and paths pick the widest scope "Always" can still write ─────

#[test]
fn browsing_with_no_project_can_be_remembered_everywhere() {
    // A `Domain` matcher is read-only by definition, so with no project in
    // view it may still be remembered `Everywhere` — the one case beta.13
    // newly turns on.
    let mut browsing = request();
    browsing.domain = Some("docs.rs".into());
    let subject = subject_for(&browsing, None);
    let verdict = decide_with(&[], &[], &subject, false);
    let offer = ask(&verdict);
    assert!(
        offer.always_here,
        "a read-only, project-less request may still be remembered everywhere"
    );
    assert_eq!(offer.note, None);
}
