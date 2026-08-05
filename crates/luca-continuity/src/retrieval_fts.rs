//! Process-memory-only opaque FTS5 hydration and lexical seeding.

use crate::{
    ContinuityError, NamespaceScope, RetrievalRecord, RetrievalText, MAX_HYDRATED_RECORDS,
    MAX_LEXICAL_SEEDS,
};
use hmac::{Hmac, KeyInit, Mac};
use luca_protocol::{canonicalize, OpaqueId};
use rand::RngExt as _;
use rusqlite::{params, params_from_iter, types::Value, Connection};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use zeroize::Zeroizing;

const MAX_QUERY_TERMS: usize = 64;
const TOKEN_DOMAIN_V1: &[u8] = b"luca.continuity.retrieval.fts-token.v1\0";

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LexicalSeed {
    pub(crate) record_id: OpaqueId,
    pub(crate) score: i64,
}

#[derive(Clone)]
struct ScopeTables {
    fts: String,
    frequencies: String,
}

/// An FTS5 database that can only be constructed with SQLite's in-memory API.
///
/// SQLite receives only per-index keyed token hashes and numeric frequencies.
/// Plaintext bodies, tags, and query terms never cross the connection boundary.
pub(crate) struct MemoryFts {
    connection: Connection,
    scope_tables: BTreeMap<String, ScopeTables>,
    row_count: usize,
    token_key: Zeroizing<[u8; 32]>,
}

impl MemoryFts {
    pub(crate) fn hydrate(records: &[RetrievalRecord]) -> Result<Self, ContinuityError> {
        let mut token_key = Zeroizing::new([0_u8; 32]);
        rand::rng().fill(&mut *token_key);
        Self::hydrate_with_key(records, token_key)
    }

