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
  { key: "settings", title: "Settings", description: "Brand and billing rules" },
];

const state = {
  operatorView: "dashboard",
  dashboardFilters: {
    dueStart: "",
    dueEnd: "",
  },
  quickPayCustomerId: "",
  data: {
    operators: [],
    customers: [],
    packages: [],
    payments: [],
    recharges: [],
    reports: [],
    staff: [],
    expenses: [],
    settings: null,
  },
};

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
    if (response.status === 401) {
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

function badgeClass(status) {
  const map = {
    active: "active",
    success: "success",
    trial: "trial",
    partial: "warning",
    suspended: "suspended",
    activation_pending: "warning",
  };
  return map[status] || "warning";
}

function showStatus(message, type = "success") {
  const box = document.getElementById("statusBox");
  if (box) {
    box.innerHTML = `<div class="feedback ${type}">${message}</div>`;
  }
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
        <div class="hero-panel">
          <div class="metric-card"><span>Total Operators</span><strong id="mrrValue">-</strong></div>
          <div class="metric-card"><span>Total Customers</span><strong id="customerValue">-</strong></div>
          <div class="metric-card"><span>Pending Platform Due</span><strong id="pendingValue">-</strong></div>
        </div>
      </header>

      <main class="content-grid">
        <section class="panel">
          <div id="statusBox"></div>
          <div class="section-head">
            <div>
              <p class="eyebrow">Operator Onboarding</p>
              <h2>Create Operator Account</h2>
            </div>
          </div>
          <form id="operatorCreateForm" class="form-grid two-col-grid">
            <label>Business Name<input name="businessName" required /></label>
            <label>Owner Name<input name="ownerName" required /></label>
            <label>City<input name="city" /></label>
            <label>Mobile<input name="mobile" required /></label>
            <label>Login Email<input name="email" type="email" required /></label>
            <label>Password<input name="password" required /></label>
            <label>Plan<input name="plan" value="Trial" /></label>
            <div class="form-actions"><button class="primary-btn" type="submit">Create Operator</button></div>
          </form>
        </section>

        <section class="panel">
          <div class="section-head">
            <div>
              <p class="eyebrow">Operator List</p>
              <h2>All Operators</h2>
            </div>
          </div>
          <div id="operatorsList" class="list-grid"></div>
        </section>
      </main>
    </div>
  `;

  attachCommonEvents();
  document.getElementById("operatorCreateForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    try {
      const response = await fetchJson("/operators", {
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
      showStatus(`Operator created. Login: ${response.login.email} / ${response.login.password}`);
      event.currentTarget.reset();
      await hydrateDashboard();
    } catch (_error) {
      showStatus("Operator create nahi hua.", "error");
    }
  });
}

function renderOperatorShell(user, tenant) {
  appRoot.innerHTML = `
    <div class="page-shell">
      <div class="topbar">
        <div>
          <p class="eyebrow">CableOps</p>
          <h2>${tenant?.businessName || "Workspace"}</h2>
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
          <header class="hero">
            <div class="hero-copy">
              <p class="eyebrow">Operations</p>
              <h1>${tenant?.businessName || "Business Dashboard"}</h1>
              <p class="lede">
                Collections, due tracking, package control, recharge flow, customer records and team operations in one premium workspace.
              </p>
            </div>
            <div class="hero-panel">
              <div class="metric-card"><span>Monthly Collection</span><strong id="mrrValue">-</strong></div>
              <div class="metric-card"><span>My Customers</span><strong id="customerValue">-</strong></div>
              <div class="metric-card"><span>Pending Collection</span><strong id="pendingValue">-</strong></div>
            </div>
          </header>

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
        <div class="section-head"><div><p class="eyebrow">Customers</p><h2>Add New Customer</h2></div></div>
        <form id="customerForm" class="form-grid two-col-grid">
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
          <div class="form-actions"><button class="primary-btn" type="submit">Add Customer</button></div>
        </form>
      </section>
      <section class="panel">
        <div class="section-head"><div><p class="eyebrow">Customer List</p><h2>Manage Customers</h2></div></div>
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
    settings: `
      <section class="panel">
        <div class="section-head"><div><p class="eyebrow">Settings</p><h2>Operator Settings</h2></div></div>
        <form id="settingsForm" class="form-grid two-col-grid">
          <label>Company Name<input name="companyName" value="${data.settings?.companyName || ""}" /></label>
          <label>Support Mobile<input name="supportMobile" value="${data.settings?.supportMobile || ""}" /></label>
          <label>Billing Day<input name="billingDay" type="number" value="${data.settings?.billingDay || 1}" /></label>
          <label>Late Fee<input name="lateFee" type="number" value="${data.settings?.lateFee || 0}" /></label>
          <label>Address<input name="address" value="${data.settings?.address || ""}" /></label>
          <div class="form-actions"><button class="primary-btn" type="submit">Save Settings</button></div>
        </form>
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
      <thead><tr><th>Name</th><th>Mobile</th><th>Area</th><th>Package</th><th>Status</th><th>Due</th><th>Actions</th></tr></thead>
      <tbody>
        ${items
          .map(
            (item) => `
              <tr>
                <td>${item.name}</td>
                <td>${item.mobile}</td>
                <td>${item.area || "-"}</td>
                <td>${item.packageName || "-"}</td>
                <td><span class="badge ${badgeClass(item.status)}">${item.status}</span></td>
                <td>${formatMoney(item.dueAmount)}</td>
                <td>
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
  }
}

