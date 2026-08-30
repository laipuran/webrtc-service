use serde::{Deserialize, Serialize};

pub type PeerId = u64;

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub struct Member {
    pub peer_id: PeerId,
    pub username: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum Signal {
    Offer { sdp: String },
    Answer { sdp: String },
    IceCandidate { candidate: String },
}

/// 客户端发送给服务器的信令消息。
#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ClientMsg {
    Join {
        room_id: String,
        auth: String,
        username: String,
    },
    Leave,
    Signal {
        to: PeerId,
        signal: Signal,
    },
}

/// 服务器发送给客户端的信令消息。
#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ServerMsg {
    Joined { peer_id: PeerId, room_id: String },
    Roster { members: Vec<Member> },
    PeerLeft { peer_id: PeerId },
    Error { message: String },
    Signal { from: PeerId, signal: Signal },
}
