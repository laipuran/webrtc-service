use serde::Deserialize;

use crate::topology::weight::Latency;

#[derive(Deserialize)]
pub struct LinkMetrics {
    latency: Latency,
}
