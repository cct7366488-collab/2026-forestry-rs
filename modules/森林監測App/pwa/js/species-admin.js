// ===== species-admin.js — admin 樹種字典管理 (v2.7.11) =====
// 動機：v2.7.4 import wizard 自動 seed verified=false 後，admin 原本要去 Firestore Console
//       手動補學名 / 保育等級 / promote verified=true。本模組提供 in-app 管理 UI。
// 路徑：top-level `species/{docId}` (rules: read 任一登入者 / write systemAdmin)
// schema：{ zh, sci, conservationGrade, verified, addedFrom, addedAt, addedBy,
//          sourceProjectId, sourceProjectCode,
//          [verifiedAt, verifiedBy, reviewedAt, reviewedBy, aliasOf] }
//
// v2.7.11 字典管理 4 件套：
//   🆔c 批次操作：checkbox 選列 + 批次 verify/unverify/delete（writeBatch）
//   🆔b alias 管理：aliasOf 欄位 — admin 設「鴨腳木」=「鵝掌柴」的別名
//   🆔d CSV bulk import：上傳 CSV → 預覽 → setDoc(merge:true) 平行寫入
//   🆔e 變更歷史：每次儲存寫一筆到 species/{id}/history sub-collection + modal 檢視

import { fb, $, $$, el, toast, state } from './app.js';

const CONS_GRADES = ['', 'I', 'II', 'III'];  // '' = 無保育級
const BATCH_OP_LIMIT = 450;  // Firestore writeBatch 上限 500，預留 buffer

let _state = {
  filter: 'unverified',
  docs: [],
  unsub: null,
  selected: new Set(),  // v2.7.11 🆔c：選取的 docIds
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
    // filter 變化時清掉跨 filter 不可見的選取（避免「看不見的勾」造成意外刪除）
    _state.selected.clear();
    renderTable();
    updateBatchBar();
  };
  $$('.species-filter-btn').forEach(b => b.addEventListener('click', () => setFilter(b.dataset.filter)));

  // 🆔c 全選 / 反選（限當前 filter）
  $('#species-check-all').addEventListener('change', (e) => {
    const visible = filterDocs();
    if (e.target.checked) visible.forEach(d => _state.selected.add(d.id));
    else visible.forEach(d => _state.selected.delete(d.id));
    renderTable();
    updateBatchBar();
  });

  // 🆔c 批次按鈕
  $('#btn-species-batch-verify').addEventListener('click', () => batchVerify(true));
  $('#btn-species-batch-unverify').addEventListener('click', () => batchVerify(false));
  $('#btn-species-batch-delete').addEventListener('click', batchDelete);
  $('#btn-species-batch-clear').addEventListener('click', () => {
    _state.selected.clear();
    renderTable();
    updateBatchBar();
  });

  // 🆔d CSV 匯入入口
  $('#btn-species-bulk-import').addEventListener('click', openCsvImportModal);

  // 即時 listener — 字典筆數預期上百筆，全量 load 一次後 onSnapshot 即時更新
  if (_state.unsub) _state.unsub();
  _state.unsub = fb.onSnapshot(fb.collection(fb.db, 'species'), snap => {
    _state.docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _state.docs.sort((a, b) => (a.zh || '').localeCompare(b.zh || '', 'zh-Hant'));
    // 清除已不存在的 selected ids
    const liveIds = new Set(_state.docs.map(d => d.id));
    _state.selected.forEach(id => { if (!liveIds.has(id)) _state.selected.delete(id); });
    renderTable();
    updateStats();
    updateBatchBar();
  }, err => {
    console.error('[species-admin onSnapshot]', err);
    toast('載入字典失敗：' + err.message);
  });

  setFilter(_state.filter);
}

function filterDocs() {
  return _state.docs.filter(d =>
    _state.filter === 'all' ? true :
    _state.filter === 'unverified' ? !d.verified :
    !!d.verified
  );
}

function updateStats() {
  const total = _state.docs.length;
  const verified = _state.docs.filter(d => d.verified).length;
  const aliases = _state.docs.filter(d => d.aliasOf).length;
  const stats = $('#species-stats');
  if (stats) stats.textContent =
    `共 ${total} 種 — ✅ ${verified} 已驗證 / ⏳ ${total - verified} 待補充 / ↪ ${aliases} 別名`;
}

