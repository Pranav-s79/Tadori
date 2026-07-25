"""Python structural extraction and the server side of the HTTP boundary."""
from dataclasses import dataclass
from importlib import import_module

# generated-from: ../../proto/oracle.proto
from oracle_pb2 import ScoreRequest


@dataclass
class Payload:
    value: int

    def label(self) -> str:
        return f"py:{self.value}"


def transform(value: int) -> int:
    return value + 1


def post(route: str):
    def decorate(handler):
        return handler
    return decorate


@post("/v1/score")
def score(payload: Payload) -> int:
    request = ScoreRequest(value=payload.value)
    return transform(request.value)


def unresolved(module_name: str):
    module = import_module(module_name)
    return getattr(module, "missing_handler")()
