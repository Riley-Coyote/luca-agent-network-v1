//! Direct HKDF-SHA256 namespace-key derivation from the continuity master key.

use std::fmt;

use hkdf::Hkdf;
use luca_continuity::NamespaceKey;
use luca_protocol::{ContinuityNamespaceKindV1, ContinuityNamespaceV1};
use sha2::Sha256;
use zeroize::Zeroizing;

use super::continuity_key_custody::ContinuityMasterKey;

/// Frozen HKDF info-domain for continuity namespace encryption keys.
pub(crate) const NAMESPACE_KEY_DERIVATION_DOMAIN: &str = "luca.continuity.namespace-key.v1";
const DERIVED_KEY_BYTES: usize = 32;

/// Process-local namespace key material with a redacted formatter.
pub(crate) struct ContinuityNamespaceKey(Zeroizing<[u8; DERIVED_KEY_BYTES]>);

impl ContinuityNamespaceKey {
    /// Borrow key material only inside trusted desktop continuity crypto code.
    pub(super) fn as_bytes(&self) -> &[u8; DERIVED_KEY_BYTES] {
        &self.0
    }
}

impl fmt::Debug for ContinuityNamespaceKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ContinuityNamespaceKey([REDACTED])")
    }
}

/// A body-free derivation failure.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum NamespaceKeyDerivationError {
    /// A supposedly validated namespace could not be decoded for derivation.
    InvalidNamespace,
    /// The HKDF output length was rejected.
    OutputLength,
}

impl fmt::Display for NamespaceKeyDerivationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("continuity namespace key derivation failed")
    }
}

impl std::error::Error for NamespaceKeyDerivationError {}

fn append_length_prefixed(
    info: &mut Vec<u8>,
    value: &[u8],
) -> Result<(), NamespaceKeyDerivationError> {
    let length =
        u32::try_from(value.len()).map_err(|_| NamespaceKeyDerivationError::InvalidNamespace)?;
    info.extend_from_slice(&length.to_be_bytes());
    info.extend_from_slice(value);
    Ok(())
}

fn namespace_kind_bytes(kind: ContinuityNamespaceKindV1) -> &'static [u8] {
    match kind {
        ContinuityNamespaceKindV1::OwnerBrain => b"owner_brain",
        ContinuityNamespaceKindV1::ResidentPrivate => b"resident_private",
    }
}

/// Construct the frozen, unambiguous HKDF `info` encoding for a namespace.
fn namespace_derivation_info(
    namespace: &ContinuityNamespaceV1,
) -> Result<Zeroizing<Vec<u8>>, NamespaceKeyDerivationError> {
    let owner = namespace
        .owner_pubkey
        .decode()
        .map_err(|_| NamespaceKeyDerivationError::InvalidNamespace)?;
    let resident = namespace
        .resident_pubkey
        .as_ref()
        .map(|key| key.decode())
        .transpose()
        .map_err(|_| NamespaceKeyDerivationError::InvalidNamespace)?
        .unwrap_or([0_u8; 32]);
    let resident_bytes: &[u8] = if namespace.resident_pubkey.is_some() {
        &resident
    } else {
        &[]
    };

    let mut info = Zeroizing::new(Vec::with_capacity(256));
    append_length_prefixed(&mut info, NAMESPACE_KEY_DERIVATION_DOMAIN.as_bytes())?;
    append_length_prefixed(&mut info, namespace.protocol.as_bytes())?;
    append_length_prefixed(&mut info, &owner)?;
    append_length_prefixed(&mut info, namespace_kind_bytes(namespace.kind))?;
    append_length_prefixed(&mut info, resident_bytes)?;
    append_length_prefixed(&mut info, namespace.namespace_ref.as_str().as_bytes())?;
    info.extend_from_slice(&namespace.key_version.get().to_be_bytes());
    Ok(info)
}

/// Derive exactly one namespace key directly from the root master key.
///
/// This has no scope-key API by design. Every invocation starts at the same
/// master key rather than chaining a prior namespace derivation.
pub(crate) fn derive_namespace_key(
    master_key: &ContinuityMasterKey,
    namespace: &NamespaceKey,
) -> Result<ContinuityNamespaceKey, NamespaceKeyDerivationError> {
    let info = namespace_derivation_info(namespace.as_protocol())?;
    let hkdf = Hkdf::<Sha256>::new(None, master_key.as_bytes());
    let mut output = Zeroizing::new([0_u8; DERIVED_KEY_BYTES]);
    hkdf.expand(&info, output.as_mut())
        .map_err(|_| NamespaceKeyDerivationError::OutputLength)?;
    Ok(ContinuityNamespaceKey(output))
}