// v2.7.11 🆔c：批次操作 bar 顯示控制
function updateBatchBar() {
  const bar = $('#species-batch-bar');
  if (!bar) return;
  const n = _state.selected.size;
  bar.classList.toggle('hidden', n === 0);
  const cnt = $('#species-batch-count');
  if (cnt) cnt.textContent = String(n);
  // 全選 checkbox 同步：當前 filter 是否全部都選
  const checkAll = $('#species-check-all');
  if (checkAll) {
    const visible = filterDocs();
    checkAll.checked = visible.length > 0 && visible.every(d => _state.selected.has(d.id));
    checkAll.indeterminate = !checkAll.checked && visible.some(d => _state.selected.has(d.id));
  }
}

function renderTable() {
  const filtered = filterDocs();
  const body = $('#species-table-body');
  if (!body) return;
  body.innerHTML = '';
  if (filtered.length === 0) {
    body.appendChild(el('tr', {},
      el('td', { colspan: '7', class: 'text-center text-stone-500 py-6 text-sm' }, '此分類無資料')
    ));
    return;
  }
  // v2.7.11 🆔b：建主名 docId → zh 反查表，給 alias 列顯示「→ 主名」用
  const docById = new Map(_state.docs.map(d => [d.id, d]));
  // 反查 docId → 它的別名清單，給主名列顯示「別名包含: X, Y」用
  const aliasesByMain = new Map();
  _state.docs.forEach(d => {
    if (!d.aliasOf) return;
    if (!aliasesByMain.has(d.aliasOf)) aliasesByMain.set(d.aliasOf, []);
    aliasesByMain.get(d.aliasOf).push(d.zh);
  });
  filtered.forEach(d => body.appendChild(buildRow(d, docById, aliasesByMain)));
}

