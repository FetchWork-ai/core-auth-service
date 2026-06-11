# Knowledge Base Module

The Knowledge Base (KB) module is responsible for storing, retrieving, and updating a user's enriched profile data. This data is represented as a "profile graph"—a structured JSON document containing the user's skills, experience, education, and other parsed attributes.

## Core Features

1. **Deep Merging**: Instead of replacing the entire profile graph on every update, the module intelligently merges incoming data with the existing data.
2. **Optimistic Concurrency Control (OCC)**: Prevents data loss when multiple clients (or background jobs) attempt to update the profile graph simultaneously.
3. **Secure Access**: All endpoints are protected and only allow users to access their own knowledge base.

---

## How It Works

### 1. Deep Merging (`deepMergeProfileGraph`)

When an update (`PUT`) is received, the `KnowledgeBaseService` merges the incoming JSON object with the existing JSON object stored in the database according to these rules:

*   **Arrays**: Concatenated and deduplicated.
    *   *Primitives* (e.g., strings, numbers) are deduplicated by their exact value.
    *   *Objects* within arrays are deduplicated based on their JSON string representation.
*   **Objects**: Recursively merged. If both the existing and incoming structures have an object at the same key, the properties of those objects are merged together.
*   **Scalars**: Incoming values overwrite existing values. If the existing data has `{"yearsOfExperience": 3}` and the incoming data has `{"yearsOfExperience": 4}`, the result will be `4`.

### 2. Optimistic Concurrency Control (OCC)

To prevent the "lost update" problem, the module uses versioning:

1.  **Read**: When a client fetches the knowledge base (via `GET /`), the response includes a `version` number (e.g., `version: 1`).
2.  **Modify**: The client modifies the profile graph locally.
3.  **Update**: The client sends the updated graph via `PUT /` and includes the version they started with as `expectedVersion: 1`.
4.  **Verification**: The service checks if the current version in the database is still `1`.
    *   **Match**: The merge proceeds, and the database version is incremented to `2`.
    *   **Mismatch**: If another process already updated the graph (so the DB version is now `2`), the service returns a `409 Conflict` (`ConcurrencyConflictError`). The client must then re-fetch the latest data, re-apply their changes, and try again.

*(Note: For the very first upsert when no KB exists, the client should pass `expectedVersion: 0` or any number, as the initial creation bypasses the version check and initializes the version to `1`.)*

---

## API Endpoints

All endpoints are registered under the `/api/v1/users/me/kb` prefix and require a valid Bearer token (`Authorization: Bearer <token>`).

### `GET /`
**Get Knowledge Base**
Retrieves the authenticated user's current knowledge base.
*   **Success (200)**: Returns the KB object including `profileGraph` and `version`.
*   **Not Found (404)**: Returns an error if the user hasn't created a knowledge base yet.

### `PUT /`
**Upsert Profile Graph**
Creates or updates the profile graph using deep merge.
*   **Body**: 
    ```json
    {
      "profileGraph": { ... },
      "expectedVersion": 1
    }
    ```
*   **Success (200)**: Returns the updated KB object with an incremented `version`.
*   **Conflict (409)**: `expectedVersion` does not match the database version.
*   **Not Found (404)**: The associated user record does not exist.

### `DELETE /`
**Delete Knowledge Base**
Completely removes the user's knowledge base.
*   **Success (204)**: Empty response.
*   **Not Found (404)**: No knowledge base existed to delete.

---

## Architecture Flow

1.  **Request**: Client calls an endpoint (e.g., `PUT /api/v1/users/me/kb`).
2.  **Controller (`kb.controller.ts`)**: Extracts the `userId` from the JWT token (`request.currentUser.id`) and the payload from the request body. Passes them to the service.
3.  **Service (`kb.service.ts`)**: Applies business logic (version checking, deep merging).
4.  **Repository (`kb.repository.ts`)**: Executes Prisma queries (`findUnique`, `upsert`, `delete`) against the PostgreSQL database.
5.  **Database**: The `KnowledgeBase` table stores the `userId`, `profileGraph` (JSONB), and `version` (Int).
