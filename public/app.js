/**
 * Daylo Productivity App - Core Application Engine
 * Figma Design: Dark navy #1A2447 sidebar, #F6F8FA background, #FFFFFF cards border #E8ECF2 rounded 16px, font Inter.
 * Preserves all original functions, IDs, and logic, augmented with the AI Limit System.
 */

const appName = 'Daylo';

// Global AI plan limits
window.PLAN_LIMITS = {
  free: { minutes: 60, messages: 90, price: 0, label: 'Free' },
  pro: { minutes: 300, messages: 450, price: 2500, label: 'Pro' },
  premium: { minutes: 999999, messages: 999999, price: 5000, label: 'Premium' }
};

window.FIREBASE_CONFIG = window.FIREBASE_CONFIG || {};

let N8N_WEBHOOKS = {
  assistant: 'https://dataknight.app.n8n.cloud/webhook/founder-assistant',
  insights: 'https://dataknight.app.n8n.cloud/webhook/flowday-insights',
  contactForm: 'https://dataknight.app.n8n.cloud/webhook/flowday-contact',
  flowdayInsights: 'https://dataknight.app.n8n.cloud/webhook/flowday-insights',
  flowdayContact: 'https://dataknight.app.n8n.cloud/webhook/flowday-contact'
};

const N8N_METHODS = {
  assistant: 'POST',
  insights: 'POST',
  contactForm: 'POST'
};

const EP = {
  assistant: 'assistant',
  insights: 'insights',
  contactForm: 'contactForm'
};

const mem = {}, LS = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return mem[k] || null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { delete mem[k]; } }
};

const $ = s => document.querySelector(s), root = $('#root');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));

let user = null, tasks = [], P = { peak: true, bias: true, eve: true }, page = 'home', sel = 0, q = '', fp = 'all', sortBy = 'score', gcal = false, GB = [], chat = [], nid = 1;
let notifications = [], notifUnsubscribe = null, tasksUnsubscribe = null, notifOpen = false;

const fbOn = () => !!(window.FB && window.FB.ok);
const live = () => fbOn();
const remote = () => live() && user && !!user.uid;

/**
 * handleFirestoreError(err)
 * Standardized Firestore error handler conforming to firebase-integration-rpc skill.
 */
/**
 * handleFirestoreError(err, operation, path)
 * Standardized Firestore error handler conforming to firebase-integration-rpc skill.
 */
function handleFirestoreError(err, operation, path) {
  const F = window.FB;
  const auth = F && F.auth ? F.auth.currentUser : null;
  const errorInfo = {
    error: err.message || String(err),
    operationType: operation || 'unknown',
    path: path || null,
    authInfo: {
      userId: auth ? auth.uid : null,
      email: auth ? auth.email : null,
      emailVerified: auth ? auth.emailVerified : null,
      isAnonymous: auth ? auth.isAnonymous : false,
      providerInfo: auth ? auth.providerData.map(p => ({ providerId: p.providerId, email: p.email })) : []
    }
  };
  console.error(`Firestore Error [${operation}]:`, errorInfo);
  throw new Error(JSON.stringify(errorInfo));
}

async function api(k, { body, query } = {}) {
  if (!live() && k !== 'contactForm') return { ok: false, demo: true };
  const key = EP[k] || k, url = N8N_WEBHOOKS[key], method = N8N_METHODS[key] || 'POST';
  if (!url || url.startsWith('YOUR_N8N_') || url === '') {
    return { ok: false, error: 'Webhook for "' + key + '" is not configured. Please set it up in the Admin Portal.' };
  }
  let target = url;
  if (query) target += (target.includes('?') ? '&' : '?') + new URLSearchParams(query);
  let tok = '';
  try {
    if (window.FB && window.FB.auth && window.FB.auth.currentUser) {
      tok = await window.FB.auth.currentUser.getIdToken(true);
    }
  } catch (e) {
    try {
      if (window.FB && window.FB.auth && window.FB.auth.currentUser) {
        tok = await window.FB.auth.currentUser.getIdToken(false);
      }
    } catch (_) {}
  }

  let postBody = body;
  if (method === 'POST' && body && typeof body === 'object') {
    postBody = { ...body };
    if (tok) {
      if (!postBody.token) postBody.token = tok;
      if (!postBody.id_token) postBody.id_token = tok;
    }
  }

  try {
    const c = new AbortController(), tm = setTimeout(() => c.abort(), 30000);
    const h = {};
    if (tok) h['Authorization'] = 'Bearer ' + tok;
    if (method === 'POST') h['Content-Type'] = 'application/json';
    const r = await fetch(target, { method, headers: h, body: method === 'POST' ? JSON.stringify(postBody || {}) : undefined, signal: c.signal });
    clearTimeout(tm);
    const t = await r.text();
    let d = t;
    try { d = JSON.parse(t); } catch (_) {}
    if (!r.ok && r.status === 401) {
      const detail = (d && (d.error || d.message)) || 'Unauthorized';
      return {
        ok: false,
        data: d,
        status: r.status,
        error: `n8n Webhook returned 401 (${detail}). Check that the Webhook node in n8n has Authentication set to "None" or accepts your Firebase token.`
      };
    }
    return { ok: r.ok, data: d, status: r.status };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/* ============================================================
   TASK 2: AI LIMIT SYSTEM
   ============================================================ */
function getUserAIState() {
  const emailKey = user ? user.email : 'guest';
  const raw = LS.get('daylo_ai_' + emailKey);
  const sessionPlan = (user && user.plan) || 'free';
  const sessionLimit = (user && user.aiLimit) || (sessionPlan === 'premium' ? 999999 : sessionPlan === 'pro' ? 300 : 60);

  let state = {
    aiMinutesUsed: 0,
    aiLimit: sessionLimit,
    totalAIRequests: 0,
    plan: sessionPlan,
    email: emailKey,
    name: user ? user.name : 'Guest User',
    createdAt: new Date().toISOString()
  };

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      state = { ...state, ...parsed };
      // If user session has an upgraded plan but local raw was free, prefer the session's plan
      if (sessionPlan !== 'free' && state.plan === 'free') {
        state.plan = sessionPlan;
        state.aiLimit = sessionLimit;
      }
    } catch (e) {}
  }
  return state;
}

function saveUserAIState(state) {
  const emailKey = user ? user.email : 'guest';
  LS.set('daylo_ai_' + emailKey, JSON.stringify(state));
  if (user) {
    user.plan = state.plan;
    user.aiLimit = state.aiLimit;
    try {
      LS.set('daylo_session', JSON.stringify(user));
    } catch (_) {}
  }
  if (remote() && window.FB && window.FB.db && user && user.uid) {
    try {
      const F = window.FB;
      F.setDoc(F.doc(F.db, 'users', user.uid), {
        aiMinutesUsed: state.aiMinutesUsed,
        aiLimit: state.aiLimit,
        totalAIRequests: state.totalAIRequests,
        plan: state.plan,
        email: state.email,
        name: state.name,
        updatedAt: new Date().toISOString()
      }, { merge: true }).catch(err => console.warn('Could not sync AI usage to Firestore:', err));
    } catch (err) {
      console.warn('Could not sync AI usage to Firestore:', err);
    }
  }
}

/* ============================================================
   NOTIFICATION SYSTEM
   ============================================================ */
function loadNotifications() {
  if (!remote()) return;
  if (notifUnsubscribe) notifUnsubscribe();
  
  const F = window.FB;
  const q = F.query(
    F.collection(F.db, 'users', user.uid, 'notifications'),
    F.orderBy('createdAt', 'desc'),
    F.limit(20)
  );
  
  notifUnsubscribe = F.onSnapshot(q, (snap) => {
    notifications = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    render();
  }, (err) => {
    console.error("Notifications error:", err);
  });
}

async function markNotifRead(id) {
  if (!remote()) return;
  const F = window.FB;
  try {
    await F.updateDoc(F.doc(F.db, 'users', user.uid, 'notifications', id), { read: true });
  } catch (err) {
    handleFirestoreError(err, 'update', 'notifications');
  }
}

async function markAllNotifsRead() {
  if (!remote()) return;
  const F = window.FB;
  const unread = notifications.filter(n => !n.read);
  if (!unread.length) return;
  
  try {
    const batch = F.writeBatch(F.db);
    unread.forEach(n => {
      const ref = F.doc(F.db, 'users', user.uid, 'notifications', n.id);
      batch.update(ref, { read: true });
    });
    await batch.commit();
    toast('All notifications marked as read.');
  } catch (err) {
    handleFirestoreError(err, 'write', 'notifications');
  }
}

function toggleNotifPanel(e) {
  if (e) e.stopPropagation();
  notifOpen = !notifOpen;
  render();
}

function timeAgo(date) {
  if (!date) return '';
  const seconds = Math.floor((new Date() - (date.toDate ? date.toDate() : new Date(date))) / 1000);
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + "y ago";
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + "mo ago";
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + "d ago";
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + "h ago";
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + "m ago";
  return "just now";
}

function notifItem(n) {
  const icons = { daily_summary: '📋', task_reminder: '🔔', task_overdue: '⚠️' };
  const colors = { daily_summary: 'bg-blue-50 text-blue-600', task_reminder: 'bg-emerald-50 text-emerald-600', task_overdue: 'bg-red-50 text-red-600' };
  const icon = icons[n.type] || '📩';
  const color = colors[n.type] || 'bg-gray-50 text-gray-600';
  
  return `
    <div class="p-3 sm:p-3.5 border-b border-[#E8ECF2] hover:bg-[#F6F8FA] transition relative group cursor-pointer ${n.read ? 'opacity-70 bg-white' : 'bg-[#EBF5F0]/30'}" onclick="${n.link ? `go('${n.link}')` : ''}">
      <div class="flex items-start gap-2.5 sm:gap-3">
        <div class="w-8 h-8 sm:w-9 sm:h-9 rounded-xl ${color} flex items-center justify-center text-base sm:text-lg flex-none mt-0.5">
          ${icon}
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex justify-between items-start gap-2 mb-1">
            <h4 class="text-xs font-bold text-[#1A2447] truncate">${esc(n.title)}</h4>
            ${!n.read ? `<button onclick="event.stopPropagation(); markNotifRead('${n.id}')" class="text-[10px] font-bold text-[#2CA67A] hover:underline flex-none whitespace-nowrap cursor-pointer">Mark read</button>` : ''}
          </div>
          <p class="text-[11px] text-[#697386] line-clamp-3 mb-1.5 break-words leading-relaxed">${esc(n.message)}</p>
          <div class="text-[10px] text-[#8A91A0] font-semibold">${timeAgo(n.createdAt)}</div>
        </div>
      </div>
      ${!n.read ? '<div class="absolute right-2.5 bottom-2.5 w-2 h-2 rounded-full bg-[#2CA67A]"></div>' : ''}
    </div>
  `;
}

/**
 * checkAILimit()
 * Returns true if user has remaining minutes, false if used >= limit
 */
function checkAILimit() {
  const state = getUserAIState();
  if (state.aiLimit >= 999999) {
    enableAIInput();
    return true;
  }
  if (state.aiMinutesUsed >= state.aiLimit) {
    showUpgradeModal();
    disableAIInput();
    return false;
  }
  enableAIInput();
  return true;
}

/**
 * trackAIUsage(minutes)
 * Increments usage by given minutes (default 1 min), updates storage & firestore
 */
function trackAIUsage(minutes = 1) {
  const state = getUserAIState();
  state.aiMinutesUsed = Math.min(state.aiLimit + 10, (state.aiMinutesUsed || 0) + minutes);
  state.totalAIRequests = (state.totalAIRequests || 0) + 1;
  saveUserAIState(state);
  updateHeaderUsageBar();
  if (state.aiLimit < 999999 && state.aiMinutesUsed >= state.aiLimit) {
    disableAIInput();
  }
}

function disableAIInput() {
  const state = getUserAIState();
  const planInfo = window.PLAN_LIMITS[state.plan] || window.PLAN_LIMITS.free;
  const input = $('#chatInput');
  const btn = $('#chatSendBtn');
  const overlay = $('#chatOverlay');
  if (input) {
    input.disabled = true;
    input.placeholder = `${planInfo.label} AI limit reached (${state.aiLimit} mins). Upgrade to continue.`;
  }
  if (btn) btn.disabled = true;
  if (overlay) overlay.classList.remove('hidden');
}

function enableAIInput() {
  const input = $('#chatInput');
  const btn = $('#chatSendBtn');
  const overlay = $('#chatOverlay');
  if (input) {
    input.disabled = false;
    input.placeholder = "Tell Ashley what changed...";
  }
  if (btn) btn.disabled = false;
  if (overlay) overlay.classList.add('hidden');
}

function updateHeaderUsageBar() {
  const state = getUserAIState();
  const el = $('#headerUsageBar');
  if (!el) return;
  const planInfo = window.PLAN_LIMITS[state.plan] || window.PLAN_LIMITS.free;
  const isUnlimited = state.aiLimit >= 999999;
  const pct = isUnlimited ? 10 : Math.min(100, Math.round((state.aiMinutesUsed / state.aiLimit) * 100));
  const displayLimit = isUnlimited ? '∞' : `${state.aiLimit}m`;
  const isCritical = !isUnlimited && pct >= 90;

  el.innerHTML = `
    <div class="flex items-center gap-1.5 sm:gap-2.5 bg-[#F0F3F8] hover:bg-[#E8ECF2] transition px-2 py-1 sm:px-3 sm:py-1.5 rounded-xl border border-[#E8ECF2] cursor-pointer" onclick="showUpgradeModal()" title="Ashley AI Chat Usage (${state.aiMinutesUsed}/${displayLimit}) - All other features are 100% free without limits">
      <div class="flex items-center gap-1 text-[10px] sm:text-xs font-semibold text-[#1A2447]">
        <span class="inline-block w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${isCritical ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}"></span>
        <span>AI Chat: ${state.aiMinutesUsed}/${displayLimit}</span>
      </div>
      <div class="hidden sm:block w-12 md:w-16 h-2 bg-[#DCE2EC] rounded-full overflow-hidden">
        <div class="h-full rounded-full transition-all duration-500 ${isCritical ? 'bg-red-500' : 'bg-[#2CA67A]'}" style="width: ${pct}%"></div>
      </div>
      <span class="text-[9px] sm:text-[10px] font-bold uppercase px-1.5 py-0.5 sm:px-2 rounded-full ${state.plan === 'premium' ? 'bg-amber-100 text-amber-800' : state.plan === 'pro' ? 'bg-[#EBF5F0] text-[#2CA67A]' : 'bg-gray-200 text-gray-700'}">
        ${planInfo.label}
      </span>
    </div>
  `;
}