function buildRow(d, docById, aliasesByMain) {
  const isAlias = !!d.aliasOf;
  const mainDoc = isAlias ? docById.get(d.aliasOf) : null;

  // 🆔c row checkbox
  const rowCheck = el('input', {
    type: 'checkbox', class: 'w-4 h-4 accent-forest-700',
    ...(_state.selected.has(d.id) ? { checked: 'true' } : {}),
  });
  rowCheck.addEventListener('change', () => {
    if (rowCheck.checked) _state.selected.add(d.id);
    else _state.selected.delete(d.id);
    updateBatchBar();
  });

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
    type: 'checkbox', class: 'w-4 h-4 accent-forest-700',
    ...(d.verified ? { checked: 'true' } : {}),
  });
  const saveBtn = el('button', {
    class: 'bg-forest-700 hover:bg-forest-800 text-white px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap',
  }, '💾');
  saveBtn.title = '儲存（同時寫一筆變更歷史）';
  const aliasBtn = el('button', {
    class: 'border border-stone-300 hover:bg-stone-100 px-2 py-1 rounded text-xs whitespace-nowrap',
    title: isAlias ? `目前是「${mainDoc?.zh || '?'}」的別名 — 點擊改設或清除` : '設為某主名的別名（不影響既有 tree.speciesZh）',
  }, '↪');
  const historyBtn = el('button', {
    class: 'border border-stone-300 hover:bg-stone-100 px-2 py-1 rounded text-xs whitespace-nowrap',
    title: '檢視變更歷史',
  }, '📜');
  const delBtn = el('button', {
    class: 'border border-red-300 text-red-600 hover:bg-red-50 px-2 py-1 rounded text-xs whitespace-nowrap',
    title: '刪除（之後若再匯入同名會被自動 seed=false）',
  }, '🗑');

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
    if (verified && !d.verified) {
      updates.verifiedAt = fb.serverTimestamp();
      updates.verifiedBy = state.user.uid;
    }
    try {
      saveBtn.disabled = true;
      saveBtn.textContent = '⏳';
      // 🆔e：併寫一筆 history（用 batch 保證原子）
      const batch = fb.writeBatch(fb.db);
      batch.update(fb.doc(fb.db, 'species', d.id), updates);
      batch.set(fb.doc(fb.collection(fb.db, 'species', d.id, 'history')), {
        action: 'edit',
        before: { sci: d.sci || null, conservationGrade: d.conservationGrade || null, verified: !!d.verified },
        after:  { sci: updates.sci, conservationGrade: updates.conservationGrade, verified: updates.verified },
        at: fb.serverTimestamp(), by: state.user.uid, byEmail: state.user.email || null,
      });
      await batch.commit();
      toast(`已更新「${d.zh}」`);
    } catch (e) {
      toast('儲存失敗：' + e.message);
      saveBtn.disabled = false;
      saveBtn.textContent = '💾';
    }
  };

  aliasBtn.onclick = () => openAliasModal(d);
  historyBtn.onclick = () => openHistoryModal(d);

  delBtn.onclick = async () => {
    if (!confirm(
      `刪除字典項目「${d.zh}」？\n\n` +
      `• 之後若有專案匯入同樣中文名，會被 import wizard 重新 seed（verified=false）\n` +
      `• 此操作無法復原\n` +
      `• 既有 tree.speciesZh 引用此名稱不會被改動（樹種名是字串、非 reference）\n` +
      `• 變更歷史 sub-collection 也會一併刪除（Firestore 不級聯，但獨立 doc 用不到也無害）\n\n` +
      `確定刪除？`
    )) return;
    try {
      await fb.deleteDoc(fb.doc(fb.db, 'species', d.id));
      _state.selected.delete(d.id);
      toast(`已刪除「${d.zh}」`);
    } catch (e) {
      toast('刪除失敗：' + e.message);
    }
  };

  // 來源 / 別名 column
  const sourceParts = [];
  if (isAlias) {
    sourceParts.push(el('span', { class: 'text-amber-700 font-medium' }, `↪ 別名 → ${mainDoc?.zh || '(找不到主名)'}`));
  } else {
    const aliases = aliasesByMain.get(d.id) || [];
    if (aliases.length) {
      sourceParts.push(el('span', { class: 'text-stone-700' }, `別名: ${aliases.join('、')}`));
    }
    const src = d.sourceProjectCode ? `${d.addedFrom || '?'} · ${d.sourceProjectCode}` : (d.addedFrom || '—');
    sourceParts.push(el('span', { class: 'text-stone-500' }, src));
  }

  const verifyBadge = d.verified
    ? el('span', { class: 'text-green-700 text-xs', title: '已驗證' }, ' ✓')
    : el('span', { class: 'text-amber-600 text-xs', title: '待補充' }, ' ⏳');

  const rowCls = isAlias ? 'border-t bg-amber-50/50 hover:bg-amber-50 align-middle' : 'border-t hover:bg-stone-50 align-middle';

  return el('tr', { class: rowCls },
    el('td', { class: 'px-2 py-1 text-center' }, rowCheck),
    el('td', { class: 'px-2 py-1 font-medium whitespace-nowrap' }, d.zh, verifyBadge),
    el('td', { class: 'px-2 py-1 min-w-[180px]' }, sciInput),
    el('td', { class: 'px-2 py-1' }, consSelect),
    el('td', { class: 'px-2 py-1 text-center' }, verifiedCb),
    el('td', { class: 'px-2 py-1 text-xs whitespace-nowrap' },
      el('div', { class: 'flex flex-col gap-0.5' }, ...sourceParts)
    ),
    el('td', { class: 'px-2 py-1' },
      el('div', { class: 'flex gap-1' }, saveBtn, aliasBtn, historyBtn, delBtn)
    ),
  );
}

// ===== 🆔c 批次操作 =====
async function batchVerify(targetVerified) {
  if (_state.selected.size === 0) return;
  const ids = [..._state.selected];
  const action = targetVerified ? '標已驗證' : '標待補充';
  if (!confirm(`批次${action} ${ids.length} 筆樹種？\n\n• 同步寫入變更歷史\n• verified=true 時會補 verifiedAt / verifiedBy（首次）`)) return;
  try {
    await runInBatches(ids, (batch, id) => {
      const d = _state.docs.find(x => x.id === id);
      if (!d) return;
      const updates = { verified: targetVerified, reviewedAt: fb.serverTimestamp(), reviewedBy: state.user.uid };
      if (targetVerified && !d.verified) {
        updates.verifiedAt = fb.serverTimestamp();
        updates.verifiedBy = state.user.uid;
      }
      batch.update(fb.doc(fb.db, 'species', id), updates);
      batch.set(fb.doc(fb.collection(fb.db, 'species', id, 'history')), {
        action: 'batch-' + (targetVerified ? 'verify' : 'unverify'),
        before: { verified: !!d.verified }, after: { verified: targetVerified },
        at: fb.serverTimestamp(), by: state.user.uid, byEmail: state.user.email || null,
      });
    }, 2);  // 每 op 含 update + set = 2 ops
    _state.selected.clear();
    toast(`✓ 已批次${action} ${ids.length} 筆`);
  } catch (e) {
    toast('批次操作失敗：' + e.message);
  }
}