#[cfg(test)]
mod tests {
    use luca_protocol::{ContinuityNamespaceKindV1, Hex64, SafeU53, Sha256Ref};

    use super::*;

    fn namespace(
        owner: u8,
        resident: Option<u8>,
        kind: ContinuityNamespaceKindV1,
        reference: u8,
        version: u64,
    ) -> NamespaceKey {
        NamespaceKey::new(ContinuityNamespaceV1 {
            protocol: "luca.continuity.v1".to_owned(),
            owner_pubkey: Hex64::parse(hex::encode([owner; 32])).unwrap(),
            kind,
            resident_pubkey: resident.map(|byte| Hex64::parse(hex::encode([byte; 32])).unwrap()),
            namespace_ref: Sha256Ref::parse(format!("sha256:{}", hex::encode([reference; 32])))
                .unwrap(),
            key_version: SafeU53::new(version).unwrap(),
        })
        .unwrap()
    }

    fn root() -> ContinuityMasterKey {
        ContinuityMasterKey::new_for_test([0x11; 32])
    }

    #[test]
    fn fixed_owner_brain_vector_is_stable() {
        let namespace = namespace(1, None, ContinuityNamespaceKindV1::OwnerBrain, 3, 1);
        let derived = derive_namespace_key(&root(), &namespace).unwrap();
        assert_eq!(
            hex::encode(derived.as_bytes()),
            "b95899b4d8162e2888c197eb1a0729ff3c54f14fac350c45524493e44ed65641"
        );
    }

    #[test]
    fn fixed_resident_private_vector_is_stable() {
        let namespace = namespace(1, Some(2), ContinuityNamespaceKindV1::ResidentPrivate, 3, 7);
        let derived = derive_namespace_key(&root(), &namespace).unwrap();
        assert_eq!(
            hex::encode(derived.as_bytes()),
            "cdc5482944e14c3633a8aa97fabaaa1c61914093aec7928ccf9dcd3c77e8f9c4"
        );
    }

    #[test]
    fn complete_namespace_identity_is_domain_separated() {
        let baseline = namespace(1, None, ContinuityNamespaceKindV1::OwnerBrain, 3, 1);
        let baseline_key = derive_namespace_key(&root(), &baseline).unwrap();
        for changed in [
            namespace(2, None, ContinuityNamespaceKindV1::OwnerBrain, 3, 1),
            namespace(1, Some(2), ContinuityNamespaceKindV1::ResidentPrivate, 3, 1),
            namespace(1, None, ContinuityNamespaceKindV1::OwnerBrain, 4, 1),
            namespace(1, None, ContinuityNamespaceKindV1::OwnerBrain, 3, 2),
        ] {
            assert_ne!(
                baseline_key.as_bytes(),
                derive_namespace_key(&root(), &changed).unwrap().as_bytes()
            );
        }
        assert_eq!(
            baseline_key.as_bytes(),
            derive_namespace_key(&root(), &baseline).unwrap().as_bytes()
        );
    }

    #[test]
    fn derivation_is_direct_from_root_not_a_chained_namespace_key() {
        let first = namespace(1, None, ContinuityNamespaceKindV1::OwnerBrain, 3, 1);
        let second = namespace(1, None, ContinuityNamespaceKindV1::OwnerBrain, 4, 1);
        let expected = derive_namespace_key(&root(), &second).unwrap();
        let intermediate = derive_namespace_key(&root(), &first).unwrap();
        let mut chained_bytes = Zeroizing::new([0_u8; DERIVED_KEY_BYTES]);
        chained_bytes.copy_from_slice(intermediate.as_bytes());
        let chained_root = ContinuityMasterKey::from_zeroizing(chained_bytes);
        let chained = derive_namespace_key(&chained_root, &second).unwrap();
        assert_ne!(expected.as_bytes(), chained.as_bytes());
    }

    #[test]
    fn derived_key_debug_is_redacted() {
        let namespace = namespace(1, None, ContinuityNamespaceKindV1::OwnerBrain, 3, 1);
        let derived = derive_namespace_key(&root(), &namespace).unwrap();
        assert_eq!(format!("{derived:?}"), "ContinuityNamespaceKey([REDACTED])");
        assert!(!format!("{derived:?}").contains("b95899"));
    }

    #[test]
    fn derivation_module_has_no_environment_or_scope_derivation_path() {
        let source = include_str!("continuity_key_derivation.rs");
        assert!(!source.contains(&["std", "::env"].concat()));
        assert!(!source.contains(&["scope", "_key"].concat()));
    }
}
