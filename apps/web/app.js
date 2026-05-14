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
  { key: "mapping", title: "Mapping", description: "Fiber routes and field survey" },
  { key: "network", title: "Network", description: "OLT, ONT and ACS tasks" },
  { key: "monitoring", title: "Monitoring", description: "Live device health and risk engine" },
  { key: "edge", title: "Edge Agent", description: "VPN-side local network access" },
  { key: "settings", title: "Settings", description: "Brand and billing rules" },
];

const state = {
  adminSelectedOperatorId: "",
  adminFormMode: "create",
  operatorView: "dashboard",
  operatorCustomerSearch: "",
  mapDrawMode: false,
  mapDraftPoints: [],
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
    monitoredDevices: [],
    deviceAlerts: [],
    monitoringSummary: null,
    edgeAgents: [],
    edgeTasks: [],
    edgeSummary: null,
    networkNodes: [],
    fiberRoutes: [],
    mapInsights: null,
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

function buildUpiPaymentLink({ upiId = "", displayName = "", amount = 0, note = "" }) {
  const pa = String(upiId || "").trim();
  if (!pa) return "";
  const params = new URLSearchParams({
    pa,
    pn: String(displayName || "Operator Payment").trim(),
    am: String(Number(amount || 0)),
    cu: "INR",
    tn: String(note || "CableOps customer payment").trim(),
  });
  return `upi://pay?${params.toString()}`;
}

async function copyText(text) {
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "readonly");
  input.style.position = "absolute";
  input.style.left = "-9999px";
  document.body.appendChild(input);
  input.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(input);
  return ok;
}

