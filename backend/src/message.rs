use serde::{Deserialize, Serialize};

use crate::room::{id::RoomId, member::MemberId};

#[derive(Clone, Serialize)]
pub struct MemberSummary {
    pub member_id: MemberId,
    pub username: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum Signal {
    Offer { sdp: String },
    Answer { sdp: String },
    IceCandidate { candidate: String },
}

#[derive(Deserialize)]
#[serde(tag = "type")]
pub enum ClientMessage {
    Join {
        room_id: RoomId,
        auth: String,
        username: String,
    },
    Leave,
    Signal {
        to: MemberId,
        signal: Signal,
    },
}

#[derive(Serialize, Clone)]
#[serde(tag = "type")]
pub enum ServerMessage {
    Joined {
        member_id: MemberId,
        room_id: RoomId,
    },
    Roster {
        members: Vec<MemberSummary>,
    },
    MemberLeft {
        member_id: MemberId,
    },
    Error {
        message: String,
    },
    Signal {
        from: MemberId,
        signal: Signal,
    },
}
