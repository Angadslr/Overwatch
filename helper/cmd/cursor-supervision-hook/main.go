package main

import (
	"io"
	"os"
	"time"

	"overwatch/helper/internal/input"
	"overwatch/helper/internal/output"
	"overwatch/helper/internal/spool"
)

const invocationBudget = 1500 * time.Millisecond

// run separates the mandatory response from fallible telemetry work. The consumer
// receives only projected metadata; T06 will supply atomic spool publication.
// Its goroutine must own any resources it opens, even after the budget expires.
func run(args []string, stdin io.Reader, stdout io.Writer, consume func(input.Result) error) input.Result {
	hook := ""
	if len(args) > 0 {
		hook = args[0]
	}
	if err := output.Respond(stdout, hook); err != nil {
		return input.Result{Counters: input.Counters{Gap: "response-write-failed"}}
	}
	if len(args) != 1 || !output.Known(hook) {
		return input.Result{Counters: input.Counters{Gap: "invalid-launcher"}}
	}
	done := make(chan input.Result, 1)
	go func() {
		result := input.Result{Counters: input.Counters{Gap: "telemetry-panic"}}
		defer func() {
			if recover() != nil {
				result = input.Result{Counters: input.Counters{Gap: "telemetry-panic"}}
			}
			done <- result
		}()
		result = input.Project(stdin, hook)
		if consume != nil {
			if err := consume(result); err != nil {
				result.Counters.Gap = "telemetry-consumer-failed"
			}
		}
	}()
	timer := time.NewTimer(invocationBudget)
	defer timer.Stop()
	select {
	case result := <-done:
		return result
	case <-timer.C:
		return input.Result{Counters: input.Counters{Gap: "input-or-consumer-timeout"}}
	}
}

func main() {
	args := os.Args[1:]
	var consume func(input.Result) error
	if len(args) == 2 {
		path := args[1]
		consume = func(result input.Result) error { return spool.PublishResult(path, result) }
		args = args[:1]
	}
	// Only the trusted launcher selects a spool path; no payload can redirect it.
	// Response-only invocation remains available without a collector.
	run(args, os.Stdin, os.Stdout, consume)
}
