// Package output owns the observational protocol, independently of telemetry.
package output

import "io"

// Hooks returns a copy; sessionEnd remains response-compatible but is not qualified
// for installation on the measured Cursor build.
func Hooks() []string {
	return []string{"sessionStart", "preToolUse", "postToolUse", "postToolUseFailure", "beforeReadFile", "afterFileEdit", "beforeShellExecution", "afterShellExecution", "beforeMCPExecution", "afterMCPExecution", "subagentStart", "subagentStop", "stop", "sessionEnd"}
}

func Known(hook string) bool {
	for _, known := range Hooks() {
		if hook == known {
			return true
		}
	}
	return false
}

// Respond makes a single write. Retrying a partial write could corrupt the hook
// protocol. Unknown launcher arguments receive the benign non-permission shape.
func Respond(w io.Writer, hook string) error {
	response := "{}\n"
	switch hook {
	case "preToolUse", "beforeReadFile", "beforeShellExecution", "beforeMCPExecution", "subagentStart":
		response = "{\"permission\":\"allow\"}\n"
	}
	n, err := io.WriteString(w, response)
	if err == nil && n != len(response) {
		return io.ErrShortWrite
	}
	return err
}