async function batchDelete() {
  if (_state.selected.size === 0) return;
  const ids = [..._state.selected];
  const sample = ids.slice(0, 5).map(id => _state.docs.find(x => x.id === id)?.zh || id).join('、');
  const more = ids.length > 5 ? ` 等 ${ids.length} 筆` : '';
  if (!confirm(`批次刪除 ${ids.length} 筆樹種：${sample}${more}？\n\n• 之後若再匯入同名會被自動 seed=false\n• 既有 tree.speciesZh 引用不會被改動\n• 此操作無法復原\n\n確定刪除？`)) return;
  try {
    await runInBatches(ids, (batch, id) => batch.delete(fb.doc(fb.db, 'species', id)), 1);
    _state.selected.clear();
    toast(`✓ 已批次刪除 ${ids.length} 筆`);
  } catch (e) {
    toast('批次刪除失敗：' + e.message);
  }
}

// 通用 batch 拆桶 helper（每桶 ≤ BATCH_OP_LIMIT ops；opsPerItem 是每個 id 會吃幾個 op）
async function runInBatches(ids, addOps, opsPerItem = 1) {
  const itemsPerBatch = Math.floor(BATCH_OP_LIMIT / opsPerItem);
  for (let i = 0; i < ids.length; i += itemsPerBatch) {
    const slice = ids.slice(i, i + itemsPerBatch);
    const batch = fb.writeBatch(fb.db);
    slice.forEach(id => addOps(batch, id));
    await batch.commit();
  }
}

// ===== 🆔b alias 設定 modal =====
function openAliasModal(d) {
  // 用主畫面外層 modal slot — 為避開既有 forms.js 的 expand/restore 邏輯，這裡用簡易自訂 overlay
  const tpl = $('#tpl-species-alias-set').content.cloneNode(true);
  const wrap = el('div', { class: 'fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-lg shadow-lg p-4 max-w-md w-full' });
  card.appendChild(tpl);
  wrap.appendChild(card);
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });

  // 填入目前 source zh
  card.querySelector('#alias-source-zh').textContent = `「${d.zh}」`;

  // 填入 datalist（排除自己 + 排除已是別名的列 — 別名不能再當別名）
  const dl = card.querySelector('#dl-alias-targets');
  _state.docs.filter(x => x.id !== d.id && !x.aliasOf).forEach(x => {
    dl.appendChild(el('option', { value: x.zh }));
  });

  const input = card.querySelector('#alias-target-input');
  if (d.aliasOf) {
    const main = _state.docs.find(x => x.id === d.aliasOf);
    input.value = main?.zh || '';
  }

  // 清除別名 button — 只在已是別名時顯示
  const clearBtn = card.querySelector('#btn-alias-clear');
  if (d.aliasOf) clearBtn.classList.remove('hidden');
  clearBtn.onclick = async () => {
    try {
      const batch = fb.writeBatch(fb.db);
      batch.update(fb.doc(fb.db, 'species', d.id), {
        aliasOf: null,
        reviewedAt: fb.serverTimestamp(), reviewedBy: state.user.uid,
      });
      batch.set(fb.doc(fb.collection(fb.db, 'species', d.id, 'history')), {
        action: 'alias-clear',
        before: { aliasOf: d.aliasOf }, after: { aliasOf: null },
        at: fb.serverTimestamp(), by: state.user.uid, byEmail: state.user.email || null,
      });
      await batch.commit();
      toast(`已清除「${d.zh}」的別名指向`);
      close();
    } catch (e) { toast('清除失敗：' + e.message); }
  };

  card.querySelector('#btn-alias-cancel').onclick = close;
  card.querySelector('#btn-alias-confirm').onclick = async () => {
    const targetZh = input.value.trim();
    if (!targetZh) return toast('請輸入目標主名');
    if (targetZh === d.zh) return toast('不能設成自己');
    const target = _state.docs.find(x => x.zh === targetZh);
    if (!target) return toast(`找不到「${targetZh}」— 請先建立此主名 dict 項目`);
    if (target.aliasOf) return toast(`「${targetZh}」本身已是別名，不能當主名`);
    try {
      const batch = fb.writeBatch(fb.db);
      batch.update(fb.doc(fb.db, 'species', d.id), {
        aliasOf: target.id,
        reviewedAt: fb.serverTimestamp(), reviewedBy: state.user.uid,
      });
      batch.set(fb.doc(fb.collection(fb.db, 'species', d.id, 'history')), {
        action: 'alias-set',
        before: { aliasOf: d.aliasOf || null }, after: { aliasOf: target.id, aliasOfZh: target.zh },
        at: fb.serverTimestamp(), by: state.user.uid, byEmail: state.user.email || null,
      });
      await batch.commit();
      toast(`已設「${d.zh}」為「${target.zh}」的別名`);
      close();
    } catch (e) { toast('設定失敗：' + e.message); }
  };
}

