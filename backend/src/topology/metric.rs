use serde::Deserialize;

use crate::topology::weight::{Latency, LinkCost};

#[derive(Deserialize)]
pub struct LinkMetrics {
    latency: Latency,
}

impl LinkMetrics {
    /// Lower costs represent better links. Currently latency is the only metric.
    pub fn cost(&self) -> LinkCost {
        LinkCost::new(self.latency.as_millis())
    }
}
