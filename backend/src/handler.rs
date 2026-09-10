use log::warn;
use tokio::net::TcpStream;

use crate::{
    message::{ClientMessage, ServerMessage, Signal},
    room::{
        Room,
        id::RoomId,
        member::{Member, MemberId},
        result::RoomError,
    },
    state::AppState,
    transport::WebSockHandler,
};

pub struct Connection {
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

    fn has_joined(&self) -> bool {
        self.room_id.is_some()
    }
}

fn join_room(
    state: &AppState,
    connection: &mut Connection,
    room_id: RoomId,
    auth: String,
    username: String,
) {
    if connection.has_joined() {
        connection.member.submit(ServerMessage::Error {
            message: RoomError::JoinedTwice.to_string(),
        });
        return;
    }

    connection.member.username = username;

    let mut room = state
        .rooms()
        .entry(room_id.clone())
        .or_insert_with(Room::new);
    match room.join(&auth, connection.member.clone()) {
        Ok(()) => {
            connection.member.submit(ServerMessage::Joined {
                member_id: connection.member.id.clone(),
                room_id: room_id.clone(),
            });
            room.broadcast(ServerMessage::Roster {
                members: room.summary(),
            });
            connection.room_id = Some(room_id);
        }
        Err(e) => {
            warn!("join room failed: {}", e);
            connection.member.submit(ServerMessage::Error {
                message: e.to_string(),
            });
        }
    }
}

fn leave_room(state: &AppState, connection: &mut Connection) {
    let Some(room_id) = connection.room_id.take() else {
        return;
    };

    let mut should_remove = false;
    if let Some(mut room) = state.rooms().get_mut(&room_id) {
        match room.leave(&connection.member.id) {
            Ok(()) => {
                room.broadcast(ServerMessage::MemberLeft {
                    member_id: connection.member.id.clone(),
                });
                should_remove = room.is_empty();
            }
            Err(e) => {
                warn!("leave room failed: {}", e);
                connection.member.submit(ServerMessage::Error {
                    message: e.to_string(),
                });
            }
        }
    }

    if should_remove {
        state.rooms().remove(&room_id);
    }
}

fn forward_signal(state: &AppState, connection: &Connection, to: MemberId, signal: Signal) {
    let Some(room_id) = connection.room_id.as_ref() else {
        return;
    };
    let Some(room) = state.rooms().get(room_id) else {
        return;
    };
    room.send_to(
        &to,
        ServerMessage::Signal {
            from: connection.member.id.clone(),
            signal,
        },
    );
}

fn handle_client_message(state: &AppState, connection: &mut Connection, message: ClientMessage) {
    match message {
        ClientMessage::Join {
            room_id,
            auth,
            username,
        } => join_room(state, connection, room_id, auth, username),
        ClientMessage::Leave => leave_room(state, connection),
        ClientMessage::Signal { to, signal } => forward_signal(state, connection, to, signal),
    }
}

fn handle_close(state: &AppState, mut connection: Connection) {
    leave_room(state, &mut connection);
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
            Box::new(|outbound_send| {
                Connection::new(Member::new(MemberId::new(), String::new(), outbound_send))
            }),
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
