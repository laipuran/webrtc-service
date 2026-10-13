use std::collections::{HashMap, HashSet};

use thiserror::Error;

use crate::{room::member::MemberId, topology::weight::LinkCost};

#[derive(Debug, PartialEq, Eq, PartialOrd, Ord, Clone, Copy, Hash)]
pub struct NodeIndex(usize);

impl NodeIndex {
    pub fn position(self) -> usize {
        self.0
    }
}

#[derive(Debug, Hash, PartialEq, Eq)]
struct Edge {
    from: NodeIndex,
    to: NodeIndex,
}

pub struct GraphBuilder {
    indices: HashMap<MemberId, NodeIndex>,
    edges: HashMap<Edge, LinkCost>,
}

impl GraphBuilder {
    pub fn new(members: &[MemberId]) -> Self {
        let members: HashSet<MemberId> = members.iter().cloned().collect();
        let mut indices: HashMap<MemberId, NodeIndex> = HashMap::new();
        for (index, member) in members.iter().enumerate() {
            indices.insert(member.clone(), NodeIndex(index));
        }

        Self {
            indices,
            edges: HashMap::new(),
        }
    }

    pub fn add(&mut self, from: &MemberId, to: &MemberId, weight: LinkCost) -> GraphResult<()> {
        let from = self.resolve_member(from)?;
        let to = self.resolve_member(to)?;

        if from == to {
            return Err(GraphError::SelfCycle);
        }

        let edge = Edge { from, to };
        if let Some(previous_weight) = self.edges.get_mut(&edge) {
            if weight < *previous_weight {
                *previous_weight = weight;
            }
        } else {
            self.edges.insert(edge, weight);
        }
        Ok(())
    }

    fn resolve_member(&self, member: &MemberId) -> GraphResult<NodeIndex> {
        self.indices
            .get(member)
            .copied()
            .ok_or(GraphError::UnknownMember)
    }

    pub fn build(self) -> AdjacencyList {
        let Self { indices, edges } = self;
        let len = indices.len();

        let mut members = vec![None; len];
        for (member, index) in &indices {
            members[index.position()] = Some(member.clone());
        }

        let members = members
            .into_iter()
            .map(|member| member.expect("every graph index must have a member"))
            .collect();

        let mut list = AdjacencyList {
            members,
            indices,
            edges: (0..len).map(|_| Vec::new()).collect(),
        };

        for (edge, weight) in edges {
            list.edges[edge.from.0].push((edge.to, weight));
        }

        for edges in &mut list.edges {
            edges.sort_by_key(|(to, _)| *to);
        }

        list
    }
}

pub struct AdjacencyList {
    members: Vec<MemberId>,
    indices: HashMap<MemberId, NodeIndex>,
    edges: Vec<Vec<(NodeIndex, LinkCost)>>,
}

impl AdjacencyList {
    pub fn index_of(&self, member: &MemberId) -> Option<NodeIndex> {
        self.indices.get(member).copied()
    }

    pub fn node_count(&self) -> usize {
        self.members.len()
    }

    pub fn outgoing(&self, from: NodeIndex) -> &[(NodeIndex, LinkCost)] {
        &self.edges[from.position()]
    }

    pub fn member_at(&self, index: NodeIndex) -> &MemberId {
        &self.members[index.position()]
    }
}

impl Default for AdjacencyList {
    fn default() -> Self {
        Self {
            members: Vec::new(),
            indices: HashMap::new(),
            edges: Vec::new(),
        }
    }
}

#[derive(Debug, Error)]
pub enum GraphError {
    #[error("Member not in graph")]
    UnknownMember,
    #[error("From and to are the same")]
    SelfCycle,
}

pub type GraphResult<T> = std::result::Result<T, GraphError>;
