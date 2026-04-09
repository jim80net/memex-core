## Requirements

### Requirement: SessionTracker defines the rule-disclosure tracking contract

`SessionTracker` SHALL expose four methods: `hasRuleBeenShown(sessionId, location)`, `markRuleShown(sessionId, location)`, `clearSession(sessionId)`, and `cleanup(maxAgeMs?)`. The interface SHALL support callers that need to know whether a rule has already been fully shown during the current session.

#### Scenario: Session tracker exposes graduated-disclosure queries and updates

- **WHEN** a caller uses `SessionTracker`
- **THEN** it can check whether a rule was already shown, mark it as shown, clear a session, and request cleanup of stale sessions

### Requirement: InMemorySessionTracker stores disclosure state in process memory only

`InMemorySessionTracker` SHALL store session state in an in-memory `Map<string, { rules: Set<string>; lastAccess: number }>` keyed by session ID. `markRuleShown` SHALL create a session entry on first use, add the rule location to that session's `Set`, and refresh `lastAccess`. `hasRuleBeenShown` SHALL report whether the location exists in the session's `Set` and also refresh `lastAccess` when the session exists. `clearSession` SHALL remove the session entry entirely. Because storage is process-local memory, all state SHALL reset on process restart.

#### Scenario: Marking and checking a rule updates in-memory session state

- **WHEN** `markRuleShown(sessionId, location)` is called and then `hasRuleBeenShown(sessionId, location)` is checked in the same process
- **THEN** the tracker reports `true` for that session-location pair

#### Scenario: Process restart clears disclosure history

- **WHEN** the process restarts and a new `InMemorySessionTracker` is created
- **THEN** previously shown rules are no longer present because the tracker does not persist state

### Requirement: InMemorySessionTracker supports cleanup of stale sessions

`cleanup(maxAgeMs = 3600000)` SHALL delete any session whose `lastAccess` timestamp is older than `Date.now() - maxAgeMs`. The default retention window SHALL be one hour.

#### Scenario: Default cleanup removes sessions idle for more than one hour

- **WHEN** `cleanup()` runs
- **THEN** any session whose `lastAccess` is more than 3600000 ms old is removed from the internal map

### Requirement: Session tracking enables graduated disclosure for repeated rule matches

The session tracker SHALL support a graduated disclosure pattern in which the first match for a rule in a session can be treated as unseen, and later matches in that same session can be treated as already shown. After a caller marks a rule as shown, subsequent `hasRuleBeenShown(sessionId, location)` calls for the same session and location SHALL return `true`, enabling consumers to switch from full rule content to a one-line reminder.

#### Scenario: First match can be full content and later matches can be one-liners

- **WHEN** a caller checks a rule before it has been marked shown, then calls `markRuleShown(sessionId, location)`, and checks again for the same session and location
- **THEN** the first check reports unseen and the later check reports seen, enabling full-content-first and one-liner-later behavior
