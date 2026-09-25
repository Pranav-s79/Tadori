use std::collections::HashMap;

/// Rust named type and method.
pub struct Payload { pub value: i32 }

impl Payload {
    pub fn label(&self) -> String { format!("rust:{}", self.value) }
}

pub fn transform(value: i32) -> i32 { value + 1 }

pub fn unresolved(name: &str) {
    let callbacks: HashMap<&str, fn()> = HashMap::new();
    if let Some(callback) = callbacks.get(name) { callback(); }
}