function parseRoutePoints(pathJson = "") {
  try {
    const parsed = JSON.parse(pathJson || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Photo read fail ho gaya."));
    reader.readAsDataURL(file);
  });
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
  const upiLink = lookup
    ? buildUpiPaymentLink({
        upiId: lookup.operator.upiId,
        displayName: lookup.operator.paymentDisplayName || lookup.operator.businessName,
        amount: lookup.customer.dueAmount || 0,
        note: `${lookup.customer.portalId} payment`,
      })
    : "";
  appRoot.innerHTML = `
    <div class="customer-shell">
      <div class="customer-page">
        <section class="customer-hero ${lookup ? "customer-hero-authenticated" : ""}">
          <div class="customer-hero-copy">
            <p class="eyebrow">Customer Portal</p>
            <h1>${lookup ? `Welcome back, ${escapeHtml(lookup.customer.name)}.` : "Professional self-service billing and payment access."}</h1>
            <p class="lede">
              ${lookup
                ? "Apna package, due, payment history aur submitted payment requests ek hi jagah clearly manage karo."
                : "Customer ID se login karo, apna current plan dekho, due check karo aur QR payment confirmation submit karo."}
            </p>
          </div>
          ${lookup
            ? `
              <div class="customer-hero-card customer-access-card">
                <p class="eyebrow">Portal Access</p>
                ${message ? `<div class="feedback ${messageType}">${message}</div>` : ""}
                <div class="customer-access-details">
                  <div>
                    <span>Portal ID</span>
                    <strong>${escapeHtml(lookup.customer.portalId)}</strong>
                  </div>
                  <div>
                    <span>Operator</span>
                    <strong>${escapeHtml(lookup.operator.paymentDisplayName || lookup.operator.businessName)}</strong>
                  </div>
                </div>
                <div class="toolbar">
                  <button id="customerLogoutBtn" class="ghost-btn" type="button">Logout</button>
                </div>
              </div>
            `
            : `
              <div class="customer-hero-card">
                <p class="eyebrow">Secure Access</p>
                <h3>Portal Login</h3>
                ${message ? `<div class="feedback ${messageType}">${message}</div>` : ""}
                <form id="publicPaymentLookupForm" class="form-grid">
                  <label>Customer Portal ID<input name="customerId" value="${escapeHtml(portalCustomerId || state.publicPayment.customerRef)}" placeholder="Unique customer portal ID" required /></label>
                  <label>Password<input name="password" type="password" value="${escapeHtml(state.publicPayment.password || "123456")}" placeholder="Default password" required /></label>
                  <button class="primary-btn" type="submit">Login to Customer Portal</button>
                </form>
                <div class="toolbar">
                  <button id="backToLoginBtn" class="ghost-btn" type="button">Back to Login</button>
                </div>
              </div>
            `}
        </section>

        ${lookup ? `
          <section class="customer-identity">
            <div>
              <p class="eyebrow">Account Summary</p>
              <h2>${escapeHtml(lookup.customer.name)}</h2>
              <p class="customer-meta-line">${escapeHtml(lookup.operator.paymentDisplayName || lookup.operator.businessName)} | ${escapeHtml(lookup.customer.mobile)} | Portal ID ${escapeHtml(lookup.customer.portalId)}</p>
            </div>
            <div class="customer-status-cluster">
              <span class="badge ${badgeClass(lookup.customer.status)}">${escapeHtml(lookup.customer.status || "-")}</span>
              <strong>${formatMoney(lookup.customer.dueAmount || 0)}</strong>
              <span class="subtle-note">Current due</span>
            </div>
          </section>

          <section class="customer-kpis">
            <article class="customer-stat-card">
              <span>Package</span>
              <strong>${escapeHtml(lookup.customer.packageName || "-")}</strong>
              <p>${escapeHtml(lookup.customer.connectionType || "-")}</p>
            </article>
            <article class="customer-stat-card">
              <span>Due Date</span>
              <strong>${escapeHtml(formatDate(lookup.customer.dueDate))}</strong>
              <p>Billing reminder date</p>
            </article>
            <article class="customer-stat-card">
              <span>Expiry</span>
              <strong>${escapeHtml(formatDate(lookup.customer.expiryDate))}</strong>
              <p>Current service validity</p>
            </article>
            <article class="customer-stat-card">
              <span>Support</span>
              <strong>${escapeHtml(lookup.operator.supportMobile || "-")}</strong>
              <p>Operator helpline</p>
            </article>
          </section>

          <section class="customer-content-grid">
            <article class="customer-panel payment-panel">
              <div class="customer-panel-head">
                <div>
                  <p class="eyebrow">QR Payment</p>
                  <h3>Pay and submit confirmation</h3>
                </div>
              </div>
              <div class="customer-payment-grid">
                <div class="customer-qr-block">
                  ${lookup.operator.qrImageUrl
                    ? `<img class="qr-preview premium-qr" src="${escapeHtml(lookup.operator.qrImageUrl)}" alt="Operator QR" />`
                    : `<div class="empty-state">QR image abhi set nahi hai. UPI ID: <strong>${escapeHtml(lookup.operator.upiId || "-")}</strong></div>`}
                  <div class="customer-upi-card">
                    <span>UPI ID</span>
                    <strong>${escapeHtml(lookup.operator.upiId || "-")}</strong>
                  </div>
                  <div class="customer-upi-card">
                    <span>Amount to pay</span>
                    <strong>${formatMoney(lookup.customer.dueAmount || 0)}</strong>
                  </div>
                </div>
                <div class="customer-payment-form-wrap">
                  <p class="subtle-note">${escapeHtml(lookup.operator.qrInstructions || "QR scan karke payment karein, phir UTR submit karein.")}</p>
                  <div class="customer-payment-actions">
                    ${upiLink
                      ? `<a class="primary-btn customer-pay-now-btn" id="customerPayNowBtn" href="${escapeHtml(upiLink)}">Pay via UPI App</a>`
                      : `<div class="empty-state">Operator ne abhi UPI ID set nahi ki hai.</div>`}
                    ${lookup.operator.upiId
                      ? `<button class="ghost-btn customer-copy-upi-btn" id="customerCopyUpiBtn" type="button">Copy UPI ID</button>`
                      : ""}
                    <span class="subtle-note">Mobile me supported UPI app direct open ho sakti hai. Payment ke baad niche confirmation submit karein.</span>
                  </div>
                  <form id="publicPaymentSubmitForm" class="form-grid">
                    <input type="hidden" name="customerId" value="${escapeHtml(lookup.customer.portalId)}" />
                    <label>Amount Paid<input name="amount" type="number" value="${lookup.customer.dueAmount || ""}" readonly required /></label>
                    <label>UTR / Transaction Ref<input name="utrNumber" placeholder="Optional but recommended" /></label>
                    <label>Note<input name="note" placeholder="Screenshot ya note reference" /></label>
                    <button class="primary-btn" type="submit">Submit Payment Confirmation</button>
                  </form>
                </div>
              </div>
            </article>

            <article class="customer-panel">
              <div class="customer-panel-head">
                <div>
                  <p class="eyebrow">Recent Payments</p>
                  <h3>Posted payment history</h3>
                </div>
              </div>
              <div class="customer-history-list">
                ${(lookup.payments || []).length
                  ? (lookup.payments || []).map((item) => `
                    <article class="customer-history-card">
                      <div>
                        <strong>${escapeHtml(formatDate(item.paymentDate))}</strong>
                        <p>${escapeHtml(item.receiptNumber || "-")}</p>
                      </div>
                      <div class="customer-history-value">
                        <strong>${formatMoney(item.amountPaid)}</strong>
                        <span class="badge ${badgeClass(item.status)}">${escapeHtml(item.status)}</span>
                      </div>
                    </article>
                  `).join("")
                  : `<div class="empty-state">No payment history yet.</div>`}
              </div>
            </article>

            <article class="customer-panel">
              <div class="customer-panel-head">
                <div>
                  <p class="eyebrow">Submitted Requests</p>
                  <h3>Pending and approved confirmations</h3>
                </div>
              </div>
              <div class="customer-history-list">
                ${(lookup.paymentRequests || []).length
                  ? (lookup.paymentRequests || []).map((item) => `
                    <article class="customer-history-card">
                      <div>
                        <strong>${escapeHtml(formatDate(item.paidAt || item.createdAt))}</strong>
                        <p>${escapeHtml(item.utrNumber || "No UTR")}</p>
                      </div>
                      <div class="customer-history-value">
                        <strong>${formatMoney(item.amount)}</strong>
                        <span class="badge ${badgeClass(item.status)}">${escapeHtml(item.status)}</span>
                      </div>
                    </article>
                  `).join("")
                  : `<div class="empty-state">No payment requests yet.</div>`}
              </div>
            </article>
          </section>
        ` : ""}
      </div>
    </div>
  `;

  const publicPaymentLookupForm = document.getElementById("publicPaymentLookupForm");
  if (publicPaymentLookupForm) {
    publicPaymentLookupForm.addEventListener("submit", async (event) => {
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
  }

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

    const customerCopyUpiBtn = document.getElementById("customerCopyUpiBtn");
    if (customerCopyUpiBtn) {
      customerCopyUpiBtn.addEventListener("click", async () => {
        try {
          await copyText(lookup.operator.upiId);
          renderPublicCustomerPaymentPortal("UPI ID copy ho gayi.", "success");
        } catch (error) {
          renderPublicCustomerPaymentPortal(parseErrorMessage(error, "UPI ID copy nahi hui."), "error");
        }
      });
    }

    const backToLoginBtn = document.getElementById("backToLoginBtn");
    if (backToLoginBtn) {
      backToLoginBtn.addEventListener("click", () => {
      state.publicPayment.lookup = null;
      state.publicPayment.customerRef = "";
      state.publicPayment.password = "123456";
      window.location.hash = "";
      renderLogin();
    });
  }

  const customerLogoutBtn = document.getElementById("customerLogoutBtn");
  if (customerLogoutBtn) {
    customerLogoutBtn.addEventListener("click", () => {
      state.publicPayment.lookup = null;
      state.publicPayment.password = "123456";
      renderPublicCustomerPaymentPortal();
    });
  }
}

function renderAdminShell(user) {
  const operatorCount = state.data.operators?.length || 0;
  const activeCount = state.data.operators?.filter((item) => item.subscriptionStatus === "active").length || 0;
  const selectedPlan = state.data.selectedOperator?.plan || "Owner Workspace";
  const selectedStatus = state.data.selectedOperator?.subscriptionStatus || "live";
  appRoot.innerHTML = `
      <div class="page-shell admin-shell">
        <div class="topbar admin-topbar">
          <div>
            <p class="eyebrow">CableOps</p>
            <h2>Owner Console</h2>
            <div class="topbar-meta">${user.name} | ${user.email}</div>
          </div>
          <div class="inline-actions">
            <button id="profileBtn" class="ghost-btn">Refresh Profile</button>
            <button id="passwordBtn" class="ghost-btn">Change Password</button>
            <button id="logoutBtn" class="primary-btn">Logout</button>
          </div>
        </div>
  
        <header class="hero admin-hero">
          <div class="hero-copy admin-hero-copy">
            <p class="eyebrow">Platform Command</p>
            <h1>Run operator onboarding, access control and commercial oversight from one premium control layer.</h1>
            <p class="lede">
              Create business accounts, tune plans, watch account health and operate the full SaaS with a cleaner executive view.
            </p>
          </div>
          <div class="admin-hero-metrics">
            <article class="admin-metric-card">
              <span>Accounts Live</span>
              <strong>${operatorCount}</strong>
              <p>${activeCount} active businesses under management</p>
            </article>
            <article class="admin-metric-card admin-metric-card-dark">
              <span>Focused Plan</span>
              <strong>${escapeHtml(selectedPlan)}</strong>
              <p>Current account status: ${escapeHtml(selectedStatus)}</p>
            </article>
          </div>
        </header>
  
        <main class="content-grid admin-content-grid">
          <section id="adminFormPanel" class="panel admin-form-panel">${renderAdminFormPanel()}</section>
  
          <section class="split-grid admin-grid premium-admin-grid">
            <article class="panel admin-list-panel">
              <div class="section-head">
                <div>
                  <p class="eyebrow">Portfolio</p>
                  <h2>Business Accounts</h2>
                </div>
              </div>
              <div id="operatorsList" class="stack-list"></div>
            </article>
  
            <article class="panel admin-detail-panel">
              <div class="section-head">
                <div>
                  <p class="eyebrow">Account Control</p>
                  <h2>Management Deck</h2>
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
      <div class="section-head admin-panel-head">
        <div>
          <p class="eyebrow">Account Studio</p>
          <h2>${isEdit ? "Edit Business Account" : "Create Business Account"}</h2>
          <p class="admin-panel-subtle">${isEdit ? "Tune access, plan, support and operator business identity from one surface." : "Launch a new operator account with clean onboarding and isolated access."}</p>
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
      <form id="operatorCreateForm" class="form-grid two-col-grid admin-form-grid">
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
        <div class="form-actions admin-form-actions"><button class="primary-btn" type="submit">${isEdit ? "Save Account Changes" : "Create Account"}</button></div>
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
    return `
      <div class="admin-empty-state">
        <p class="eyebrow">No Account Selected</p>
        <h3>Choose a business from the left portfolio.</h3>
        <p>Once selected, you can manage plan, access, password resets, support identity and subscription status from this deck.</p>
      </div>
    `;
  }

function renderAdminOperatorDetail() {
  const item = state.data.selectedOperator;
  const settings = state.data.selectedOperatorSettings;
  const metrics = state.data.selectedOperatorMetrics;
  const adminUser = state.data.selectedOperatorAdmins?.[0];

  if (!item) return renderAdminEmptyState();

  return `
      <div class="menu-grid admin-summary-grid">
        <article class="menu-card admin-summary-card"><h3>Plan</h3><p>${item.plan}</p><span>Subscription status: ${item.subscriptionStatus}</span></article>
        <article class="menu-card admin-summary-card"><h3>Customers</h3><p>${metrics?.activeCustomers || 0}</p><span>Pending due: ${formatMoney(metrics?.pendingCollections || 0)}</span></article>
        <article class="menu-card admin-summary-card"><h3>Collection</h3><p>${formatMoney(metrics?.totalCollection || 0)}</p><span>Monthly counter: ${formatMoney(metrics?.monthCollection || 0)}</span></article>
        <article class="menu-card admin-summary-card admin-summary-card-dark"><h3>Login</h3><p>${adminUser?.email || "-"}</p><span>${adminUser?.name || "No admin mapped"}</span></article>
      </div>
  
      <form id="operatorManageForm" class="form-grid two-col-grid admin-manage-form">
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

      <div class="toolbar admin-detail-toolbar">
        <button type="button" id="editOperatorInFormBtn" class="ghost-btn">Edit In Form</button>
        <button type="button" id="resetOperatorPasswordBtn" class="ghost-btn">Reset Operator Password</button>
        <button type="button" id="toggleOperatorStatusBtn" class="ghost-btn">${item.subscriptionStatus === "suspended" ? "Activate Account" : "Suspend Account"}</button>
      </div>
    `;
}

function renderOperatorShell(user, tenant) {
  const brandName = state.data.settings?.companyName || tenant?.businessName || "Workspace";
  appRoot.innerHTML = `
    <div class="page-shell operator-shell">
      <div class="topbar operator-topbar">
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
            <p class="sidebar-note">Customers, collections, network and service operations ko faster control me rakho.</p>
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

function renderOperatorWorkspaceHero(data, metrics, settings) {
  const session = getSession();
  const brandName = settings?.companyName || session?.tenant?.businessName || "Workspace";
  const ownerLine = [session?.user?.name, settings?.supportMobile || session?.tenant?.mobile || "Support not set"]
    .filter(Boolean)
    .join(" | ");

  return `
    <section class="hero operator-hero">
      <div class="hero-copy operator-hero-copy">
        <p class="eyebrow">Operations Hub</p>
        <h1>${escapeHtml(brandName)}</h1>
        <p class="lede">
          Collections, due recovery, customer lifecycle, recharge flow, network visibility and operator-side business controls ek hi polished workspace me.
        </p>
        <div class="operator-hero-subline">${escapeHtml(ownerLine)}</div>
        <div class="operator-quick-actions">
          <button type="button" class="primary-btn jump-view-btn" data-jump-view="customers">Add Customer</button>
          <button type="button" class="ghost-btn jump-view-btn" data-jump-view="payments">Collect Payment</button>
          <button type="button" class="ghost-btn jump-view-btn" data-jump-view="recharge">Recharge</button>
          <button type="button" class="ghost-btn jump-view-btn" data-jump-view="settings">Payment Setup</button>
        </div>
      </div>
      <div class="operator-hero-metrics">
        <article class="operator-premium-metric">
          <span>Today</span>
          <strong>${formatMoney(metrics.todayCollections)}</strong>
          <p>Fresh collections posted today</p>
        </article>
        <article class="operator-premium-metric operator-premium-metric-dark">
          <span>Pending Due</span>
          <strong>${formatMoney(metrics.pendingTotal)}</strong>
          <p>${metrics.dueCustomersCount} customers pending</p>
        </article>
        <article class="operator-premium-metric">
          <span>Approvals</span>
          <strong>${metrics.pendingRequests}</strong>
          <p>Customer payment confirmations waiting</p>
        </article>
        <article class="operator-premium-metric">
          <span>Network</span>
          <strong>${metrics.onlineOnts}</strong>
          <p>Online ONTs visible in live inventory</p>
        </article>
      </div>
    </section>
  `;
}

function renderMapInsightCards(insights) {
  const counters = insights?.counters || {};
  return `
    <div class="menu-grid operator-mini-grid">
      <article class="menu-card operator-mini-card"><h3>Nodes</h3><p>${counters.totalNodes || 0}</p><span>OLT, splitter, joint, customer endpoints</span></article>
      <article class="menu-card operator-mini-card"><h3>Routes</h3><p>${counters.totalRoutes || 0}</p><span>Mapped feeder and drop lines</span></article>
      <article class="menu-card operator-mini-card"><h3>Splitters</h3><p>${counters.splitters || 0}</p><span>Visible splitter and FD ecosystem</span></article>
      <article class="menu-card operator-mini-card"><h3>Unmapped</h3><p>${counters.unmappedCustomers || 0}</p><span>Customers without physical endpoint map</span></article>
    </div>
  `;
}

function renderSmartMappingNotes(insights) {
  const suggestions = insights?.suggestions || [];
  if (!suggestions.length) {
    return `<div class="empty-state">Map insights abhi generate nahi hui.</div>`;
  }

  return `
    <div class="stack-list">
      ${suggestions.map((item) => `
        <article class="stack-card smart-note-card">
          <div>
            <strong>Smart Insight</strong>
            <p>${escapeHtml(item)}</p>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderNetworkNodeTable(items, customers = []) {
  const customerMap = Object.fromEntries(customers.map((item) => [item.id, item]));
  if (!items.length) {
    return `<div class="empty-state">Abhi tak koi map node create nahi hua.</div>`;
  }

  return `
    <table>
      <thead><tr><th>Name</th><th>Type</th><th>Linked Customer</th><th>Coordinates</th><th>Meta</th><th>Action</th></tr></thead>
      <tbody>
        ${items.map((item) => `
          <tr>
            <td>${escapeHtml(item.name)}</td>
            <td><span class="badge ${badgeClass(item.status)}">${escapeHtml(item.type)}</span></td>
            <td>${escapeHtml(customerMap[item.relatedCustomerId]?.name || "-")}</td>
            <td>${Number(item.latitude).toFixed(5)}, ${Number(item.longitude).toFixed(5)}</td>
            <td>${escapeHtml(item.splitterRatio || item.colorCode || item.note || "-")}</td>
            <td><button class="ghost-btn action-btn" data-action="delete-map-node" data-id="${item.id}">Delete</button></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderFiberRouteTable(items) {
  if (!items.length) {
    return `<div class="empty-state">Abhi tak koi fiber route draw nahi hua.</div>`;
  }

  return `
    <table>
      <thead><tr><th>Name</th><th>Type</th><th>Cores</th><th>Length</th><th>Color</th><th>Action</th></tr></thead>
      <tbody>
        ${items.map((item) => `
          <tr>
            <td>${escapeHtml(item.name)}</td>
            <td>${escapeHtml(item.routeType)}</td>
            <td>${item.coreCount || 0}</td>
            <td>${Math.round(item.lengthMeters || 0)} m</td>
            <td>${escapeHtml(item.colorCode || item.cableType || "-")}</td>
            <td><button class="ghost-btn action-btn" data-action="delete-map-route" data-id="${item.id}">Delete</button></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderMappingView(data, metrics) {
  const insights = data.mapInsights || {};
  return `
    <section class="panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">Fiber Mapping</p>
          <h2>Operator Survey Map</h2>
          <p class="subtle-note">Har operator ka apna isolated network map. Nodes, splitters, fiber routes aur customer endpoints ko map par save karo.</p>
        </div>
      </div>
      ${renderMapInsightCards(insights)}
      <div class="mapping-map-wrap mapping-map-wrap-full">
        <div id="networkMapCanvas" class="network-map-canvas network-map-canvas-large"></div>
        <div class="mapping-draft-bar">
          <strong>Route Draft:</strong>
          <span>${state.mapDraftPoints.length} points</span>
          <button type="button" id="startRouteDrawingBtn" class="ghost-btn">${state.mapDrawMode ? "Drawing Active" : "Start Route Drawing"}</button>
          <button type="button" id="clearRouteDraftBtn" class="ghost-btn">Clear Draft</button>
        </div>
      </div>
    </section>
    <section class="mapping-detail-layout">
      <div class="mapping-detail-main">
        <section class="split-grid dashboard-split">
          <article class="panel">
            <div class="section-head"><div><p class="eyebrow">Smart Notes</p><h2>Free Smart Suggestions</h2></div></div>
            ${renderSmartMappingNotes(insights)}
          </article>
          <article class="panel">
            <div class="section-head"><div><p class="eyebrow">Coverage Gaps</p><h2>Unmapped Customers</h2></div></div>
            <div class="stack-list">
              ${(insights.unmappedCustomers || []).length
                ? insights.unmappedCustomers.map((item) => `
                  <article class="stack-card">
                    <div>
                      <strong>${escapeHtml(item.name)}</strong>
                      <p>${escapeHtml(item.customerCode)} | ${escapeHtml(item.mobile)}</p>
                    </div>
                    <div>
                      <strong>${escapeHtml(item.area || "-")}</strong>
                      <p>Need endpoint survey</p>
                    </div>
                  </article>
                `).join("")
                : `<div class="empty-state">All visible customers ka map endpoint linked lag raha hai.</div>`}
            </div>
          </article>
        </section>
        <section class="panel">
          <div class="section-head"><div><p class="eyebrow">Mapped Nodes</p><h2>Node Registry</h2></div></div>
          ${tableWrapper(renderNetworkNodeTable(data.networkNodes, data.customers))}
        </section>
        <section class="panel">
          <div class="section-head"><div><p class="eyebrow">Fiber Routes</p><h2>Route Registry</h2></div></div>
          ${tableWrapper(renderFiberRouteTable(data.fiberRoutes))}
        </section>
      </div>
      <aside class="mapping-side-panels">
        <div class="inline-form-block mapping-form-card">
          <div class="section-head">
            <div>
              <p class="eyebrow">Node Survey</p>
              <h3>Add Map Node</h3>
            </div>
          </div>
          <form id="mapNodeForm" class="form-grid">
            <label>Node Type
              <select name="type">
                <option value="olt">OLT</option>
                <option value="fd_box">FD Box</option>
                <option value="splitter">Splitter</option>
                <option value="joint">Joint</option>
                <option value="pole">Pole</option>
                <option value="customer_endpoint">Customer Endpoint</option>
              </select>
            </label>
            <label>Name<input name="name" required /></label>
            <label>Linked Customer
              <select name="relatedCustomerId">
                <option value="">No customer mapping</option>
                ${renderCustomerOptions(data.customers)}
              </select>
            </label>
            <label>Parent Splitter / Node
              <select name="parentNodeId">
                <option value="">No parent</option>
                ${data.networkNodes.map((item) => `<option value="${item.id}">${escapeHtml(item.name)} | ${escapeHtml(item.type)}</option>`).join("")}
              </select>
            </label>
            <label>Latitude<input id="mapNodeLat" name="latitude" type="number" step="any" required /></label>
            <label>Longitude<input id="mapNodeLng" name="longitude" type="number" step="any" required /></label>
            <label>Fiber Core Count<input name="fiberCoreCount" type="number" /></label>
            <label>Splitter Ratio<input name="splitterRatio" placeholder="1:8 / 1:16 / 1:32" /></label>
            <label>Capacity<input name="capacity" type="number" /></label>
            <label>Color / Core Code<input name="colorCode" placeholder="Red core / Orange route" /></label>
            <label>Photo<input id="mapNodePhoto" type="file" accept="image/*" capture="environment" /></label>
            <label>Note<input name="note" placeholder="Pole no, cabinet note, route detail" /></label>
            <div class="toolbar">
              <button type="button" id="useCurrentLocationBtn" class="ghost-btn">Use Current Location</button>
              <button class="primary-btn" type="submit">Save Node</button>
            </div>
          </form>
        </div>
        <div class="inline-form-block mapping-form-card">
          <div class="section-head">
            <div>
              <p class="eyebrow">Route Survey</p>
              <h3>Save Fiber Route</h3>
            </div>
          </div>
          <form id="fiberRouteForm" class="form-grid">
            <label>Route Name<input name="name" required /></label>
            <label>Route Type
              <select name="routeType">
                <option value="feeder">Feeder</option>
                <option value="distribution">Distribution</option>
                <option value="drop">Customer Drop</option>
              </select>
            </label>
            <label>Core Count<input name="coreCount" type="number" /></label>
            <label>Cable Type<input name="cableType" placeholder="Aerial / Underground / ADSS" /></label>
            <label>Color Code<input name="colorCode" placeholder="24 core red / yellow sheath" /></label>
            <label>Start Node
              <select name="startNodeId">
                <option value="">No start node</option>
                ${data.networkNodes.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}
              </select>
            </label>
            <label>End Node
              <select name="endNodeId">
                <option value="">No end node</option>
                ${data.networkNodes.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}
              </select>
            </label>
            <label>Route Note<input name="note" placeholder="Survey note, side road, lane" /></label>
            <div class="mapping-draft-note">
              <strong>${state.mapDraftPoints.length}</strong>
              <span>map points ready for route save</span>
            </div>
            <button class="primary-btn" type="submit">Save Drawn Route</button>
          </form>
        </div>
      </aside>
    </section>
  `;
}

function initNetworkMap() {
  const mapCanvas = document.getElementById("networkMapCanvas");
  if (!mapCanvas || !window.L) return;

  if (state.networkLeafletMap) {
    state.networkLeafletMap.remove();
    state.networkLeafletMap = null;
  }

  const nodes = state.data.networkNodes || [];
  const routes = state.data.fiberRoutes || [];
  const centerLat = nodes[0]?.latitude || 23.2599;
  const centerLng = nodes[0]?.longitude || 77.4126;
  const map = window.L.map(mapCanvas).setView([centerLat, centerLng], nodes.length ? 14 : 5);
  state.networkLeafletMap = map;

  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  const markerColor = {
    olt: "#0b57d0",
    splitter: "#b68222",
    fd_box: "#0b8f83",
    joint: "#8b5cf6",
    pole: "#475569",
    customer_endpoint: "#d9485f",
  };

  nodes.forEach((node) => {
    const marker = window.L.circleMarker([node.latitude, node.longitude], {
      radius: node.type === "olt" ? 9 : 7,
      color: markerColor[node.type] || "#0b57d0",
      weight: 2,
      fillOpacity: 0.9,
    }).addTo(map);

    marker.bindPopup(`
      <div class="map-popup">
        <strong>${escapeHtml(node.name)}</strong><br/>
        <span>${escapeHtml(node.type)}</span><br/>
        ${node.photoDataUrl ? `<img src="${escapeHtml(node.photoDataUrl)}" alt="${escapeHtml(node.name)}" style="width:160px;border-radius:12px;margin-top:10px;" />` : ""}
      </div>
    `);
  });

  routes.forEach((route) => {
    const points = parseRoutePoints(route.pathJson).filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));
    if (points.length < 2) return;
    window.L.polyline(points.map((item) => [item.lat, item.lng]), {
      color: route.colorCode || "#0b57d0",
      weight: route.routeType === "drop" ? 3 : 5,
      opacity: 0.85,
    }).addTo(map).bindPopup(`
      <div class="map-popup">
        <strong>${escapeHtml(route.name)}</strong><br/>
        <span>${escapeHtml(route.routeType)} | ${route.coreCount || 0} core</span><br/>
        <span>${Math.round(route.lengthMeters || 0)} meters</span>
      </div>
    `);
  });

  if (state.mapDraftPoints.length >= 2) {
    window.L.polyline(state.mapDraftPoints.map((item) => [item.lat, item.lng]), {
      color: "#ef4444",
      weight: 4,
      dashArray: "10,8",
    }).addTo(map);
  }

  map.on("click", (event) => {
    if (!state.mapDrawMode) return;
    state.mapDraftPoints.push({
      lat: Number(event.latlng.lat.toFixed(6)),
      lng: Number(event.latlng.lng.toFixed(6)),
    });
    initNetworkMap();
  });

  if (nodes.length || routes.length || state.mapDraftPoints.length) {
    const bounds = [];
    nodes.forEach((node) => bounds.push([node.latitude, node.longitude]));
    routes.forEach((route) => {
      parseRoutePoints(route.pathJson).forEach((point) => bounds.push([point.lat, point.lng]));
    });
    state.mapDraftPoints.forEach((point) => bounds.push([point.lat, point.lng]));
    if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [24, 24] });
    }
  }
}

function renderOperatorView() {
  const root = document.getElementById("operatorContent");
  const data = state.data;
  const today = normalizeDateOnly(new Date());
  const customerSearch = String(state.operatorCustomerSearch || "").trim().toLowerCase();
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
  const pendingRequests = data.paymentRequests.filter((item) => item.status === "pending").length;
  const onlineOnts = data.onts.filter((item) => item.status === "online").length;
  const filteredCustomers = data.customers.filter((item) => {
    if (!customerSearch) return true;
    return [item.name, item.mobile, item.customerCode, item.area, item.packageName]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(customerSearch));
  });
  const customerAreas = new Set(data.customers.map((item) => item.area).filter(Boolean)).size;
  const avgPackagePrice = data.packages.length
    ? data.packages.reduce((sum, item) => sum + Number(item.price || 0), 0) / data.packages.length
    : 0;
  const metrics = {
    todayCollections,
    pendingTotal,
    dueCustomersCount: dueCustomers.length,
    pendingRequests,
    onlineOnts,
  };

  const views = {
    dashboard: `
      ${renderOperatorWorkspaceHero(data, metrics, data.settings)}
      <section class="panel">
        <div class="section-head"><div><p class="eyebrow">Dashboard</p><h2>Main Overview</h2><p class="subtle-note">Collections, due recovery, customer count aur package activity ka fast command view.</p></div></div>
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
        <div class="section-head"><div><p class="eyebrow">Action Center</p><h2>Operator Priority Queue</h2></div></div>
        <div class="menu-grid operator-priority-grid">
          <article class="menu-card priority-card">
            <h3>Payment Confirmations</h3>
            <p>${pendingRequests}</p>
            <span>Customer submitted requests waiting for approval</span>
          </article>
          <article class="menu-card priority-card">
            <h3>Recharge Ready</h3>
            <p>${data.recharges.length}</p>
            <span>Latest recharge records available for review</span>
          </article>
          <article class="menu-card priority-card">
            <h3>Service Areas</h3>
            <p>${customerAreas}</p>
            <span>Distinct areas mapped across your customer base</span>
          </article>
          <article class="menu-card priority-card">
            <h3>Online Devices</h3>
            <p>${onlineOnts}</p>
            <span>ONT inventory currently reporting online status</span>
          </article>
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
        ${renderOperatorWorkspaceHero(data, metrics, data.settings)}
        <section class="panel">
          <div class="section-head">
            <div><p class="eyebrow">Customers</p><h2>Customer List</h2><p class="subtle-note">Customer records, migration import aur direct portal distribution ek hi place par.</p></div>
            <div class="toolbar">
              <label class="compact-field operator-search-field">Search Customer<input id="customerSearchInput" type="search" value="${escapeHtml(state.operatorCustomerSearch)}" placeholder="Name, mobile, portal ID, package" /></label>
              <button type="button" id="toggleCustomerForm" class="primary-btn">
                ${state.customerFormOpen ? "Close Form" : "Add New Customer"}
              </button>
            </div>
          </div>
          <div class="menu-grid operator-mini-grid">
            <article class="menu-card operator-mini-card"><h3>Visible Records</h3><p>${filteredCustomers.length}</p><span>Filtered customer count</span></article>
            <article class="menu-card operator-mini-card"><h3>Active</h3><p>${activeCustomers}</p><span>Customers currently active</span></article>
            <article class="menu-card operator-mini-card"><h3>Pending Due</h3><p>${dueCustomers.length}</p><span>Collections follow-up list</span></article>
            <article class="menu-card operator-mini-card"><h3>Areas Covered</h3><p>${customerAreas}</p><span>Distinct mapped customer localities</span></article>
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
          ${tableWrapper(renderCustomerTable(filteredCustomers))}
        </section>
      `,
      packages: `
        ${renderOperatorWorkspaceHero(data, metrics, data.settings)}
        <section class="panel">
          <div class="section-head"><div><p class="eyebrow">Packages</p><h2>Create Package</h2><p class="subtle-note">Cable, internet aur combo plans ko structured catalog me maintain karo.</p></div></div>
          <div class="menu-grid operator-mini-grid">
            <article class="menu-card operator-mini-card"><h3>Total Plans</h3><p>${data.packages.length}</p><span>Packages currently configured</span></article>
            <article class="menu-card operator-mini-card"><h3>Average Price</h3><p>${formatMoney(avgPackagePrice)}</p><span>Average plan value across catalog</span></article>
            <article class="menu-card operator-mini-card"><h3>Combo Ready</h3><p>${data.packages.filter((item) => item.type === "combo").length}</p><span>Combo packages available</span></article>
            <article class="menu-card operator-mini-card"><h3>Assigned Base</h3><p>${data.customers.filter((item) => item.packageId).length}</p><span>Customers already mapped to a plan</span></article>
          </div>
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
        ${renderOperatorWorkspaceHero(data, metrics, data.settings)}
        <section class="panel">
          <div class="section-head">
            <div><p class="eyebrow">Customer Payment Requests</p><h2>Pending Approval Queue</h2><p class="subtle-note">Customer-submitted UTR confirmations ko verify karke auto ledger entry post karo.</p></div>
            <div class="toolbar">
              <button type="button" id="copyCustomerPaymentLink" class="ghost-btn">Copy Customer Payment Link</button>
            </div>
          </div>
          <div class="menu-grid operator-mini-grid">
            <article class="menu-card operator-mini-card"><h3>Pending Requests</h3><p>${pendingRequests}</p><span>Approval waiting list</span></article>
            <article class="menu-card operator-mini-card"><h3>Today Posted</h3><p>${formatMoney(todayCollections)}</p><span>Ledger value posted today</span></article>
            <article class="menu-card operator-mini-card"><h3>Total Receipts</h3><p>${data.payments.length}</p><span>Recorded payment entries</span></article>
            <article class="menu-card operator-mini-card"><h3>Pending Due</h3><p>${formatMoney(pendingTotal)}</p><span>Outstanding collection base</span></article>
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
        ${renderOperatorWorkspaceHero(data, metrics, data.settings)}
        <section class="panel">
          <div class="section-head"><div><p class="eyebrow">Recharge</p><h2>Recharge Customer</h2><p class="subtle-note">Renewal, validity extension aur assisted recharge workflow ko structured rakho.</p></div></div>
          <div class="menu-grid operator-mini-grid">
            <article class="menu-card operator-mini-card"><h3>Total Recharges</h3><p>${data.recharges.length}</p><span>Recharge events on record</span></article>
            <article class="menu-card operator-mini-card"><h3>Expiring Soon</h3><p>${expiringCustomers.length}</p><span>Customers near validity edge</span></article>
            <article class="menu-card operator-mini-card"><h3>Pending Due</h3><p>${dueCustomers.length}</p><span>Recharge follow-up candidates</span></article>
            <article class="menu-card operator-mini-card"><h3>Collected This Month</h3><p>${formatMoney(monthlyCollection)}</p><span>Useful for renewal planning</span></article>
          </div>
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
        ${renderOperatorWorkspaceHero(data, metrics, data.settings)}
        <section class="panel">
          <div class="section-head"><div><p class="eyebrow">Reports</p><h2>Business Summary</h2><p class="subtle-note">Collection, due, expenses aur customer growth ko operator-side decision dashboard me dekho.</p></div></div>
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
        ${renderOperatorWorkspaceHero(data, metrics, data.settings)}
        <section class="panel">
          <div class="section-head"><div><p class="eyebrow">Staff</p><h2>Add Staff</h2><p class="subtle-note">Collection, support aur technician roles ko better team structure me manage karo.</p></div></div>
          <div class="menu-grid operator-mini-grid">
            <article class="menu-card operator-mini-card"><h3>Total Staff</h3><p>${data.staff.length}</p><span>Team members on platform</span></article>
            <article class="menu-card operator-mini-card"><h3>Collectors</h3><p>${data.staff.filter((item) => item.role === "collector").length}</p><span>Field collection resources</span></article>
            <article class="menu-card operator-mini-card"><h3>Technicians</h3><p>${data.staff.filter((item) => item.role === "technician").length}</p><span>Service response headcount</span></article>
            <article class="menu-card operator-mini-card"><h3>Active Roles</h3><p>${new Set(data.staff.map((item) => item.role)).size}</p><span>Role coverage inside business</span></article>
          </div>
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
        ${renderOperatorWorkspaceHero(data, metrics, data.settings)}
        <section class="panel">
          <div class="section-head"><div><p class="eyebrow">Expenses</p><h2>Add Expense</h2><p class="subtle-note">Operational cost, field spend aur monthly outflow ko clear records me rakho.</p></div></div>
          <div class="menu-grid operator-mini-grid">
            <article class="menu-card operator-mini-card"><h3>Total Expense</h3><p>${formatMoney(data.expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0))}</p><span>All recorded expenses</span></article>
            <article class="menu-card operator-mini-card"><h3>Entries</h3><p>${data.expenses.length}</p><span>Expense rows logged</span></article>
            <article class="menu-card operator-mini-card"><h3>Net Collection</h3><p>${formatMoney(monthlyCollection - data.expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0))}</p><span>Collection minus expenses</span></article>
            <article class="menu-card operator-mini-card"><h3>Due Buffer</h3><p>${formatMoney(pendingTotal)}</p><span>Potential recoverable value</span></article>
          </div>
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
        ${renderOperatorWorkspaceHero(data, metrics, data.settings)}
        <section class="panel">
          <div class="feedback success">ACS endpoint: <strong>${getAcsEndpoint()}</strong></div>
          <div class="section-head"><div><p class="eyebrow">Network Core</p><h2>OLT Management</h2><p class="subtle-note">Access layer inventory, ONT provisioning queue aur ACS diagnostics ko one place se monitor karo.</p></div></div>
          <div class="menu-grid operator-mini-grid">
            <article class="menu-card operator-mini-card"><h3>OLTs</h3><p>${data.olts.length}</p><span>Core access devices on record</span></article>
            <article class="menu-card operator-mini-card"><h3>ONTs</h3><p>${data.onts.length}</p><span>Customer edge devices tracked</span></article>
            <article class="menu-card operator-mini-card"><h3>Online</h3><p>${onlineOnts}</p><span>Live ONTs currently online</span></article>
            <article class="menu-card operator-mini-card"><h3>Queued Tasks</h3><p>${data.acsTasks.filter((item) => item.status === "queued").length}</p><span>Provisioning tasks waiting dispatch</span></article>
          </div>
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
    monitoring: `
      ${renderOperatorWorkspaceHero(data, metrics, data.settings)}
      <section class="panel">
        <div class="section-head"><div><p class="eyebrow">Deep Monitoring</p><h2>Predictive Device Intelligence</h2><p class="subtle-note">OLT, ONT, switch, router ya kisi bhi field device ko clean control-room layout me onboard, poll aur troubleshoot karo. Risk, alerts, interfaces aur edge-assisted access sab ek hi screen par aligned rahenge.</p></div></div>
        ${renderMonitoringSummary(data.monitoringSummary || {})}
      </section>
      <section class="monitoring-command-grid">
        <article class="panel monitoring-form-panel">
          <div class="section-head"><div><p class="eyebrow">Device Onboarding</p><h2>Add Monitoring Device</h2><p class="subtle-note">Server-side poll, edge-agent SNMP ya telemetry push me se jo real path ho uske hisaab se device banao.</p></div></div>
          <form id="monitoringDeviceForm" class="form-grid two-col-grid monitoring-form-grid">
            <label>Device Name<input name="name" required /></label>
            <label>Type
              <select name="deviceType">
                <option value="olt">OLT</option>
                <option value="ont">ONT</option>
                <option value="switch">Switch</option>
                <option value="router">Router</option>
                <option value="firewall">Firewall</option>
                <option value="ap">Access Point</option>
              </select>
            </label>
            <label>Vendor<input name="vendor" /></label>
            <label>Model<input name="model" /></label>
            <label>Host / IP<input name="host" placeholder="192.168.1.1" /></label>
            <label>Port<input name="port" type="number" value="161" /></label>
            <label>Protocol
              <select name="protocol">
                <option value="mikrotik_rest">MikroTik REST (HTTPS)</option>
                <option value="mikrotik_rest_http">MikroTik REST (HTTP)</option>
                <option value="snmp">SNMP v2c</option>
                <option value="tcp">TCP Port Check</option>
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
                <option value="custom">Custom / Future</option>
              </select>
            </label>
            <label>SNMP Version
              <select name="snmpVersion">
                <option value="2c">v2c</option>
              </select>
            </label>
            <label>SNMP Community<input name="snmpCommunity" placeholder="public / readonly community" /></label>
            <label>Metric Profile
              <select name="metricProfile">
                <option value="generic_system">Generic System (uptime test)</option>
                <option value="">Custom OID Map</option>
              </select>
            </label>
            <label>Mode
              <select name="monitorMode">
                <option value="active_poll">Active Poll from server</option>
                <option value="edge_agent_snmp">Edge Agent SNMP</option>
                <option value="push">Device/Agent Push Telemetry</option>
              </select>
            </label>
            <label>Edge Agent
              <select name="edgeAgentId">
                <option value="">No edge agent</option>
                ${(data.edgeAgents || []).map((item) => `<option value="${item.id}">${escapeHtml(item.name)} | ${escapeHtml(item.status)}</option>`).join("")}
              </select>
            </label>
            <label>Expected Heartbeat (sec)<input name="expectedIntervalSec" type="number" value="300" /></label>
            <label>Poll Path<input name="pollPath" value="/" placeholder="/status /login /" /></label>
            <label>Poll Timeout (ms)<input name="pollTimeoutMs" type="number" value="5000" /></label>
            <label>Auth User<input name="authUsername" placeholder="optional" /></label>
            <label>Auth Password<input name="authPassword" placeholder="optional" /></label>
            <div class="monitoring-inline-note">MikroTik ke liye sahi protocol, login aur REST service zaroor do. Local OLT ya switch ke liye edge-agent SNMP use karna zyada practical rahega.</div>
            <label>Enable Active Poll
              <select name="pollEnabled">
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </label>
            <label>Custom OID Map JSON<textarea name="customOidMapJson" rows="6" placeholder='{"cpuPercent":"1.3.6.x.x","memoryPercent":"1.3.6.x.x","temperatureC":"1.3.6.x.x","opticalRxPowerDbm":"1.3.6.x.x","opticalTxPowerDbm":"1.3.6.x.x","onuOnlineCount":"1.3.6.x.x","onuOfflineCount":"1.3.6.x.x","activeAlarmCount":"1.3.6.x.x","interfaceDownCount":"1.3.6.x.x","uptimeSeconds":"1.3.6.x.x"}'></textarea></label>
            <label>Linked OLT
              <select name="linkedOltId">
                <option value="">No OLT link</option>
                ${renderOltOptions(data.olts)}
              </select>
            </label>
            <label>Linked ONT
              <select name="linkedOntId">
                <option value="">No ONT link</option>
                ${renderOntOptions(data.onts)}
              </select>
            </label>
            <label>Linked Customer
              <select name="linkedCustomerId">
                <option value="">No customer link</option>
                ${renderCustomerOptions(data.customers)}
              </select>
            </label>
            <label>Note<input name="note" placeholder="Rack note, POP note, site details" /></label>
            <div class="form-actions"><button class="primary-btn" type="submit">Create Monitoring Device</button></div>
          </form>
        </article>
        <article class="panel monitoring-side-panel">
          <div class="section-head"><div><p class="eyebrow">Live Ops Guide</p><h2>What To Connect</h2><p class="subtle-note">Yahan se operator ko quickly samajh aa jaye ki kaunsi device kaunsa mode use karegi.</p></div></div>
          <div class="monitoring-guide-grid">
            <article class="monitoring-guide-card">
              <span class="monitoring-guide-kicker">MikroTik / Public Router</span>
              <strong>REST + Auth</strong>
              <p>Public IP, login aur correct HTTP/HTTPS port do. Interface list aur port actions isi path se aayenge.</p>
            </article>
            <article class="monitoring-guide-card">
              <span class="monitoring-guide-kicker">OLT / Switch / Local SNMP</span>
              <strong>Edge Agent SNMP</strong>
              <p>Local IP ya VPN-side devices ke liye online edge agent choose karo, warna cloud poll timeout deta rahega.</p>
            </article>
            <article class="monitoring-guide-card">
              <span class="monitoring-guide-kicker">Custom Telemetry</span>
              <strong>Push Ingest</strong>
              <p>Secure ingest key ke through CPU, optical power, alarms ya device heartbeat directly bhej sakte ho.</p>
            </article>
          </div>
          <div class="monitoring-mini-strip">
            <article class="monitoring-mini-card">
              <span>Edge Agents Online</span>
              <strong>${(data.edgeAgents || []).filter((item) => item.status === "online").length}</strong>
            </article>
            <article class="monitoring-mini-card">
              <span>Server Poll Devices</span>
              <strong>${(data.monitoredDevices || []).filter((item) => item.monitorMode === "active_poll").length}</strong>
            </article>
            <article class="monitoring-mini-card">
              <span>Edge SNMP Devices</span>
              <strong>${(data.monitoredDevices || []).filter((item) => item.monitorMode === "edge_agent_snmp").length}</strong>
            </article>
          </div>
        </article>
      </section>
      <section class="panel">
        <div class="section-head">
          <div><p class="eyebrow">Device Health</p><h2>Risk Analysis Table</h2><p class="subtle-note">Delete, poll, regenerate key aur live health sab isi list se manage karo.</p></div>
          <div class="monitoring-table-summary">
            <span>${(data.monitoredDevices || []).length} devices</span>
            <span>${(data.monitoredDevices || []).filter((item) => item.status === "online").length} online</span>
            <span>${(data.monitoredDevices || []).filter((item) => item.status !== "online").length} offline / unknown</span>
          </div>
        </div>
        ${tableWrapper(renderMonitoringDeviceTable(data.monitoredDevices))}
      </section>
      <section class="monitoring-bottom-grid">
        <article class="panel">
          <div class="section-head"><div><p class="eyebrow">Alert Feed</p><h2>Active Monitoring Alerts</h2></div></div>
          ${tableWrapper(renderMonitoringAlertsTable(data.deviceAlerts))}
        </article>
        <article class="panel">
          <div class="section-head"><div><p class="eyebrow">Ports & Interfaces</p><h2>Live Port Status</h2><p class="subtle-note">MikroTik REST ya future vendor adapters se live interface state aur actions yahin dikhengi.</p></div></div>
          ${tableWrapper(renderMonitoringPortTable(data.monitoredDevices))}
        </article>
      </section>
    `,
    edge: `
      ${renderOperatorWorkspaceHero(data, metrics, data.settings)}
      <section class="panel">
        <div class="section-head"><div><p class="eyebrow">Edge Control</p><h2>VPN-Side Local Network Access</h2><p class="subtle-note">Ye same software ka connected edge agent hoga. Agent operator ke local VPN network me chalega aur local IP devices ko ping/poll karke cloud panel me result bhejega.</p></div></div>
        ${renderEdgeAgentSummary(data.edgeSummary || {})}
      </section>
      <section class="split-grid dashboard-split">
        <article class="panel">
          <div class="section-head"><div><p class="eyebrow">Register Agent</p><h2>Create Edge Agent</h2></div></div>
          <form id="edgeAgentForm" class="form-grid two-col-grid">
            <label>Agent Name<input name="name" required /></label>
            <label>VPN Mode
              <select name="vpnMode">
                <option value="existing_vpn">Existing VPN on host</option>
                <option value="l2tp_client">L2TP Client Host</option>
                <option value="wireguard_client">WireGuard Client Host</option>
              </select>
            </label>
            <label>Note<input name="note" placeholder="Office mini PC / NOC server / site agent" /></label>
            <div class="form-actions"><button class="primary-btn" type="submit">Create Agent</button></div>
          </form>
        </article>
        <article class="panel">
          <div class="section-head"><div><p class="eyebrow">Ping Tool</p><h2>Queue Local IP Ping</h2></div></div>
          <form id="edgePingForm" class="form-grid two-col-grid">
            <label>Agent
              <select name="agentId">
                ${(data.edgeAgents || []).map((item) => `<option value="${item.id}">${escapeHtml(item.name)} | ${escapeHtml(item.status)}</option>`).join("")}
              </select>
            </label>
            <label>Target Host<input name="targetHost" placeholder="192.168.1.1" required /></label>
            <label>Ping Count<input name="count" type="number" value="2" /></label>
            <label>Timeout (ms)<input name="timeoutMs" type="number" value="5000" /></label>
            <div class="form-actions"><button class="primary-btn" type="submit">Queue Ping</button></div>
          </form>
        </article>
      </section>
      <section class="panel">
        <div class="section-head"><div><p class="eyebrow">Agents</p><h2>Connected Edge Agents</h2></div></div>
        ${tableWrapper(renderEdgeAgentsTable(data.edgeAgents))}
      </section>
      <section class="panel">
        <div class="section-head"><div><p class="eyebrow">Task History</p><h2>Ping / Relay Results</h2></div></div>
        ${tableWrapper(renderEdgeTasksTable(data.edgeTasks))}
      </section>
    `,
    settings: `
        ${renderOperatorWorkspaceHero(data, metrics, data.settings)}
        <section class="panel">
          <div class="section-head"><div><p class="eyebrow">Settings</p><h2>Brand, Billing, Payment and ACS Settings</h2><p class="subtle-note">Business identity, payment instructions, billing rules aur ACS defaults ko operator side se fine-tune karo.</p></div></div>
          <form id="settingsForm" class="form-grid two-col-grid">
            <label>Firm Name<input name="companyName" value="${data.settings?.companyName || ""}" /></label>
            <label>Support Mobile<input name="supportMobile" value="${data.settings?.supportMobile || ""}" /></label>
          <label>Billing Day<input name="billingDay" type="number" value="${data.settings?.billingDay || 1}" /></label>
          <label>Late Fee<input name="lateFee" type="number" value="${data.settings?.lateFee || 0}" /></label>
          <label>Address<input name="address" value="${data.settings?.address || ""}" /></label>
          <label>Payment Display Name<input name="paymentDisplayName" value="${data.settings?.paymentDisplayName || ""}" placeholder="Customer portal heading" /></label>
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
        ${renderOperatorPaymentPreview(data.settings, getSession()?.tenant)}
        <div class="inline-form-block">
          <p class="eyebrow">Customer Payment Link</p>
          <p class="subtle-note">${escapeHtml(`${window.location.origin}${window.location.pathname}#customer-pay`)}</p>
        </div>
      </section>
    `,
    mapping: renderMappingView(data, metrics),
  };

  root.innerHTML = views[state.operatorView];
  attachOperatorSectionEvents();
  if (state.operatorView === "mapping") {
    window.setTimeout(() => initNetworkMap(), 0);
  }
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

function renderOperatorPaymentPreview(settings, sessionTenant) {
  const brand = settings?.paymentDisplayName || settings?.companyName || sessionTenant?.businessName || "Operator Payment";
  const support = settings?.supportMobile || sessionTenant?.mobile || "-";
  const upiId = settings?.upiId || "-";
  const portalBase = `${window.location.origin}${window.location.pathname}#customer-pay/<customer-id>`;

  return `
    <div class="operator-payment-preview">
      <div class="operator-payment-preview-head">
        <div>
          <p class="eyebrow">Customer Side Preview</p>
          <h3>${escapeHtml(brand)}</h3>
          <p class="subtle-note">Ye information customer portal me dikhengi jab customer login karega.</p>
        </div>
        <div class="operator-payment-badge">
          <span>UPI</span>
          <strong>${escapeHtml(upiId)}</strong>
        </div>
      </div>
      <div class="operator-payment-preview-grid">
        <article class="menu-card">
          <h3>Payment Display</h3>
          <p>${escapeHtml(brand)}</p>
          <span>Customer portal payment heading</span>
        </article>
        <article class="menu-card">
          <h3>Support Mobile</h3>
          <p>${escapeHtml(support)}</p>
          <span>Customer help contact</span>
        </article>
        <article class="menu-card">
          <h3>Portal Link Format</h3>
          <p>${escapeHtml(portalBase)}</p>
          <span>Unique customer ID ke saath share hoga</span>
        </article>
      </div>
      ${settings?.qrImageUrl
        ? `<div class="operator-qr-preview-wrap"><img class="qr-preview operator-qr-preview" src="${escapeHtml(settings.qrImageUrl)}" alt="Operator QR Preview" /></div>`
        : `<div class="empty-state">QR image URL save karoge to yahin preview dikh jayegi.</div>`}
      <div class="customer-upi-card">
        <span>Customer Instructions</span>
        <strong>${escapeHtml(settings?.qrInstructions || "QR scan karke payment karein, phir UTR submit karein.")}</strong>
      </div>
    </div>
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

function renderMonitoringSummary(summary = {}) {
  return `
    <div class="menu-grid operator-mini-grid monitoring-summary-grid">
      <article class="menu-card operator-mini-card monitoring-summary-card"><h3>Total Devices</h3><p>${summary.totalDevices || 0}</p><span>Routers, switches, OLTs aur field devices</span></article>
      <article class="menu-card operator-mini-card monitoring-summary-card"><h3>Online</h3><p>${summary.onlineDevices || 0}</p><span>Latest telemetry receive hui devices</span></article>
      <article class="menu-card operator-mini-card monitoring-summary-card"><h3>Critical</h3><p>${summary.criticalDevices || 0}</p><span>Immediate action wali high-risk devices</span></article>
      <article class="menu-card operator-mini-card monitoring-summary-card"><h3>Warnings</h3><p>${summary.warningDevices || 0}</p><span>Behaviour degrade ho raha hai</span></article>
      <article class="menu-card operator-mini-card monitoring-summary-card"><h3>Open Alerts</h3><p>${summary.openAlerts || 0}</p><span>Operator acknowledgement ka wait</span></article>
      <article class="menu-card operator-mini-card monitoring-summary-card"><h3>High Risk</h3><p>${summary.highRiskDevices || 0}</p><span>Prediction engine ne flag kiya</span></article>
    </div>
  `;
}

function renderMonitoringAlertsTable(items = []) {
  if (!items.length) {
    return `<div class="empty-state">Abhi koi monitoring alert detect nahi hua.</div>`;
  }

  return `
    <table>
      <thead><tr><th>Severity</th><th>Device</th><th>Alert</th><th>Detail</th><th>Status</th><th>Last Seen</th></tr></thead>
      <tbody>
        ${items.map((item) => `
          <tr>
            <td><span class="badge ${badgeClass(item.severity === "critical" ? "failed" : item.severity === "warning" ? "queued" : "active")}">${escapeHtml(item.severity)}</span></td>
            <td>${escapeHtml(item.device?.name || item.deviceId || "-")}</td>
            <td>${escapeHtml(item.title)}</td>
            <td>${escapeHtml(item.detail || "-")}</td>
            <td><span class="badge ${badgeClass(item.status === "open" ? "warning" : "success")}">${escapeHtml(item.status)}</span></td>
            <td>${escapeHtml(formatDate(item.lastDetectedAt || item.updatedAt))}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderMonitoringDeviceTable(items = []) {
  if (!items.length) {
    return `<div class="empty-state">Abhi koi monitored device add nahi hua.</div>`;
  }

  return `
    <table>
      <thead><tr><th>Device</th><th>Type</th><th>Status</th><th>Risk</th><th>Live Metrics</th><th>Prediction</th><th>Actions</th></tr></thead>
      <tbody>
        ${items.map((item) => {
          const analysis = item.analysis || {};
          const metrics = analysis.metrics || {};
          const predicted = (analysis.predictedIssues || []).slice(0, 2).join(" | ") || "-";
          return `
            <tr>
              <td>
                <div class="monitoring-device-cell">
                  <strong>${escapeHtml(item.name)}</strong>
                  <span class="subtle-note">${escapeHtml(item.host || "No host")} | ${escapeHtml(item.protocol || "-")}</span>
                  <span class="subtle-note">${escapeHtml(item.monitorMode || "push")} | ${escapeHtml(item.vendor || "Unknown vendor")}${item.model ? ` | ${escapeHtml(item.model)}` : ""}</span>
                </div>
              </td>
              <td>${escapeHtml(item.deviceType)}</td>
              <td><span class="badge ${badgeClass(analysis.healthStatus === "critical" ? "failed" : analysis.healthStatus === "warning" ? "queued" : item.status === "online" ? "active" : "offline")}">${escapeHtml(analysis.healthStatus || item.status || "unknown")}</span></td>
              <td>
                <strong>${item.riskScore ?? analysis.riskScore ?? 0}</strong><br />
                <span class="subtle-note">Last seen ${escapeHtml(formatDate(item.lastSeenAt))}</span><br />
                <span class="subtle-note">${escapeHtml(item.lastEventMessage || "No probe detail yet")}</span>
              </td>
              <td>
                CPU ${metrics.cpuPercent ?? item.cpuPercent ?? "-"}%<br />
                Mem ${metrics.memoryPercent ?? item.memoryPercent ?? "-"}%<br />
                Lat ${metrics.latencyMs ?? item.latencyMs ?? "-"} ms<br />
                RX ${metrics.opticalRxPowerDbm ?? item.opticalRxPowerDbm ?? item.signalPowerDbm ?? "-"} dBm<br />
                TX ${metrics.opticalTxPowerDbm ?? item.opticalTxPowerDbm ?? "-"} dBm<br />
                ONU Off ${metrics.onuOfflineCount ?? item.onuOfflineCount ?? "-"} | Alarms ${metrics.activeAlarmCount ?? item.activeAlarmCount ?? "-"}
              </td>
              <td>${escapeHtml(predicted)}<br /><span class="subtle-note">Poll code ${escapeHtml(String(item.lastPollStatusCode ?? "-"))}</span></td>
              <td>
                <div class="monitoring-action-group">
                  <button class="ghost-btn action-btn" data-action="copy-monitor-endpoint" data-id="${item.id}">Copy Ingest</button>
                  <button class="ghost-btn action-btn" data-action="poll-monitor-device" data-id="${item.id}">Poll Now</button>
                  <button class="ghost-btn action-btn" data-action="regen-monitor-key" data-id="${item.id}">New Key</button>
                  <button class="ghost-btn danger-btn action-btn" data-action="delete-monitor-device" data-id="${item.id}">Delete</button>
                </div>
              </td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

function renderMonitoringPortTable(items = []) {
  const rows = [];
  const diagnostics = [];
  items.forEach((device) => {
    let ports = [];
    let fetchMessage = "";
    try {
      const parsed = JSON.parse(device.lastInterfacesJson || "[]");
      if (Array.isArray(parsed)) {
        ports = parsed;
      } else {
        ports = Array.isArray(parsed.items) ? parsed.items : [];
        fetchMessage = parsed.fetchMessage || "";
      }
    } catch {
      ports = [];
    }
    ports.forEach((port) => {
      rows.push({ device, port });
    });
    if (!ports.length && (device.protocol === "mikrotik_rest" || device.protocol === "mikrotik_rest_http")) {
      diagnostics.push({
        deviceName: device.name,
        host: device.host,
        message: fetchMessage || device.lastEventMessage || "Interface fetch detail abhi receive nahi hui.",
      });
    }
  });

  if (!rows.length) {
    return `
      <div class="empty-state">Abhi kisi device se live port/interface list receive nahi hui.</div>
      ${diagnostics.length ? `
        <div class="stack-list">
          ${diagnostics.map((item) => `
            <article class="stack-card">
              <div>
                <strong>${escapeHtml(item.deviceName)}</strong>
                <p>${escapeHtml(item.host || "-")}</p>
              </div>
              <div>
                <strong>Interface Fetch</strong>
                <p>${escapeHtml(item.message)}</p>
              </div>
            </article>
          `).join("")}
        </div>
      ` : ""}
    `;
  }

  return `
    <table>
      <thead><tr><th>Device</th><th>Port</th><th>Type</th><th>Running</th><th>Disabled</th><th>MTU</th><th>Action</th></tr></thead>
      <tbody>
        ${rows.map(({ device, port }) => `
          <tr>
            <td>${escapeHtml(device.name)}</td>
            <td>${escapeHtml(port.name || port.id || "-")}</td>
            <td>${escapeHtml(port.type || "-")}</td>
            <td><span class="badge ${badgeClass(port.running ? "online" : "offline")}">${port.running ? "running" : "down"}</span></td>
            <td><span class="badge ${badgeClass(port.disabled ? "suspended" : "active")}">${port.disabled ? "disabled" : "enabled"}</span></td>
            <td>${escapeHtml(String(port.mtu || "-"))}</td>
            <td>
              <button class="ghost-btn action-btn" data-action="enable-port" data-id="${device.id}::${encodeURIComponent(port.id || port.name || "")}">Enable</button>
              <button class="ghost-btn action-btn" data-action="disable-port" data-id="${device.id}::${encodeURIComponent(port.id || port.name || "")}">Disable</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderEdgeAgentSummary(summary = {}) {
  return `
    <div class="menu-grid operator-mini-grid">
      <article class="menu-card operator-mini-card"><h3>Total Agents</h3><p>${summary.totalAgents || 0}</p><span>Registered VPN-side collectors</span></article>
      <article class="menu-card operator-mini-card"><h3>Online Agents</h3><p>${summary.onlineAgents || 0}</p><span>Heartbeat receive ho raha hai</span></article>
      <article class="menu-card operator-mini-card"><h3>Queued Tasks</h3><p>${summary.queuedTasks || 0}</p><span>Pending ping/poll tasks</span></article>
    </div>
  `;
}

function renderEdgeAgentsTable(items = []) {
  if (!items.length) return `<div class="empty-state">Abhi koi edge agent register nahi hai.</div>`;
  return `
    <table>
      <thead><tr><th>Agent</th><th>Status</th><th>VPN</th><th>Last Seen</th><th>Token</th><th>Action</th></tr></thead>
      <tbody>
        ${items.map((item) => `
          <tr>
            <td>${escapeHtml(item.name)}<br /><span class="subtle-note">${escapeHtml(item.lastIpAddress || "-")}</span></td>
            <td><span class="badge ${badgeClass(item.status === "online" ? "online" : "offline")}">${escapeHtml(item.status)}</span></td>
            <td>${escapeHtml(item.vpnMode || "-")}</td>
            <td>${escapeHtml(formatDate(item.lastSeenAt))}<br /><span class="subtle-note">${escapeHtml(item.lastMessage || "-")}</span></td>
            <td><code>${escapeHtml(item.token)}</code></td>
            <td>
              <button class="ghost-btn action-btn" data-action="copy-edge-agent" data-id="${item.id}">Copy Setup</button>
              <button class="ghost-btn action-btn" data-action="regen-edge-token" data-id="${item.id}">New Token</button>
              <button class="ghost-btn action-btn" data-action="delete-edge-agent" data-id="${item.id}">Delete</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderEdgeTasksTable(items = []) {
  if (!items.length) return `<div class="empty-state">Abhi koi edge task history nahi hai.</div>`;
  return `
    <table>
      <thead><tr><th>Type</th><th>Target</th><th>Status</th><th>Result</th><th>Time</th></tr></thead>
      <tbody>
        ${items.map((item) => `
          <tr>
            <td>${escapeHtml(item.taskType)}</td>
            <td>${escapeHtml(item.targetHost || "-")}${item.targetPort ? `:${escapeHtml(String(item.targetPort))}` : ""}</td>
            <td><span class="badge ${badgeClass(item.status === "completed" ? "success" : item.status === "failed" ? "failed" : "queued")}">${escapeHtml(item.status)}</span></td>
            <td>${escapeHtml(item.errorMessage || item.resultJson || "-")}</td>
            <td>${escapeHtml(formatDate(item.completedAt || item.updatedAt || item.createdAt))}</td>
          </tr>
        `).join("")}
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
        <button type="button" class="nav-item ${selected ? "active-nav" : ""} admin-operator-item premium-operator-card" data-operator-id="${item.id}">
          <div class="admin-operator-card-top">
            <strong>${item.businessName}</strong>
            <span class="badge ${badgeClass(item.subscriptionStatus)}">${item.subscriptionStatus}</span>
          </div>
          <span>${item.ownerName} | ${item.city || "-"}</span>
          <span>${item.plan} plan</span>
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

  if (action === "copy-monitor-endpoint") {
    const item = state.data.monitoredDevices.find((device) => device.id === id);
    if (!item) return;
    const endpoint = `${apiBase}/monitoring/ingest/${item.ingestKey}`;
    const examplePayload = {
      eventType: "telemetry",
      status: "online",
      cpuPercent: 42,
      memoryPercent: 57,
      temperatureC: 48,
      latencyMs: 12,
      packetLossPercent: 0,
      opticalRxPowerDbm: -21.4,
      opticalTxPowerDbm: 2.1,
      message: "periodic device heartbeat",
    };
    const shareText = `${endpoint}\n\nPOST JSON example:\n${JSON.stringify(examplePayload, null, 2)}`;
    await copyText(shareText);
    showStatus("Monitoring ingest endpoint copied.");
    return;
  }

  if (action === "regen-monitor-key") {
    await fetchJson(`/monitoring/devices/${id}/regenerate-key`, { method: "POST" });
    await loadOperatorData();
    renderOperatorView();
    showStatus("Monitoring ingest key regenerate ho gayi.");
    return;
  }

  if (action === "poll-monitor-device") {
    await fetchJson(`/monitoring/devices/${id}/poll`, { method: "POST" });
    await loadOperatorData();
    renderOperatorView();
    showStatus("Manual poll complete ho gaya.");
    return;
  }

  if (action === "delete-monitor-device") {
    if (!window.confirm("Delete this monitoring device?")) return;
    try {
      const response = await fetchJson(`/monitoring/devices/${id}`, { method: "DELETE" });
      state.data.monitoredDevices = (state.data.monitoredDevices || []).filter((item) => item.id !== id);
      state.data.deviceAlerts = (state.data.deviceAlerts || []).filter((item) => item.deviceId !== id);
      await loadOperatorData();
      renderOperatorView();
      showStatus(response.message || "Monitoring device deleted.");
    } catch (error) {
      showStatus(parseErrorMessage(error, "Monitoring device delete nahi hua."), "error");
    }
    return;
  }

  if (action === "enable-port" || action === "disable-port") {
    const [deviceId, encodedPortId] = String(id || "").split("::");
    if (!deviceId || !encodedPortId) return;
    const command = action === "enable-port" ? "enable" : "disable";
    await fetchJson(`/monitoring/devices/${deviceId}/ports/${decodeURIComponent(encodedPortId)}/${command}`, { method: "POST" });
    await loadOperatorData();
    renderOperatorView();
    showStatus(`Port ${command} action complete ho gayi.`);
    return;
  }

  if (action === "copy-edge-agent") {
    const item = state.data.edgeAgents.find((agent) => agent.id === id);
    if (!item) return;
    const setupText = [
      `CABLEOPS_CLOUD_API_BASE=${apiBase}`,
      `CABLEOPS_AGENT_TOKEN=${item.token}`,
      `CABLEOPS_AGENT_NAME=${item.name}`,
      "",
      "Run:",
      "npm --workspace apps/agent run start",
    ].join("\n");
    await copyText(setupText);
    showStatus("Edge agent setup copied.");
    return;
  }

  if (action === "regen-edge-token") {
    await fetchJson(`/edge/agents/${id}/regenerate-token`, { method: "POST" });
    await loadOperatorData();
    renderOperatorView();
    showStatus("Edge agent token regenerate ho gaya.");
    return;
  }

  if (action === "delete-edge-agent") {
    if (!window.confirm("Delete this edge agent?")) return;
    await fetchJson(`/edge/agents/${id}`, { method: "DELETE" });
    await loadOperatorData();
    renderOperatorView();
    showStatus("Edge agent deleted.");
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
    return;
  }

  if (action === "delete-map-node") {
    if (!window.confirm("Delete this map node?")) return;
    await fetchJson(`/mapping/nodes/${id}`, { method: "DELETE" });
    await loadOperatorData();
    renderOperatorView();
    showStatus("Map node deleted.");
    return;
  }

  if (action === "delete-map-route") {
    if (!window.confirm("Delete this fiber route?")) return;
    await fetchJson(`/mapping/routes/${id}`, { method: "DELETE" });
    await loadOperatorData();
    renderOperatorView();
    showStatus("Fiber route deleted.");
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

  const customerSearchInput = document.getElementById("customerSearchInput");
  if (customerSearchInput) {
    customerSearchInput.addEventListener("input", (event) => {
      state.operatorCustomerSearch = event.currentTarget.value || "";
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

  const monitoringDeviceForm = document.getElementById("monitoringDeviceForm");
  if (monitoringDeviceForm) {
    monitoringDeviceForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const formData = new FormData(event.currentTarget);
      const payload = Object.fromEntries(formData.entries());
      payload.pollEnabled = payload.pollEnabled === "true";
      await fetchJson("/monitoring/devices", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      form.reset();
      await loadOperatorData();
      renderOperatorView();
      showStatus("Monitoring device add ho gaya. Ab ingest endpoint copy karke telemetry push kar sakte ho.");
    });
  }

  const edgeAgentForm = document.getElementById("edgeAgentForm");
  if (edgeAgentForm) {
    edgeAgentForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
      await fetchJson("/edge/agents", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await loadOperatorData();
      renderOperatorView();
      showStatus("Edge agent create ho gaya.");
    });
  }

  const edgePingForm = document.getElementById("edgePingForm");
  if (edgePingForm) {
    edgePingForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
      await fetchJson(`/edge/agents/${payload.agentId}/ping`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await loadOperatorData();
      renderOperatorView();
      showStatus("Ping task queue ho gayi. Agent run hote hi result aayega.");
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

  const startRouteDrawingBtn = document.getElementById("startRouteDrawingBtn");
  if (startRouteDrawingBtn) {
    startRouteDrawingBtn.addEventListener("click", () => {
      state.mapDrawMode = true;
      showStatus("Map par click karke fiber route points add karo.");
      initNetworkMap();
    });
  }

  const clearRouteDraftBtn = document.getElementById("clearRouteDraftBtn");
  if (clearRouteDraftBtn) {
    clearRouteDraftBtn.addEventListener("click", () => {
      state.mapDraftPoints = [];
      state.mapDrawMode = false;
      renderOperatorView();
      showStatus("Route draft clear ho gaya.");
    });
  }

  const useCurrentLocationBtn = document.getElementById("useCurrentLocationBtn");
  if (useCurrentLocationBtn) {
    useCurrentLocationBtn.addEventListener("click", () => {
      if (!navigator.geolocation) {
        showStatus("Geolocation is browser me available nahi hai.", "error");
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const latInput = document.getElementById("mapNodeLat");
          const lngInput = document.getElementById("mapNodeLng");
          if (latInput) latInput.value = String(position.coords.latitude.toFixed(6));
          if (lngInput) lngInput.value = String(position.coords.longitude.toFixed(6));
          showStatus("Current location form me aa gayi.");
        },
        () => showStatus("Current location fetch nahi hui.", "error"),
        { enableHighAccuracy: true, timeout: 10000 },
      );
    });
  }

  const mapNodeForm = document.getElementById("mapNodeForm");
  if (mapNodeForm) {
    mapNodeForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const photoFile = document.getElementById("mapNodePhoto")?.files?.[0];
      const payload = Object.fromEntries(formData.entries());
      if (photoFile) {
        payload.photoDataUrl = await fileToDataUrl(photoFile);
      }
      await fetchJson("/mapping/nodes", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await loadOperatorData();
      renderOperatorView();
      showStatus("Map node saved successfully.");
    });
  }

  const fiberRouteForm = document.getElementById("fiberRouteForm");
  if (fiberRouteForm) {
    fiberRouteForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (state.mapDraftPoints.length < 2) {
        showStatus("Route save karne se pehle map par kam se kam 2 points add karo.", "error");
        return;
      }
      const formData = new FormData(event.currentTarget);
      const payload = Object.fromEntries(formData.entries());
      payload.points = state.mapDraftPoints;
      await fetchJson("/mapping/routes", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      state.mapDraftPoints = [];
      state.mapDrawMode = false;
      await loadOperatorData();
      renderOperatorView();
      showStatus("Fiber route saved successfully.");
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

  const jumpViewButton = event.target.closest("[data-jump-view]");
  if (jumpViewButton) {
    state.operatorView = jumpViewButton.dataset.jumpView;
    renderOperatorNav();
    renderOperatorView();
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
  const [operators, customers, packages, payments, paymentRequests, recharges, reports, staff, expenses, olts, onts, acsTasks, acsEvents, settings, mappingOverview, monitoringOverview, edgeOverview] =
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
      fetchJson("/mapping/overview"),
      fetchJson("/monitoring/overview"),
      fetchJson("/edge/overview"),
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
  state.data.networkNodes = mappingOverview.items?.nodes || [];
  state.data.fiberRoutes = mappingOverview.items?.routes || [];
  state.data.mapInsights = mappingOverview.items?.insights || null;
  state.data.monitoredDevices = monitoringOverview.items?.devices || [];
  state.data.deviceAlerts = monitoringOverview.items?.alerts || [];
  state.data.monitoringSummary = monitoringOverview.items?.summary || null;
  state.data.edgeAgents = edgeOverview.items?.agents || [];
  state.data.edgeTasks = edgeOverview.items?.tasks || [];
  state.data.edgeSummary = edgeOverview.items?.summary || null;
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
