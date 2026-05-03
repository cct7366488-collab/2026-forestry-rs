// ===== ai-identify-modal.js — v2.11.0 AI 樹種辨識 modal =====
// 用法：
//   import { openAiIdentifyModal } from './ai-identify-modal.js';
//   openAiIdentifyModal({
//     onPick: ({ zh, sci, localSpecies, aiResult }) => {
//       // user 選了一個結果 — 套用到 caller 的 form 欄位
//     }
//   });
//
// 流程：
//   1. 檢查 localStorage 有無 Pl@ntNet API key
//      - 無 → 顯示「請去 my.plantnet.org 註冊取 free key」設定區
//   2. 拍照（手機 capture=environment）或選圖
//   3. 選器官（葉/花/果/皮/全株/auto）
//   4. POST → top-3 結果（含中文 if 字典命中 + 信心 % + 學名 + 科）
//   5. 點選一筆 → onPick + close modal

import { el, toast } from './app.js?v=21101';
import { identifySpecies, getApiKey, setApiKey, clearApiKey, resizeImage, matchToLocalSpecies } from './ai-species.js?v=21101';
import { loadSpeciesCache } from './species-picker.js?v=21101';

export function openAiIdentifyModal({ onPick } = {}) {
  const wrap = el('div', { class: 'fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto' });
  const card = el('div', { class: 'bg-white rounded-lg shadow-lg p-4 max-w-md w-full my-8' });
  wrap.appendChild(card);
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  // 點 backdrop 關閉
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });

  // 標題列
  card.appendChild(el('div', { class: 'flex justify-between items-center mb-3 pb-2 border-b' },
    el('h3', { class: 'font-bold text-lg' }, '📸 AI 樹種辨識'),
    el('button', {
      type: 'button', class: 'text-stone-500 hover:text-stone-900 text-xl leading-none',
      onclick: close
    }, '✕')
  ));

  // === API key 未設 → 設定流程 ===
  if (!getApiKey()) {
    const setup = el('div', { class: 'space-y-3' });
    const hint = el('div', { class: 'bg-amber-50 border border-amber-300 rounded p-3 text-sm' });
    hint.innerHTML = `
      <p class="font-medium mb-2">⚠ 需要 Pl@ntNet API key（首次設定）</p>
      <ol class="list-decimal list-inside space-y-1 text-xs ml-1">
        <li>到 <a href="https://my.plantnet.org/" target="_blank" rel="noopener" class="text-blue-700 underline">my.plantnet.org</a> 免費註冊</li>
        <li>登入 → 右上角頭像 → My account → API key</li>
        <li>產生 key（free tier 每日 500 次辨識）</li>
        <li>複製 key 貼到下方</li>
      </ol>
      <p class="text-[10px] text-stone-600 mt-2">key 只存在你瀏覽器（localStorage），不會送到我們 server。</p>
    `;
    setup.appendChild(hint);
    const keyInput = el('input', {
      type: 'text', placeholder: '貼上 Pl@ntNet API key',
      class: 'border rounded px-2 py-1.5 w-full font-mono text-sm',
    });
    setup.appendChild(keyInput);
    const saveBtn = el('button', {
      type: 'button',
      class: 'bg-forest-700 hover:bg-forest-800 text-white px-3 py-1.5 rounded text-sm font-medium w-full',
    }, '儲存並開始');
    saveBtn.addEventListener('click', () => {
      const k = keyInput.value.trim();
      if (!k) { toast('請貼上 API key'); return; }
      setApiKey(k);
      close();
      // 重新開啟 modal 進入主流程
      openAiIdentifyModal({ onPick });
    });
    setup.appendChild(saveBtn);
    card.appendChild(setup);
    setTimeout(() => keyInput.focus(), 50);
    return;
  }

  // === 主流程 ===
  let _imageBlob = null;

  const fileInput = el('input', {
    type: 'file', accept: 'image/*', capture: 'environment',
    class: 'block w-full text-sm border rounded p-1',
  });
  const preview = el('img', {
    class: 'mt-2 max-h-64 rounded border hidden mx-auto',
    style: 'object-fit:contain',
  });
  const organSel = el('select', { class: 'border rounded px-2 py-1 text-sm' },
    el('option', { value: 'auto' }, 'auto 自動'),
    el('option', { value: 'leaf' }, 'leaf 葉'),
    el('option', { value: 'bark' }, 'bark 樹皮'),
    el('option', { value: 'flower' }, 'flower 花'),
    el('option', { value: 'fruit' }, 'fruit 果實'),
    el('option', { value: 'habit' }, 'habit 全株'),
  );
  organSel.value = 'leaf';   // 葉子最容易辨識
  const idBtn = el('button', {
    type: 'button',
    class: 'bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 rounded text-sm font-medium disabled:bg-stone-300',
    disabled: 'true',
  }, '🔍 辨識');
  const resultsBox = el('div', { class: 'mt-3' });

  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (!f) { _imageBlob = null; idBtn.disabled = true; return; }
    _imageBlob = f;
    preview.src = URL.createObjectURL(f);
    preview.classList.remove('hidden');
    idBtn.disabled = false;
    resultsBox.innerHTML = '';
  });

  idBtn.addEventListener('click', async () => {
    if (!_imageBlob) return;
    idBtn.disabled = true;
    const oldText = idBtn.textContent;
    idBtn.textContent = '⏳ 辨識中...';
    resultsBox.innerHTML = '<div class="text-stone-500 text-sm py-2">⏳ 上傳並辨識中（10-30 秒）...</div>';
    try {
      const small = await resizeImage(_imageBlob, 800);
      const results = await identifySpecies(small, { organs: [organSel.value] });
      const allSpecies = await loadSpeciesCache();
      renderResults(results, allSpecies);
    } catch (e) {
      console.error('[ai-identify]', e);
      const msg = (e?.message === 'NO_API_KEY') ? '需要 API key（請重開 modal）' : (e?.message || String(e));
      resultsBox.innerHTML = `<div class="bg-red-50 border border-red-300 text-red-700 rounded p-2 text-sm">❌ 辨識失敗：${escHtml(msg)}</div>`;
    } finally {
      idBtn.disabled = false;
      idBtn.textContent = oldText;
    }
  });

  function renderResults(results, allSpecies) {
    if (!results || results.length === 0) {
      resultsBox.innerHTML = '<div class="text-stone-500 text-sm py-2">查無結果（可換器官 / 換照片重試）</div>';
      return;
    }
    resultsBox.innerHTML = '';
    resultsBox.appendChild(el('div', { class: 'text-xs text-stone-600 mb-2 font-medium' },
      '👇 點選最像的物種套用（依信心排序，最多 3 筆）'));
    results.slice(0, 3).forEach(r => {
      const localSp = matchToLocalSpecies(r, allSpecies);
      const scorePct = Math.round(r.score * 100);
      // 信心等級顏色
      const cls = scorePct >= 70 ? 'border-green-400 bg-green-50'
                : scorePct >= 40 ? 'border-amber-400 bg-amber-50'
                : 'border-stone-300 bg-stone-50';
      const scoreClsText = scorePct >= 70 ? 'text-green-700'
                        : scorePct >= 40 ? 'text-amber-700'
                        : 'text-stone-600';
      // 中文名 — 優先 Firestore 字典命中，其次 PlantNet commonNames，最後標 (字典外)
      const zh = localSp?.zh || r.commonNames?.[0] || '(字典中無中名)';
      const matchTag = localSp
        ? '<span class="text-[10px] bg-green-200 text-green-900 px-1 rounded ml-1">✓ 字典中</span>'
        : '<span class="text-[10px] bg-amber-200 text-amber-900 px-1 rounded ml-1">⚠ 字典外</span>';
      const consTag = localSp?.conservationGrade
        ? `<span class="text-[10px] bg-red-200 text-red-900 px-1 rounded ml-1">⚠ 保育 ${escHtml(localSp.conservationGrade)}</span>`
        : '';
      const familyStr = r.family ? `${escHtml(r.family)}` : '—';
      const aliases = r.commonNames?.slice(0, 3).join(' / ') || '';

      const row = el('div', { class: `border-2 rounded p-2 mb-2 cursor-pointer hover:shadow-md transition ${cls}` });
      row.innerHTML = `
        <div class="flex items-baseline justify-between mb-1">
          <div class="font-bold text-base">${escHtml(zh)}${matchTag}${consTag}</div>
          <div class="text-sm font-bold ${scoreClsText} whitespace-nowrap ml-2">${scorePct}%</div>
        </div>
        <div class="text-xs italic text-stone-700">${escHtml(r.sci)}</div>
        <div class="text-[10px] text-stone-500 mt-0.5">科 ${familyStr}${aliases ? ` · 別名 ${escHtml(aliases)}` : ''}</div>
      `;
      row.addEventListener('click', () => {
        const finalZh = localSp?.zh || zh;
        if (onPick) onPick({ zh: finalZh, sci: r.sci, localSpecies: localSp, aiResult: r });
        toast(`✓ AI 套用：${finalZh}（信心 ${scorePct}%）`, 3000);
        close();
      });
      resultsBox.appendChild(row);
    });
    // hint
    resultsBox.appendChild(el('div', { class: 'text-[10px] text-stone-500 mt-2 border-t pt-2' },
      '✓ 字典中 = 已對應 Firestore 224 種；⚠ 字典外 = 套用後請手動編輯字典或自由輸入'));
  }

  function escHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    })[c]);
  }

  card.appendChild(el('div', { class: 'space-y-2' },
    el('div', { class: 'text-xs text-stone-700 leading-tight' },
      '📷 拍照或選圖（葉子最準）→ 選器官 → 點辨識'),
    fileInput,
    preview,
    el('div', { class: 'flex items-center justify-between gap-2' },
      el('div', { class: 'flex items-center gap-1' },
        el('span', { class: 'text-xs text-stone-600' }, '器官:'),
        organSel
      ),
      idBtn
    ),
    resultsBox,
    // 底部設定區
    el('div', { class: 'text-[10px] text-stone-500 mt-3 border-t pt-2 flex items-center justify-between' },
      el('span', {}, `🔑 key: ${getApiKey().slice(0, 8)}...`),
      el('button', {
        type: 'button', class: 'text-blue-700 hover:underline',
        onclick: () => { clearApiKey(); toast('API key 已清除'); close(); }
      }, '清除/換 key')
    )
  ));
}
