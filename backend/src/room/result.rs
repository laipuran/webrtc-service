use thiserror::Error;

#[derive(Debug, Error)]
pub enum RoomError {
    #[error("Room auth failed")]
    AuthFailed,
    #[error("Already joined a room")]
    JoinedTwice,
    #[error("Member not in room")]
    MemberNotExists,
    // #[error("Room does not exist")]
    // RoomNotExists,
}

pub type RoomResult<T> = std::result::Result<T, RoomError>;
