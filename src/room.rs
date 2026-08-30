pub mod id;
pub mod member;
pub mod result;

use crate::{
    message::ServerMessage,
    room::{
        member::{Member, MemberId},
        result::{RoomError, RoomResult},
    },
};

pub struct Room {
    members: Vec<Member>,
    auth: String,
}

impl Room {
    pub fn new(auth: String) -> Self {
        Self {
            members: Vec::new(),
            auth,
        }
    }
    pub fn join(&mut self, auth: &str, member: Member) -> RoomResult<()> {
        if self.auth != auth {
            return Err(RoomError::AuthFailed);
        }
        if self.members.iter().any(|current| current.id == member.id) {
            return Err(RoomError::JoinedTwice {
                member_id: member.id,
            });
        }
        self.members.push(member);
        Ok(())
    }
    pub fn leave(&mut self, member_id: &MemberId) -> RoomResult<()> {
        let Some(index) = self
            .members
            .iter()
            .position(|member| &member.id == member_id)
        else {
            return Err(RoomError::MemberNotExists {
                member_id: member_id.clone(),
            });
        };
        self.members.remove(index);
        Ok(())
    }
    pub fn broadcast(&self, message: ServerMessage) {
        for member in &self.members {
            member.submit_message(message.clone());
        }
    }
}