// ===== 🆔d CSV 批次匯入 modal =====
function openCsvImportModal() {
  const tpl = $('#tpl-species-csv-import').content.cloneNode(true);
  const wrap = el('div', { class: 'fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-lg shadow-lg p-4 max-w-2xl w-full' });
  card.appendChild(tpl);
  wrap.appendChild(card);
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });

  let parsedRows = [];

  const fileInput = card.querySelector('#species-csv-file');
  const previewBox = card.querySelector('#species-csv-preview');
  const confirmBtn = card.querySelector('#btn-species-csv-confirm');

  fileInput.onchange = async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      parsedRows = parseSpeciesCSV(text);
      const newCount = parsedRows.filter(r => !_state.docs.some(d => d.id === r.zh)).length;
      const updateCount = parsedRows.length - newCount;
      previewBox.classList.remove('hidden');
      previewBox.innerHTML = '';
      previewBox.appendChild(el('div', { class: 'mb-1 font-medium' },
        `共 ${parsedRows.length} 筆 — 新增 ${newCount}、合併更新 ${updateCount}`));
      const tbl = el('table', { class: 'w-full text-xs' },
        el('thead', { class: 'bg-stone-200' },
          el('tr', {},
            el('th', { class: 'px-2 py-1 text-left' }, 'zh'),
            el('th', { class: 'px-2 py-1 text-left' }, 'sci'),
            el('th', { class: 'px-2 py-1 text-left' }, 'cons'),
            el('th', { class: 'px-2 py-1 text-left' }, 'verified'),
            el('th', { class: 'px-2 py-1 text-left' }, '狀態')
          )
        ),
        el('tbody', {},
          ...parsedRows.slice(0, 50).map(r => {
            const exists = _state.docs.some(d => d.id === r.zh);
            return el('tr', { class: 'border-t' },
              el('td', { class: 'px-2 py-1' }, r.zh),
              el('td', { class: 'px-2 py-1 italic' }, r.sci || '—'),
              el('td', { class: 'px-2 py-1' }, r.conservationGrade || '無'),
              el('td', { class: 'px-2 py-1' }, r.verified ? '✓' : '⏳'),
              el('td', { class: 'px-2 py-1 text-xs' }, exists ? '🔄 合併更新' : '➕ 新增')
            );
          })
        )
      );
      previewBox.appendChild(tbl);
      if (parsedRows.length > 50) {
        previewBox.appendChild(el('p', { class: 'text-stone-500 text-xs mt-1' }, `（僅顯示前 50 筆 / 共 ${parsedRows.length} 筆）`));
      }
      confirmBtn.classList.remove('hidden');
    } catch (e) {
      previewBox.classList.remove('hidden');
      previewBox.innerHTML = `<div class="text-red-600">解析失敗：${e.message}</div>`;
      confirmBtn.classList.add('hidden');
    }
  };

  card.querySelector('#btn-species-csv-cancel').onclick = close;
  confirmBtn.onclick = async () => {
    if (parsedRows.length === 0) return;
    try {
      confirmBtn.disabled = true;
      confirmBtn.textContent = '⏳ 匯入中…';
      // 用 setDoc(merge:true) 平行寫入；同時寫 history
      await runInBatches(parsedRows.map((_, i) => i), (batch, idx) => {
        const r = parsedRows[idx];
        const docRef = fb.doc(fb.db, 'species', r.zh);
        const exists = _state.docs.some(d => d.id === r.zh);
        const payload = {
          zh: r.zh,
          sci: r.sci || null,
          conservationGrade: r.conservationGrade || null,
          verified: r.verified,
          reviewedAt: fb.serverTimestamp(), reviewedBy: state.user.uid,
        };
        if (!exists) {
          payload.addedFrom = 'csv-bulk-import';
          payload.addedAt = fb.serverTimestamp();
          payload.addedBy = state.user.uid;
        }
        if (r.verified) {
          payload.verifiedAt = fb.serverTimestamp();
          payload.verifiedBy = state.user.uid;
        }
        batch.set(docRef, payload, { merge: true });
        batch.set(fb.doc(fb.collection(fb.db, 'species', r.zh, 'history')), {
          action: exists ? 'csv-merge' : 'csv-create',
          after: { sci: payload.sci, conservationGrade: payload.conservationGrade, verified: payload.verified },
          at: fb.serverTimestamp(), by: state.user.uid, byEmail: state.user.email || null,
        });
      }, 2);
      toast(`✓ CSV 匯入完成：${parsedRows.length} 筆`);
      close();
    } catch (e) {
      toast('CSV 匯入失敗：' + e.message);
      confirmBtn.disabled = false;
      confirmBtn.textContent = '確認匯入';
    }
  };
}

