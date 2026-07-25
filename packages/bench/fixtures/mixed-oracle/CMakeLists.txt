cmake_minimum_required(VERSION 3.20)
project(mixed_oracle LANGUAGES C CXX)

# Explicit C -> C++ build/link boundary.
add_library(checksum STATIC src/c/checksum.c)
target_include_directories(checksum PUBLIC src/c)
add_library(cpp_bridge STATIC src/cpp/bridge.cpp)
target_link_libraries(cpp_bridge PRIVATE checksum)
