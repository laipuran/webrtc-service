use std::collections::HashMap;

use crate::{
    message::{MemberSummary, ServerMessage},
    room::{
        member::{Member, MemberId},
        result::{RoomError, RoomResult},
    },
    topology::metric::LinkMetrics,
};

pub mod id;
pub mod member;
pub mod result;

#[derive(Debug, PartialEq, Eq, Clone, Hash, Copy)]
pub struct RoomEdge {
    from: MemberId,
    to: MemberId,
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
}
