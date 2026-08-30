use crate::room::member::MemberId;

#[derive(Debug, thiserror::Error)]
pub enum RoomError {
    #[error("Invalid auth")]
    AuthFailed,
    #[error("Already joined: {member_id}")]
    JoinedTwice { member_id: MemberId },
    #[error("Member does not exist: {member_id}")]
    MemberNotExists { member_id: MemberId },
}

pub type RoomResult<T> = std::result::Result<T, RoomError>;
