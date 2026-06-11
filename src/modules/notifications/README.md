# Notifications Module

The Notifications module is responsible for managing user preferences related to how and when they receive alerts (e.g., job matches, application status changes). It provides a flexible, partial-update system to allow users to customize their notification experience.

## Core Features

1. **Configurable Preferences**: Granular control over digest frequency, minimum match score thresholds, event triggers, quiet hours, and delivery channels.
2. **Partial Updates**: The update API (`PUT`) accepts partial payloads. Omitted fields are ignored, leaving the existing settings intact.
3. **Sensible Defaults**: If a user has never configured their preferences, creating them will automatically apply system-wide sensible defaults for any omitted fields.
4. **Reset Capability**: Users can completely reset their preferences back to the system defaults.

---

## Configurable Preferences

The `NotificationPreference` model supports the following settings:

*   **`digestFrequency`**: How often to receive grouped updates. Options: `INSTANT`, `DAILY`, `WEEKLY`, `NEVER`. (Default: `DAILY`)
*   **`minMatchScore`**: A decimal between `0.00` and `1.00`. Only events (e.g., job matches) scoring above this threshold will trigger a notification. (Default: `0.70`)
*   **`notifyOnNewJobs`**: Boolean flag. (Default: `true`)
*   **`notifyOnStatusChange`**: Boolean flag for application updates. (Default: `false`)
*   **`quietHoursStart` / `quietHoursEnd`**: Strings in `HH:MM` format (24-hour clock, e.g., `"22:00"` to `"07:00"`). Notifications generated during this window are queued or suppressed. (Default: `null`)
*   **`channels`**: Array of strings determining delivery methods. Options might include `"email"`, `"push"`, `"sms"`. (Default: `[]`)

---

## API Endpoints

All endpoints are registered under the `/api/v1/users/me/notifications` prefix and require a valid Bearer token (`Authorization: Bearer <token>`).

### `GET /`
**Get Notification Preferences**
Retrieves the authenticated user's current preferences.
*   **Success (200)**: Returns the preferences object.
*   **Not Found (404)**: Returns an error if the user hasn't created custom preferences yet.

### `PUT /`
**Update (Upsert) Preferences**
Creates or updates the notification preferences. Because this behaves like a `PATCH`, you only need to send the fields you want to change.
*   **Body Example**: 
    ```json
    {
      "digestFrequency": "WEEKLY",
      "quietHoursStart": "23:00",
      "quietHoursEnd": "08:00"
    }
    ```
*   **Success (200)**: Returns the updated preferences object. If this was the first time preferences were set, omitted fields like `minMatchScore` will automatically be set to their default values (e.g., `0.70`).

### `DELETE /`
**Reset Preferences**
Deletes the user's custom preferences, effectively resetting them to the system defaults.
*   **Success (204)**: Empty response.
*   **Not Found (404)**: No custom preferences existed to reset.

---

## Architecture Flow

1.  **Request**: Client calls an endpoint (e.g., `PUT /api/v1/users/me/notifications`).
2.  **Controller (`notification.controller.ts`)**: Extracts the `userId` from the JWT token (`request.currentUser.id`) and the partial payload from the request body.
3.  **Service (`notification.service.ts`)**: Handles the business logic and calls the repository. It handles serialization, like converting Prisma's `Decimal` types to standard numbers for JSON.
4.  **Repository (`notification.repository.ts`)**: Executes Prisma queries (`findUnique`, `upsert`, `delete`). The `upsert` method is specially designed to spread only the provided fields during an `update`, while applying defaults during a `create`.
5.  **Database**: The `NotificationPreference` table stores the user's settings.
