mod handler;
mod message;
mod room;
mod state;

use std::error::Error;

use log::info;
use tokio::net::TcpListener;

use crate::{handler::AppHandler, state::AppState};

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    env_logger::init();

    let listener = TcpListener::bind("127.0.0.1:9001").await?;

    info!("Listening at 127.0.0.1:9001.");

    let app_handler = AppHandler::new(AppState::default());
    loop {
        let (stream, _) = listener.accept().await?;
        let app_handler = app_handler.clone();
        tokio::spawn(async move { app_handler.handle(stream).await });
    }
}
