# Security Specification & Payload-First TDD

## 1. Data Invariants
1. **Verified Authentication**: Every read and write requires `request.auth != null && request.auth.token.email_verified == true`.
2. **Workspace Gate**: Every `/teamMembers/{userId}` creation must provide the exact workspace access code `m1256` and set `role == 'member'` (no self-assigned admin escalation).
3. **Admin-Only Deletion**: Only bootstrapped admin (`mitabdou09@gmail.com`) or users present in `/admins/{uid}` can delete `/equipment/{equipmentId}`, `/equipment/{equipmentId}/notes/{noteId}`, or `/backups/{backupId}`.
4. **Master Gate on Subcollections**: Creating a note in `/equipment/{equipmentId}/notes/{noteId}` verifies that the parent `/equipment/{equipmentId}` document exists and matches `workspaceKey == 'm1256'`.
5. **Temporal Integrity**: `createdAt`, `updatedAt`, and `joinedAt` must equal `request.time`. `createdAt` and `createdByUid` are immutable after creation.
6. **Strict Schema & Size Bounds**: Every write validates exact allowed keys (`hasAll` + `hasOnly`), string `.size()` bounds, regex IDs (`^[a-zA-Z0-9_\-]+$`), and date format (`^[0-9]{4}-[0-9]{2}-[0-9]{2}$`).
7. **Colleague Local Desktop Sync Gate (`/localSyncEquipment`, `/localSyncOrgAssets`)**: Allows Local Desktop Edition clients (without Google Auth) to two-way sync equipment/notes and org assets strictly within `workspaceKey == 'm1256'`, enforcing full schema/type/enum/size validation, server timestamp (`syncedAt == request.time`), immutable `createdAtIso`/`workspaceKey`, soft-deletes (`allow delete: if false`), and query-enforced `list` (`resource.data.workspaceKey == 'm1256'`).
8. **Primary Admin Governance & Sync Lock (`/workspaceSettings/m1256`, `/teamMembers`, `/admins`, `/adminEmails`)**: Only the Primary Admin (`mitabdou09@gmail.com`) can toggle the Sync & Refresh Lock (`syncRefreshLocked`), manage team membership, and list full audit history across both systems.
9. **Immutable Modification Audit Trail (`/auditLogs/{logId}`)**: Verified team members may append audit entries stamped with their `actorUid == request.auth.uid` and `createdAt == request.time`; updates/deletes are forbidden and reads are restricted to the Primary Admin.

## 2. The "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated Equipment Read/Write**: `auth = null` attempting `get/create` on `/equipment/eq1`.
2. **Unverified Email Write**: `auth.token.email_verified = false` attempting `create` on `/equipment/eq1`.
3. **Wrong Workspace Access Code**: Creating `/teamMembers/uid1` with `accessCode: "wrong"`.
4. **Self-Assigned Admin Escalation**: Creating `/teamMembers/uid1` with `role: "admin"` or writing directly to `/admins/uid1` as non-admin.
5. **Shadow / Ghost Field Injection**: Creating `/equipment/eq1` with extra field `isAdminApproved: true`.
6. **Non-Admin Equipment Deletion**: Standard team member attempting `delete` on `/equipment/eq1`.
7. **Identity Spoofing on Create**: Creating `/equipment/eq1` with `createdByUid: "otherUserUid"`.
8. **Immutable Field Tampering**: Updating `/equipment/eq1` and altering `createdByUid` or `createdAt`.
9. **Client Timestamp Forgery**: Creating `/equipment/eq1` with client-supplied `createdAt` instead of `request.time`.
10. **Path ID Poisoning**: Creating `/equipment/invalid$id!with*bad#chars` or 500-char document ID.
11. **Oversized String Payload (Denial of Wallet)**: Updating `delayServicesNote` with a 5000-character string (`> 1500` limit).
12. **Orphaned Note Creation**: Creating `/equipment/nonExistentEq/notes/n1` without an existing parent equipment document.
13. **Wrong Workspace Key on Local Sync**: Creating `/localSyncEquipment/eq1` with `workspaceKey: "wrong"`.
14. **Hard Delete Attempt on Local Sync**: Calling `delete` on `/localSyncEquipment/eq1` or `/localSyncOrgAssets/a1`.
15. **Non-Primary-Admin Sync Lock Tampering**: Standard user or delegated admin attempting to update `/workspaceSettings/m1256`.
16. **Non-Primary-Admin Audit Log Read/Delete**: Standard user attempting to list or delete `/auditLogs/log1`.
