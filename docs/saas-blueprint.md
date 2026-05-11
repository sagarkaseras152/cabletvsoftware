# CableOps SaaS Blueprint

## 1. Product goal

Build a real multi-tenant SaaS where you charge multiple cable and internet operators to use your software. Each operator gets a separate workspace, staff accounts, customers, billing, collections, reporting, and optional customer self-service.

## 2. Recommended backend for a free start

### Best starting backend

- `Node.js + Express + PostgreSQL`

### Why this is the best fit

- Free and open-source
- Easy hosting on Render/Railway/Fly self-hosted/PostgreSQL free tiers
- Good realtime support with Socket.IO
- Strong ecosystem for payments, SMS, WhatsApp, PDFs, Excel exports
- Easy to hire developers for later

### Supporting services

- `PostgreSQL`: main relational database
- `Redis`: caching, sessions, queues, rate limiting
- `BullMQ`: background jobs for reminders, reports, webhooks
- `S3-compatible storage`: documents, receipts, exports

## 3. Recommended frontend

- `React + Vite + TypeScript + Tailwind`

### Why

- Fast dashboard UI
- Reusable layouts for super admin and operator panels
- Easy forms/tables/charts
- Good for later mobile-web/PWA support

## 4. Multi-tenant architecture

### Tenant model

- Your platform has one global owner space
- Every operator is a tenant
- Each tenant has isolated data by `tenantId`
- Users only see data belonging to their tenant

### Isolation rules

- Every business table must carry `tenantId`
- Middleware must inject `tenantId` from logged-in user
- All queries must scope by `tenantId`
- Super admin can cross-view tenants; operators cannot

## 5. Real recharge strategy for your SaaS

### Problem

Operators already use different billing systems. So your system cannot assume direct package activation inside their legacy software.

### Required recharge modes

1. `Internal billing mode`
   - Operator fully uses your SaaS
   - Payment updates expiry instantly
   - Receipts and reports are final in your system

2. `Assisted recharge mode`
   - Customer pays through your SaaS
   - Your system marks recharge as `pending_reconciliation`
   - Operator gets notification and export file
   - Operator updates external software separately
   - Later they mark it reconciled

3. `Integrated mode`
   - External billing software exposes API/webhook
   - Your system posts recharge to external software
   - External system returns success/failure
   - Sync logs are stored for audit

### Recharge states

- `draft`
- `payment_received`
- `activation_pending`
- `activated_internal`
- `sent_to_external`
- `external_success`
- `external_failed`
- `reconciled`
- `cancelled`

## 6. Main apps and page structure

### A. Public pages

- Landing page
- Pricing
- Operator signup
- Operator login
- Forgot password
- Contact sales
- Status/maintenance page

### B. Super admin app

- Dashboard
- Operators
- Operator detail
- SaaS plans
- Operator subscriptions
- Platform revenue
- Commissions
- Coupons/promotions
- Support tickets
- Announcements
- Global templates
- System settings
- Audit logs
- Monitoring/health

### C. Operator app

- Dashboard
- Customers
- Add customer
- Customer profile
- Packages
- Collect payment
- Payments history
- Recharges
- Due list / defaulters
- Reports
- Staff
- Areas
- Complaints
- Notifications
- Expenses
- Offers
- Settings
- My subscription

### D. Optional customer portal

- Login
- Dashboard
- Pay bill
- Recharge
- Receipts
- Complaints
- Profile

## 7. Full workflow from login to logout

### Operator onboarding

1. Operator signs up
2. Mobile/email verification
3. Plan/trial selection
4. Admin approval if required
5. Tenant created
6. Operator admin user created
7. Default roles, settings, and trial limits seeded

### Daily operator flow

1. Login
2. Dashboard shows due collections and expiring users
3. Search customer
4. Collect payment
5. Create receipt
6. Extend package validity or mark recharge pending external sync
7. Send SMS/WhatsApp
8. Staff or operator checks reports
9. Logout or auto-session expiry

### Super admin flow

1. Login
2. Review operator health, subscriptions, outstanding dues
3. Approve new operators or plan upgrades
4. Monitor platform revenue and ticket load
5. Send announcements or renewals
6. Review audit logs
7. Logout

## 8. Small but important features people forget

- Unique receipt sequences per tenant
- Grace period before suspension
- Partial payments
- Advance wallet or credit balance
- Refund logs
- Document expiry reminders
- Duplicate mobile/STB/MAC detection
- Deleted-record archive instead of hard delete
- Staff activity audit
- Bulk import error rows download
- Area route planning for collectors
- Retry queues for failed SMS/webhooks
- GST/tax-aware invoices
- Multi-language message templates
- Trial-expiry nudges for operators
- Usage-limit warnings when plan caps are near
- Offline collection sync for field staff
- Customer merge when duplicate records exist

## 9. Core data domains

- Identity and access
- Tenants and subscriptions
- Customers and packages
- Billing, payments, receipts, recharges
- Staff, roles, permissions
- Complaints and tickets
- Notifications and templates
- Reports and exports
- Settings and audit

## 10. Technical modules you should build first

### Phase 1 MVP

- Auth
- Tenant creation
- Operator subscription plan model
- Customer CRUD
- Package CRUD
- Collect payment
- Receipt generation
- Due tracking
- Role-based staff access
- Dashboard summaries

### Phase 2

- Notifications
- Complaints
- Expenses
- Reports export
- SaaS billing for operators

### Phase 3

- External billing sync adapters
- Customer portal
- Realtime alerts
- Advanced reconciliation
- API marketplace/integration center

## 11. Security requirements

- Hash passwords with bcrypt/argon2
- Refresh token rotation
- Role and permission checks on every endpoint
- Tenant-aware query enforcement
- Row-level soft delete
- File upload validation
- Rate limiting on login and OTP
- Audit logging for financial actions
- Signed URLs for document downloads

## 12. Deployment path

### Cheap/free start

- Frontend: Vercel or Netlify
- API: Render/Railway/Fly or VPS with Docker
- DB: PostgreSQL managed free tier or self-hosted
- Redis: Upstash or self-hosted
- Object storage: Cloudflare R2 / MinIO

### When you grow

- Dockerize services
- Add worker processes
- Add backup/restore strategy
- Add multi-region storage/CDN
- Add monitoring with Grafana/Sentry

## 13. UX direction

- Clean SaaS layout, not cluttered local-software style
- Fast customer search always visible
- Payment flow in 3 steps max
- High-contrast due and expiry states
- Large tap-friendly actions for collectors
- Consistent filters across all list pages
- Sticky summary cards on desktop
- Mobile responsive operator dashboard

## 14. Immediate deliverable in this repo

This repo now starts with:

- Product blueprint
- Express backend scaffold
- Tenant-aware API structure
- React dashboard scaffold
- Modern page layout for admin/operator experience
