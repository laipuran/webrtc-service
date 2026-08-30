use serde::{Deserialize, Serialize};

use crate::room::{id::RoomId, member::MemberId};

#[derive(Deserialize)]
pub enum ClientMessage {
    JoinRoom {
        room_id: RoomId,
        username: String,
        auth: String,
    },
    LeaveRoom {
        room_id: RoomId,
    },
    Say {
        room_id: RoomId,
        content: String,
    },
}

#[derive(Serialize)]
pub enum ServerMessage {
    MemberJoin {
        room_id: RoomId,
        member_id: MemberId,
        member_username: String,
    },
    MemberLeft {
        room_id: RoomId,
        member_id: MemberId,
    },
    MemberSay {
        room_id: String,
        content: String,
    },
}
