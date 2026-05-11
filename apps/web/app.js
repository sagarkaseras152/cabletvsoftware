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
  { key: "customers", title: "Customers", description: "Add and manage customers" },
  { key: "packages", title: "Packages", description: "Manage plans and pricing" },
  { key: "payments", title: "Payments", description: "Collect payment and receipts" },
  { key: "recharge", title: "Recharge", description: "Renew and extend validity" },
  { key: "reports", title: "Reports", description: "Collections and defaulter summary" },
  { key: "staff", title: "Staff", description: "Team and permissions" },
  { key: "expenses", title: "Expenses", description: "Track operational cost" },
  { key: "settings", title: "Settings", description: "Operator profile and billing rules" },
];

const state = {
  operatorView: "dashboard",
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
          <p class="eyebrow">CableOps Secure Access</p>
          <h1>Production-style admin and operator login.</h1>
          <p class="lede">
            Admin ko sirf operator management panel milega. Operator ko apna working portal milega jahan wo customers, packages, billing, recharge, expenses aur reports manage karega.
          </p>
          <div class="auth-points">
            <div class="auth-point">Separate admin and operator panels</div>
            <div class="auth-point">Working operator sections with forms</div>
            <div class="auth-point">JWT login and protected API</div>
          </div>
          <div class="demo-credentials">
            <strong>Demo accounts</strong>
            <p>Admin: owner@cableops.in / admin123</p>
            <p>Operator: demo.operator@cableops.in / demo12345</p>
            <p>URL: http://localhost:4173</p>
          </div>
        </section>
        <section class="auth-form">
          <p class="eyebrow">Login</p>
          <h2>Welcome back</h2>
          ${message ? `<div class="feedback error">${message}</div>` : ""}
          <form id="loginForm" class="form-grid">
            <label>
              Email
              <input name="email" type="email" value="demo.operator@cableops.in" required />
            </label>
            <label>
              Password
              <input name="password" type="password" value="demo12345" required />
            </label>
            <button class="primary-btn" type="submit">Login</button>
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
          <p class="eyebrow">Platform Owner</p>
          <h2>CableOps Admin Control</h2>
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
          <p class="eyebrow">SaaS Admin</p>
          <h1>Manage operators, subscriptions, and access.</h1>
          <p class="lede">
            Yahan se aap operator accounts banao aur unko software use karne ke liye credentials do.
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
          <p class="eyebrow">Operator Workspace</p>
          <h2>${tenant?.businessName || "Operator Panel"}</h2>
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
            <p class="eyebrow">Operator Menu</p>
            <h3>Manage Business</h3>
          </div>
          <nav id="operatorNav" class="nav-list"></nav>
        </aside>

        <section class="workspace-main">
          <header class="hero">
            <div class="hero-copy">
              <p class="eyebrow">Operator Panel</p>
              <h1>Working management software for daily operations.</h1>
              <p class="lede">
                Customer add karo, package banao, payment collect karo, recharge karo, staff aur expenses manage karo.
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
        <button class="nav-item ${state.operatorView === item.key ? "active-nav" : ""}" data-view="${item.key}">
          <strong>${item.title}</strong>
          <span>${item.description}</span>
        </button>
      `,
    )
    .join("");

  nav.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.operatorView = button.dataset.view;
      renderOperatorNav();
      renderOperatorView();
    });
  });
}

function tableWrapper(inner) {
  return `<div class="table-wrap">${inner}</div>`;
}

function renderOperatorView() {
  const root = document.getElementById("operatorContent");
  const data = state.data;

  const views = {
    dashboard: `
      <section class="panel">
        <div class="section-head"><div><p class="eyebrow">Dashboard</p><h2>Quick Overview</h2></div></div>
        <div class="menu-grid">
          <article class="menu-card"><h3>Total Customers</h3><p>${data.customers.length}</p></article>
          <article class="menu-card"><h3>Total Packages</h3><p>${data.packages.length}</p></article>
          <article class="menu-card"><h3>Total Payments</h3><p>${data.payments.length}</p></article>
          <article class="menu-card"><h3>Total Expenses</h3><p>${formatMoney(data.expenses.reduce((sum, item) => sum + item.amount, 0))}</p></article>
        </div>
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
            <select name="customerId">${renderCustomerOptions(data.customers)}</select>
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

function renderCustomerOptions(items) {
  return items.map((item) => `<option value="${item.id}">${item.name} | ${item.mobile}</option>`).join("");
}

function renderPackageOptions(items) {
  return items.map((item) => `<option value="${item.id}">${item.name} | ${formatMoney(item.price)}</option>`).join("");
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

function attachOperatorSectionEvents() {
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

  document.querySelectorAll("[data-action='edit-customer']").forEach((button) => {
    button.addEventListener("click", async () => {
      const customer = state.data.customers.find((item) => item.id === button.dataset.id);
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
    });
  });

  document.querySelectorAll("[data-action='assign-package']").forEach((button) => {
    button.addEventListener("click", async () => {
      const customer = state.data.customers.find((item) => item.id === button.dataset.id);
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
    });
  });

  document.querySelectorAll("[data-action='delete-customer']").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm("Delete this customer?")) return;
      await fetchJson(`/customers/${button.dataset.id}`, { method: "DELETE" });
      await loadOperatorData();
      renderOperatorView();
      showStatus("Customer deleted.");
    });
  });

  document.querySelectorAll("[data-action='edit-package']").forEach((button) => {
    button.addEventListener("click", async () => {
      const item = state.data.packages.find((pkg) => pkg.id === button.dataset.id);
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
    });
  });

  document.querySelectorAll("[data-action='delete-package']").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm("Delete this package?")) return;
      try {
        await fetchJson(`/packages/${button.dataset.id}`, { method: "DELETE" });
        await loadOperatorData();
        renderOperatorView();
        showStatus("Package deleted.");
      } catch (_error) {
        showStatus("Package assigned hai, pehle customers reassign karo.", "error");
      }
    });
  });
}

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
