use std::sync::{Arc, Mutex};

use futures_util::{SinkExt, StreamExt};
use log::{info, warn};
use tokio::{net::TcpStream, sync::mpsc::UnboundedSender};
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

use crate::{
    AppState,
    message::{ClientMsg, Member, PeerId, ServerMsg, Signal},
    room::{RoomError, RoomState},
    signaling::{
        Dest::{self, Myself},
        JoinResult, handle_join, handle_leave,
    },
};

pub struct Connection {
    member: Member,
    room_id: String,
}

pub type ConnState = Option<Connection>;

pub async fn handle_ws(stream: TcpStream, app_state: Arc<AppState>) {
    let Ok(peer_addr) = stream.peer_addr() else {
        return;
    };
    info!("Peer connected: {}", peer_addr);

    let Ok(ws) = accept_async(stream).await else {
        return;
    };

    let mut conn_state: ConnState = None;

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Message>();
    let (mut write, mut read) = ws.split();
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if write.send(msg).await.is_err() {
                break;
            }
        }
    });

    loop {
        let Some(payload) = read.next().await else {
            break;
        };
        let Ok(message) = payload else {
            break;
        };

        match message {
            Message::Close(_) => {
                break;
            }
            Message::Ping(p) => {
                let _ = tx.send(Message::Pong(p));
            }
            Message::Text(t) => {
                let Ok(msg): Result<ClientMsg, serde_json::Error> = serde_json::from_str(&t) else {
                    warn!("Parse failed on: {}", t);
                    continue;
                };
                let messages = handle_client_msg(&app_state, &mut conn_state, &tx, msg);
                handle_dispatch_msg(&app_state, &tx, messages);
            }
            _ => {}
        };
    }

    info!("Peer disconnected: {}", peer_addr);

    if let Some(conn) = conn_state {
        app_state.bus.lock().unwrap().remove(&conn.member.peer_id);
        let messages = handle_leave(&app_state.room_state, &conn.room_id, conn.member.peer_id);
        handle_dispatch_msg(&app_state, &tx, messages);
    }
}

fn handle_dispatch_msg(
    app_state: &Arc<AppState>,
    tx: &UnboundedSender<Message>,
    messages: Vec<(Dest, ServerMsg)>,
) {
    for (dest, server_msg) in messages {
        let text = serde_json::to_string(&server_msg).unwrap();
        let msg = Message::Text(text.into());

        match dest {
            Dest::Myself => _ = tx.send(msg.clone()),
            Dest::Peer(p) => handle_peer_msg(app_state, &msg, &p),
            Dest::Room(r) => handle_room_msg(app_state, &msg, &r),
        };
    }
}

fn handle_peer_msg(app_state: &Arc<AppState>, msg: &Message, peer_id: &PeerId) {
    if let Some(tx) = app_state.bus.lock().unwrap().get(peer_id) {
        _ = tx.send(msg.clone());
    }
}

fn handle_room_msg(app_state: &Arc<AppState>, msg: &Message, room_id: &str) {
    if let Ok(members) = app_state.room_state.lock().unwrap().members(room_id) {
        for Member { peer_id, .. } in members {
            handle_peer_msg(app_state, msg, peer_id);
        }
    }
}

fn handle_client_msg(
    app_state: &Arc<AppState>,
    conn_state: &mut ConnState,
    tx: &UnboundedSender<Message>,
    msg: ClientMsg,
) -> Vec<(Dest, ServerMsg)> {
    match msg {
        ClientMsg::Join {
            room_id,
            auth,
            username,
        } => handle_join_msg(app_state, conn_state, tx, room_id, auth, username),
        ClientMsg::Leave => handle_leave_msg(app_state, conn_state),
        ClientMsg::Signal { to, signal } => {
            handle_signal_msg(&app_state.room_state, conn_state, to, signal)
        }
    }
}

fn handle_join_msg(
    app_state: &Arc<AppState>,
    conn_state: &mut Option<Connection>,
    tx: &UnboundedSender<Message>,
    room_id: String,
    auth: String,
    username: String,
) -> Vec<(Dest, ServerMsg)> {
    if conn_state.is_some() {
        let dest = Myself;
        let error = ServerMsg::Error {
            message: RoomError::JoinedTwice.message().to_string(),
        };
        vec![(dest, error)]
    } else {
        let join_result = handle_join(&app_state.room_state, &room_id, &auth, &username);
        match join_result {
            JoinResult::Joined { peer_id, messages } => {
                app_state.bus.lock().unwrap().insert(peer_id, tx.clone());

                *conn_state = Some(Connection {
                    member: Member { peer_id, username },
                    room_id,
                });
                messages
            }
            JoinResult::Rejected { messages } => messages,
        }
    }
}

fn handle_leave_msg(
    app_state: &Arc<AppState>,
    conn_state: &mut Option<Connection>,
) -> Vec<(Dest, ServerMsg)> {
    match conn_state.take() {
        Some(conn) => {
            app_state.bus.lock().unwrap().remove(&conn.member.peer_id);
            handle_leave(&app_state.room_state, &conn.room_id, conn.member.peer_id)
        }
        None => Vec::new(),
    }
}

fn handle_signal_msg(
    room_state: &Mutex<RoomState>,
    conn_state: &mut Option<Connection>,
    to: PeerId,
    signal: Signal,
) -> Vec<(Dest, ServerMsg)> {
    let Some(connection) = conn_state else {
        return Vec::new();
    };
    let guard = room_state.lock().unwrap();
    let Ok(members) = guard.members(&connection.room_id) else {
        return Vec::new();
    };
    if members.iter().position(|m| m.peer_id == to).is_some() {
        let dest = Dest::Peer(to);
        let msg = ServerMsg::Signal {
            from: connection.member.peer_id,
            signal,
        };
        return vec![(dest, msg)];
    }
    Vec::new()
}
