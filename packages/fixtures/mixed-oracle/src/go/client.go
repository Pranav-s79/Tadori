package oracle

//go:generate protoc --go_out=../gen ../../proto/oracle.proto
import (
	"fmt"

	oraclepb "example.com/tadori/mixed-oracle/gen/proto"
)

// Payload exercises a named type and method.
type Payload struct { Value int32 }

func (p Payload) Label() string { return fmt.Sprintf("go:%d", p.Value) }

func transform(value int32) int32 { return value + 1 }

func BuildRequest(payload Payload) *oraclepb.ScoreRequest {
	return &oraclepb.ScoreRequest{Value: transform(payload.Value)}
}

func unresolved(name string) {
	callbacks := map[string]func(){}
	callbacks[name]()
}
