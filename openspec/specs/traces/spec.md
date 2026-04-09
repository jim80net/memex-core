## Requirements

### Requirement: writeTrace creates the traces directory and writes a sanitized date-prefixed JSON filename

`writeTrace(tracesDir, trace)` SHALL create `tracesDir` recursively before writing. It SHALL write the trace as pretty-printed JSON to a filename shaped as `{date}-{sessionSlug}.json`, where `date` is the current ISO calendar date, `sessionSlug` is derived from `trace.sessionKey` by replacing every non-alphanumeric character with `-`, and the slug is truncated to at most 60 characters.

#### Scenario: Trace files are written under a sanitized session slug

- **WHEN** `writeTrace` is called for a session key containing punctuation or path-like characters
- **THEN** the output filename uses only alphanumeric characters and dashes in the slug portion and is prefixed by the current date

### Requirement: TraceAccumulator stores per-session trace state

`TraceAccumulator` SHALL maintain per-session state in memory containing `startTime`, a `skillsInjected` set, a `toolsCalled` set, `agentId`, and `messageCount`.

#### Scenario: Session state is initialized on first injection

- **WHEN** a session key is first seen through `recordInjection`
- **THEN** the accumulator creates an in-memory session record with the required fields and initializes both collections as empty sets before adding new skills

### Requirement: recordInjection adds injected skills and creates session state when missing

`recordInjection(sessionKey, agentId, skillNames)` SHALL create a session record when one does not exist and SHALL add each provided skill name to the session's `skillsInjected` set so repeated names are deduplicated.

#### Scenario: Repeated injection does not duplicate a skill name

- **WHEN** the same skill name is recorded multiple times for one session
- **THEN** the session retains that skill only once in `skillsInjected`

### Requirement: recordToolCall records tool usage in a set

`recordToolCall(sessionKey, toolName)` SHALL add the tool name to the session's `toolsCalled` set when the session exists.

#### Scenario: Tool call is ignored for unknown session

- **WHEN** `recordToolCall` is called before any session entry exists for that key
- **THEN** no session record is created and no tool call is stored

### Requirement: recordMessageCount updates the tracked message count

`recordMessageCount(sessionKey, count)` SHALL update the session's stored `messageCount` when the session exists.

#### Scenario: Message count replaces the prior count

- **WHEN** `recordMessageCount` is called multiple times for the same session
- **THEN** the most recent count becomes the stored `messageCount`

### Requirement: finalize returns an execution trace, removes session state, and only persists meaningful traces

`finalize(sessionKey, outcome, errorSummary?)` SHALL return `null` when the session key is unknown. For known sessions it SHALL build an `ExecutionTrace` from the accumulated state, including timestamp, duration, injected skills, called tools, message count, outcome, and optional error summary, then delete the session from the accumulator. The trace SHALL be written to disk only when `messageCount > 2` or at least one tool was called.

#### Scenario: Unknown session returns null

- **WHEN** `finalize` is called for a session key that is not being tracked
- **THEN** it returns `null`

#### Scenario: Finalized session is removed from the accumulator

- **WHEN** `finalize` succeeds for a tracked session
- **THEN** that session's in-memory state is deleted before the call returns

#### Scenario: Short idle sessions are not written to disk

- **WHEN** a finalized session has `messageCount <= 2` and no recorded tools
- **THEN** `finalize` returns the trace object but does not call `writeTrace`

#### Scenario: Active sessions are persisted

- **WHEN** a finalized session has more than two messages or at least one recorded tool call
- **THEN** `finalize` writes the trace JSON to disk and returns the trace object

### Requirement: cleanup removes expired session state based on age

`cleanup(maxAgeMs = 3600000)` SHALL delete any tracked session whose `startTime` is older than the current time minus `maxAgeMs`.

#### Scenario: Default cleanup removes sessions older than one hour

- **WHEN** `cleanup()` runs with no explicit argument
- **THEN** any tracked session older than one hour is removed from the accumulator
