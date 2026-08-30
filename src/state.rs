use std::sync::Arc;

use dashmap::DashMap;

use crate::room::{Room, id::RoomId};

#[derive(Clone, Default)]
pub struct AppState {
    inner: Arc<AppStateInner>,
}

impl AppState {
    pub fn rooms(&self) -> &DashMap<RoomId, Room> {
        &self.inner.rooms
    }
}

#[derive(Default)]
struct AppStateInner {
    rooms: DashMap<RoomId, Room>,
}
