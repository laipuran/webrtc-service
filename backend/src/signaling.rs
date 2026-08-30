use std::sync::Mutex;

use crate::{
    message::{PeerId, ServerMsg},
    room::RoomState,
};

pub enum Dest {
    Myself,
    Peer(PeerId),
    Room(String),
}

pub enum JoinResult {
    Joined {
        peer_id: PeerId,
        messages: Vec<(Dest, ServerMsg)>,
    },
    Rejected {
        messages: Vec<(Dest, ServerMsg)>,
    },
}

pub fn handle_join(
    room_state: &Mutex<RoomState>,
    room_id: &str,
    auth: &str,
    username: &str,
) -> JoinResult {
    let mut room_state = room_state.lock().unwrap();

    let mut messages: Vec<(Dest, ServerMsg)> = Vec::new();
    match room_state.join(room_id, auth, username) {
        Ok(peer_id) => {
            messages.push((
                Dest::Peer(peer_id),
                ServerMsg::Joined {
                    peer_id,
                    room_id: room_id.to_string(),
                },
            ));

            messages.push((
                Dest::Room(room_id.to_string()),
                ServerMsg::Roster {
                    members: room_state.members(room_id).unwrap().to_vec(),
                },
            ));
            JoinResult::Joined { peer_id, messages }
        }
        Err(e) => {
            messages.push((
                Dest::Myself,
                ServerMsg::Error {
                    message: e.message().to_string(),
                },
            ));
            JoinResult::Rejected { messages }
        }
    }
}

pub fn handle_leave(
    room_state: &Mutex<RoomState>,
    room_id: &str,
    peer_id: PeerId,
) -> Vec<(Dest, ServerMsg)> {
    let mut room_state = room_state.lock().unwrap();

    let mut messages: Vec<(Dest, ServerMsg)> = Vec::new();
    match room_state.leave(room_id, peer_id) {
        Ok(()) => {
            messages.push((
                Dest::Room(room_id.to_string()),
                ServerMsg::PeerLeft { peer_id },
            ));
            messages
        }
        Err(e) => {
            messages.push((
                Dest::Myself,
                ServerMsg::Error {
                    message: e.message().to_string(),
                },
            ));
            messages
        }
    }
}
