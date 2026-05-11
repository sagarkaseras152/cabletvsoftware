const apiBase = (() => {
  const configured = window.CABLEOPS_API_BASE;
  if (configured) return configured;
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return "http://localhost:4000/api";
  }
  return "https://cableops-api.onrender.com/api";
})();

const appRoot = document.getElementById("app");
const storageKey = "cableops_session";

const operatorMenu = [
  { key: "dashboard", title: "Dashboard", description: "Overview and quick stats" },
  { key: "customers", title: "Customers", description: "Profiles and lifecycle" },
  { key: "packages", title: "Packages", description: "Plans and pricing" },
  { key: "payments", title: "Payments", description: "Collections and receipts" },
  { key: "recharge", title: "Recharge", description: "Renewals and validity" },
  { key: "reports", title: "Reports", description: "Collections and due summary" },
  { key: "staff", title: "Staff", description: "Team and permissions" },
  { key: "expenses", title: "Expenses", description: "Operational cost" },
  { key: "network", title: "Network", description: "OLT, ONT and ACS tasks" },
  { key: "settings", title: "Settings", description: "Brand and billing rules" },
];

const state = {
  adminSelectedOperatorId: "",
  adminFormMode: "create",
  operatorView: "dashboard",
  customerFormOpen: false,
  customerImportPreview: null,
  customerImportFileName: "",
  customerImportMode: "skip_duplicates",
  statusTimer: null,
  publicPayment: {
    customerRef: "",
    password: "123456",
    lookup: null,
  },
  dashboardFilters: {
    dueStart: "",
    dueEnd: "",
  },
  quickPayCustomerId: "",
  data: {
    operators: [],
    selectedOperator: null,
    selectedOperatorSettings: null,
    selectedOperatorMetrics: null,
    selectedOperatorAdmins: [],
    customers: [],
    packages: [],
    payments: [],
    paymentRequests: [],
    recharges: [],
    reports: [],
    staff: [],
    expenses: [],
    olts: [],
    onts: [],
    acsTasks: [],
    acsEvents: [],
    settings: null,
  },
};

function isCustomerPortalMode() {
  return window.location.hash.startsWith("#customer-pay");
}

function getCustomerPortalIdFromHash() {
  const raw = window.location.hash || "";
  const match = raw.match(/^#customer-pay\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function getSession() {
  const raw = localStorage.getItem(storageKey);
  return raw ? JSON.parse(raw) : null;
}

function setSession(session) {
  localStorage.setItem(storageKey, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(storageKey);
}

async function fetchJson(path, options = {}) {
  const session = getSession();
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    if (response.status === 401 && session?.token) {
      clearSession();
      renderLogin("Session expired. Please log in again.");
    }
    const errorText = await response.text();
    throw new Error(errorText || `Request failed: ${response.status}`);
  }

  return response.json();
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN");
}

function normalizeDateOnly(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function getAcsEndpoint() {
  const session = getSession();
  const tenantCode = session?.tenant?.code || "TENANT";
  return `${apiBase.replace(/\/api$/, "")}/api/acs/cwmp/${tenantCode}`;
}

function badgeClass(status) {
  const map = {
    active: "active",
    success: "success",
    trial: "trial",
    approved: "success",
    completed: "success",
    online: "success",
    queued: "warning",
    dispatched: "warning",
    new_discovered: "warning",
    received: "warning",
    partial: "warning",
    suspended: "suspended",
    activation_pending: "warning",
    failed: "danger",
    fault: "danger",
    rejected: "danger",
    device_not_tr069_ready: "danger",
    offline: "danger",
  };
  return map[status] || "warning";
}

function showStatus(message, type = "success") {
  const box = document.getElementById("statusBox");
  if (box) {
    box.innerHTML = `<div class="feedback ${type}">${message}</div>`;
  }
  if (state.statusTimer) {
    clearTimeout(state.statusTimer);
    state.statusTimer = null;
  }
  if (message && box) {
    state.statusTimer = window.setTimeout(() => {
      const current = document.getElementById("statusBox");
      if (current) current.innerHTML = "";
    }, 4200);
  }
}

function parseErrorMessage(error, fallback = "Request failed.") {
  try {
    const parsed = JSON.parse(error.message);
    if (parsed?.message) return parsed.message;
  } catch {
  }

  return error?.message || fallback;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseCsvText(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  if (current.length || row.length) {
    row.push(current);
    rows.push(row);
  }

  return rows.filter((item) => item.some((cell) => String(cell || "").trim()));
}

function normalizeImportKey(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function mapImportRowsFromCsv(text) {
  const parsedRows = parseCsvText(text);
  if (parsedRows.length < 2) {
    throw new Error("CSV me header aur kam se kam 1 data row hona chahiye.");
  }

  const headers = parsedRows[0].map((item) => normalizeImportKey(item));
  const aliasMap = {
    name: "name",
    customername: "name",
    fullname: "name",
    mobile: "mobile",
    mobilenumber: "mobile",
    phone: "mobile",
    customercode: "customerCode",
    customerid: "customerCode",
    code: "customerCode",
    area: "area",
    locality: "area",
    package: "packageName",
    packagename: "packageName",
    plan: "packageName",
    due: "dueAmount",
    dueamount: "dueAmount",
    amountdue: "dueAmount",
    duedate: "dueDate",
    expirydate: "expiryDate",
    connectiontype: "connectionType",
    service: "connectionType",
  };

  const mappedHeaders = headers.map((header) => aliasMap[header] || "");
  if (!mappedHeaders.includes("name") || !mappedHeaders.includes("mobile")) {
    throw new Error("CSV header me kam se kam Name aur Mobile columns chahiye.");
  }

  return parsedRows.slice(1).map((row) => {
    const mapped = {};
    mappedHeaders.forEach((key, index) => {
      if (!key) return;
      mapped[key] = String(row[index] || "").trim();
    });
    return mapped;
  }).filter((item) => Object.values(item).some((value) => String(value || "").trim()));
}

function renderCustomerImportPreview(preview) {
  if (!preview) {
    return `<div class="empty-state">CSV upload karo, preview dekho, phir safe import chalao.</div>`;
  }

  return `
    <div class="import-summary-grid">
      <article class="menu-card"><h3>Total Rows</h3><p>${preview.summary.totalRows}</p></article>
      <article class="menu-card"><h3>New Create</h3><p>${preview.summary.createCount}</p></article>
      <article class="menu-card"><h3>Update Match</h3><p>${preview.summary.updateCount}</p></article>
      <article class="menu-card"><h3>Skip / Issue</h3><p>${preview.summary.skipCount}</p></article>
    </div>
    ${tableWrapper(`
      <table>
        <thead><tr><th>Row</th><th>Name</th><th>Mobile</th><th>Package</th><th>Action</th><th>Issues</th></tr></thead>
        <tbody>
          ${preview.items
            .slice(0, 15)
            .map(
              (item) => `
                <tr>
                  <td>${item.rowNumber}</td>
                  <td>${escapeHtml(item.name)}</td>
                  <td>${escapeHtml(item.mobile)}</td>
                  <td>${escapeHtml(item.packageRef || "-")}</td>
                  <td><span class="badge ${badgeClass(item.action === "create" ? "success" : item.action === "update" ? "warning" : "danger")}">${item.action}</span></td>
                  <td>${item.issues.length ? escapeHtml(item.issues.join(", ")) : "-"}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    `)}
    ${preview.items.length > 15 ? `<p class="subtle-note">Preview me first 15 rows dikh rahi hain. Import sab rows par chalega.</p>` : ""}
  `;
}

function renderLogin(message = "") {
  appRoot.innerHTML = `
    <div class="auth-shell">
      <div class="auth-card">
        <section class="auth-brand">
          <p class="eyebrow">CableOps Access</p>
          <h1>Built for high-volume cable and internet operations.</h1>
          <p class="lede">
            Clean control for subscriptions, collections, customer records, packages, recharge flows, team access, and day-to-day operations.
          </p>
          <div class="auth-points">
            <div class="auth-point">Revenue, billing and due visibility in one place</div>
            <div class="auth-point">Protected access with dedicated workspaces</div>
            <div class="auth-point">Fast actions for customer, recharge and collection teams</div>
          </div>
        </section>
        <section class="auth-form">
          <p class="eyebrow">Secure Login</p>
          <h2>Sign in to continue</h2>
          ${message ? `<div class="feedback error">${message}</div>` : ""}
          <form id="loginForm" class="form-grid">
            <label>
              Email
              <input name="email" type="email" placeholder="name@company.com" required />
            </label>
            <label>
              Password
              <input name="password" type="password" placeholder="Enter password" required />
            </label>
            <button class="primary-btn" type="submit">Sign In</button>
          </form>
          <div class="toolbar">
            <button id="openCustomerPayPortal" class="ghost-btn" type="button">Customer Payment</button>
          </div>
        </section>
      </div>
    </div>
  `;

  document.getElementById("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    try {
      const response = await fetchJson("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: formData.get("email"),
          password: formData.get("password"),
        }),
      });
      setSession(response);
      renderAppShell();
      await hydrateDashboard();
    } catch (_error) {
      renderLogin("Email ya password galat hai.");
    }
  });

  document.getElementById("openCustomerPayPortal").addEventListener("click", () => {
    window.location.hash = "#customer-pay";
    renderPublicCustomerPaymentPortal();
  });
}

function renderPublicCustomerPaymentPortal(message = "", messageType = "error") {
  const lookup = state.publicPayment.lookup;
  const portalCustomerId = getCustomerPortalIdFromHash();
  appRoot.innerHTML = `
    <div class="auth-shell">
      <div class="auth-card">
        <section class="auth-brand">
          <p class="eyebrow">Customer Payment</p>
          <h1>Pay your operator using the assigned QR.</h1>
          <p class="lede">
            Apna unique Customer Portal ID dalo. Iske baad aapko apni details, package, due amount aur payment confirmation screen milegi.
          </p>
        </section>
        <section class="auth-form">
          <p class="eyebrow">Secure Payment Lookup</p>
          <h2>Find your account</h2>
          ${message ? `<div class="feedback ${messageType}">${message}</div>` : ""}
          <form id="publicPaymentLookupForm" class="form-grid">
            <label>Customer Portal ID<input name="customerId" value="${escapeHtml(portalCustomerId || state.publicPayment.customerRef)}" placeholder="Unique customer portal ID" required /></label>
            <label>Password<input name="password" type="password" value="${escapeHtml(state.publicPayment.password || "123456")}" placeholder="Default password" required /></label>
            <button class="primary-btn" type="submit">Login to Customer Portal</button>
          </form>
          ${lookup ? `
            <div class="inline-form-block public-payment-card">
              <p class="eyebrow">Customer Portal</p>
              <h3>${escapeHtml(lookup.operator.paymentDisplayName || lookup.operator.businessName)}</h3>
              <p class="subtle-note">${escapeHtml(lookup.customer.name)} | ${escapeHtml(lookup.customer.mobile)} | Portal ID ${escapeHtml(lookup.customer.portalId)}</p>
              <div class="import-summary-grid">
                <article class="menu-card"><h3>Package</h3><p>${escapeHtml(lookup.customer.packageName || "-")}</p></article>
                <article class="menu-card"><h3>Due</h3><p>${formatMoney(lookup.customer.dueAmount || 0)}</p></article>
                <article class="menu-card"><h3>Due Date</h3><p>${escapeHtml(formatDate(lookup.customer.dueDate))}</p></article>
                <article class="menu-card"><h3>Status</h3><p>${escapeHtml(lookup.customer.status || "-")}</p></article>
              </div>
              ${lookup.operator.qrImageUrl ? `<img class="qr-preview" src="${escapeHtml(lookup.operator.qrImageUrl)}" alt="Operator QR" />` : `<div class="empty-state">QR image abhi set nahi hai. UPI ID: <strong>${escapeHtml(lookup.operator.upiId || "-")}</strong></div>`}
              <p class="subtle-note">${escapeHtml(lookup.operator.qrInstructions || "QR scan karke payment karein, phir UTR submit karein.")}</p>
              <form id="publicPaymentSubmitForm" class="form-grid">
                <input type="hidden" name="customerId" value="${escapeHtml(lookup.customer.portalId)}" />
                <label>Amount Paid<input name="amount" type="number" value="${lookup.customer.dueAmount || ""}" required /></label>
                <label>UTR / Transaction Ref<input name="utrNumber" placeholder="Optional but recommended" /></label>
                <label>Note<input name="note" placeholder="Screenshot ya note reference" /></label>
                <button class="primary-btn" type="submit">Submit Payment Confirmation</button>
              </form>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>Recent Payments</th><th>Amount</th><th>Status</th></tr></thead>
                  <tbody>
                    ${(lookup.payments || []).map((item) => `
                      <tr>
                        <td>${escapeHtml(formatDate(item.paymentDate))}<br /><span class="subtle-note">${escapeHtml(item.receiptNumber || "-")}</span></td>
                        <td>${formatMoney(item.amountPaid)}</td>
                        <td><span class="badge ${badgeClass(item.status)}">${escapeHtml(item.status)}</span></td>
                      </tr>
                    `).join("") || `<tr><td colspan="3">No payment history yet.</td></tr>`}
                  </tbody>
                </table>
              </div>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>Pending Requests</th><th>Amount</th><th>Status</th></tr></thead>
                  <tbody>
                    ${(lookup.paymentRequests || []).map((item) => `
                      <tr>
                        <td>${escapeHtml(formatDate(item.paidAt || item.createdAt))}<br /><span class="subtle-note">${escapeHtml(item.utrNumber || "-")}</span></td>
                        <td>${formatMoney(item.amount)}</td>
                        <td><span class="badge ${badgeClass(item.status)}">${escapeHtml(item.status)}</span></td>
                      </tr>
                    `).join("") || `<tr><td colspan="3">No payment requests yet.</td></tr>`}
                  </tbody>
                </table>
              </div>
            </div>
          ` : ""}
          <div class="toolbar">
            <button id="backToLoginBtn" class="ghost-btn" type="button">Back to Login</button>
          </div>
        </section>
      </div>
    </div>
  `;

  document.getElementById("publicPaymentLookupForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    state.publicPayment.customerRef = String(formData.get("customerId") || "").trim();
    state.publicPayment.password = String(formData.get("password") || "").trim();
    try {
      const response = await fetchJson("/public/customer-login", {
        method: "POST",
        body: JSON.stringify({
          customerId: state.publicPayment.customerRef,
          password: state.publicPayment.password,
        }),
      });
      state.publicPayment.lookup = response;
      window.location.hash = `#customer-pay/${encodeURIComponent(response.customer.portalId)}`;
      renderPublicCustomerPaymentPortal();
    } catch (error) {
      renderPublicCustomerPaymentPortal(parseErrorMessage(error, "Customer lookup fail ho gaya."), "error");
    }
  });

  const publicPaymentSubmitForm = document.getElementById("publicPaymentSubmitForm");
  if (publicPaymentSubmitForm) {
    publicPaymentSubmitForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      try {
        await fetchJson("/public/payment-request", {
          method: "POST",
          body: JSON.stringify(Object.fromEntries(formData.entries())),
        });
        const fresh = await fetchJson(`/public/customer-portal/${lookup.customer.portalId}`);
        state.publicPayment.lookup = fresh;
        renderPublicCustomerPaymentPortal("Payment request submit ho gaya. Operator approval ke baad software me auto entry ho jayegi.", "success");
      } catch (error) {
        renderPublicCustomerPaymentPortal(parseErrorMessage(error, "Payment request submit nahi hua."), "error");
      }
    });
  }

  document.getElementById("backToLoginBtn").addEventListener("click", () => {
    state.publicPayment.lookup = null;
    state.publicPayment.customerRef = "";
    state.publicPayment.password = "123456";
    window.location.hash = "";
    renderLogin();
  });
}

