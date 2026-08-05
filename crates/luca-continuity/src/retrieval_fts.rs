//! Process-memory-only FTS5 hydration and lexical seeding.

use crate::{
    ContinuityError, NamespaceScope, RetrievalRecord, MAX_HYDRATED_RECORDS, MAX_LEXICAL_SEEDS,
};
use luca_protocol::{canonicalize, OpaqueId};
use rusqlite::{params, Connection};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const MAX_QUERY_TERMS: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LexicalSeed {
    pub(crate) record_id: OpaqueId,
    pub(crate) score: i64,
}

/// An FTS5 database that can only be constructed with SQLite's in-memory API.
pub(crate) struct MemoryFts {
    connection: Connection,
    scope_tables: BTreeMap<String, String>,
    row_count: usize,
}

impl MemoryFts {
    pub(crate) fn hydrate(records: &[RetrievalRecord]) -> Result<Self, ContinuityError> {
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
            let table = format!("memory_fts_{token}");
            connection
                .execute_batch(&format!(
                    "CREATE VIRTUAL TABLE {table} USING fts5(
                        record_id UNINDEXED,
                        body,
                        tags,
                        tokenize='unicode61'
                    );"
                ))
                .map_err(index_error)?;
            let transaction = connection.transaction().map_err(index_error)?;
            {
                let mut insert = transaction
                    .prepare(&format!(
                        "INSERT INTO {table}(record_id, body, tags) VALUES (?1, ?2, ?3)"
                    ))
                    .map_err(index_error)?;
                for record in scoped_records {
                    insert
                        .execute(params![
                            record.record_id.as_str(),
                            &record.body,
                            record.tags.join(" ")
                        ])
                        .map_err(index_error)?;
                }
            }
            transaction.commit().map_err(index_error)?;
            scope_tables.insert(token, table);
        }
        connection
            .execute_batch("PRAGMA query_only=ON;")
            .map_err(index_error)?;
        Ok(Self {
            connection,
            scope_tables,
            row_count: records.len(),
        })
    }

    pub(crate) fn lexical_seeds(
        &self,
        address: &NamespaceScope,
        cue: &str,
    ) -> Result<Vec<LexicalSeed>, ContinuityError> {
        let terms = sanitized_terms(cue);
        if terms.is_empty() {
            return Ok(Vec::new());
        }
        let query = match_query(&terms);
        let token = scope_token(address)?;
        let Some(table) = self.scope_tables.get(&token) else {
            return Ok(Vec::new());
        };
        let mut statement = self
            .connection
            .prepare(&format!(
                "SELECT record_id, body, tags
                 FROM {table}
                 WHERE {table} MATCH ?1
                 ORDER BY record_id ASC
                 LIMIT ?2"
            ))
            .map_err(index_error)?;
        let rows = statement
            .query_map(params![query, MAX_HYDRATED_RECORDS as i64], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(index_error)?;
        let term_set: BTreeSet<_> = terms.iter().map(String::as_str).collect();
        let mut ranked = Vec::new();
        for row in rows {
            let (record_id, body, tags) = row.map_err(index_error)?;
            let record_id =
                OpaqueId::parse(record_id).map_err(|_| ContinuityError::RetrievalIndex)?;
            let body_matches = lexical_match_count(&body, &term_set);
            let tag_matches = lexical_match_count(&tags, &term_set);
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

fn sanitized_terms(cue: &str) -> Vec<String> {
    let mut terms: Vec<String> = cue
        .split(|character: char| {
            !(character.is_alphanumeric() || character == '_' || character == '-')
        })
        .filter(|term| !term.is_empty())
        .map(|term| term.to_lowercase())
        .collect();
    terms.sort();
    terms.dedup();
    terms.truncate(MAX_QUERY_TERMS);
    terms
}

fn match_query(terms: &[String]) -> String {
    terms
        .iter()
        .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" OR ")
}

fn lexical_match_count(text: &str, terms: &BTreeSet<&str>) -> i64 {
    text.split(|character: char| {
        !(character.is_alphanumeric() || character == '_' || character == '-')
    })
    .filter(|token| !token.is_empty())
    .fold(0_i64, |count, token| {
        count.saturating_add(i64::from(terms.contains(token.to_lowercase().as_str())))
    })
}

fn index_error(_: rusqlite::Error) -> ContinuityError {
    ContinuityError::RetrievalIndex
}

#[cfg(test)]
mod tests {
    use super::{match_query, sanitized_terms};

    #[test]
    fn sanitizer_emits_only_quoted_or_terms() {
        assert_eq!(
            match_query(&sanitized_terms("alpha\" OR * NEAR(beta)")),
            "\"alpha\" OR \"beta\" OR \"near\" OR \"or\""
        );
        assert!(sanitized_terms(":() *").is_empty());
    }
}