// CSV 解析（最簡實作 — 假設沒有引號內逗號這種邊角；admin 自己負責格式）
function parseSpeciesCSV(text) {
  // 去 BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV 至少要有標題列 + 1 筆資料');
  const headers = lines[0].split(',').map(h => h.trim());
  const required = ['zh'];
  for (const r of required) if (!headers.includes(r)) throw new Error(`缺必填欄位「${r}」`);
  const idxZh = headers.indexOf('zh');
  const idxSci = headers.indexOf('sci');
  const idxCons = headers.indexOf('conservationGrade');
  const idxVerified = headers.indexOf('verified');
  const rows = [];
  const seen = new Set();
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map(c => c.trim());
    const zh = cells[idxZh];
    if (!zh) continue;
    if (seen.has(zh)) continue;  // 跳過 CSV 內重複
    seen.add(zh);
    const cons = idxCons >= 0 ? cells[idxCons] : '';
    if (cons && !['I', 'II', 'III'].includes(cons)) {
      throw new Error(`第 ${i + 1} 列 conservationGrade「${cons}」不是 I/II/III/空白`);
    }
    rows.push({
      zh,
      sci: idxSci >= 0 ? cells[idxSci] : '',
      conservationGrade: cons,
      verified: idxVerified >= 0 && (cells[idxVerified] || '').toLowerCase() === 'true',
    });
  }
  return rows;
}

// ===== 🆔e 變更歷史 modal =====
function openHistoryModal(d) {
  const tpl = $('#tpl-species-history').content.cloneNode(true);
  const wrap = el('div', { class: 'fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4' });
  const card = el('div', { class: 'bg-white rounded-lg shadow-lg p-4 max-w-2xl w-full' });
  card.appendChild(tpl);
  wrap.appendChild(card);
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });

  card.querySelector('#history-zh').textContent = `「${d.zh}」`;
  card.querySelector('#btn-history-close').onclick = close;

  const list = card.querySelector('#history-list');
  list.innerHTML = '<div class="p-3 text-stone-500 text-xs">載入中…</div>';
  fb.getDocs(fb.query(
    fb.collection(fb.db, 'species', d.id, 'history'),
    fb.orderBy('at', 'desc')
  )).then(snap => {
    list.innerHTML = '';
    if (snap.empty) {
      list.appendChild(el('div', { class: 'p-3 text-stone-500 text-xs' }, '尚無變更歷史（此功能於 v2.7.11 上線；此前的編輯不會有歷史紀錄）'));
      return;
    }
    snap.docs.forEach(doc => {
      const h = doc.data();
      const at = h.at?.toDate ? h.at.toDate().toLocaleString('zh-TW') : '—';
      const by = h.byEmail || h.by || '—';
      const beforeStr = h.before ? Object.entries(h.before).map(([k, v]) => `${k}=${formatVal(v)}`).join(', ') : '';
      const afterStr = h.after ? Object.entries(h.after).map(([k, v]) => `${k}=${formatVal(v)}`).join(', ') : '';
      list.appendChild(el('div', { class: 'border-b p-2' },
        el('div', { class: 'flex justify-between items-baseline' },
          el('span', { class: 'font-medium' }, h.action || '?'),
          el('span', { class: 'text-stone-500' }, `${at} · ${by}`)
        ),
        beforeStr ? el('div', { class: 'text-stone-600 mt-0.5' }, '前: ', beforeStr) : null,
        afterStr ? el('div', { class: 'text-stone-700' }, '後: ', afterStr) : null,
      ));
    });
  }).catch(e => {
    list.innerHTML = `<div class="p-3 text-red-600 text-xs">載入歷史失敗：${e.message}</div>`;
  });
}

function formatVal(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

// 離開頁面時清 listener（route 切走時呼叫）
export function disposeSpeciesDict() {
  if (_state.unsub) {
    _state.unsub();
    _state.unsub = null;
  }
  _state.selected.clear();
}
