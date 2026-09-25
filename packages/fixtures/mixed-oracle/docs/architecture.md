# Mixed-language oracle

<!-- Markdown comment extraction sentinel. -->

The TypeScript client posts to `http://python-api:8000/v1/score`, implemented by
the Python `score` handler. Python and Go reference bindings generated from
`proto/oracle.proto`. C++ includes the C ABI header and invokes the Python
healthcheck as a subprocess. CMake links the C implementation into C++.

This prose is repository-derived evidence, not a compiler-resolved relation.
