use serde::{Deserialize, Serialize};

use crate::{
    room::{id::RoomId, member::MemberId},
    topology::metric::LinkMetrics,
};

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
pub struct Link {
    pub to: MemberId,
    pub metrics: LinkMetrics,
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
    Links {
        links: Vec<Link>,
    },
}
#[derive(Clone, Serialize)]
pub struct ForwardingRoute {
    pub from: MemberId,
    pub to: MemberId,
    pub source: MemberId,
}

#[derive(Clone, Serialize)]
pub struct MemberTopology {
    pub routes: Vec<ForwardingRoute>,
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
    Topology {
        topology: MemberTopology,
    },
}
