use super::*;
use std::io::Cursor;

fn event() -> BrowserEventV1 {
    BrowserEventV1 {
        event_id: OpaqueId::parse("event-sentinel").unwrap(),
        sequence: SafeU53::new(1).unwrap(),
        browser_time_ms: SafeU53::new(10).unwrap(),
        kind: BrowserEventKindV1::Visit,
        url: "https://example.com/article".into(),
        title: Some("Disposable article".into()),
        excerpt: None,
        incognito: false,
        credential_context: false,
        excluded: false,
        scope_verified: true,
    }
}
#[test]
fn separate_reference_classes_and_sensitive_scope_fail_closed() {
    assert!(event().validate().is_ok());
    for field in 0..4 {
        let mut changed = event();
        match field {
            0 => changed.incognito = true,
            1 => changed.credential_context = true,
            2 => changed.excluded = true,
            _ => changed.scope_verified = false,
        }
        assert_eq!(changed.validate(), Err(BrowserBridgeError::UnsafeScope));
    }
    for url in [
        "https://example.com/article?token=sentinel",
        "https://example.com/article#secret",
        "https://user:password@example.com/article",
        "file:///private/sentinel",
        "https://example.com/login",
        "https://example.com/%6cogin",
    ] {
        let mut changed = event();
        changed.url = url.into();
        assert!(changed.validate().is_err());
    }
    let mut changed = event();
    changed.excerpt = Some("visit cannot smuggle page content".into());
    assert!(changed.validate().is_err());
    changed.kind = BrowserEventKindV1::Excerpt;
    assert!(changed.validate().is_ok());
    changed.excerpt = Some("Bearer PRIVATE_SENTINEL".into());
    assert!(changed.validate().is_err());
    assert!(!format!("{changed:?}").contains("PRIVATE_SENTINEL"));
}
#[test]
fn frames_are_bounded_and_unknown_authority_fields_reject() {
    let mut bytes = Vec::new();
    write_frame(&mut bytes, b"{\"sentinel\":true}").unwrap();
    assert_eq!(
        read_frame(&mut Cursor::new(bytes)).unwrap(),
        Some(b"{\"sentinel\":true}".to_vec())
    );
    assert!(read_frame(&mut Cursor::new(
        ((MAX_BROWSER_FRAME_BYTES + 1) as u32).to_ne_bytes()
    ))
    .is_err());
    assert!(read_frame(&mut Cursor::new([1, 0])).is_err());
    let frame = serde_json::json!({"protocol":BROWSER_PROTOCOL,"request_id":"request-1","request":{"kind":"status","profile_instance_id":"profile-1","token":"x".repeat(32),"owner_pubkey":"a".repeat(64)}});
    assert!(serde_json::from_value::<BrowserClientFrameV1>(frame).is_err());
    assert!(valid_extension_origin(&format!(
        "chrome-extension://{DEVELOPMENT_EXTENSION_ID}/"
    )));
    assert!(!valid_extension_origin("https://example.com/"));
    assert!(!secret_eq("a".repeat(32).as_str(), "b".repeat(32).as_str()));
}

#[test]
fn a_wrong_origin_or_bridge_capability_never_reaches_host_pairing() {
    use std::os::unix::net::UnixStream;
    use std::sync::atomic::AtomicUsize;
    let origin = format!("chrome-extension://{DEVELOPMENT_EXTENSION_ID}/");
    let capability = "a".repeat(32);
    for wrong_origin in [true, false] {
        let calls = Arc::new(AtomicUsize::new(0));
        let counted = Arc::clone(&calls);
        let callback: BrowserHostCallback = Arc::new(move |_| {
            counted.fetch_add(1, Ordering::SeqCst);
            BrowserResponseV1::Rejected {
                code: BrowserRejectionV1::Unpaired,
            }
        });
        let client = BrowserClientFrameV1 {
            protocol: BROWSER_PROTOCOL.into(),
            request_id: OpaqueId::parse("request-fixture").unwrap(),
            request: BrowserRequestV1::Status {
                profile_instance_id: OpaqueId::parse("profile-fixture").unwrap(),
                token: "x".repeat(32),
            },
        };
        let frame = BrowserBridgeFrameV1 {
            protocol: BROWSER_BRIDGE_PROTOCOL.into(),
            bridge_capability: if wrong_origin {
                capability.clone()
            } else {
                "b".repeat(32)
            },
            caller_origin: if wrong_origin {
                "https://page.example/".into()
            } else {
                origin.clone()
            },
            client,
        };
        let (mut sender, mut receiver) = UnixStream::pair().unwrap();
        write_frame(&mut sender, &serde_json::to_vec(&frame).unwrap()).unwrap();
        serve_one(&mut receiver, &origin, &capability, &callback).unwrap();
        let reply: BrowserReplyFrameV1 =
            serde_json::from_slice(&read_frame(&mut sender).unwrap().unwrap()).unwrap();
        assert!(matches!(
            reply.response,
            BrowserResponseV1::Rejected {
                code: BrowserRejectionV1::Invalid
            }
        ));
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }
}
