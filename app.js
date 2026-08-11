/* ================= گھر کا حساب — App Logic ================= */

const CATEGORIES = [
  { key: 'gosht',        label: 'گوشت',                       icon: '🥩' },
  { key: 'sabzi',         label: 'سبزیاں',                     icon: '🥬' },
  { key: 'phal',          label: 'پھل',                        icon: '🍎' },
  { key: 'bills',         label: 'بل اور ضروری خدمات',          icon: '🧾',
    subs: ['بجلی کا بل', 'پانی کا بل', 'دودھ کا خرچ', 'موبائل کا بل'] },
  { key: 'sauda',         label: 'ماہانہ سودا سلف',             icon: '🛒' },
  { key: 'petrol',        label: 'گاڑی کا پیٹرول',              icon: '⛽' },
  { key: 'jaib_kharch',   label: 'والدہ اور اہلیہ کا جیب خرچ',   icon: '🤲' },
  { key: 'ghair_mutawaqqa', label: 'غیر متوقع اخراجات',          icon: '⚠️',
    subs: ['دوا', 'ہوٹل کا کھانا', 'دیگر'] },
  { key: 'jumma_dawat',   label: 'جمعرات کی دعوت',              icon: '🍽️' },
];
const SAVING_LABEL = 'ماہانہ بچت';
const SAVING_ICON = '🏦';

const MONTH_NAMES = ['جنوری','فروری','مارچ','اپریل','مئی','جون','جولائی','اگست','ستمبر','اکتوبر','نومبر','دسمبر'];

let cfg = null;          // { url, key, householdId, userName }
let sb = null;            // supabase client
let realtimeChannel = null;
let viewDate = new Date(); // year/month currently viewed
let state = { entries: [], income: 0, budgets: {} };

/* ---------------- Utilities ---------------- */
function fmtMoney(n){
  n = Math.round(Number(n) || 0);
  return '₹' + n.toLocaleString('en-IN');
}
function monthKey(d){
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
}
function monthLabel(d){
  return MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear();
}
function todayStr(){
  return new Date().toISOString().slice(0,10);
}
function catByKey(key){
  return CATEGORIES.find(c => c.key === key);
}
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(showToast._tm);
  showToast._tm = setTimeout(()=> t.classList.add('hidden'), 2200);
}
function showSync(msg){
  const b = document.getElementById('sync-badge');
  b.textContent = msg;
  b.classList.add('show');
  clearTimeout(showSync._tm);
  showSync._tm = setTimeout(()=> b.classList.remove('show'), 1600);
}

/* ---------------- ڈارک موڈ ---------------- */
function initTheme(){
  const saved = localStorage.getItem('ghk_theme');
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  applyTheme(theme);
}
function applyTheme(theme){
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('btn-theme');
  if(btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute('content', theme === 'dark' ? '#10231C' : '#1F5C4F');
}
function toggleTheme(){
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem('ghk_theme', next);
  applyTheme(next);
}

/* ---------------- Config / Setup ---------------- */
function loadConfig(){
  try{
    const raw = localStorage.getItem('ghk_config');
    return raw ? JSON.parse(raw) : null;
  }catch(e){ return null; }
}
function saveConfig(c){
  localStorage.setItem('ghk_config', JSON.stringify(c));
}
function uuidv4(){
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c=>{
    const r = Math.random()*16|0, v = c==='x' ? r : (r&0x3|0x8);
    return v.toString(16);
  });
}

function initSetupScreen(){
  const nameSel = document.getElementById('setup-name');
  ['مناظر','اہلیہ','دیگر'].forEach(n=>{
    const o = document.createElement('option');
    o.value = n; o.textContent = n;
    nameSel.appendChild(o);
  });
  nameSel.addEventListener('change', ()=>{
    document.getElementById('custom-name-wrap').classList.toggle('hidden', nameSel.value !== 'دیگر');
  });

  document.getElementById('setup-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    let name = nameSel.value;
    if(name === 'دیگر'){
      name = document.getElementById('setup-name-custom').value.trim();
    }
    const url = document.getElementById('setup-url').value.trim().replace(/\/$/,'');
    const key = document.getElementById('setup-key').value.trim();
    let household = document.getElementById('setup-household').value.trim();
    if(!name || !url || !key){ showToast('براہ مہربانی تمام خانے پُر کریں'); return; }
    if(!household){ household = uuidv4(); }

    cfg = { url, key, householdId: household, userName: name };

    try{
      sb = supabase.createClient(cfg.url, cfg.key);
      // quick sanity check
      const { error } = await sb.from('household_settings').select('household_id').limit(1);
      if(error) throw error;
    }catch(err){
      showToast('کنکشن ناکام — URL اور Key دوبارہ چیک کریں');
      return;
    }

    saveConfig(cfg);
    await bootApp();
  });
}