function showUpgradeModal() {
  const existing = $('#upgradeModal');
  if (existing) existing.remove();

  const state = getUserAIState();
  const modal = document.createElement('div');
  modal.id = 'upgradeModal';
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#111827]/60 backdrop-blur-xs transition-opacity animate-fade-in';
  modal.innerHTML = `
    <div class="bg-white rounded-2xl max-w-4xl w-full p-6 md:p-8 border border-[#E8ECF2] shadow-2xl relative max-h-[92vh] overflow-y-auto">
      <button class="absolute top-5 right-5 text-[#697386] hover:text-[#172033] w-9 h-9 rounded-xl bg-[#F6F8FA] flex items-center justify-center font-bold text-lg cursor-pointer" onclick="this.closest('#upgradeModal').remove()">✕</button>
      
      <div class="text-center max-w-xl mx-auto mb-6">
        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[#EBF5F0] text-[#2CA67A] mb-2">✦ Supercharge Your Productivity</span>
        <h2 class="text-2xl md:text-3xl font-extrabold text-[#1A2447]">Daylo Plans & AI Chat Limits</h2>
        <p class="text-[#697386] text-xs sm:text-sm mt-1">Choose the Ashley AI chat limit that matches your workday. Core features remain 100% free.</p>
        
        <div class="mt-3 p-2.5 rounded-xl bg-emerald-50/80 border border-emerald-200 inline-flex items-center gap-2 text-xs text-emerald-900 font-medium text-left">
          <span>✨</span>
          <span><b>All Core Features Free:</b> Tasks, Auto-Planning, Calendar sync, and Energy insights are <b>completely free and unlimited</b> on all plans!</span>
        </div>

        <div class="mt-3 p-3 rounded-xl bg-[#F6F8FA] border border-[#E8ECF2] inline-flex items-center gap-3 text-xs text-[#1A2447]">
          <span>Current AI Chat usage: <b>${state.aiMinutesUsed} / ${state.aiLimit >= 999999 ? '∞' : state.aiLimit + ' mins'}</b></span>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${state.plan === 'premium' ? 'bg-amber-100 text-amber-800' : state.plan === 'pro' ? 'bg-[#EBF5F0] text-[#2CA67A]' : 'bg-gray-200 text-gray-700'}">${state.plan} Plan</span>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
        <!-- Free Plan -->
        <div class="rounded-2xl border ${state.plan === 'free' ? 'border-[#2CA67A] ring-2 ring-[#2CA67A]/20 bg-[#F6F8FA]' : 'border-[#E8ECF2] bg-white'} p-6 flex flex-col justify-between shadow-xs">
          <div>
            <div class="flex justify-between items-center mb-2">
              <h3 class="font-bold text-lg text-[#1A2447]">Free Plan</h3>
              ${state.plan === 'free' ? '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#2CA67A] text-white">Active</span>' : ''}
            </div>
            <div class="text-3xl font-black text-[#1A2447] mb-1">₦0</div>
            <p class="text-xs text-[#697386] mb-4">Forever free for personal focus</p>
            <ul class="space-y-2.5 text-xs text-[#172033] mb-6">
              <li class="flex items-center gap-2"><span class="text-emerald-500 font-bold">✓</span> <b>60 mins</b> Ashley AI Chat/month</li>
              <li class="flex items-center gap-2"><span class="text-emerald-500 font-bold">✓</span> <b>90</b> Ashley messages/month</li>
              <li class="flex items-center gap-2"><span class="text-emerald-500 font-bold">✓</span> <b>Unlimited tasks</b> (100% free)</li>
              <li class="flex items-center gap-2"><span class="text-emerald-500 font-bold">✓</span> <b>Unlimited Auto-Planning</b> (100% free)</li>
              <li class="flex items-center gap-2"><span class="text-emerald-500 font-bold">✓</span> Google Calendar integration</li>
            </ul>
          </div>
          <button class="w-full py-2.5 rounded-xl text-xs font-bold ${state.plan === 'free' ? 'border border-emerald-200 text-emerald-700 bg-emerald-50 cursor-default' : 'border border-[#E8ECF2] text-[#697386] bg-gray-50 hover:bg-gray-100 cursor-pointer'}" onclick="upgradePlan('free')">
            ${state.plan === 'free' ? 'Active Plan ✓' : 'Switch to Free'}
          </button>
        </div>

        <!-- Pro Plan -->
        <div class="rounded-2xl border-2 ${state.plan === 'pro' ? 'border-[#2CA67A] ring-2 ring-[#2CA67A]/20 bg-[#F6F8FA]' : 'border-[#1A2447] bg-white shadow-lg relative'} p-6 flex flex-col justify-between">
          <div class="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#1A2447] text-white text-[10px] font-extrabold uppercase tracking-wider px-3 py-0.5 rounded-full shadow-sm">
            Most Popular
          </div>
          <div>
            <div class="flex justify-between items-center mb-2">
              <h3 class="font-bold text-lg text-[#1A2447]">Pro Plan</h3>
              ${state.plan === 'pro' ? '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#2CA67A] text-white">Active</span>' : '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#EBF5F0] text-[#2CA67A]">Recommended</span>'}
            </div>
            <div class="text-3xl font-black text-[#1A2447] mb-1">₦2,500 <span class="text-xs font-normal text-[#697386]">/month</span></div>
            <p class="text-xs text-[#697386] mb-4">For busy founders & professionals</p>
            <ul class="space-y-2.5 text-xs text-[#172033] mb-6">
              <li class="flex items-center gap-2"><span class="text-[#2CA67A] font-bold">✓</span> <b>300 mins</b> Ashley AI Chat/month</li>
              <li class="flex items-center gap-2"><span class="text-[#2CA67A] font-bold">✓</span> <b>450</b> Ashley messages/month</li>
              <li class="flex items-center gap-2"><span class="text-[#2CA67A] font-bold">✓</span> <b>Unlimited tasks & planning</b></li>
              <li class="flex items-center gap-2"><span class="text-[#2CA67A] font-bold">✓</span> Live Google Calendar sync</li>
              <li class="flex items-center gap-2"><span class="text-[#2CA67A] font-bold">✓</span> Personalized peak hours learning</li>
            </ul>
          </div>
          <button class="w-full py-2.5 rounded-xl text-xs font-bold ${state.plan === 'pro' ? 'border border-emerald-200 text-emerald-700 bg-emerald-50 cursor-default' : 'text-white bg-[#1A2447] hover:bg-[#2A376B] shadow-md shadow-[#1A2447]/20 cursor-pointer'} transition" onclick="upgradePlan('pro')">
            ${state.plan === 'pro' ? 'Active Plan ✓' : 'Upgrade to Pro (₦2,500/mo)'}
          </button>
        </div>

        <!-- Premium Plan -->
        <div class="rounded-2xl border ${state.plan === 'premium' ? 'border-amber-500 ring-2 ring-amber-500/20 bg-[#FFFDF9]' : 'border-[#E8ECF2] bg-white'} p-6 flex flex-col justify-between shadow-xs">
          <div>
            <div class="flex justify-between items-center mb-2">
              <h3 class="font-bold text-lg text-[#1A2447]">Premium</h3>
              ${state.plan === 'premium' ? '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500 text-white">Active</span>' : '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Unlimited</span>'}
            </div>
            <div class="text-3xl font-black text-[#1A2447] mb-1">₦5,000 <span class="text-xs font-normal text-[#697386]">/month</span></div>
            <p class="text-xs text-[#697386] mb-4">Unlimited AI power & priority execution</p>
            <ul class="space-y-2.5 text-xs text-[#172033] mb-6">
              <li class="flex items-center gap-2"><span class="text-amber-500 font-bold">✓</span> <b>Unlimited Ashley AI Chat (999,999 mins)</b></li>
              <li class="flex items-center gap-2"><span class="text-amber-500 font-bold">✓</span> <b>Unlimited Ashley messages</b></li>
              <li class="flex items-center gap-2"><span class="text-amber-500 font-bold">✓</span> Unlimited tasks, planning & calendar</li>
              <li class="flex items-center gap-2"><span class="text-amber-500 font-bold">✓</span> Priority n8n workflow execution</li>
              <li class="flex items-center gap-2"><span class="text-amber-500 font-bold">✓</span> Direct developer support</li>
            </ul>
          </div>
          <button class="w-full py-2.5 rounded-xl text-xs font-bold ${state.plan === 'premium' ? 'border border-amber-300 text-amber-800 bg-amber-50 cursor-default' : 'text-white bg-[#1A2447] hover:bg-[#2A376B] shadow-md cursor-pointer'} transition" onclick="upgradePlan('premium')">
            ${state.plan === 'premium' ? 'Active Plan ✓' : 'Get Unlimited Premium (₦5,000/mo)'}
          </button>
        </div>
      </div>
      
      <div class="text-center mt-6 text-xs text-[#697386]">
        Secure payments powered by Paystack. Upgrades take effect immediately across your workspace.
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

const PAYSTACK_LINKS = {
  pro: "https://paystack.shop/pay/ug-96czjsq",
  premium: "https://paystack.shop/pay/ellh5-mvog"
};

async function activatePlan(planKey, options = {}) {
  const planInfo = window.PLAN_LIMITS[planKey];
  if (!planInfo) return;

  const emailKey = user ? user.email : 'guest';
  const state = getUserAIState();
  state.plan = planKey;
  state.aiLimit = planInfo.minutes;
  if (state.aiMinutesUsed > state.aiLimit) {
    state.aiMinutesUsed = 0;
  }
  state.updatedAt = new Date().toISOString();
  saveUserAIState(state);

  if (user) {
    user.plan = planKey;
    user.aiLimit = planInfo.minutes;
    try {
      LS.set('daylo_session', JSON.stringify(user));
    } catch (_) {}
  }

  try {
    if (emailKey && emailKey !== 'guest') {
      const uMap = JSON.parse(localStorage.getItem('daylo_users') || '{}');
      if (!uMap[emailKey.toLowerCase()]) uMap[emailKey.toLowerCase()] = {};
      uMap[emailKey.toLowerCase()].plan = planKey;
      uMap[emailKey.toLowerCase()].aiLimit = planInfo.minutes;
      localStorage.setItem('daylo_users', JSON.stringify(uMap));
    }
  } catch (_) {}

  // Sync to Firestore if remote
  if (remote() && window.FB && window.FB.db && user && user.uid) {
    try {
      const F = window.FB;
      await F.setDoc(F.doc(F.db, 'users', user.uid), {
        plan: planKey,
        aiLimit: planInfo.minutes,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      await F.addDoc(F.collection(F.db, 'users', user.uid, 'notifications'), {
        title: `🎉 ${planInfo.label} Plan Activated`,
        message: `Your account is now upgraded to ${planInfo.label} (${planInfo.minutes >= 999999 ? 'Unlimited' : planInfo.minutes + ' mins'} Ashley AI chat). Your new limits are active across your workspace!`,
        type: 'daily_summary',
        createdAt: new Date().toISOString(),
        read: false
      });
    } catch (e) {
      console.warn('Could not sync upgrade to Firestore:', e);
    }
  }

  updateHeaderUsageBar();
  enableAIInput();

  const m = $('#upgradeModal');
  if (m) m.remove();

  if (options.showSuccessModal) {
    showPlanSuccessModal(planKey);
  } else {
    toast(`🎉 Upgraded to ${planInfo.label} Plan! Limits set to ${planInfo.minutes >= 999999 ? 'Unlimited' : planInfo.minutes + ' mins'}.`);
  }

  render();
}

function upgradePlan(planKey) {
  const planInfo = window.PLAN_LIMITS[planKey];
  if (!planInfo) return;

  const curState = getUserAIState();
  if (curState.plan === planKey) {
    toast(`You are already on the ${planInfo.label} plan.`);
    return;
  }

  activatePlan(planKey, { showSuccessModal: true });
}

function showPlanSuccessModal(planKey) {
  const planInfo = window.PLAN_LIMITS[planKey] || window.PLAN_LIMITS.pro;
  const paystackUrl = PAYSTACK_LINKS[planKey];
  const existing = document.getElementById('planSuccessModal');
  if (existing) existing.remove();

  const m = document.createElement('div');
  m.id = 'planSuccessModal';
  m.className = 'fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#111827]/70 backdrop-blur-xs animate-fade-in';
  m.innerHTML = `
    <div class="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 border border-[#E8ECF2] shadow-2xl text-center relative overflow-hidden">
      <div class="w-16 h-16 rounded-2xl ${planKey === 'premium' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'} flex items-center justify-center text-3xl font-black mx-auto mb-4 shadow-sm">
        ${planKey === 'premium' ? '👑' : '🎉'}
      </div>

      <span class="inline-block px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider ${planKey === 'premium' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'} mb-2">
        Upgrade Successful & Effective
      </span>

      <h3 class="text-xl sm:text-2xl font-black text-[#1A2447] mb-2">Welcome to Daylo ${planInfo.label}!</h3>
      
      <p class="text-xs sm:text-sm text-[#697386] mb-6 leading-relaxed">
        Your plan upgrade is <b>now active</b> on your dashboard. You have <b>${planInfo.minutes >= 999999 ? 'Unlimited' : planInfo.minutes + ' minutes'}</b> of Ashley AI chat, priority auto-planning, and protected focus windows.
      </p>

      <div class="p-3.5 rounded-2xl bg-[#F6F8FA] border border-[#E8ECF2] mb-6 text-xs text-left space-y-2.5">
        <div class="flex justify-between items-center">
          <span class="text-[#697386]">Active Plan:</span>
          <b class="text-[#1A2447] uppercase">${planInfo.label}</b>
        </div>
        <div class="flex justify-between items-center">
          <span class="text-[#697386]">Ashley AI Chat Limit:</span>
          <b class="text-[#2CA67A]">${planInfo.minutes >= 999999 ? 'Unlimited (∞)' : planInfo.minutes + ' mins/month'}</b>
        </div>
        <div class="flex justify-between items-center">
          <span class="text-[#697386]">Dashboard Status:</span>
          <b class="text-emerald-600 font-bold">Active & Synchronized ✓</b>
        </div>
      </div>

      <div class="space-y-2.5">
        <button onclick="document.getElementById('planSuccessModal').remove(); if(page !== 'dashboard') go('dashboard'); else render();" class="w-full py-3 rounded-xl bg-[#1A2447] text-white text-xs font-bold hover:bg-[#2A376B] transition shadow-md cursor-pointer">
          Continue to Dashboard →
        </button>
        ${paystackUrl && planKey !== 'free' ? `
          <a href="${paystackUrl}" target="_blank" rel="noopener" class="block w-full py-2.5 rounded-xl border border-[#E8ECF2] text-xs font-semibold text-[#697386] hover:text-[#1A2447] hover:bg-gray-50 transition text-center">
            View / Complete Paystack Payment Checkout (₦${planInfo.price.toLocaleString()}) ↗
          </a>
        ` : ''}
      </div>
    </div>
  `;
  document.body.appendChild(m);
}

function checkUrlPlanUpgrade() {
  try {
    const params = new URLSearchParams(window.location.search);
    const planParam = (params.get('plan') || params.get('upgraded') || params.get('tier') || '').toLowerCase();
    const trxref = params.get('trxref') || params.get('reference');
    const status = params.get('status');

    let targetPlan = null;
    if (planParam === 'pro' || planParam === 'premium' || planParam === 'free') {
      targetPlan = planParam;
    } else if (trxref || status === 'success') {
      targetPlan = 'pro';
    }

    if (targetPlan) {
      activatePlan(targetPlan, { showSuccessModal: true });
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  } catch (e) {
    console.warn('URL plan check error:', e);
  }
}

/* ============================================================
   FOUNDER AI ASSISTANT PLANNING ENGINE
   ============================================================ */
const conf = k => { const u = N8N_WEBHOOKS[EP[k] || k]; return !!u && !String(u).startsWith('YOUR_N8N_'); };
let autoPlanned = false;
const gbISO = g => {
  const [y, m, d] = g.k.split('-'), a = new Date(y, m - 1, d, 0, 0).getTime();
  return { summary: g.t, start: new Date(a + g.s * 36e5).toISOString(), end: new Date(a + g.e * 36e5).toISOString() };
};

async function requestFounderPlan(message = "Plan my day") {
  if (!remote()) {
    return toast('Log in to use AI planning.');
  }

  let freshToken = '';
  try {
    if (window.FB && window.FB.auth && window.FB.auth.currentUser) {
      freshToken = await window.FB.auth.currentUser.getIdToken(true);
    }
  } catch (e) {
    console.warn('Failed to get fresh ID token:', e);
  }

  const url = N8N_WEBHOOKS.assistant || 'https://dataknight.app.n8n.cloud/webhook/founder-assistant';
  toast('Ashley is planning your day…');

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(freshToken ? { 'Authorization': 'Bearer ' + freshToken } : {})
      },
      body: JSON.stringify({
        message: message,
        prompt: message,
        text: message,
        action: 'plan',
        founder_id: user.uid,
        user_id: user.uid,
        id_token: freshToken,
        token: freshToken
      })
    });

    if (res.status === 401) {
      console.warn('Founder plan 401 Unauthorized - falling back to local auto-slotting');
    }

    let data = null;
    try {
      const text = await res.text();
      try { data = JSON.parse(text); } catch (_) { data = text; }
    } catch (_) {}

    if (!res.ok) {
      const errorDetail = (data && typeof data === 'object' && (data.error || data.message || data.details)) || `HTTP ${res.status}`;
      console.warn(`Founder plan response (${res.status}):`, errorDetail);
      // Auto-schedule unslotted tasks locally when webhook is unavailable or unauthorized
      let slottedCount = 0;
      tasks.forEach(t => {
        if (t.status === 'open' && !t.slot) {
          t.slot = findSlot(t);
          if (t.slot) {
            slottedCount++;
            saveSlot(t);
          }
        }
      });
      if (slottedCount) {
        toast(`Ashley arranged ${slottedCount} task${slottedCount > 1 ? 's' : ''} on your schedule.`);
      } else {
        toast('Ashley reviewed your schedule: priorities are protected.');
      }
      render();
      return;
    }

    const replyText = data && (data.reply || data.output || data.text || (typeof data === 'string' ? data : JSON.stringify(data)));

    if (replyText) {
      const formattedReply = String(replyText).replace(/\n/g, '<br>');
      chat.push({ r: 'ai', t: formattedReply });
      toast('Plan updated by Ashley ✓');
    }

    // Re-fetch founder's tasks silently from Firestore
    await syncTasks({ silent: true });
    render();
  } catch (err) {
    console.warn('Founder plan network error:', err);
    // Local fallback
    let slottedCount = 0;
    tasks.forEach(t => {
      if (t.status === 'open' && !t.slot) {
        t.slot = findSlot(t);
        if (t.slot) {
          slottedCount++;
          saveSlot(t);
        }
      }
    });
    if (slottedCount) {
      toast(`Ashley arranged ${slottedCount} task${slottedCount > 1 ? 's' : ''} on your schedule.`);
    } else {
      toast('Ashley checked your schedule: priorities are protected.');
    }
    render();
  }
}

async function planTasks() {
  await requestFounderPlan("Plan my day");
}

async function proposeMissing() {
  await syncTasks();
}

async function saveSlot(t) {
  if (!remote() || !t.slot) return;
  const F = window.FB, s = slotISO(t.slot);
  try {
    await F.updateDoc(F.doc(F.db, 'tasks', String(t.id)), {
      status: 'open',
      scheduled_start: s.start_iso,
      scheduled_end: s.end_iso,
      google_event_id: t.eid || null
    });
  } catch (e) {
    handleFirestoreError(e, 'update', 'tasks');
  }
}

async function confirmSlot(t, reason) {
  await syncSlot(t);
  await saveSlot(t);
}

/* ===== time, calendar and urgency ===== */
const dk = d => d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
const DAYS = (() => {
  const a = [], d = new Date();
  d.setHours(0, 0, 0, 0);
  while (a.length < 7) {
    if (d.getDay() % 6) a.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return a;
})();
const dIdx = k => DAYS.findIndex(d => dk(d) === k);
const isToday = i => dk(DAYS[i]) === dk(new Date());
const slDay = k => {
  const [y, m, d] = k.split('-'), dt = new Date(y, m - 1, d);
  return dk(dt) === dk(new Date()) ? 'Today' : dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};
const f = h => {
  const x = Math.floor(h);
  return (x > 12 ? x - 12 : x) + ':' + (h % 1 ? '30' : '00');
};
const sl = p => slDay(p.k) + ' ' + f(p.s) + '–' + f(p.s + p.len);
const at = (off, h) => {
  const d = new Date();
  d.setDate(d.getDate() + off);
  d.setHours(h, 0, 0, 0);
  return d;
};
const nowH = () => {
  const n = new Date();
  return n.getHours() + n.getMinutes() / 60;
};
const MEET = {
  1: [['Team sync', 14, 15]],
  2: [['Weekly sync', 14, 15]],
  3: [['Co-founder 1:1', 15, 16]],
  4: [['Design review', 10, 11]],
  5: [['Demo rehearsal', 14, 16]]
};
const meets = i => gcal ? GB.filter(g => g.k === dk(DAYS[i])).map(g => [g.t, g.s, g.e]) : (MEET[DAYS[i].getDay()] || []);
const adj = t => P.bias ? Math.ceil(t.dur * (P.mult || 1.5) * 2) / 2 : t.dur;
const inPk = x => x >= P.pk[0] && x < P.pk[1];
const pkLabel = () => {
  const h = x => x > 12 ? x - 12 : x, a = P.pk[0], b = P.pk[1];
  return h(a) + '–' + h(b) + (b <= 12 ? ' AM' : a >= 12 ? ' PM' : '');
};
const dl = t => Math.max((new Date(t.due) - new Date()) / 864e5, .5);
const parts = t => {
  const d = dl(t), D = Math.min(1, Math.max(0, 1 - (d - .5) / 14)), I = (t.prio - 1) / 2, E = Math.min(1, adj(t) / (d * 2) + .4 * (t.miss || 0));
  return { D: Math.round(40 * D), I: Math.round(30 * I), E: Math.round(30 * E) };
};
const score = t => {
  const p = parts(t);
  return p.D + p.I + p.E;
};
const dueTxt = t => 'Due ' + new Date(t.due).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const pub = t => ({
  id: t.id,
  title: t.title,
  kind: t.kind,
  project: t.project,
  due: t.due,
  duration_hours: t.dur,
  priority: t.prio,
  status: t.status,
  urgency: score(t),
  slot: t.slot ? slotISO(t.slot) : null
});

function slotISO(s) {
  const [y, m, d] = s.k.split('-'), a = new Date(y, m - 1, d, 0, 0).getTime();
  return {
    start_iso: new Date(a + s.s * 36e5).toISOString(),
    end_iso: new Date(a + (s.s + s.len) * 36e5).toISOString()
  };
}

function busy(i, skip) {
  const k = dk(DAYS[i]), b = [[12.5, 13.5]];
  meets(i).forEach(m => b.push([m[1], m[2]]));
  tasks.forEach(t => {
    if (t.slot && t.slot.k === k && t.id !== skip) b.push([t.slot.s, t.slot.s + t.slot.len]);
  });
  return b;
}

const lastDay = t => {
  const due = new Date(t.due);
  let l = -1;
  DAYS.forEach((d, i) => { if (d <= due) l = i; });
  return l < 0 ? 1 : l;
};

function findSlot(t, after) {
  const len = adj(t), end = P.eve ? 18 : 20, last = lastDay(t);
  for (let i = 0; i <= last; i++) {
    const b = busy(i, t.id), c = [];
    let st = 9;
    if (isToday(i)) st = Math.max(9, Math.ceil((nowH() + .5) * 2) / 2);
    for (let s = st; s + len <= end; s += .5) {
      if (after && (i < after.i || (i === after.i && s <= after.s))) continue;
      if (b.some(x => s < x[1] && s + len > x[0])) continue;
      c.push(s);
    }
    if (P.peak) c.sort((a, z) => (inPk(a) ? 0 : 1) - (inPk(z) ? 0 : 1));
    if (c.length) return { k: dk(DAYS[i]), s: c[0], len };
  }
  return null;
}

function why(t, p) {
  const r = [P.peak && t.prio >= 2 && inPk(p.s) ? 'Inside your ' + pkLabel() + ' peak window' : 'First free slot', 'before the deadline'];
  if (P.bias && p.len !== t.dur) r.push('padded to ' + p.len + 'h (you said ' + t.dur + 'h)');
  if (P.eve) r.push('nothing after 6 PM');
  return r.join(', ');
}

const mkProp = t => {
  const p = findSlot(t);
  return p ? { ...p, reason: why(t, p), src: 'demo' } : null;
};

/* ===== data, seeds, persistence ===== */
const save = () => {
  if (user && !remote()) LS.set('daylo_data_' + user.email, JSON.stringify({ tasks: tasks.map(t => ({ ...t, proposal: undefined })), P }));
};

function seed() {
  tasks = [];
  nid = 1;
}

function autoMiss() {
  tasks.forEach(t => {
    if (t.status === 'open' && t.slot) {
      const [y, m, d] = t.slot.k.split('-');
      if (new Date(y, m - 1, d).getTime() + (t.slot.s + t.slot.len) * 36e5 < Date.now()) {
        recordMiss(t);
        t.was = sl(t.slot);
        t.slot = null;
        t.status = 'missed';
        if (!remote()) t.miss = (t.miss || 0) + 1;
      }
    }
  });
  tasks.forEach(t => {
    if (t.status === 'missed' && !usePlan()) t.proposal = mkProp(t);
  });
}

function normalizeUser(u) {
  u = (u && typeof u === 'object') ? u : {};
  u.name = String(u.name || u.email?.split('@')[0] || 'User').trim() || 'User';
  u.email = String(u.email || 'guest').trim().toLowerCase() || 'guest';
  return u;
}

function normalizePrefs(p, remoteMode) {
  const base = remoteMode ? { peak: false, bias: false, eve: true, mult: 1, pk: [9, 11] } : { peak: true, bias: true, eve: true, mult: 1.5, pk: [9, 11] };
  p = (p && typeof p === 'object') ? p : {};
  const out = { ...base, ...p };
  out.peak = !!out.peak;
  out.bias = !!out.bias;
  out.eve = !!out.eve;
  out.mult = Number.isFinite(Number(out.mult)) && Number(out.mult) > 0 ? Number(out.mult) : base.mult;
  if (!Array.isArray(out.pk) || out.pk.length < 2 || !Number.isFinite(Number(out.pk[0])) || !Number.isFinite(Number(out.pk[1])) || Number(out.pk[1]) <= Number(out.pk[0])) {
    out.pk = [9, 11];
  } else {
    out.pk = [Number(out.pk[0]), Number(out.pk[1])];
  }
  return out;
}

function enter(u) {
  user = normalizeUser(u);
  gcal = false;
  GB = [];
  P = normalizePrefs(null, remote());
  INS = null;
  INSERR = false;
  insApplied = false;

  let ok = false;
  const raw = remote() ? null : LS.get('daylo_data_' + user.email);
  if (raw) {
    try {
      const d = JSON.parse(raw);
      if (Array.isArray(d.tasks)) tasks = d.tasks;
      if (d && typeof d === 'object') P = normalizePrefs(d.P, remote());
      ok = Array.isArray(d.tasks);
    } catch (e) {}
  }
  if (!ok) {
    if (remote()) tasks = [];
    else seed();
  }
  if (!Array.isArray(tasks)) tasks = [];
  P = normalizePrefs(P, remote());
  nid = tasks.reduce((m, t) => {
    const id = parseInt(t.id);
    return isNaN(id) ? m : Math.max(m, id);
  }, 0) + 1;
  autoMiss();
  save();
  sel = 0;
  chat = [];
  page = 'dashboard';
  checkUrlPlanUpgrade();
  render();
  scrollTo(0, 0);
  if (remote()) {
    try {
      const F = window.FB;
      F.getDoc(F.doc(F.db, 'users', user.uid)).then(d => {
        if (d.exists()) {
          const data = d.data();
          if (data.prefs) {
            P = normalizePrefs(data.prefs, remote());
          }
          if (data.plan) {
            const ai = getUserAIState();
            ai.plan = data.plan;
            ai.aiLimit = data.aiLimit || (data.plan === 'premium' ? 999999 : data.plan === 'pro' ? 300 : 60);
            if (data.aiMinutesUsed != null) ai.aiMinutesUsed = data.aiMinutesUsed;
            saveUserAIState(ai);
            user.plan = data.plan;
            user.aiLimit = ai.aiLimit;
            try { LS.set('daylo_session', JSON.stringify(user)); } catch (_) {}
          }
          render();
        }
      }).catch(_ => {});
    } catch (_) {}
    loadCalendar().then(syncTasks);
    initTasksListener();
    loadInsights(true);
    loadN8NConfig();
    loadNotifications();
  }
}

async function loadN8NConfig() {
  if (!live() || !window.FB.db) return;
  try {
    const F = window.FB;
    const docRef = F.doc(F.db, 'n8n_config', 'webhooks');
    const snap = await F.getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data();
      // Auto-migrate any stale webhook-test paths to production /webhook/
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === 'string') {
          data[k] = v.replace('/webhook-test/', '/webhook/');
        }
      }
      N8N_WEBHOOKS = { ...N8N_WEBHOOKS, ...data };
    }
  } catch (err) {
    handleFirestoreError(err, 'get', 'n8n_config/webhooks');
  }
}

/* ===== auth ===== */
const users = () => { try { return JSON.parse(LS.get('daylo_users') || '{}'); } catch (e) { return {}; } };

async function sha(p, s) {
  try {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s + ':' + p));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    return btoa(unescape(encodeURIComponent(s + ':' + p)));
  }
}

async function submitAuth(e, type) {
  e.preventDefault();
  const g = id => $('#' + id) ? $('#' + id).value : '';
  const em = g('authEmail').trim().toLowerCase();
  const pw = g('authPass');
  const nm = g('authName').trim();
  const er = m => { const el = $('#err'); if (el) el.textContent = m; };
  const us = users();
  const btn = e.target.querySelector('button[type=submit]');

  if (!/^\S+@\S+\.\S+$/.test(em)) return er('Enter a valid email, like you@example.com.');
  if (type === 'register') {
    if (!nm) return er('Enter your name.');
    if (pw.length < 8) return er('Use at least 8 characters for your password.');
    if (pw !== g('authPass2')) return er("The passwords don't match.");
  }
  er('');
  if (btn) btn.disabled = true;
  let who;

  if (live()) {
    const F = window.FB;
    try {
      if (type === 'register') {
        const c = await F.createUserWithEmailAndPassword(F.auth, em, pw);
        try {
          await F.updateProfile(c.user, { displayName: nm });
          await F.setDoc(F.doc(F.db, 'users', c.user.uid), {
            name: nm,
            email: em,
            plan: 'free',
            aiMinutesUsed: 0,
            aiLimit: 60,
            totalAIRequests: 0,
            role: ['dayloinfo@gmail.com', 'uchechukwusandra0@gmail.com'].includes(em) ? 'admin' : 'user',
            created_at: new Date().toISOString()
          });
        } catch (_) {}
        who = { name: nm, email: em, uid: c.user.uid };
      } else {
        const c = await F.signInWithEmailAndPassword(F.auth, em, pw);
        who = await profileOf(c.user);
      }
    } catch (err) {
      if (btn) btn.disabled = false;
      // Distinguish between Auth errors and potential Firestore errors during registration
      if (err.code && err.code.startsWith('auth/')) {
        return er(authMsg(err));
      } else {
        try {
          handleFirestoreError(err, 'write', 'users');
        } catch (fe) {
          return er('Database error: ' + JSON.parse(fe.message).message);
        }
      }
    }
    if (btn) btn.disabled = false;
  } else {
    if (btn) btn.disabled = false;
    if (type === 'register') {
      if (us[em]) return er('That email already has an account. Log in instead.');
      us[em] = { name: nm, h: await sha(pw, em), plan: 'free', aiMinutesUsed: 0, aiLimit: 60, joined: new Date().toLocaleDateString() };
      LS.set('daylo_users', JSON.stringify(us));
    } else {
      if (!us[em]) return er('No account with that email. Create one first.');
      if (us[em].h !== await sha(pw, em)) return er("That password doesn't match.");
    }
    who = { name: us[em].name, email: em };
  }

  LS.set('daylo_session', JSON.stringify(who));
  enter(who);
  toast(type === 'register' ? 'Account created. Welcome to Daylo, ' + who.name.split(' ')[0] : 'Welcome back, ' + who.name.split(' ')[0]);
}

function guest() {
  go('login');
}

async function googleAuth() {
  if (live() && window.FB && window.FB.GoogleAuthProvider && window.FB.signInWithPopup) {
    try {
      const provider = new window.FB.GoogleAuthProvider();
      const res = await window.FB.signInWithPopup(window.FB.auth, provider);
      const who = await profileOf(res.user);
      LS.set('daylo_session', JSON.stringify(who));
      enter(who);
      toast('Signed in with Google ✓');
      return;
    } catch (e) {
      console.warn('Firebase Google Auth popup error:', e);
      if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') {
        return toast('Google sign-in was cancelled.');
      }
      if (e.code === 'auth/popup-blocked') {
        return toast('Popup was blocked by your browser. Please allow popups.');
      }
      return toast('Google sign-in failed: ' + (e.message || 'Please try again.'));
    }
  }
  const email = prompt('Enter your Google email address:', 'user@gmail.com') || 'user@gmail.com';
  const name = email.split('@')[0];
  const capitalized = name.charAt(0).toUpperCase() + name.slice(1);
  const who = { name: capitalized, email: email.toLowerCase(), uid: 'google_' + Date.now() };
  LS.set('daylo_session', JSON.stringify(who));
  enter(who);
  toast('Signed in with Google ✓');
}

function authMsg(e) {
  const c = String(e && e.code || '');
  return ({
    'auth/email-already-in-use': 'That email already has an account. Log in instead.',
    'auth/invalid-credential': "That password doesn't match, or you originally signed up with Google. Try 'Continue with Google'.",
    'auth/wrong-password': "That password doesn't match.",
    'auth/user-not-found': 'No account with that email. Create one first.',
    'auth/weak-password': 'Use at least 8 characters for your password.',
    'auth/invalid-email': 'Enter a valid email, like you@example.com.',
    'auth/too-many-requests': 'Account temporarily locked due to too many failed attempts. Please wait a few moments or reset your password.',
    'auth/operation-not-allowed': 'Email/Password sign-in is not enabled in Firebase Console. Please sign in with Google.',
    'auth/network-request-failed': 'We could not reach the server. Please check your internet connection and try again.'
  })[c] || (e && e.message ? e.message : 'Something went wrong. Please try again.');
}

async function profileOf(u) {
  let name = u.displayName || '';
  let plan = 'free';
  let aiLimit = 60;
  let aiMinutesUsed = 0;
  try {
    const F = window.FB;
    const d = await F.getDoc(F.doc(F.db, 'users', u.uid));
    if (d.exists()) {
      const data = d.data();
      if (data.name) name = data.name;
      if (data.plan) plan = data.plan;
      if (data.aiLimit != null) aiLimit = data.aiLimit;
      if (data.aiMinutesUsed != null) aiMinutesUsed = data.aiMinutesUsed;
    }
  } catch (e) {
    console.warn('Profile fetch warning (non-fatal):', e);
  }
  return {
    name: name || String(u.email || '').split('@')[0] || 'User',
    email: u.email || '',
    uid: u.uid,
    plan,
    aiLimit,
    aiMinutesUsed
  };
}

async function logout() {
  if (tasksUnsubscribe) { tasksUnsubscribe(); tasksUnsubscribe = null; }
  if (notifUnsubscribe) { notifUnsubscribe(); notifUnsubscribe = null; }
  if (window.FB && window.FB.auth && window.FB.signOut) {
    try { await window.FB.signOut(window.FB.auth); } catch (e) {}
  }
  setCalendarToken(null);
  LS.del('daylo_session');
  user = null;
  window.location.href = '/login.html';
}

function toggleMobileMenu() {
  const sb = document.getElementById('mobileSidebar');
  const bd = document.getElementById('mobileMenuBackdrop');
  if (!sb) return;
  const isClosed = sb.classList.contains('-translate-x-full');
  if (isClosed) {
    sb.classList.remove('-translate-x-full');
    if (bd) bd.classList.remove('hidden');
  } else {
    sb.classList.add('-translate-x-full');
    if (bd) bd.classList.add('hidden');
  }
}

const go = p => {
  if (p === 'login') { window.location.href = '/login.html'; return; }
  if (p === 'register') { window.location.href = '/signup.html'; return; }
  page = p;
  const sb = document.getElementById('mobileSidebar');
  const bd = document.getElementById('mobileMenuBackdrop');
  if (sb) sb.classList.add('-translate-x-full');
  if (bd) bd.classList.add('hidden');
  render();
  scrollTo(0, 0);
  if (p === 'learning') loadInsights();
};

const sc = id => {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth' });
};

function toast(msg) {
  const d = document.createElement('div');
  d.className = 'fixed bottom-6 right-6 z-50 bg-[#1A2447] text-white text-xs font-semibold px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 border border-white/10 animate-fade-in';
  d.innerHTML = `<span>✦</span><span>${esc(msg)}</span>`;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 3200);
}

function bars() {
  const v = [3, 11, 8, 3, 5, 2, 1], l = ['7a', '9a', '11a', '1p', '3p', '5p', '7p'];
  return `
    <div class="bars flex items-end gap-2.5 h-[120px] pt-4">
      ${v.map((x, i) => `
        <div class="${i === 1 || i === 2 ? 'pk !bg-[#1A2447]' : '!bg-[#E4E6EE]'} flex-1 rounded-md transition-all hover:opacity-90" style="height:${(x / 11) * 100}%" title="${x} tasks completed"></div>
      `).join('')}
    </div>
    <div class="bl flex gap-2.5 text-[11px] font-semibold text-[#8A91A0] text-center mt-2">
      ${l.map(x => `<span class="flex-1">${x}</span>`).join('')}
    </div>
  `;
}

function initScrollAnimations() {
  const elements = document.querySelectorAll('.reveal-on-scroll');
  if (!elements.length) return;

  if (!('IntersectionObserver' in window)) {
    elements.forEach(el => el.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
      } else {
        entry.target.classList.remove('is-visible');
      }
    });
  }, {
    threshold: 0.08,
    rootMargin: '0px 0px -20px 0px'
  });

  elements.forEach(el => observer.observe(el));
}

function landing() {
  root.innerHTML = `
    <div class="min-h-screen bg-[#F3FDF8] font-sans text-[#172033]">
      <nav class="h-16 sm:h-20 border-b border-[#E8ECF2] flex items-center justify-between px-4 sm:px-8 md:px-12 sticky top-0 z-40 bg-cover bg-center" style="background-image: url('/assets/aistudio/frame-388.png');">
        <div class="flex items-center gap-2 sm:gap-3">
          <img src="/assets/aistudio/daylo-logo.png" alt="Daylo Logo" class="h-6 sm:h-8 w-auto object-contain">
        </div>
        <div class="hidden md:flex items-center gap-2">
          <a onclick="sc('features')" class="px-4 py-2 rounded-xl text-sm font-semibold text-[#697386] hover:text-[#1A2447] hover:bg-[#F6F8FA] transition cursor-pointer">Features</a>
          <a onclick="sc('how')" class="px-4 py-2 rounded-xl text-sm font-semibold text-[#697386] hover:text-[#1A2447] hover:bg-[#F6F8FA] transition cursor-pointer">How it works</a>
          <a onclick="sc('learns')" class="px-4 py-2 rounded-xl text-sm font-semibold text-[#697386] hover:text-[#1A2447] hover:bg-[#F6F8FA] transition cursor-pointer">Learns you</a>
          <a href="/upgrade.html" class="px-4 py-2 rounded-xl text-sm font-semibold text-[#697386] hover:text-[#1A2447] hover:bg-[#F6F8FA] transition cursor-pointer">Pricing</a>
          <a onclick="go('contact')" class="px-4 py-2 rounded-xl text-sm font-semibold text-[#697386] hover:text-[#1A2447] hover:bg-[#F6F8FA] transition cursor-pointer">Contact</a>
        </div>
        <div class="flex items-center gap-2 sm:gap-3">
          <button class="px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-bold text-[#1A2447] hover:bg-[#F6F8FA] rounded-xl transition cursor-pointer" onclick="go('login')">Log in</button>
          <button class="px-3.5 sm:px-5 py-1.5 sm:py-2.5 text-xs sm:text-sm font-bold bg-[#1A2447] text-white hover:bg-[#2A376B] rounded-xl shadow-sm transition cursor-pointer" onclick="go('register')">Get started</button>
        </div>
      </nav>

      <!-- Hero Banner with Dark Navy Header Background matching Figma -->
      <section class="bg-gradient-to-b from-[#1A2447] via-[#1E2B54] to-[#1A2447] text-white pt-16 pb-32 px-6 text-center relative overflow-hidden">
        <div class="max-w-5xl mx-auto relative z-10 reveal-on-scroll">
          <div class="inline-flex items-center gap-2 px-3.5 py-1 rounded-full text-xs font-bold text-[#2CA67A] uppercase tracking-wider mb-5">
            ✦ YOUR DAY, INTELLIGENTLY ORGANIZED
          </div>
          <h1 class="text-4xl md:text-6xl font-black tracking-tight text-white max-w-3xl mx-auto leading-tight md:leading-none">
            Stop planning your day<br>Let AI plan with <span class="text-[#2CA67A]">you.</span>
          </h1>
          <p class="text-sm md:text-base text-[#C5CBE0] max-w-xl mx-auto mt-5 leading-relaxed">
            Daylo combines your tasks, calendar, time and AI assistant in one place, then learns how you work so your schedule gets smarter over time.
          </p>
          <div class="flex items-center justify-center gap-3.5 mt-7 flex-wrap">
            <button class="w-48 sm:w-52 py-3.5 text-sm font-bold bg-[#1A2447] text-white border border-white/20 rounded-xl hover:bg-[#2A376B] transition shadow-lg cursor-pointer flex items-center justify-center gap-1.5" onclick="go('register')">
              Start free →
            </button>
            <button class="w-48 sm:w-52 py-3.5 text-sm font-bold bg-white text-[#172033] rounded-xl hover:bg-gray-100 transition shadow-md cursor-pointer flex items-center justify-center" onclick="sc('how')">
              See how it works
            </button>
          </div>
        </div>
      </section>

      <!-- Product Mockup Showcase Section (Professionally placed between Hero and Features) -->
      <section class="max-w-6xl mx-auto px-6 -mt-16 md:-mt-24 relative z-20 reveal-on-scroll reveal-delay-1">
        <div class="bg-white/10 backdrop-blur-md p-3 sm:p-4 rounded-3xl border border-white/20 shadow-[0_30px_70px_rgba(26,36,71,0.2)]">
          <img src="/assets/aistudio/app-mockup.png" alt="Daylo App Mockup" class="w-full h-auto rounded-2xl object-cover shadow-sm">
        </div>
      </section>

      <!-- Section: One place for the whole day matching Figma 6 white cards -->
      <section class="max-w-6xl mx-auto px-6 pt-12 pb-20" id="features">
        <div class="text-left mb-12 reveal-on-scroll">
          <h2 class="text-3xl font-extrabold text-[#1A2447] tracking-tight">One place for the whole day</h2>
          <p class="text-xs md:text-sm text-[#697386] mt-2 max-w-xl">
            Calendar, to-do list and timer usually live in three apps. Daylo brings them together and keeps the plan honest.
          </p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
          <!-- Card 1 -->
          <div class="bg-white border border-[#E8ECF2] rounded-2xl p-6 shadow-xs hover:border-[#2CA67A]/30 transition reveal-on-scroll reveal-delay-1 card-hover">
            <div class="text-[#2CA67A] text-xl font-bold mb-3">◷</div>
            <h3 class="font-bold text-sm text-[#1A2447] mb-1.5">One smart calendar</h3>
            <p class="text-xs text-[#697386] leading-relaxed">Tasks become time blocks around your meetings, synced with Google Calendar.</p>
          </div>

          <!-- Card 2 -->
          <div class="bg-white border border-[#E8ECF2] rounded-2xl p-6 shadow-xs hover:border-[#2CA67A]/30 transition reveal-on-scroll reveal-delay-2 card-hover">
            <div class="text-[#4285F4] text-xl font-bold mb-3">◎</div>
            <h3 class="font-bold text-sm text-[#1A2447] mb-1.5">Urgency scoring</h3>
            <p class="text-xs text-[#697386] leading-relaxed">Every task gets a transparent score from deadline, importance, effort and risk.</p>
          </div>

          <!-- Card 3 -->
          <div class="bg-white border border-[#E8ECF2] rounded-2xl p-6 shadow-xs hover:border-[#2CA67A]/30 transition reveal-on-scroll reveal-delay-3 card-hover">
            <div class="text-[#2CA67A] text-xl font-bold mb-3">↻</div>
            <h3 class="font-bold text-sm text-[#1A2447] mb-1.5">Replans with your OK</h3>
            <p class="text-xs text-[#697386] leading-relaxed">Miss a slot and Daylo proposes a new one. Nothing moves until you approve.</p>
          </div>

          <!-- Card 4 -->
          <div class="bg-white border border-[#E8ECF2] rounded-2xl p-6 shadow-xs hover:border-[#2CA67A]/30 transition reveal-on-scroll reveal-delay-4 card-hover">
            <div class="text-[#2CA67A] text-xl font-bold mb-3">✦</div>
            <h3 class="font-bold text-sm text-[#1A2447] mb-1.5">Ashley, your assistant</h3>
            <p class="text-xs text-[#697386] leading-relaxed">Tell Ashley what changed and get a new plan in plain language.</p>
          </div>

          <!-- Card 5 -->
          <div class="bg-white border border-[#E8ECF2] rounded-2xl p-6 shadow-xs hover:border-[#2CA67A]/30 transition reveal-on-scroll reveal-delay-5 card-hover">
            <div class="text-[#2CA67A] text-xl font-bold mb-3">◔</div>
            <h3 class="font-bold text-sm text-[#1A2447] mb-1.5">Smart reminders</h3>
            <p class="text-xs text-[#697386] leading-relaxed">A 7 AM brief with your top three tasks and anything that needs a decision.</p>
          </div>

          <!-- Card 6 -->
          <div class="bg-white border border-[#E8ECF2] rounded-2xl p-6 shadow-xs hover:border-[#2CA67A]/30 transition reveal-on-scroll reveal-delay-6 card-hover">
            <div class="text-[#697386] text-xl font-bold mb-3">◌</div>
            <div class="flex items-center gap-2 mb-1.5">
              <h3 class="font-bold text-sm text-[#1A2447]">Focus mode</h3>
              <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">Coming soon</span>
            </div>
            <p class="text-xs text-[#697386] leading-relaxed">Blocks the sites you choose while a focus session runs.</p>
          </div>
        </div>
      </section>

      <!-- Section: How it works on Dark Navy matching Figma -->
      <section class="bg-[#1A2447] text-white py-20 px-6" id="how">
        <div class="max-w-6xl mx-auto">
          <div class="text-left mb-12 reveal-on-scroll">
            <h2 class="text-3xl font-extrabold text-white tracking-tight">How it works</h2>
            <p class="text-xs md:text-sm text-[#C5CBE0] mt-2">Three steps, and the third is the one other planners skip.</p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
            <!-- Step 1 -->
            <div class="bg-white text-[#172033] rounded-2xl p-6 shadow-md flex flex-col justify-between reveal-on-scroll reveal-delay-1 card-hover">
              <div>
                <span class="text-3xl font-black text-[#2CA67A] block mb-2">1</span>
                <b class="text-sm font-bold text-[#1A2447] block mb-1">Say what you need to do</b>
                <p class="text-xs text-[#697386] mb-4">Type it the way you'd text a friend.</p>
              </div>
              <div class="p-3 rounded-xl bg-[#F6F8FA] border border-[#E8ECF2] text-xs text-[#172033] italic">
                “Send proposal to client, due Friday, needs 2 hours”
              </div>
            </div>

            <!-- Step 2 -->
            <div class="bg-white text-[#172033] rounded-2xl p-6 shadow-md flex flex-col justify-between reveal-on-scroll reveal-delay-2 card-hover">
              <div>
                <span class="text-3xl font-black text-[#2CA67A] block mb-2">2</span>
                <b class="text-sm font-bold text-[#1A2447] block mb-1">Daylo plans your week</b>
                <p class="text-xs text-[#697386] mb-4">It finds the best free slot before the deadline.</p>
              </div>
              <div class="p-3 rounded-xl bg-[#F6F8FA] border border-[#E8ECF2] text-xs">
                <div class="font-bold text-[#1A2447]">Wed 9:00–10:30</div>
                <div class="text-[11px] text-[#697386] mt-0.5">Inside your 9–11 AM peak window</div>
              </div>
            </div>

            <!-- Step 3 -->
            <div class="bg-white text-[#172033] rounded-2xl p-6 shadow-md flex flex-col justify-between reveal-on-scroll reveal-delay-3 card-hover">
              <div>
                <span class="text-3xl font-black text-[#2CA67A] block mb-2">3</span>
                <b class="text-sm font-bold text-[#1A2447] block mb-1">It replans when life happens</b>
                <p class="text-xs text-[#697386] mb-4">Missed a block? You get a proposal, not a surprise.</p>
              </div>
              <div class="p-3 rounded-xl bg-red-50/50 border border-red-200 text-xs">
                <div class="flex items-center gap-1.5">
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700">Missed</span>
                  <b class="text-[#1A2447]">Thu 10:00–11:00</b>
                </div>
                <div class="text-[11px] text-[#697386] mt-1">Proposed. Approve in one tap.</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Section: It learns how you work matching Figma -->
      <section class="max-w-6xl mx-auto px-6 py-20" id="learns">
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div class="lg:col-span-7 text-left space-y-4 reveal-on-scroll">
            <h2 class="text-3xl font-extrabold text-[#1A2447] tracking-tight">It learns how you work</h2>
            <p class="text-xs md:text-sm text-[#697386] leading-relaxed">
              Daylo logs when tasks actually get done, how long they take, and which slots you skip. Those numbers feed the next plan.
            </p>

            <div class="space-y-3 pt-2">
              <div class="p-4 rounded-xl bg-white border border-[#E8ECF2] shadow-xs">
                <b class="text-xs font-bold text-[#1A2447] block mb-1">Peak hours</b>
                <p class="text-xs text-[#697386]">Important work goes where you finish the most tasks.</p>
              </div>
              <div class="p-4 rounded-xl bg-white border border-[#E8ECF2] shadow-xs">
                <b class="text-xs font-bold text-[#1A2447] block mb-1">Estimate bias</b>
                <p class="text-xs text-[#697386]">If 1 hour usually means 1.5, plans are padded to match.</p>
              </div>
              <div class="p-4 rounded-xl bg-white border border-[#E8ECF2] shadow-xs">
                <b class="text-xs font-bold text-[#1A2447] block mb-1">Skip patterns</b>
                <p class="text-xs text-[#697386]">Slots you keep missing stop getting proposed.</p>
              </div>
            </div>
          </div>

          <!-- Completed Tasks Histogram Bar Chart matching Figma -->
          <div class="lg:col-span-5 bg-white border border-[#E8ECF2] rounded-2xl p-6 shadow-xs reveal-on-scroll reveal-delay-2 card-hover">
            <h3 class="font-bold text-sm text-[#1A2447] mb-4">Tasks completed by time of day</h3>
            ${bars()}
            <p class="text-xs text-[#1A2447] mt-4 font-medium">Peak focus: <b class="text-[#1A2447]">9 to 11 AM</b></p>
          </div>
        </div>
      </section>

      <!-- CTA Box matching Figma dark card -->
      <section class="max-w-5xl mx-auto px-6 pb-20 reveal-on-scroll">
        <div class="bg-[#1A2447] text-white rounded-3xl p-10 md:p-14 text-center shadow-xl card-hover">
          <h2 class="text-3xl font-extrabold mb-3 tracking-tight">Plan today in under a minute</h2>
          <p class="text-[#C5CBE0] text-xs md:text-sm max-w-md mx-auto mb-8">Create an account to start building a smarter, stress-free workday.</p>
          <div class="flex items-center justify-center gap-4 flex-wrap">
            <button class="w-48 sm:w-52 py-3.5 text-sm font-bold bg-white text-[#1A2447] rounded-xl hover:bg-gray-100 transition shadow-md cursor-pointer flex items-center justify-center gap-1.5" onclick="go('register')">
              Start free →
            </button>
          </div>
        </div>
      </section>

      <!-- Footer -->
      <footer class="border-t border-[#E8ECF2] bg-white py-8 px-6 md:px-12 text-xs text-[#697386] flex flex-col md:flex-row items-center justify-between gap-4">
        <div>© ${new Date().getFullYear()} ${appName}. All rights reserved.</div>
        <div class="flex items-center gap-4">
          <a onclick="go('contact')" class="text-[#2CA67A] font-bold hover:underline cursor-pointer">Contact Us</a>
          <span>·</span>
          <span>Your plan, adapted every day.</span>
        </div>
      </footer>
    </div>
  `;
  setTimeout(initScrollAnimations, 50);
}

function auth(type) {
  const L = type === 'login';
  let loginName = '';
  try {
    const s = JSON.parse(LS.get('daylo_session') || '{}');
    if (s && s.name) loginName = s.name.split(' ')[0];
    else {
      const uMap = users();
      const keys = Object.keys(uMap);
      if (keys.length > 0 && uMap[keys[0]].name) loginName = uMap[keys[0]].name.split(' ')[0];
    }
  } catch (_) {}
  const loginTitle = L ? (loginName ? `Welcome back, ${loginName}` : 'Welcome back') : 'Create your Daylo account';

  root.innerHTML = `
    <div class="min-h-screen bg-[#F3FDF8] flex items-center justify-center p-6 font-sans">
      <div class="bg-white border border-[#E8ECF2] rounded-3xl p-8 md:p-10 max-w-md w-full shadow-xl">
        <div class="flex items-center gap-2 mb-6 cursor-pointer" onclick="go('home')">
          <div class="w-8 h-8 rounded-xl bg-[#1A2447] text-white flex items-center justify-center font-black">✦</div>
          <span class="font-black text-xl text-[#1A2447]">${appName}</span>
        </div>
        <h1 class="text-2xl font-black text-[#1A2447] mb-1">${loginTitle}</h1>
        <p class="text-xs text-[#697386] mb-6">${L ? 'Pick up right where your schedule left off.' : 'Start structuring your workday with AI protection.'}</p>

        <form onsubmit="submitAuth(event,'${type}')" novalidate class="space-y-4">
          <div class="${L ? 'hidden' : ''}">
            <label for="authName" class="block text-xs font-bold text-[#1A2447] mb-1.5">Full Name</label>
            <input id="authName" autocomplete="name" placeholder="Sandra Adeleke" class="w-full px-3.5 py-2.5 rounded-xl border border-[#E8ECF2] text-sm focus:outline-none focus:border-[#2CA67A] focus:ring-2 focus:ring-[#2CA67A]/15 bg-white">
          </div>
          <div>
            <label for="authEmail" class="block text-xs font-bold text-[#1A2447] mb-1.5">Email address</label>
            <input id="authEmail" type="email" autocomplete="email" placeholder="sandra@company.com" class="w-full px-3.5 py-2.5 rounded-xl border border-[#E8ECF2] text-sm focus:outline-none focus:border-[#2CA67A] focus:ring-2 focus:ring-[#2CA67A]/15 bg-white">
          </div>
          <div>
            <label for="authPass" class="block text-xs font-bold text-[#1A2447] mb-1.5">Password</label>
            <input id="authPass" type="password" autocomplete="${L ? 'current-password' : 'new-password'}" placeholder="${L ? '••••••••' : 'At least 8 characters'}" class="w-full px-3.5 py-2.5 rounded-xl border border-[#E8ECF2] text-sm focus:outline-none focus:border-[#2CA67A] focus:ring-2 focus:ring-[#2CA67A]/15 bg-white">
          </div>
          <div class="${L ? 'hidden' : ''}">
            <label for="authPass2" class="block text-xs font-bold text-[#1A2447] mb-1.5">Confirm Password</label>
            <input id="authPass2" type="password" autocomplete="new-password" placeholder="••••••••" class="w-full px-3.5 py-2.5 rounded-xl border border-[#E8ECF2] text-sm focus:outline-none focus:border-[#2CA67A] focus:ring-2 focus:ring-[#2CA67A]/15 bg-white">
          </div>

          <p class="text-xs text-red-500 min-h-4 font-medium" id="err" role="alert"></p>

          <button class="w-full py-3 rounded-xl bg-[#1A2447] text-white font-bold text-sm hover:bg-[#2A376B] transition shadow-md" type="submit">
            ${L ? 'Log in to Daylo' : 'Create free account'}
          </button>
        </form>

        <!-- Social Auth Divider -->
        <div class="my-5 flex items-center gap-3">
          <div class="flex-1 h-px bg-[#E8ECF2]"></div>
          <span class="text-[11px] text-[#697386] uppercase font-semibold">or</span>
          <div class="flex-1 h-px bg-[#E8ECF2]"></div>
        </div>

        <!-- Google Sign In matching Figma -->
        <button onclick="googleAuth()" type="button" class="w-full py-2.5 rounded-xl border border-[#E8ECF2] text-xs font-bold text-[#1A2447] hover:bg-[#F6F8FA] transition flex items-center justify-center gap-2.5 shadow-xs cursor-pointer">
          <svg class="w-4 h-4 flex-none" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
          </svg>
          Continue with Google
        </button>

        <div class="mt-6 pt-5 border-t border-[#E8ECF2] text-center text-xs text-[#697386]">
          ${L ? "Don't have an account?" : "Already have an account?"}
          <button class="text-[#2CA67A] font-bold ml-1 hover:underline" onclick="go('${L ? 'register' : 'login'}')">
            ${L ? 'Sign up' : 'Log in'}
          </button>
        </div>

        <div class="mt-3 text-center">
          <button class="text-xs text-[#697386] hover:text-[#1A2447]" onclick="go('home')">← Back to website</button>
        </div>
      </div>
    </div>
  `;
}

/* ===== dashboard shell ===== */
const NAVS = [
  ['dashboard', '⌂', 'Overview'],
  ['tasks', '✓', 'My Tasks'],
  ['calendar', '◷', 'Calendar'],
  ['assistant', '✦', 'AI Assistant'],
  ['learning', '◌', 'How I Work'],
  ['profile', '◉', 'Profile'],
  ['contact', '✉', 'Contact Us'],
  ['settings', '⚙', 'Settings']
];

function shell() {
  const userInit = initials(user ? user.name : 'User');
  const aiState = getUserAIState();
  const planInfo = window.PLAN_LIMITS[aiState.plan] || window.PLAN_LIMITS.free;

  return `
    <div class="min-h-screen bg-[#F3FDF8] flex font-sans text-[#172033]">
      <!-- Dark Navy Sidebar - Always visible -->
      <aside class="fixed top-0 bottom-0 left-0 w-16 md:w-64 bg-[#1A2447] text-white z-40 flex flex-col justify-between p-3 md:p-5 border-r border-[#151D3A] overflow-y-auto">
        <div>
          <!-- Brand Logo -->
          <div class="flex items-center justify-center md:justify-start pb-6 border-b border-white/10 mb-6 cursor-pointer gap-2" onclick="go('dashboard')">
            <img src="/assets/aistudio/daylo-logo-white.png" alt="Daylo Logo" class="h-8 w-auto object-contain">
          </div>

          <!-- Navigation Links -->
          <nav class="space-y-1.5">
            ${[
              ['dashboard', '⌂', 'Overview'],
              ['tasks', '✓', 'My Tasks'],
              ['calendar', '◷', 'Calendar'],
              ['assistant', '✦', 'AI Assistant'],
              ['learning', '◌', 'How I Work'],
              ['contact', '✉', 'Contact Us'],
              ...(user && ['dayloinfo@gmail.com', 'uchechukwusandra0@gmail.com'].includes(user.email) ? [['admin', '👥', 'Admin Portal']] : [])
            ].map(n => `
              <button class="w-full flex items-center justify-center md:justify-start gap-3 px-2 md:px-3.5 py-2.5 rounded-xl text-sm font-semibold text-left transition ${page === n[0] ? 'bg-white text-[#1A2447] font-bold shadow-md shadow-black/10' : 'text-white/70 hover:bg-white/10 hover:text-white'}" onclick="${n[0] === 'admin' ? "window.location.href='/admin.html'" : `go('${n[0]}')`}" title="${n[2]}">
                <span class="text-sm font-bold flex-none">${n[1]}</span>
                <span class="hidden md:inline truncate">${n[2]}</span>
              </button>
            `).join('')}
          </nav>
        </div>

        <!-- Sidebar Bottom -->
        <div class="space-y-3 pt-4 border-t border-white/10">
          <div class="hidden md:block p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition cursor-pointer" onclick="showUpgradeModal()">
            <div class="flex items-center justify-between text-xs font-bold text-white mb-1">
              <span>${planInfo.label} Plan</span>
              <span class="text-[10px] ${aiState.plan === 'premium' ? 'text-amber-400 bg-amber-400/20' : aiState.plan === 'pro' ? 'text-emerald-400 bg-emerald-400/20' : 'text-[#2CA67A] bg-[#EBF5F0]'} px-2 py-0.5 rounded-full font-extrabold uppercase">
                ${aiState.plan === 'free' ? 'Upgrade' : 'Active ✓'}
              </span>
            </div>
            <div class="text-[11px] text-white/60 mb-2">AI Chat: ${aiState.aiMinutesUsed} of ${aiState.aiLimit >= 999999 ? '∞' : aiState.aiLimit + 'm'}</div>
            <div class="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div class="h-full ${aiState.plan === 'premium' ? 'bg-amber-400' : 'bg-[#2CA67A]'} rounded-full" style="width: ${aiState.aiLimit >= 999999 ? '15%' : Math.min(100, Math.round((aiState.aiMinutesUsed / aiState.aiLimit) * 100)) + '%'}"></div>
            </div>
          </div>

          <button class="w-full flex items-center justify-center md:justify-start gap-3 px-2 md:px-3.5 py-2 rounded-xl text-xs font-semibold text-left transition ${page === 'settings' ? 'bg-white text-[#1A2447] font-bold' : 'text-white/70 hover:bg-white/10 hover:text-white'}" onclick="go('settings')" title="Settings">
            <span class="text-sm flex-none">⚙</span>
            <span class="hidden md:inline">Settings</span>
          </button>

          <button class="w-full flex items-center justify-center md:justify-start gap-2.5 p-2 rounded-xl md:p-2.5 bg-white text-[#1A2447] shadow-sm text-left transition hover:bg-gray-50" onclick="go('profile')" title="${esc(user.name)}" aria-label="Open your profile">
            <div class="w-8 h-8 rounded-lg bg-[#1A2447] text-white font-black text-xs flex items-center justify-center flex-none shadow-xs">
              ${esc(userInit)}
            </div>
            <div class="hidden md:block min-w-0 flex-1">
              <div class="text-xs font-bold text-[#1A2447] truncate">${esc(getUserFirstName())}</div>
              <div class="text-[10px] text-[#697386] truncate capitalize">${esc(aiState.plan)} workspace</div>
            </div>
          </button>
        </div>
      </aside>

      <!-- Main Content Area -->
      <main class="ml-16 md:ml-64 flex-1 flex flex-col min-w-0 overflow-x-hidden">
        <!-- Topbar -->
        <header class="h-16 border-b border-[#E8ECF2] sticky top-0 z-50 flex items-center justify-between px-3 sm:px-4 bg-cover bg-center" style="background-image: url('/assets/aistudio/frame-388.png');">
          <div class="flex items-center min-w-0 flex-1">
            <h2 class="text-sm font-bold text-[#1A2447] truncate">${NAVS.find(n => n[0] === page)?.[2] || 'Overview'}</h2>
          </div>

          <!-- Actions: Notification, Profile, Task, Logout -->
          <div class="flex items-center gap-1.5 flex-none ml-2">
            <div id="headerUsageBar" class="hidden sm:block"></div>
            
            <div class="relative">
              <button class="w-9 h-9 flex items-center justify-center rounded-xl border border-[#E8ECF2] hover:bg-[#F6F8FA] transition relative cursor-pointer" onclick="toggleNotifPanel(event)" aria-label="Notifications" title="Notifications">
                <span class="text-lg">🔔</span>
                ${notifications.filter(n => !n.read).length ? `
                  <span class="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-black flex items-center justify-center rounded-full border-2 border-white animate-bounce-subtle">
                    ${notifications.filter(n => !n.read).length}
                  </span>
                ` : ''}
              </button>
              
              <!-- Notification Panel -->
              ${notifOpen ? `
                <div class="fixed inset-0 z-[60] bg-black/15 sm:bg-transparent" onclick="toggleNotifPanel(event)"></div>
                <div class="fixed top-[68px] right-3 left-auto w-[min(360px,calc(100vw-24px))] sm:absolute sm:top-full sm:right-0 sm:left-auto sm:mt-2 sm:w-80 bg-white border border-[#E8ECF2] rounded-2xl shadow-2xl z-[70] overflow-hidden flex flex-col max-h-[calc(100vh-84px)] sm:max-h-[480px] animate-fade-in" onclick="event.stopPropagation()">
                  <div class="p-3.5 sm:p-4 border-b border-[#E8ECF2] flex items-center justify-between bg-[#F6F8FA]/70 flex-none">
                    <div class="flex items-center gap-2">
                      <h3 class="font-bold text-sm text-[#1A2447]">Notifications</h3>
                      ${notifications.filter(n => !n.read).length ? `
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-red-100 text-red-600">
                          ${notifications.filter(n => !n.read).length} new
                        </span>
                      ` : ''}
                    </div>
                    ${notifications.filter(n => !n.read).length ? `
                      <button class="text-[11px] font-bold text-[#2CA67A] hover:underline cursor-pointer" onclick="markAllNotifsRead()">Mark all as read</button>
                    ` : ''}
                  </div>
                  <div class="overflow-y-auto overscroll-contain flex-1 divide-y divide-[#E8ECF2]">
                    ${notifications.length ? notifications.map(notifItem).join('') : `
                      <div class="p-8 text-center">
                        <div class="text-3xl mb-2 opacity-20">🔔</div>
                        <p class="text-xs text-[#697386] font-medium">No notifications yet</p>
                      </div>
                    `}
                  </div>
                  ${notifications.length ? `
                    <div class="p-2.5 border-t border-[#E8ECF2] bg-white text-center flex-none">
                      <button class="text-[11px] font-bold text-[#697386] hover:text-[#1A2447] py-1 px-3 rounded-lg hover:bg-[#F6F8FA] transition cursor-pointer" onclick="go('dashboard'); toggleNotifPanel();">View All in Dashboard</button>
                    </div>
                  ` : ''}
                </div>
              ` : ''}
            </div>

            <button class="px-2 py-1.5 rounded-lg border border-[#E8ECF2] text-[10px] font-bold text-[#1A2447] hover:bg-[#F6F8FA] transition cursor-pointer whitespace-nowrap" onclick="go('profile')">Profile</button>
            <button class="px-2 py-1.5 rounded-lg bg-[#1A2447] text-white text-[10px] font-bold hover:bg-[#2A376B] transition shadow-xs cursor-pointer whitespace-nowrap" onclick="quickAdd()">＋ Task</button>
            <button class="px-2 py-1.5 rounded-lg text-[10px] font-semibold text-[#697386] hover:text-gray-900 hover:bg-gray-100 transition cursor-pointer whitespace-nowrap" onclick="logout()">Log out</button>
          </div>
        </header>

        <!-- Page Content View -->
        <div class="p-4 sm:p-6 md:p-8 max-w-7xl w-full mx-auto space-y-4 sm:space-y-6">
          ${({
            dashboard,
            tasks: tasksPage,
            calendar: calendarPage,
            assistant: assistantPage,
            learning: learningPage,
            profile: profilePage,
            contact: contactPage,
            settings: settingsPage
          }[page] || dashboard)()}
        </div>
      </main>
    </div>
  `;
}

function render() {
  if (page === 'home') return landing();
  if (page === 'login' || page === 'register') return auth(page);
  if (!user || user.email === 'guest') {
    user = null;
    page = 'login';
    return auth('login');
  }
  root.innerHTML = shell();
  updateHeaderUsageBar();
}

function taskRow(t) {
  const c = parts(t), d = t.status === 'done';
  return `
    <div class="flex items-center justify-between p-3.5 rounded-xl border border-[#E8ECF2] bg-white hover:border-[#D0D6E2] transition ${d ? 'opacity-60 bg-gray-50' : ''}">
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <button class="w-5 h-5 rounded-md border-2 ${d ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-[#cfd3de] hover:border-[#2CA67A]'} flex items-center justify-center text-xs font-bold transition flex-none" onclick="toggleTask('${t.id}')">
          ${d ? '✓' : ''}
        </button>
        <div class="min-w-0 flex-1">
          <div class="text-xs font-bold text-[#1A2447] truncate ${d ? 'line-through text-gray-400' : ''}">${esc(t.title)}</div>
          <div class="flex items-center gap-2 mt-1 flex-wrap text-[11px]">
            <span class="px-2 py-0.5 rounded-md bg-[#F2F3F7] text-[#626B7C] font-medium">${esc(t.project)}</span>
            <span class="px-2 py-0.5 rounded-md font-semibold ${t.prio == 3 ? 'bg-red-50 text-red-600' : t.prio == 2 ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'}">
              ${['', 'Low', 'Medium', 'High'][t.prio]}
            </span>
            <span class="text-[#697386]">${dueTxt(t)}</span>
            <span class="text-[#2CA67A] font-semibold">${t.slot ? sl(t.slot) : t.status === 'missed' ? '⚠️ Needs rescheduling' : 'Not scheduled'}</span>
          </div>
        </div>
      </div>
      <div class="flex items-center gap-4 pl-4 flex-none">
        <div class="text-right">
          <div class="text-sm font-black text-[#2CA67A]">${score(t)}</div>
          <div class="text-[10px] text-[#697386] uppercase tracking-wider font-semibold">urgency</div>
        </div>
        <button onclick="editTask('${t.id}')" class="w-8 h-8 rounded-lg bg-gray-50 text-gray-400 hover:text-[#1A2447] hover:bg-gray-100 flex items-center justify-center transition" title="Edit Task">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
        </button>
      </div>
    </div>
  `;
}

function ribbon(i) {
  const k = dk(DAYS[i]), pc = h => (h - 8) / 11 * 100;
  const b = [`<div class="rb" style="left:${pc(12.5)}%;width:${pc(13.5) - pc(12.5)}%" title="Lunch Break"></div>`];

  meets(i).forEach(m => b.push(`<div class="rb" title="${m[0]}" style="left:${pc(m[1])}%;width:${pc(m[2]) - pc(m[1])}%"></div>`));
  tasks.forEach(t => {
    if (t.slot && t.slot.k === k) b.push(`<div class="rb t" title="${esc(t.title)}" style="left:${pc(t.slot.s)}%;width:${t.slot.len / 11 * 100}%"></div>`);
    const p = t.proposal;
    if (t.status === 'missed' && p && p.k === k) b.push(`<div class="rb g" title="Proposed: ${esc(t.title)}" style="left:${pc(p.s)}%;width:${p.len / 11 * 100}%"></div>`);
  });
  if (isToday(i) && nowH() >= 8 && nowH() <= 19) b.push(`<div class="now" style="left:${pc(nowH())}%"></div>`);

  return `
    <div class="relative h-10 bg-[#F0F1F6] rounded-xl overflow-hidden my-3">
      ${b.join('')}
    </div>
    <div class="flex justify-between text-[11px] text-[#8A91A0] font-semibold px-1">
      <span>8 AM</span><span>10 AM</span><span>12 PM</span><span>2 PM</span><span>4 PM</span><span>6 PM</span><span>7 PM</span>
    </div>
    <div class="flex items-center gap-4 text-xs text-[#697386] mt-3 flex-wrap">
      <span class="flex items-center gap-1.5"><i class="w-2.5 h-2.5 rounded-sm bg-[#2CA67A] inline-block"></i> Planned by Daylo</span>
      <span class="flex items-center gap-1.5"><i class="w-2.5 h-2.5 rounded-sm bg-[#DFE1E8] inline-block"></i> Meetings & Lunch</span>
      <span class="flex items-center gap-1.5"><i class="w-2.5 h-2.5 rounded-sm border border-dashed border-[#2CA67A] bg-white inline-block"></i> Proposed Time</span>
    </div>
  `;
}

function missCard(t) {
  const p = t.proposal;
  return `
    <div class="bg-red-50/50 border border-red-200 rounded-2xl p-4 mb-3">
      <div class="flex items-start justify-between">
        <div>
          <div class="text-xs font-bold text-[#1A2447]">${esc(t.title)}</div>
          <div class="flex items-center gap-2 mt-1">
            <span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-red-100 text-red-700">Missed, was ${esc(t.was || 'earlier')}</span>
            <span class="text-xs text-[#697386]">${esc(t.project)}</span>
            <span class="text-xs text-[#697386]">· ${dueTxt(t)}</span>
          </div>
        </div>
      </div>
      <div class="mt-3 p-3 rounded-xl bg-white border border-red-100">
        ${p ? `
          <div class="text-[11px] text-[#697386] font-semibold uppercase tracking-wider">Proposed New Slot</div>
          <div class="text-sm font-extrabold text-[#1A2447] mt-0.5">${sl(p)}</div>
          <p class="text-xs text-[#697386] mt-1">${esc(p.reason)}</p>
          <div class="mt-3 flex items-center gap-2">
            <button class="px-3 py-1.5 rounded-lg bg-[#2CA67A] text-white text-xs font-bold hover:bg-[#208b64] transition" onclick="approve('${t.id}')">Approve Move</button>
            <button class="px-3 py-1.5 rounded-lg border border-[#E8ECF2] text-xs font-bold text-[#1A2447] hover:bg-[#F6F8FA] transition" onclick="another('${t.id}')">Find Another Time</button>
          </div>
        ` : (t.pending ? `<div class="text-xs font-bold text-[#2CA67A]">Ashley is finding an optimal slot...</div>` : `<div class="text-xs font-bold text-red-600">No free slot found before deadline. Free up time or move due date.</div>`)}
      </div>
    </div>
  `;
}

function getUserFullName() {
  if (!user) return 'User';
  let name = (user.name || '').trim();
  let email = (user.email || '').trim().toLowerCase();
  
  // If name is obviously a fallback or missing, try email prefix
  if (!name || name.toLowerCase() === 'user' || name.toLowerCase() === 'admin' || name.toLowerCase() === 'daylo' || name.toLowerCase() === 'founder' || name.includes('@')) {
    if (email && email !== 'guest') {
      let prefix = email.split('@')[0];
      // Filter out generic email prefixes
      const generic = ['info', 'admin', 'support', 'hello', 'contact', 'team', 'no-reply', 'office', 'founder', 'daylo'];
      if (generic.some(g => prefix.toLowerCase().includes(g))) {
        name = 'User';
      } else {
        name = prefix;
      }
    } else {
      name = 'User';
    }
  }

  // Final cleaning: split by space, dot, underscore, or dash
  let words = name.split(/[\s._-]+/).map(w => {
    let clean = w.replace(/[^a-zA-Z]/g, '');
    if (!clean) return '';
    return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
  }).filter(Boolean);

  let full = words.length ? words.join(' ') : 'User';
  // Avoid returning the app name or "Founder" as a user name
  if (full.toLowerCase() === 'daylo' || full.toLowerCase() === 'admin' || full.toLowerCase() === 'founder') return 'User';
  return full;
}

function getUserFirstName() {
  const fullName = getUserFullName();
  if (!fullName || fullName === 'User' || fullName === 'Admin') return fullName;
  const firstWord = fullName.split(' ')[0];
  return firstWord || 'User';
}

function dashboard() {
  const open = tasks.filter(t => t.status === 'open');
  const miss = tasks.filter(t => t.status === 'missed');
  const k0 = dk(DAYS[0]);
  const td = open.filter(t => t.slot && t.slot.k === k0);
  const mins = Math.round(td.reduce((a, t) => a + t.slot.len, 0) * 60);
  const top = open.slice().sort((a, b) => score(b) - score(a));
  const h = new Date().getHours();
  const g = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  const t0 = top[0];
  const firstName = getUserFirstName();
  const aiState = getUserAIState();
  const planInfo = window.PLAN_LIMITS[aiState.plan] || window.PLAN_LIMITS.free;

  return `
    <div class="space-y-4 sm:space-y-6">
      <!-- Welcome Header -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div class="flex items-center gap-2.5 flex-wrap">
            <h1 class="text-xl sm:text-2xl font-black text-[#1A2447]">Good ${g}, ${esc(firstName)} 👋</h1>
          </div>
          <p class="text-xs text-[#697386] mt-0.5">Your adaptive schedule protects your energy and top priorities.</p>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <button class="w-36 sm:w-40 justify-center py-1.5 sm:py-2 rounded-xl border border-[#E8ECF2] bg-white text-xs font-bold text-[#1A2447] hover:bg-[#F6F8FA] transition shadow-xs cursor-pointer flex items-center" onclick="planAll()">Auto-plan week</button>
          <button class="w-36 sm:w-40 justify-center py-1.5 sm:py-2 rounded-xl bg-[#1A2447] text-white text-xs font-bold hover:bg-[#2A376B] transition shadow-xs cursor-pointer flex items-center" onclick="go('assistant')">✦ Ask Ashley</button>
        </div>
      </div>

      <!-- Stats Grid matching Figma #FFFFFF border #E8ECF2 rounded 16px -->
      <div class="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-4">
        <div class="bg-white border border-[#E8ECF2] rounded-2xl p-3.5 sm:p-5 shadow-xs">
          <div class="text-[10px] sm:text-xs font-bold text-[#697386] truncate">${isToday(0) ? 'Planned Today' : 'Next Working Day'}</div>
          <div class="text-2xl sm:text-3xl font-black text-[#1A2447] mt-1 sm:mt-2 mb-0.5 sm:mb-1">${td.length}</div>
          <div class="text-[10px] sm:text-xs text-[#697386] truncate">${Math.floor(mins / 60)}h ${mins % 60}m focus work</div>
        </div>
        <div class="bg-white border border-[#E8ECF2] rounded-2xl p-3.5 sm:p-5 shadow-xs">
          <div class="text-[10px] sm:text-xs font-bold text-[#697386] truncate">Open Tasks</div>
          <div class="text-2xl sm:text-3xl font-black text-[#1A2447] mt-1 sm:mt-2 mb-0.5 sm:mb-1">${open.length}</div>
          <div class="text-[10px] sm:text-xs ${miss.length ? 'text-red-500 font-semibold' : 'text-[#697386]'} truncate">${miss.length} need rescheduling</div>
        </div>
        <div class="bg-white border border-[#E8ECF2] rounded-2xl p-3.5 sm:p-5 shadow-xs">
          <div class="text-[10px] sm:text-xs font-bold text-[#697386] truncate">Completed</div>
          <div class="text-2xl sm:text-3xl font-black text-emerald-600 mt-1 sm:mt-2 mb-0.5 sm:mb-1">${tasks.filter(t => t.status === 'done').length}</div>
          <div class="text-[10px] sm:text-xs text-[#697386] truncate">of ${tasks.length} total tasks</div>
        </div>
        <div class="bg-white border border-[#E8ECF2] rounded-2xl p-3.5 sm:p-5 shadow-xs">
          <div class="text-[10px] sm:text-xs font-bold text-[#697386] truncate">Avg Urgency Score</div>
          <div class="text-2xl sm:text-3xl font-black text-[#2CA67A] mt-1 sm:mt-2 mb-0.5 sm:mb-1">${Math.round(top.reduce((a, t) => a + score(t), 0) / Math.max(top.length, 1))}</div>
          <div class="text-[10px] sm:text-xs text-[#697386] truncate">across active workload</div>
        </div>
      </div>

      <!-- Day Timeline Ribbon -->
      <div class="bg-white border border-[#E8ECF2] rounded-2xl p-4 sm:p-6 shadow-xs">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <div>
            <h3 class="font-bold text-xs sm:text-sm text-[#1A2447]">${isToday(0) ? "Today's Time Block Sequence" : "Next Working Day Sequence"}</h3>
            <p class="text-[10px] sm:text-xs text-[#697386]">Visualizing focus slots and commitments</p>
          </div>
          <button class="self-start sm:self-auto px-3.5 py-1.5 rounded-xl border border-[#E8ECF2] bg-[#F6F8FA] sm:bg-white text-xs font-bold text-[#1A2447] hover:bg-gray-100 transition shadow-xs cursor-pointer flex items-center gap-1.5 whitespace-nowrap" onclick="go('calendar')">
            <span>Open Calendar</span>
            <span class="text-xs font-semibold text-[#2CA67A]">→</span>
          </button>
        </div>
        ${ribbon(0)}
      </div>

      <!-- Needs Rescheduling Banner (if any) -->
      ${miss.length ? `
        <div>
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-extrabold text-xs sm:text-sm text-[#1A2447] flex items-center gap-2">
              Needs your approval <span class="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700">${miss.length}</span>
            </h3>
          </div>
          ${miss.map(missCard).join('')}
        </div>
      ` : ''}

      <!-- Priorities & AI Recommendation -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
        <!-- Top Priorities List -->
        <div class="lg:col-span-7 bg-white border border-[#E8ECF2] rounded-2xl p-4 sm:p-6 shadow-xs">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h3 class="font-bold text-xs sm:text-sm text-[#1A2447]">High Priority Tasks</h3>
              <p class="text-[10px] sm:text-xs text-[#697386]">Ranked by urgency scoring</p>
            </div>
            <button class="text-xs font-bold text-[#2CA67A] hover:underline" onclick="go('tasks')">View all (${tasks.length})</button>
          </div>
          <div class="space-y-2.5">
            ${top.slice(0, 4).map(taskRow).join('') || '<p class="text-xs text-[#697386] py-6 text-center">No open tasks right now. Click "+ Add task" to schedule work.</p>'}
          </div>
        </div>

        <!-- AI Assistant Insight Panel -->
        <div class="lg:col-span-5 bg-white border border-[#E8ECF2] rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-4">
              <h3 class="font-bold text-xs sm:text-sm text-[#1A2447] flex items-center gap-1.5">
                <span class="text-[#2CA67A]">✦</span> Ashley AI Recommendation
              </h3>
              <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#EBF5F0] text-[#2CA67A]">Adaptive</span>
            </div>

            ${t0 ? `
              <div class="p-3.5 sm:p-4 rounded-xl bg-[#F6F8FA] border border-[#E8ECF2] mb-4">
                <div class="text-xs font-bold text-[#1A2447]">Start with: “${esc(t0.title)}”</div>
                <p class="text-xs text-[#697386] mt-1 leading-relaxed">
                  Calculated urgency is <b class="text-[#2CA67A]">${score(t0)}</b>. ${t0.slot ? 'Planned for ' + sl(t0.slot) + '. ' + esc(why(t0, t0.slot)) + '.' : 'Not scheduled yet.'}
                </p>
              </div>
            ` : `
              <div class="p-3.5 sm:p-4 rounded-xl bg-[#F6F8FA] border border-[#E8ECF2] mb-4 text-center">
                <div class="text-xs font-bold text-[#1A2447]">No tasks added yet</div>
                <p class="text-xs text-[#697386] mt-1 leading-relaxed">Click "+ Add Task" to plan your day with Ashley AI.</p>
              </div>
            `}

            <div class="p-3.5 sm:p-4 rounded-xl bg-[#F6F8FA] border border-[#E8ECF2] mb-4">
              <div class="text-xs font-bold text-[#1A2447]">${P.peak ? 'Peak Window Protected (' + pkLabel() + ')' : 'Peak window planning inactive'}</div>
              <p class="text-xs text-[#697386] mt-1 leading-relaxed">
                ${P.peak ? 'Important tasks are shielded into your highest-energy morning hours.' : 'Enable in How I Work to optimize your peak performance.'}
              </p>
            </div>
          </div>

          <div class="pt-2">
            <button class="w-full py-2.5 rounded-xl bg-[#1A2447] text-white text-xs font-bold hover:bg-[#2A376B] transition shadow-xs cursor-pointer" onclick="planAll()">
              ✦ Plan Unscheduled Tasks
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function taskMatchesSearch(t, query) {
  if (!query) return true;
  const qLower = String(query).toLowerCase().trim();
  if (!qLower) return true;
  
  // 1. Match title
  if (t.title && String(t.title).toLowerCase().includes(qLower)) return true;
  
  // 2. Match project / tag
  if (t.project && String(t.project).toLowerCase().includes(qLower)) return true;
  
  // 3. Match array of tags or tag string
  if (t.tags) {
    if (Array.isArray(t.tags)) {
      if (t.tags.some(tag => String(tag).toLowerCase().includes(qLower))) return true;
    } else if (typeof t.tags === 'string' && t.tags.toLowerCase().includes(qLower)) {
      return true;
    }
  }

  // 4. Match kind / category
  if (t.kind && String(t.kind).toLowerCase().includes(qLower)) return true;

  // 5. Match notes
  if (t.notes && String(t.notes).toLowerCase().includes(qLower)) return true;

  return false;
}

function handleGlobalHeaderSearch(val) {
  q = val;
  if (page === 'tasks') {
    refreshList();
    const pageInput = document.getElementById('tasksPageSearch');
    if (pageInput && pageInput.value !== val) pageInput.value = val;
  }
  renderGlobalSearchDropdown(val);
}

function renderGlobalSearchDropdown(query) {
  const dropdown = document.getElementById('globalSearchDropdown');
  if (!dropdown) return;
  const qTrim = (query || '').trim();
  if (!qTrim) {
    dropdown.classList.add('hidden');
    dropdown.innerHTML = '';
    return;
  }

  const matchingTasks = tasks.filter(t => taskMatchesSearch(t, qTrim));
  dropdown.classList.remove('hidden');

  if (!matchingTasks.length) {
    dropdown.innerHTML = `
      <div class="p-4 text-center text-xs text-[#697386]">
        <span class="block text-base mb-1">🔍</span>
        No tasks matching "<b>${esc(qTrim)}</b>" found by title or tag.
      </div>
    `;
    return;
  }

  dropdown.innerHTML = `
    <div class="px-3.5 py-2.5 bg-[#F6F8FA] border-b border-[#E8ECF2] flex items-center justify-between text-[11px] font-bold text-[#1A2447]">
      <span>Found ${matchingTasks.length} matching task${matchingTasks.length === 1 ? '' : 's'}</span>
      <button onclick="goToTasksWithSearch('${esc(qTrim)}')" class="text-[#2CA67A] hover:underline font-bold">View all in My Tasks →</button>
    </div>
    <div class="divide-y divide-[#E8ECF2]">
      ${matchingTasks.slice(0, 6).map(t => {
        const isDone = t.status === 'done';
        return `
          <div class="p-3 hover:bg-[#F6F8FA] transition cursor-pointer flex items-center justify-between gap-3 text-left" onclick="openTaskFromSearch('${t.id}')">
            <div class="min-w-0 flex-1">
              <div class="text-xs font-bold text-[#1A2447] truncate ${isDone ? 'line-through text-gray-400' : ''}">${esc(t.title)}</div>
              <div class="flex items-center gap-1.5 mt-1 flex-wrap text-[10px]">
                <span class="px-1.5 py-0.5 rounded bg-[#E8ECF2] text-[#1A2447] font-semibold">${esc(t.project || 'General')}</span>
                <span class="px-1.5 py-0.5 rounded font-bold ${t.prio == 3 ? 'bg-red-50 text-red-600' : t.prio == 2 ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'}">
                  ${['', 'Low', 'Medium', 'High'][t.prio]}
                </span>
                <span class="text-[#697386]">${dueTxt(t)}</span>
                ${isDone ? '<span class="text-emerald-600 font-bold">✓ Done</span>' : ''}
              </div>
            </div>
            <div class="text-right flex-none">
              <span class="text-xs font-black text-[#2CA67A]">${score(t)}</span>
              <span class="block text-[9px] text-[#697386] uppercase font-semibold">score</span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
    ${matchingTasks.length > 6 ? `
      <div class="p-2.5 border-t border-[#E8ECF2] text-center bg-white">
        <button onclick="goToTasksWithSearch('${esc(qTrim)}')" class="text-xs font-bold text-[#1A2447] hover:text-[#2CA67A]">
          + ${matchingTasks.length - 6} more matching tasks — View in My Tasks
        </button>
      </div>
    ` : ''}
  `;
}

function showSearchDropdown() {
  if (q && q.trim()) {
    renderGlobalSearchDropdown(q);
  }
}

function clearGlobalSearch() {
  q = '';
  const headerInput = document.getElementById('globalHeaderSearch');
  if (headerInput) headerInput.value = '';
  const pageSearch = document.getElementById('tasksPageSearch');
  if (pageSearch) pageSearch.value = '';
  const dropdown = document.getElementById('globalSearchDropdown');
  if (dropdown) dropdown.classList.add('hidden');
  if (page === 'tasks') refreshList();
}

function goToTasksWithSearch(query) {
  q = query;
  go('tasks');
  const dropdown = document.getElementById('globalSearchDropdown');
  if (dropdown) dropdown.classList.add('hidden');
}

function openTaskFromSearch(id) {
  const dropdown = document.getElementById('globalSearchDropdown');
  if (dropdown) dropdown.classList.add('hidden');
  editTask(id);
}

document.addEventListener('click', (e) => {
  const searchInput = document.getElementById('globalHeaderSearch');
  const dropdown = document.getElementById('globalSearchDropdown');
  if (dropdown && !dropdown.contains(e.target) && e.target !== searchInput) {
    dropdown.classList.add('hidden');
  }
  if (notifOpen && !e.target.closest('.relative')) {
    notifOpen = false;
    render();
  }
});

function listHTML() {
  const a = tasks.filter(t => (fp === 'all' || ['', 'Low', 'Medium', 'High'][t.prio] === fp) && taskMatchesSearch(t, q));
  const none = '<p class="text-xs text-[#697386] py-8 text-center">No tasks match your filter criteria.</p>';
  if (sortBy === 'due') {
    return a.sort((x, y) => new Date(x.due) - new Date(y.due)).map(taskRow).join('') || none;
  }
  const G = [
    ['Critical / Due Soon (Score 60+)', t => t.status !== 'done' && score(t) >= 60],
    ['Coming Up (Score 30-59)', t => t.status !== 'done' && score(t) >= 30 && score(t) < 60],
    ['Low Pressure (Score < 30)', t => t.status !== 'done' && score(t) < 30],
    ['Completed Tasks', t => t.status === 'done']
  ];
  return G.map(([n, fn]) => {
    const r = a.filter(fn).sort((x, y) => score(y) - score(x));
    return r.length ? `
      <div class="mb-5">
        <div class="flex items-center gap-2 mb-2 text-xs font-bold text-[#1A2447]">
          <span>${n}</span>
          <span class="px-2 py-0.5 rounded-full text-[10px] bg-gray-100 text-gray-600">${r.length}</span>
        </div>
        <div class="space-y-2">${r.map(taskRow).join('')}</div>
      </div>
    ` : '';
  }).join('') || none;
}

const refreshList = () => {
  const el = $('#taskList');
  if (el) el.innerHTML = listHTML();
};

function tasksPage() {
  const t0 = tasks.filter(t => t.status !== 'done').sort((a, b) => score(b) - score(a))[0];
  const c = t0 && parts(t0);

  return `
    <div class="space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-xl sm:text-2xl font-black text-[#1A2447]">My Tasks</h1>
          <p class="text-xs text-[#697386] mt-1">Every task receives a mathematical urgency score so you know exactly what to tackle first.</p>
        </div>
        <button class="px-4 py-2.5 rounded-xl bg-[#1A2447] text-white text-xs font-bold hover:bg-[#2A376B] transition shadow-xs" onclick="quickAdd()">＋ Add Task</button>
      </div>

      <!-- Filters & Search Bar -->
      <div class="bg-white border border-[#E8ECF2] rounded-2xl p-3.5 sm:p-4 shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div class="flex items-center gap-2 flex-1 min-w-0">
          <input id="tasksPageSearch" class="w-full px-3.5 py-2 rounded-xl border border-[#E8ECF2] text-xs focus:outline-none focus:border-[#2CA67A] bg-[#F6F8FA]" oninput="handleGlobalHeaderSearch(this.value)" placeholder="Search tasks by title or tag..." value="${esc(q)}">
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <select onchange="fp=this.value;refreshList()" class="px-3 py-2 rounded-xl border border-[#E8ECF2] text-xs font-semibold bg-white text-[#1A2447]">
            ${['all', 'High', 'Medium', 'Low'].map(x => `<option ${fp === x ? 'selected' : ''} value="${x}">${x === 'all' ? 'All Priorities' : x + ' Priority'}</option>`).join('')}
          </select>
          <button class="px-3 py-2 rounded-xl border ${sortBy === 'score' ? 'bg-[#1A2447] text-white border-[#1A2447]' : 'border-[#E8ECF2] text-[#1A2447]'} text-xs font-bold hover:text-blue-600 hover:border-blue-600 hover:bg-[#F6F8FA] transition cursor-pointer" onclick="sortBy='score';refreshList()">Highest Urgency</button>
          <button class="px-3 py-2 rounded-xl border ${sortBy === 'due' ? 'bg-[#1A2447] text-white border-[#1A2447]' : 'border-[#E8ECF2] text-[#1A2447]'} text-xs font-bold hover:bg-[#F6F8FA]" onclick="sortBy='due';refreshList()">Deadline Date</button>
        </div>
      </div>

      <!-- Tasks List Card -->
      <div class="bg-white border border-[#E8ECF2] rounded-2xl p-4 sm:p-6 shadow-xs" id="taskList">
        ${listHTML()}
      </div>

      <!-- Urgency Formula Explanation -->
      <div class="bg-white border border-[#E8ECF2] rounded-2xl p-4 sm:p-6 shadow-xs">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-bold text-xs sm:text-sm text-[#1A2447]">How Urgency is Calculated</h3>
          <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">100% Transparent</span>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
          <div class="p-3.5 sm:p-4 rounded-xl bg-[#F6F8FA] border border-[#E8ECF2]">
            <div class="text-xs font-bold text-[#1A2447]">1. Deadline Proximity · 40%</div>
            <p class="text-xs text-[#697386] mt-1 leading-relaxed">Closer due dates exponentially raise the urgency.${c ? ' Top task: ' + c.D + '/40 pts.' : ''}</p>
          </div>
          <div class="p-3.5 sm:p-4 rounded-xl bg-[#F6F8FA] border border-[#E8ECF2]">
            <div class="text-xs font-bold text-[#1A2447]">2. Importance Weight · 30%</div>
            <p class="text-xs text-[#697386] mt-1 leading-relaxed">Your assigned priority (High, Medium, Low) shapes priority placement.${c ? ' Top task: ' + c.I + '/30 pts.' : ''}</p>
          </div>
          <div class="p-3.5 sm:p-4 rounded-xl bg-[#F6F8FA] border border-[#E8ECF2]">
            <div class="text-xs font-bold text-[#1A2447]">3. Effort & Risk · 30%</div>
            <p class="text-xs text-[#697386] mt-1 leading-relaxed">Longer blocks and tasks that have been missed before get bumped up.${c ? ' Top task: ' + c.E + '/30 pts.' : ''}</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

function calendarPage() {
  const H = 48, k = dk(DAYS[sel]), ev = [`<div class="ev" style="top:${4.5 * H}px;height:${H - 2}px">Lunch Break</div>`];
  let ln = '';
  meets(sel).forEach(m => ev.push(`<div class="ev" style="top:${(m[1] - 8) * H}px;height:${(m[2] - m[1]) * H - 2}px">${m[0]}<small>${f(m[1])}–${f(m[2])}</small></div>`));
  tasks.forEach(t => {
    if (t.slot && t.slot.k === k) ev.push(`<div class="ev t ${t.status === 'done' ? 'd' : ''}" style="top:${(t.slot.s - 8) * H}px;height:${t.slot.len * H - 2}px">${esc(t.title)}<small>${f(t.slot.s)}–${f(t.slot.s + t.slot.len)}</small></div>`);
    const p = t.proposal;
    if (t.status === 'missed' && p && p.k === k) ev.push(`<div class="ev g" style="top:${(p.s - 8) * H}px;height:${p.len * H - 2}px">Proposed: ${esc(t.title)}<small>Approve on Overview</small></div>`);
  });
  for (let h = 8; h <= 19; h++) ln += `<div class="hl" style="top:${(h - 8) * H}px"><span>${f(h)}</span></div>`;
  const nl = isToday(sel) && nowH() >= 8 && nowH() <= 19 ? `<div class="nowl" style="top:${(nowH() - 8) * H}px"></div>` : '';

  return `
    <div class="space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-xl sm:text-2xl font-black text-[#1A2447]">Your Schedule</h1>
          <p class="text-xs text-[#697386] mt-1">Calendar events and task time blocks unified into one view.${gcal ? ' (Connected to Google Calendar)' : ''}</p>
        </div>
        <div class="flex items-center gap-3">
          ${gcal ? '<div class="flex items-center gap-2"><span class="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200">● Google Calendar Active</span><button class="text-xs text-[#697386] hover:text-red-500 font-medium px-2.5 py-1.5 rounded-xl border border-[#E8ECF2] bg-white hover:bg-red-50 transition cursor-pointer" onclick="disconnectGoogle()">Disconnect</button></div>' : '<button class="px-3.5 py-2 rounded-xl border border-[#E8ECF2] bg-white text-xs font-bold text-[#1A2447] hover:bg-[#F6F8FA] cursor-pointer" onclick="connectGoogle()">Connect Google Calendar</button>'}
          <button class="px-4 py-2 rounded-xl bg-[#1A2447] text-white text-xs font-bold hover:bg-[#2A376B]" onclick="quickAdd()">＋ Add Task</button>
        </div>
      </div>

      <!-- Day selector tabs -->
      <div class="flex items-center gap-2 overflow-x-auto pb-2">
        ${DAYS.map((d, i) => `
          <button class="px-3.5 sm:px-4 py-2 rounded-xl border transition text-center min-w-[80px] sm:min-w-[90px] ${i === sel ? 'bg-[#1A2447] text-white border-[#1A2447] shadow-sm' : 'bg-white text-[#697386] border-[#E8ECF2] hover:bg-[#F6F8FA]'}" onclick="sel=${i};render()">
            <div class="text-[10px] sm:text-[11px] uppercase tracking-wider font-semibold">${d.toLocaleDateString('en-US', { weekday: 'short' })}</div>
            <div class="text-base sm:text-lg font-black leading-tight">${d.getDate()}</div>
          </button>
        `).join('')}
      </div>

      <!-- Calendar grid view -->
      <div class="bg-white border border-[#E8ECF2] rounded-2xl p-4 sm:p-6 shadow-xs overflow-x-auto">
        <div class="tlw w-full overflow-x-auto">
          <div class="tl relative w-full min-w-[300px]">${ln}${ev.join('')}${nl}</div>
        </div>
      </div>

      <!-- Bottom Actions -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div class="bg-white border border-[#E8ECF2] rounded-2xl p-4 sm:p-6 shadow-xs">
          <h3 class="font-bold text-sm text-[#1A2447] mb-1">Adaptive Replanning</h3>
          <p class="text-xs text-[#697386] mb-4">Recomputes optimal slots around your new calendar commitments without overwriting manual locks.</p>
          <button class="px-4 py-2 rounded-xl bg-[#1A2447] text-white text-xs font-bold hover:bg-[#2A376B] transition shadow-xs cursor-pointer" onclick="replanAll()">✦ Re-plan my week</button>
        </div>
        <div class="bg-white border border-[#E8ECF2] rounded-2xl p-4 sm:p-6 shadow-xs">
          <h3 class="font-bold text-sm text-[#1A2447] mb-1">Calendar Integration</h3>
          <p class="text-xs text-[#697386] mb-4">Export planned blocks directly to your primary Google Calendar account.</p>
          <button class="px-4 py-2 rounded-xl border border-[#E8ECF2] text-xs font-bold text-[#1A2447] hover:bg-[#F6F8FA]" onclick="exportTask()">Add top task to Google Calendar</button>
        </div>
      </div>
    </div>
  `;
}

function assistantPage() {
  const aiState = getUserAIState();
  const limitReached = aiState.aiMinutesUsed >= aiState.aiLimit;
  const firstName = getUserFirstName();

  return `
    <div class="space-y-4 sm:space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 class="text-xl sm:text-2xl font-black text-[#1A2447]">Ashley AI Assistant</h1>
          <p class="text-xs text-[#697386] mt-0.5">Talk to Ashley to adjust your daily plan, clear bottlenecks, or schedule new commitments.</p>
        </div>
        <div class="flex items-center gap-2">
          <button class="px-3.5 py-1.5 rounded-xl border border-[#E8ECF2] text-xs font-bold bg-white text-[#1A2447] hover:bg-[#F6F8FA]" onclick="showUpgradeModal()">View AI Limits</button>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
        <!-- Chat Box -->
        <div class="lg:col-span-8 bg-white border border-[#E8ECF2] rounded-2xl shadow-xs flex flex-col h-[480px] sm:h-[620px] relative overflow-hidden">
          <!-- Chat Messages Area -->
          <div class="flex-1 p-3.5 sm:p-6 overflow-y-auto space-y-3 scroll-smooth" id="messages">
            <div class="max-w-[88%] sm:max-w-[80%] p-3 sm:p-4 rounded-2xl rounded-tl-sm bg-[#EBF5F0] text-xs text-[#172033] leading-relaxed shadow-xs">
              <div class="font-extrabold text-[#2CA67A] mb-1">✦ Ashley</div>
              Hi ${esc(firstName)}! I'm your scheduling assistant. You can ask me what to work on next, tell me if an urgent meeting popped up, or type “Plan my day”.
            </div>
            ${chat.map(m => `
              <div class="max-w-[88%] sm:max-w-[80%] p-3 sm:p-4 rounded-2xl ${m.r === 'user' ? 'ml-auto rounded-tr-sm bg-[#1A2447] text-white' : 'rounded-tl-sm bg-[#EBF5F0] text-[#172033]'} text-xs leading-relaxed shadow-xs">
                ${m.t}
              </div>
            `).join('')}

            <!-- Suggested prompts -->
            <div class="pt-3 flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <button class="px-2.5 sm:px-3 py-1.5 rounded-full border border-[#E8ECF2] bg-white text-[11px] font-semibold text-[#697386] hover:text-[#1A2447] hover:border-[#2CA67A] transition cursor-pointer" onclick="suggestAsk('What should I work on next?')">
                “What should I work on next?”
              </button>
              <button class="px-2.5 sm:px-3 py-1.5 rounded-full border border-[#E8ECF2] bg-white text-[11px] font-semibold text-[#697386] hover:text-[#1A2447] hover:border-[#2CA67A] transition cursor-pointer" onclick="suggestAsk('Plan my day')">
                “Plan my day”
              </button>
              <button class="px-2.5 sm:px-3 py-1.5 rounded-full border border-[#E8ECF2] bg-white text-[11px] font-semibold text-[#697386] hover:text-[#1A2447] hover:border-[#2CA67A] transition cursor-pointer" onclick="suggestAsk('Move my client feedback reply')">
                “Move client reply”
              </button>
            </div>
          </div>

          <!-- Chat Overlay when limit reached -->
          <div id="chatOverlay" class="${limitReached ? '' : 'hidden'} absolute inset-x-0 bottom-16 bg-[#1A2447]/95 text-white p-4 backdrop-blur-xs flex items-center justify-between border-t border-white/10 z-10">
            <div class="flex items-center gap-3 min-w-0">
              <span class="text-xl flex-none">⚠️</span>
              <div class="min-w-0">
                <div class="text-xs font-bold truncate">You've reached your free AI limit (60 mins)</div>
                <div class="text-[11px] text-white/70 truncate">Upgrade to Pro (300 mins) or Premium (Unlimited) to continue talking to Ashley.</div>
              </div>
            </div>
            <button class="px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-xl bg-[#1A2447] text-white text-xs font-bold hover:bg-[#2A376B] transition whitespace-nowrap flex-none border border-white/20" onclick="showUpgradeModal()">
              Upgrade Now →
            </button>
          </div>

          <!-- Input Bar -->
          <div class="p-2.5 sm:p-3 bg-[#F6F8FA] border-t border-[#E8ECF2] flex items-center gap-2">
            <input id="chatInput" ${limitReached ? 'disabled' : ''} onkeydown="if(event.key==='Enter'){event.preventDefault();sendChat();}" placeholder="${limitReached ? 'Free AI limit reached (60 mins). Upgrade to Pro to continue.' : 'Tell Ashley what changed or ask what is next...'}" class="flex-1 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl border border-[#E8ECF2] text-xs bg-white focus:outline-none focus:border-[#2CA67A] disabled:opacity-60 disabled:bg-gray-100">
            <button id="chatSendBtn" ${limitReached ? 'disabled' : ''} class="px-3.5 sm:px-5 py-2 sm:py-2.5 rounded-xl bg-[#1A2447] text-white text-xs font-bold hover:bg-[#2A376B] transition disabled:opacity-50 flex-none cursor-pointer" onclick="sendChat()">Send</button>
          </div>
        </div>

        <!-- Assistant Capabilities & Info -->
        <div class="lg:col-span-4 space-y-4">
          <div class="bg-white border border-[#E8ECF2] rounded-2xl p-4 sm:p-6 shadow-xs">
            <div class="flex items-center justify-between mb-4">
              <h3 class="font-bold text-sm text-[#1A2447]">Assistant Actions</h3>
            </div>
            <div class="space-y-3">
              <div class="p-3.5 rounded-xl bg-[#F6F8FA] border border-[#E8ECF2]">
                <div class="text-xs font-bold text-[#1A2447]">1. Real-Time Prioritization</div>
                <p class="text-xs text-[#697386] mt-0.5">Asks Ashley to parse which deadline carries the biggest risk today.</p>
              </div>
              <div class="p-3.5 rounded-xl bg-[#F6F8FA] border border-[#E8ECF2]">
                <div class="text-xs font-bold text-[#1A2447]">2. Intelligent Rebalancing</div>
                <p class="text-xs text-[#697386] mt-0.5">“I took an unexpected call, push my afternoon 45 minutes.”</p>
              </div>
              <div class="p-3.5 rounded-xl bg-[#F6F8FA] border border-[#E8ECF2]">
                <div class="text-xs font-bold text-[#1A2447]">3. Quick Intake</div>
                <p class="text-xs text-[#697386] mt-0.5">Describe commitments naturally: “Follow up with lawyer by Thursday, 1 hour”.</p>
              </div>
            </div>
          </div>

          <div class="bg-white border border-[#E8ECF2] rounded-2xl p-4 sm:p-6 shadow-xs">
            <div class="text-xs font-bold text-[#1A2447] mb-1">Ashley AI Chat Usage</div>
            <div class="text-[11px] text-[#697386] mb-3">Only AI chat interactions count toward this limit. Tasks, Auto-Planning, Calendar sync, and Energy insights are completely free on all plans!</div>
            <div class="flex items-center justify-between text-xs font-semibold mb-1">
              <span>Chat Minutes</span>
              <span>${aiState.aiMinutesUsed} / ${aiState.aiLimit >= 999999 ? '∞' : aiState.aiLimit} mins</span>
            </div>
            <div class="w-full h-2 bg-[#E8ECF2] rounded-full overflow-hidden mb-3">
              <div class="h-full bg-[#2CA67A] rounded-full" style="width: ${aiState.aiLimit >= 999999 ? '12%' : Math.min(100, Math.round((aiState.aiMinutesUsed / aiState.aiLimit) * 100)) + '%'}"></div>
            </div>
            <button class="w-full py-2 rounded-xl text-xs font-bold border border-[#1A2447] text-[#1A2447] hover:bg-[#F6F8FA] transition cursor-pointer" onclick="showUpgradeModal()">
              Upgrade Plan
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function demoLearning() {
  const R = [
    ['peak', 'Schedule important work between 9 and 11 AM', 'You finish the most tasks in this window.'],
    ['bias', 'Add 50% to your time estimates', 'Tasks take about 1.5x longer than you plan.'],
    ['eve', 'Keep evenings free', 'You skipped 4 of 5 slots after 7 PM.']
  ];
  return `
    <div class="space-y-6">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-black text-[#1A2447]">How I Work</h1>
          <p class="text-xs text-[#697386] mt-1">Daylo learns patterns from your execution history so your schedule improves automatically.</p>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div class="lg:col-span-6 bg-white border border-[#E8ECF2] rounded-2xl p-6 shadow-xs">
          <h3 class="font-bold text-sm text-[#1A2447] mb-2">Tasks Completed by Time of Day</h3>
          ${bars()}
          <p class="text-xs text-[#1A2447] mt-3 mb-4">Peak focus window: <b class="text-[#2CA67A]">9:00 AM to 11:00 AM</b></p>
          
          <div class="grid grid-cols-2 gap-3 mb-4">
            <div class="p-3.5 rounded-xl bg-[#F6F8FA] border border-[#E8ECF2]">
              <div class="text-[11px] font-semibold text-[#697386]">Estimate Bias</div>
              <div class="text-xl font-black text-[#1A2447] mt-1">${P.bias ? '1.5x' : 'Off'}</div>
            </div>
            <div class="p-3.5 rounded-xl bg-[#F6F8FA] border border-[#E8ECF2]">
              <div class="text-[11px] font-semibold text-[#697386]">Completion Rate</div>
              <div class="text-xl font-black text-emerald-600 mt-1">78%</div>
            </div>
          </div>

          <div class="p-4 rounded-xl bg-[#F6F8FA] border border-[#E8ECF2] flex items-center gap-4">
            <div class="ring"></div>
            <div>
              <div class="text-xs font-bold text-[#1A2447]">74% Model Confidence</div>
              <p class="text-xs text-[#697386]">Sufficient data to optimize slot recommendations.</p>
            </div>
          </div>
        </div>

        <div class="lg:col-span-6 bg-white border border-[#E8ECF2] rounded-2xl p-6 shadow-xs">
          <h3 class="font-bold text-sm text-[#1A2447] mb-1">What Daylo Applies Now</h3>
          <p class="text-xs text-[#697386] mb-4">Toggle rules on or off to fine-tune your autonomous scheduling engine.</p>
          
          <div class="space-y-3">
            ${R.map(r => `
              <div class="flex items-center justify-between p-3.5 rounded-xl border border-[#E8ECF2] bg-[#F6F8FA]">
                <div>
                  <div class="text-xs font-bold text-[#1A2447]">${r[1]}</div>
                  <div class="text-[11px] text-[#697386] mt-0.5">${r[2]}</div>
                </div>
                <button class="sw" role="switch" aria-checked="${P[r[0]]}" aria-label="${r[1]}" onclick="rule('${r[0]}')"></button>
              </div>
            `).join('')}
          </div>

          <div class="mt-6 p-4 rounded-xl bg-[#F6F8FA] border border-[#E8ECF2]">
            <div class="text-xs font-bold text-[#1A2447] mb-1">Privacy & Ownership</div>
            <p class="text-xs text-[#697386] leading-relaxed">Your completion timestamps and estimates remain private. You can reset or purge your pattern history at any time.</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

let INS = null, INSERR = false, insApplied = false;
async function loadInsights(silent) {
  if (!remote()) return;
  if (!conf('insights')) {
    if (!silent && page === 'learning') toast('Insights webhook not configured');
    return;
  }
  
  if (!silent && page === 'learning') {
    INSERR = false;
    render();
  }

  const r = await api('insights', { body: { action: 'get', founder_id: user.uid, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } });
  
  // Consider success if we have hours data or at least some stats
  const d = r.ok && r.data && r.data.success !== false && (r.data.hours || r.data.sample_size != null) ? r.data : null;
  
  INSERR = !d;
  if (d) INS = d;
  
  if (d && !insApplied) {
    insApplied = true;
    if (d.sample_size >= 5) {
      const sg = d.suggestions || {};
      if (sg.peak_window) { P.pk = [sg.peak_window.start, sg.peak_window.end]; P.peak = true; }
      if (sg.estimate_multiplier) { P.mult = sg.estimate_multiplier; P.bias = true; }
    }
  }
  
  if (!silent || page === 'learning') render();
}

const hr12 = x => (x > 12 ? x - 12 : x) + (x >= 12 ? ' PM' : ' AM');
function realBars(h) {
  const m = Math.max(1, ...h.counts), w = INS.peak_window;
  return `
    <div class="bars">${h.counts.map((v, i) => {
      const st = 7 + 2 * i;
      return `<div class="${w && st >= w.start && st < w.end ? 'pk' : ''}" style="height:${Math.max(4, v / m * 100)}%" title="${v} tasks"></div>`;
    }).join('')}</div>
    <div class="bl">${h.labels.map(x => `<span>${x}</span>`).join('')}</div>
  `;
}

function learningPage() {
  if (!(remote() && conf('insights'))) return demoLearning();
  const head = `
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
      <div>
        <h1 class="text-2xl font-black text-[#1A2447]">How I Work</h1>
        <p class="text-xs text-[#697386] mt-1">Daylo learns from the tasks you complete and the slots you miss.</p>
      </div>
      <div class="flex items-center gap-2">
        <button class="px-3 py-1.5 rounded-xl border border-[#E8ECF2] bg-white text-[10px] font-bold text-[#1A2447] hover:bg-[#F6F8FA] transition flex items-center gap-1.5" onclick="loadInsights()">
          <span>↻</span> Refresh
        </button>
      </div>
    </div>
  `;
  if (!INS) {
    return head + `
      <div class="bg-white border border-[#E8ECF2] rounded-2xl p-6 text-center">
        <p class="text-xs text-[#697386]">${INSERR ? 'Could not load your patterns. <button class="px-3 py-1 bg-[#1A2447] text-white rounded-lg text-xs font-bold ml-2" onclick="loadInsights()">Try again</button>' : 'Analyzing completion telemetry…'}</p>
      </div>
    `;
  }
  const n = INS.sample_size, pc = v => v == null ? 'n/a' : Math.round(v * 100) + '%';
  if (n < 5) {
    return head + `
      <div class="bg-white border border-[#E8ECF2] rounded-2xl p-6">
        <h3 class="font-bold text-sm text-[#1A2447] mb-2">Building Your Profile (${n} of 5 tasks logged)</h3>
        <p class="text-xs text-[#697386] leading-relaxed">Complete ${5 - n} more task${5 - n === 1 ? '' : 's'} and Daylo will chart your exact peak performance window and estimate multiplier.</p>
      </div>
    `;
  }
  const sg = INS.suggestions || {}, w = INS.peak_window || {start: P.pk[0], end: P.pk[1]}, inW = w ? INS.hours.counts.reduce((a, c, i) => { const st = 7 + 2 * i; return a + (st >= w.start && st < w.end ? c : 0); }, 0) : 0, R = [];
  R.push(['peak', 'Schedule important work between ' + hr12(P.pk[0]) + ' and ' + hr12(P.pk[1]), w ? 'You finished ' + inW + ' of ' + n + ' tasks in this window.' : 'Optimize planning around your preferred focus hours.']);
  if (sg.estimate_multiplier) R.push(['bias', 'Plan for ' + sg.estimate_multiplier + 'x your time estimates', 'Across ' + INS.estimate_samples + ' timed tasks, real time was ' + sg.estimate_multiplier + 'x your estimate.']);
  if (sg.avoid_evenings) R.push(['eve', 'Keep evenings free', INS.misses.evening + ' of ' + INS.misses.total + ' missed slots were after 6 PM.']);

  return head + `
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div class="lg:col-span-6 bg-white border border-[#E8ECF2] rounded-2xl p-6 shadow-xs">
        <h3 class="font-bold text-sm text-[#1A2447] mb-2">Tasks Completed by Time of Day</h3>
        ${realBars(INS.hours)}
        <p class="text-xs text-[#1A2447] mt-3 mb-4">Peak focus: <b class="text-[#2CA67A]">${w ? hr12(w.start) + ' to ' + hr12(w.end) : 'No clear peak yet'}</b></p>
        <div class="grid grid-cols-2 gap-3 mb-4">
          <div class="p-3.5 rounded-xl bg-[#F6F8FA] border border-[#E8ECF2]">
            <div class="text-[11px] font-semibold text-[#697386]">Estimate Bias</div>
            <div class="text-xl font-black text-[#1A2447] mt-1">${INS.estimate_bias ? INS.estimate_bias + 'x' : 'n/a'}</div>
            <div class="text-[10px] text-[#697386]">${INS.estimate_bias ? INS.estimate_samples + ' timed tasks' : INS.estimate_samples + '/3 timed tasks'}</div>
          </div>
          <div class="p-3.5 rounded-xl bg-[#F6F8FA] border border-[#E8ECF2]">
            <div class="text-[11px] font-semibold text-[#697386]">Finished on Time</div>
            <div class="text-xl font-black text-emerald-600 mt-1">${pc(INS.on_time_rate)}</div>
            <div class="text-[10px] text-[#697386]">${pc(INS.first_try_rate)} first-try completion</div>
          </div>
        </div>
        <div class="p-3.5 rounded-xl bg-[#F6F8FA] border border-[#E8ECF2] text-xs text-[#697386]">
          <b>${pc(INS.confidence)} confidence:</b> Calculated from ${n} completed tasks and ${INS.misses.total} rescheduled slots.
        </div>
      </div>

      <div class="lg:col-span-6 bg-white border border-[#E8ECF2] rounded-2xl p-6 shadow-xs">
        <h3 class="font-bold text-sm text-[#1A2447] mb-3">Active Pattern Rules</h3>
        <div class="space-y-3">
          ${R.length ? R.map(r => `
            <div class="flex items-center justify-between p-3.5 rounded-xl border border-[#E8ECF2] bg-[#F6F8FA]">
              <div>
                <div class="text-xs font-bold text-[#1A2447]">${r[1]}</div>
                <div class="text-[11px] text-[#697386] mt-0.5">${r[2]}</div>
              </div>
              <button class="sw" role="switch" aria-checked="${P[r[0]]}" aria-label="${r[1]}" onclick="rule('${r[0]}')"></button>
            </div>
          `).join('') : '<p class="text-xs text-[#697386]">No strong habit pattern detected yet. Keep logging your daily completions.</p>'}
        </div>
      </div>
    </div>
  `;
}

function initials(name) {
  const x = String(name || 'User').trim().split(/\s+/).filter(Boolean);
  return (x.length > 1 ? x[0][0] + x[x.length - 1][0] : x[0]?.[0] || 'U').toUpperCase();
}

async function saveProfile() {
  const input = $('#profileName');
  if (!input) return toast('Name input field not found.');
  const rawInput = input.value.trim();
  if (!rawInput) return toast('Please enter your full name.');
  
  let words = rawInput.split(/\s+/).map(w => {
    let clean = w.replace(/[^a-zA-Z]/g, '');
    if (!clean) return '';
    return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
  }).filter(Boolean);

  if (!words.length) return toast('Please enter a valid name.');
  const formattedFullName = words.join(' ');

  // Update in-memory user object
  user.name = formattedFullName;

  // Persist session in localStorage and daylo_users map
  try {
    LS.set('daylo_session', JSON.stringify(user));
    if (user.email && user.email !== 'guest') {
      const uMap = JSON.parse(localStorage.getItem('daylo_users') || '{}');
      uMap[user.email.toLowerCase()] = { name: formattedFullName, email: user.email, updated_at: new Date().toISOString() };
      localStorage.setItem('daylo_users', JSON.stringify(uMap));
    }
  } catch (e) {
    console.warn('LocalStorage save profile error:', e);
  }

  // Attempt remote Firebase sync asynchronously
  if (remote()) {
    try {
      const F = window.FB;
      if (F && F.auth && F.auth.currentUser && F.updateProfile) {
        await F.updateProfile(F.auth.currentUser, { displayName: formattedFullName });
      }
      if (F && F.db && F.setDoc && F.doc && user.uid) {
        await F.setDoc(F.doc(F.db, 'users', user.uid), { name: formattedFullName, email: user.email, updated_at: new Date().toISOString() }, { merge: true });
      }
    } catch (e) {
      handleFirestoreError(e, 'update', 'users');
    }
  }

  toast('Profile updated successfully ✓');
  render();
}

function profilePage() {
  const aiState = getUserAIState();
  const planInfo = window.PLAN_LIMITS[aiState.plan] || window.PLAN_LIMITS.free;
  const fullName = getUserFullName();

  return `
    <div class="space-y-6">
      <div>
        <h1 class="text-2xl font-black text-[#1A2447]">User Profile</h1>
        <p class="text-xs text-[#697386] mt-1">Manage your account information and subscription tier.</p>
      </div>

      <!-- Profile Header Card matching Figma -->
      <div class="bg-white border border-[#E8ECF2] rounded-2xl p-4 sm:p-6 shadow-xs flex flex-wrap items-center gap-4 sm:gap-5">
        <div class="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-[#1A2447] text-white flex items-center justify-center text-xl sm:text-2xl font-black shadow-md flex-none">
          ${esc(initials(fullName))}
        </div>
        <div class="flex-1 min-w-[200px]">
          <h2 class="text-lg sm:text-xl font-bold text-[#1A2447]">${esc(getUserFullName())}</h2>
          <div class="text-xs text-[#697386] truncate">${esc(user.email === 'guest' ? 'Guest session' : user.email)}</div>
          <div class="flex items-center gap-2 mt-2">
            <span class="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase ${aiState.plan === 'premium' ? 'bg-amber-100 text-amber-800' : aiState.plan === 'pro' ? 'bg-[#EBF5F0] text-[#2CA67A]' : 'bg-gray-100 text-gray-700'}">
              ${planInfo.label} Plan
            </span>
            <button class="text-xs font-bold text-[#2CA67A] hover:underline cursor-pointer" onclick="showUpgradeModal()">Change plan</button>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <!-- Edit Profile Form -->
        <div class="lg:col-span-7 bg-white border border-[#E8ECF2] rounded-2xl p-4 sm:p-6 shadow-xs">
          <h3 class="font-bold text-sm text-[#1A2447] mb-4">Personal Information</h3>
          <div class="space-y-4">
            <div>
              <label for="profileName" class="block text-xs font-bold text-[#1A2447] mb-1.5">Full Name</label>
              <input id="profileName" value="${esc(fullName)}" maxlength="80" autocomplete="name" placeholder="e.g. Uchechukwu Sandra" class="w-full px-3.5 py-2.5 rounded-xl border border-[#E8ECF2] text-xs focus:outline-none focus:border-[#2CA67A] bg-white">
            </div>
            <div>
              <label class="block text-xs font-bold text-[#1A2447] mb-1.5">Email address</label>
              <input value="${esc(user.email === 'guest' ? 'Guest session' : user.email)}" disabled class="w-full px-3.5 py-2.5 rounded-xl border border-[#E8ECF2] text-xs bg-gray-50 text-gray-500 cursor-not-allowed">
            </div>
            <button class="px-5 py-2.5 rounded-xl bg-[#1A2447] text-white text-xs font-bold hover:bg-[#2A376B] transition shadow-xs cursor-pointer" onclick="saveProfile()">
              Save Changes
            </button>
          </div>
        </div>

        <!-- Subscription & AI Usage -->
        <div class="lg:col-span-5 bg-white border border-[#E8ECF2] rounded-2xl p-6 shadow-xs flex flex-col justify-between">
          <div>
            <h3 class="font-bold text-sm text-[#1A2447] mb-1">AI Plan & Usage</h3>
            <p class="text-[11px] text-[#697386] mb-3">Limits only count when chatting with Ashley AI. All other features are 100% free with no limits.</p>
            <div class="space-y-3 text-xs">
              <div class="flex justify-between py-2 border-b border-[#E8ECF2]">
                <span class="text-[#697386]">Current Plan</span>
                <b class="text-[#1A2447] uppercase">${planInfo.label}</b>
              </div>
              <div class="flex justify-between py-2 border-b border-[#E8ECF2]">
                <span class="text-[#697386]">Ashley AI Chat Limit</span>
                <b class="text-[#1A2447]">${aiState.aiLimit >= 999999 ? 'Unlimited' : aiState.aiLimit + ' mins'}</b>
              </div>
              <div class="flex justify-between py-2 border-b border-[#E8ECF2]">
                <span class="text-[#697386]">AI Chat Consumed</span>
                <b class="${aiState.aiMinutesUsed >= aiState.aiLimit ? 'text-red-500' : 'text-[#2CA67A]'} font-bold">${aiState.aiMinutesUsed} mins</b>
              </div>
              <div class="flex justify-between py-2 border-b border-[#E8ECF2]">
                <span class="text-[#697386]">Tasks & Auto-Planning</span>
                <b class="text-emerald-600 font-bold">Unlimited (Free)</b>
              </div>
              <div class="flex justify-between py-2 border-b border-[#E8ECF2]">
                <span class="text-[#697386]">Google Calendar</span>
                <b class="${gcal ? 'text-emerald-600' : 'text-[#697386]'}">${gcal ? 'Connected' : 'Not Connected'}</b>
              </div>
            </div>
          </div>

          <div class="pt-4 mt-4 border-t border-[#E8ECF2] flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3">
            <button class="flex-1 py-3 sm:py-2.5 px-4 rounded-xl bg-[#1A2447] text-white text-xs font-bold hover:bg-[#2A376B] transition shadow-md shadow-[#1A2447]/15 cursor-pointer text-center" onclick="showUpgradeModal()">Upgrade / Manage Plan</button>
            <a href="/upgrade.html" class="py-2.5 px-4 rounded-xl border border-[#E8ECF2] text-xs font-bold text-[#1A2447] hover:bg-[#F6F8FA] transition text-center whitespace-nowrap">Pricing Page</a>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function submitContact(e) {
  e.preventDefault();
  const name = $('#contactName').value.trim();
  const email = $('#contactEmail').value.trim().toLowerCase();
  const subject = $('#contactSubject').value.trim();
  const message = $('#contactMessage').value.trim();
  if (!name || !email || !subject || !message) return toast('Please complete all fields.');
  if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Enter a valid email address.');
  const btn = e.target.querySelector('button[type=submit]');
  if (btn) btn.disabled = true;
  const payload = { name, email, subject, message, created_at: new Date().toISOString(), user_id: user?.uid || null };

  if (conf('contactForm')) {
    try {
      const r = await api('contactForm', { body: payload });
      if (!r.ok) throw new Error(r.error || 'Webhook request failed');
      e.target.reset();
      const emInput = $('#contactEmail');
      if (emInput) emInput.value = user?.email && user.email !== 'guest' ? user.email : '';
      if (btn) btn.disabled = false;
      toast('Message sent to Daylo support. Thank you!');
      return;
    } catch (err) {
      if (btn) btn.disabled = false;
      return toast('We could not send your message right now. Please try again.');
    }
  }

  if (remote()) {
    try {
      const F = window.FB;
      await F.addDoc(F.collection(F.db, 'contact_messages'), payload);
    } catch (err) {
      if (btn) btn.disabled = false;
      handleFirestoreError(err, 'create', 'contact_messages');
      return toast('We could not send your message right now. Please try again.');
    }
  } else {
    const key = 'daylo_contact_messages';
    let arr = [];
    try { arr = JSON.parse(LS.get(key) || '[]'); } catch (_) {}
    arr.push(payload);
    LS.set(key, JSON.stringify(arr));
  }
  e.target.reset();
  const emInput = $('#contactEmail');
  if (emInput) emInput.value = user?.email && user.email !== 'guest' ? user.email : '';
  if (btn) btn.disabled = false;
  toast('Message sent. Thank you!');
}

function contactPage() {
  const defaultEmail = user?.email && user.email !== 'guest' ? user.email : '';
  const firstName = getUserFirstName();
  return `
    <div class="space-y-6">
      <div>
        <h1 class="text-2xl font-black text-[#1A2447]">Contact Us</h1>
        <p class="text-xs text-[#697386] mt-1">Have a question, found a problem, or need help with Daylo? Send us a message.</p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <!-- Left Column: How can we help? -->
        <div class="lg:col-span-5 bg-white border border-[#E8ECF2] rounded-2xl p-6 shadow-xs">
          <h3 class="font-bold text-sm text-[#1A2447] mb-4">How can we help?</h3>

          <div class="space-y-3.5">
            <div class="flex items-start gap-3.5 p-3.5 rounded-xl border border-[#E8ECF2] bg-[#F6F8FA] hover:bg-[#EBF5F0]/30 transition cursor-pointer">
              <div class="w-10 h-10 rounded-xl bg-[#EBF5F0] text-[#2CA67A] flex items-center justify-center font-black text-sm flex-none">
                ?
              </div>
              <div>
                <b class="text-xs font-bold text-[#1A2447] block">Product support</b>
                <p class="text-xs text-[#697386] mt-0.5 leading-relaxed">Questions about tasks, planning, Ashley or your dashboard.</p>
              </div>
            </div>

            <div class="flex items-start gap-3.5 p-3.5 rounded-xl border border-[#E8ECF2] bg-[#F6F8FA] hover:bg-[#EBF5F0]/30 transition cursor-pointer">
              <div class="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center font-black text-sm flex-none">
                ⚙
              </div>
              <div>
                <b class="text-xs font-bold text-[#1A2447] block">Report a problem</b>
                <p class="text-xs text-[#697386] mt-0.5 leading-relaxed">Tell us what went wrong and what you expected to happen.</p>
              </div>
            </div>

            <div class="flex items-start gap-3.5 p-3.5 rounded-xl border border-[#E8ECF2] bg-[#F6F8FA] hover:bg-[#EBF5F0]/30 transition cursor-pointer">
              <div class="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-sm flex-none">
                ✦
              </div>
              <div>
                <b class="text-xs font-bold text-[#1A2447] block">Feature feedback</b>
                <p class="text-xs text-[#697386] mt-0.5 leading-relaxed">Share an idea that could make your workday easier.</p>
              </div>
            </div>
          </div>

          <div class="mt-6 p-4 rounded-xl bg-[#F6F8FA] border border-[#E8ECF2]">
            <b class="text-xs font-bold text-[#1A2447] block mb-1">Before you send</b>
            <p class="text-xs text-[#697386] leading-relaxed">
              Include enough detail for us to understand the issue. Please don't include passwords or other sensitive account information.
            </p>
          </div>
        </div>

        <!-- Right Column: Send us a message -->
        <div class="lg:col-span-7 bg-white border border-[#E8ECF2] rounded-2xl p-6 shadow-xs">
          <h3 class="font-bold text-sm text-[#1A2447] mb-4">Send us a message</h3>
          <form onsubmit="submitContact(event)" class="space-y-4">
            <div>
              <label for="contactName" class="block text-xs font-bold text-[#1A2447] mb-1.5">First Name</label>
              <input id="contactName" value="${esc(firstName)}" required maxlength="80" placeholder="Your name" class="w-full px-3.5 py-2.5 rounded-xl border border-[#E8ECF2] text-xs focus:outline-none focus:border-[#2CA67A] focus:ring-2 focus:ring-[#2CA67A]/15 bg-white">
            </div>
            <div>
              <label for="contactEmail" class="block text-xs font-bold text-[#1A2447] mb-1.5">Email</label>
              <input id="contactEmail" type="email" value="${esc(defaultEmail)}" required placeholder="you@example.com" class="w-full px-3.5 py-2.5 rounded-xl border border-[#E8ECF2] text-xs focus:outline-none focus:border-[#2CA67A] focus:ring-2 focus:ring-[#2CA67A]/15 bg-white">
            </div>
            <div>
              <label for="contactSubject" class="block text-xs font-bold text-[#1A2447] mb-1.5">Subject</label>
              <input id="contactSubject" required maxlength="120" placeholder="How can we help?" class="w-full px-3.5 py-2.5 rounded-xl border border-[#E8ECF2] text-xs focus:outline-none focus:border-[#2CA67A] focus:ring-2 focus:ring-[#2CA67A]/15 bg-white">
            </div>
            <div>
              <label for="contactMessage" class="block text-xs font-bold text-[#1A2447] mb-1.5">Message</label>
              <textarea id="contactMessage" required maxlength="3000" rows="5" placeholder="Tell us what you need help with..." class="w-full px-3.5 py-2.5 rounded-xl border border-[#E8ECF2] text-xs focus:outline-none focus:border-[#2CA67A] focus:ring-2 focus:ring-[#2CA67A]/15 bg-white"></textarea>
            </div>
            <div class="pt-2">
              <button class="px-6 py-3 rounded-xl bg-[#1A2447] text-white text-xs font-bold hover:bg-[#2A376B] transition shadow-md flex items-center gap-2" type="submit">
                <span>Send message →</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;
}

function settingsPage() {
  const fullName = getUserFullName();
  const emailVal = user.email === 'guest' ? 'Guest session' : user.email;
  const aiState = getUserAIState();
  const planInfo = window.PLAN_LIMITS[aiState.plan] || window.PLAN_LIMITS.free;

  return `
    <div class="space-y-6">
      <div>
        <h1 class="text-2xl font-black text-[#1A2447]">Settings</h1>
        <p class="text-xs text-[#697386] mt-1">Configure workspace parameters and connections.</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="bg-white border border-[#E8ECF2] rounded-2xl p-4 sm:p-6 shadow-xs">
          <h3 class="font-bold text-sm text-[#1A2447] mb-4">Account & Integrations</h3>
          <div class="space-y-3.5 text-xs">
            <div class="flex items-center justify-between py-2 border-b border-[#E8ECF2]">
              <span class="text-[#697386] font-medium">Full Name</span>
              <b class="text-[#1A2447]">${esc(getUserFullName())}</b>
            </div>
            <div class="flex flex-col sm:flex-row sm:items-center justify-between py-2 border-b border-[#E8ECF2] gap-1 sm:gap-4">
              <span class="text-[#697386] font-medium">Account Email</span>
              <input value="${esc(emailVal)}" disabled class="w-full sm:w-64 px-3 py-1.5 rounded-lg border border-[#E8ECF2] text-xs bg-gray-50 text-[#1A2447] font-semibold cursor-not-allowed text-left sm:text-right truncate" />
            </div>
            <div class="flex items-center justify-between py-2 border-b border-[#E8ECF2]">
              <span class="text-[#697386] font-medium">Google Calendar</span>
              ${gcal ? '<span class="text-emerald-600 font-bold">Connected</span>' : '<button class="px-3 py-1 rounded-lg border border-[#E8ECF2] text-xs font-bold text-[#1A2447] hover:bg-[#F6F8FA]" onclick="connectGoogle()">Connect</button>'}
            </div>
            <div class="flex items-center justify-between py-2 border-b border-[#E8ECF2]">
              <span class="text-[#697386] font-medium">Pricing & Plan</span>
              <div class="flex items-center gap-2">
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${aiState.plan === 'premium' ? 'bg-amber-100 text-amber-800' : aiState.plan === 'pro' ? 'bg-[#EBF5F0] text-[#2CA67A]' : 'bg-gray-100 text-gray-700'}">${planInfo.label}</span>
                <button class="px-3 py-1 rounded-lg bg-[#1A2447] text-white text-xs font-bold hover:bg-[#2A376B] transition cursor-pointer" onclick="showUpgradeModal()">Manage Plan</button>
              </div>
            </div>
          </div>
          <button class="mt-6 px-4 py-2 rounded-xl border border-red-200 text-red-600 text-xs font-bold hover:bg-red-50 transition cursor-pointer" onclick="logout()">
            Sign out of Daylo
          </button>
        </div>

        <div class="bg-white border border-[#E8ECF2] rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col justify-between">
          <div>
            <h3 class="font-bold text-sm text-[#1A2447] mb-2">Data & Storage</h3>
            <p class="text-xs text-[#697386] leading-relaxed mb-4">
              ${remote() ? 'Your tasks and schedules are securely synchronized in real-time across your workspace sessions.' : 'You are currently in demo mode. Tasks and AI telemetry reside only in this browser.'}
            </p>
          </div>
          <div>
            ${remote() ? '' : `
              <button class="px-4 py-2 rounded-xl border border-[#E8ECF2] text-xs font-bold text-[#1A2447] hover:bg-[#F6F8FA] transition cursor-pointer" onclick="resetData()">
                Reset Local Demo Data
              </button>
            `}
          </div>
        </div>
      </div>
    </div>
  `;
}

/* ===== task & schedule actions ===== */
async function toggleTask(id) {
  const t = tasks.find(x => x.id == id);
  if (!t) return;
  const wasDone = t.status === 'done';
  
  if (remote()) {
    let u = { status: wasDone ? 'open' : 'done' };
    if (!wasDone) {
      const mins = await askActual(t);
      u.completed_at = new Date().toISOString();
      if (mins != null) u.actual_minutes = mins;
      t.actual = mins;
    } else {
      u.completed_at = null;
      u.actual_minutes = null;
      t.actual = null;
    }

    try {
      const F = window.FB;
      await F.updateDoc(F.doc(F.db, 'tasks', String(t.id)), u);
    } catch (e) {
      handleFirestoreError(e, 'update', 'tasks');
      return toast('Could not update task status.');
    }
    loadInsights(true);
  }
  t.status = wasDone ? 'open' : 'done';
  save();
  render();
  toast(t.status === 'done' ? 'Task completed ✓' : 'Task reopened');
}

function formatTimeVal(h) {
  if (h == null || isNaN(h)) return '';
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return String(hrs).padStart(2, '0') + ':' + String(mins).padStart(2, '0');
}

function editTask(id) {
  const t = tasks.find(x => x.id == id);
  if (!t) return;
  
  const m = document.createElement('div');
  m.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#111827]/60 backdrop-blur-xs';
  m.id = 'editm';
  m.innerHTML = `
    <div class="bg-white rounded-2xl max-w-md w-full p-6 border border-[#E8ECF2] shadow-2xl">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-base font-bold text-[#1A2447]">Edit Task</h3>
        <button class="text-gray-400 hover:text-gray-600 font-bold" onclick="this.closest('#editm').remove()">✕</button>
      </div>
      
      <div class="space-y-4">
        <div>
          <label class="block text-[10px] font-bold text-[#697386] uppercase tracking-wider mb-1">Task Title</label>
          <input id="editTitle" value="${esc(t.title)}" class="w-full px-3.5 py-2 rounded-xl border border-[#E8ECF2] text-xs focus:outline-none focus:border-[#2CA67A]">
        </div>
        
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-[10px] font-bold text-[#697386] uppercase tracking-wider mb-1">Priority</label>
            <select id="editPrio" class="w-full px-3 py-2 rounded-xl border border-[#E8ECF2] text-xs bg-white">
              <option value="1" ${t.prio == 1 ? 'selected' : ''}>Low</option>
              <option value="2" ${t.prio == 2 ? 'selected' : ''}>Medium</option>
              <option value="3" ${t.prio == 3 ? 'selected' : ''}>High</option>
            </select>
          </div>
          <div>
            <label class="block text-[10px] font-bold text-[#697386] uppercase tracking-wider mb-1">Duration (Hours)</label>
            <input id="editDur" type="number" step="0.5" value="${t.dur}" class="w-full px-3.5 py-2 rounded-xl border border-[#E8ECF2] text-xs focus:outline-none focus:border-[#2CA67A]">
          </div>
        </div>
        
        <div>
          <label class="block text-[10px] font-bold text-[#697386] uppercase tracking-wider mb-1">Tag / Project</label>
          <input id="editProject" value="${esc(t.project || 'General')}" placeholder="e.g. Work, Launch, Design" class="w-full px-3.5 py-2 rounded-xl border border-[#E8ECF2] text-xs focus:outline-none focus:border-[#2CA67A]">
        </div>

        <div>
          <label class="block text-[10px] font-bold text-[#697386] uppercase tracking-wider mb-1">Due Date</label>
          <input id="editDue" type="date" value="${new Date(t.due).toISOString().split('T')[0]}" class="w-full px-3.5 py-2 rounded-xl border border-[#E8ECF2] text-xs focus:outline-none focus:border-[#2CA67A]">
        </div>

        <!-- Reschedule Section -->
        <div class="p-3.5 bg-[#F6F8FA] border border-[#E8ECF2] rounded-xl space-y-2">
          <div class="text-[10px] font-extrabold text-[#1A2447] uppercase tracking-wider">Schedule / Reschedule</div>
          <div class="grid grid-cols-2 gap-2.5">
            <div>
              <label class="block text-[10px] font-bold text-[#697386] uppercase tracking-wider mb-1">Schedule Date</label>
              <input id="editSchedDate" type="date" value="${t.slot ? t.slot.k : ''}" class="w-full px-3 py-1.5 rounded-lg border border-[#E8ECF2] text-xs bg-white focus:outline-none focus:border-[#2CA67A]">
            </div>
            <div>
              <label class="block text-[10px] font-bold text-[#697386] uppercase tracking-wider mb-1">Start Time</label>
              <input id="editSchedTime" type="time" value="${t.slot ? formatTimeVal(t.slot.s) : ''}" class="w-full px-3 py-1.5 rounded-lg border border-[#E8ECF2] text-xs bg-white focus:outline-none focus:border-[#2CA67A]">
            </div>
          </div>
          <p class="text-[10px] text-[#697386]">Pick a date & start time to manually position or reschedule this task on your schedule & calendar.</p>
        </div>

        <div class="pt-2 flex items-center gap-3">
          <button onclick="saveTaskEdit('${t.id}')" id="saveEditBtn" class="flex-1 py-2.5 rounded-xl bg-[#1A2447] text-white text-xs font-bold hover:bg-[#2A376B] transition shadow-md">Save Changes</button>
          <button onclick="deleteTask('${t.id}')" class="px-4 py-2.5 rounded-xl border border-red-100 text-red-600 text-xs font-bold hover:bg-red-50 transition">Delete</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(m);
}

async function saveTaskEdit(id) {
  const t = tasks.find(x => x.id == id);
  if (!t) return;
  
  const title = $('#editTitle').value.trim();
  const project = ($('#editProject') ? $('#editProject').value.trim() : '') || 'General';
  const prio = parseInt($('#editPrio').value);
  const dur = parseFloat($('#editDur').value) || 1;
  const due = new Date($('#editDue').value).toISOString();

  const schedDate = $('#editSchedDate') ? $('#editSchedDate').value.trim() : '';
  const schedTime = $('#editSchedTime') ? $('#editSchedTime').value.trim() : '';

  let newSlot = null;
  let startIso = null;
  let endIso = null;

  if (schedDate && schedTime) {
    const [sH, sM] = schedTime.split(':').map(Number);
    const startHourFloat = sH + (sM / 60);
    const [y, m, d] = schedDate.split('-').map(Number);
    const startDate = new Date(y, m - 1, d, sH, sM, 0);
    const endDate = new Date(startDate.getTime() + (dur * 3600000));

    startIso = startDate.toISOString();
    endIso = endDate.toISOString();
    newSlot = { k: schedDate, s: startHourFloat, len: dur };
  }

  if (!title) return toast('Title cannot be empty.');

  const btn = $('#saveEditBtn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  if (remote()) {
    try {
      const F = window.FB;
      await F.updateDoc(F.doc(F.db, 'tasks', String(t.id)), {
        content: title,
        project: project,
        tag: project,
        priority: prio,
        duration_hours: dur,
        due_date: due,
        scheduled_start: startIso,
        scheduled_end: endIso,
        status: 'open',
        updated_at: new Date().toISOString()
      });
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Save Changes';
      handleFirestoreError(e, 'update', 'tasks');
      return toast('Could not update task in Firestore.');
    }
  }

  t.title = title;
  t.project = project;
  t.tag = project;
  t.prio = prio;
  t.dur = dur;
  t.due = due;
  t.slot = newSlot;
  t.status = 'open';
  
  await syncSlot(t);
  save();
  if ($('#editm')) $('#editm').remove();
  render();
  toast(newSlot ? 'Task updated & scheduled for ' + sl(newSlot) : 'Task updated ✓');
}

async function deleteTask(id) {
  if (!confirm('Permanently delete this task?')) return;
  const idx = tasks.findIndex(x => x.id == id);
  if (idx < 0) return;

  if (remote()) {
    try {
      const F = window.FB;
      await F.deleteDoc(F.doc(F.db, 'tasks', String(id)));
    } catch (e) {
      handleFirestoreError(e, 'delete', 'tasks');
      return toast('Could not delete task from Firestore.');
    }
  }

  tasks.splice(idx, 1);
  save();
  if ($('#editm')) $('#editm').remove();
  render();
  toast('Task deleted');
}

function askActual(t) {
  return new Promise(res => {
    const m = document.createElement('div');
    m.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#111827]/60 backdrop-blur-xs';
    m.innerHTML = `
      <div class="bg-white rounded-2xl max-w-sm w-full p-6 border border-[#E8ECF2] shadow-2xl">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-base font-bold text-[#1A2447]">How long did it take?</h3>
          <button class="text-gray-400 hover:text-gray-600 font-bold" data-v="skip">✕</button>
        </div>
        <p class="text-xs text-[#697386] mb-4">${esc(t.title)}. This helps Daylo calculate your actual estimate bias.</p>
        <div class="grid grid-cols-3 gap-2">
          ${[[15, '15 min'], [30, '30 min'], [60, '1 hour'], [90, '1.5 hrs'], [120, '2 hours'], [180, '3+ hrs']].map(a => `
            <button class="py-2 rounded-xl border border-[#E8ECF2] text-xs font-bold text-[#1A2447] hover:border-[#2CA67A] hover:bg-[#EBF5F0] transition" data-v="${a[0]}">${a[1]}</button>
          `).join('')}
        </div>
        <button class="w-full mt-4 py-2 rounded-xl text-xs text-[#697386] hover:text-[#1A2447]" data-v="skip">Skip timing</button>
      </div>
    `;
    m.onclick = e => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      m.remove();
      res(b.dataset.v === 'skip' ? null : +b.dataset.v);
    };
    document.body.appendChild(m);
  });
}

async function recordMiss(t) {
  if (!remote() || !t.slot) return;
  const F = window.FB, s = slotISO(t.slot);
  try {
    await F.addDoc(F.collection(F.db, 'misses'), {
      uid: user.uid,
      task_id: String(t.id),
      slot_start: s.start_iso,
      slot_hour: new Date(s.start_iso).getHours(),
      created_at: new Date().toISOString()
    });
    await F.updateDoc(F.doc(F.db, 'tasks', String(t.id)), {
      status: 'missed',
      missed_count: F.increment(1),
      missed_slot: s.start_iso,
      scheduled_start: null,
      scheduled_end: null
    });
  } catch (e) {
    handleFirestoreError(e, 'create', 'misses');
  }
}

// Direct Google Calendar Integration via official Workspace OAuth
const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];
let cachedCalendarToken = null;

function getCalendarToken() {
  if (cachedCalendarToken) return cachedCalendarToken;
  try {
    const s = sessionStorage.getItem('daylo_gcal_token');
    if (s) {
      cachedCalendarToken = s;
      return s;
    }
  } catch (_) {}
  return null;
}

function setCalendarToken(tok) {
  cachedCalendarToken = tok;
  try {
    if (tok) sessionStorage.setItem('daylo_gcal_token', tok);
    else sessionStorage.removeItem('daylo_gcal_token');
  } catch (_) {}
}

function disconnectGoogle() {
  setCalendarToken(null);
  gcal = false;
  GB = [];
  save();
  render();
  toast('Google Calendar disconnected.');
}

async function syncSlot(t) {
  if (!remote() || !gcal || !t.slot) return;
  const s = slotISO(t.slot);

  // 1. Direct Google Calendar API sync if token available
  const gToken = getCalendarToken();
  if (gToken) {
    try {
      const eventPayload = {
        summary: t.title,
        description: `Daylo scheduled task\nProject: ${t.project || 'General'}`,
        start: { dateTime: s.start_iso },
        end: { dateTime: s.end_iso }
      };
      let endpoint = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
      let method = 'POST';
      if (t.eid) {
        endpoint += '/' + encodeURIComponent(t.eid);
        method = 'PUT';
      }
      const res = await fetch(endpoint, {
        method,
        headers: {
          Authorization: `Bearer ${gToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(eventPayload)
      });
      if (res.ok) {
        const ev = await res.json();
        if (ev && ev.id) {
          t.eid = ev.id;
          save();
        }
        return;
      } else if (res.status === 401) {
        setCalendarToken(null);
      }
    } catch (err) {
      console.warn('Direct Calendar sync error:', err);
    }
  }
}

function approve(id) {
  const t = tasks.find(x => x.id == id);
  if (!t || !t.proposal) return;
  const p = t.proposal;
  t.slot = { k: p.k, s: p.s, len: p.len };
  t.status = 'open';
  delete t.proposal;
  save();
  render();
  toast('Moved to ' + sl(t.slot));
  confirmSlot(t, p.reason);
}

async function another(id) {
  const t = tasks.find(x => x.id == id);
  if (!t || !t.proposal) return;
  if (usePlan()) {
    const cur = slotISO(t.proposal), old = t.proposal;
    t.pending = true;
    render();
    const it = parsePlan(await api('plan', { body: planBody('reschedule', [t], { exclude: [cur], after: cur.start_iso }) }));
    const x = it.find(i => i.id == t.id) || it[0];
    t.pending = false;
    if (x) t.proposal = { k: x.k, s: x.s, len: x.len, reason: x.reason, src: 'plan' };
    else { t.proposal = old; toast('The planner has no alternative time to suggest.'); }
    render();
    return;
  }
  const n = findSlot(t, { i: dIdx(t.proposal.k), s: t.proposal.s });
  if (n) {
    t.proposal = { ...n, reason: why(t, n), src: 'demo' };
    render();
  } else {
    toast('No later slot available before the deadline.');
  }
}

function missTask(t) {
  t.was = t.slot ? sl(t.slot) : 'earlier';
  t.slot = null;
  t.status = 'missed';
  t.miss = (t.miss || 0) + 1;
  t.proposal = mkProp(t);
  save();
  render();
  if (remote()) {
    try {
      const F = window.FB;
      F.updateDoc(F.doc(F.db, 'tasks', String(t.id)), {
        status: 'missed',
        missed_count: t.miss,
        missed_slot: new Date().toISOString(),
        scheduled_start: null,
        scheduled_end: null
      }).catch(err => console.warn('Could not update missed status in Firestore:', err));
    } catch (_) {}
  }
}

function simMiss() {
  const c = tasks.filter(t => t.status === 'open' && t.slot).sort((a, b) => slotISO(a.slot).start_iso.localeCompare(slotISO(b.slot).start_iso))[0];
  if (!c) return toast('No scheduled task left to miss.');
  missTask(c);
  toast('Marked as missed. A new time was proposed.');
}

async function planAll() {
  if (remote()) {
    await requestFounderPlan("Plan my day");
  } else {
    const u = tasks.filter(t => t.status === 'open' && !t.slot);
    if (!u.length) return toast('Everything is already planned.');
    u.sort((a, b) => score(b) - score(a)).forEach(t => {
      t.slot = findSlot(t);
      if (t.slot) confirmSlot(t);
    });
    save();
    render();
    toast('Planned ' + u.length + ' task' + (u.length > 1 ? 's' : ''));
  }
}

async function rule(k) {
  P[k] = !P[k];
  const stateLabels = {
    peak: P.peak ? 'Peak hours protection enabled (9–11 AM)' : 'Peak hours protection disabled',
    bias: P.bias ? '1.5x estimate bias padding enabled' : 'Estimate bias padding disabled',
    eve: P.eve ? 'Evening free rule enabled (no tasks after 6 PM)' : 'Evening free rule disabled'
  };

  save();
  render();
  toast(stateLabels[k] || 'Pattern rule updated ✓');

  if (remote()) {
    try {
      const F = window.FB;
      await F.setDoc(F.doc(F.db, 'users', user.uid), {
        prefs: P,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (e) {
      console.warn('Firestore update prefs error:', e);
    }
  }
}

function resetData() {
  LS.del('daylo_data_' + user.email);
  enter(user);
  toast('Demo data reset successfully.');
}

async function loadCalendar() {
  if (!remote()) return false;
  const a = new Date();
  a.setHours(0, 0, 0, 0);
  const timeMin = a.toISOString();
  const timeMax = new Date(a.getTime() + 8 * 864e5).toISOString();

  // 1. Direct Google Calendar API fetch if access token is present
  const gToken = getCalendarToken();
  if (gToken) {
    try {
      const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${gToken}` }
      });
      if (res.ok) {
        const json = await res.json();
        const items = json.items || [];
        gcal = true;
        GB = [];
        items.forEach(e => {
          if (!e.start || !e.start.dateTime || (e.description || '').includes('Daylo scheduled task')) return;
          const s = new Date(e.start.dateTime), n = new Date(e.end.dateTime);
          GB.push({
            k: dk(s),
            t: e.summary || 'Busy',
            s: s.getHours() + s.getMinutes() / 60,
            e: dk(n) === dk(s) ? n.getHours() + n.getMinutes() / 60 : 24
          });
        });
        return true;
      } else if (res.status === 401) {
        // Token expired or invalid
        setCalendarToken(null);
      }
    } catch (err) {
      console.warn('Direct Calendar API error:', err);
    }
  }

  gcal = false;
  return false;
}

async function replanAll() {
  if (remote()) {
    await requestFounderPlan("Replan my schedule");
  } else {
    const o = tasks.filter(t => t.status === 'open');
    if (!o.length) return toast('No open tasks to plan.');
    o.forEach(t => t.slot = null);
    o.sort((a, b) => score(b) - score(a)).forEach(t => {
      t.slot = findSlot(t);
      if (t.slot) confirmSlot(t);
    });
    save();
    render();
    toast('Re-planned ' + o.length + ' tasks.');
  }
}

async function connectGoogle() {
  if (!remote()) return toast('Log in with an account to connect Google Calendar.');

  // 1. Direct Official Google Calendar Flow via Firebase GoogleAuthProvider
  if (window.FB && window.FB.auth && window.FB.GoogleAuthProvider) {
    try {
      toast('Opening Google Calendar authorization…');
      const provider = new window.FB.GoogleAuthProvider();
      provider.addScope('https://www.googleapis.com/auth/calendar.events');
      provider.setCustomParameters({ prompt: 'select_account consent', access_type: 'offline' });

      let result = null;
      try {
        if (window.FB.linkWithPopup && window.FB.auth.currentUser) {
          result = await window.FB.linkWithPopup(window.FB.auth.currentUser, provider);
        } else {
          result = await window.FB.signInWithPopup(window.FB.auth, provider);
        }
      } catch (linkErr) {
        // If already linked or credential collision, fallback to signInWithPopup
        result = await window.FB.signInWithPopup(window.FB.auth, provider);
      }

      if (result) {
        const cred = window.FB.GoogleAuthProvider.credentialFromResult(result);
        if (cred && cred.accessToken) {
          setCalendarToken(cred.accessToken);
          if (await loadCalendar()) {
            replanAll();
            save();
            render();
            return toast('Google Calendar connected directly & synced!');
          }
        }
      }
    } catch (gErr) {
      console.warn('Direct Google Calendar flow error:', gErr);
      if (gErr.code === 'auth/popup-closed-by-user') {
        return toast('Google Calendar connection was cancelled.');
      }
      return toast('Google Calendar connection failed: ' + (gErr.message || 'Please check popup settings.'));
    }
  } else {
    toast('Google Calendar authorization is unavailable right now.');
  }
}

function parsePrioVal(val) {
  if (val == null) return 2;
  if (typeof val === 'number' && !isNaN(val)) return Math.min(3, Math.max(1, val));
  const s = String(val).trim().toLowerCase();
  if (s === '3' || s === 'high' || s === 'urgent' || s === 'critical') return 3;
  if (s === '1' || s === 'low') return 1;
  if (s === '2' || s === 'medium' || s === 'normal') return 2;
  return 2;
}

function applyTaskRows(rows, options = {}) {
  const silent = typeof options === 'boolean' ? options : !!(options && options.silent);
  const old = tasks, out = [];
  rows.forEach(x => {
    const o = old.find(t => t.id == x.id);
    const d = x.due_date ? new Date(x.due_date) : null;
    const st = x.status === 'done' ? 'done' : x.status === 'missed' ? 'missed' : 'open';
    const pr = parsePrioVal(x.priority != null ? x.priority : (x.prio != null ? x.prio : x.priority_label));
    const t = o || {
      id: x.id,
      miss: 0,
      status: st,
      dur: +x.duration_hours || (+x.duration_minutes / 60) || +x.dur || 1,
      prio: pr,
      slot: null
    };
    t.status = st;
    t.prio = pr;
    Object.assign(t, {
      title: x.content || x.title || t.title || 'Untitled',
      kind: x.category || x.kind || t.kind || 'task',
      project: x.linked_person || x.project || t.project || 'Inbox',
      prio: pr,
      miss: +x.missed_count || +x.miss || 0,
      due: (!d || isNaN(d) ? (x.due ? new Date(x.due) : at(3, 17)) : d).toISOString()
    });
    const rawStart = x.scheduled_start || x.scheduledStart || x.start || x.start_time || x.slot_start || x.start_iso;
    const rawEnd = x.scheduled_end || x.scheduledEnd || x.end || x.end_time || x.slot_end || x.end_iso;
    const ss = rawStart ? new Date(rawStart) : null;
    const se = rawEnd ? new Date(rawEnd) : null;
    if (ss && !isNaN(ss.getTime()) && se && !isNaN(se.getTime()) && se > ss) {
      t.slot = { k: dk(ss), s: ss.getHours() + ss.getMinutes() / 60, len: (se - ss) / 36e5 };
      if (t.status === 'missed') {
        t.status = 'open';
      }
    } else if (!rawStart && t.status === 'missed') {
      t.slot = null;
    }
    if (x.google_event_id) t.eid = x.google_event_id;
    if (st === 'missed' && !t.was) {
      const ms = new Date(x.missed_slot || '');
      t.was = isNaN(ms) ? 'earlier' : slDay(dk(ms)) + ' ' + f(ms.getHours() + ms.getMinutes() / 60);
    }
    if (st === 'missed' && !t.proposal) {
      t.proposal = mkProp(t);
    }
    out.push(t);
  });
  old.filter(t => t.status === 'done' && !out.some(x => x.id == t.id)).forEach(t => out.push(t));
  tasks = out;
  autoMiss();
  if (page === 'tasks') {
    refreshList();
  }
  if (!silent && page !== 'assistant') {
    render();
  }
}

function initTasksListener() {
  if (!remote()) return;
  if (tasksUnsubscribe) {
    tasksUnsubscribe();
    tasksUnsubscribe = null;
  }
  const F = window.FB;
  try {
    const q = F.query(F.collection(F.db, 'tasks'), F.where('uid', '==', user.uid));
    tasksUnsubscribe = F.onSnapshot(q, (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      applyTaskRows(rows, { silent: page === 'assistant' });
    }, (err) => {
      console.warn("Tasks onSnapshot error:", err);
    });
  } catch (err) {
    console.warn("Could not attach tasks listener:", err);
  }
}

async function syncTasks(options = {}) {
  const silent = typeof options === 'boolean' ? options : !!(options && options.silent);
  if (!remote()) return;
  const F = window.FB;
  let rows;
  try {
    const q = await F.getDocs(F.query(F.collection(F.db, 'tasks'), F.where('uid', '==', user.uid)));
    rows = q.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    handleFirestoreError(e, 'list', 'tasks');
    return toast('Could not load your tasks.');
  }
  applyTaskRows(rows, { silent });
  const un = tasks.filter(t => t.status === 'open' && !t.slot);
  if (!silent && un.length && !autoPlanned && remote() && page !== 'assistant') {
    autoPlanned = true;
    requestFounderPlan("Plan my day");
  }
}

async function pushTask(t) {
  const F = window.FB;
  if (!remote() || !F || !F.db) return 'local_' + Date.now();
  try {
    const r = await F.addDoc(F.collection(F.db, 'tasks'), {
      uid: user.uid,
      content: t.title,
      linked_person: t.project === 'Inbox' ? '' : t.project,
      due_date: t.due,
      category: t.kind,
      duration_hours: t.dur,
      priority: t.prio,
      status: 'open',
      missed_count: 0,
      created_at: new Date().toISOString()
    });
    return r.id;
  } catch (e) {
    console.warn('Firestore pushTask warning (saving locally):', e);
    return 'local_' + Date.now();
  }
}

function exportTask() {
  const t = tasks.filter(x => x.status === 'open' && x.slot).sort((a, b) => score(b) - score(a))[0];
  if (!t) return toast('Plan a task first.');
  const s = slotISO(t.slot), fm = d => d.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  window.open('https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(t.title) + '&dates=' + fm(s.start_iso) + '/' + fm(s.end_iso) + '&details=' + encodeURIComponent('Planned by ' + appName), '_blank');
}

/* add task: intake */
function parseLocal(text) {
  const l = text.toLowerCase();
  let title = text.split(/\s*(?:,|\bdue\b|\bby\b|\bneeds?\b|\burgent\b|\basap\b|\btomorrow\b|\btoday\b)/i)[0].trim() || text.trim();
  title = title[0].toUpperCase() + title.slice(1);
  let off = 3, m;
  const wd = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  if (/\btoday\b/.test(l)) off = 0;
  else if (/\btomorrow\b/.test(l)) off = 1;
  else if (/next week/.test(l)) off = 7;
  else wd.forEach((n, i) => { if (l.includes(n)) off = (i - new Date().getDay() + 7) % 7 || 7; });
  let dur = 1;
  if (m = l.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\b/)) dur = +m[1];
  else if (m = l.match(/(\d+)\s*(?:m|mins?|minutes)\b/)) dur = Math.max(.5, Math.round(m[1] / 30) / 2);
  let prio = 2;
  if (/urgent|asap|important|critical|high|top|prio\s*1|p1|priority\s*1|priority\s*high/i.test(l)) prio = 3;
  else if (/low|whenever|someday|minor|prio\s*3|p3|priority\s*3|priority\s*low/i.test(l)) prio = 1;

  return {
    text,
    title,
    due: at(off, 17),
    dur,
    prio,
    kind: /send|follow up|reply|promised|commit/.test(l) ? 'commitment' : 'task'
  };
}

const intake = async text => ({ ...parseLocal(text), src: 'demo' });
let draft = null;

function quickAdd() {
  const m = document.createElement('div');
  m.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#111827]/60 backdrop-blur-xs';
  m.id = 'addm';
  m.innerHTML = `
    <div class="bg-white rounded-2xl max-w-md w-full p-6 border border-[#E8ECF2] shadow-2xl">
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-base font-bold text-[#1A2447]">Add New Task</h3>
        <button class="text-gray-400 hover:text-gray-600 font-bold" onclick="closeAdd()">✕</button>
      </div>
      <p class="text-xs text-[#697386] mb-4">Describe it in plain English. Daylo computes deadline, duration and the ideal calendar slot.</p>
      <div class="space-y-3">
        <input id="nl" placeholder="Send proposal to client, due Friday, needs 2 hours, urgent" onkeydown="if(event.key==='Enter')planDraft()" class="w-full px-3.5 py-2.5 rounded-xl border border-[#E8ECF2] text-xs focus:outline-none focus:border-[#2CA67A]">
        <button class="w-full py-2.5 rounded-xl bg-[#1A2447] text-white text-xs font-bold hover:bg-[#2A376B] transition" id="planBtn" onclick="planDraft()">Compute Schedule Slot</button>
      </div>
      <div id="draft"></div>
    </div>
  `;
  document.body.appendChild(m);
  const input = $('#nl');
  if (input) input.focus();
}

const closeAdd = () => {
  const m = $('#addm');
  if (m) m.remove();
};

async function planDraft() {
  const x = $('#nl').value.trim();
  if (!x) return toast('Describe a task first.');
  $('#planBtn').textContent = 'Computing…';
  draft = await intake(x);
  $('#planBtn').textContent = 'Compute Schedule Slot';
  const t = { id: 0, dur: draft.dur, prio: draft.prio, due: draft.due.toISOString(), miss: 0 };
  const p = findSlot(t);
  draft.p = p;
  $('#draft').innerHTML = `
    <div class="p-3.5 rounded-xl bg-[#F6F8FA] border border-[#E8ECF2] text-xs text-[#172033] mt-4">
      <div class="font-bold text-[#1A2447]">${esc(draft.title)}</div>
      <p class="text-[#697386] mt-1">${draft.kind}, ${dueTxt({ due: draft.due })}, ${draft.dur}h estimate${P.bias ? ' (padded to ' + adj(t) + 'h)' : ''}, ${['', 'low', 'medium', 'high'][draft.prio]} priority.<br>${p ? 'Scheduled: <b class="text-[#2CA67A]">' + sl(p) + '</b>. ' + esc(why(t, p)) + '.' : 'No free slot before deadline.'}</p>
    </div>
    <button class="w-full mt-3 py-2.5 rounded-xl bg-[#2CA67A] text-white text-xs font-bold hover:bg-[#208b64] transition" onclick="confirmAdd()">Add to My Schedule</button>
  `;
}

async function confirmAdd() {
  const d = draft;
  const t = {
    id: nid++,
    title: d.title,
    kind: d.kind,
    project: 'Inbox',
    due: d.due.toISOString(),
    dur: d.dur,
    prio: d.prio,
    status: 'open',
    slot: null,
    miss: 0
  };
  if (remote()) {
    toast('Saving task…');
    try {
      const id = await pushTask(t);
      if (!id) {
        return toast('Could not save task. Please try again.');
      }
      t.id = id;
      // Pre-calculate local slot for instant UI feedback
      t.slot = findSlot(t);
      tasks.push(t);
      closeAdd();
      render();
      if (usePlan()) {
        planTasks([t]);
      } else {
        t.slot = findSlot(t);
        render();
        confirmSlot(t);
      }
      return;
    } catch (err) {
      console.error('Error in confirmAdd:', err);
      return toast('Could not save task. Please check your connection or permissions.');
    }
  }
  t.slot = findSlot(t);
  tasks.push(t);
  save();
  closeAdd();
  render();
  toast(t.slot ? 'Added for ' + sl(t.slot) : 'Added, but no free slot was found.');
}

let isSendingChat = false;

/* Ashley chat reply */
function localReply(x) {
  const l = x.toLowerCase();
  const o = tasks.filter(t => t.status === 'open').sort((a, b) => score(b) - score(a));
  const done = tasks.filter(t => t.status === 'done');
  const miss = tasks.filter(t => t.status === 'missed');
  const m = o.find(t => t.title.toLowerCase().split(' ').some(w => w.length > 4 && l.includes(w)));

  if (/move|resched|push|delay/.test(l) && m) {
    missTask(m);
    return `I pulled <b>${esc(m.title)}</b> off your calendar and proposed a new time slot. You can review and approve it on your Overview dashboard!`;
  }
  if (/next|priorit|urgent|focus|top/.test(l)) {
    if (o[0]) {
      return `Your top priority right now is <b>${esc(o[0].title)}</b> (urgency score ${score(o[0])})${o[0].slot ? '. Planned for ' + sl(o[0].slot) : ', not yet scheduled'}. Would you like me to reserve time for it?`;
    }
    return 'You have no open tasks pending! Great job clearing your workload today.';
  }
  if (/plan|day|afternoon|morning|schedule|tomorrow|week/.test(l)) {
    const p = o.filter(t => t.slot).sort((a, b) => slotISO(a.slot).start_iso.localeCompare(slotISO(b.slot).start_iso)).slice(0, 3);
    if (p.length) {
      return 'Coming up next on your calendar: ' + p.map(t => `<b>${esc(t.title)}</b> (${sl(t.slot)})`).join(', ') + '.';
    }
    return `You have ${o.length} open task${o.length === 1 ? '' : 's'}. Click “Auto-Plan Week” on Overview or let me know which deadline to protect first.`;
  }
  if (/hello|hi|hey|good morning|good afternoon/.test(l)) {
    const name = getUserFirstName();
    return `Hello ${esc(name)}! I'm Ashley, your AI productivity assistant. You have ${o.length} open task${o.length === 1 ? '' : 's'} (${miss.length ? miss.length + ' need rescheduling' : 'all on track'}). How can I support your schedule today?`;
  }
  if (/status|how am i doing|progress|stats/.test(l)) {
    return `Here is your current status: <b>${o.length}</b> open task${o.length === 1 ? '' : 's'}, <b>${done.length}</b> completed, and <b>${miss.length}</b> needing rescheduling.`;
  }
  if (/who are you|what can you do|help/.test(l)) {
    return `I'm Ashley, your intelligent productivity planner! I can:<br>• Plan and prioritize your day based on urgency<br>• Reschedule missed or delayed commitments<br>• Protect your peak energy focus hours<br>• Adjust your schedule dynamically when urgent matters arise.`;
  }
  return 'I recommend protecting your highest urgency task during your morning focus window and keeping flexible administrative commitments after 2 PM.';
}

async function sendChat() {
  if (isSendingChat) return;
  const i = $('#chatInput');
  const btn = $('#chatSendBtn');
  const x = i ? i.value.trim() : '';
  if (!x) return;

  // Check AI Limit before proceeding
  if (!checkAILimit()) {
    return;
  }

  isSendingChat = true;
  if (i) {
    i.value = '';
    i.disabled = true;
  }
  if (btn) btn.disabled = true;

  chat.push({ r: 'user', t: esc(x) });
  const b = $('#messages');
  if (b) {
    b.insertAdjacentHTML('beforeend', `
      <div class="max-w-[88%] sm:max-w-[80%] p-3 sm:p-4 rounded-2xl ml-auto rounded-tr-sm bg-[#1A2447] text-white text-xs leading-relaxed shadow-xs">
        ${esc(x)}
      </div>
      <div class="max-w-[88%] sm:max-w-[80%] p-3 sm:p-4 rounded-2xl rounded-tl-sm bg-[#EBF5F0] text-xs text-[#172033] leading-relaxed shadow-xs" id="typing">
        <span class="text-[#2CA67A] font-bold">✦ Ashley is thinking…</span>
      </div>
    `);
    b.scrollTop = b.scrollHeight;
  }

  // Deduct 1 minute of AI usage
  trackAIUsage(1);

  let a = '';
  try {
    let r = { ok: false };
    if (remote()) {
      r = await api('assistant', {
        body: {
          message: x,
          prompt: x,
          text: x,
          action: 'chat',
          founder_id: user.uid,
          user_id: user.uid
        }
      });
    }

    if (r && r.ok && r.data) {
      const d = r.data;
      let rawText = '';
      if (typeof d === 'string') {
        rawText = d;
      } else if (typeof d === 'object') {
        rawText = d.reply || d.output || d.text || d.message || d.response || d.content || d.result || (d.data && (d.data.reply || d.data.output || d.data.text || d.data.message)) || '';
        if (!rawText && d.success && d.details) rawText = d.details;
      }
      if (rawText) {
        a = esc(rawText).replace(/\n/g, '<br>');
      }
    }

    // If webhook failed or did not provide text, gracefully fall back to local smart reply
    if (!a) {
      if (r && r.status === 401) {
        console.warn('Ashley assistant 401: Token unauthorized, falling back to smart local assistant.');
      }
      a = localReply(x);
    }
  } catch (err) {
    console.warn('sendChat error:', err);
    a = localReply(x);
  } finally {
    isSendingChat = false;
    if (i) {
      i.disabled = false;
      i.focus();
    }
    if (btn) btn.disabled = false;
  }

  chat.push({ r: 'ai', t: a });

  const ty = $('#typing');
  if (ty) {
    ty.outerHTML = `
      <div class="max-w-[88%] sm:max-w-[80%] p-3 sm:p-4 rounded-2xl rounded-tl-sm bg-[#EBF5F0] text-xs text-[#172033] leading-relaxed shadow-xs">
        <div class="font-extrabold text-[#2CA67A] mb-1">✦ Ashley</div>
        ${a}
      </div>
    `;
    if (b) b.scrollTop = b.scrollHeight;
  } else {
    render();
  }

  if (remote()) {
    // Sync tasks silently without background planning loop during active chat
    syncTasks({ silent: true });
  }
}

const suggestAsk = s => {
  const input = $('#chatInput');
  if (input) {
    input.value = s;
    sendChat();
  }
};

let booted = false;
async function start() {
  if (booted) return;
  booted = true;
  checkUrlPlanUpgrade();
  if (live()) {
    const F = window.FB;
    try { await F.auth.authStateReady(); } catch (e) {}
    if (F.auth.currentUser) {
      enter(await profileOf(F.auth.currentUser));
    } else {
      render();
    }
    return;
  }
  let s = null;
  try { s = JSON.parse(LS.get('daylo_session') || 'null'); } catch (e) {}
  if (s && s.email === 'guest') {
    LS.del('daylo_session');
    s = null;
  }
  if (s && s.email) enter(s);
  else render();
}

window.addEventListener('fbready', start);
if (window.FB) start();
else setTimeout(start, 4000);

// Global export for script access
window.Daylo = {
  checkAILimit,
  trackAIUsage,
  getUserAIState,
  saveUserAIState,
  showUpgradeModal,
  upgradePlan,
  activatePlan,
  showPlanSuccessModal,
  checkUrlPlanUpgrade,
  go,
  quickAdd,
  logout
};
