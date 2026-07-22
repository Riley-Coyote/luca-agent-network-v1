//! Secret-safe diagnostics and artifact scanning primitives for Luca V1.
//!
//! This crate deliberately has a small surface: callers can redact untrusted
//! diagnostic text and classify synthetic sentinels before writing an artifact.
//! It does not retain matched values, construct paths, or expose a way to log a
//! secret. The Python gate scanner uses the same stable classifications.

#![forbid(unsafe_code)]

use regex::Regex;
use std::sync::LazyLock;

/// A value class which is never safe to preserve in a normal diagnostic.
///
/// The string representations are a stable cross-language contract with
/// `scripts/evidence/scan_artifacts.py`.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash)]
pub enum SensitiveClass {
    Secret,
    ProtectedBody,
    AbsolutePath,
}

impl SensitiveClass {
    /// Stable lower-case value used in receipts and tests.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Secret => "secret",
            Self::ProtectedBody => "protected_body",
            Self::AbsolutePath => "absolute_path",
        }
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
struct SensitiveMatch {
    start: usize,
    end: usize,
    class: SensitiveClass,
}

static NSEC_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\bnsec1[023456789acdefghjklmnpqrstuvwxyz]{20,}\b")
        .expect("constant nsec pattern must compile")
});
static ASSIGNMENT_SECRET_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|private[_-]?key|secret|token)\s*[:=]\s*[^\s,;\]\}]+",
    )
    .expect("constant secret assignment pattern must compile")
});
static SYNTHETIC_SECRET_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\bLUCATEST_(?:NSEC|PROVIDER|TOKEN|SECRET)_SENTINEL(?:_[A-Z0-9_]+)?\b")
        .expect("constant synthetic secret pattern must compile")
});
static SYNTHETIC_BODY_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\bLUCATEST_PROTECTED_BODY_SENTINEL(?:_[A-Z0-9_]+)?\b")
        .expect("constant synthetic body pattern must compile")
});
static UNIX_ABSOLUTE_PATH_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"/(?:Users|home|private|var|tmp)/[^\s"'<>]+"#)
        .expect("constant Unix absolute-path pattern must compile")
});
static WINDOWS_ABSOLUTE_PATH_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)\b[a-z]:\\(?:Users|home|private|var|tmp)\\[^\s"'<>]+"#)
        .expect("constant Windows absolute-path pattern must compile")
});
static SYNTHETIC_PATH_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\bLUCATEST_ABSOLUTE_SOURCE_PATH_SENTINEL(?:_[A-Z0-9_]+)?\b")
        .expect("constant synthetic path pattern must compile")
});

/// Count sensitive values without retaining their text.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct RedactionSummary {
    pub secret_count: usize,
    pub protected_body_count: usize,
    pub absolute_path_count: usize,
}

impl RedactionSummary {
    fn record(&mut self, class: SensitiveClass) {
        match class {
            SensitiveClass::Secret => self.secret_count += 1,
            SensitiveClass::ProtectedBody => self.protected_body_count += 1,
            SensitiveClass::AbsolutePath => self.absolute_path_count += 1,
        }
    }

    /// Return whether the source contained anything that needed redaction.
    pub const fn has_sensitive_content(&self) -> bool {
        self.secret_count + self.protected_body_count + self.absolute_path_count > 0
    }
}

/// Return safe, fixed diagnostic text and a count-only summary.
///
/// Matching values are replaced with a fixed class marker rather than a hash.
/// A hash of a short provider token can itself become a disclosure oracle.
pub fn redact_diagnostic(input: &str) -> (String, RedactionSummary) {
    let matches = sensitive_matches(input);
    if matches.is_empty() {
        return (input.to_owned(), RedactionSummary::default());
    }

    let mut output = String::with_capacity(input.len());
    let mut cursor = 0;
    let mut summary = RedactionSummary::default();
    for matched in matches {
        output.push_str(&input[cursor..matched.start]);
        output.push_str("[REDACTED:");
        output.push_str(matched.class.as_str());
        output.push(']');
        summary.record(matched.class);
        cursor = matched.end;
    }
    output.push_str(&input[cursor..]);
    (output, summary)
}

/// Classify a value for the gate scanner without returning the matched bytes.
pub fn classify_sensitive_content(input: &str) -> Vec<SensitiveClass> {
    sensitive_matches(input)
        .into_iter()
        .map(|matched| matched.class)
        .collect()
}

fn sensitive_matches(input: &str) -> Vec<SensitiveMatch> {
    let mut candidates = Vec::new();
    append_matches(
        &mut candidates,
        &NSEC_PATTERN,
        input,
        SensitiveClass::Secret,
    );
    append_matches(
        &mut candidates,
        &ASSIGNMENT_SECRET_PATTERN,
        input,
        SensitiveClass::Secret,
    );
    append_matches(
        &mut candidates,
        &SYNTHETIC_SECRET_PATTERN,
        input,
        SensitiveClass::Secret,
    );
    append_matches(
        &mut candidates,
        &SYNTHETIC_BODY_PATTERN,
        input,
        SensitiveClass::ProtectedBody,
    );
    append_matches(
        &mut candidates,
        &UNIX_ABSOLUTE_PATH_PATTERN,
        input,
        SensitiveClass::AbsolutePath,
    );
    append_matches(
        &mut candidates,
        &WINDOWS_ABSOLUTE_PATH_PATTERN,
        input,
        SensitiveClass::AbsolutePath,
    );
    append_matches(
        &mut candidates,
        &SYNTHETIC_PATH_PATTERN,
        input,
        SensitiveClass::AbsolutePath,
    );

    candidates.sort_by_key(|matched| (matched.start, matched.end));
    let mut non_overlapping = Vec::new();
    for candidate in candidates {
        if non_overlapping
            .last()
            .map_or(true, |previous: &SensitiveMatch| {
                previous.end <= candidate.start
            })
        {
            non_overlapping.push(candidate);
        }
    }
    non_overlapping
}

fn append_matches(
    output: &mut Vec<SensitiveMatch>,
    pattern: &Regex,
    input: &str,
    class: SensitiveClass,
) {
    output.extend(pattern.find_iter(input).map(|found| SensitiveMatch {
        start: found.start(),
        end: found.end(),
        class,
    }));
}
