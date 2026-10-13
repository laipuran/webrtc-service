use serde::Deserialize;

#[derive(Eq, Ord, Clone, Copy, Debug, PartialEq, PartialOrd)]
pub struct LinkCost(u64);

impl LinkCost {
    pub fn new(value: u64) -> Self {
        Self(value)
    }

    pub fn value(self) -> u64 {
        self.0
    }
    pub fn zero() -> Self {
        Self(0)
    }

    pub fn checked_add(self, rhs: Self) -> Option<Self> {
        self.0.checked_add(rhs.0).map(Self)
    }
}

#[derive(Eq, Ord, Clone, Copy, Debug, PartialEq, PartialOrd, Deserialize)]
pub struct Latency(u64);

impl Latency {
    pub fn from_millis(value: u64) -> Self {
        Self(value)
    }

    pub fn as_millis(self) -> u64 {
        self.0
    }
}
