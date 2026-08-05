//! Deterministic fixed-point bounded graph activation.

use crate::retrieval_fts::LexicalSeed;
use crate::{
    RetrievalPathNode, RetrievalRecord, MAX_ACTIVATED_CANDIDATES, MAX_GRAPH_DEPTH,
    MAX_OUTGOING_EDGES,
};
use std::collections::{BTreeMap, BTreeSet};

const ACTIVATION_SCALE: i64 = 10_000;
const DEPTH_DECAY: i64 = 6_500;

pub(crate) struct GraphActivation {
    pub(crate) scores: BTreeMap<String, i64>,
    pub(crate) paths: BTreeMap<String, Vec<RetrievalPathNode>>,
    pub(crate) candidate_count: usize,
}

#[derive(Clone)]
struct FrontierEntry {
    activation: i64,
    path: Vec<RetrievalPathNode>,
}

pub(crate) fn activate_graph(
    scoped_records: &BTreeMap<String, RetrievalRecord>,
    seeds: &[LexicalSeed],
) -> GraphActivation {
    let mut scores = BTreeMap::new();
    let mut paths = BTreeMap::new();
    let mut path_strengths = BTreeMap::new();
    let mut frontier = BTreeMap::new();

    for seed in seeds {
        let Some(record) = scoped_records.get(seed.record_id.as_str()) else {
            continue;
        };
        let path = vec![path_node(record, None)];
        scores
            .entry(seed.record_id.as_str().to_owned())
            .and_modify(|score: &mut i64| *score = score.saturating_add(seed.score))
            .or_insert(seed.score);
        paths
            .entry(seed.record_id.as_str().to_owned())
            .or_insert_with(|| path.clone());
        path_strengths
            .entry(seed.record_id.as_str().to_owned())
            .or_insert(seed.score);
        frontier.insert(
            seed.record_id.as_str().to_owned(),
            FrontierEntry {
                activation: seed.score,
                path,
            },
        );
    }
    retain_top_candidates(&mut scores, &mut paths, &mut path_strengths, &mut frontier);

    for _depth in 0..MAX_GRAPH_DEPTH {
        if frontier.is_empty() {
            break;
        }
        let mut next_frontier: BTreeMap<String, FrontierEntry> = BTreeMap::new();
        let mut next_best_path_activation: BTreeMap<String, i64> = BTreeMap::new();

        for (source_id, source_state) in &frontier {
            let Some(source) = scoped_records.get(source_id) else {
                continue;
            };
            let mut edges = source.outgoing_edges.clone();
            edges.sort_by(|left, right| {
                left.target_record_id
                    .cmp(&right.target_record_id)
                    .then_with(|| left.relation.cmp(&right.relation))
                    .then_with(|| left.weight_basis_points.cmp(&right.weight_basis_points))
            });
            edges.truncate(MAX_OUTGOING_EDGES);

            for edge in edges {
                let Some(relation_weight) = edge.relation.fixed_weight() else {
                    continue;
                };
                let target_id = edge.target_record_id.as_str();
                let Some(target) = scoped_records.get(target_id) else {
                    continue;
                };
                let contribution = scaled_contribution(
                    source_state.activation,
                    i64::from(edge.weight_basis_points),
                    relation_weight,
                );
                if contribution <= 0 {
                    continue;
                }

                scores
                    .entry(target_id.to_owned())
                    .and_modify(|score| *score = score.saturating_add(contribution))
                    .or_insert(contribution);
                let next = next_frontier
                    .entry(target_id.to_owned())
                    .or_insert_with(|| FrontierEntry {
                        activation: 0,
                        path: Vec::new(),
                    });
                next.activation = next.activation.saturating_add(contribution);

                let mut candidate_path = source_state.path.clone();
                candidate_path.push(path_node(target, Some(edge.relation)));
                let prior = next_best_path_activation
                    .get(target_id)
                    .copied()
                    .unwrap_or(-1);
                let replace = contribution > prior
                    || (contribution == prior
                        && (next.path.is_empty() || candidate_path < next.path));
                if replace {
                    next.path = candidate_path.clone();
                    next_best_path_activation.insert(target_id.to_owned(), contribution);
                }
                let global_strength = path_strengths.get(target_id).copied().unwrap_or(-1);
                let replace_global = contribution > global_strength
                    || (contribution == global_strength
                        && paths
                            .get(target_id)
                            .map(|path| candidate_path.as_slice() < path.as_slice())
                            .unwrap_or(true));
                if replace_global {
                    paths.insert(target_id.to_owned(), candidate_path);
                    path_strengths.insert(target_id.to_owned(), contribution);
                }
            }
        }

        frontier = next_frontier;
        retain_top_candidates(&mut scores, &mut paths, &mut path_strengths, &mut frontier);
    }

    GraphActivation {
        candidate_count: scores.len(),
        scores,
        paths,
    }
}

fn path_node(
    record: &RetrievalRecord,
    via_relation: Option<crate::RetrievalRelation>,
) -> RetrievalPathNode {
    RetrievalPathNode {
        record_id: record.record_id.clone(),
        via_relation,
        provenance_refs: record.provenance_refs.clone(),
    }
}

fn scaled_contribution(activation: i64, edge_weight: i64, relation_weight: i64) -> i64 {
    activation
        .saturating_mul(edge_weight)
        .saturating_div(ACTIVATION_SCALE)
        .saturating_mul(relation_weight)
        .saturating_div(ACTIVATION_SCALE)
        .saturating_mul(DEPTH_DECAY)
        .saturating_div(ACTIVATION_SCALE)
}

fn retain_top_candidates(
    scores: &mut BTreeMap<String, i64>,
    paths: &mut BTreeMap<String, Vec<RetrievalPathNode>>,
    path_strengths: &mut BTreeMap<String, i64>,
    frontier: &mut BTreeMap<String, FrontierEntry>,
) {
    if scores.len() <= MAX_ACTIVATED_CANDIDATES {
        return;
    }
    let mut ranked: Vec<_> = scores
        .iter()
        .map(|(record_id, score)| (record_id.clone(), *score))
        .collect();
    ranked.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
    ranked.truncate(MAX_ACTIVATED_CANDIDATES);
    let retained: BTreeSet<_> = ranked.into_iter().map(|(record_id, _)| record_id).collect();
    scores.retain(|record_id, _| retained.contains(record_id));
    paths.retain(|record_id, _| retained.contains(record_id));
    path_strengths.retain(|record_id, _| retained.contains(record_id));
    frontier.retain(|record_id, _| retained.contains(record_id));
}
