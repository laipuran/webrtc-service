mod handler;
mod message;
mod room;
mod state;
mod transport;

use std::error::Error;

use log::info;
use tokio::net::TcpListener;

use crate::{handler::AppHandler, state::AppState};

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    env_logger::init();

    let bind_addr = std::env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:9001".to_string());
    let listener = TcpListener::bind(&bind_addr).await?;
    info!("Listening at {bind_addr}.");

    let app_handler = AppHandler::new(AppState::default());
    loop {
        let (stream, _) = listener.accept().await?;
        let app_handler = app_handler.clone();
        tokio::spawn(async move { app_handler.handle(stream).await });
    }
}
