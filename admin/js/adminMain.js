import {
  MAIN_APP_URL,
  adminFetch,
  clearAdminToken,
  isAdminLoggedIn,
  setAdminToken,
} from './adminApi.js';

const loginView = document.getElementById('loginView');
const loginForm = document.getElementById('loginForm');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');

const dashboard = document.getElementById('dashboard');
const logoutBtn = document.getElementById('logoutBtn');

const statTotalUsers = document.getElementById('statTotalUsers');
const statFreeUsers = document.getElementById('statFreeUsers');
const statProMonthly = document.getElementById('statProMonthly');
const statProYearly = document.getElementById('statProYearly');
const statMessagesToday = document.getElementById('statMessagesToday');
const statMRR = document.getElementById('statMRR');

const signupsChart = document.getElementById('signupsChart');
const usersSearch = document.getElementById('usersSearch');
const usersTableBody = document.getElementById('usersTableBody');
const usersTotalLabel = document.getElementById('usersTotalLabel');

const userModal = document.getElementById('userModal');
const userModalClose = document.getElementById('userModalClose');
const userModalBody = document.getElementById('userModalBody');

const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const dateFormatter = (iso) => new Date(iso).toLocaleDateString(undefined, {
  year: 'numeric', month: 'short', day: 'numeric'
});

function showLogin(){
  loginView.classList.remove('hidden');
  dashboard.classList.add('hidden');
}

function showDashboard(){
  loginView.classList.add('hidden');
  dashboard.classList.remove('hidden');
}

// ---- Login ----
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  loginBtn.disabled = true;
  try{
    const res = await adminFetch('/admin/auth/login', {
      method: 'POST',
      body: { email: loginEmail.value, password: loginPassword.value },
    });
    const data = await res.json();
    setAdminToken(data.access_token);
    showDashboard();
    await loadDashboard();
  }catch(err){
    loginError.textContent = err.detail || err.message || 'Something went wrong.';
  }finally{
    loginBtn.disabled = false;
  }
});

logoutBtn.addEventListener('click', () => {
  clearAdminToken();
  window.location.reload();
});

// ---- Stats ----
function renderStats(stats){
  statTotalUsers.textContent = stats.total_users;
  statFreeUsers.textContent = stats.free_users;
  statProMonthly.textContent = stats.pro_monthly;
  statProYearly.textContent = stats.pro_yearly;
  statMessagesToday.textContent = stats.messages_today;
  statMRR.textContent = currencyFormatter.format(stats.estimated_mrr);
}

// ---- Chart: single-series bar chart, reused for both the signups panel
// and each user's usage-history in the detail modal. ----
function renderChart(container, days){
  container.innerHTML = '';
  const max = Math.max(1, ...days.map((d) => d.count));

  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  container.appendChild(tooltip);

  function showTooltip(bar, day){
    const value = document.createElement('span');
    value.className = 'tt-value';
    value.textContent = String(day.count);
    const label = document.createElement('span');
    label.className = 'tt-date';
    label.textContent = dateFormatter(day.date);

    tooltip.textContent = '';
    tooltip.appendChild(value);
    tooltip.appendChild(label);

    const chartRect = container.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    tooltip.style.left = `${barRect.left - chartRect.left + barRect.width / 2}px`;
    tooltip.style.top = `${barRect.top - chartRect.top}px`;
    tooltip.classList.add('visible');
  }

  function hideTooltip(){
    tooltip.classList.remove('visible');
  }

  days.forEach((day) => {
    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    bar.tabIndex = 0;
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', `${day.count} on ${day.date}`);

    const fill = document.createElement('div');
    fill.className = 'chart-bar-fill';
    const heightPct = Math.max(3, Math.round((day.count / max) * 100));
    fill.style.height = `${heightPct}%`;

    bar.appendChild(fill);
    bar.addEventListener('mouseenter', () => showTooltip(bar, day));
    bar.addEventListener('mouseleave', hideTooltip);
    bar.addEventListener('focus', () => showTooltip(bar, day));
    bar.addEventListener('blur', hideTooltip);

    container.appendChild(bar);
  });
}

// ---- Users table ----
function planLabel(plan){
  if(plan === 'monthly') return 'Pro Monthly';
  if(plan === 'yearly') return 'Pro Yearly';
  return 'Free';
}

function renderUsers(data){
  usersTableBody.innerHTML = '';

  if(data.users.length === 0){
    const row = document.createElement('tr');
    row.className = 'empty-row';
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.textContent = 'No users match.';
    row.appendChild(cell);
    usersTableBody.appendChild(row);
  }

  for(const user of data.users){
    const row = document.createElement('tr');
    row.addEventListener('click', () => openUserModal(user.id));

    const email = document.createElement('td');
    email.textContent = user.email;

    const joined = document.createElement('td');
    joined.textContent = dateFormatter(user.created_at);

    const plan = document.createElement('td');
    const planBadge = document.createElement('span');
    planBadge.className = `plan-badge ${user.plan}`;
    planBadge.textContent = planLabel(user.plan);
    plan.appendChild(planBadge);

    const statusCell = document.createElement('td');
    const statusBadge = document.createElement('span');
    statusBadge.className = `status-badge ${user.subscription_status}`;
    statusBadge.textContent = user.subscription_status;
    statusCell.appendChild(statusBadge);

    const messages = document.createElement('td');
    messages.textContent = `${user.messages_today}/${user.daily_limit}`;

    row.appendChild(email);
    row.appendChild(joined);
    row.appendChild(plan);
    row.appendChild(statusCell);
    row.appendChild(messages);
    usersTableBody.appendChild(row);
  }

  usersTotalLabel.textContent = `Showing ${data.users.length} of ${data.total} user${data.total === 1 ? '' : 's'}`;
}

