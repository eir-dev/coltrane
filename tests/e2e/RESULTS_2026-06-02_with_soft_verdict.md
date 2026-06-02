# Phase 16 — coltrane-standard soft-judge for phase-15 e2e (self-referential)

**Run date:** 2026-06-02
**Branch:** `groove/phase16-soft-judge` (off `groove/phase15-e2e-sub-thread`)
**Standard:** `standards/sub_thread_invocation.json` (SENSE + INTERPRET)
**Self-referential:** coltrane's own runGig + Claude CLI score coltrane's own sub-thread tests.

## Honesty preamble

Phase-15 cleaned up its tempdirs in `afterAll`, so the e2e suite persisted NO transcripts
or recorder logs past its run. Phase-16 captures fresh artifacts for two representative
cases (one passing, one failing-equivalent) so the soft-judge has concrete inputs.

For both cases the recorder log is written EMPTY — mirroring the exact phase-15 finding
that coltrane has no `SubthreadRecorder` wired. The soft-judge surfaces this as
UNJUDGEABLE for any criterion that requires multi-turn evidence.

## Per-test soft-verdict

### sub_thread.eng_manager.spec.ts — hard: example completes without error (exit code 0)

- **Pre-reg verdict (hard):** PASS
- **Capture status:** to-capture: a fresh `claude -p` invocation matching the passing test's shape
- **Transcript:** `/Users/eugenestuckless/eir/coltrane-oss/tests/e2e/phase16_artifacts/sub_thread.eng_manager.spec.ts.hard_example_completes_without_error_exit_code_0_.stream.jsonl`
- **Recorder log:** `/Users/eugenestuckless/eir/coltrane-oss/tests/e2e/phase16_artifacts/sub_thread.eng_manager.spec.ts.hard_example_completes_without_error_exit_code_0_.recorder.jsonl` (empty by design)
- **Capture exit code:** 0

**SENSE output (parsed-conversation-trace):**
```json
{
  "transcript_path": "/Users/eugenestuckless/eir/coltrane-oss/tests/e2e/phase16_artifacts/sub_thread.eng_manager.spec.ts.hard_example_completes_without_error_exit_code_0_.stream.jsonl",
  "recorder_log_path": "/Users/eugenestuckless/eir/coltrane-oss/tests/e2e/phase16_artifacts/sub_thread.eng_manager.spec.ts.hard_example_completes_without_error_exit_code_0_.recorder.jsonl",
  "transcript_present": true,
  "recorder_log_present": false,
  "recorder_log_empty": true,
  "turns": [
    {
      "turn_idx": 0,
      "parent_session_id": null,
      "child_session_id": "cbd7c037-f74a-4cea-b4e4-7b7cacca3ade",
      "prompt": null,
      "response": "ready",
      "timestamp": null,
      "tool_calls": []
    }
  ],
  "notes": "Transcript is a single-turn stream-json run. The init system event reports session_id cbd7c037-f74a-4cea-b4e4-7b7cacca3ade (treated as child_session_id; no parent_session_id present, so this is a root run). No user/parent prompt line is captured in the stream (no {type:'user'} event), so prompt is null rather than fabricated — the assistant simply emitted 'ready' and the run terminated with result.subtype='success', result text 'ready', stop_reason 'end_turn', num_turns 1. No tool_calls occurred. No per-event timestamps are present in the stream (only a rate_limit resetsAt epoch), so timestamp is null. The recorder log file is empty/missing — recorder_log_present=false and recorder_log_empty=true."
}
```

