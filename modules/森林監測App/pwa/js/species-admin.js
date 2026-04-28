// ===== species-admin.js — admin 樹種字典管理 (v2.7.10) =====
// 動機：v2.7.4 import wizard 自動 seed verified=false 後，admin 原本要去 Firestore Console
//       手動補學名 / 保育等級 / promote verified=true。本模組提供 in-app 管理 UI。
// 路徑：top-level `species/{docId}` (rules: read 任一登入者 / write systemAdmin)
// schema：{ zh, sci, conservationGrade, verified, addedFrom, addedAt, addedBy,
//          sourceProjectId, sourceProjectCode, [verifiedAt, verifiedBy, reviewedAt, reviewedBy] }

import { fb, $, $$, el, toast, state } from './app.js';

const CONS_GRADES = ['', 'I', 'II', 'III'];  // '' = 無保育級

let _state = {
  filter: 'unverified',  // 'all' | 'unverified' | 'verified'
  docs: [],
  unsub: null,
};

export async function renderSpeciesDict(root) {
  root.innerHTML = '';
  const tpl = $('#view-species-dict').content.cloneNode(true);
  root.appendChild(tpl);

  // filter 切換
  const setFilter = (f) => {
    _state.filter = f;
    $$('.species-filter-btn').forEach(b => {
      const on = b.dataset.filter === f;
      b.classList.toggle('bg-forest-700', on);
      b.classList.toggle('text-white', on);
      b.classList.toggle('bg-stone-100', !on);
      b.classList.toggle('text-stone-700', !on);
    });
    renderTable();
  };
  $$('.species-filter-btn').forEach(b => b.addEventListener('click', () => setFilter(b.dataset.filter)));

  // 即時 listener — 字典筆數預期上百筆，全量 load 一次後 onSnapshot 即時更新
  if (_state.unsub) _state.unsub();
  _state.unsub = fb.onSnapshot(fb.collection(fb.db, 'species'), snap => {
    _state.docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _state.docs.sort((a, b) => (a.zh || '').localeCompare(b.zh || '', 'zh-Hant'));
    renderTable();
    updateStats();
  }, err => {
    console.error('[species-admin onSnapshot]', err);
    toast('載入字典失敗：' + err.message);
  });

  setFilter(_state.filter);
}

function updateStats() {
  const total = _state.docs.length;
  const verified = _state.docs.filter(d => d.verified).length;
  const unverified = total - verified;
  const stats = $('#species-stats');
  if (stats) stats.textContent = `共 ${total} 種 — ✅ ${verified} 已驗證 / ⏳ ${unverified} 待補充`;
}

function renderTable() {
  const filtered = _state.docs.filter(d =>
    _state.filter === 'all' ? true :
    _state.filter === 'unverified' ? !d.verified :
    !!d.verified
  );
  const body = $('#species-table-body');
  if (!body) return;
  body.innerHTML = '';
  if (filtered.length === 0) {
    body.appendChild(el('tr', {},
      el('td', { colspan: '6', class: 'text-center text-stone-500 py-6 text-sm' }, '此分類無資料')
    ));
    return;
  }
  filtered.forEach(d => body.appendChild(buildRow(d)));
}

function buildRow(d) {
  const sciInput = el('input', {
    type: 'text', value: d.sci || '', placeholder: 'e.g. Cinnamomum kanehirae',
    class: 'border rounded px-2 py-1 text-sm w-full italic',
  });
  const consSelect = el('select', { class: 'border rounded px-2 py-1 text-sm' },
    ...CONS_GRADES.map(g => {
      const opt = el('option', { value: g }, g === '' ? '無' : `第 ${g} 級`);
      if ((d.conservationGrade || '') === g) opt.setAttribute('selected', 'true');
      return opt;
    })
  );
  const verifiedCb = el('input', {
    type: 'checkbox',
    class: 'w-4 h-4 accent-forest-700',
    ...(d.verified ? { checked: 'true' } : {}),
  });
  const saveBtn = el('button', {
    class: 'bg-forest-700 hover:bg-forest-800 text-white px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap',
  }, '💾 儲存');
  const delBtn = el('button', {
    class: 'border border-red-300 text-red-600 hover:bg-red-50 px-2 py-1 rounded text-xs whitespace-nowrap',
    title: '刪除（之後若有專案再匯入同名會被自動 seed=false）',
  }, '🗑️');

  saveBtn.onclick = async () => {
    const cons = consSelect.value || null;
    const verified = verifiedCb.checked;
    const updates = {
      sci: sciInput.value.trim() || null,
      conservationGrade: cons,
      verified,
      reviewedAt: fb.serverTimestamp(),
      reviewedBy: state.user.uid,
    };
    // 第一次 promote 為 verified — 補永久查證 metadata（沿用 reviewer-approved 模式）
    if (verified && !d.verified) {
      updates.verifiedAt = fb.serverTimestamp();
      updates.verifiedBy = state.user.uid;
    }
    try {
      saveBtn.disabled = true;
      saveBtn.textContent = '⏳';
      await fb.updateDoc(fb.doc(fb.db, 'species', d.id), updates);
      toast(`已更新「${d.zh}」`);
      // onSnapshot 自動重繪，按鈕狀態會被 row rebuild 取代
    } catch (e) {
      toast('儲存失敗：' + e.message);
      saveBtn.disabled = false;
      saveBtn.textContent = '💾 儲存';
    }
  };
  delBtn.onclick = async () => {
    if (!confirm(
      `刪除字典項目「${d.zh}」？\n\n` +
      `• 之後若有專案匯入同樣中文名，會被 import wizard 重新 seed（verified=false）\n` +
      `• 此操作無法復原\n` +
      `• 既有 tree.speciesZh 引用此名稱不會被改動（樹種名是字串、非 reference）\n\n` +
      `確定刪除？`
    )) return;
    try {
      await fb.deleteDoc(fb.doc(fb.db, 'species', d.id));
      toast(`已刪除「${d.zh}」`);
    } catch (e) {
      toast('刪除失敗：' + e.message);
    }
  };

  // 來源 + 狀態徽章
  const sourceLabel = d.sourceProjectCode
    ? `${d.addedFrom || '?'} · ${d.sourceProjectCode}`
    : (d.addedFrom || '—');
  const verifyBadge = d.verified
    ? el('span', { class: 'text-green-700 text-xs', title: '已驗證' }, ' ✓')
    : el('span', { class: 'text-amber-600 text-xs', title: '待補充' }, ' ⏳');

  return el('tr', { class: 'border-t hover:bg-stone-50 align-middle' },
    el('td', { class: 'px-2 py-1 font-medium whitespace-nowrap' }, d.zh, verifyBadge),
    el('td', { class: 'px-2 py-1 min-w-[180px]' }, sciInput),
    el('td', { class: 'px-2 py-1' }, consSelect),
    el('td', { class: 'px-2 py-1 text-center' }, verifiedCb),
    el('td', { class: 'px-2 py-1 text-xs text-stone-500 whitespace-nowrap' }, sourceLabel),
    el('td', { class: 'px-2 py-1' },
      el('div', { class: 'flex gap-1' }, saveBtn, delBtn)
    ),
  );
}

// 離開頁面時清 listener（route 切走時呼叫）
export function disposeSpeciesDict() {
  if (_state.unsub) {
    _state.unsub();
    _state.unsub = null;
  }
}
