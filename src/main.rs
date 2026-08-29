mod handler;
mod message;
mod room;
mod signaling;

use std::{
    collections::HashMap,
    error::Error,
    sync::{Arc, Mutex},
};

use log::info;
use tokio::{net::TcpListener, sync::mpsc::UnboundedSender};
use tokio_tungstenite::tungstenite::Message;

use crate::room::RoomState;
use crate::{
    handler::handle_ws,
    message::PeerId,
};

pub struct AppState {
    room_state: Mutex<RoomState>,
    bus: Mutex<HashMap<PeerId, UnboundedSender<Message>>>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    env_logger::init();

    let listener = TcpListener::bind("127.0.0.1:9001").await?;
    info!("Listening at 127.0.0.1:9001.");

    let app_state = Arc::new(AppState {
        room_state: Mutex::new(RoomState::new()),
        bus: Mutex::new(HashMap::new()),
    });
    loop {
        let (stream, _) = listener.accept().await?;
        let app_state = Arc::clone(&app_state);
        tokio::spawn(handle_ws(stream, app_state));
    }
}
