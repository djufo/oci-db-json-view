package main

import (
	"os"
	"os/exec"
	"strings"
	"testing"
)

func TestInvalidFramePolicyRefusesBeforeOracleStartup(t *testing.T) {
	if os.Getenv("FRAME_POLICY_TEST_CHILD") == "1" {
		main()
		return
	}
	t.Setenv("FRAME_ALLOWED_ANCESTORS", "http://localhost|embed")
	t.Setenv("FRAME_ALLOWED_INSECURE_HOSTS", "")
	command := exec.Command(os.Args[0], "-test.run=^TestInvalidFramePolicyRefusesBeforeOracleStartup$")
	command.Env = append(os.Environ(), "FRAME_POLICY_TEST_CHILD=1")
	output, err := command.CombinedOutput()
	if err == nil || !strings.Contains(string(output), "invalid FRAME_ALLOWED_ANCESTORS") || strings.Contains(string(output), "open oracle") {
		t.Fatalf("startup did not reject frame configuration first: %v %s", err, output)
	}
}
