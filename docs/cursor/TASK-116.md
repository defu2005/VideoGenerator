# TASK-116 — Team UI: members, invites, roles, channel grants, 2FA, sessions, API keys, audit view 👥

**Who:** Cursor `grok-4.7-medium`, or a new Sonnet 5.5 session (`context: fresh`) while Cursor has no usage. This is mostly UI on top of endpoints that already exist, plus one guarded signup path. **Size:** M. **Order:** after TASK-115. **DB change:** none expected. If you find you need one, stop and explain it in the report instead.

Read first:
- `docs/cursor/README.md`
- `docs/architecture/multi-user-multi-node.md`: "Roles" and "Request flow".
- `docs/cursor/TASK-114.md`, `docs/cursor/TASK-115.md` and both reports in `docs/tasks/`.
- Server:
  - `apps/server/src/auth/`: `instance.ts` (the plugins `organization`, `twoFactor`, `apiKey`), `policy.ts` (actions, `can`), `routePermissions.ts`, `workspaces.ts`, `setup.ts`.
  - The audit API: `GET /api/audit`.
  - `GET /api/me`.
- Web:
  - `apps/web/src/features/auth/` (login and setup pages)
  - `apps/web/src/features/settings/`, especially how a settings page is laid out
  - `apps/web/src/components/ui/`: `Table`, `Modal`, `Tabs`, `Field`, `Select`, `Toggle`, `Badge`, `Toast`, `LoadMore`
  - `apps/web/src/components/layout/AppLayout.tsx` (sidebar groups and the user menu)
- Better Auth client docs for `organization`, `twoFactor` and `apiKey` in `apps/server/node_modules/better-auth` (offline).

## Why

TASK-114 and TASK-115 built logins, workspaces, roles, grants and the audit log, but the only way to add a person today is through the API. The owner needs a page to:
- invite people;
- set their role and their channels;
- see and revoke sessions and keys;
- turn on 2FA;
- read who did what.

## Mã nguồn mở có sẵn

- **Better Auth client** (MIT, `better-auth/react` and `better-auth/client/plugins`, already installed with `better-auth@1.7.21`): `organizationClient`, `twoFactorClient` and `apiKeyClient` give typed calls for:
  - invite, accept, cancel, list members, update a member's role, remove;
  - 2FA enable and verify, backup codes, disable;
  - create, list and revoke API keys;
  - list and revoke sessions.

  Use these instead of writing new server endpoints, wherever the plugin's own check matches `policy.ts`. Check in `apps/web/package.json` whether `better-auth` is reachable from `apps/web`. If it is not, call the plugin's HTTP endpoints under `/api/auth/*` with the existing API client instead. **Do not run `npm install`.**
- **QR code for 2FA:** no QR library is installed, and this task adds no dependency. Show the TOTP setup key as text with a copy button, plus the `otpauth://` link. Authenticator apps (Google Authenticator, Microsoft Authenticator, Authy, 1Password, Bitwarden) all accept a key typed in by hand. Say in the report if you think a QR library is worth adding later, and which one (MIT, no dependencies).

## What to do

### 1. Settings › Nhóm (members)

The page is visible with `members.manage` (owner and admin). Get the permission from `GET /api/me`; never hard-code a role check.

**Members table:**
- name, email, role, channels (all, or a list), 2FA on/off, last active, joined;
- a row menu: change role, edit channels, remove;
- an admin cannot change or remove an owner, and cannot make anyone owner. The server already enforces this; the UI hides those options.
- there must always be at least one owner: the last owner cannot be demoted or removed. Check that the server refuses it. If it does not, add the check in the TASK-115 policy or bootstrap code and test it.

