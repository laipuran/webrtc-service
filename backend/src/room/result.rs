use thiserror::Error;

use crate::topology::{graph::GraphError, shortest_path::ShortestPathError};

#[derive(Debug, Error)]
pub enum RoomError {
    #[error("Room auth failed")]
    AuthFailed,
    #[error("Already joined a room")]
    JoinedTwice,
    #[error("Member not in room")]
    MemberNotExists,
    #[error("Edge has the same from and to")]
    SelfCycle,
    #[error("Duplicate link target")]
    DuplicateLink,
    #[error("Topology graph failed: {0}")]
    Graph(#[from] GraphError),
    #[error("Topology shortest paths failed: {0}")]
    ShortestPath(#[from] ShortestPathError),
    // #[error("Room does not exist")]
    // RoomNotExists,
}

pub type RoomResult<T> = std::result::Result<T, RoomError>;
