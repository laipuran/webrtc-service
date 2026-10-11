pub trait Weight: Copy + Ord {
    fn zero() -> Self;
    fn checked_add(self, rhs: Self) -> Option<Self>;
}

#[derive(Eq, Ord, Clone, Copy, Debug, PartialEq, PartialOrd)]
pub struct Latency(u64);

impl Latency {
    pub fn from_millis(value: u64) -> Self {
        Self(value)
    }

    pub fn as_millis(self) -> u64 {
        self.0
    }
}

impl Weight for Latency {
    fn zero() -> Self {
        Self(0)
    }

    fn checked_add(self, rhs: Self) -> Option<Self> {
        self.0.checked_add(rhs.0).map(Self)
    }
}