/* ---------------- App boot ---------------- */
async function bootApp(){
  document.getElementById('setup-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  buildCategoryFormOptions();
  buildBudgetFields();
  await ensureHouseholdRow();
  await loadMonth();
  subscribeRealtime();
}

async function ensureHouseholdRow(){
  const { data } = await sb.from('household_settings').select('*').eq('household_id', cfg.householdId).maybeSingle();
  if(!data){
    await sb.from('household_settings').insert({ household_id: cfg.householdId, monthly_income: 0 });
    state.income = 0;
  } else {
    state.income = Number(data.monthly_income) || 0;
  }
}

/* ---------------- Data loading ---------------- */
async function loadMonth(){
  document.getElementById('month-label').textContent = monthLabel(viewDate);
  const mk = monthKey(viewDate);
  const start = mk + '-01';
  const endDate = new Date(viewDate.getFullYear(), viewDate.getMonth()+1, 1);
  const end = endDate.toISOString().slice(0,10);

  showSync('🔄 اپ ڈیٹ ہو رہا ہے…');

  const [{ data: entries, error: e1 }, { data: budgets, error: e2 }, { data: settingsRow, error: e3 }] = await Promise.all([
    sb.from('entries').select('*')
      .eq('household_id', cfg.householdId)
      .gte('entry_date', start).lt('entry_date', end)
      .order('entry_date', { ascending: false }).order('created_at', { ascending: false }),
    sb.from('budgets').select('*').eq('household_id', cfg.householdId).eq('month', mk),
    sb.from('household_settings').select('*').eq('household_id', cfg.householdId).maybeSingle(),
  ]);

  if(e1 || e2 || e3){
    showToast('ڈیٹا لوڈ کرنے میں مسئلہ — انٹرنیٹ چیک کریں');
    return;
  }

  state.entries = entries || [];
  state.budgets = {};
  (budgets||[]).forEach(b => state.budgets[b.category] = Number(b.limit_amount));
  state.income = settingsRow ? Number(settingsRow.monthly_income)||0 : 0;

  renderAll();
}

function subscribeRealtime(){
  if(realtimeChannel) sb.removeChannel(realtimeChannel);
  realtimeChannel = sb.channel('ghk-' + cfg.householdId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entries', filter: `household_id=eq.${cfg.householdId}` },
      () => { showSync('🔄 نیا اندراج موصول ہوا'); loadMonth(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'household_settings', filter: `household_id=eq.${cfg.householdId}` },
      () => { loadMonth(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'budgets', filter: `household_id=eq.${cfg.householdId}` },
      () => { loadMonth(); })
    .subscribe();
}

/* ---------------- Rendering ---------------- */
function renderAll(){
  const expenseEntries = state.entries.filter(e => e.entry_type === 'expense');
  const savingEntries = state.entries.filter(e => e.entry_type === 'saving');

  const totalExpense = expenseEntries.reduce((s,e)=> s + Number(e.amount), 0);
  const totalSaving = savingEntries.reduce((s,e)=> s + Number(e.amount), 0);
  const today = todayStr();
  const todayExpense = expenseEntries.filter(e => e.entry_date === today).reduce((s,e)=> s + Number(e.amount), 0);
  const remaining = state.income - totalExpense - totalSaving;

  document.getElementById('sum-income').textContent = fmtMoney(state.income);
  document.getElementById('sum-today').textContent = fmtMoney(todayExpense);
  document.getElementById('sum-total').textContent = fmtMoney(totalExpense);
  document.getElementById('sum-remaining').textContent = fmtMoney(remaining);

  renderSavingCard(totalSaving);
  renderCategoryList(expenseEntries);
  renderBudgetOverview(expenseEntries);
  renderChart(expenseEntries);
  renderRecent();
}

function renderSavingCard(totalSaving){
  const goal = Number(state.budgets['saving_goal']) || 0;
  const withGoal = document.getElementById('saving-with-goal');
  const noGoal = document.getElementById('saving-no-goal');

  if(!goal){
    withGoal.classList.add('hidden');
    noGoal.classList.remove('hidden');
    return;
  }
  withGoal.classList.remove('hidden');
  noGoal.classList.add('hidden');

  const left = goal - totalSaving;
  const rawPct = Math.round((totalSaving/goal)*100);
  const pct = Math.min(100, rawPct);

  document.getElementById('saving-goal-amt').textContent = fmtMoney(goal);
  document.getElementById('saving-current-amt').textContent = fmtMoney(totalSaving);
  document.getElementById('saving-left-amt').textContent = left > 0 ? fmtMoney(left) : '₹0';

  const fill = document.getElementById('saving-bar-fill');
  fill.style.width = pct + '%';
  fill.className = 'cat-bar-fill' + (totalSaving >= goal ? ' over' : '');

  document.getElementById('saving-pct-note').textContent =
    totalSaving >= goal ? `🎉 ہدف مکمل ہوگیا — ${rawPct}%` : `${rawPct}% مکمل`;
}

function renderBudgetOverview(expenseEntries){
  const totals = categoryTotals(expenseEntries);
  const budgetedCats = CATEGORIES.filter(c => state.budgets[c.key]);
  const wrap = document.getElementById('budget-overview-set');
  const empty = document.getElementById('budget-overview-empty');

  if(budgetedCats.length === 0){
    wrap.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  empty.classList.add('hidden');

  const totalBudget = budgetedCats.reduce((s,c)=> s + Number(state.budgets[c.key]), 0);
  const totalSpent = budgetedCats.reduce((s,c)=> s + (totals[c.key]||0), 0);
  const remaining = totalBudget - totalSpent;
  const rawPct = Math.round((totalSpent/totalBudget)*100);
  const pct = Math.min(100, rawPct);
  const over = totalSpent > totalBudget;

  document.getElementById('bo-total-budget').textContent = fmtMoney(totalBudget);
  document.getElementById('bo-total-spent').textContent = fmtMoney(totalSpent);
  document.getElementById('bo-remaining').textContent = remaining < 0 ? '− ' + fmtMoney(Math.abs(remaining)) : fmtMoney(remaining);
  document.getElementById('bo-remaining').className = remaining < 0 ? 'over-text' : '';

  const fill = document.getElementById('bo-bar-fill');
  fill.style.width = pct + '%';
  fill.className = 'cat-bar-fill' + (over ? ' over' : (pct >= 90 ? ' warn' : ''));

  document.getElementById('bo-pct-note').textContent = over
    ? `⚠️ بجٹ سے ${fmtMoney(totalSpent-totalBudget)} تجاوز`
    : `${rawPct}% استعمال`;
  document.getElementById('bo-pct-note').className = 'cat-budget-note' + (over ? ' over' : (pct >= 90 ? ' warn' : ''));
}

function categoryTotals(expenseEntries){
  const totals = {};
  CATEGORIES.forEach(c => totals[c.key] = 0);
  expenseEntries.forEach(e => { totals[e.category] = (totals[e.category]||0) + Number(e.amount); });
  return totals;
}

function renderCategoryList(expenseEntries){
  const totals = categoryTotals(expenseEntries);
  const list = document.getElementById('category-list');
  list.innerHTML = '';

  CATEGORIES.forEach(c => {
    const amount = totals[c.key] || 0;
    const budget = state.budgets[c.key];
    const card = document.createElement('div');
    card.className = 'cat-card';

    let barHtml = '';
    let noteHtml = '';
    if(budget){
      const rawPct = Math.round((amount/budget)*100);
      const pct = Math.min(100, rawPct);
      const over = amount - budget;
      const cls = amount > budget ? 'over' : (pct >= 90 ? 'warn' : '');
      barHtml = `<div class="cat-bar-track"><div class="cat-bar-fill ${cls}" style="width:${pct}%"></div></div>`;

      let statusText = `${fmtMoney(amount)} / ${fmtMoney(budget)} — ${rawPct}% استعمال — ✅ بجٹ کے اندر`;
      if(amount > budget){
        statusText = `${fmtMoney(amount)} / ${fmtMoney(budget)} — 🚨 بجٹ سے ${fmtMoney(over)} زائد`;
      } else if(pct >= 90){
        statusText = `${fmtMoney(amount)} / ${fmtMoney(budget)} — ⚠️ بجٹ قریب ہے (${rawPct}%)`;
      }
      noteHtml = `<div class="cat-budget-note ${cls}">${statusText}</div>`;
    } else {
      noteHtml = `<div class="cat-budget-note">بجٹ مقرر نہیں</div>`;
    }

    card.innerHTML = `
      <div class="cat-row-top">
        <span class="cat-name">${c.icon} ${c.label}</span>
        <span class="cat-amount">${fmtMoney(amount)}</span>
      </div>
      ${barHtml}${noteHtml}
    `;
    list.appendChild(card);
  });

  // بچت الگ کارڈ میں اوپر دکھائی جاتی ہے (renderSavingCard)
}

function renderChart(expenseEntries){
  const totals = categoryTotals(expenseEntries);
  const rows = CATEGORIES.map(c => ({ label: c.icon+' '+c.label, value: totals[c.key]||0 }))
    .filter(r => r.value > 0)
    .sort((a,b)=> b.value - a.value);

  const svg = document.getElementById('chart-svg');
  const empty = document.getElementById('chart-empty');
  const topList = document.getElementById('top-list');
  topList.innerHTML = '';

  if(rows.length === 0){
    svg.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  svg.classList.remove('hidden');

  const max = Math.max(...rows.map(r=>r.value));
  const barW = 100 / rows.length;
  let bars = '';
  rows.forEach((r, i) => {
    const h = max ? (r.value/max) * 88 : 0;
    const x = i * barW + barW*0.15;
    const w = barW * 0.7;
    const y = 100 - h;
    bars += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.2" fill="${i===0 ? 'var(--gold)' : 'var(--primary)'}"></rect>`;
  });
  svg.innerHTML = bars;

  const medals = ['🥇','🥈','🥉'];
  rows.slice(0,3).forEach((r,i)=>{
    const li = document.createElement('li');
    li.innerHTML = `<span class="rank">${medals[i]||''} ${r.label}</span><span class="money">${fmtMoney(r.value)}</span>`;
    topList.appendChild(li);
  });
}

function renderRecent(){
  const list = document.getElementById('recent-list');
  const empty = document.getElementById('recent-empty');
  list.innerHTML = '';

  if(state.entries.length === 0){
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  state.entries.slice(0, 40).forEach(e => {
    const isSaving = e.entry_type === 'saving';
    const cat = isSaving ? null : catByKey(e.category);
    const icon = isSaving ? SAVING_ICON : (cat ? cat.icon : '🧾');
    const title = isSaving ? SAVING_LABEL : (cat ? cat.label : e.category);
    const sub = e.subcategory ? ' • ' + e.subcategory : '';
    const dateShown = new Date(e.entry_date).toLocaleDateString('ur-PK-u-nu-latn', { day:'numeric', month:'short' });

    const li = document.createElement('li');
    li.className = 'recent-item';
    li.dataset.id = e.id;
    li.innerHTML = `
      <div class="recent-left">
        <span class="recent-icon ${isSaving?'saving':''}">${icon}</span>
        <div>
          <div class="recent-title">${title}${sub}${e.note ? ' — ' + escapeHtml(e.note) : ''}</div>
          <div class="recent-meta">${dateShown} • درج کیا: ${escapeHtml(e.entered_by)}</div>
        </div>
      </div>
      <span class="recent-amount ${isSaving?'saving':''}">${fmtMoney(e.amount)}</span>
    `;
    li.addEventListener('click', ()=> openEditModal(e));
    list.appendChild(li);
  });
}

function escapeHtml(s){
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

/* ---------------- Entry modal ---------------- */
function buildCategoryFormOptions(){
  const sel = document.getElementById('entry-category');
  sel.innerHTML = '';
  CATEGORIES.forEach(c=>{
    const o = document.createElement('option');
    o.value = c.key; o.textContent = c.icon + ' ' + c.label;
    sel.appendChild(o);
  });
  sel.addEventListener('change', updateSubcategoryField);
}
function updateSubcategoryField(){
  const key = document.getElementById('entry-category').value;
  const c = catByKey(key);
  const wrap = document.getElementById('entry-sub-wrap');
  const sub = document.getElementById('entry-subcategory');
  if(c && c.subs){
    sub.innerHTML = '<option value="">— کوئی نہیں —</option>' + c.subs.map(s=>`<option value="${s}">${s}</option>`).join('');
    wrap.classList.remove('hidden');
  } else {
    sub.innerHTML = '';
    wrap.classList.add('hidden');
  }
}

function setEntryType(type){
  document.querySelectorAll('#entry-type-seg .seg-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.type === type);
  });
  document.getElementById('entry-cat-wrap').classList.toggle('hidden', type === 'saving');
  document.getElementById('entry-sub-wrap').classList.toggle('hidden', type === 'saving');
  document.getElementById('entry-modal-title').textContent = document.getElementById('entry-id').value
    ? (type === 'saving' ? '✎ بچت میں ترمیم' : '✎ خرچ میں ترمیم')
    : (type === 'saving' ? '＋ نئی بچت' : '＋ نیا خرچ');
}

function openAddModal(){
  document.getElementById('entry-form').reset();
  document.getElementById('entry-id').value = '';
  document.getElementById('entry-date').value = todayStr();
  document.getElementById('entry-delete').classList.add('hidden');
  setEntryType('expense');
  updateSubcategoryField();
  document.getElementById('entry-modal').classList.remove('hidden');
}

function openEditModal(entry){
  document.getElementById('entry-id').value = entry.id;
  document.getElementById('entry-amount').value = entry.amount;
  document.getElementById('entry-date').value = entry.entry_date;
  document.getElementById('entry-note').value = entry.note || '';
  setEntryType(entry.entry_type);
  if(entry.entry_type === 'expense'){
    document.getElementById('entry-category').value = entry.category;
    updateSubcategoryField();
    document.getElementById('entry-subcategory').value = entry.subcategory || '';
  }
  document.getElementById('entry-delete').classList.remove('hidden');
  document.getElementById('entry-modal').classList.remove('hidden');
}

function closeEntryModal(){
  document.getElementById('entry-modal').classList.add('hidden');
}

async function saveEntryForm(e){
  e.preventDefault();
  const id = document.getElementById('entry-id').value;
  const type = document.querySelector('#entry-type-seg .seg-btn.active').dataset.type;
  const amount = Number(document.getElementById('entry-amount').value);
  const date = document.getElementById('entry-date').value;
  const note = document.getElementById('entry-note').value.trim();

  if(!amount || amount <= 0){ showToast('براہ مہربانی درست رقم درج کریں'); return; }

  const payload = {
    household_id: cfg.householdId,
    entry_type: type,
    category: type === 'saving' ? 'بچت' : document.getElementById('entry-category').value,
    subcategory: type === 'saving' ? null : (document.getElementById('entry-subcategory').value || null),
    amount, note: note || null,
    entered_by: cfg.userName,
    entry_date: date,
  };

  let error;
  if(id){
    ({ error } = await sb.from('entries').update(payload).eq('id', id));
  } else {
    ({ error } = await sb.from('entries').insert(payload));
  }

  if(error){ showToast('محفوظ کرنے میں مسئلہ پیش آیا'); return; }
  closeEntryModal();
  showToast('محفوظ ہوگیا ✅');
  await loadMonth();
}

async function deleteCurrentEntry(){
  const id = document.getElementById('entry-id').value;
  if(!id) return;
  if(!confirm('کیا آپ واقعی یہ اندراج حذف کرنا چاہتے ہیں؟')) return;
  const { error } = await sb.from('entries').delete().eq('id', id);
  if(error){ showToast('حذف کرنے میں مسئلہ پیش آیا'); return; }
  closeEntryModal();
  showToast('حذف کر دیا گیا');
  await loadMonth();
}

/* ---------------- Settings modal ---------------- */
function buildBudgetFields(){
  const wrap = document.getElementById('budget-fields');
  wrap.innerHTML = '';
  CATEGORIES.forEach(c=>{
    const row = document.createElement('div');
    row.className = 'budget-field';
    row.innerHTML = `
      <label for="budget-${c.key}">${c.icon} ${c.label}</label>
      <input type="number" min="0" step="1" id="budget-${c.key}" dir="ltr" placeholder="حد نہیں">
    `;
    wrap.appendChild(row);
  });
}

function openSettingsModal(){
  document.getElementById('settings-income').value = state.income || '';
  document.getElementById('settings-saving-goal').value = state.budgets['saving_goal'] || '';
  CATEGORIES.forEach(c=>{
    const el = document.getElementById('budget-' + c.key);
    el.value = state.budgets[c.key] || '';
  });
  document.getElementById('household-code-box').textContent = cfg.householdId;
  document.getElementById('settings-modal').classList.remove('hidden');
}
function closeSettingsModal(){
  document.getElementById('settings-modal').classList.add('hidden');
}

async function saveIncome(){
  const val = Number(document.getElementById('settings-income').value) || 0;
  const { error } = await sb.from('household_settings')
    .update({ monthly_income: val, updated_at: new Date().toISOString() })
    .eq('household_id', cfg.householdId);
  if(error){ showToast('محفوظ کرنے میں مسئلہ پیش آیا'); return; }
  showToast('آمدن محفوظ ہوگئی ✅');
  await loadMonth();
}

async function saveBudgets(){
  const mk = monthKey(viewDate);
  const rows = CATEGORIES.map(c => {
    const v = document.getElementById('budget-' + c.key).value;
    return v ? { household_id: cfg.householdId, category: c.key, month: mk, limit_amount: Number(v) } : null;
  }).filter(Boolean);
  const catKeys = CATEGORIES.map(c => c.key);

  // صرف اسی مہینے کی مدات کا پرانا بجٹ ہٹائیں — بچت کا ہدف محفوظ رہے
  await sb.from('budgets').delete().eq('household_id', cfg.householdId).eq('month', mk).in('category', catKeys);
  if(rows.length){
    const { error } = await sb.from('budgets').insert(rows);
    if(error){ showToast('بجٹ محفوظ کرنے میں مسئلہ پیش آیا'); return; }
  }
  showToast('بجٹ محفوظ ہوگیا ✅');
  await loadMonth();
}

async function saveSavingGoal(){
  const mk = monthKey(viewDate);
  const val = Number(document.getElementById('settings-saving-goal').value) || 0;

  await sb.from('budgets').delete().eq('household_id', cfg.householdId).eq('month', mk).eq('category', 'saving_goal');
  if(val > 0){
    const { error } = await sb.from('budgets').insert({ household_id: cfg.householdId, category: 'saving_goal', month: mk, limit_amount: val });
    if(error){ showToast('بچت کا ہدف محفوظ کرنے میں مسئلہ پیش آیا'); return; }
  }
  showToast('بچت کا ہدف محفوظ ہوگیا ✅');
  await loadMonth();
}

function signOut(){
  if(!confirm('یہ صرف اس ڈیوائس سے سیٹ اپ ہٹائے گا، آپ کا ڈیٹا محفوظ رہے گا۔ جاری رکھیں؟')) return;
  localStorage.removeItem('ghk_config');
  location.reload();
}

/* ---------------- Month navigation ---------------- */
function changeMonth(delta){
  viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1);
  loadMonth();
}

/* ---------------- Wiring ---------------- */
function wireEvents(){
  document.getElementById('btn-add-entry').addEventListener('click', openAddModal);
  document.getElementById('entry-close').addEventListener('click', closeEntryModal);
  document.getElementById('entry-form').addEventListener('submit', saveEntryForm);
  document.getElementById('entry-delete').addEventListener('click', deleteCurrentEntry);
  document.querySelectorAll('#entry-type-seg .seg-btn').forEach(b=>{
    b.addEventListener('click', ()=> setEntryType(b.dataset.type));
  });

  document.getElementById('btn-settings').addEventListener('click', openSettingsModal);
  document.getElementById('btn-theme').addEventListener('click', toggleTheme);
  document.getElementById('settings-close').addEventListener('click', closeSettingsModal);
  document.getElementById('btn-save-income').addEventListener('click', saveIncome);
  document.getElementById('btn-save-saving-goal').addEventListener('click', saveSavingGoal);
  document.getElementById('btn-save-budgets').addEventListener('click', saveBudgets);
  document.getElementById('btn-signout').addEventListener('click', signOut);
  document.getElementById('btn-copy-code').addEventListener('click', ()=>{
    navigator.clipboard?.writeText(cfg.householdId);
    showToast('کوڈ کاپی ہوگیا');
  });

  document.getElementById('month-prev').addEventListener('click', ()=> changeMonth(-1));
  document.getElementById('month-next').addEventListener('click', ()=> changeMonth(1));

  [['entry-modal'],['settings-modal']].forEach(([id])=>{
    document.getElementById(id).addEventListener('click', (e)=>{
      if(e.target.id === id) document.getElementById(id).classList.add('hidden');
    });
  });
}

/* ---------------- Boot ---------------- */
window.addEventListener('DOMContentLoaded', async ()=>{
  wireEvents();
  initSetupScreen();
  initTheme();

  cfg = loadConfig();
  if(cfg && cfg.url && cfg.key && cfg.householdId){
    sb = supabase.createClient(cfg.url, cfg.key);
    await bootApp();
  } else {
    document.getElementById('setup-screen').classList.remove('hidden');
  }

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  }
});