**INTERPRET output (soft-verdict):**
```json
{
  "criteria": {
    "parent_context_preservation": {
      "score": null,
      "rationale": "Cannot be judged. The trace contains no --resume: parent_session_id is null and there is exactly one turn (turn_idx 0) whose prompt is null and whose response is the stub 'ready'. With no parent prompt to seed named context (deals, units, north-stars) and no subsequent child turn that could echo it, there are zero prior-turn entities to test for survival. Scoring this would require fabricating a context-preservation event the transcript never recorded."
    },
    "child_stay_on_task": {
      "score": null,
      "rationale": "Cannot be judged. 'Staying on task' presupposes a parent ask to stay on; here prompt=null, so no original ask was captured in the stream (no {type:'user'} event). The single assistant emission was 'ready' with num_turns=1 and no tool_calls. There is no task and no drift to measure — only a one-shot stub."
    },
    "inter_turn_coherence": {
      "score": null,
      "rationale": "Cannot be judged. Inter-turn coherence requires at least two successive responses to test for accumulation/back-reference. The trace has a single turn, so there is no second response to read against the first. N=1 is structurally insufficient for this criterion."
    },
    "graceful_degradation": {
      "score": null,
      "rationale": "Cannot be judged. No context-window overflow or structural failure was exercised in this run: it terminated with result.subtype='success', stop_reason='end_turn', exit code 0. With no stress condition reached, there is no degradation behavior (graceful or hard-fail) to observe. The run's cleanness is not evidence of graceful degradation — it is the absence of the test condition entirely."
    }
  },
  "overall_verdict_shade": "UNJUDGEABLE",
  "top_insight": "The hard-asserts went green on 'completes without error / exit code 0', but the transcript shows that green masks a substantively empty run: a single root turn with no parent prompt, no --resume, no follow-up, no tool_calls — the assistant emitted only the stub 'ready' (num_turns=1) — and the recorder log is empty/missing (recorder_log_present=false, recorder_log_empty=true). Exit-0 certifies the harness didn't crash, not that any sub-thread invocation occurred; none of the four soft criteria have any behavioral substrate to score, so the only honest verdict is UNJUDGEABLE. The real signal the hard layer missed is that this spec is passing on a no-op transcript."
}
```

**Verdict shade:** `UNJUDGEABLE`
**Top insight (beyond hard-asserts):** The hard-asserts went green on 'completes without error / exit code 0', but the transcript shows that green masks a substantively empty run: a single root turn with no parent prompt, no --resume, no follow-up, no tool_calls — the assistant emitted only the stub 'ready' (num_turns=1) — and the recorder log is empty/missing (recorder_log_present=false, recorder_log_empty=true). Exit-0 certifies the harness didn't crash, not that any sub-thread invocation occurred; none of the four soft criteria have any behavioral substrate to score, so the only honest verdict is UNJUDGEABLE. The real signal the hard layer missed is that this spec is passing on a no-op transcript.

### sub_thread.solo_dev.spec.ts — hard: 3-parallel children return session_ids; recorder captures all 3

- **Pre-reg verdict (hard):** FAIL
- **Capture status:** to-capture: stream-json from one of the 3 parallel children + a deliberately EMPTY recorder log (mirroring the phase-15 finding that coltrane has no sub-thread recorder hook)
- **Transcript:** `/Users/eugenestuckless/eir/coltrane-oss/tests/e2e/phase16_artifacts/sub_thread.solo_dev.spec.ts.hard_3_parallel_children_return_session_ids_recorder_capture.stream.jsonl`
- **Recorder log:** `/Users/eugenestuckless/eir/coltrane-oss/tests/e2e/phase16_artifacts/sub_thread.solo_dev.spec.ts.hard_3_parallel_children_return_session_ids_recorder_capture.recorder.jsonl` (empty by design)
- **Capture exit code:** 0

**SENSE output (parsed-conversation-trace):**
```json
{
  "transcript_path": "/Users/eugenestuckless/eir/coltrane-oss/tests/e2e/phase16_artifacts/sub_thread.solo_dev.spec.ts.hard_3_parallel_children_return_session_ids_recorder_capture.stream.jsonl",
  "recorder_log_path": "/Users/eugenestuckless/eir/coltrane-oss/tests/e2e/phase16_artifacts/sub_thread.solo_dev.spec.ts.hard_3_parallel_children_return_session_ids_recorder_capture.recorder.jsonl",
  "transcript_present": true,
  "recorder_log_present": false,
  "recorder_log_empty": true,
  "turns": [
    {
      "turn_idx": 0,
      "parent_session_id": null,
      "child_session_id": "ed27157d-c334-40f5-b1d1-ff42e848c0df",
      "prompt": "",
      "response": "one",
      "timestamp": null,
      "tool_calls": []
    }
  ],
  "notes": "Transcript parsed successfully but contains only a SINGLE session (ed27157d-c334-40f5-b1d1-ff42e848c0df), comprising: a system/init event, a rate_limit_event (status=allowed, overageStatus=rejected/out_of_credits), one assistant message with text 'one', and a result event (subtype=success, result='one', num_turns=1, duration_ms=2087). No user/parent prompt is present in the stream-json — there is no event of type 'user', so the prompt for turn 0 could not be recovered and is reported as empty string (NOT fabricated). No timestamp field is present on any per-turn event (only an epoch resetsAt in the rate_limit_event and a result duration), so timestamp is null. No tool_calls occurred. The recorder log file is empty/missing — recorder_log_present=false and recorder_log_empty=true (the two cases are indistinguishable from the provided contents). IMPORTANT FINDING: the test is named 'hard_3_parallel_children_return_session_ids_recorder_capture', implying 3 parallel child invocations each returning a session_id with recorder capture, but this transcript captures only 1 session and the recorder log is empty. Either the other 2 children's traces live in separate artifact files, or the parallel-children + recorder-capture behavior was not exercised/captured in this run."
}
```

