## Requirements

### Requirement: loadTelemetry returns version 1 telemetry data and falls back to empty data on invalid input

`loadTelemetry(telemetryPath)` SHALL read JSON telemetry from disk and expect the version 1 schema `{ version: 1, entries: {} }`. If the file is missing, unreadable, malformed, or has a version other than `1`, the function SHALL return an empty version 1 telemetry object.

#### Scenario: Valid version 1 telemetry loads successfully

- **WHEN** the telemetry file contains valid JSON with `version: 1`
- **THEN** `loadTelemetry` returns the parsed data

#### Scenario: Corrupt or mismatched telemetry is ignored

- **WHEN** the telemetry file is unreadable, invalid JSON, or declares a version other than `1`
- **THEN** `loadTelemetry` returns `{ version: 1, entries: {} }`

### Requirement: saveTelemetry writes atomically and creates parent directories

`saveTelemetry(telemetryPath, data)` SHALL create the destination parent directory if needed, write the JSON payload to a uniquely suffixed temporary file, and then replace the target path via rename so the final write is atomic at the file level.

#### Scenario: Saving telemetry creates missing directories

- **WHEN** the parent directory for `telemetryPath` does not exist
- **THEN** `saveTelemetry` creates it before writing the temp file and renaming it into place

### Requirement: recordMatch mutates telemetry entries in place and tracks sessions and query hits

`recordMatch(telemetry, location, sessionId, queryIndex?)` SHALL mutate the supplied telemetry object in place. On a first match for a location, it SHALL create an entry with `matchCount = 1`, `firstMatched = now`, `lastMatched = now`, and `sessionIds = [sessionId]`. On later matches it SHALL increment `matchCount`, refresh `lastMatched`, retain unique session IDs in a sliding window capped at 50 values, and increment `queryHits[queryIndex]` when a query index is provided.

#### Scenario: First match creates a telemetry entry

- **WHEN** `recordMatch` is called for a location that does not yet exist in `telemetry.entries`
- **THEN** a new entry is created with count `1`, matching first and last timestamps, and the current session ID recorded once

#### Scenario: Repeated matches update counts and maintain the session window

- **WHEN** `recordMatch` is called repeatedly for an existing location across many sessions
- **THEN** the match count increases, `lastMatched` updates, duplicate session IDs are not re-added, and only the most recent 50 unique session IDs are retained

#### Scenario: Query hits accumulate by query index

- **WHEN** `recordMatch` is called with a `queryIndex`
- **THEN** the entry records or increments that index under `queryHits`

### Requirement: recordObservation appends observations with a capped history and ignores unknown entries

`recordObservation(telemetry, location, observation)` SHALL append the observation to the matched entry's `observations` array, creating that array when needed, and SHALL retain only the most recent 100 observations. If the location has no telemetry entry, the function SHALL do nothing.

#### Scenario: Observation history is capped

- **WHEN** more than 100 observations are recorded for one entry
- **THEN** only the latest 100 observations remain on that entry

#### Scenario: Missing entries are ignored

- **WHEN** `recordObservation` is called for a location absent from `telemetry.entries`
- **THEN** the telemetry data remains unchanged

### Requirement: clearObservations removes stored observations and no-ops for missing entries

`clearObservations(telemetry, location)` SHALL delete the `observations` field from the specified telemetry entry. If the entry does not exist, the function SHALL leave telemetry unchanged.

#### Scenario: Observations are cleared from an existing entry

- **WHEN** `clearObservations` is called for an entry with stored observations
- **THEN** the entry no longer has an `observations` field

#### Scenario: Missing entry is ignored during clear

- **WHEN** `clearObservations` is called for an unknown location
- **THEN** no telemetry entries are created or modified

### Requirement: formatTelemetryReport renders a markdown table or an empty-data message

`formatTelemetryReport(telemetry)` SHALL return `"No telemetry data."` when there are no entries. Otherwise it SHALL return a markdown table with the columns `Entry`, `Matches`, `Sessions`, `Last Match`, `Obs`, and `Query Hits`, rendering each telemetry entry on its own row.

#### Scenario: Empty telemetry renders a fixed message

- **WHEN** `telemetry.entries` is empty
- **THEN** the function returns `"No telemetry data."`

#### Scenario: Non-empty telemetry renders the report table

- **WHEN** one or more telemetry entries exist
- **THEN** the returned markdown begins with the expected header row and includes each entry's match count, session count, last match timestamp, observation count, and formatted query-hit summary

### Requirement: getEntryTelemetry returns entry data by location

`getEntryTelemetry(telemetry, location)` SHALL return the telemetry entry stored at that location, or `undefined` when no entry exists.

#### Scenario: Entry lookup misses

- **WHEN** the requested location is not present in `telemetry.entries`
- **THEN** `getEntryTelemetry` returns `undefined`
