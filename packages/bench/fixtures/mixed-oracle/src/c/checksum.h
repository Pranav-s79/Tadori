#ifndef MIXED_ORACLE_CHECKSUM_H
#define MIXED_ORACLE_CHECKSUM_H

#ifdef __cplusplus
extern "C" {
#endif

typedef struct Payload {
  int value;
} Payload;

int transform(int value);
int c_checksum(const char *text);

#ifdef __cplusplus
}
#endif

#endif