**INTERPRET output (soft-verdict):**
```json
{
  "criteria": {
    "parent_context_preservation": {
      "score": null,
      "rationale": "Unjudgeable. parent_session_id is null and there is exactly one turn (turn_idx=0) with no --resume follow-up. There is no parent prompt in the stream-json (no event of type 'user', prompt recovered as empty string) and no prior-turn entities (deals/units/north-stars/prior outputs) to look for echoes of. A single child session with no parent and no second turn cannot demonstrate context surviving a resume."
    },
    "child_stay_on_task": {
      "score": null,
      "rationale": "Unjudgeable. The original ask cannot be reconstructed — the prompt is an empty string (not present in the transcript, correctly not fabricated by the sensor) and the entire response is the single token 'one'. With no known task and a one-word output there is no basis to assess focus vs. drift."
    },
    "inter_turn_coherence": {
      "score": null,
      "rationale": "Unjudgeable. Coherence is a relation between successive responses, and only one turn exists (num_turns=1). There are no later responses to test for accumulation of state or back-reference to a prior turn."
    },
    "graceful_degradation": {
      "score": null,
      "rationale": "Unjudgeable. No context-window overflow or structural failure occurred in the captured turn (result subtype=success, no stack trace, no silent corruption visible), so the degradation precondition was never triggered for this single session. The interesting signal — the rate_limit_event's overageStatus=rejected/out_of_credits — is upstream of the response, not a degradation of it, and the trace is too thin to judge whether the missing children degraded gracefully or were hard-killed."
    }
  },
  "overall_verdict_shade": "UNJUDGEABLE",
  "top_insight": "The hard-asserts treat this as a captured run, but the artifact is structurally incomplete in a way that points at a cause: the test 'hard_3_parallel_children_return_session_ids_recorder_capture' expects 3 parallel child sessions each returning a session_id plus a recorder capture, yet the transcript holds exactly ONE session (ed27157d…) producing only 'one' and the recorder log is empty. The rate_limit_event in that same session carries overageStatus=rejected/out_of_credits — strongly suggesting the parallel children were rejected for credit overage and only a single degenerate session survived, which is also why the recorder captured nothing. That credit-exhaustion → partial-fan-out linkage is invisible to session-id/structure hard-asserts, which would only report 'fewer sessions than expected' without the why."
}
```

**Verdict shade:** `UNJUDGEABLE`
**Top insight (beyond hard-asserts):** The hard-asserts treat this as a captured run, but the artifact is structurally incomplete in a way that points at a cause: the test 'hard_3_parallel_children_return_session_ids_recorder_capture' expects 3 parallel child sessions each returning a session_id plus a recorder capture, yet the transcript holds exactly ONE session (ed27157d…) producing only 'one' and the recorder log is empty. The rate_limit_event in that same session carries overageStatus=rejected/out_of_credits — strongly suggesting the parallel children were rejected for credit overage and only a single degenerate session survived, which is also why the recorder captured nothing. That credit-exhaustion → partial-fan-out linkage is invisible to session-id/structure hard-asserts, which would only report 'fewer sessions than expected' without the why.

## Phase-15 cases that CANNOT be soft-judged

Per honest pre-reg discipline, the following phase-15 tests cannot be soft-judged from
existing artifacts because phase-15 produced no persisted transcripts. The soft-judge
is meaningful ONLY where a real conversation can be inspected:

- `platform_team` F1 hash-stability (vacuous-pass; both hashes were SHA256(empty) per phase-15)
- `research_lab` F1 chain-of-5 (same vacuous-pass condition)
- `research_lab` F4 nested depth ≥3 (no lineage edges in any artifact)
- `platform_team` F2 API-version-bump fails-CLOSED (no API-version concept → no transcript to judge)
- `platform_team` F3, `research_lab` F5 (both blocked on the same recorder gap)

These are structurally unjudgeable until coltrane wires the `SubthreadRecorder`. Once
the recorder is wired, the soft-judge's INTERPRET phase can score the recorded turn-list
directly without needing to re-capture transcripts.

## Apoha — what this soft-judge is NOT

- NOT a replacement for the hard RED/GREEN asserts (those still own correctness)
- NOT a new judge framework (REUSES runGig + claude_invoker.extractJson)
- NOT fabricating turns when none exist (returns UNJUDGEABLE with diagnosis)
- NOT modifying phase-15's tests (this branch is purely additive)
