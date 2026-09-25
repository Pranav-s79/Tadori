package oracle

import "testing"

// Go test call and method linkage.
func TestTransform(t *testing.T) {
	if got := transform(1); got != 2 { t.Fatalf("got %d", got) }
	_ = Payload{Value: 1}.Label()
}
