use std::{cmp::Reverse, collections::BinaryHeap};

use thiserror::Error;

use crate::{
    room::member::MemberId,
    topology::{
        graph::{AdjacencyList, NodeIndex},
        weight::Weight,
    },
};

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ShortestPathError {
    #[error("source member is not in graph")]
    UnknownSource,
    #[error("path weight overflow")]
    WeightOverflow,
}

pub struct ShortestPaths<W>
where
    W: Weight,
{
    source: NodeIndex,
    distances: Vec<Option<W>>,
    parents: Vec<Option<NodeIndex>>,
}

impl<W> ShortestPaths<W>
where
    W: Weight,
{
    pub fn source(&self) -> NodeIndex {
        self.source
    }

    pub fn distance_to(&self, target: NodeIndex) -> Option<W> {
        self.distances[target.position()]
    }

    pub fn parent_of(&self, target: NodeIndex) -> Option<NodeIndex> {
        self.parents[target.position()]
    }
}

pub fn shortest_paths<W>(
    graph: &AdjacencyList<W>,
    source: &MemberId,
) -> Result<ShortestPaths<W>, ShortestPathError>
where
    W: Weight,
{
    let source = graph.index_of(source).ok_or(ShortestPathError::UnknownSource)?;

    let mut distances = vec![None; graph.node_count()];
    let mut parents = vec![None; graph.node_count()];
    let mut queue = BinaryHeap::new();

    distances[source.position()] = Some(W::zero());
    queue.push(Reverse((W::zero(), source)));

    while let Some(Reverse((current_distance, current))) = queue.pop() {
        if distances[current.position()] != Some(current_distance) {
            continue;
        }

        for &(next, edge_weight) in graph.outgoing(current) {
            let candidate_distance = current_distance
                .checked_add(edge_weight)
                .ok_or(ShortestPathError::WeightOverflow)?;

            let next_position = next.position();
            let should_update = distances[next_position]
                .map(|known_distance| candidate_distance < known_distance)
                .unwrap_or(true);

            if should_update {
                distances[next_position] = Some(candidate_distance);
                parents[next_position] = Some(current);
                queue.push(Reverse((candidate_distance, next)));
            }
        }
    }

    Ok(ShortestPaths {
        source,
        distances,
        parents,
    })
}
