use serde::{Deserialize, Serialize};

use crate::{handler::transport::OutboundSender, message::ServerMessage};

// A wrapper ID type in case unexpected type coercion.
#[derive(Debug, PartialEq, Eq, Hash, Clone, Serialize, Deserialize)]
pub struct MemberId(String);

impl std::fmt::Display for MemberId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl MemberId {
    pub fn new() -> Self {
        Self(uuid::Uuid::now_v7().to_string())
    }
}

#[derive(Clone)]
pub struct Member {
    pub id: MemberId,
    submit_send: OutboundSender<ServerMessage>,
}

impl Member {
    pub fn new(id: MemberId, submit_send: OutboundSender<ServerMessage>) -> Self {
        Self { id, submit_send }
    }

    pub fn submit_message(&self, message: ServerMessage) {
        let _ = self.submit_send.send(message);
    }
}
