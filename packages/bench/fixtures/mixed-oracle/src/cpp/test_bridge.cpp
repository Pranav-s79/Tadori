#include <cassert>

namespace oracle { int transform(int value); }

// C++ test call.
int main() {
  assert(oracle::transform(1) > 1);
  return 0;
}