**Invite:**
- a modal with email, role (default `viewer`) and channels (optional multi-select of the workspace's channels);
- it creates the invitation through the plugin and stores the channel list to apply on accept. Use the invitation's metadata if the plugin supports it; otherwise use a small key/value entry that `workspaces.ts` reads. Say which in the report;
- there is no email sending in the app. The modal shows the invite link `https://<origin>/invite/<id>` with a copy button, and says the link expires (the plugin's default, which you name in the report);
- a pending invitations list with copy link, cancel and the expiry date.

**Change role:** a select with the six roles, each with its one-line Vietnamese description from the design doc's Roles table.

**Channels (grants):**
- choose "Tất cả kênh" or pick channels;
- for each picked channel, an optional lower role;
- show the effective role next to each channel, using the same rule as `policy.ts`: the lower of the two.

### 2. Accepting an invite (the one new server path)

- Web route `/invite/:id` sits outside the protected layout.
- **Not logged in, and no account exists for the invited email:** show name and password fields. Submit to a new server route `POST /api/setup/accept-invite` (under the existing `/api/setup/*` allowlist). It must:
  - find the invitation by id; it must be pending, unexpired, and not cancelled;
  - create the user **only** for the invited email (signup stays disabled everywhere else);
  - accept the invitation, apply the stored channel grants, and set the workspace active;
  - sign the user in (session cookie);
  - all in one transaction, so a crash leaves no user without a membership;
  - be safe against two submits at once (a second one gets 409);
  - use the same rate limit as login;
  - reveal nothing about other emails, or about whether the id exists: the error text is the same for an unknown, used and expired invite.
- **Logged in as the invited email:** show one "Tham gia" button that accepts it through the plugin.
- **Logged in as a different email:** say the invite is for another account, and offer to log out.
- Audit: write `member.invited`, `member.joined`, `member.role_changed`, `member.grants_changed` and `member.removed` rows to `audit_log` with the TASK-115 helper.

### 3. Tài khoản của tôi (account)

This page is open to every logged-in user.

**Profile:** change name; change password (current plus new, at least 8 characters, revoke other sessions as an option, on by default).

**2FA:**
- enable: password, then the setup key and link, then enter a 6-digit code to verify, then show backup codes once with copy and download as `.txt`;
- disable: password plus a code;
- regenerate backup codes;
- the login page from TASK-114 must ask for the TOTP code, or a backup code, when 2FA is on. Check this and add it if it is missing.
- workspace switch "Bắt buộc 2FA cho owner và admin", default off, stored in the organization's metadata. When it is on, an owner or admin without 2FA is sent to this page after login and can do nothing else until 2FA is set up. Enforce it on the server in the TASK-115 guard, with an allowlist of the 2FA and logout routes. The UI alone is not enough.

**Sessions:** list device or user agent, IP, created and last active, with "phiên này" on the current one. Revoke one, or revoke all others.

**API keys:**
- the user's own keys: name, prefix, created, last used, expiry;
- create: name and optional expiry (30 / 90 / 365 days / never). The full key is shown **once**, with copy and a warning;
- revoke;
- an owner or admin also sees a "Khóa của dịch vụ" section that lists the `local-services` key from TASK-114 (prefix only, never the value) and any MCP or Hermes keys, with revoke and a confirm. Revoking `local-services` warns that MCP and Telegram on this machine will stop until the server restarts and creates a new one. Check that the server really recreates it at restart. If it does not, say so in the report and do not change TASK-114 code beyond what that needs.

### 4. Settings › Nhật ký (audit view)

Visible with `audit.read`.
- A table with time, who (name or key name, or "hệ thống"), source, action, target (with a link when it is a project or channel), outcome badge, and summary.
- Filters: person, action, source, outcome, date range. Paging uses "Tải thêm" (`LoadMore`) with the API cursor.
- Clicking a row opens a side panel with the redacted payload as formatted JSON, read only.
- No export in this task.

### 5. Navigation and polish

- In the sidebar's settings group, add "Nhóm" and "Nhật ký", each shown only when allowed. Add "Tài khoản của tôi" to the user menu.
- Add the new pages to the Ctrl+K command palette and to the TASK-048 `featureMap`, with help links.
- The workspace settings switches (`hideFinanceFromViewers`, `adminsCanUseOperator`, the 2FA requirement) go on the Nhóm page in a small "Cài đặt không gian" card, and only the owner can change them. The server checks this as well.
- Every text is Vietnamese. Every action that changes something shows a toast. Every destructive action (remove a member, revoke a key or session, cancel an invite) uses a confirm modal.

## Rules

- No commit or push. No new npm dependency. No migration; stop and report if you need one. Do not run `npm install` and do not touch `node_modules` or `package-lock.json`.
- Do not touch:
  - `.env`, `.claude/`, `data/`, `scripts/`
  - `deploy/`
  - `apps/server/src/pipeline/**`, `apps/server/src/compose/**`, `apps/server/assets/**`, `packages/shared/src/style/**`
- Do not weaken anything in `policy.ts`, the guard, the hard blocks or the TASK-059 limits. Server checks decide; the web only hides.
- No agent tool may invite, change roles or grants, remove members, create or revoke keys, or change 2FA. Check that the TASK-115 forbidden list covers the new plugin calls when they are reached through tools. They should not be tools at all.
- Never show or log a full API key after creation, a password, a TOTP secret after setup, or backup codes after the first display.
- Tests: no network and no real LLM. Never render or approve gates on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Done

- **Server tests:**
  - accept-invite creates exactly one user and one membership with the stored grants, and signs in;
  - accept-invite refuses an expired, cancelled, used or unknown id with the same message;
  - a parallel double submit gets one 201 and one 409;
  - signup is still disabled outside invites;
  - the last owner cannot be demoted or removed;
  - an admin cannot make an owner;
  - required 2FA blocks an owner without 2FA everywhere except the 2FA and logout routes;
  - every member change writes the right audit row;
  - none of these plugin actions is reachable as a registry tool.
- **Web tests:** members table rendering and permission hiding; the invite modal shows the link; the grant editor shows the effective role; API key create shows the key once; the 2FA enable flow; audit filters and paging (with a mocked API).
- **Checks:** `npm run typecheck` at the root; `npm test` in `packages/shared`, `apps/server`, `apps/mcp` and `apps/web`. List any failure outside your area, with its file.
- **Manual check:** on a temporary `DATA_DIR` (never the real `data/`):
  - as owner, invite an editor limited to one channel, copy the link, and open it in a private window;
  - accept with a new password and check that only that channel shows;
  - turn on 2FA for the owner, log out, and log in with a code;
  - create and revoke an API key;
  - read the audit view and find each of those actions.
- **User guide:** extend the TASK-115 page "Không gian làm việc và quyền" with how to invite, set channels, use 2FA and API keys, and read the audit log. Add one line to `nhat-ky-thay-doi.md`.
- **Report:** write `docs/tasks/TASK-116.report.md` in Vietnamese, at most 50 lines:
  - pages added
  - where the invite's channel list is stored
  - the invite expiry
  - whether `local-services` is recreated at restart
  - the QR library suggestion, if any
  - test results
  - anything you decided differently from this guide, and why
- Then create the empty `docs/tasks/TASK-116.done`.
