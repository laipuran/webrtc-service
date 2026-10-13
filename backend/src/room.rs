use std::collections::HashMap;

use crate::{
    message::{ForwardingRoute, MemberSummary, MemberTopology, ServerMessage},
    room::{
        member::{Member, MemberId},
        result::{RoomError, RoomResult},
    },
    topology::{
        graph::GraphBuilder, metric::LinkMetrics, shortest_path::shortest_paths, weight::LinkCost,
    },
};

pub mod id;
pub mod member;
pub mod result;

#[derive(Debug, PartialEq, Eq, Clone, Hash, Copy)]
pub struct RoomEdge {
    pub from: MemberId,
    pub to: MemberId,
}

pub struct BuiltTopology {
    pub cost: f64,
    pub members: HashMap<MemberId, MemberTopology>,
}

pub struct Room {
    members: Vec<Member>,
    auth: Option<String>,
    edges: HashMap<RoomEdge, LinkMetrics>,
}

impl Room {
    pub fn new() -> Self {
        Self {
            members: Vec::new(),
            auth: None,
            edges: HashMap::new(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.members.is_empty()
    }

    pub fn join(&mut self, auth: &str, member: Member) -> RoomResult<()> {
        match &self.auth {
            Some(a) => {
                if a != auth {
                    return Err(RoomError::AuthFailed);
                }
            }
            None => self.auth = Some(auth.to_string()),
        }
        if self
            .members
            .iter()
            .position(|m| m.id == member.id)
            .is_some()
        {
            return Err(RoomError::JoinedTwice);
        }
        self.members.push(member);
        Ok(())
    }

    pub fn leave(&mut self, member: &MemberId) -> RoomResult<()> {
        // Clean up the member's edges
        self.edges
            .retain(|edge, _| edge.from != *member && edge.to != *member);

        if let Some(pos) = self.members.iter().position(|m| &m.id == member) {
            self.members.remove(pos);
            Ok(())
        } else {
            Err(RoomError::MemberNotExists)
        }
    }

    pub fn broadcast(&self, message: ServerMessage) {
        for member in &self.members {
            member.submit(message.clone());
        }
    }

    pub fn send_to(&self, member_id: &MemberId, message: ServerMessage) -> RoomResult<()> {
        if let Some(member) = self.members.iter().find(|m| &m.id == member_id) {
            member.submit(message);
            Ok(())
        } else {
            Err(RoomError::MemberNotExists)
        }
    }

    pub fn summary(&self) -> Vec<MemberSummary> {
        self.members
            .iter()
            .map(|m| MemberSummary {
                member_id: m.id.clone(),
                username: m.username.clone(),
            })
            .collect()
    }

    pub fn insert_edge(&mut self, edge: RoomEdge, metrics: LinkMetrics) -> RoomResult<()> {
        if edge.from == edge.to {
            return Err(RoomError::SelfCycle);
        }

        if let Some(previous_metrics) = self.edges.get_mut(&edge) {
            *previous_metrics = metrics;
        } else {
            self.edges.insert(edge, metrics);
        }
        Ok(())
    }

    pub fn build_topo(&self) -> RoomResult<BuiltTopology> {
        let member_ids: Vec<_> = self.members.iter().map(|member| member.id).collect();
        let mut builder = GraphBuilder::new(&member_ids);
        let mut members: HashMap<_, _> = member_ids
            .iter()
            .map(|&id| (id, MemberTopology { routes: Vec::new() }))
            .collect();

        for (edge, metrics) in &self.edges {
            if members.contains_key(&edge.from) && members.contains_key(&edge.to) {
                builder.add(&edge.from, &edge.to, metrics.cost())?;
            }
        }

        let graph = builder.build();
        let mut distances = Vec::new();
        for source in &member_ids {
            let paths = shortest_paths(&graph, source)?;
            for target in &member_ids {
                if source == target {
                    continue;
                }
                let target_index = graph.index_of(target).ok_or(RoomError::MemberNotExists)?;
                distances.push(paths.distance_to(target_index));
                if let Some(parent) = paths.parent_of(target_index) {
                    let from = *graph.member_at(parent);
                    let route = ForwardingRoute {
                        from,
                        to: *target,
                        source: *source,
                    };
                    members
                        .get_mut(&from)
                        .ok_or(RoomError::MemberNotExists)?
                        .routes
                        .push(route.clone());
                    members
                        .get_mut(target)
                        .ok_or(RoomError::MemberNotExists)?
                        .routes
                        .push(route);
                }
            }
        }

        Ok(BuiltTopology {
            cost: evaluate(&distances),
            members,
        })
    }
}

fn evaluate(distances: &[Option<LinkCost>]) -> f64 {
    distances
        .iter()
        .map(|distance| distance.map_or(f64::INFINITY, |cost| cost.value() as f64))
        .sum()
}
