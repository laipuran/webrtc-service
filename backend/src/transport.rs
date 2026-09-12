use std::time::Duration;

use crossfire::{MTx, mpsc};
use futures_util::{SinkExt, StreamExt};
use log::{debug, error, info};
use serde::{Serialize, de::DeserializeOwned};
use tokio::{
    net::TcpStream,
    time::{MissedTickBehavior, interval},
};
use tokio_tungstenite::{accept_async, tungstenite::Message};

pub type OutboundSender<O> = MTx<mpsc::List<O>>;

pub type ConnEstablishHandler<O, C> = Box<dyn FnOnce(OutboundSender<O>) -> C + Send>;
pub type ClientMessageHandler<I, C> = Box<dyn FnMut(&mut C, I) -> anyhow::Result<()> + Send>;
pub type ConnCloseHandler<C> = Box<dyn FnOnce(C) + Send>;

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);

pub struct WebSockHandler<I, O, C>
where
    I: DeserializeOwned,
    O: Serialize + Send + 'static,
{
    handle_conn_establish: ConnEstablishHandler<O, C>,
    handle_client_message: ClientMessageHandler<I, C>,
    handle_conn_close: ConnCloseHandler<C>,
}

impl<I, O, C> WebSockHandler<I, O, C>
where
    I: DeserializeOwned,
    O: Serialize + Send + 'static,
{
    pub fn new(
        handle_conn_establish: ConnEstablishHandler<O, C>,
        handle_client_message: ClientMessageHandler<I, C>,
        handle_conn_close: ConnCloseHandler<C>,
    ) -> Self {
        Self {
            handle_conn_establish,
            handle_client_message,
            handle_conn_close,
        }
    }

    pub async fn run_detached(self, stream: TcpStream) {
        let peer_addr = match stream.peer_addr() {
            Ok(addr) => addr,
            Err(e) => {
                error!("error getting peer addr: {}", e);
                return;
            }
        };

        let websock = match accept_async(stream).await {
            Ok(ws) => ws,
            Err(e) => {
                error!("websock accept error: {}", e);
                return;
            }
        };

        let (outbound_send, outbound_recv) = mpsc::unbounded_async::<O>();
        let (control_send, control_recv) = mpsc::unbounded_async::<Message>();
        let (mut websock_send, mut websock_recv) = websock.split();

        let Self {
            handle_conn_establish,
            mut handle_client_message,
            handle_conn_close,
        } = self;

        tokio::spawn(async move {
            let mut heartbeat = interval(HEARTBEAT_INTERVAL);
            heartbeat.set_missed_tick_behavior(MissedTickBehavior::Delay);
            heartbeat.tick().await;

            loop {
                let message = tokio::select! {
                    _ = heartbeat.tick()=>Message::Ping(Vec::new().into()),
                    outbound = outbound_recv.recv() => match outbound {
                        Ok(message) => match serde_json::to_string(&message) {
                            Ok(text) => Message::Text(text.into()),
                            Err(e) => {
                                error!("serialize server message error: {}", e);
                                continue;
                            }
                        },
                        Err(_) => break,
                    },
                    control = control_recv.recv() => match control {
                        Ok(message) => message,
                        Err(_) => break,
                    },
                };

                if let Err(e) = websock_send.send(message).await {
                    error!("websock send error: {}", e);
                    break;
                }
            }
        });

        let mut connection = handle_conn_establish(outbound_send.clone());

        'main: while let Some(input) = websock_recv.next().await {
            let message = match input {
                Ok(message) => message,
                Err(e) => {
                    error!("websock receive error: {}", e);
                    break;
                }
            };

            match message {
                Message::Close(_) => {
                    debug!("websock close");
                    break;
                }
                Message::Ping(payload) => {
                    if let Err(e) = control_send.send(Message::Pong(payload)) {
                        error!("control channel closed: {}", e);
                        break;
                    }
                }
                Message::Text(text) => {
                    let input = match serde_json::from_str(&text) {
                        Ok(input) => input,
                        Err(e) => {
                            error!("deserialize client message error: {}", e);
                            continue;
                        }
                    };
                    if let Err(e) = handle_client_message(&mut connection, input) {
                        error!("client message handler error: {}", e);
                        break 'main;
                    }
                }
                _ => {}
            }
        }

        info!("connection from {} closed", peer_addr);
        handle_conn_close(connection);
    }
}
