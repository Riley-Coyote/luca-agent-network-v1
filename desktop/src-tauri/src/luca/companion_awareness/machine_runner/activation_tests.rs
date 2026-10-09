//! Pure signals/control state. No helper process or workspace notification runs.
use super::*;
fn key(source:&str)->AwarenessGrantKeyV1 {AwarenessGrantKeyV1 {source:crate::luca::companion_awareness::AwarenessSourceKeyV1 {
    owner_pubkey:Hex64::parse("11".repeat(32)).unwrap(),source_id:OpaqueId::parse(source).unwrap(),device_id:OpaqueId::parse("internal-device").unwrap()},resident_pubkey:Hex64::parse("22".repeat(32)).unwrap()}}
#[test]
fn fixed_notification_framing_is_bounded_and_contains_no_context() {
    let mut parser=SignalParser::default();assert!(!parser.feed(b"1").unwrap());assert!(parser.feed(b"\n1\n").unwrap());
    assert!(parser.feed(b"{\"bundle_id\":\"private\"}").is_err());
    let mut bounded=SignalParser::default();assert!(bounded.feed(&b"1\n".repeat(MAX_MACHINE_REPLY_BYTES/2)).unwrap());assert!(bounded.feed(b"1\n").is_err());
}
#[test]
fn exact_stream_stop_discards_dirty_without_claiming_native_terminal() {
    let scope=key("metadata-source");let watcher=MachineActivationWatcherV1 {key:scope.clone(),control:Arc::new(Control::default())};
    watcher.control.dirty.store(true,Ordering::Release);assert!(!watcher.take_changed(&key("other-source")));
    assert!(watcher.take_changed(&scope));watcher.control.dirty.store(true,Ordering::Release);
    assert!(!watcher.cancel_grant(&key("other-source")));assert!(watcher.cancel_grant(&scope));
    assert!(!watcher.take_changed(&scope));assert!(watcher.status().cancel_requested);assert!(!watcher.status().terminal_seen);
    assert!(!watcher.wait_terminal(&scope,Instant::now()));watcher.control.terminal.store(true,Ordering::Release);
    assert!(watcher.wait_terminal(&scope,Instant::now()));
}