function renderAdminShell(user) {
  appRoot.innerHTML = `
    <div class="page-shell">
      <div class="topbar">
        <div>
          <p class="eyebrow">CableOps</p>
          <h2>Admin Control</h2>
          <div class="topbar-meta">${user.name} | ${user.email}</div>
        </div>
        <div class="inline-actions">
          <button id="profileBtn" class="ghost-btn">Refresh Profile</button>
          <button id="passwordBtn" class="ghost-btn">Change Password</button>
          <button id="logoutBtn" class="primary-btn">Logout</button>
        </div>
      </div>

      <header class="hero">
        <div class="hero-copy">
          <p class="eyebrow">Control Center</p>
          <h1>Manage accounts, access and commercial operations.</h1>
          <p class="lede">
            Create accounts, control access, manage plans, and maintain platform-wide visibility.
          </p>
        </div>
      </header>

      <main class="content-grid">
        <section id="adminFormPanel" class="panel">${renderAdminFormPanel()}</section>

        <section class="split-grid admin-grid">
          <article class="panel">
            <div class="section-head">
              <div>
                <p class="eyebrow">Business List</p>
                <h2>All Accounts</h2>
              </div>
            </div>
            <div id="operatorsList" class="stack-list"></div>
          </article>

          <article class="panel">
            <div class="section-head">
              <div>
                <p class="eyebrow">Account Control</p>
                <h2>Management</h2>
              </div>
            </div>
            <div id="adminOperatorDetail">${renderAdminEmptyState()}</div>
          </article>
        </section>
      </main>
    </div>
  `;

  attachCommonEvents();
  attachAdminFormEvents();
}

function renderAdminFormPanel() {
  const isEdit = state.adminFormMode === "edit" && state.data.selectedOperator;
  const item = state.data.selectedOperator || {};
  const settings = state.data.selectedOperatorSettings || {};
  const adminUser = state.data.selectedOperatorAdmins?.[0] || {};

  return `
    <div id="statusBox"></div>
    <div class="section-head">
      <div>
        <p class="eyebrow">Account Onboarding</p>
        <h2>${isEdit ? "Edit Business Account" : "Create Business Account"}</h2>
      </div>
      <div class="toolbar">
        <button type="button" id="exportBackupBtn" class="ghost-btn">Export Backup</button>
        <label class="ghost-btn backup-upload-btn">
          Import Backup
          <input id="importBackupFile" type="file" accept=".json,application/json" hidden />
        </label>
        ${isEdit ? `<button type="button" id="adminCreateNewBtn" class="ghost-btn">Create New</button>` : ""}
      </div>
    </div>
    <form id="operatorCreateForm" class="form-grid two-col-grid">
      <label>Business Name<input name="businessName" value="${escapeHtml(item.businessName || "")}" required /></label>
      <label>Owner Name<input name="ownerName" value="${escapeHtml(item.ownerName || "")}" required /></label>
      <label>City<input name="city" value="${escapeHtml(item.city || "")}" /></label>
      <label>Mobile<input name="mobile" value="${escapeHtml(item.mobile || "")}" required /></label>
      <label>Login Email<input name="email" type="email" value="${escapeHtml(adminUser.email || "")}" ${isEdit ? "readonly" : ""} required /></label>
      <label>${isEdit ? "Subscription Status" : "Password"}${isEdit
        ? `<select name="subscriptionStatus">
            <option value="trial" ${item.subscriptionStatus === "trial" ? "selected" : ""}>Trial</option>
            <option value="active" ${item.subscriptionStatus === "active" ? "selected" : ""}>Active</option>
            <option value="suspended" ${item.subscriptionStatus === "suspended" ? "selected" : ""}>Suspended</option>
            <option value="expired" ${item.subscriptionStatus === "expired" ? "selected" : ""}>Expired</option>
          </select>`
        : `<input name="password" required />`}</label>
      <label>Plan<input name="plan" value="${escapeHtml(item.plan || "Trial")}" /></label>
      ${isEdit ? `
        <label>Firm Name<input name="companyName" value="${escapeHtml(settings.companyName || "")}" /></label>
        <label>Support Mobile<input name="supportMobile" value="${escapeHtml(settings.supportMobile || "")}" /></label>
        <label>Address<input name="address" value="${escapeHtml(settings.address || "")}" /></label>
        <label>SMS Credits<input name="smsCredits" type="number" value="${item.smsCredits || 0}" /></label>
      ` : ""}
      <div class="form-actions"><button class="primary-btn" type="submit">${isEdit ? "Save Account Changes" : "Create Account"}</button></div>
    </form>
  `;
}

