# Users and Admin API Documentation

This document outlines the available REST API endpoints for standard users and administrators in the `core-auth-service`. 

All endpoints below require a valid `Bearer JWT Token` in the `Authorization` header.

---

## 1. User APIs (Prefix: `/api/v1`)

These endpoints are for authenticated users to manage their own profiles.

### 1.1 Get Current User Profile
Retrieves the profile of the currently authenticated user.

- **Method**: `GET`
- **Path**: `/users/me`
- **Response** (`200 OK`):
  ```json
  {
    "id": "uuid",
    "email": "user@example.com",
    "roles": ["CANDIDATE"],
    "connectedProviders": [
      {
        "provider": "GITHUB",
        "providerUserId": "12345",
        "scopes": ["read:user"],
        "connectedAt": "2026-06-12T10:00:00Z"
      }
    ],
    "createdAt": "2026-06-12T10:00:00Z"
  }
  ```

### 1.2 Update Current User
Updates the non-privileged fields of the currently authenticated user.

- **Method**: `PUT`
- **Path**: `/users/me`
- **Body**:
  ```json
  {
    // Any updatable profile fields
  }
  ```
- **Response** (`200 OK`):
  ```json
  {
    "id": "uuid",
    "email": "user@example.com",
    "roles": ["CANDIDATE"],
    "createdAt": "2026-06-12T10:00:00Z",
    "updatedAt": "2026-06-12T11:00:00Z"
  }
  ```

### 1.3 Delete Current User
Permanently deletes the currently authenticated user and all associated data.

- **Method**: `DELETE`
- **Path**: `/users/me`
- **Response**: `204 No Content`

---

## 2. Admin APIs (Prefix: `/api/v1/admin`)

These endpoints are strictly for users who possess the `ADMIN` role. 

### 2.1 List All Users
Retrieves a paginated list of users in the system, with optional filtering.

- **Method**: `GET`
- **Path**: `/users`
- **Query Parameters**:
  - `page` (integer) - Page number (default: 1)
  - `limit` (integer) - Items per page (default: 10)
  - `search` (string) - Search by email address
  - `role` (string) - Filter by role (`CANDIDATE`, `RECRUITER`, `ADMIN`)
  - `status` (string) - Filter by status (`PENDING_VERIFICATION`, `ACTIVE`, `SUSPENDED`)
- **Response** (`200 OK`):
  ```json
  {
    "data": [
      {
        "id": "uuid",
        "email": "user@example.com",
        "roles": "CANDIDATE",
        "status": "ACTIVE",
        "createdAt": "2026-06-12T10:00:00Z",
        "updatedAt": "2026-06-12T11:00:00Z"
      }
    ],
    "meta": {
      "total": 1,
      "page": 1,
      "limit": 10,
      "totalPages": 1
    }
  }
  ```

### 2.2 Get User Details
Retrieves the comprehensive profile of a specific user by their ID.

- **Method**: `GET`
- **Path**: `/users/:id`
- **Response** (`200 OK`): Returns the same object structure as `GET /users/me`.

### 2.3 Update User Role or Status
Updates privileged fields for a user. Ideal for banning/suspending users or promoting users to an admin role.

- **Method**: `PATCH`
- **Path**: `/users/:id`
- **Body**:
  ```json
  {
    "roles": "ADMIN", // Optional
    "status": "SUSPENDED" // Optional
  }
  ```
- **Response** (`200 OK`):
  ```json
  {
    "id": "uuid",
    "email": "user@example.com",
    "roles": ["ADMIN"],
    "status": "SUSPENDED",
    "updatedAt": "2026-06-12T11:05:00Z"
  }
  ```

### 2.4 Delete a User
Permanently deletes a specific user and their related records.

- **Method**: `DELETE`
- **Path**: `/users/:id`
- **Response**: `204 No Content`

### 2.5 Get System Statistics
Retrieves aggregated statistics regarding users in the platform.

- **Method**: `GET`
- **Path**: `/stats`
- **Response** (`200 OK`):
  ```json
  {
    "totalUsers": 150,
    "statusCounts": {
      "ACTIVE": 120,
      "PENDING_VERIFICATION": 25,
      "SUSPENDED": 5
    },
    "roleCounts": {
      "CANDIDATE": 130,
      "RECRUITER": 15,
      "ADMIN": 5
    }
  }
  ```
