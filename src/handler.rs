pub mod transport;

use log::warn;
use tokio::net::TcpStream;

use crate::{
    message::{ClientMessage, ServerMessage},
    room::{
        Room,
        id::RoomId,
        member::{Member, MemberId},
    },
    state::AppState,
};
use transport::WebSockHandler;

struct Connection {
    member: Member,
    room_id: Option<RoomId>,
}

impl Connection {
    fn new(member: Member) -> Self {
        Self {
            member,
            room_id: None,
        }
    }

    fn is_joined_room(&self, room_id: &RoomId) -> bool {
        self.room_id.as_ref() == Some(room_id)
    }

    fn has_joined_room(&self) -> bool {
        self.room_id.is_some()
    }

    fn join_room(&mut self, room_id: RoomId) {
        self.room_id = Some(room_id);
    }

    fn leave_room(&mut self) -> Option<RoomId> {
        self.room_id.take()
    }
}

fn submit_error(member: &Member, message: impl Into<String>) {
    member.submit_message(ServerMessage::Error {
        message: message.into(),
    });
}

fn leave_room_by_id(state: &AppState, member_id: &MemberId, room_id: RoomId) -> anyhow::Result<()> {
    let Some(mut room) = state.rooms().get_mut(&room_id) else {
        anyhow::bail!("room does not exist");
    };
    room.leave(member_id)?;
    room.broadcast(ServerMessage::Left {
        room_id,
        member_id: member_id.clone(),
    });
    Ok(())
}

fn leave_room(state: &AppState, connection: &mut Connection, room_id: RoomId) {
    if !connection.is_joined_room(&room_id) {
        submit_error(&connection.member, "Not a member of this room");
        return;
    }
    if let Err(error) = leave_room_by_id(state, &connection.member.id, room_id) {
        warn!("leave room failed: {error}");
        submit_error(&connection.member, error.to_string());
        return;
    }
    connection.leave_room();
}

fn join_room(
    state: &AppState,
    connection: &mut Connection,
    room_id: RoomId,
    username: String,
    auth: String,
) {
    if connection.has_joined_room() {
        submit_error(&connection.member, "Already joined a room");
        return;
    }
    let mut room = state
        .rooms()
        .entry(room_id.clone())
        .or_insert_with(|| Room::new(auth.clone()));
    if let Err(error) = room.join(&auth, connection.member.clone()) {
        warn!("join room failed: {error}");
        submit_error(&connection.member, error.to_string());
        return;
    }
    connection.join_room(room_id.clone());
    room.broadcast(ServerMessage::Join {
        room_id,
        member_id: connection.member.id.clone(),
        member_username: username,
    });
}

fn say(state: &AppState, connection: &Connection, room_id: RoomId, content: String) {
    if !connection.is_joined_room(&room_id) {
        submit_error(&connection.member, "Not a member of this room");
        return;
    }
    let Some(room) = state.rooms().get(&room_id) else {
        submit_error(&connection.member, "Room does not exist");
        return;
    };
    room.broadcast(ServerMessage::Say {
        room_id: room_id.to_string(),
        content,
    });
}

fn handle_client_message(state: &AppState, connection: &mut Connection, message: ClientMessage) {
    match message {
        ClientMessage::Join {
            room_id,
            username,
            auth,
        } => join_room(state, connection, room_id, username, auth),
        ClientMessage::Leave { room_id } => leave_room(state, connection, room_id),
        ClientMessage::Say { room_id, content } => say(state, connection, room_id, content),
    }
}

fn handle_close(state: &AppState, mut connection: Connection) {
    let Some(room_id) = connection.leave_room() else {
        return;
    };
    if let Err(error) = leave_room_by_id(state, &connection.member.id, room_id) {
        warn!("remove disconnected member failed: {error}");
    }
}

#[derive(Clone)]
pub struct AppHandler {
    state: AppState,
}

impl AppHandler {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    pub async fn handle(&self, stream: TcpStream) {
        let message_state = self.state.clone();
        let close_state = self.state.clone();

        WebSockHandler::new(
            Box::new(|submit_send| Connection::new(Member::new(MemberId::new(), submit_send))),
            Box::new(move |connection, message| {
                handle_client_message(&message_state, connection, message);
                Ok(())
            }),
            Box::new(move |connection| handle_close(&close_state, connection)),
        )
        .run_detached(stream)
        .await;
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use crossfire::mpsc;

    use super::*;

