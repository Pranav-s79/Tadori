use mixed_oracle::{transform, Payload};

// Rust integration-test calls.
#[test]
fn test_transform() {
    assert_eq!(transform(1), 2);
    assert_eq!(Payload { value: 1 }.label(), "rust:1");
}
