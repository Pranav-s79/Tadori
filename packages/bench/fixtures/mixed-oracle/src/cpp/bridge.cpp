#include "../c/checksum.h"
#include <cstdlib>
#include <string>

// C++ calls C over an evidenced header/ABI boundary and Python as a subprocess.
struct Payload {
  int value;
  std::string label() const { return "cpp:" + std::to_string(value); }
};

namespace oracle {
int transform(int value) {
  return c_checksum("cpp") + value;
}
}  // namespace oracle

int run_python_healthcheck() {
  return std::system("python3 src/python/api.py --healthcheck");
}

int unresolved(void (*callback)()) {
  if (callback != nullptr) callback();
  return 0;
}