function attachAdminFormEvents() {
  const operatorCreateForm = document.getElementById("operatorCreateForm");
  if (!operatorCreateForm) return;

  operatorCreateForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(event.currentTarget);
    try {
      if (state.adminFormMode === "edit" && state.adminSelectedOperatorId) {
        await fetchJson(`/operators/${state.adminSelectedOperatorId}`, {
          method: "PATCH",
          body: JSON.stringify({
            businessName: formData.get("businessName"),
            ownerName: formData.get("ownerName"),
            city: formData.get("city"),
            mobile: formData.get("mobile"),
            plan: formData.get("plan"),
            subscriptionStatus: formData.get("subscriptionStatus"),
            companyName: formData.get("companyName"),
            supportMobile: formData.get("supportMobile"),
            address: formData.get("address"),
            smsCredits: formData.get("smsCredits"),
          }),
        });
        showStatus("Business account updated successfully.");
      } else {
        await fetchJson("/operators", {
          method: "POST",
          body: JSON.stringify({
            businessName: formData.get("businessName"),
            ownerName: formData.get("ownerName"),
            city: formData.get("city"),
            mobile: formData.get("mobile"),
            email: formData.get("email"),
            password: formData.get("password"),
            plan: formData.get("plan"),
          }),
        });
        showStatus("Business account created successfully.");
        form.reset();
      }
      await hydrateDashboard();
    } catch (error) {
      showStatus(parseErrorMessage(error, "Account create nahi hua."), "error");
    }
  });

  const adminCreateNewBtn = document.getElementById("adminCreateNewBtn");
  if (adminCreateNewBtn) {
    adminCreateNewBtn.addEventListener("click", () => {
      state.adminFormMode = "create";
      state.adminSelectedOperatorId = "";
      state.data.selectedOperator = null;
      state.data.selectedOperatorSettings = null;
      state.data.selectedOperatorAdmins = [];
      const panel = document.getElementById("adminFormPanel");
      if (panel) {
        panel.innerHTML = renderAdminFormPanel();
        attachAdminFormEvents();
      }
      const detail = document.getElementById("adminOperatorDetail");
      if (detail) detail.innerHTML = renderAdminEmptyState();
    });
  }

  const exportBackupBtn = document.getElementById("exportBackupBtn");
  if (exportBackupBtn) {
    exportBackupBtn.addEventListener("click", async () => {
      try {
        const response = await fetchJson("/backup/export");
        const blob = new Blob([JSON.stringify(response.snapshot, null, 2)], { type: "application/json;charset=utf-8" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `cableops-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(link.href);
        showStatus("Full backup export ho gaya.");
      } catch (error) {
        showStatus(parseErrorMessage(error, "Backup export fail ho gaya."), "error");
      }
    });
  }

  const importBackupFile = document.getElementById("importBackupFile");
  if (importBackupFile) {
    importBackupFile.addEventListener("change", async (event) => {
      const file = event.currentTarget.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const snapshot = JSON.parse(text);
        const response = await fetchJson("/backup/import", {
          method: "POST",
          body: JSON.stringify({ snapshot }),
        });
        await hydrateDashboard();
        showStatus(response.message || "Backup restore ho gaya.");
      } catch (error) {
        showStatus(parseErrorMessage(error, "Backup import fail ho gaya."), "error");
      } finally {
        event.currentTarget.value = "";
      }
    });
  }
}

function renderAdminEmptyState() {
  return `<div class="empty-state">Select a business account to manage login, plan, subscription status and billing settings.</div>`;
}

function renderAdminOperatorDetail() {
  const item = state.data.selectedOperator;
  const settings = state.data.selectedOperatorSettings;
  const metrics = state.data.selectedOperatorMetrics;
  const adminUser = state.data.selectedOperatorAdmins?.[0];

  if (!item) return renderAdminEmptyState();

  return `
    <div class="menu-grid">
      <article class="menu-card"><h3>Plan</h3><p>${item.plan}</p><span>Subscription status: ${item.subscriptionStatus}</span></article>
      <article class="menu-card"><h3>Customers</h3><p>${metrics?.activeCustomers || 0}</p><span>Pending due: ${formatMoney(metrics?.pendingCollections || 0)}</span></article>
      <article class="menu-card"><h3>Collection</h3><p>${formatMoney(metrics?.totalCollection || 0)}</p><span>Monthly counter: ${formatMoney(metrics?.monthCollection || 0)}</span></article>
      <article class="menu-card"><h3>Login</h3><p>${adminUser?.email || "-"}</p><span>${adminUser?.name || "No admin mapped"}</span></article>
    </div>

    <form id="operatorManageForm" class="form-grid two-col-grid">
      <label>Business Name<input name="businessName" value="${item.businessName || ""}" required /></label>
      <label>Owner Name<input name="ownerName" value="${item.ownerName || ""}" required /></label>
      <label>City<input name="city" value="${item.city || ""}" /></label>
      <label>Mobile<input name="mobile" value="${item.mobile || ""}" /></label>
      <label>Plan
        <select name="plan">
          <option value="Trial" ${item.plan === "Trial" ? "selected" : ""}>Trial</option>
          <option value="Basic" ${item.plan === "Basic" ? "selected" : ""}>Basic</option>
          <option value="Standard" ${item.plan === "Standard" ? "selected" : ""}>Standard</option>
          <option value="Premium" ${item.plan === "Premium" ? "selected" : ""}>Premium</option>
        </select>
      </label>
      <label>Status
        <select name="subscriptionStatus">
          <option value="trial" ${item.subscriptionStatus === "trial" ? "selected" : ""}>Trial</option>
          <option value="active" ${item.subscriptionStatus === "active" ? "selected" : ""}>Active</option>
          <option value="suspended" ${item.subscriptionStatus === "suspended" ? "selected" : ""}>Suspended</option>
          <option value="expired" ${item.subscriptionStatus === "expired" ? "selected" : ""}>Expired</option>
        </select>
      </label>
      <label>SMS Credits<input name="smsCredits" type="number" value="${item.smsCredits || 0}" /></label>
      <label>Firm Name<input name="companyName" value="${settings?.companyName || ""}" /></label>
      <label>Support Mobile<input name="supportMobile" value="${settings?.supportMobile || ""}" /></label>
      <label>Address<input name="address" value="${settings?.address || ""}" /></label>
      <div class="form-actions"><button class="primary-btn" type="submit">Save Account Changes</button></div>
    </form>

    <div class="toolbar">
      <button type="button" id="editOperatorInFormBtn" class="ghost-btn">Edit In Form</button>
      <button type="button" id="resetOperatorPasswordBtn" class="ghost-btn">Reset Operator Password</button>
      <button type="button" id="toggleOperatorStatusBtn" class="ghost-btn">${item.subscriptionStatus === "suspended" ? "Activate Account" : "Suspend Account"}</button>
    </div>
  `;
}

function renderOperatorShell(user, tenant) {
  const brandName = state.data.settings?.companyName || tenant?.businessName || "Workspace";
  appRoot.innerHTML = `
    <div class="page-shell">
      <div class="topbar">
        <div>
          <p class="eyebrow">CableOps</p>
          <h2 id="workspaceTitle">${brandName}</h2>
          <div class="topbar-meta">${user.name} | ${user.email}</div>
        </div>
        <div class="inline-actions">
          <button id="profileBtn" class="ghost-btn">Refresh Profile</button>
          <button id="passwordBtn" class="ghost-btn">Change Password</button>
          <button id="logoutBtn" class="primary-btn">Logout</button>
        </div>
      </div>

      <div class="workspace-grid">
        <aside class="sidebar">
          <div class="sidebar-brand">
            <p class="eyebrow">Navigation</p>
            <h3>Business Suite</h3>
          </div>
          <nav id="operatorNav" class="nav-list"></nav>
        </aside>

        <section class="workspace-main">
          <div id="statusBox"></div>
          <div id="operatorContent" class="content-grid"></div>
        </section>
      </div>
    </div>
  `;

  attachCommonEvents();
  renderOperatorNav();
  renderOperatorView();
}

function renderOperatorNav() {
  const nav = document.getElementById("operatorNav");
  nav.innerHTML = operatorMenu
    .map(
      (item) => `
        <button type="button" class="nav-item ${state.operatorView === item.key ? "active-nav" : ""}" data-view="${item.key}">
          <strong>${item.title}</strong>
          <span>${item.description}</span>
        </button>
      `,
    )
    .join("");
}

function tableWrapper(inner) {
  return `<div class="table-wrap">${inner}</div>`;
}

function updateWorkspaceBrand() {
  const title = document.getElementById("workspaceTitle");
  const session = getSession();
  if (!title || !session?.user || session.user.role === "platform_owner") return;
  title.textContent = state.data.settings?.companyName || session.tenant?.businessName || "Workspace";
}

function renderOperatorView() {
  const root = document.getElementById("operatorContent");
  const data = state.data;
  const today = normalizeDateOnly(new Date());
  const dueCustomers = data.customers
    .filter((item) => Number(item.dueAmount || 0) > 0)
    .filter((item) => {
      const dueDate = normalizeDateOnly(item.dueDate);
      if (!dueDate) return true;
      if (state.dashboardFilters.dueStart && dueDate < state.dashboardFilters.dueStart) return false;
      if (state.dashboardFilters.dueEnd && dueDate > state.dashboardFilters.dueEnd) return false;
      return true;
    })
    .sort((a, b) => (normalizeDateOnly(a.dueDate) || "9999-12-31").localeCompare(normalizeDateOnly(b.dueDate) || "9999-12-31"));
  const expiringCustomers = data.customers
    .filter((item) => item.expiryDate)
    .filter((item) => {
      const expiry = normalizeDateOnly(item.expiryDate);
      return expiry >= today;
    })
    .sort((a, b) => normalizeDateOnly(a.expiryDate).localeCompare(normalizeDateOnly(b.expiryDate)))
    .slice(0, 8);
  const activeCustomers = data.customers.filter((item) => item.status === "active").length;
  const monthlyCollection = data.payments.reduce((sum, item) => sum + Number(item.amountPaid || 0), 0);
  const pendingTotal = data.customers.reduce((sum, item) => sum + Number(item.dueAmount || 0), 0);
  const todayCollections = data.payments
    .filter((item) => normalizeDateOnly(item.paymentDate) === today)
    .reduce((sum, item) => sum + Number(item.amountPaid || 0), 0);

  const views = {
    dashboard: `
      <section class="panel">
        <div class="section-head"><div><p class="eyebrow">Dashboard</p><h2>Main Overview</h2></div></div>
        <div class="menu-grid dashboard-grid">
          <article class="menu-card kpi-card"><h3>Total Customers</h3><p>${data.customers.length}</p><span>All registered customers</span></article>
          <article class="menu-card kpi-card"><h3>Active Customers</h3><p>${activeCustomers}</p><span>Currently active connections</span></article>
          <article class="menu-card kpi-card"><h3>Today's Collection</h3><p>${formatMoney(todayCollections)}</p><span>Collected on ${formatDate(today)}</span></article>
          <article class="menu-card kpi-card"><h3>Pending Due</h3><p>${formatMoney(pendingTotal)}</p><span>${dueCustomers.length} customers pending</span></article>
          <article class="menu-card kpi-card"><h3>Monthly Collection</h3><p>${formatMoney(monthlyCollection)}</p><span>Total collected amount</span></article>
          <article class="menu-card kpi-card"><h3>Total Packages</h3><p>${data.packages.length}</p><span>Available active plans</span></article>
        </div>
      </section>
      <section class="panel">
        <div class="section-head">
          <div><p class="eyebrow">Due Payments</p><h2>Customer Due List</h2></div>
          <div class="toolbar filter-toolbar">
            <label class="compact-field">From<input id="dueStartFilter" type="date" value="${state.dashboardFilters.dueStart}" /></label>
            <label class="compact-field">To<input id="dueEndFilter" type="date" value="${state.dashboardFilters.dueEnd}" /></label>
            <button type="button" id="clearDueFilters" class="ghost-btn">Clear</button>
          </div>
        </div>
        ${tableWrapper(renderDashboardDueTable(dueCustomers))}
      </section>
      <section class="split-grid dashboard-split">
        <article class="panel">
          <div class="section-head"><div><p class="eyebrow">Expiring Soon</p><h2>Upcoming Expiry</h2></div></div>
          <div class="stack-list">${renderExpiringCards(expiringCustomers)}</div>
        </article>
        <article class="panel">
          <div class="section-head"><div><p class="eyebrow">Recent Payments</p><h2>Latest Collection</h2></div></div>
          <div class="stack-list">${renderPaymentCards(data.payments.slice(0, 6))}</div>
        </article>
      </section>
    `,
    customers: `
      <section class="panel">
        <div class="section-head">
          <div><p class="eyebrow">Customers</p><h2>Customer List</h2></div>
          <div class="toolbar">
            <button type="button" id="toggleCustomerForm" class="primary-btn">
              ${state.customerFormOpen ? "Close Form" : "Add New Customer"}
            </button>
          </div>
        </div>
        <div class="inline-form-block import-block">
          <div class="section-head">
            <div>
              <p class="eyebrow">Migration Import</p>
              <h3>Upload Excel CSV Safely</h3>
              <p class="subtle-note">Dusre software se customer export ko CSV me save karke upload karo. Pehle preview aayega, phir safe import chalega.</p>
            </div>
          </div>
          <form id="customerImportForm" class="form-grid import-form">
            <label>CSV File<input id="customerImportFile" name="file" type="file" accept=".csv,text/csv" required /></label>
            <label>Import Mode
              <select id="customerImportMode" name="importMode">
                <option value="skip_duplicates" ${state.customerImportMode === "skip_duplicates" ? "selected" : ""}>Safe Mode: Existing skip</option>
                <option value="update_existing" ${state.customerImportMode === "update_existing" ? "selected" : ""}>Update matched existing</option>
              </select>
            </label>
            <div class="form-actions">
              <button class="ghost-btn" type="button" id="downloadCustomerTemplate">Download Sample Header</button>
              <button class="primary-btn" type="submit">Preview Import</button>
            </div>
          </form>
          ${state.customerImportFileName ? `<p class="subtle-note">Selected file: ${escapeHtml(state.customerImportFileName)}</p>` : ""}
          <div id="customerImportPreviewWrap">${renderCustomerImportPreview(state.customerImportPreview)}</div>
          ${state.customerImportPreview ? `<div class="toolbar"><button type="button" id="confirmCustomerImport" class="primary-btn">Run Safe Import</button><button type="button" id="clearCustomerImport" class="ghost-btn">Clear Preview</button></div>` : ""}
        </div>
        ${state.customerFormOpen
          ? `
            <form id="customerForm" class="form-grid two-col-grid inline-form-block">
              <label>Name<input name="name" required /></label>
              <label>Mobile<input name="mobile" required /></label>
              <label>Area<input name="area" /></label>
              <label>Package
                <select name="packageId">
                  <option value="">No package</option>
                  ${renderPackageOptions(data.packages)}
                </select>
              </label>
              <label>Due Amount<input name="dueAmount" type="number" /></label>
              <label>Due Date<input name="dueDate" type="date" /></label>
              <label>Connection Type
                <select name="connectionType">
                  <option value="cable">Cable TV</option>
                  <option value="internet">Internet</option>
                  <option value="both">Both</option>
                </select>
              </label>
              <div class="form-actions"><button class="primary-btn" type="submit">Save Customer</button></div>
            </form>
          `
          : ""}
        ${tableWrapper(renderCustomerTable(data.customers))}
      </section>
    `,
    packages: `
      <section class="panel">
        <div class="section-head"><div><p class="eyebrow">Packages</p><h2>Create Package</h2></div></div>
        <form id="packageForm" class="form-grid two-col-grid">
          <label>Package Name<input name="name" required /></label>
          <label>Type
            <select name="type">
              <option value="cable">Cable</option>
              <option value="internet">Internet</option>
              <option value="combo">Combo</option>
            </select>
          </label>
          <label>Price<input name="price" type="number" required /></label>
          <label>Validity Days<input name="validityDays" type="number" value="30" /></label>
          <div class="form-actions"><button class="primary-btn" type="submit">Save Package</button></div>
        </form>
      </section>
      <section class="panel">
        <div class="section-head"><div><p class="eyebrow">Package List</p><h2>Available Packages</h2></div></div>
        ${tableWrapper(renderPackageTable(data.packages))}
      </section>
    `,
    payments: `
      <section class="panel">
        <div class="section-head">
          <div><p class="eyebrow">Customer Payment Requests</p><h2>Pending Approval Queue</h2></div>
          <div class="toolbar">
            <button type="button" id="copyCustomerPaymentLink" class="ghost-btn">Copy Customer Payment Link</button>
          </div>
        </div>
        ${tableWrapper(renderPaymentRequestTable(data.paymentRequests))}
      </section>
      <section class="panel">
        <div class="section-head"><div><p class="eyebrow">Payments</p><h2>Collect Payment</h2></div></div>
        <form id="paymentForm" class="form-grid two-col-grid">
          <label>Customer
            <select name="customerId">${renderCustomerOptions(data.customers, state.quickPayCustomerId)}</select>
          </label>
          <label>Amount Paid<input name="amountPaid" type="number" required /></label>
          <label>Payment Mode
            <select name="paymentMode">
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="online">Online</option>
            </select>
          </label>
          <div class="form-actions"><button class="primary-btn" type="submit">Collect Payment</button></div>
        </form>
      </section>
      <section class="panel">
        <div class="section-head"><div><p class="eyebrow">Payment History</p><h2>Recent Receipts</h2></div></div>
        <div class="stack-list">${renderPaymentCards(data.payments)}</div>
      </section>
    `,
    recharge: `
      <section class="panel">
        <div class="section-head"><div><p class="eyebrow">Recharge</p><h2>Recharge Customer</h2></div></div>
        <form id="rechargeForm" class="form-grid two-col-grid">
          <label>Customer
            <select name="customerId">${renderCustomerOptions(data.customers)}</select>
          </label>
          <label>Mode
            <select name="mode">
              <option value="internal">Internal</option>
              <option value="assisted">Assisted</option>
            </select>
          </label>
          <label>Amount<input name="amount" type="number" required /></label>
          <div class="form-actions"><button class="primary-btn" type="submit">Create Recharge</button></div>
        </form>
      </section>
      <section class="panel">
        <div class="section-head"><div><p class="eyebrow">Recharge History</p><h2>Recent Recharges</h2></div></div>
        <div class="stack-list">${renderRechargeCards(data.recharges)}</div>
      </section>
    `,
    reports: `
      <section class="panel">
        <div class="section-head"><div><p class="eyebrow">Reports</p><h2>Business Summary</h2></div></div>
        <div class="menu-grid">
          <article class="menu-card"><h3>Collection</h3><p>${formatMoney(data.payments.reduce((sum, item) => sum + item.amountPaid, 0))}</p></article>
          <article class="menu-card"><h3>Pending Due</h3><p>${formatMoney(data.customers.reduce((sum, item) => sum + (item.dueAmount || 0), 0))}</p></article>
          <article class="menu-card"><h3>Expenses</h3><p>${formatMoney(data.expenses.reduce((sum, item) => sum + item.amount, 0))}</p></article>
          <article class="menu-card"><h3>Customers</h3><p>${data.customers.length}</p></article>
        </div>
      </section>
      <section class="panel">
        <div class="section-head"><div><p class="eyebrow">Generated Reports</p><h2>Report Files</h2></div></div>
        ${tableWrapper(renderReportsTable(data.reports))}
      </section>
    `,
    staff: `
      <section class="panel">
        <div class="section-head"><div><p class="eyebrow">Staff</p><h2>Add Staff</h2></div></div>
        <form id="staffForm" class="form-grid two-col-grid">
          <label>Name<input name="name" required /></label>
          <label>Mobile<input name="mobile" required /></label>
          <label>Role
            <select name="role">
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
              <option value="collector">Collector</option>
              <option value="technician">Technician</option>
            </select>
          </label>
          <div class="form-actions"><button class="primary-btn" type="submit">Add Staff</button></div>
        </form>
      </section>
      <section class="panel">
        <div class="section-head"><div><p class="eyebrow">Staff List</p><h2>Current Team</h2></div></div>
        ${tableWrapper(renderStaffTable(data.staff))}
      </section>
    `,
    expenses: `
      <section class="panel">
        <div class="section-head"><div><p class="eyebrow">Expenses</p><h2>Add Expense</h2></div></div>
        <form id="expenseForm" class="form-grid two-col-grid">
          <label>Title<input name="title" required /></label>
          <label>Category<input name="category" required /></label>
          <label>Amount<input name="amount" type="number" required /></label>
          <label>Date<input name="expenseDate" type="date" required /></label>
          <div class="form-actions"><button class="primary-btn" type="submit">Save Expense</button></div>
        </form>
      </section>
      <section class="panel">
        <div class="section-head"><div><p class="eyebrow">Expense List</p><h2>Recent Expenses</h2></div></div>
        ${tableWrapper(renderExpenseTable(data.expenses))}
      </section>
    `,
    network: `
      <section class="panel">
        <div class="feedback success">ACS endpoint: <strong>${getAcsEndpoint()}</strong></div>
        <div class="section-head"><div><p class="eyebrow">Network Core</p><h2>OLT Management</h2></div></div>
        <form id="oltForm" class="form-grid two-col-grid">
          <label>OLT Name<input name="name" required /></label>
          <label>Vendor
            <select name="vendor">
              <option value="syrotech">Syrotech</option>
              <option value="dbc">DBC</option>
              <option value="bdcom">BDCOM</option>
            </select>
          </label>
          <label>Model<input name="model" /></label>
          <label>Management IP<input name="ipAddress" required /></label>
          <label>Username<input name="username" /></label>
          <label>Password<input name="password" /></label>
          <label>Firmware<input name="firmware" /></label>
          <label>PON Ports<input name="ponPorts" type="number" value="4" /></label>
          <label>Location<input name="location" /></label>
          <div class="form-actions"><button class="primary-btn" type="submit">Add OLT</button></div>
        </form>
        ${tableWrapper(renderOltTable(data.olts))}
      </section>
      <section class="panel">
        <div class="section-head"><div><p class="eyebrow">Access Devices</p><h2>ONT Inventory</h2></div></div>
        <form id="ontForm" class="form-grid two-col-grid">
          <label>Serial Number<input name="serialNumber" required /></label>
          <label>Vendor
            <select name="vendor">
              <option value="syrotech">Syrotech</option>
              <option value="dbc">DBC</option>
              <option value="bdcom">BDCOM</option>
            </select>
          </label>
          <label>Model<input name="model" /></label>
          <label>ACS Profile
            <select name="acsProfile">
              <option value="tr181">TR-181</option>
              <option value="tr098">TR-098</option>
            </select>
          </label>
          <label>OLT
            <select name="oltId">
              <option value="">Unmapped</option>
              ${renderOltOptions(data.olts)}
            </select>
          </label>
          <label>Customer
            <select name="customerId">
              <option value="">Unmapped</option>
              ${renderCustomerOptions(data.customers)}
            </select>
          </label>
          <label>PON Port<input name="ponPort" /></label>
          <label>ONU Index<input name="onuIndex" /></label>
          <label>TR-069 Ready
            <select name="tr069Enabled">
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
          <label>Connection Request URL<input name="connectionRequestUrl" /></label>
          <label>Conn. User<input name="connectionRequestUser" /></label>
          <label>Conn. Password<input name="connectionRequestPass" /></label>
          <label>SSID Path<input name="wifiSsidPath" placeholder="optional custom path" /></label>
          <label>Password Path<input name="wifiPasswordPath" placeholder="optional custom path" /></label>
          <label>WiFi SSID<input name="wifiSsid" /></label>
          <label>WiFi Password<input name="wifiPassword" /></label>
          <div class="form-actions"><button class="primary-btn" type="submit">Add ONT</button></div>
        </form>
        ${tableWrapper(renderOntTable(data.onts, data.olts, data.customers))}
      </section>
      <section class="panel">
        <div class="section-head"><div><p class="eyebrow">Provisioning</p><h2>WiFi Update Queue</h2></div></div>
        <form id="wifiTaskForm" class="form-grid two-col-grid">
          <label>ONT
            <select name="ontId">${renderOntOptions(data.onts)}</select>
          </label>
          <label>New WiFi Name<input name="wifiSsid" required /></label>
          <label>New WiFi Password<input name="wifiPassword" required /></label>
          <div class="form-actions"><button class="primary-btn" type="submit">Queue WiFi Change</button></div>
        </form>
        ${tableWrapper(renderAcsTaskTable(data.acsTasks, data.onts))}
      </section>
      <section class="panel">
        <div class="section-head"><div><p class="eyebrow">Diagnostics</p><h2>ACS Event Log</h2></div></div>
        ${tableWrapper(renderAcsEventTable(data.acsEvents, data.onts))}
      </section>
    `,
    settings: `
      <section class="panel">
        <div class="section-head"><div><p class="eyebrow">Settings</p><h2>Brand, Billing and ACS Settings</h2></div></div>
        <form id="settingsForm" class="form-grid two-col-grid">
          <label>Firm Name<input name="companyName" value="${data.settings?.companyName || ""}" /></label>
          <label>Support Mobile<input name="supportMobile" value="${data.settings?.supportMobile || ""}" /></label>
          <label>Billing Day<input name="billingDay" type="number" value="${data.settings?.billingDay || 1}" /></label>
          <label>Late Fee<input name="lateFee" type="number" value="${data.settings?.lateFee || 0}" /></label>
          <label>Address<input name="address" value="${data.settings?.address || ""}" /></label>
          <label>Payment Display Name<input name="paymentDisplayName" value="${data.settings?.paymentDisplayName || ""}" /></label>
          <label>UPI ID<input name="upiId" value="${data.settings?.upiId || ""}" placeholder="example@upi" /></label>
          <label>QR Image URL<input name="qrImageUrl" value="${data.settings?.qrImageUrl || ""}" placeholder="https://.../operator-qr.png" /></label>
          <label>QR Instructions<input name="qrInstructions" value="${data.settings?.qrInstructions || ""}" placeholder="Payment karne ke baad UTR submit karein" /></label>
          <label>ACS Username<input name="acsUsername" value="${data.settings?.acsUsername || ""}" /></label>
          <label>ACS Password<input name="acsPassword" value="${data.settings?.acsPassword || ""}" /></label>
          <label>Default ACS Profile
            <select name="defaultAcsProfile">
              <option value="tr181" ${data.settings?.defaultAcsProfile === "tr181" ? "selected" : ""}>TR-181</option>
              <option value="tr098" ${data.settings?.defaultAcsProfile === "tr098" ? "selected" : ""}>TR-098</option>
            </select>
          </label>
          <label>Default Inform Interval<input name="defaultInformInterval" type="number" value="${data.settings?.defaultInformInterval || 300}" /></label>
          <label>Default SSID Path<input name="defaultWifiSsidPath" value="${data.settings?.defaultWifiSsidPath || ""}" /></label>
          <label>Default Password Path<input name="defaultWifiPasswordPath" value="${data.settings?.defaultWifiPasswordPath || ""}" /></label>
          <label>TR-069 Template Name<input name="tr069TemplateName" value="${data.settings?.tr069TemplateName || ""}" /></label>
          <label>Auto Approve Discovered ONTs
            <select name="autoApproveOnts">
              <option value="true" ${data.settings?.autoApproveOnts !== false ? "selected" : ""}>Yes</option>
              <option value="false" ${data.settings?.autoApproveOnts === false ? "selected" : ""}>No</option>
            </select>
          </label>
          <div class="form-actions"><button class="primary-btn" type="submit">Save Settings</button></div>
        </form>
        <div class="inline-form-block">
          <p class="eyebrow">Customer Payment Link</p>
          <p class="subtle-note">${escapeHtml(`${window.location.origin}${window.location.pathname}#customer-pay`)}</p>
        </div>
      </section>
    `,
  };

  root.innerHTML = views[state.operatorView];
  attachOperatorSectionEvents();
}

function renderCustomerOptions(items, selectedId = "") {
  return items
    .map((item) => `<option value="${item.id}" ${selectedId === item.id ? "selected" : ""}>${item.name} | ${item.mobile}</option>`)
    .join("");
}

function renderPackageOptions(items) {
  return items.map((item) => `<option value="${item.id}">${item.name} | ${formatMoney(item.price)}</option>`).join("");
}

function renderOltOptions(items) {
  return items.map((item) => `<option value="${item.id}">${item.name} | ${item.ipAddress}</option>`).join("");
}

function renderOntOptions(items) {
  return items.map((item) => `<option value="${item.id}">${item.serialNumber} | ${item.vendor || "-"}</option>`).join("");
}

function renderPaymentCards(items) {
  if (!items.length) {
    return `<div class="empty-state">Abhi tak koi payment record nahi hai.</div>`;
  }

  return items
    .map(
      (item) => `
        <article class="stack-card">
          <div>
            <strong>${item.customerName}</strong>
            <p>${item.receiptNumber} | ${item.paymentMode} | ${item.paymentDate}</p>
          </div>
          <div>
            <strong>${formatMoney(item.amountPaid)}</strong>
            <p><span class="badge ${badgeClass(item.status)}">${item.status}</span></p>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderPaymentRequestTable(items) {
  if (!items.length) {
    return `<div class="empty-state">Abhi koi pending customer payment request nahi hai.</div>`;
  }

  return `
    <table>
      <thead><tr><th>Customer</th><th>Amount</th><th>UTR</th><th>Paid At</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>
        ${items
          .map(
            (item) => `
              <tr>
                <td>${escapeHtml(item.customerName)}<br /><span class="subtle-note">${escapeHtml(item.customerMobile)}</span></td>
                <td>${formatMoney(item.amount)}</td>
                <td>${escapeHtml(item.utrNumber || "-")}</td>
                <td>${formatDate(item.paidAt || item.createdAt)}</td>
                <td><span class="badge ${badgeClass(item.status)}">${item.status}</span></td>
                <td>
                  ${item.status === "pending"
                    ? `
                      <button class="ghost-btn action-btn" data-action="approve-payment-request" data-id="${item.id}">Approve</button>
                      <button class="ghost-btn action-btn" data-action="reject-payment-request" data-id="${item.id}">Reject</button>
                    `
                    : "-"}
                </td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderRechargeCards(items) {
  if (!items.length) {
    return `<div class="empty-state">Abhi tak koi recharge record nahi hai.</div>`;
  }

  return items
    .map(
      (item) => `
        <article class="stack-card">
          <div>
            <strong>${item.customerName}</strong>
            <p>${item.mode} | Old: ${item.oldExpiryDate || "-"} | New: ${item.newExpiryDate || "-"}</p>
          </div>
          <div>
            <strong>${formatMoney(item.amount)}</strong>
            <p><span class="badge ${badgeClass(item.status)}">${item.status}</span></p>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderDashboardDueTable(items) {
  if (!items.length) {
    return `<div class="empty-state">Selected filter me koi due customer nahi mila.</div>`;
  }

  return `
    <table>
      <thead><tr><th>Customer</th><th>Mobile</th><th>Area</th><th>Package</th><th>Due Date</th><th>Due Amount</th><th>Action</th></tr></thead>
      <tbody>
        ${items
          .map(
            (item) => `
              <tr>
                <td>${item.name}</td>
                <td>${item.mobile}</td>
                <td>${item.area || "-"}</td>
                <td>${item.packageName || "-"}</td>
                <td>${formatDate(item.dueDate)}</td>
                <td>${formatMoney(item.dueAmount)}</td>
                <td><button type="button" class="primary-btn action-btn" data-action="quick-collect" data-id="${item.id}">Collect</button></td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderExpiringCards(items) {
  if (!items.length) {
    return `<div class="empty-state">Abhi koi near-expiry customer nahi hai.</div>`;
  }

  return items
    .map(
      (item) => `
        <article class="stack-card">
          <div>
            <strong>${item.name}</strong>
            <p>${item.mobile} | ${item.packageName || "No package"}</p>
          </div>
          <div>
            <strong>${formatDate(item.expiryDate)}</strong>
            <p>${item.area || "-"}</p>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderCustomerTable(items) {
  return `
    <table>
      <thead><tr><th>Name</th><th>Mobile</th><th>Portal ID</th><th>Area</th><th>Package</th><th>Status</th><th>Due</th><th>Actions</th></tr></thead>
      <tbody>
        ${items
          .map(
            (item) => `
              <tr>
                <td>${item.name}</td>
                <td>${item.mobile}</td>
                <td>${item.customerCode}</td>
                <td>${item.area || "-"}</td>
                <td>${item.packageName || "-"}</td>
                <td><span class="badge ${badgeClass(item.status)}">${item.status}</span></td>
                <td>${formatMoney(item.dueAmount)}</td>
                <td>
                  <button class="ghost-btn action-btn" data-action="copy-customer-portal" data-id="${item.id}">Portal Link</button>
                  <button class="ghost-btn action-btn" data-action="edit-customer" data-id="${item.id}">Edit</button>
                  <button class="ghost-btn action-btn" data-action="assign-package" data-id="${item.id}">Assign</button>
                  <button class="ghost-btn action-btn" data-action="delete-customer" data-id="${item.id}">Delete</button>
                </td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderPackageTable(items) {
  return `
    <table>
      <thead><tr><th>Name</th><th>Type</th><th>Price</th><th>Validity</th><th>Customers</th><th>Actions</th></tr></thead>
      <tbody>
        ${items
          .map(
            (item) => `
              <tr>
                <td>${item.name}</td>
                <td>${item.type}</td>
                <td>${formatMoney(item.price)}</td>
                <td>${item.validityDays} days</td>
                <td>${item.customers || 0}</td>
                <td>
                  <button class="ghost-btn action-btn" data-action="edit-package" data-id="${item.id}">Edit</button>
                  <button class="ghost-btn action-btn" data-action="delete-package" data-id="${item.id}">Delete</button>
                </td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderReportsTable(items) {
  return `
    <table>
      <thead><tr><th>Name</th><th>Format</th><th>Generated At</th></tr></thead>
      <tbody>
        ${items
          .map(
            (item) => `
              <tr>
                <td>${item.name}</td>
                <td>${item.format}</td>
                <td>${item.generatedAt}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderStaffTable(items) {
  return `
    <table>
      <thead><tr><th>Name</th><th>Mobile</th><th>Role</th><th>Status</th></tr></thead>
      <tbody>
        ${items
          .map(
            (item) => `
              <tr>
                <td>${item.name}</td>
                <td>${item.mobile}</td>
                <td>${item.role}</td>
                <td><span class="badge ${badgeClass(item.status)}">${item.status}</span></td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderExpenseTable(items) {
  return `
    <table>
      <thead><tr><th>Title</th><th>Category</th><th>Date</th><th>Amount</th></tr></thead>
      <tbody>
        ${items
          .map(
            (item) => `
              <tr>
                <td>${item.title}</td>
                <td>${item.category}</td>
                <td>${item.expenseDate}</td>
                <td>${formatMoney(item.amount)}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderOltTable(items) {
  return `
    <table>
      <thead><tr><th>Name</th><th>Vendor</th><th>Model</th><th>IP</th><th>Firmware</th><th>PON</th><th>Status</th></tr></thead>
      <tbody>
        ${items
          .map(
            (item) => `
              <tr>
                <td>${item.name}</td>
                <td>${item.vendor}</td>
                <td>${item.model || "-"}</td>
                <td>${item.ipAddress}</td>
                <td>${item.firmware || "-"}</td>
                <td>${item.ponPorts || 0}</td>
                <td><span class="badge ${badgeClass(item.status)}">${item.status}</span></td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderOntTable(onts, olts, customers) {
  const oltMap = Object.fromEntries(olts.map((item) => [item.id, item]));
  const customerMap = Object.fromEntries(customers.map((item) => [item.id, item]));
  return `
    <table>
      <thead><tr><th>Serial</th><th>Vendor</th><th>OLT</th><th>Customer</th><th>PON</th><th>Discovery</th><th>TR-069</th><th>WiFi</th><th>Informs</th><th>Status</th></tr></thead>
      <tbody>
        ${onts
          .map(
            (item) => `
              <tr>
                <td>${item.serialNumber}</td>
                <td>${item.vendor || "-"}</td>
                <td>${oltMap[item.oltId]?.name || "-"}</td>
                <td>${customerMap[item.customerId]?.name || "-"}</td>
                <td>${item.ponPort || "-"}</td>
                <td><span class="badge ${item.discoveryStatus === "approved" ? "success" : "warning"}">${item.discoveryStatus || "-"}</span></td>
                <td><span class="badge ${item.tr069Enabled ? "success" : "warning"}">${item.tr069Enabled ? "ready" : "pending"}</span></td>
                <td>${item.wifiSsid || "-"}</td>
                <td>${item.informCount || 0}</td>
                <td><span class="badge ${badgeClass(item.status)}">${item.status}</span></td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderAcsTaskTable(items, onts) {
  const ontMap = Object.fromEntries(onts.map((item) => [item.id, item]));
  return `
    <table>
      <thead><tr><th>Task</th><th>Device</th><th>Status</th><th>Retries</th><th>Details</th><th>Created</th></tr></thead>
      <tbody>
        ${items
          .map(
            (item) => `
              <tr>
                <td>${item.taskType}</td>
                <td>${ontMap[item.ontId]?.serialNumber || "-"}</td>
                <td><span class="badge ${badgeClass(item.status)}">${item.status}</span></td>
                <td>${item.retryCount || 0}</td>
                <td>${item.resultMessage || "-"}</td>
                <td>${formatDate(item.createdAt)}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderAcsEventTable(items, onts) {
  const ontMap = Object.fromEntries(onts.map((item) => [item.id, item]));
  return `
    <table>
      <thead><tr><th>Event</th><th>Device</th><th>Status</th><th>Details</th><th>Time</th></tr></thead>
      <tbody>
        ${items
          .map(
            (item) => `
              <tr>
                <td>${item.eventType}</td>
                <td>${ontMap[item.ontId]?.serialNumber || item.serialNumber || "-"}</td>
                <td><span class="badge ${badgeClass(item.status)}">${item.status || "-"}</span></td>
                <td>${item.details || "-"}</td>
                <td>${formatDate(item.createdAt)}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderOperatorsAdminList(items) {
  if (!items.length) {
    return `<div class="empty-state">No business accounts created yet.</div>`;
  }

  return items
    .map((item) => {
      const selected = state.adminSelectedOperatorId === item.id;
      const adminEmail = item.users?.[0]?.email || "-";
      return `
        <button type="button" class="nav-item ${selected ? "active-nav" : ""} admin-operator-item" data-operator-id="${item.id}">
          <strong>${item.businessName}</strong>
          <span>${item.ownerName} | ${item.city || "-"}</span>
          <span>${item.plan} | ${item.subscriptionStatus}</span>
          <span>${adminEmail}</span>
        </button>
      `;
    })
    .join("");
}

async function loadAdminOperatorDetail(operatorId) {
  const response = await fetchJson(`/operators/${operatorId}`);
  state.adminSelectedOperatorId = operatorId;
  state.adminFormMode = "edit";
  state.data.selectedOperator = response.item;
  state.data.selectedOperatorSettings = response.settings;
  state.data.selectedOperatorMetrics = response.metrics;
  state.data.selectedOperatorAdmins = response.adminUsers || [];

  const formPanel = document.getElementById("adminFormPanel");
  if (formPanel) {
    formPanel.innerHTML = renderAdminFormPanel();
    attachAdminFormEvents();
  }

  const detail = document.getElementById("adminOperatorDetail");
  if (detail) {
    detail.innerHTML = renderAdminOperatorDetail();
    attachAdminDetailEvents();
  }

  const list = document.getElementById("operatorsList");
  if (list) {
    list.innerHTML = renderOperatorsAdminList(state.data.operators);
  }
}

function attachCommonEvents() {
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    try {
      await fetchJson("/auth/logout", { method: "POST" });
    } catch (_error) {
    }
    clearSession();
    renderLogin("Logged out successfully.");
  });

  document.getElementById("profileBtn").addEventListener("click", async () => {
    try {
      const profile = await fetchJson("/auth/me");
      showStatus(`Logged in as ${profile.user.name} (${profile.user.role})`, "success");
    } catch (_error) {
      showStatus("Profile refresh failed.", "error");
    }
  });

  document.getElementById("passwordBtn").addEventListener("click", async () => {
    const currentPassword = window.prompt("Current password");
    const newPassword = window.prompt("New password (min 8 characters)");
    if (!currentPassword || !newPassword) return;
    try {
      const response = await fetchJson("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      showStatus(response.message, "success");
    } catch (_error) {
      showStatus("Password change failed.", "error");
    }
  });
}

async function handleOperatorAction(action, id) {
  if (action === "quick-collect") {
    state.quickPayCustomerId = id;
    state.operatorView = "payments";
    renderOperatorNav();
    renderOperatorView();
    showStatus("Customer selected for payment collection.", "success");
    return;
  }

  if (action === "copy-customer-portal") {
    const customer = state.data.customers.find((item) => item.id === id);
    if (!customer) return;
    const portalLink = `${window.location.origin}${window.location.pathname}#customer-pay/${encodeURIComponent(customer.customerCode)}`;
    const shareText = `${portalLink}\nCustomer Portal ID: ${customer.customerCode}\nDefault Password: 123456`;
    try {
      await navigator.clipboard.writeText(shareText);
      showStatus("Customer portal link copied.");
    } catch {
      showStatus(shareText);
    }
    return;
  }

  if (action === "edit-customer") {
    const customer = state.data.customers.find((item) => item.id === id);
    if (!customer) return;
    const name = window.prompt("Customer name", customer.name);
    const mobile = window.prompt("Mobile", customer.mobile);
    const area = window.prompt("Area", customer.area || "");
    const dueAmount = window.prompt("Due amount", customer.dueAmount);
    if (!name || !mobile) return;
    await fetchJson(`/customers/${customer.id}`, {
      method: "PUT",
      body: JSON.stringify({ name, mobile, area, dueAmount: Number(dueAmount || 0) }),
    });
    await loadOperatorData();
    renderOperatorView();
    showStatus("Customer updated.");
    return;
  }

  if (action === "assign-package") {
    const customer = state.data.customers.find((item) => item.id === id);
    if (!customer) return;
    const packageId = window.prompt(
      `Package ID enter karo:\n${state.data.packages.map((pkg) => `${pkg.id} = ${pkg.name}`).join("\n")}`,
      customer.packageId || "",
    );
    if (!packageId) return;
    await fetchJson(`/customers/${customer.id}`, {
      method: "PUT",
      body: JSON.stringify({ packageId }),
    });
    await loadOperatorData();
    renderOperatorView();
    showStatus("Package assigned to customer.");
    return;
  }

  if (action === "delete-customer") {
    if (!window.confirm("Delete this customer?")) return;
    await fetchJson(`/customers/${id}`, { method: "DELETE" });
    await loadOperatorData();
    renderOperatorView();
    showStatus("Customer deleted.");
    return;
  }

  if (action === "edit-package") {
    const item = state.data.packages.find((pkg) => pkg.id === id);
    if (!item) return;
    const name = window.prompt("Package name", item.name);
    const price = window.prompt("Price", item.price);
    const validityDays = window.prompt("Validity days", item.validityDays);
    if (!name || !price) return;
    await fetchJson(`/packages/${item.id}`, {
      method: "PUT",
      body: JSON.stringify({ name, price: Number(price), validityDays: Number(validityDays || 30) }),
    });
    await loadOperatorData();
    renderOperatorView();
    showStatus("Package updated.");
    return;
  }

  if (action === "delete-package") {
    if (!window.confirm("Delete this package?")) return;
    try {
      await fetchJson(`/packages/${id}`, { method: "DELETE" });
      await loadOperatorData();
      renderOperatorView();
      showStatus("Package deleted.");
    } catch (_error) {
      showStatus("Package assigned hai, pehle customers reassign karo.", "error");
    }
    return;
  }

  if (action === "approve-payment-request") {
    await fetchJson(`/payments/requests/${id}/approve`, { method: "POST" });
    await loadOperatorData();
    renderOperatorView();
    showStatus("Customer payment approved and posted.");
    return;
  }

  if (action === "reject-payment-request") {
    if (!window.confirm("Reject this customer payment request?")) return;
    await fetchJson(`/payments/requests/${id}/reject`, { method: "POST" });
    await loadOperatorData();
    renderOperatorView();
    showStatus("Customer payment request rejected.");
  }
}

function attachOperatorSectionEvents() {
  const toggleCustomerForm = document.getElementById("toggleCustomerForm");
  if (toggleCustomerForm) {
    toggleCustomerForm.addEventListener("click", () => {
      state.customerFormOpen = !state.customerFormOpen;
      renderOperatorView();
    });
  }

  const dueStartFilter = document.getElementById("dueStartFilter");
  if (dueStartFilter) {
    dueStartFilter.addEventListener("change", (event) => {
      state.dashboardFilters.dueStart = event.currentTarget.value;
      renderOperatorView();
    });
  }

  const dueEndFilter = document.getElementById("dueEndFilter");
  if (dueEndFilter) {
    dueEndFilter.addEventListener("change", (event) => {
      state.dashboardFilters.dueEnd = event.currentTarget.value;
      renderOperatorView();
    });
  }

  const clearDueFilters = document.getElementById("clearDueFilters");
  if (clearDueFilters) {
    clearDueFilters.addEventListener("click", () => {
      state.dashboardFilters.dueStart = "";
      state.dashboardFilters.dueEnd = "";
      renderOperatorView();
    });
  }

  const customerForm = document.getElementById("customerForm");
  if (customerForm) {
    customerForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      await fetchJson("/customers", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(formData.entries())),
      });
      state.customerFormOpen = false;
      await loadOperatorData();
      renderOperatorView();
      showStatus("Customer added successfully.");
    });
  }

  const downloadCustomerTemplate = document.getElementById("downloadCustomerTemplate");
  if (downloadCustomerTemplate) {
    downloadCustomerTemplate.addEventListener("click", () => {
      const csv = "name,mobile,customerCode,area,packageName,dueAmount,dueDate,expiryDate,connectionType\nAmit Sharma,9876543210,CUS-1001,Palasia,Basic 50 Mbps,500,2026-05-20,2026-05-20,internet";
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "customer-import-sample.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
    });
  }

  const customerImportForm = document.getElementById("customerImportForm");
  if (customerImportForm) {
    customerImportForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fileInput = document.getElementById("customerImportFile");
      const modeInput = document.getElementById("customerImportMode");
      const file = fileInput?.files?.[0];
      if (!file) {
        showStatus("CSV file select karo.", "error");
        return;
      }

      try {
        const text = await file.text();
        const rows = mapImportRowsFromCsv(text);
        const preview = await fetchJson("/customers/import-preview", {
          method: "POST",
          body: JSON.stringify({ rows }),
        });
        state.customerImportPreview = { ...preview, rows };
        state.customerImportFileName = file.name;
        state.customerImportMode = modeInput?.value || "skip_duplicates";
        renderOperatorView();
        showStatus("Import preview ready. Review karke safe import chalao.");
      } catch (error) {
        showStatus(parseErrorMessage(error, "CSV preview ban nahi paya."), "error");
      }
    });
  }

  const confirmCustomerImport = document.getElementById("confirmCustomerImport");
  if (confirmCustomerImport) {
    confirmCustomerImport.addEventListener("click", async () => {
      if (!state.customerImportPreview?.rows?.length) {
        showStatus("Pehle preview chalao.", "error");
        return;
      }

      try {
        const response = await fetchJson("/customers/import", {
          method: "POST",
          body: JSON.stringify({
            rows: state.customerImportPreview.rows,
            mode: state.customerImportMode,
          }),
        });
        state.customerImportPreview = null;
        state.customerImportFileName = "";
        await loadOperatorData();
        renderOperatorView();
        showStatus(`Import done. Created: ${response.summary.created}, Updated: ${response.summary.updated}, Skipped: ${response.summary.skipped}`);
      } catch (error) {
        showStatus(parseErrorMessage(error, "Customer import fail ho gaya."), "error");
      }
    });
  }

  const clearCustomerImport = document.getElementById("clearCustomerImport");
  if (clearCustomerImport) {
    clearCustomerImport.addEventListener("click", () => {
      state.customerImportPreview = null;
      state.customerImportFileName = "";
      renderOperatorView();
    });
  }

  const packageForm = document.getElementById("packageForm");
  if (packageForm) {
    packageForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      await fetchJson("/packages", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(formData.entries())),
      });
      await loadOperatorData();
      renderOperatorView();
      showStatus("Package saved successfully.");
    });
  }

  const paymentForm = document.getElementById("paymentForm");
  if (paymentForm) {
    paymentForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      await fetchJson("/payments/collect", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(formData.entries())),
      });
      state.quickPayCustomerId = "";
      await loadOperatorData();
      renderOperatorView();
      showStatus("Payment collected successfully.");
    });
  }

  const copyCustomerPaymentLink = document.getElementById("copyCustomerPaymentLink");
  if (copyCustomerPaymentLink) {
    copyCustomerPaymentLink.addEventListener("click", async () => {
      const session = getSession();
      const paymentLink = `${window.location.origin}${window.location.pathname}#customer-pay`;
      const shareText = `${paymentLink}\nOperator Code: ${session?.tenant?.code || ""}`;
      try {
        await navigator.clipboard.writeText(shareText);
        showStatus("Customer payment link copied.");
      } catch {
        showStatus(`Customer payment link: ${shareText}`);
      }
    });
  }

  const rechargeForm = document.getElementById("rechargeForm");
  if (rechargeForm) {
    rechargeForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      await fetchJson("/recharges", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(formData.entries())),
      });
      await loadOperatorData();
      renderOperatorView();
      showStatus("Recharge created successfully.");
    });
  }

  const staffForm = document.getElementById("staffForm");
  if (staffForm) {
    staffForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      await fetchJson("/staff", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(formData.entries())),
      });
      await loadOperatorData();
      renderOperatorView();
      showStatus("Staff member added.");
    });
  }

  const expenseForm = document.getElementById("expenseForm");
  if (expenseForm) {
    expenseForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      await fetchJson("/expenses", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(formData.entries())),
      });
      await loadOperatorData();
      renderOperatorView();
      showStatus("Expense saved.");
    });
  }

  const oltForm = document.getElementById("oltForm");
  if (oltForm) {
    oltForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      await fetchJson("/olts", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(formData.entries())),
      });
      await loadOperatorData();
      renderOperatorView();
      showStatus("OLT added successfully.");
    });
  }

  const ontForm = document.getElementById("ontForm");
  if (ontForm) {
    ontForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const payload = Object.fromEntries(formData.entries());
      payload.tr069Enabled = payload.tr069Enabled === "true";
      await fetchJson("/onts", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await loadOperatorData();
      renderOperatorView();
      showStatus("ONT added successfully.");
    });
  }

  const wifiTaskForm = document.getElementById("wifiTaskForm");
  if (wifiTaskForm) {
    wifiTaskForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      await fetchJson("/acs/tasks/wifi", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(formData.entries())),
      });
      await loadOperatorData();
      renderOperatorView();
      showStatus("WiFi update task queued.");
    });
  }

  const settingsForm = document.getElementById("settingsForm");
  if (settingsForm) {
    settingsForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      await fetchJson("/settings", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(formData.entries())),
      });
      await loadOperatorData();
      renderOperatorView();
      showStatus("Settings saved.");
    });
  }

}