    fn room_id(value: &str) -> RoomId {
        serde_json::from_str(&format!("\"{value}\"")).unwrap()
    }

    fn join_message(room_id: RoomId, auth: &str) -> ClientMessage {
        ClientMessage::Join {
            room_id,
            username: "duck".to_string(),
            auth: auth.to_string(),
        }
    }

    #[tokio::test]
    async fn joining_a_second_room_is_rejected() {
        let state = AppState::default();
        let (submit_send, submit_recv) = mpsc::unbounded_async::<ServerMessage>();
        let mut connection = Connection::new(Member::new(MemberId::new(), submit_send));
        let first_room_id = room_id("first");
        let second_room_id = room_id("second");

        handle_client_message(
            &state,
            &mut connection,
            join_message(first_room_id.clone(), "first-auth"),
        );
        let joined = tokio::time::timeout(Duration::from_secs(1), submit_recv.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(joined, ServerMessage::Join { .. }));

        handle_client_message(
            &state,
            &mut connection,
            join_message(second_room_id.clone(), "second-auth"),
        );
        let rejected = tokio::time::timeout(Duration::from_secs(1), submit_recv.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(
            rejected,
            ServerMessage::Error { message } if message == "Already joined a room"
        ));
        assert!(connection.is_joined_room(&first_room_id));
        assert!(state.rooms().get(&second_room_id).is_none());
    }

    #[tokio::test]
    async fn say_requires_membership_in_the_target_room() {
        let state = AppState::default();
        let (submit_send, submit_recv) = mpsc::unbounded_async::<ServerMessage>();
        let mut connection = Connection::new(Member::new(MemberId::new(), submit_send));
        let joined_room_id = room_id("joined");
        let other_room_id = room_id("other");

        handle_client_message(
            &state,
            &mut connection,
            join_message(joined_room_id, "auth"),
        );
        let _ = tokio::time::timeout(Duration::from_secs(1), submit_recv.recv())
            .await
            .unwrap()
            .unwrap();

        handle_client_message(
            &state,
            &mut connection,
            ClientMessage::Say {
                room_id: other_room_id,
                content: "unauthorized".to_string(),
            },
        );
        let rejected = tokio::time::timeout(Duration::from_secs(1), submit_recv.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(
            rejected,
            ServerMessage::Error { message } if message == "Not a member of this room"
        ));
    }

    #[tokio::test]
    async fn leave_allows_joining_a_new_room() {
        let state = AppState::default();
        let (submit_send, submit_recv) = mpsc::unbounded_async::<ServerMessage>();
        let mut connection = Connection::new(Member::new(MemberId::new(), submit_send));
        let first_room_id = room_id("first");
        let second_room_id = room_id("second");

        handle_client_message(
            &state,
            &mut connection,
            join_message(first_room_id.clone(), "first-auth"),
        );
        let _ = tokio::time::timeout(Duration::from_secs(1), submit_recv.recv())
            .await
            .unwrap()
            .unwrap();

        handle_client_message(
            &state,
            &mut connection,
            ClientMessage::Leave {
                room_id: first_room_id,
            },
        );

        handle_client_message(
            &state,
            &mut connection,
            join_message(second_room_id.clone(), "second-auth"),
        );
        let joined = tokio::time::timeout(Duration::from_secs(1), submit_recv.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(joined, ServerMessage::Join { .. }));
        assert!(connection.is_joined_room(&second_room_id));
    }

    #[tokio::test]
    async fn joining_with_invalid_auth_returns_an_error() {
        let state = AppState::default();
        let room_id = room_id("room");
        let (first_submit_send, first_submit_recv) = mpsc::unbounded_async::<ServerMessage>();
        let mut first_connection = Connection::new(Member::new(MemberId::new(), first_submit_send));
        let (second_submit_send, second_submit_recv) = mpsc::unbounded_async::<ServerMessage>();
        let mut second_connection =
            Connection::new(Member::new(MemberId::new(), second_submit_send));

        handle_client_message(
            &state,
            &mut first_connection,
            join_message(room_id.clone(), "valid-auth"),
        );
        let _ = tokio::time::timeout(Duration::from_secs(1), first_submit_recv.recv())
            .await
            .unwrap()
            .unwrap();

        handle_client_message(
            &state,
            &mut second_connection,
            join_message(room_id, "invalid-auth"),
        );
        let rejected = tokio::time::timeout(Duration::from_secs(1), second_submit_recv.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(
            rejected,
            ServerMessage::Error { message } if message == "Invalid auth"
        ));
    }
}
