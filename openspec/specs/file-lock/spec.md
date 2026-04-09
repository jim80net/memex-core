## Requirements

### Requirement: Advisory file locking via mkdir

`acquireLock(filePath)` SHALL create an advisory lock directory at `${filePath}.lock` using `mkdir`, which is atomic on all platforms. It returns an unlock function that removes the lock directory. If the lock already exists, it retries with exponential backoff until a timeout is reached.

#### Scenario: Lock acquired on first attempt

- **WHEN** no lock directory exists for a given file path
- **THEN** `mkdir` succeeds, the lock directory is created, and the returned unlock function removes it

#### Scenario: Lock contention with retry

- **WHEN** another process holds the lock directory
- **THEN** the acquiring process retries every 50ms until the 5-second timeout

#### Scenario: Stale lock detection and recovery

- **WHEN** a lock directory exists whose `mtimeMs` is more than 30 seconds old
- **THEN** the lock is considered stale, force-removed, and acquisition retries immediately

#### Scenario: Lock between mkdir and stat

- **WHEN** the lock directory is released by another process between the failing `mkdir` and the `stat` check
- **THEN** `stat` throws, the catch block detects the lock was released, and acquisition retries immediately

#### Scenario: Timeout with best-effort fallback

- **WHEN** the 5-second deadline is reached without acquiring the lock
- **THEN** a no-op unlock function is returned and execution proceeds without the lock (best-effort)

### Requirement: withFileLock executes callback under lock

`withFileLock(filePath, fn)` SHALL acquire the lock, execute the callback `fn`, and release the lock in a `finally` block — even if the callback throws.

#### Scenario: Successful locked operation

- **WHEN** `withFileLock("/data/cache.json", async () => { ... })` is called
- **THEN** the lock directory `/data/cache.json.lock` exists during callback execution and is removed afterward

#### Scenario: Callback error releases lock

- **WHEN** the callback throws an error
- **THEN** the lock is released (unlock function called in `finally`) and the error propagates to the caller