    fn hydrate_with_key(
        records: &[RetrievalRecord],
        token_key: Zeroizing<[u8; 32]>,
    ) -> Result<Self, ContinuityError> {
        let mut connection = Connection::open_in_memory().map_err(index_error)?;
        connection
            .execute_batch(
                "PRAGMA temp_store=MEMORY;
                 PRAGMA journal_mode=MEMORY;",
            )
            .map_err(index_error)?;

        let mut grouped = BTreeMap::<String, Vec<&RetrievalRecord>>::new();
        for record in records {
            grouped
                .entry(scope_token(&record.address)?)
                .or_default()
                .push(record);
        }
        let mut scope_tables = BTreeMap::new();
        for (token, scoped_records) in grouped {
            let fts_table = format!("memory_fts_{token}");
            let frequency_table = format!("memory_frequency_{token}");
            connection
                .execute_batch(&format!(
                    "CREATE VIRTUAL TABLE {fts_table} USING fts5(
                        record_id UNINDEXED,
                        opaque_terms,
                        tokenize='unicode61'
                    );
                     CREATE TABLE {frequency_table}(
                        record_id TEXT NOT NULL,
                        term_hash TEXT NOT NULL,
                        body_frequency INTEGER NOT NULL,
                        tag_frequency INTEGER NOT NULL,
                        PRIMARY KEY(record_id, term_hash)
                    ) STRICT, WITHOUT ROWID;"
                ))
                .map_err(index_error)?;
            let transaction = connection.transaction().map_err(index_error)?;
            {
                let mut insert_fts = transaction
                    .prepare(&format!(
                        "INSERT INTO {fts_table}(record_id, opaque_terms) VALUES (?1, ?2)"
                    ))
                    .map_err(index_error)?;
                let mut insert_frequency = transaction
                    .prepare(&format!(
                        "INSERT INTO {frequency_table}(
                            record_id, term_hash, body_frequency, tag_frequency
                         ) VALUES (?1, ?2, ?3, ?4)"
                    ))
                    .map_err(index_error)?;
                for record in scoped_records {
                    let frequencies = opaque_frequencies(record, &token_key)?;
                    let document = opaque_document(frequencies.keys());
                    insert_fts
                        .execute(params![record.record_id.as_str(), document.as_str()])
                        .map_err(index_error)?;
                    for (term_hash, (body_frequency, tag_frequency)) in frequencies {
                        insert_frequency
                            .execute(params![
                                record.record_id.as_str(),
                                term_hash.as_str(),
                                body_frequency,
                                tag_frequency
                            ])
                            .map_err(index_error)?;
                    }
                }
            }
            transaction.commit().map_err(index_error)?;
            scope_tables.insert(
                token,
                ScopeTables {
                    fts: fts_table,
                    frequencies: frequency_table,
                },
            );
        }
        connection
            .execute_batch("PRAGMA query_only=ON;")
            .map_err(index_error)?;
        Ok(Self {
            connection,
            scope_tables,
            row_count: records.len(),
            token_key,
        })
    }

    pub(crate) fn lexical_seeds(
        &self,
        address: &NamespaceScope,
        cue: &str,
    ) -> Result<Vec<LexicalSeed>, ContinuityError> {
        let normalized_terms = normalized_query_terms(cue);
        if normalized_terms.is_empty() {
            return Ok(Vec::new());
        }
        let opaque_terms = opaque_query_terms(&normalized_terms, &self.token_key)?;
        let query = match_query(&opaque_terms);
        let token = scope_token(address)?;
        let Some(tables) = self.scope_tables.get(&token) else {
            return Ok(Vec::new());
        };
        let placeholders = (0..opaque_terms.len())
            .map(|position| format!("?{}", position + 2))
            .collect::<Vec<_>>()
            .join(", ");
        let limit_parameter = opaque_terms.len() + 2;
        let sql = format!(
            "SELECT indexed.record_id,
                    COALESCE(SUM(frequency.body_frequency), 0),
                    COALESCE(SUM(frequency.tag_frequency), 0)
             FROM {fts} AS indexed
             JOIN {frequencies} AS frequency
               ON frequency.record_id = indexed.record_id
             WHERE {fts} MATCH ?1
               AND frequency.term_hash IN ({placeholders})
             GROUP BY indexed.record_id
             ORDER BY indexed.record_id ASC
             LIMIT ?{limit_parameter}",
            fts = tables.fts,
            frequencies = tables.frequencies,
        );
        let mut parameters = Vec::with_capacity(opaque_terms.len() + 2);
        parameters.push(Value::Text(query.as_str().to_owned()));
        parameters.extend(
            opaque_terms
                .iter()
                .map(|term| Value::Text(term.as_str().to_owned())),
        );
        parameters.push(Value::Integer(MAX_HYDRATED_RECORDS as i64));
        let mut statement = self.connection.prepare(&sql).map_err(index_error)?;
        let rows = statement
            .query_map(params_from_iter(parameters.iter()), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .map_err(index_error)?;
        let mut ranked = Vec::new();
        for row in rows {
            let (record_id, body_matches, tag_matches) = row.map_err(index_error)?;
            let record_id =
                OpaqueId::parse(record_id).map_err(|_| ContinuityError::RetrievalIndex)?;
            let score = body_matches
                .saturating_mul(1_000_000)
                .saturating_add(tag_matches.saturating_mul(2_000_000));
            ranked.push((record_id, score));
        }
        ranked.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
        ranked.truncate(MAX_LEXICAL_SEEDS);
        Ok(ranked
            .into_iter()
            .enumerate()
            .map(|(position, (record_id, fixed_rank))| LexicalSeed {
                record_id,
                score: fixed_rank.saturating_add(((MAX_LEXICAL_SEEDS - position) as i64) * 100_000),
            })
            .collect())
    }

    pub(crate) fn row_count(&self) -> Result<usize, ContinuityError> {
        Ok(self.row_count)
    }

    pub(crate) fn is_process_memory_only(&self) -> Result<bool, ContinuityError> {
        let main_path: String = self
            .connection
            .query_row(
                "SELECT file FROM pragma_database_list WHERE name = 'main'",
                [],
                |row| row.get(0),
            )
            .map_err(index_error)?;
        let journal_mode: String = self
            .connection
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .map_err(index_error)?;
        let temp_store: i64 = self
            .connection
            .query_row("PRAGMA temp_store", [], |row| row.get(0))
            .map_err(index_error)?;
        Ok(main_path.is_empty() && journal_mode.eq_ignore_ascii_case("memory") && temp_store == 2)
    }
}

#[derive(Serialize)]
struct ExactScopeToken<'a> {
    namespace: &'a luca_protocol::ContinuityNamespaceV1,
    scope: &'a luca_protocol::ContinuityScopeV1,
}

fn scope_token(address: &NamespaceScope) -> Result<String, ContinuityError> {
    let canonical = canonicalize(&ExactScopeToken {
        namespace: address.namespace().as_protocol(),
        scope: address.as_protocol(),
    })
    .map_err(|_| ContinuityError::RetrievalIndex)?;
    Ok(hex::encode(Sha256::digest(canonical)))
}

