# CableOps SaaS

Multi-tenant Cable TV and Internet Management SaaS for small and mid-sized operators.

## Recommended stack

- Backend: Node.js, Express, PostgreSQL, Prisma, Redis, BullMQ
- Frontend: React, Vite, TypeScript, Tailwind CSS
- Auth: JWT access/refresh tokens with role-based permissions
- Realtime: Socket.IO
- Storage: S3-compatible object storage
- Notifications: MSG91 / Fast2SMS / WhatsApp Business API
- Payments: Razorpay first, extensible for other gateways

## Monorepo structure

- `docs/`
  - `saas-blueprint.md`: A-to-Z feature brief, page map, and workflows
- `apps/api/`
  - Express API scaffold with tenant-aware modules
- `apps/web/`
  - React operator/admin web app scaffold

## User roles

- `platform_owner`: SaaS super admin
- `operator_admin`: operator owner/admin
- `operator_manager`
- `collector`
- `technician`
- `accountant`
- `customer_portal_user`

## Core product pillars

1. Multi-tenant operator management
2. Customer lifecycle and package billing
3. Payment, recharge, receipt, and due tracking
4. Staff, complaints, and area operations
5. Subscription billing for operators using your SaaS
6. Messaging, reports, and reconciliation

## Starting build phases

1. Foundation
   - Auth
   - Tenant model
   - Roles and permissions
   - Operator onboarding
2. Revenue core
   - Customer management
   - Packages
   - Billing cycles
   - Payments and receipts
3. Operations
   - Staff
   - Areas
   - Complaints
   - Notifications
4. SaaS monetization
   - Plans
   - Subscriptions
   - Usage limits
   - Trials
5. Advanced
   - Reconciliation
   - API integrations
   - Customer portal
   - Mobile collector app

## Notes on recharge for multi-operator SaaS

Because most operators already use different billing systems, recharge should support three modes:

- Manual ledger mode
- Bulk import/sync mode
- API/webhook integration mode

The platform should treat recharge as an internal bill-extension event and maintain an external reconciliation status for operators that still update their legacy software separately.

## Render production rule

- Render free web services use an ephemeral filesystem.
- Never use SQLite `file:./dev.db` on Render for live operator data.
- Always use Render Postgres and set `DATABASE_URL` to the Postgres internal connection string.
- The API now blocks startup on Render if `DATABASE_URL` still points to a local SQLite file, so silent data loss does not happen again.
