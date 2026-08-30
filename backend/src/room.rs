use std::collections::HashMap;

use crate::message::{Member, PeerId};

pub struct Room {
    members: Vec<Member>,
    auth: Option<String>,
}

pub struct RoomState {
    rooms: HashMap<String, Room>,
    next_peer: PeerId,
}

#[derive(Debug)]
pub enum RoomError {
    AuthFailed,
    JoinedTwice,
    PeerNotExists,
    RoomNotExists,
}

impl Room {
    pub fn new() -> Self {
        Self {
            members: Vec::new(),
            auth: None,
        }
    }

    pub fn join(&mut self, auth: &str, username: &str, peer_id: PeerId) -> Result<(), RoomError> {
        match &self.auth {
            Some(a) => {
                if a != auth {
                    return Err(RoomError::AuthFailed);
                }
            }
            None => self.auth = Some(auth.to_string()),
        }

        // TODO: This may be useless.
        if self
            .members
            .iter()
            .position(|m| m.peer_id == peer_id)
            .is_some()
        {
            return Err(RoomError::JoinedTwice);
        }

        let new_peer = Member {
            peer_id,
            username: username.to_string(),
        };
        self.members.push(new_peer);
        Ok(())
    }

    pub fn leave(&mut self, peer_id: PeerId) -> Result<(), RoomError> {
        if let Some(pos) = self.members.iter().position(|m| m.peer_id == peer_id) {
            self.members.remove(pos);
            Ok(())
        } else {
            Err(RoomError::PeerNotExists)
        }
    }
}

impl RoomState {
    pub fn new() -> Self {
        Self {
            rooms: HashMap::new(),
            next_peer: 0,
        }
    }

    pub fn members(&self, room_id: &str) -> Result<&[Member], RoomError> {
        if let Some(room) = self.rooms.get(room_id) {
            Ok(&room.members)
        } else {
            Err(RoomError::RoomNotExists)
        }
    }

    pub fn join(&mut self, room_id: &str, auth: &str, username: &str) -> Result<PeerId, RoomError> {
        let room = self
            .rooms
            .entry(room_id.to_string())
            .or_insert_with(Room::new);

        let peer_id = self.next_peer;
        room.join(auth, username, peer_id)?;
        self.next_peer += 1;
        Ok(peer_id)
    }

    pub fn leave(&mut self, room_id: &str, peer_id: PeerId) -> Result<(), RoomError> {
        let room = self.rooms.get_mut(room_id);
        let empty = match room {
            None => return Err(RoomError::RoomNotExists),
            Some(r) => {
                r.leave(peer_id)?;
                r.members.is_empty()
            }
        };
        if empty {
            self.rooms.remove(room_id);
        }
        Ok(())
    }
}

impl RoomError {
    pub fn message(&self) -> &str {
        match self {
            RoomError::AuthFailed => "Room auth failed",
            RoomError::JoinedTwice => "Already joined a room",
            RoomError::PeerNotExists => "Peer not in room",
            RoomError::RoomNotExists => "Room does not exist",
        }
    }
}