fn normalized_query_terms(cue: &str) -> Vec<RetrievalText> {
    let mut terms = split_terms(cue)
        .map(|term| RetrievalText::new(term.to_lowercase()))
        .collect::<Vec<_>>();
    terms.sort();
    terms.dedup();
    terms.truncate(MAX_QUERY_TERMS);
    terms
}

fn opaque_query_terms(
    normalized_terms: &[RetrievalText],
    token_key: &[u8; 32],
) -> Result<Vec<RetrievalText>, ContinuityError> {
    let mut terms = normalized_terms
        .iter()
        .map(|term| opaque_term(term.as_str(), token_key))
        .collect::<Result<Vec<_>, _>>()?;
    terms.sort();
    terms.dedup();
    Ok(terms)
}

fn opaque_frequencies(
    record: &RetrievalRecord,
    token_key: &[u8; 32],
) -> Result<BTreeMap<RetrievalText, (i64, i64)>, ContinuityError> {
    let mut frequencies = BTreeMap::<RetrievalText, (i64, i64)>::new();
    for term in split_terms(record.body.as_str()) {
        let normalized = RetrievalText::new(term.to_lowercase());
        let hash = opaque_term(normalized.as_str(), token_key)?;
        let entry = frequencies.entry(hash).or_default();
        entry.0 = entry.0.saturating_add(1);
    }
    for tag in &record.tags {
        for term in split_terms(tag.as_str()) {
            let normalized = RetrievalText::new(term.to_lowercase());
            let hash = opaque_term(normalized.as_str(), token_key)?;
            let entry = frequencies.entry(hash).or_default();
            entry.1 = entry.1.saturating_add(1);
        }
    }
    Ok(frequencies)
}

fn opaque_term(term: &str, token_key: &[u8; 32]) -> Result<RetrievalText, ContinuityError> {
    let mut mac = <HmacSha256 as KeyInit>::new_from_slice(token_key)
        .map_err(|_| ContinuityError::RetrievalIndex)?;
    mac.update(TOKEN_DOMAIN_V1);
    mac.update(term.as_bytes());
    Ok(RetrievalText::new(hex::encode(mac.finalize().into_bytes())))
}

fn opaque_document<'a>(terms: impl Iterator<Item = &'a RetrievalText>) -> RetrievalText {
    let mut document = String::new();
    for term in terms {
        if !document.is_empty() {
            document.push(' ');
        }
        document.push_str(term.as_str());
    }
    RetrievalText::new(document)
}

fn match_query(terms: &[RetrievalText]) -> RetrievalText {
    let mut query = String::new();
    for term in terms {
        if !query.is_empty() {
            query.push_str(" OR ");
        }
        query.push('"');
        query.push_str(term.as_str());
        query.push('"');
    }
    RetrievalText::new(query)
}

fn split_terms(text: &str) -> impl Iterator<Item = &str> {
    text.split(|character: char| {
        !(character.is_alphanumeric() || character == '_' || character == '-')
    })
    .filter(|term| !term.is_empty())
}

