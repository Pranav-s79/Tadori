#include "checksum.h"
#include <assert.h>

typedef void (*Callback)(void);

// A small C test caller.
int main(void) {
  Callback callback = 0;
  if (callback != 0) callback(); /* unresolved indirect call */
  assert(transform(1) == 2);
  return 0;
}
