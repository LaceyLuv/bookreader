# Upload Dedup And TXT Entry Design

## Context

The current upload flow can surface two user-facing problems:

1. Adding a file can create a second library entry whose visible name looks like an internal storage filename made of English letters and numbers.
2. Opening a TXT file can fail with a generic "failed to load file content" message.

For this design, the confirmed product requirement is narrow on purpose:

- New uploads must appear in the library exactly once.
- The library must show the original filename, not the internal storage filename.
- Internal storage filenames must not be shown anywhere in the UI.
- Existing bad duplicate records already stored in data are out of scope for automatic cleanup in this change.

This design focuses on preventing new bad records and removing internal storage-name leakage from the UI. TXT loading failures are treated as a related symptom that may need follow-up debugging if they remain after upload dedup is fixed.

## Goals

- Guarantee one library record per newly uploaded file.
- Keep internal storage naming as a backend implementation detail.
- Ensure upload responses and first-render UI state already contain the user-facing filename.
- Avoid automatic migration or cleanup of historical duplicate data.
- Minimize blast radius by changing upload and presentation behavior without broad storage refactors.

## Non-Goals

- Cleaning or rewriting existing duplicate records in `backend/library.json`.
- Changing the internal storage naming scheme for files on disk.
- Refactoring unrelated library metadata behavior.
- Claiming TXT open failures are fully solved by this work alone.

## User-Facing Behavior

### Upload

- When the user uploads a supported file, the library gains exactly one new visible entry.
- That new entry is labeled with the original filename or the user-facing title derived from it.
- No English-and-number internal storage filename is shown during upload, after upload, or after refresh.

### Library And Details

- Library cards and list rows use `title` or `filename`, never `stored_filename`.
- File detail views expose only the original filename as a file identity field.
- Internal storage names remain available to backend code only.

### TXT Opening

- TXT open behavior continues to use the same book `id`.
- If TXT loading still fails after dedup is fixed, that failure is treated as a separate defect and debugged independently.

## Current Failure Model

The observed failure pattern suggests the upload pipeline currently allows these concerns to overlap:

- A physical file is written using an internal storage name.
- Storage synchronization can discover that file as an orphan before or during record registration.
- The upload path can then add a second record for the same physical file.
- The library may display whichever record it receives, including the one whose `filename` is the internal storage name.

This creates a data integrity problem first and a UI leakage problem second. The design therefore fixes them in that order.

## Proposed Architecture

### 1. Separate File Identity Roles Clearly

The backend keeps two distinct names:

- `filename`: user-facing original filename
- `stored_filename`: backend-only physical storage filename

The design rule is strict:

- `filename` is the only name that may flow into UI view models.
- `stored_filename` may be used only for file resolution on disk and backend storage bookkeeping.

### 2. Treat Upload Registration As An Idempotent Operation

The upload pipeline must behave as "write file once, register record once" for each newly uploaded file.

Implementation-level expectation:

- If a record already exists for the just-written `stored_filename`, the upload registration step must not append a second logical book entry.
- The upload path should either replace the provisional/orphan-style record with the proper uploaded record or avoid creating the provisional record in the first place.

The important contract is not the exact mechanism but the outcome:

- one `stored_filename`
- one logical record
- one visible library entry

### 3. Keep Historical Data Out Of Scope

Because the chosen requirement is "new uploads only," synchronization logic must not include broad retroactive cleanup rules that merge or delete old duplicates from persistent storage as part of this task.

That means:

- old duplicate records may continue to exist until a separate cleanup task is approved
- this feature only guarantees that newly uploaded files do not create fresh duplicates

### 4. Make UI Rendering Blind To Internal Names

Frontend view logic must not fall back to `stored_filename` anywhere the user can see.

Allowed sources for display:

- explicit editable title
- original `filename`

Disallowed sources for display:

- `stored_filename`
- derived storage stem
- placeholder values copied from internal upload results

This rule also applies to temporary or optimistic UI state immediately after upload and before a refetch settles.

## Data Flow

### Upload Request

1. The frontend sends the selected file.
2. The backend normalizes the original filename and computes a unique internal storage filename.
3. The backend writes the file to disk under `stored_filename`.
4. The backend registers exactly one logical record associated with that file.
5. The backend returns a book payload whose user-visible naming fields already reflect the original filename.
6. The frontend refreshes or merges the returned record without ever displaying `stored_filename`.

### Library Rendering

1. The frontend receives book metadata.
2. It renders using `title`, then `filename` if no edited title exists.
3. It routes open/read actions by `id`, not by filename.
4. It never exposes `stored_filename` in list or detail UI.

## Error Handling

### Upload Errors

- If file saving fails, no partial logical book entry should remain.
- If record registration fails after file write, the backend should preserve atomic behavior as much as practical and avoid returning a duplicate visible entry.

### TXT Open Errors

- This design does not redefine TXT reader internals.
- If a TXT file still fails to open after dedup is fixed, the user should continue to get the existing failure message, and a follow-up bugfix should inspect reader fetch, transform, and render paths separately.

## Testing Strategy

### Backend Tests

- Uploading a new file creates exactly one book record.
- Registering an uploaded file does not append a second record for the same `stored_filename`.
- Returned metadata keeps the original filename in `filename`.
- New upload behavior does not require cleanup of old duplicate records to pass.

### Frontend Tests

- After upload, the library shows only the original filename.
- No UI component renders `stored_filename`.
- Detail panels and first-render fallback state use `filename` or title only.
- Opening a TXT entry still routes by book `id`.

### Manual Validation

1. Upload a Korean-named `.txt` file.
2. Confirm exactly one new library item appears.
3. Confirm the visible name matches the original filename.
4. Confirm no internal storage-looking filename appears in the library or details UI.
5. Open the uploaded TXT file immediately after upload.
6. Refresh the app and confirm the same single entry remains visible.

## Risks And Follow-Up

### Known Risk

If TXT open failures are caused by reader rendering, manifest loading, or encoding-specific frontend assumptions rather than duplicate records, this feature will not fully resolve that symptom.

### Follow-Up Trigger

If users still hit TXT open failures after the dedup fix, the next task should isolate:

- TXT manifest fetch behavior
- first window fetch behavior
- reader page composition behavior
- fallback rendering when no visible render pages are produced

## Recommended Implementation Scope

Keep the implementation tightly scoped to:

- upload record registration rules
- storage-layer dedup guard for new uploads
- frontend display-field hygiene

Do not include:

- historical data migration
- bulk record reconciliation
- unrelated metadata cleanup
- speculative TXT reader refactors

## Acceptance Criteria

- A newly uploaded file produces exactly one visible library entry.
- That entry shows the original filename, not the internal storage filename.
- Internal storage filenames are not visible anywhere in the UI.
- Existing historical duplicate records are not automatically modified by this feature.
- If TXT open still fails, it is treated as a separate issue rather than hidden by this change.
