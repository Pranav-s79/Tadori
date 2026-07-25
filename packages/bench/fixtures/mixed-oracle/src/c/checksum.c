#include "checksum.h"

// C implementation consumed through the C ABI by C++.
int transform(int value) {
  return value + 1;
}

int c_checksum(const char *text) {
  int total = 0;
  while (*text != '\0') {
    total += *text++;
  }
  return transform(total);
}
