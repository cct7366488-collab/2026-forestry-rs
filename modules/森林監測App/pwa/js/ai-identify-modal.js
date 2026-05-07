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

import { el, toast, isSystemAdmin } from './app.js?v=21116';
import { identifySpecies, getApiKey, setApiKey, clearApiKey, getProxyUrl, setProxyUrl, clearProxyUrl, getEffectiveApiKey, getEffectiveProxyUrl, loadGlobalAiConfig, setGlobalAiConfig, getLlmKey, setLlmKey, clearLlmKey, getEffectiveLlmKey, getEffectiveLlmModel, enrichWithLLM, resizeImage, matchToLocalSpecies, lookupChineseName, LLM_MODELS } from './ai-species.js?v=21116';
import { loadSpeciesCache } from './species-picker.js?v=21116';

// v2.11.7：加 forceSetup 旗標 — 「編輯全域設定」按鈕走這條，不論 effective 是否滿足都進設定畫面
export async function openAiIdentifyModal({ onPick, forceSetup = false } = {}) {
  const wrap = el('div', { class: 'fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto' });
  const card = el('div', { class: 'bg-white rounded-lg shadow-lg p-4 max-w-md w-full my-8' });
  wrap.appendChild(card);
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });

  card.appendChild(el('div', { class: 'flex justify-between items-center mb-3 pb-2 border-b' },
    el('h3', { class: 'font-bold text-lg' }, '📸 AI 樹種辨識'),
    el('button', {
      type: 'button', class: 'text-stone-500 hover:text-stone-900 text-xl leading-none',
      onclick: close
    }, '✕')
  ));

  // v2.11.4：先 await effective key/proxy（含 Firestore admin 全域）
  const [effKey, effProxy] = await Promise.all([getEffectiveApiKey(), getEffectiveProxyUrl()]);
  const global = await loadGlobalAiConfig();
  const amAdmin = isSystemAdmin();

  // === effective key/proxy 任一缺 OR 明確要求 forceSetup → 設定流程 ===
  if (!effKey || !effProxy || forceSetup) {
    const setup = el('div', { class: 'space-y-3' });

    // 非 admin 且 admin 沒設過全域 → 提示「請聯絡 admin」
    if (!amAdmin && !global?.plantnetApiKey && !global?.plantnetProxyUrl) {
      const hint = el('div', { class: 'bg-amber-50 border border-amber-300 rounded p-3 text-sm' });
      hint.innerHTML = `
        <p class="font-medium mb-2">⚠ 尚未設定 AI 辨識</p>
        <p class="text-xs mb-2">系統 admin 還沒設定 PlantNet API key + CORS Proxy URL（全域共用）。請聯絡 admin 完成設定，或自己暫時設個人 key。</p>
      `;
      setup.appendChild(hint);
    }

    if (amAdmin) {
      // admin：寫全域（Firestore）
      const adminHint = el('div', { class: 'bg-blue-50 border border-blue-300 rounded p-3 text-sm' });
      adminHint.innerHTML = `
        <p class="font-medium mb-1">⚙️ 全域設定（admin only）— 寫入 Firestore，全 user 共用</p>
        <p class="text-[10px] text-stone-600">取得方式：<a href="https://my.plantnet.org/" target="_blank" rel="noopener" class="text-blue-700 underline">my.plantnet.org</a> 註冊+認證信→Generate key；CF Worker 5 分鐘建好。</p>
      `;
      setup.appendChild(adminHint);

      setup.appendChild(el('label', { class: 'text-xs font-medium' }, 'Pl@ntNet API key（全域）'));
      const adminKeyInput = el('input', {
        type: 'text', placeholder: '2b10... (貼完整 key)',
        value: global?.plantnetApiKey || '',
        class: 'border rounded px-2 py-1.5 w-full font-mono text-xs',
      });
      setup.appendChild(adminKeyInput);

      setup.appendChild(el('label', { class: 'text-xs font-medium mt-2' }, 'Proxy URL（全域）'));
      const adminProxyInput = el('input', {
        type: 'text', placeholder: 'https://xxx.workers.dev',
        value: global?.plantnetProxyUrl || '',
        class: 'border rounded px-2 py-1.5 w-full font-mono text-xs',
      });
      setup.appendChild(adminProxyInput);

      // v2.11.5：LLM 補詳細解釋（optional，可空白）
      setup.appendChild(el('label', { class: 'text-xs font-medium mt-2' },
        'Anthropic Claude API key（全域，選填 — 啟用詳細解釋）'));
      const adminLlmInput = el('input', {
        type: 'text', placeholder: 'sk-ant-... (留空=不啟用 LLM 補詳細)',
        value: global?.llmApiKey || '',
        class: 'border rounded px-2 py-1.5 w-full font-mono text-xs',
      });
      setup.appendChild(adminLlmInput);
      setup.appendChild(el('div', { class: 'text-[10px] text-stone-500 mt-0.5' },
        '取得：console.anthropic.com/settings/keys（須加值至少 $5；Claude Pro 月費不含 API）'));

      // v2.11.6：LLM model 選擇 — 預設 Haiku 省 3 倍成本
      setup.appendChild(el('label', { class: 'text-xs font-medium mt-2' }, 'LLM 模型'));
      const adminModelSel = el('select', {
        class: 'border rounded px-2 py-1.5 text-xs w-full',
      });
      const currentModel = global?.llmModel || 'claude-haiku-4-5-20251001';
      Object.entries(LLM_MODELS).forEach(([k, m]) => {
        const opt = el('option', { value: k }, `${m.label} ${m.pricePerCall} — ${m.desc}`);
        if (k === currentModel) opt.setAttribute('selected', 'true');
        adminModelSel.appendChild(opt);
      });
      setup.appendChild(adminModelSel);

      const saveAdminBtn = el('button', {
        type: 'button',
        class: 'bg-blue-700 hover:bg-blue-800 text-white px-3 py-1.5 rounded text-sm font-medium w-full mt-2',
      }, '💾 儲存到全域 (admin)');
      saveAdminBtn.addEventListener('click', async () => {
        const k = adminKeyInput.value.trim();
        const p = adminProxyInput.value.trim();
        const l = adminLlmInput.value.trim();          // 可空
        const m = adminModelSel.value;                 // v2.11.6
        if (!k) { toast('請貼上 Pl@ntNet API key'); return; }
        if (!p) { toast('請貼上 Proxy URL'); return; }
        if (!/^https:\/\//.test(p)) { toast('Proxy URL 須以 https:// 開頭'); return; }
        try {
          saveAdminBtn.disabled = true; saveAdminBtn.textContent = '⏳ 寫入...';
          await setGlobalAiConfig({ plantnetApiKey: k, plantnetProxyUrl: p, llmApiKey: l || null, llmModel: m });
          toast('✓ 全域設定已儲存');
          close();
          openAiIdentifyModal({ onPick });
        } catch (e) {
          toast('儲存失敗：' + e.message);
          saveAdminBtn.disabled = false; saveAdminBtn.textContent = '💾 儲存到全域 (admin)';
        }
      });
      setup.appendChild(saveAdminBtn);
    }

    // 所有 user 都可設個人 override（localStorage）
    setup.appendChild(el('details', { class: 'mt-2' },
      el('summary', { class: 'text-xs text-blue-700 cursor-pointer' },
        amAdmin ? '👤 或設個人 override（不寫全域）' : '👤 設個人 key（暫時用，admin 設好全域後可清掉）'),
      (() => {
        const userBox = el('div', { class: 'space-y-2 mt-2' });
        userBox.appendChild(el('label', { class: 'text-xs' }, 'PlantNet API key（個人）'));
        const userKeyInput = el('input', {
          type: 'text', placeholder: '2b10...', value: getApiKey() || '',
          class: 'border rounded px-2 py-1.5 w-full font-mono text-xs',
        });
        userBox.appendChild(userKeyInput);
        userBox.appendChild(el('label', { class: 'text-xs' }, 'Proxy URL（個人）'));
        const userProxyInput = el('input', {
          type: 'text', placeholder: 'https://xxx.workers.dev', value: getProxyUrl() || '',
          class: 'border rounded px-2 py-1.5 w-full font-mono text-xs',
        });
        userBox.appendChild(userProxyInput);
        const saveUserBtn = el('button', {
          type: 'button',
          class: 'bg-stone-700 hover:bg-stone-800 text-white px-3 py-1 rounded text-xs font-medium',
        }, '儲存個人設定');
        saveUserBtn.addEventListener('click', () => {
          const k = userKeyInput.value.trim();
          const p = userProxyInput.value.trim();
          if (k) setApiKey(k);
          if (p) {
            if (!/^https:\/\//.test(p)) { toast('Proxy URL 須以 https:// 開頭'); return; }
            setProxyUrl(p);
          }
          toast('✓ 個人設定已儲存');
          close();
          openAiIdentifyModal({ onPick });
        });
        userBox.appendChild(saveUserBtn);
        return userBox;
      })()
    ));

    card.appendChild(setup);
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

    // v2.11.5：佔位給 LLM 補詳細結果（imageQuality + characteristics/habitat）
    const llmTopBox = el('div', { class: 'mb-2' });
    resultsBox.appendChild(llmTopBox);

    // 每個 candidate 對應一個 detail box（LLM enrich 完後 inline 注入）
    const detailBoxes = {};   // sci → detail container element
    // v2.11.16：每筆候選的中文名動態狀態 — 來源優先序 字典(4) > iNat(3) > LLM(2) > 英文(1) > 查詢中(0)
    //   onPick 點選時用 rowStates[sci].zh 而非 closure 內的初始 zh
    const rowStates = {};   // sci → { zhSpan, sourceSpan, zh, sourcePri, localSp, englishFallback }

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

      // v2.11.16：初始顯示 — 字典命中直接用，否則先擱「⏳ 查中文名…」由 iNat / LLM 填
      //   (避免先閃英文再變中文的視覺跳動；iNat 通常 <300ms 就回)
      const englishFallback = r.commonNames?.[0] || '';
      const initialZh = localSp?.zh || (englishFallback ? '⏳ 查中文名…' : '(無中名)');
      const initialPri = localSp ? 4 : 0;
      const initialSourceLabel = localSp
        ? '<span class="text-[10px] bg-green-200 text-green-900 px-1 rounded ml-1">✓ 字典中</span>'
        : '<span class="text-[10px] bg-stone-200 text-stone-700 px-1 rounded ml-1">⏳ 查詢中</span>';
      const consTag = localSp?.conservationGrade
        ? `<span class="text-[10px] bg-red-200 text-red-900 px-1 rounded ml-1">⚠ 保育 ${escHtml(localSp.conservationGrade)}</span>`
        : '';
      const familyStr = r.family ? `${escHtml(r.family)}` : '—';
      const aliases = r.commonNames?.slice(0, 3).join(' / ') || '';

      const row = el('div', { class: `border-2 rounded p-2 mb-2 cursor-pointer hover:shadow-md transition ${cls}` });
      row.innerHTML = `
        <div class="flex items-baseline justify-between mb-1">
          <div class="font-bold text-base"><span class="ai-zh-name">${escHtml(initialZh)}</span><span class="ai-zh-source">${initialSourceLabel}</span>${consTag}</div>
          <div class="text-sm font-bold ${scoreClsText} whitespace-nowrap ml-2">${scorePct}%</div>
        </div>
        <div class="text-xs italic text-stone-700">${escHtml(r.sci)}</div>
        <div class="text-[10px] text-stone-500 mt-0.5">科 ${familyStr}${aliases ? ` · 別名 ${escHtml(aliases)}` : ''}</div>
      `;
      const zhSpan = row.querySelector('.ai-zh-name');
      const sourceSpan = row.querySelector('.ai-zh-source');
      rowStates[r.sci] = { zhSpan, sourceSpan, zh: initialZh, sourcePri: initialPri, localSp, englishFallback };

      row.addEventListener('click', () => {
        const st = rowStates[r.sci];
        // 取目前已 resolve 的最佳 zh；若還在「⏳ 查中文名…」狀態則 fallback 英文
        const finalZh = (st.sourcePri >= 1) ? st.zh : (englishFallback || '(無中名)');
        // v2.11.3：onPick 多帶 imageBlob，讓 caller 把這張照片自動加入 tree.photos（一動作雙功能）
        if (onPick) onPick({
          zh: finalZh, sci: r.sci, localSpecies: localSp, aiResult: r,
          imageBlob: _imageBlob,
        });
        toast(`✓ AI 套用：${finalZh}（信心 ${scorePct}%）+ 照片已入立木紀錄`, 3000);
        close();
      });
      // v2.11.5：detail box 在 row 下方 — LLM enrich 完後填內容
      const detail = el('div', { class: 'text-[11px] text-stone-600 px-2 py-1 border-l-2 border-stone-200 ml-2 hidden' });
      detailBoxes[r.sci] = detail;
      resultsBox.appendChild(row);
      resultsBox.appendChild(detail);
    });
    // hint
    resultsBox.appendChild(el('div', { class: 'text-[10px] text-stone-500 mt-2 border-t pt-2' },
      '✓ 字典中 = 已對應 Firestore 224 種；🌐 iNat = iNaturalist 中文名；🔬 LLM = Claude 推論；⚠ 字典外（英文）= 中文查無'));

    // v2.11.16：iNat 中文名查詢 — 字典外候選並行 fetch、resolve 後即時更新標題
    results.slice(0, 3).forEach(r => {
      const st = rowStates[r.sci];
      if (!st || st.sourcePri >= 4) return;   // 字典命中不查
      lookupChineseName(r.sci).then(zh => {
        if (zh) {
          updateZhName(st, zh, 3, '🌐 iNat', 'bg-blue-200 text-blue-900');
        } else if (st.sourcePri < 1) {
          // iNat 無中文名 → fallback 英文
          updateZhName(st, st.englishFallback || '(無中名)', 1,
            '⚠ 字典外（英文）', 'bg-amber-200 text-amber-900');
        }
      }).catch(() => {
        if (st.sourcePri < 1) {
          updateZhName(st, st.englishFallback || '(無中名)', 1,
            '⚠ 字典外（英文）', 'bg-amber-200 text-amber-900');
        }
      });
    });

    // v2.11.5：背景 fire LLM enrich（若有 LLM key）
    getEffectiveLlmKey().then(llmKey => {
      if (!llmKey) return;
      const top3 = results.slice(0, 3);
      llmTopBox.innerHTML = '<div class="text-[11px] text-stone-500">🔬 LLM 補詳細解釋中...（約 5-15 秒）</div>';
      enrichWithLLM(_imageBlob, top3)
        .then(enriched => {
          // 顯示 imageQuality
          if (enriched?.imageQuality) {
            const q = enriched.imageQuality;
            const qReason = enriched.imageQualityReason || '';
            const cls = q === 'good' ? 'bg-green-50 border-green-300 text-green-800'
                      : q === 'poor' ? 'bg-amber-50 border-amber-300 text-amber-800'
                      : 'bg-stone-50 border-stone-300 text-stone-700';
            const icon = q === 'good' ? '✓' : q === 'poor' ? '⚠' : '?';
            llmTopBox.innerHTML = `<div class="border rounded p-1.5 text-xs ${cls}">${icon} 照片品質：<b>${escHtml(q)}</b> — ${escHtml(qReason)}</div>`;
          } else {
            llmTopBox.innerHTML = '';
          }
          // 注入 per-candidate 詳細
          (enriched?.candidates || []).forEach(c => {
            const box = detailBoxes[c.sci];
            if (!box) return;
            const native = c.isNative ? '<span class="text-green-700">原生</span>' : '<span class="text-stone-500">非原生</span>';
            // v2.11.16：LLM chineseName — iNat 沒回 / 字典外才用；iNat 已回但與 LLM 不同則在 detail 提示
            const llmZh = (c.chineseName || '').trim();
            let xrefHint = '';
            const st = rowStates[c.sci];
            if (st && llmZh && /[一-鿿]/.test(llmZh)) {
              if (st.sourcePri < 2) {
                updateZhName(st, llmZh, 2, '🔬 LLM', 'bg-purple-200 text-purple-900');
              } else if (st.sourcePri === 3 && st.zh !== llmZh) {
                xrefHint = `<br>🔬 LLM 另推：<b>${escHtml(llmZh)}</b>（顯示以 iNat 為準）`;
              }
            }
            box.innerHTML = `🔬 <b>特徵</b>: ${escHtml(c.characteristics || '—')}<br>📍 <b>棲地</b>: ${escHtml(c.habitat || '—')}（${native}）${c.notes ? `<br>📝 ${escHtml(c.notes)}` : ''}${xrefHint}`;
            box.classList.remove('hidden');
          });
        })
        .catch(e => {
          console.warn('[ai enrich]', e);
          llmTopBox.innerHTML = `<div class="text-[11px] text-amber-700">⚠ LLM 補詳細失敗：${escHtml(e?.message || String(e))}（不影響 PlantNet 結果）</div>`;
        });
    });
  }

  // v2.11.16：依優先序更新標題的中文名 + source 徽章 — newPri > 現 pri 才更
  function updateZhName(state, newZh, newPri, sourceLabel, badgeCls) {
    if (!state || !state.zhSpan || !state.sourceSpan) return;
    if (newPri <= state.sourcePri) return;
    state.zh = newZh;
    state.sourcePri = newPri;
    state.zhSpan.textContent = newZh;
    state.sourceSpan.innerHTML = `<span class="text-[10px] ${badgeCls} px-1 rounded ml-1">${sourceLabel}</span>`;
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
    // v2.11.4 底部設定區 — 顯示 effective key/proxy 來源（admin 全域 / 個人 override）
    (() => {
      const userKey = getApiKey();
      const userProxy = getProxyUrl();
      const keySource = userKey ? '個人 override' : (global?.plantnetApiKey ? 'admin 全域' : '無');
      const proxySource = userProxy ? '個人 override' : (global?.plantnetProxyUrl ? 'admin 全域' : '無');
      const llmKey = global?.llmApiKey || '';
      const llmModelKey = global?.llmModel || 'claude-haiku-4-5-20251001';
      const llmModelLabel = LLM_MODELS[llmModelKey]?.label || llmModelKey;
      const llmPrice = LLM_MODELS[llmModelKey]?.pricePerCall || '?';
      return el('div', { class: 'text-[10px] text-stone-500 mt-3 border-t pt-2 space-y-0.5' },
        el('div', { class: 'flex items-center justify-between' },
          el('span', {}, `🔑 key (${keySource}): ${effKey.slice(0, 8)}... (${effKey.length} 字)`),
          userKey ? el('button', {
            type: 'button', class: 'text-blue-700 hover:underline',
            onclick: () => { clearApiKey(); toast('個人 key 已清除（將回到全域設定）'); close(); }
          }, '清除個人 key') : null
        ),
        el('div', { class: 'flex items-center justify-between' },
          el('span', { class: 'truncate max-w-[60%]' }, `🔧 proxy (${proxySource}): ${effProxy}`),
          userProxy ? el('button', {
            type: 'button', class: 'text-blue-700 hover:underline',
            onclick: () => { clearProxyUrl(); toast('個人 proxy 已清除'); close(); }
          }, '清除個人 proxy') : null
        ),
        // v2.11.6：顯示 LLM 狀態
        el('div', {}, llmKey ? `🔬 LLM: ${llmModelLabel} (${llmPrice}/次)` : '🔬 LLM: 未啟用（純 PlantNet）'),
        amAdmin ? el('div', { class: 'mt-1' },
          el('button', {
            type: 'button', class: 'text-blue-700 hover:underline text-[10px]',
            // v2.11.7：直接 forceSetup 進設定畫面（不清個人 keys，保留 user override）
            onclick: () => {
              close();
              openAiIdentifyModal({ onPick, forceSetup: true });
            }
          }, '⚙️ 編輯全域設定 (admin)')
        ) : null
      );
    })()
  ));
}