function attachOperatorSectionEvents() {
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
      await loadOperatorData();
      renderOperatorView();
      showStatus("Customer added successfully.");
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

document.addEventListener("click", async (event) => {
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
  document.getElementById("mrrValue").textContent = String(operatorsResponse.items.length);
  document.getElementById("customerValue").textContent = overviewResponse.overview.platform.totalEndCustomers.toLocaleString("en-IN");
  document.getElementById("pendingValue").textContent = formatMoney(overviewResponse.overview.platform.pendingCollections);
  document.getElementById("operatorsList").innerHTML = operatorsResponse.items
    .map(
      (item) => `
        <article class="operator-card">
          <div class="badge ${badgeClass(item.subscriptionStatus)}">${item.subscriptionStatus}</div>
          <h3>${item.businessName}</h3>
          <p>${item.city} | ${item.plan} | ${item.ownerName}</p>
          <p class="meta-line">Customers: ${item.activeCustomers} | Collection: ${formatMoney(item.monthlyCollection)}</p>
        </article>
      `,
    )
    .join("");
}

async function loadOperatorData() {
  const [operators, customers, packages, payments, recharges, reports, staff, expenses, settings] =
    await Promise.all([
      fetchJson("/operators"),
      fetchJson("/customers"),
      fetchJson("/packages"),
      fetchJson("/payments"),
      fetchJson("/recharges"),
      fetchJson("/reports"),
      fetchJson("/staff"),
      fetchJson("/expenses"),
      fetchJson("/settings"),
    ]);

  state.data.operators = operators.items;
  state.data.customers = customers.items;
  state.data.packages = packages.items;
  state.data.payments = payments.items;
  state.data.recharges = recharges.items;
  state.data.reports = reports.items;
  state.data.staff = staff.items;
  state.data.expenses = expenses.items;
  state.data.settings = settings.item;

  const operator = operators.items[0];
  const pending = customers.items.reduce((sum, item) => sum + (Number(item.dueAmount) || 0), 0);
  document.getElementById("mrrValue").textContent = formatMoney(operator?.monthlyCollection || 0);
  document.getElementById("customerValue").textContent = String(customers.items.length);
  document.getElementById("pendingValue").textContent = formatMoney(pending);
}

async function hydrateDashboard() {
  const session = getSession();
  if (session.user.role === "platform_owner") {
    await loadPlatformOwnerData();
    showStatus("Admin panel loaded.");
    return;
  }

  await loadOperatorData();
  renderOperatorView();
  showStatus("Operator workspace loaded.");
}

if (getSession()?.token) {
  renderAppShell();
  hydrateDashboard().catch(() => {
    clearSession();
    renderLogin("Session invalid. Please log in again.");
  });
} else {
  renderLogin();
}
