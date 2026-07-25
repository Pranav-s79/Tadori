from api import Payload, score, transform, unresolved


# Convention-derived test linkage, including an intentionally unresolved call.
def test_transform() -> None:
    assert Payload(transform(1)).label() == "py:2"
    assert score(Payload(1)) == 2
    unresolved("missing_plugin")