fn index_error(_: rusqlite::Error) -> ContinuityError {
    ContinuityError::RetrievalIndex
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{NamespaceKey, RetrievalRecordInput, RetrievalRecordState, RetrievalRelation};
    use luca_protocol::{
        ContinuityNamespaceKindV1, ContinuityNamespaceV1, ContinuityScopeV1, Hex64, SafeU53,
        Sha256Ref, CONTINUITY_PROTOCOL,
    };

    fn hex(digit: char) -> Hex64 {
        Hex64::parse(digit.to_string().repeat(64)).unwrap()
    }

    fn sha(digit: char) -> Sha256Ref {
        Sha256Ref::parse(format!("sha256:{}", digit.to_string().repeat(64))).unwrap()
    }

    fn record(body: &str, tags: &[&str]) -> RetrievalRecord {
        let namespace = ContinuityNamespaceV1 {
            protocol: CONTINUITY_PROTOCOL.into(),
            owner_pubkey: hex('1'),
            kind: ContinuityNamespaceKindV1::ResidentPrivate,
            resident_pubkey: Some(hex('2')),
            namespace_ref: sha('3'),
            key_version: SafeU53::new(1).unwrap(),
        };
        let address = NamespaceScope::new(
            NamespaceKey::new(namespace.clone()).unwrap(),
            ContinuityScopeV1 {
                protocol: CONTINUITY_PROTOCOL.into(),
                namespace_ref: namespace.namespace_ref,
                scope_ref: sha('4'),
                source_id: Some(OpaqueId::parse("source-1").unwrap()),
                project_id: None,
                room_id: None,
                conversation_id: Some(OpaqueId::parse("conversation-1").unwrap()),
            },
        )
        .unwrap();
        RetrievalRecord::new(RetrievalRecordInput {
            address,
            record_id: OpaqueId::parse("record-1").unwrap(),
            record_type: OpaqueId::parse("engram").unwrap(),
            revision: SafeU53::new(1).unwrap(),
            body: RetrievalText::from(body),
            tags: tags.iter().map(|tag| RetrievalText::from(*tag)).collect(),
            confidence_basis_points: 8_000,
            provenance_refs: vec![sha('5')],
            outgoing_edges: vec![],
            state: RetrievalRecordState::Active,
        })
        .unwrap()
    }

    fn stored_values(index: &MemoryFts) -> Vec<String> {
        let mut values = Vec::new();
        for tables in index.scope_tables.values() {
            let mut statement = index
                .connection
                .prepare(&format!(
                    "SELECT record_id, opaque_terms FROM {} ORDER BY record_id",
                    tables.fts
                ))
                .unwrap();
            values.extend(
                statement
                    .query_map([], |row| {
                        Ok(format!(
                            "{} {}",
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?
                        ))
                    })
                    .unwrap()
                    .map(Result::unwrap),
            );
            let mut statement = index
                .connection
                .prepare(&format!(
                    "SELECT record_id, term_hash, body_frequency, tag_frequency
                     FROM {} ORDER BY record_id, term_hash",
                    tables.frequencies
                ))
                .unwrap();
            values.extend(
                statement
                    .query_map([], |row| {
                        Ok(format!(
                            "{} {} {} {}",
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, i64>(3)?
                        ))
                    })
                    .unwrap()
                    .map(Result::unwrap),
            );
        }
        values
    }

    #[test]
    fn plaintext_never_enters_sqlite_or_opaque_query_material() {
        let fixture = "private-orchid-sentence";
        let tag = "sensitive-tag";
        let record = record(fixture, &[tag]);
        let index =
            MemoryFts::hydrate_with_key(std::slice::from_ref(&record), Zeroizing::new([7_u8; 32]))
                .unwrap();
        let stored = stored_values(&index).join(" ");
        assert!(!stored.contains(fixture));
        assert!(!stored.contains(tag));

        let normalized = normalized_query_terms(fixture);
        assert!(!format!("{normalized:?}").contains(fixture));
        let opaque = opaque_query_terms(&normalized, &index.token_key).unwrap();
        let query = match_query(&opaque);
        assert!(!query.as_str().contains(fixture));
        assert!(!format!("{query:?}").contains(fixture));
    }

    #[test]
    fn per_index_keys_change_terms_without_changing_results() {
        let record = record("orchid orchid continuity", &["orchid"]);
        let first =
            MemoryFts::hydrate_with_key(std::slice::from_ref(&record), Zeroizing::new([1_u8; 32]))
                .unwrap();
        let second =
            MemoryFts::hydrate_with_key(std::slice::from_ref(&record), Zeroizing::new([2_u8; 32]))
                .unwrap();
        assert_ne!(stored_values(&first), stored_values(&second));
        let first_hits = first.lexical_seeds(&record.address, "orchid").unwrap();
        let repeated = first.lexical_seeds(&record.address, "orchid").unwrap();
        let second_hits = second.lexical_seeds(&record.address, "orchid").unwrap();
        assert_eq!(first_hits, repeated);
        assert_eq!(first_hits, second_hits);
        assert_eq!(first_hits[0].score, 4_000_000 + 3_000_000);
    }

    #[test]
    fn normalized_terms_and_text_debug_are_redacted() {
        let terms = normalized_query_terms("alpha\" OR * NEAR(beta)");
        assert_eq!(terms.len(), 4);
        assert!(format!("{terms:?}").contains("[REDACTED]"));
        assert!(!format!("{terms:?}").contains("alpha"));
        assert!(normalized_query_terms(":() *").is_empty());
        let relation = RetrievalRelation::Related;
        assert_eq!(relation.fixed_weight(), Some(6_000));
    }

    #[test]
    fn punctuation_only_plaintext_is_valid_but_has_no_lexical_seed() {
        let record = record("... !!! ---", &[]);
        let index =
            MemoryFts::hydrate_with_key(std::slice::from_ref(&record), Zeroizing::new([9_u8; 32]))
                .unwrap();
        assert_eq!(index.row_count().unwrap(), 1);
        assert!(index
            .lexical_seeds(&record.address, "anything")
            .unwrap()
            .is_empty());
    }
}
