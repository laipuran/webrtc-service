use serde::{Deserialize, Serialize};

use crate::{message::ServerMessage, transport::OutboundSender};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct MemberId(uuid::Uuid);

impl MemberId {
    pub fn new() -> Self {
        Self(uuid::Uuid::now_v7())
    }
}

impl std::fmt::Display for MemberId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl Default for MemberId {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone)]
pub struct Member {
    pub id: MemberId,
    pub username: String,
    outbound: OutboundSender<ServerMessage>,
}

impl Member {
    pub fn new(id: MemberId, username: String, outbound: OutboundSender<ServerMessage>) -> Self {
        Self {
            id,
            username,
            outbound,
        }
    }

    pub fn submit(&self, message: ServerMessage) {
        let _ = self.outbound.send(message);
    }

    pub fn submit_error(&self, error: impl std::fmt::Display) {
        self.submit(ServerMessage::Error {
            message: error.to_string(),
        });
    }
}