async function fetchUsers(search = ''){
  const query = search ? `?search=${encodeURIComponent(search)}` : '';
  const res = await adminFetch(`/admin/users${query}`);
  renderUsers(await res.json());
}

let searchDebounce = null;
usersSearch.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => fetchUsers(usersSearch.value.trim()), 250);
});

// ---- User detail modal ----
function closeUserModal(){
  userModal.classList.add('hidden');
  userModalBody.innerHTML = '';
}

userModalClose.addEventListener('click', closeUserModal);
userModal.addEventListener('click', (e) => {
  if(e.target === userModal) closeUserModal();
});
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape' && !userModal.classList.contains('hidden')) closeUserModal();
});

function detailRow(label, value){
  const row = document.createElement('div');
  row.className = 'detail-row';
  const labelEl = document.createElement('span');
  labelEl.className = 'label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'value';
  valueEl.textContent = value;
  row.appendChild(labelEl);
  row.appendChild(valueEl);
  return row;
}

function renderUserDetail(user){
  userModalBody.innerHTML = '';

  const email = document.createElement('div');
  email.className = 'detail-email';
  email.textContent = user.email;
  userModalBody.appendChild(email);

  const badges = document.createElement('div');
  badges.className = 'detail-badges';
  const planBadge = document.createElement('span');
  planBadge.className = `plan-badge ${user.plan}`;
  planBadge.textContent = planLabel(user.plan);
  const statusBadge = document.createElement('span');
  statusBadge.className = `status-badge ${user.subscription_status}`;
  statusBadge.textContent = user.subscription_status;
  badges.appendChild(planBadge);
  badges.appendChild(statusBadge);
  userModalBody.appendChild(badges);

  const rows = document.createElement('div');
  rows.className = 'detail-rows';
  rows.appendChild(detailRow('Joined', dateFormatter(user.created_at)));
  rows.appendChild(detailRow('Total messages (last 60 days)', String(user.total_messages)));
  if(user.current_period_end){
    rows.appendChild(detailRow('Current period ends', dateFormatter(user.current_period_end)));
  }
  if(user.stripe_customer_id){
    rows.appendChild(detailRow('Stripe customer', user.stripe_customer_id));
  }
  rows.appendChild(detailRow(
    'Times impersonated',
    user.impersonation_count > 0
      ? `${user.impersonation_count} (last ${dateFormatter(user.last_impersonated_at)})`
      : '0'
  ));
  userModalBody.appendChild(rows);

  const chartLabel = document.createElement('div');
  chartLabel.className = 'detail-chart-label';
  chartLabel.textContent = 'Usage — last 60 days';
  userModalBody.appendChild(chartLabel);

  const chart = document.createElement('div');
  chart.className = 'chart';
  chart.setAttribute('role', 'img');
  chart.setAttribute('aria-label', `Daily message count for ${user.email} over the last 60 days`);
  userModalBody.appendChild(chart);
  renderChart(chart, user.usage_history);

  const impersonateBtn = document.createElement('button');
  impersonateBtn.type = 'button';
  impersonateBtn.className = 'impersonate-btn';
  impersonateBtn.textContent = `Impersonate ${user.email}`;

  const impersonateError = document.createElement('div');
  impersonateError.className = 'impersonate-error';

  impersonateBtn.addEventListener('click', async () => {
    const confirmed = window.confirm(
      `Log in as ${user.email}? This opens a new tab authenticated as them and is logged.`
    );
    if(!confirmed) return;

    impersonateError.textContent = '';
    impersonateBtn.disabled = true;
    try{
      const res = await adminFetch(`/admin/users/${user.id}/impersonate`, { method: 'POST' });
      const data = await res.json();
      window.open(`${MAIN_APP_URL}/?impersonate_token=${encodeURIComponent(data.access_token)}`, '_blank');
      closeUserModal();
    }catch(err){
      impersonateError.textContent = err.detail || err.message || 'Could not impersonate this user.';
    }finally{
      impersonateBtn.disabled = false;
    }
  });

  userModalBody.appendChild(impersonateBtn);
  const note = document.createElement('div');
  note.className = 'impersonate-note';
  note.textContent = 'Opens the main app, signed in as this user, in a new tab.';
  userModalBody.appendChild(note);
  userModalBody.appendChild(impersonateError);
}

async function openUserModal(userId){
  userModalBody.innerHTML = '<p class="modal-loading">Loading…</p>';
  userModal.classList.remove('hidden');
  try{
    const res = await adminFetch(`/admin/users/${userId}`);
    renderUserDetail(await res.json());
  }catch(err){
    userModalBody.innerHTML = '';
    const error = document.createElement('p');
    error.className = 'modal-loading';
    error.textContent = err.detail || err.message || 'Could not load this user.';
    userModalBody.appendChild(error);
  }
}

// ---- Boot ----
async function loadDashboard(){
  const [statsRes] = await Promise.all([
    adminFetch('/admin/stats'),
    fetchUsers(),
  ]);
  const stats = await statsRes.json();
  renderStats(stats);
  renderChart(signupsChart, stats.signups_by_day);
}

async function boot(){
  if(!isAdminLoggedIn()){
    showLogin();
    return;
  }
  try{
    showDashboard();
    await loadDashboard();
  }catch(err){
    console.warn('Admin session invalid, signing out:', err);
    clearAdminToken();
    showLogin();
  }
}

boot();