function attachAdminDetailEvents() {
  const editBtn = document.getElementById("editOperatorInFormBtn");
  if (editBtn) {
    editBtn.addEventListener("click", () => {
      state.adminFormMode = "edit";
      const formPanel = document.getElementById("adminFormPanel");
      if (formPanel) {
        formPanel.innerHTML = renderAdminFormPanel();
        attachAdminFormEvents();
      }
      showStatus("Selected account loaded in edit form.");
    });
  }

  const operatorManageForm = document.getElementById("operatorManageForm");
  if (operatorManageForm) {
    operatorManageForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      await fetchJson(`/operators/${state.adminSelectedOperatorId}`, {
        method: "PATCH",
        body: JSON.stringify(Object.fromEntries(formData.entries())),
      });
      await loadPlatformOwnerData();
      await loadAdminOperatorDetail(state.adminSelectedOperatorId);
      showStatus("Business account updated successfully.");
    });
  }

  const resetBtn = document.getElementById("resetOperatorPasswordBtn");
  if (resetBtn) {
    resetBtn.addEventListener("click", async () => {
      const newPassword = window.prompt("New password (leave blank to auto-generate)");
      const response = await fetchJson(`/operators/${state.adminSelectedOperatorId}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ newPassword }),
      });
      showStatus(`Password reset. Login: ${response.login.email} / ${response.login.password}`);
    });
  }

  const toggleBtn = document.getElementById("toggleOperatorStatusBtn");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", async () => {
      const current = state.data.selectedOperator?.subscriptionStatus;
      const next = current === "suspended" ? "active" : "suspended";
      await fetchJson(`/operators/${state.adminSelectedOperatorId}`, {
        method: "PATCH",
        body: JSON.stringify({ subscriptionStatus: next }),
      });
      await loadPlatformOwnerData();
      await loadAdminOperatorDetail(state.adminSelectedOperatorId);
      showStatus(`Account ${next === "active" ? "activated" : "suspended"} successfully.`);
    });
  }
}

document.addEventListener("click", async (event) => {
  const adminOperatorButton = event.target.closest(".admin-operator-item[data-operator-id]");
  if (adminOperatorButton) {
    await loadAdminOperatorDetail(adminOperatorButton.dataset.operatorId);
    return;
  }

  const navButton = event.target.closest("#operatorNav [data-view]");
  if (navButton) {
    state.operatorView = navButton.dataset.view;
    renderOperatorNav();
    renderOperatorView();
    return;
  }

  const actionButton = event.target.closest(".action-btn[data-action]");
  if (actionButton) {
    await handleOperatorAction(actionButton.dataset.action, actionButton.dataset.id);
  }
});

function renderAppShell() {
  const session = getSession();
  if (session.user.role === "platform_owner") {
    renderAdminShell(session.user);
  } else {
    renderOperatorShell(session.user, session.tenant);
  }
}

async function loadPlatformOwnerData() {
  const [overviewResponse, operatorsResponse] = await Promise.all([
    fetchJson("/blueprint/overview"),
    fetchJson("/operators"),
  ]);

  state.data.operators = operatorsResponse.items;
  const list = document.getElementById("operatorsList");
  if (list) {
    list.innerHTML = renderOperatorsAdminList(operatorsResponse.items);
  }

  if (!state.adminSelectedOperatorId && operatorsResponse.items[0]?.id) {
    await loadAdminOperatorDetail(operatorsResponse.items[0].id);
  } else if (state.adminSelectedOperatorId) {
    await loadAdminOperatorDetail(state.adminSelectedOperatorId);
  }
}

async function loadOperatorData() {
  const [operators, customers, packages, payments, paymentRequests, recharges, reports, staff, expenses, olts, onts, acsTasks, acsEvents, settings] =
    await Promise.all([
      fetchJson("/operators"),
      fetchJson("/customers"),
      fetchJson("/packages"),
      fetchJson("/payments"),
      fetchJson("/payments/requests"),
      fetchJson("/recharges"),
      fetchJson("/reports"),
      fetchJson("/staff"),
      fetchJson("/expenses"),
      fetchJson("/olts"),
      fetchJson("/onts"),
      fetchJson("/acs/tasks"),
      fetchJson("/acs/events"),
      fetchJson("/settings"),
    ]);

  state.data.operators = operators.items;
  state.data.customers = customers.items;
  state.data.packages = packages.items;
  state.data.payments = payments.items;
  state.data.paymentRequests = paymentRequests.items;
  state.data.recharges = recharges.items;
  state.data.reports = reports.items;
  state.data.staff = staff.items;
  state.data.expenses = expenses.items;
  state.data.olts = olts.items;
  state.data.onts = onts.items;
  state.data.acsTasks = acsTasks.items;
  state.data.acsEvents = acsEvents.items;
  state.data.settings = settings.item;
  updateWorkspaceBrand();
}

async function hydrateDashboard() {
  const session = getSession();
  if (session.user.role === "platform_owner") {
    await loadPlatformOwnerData();
    showStatus("Workspace loaded.");
    return;
  }

  await loadOperatorData();
  renderOperatorView();
  showStatus("Workspace loaded.");
}

if (getSession()?.token) {
  if (isCustomerPortalMode()) {
    renderPublicCustomerPaymentPortal();
  } else {
    renderAppShell();
    hydrateDashboard().catch(() => {
      clearSession();
      renderLogin("Session invalid. Please log in again.");
    });
  }
} else {
  if (isCustomerPortalMode()) renderPublicCustomerPaymentPortal();
  else renderLogin();
}

window.addEventListener("hashchange", () => {
  if (isCustomerPortalMode()) {
    renderPublicCustomerPaymentPortal();
    return;
  }

  const session = getSession();
  if (session?.token) {
    renderAppShell();
    hydrateDashboard().catch(() => {
      clearSession();
      renderLogin("Session invalid. Please log in again.");
    });
  } else {
    renderLogin();
  }
});
