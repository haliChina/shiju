/**
 * 拾句 · script.js
 * 功能：收藏、评分、排序、高级筛选、批量操作、
 *       导出/导入JSON、统计、标签管理、阅读模式、自动备份
 */

/* ── 常量 ── */
const STORAGE_KEY       = 'shiju_data';
const THEME_KEY         = 'shiju_theme';
const BACKUP_PREFIX     = 'shiju_backup_';
const PRESET_TAGS       = ['励志','爱情','人生','自然','友情','哲思','文学','诗词','散文','经典'];
const COLLECTIONS_KEY   = 'shiju_collections';
const CHECKIN_KEY       = 'shiju_checkins';
const DAILY_RECOMM_KEY  = 'shiju_daily_recomm';

/* ── 状态 ── */
let activeTag         = '';
let activeCollection  = '';
let searchKeyword     = '';
let sortState         = 'newest';
let filterState       = { favorite: false, exact: false, dateFrom: '', dateTo: '' };
let isBatchMode       = false;
let selectedIds       = new Set();
let editingId         = null;
let selectedTags      = [];
let detailId          = null;
let pendingDelete     = null;   // { id, isBatch: bool, ids: [] }
let readingList       = [];
let readingIndex      = 0;
let importFileData    = null;
let noteTargetId      = null;
let editingCollection = null;
let shareTargetId     = null;
let shareStyle        = 'minimal';

const SORT_LABELS = { newest:'最新', oldest:'最早', 'author-asc':'作者↑', 'author-desc':'作者↓', 'rating-desc':'评分↓' };

/* ── 数据层 ── */
function loadData() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
}
function saveData(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    autoBackup(list);
  } catch (e) {
    console.warn('saveData failed:', e);
  }
}
function loadCollections() {
  try { return JSON.parse(localStorage.getItem(COLLECTIONS_KEY)) || []; } catch { return []; }
}
function saveCollections(collections) {
  try { localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(collections)); } catch (e) { console.warn('saveCollections failed:', e); }
}
function loadCheckIns() {
  try { return JSON.parse(localStorage.getItem(CHECKIN_KEY)) || []; } catch { return []; }
}
function saveCheckIns(checkIns) {
  try { localStorage.setItem(CHECKIN_KEY, JSON.stringify(checkIns)); } catch (e) { console.warn('saveCheckIns failed:', e); }
}
function loadDailyRecomm() {
  try { return JSON.parse(localStorage.getItem(DAILY_RECOMM_KEY)) || null; } catch { return null; }
}
function saveDailyRecomm(recomm) {
  try { localStorage.setItem(DAILY_RECOMM_KEY, JSON.stringify(recomm)); } catch (e) { console.warn('saveDailyRecomm failed:', e); }
}
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2,6);
}
function esc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/\n/g,'<br>');
}
function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/* ── 自动备份 ── */
function autoBackup(list) {
  const key = BACKUP_PREFIX + new Date().toISOString().slice(0,10);
  localStorage.setItem(key, JSON.stringify(list));
  // 清理7天前备份
  const cutoff = Date.now() - 7*86400000;
  for (let i = localStorage.length-1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith(BACKUP_PREFIX)) {
      const d = new Date(k.replace(BACKUP_PREFIX,''));
      if (d < cutoff) localStorage.removeItem(k);
    }
  }
}

/* ── 主题 (light / dark / auto) ── */
const htmlEl = document.documentElement;
const THEME_ICONS = { light:'#ic-sun', dark:'#ic-moon', auto:'#ic-monitor' };
const THEME_LABELS = { light:'浅色', dark:'深色', auto:'跟随系统' };
const THEME_DESCS = { light:'当前：浅色模式', dark:'当前：深色模式', auto:'当前：跟随系统' };

let currentThemeSetting = localStorage.getItem(THEME_KEY) || 'auto';

function applyThemeSetting(val) {
  currentThemeSetting = val;
  localStorage.setItem(THEME_KEY, val);
  let effective = val;
  if (val === 'auto') {
    effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  htmlEl.setAttribute('data-theme', effective);
  // update header button
  const use  = document.getElementById('themeBtnUse');
  const lbl  = document.getElementById('themeBtnLabel');
  if (use)  use.setAttribute('href', THEME_ICONS[val]);
  if (lbl)  lbl.textContent = THEME_LABELS[val];
  // update settings switcher
  const radio = document.querySelector(`input[name="themeMode"][value="${val}"]`);
  if (radio) radio.checked = true;
  // update desc
  const desc = document.getElementById('themeDesc');
  if (desc) desc.textContent = THEME_DESCS[val];
}

// Header cycle button: light → dark → auto → light
document.getElementById('themeBtn').addEventListener('click', () => {
  const cycle = { light:'dark', dark:'auto', auto:'light' };
  applyThemeSetting(cycle[currentThemeSetting] || 'light');
});

// Settings radio buttons
document.querySelectorAll('input[name="themeMode"]').forEach(radio => {
  radio.addEventListener('change', () => { if (radio.checked) applyThemeSetting(radio.value); });
});

// Follow system theme changes in auto mode
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (currentThemeSetting === 'auto') applyThemeSetting('auto');
});

/* ── 筛选/排序核心 ── */
function getAllTags(list) {
  const s = new Set(); list.forEach(i => (i.tags||[]).forEach(t => s.add(t))); return [...s].sort();
}
function applyFilters(list) {
  const collections = loadCollections();
  const activeCol = collections.find(c => c.id === activeCollection);
  
  return list.filter(item => {
    const matchTag  = !activeTag || (item.tags||[]).includes(activeTag);
    const matchCol  = !activeCol || (activeCol.items || []).includes(item.id);
    const kw        = searchKeyword.trim().toLowerCase();
    const matchSearch = !kw || (filterState.exact
      ? item.content.toLowerCase()===kw || (item.author||'').toLowerCase()===kw
      : item.content.toLowerCase().includes(kw) || (item.author||'').toLowerCase().includes(kw));
    const matchFav  = !filterState.favorite || item.favorite;
    let matchDate   = true;
    if (filterState.dateFrom || filterState.dateTo) {
      const d = new Date(item.createdAt||0);
      if (filterState.dateFrom && d < new Date(filterState.dateFrom)) matchDate = false;
      if (filterState.dateTo) {
        const to = new Date(filterState.dateTo); to.setHours(23,59,59,999);
        if (d > to) matchDate = false;
      }
    }
    return matchTag && matchCol && matchSearch && matchFav && matchDate;
  });
}
function applySort(list) {
  const a = list.slice();
  switch (sortState) {
    case 'newest':      a.sort((x,y)=>(y.createdAt||0)-(x.createdAt||0)); break;
    case 'oldest':      a.sort((x,y)=>(x.createdAt||0)-(y.createdAt||0)); break;
    case 'author-asc':  a.sort((x,y)=>(x.author||'').localeCompare(y.author||'')); break;
    case 'author-desc': a.sort((x,y)=>(y.author||'').localeCompare(x.author||'')); break;
    case 'rating-desc': a.sort((x,y)=>(y.rating||0)-(x.rating||0)); break;
  }
  return a;
}
function tagsHtml(tags, clickable=false) {
  if (!tags||!tags.length) return '';
  return tags.map(t=>`<span class="tag${t===activeTag?' active':''}"${clickable?` data-tag="${esc(t)}"`:''} >${esc(t)}</span>`).join('');
}

/* ── 渲染层 ── */
function refreshTagFilter(list) {
  const sel = document.getElementById('tagFilter');
  const cur = activeTag;
  sel.innerHTML = '<option value="">全部标签</option>';
  getAllTags(list).forEach(t => {
    const o = document.createElement('option');
    o.value = t; o.textContent = t;
    if (t===cur) o.selected = true;
    sel.appendChild(o);
  });
}
function refreshCollectionFilter() {
  const sel = document.getElementById('collectionFilter');
  const cur = activeCollection;
  sel.innerHTML = '<option value="">全部文集</option>';
  loadCollections().forEach(c => {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = c.name;
    if (c.id===cur) o.selected = true;
    sel.appendChild(o);
  });
}

function buildCard(item) {
  const el = document.createElement('div');
  el.className = 'card' + (selectedIds.has(item.id) ? ' batch-selected' : '');
  el.dataset.id = item.id;

  const ratingHtml = Array.from({length:5},(_,i)=>
    `<svg class="star ${i<(item.rating||0)?'filled':''}"><use href="#ic-${i<(item.rating||0)?'star-fill':'star'}"/></svg>`
  ).join('');
  
  const hasNote = item.note && item.note.trim().length > 0;

  el.innerHTML = `
    <div class="card-header">
      <div class="card-checkbox-wrap">
        <input type="checkbox" class="card-checkbox" aria-label="选择" ${selectedIds.has(item.id)?'checked':''}>
      </div>
      <button class="card-fav-btn${item.favorite?' is-fav':''}" title="${item.favorite?'取消收藏':'收藏'}" aria-label="${item.favorite?'取消收藏':'收藏'}">
        <svg class="icon"><use href="#ic-${item.favorite?'star-fill':'star'}"/></svg>
      </button>
      ${hasNote ? '<span class="note-badge" title="有笔记" style="width:8px;height:8px;background:var(--c-accent);border-radius:50%;position:absolute;top:8px;left:8px;"></span>' : ''}
    </div>
    <div class="card-body">${esc(item.content)}</div>
    <div class="card-rating">${ratingHtml}</div>
    <div class="card-footer">
      <span class="card-author">${esc(item.author||'佚名')}</span>
      <div class="card-tags">${tagsHtml(item.tags,true)}</div>
      <div class="card-actions">
        <button class="card-act-btn" title="笔记" aria-label="笔记"><svg class="icon"><use href="#ic-note"/></svg></button>
        <button class="card-act-btn" title="分享" aria-label="分享"><svg class="icon"><use href="#ic-share"/></svg></button>
        <button class="card-act-btn" title="编辑" aria-label="编辑"><svg class="icon"><use href="#ic-edit"/></svg></button>
        <button class="card-act-btn act-del" title="删除" aria-label="删除"><svg class="icon"><use href="#ic-trash"/></svg></button>
      </div>
    </div>
  `;

  // Checkbox
  const cb = el.querySelector('.card-checkbox');
  cb.addEventListener('change', () => {
    if (cb.checked) { selectedIds.add(item.id); el.classList.add('batch-selected'); }
    else            { selectedIds.delete(item.id); el.classList.remove('batch-selected'); }
    updateBatchBar();
  });

  // Favorite btn
  el.querySelector('.card-fav-btn').addEventListener('click', e => {
    e.stopPropagation();
    toggleFavorite(item.id);
  });

  // Main click → detail
  el.addEventListener('click', e => {
    if (e.target.closest('.card-act-btn')||e.target.closest('.tag')||e.target.closest('.card-fav-btn')||e.target.closest('.card-checkbox-wrap')) return;
    openDetail(item.id);
  });

  // Tag click
  el.querySelectorAll('.tag[data-tag]').forEach(t => {
    t.addEventListener('click', e => {
      e.stopPropagation();
      activeTag = activeTag===t.dataset.tag ? '' : t.dataset.tag;
      document.getElementById('tagFilter').value = activeTag;
      renderCards();
    });
  });

  // Note
  el.querySelectorAll('.card-act-btn')[0].addEventListener('click', e => { e.stopPropagation(); openNoteEditor(item.id); });
  // Share
  el.querySelectorAll('.card-act-btn')[1].addEventListener('click', e => { e.stopPropagation(); openShareModal(item.id); });
  // Edit
  el.querySelectorAll('.card-act-btn')[2].addEventListener('click', e => { e.stopPropagation(); openEditor(item.id); });
  // Delete
  el.querySelector('.act-del').addEventListener('click', e => { e.stopPropagation(); openDeleteConfirm(item.id); });

  return el;
}

function renderCards() {
  const list     = loadData();
  const filtered = applyFilters(list);
  const sorted   = applySort(filtered);

  document.getElementById('totalCount').textContent = list.length;
  refreshTagFilter(list);
  refreshCollectionFilter();

  const grid = document.getElementById('cardsGrid');
  const emptyEl = document.getElementById('emptyState');
  const noRes   = document.getElementById('noResultState');

  grid.innerHTML = '';
  emptyEl.classList.remove('visible');
  noRes.style.display = 'none';
  noRes.classList.remove('visible');

  if (list.length === 0) { emptyEl.classList.add('visible'); return; }
  if (sorted.length === 0) { noRes.style.display='flex'; noRes.classList.add('visible'); return; }

  if (isBatchMode) grid.classList.add('batch-mode');
  else             grid.classList.remove('batch-mode');

  sorted.forEach((item, idx) => {
    const card = buildCard(item);
    card.style.animationDelay = `${idx*0.04}s`;
    grid.appendChild(card);
  });
}

function toggleFavorite(id) {
  const list = loadData();
  const item = list.find(x => x.id===id);
  if (!item) return;
  item.favorite = !item.favorite;
  saveData(list);
  renderCards();
  if (detailId===id) refreshDetailFavBtn(item.favorite);
  showToast(item.favorite ? '已添加到收藏' : '已取消收藏', 'info');
}

/* ── 搜索/筛选事件 ── */
const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');
searchInput.addEventListener('input', () => {
  searchKeyword = searchInput.value;
  searchClear.classList.toggle('visible', !!searchKeyword);
  renderCards();
});
searchClear.addEventListener('click', () => {
  searchInput.value = ''; searchKeyword = '';
  searchClear.classList.remove('visible');
  searchInput.focus(); renderCards();
});
document.getElementById('tagFilter').addEventListener('change', e => { activeTag = e.target.value; renderCards(); });
document.getElementById('collectionFilter').addEventListener('change', e => { activeCollection = e.target.value; renderCards(); });

/* ── 排序 ── */
const sortDropdown = document.getElementById('sortDropdown');
const sortBtn = document.getElementById('sortBtn');
if (sortBtn) {
  sortBtn.addEventListener('click', e => {
    e.stopPropagation(); sortDropdown.classList.toggle('open');
  });
}
document.querySelectorAll('.sort-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    sortState = btn.dataset.sort;
    const sortLabel = document.getElementById('sortLabel');
    const moreSortLabel = document.getElementById('moreSortLabel');
    if (sortLabel) sortLabel.textContent = SORT_LABELS[sortState]||'排序';
    if (moreSortLabel) moreSortLabel.textContent = SORT_LABELS[sortState]||'最新';
    document.querySelectorAll('.sort-opt').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    if (sortDropdown) sortDropdown.classList.remove('open');
    renderCards();
  });
});
document.addEventListener('click', e => {
  if (sortDropdown && !e.target.closest('.sort-wrap')) sortDropdown.classList.remove('open');
});

/* ── 高级筛选面板 ── */
const advPanel = document.getElementById('advFilterPanel');
const filterAdvBtn = document.getElementById('filterAdvBtn');
if (filterAdvBtn) {
  filterAdvBtn.addEventListener('click', () => advPanel.classList.toggle('open'));
}

function updateFilterBadge() {
  const active = filterState.favorite||filterState.exact||filterState.dateFrom||filterState.dateTo;
  const filterBadge = document.getElementById('filterBadge');
  const moreFilterBadge = document.getElementById('moreFilterBadge');
  if (filterBadge) filterBadge.style.display = active ? 'block' : 'none';
  if (moreFilterBadge) moreFilterBadge.style.display = active ? 'inline-flex' : 'none';
}
document.getElementById('filterFavorite').addEventListener('change', e => { filterState.favorite=e.target.checked; updateFilterBadge(); renderCards(); });
document.getElementById('filterExact').addEventListener('change', e => { filterState.exact=e.target.checked; updateFilterBadge(); renderCards(); });
document.getElementById('filterDateFrom').addEventListener('change', e => { filterState.dateFrom=e.target.value; updateFilterBadge(); renderCards(); });
document.getElementById('filterDateTo').addEventListener('change', e => { filterState.dateTo=e.target.value; updateFilterBadge(); renderCards(); });
document.getElementById('filterResetBtn').addEventListener('click', () => {
  filterState = {favorite:false,exact:false,dateFrom:'',dateTo:''};
  document.getElementById('filterFavorite').checked = false;
  document.getElementById('filterExact').checked = false;
  document.getElementById('filterDateFrom').value = '';
  document.getElementById('filterDateTo').value = '';
  updateFilterBadge(); renderCards();
});

/* ── 批量操作 ── */
function toggleBatchMode() {
  isBatchMode = !isBatchMode;
  selectedIds.clear();
  const bar = document.getElementById('batchBar');
  const cardsGrid = document.getElementById('cardsGrid');
  if (!isBatchMode) {
    if (bar) bar.classList.add('hidden');
    if (cardsGrid) cardsGrid.classList.remove('batch-mode');
  } else {
    showToast('已进入批量选择模式', 'info');
  }
  renderCards();
}

function openSettings() {
  refreshStats();
  refreshTagMgmt();
  refreshCollectionMgmt();
  applyThemeSetting(currentThemeSetting);
  applySourceSetting(randomSource);
  openModal('settingsOverlay');
}

function updateBatchBar() {
  const bar = document.getElementById('batchBar');
  const batchCount = document.getElementById('batchCount');
  if (bar && batchCount) {
    batchCount.textContent = `已选 ${selectedIds.size} 项`;
    if (selectedIds.size > 0) bar.classList.remove('hidden');
  }
}

const batchModeBtn = document.getElementById('batchModeBtn');
if (batchModeBtn) {
  batchModeBtn.addEventListener('click', () => {
    isBatchMode = !isBatchMode;
    selectedIds.clear();
    const bar = document.getElementById('batchBar');
    const cardsGrid = document.getElementById('cardsGrid');
    if (!isBatchMode) {
      if (bar) bar.classList.add('hidden');
      if (cardsGrid) cardsGrid.classList.remove('batch-mode');
    } else {
      showToast('已进入批量选择模式', 'info');
    }
    renderCards();
  });
}
const exitBatchBtn = document.getElementById('exitBatchBtn');
if (exitBatchBtn) {
  exitBatchBtn.addEventListener('click', () => {
    isBatchMode = false; selectedIds.clear();
    const bar = document.getElementById('batchBar');
    const cardsGrid = document.getElementById('cardsGrid');
    if (bar) bar.classList.add('hidden');
    if (cardsGrid) cardsGrid.classList.remove('batch-mode');
    renderCards();
  });
}
const selectAllBtn = document.getElementById('selectAllBtn');
if (selectAllBtn) {
  selectAllBtn.addEventListener('click', () => {
    const allIds = applySort(applyFilters(loadData())).map(i=>i.id);
    if (selectedIds.size === allIds.length) {
      selectedIds.clear();
    } else {
      allIds.forEach(id => selectedIds.add(id));
    }
    updateBatchBar();
    renderCards();
  });
}
const batchDeleteBtn = document.getElementById('batchDeleteBtn');
if (batchDeleteBtn) {
  batchDeleteBtn.addEventListener('click', () => {
    if (!selectedIds.size) return;
    pendingDelete = { isBatch:true, ids:[...selectedIds] };
    const deleteModalTitle = document.getElementById('deleteModalTitle');
    const deleteMsg = document.getElementById('deleteMsg');
    if (deleteModalTitle) deleteModalTitle.textContent = '批量删除';
    if (deleteMsg) deleteMsg.textContent = `确定要删除选中的 ${selectedIds.size} 条好句吗？此操作无法恢复。`;
    openModal('deleteOverlay');
  });
}
const batchExportBtn = document.getElementById('batchExportBtn');
if (batchExportBtn) {
  batchExportBtn.addEventListener('click', () => {
    const list = loadData().filter(i => selectedIds.has(i.id));
    downloadJSON(list, `拾句_选中_${fmtDate(Date.now())}.json`);
    showToast(`已导出 ${list.length} 条`, 'success');
  });
}

/* ── 弹窗管理 ── */
function openModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove('active');
    if (!document.querySelector('.modal-overlay.active')) document.body.style.overflow = '';
  }
}
['editOverlay','detailOverlay','randomOverlay','deleteOverlay','settingsOverlay','noteOverlay','collectionEditOverlay','dailyOverlay','checkInHistoryOverlay','shareOverlay','linksOverlay','legalOverlay'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('click', e => { if(e.target.id===id) closeModal(id); });
  }
});
document.addEventListener('keydown', e => {
  if (e.key!=='Escape') return;
  const order = ['deleteOverlay','editOverlay','noteOverlay','collectionEditOverlay','checkInHistoryOverlay','shareOverlay','legalOverlay','linksOverlay','dailyOverlay','randomOverlay','detailOverlay','settingsOverlay'];
  for (const id of order) {
    if (document.getElementById(id).classList.contains('active')) { closeModal(id); break; }
  }
});

/* ── 编辑器 ── */
const editModalTitle  = document.getElementById('editModalTitle');
const contentInput    = document.getElementById('contentInput');
const authorInput     = document.getElementById('authorInput');
const charCountEl     = document.getElementById('charCount');
const tagSelectedEl   = document.getElementById('tagSelected');
const tagPlaceholder  = document.getElementById('tagPlaceholder');
const tagCustomInput  = document.getElementById('tagCustomInput');
const tagPresetsEl    = document.getElementById('tagPresets');

function renderSelectedTags() {
  tagSelectedEl.querySelectorAll('.tag-chip').forEach(c=>c.remove());
  tagPlaceholder.style.display = selectedTags.length ? 'none' : '';
  selectedTags.forEach(t => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.innerHTML = `${esc(t)}<button class="tag-chip-remove" aria-label="移除"><svg class="icon"><use href="#ic-x"/></svg></button>`;
    chip.querySelector('.tag-chip-remove').addEventListener('click', () => toggleTag(t));
    tagSelectedEl.appendChild(chip);
  });
}
function renderPresetTags() {
  const existing = getAllTags(loadData());
  const all = [...new Set([...PRESET_TAGS,...existing])];
  tagPresetsEl.innerHTML = '';
  all.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'tag-preset-btn' + (selectedTags.includes(t)?' is-selected':'');
    btn.textContent = t;
    btn.addEventListener('click', () => toggleTag(t));
    tagPresetsEl.appendChild(btn);
  });
}
function toggleTag(tag) {
  if (selectedTags.includes(tag)) selectedTags = selectedTags.filter(t=>t!==tag);
  else { if (selectedTags.length>=5) { showToast('最多添加 5 个标签','error'); return; } selectedTags = [...selectedTags,tag]; }
  renderSelectedTags(); renderPresetTags();
}
function addCustomTag() {
  const v = tagCustomInput.value.trim(); if (!v) return;
  if (selectedTags.includes(v)) showToast('该标签已存在','info');
  else toggleTag(v);
  tagCustomInput.value = ''; tagCustomInput.focus();
}
document.getElementById('tagAddBtn').addEventListener('click', addCustomTag);
tagCustomInput.addEventListener('keydown', e => { if(e.key==='Enter'){e.preventDefault();addCustomTag();} });
contentInput.addEventListener('input', () => { charCountEl.textContent=`${contentInput.value.length} / 500`; });

function openEditor(id=null) {
  editingId=id; selectedTags=[];
  if (id) {
    const item = loadData().find(x=>x.id===id);
    if (!item) return;
    editModalTitle.textContent = '编辑句子';
    contentInput.value = item.content;
    authorInput.value  = item.author||'';
    selectedTags = [...(item.tags||[])];
    charCountEl.textContent = `${item.content.length} / 500`;
  } else {
    editModalTitle.textContent='添加好句';
    contentInput.value=''; authorInput.value=''; charCountEl.textContent='0 / 500';
  }
  renderSelectedTags(); renderPresetTags();
  openModal('editOverlay');
  setTimeout(()=>contentInput.focus(),80);
}
function saveItem() {
  const content = contentInput.value.trim();
  if (!content) {
    showToast('句子内容不能为空','error');
    contentInput.classList.add('is-shake');
    setTimeout(()=>contentInput.classList.remove('is-shake'),500);
    contentInput.focus(); return;
  }
  const list = loadData();
  if (editingId) {
    const idx = list.findIndex(x=>x.id===editingId);
    if (idx!==-1) list[idx] = {...list[idx], content, author:authorInput.value.trim(), tags:selectedTags, updatedAt:Date.now()};
    showToast('句子已保存','success');
  } else {
    list.push({id:genId(), content, author:authorInput.value.trim(), tags:selectedTags, createdAt:Date.now(), favorite:false, rating:0});
    showToast('已添加好句','success');
  }
  saveData(list); closeModal('editOverlay'); renderCards();
}
document.getElementById('editSave').addEventListener('click', saveItem);
document.getElementById('editClose').addEventListener('click', ()=>closeModal('editOverlay'));
document.getElementById('editCancel').addEventListener('click', ()=>closeModal('editOverlay'));
document.getElementById('addBtn').addEventListener('click', ()=>openEditor(null));
document.getElementById('emptyAddBtn').addEventListener('click', ()=>openEditor(null));

/* ── 详情弹窗 ── */
function buildRatingStars(containerId, rating, itemId) {
  const c = document.getElementById(containerId);
  c.innerHTML = '';
  for (let i=1;i<=5;i++) {
    const btn = document.createElement('button');
    btn.className = 'rating-star' + (i<=rating?' filled':'');
    btn.setAttribute('aria-label', `${i}星`);
    btn.innerHTML = `<svg class="icon"><use href="#ic-${i<=rating?'star-fill':'star'}"/></svg>`;
    btn.addEventListener('click', ()=>setRating(itemId,i));
    btn.addEventListener('mouseenter',()=>{
      c.querySelectorAll('.rating-star').forEach((s,idx)=>{
        s.classList.toggle('filled',idx<i);
        s.querySelector('use').setAttribute('href',`#ic-${idx<i?'star-fill':'star'}`);
      });
    });
    btn.addEventListener('mouseleave',()=>buildRatingStars(containerId,loadData().find(x=>x.id===itemId)?.rating||0,itemId));
    c.appendChild(btn);
  }
}
function setRating(id,rating) {
  const list = loadData(); const item = list.find(x=>x.id===id);
  if (!item) return;
  item.rating = item.rating===rating ? 0 : rating;
  saveData(list);
  buildRatingStars('detailRating', item.rating, id);
  renderCards();
}
function refreshDetailFavBtn(isFav) {
  document.getElementById('detailFavIcon').querySelector('use').setAttribute('href',`#ic-${isFav?'star-fill':'star'}`);
  document.getElementById('detailFavText').textContent = isFav ? '取消收藏' : '收藏';
}
function openDetail(id) {
  const item = loadData().find(x=>x.id===id); if (!item) return;
  detailId = id;
  document.getElementById('detailContent').innerHTML = esc(item.content);
  document.getElementById('detailAuthor').textContent = item.author||'佚名';
  document.getElementById('detailDate').textContent   = item.createdAt ? `收集于 ${fmtDate(item.createdAt)}` : '';
  document.getElementById('detailTags').innerHTML     = tagsHtml(item.tags||[]);
  refreshDetailFavBtn(!!item.favorite);
  
  // Update note button
  const hasNote = item.note && item.note.trim().length > 0;
  document.getElementById('detailNoteText').textContent = hasNote ? '编辑笔记' : '笔记';
  
  buildRatingStars('detailRating', item.rating||0, id);
  openModal('detailOverlay');
}
document.getElementById('detailClose').addEventListener('click', ()=>closeModal('detailOverlay'));
document.getElementById('detailEdit').addEventListener('click', ()=>{ closeModal('detailOverlay'); openEditor(detailId); });
document.getElementById('detailDelete').addEventListener('click', ()=>{ closeModal('detailOverlay'); openDeleteConfirm(detailId); });
document.getElementById('detailFavorite').addEventListener('click', ()=>toggleFavorite(detailId));
document.getElementById('detailNote').addEventListener('click', ()=>openNoteEditor(detailId));
document.getElementById('detailCollection').addEventListener('click', ()=>openCollectionSelector(detailId));
document.getElementById('detailShare').addEventListener('click', ()=>openShareModal(detailId));

/* ── 删除确认 ── */
function openDeleteConfirm(id) {
  pendingDelete = { isBatch:false, id };
  document.getElementById('deleteModalTitle').textContent = '确认删除';
  document.getElementById('deleteMsg').textContent = '确定要删除这条好句吗？删除后数据将无法恢复。';
  openModal('deleteOverlay');
}
document.getElementById('deleteClose').addEventListener('click', ()=>closeModal('deleteOverlay'));
document.getElementById('deleteCancelBtn').addEventListener('click', ()=>closeModal('deleteOverlay'));
document.getElementById('deleteConfirmBtn').addEventListener('click', ()=>{
  if (!pendingDelete) return;
  let list = loadData();
  if (pendingDelete.isBatch) {
    const ids = pendingDelete.ids;
    list = list.filter(x=>!ids.includes(x.id));
    selectedIds.clear();
    document.getElementById('batchBar').classList.add('hidden');
    showToast(`已删除 ${ids.length} 条句子`,'info');
  } else {
    list = list.filter(x=>x.id!==pendingDelete.id);
    showToast('句子已删除','info');
  }
  saveData(list); closeModal('deleteOverlay'); renderCards(); pendingDelete=null;
});

/* ── 随机推荐来源 ── */
const SOURCE_KEY = 'shiju_source';
let randomSource = localStorage.getItem(SOURCE_KEY) || 'local';
let randomLoading = false;

function applySourceSetting(val) {
  randomSource = val;
  localStorage.setItem(SOURCE_KEY, val);
  const radio = document.querySelector(`input[name="randomSource"][value="${val}"]`);
  if (radio) radio.checked = true;
  const warn = document.getElementById('hitokotoWarning');
  if (warn) warn.classList.toggle('visible', val === 'hitokoto');
}

document.querySelectorAll('input[name="randomSource"]').forEach(radio => {
  radio.addEventListener('change', () => { if (radio.checked) applySourceSetting(radio.value); });
});

/* ── 随机推荐 ── */

/** 仅加载内容到 DOM，不打开弹窗 */
async function loadRandomContent() {
  if (randomSource === 'hitokoto') {
    return loadHitokotoContent();
  }
  return loadLocalContent();
}

function loadLocalContent() {
  const list = loadData();
  if (!list.length) { showToast('还没有收藏任何句子','info'); return false; }
  const item = list[Math.floor(Math.random()*list.length)];
  document.getElementById('randomContent').innerHTML  = esc(item.content);
  document.getElementById('randomAuthor').textContent = item.author||'佚名';
  document.getElementById('randomTags').innerHTML     = tagsHtml(item.tags||[]);
  return true;
}

async function loadHitokotoContent() {
  try {
    const res = await fetch('https://v1.hitokoto.cn/?encode=json&charset=utf-8',
      { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error('network');
    const data = await res.json();
    document.getElementById('randomContent').innerHTML  = esc(data.hitokoto||'');
    document.getElementById('randomAuthor').textContent = [data.from_who, data.from].filter(Boolean).join('·')||'一言';
    document.getElementById('randomTags').innerHTML     = `<span class="tag">一言</span>`;
    return true;
  } catch {
    showToast('一言服务不可用，改用本地数据','info');
    return loadLocalContent();
  }
}

/** 首次打开：加载内容后再显示弹窗 */
async function showRandom() {
  if (randomLoading) return;
  randomLoading = true;
  try {
    const ok = await loadRandomContent();
    if (ok) openModal('randomOverlay');
  } finally {
    randomLoading = false;
  }
}

document.getElementById('randomBtn').addEventListener('click', showRandom);
document.getElementById('randomClose').addEventListener('click',  ()=>closeModal('randomOverlay'));
document.getElementById('randomClose2').addEventListener('click', ()=>closeModal('randomOverlay'));

/** 换一句：先淡出，等内容加载完再淡回 */
document.getElementById('randomAgain').addEventListener('click', async () => {
  if (randomLoading) return;
  randomLoading = true;
  const m = document.getElementById('randomModal');
  // 淡出
  m.style.transition = 'opacity .15s ease, transform .15s ease';
  m.style.opacity    = '0';
  m.style.transform  = 'scale(.94) translateY(6px)';
  try {
    await new Promise(r => setTimeout(r, 150));   // 等淡出完成
    await loadRandomContent();                     // 加载新内容（可能是网络请求）
    // 淡回
    m.style.opacity   = '';
    m.style.transform = '';
    await new Promise(r => setTimeout(r, 320));
    m.style.transition = '';
  } finally {
    randomLoading = false;
  }
});

/* ── 阅读模式 ── */
function enterReadingMode() {
  readingList = applySort(applyFilters(loadData()));
  if (!readingList.length) { showToast('没有可阅读的句子','info'); return; }
  readingIndex = 0;
  renderReadingPage();
  const readingOverlay = document.getElementById('readingOverlay');
  if (readingOverlay) {
    readingOverlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
}
function renderReadingPage() {
  const item = readingList[readingIndex];
  if (!item) return;
  const readingContent = document.getElementById('readingContent');
  const readingAuthor = document.getElementById('readingAuthor');
  const readingTags = document.getElementById('readingTags');
  const readingIndicator = document.getElementById('readingIndicator');
  
  if (readingContent) readingContent.innerHTML  = esc(item.content);
  if (readingAuthor) readingAuthor.textContent = item.author||'佚名';
  if (readingTags) readingTags.innerHTML     = tagsHtml(item.tags||[]);
  if (readingIndicator) readingIndicator.textContent = `${readingIndex+1} / ${readingList.length}`;
  
  // Scroll back to top of reading area on every page change
  const scrollEl = document.querySelector('.reading-scroll');
  if (scrollEl) {
    scrollEl.scrollTop = 0;
    scrollEl.scrollTo({ top: 0, behavior: 'auto' });
  }
}
function exitReadingMode() {
  const readingOverlay = document.getElementById('readingOverlay');
  if (readingOverlay) {
    readingOverlay.classList.add('hidden');
    document.body.style.overflow = '';
  }
}
const readingModeBtn = document.getElementById('readingModeBtn');
if (readingModeBtn) {
  readingModeBtn.addEventListener('click', enterReadingMode);
}
const readingExit = document.getElementById('readingExit');
if (readingExit) {
  readingExit.addEventListener('click', exitReadingMode);
}
const readingPrev = document.getElementById('readingPrev');
if (readingPrev) {
  readingPrev.addEventListener('click', ()=>{ readingIndex=(readingIndex-1+readingList.length)%readingList.length; renderReadingPage(); });
}
const readingNext = document.getElementById('readingNext');
if (readingNext) {
  readingNext.addEventListener('click', ()=>{ readingIndex=(readingIndex+1)%readingList.length; renderReadingPage(); });
}
// Touch/keyboard nav in reading mode
document.addEventListener('keydown', e => {
  const readingOverlay = document.getElementById('readingOverlay');
  if (!readingOverlay || readingOverlay.classList.contains('hidden')) return;
  if (e.key==='ArrowLeft'||e.key==='ArrowUp')   { readingIndex=(readingIndex-1+readingList.length)%readingList.length; renderReadingPage(); }
  if (e.key==='ArrowRight'||e.key==='ArrowDown') { readingIndex=(readingIndex+1)%readingList.length; renderReadingPage(); }
  if (e.key==='Escape') exitReadingMode();
});

/* ── 设置面板 ── */
const settingsBtn = document.getElementById('settingsBtn');
if (settingsBtn) {
  settingsBtn.addEventListener('click', ()=>{
    refreshStats();
    refreshTagMgmt();
    // sync appearance pane state
    applyThemeSetting(currentThemeSetting);
    applySourceSetting(randomSource);
    openModal('settingsOverlay');
  });
}
const settingsClose = document.getElementById('settingsClose');
if (settingsClose) {
  settingsClose.addEventListener('click', ()=>closeModal('settingsOverlay'));
}

// Tabs
document.querySelectorAll('.settings-tab').forEach(tab => {
  tab.addEventListener('click', ()=>{
    document.querySelectorAll('.settings-tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.settings-pane').forEach(p=>p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('pane-'+tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab==='tags')  refreshTagMgmt();
    if (tab.dataset.tab==='stats') refreshStats();
  });
});

/* ── 统计 ── */
function refreshStats() {
  const list = loadData();
  const now  = new Date(); const year=now.getFullYear(); const month=now.getMonth();
  document.getElementById('st-total').textContent = list.length;
  document.getElementById('st-fav').textContent   = list.filter(i=>i.favorite).length;
  document.getElementById('st-tags').textContent  = getAllTags(list).length;
  document.getElementById('st-month').textContent = list.filter(i=>{ const d=new Date(i.createdAt||0); return d.getFullYear()===year&&d.getMonth()===month; }).length;
  // Tag dist
  const tagCount = {};
  list.forEach(i=>(i.tags||[]).forEach(t=>{ tagCount[t]=(tagCount[t]||0)+1; }));
  const dist = document.getElementById('tagDist');
  dist.innerHTML = '';
  if (!Object.keys(tagCount).length) { dist.innerHTML='<span style="font-size:12px;color:var(--c-text-4)">暂无标签</span>'; return; }
  Object.entries(tagCount).sort((a,b)=>b[1]-a[1]).forEach(([t,n])=>{
    const el = document.createElement('span');
    el.className = 'tag-dist-item';
    el.innerHTML = `${esc(t)} <span class="tag-dist-count">${n}</span>`;
    dist.appendChild(el);
  });
}

/* ── 标签管理 ── */
function refreshTagMgmt() {
  const list = loadData();
  const tags = getAllTags(list);
  const tagCount = {};
  list.forEach(i=>(i.tags||[]).forEach(t=>{ tagCount[t]=(tagCount[t]||0)+1; }));

  const mgmtList = document.getElementById('tagMgmtList');
  mgmtList.innerHTML = '';
  if (!tags.length) { mgmtList.innerHTML='<div style="font-size:12.5px;color:var(--c-text-4);padding:4px">暂无标签</div>'; }
  tags.forEach(t => {
    const row = document.createElement('div');
    row.className = 'tag-mgmt-item';
    row.innerHTML = `
      <span class="tag-mgmt-name">${esc(t)}</span>
      <span class="tag-mgmt-count">${tagCount[t]||0} 条</span>
      <button class="tag-mgmt-rename" title="重命名" aria-label="重命名"><svg class="icon"><use href="#ic-pencil"/></svg></button>
      <button class="tag-mgmt-del" title="删除标签" aria-label="删除标签"><svg class="icon"><use href="#ic-trash"/></svg></button>
    `;
    row.querySelector('.tag-mgmt-rename').addEventListener('click', ()=>renameTag(t));
    row.querySelector('.tag-mgmt-del').addEventListener('click', ()=>deleteTag(t));
    mgmtList.appendChild(row);
  });

  // Merge selects
  ['mergeFrom','mergeTo'].forEach(id=>{
    const sel = document.getElementById(id);
    sel.innerHTML = `<option value="">选择标签</option>`;
    tags.forEach(t=>{ const o=document.createElement('option'); o.value=t; o.textContent=t; sel.appendChild(o); });
  });
}
function renameTag(oldName) {
  const newName = prompt(`将标签"${oldName}"重命名为：`, oldName);
  if (!newName||newName.trim()===oldName) return;
  const nn = newName.trim();
  const list = loadData();
  list.forEach(i=>{ if(i.tags) i.tags=i.tags.map(t=>t===oldName?nn:t); });
  saveData(list); renderCards(); refreshTagMgmt(); showToast(`标签已重命名为"${nn}"`,'success');
}
function deleteTag(tag) {
  if (!confirm(`确定删除标签"${tag}"？此操作将从所有句子中移除该标签。`)) return;
  const list = loadData();
  list.forEach(i=>{ if(i.tags) i.tags=i.tags.filter(t=>t!==tag); });
  saveData(list); renderCards(); refreshTagMgmt(); refreshStats();
  showToast(`标签"${tag}"已删除`,'info');
}
document.getElementById('mergeTagsBtn').addEventListener('click', ()=>{
  const from = document.getElementById('mergeFrom').value;
  const to   = document.getElementById('mergeTo').value;
  if (!from||!to) { showToast('请选择两个标签','error'); return; }
  if (from===to) { showToast('源标签与目标标签不能相同','error'); return; }
  const list = loadData();
  list.forEach(i=>{
    if (i.tags&&i.tags.includes(from)) {
      i.tags = [...new Set(i.tags.map(t=>t===from?to:t))];
    }
  });
  saveData(list); renderCards(); refreshTagMgmt(); showToast(`已将"${from}"合并到"${to}"`,'success');
});

/* ── 导出/导入 ── */
function downloadJSON(data, filename) {
  const a = document.createElement('a');
  a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data,null,2));
  a.download = filename; a.click();
}
document.getElementById('exportJsonBtn').addEventListener('click', ()=>{
  const list = loadData();
  if (!list.length) { showToast('没有数据可导出','info'); return; }
  downloadJSON(list, `拾句_${fmtDate(Date.now())}.json`);
  showToast('数据已导出','success');
});

/* ── 导出 PDF ── */
document.getElementById('exportPdfBtn').addEventListener('click', exportToPDF);

/* 按需懒加载 jsPDF + html2canvas，避免阻塞页面启动 */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}
async function loadPdfLibs() {
  if (window.jspdf && window.html2canvas) return;
  try {
    await Promise.all([
      loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'),
      loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'),
    ]);
  } catch(e) {
    console.error('PDF lib load failed:', e);
  }
}

async function exportToPDF() {
  const list = loadData();
  if (!list.length) { showToast('没有数据可导出','info'); return; }

  // Lazy-load PDF libraries if not already present
  await loadPdfLibs();
  if (!window.jspdf || !window.html2canvas) {
    showToast('PDF 库加载失败，请检查网络后重试', 'error'); return;
  }

  showToast('正在生成 PDF，请稍候…','info', 6000);

  // 1. Build a hidden render container styled for print
  const container = document.createElement('div');
  container.id = '__pdf-render__';
  container.innerHTML = buildPdfHTML(list);
  Object.assign(container.style, {
    position: 'fixed', left: '-9999px', top: '0',
    width: '794px',   // A4 @ 96dpi ≈ 794px
    background: '#fdf8f2',
    fontFamily: "'Noto Serif SC', 'Songti SC', Georgia, serif",
    zIndex: '-1',
  });
  document.body.appendChild(container);

  // 2. Let fonts & layout settle
  await new Promise(r => setTimeout(r, 400));

  try {
    const { jsPDF } = window.jspdf;

    // Render at 2× for sharpness
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#fdf8f2',
      logging: false,
    });

    // 3. Slice canvas into A4 pages
    const pdf      = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const pageW    = pdf.internal.pageSize.getWidth();   // 595.28pt
    const pageH    = pdf.internal.pageSize.getHeight();  // 841.89pt
    const margin   = 36; // pt
    const imgW     = pageW - margin * 2;
    const scale    = imgW / canvas.width;
    const imgH     = canvas.height * scale;
    const sliceH   = (pageH - margin * 2) / scale; // canvas px per page

    let yOffset = 0;
    let pageIndex = 0;

    while (yOffset < canvas.height) {
      if (pageIndex > 0) pdf.addPage();

      const sliceCanvas = document.createElement('canvas');
      const sliceActualH = Math.min(sliceH, canvas.height - yOffset);
      sliceCanvas.width  = canvas.width;
      sliceCanvas.height = sliceActualH;
      sliceCanvas.getContext('2d').drawImage(
        canvas, 0, yOffset, canvas.width, sliceActualH,
        0, 0,   canvas.width, sliceActualH
      );

      pdf.addImage(
        sliceCanvas.toDataURL('image/jpeg', 0.92),
        'JPEG',
        margin, margin,
        imgW, sliceActualH * scale
      );

      yOffset += sliceH;
      pageIndex++;
    }

    pdf.save(`拾句_${fmtDate(Date.now())}.pdf`);
    showToast(`PDF 已导出（共 ${pageIndex} 页）`, 'success');
  } catch (err) {
    console.error(err);
    showToast('PDF 导出失败，请重试', 'error');
  } finally {
    document.body.removeChild(container);
  }
}

function buildPdfHTML(list) {
  const sorted = [...list].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  const dateStr = new Date().toLocaleDateString('zh-CN', { year:'numeric', month:'long', day:'numeric' });

  const cards = sorted.map((item, i) => {
    const tags  = (item.tags||[]).map(t=>`<span style="display:inline-block;padding:2px 10px;margin:0 4px 4px 0;background:#f0e8d8;color:#a3722a;border-radius:99px;font-size:12px;font-family:sans-serif;">${esc(t)}</span>`).join('');
    const starSvg = (filled) => `<svg width="14" height="14" viewBox="0 0 24 24" style="display:inline-block;vertical-align:middle;" fill="${filled?'#d4922a':'none'}" stroke="${filled?'#d4922a':'#ddd'}" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
    const stars = Array.from({length:5},(_,j)=> starSvg(j<(item.rating||0))).join('');
    const favMark = item.favorite ? `<span style="float:right;color:#d4922a;font-size:13px;font-family:sans-serif;display:inline-flex;align-items:center;gap:3px;">${starSvg(true)} 已收藏</span>` : '';

    return `
    <div style="break-inside:avoid;padding:28px 36px;margin-bottom:18px;background:#fff;border-radius:12px;border-left:4px solid #c4924a;box-shadow:0 2px 8px rgba(60,40,10,.07);">
      <div style="font-size:12px;color:#bfb3a0;font-family:sans-serif;margin-bottom:12px;">${favMark}No.${String(i+1).padStart(3,'0')}</div>
      <blockquote style="margin:0 0 16px;padding:0 0 0 16px;border-left:none;font-size:17px;line-height:1.9;color:#1e1a14;letter-spacing:.04em;">${esc(item.content)}</blockquote>
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <div>
          <span style="font-size:13px;color:#9b8c78;font-family:sans-serif;">— ${esc(item.author||'佚名')}</span>
          ${tags ? `<div style="margin-top:8px;">${tags}</div>` : ''}
        </div>
        <div style="text-align:right;">
          <div>${stars}</div>
          <div style="font-size:11px;color:#bfb3a0;margin-top:4px;font-family:sans-serif;">${fmtDate(item.createdAt)}</div>
        </div>
      </div>
    </div>`;
  }).join('');

  return `
    <div style="padding:48px 40px;min-height:100%;background:#fdf8f2;">
      <!-- Cover header -->
      <div style="text-align:center;padding:40px 0 48px;border-bottom:2px solid #e8e1d6;margin-bottom:40px;">
        <div style="font-size:36px;font-weight:700;color:#1e1a14;letter-spacing:.12em;margin-bottom:8px;">拾 句</div>
        <div style="font-size:14px;color:#9b8c78;letter-spacing:.2em;font-family:sans-serif;margin-bottom:24px;">好词好句收集册</div>
        <div style="display:inline-block;width:40px;height:2px;background:#c4924a;"></div>
        <div style="margin-top:20px;font-size:13px;color:#bfb3a0;font-family:sans-serif;">共 ${list.length} 条 · 导出于 ${dateStr}</div>
      </div>
      ${cards}
      <!-- Footer -->
      <div style="text-align:center;margin-top:40px;padding-top:24px;border-top:1px solid #e8e1d6;font-size:12px;color:#bfb3a0;font-family:sans-serif;letter-spacing:.08em;">
        由「拾句 · 好词好句收集器」生成
      </div>
    </div>`;
}
document.getElementById('importPickBtn').addEventListener('click', ()=>document.getElementById('importFile').click());
document.getElementById('importFile').addEventListener('change', e=>{
  const file = e.target.files[0]; if (!file) return;
  document.getElementById('importFilename').textContent = file.name;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      importFileData = JSON.parse(ev.target.result);
      if (!Array.isArray(importFileData)) throw new Error();
      document.getElementById('importDoBtn').disabled = false;
      showToast(`已读取 ${importFileData.length} 条数据`,'info');
    } catch { showToast('文件格式不正确','error'); importFileData=null; }
  };
  reader.readAsText(file);
  e.target.value = '';
});
document.getElementById('importDoBtn').addEventListener('click', ()=>{
  if (!importFileData) return;
  const list = loadData();
  const existIds = new Set(list.map(i=>i.id));
  const newItems = importFileData.filter(i=>i.id&&i.content&&!existIds.has(i.id));
  saveData([...list,...newItems]);
  renderCards(); refreshStats(); refreshTagMgmt();
  document.getElementById('importDoBtn').disabled = true;
  document.getElementById('importFilename').textContent = '';
  importFileData = null;
  showToast(`已导入 ${newItems.length} 条新句子`,'success');
});
document.getElementById('deleteAllBtn').addEventListener('click', ()=>{
  if (!confirm('确定要删除所有数据吗？此操作无法恢复！')) return;
  saveData([]); renderCards(); refreshStats(); refreshTagMgmt();
  showToast('所有数据已清空','info');
});

/* ── Toast ── */
const TOAST_ICON = { success:'#ic-check', error:'#ic-alert', info:'#ic-info' };
function showToast(msg, type='info', ms=2800) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<div class="toast-icon ic-${type}"><svg class="icon"><use href="${TOAST_ICON[type]}"/></svg></div><span>${esc(msg)}</span>`;
  document.getElementById('toastContainer').appendChild(t);
  const dismiss = ()=>{ t.classList.add('fade-out'); t.addEventListener('animationend',()=>t.remove(),{once:true}); };
  const timer = setTimeout(dismiss, ms);
  t.addEventListener('click',()=>{ clearTimeout(timer); dismiss(); });
}

/* ── 示例数据 ── */
function initSampleData() {
  if (loadData().length>0) return;
  const samples = [
    {content:'人生若只如初见，何事秋风悲画扇。',author:'纳兰性德',tags:['诗词','爱情']},
    {content:'不以物喜，不以己悲。',author:'范仲淹《岳阳楼记》',tags:['哲思','人生']},
    {content:'有些人二十岁就死了，八十岁才被埋葬。',author:'本杰明·富兰克林',tags:['励志','人生']},
    {content:'愿你出走半生，归来仍是少年。',author:'网络',tags:['励志']},
    {content:'生活不止眼前的苟且，还有诗和远方的田野。',author:'高晓松',tags:['人生','励志']},
    {content:'长风破浪会有时，直挂云帆济沧海。',author:'李白《行路难》',tags:['诗词','励志']},
  ];
  const list = samples.map(s=>({
    id:genId(), content:s.content, author:s.author, tags:s.tags,
    createdAt:Date.now()-Math.floor(Math.random()*8.64e7*30),
    favorite:false, rating:0
  }));
  saveData(list);
}

/* ── 抖动动画 ── */
const shakeCSS = document.createElement('style');
shakeCSS.textContent=`
@keyframes shakeX{0%,100%{transform:translateX(0)}20%{transform:translateX(-7px)}40%{transform:translateX(7px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}
.is-shake{animation:shakeX .42s ease;border-color:var(--c-danger)!important;box-shadow:0 0 0 3px rgba(184,50,50,.12)!important}
`;
document.head.appendChild(shakeCSS);

/* ── 初始化 ── */
try { applyThemeSetting(localStorage.getItem(THEME_KEY) || 'auto'); } catch(e) {}
try { applySourceSetting(localStorage.getItem(SOURCE_KEY) || 'local'); } catch(e) {}
// 仅老用户（已完成引导）才执行示例数据填充；首次用户由欢迎弹窗接管
if (localStorage.getItem('shiju_onboarded')) {
  try { initSampleData(); } catch(e) { console.warn('initSampleData failed:', e); }
}
renderCards();

/* ══════════════════════════════════════════
   初次使用引导 · Welcome Onboarding
   ══════════════════════════════════════════ */
const ONBOARDED_KEY = 'shiju_onboarded';

function isFirstTime() {
  return !localStorage.getItem(ONBOARDED_KEY);
}

function markOnboarded() {
  localStorage.setItem(ONBOARDED_KEY, '1');
}

/* 从相对路径加载素材包 JSON */
async function loadPackJSON(packNum) {
  const url = `Asset/firsttime2use/${packNum}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* 将素材包内容合并入本地数据（跳过已有 id） */
function mergePackData(packItems) {
  const list     = loadData();
  const existIds = new Set(list.map(i => i.id));
  // 每条重新生成 id 避免冲突；保留其他字段
  const newItems = packItems.map(item => ({
    ...item,
    id: existIds.has(item.id) ? genId() : item.id,
    createdAt: item.createdAt || Date.now(),
    favorite:  item.favorite  ?? false,
    rating:    item.rating    ?? 0,
  })).filter(item => item.content && item.content.trim());

  // 再次过滤（重新生成 id 后不会重复，但原始 id 可能已出现在 existIds）
  const finalNew = [];
  const seen = new Set(list.map(i => i.id));
  for (const item of newItems) {
    if (!seen.has(item.id)) { finalNew.push(item); seen.add(item.id); }
    else {
      const reItem = { ...item, id: genId() };
      finalNew.push(reItem); seen.add(reItem.id);
    }
  }
  saveData([...list, ...finalNew]);
  return finalNew.length;
}

/* 更新「导入」按钮文字及状态 */
function updateWelcomeImportBtn() {
  const checked = document.querySelectorAll('.pack-checkbox:checked');
  const btn     = document.getElementById('welcomeImportBtn');
  const label   = document.getElementById('welcomeImportLabel');
  const hint    = document.getElementById('welcomeHint');
  if (checked.length === 0) {
    btn.disabled = true;
    label.textContent = '导入选中素材包';
    hint.textContent  = '请勾选要导入的素材包，或直接跳过';
    hint.classList.remove('has-selection');
  } else {
    btn.disabled = false;
    const names = { '1':'基础学生包', '2':'深港澳包', '3':'新媒体包' };
    const sel   = [...checked].map(c => names[c.value]).join('、');
    label.textContent = `导入 ${sel}`;
    hint.textContent  = `已选 ${checked.length} 个素材包，共约 ${checked.length * 20} 条`;
    hint.classList.add('has-selection');
  }
}

/* 关闭欢迎弹窗，标记已引导 */
function closeWelcome() {
  const overlay = document.getElementById('welcomeOverlay');
  overlay.classList.remove('active');
  // 移除 overflow:hidden（openModal 不管理这个弹窗，手动恢复）
  if (!document.querySelector('.modal-overlay.active')) {
    document.body.style.overflow = '';
  }
  markOnboarded();
}

/* 初始化欢迎弹窗交互 */
function initWelcomeModal() {
  // checkbox 联动
  document.querySelectorAll('.pack-checkbox').forEach(cb => {
    cb.addEventListener('change', updateWelcomeImportBtn);
  });

  // 跳过按钮
  document.getElementById('welcomeSkipBtn').addEventListener('click', () => {
    closeWelcome();
    showToast('已跳过引导，随时可手动添加句子', 'info');
  });

  // 导入按钮
  document.getElementById('welcomeImportBtn').addEventListener('click', async () => {
    const checked = [...document.querySelectorAll('.pack-checkbox:checked')];
    if (!checked.length) return;

    const btn = document.getElementById('welcomeImportBtn');
    btn.disabled = true;
    btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite;vertical-align:-2px;margin-right:6px;flex-shrink:0"></span>导入中…';

    let totalImported = 0;
    const errors = [];

    for (const cb of checked) {
      try {
        const items = await loadPackJSON(cb.value);
        const count = mergePackData(items);
        totalImported += count;
      } catch (e) {
        console.error(`pack${cb.value} load failed`, e);
        errors.push(cb.value);
      }
    }

    closeWelcome();
    renderCards();

    if (errors.length) {
      showToast(`部分素材包加载失败（${errors.join('、')}号包），请检查文件路径`, 'error', 4000);
    } else {
      showToast(`成功导入 ${totalImported} 条素材，开始探索吧！`, 'success', 3500);
    }
  });
}

/* 添加旋转动画 keyframe（导入中状态） */
const spinCSS = document.createElement('style');
spinCSS.textContent = '@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';
document.head.appendChild(spinCSS);

/* ── 欢迎弹窗触发 ── */
// initSampleData 已在上方运行；如果是首次，清空示例数据，用引导代替
if (isFirstTime()) {
  // 清空 initSampleData 插入的示例（首次使用让用户自己选）
  saveData([]);
  renderCards();
  // 短暂延迟，等页面动画稳定后弹出
  setTimeout(() => {
    initWelcomeModal();
    document.getElementById('welcomeOverlay').classList.add('active');
    document.body.style.overflow = 'hidden';
  }, 420);
}

/* ════════════════════════════════════════════════
   新增功能：笔记、文集、每日打卡、分享卡片
   ════════════════════════════════════════════════ */

/* ── 笔记功能 ── */
function openNoteEditor(id) {
  noteTargetId = id;
  const item = loadData().find(x => x.id === id);
  if (!item) return;
  
  const noteInput = document.getElementById('noteInput');
  noteInput.value = item.note || '';
  document.getElementById('noteCharCount').textContent = `${noteInput.value.length} / 500`;
  
  openModal('noteOverlay');
  setTimeout(() => noteInput.focus(), 80);
}
function saveNote() {
  const noteInput = document.getElementById('noteInput');
  if (noteInput.value.length > 500) {
    showToast('笔记长度不能超过500字', 'error');
    return;
  }
  
  const list = loadData();
  const item = list.find(x => x.id === noteTargetId);
  if (!item) return;
  
  item.note = noteInput.value;
  saveData(list);
  
  closeModal('noteOverlay');
  renderCards();
  
  if (detailId === noteTargetId) openDetail(detailId);
  showToast('笔记已保存', 'success');
}
document.getElementById('noteInput').addEventListener('input', () => {
  document.getElementById('noteCharCount').textContent = `${document.getElementById('noteInput').value.length} / 500`;
});
document.getElementById('noteSave').addEventListener('click', saveNote);
document.getElementById('noteCancel').addEventListener('click', () => closeModal('noteOverlay'));
document.getElementById('noteClose').addEventListener('click', () => closeModal('noteOverlay'));

/* ── 文集功能 ── */
function refreshCollectionMgmt() {
  const collections = loadCollections();
  const list = loadData();
  const mgmtList = document.getElementById('collectionMgmtList');
  mgmtList.innerHTML = '';
  
  if (!collections.length) {
    mgmtList.innerHTML = '<div style="font-size:12.5px;color:var(--c-text-4);padding:4px">暂未创建文集</div>';
    return;
  }
  
  collections.forEach(c => {
    const itemCount = (c.items || []).length;
    const row = document.createElement('div');
    row.className = 'tag-mgmt-item';
    row.innerHTML = `
      <div style="flex:1;">
        <div style="font-weight:500;color:var(--c-text-1);">${esc(c.name)}</div>
        <div style="font-size:11.5px;color:var(--c-text-3);">${esc(c.desc || '')}${c.desc ? ' · ' : ''}${itemCount} 条</div>
      </div>
      <button class="tag-mgmt-rename" title="编辑" aria-label="编辑"><svg class="icon"><use href="#ic-pencil"/></svg></button>
      <button class="tag-mgmt-del" title="删除" aria-label="删除"><svg class="icon"><use href="#ic-trash"/></svg></button>
    `;
    row.querySelector('.tag-mgmt-rename').addEventListener('click', () => openCollectionEditor(c.id));
    row.querySelector('.tag-mgmt-del').addEventListener('click', () => deleteCollection(c.id));
    mgmtList.appendChild(row);
  });
}
function openCollectionEditor(id = null) {
  editingCollection = id;
  const collections = loadCollections();
  
  if (id) {
    const col = collections.find(c => c.id === id);
    if (col) {
      document.getElementById('collectionEditTitle').textContent = '编辑文集';
      document.getElementById('collectionNameInput').value = col.name;
      document.getElementById('collectionDescInput').value = col.desc || '';
    }
  } else {
    document.getElementById('collectionEditTitle').textContent = '创建文集';
    document.getElementById('collectionNameInput').value = '';
    document.getElementById('collectionDescInput').value = '';
  }
  
  openModal('collectionEditOverlay');
  setTimeout(() => document.getElementById('collectionNameInput').focus(), 80);
}
function saveCollection() {
  const name = document.getElementById('collectionNameInput').value.trim();
  const desc = document.getElementById('collectionDescInput').value.trim();
  
  if (!name) {
    showToast('文集名称不能为空', 'error');
    return;
  }
  
  const collections = loadCollections();
  
  if (collections.some(c => c.name === name && c.id !== editingCollection)) {
    showToast('文集名称已存在', 'error');
    return;
  }
  
  if (editingCollection) {
    const idx = collections.findIndex(c => c.id === editingCollection);
    if (idx !== -1) {
      collections[idx].name = name;
      collections[idx].desc = desc;
    }
  } else {
    collections.push({ id: genId(), name, desc, items: [], createdAt: Date.now() });
  }
  
  saveCollections(collections);
  closeModal('collectionEditOverlay');
  refreshCollectionMgmt();
  refreshCollectionFilter();
  renderCards();
  showToast(editingCollection ? '文集已更新' : '文集已创建', 'success');
}
function deleteCollection(id) {
  if (!confirm('确定删除这个文集？文集内的句子不会被删除。')) return;
  
  const collections = loadCollections().filter(c => c.id !== id);
  saveCollections(collections);
  
  if (activeCollection === id) activeCollection = '';
  refreshCollectionMgmt();
  refreshCollectionFilter();
  renderCards();
  showToast('文集已删除', 'info');
}
function openCollectionSelector(itemId) {
  const collections = loadCollections();
  const list = loadData();
  const item = list.find(x => x.id === itemId);
  if (!item) return;
  
  const overlayId = 'collectionSelectOverlay';
  
  let overlay = document.getElementById(overlayId);
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = overlayId;
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:420px;">
        <div class="modal-header">
          <h2 class="modal-title">添加到文集</h2>
          <button class="modal-close" onclick="closeModal('${overlayId}')"><svg class="icon"><use href="#ic-x"/></svg></button>
        </div>
        <div class="modal-body" id="collectionSelectBody"></div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal('${overlayId}')">取消</button>
          <button class="btn btn-primary" id="collectionSelectCreate"><svg class="icon"><use href="#ic-plus"/></svg>创建文集</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    
    overlay.addEventListener('click', e => { if(e.target.id === overlayId) closeModal(overlayId); });
  }
  
  const body = document.getElementById('collectionSelectBody');
  body.innerHTML = '';
  
  if (!collections.length) {
    body.innerHTML = '<div style="text-align:center;padding:20px;color:var(--c-text-3);font-size:13px;">暂未创建文集</div>';
  } else {
    collections.forEach(c => {
      const isIn = (c.items || []).includes(itemId);
      const item = document.createElement('label');
      item.className = 'adv-filter-item';
      item.style.marginBottom = '8px';
      item.innerHTML = `<input type="checkbox" ${isIn ? 'checked' : ''}><span>${esc(c.name)}</span><span style="margin-left:auto;font-size:12px;color:var(--c-text-3);">${(c.items||[]).length} 条</span>`;
      item.querySelector('input').addEventListener('change', e => {
        toggleItemInCollection(c.id, itemId, e.target.checked);
      });
      body.appendChild(item);
    });
  }
  
  document.getElementById('collectionSelectCreate').onclick = () => {
    closeModal(overlayId);
    openCollectionEditor();
  };
  
  openModal(overlayId);
}
function toggleItemInCollection(colId, itemId, add) {
  const collections = loadCollections();
  const col = collections.find(c => c.id === colId);
  if (!col) return;
  
  if (!col.items) col.items = [];
  
  if (add) {
    if (!col.items.includes(itemId)) col.items.push(itemId);
  } else {
    col.items = col.items.filter(id => id !== itemId);
  }
  
  saveCollections(collections);
  renderCards();
}
document.getElementById('addCollectionBtn').addEventListener('click', () => openCollectionEditor());
document.getElementById('collectionEditSave').addEventListener('click', saveCollection);
document.getElementById('collectionEditCancel').addEventListener('click', () => closeModal('collectionEditOverlay'));
document.getElementById('collectionEditClose').addEventListener('click', () => closeModal('collectionEditOverlay'));

/* ── 设置面板标签页更新 ── */
const origTabClick = document.querySelectorAll('.settings-tab')[0]?.onclick;
document.querySelectorAll('.settings-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    if (tab.dataset.tab === 'collections') refreshCollectionMgmt();
  });
});

/* ── 每日推荐/打卡功能 ── */
function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function getDailyRecommendation() {
  const today = getTodayStr();
  const saved = loadDailyRecomm();
  
  if (saved && saved.date === today) {
    const list = loadData();
    return list.find(x => x.id === saved.itemId);
  }
  
  const list = loadData();
  if (!list.length) return null;
  
  const checkIns = loadCheckIns();
  const checkedIds = new Set(checkIns.map(c => c.itemId));
  
  let candidates = list.filter(x => !checkedIds.has(x.id));
  if (!candidates.length) candidates = list;
  
  candidates.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  
  const topCount = Math.min(10, candidates.length);
  const selected = candidates[Math.floor(Math.random() * topCount)];
  
  saveDailyRecomm({ date: today, itemId: selected.id });
  return selected;
}
function hasCheckedInToday() {
  const checkIns = loadCheckIns();
  const today = getTodayStr();
  return checkIns.some(c => c.date === today);
}
function checkIn(itemId) {
  const checkIns = loadCheckIns();
  const today = getTodayStr();
  
  if (checkIns.some(c => c.date === today)) {
    showToast('今天已经打卡了哦', 'info');
    return;
  }
  
  checkIns.push({ id: genId(), date: today, itemId, checkedAt: Date.now() });
  saveCheckIns(checkIns);
  showToast('打卡成功！', 'success');
  closeModal('dailyOverlay');
}
function openDailyModal() {
  const item = getDailyRecommendation();
  if (!item) {
    showToast('还没有收藏任何句子', 'info');
    return;
  }
  
  document.getElementById('dailyContent').innerHTML = esc(item.content);
  document.getElementById('dailyAuthor').textContent = item.author || '佚名';
  document.getElementById('dailyTags').innerHTML = tagsHtml(item.tags || []);
  
  const checkInBtn = document.getElementById('dailyCheckIn');
  if (hasCheckedInToday()) {
    checkInBtn.disabled = true;
    checkInBtn.innerHTML = '<svg class="icon"><use href="#ic-check-circle"/></svg>今日已打卡';
  } else {
    checkInBtn.disabled = false;
    checkInBtn.innerHTML = '<svg class="icon"><use href="#ic-check"/></svg>完成打卡';
  }
  
  openModal('dailyOverlay');
}
function showCheckInHistory() {
  closeModal('dailyOverlay');
  
  const checkIns = loadCheckIns().sort((a, b) => (b.checkedAt || 0) - (a.checkedAt || 0));
  const list = loadData();
  const historyList = document.getElementById('checkInHistoryList');
  historyList.innerHTML = '';
  
  if (!checkIns.length) {
    historyList.innerHTML = '<div style="font-size:12.5px;color:var(--c-text-4);padding:20px;text-align:center;">暂无打卡记录</div>';
  } else {
    checkIns.forEach(c => {
      const item = list.find(x => x.id === c.itemId);
      const row = document.createElement('div');
      row.className = 'tag-mgmt-item';
      row.style.cursor = 'pointer';
      row.innerHTML = `
        <div style="flex:1;min-width:0;">
          <div style="font-weight:500;color:var(--c-text-1);margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(item?.content?.slice(0, 40) || '')}${item?.content?.length > 40 ? '…' : ''}</div>
          <div style="font-size:11.5px;color:var(--c-text-3);">${esc(c.date)} · ${esc(item?.author || '佚名')}</div>
        </div>
        <svg class="icon" style="width:16px;height:16px;color:var(--c-text-4);flex-shrink:0;"><use href="#ic-chevron-right"/></svg>
      `;
      row.addEventListener('click', () => {
        if (item) {
          closeModal('checkInHistoryOverlay');
          openDetail(item.id);
        }
      });
      historyList.appendChild(row);
    });
  }
  
  openModal('checkInHistoryOverlay');
}
document.getElementById('dailyBtn').addEventListener('click', openDailyModal);
document.getElementById('dailyClose').addEventListener('click', () => closeModal('dailyOverlay'));
document.getElementById('dailySkip').addEventListener('click', () => closeModal('dailyOverlay'));
document.getElementById('dailyCheckIn').addEventListener('click', () => {
  const saved = loadDailyRecomm();
  if (saved && saved.itemId) checkIn(saved.itemId);
});
document.getElementById('viewHistoryBtn').addEventListener('click', showCheckInHistory);
document.getElementById('checkInHistoryClose').addEventListener('click', () => closeModal('checkInHistoryOverlay'));

/* ── 分享功能 ── */
function openShareModal(id) {
  shareTargetId = id;
  shareStyle = 'minimal';
  
  const list = loadData();
  const item = list.find(x => x.id === id);
  if (!item) return;
  
  document.querySelectorAll('.share-style-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.style === shareStyle) btn.classList.add('active');
  });
  
  renderShareCardPreview(item, shareStyle);
  openModal('shareOverlay');
}
function renderShareCardPreview(item, style) {
  const container = document.getElementById('shareCardPreview');
  const html = buildShareCardHTML(item, style);
  container.innerHTML = html;
}
function buildShareCardHTML(item, style) {
  const colors = {
    minimal: { bg: '#ffffff', border: '#e8e1d6', text: '#1e1a14', accent: '#a3722a', subtext: '#9b8c78' },
    elegant: { bg: '#f7f4ef', border: '#c4924a', text: '#1e1a14', accent: '#a3722a', subtext: '#5c5040' },
    warm: { bg: '#fdf5ea', border: '#d4922a', text: '#1e1a14', accent: '#a3722a', subtext: '#a3722a' }
  };
  const c = colors[style] || colors.minimal;
  
  return `
    <div style="
      width:360px;
      padding:32px 28px;
      background:${c.bg};
      border:2px solid ${c.border};
      border-radius:16px;
      font-family:'Noto Serif SC','Songti SC',Georgia,serif;
      text-align:center;
      box-shadow:0 8px 32px rgba(60,40,10,.12);
    ">
      <div style="
        font-size:12px;
        letter-spacing:.2em;
        color:${c.subtext};
        margin-bottom:16px;
        text-transform:uppercase;
      ">拾 句</div>
      <div style="
        font-size:18px;
        line-height:1.8;
        color:${c.text};
        margin-bottom:20px;
        letter-spacing:.02em;
      ">${esc(item.content)}</div>
      <div style="
        display:flex;
        align-items:center;
        justify-content:center;
        gap:12px;
      ">
        <div style="width:40px;height:1px;background:${c.accent};opacity:.4;"></div>
        <div style="
          font-size:13px;
          color:${c.accent};
          font-style:italic;
        ">—— ${esc(item.author || '佚名')}</div>
        <div style="width:40px;height:1px;background:${c.accent};opacity:.4;"></div>
      </div>
      <div style="
        margin-top:20px;
        padding-top:16px;
        border-top:1px solid ${c.border};
        font-size:11px;
        color:${c.subtext};
        letter-spacing:.08em;
      ">由「拾句」生成</div>
    </div>
  `;
}
async function downloadShareCard() {
  const list = loadData();
  const item = list.find(x => x.id === shareTargetId);
  if (!item) return;
  
  await loadPdfLibs();
  if (!window.html2canvas) {
    showToast('图片库加载失败，请检查网络后重试', 'error');
    return;
  }
  
  showToast('正在生成图片…', 'info', 5000);
  
  const renderContainer = document.getElementById('shareCardRenderContainer');
  if (!renderContainer) return;
  renderContainer.innerHTML = buildShareCardHTML(item, shareStyle);
  const cardEl = renderContainer.firstElementChild;
  if (!cardEl) return;
  
  try {
    const canvas = await html2canvas(cardEl, {
      scale: 2,
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: true,
      allowTaint: true
    });
    
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `拾句_${fmtDate(Date.now())}.png`;
    a.click();
    
    showToast('分享卡片已下载', 'success');
  } catch (e) {
    console.error(e);
    showToast('生成失败，请重试', 'error');
  }
}
function copyShareText() {
  const list = loadData();
  const item = list.find(x => x.id === shareTargetId);
  if (!item) return;
  
  const text = `${item.content}\n\n—— ${item.author || '佚名'}`;
  navigator.clipboard.writeText(text).then(() => {
    showToast('已复制到剪贴板', 'success');
  }).catch(() => {
    showToast('复制失败', 'error');
  });
}
document.querySelectorAll('.share-style-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const list = loadData();
    const item = list.find(x => x.id === shareTargetId);
    if (!item) return;
    
    shareStyle = btn.dataset.style;
    document.querySelectorAll('.share-style-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderShareCardPreview(item, shareStyle);
  });
});
document.getElementById('shareClose').addEventListener('click', () => closeModal('shareOverlay'));
document.getElementById('shareDownload').addEventListener('click', downloadShareCard);
document.getElementById('shareCopyText').addEventListener('click', copyShareText);

/* More Menu Logic */
function toggleMoreMenu() {
  const menu = document.getElementById('moreMenu');
  menu.classList.toggle('active');
}
function closeMoreMenu() {
  const menu = document.getElementById('moreMenu');
  menu.classList.remove('active');
}
document.getElementById('moreMenuBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMoreMenu();
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.more-menu-wrap')) {
    closeMoreMenu();
  }
});
document.getElementById('moreSortBtn').addEventListener('click', () => {
  closeMoreMenu();
  document.getElementById('sortBtn').click();
});
document.getElementById('moreFilterAdvBtn').addEventListener('click', () => {
  closeMoreMenu();
  const panel = document.getElementById('advFilterPanel');
  panel.classList.toggle('open');
});
document.getElementById('moreBatchBtn').addEventListener('click', () => {
  closeMoreMenu();
  toggleBatchMode();
});
document.getElementById('moreSettingsBtn').addEventListener('click', () => {
  closeMoreMenu();
  openSettings();
});
function updateMoreMenuSortLabel() {
  const moreSortLabel = document.getElementById('moreSortLabel');
  if (moreSortLabel) {
    moreSortLabel.textContent = SORT_LABELS[sortState] || '最新';
  }
}
document.querySelectorAll('.sort-opt').forEach(opt => {
  opt.addEventListener('click', () => {
    setTimeout(updateMoreMenuSortLabel, 0);
  });
});
updateMoreMenuSortLabel();
function syncFilterBadge() {
  const originalBadge = document.getElementById('filterBadge');
  const moreBadge = document.getElementById('moreFilterBadge');
  if (originalBadge && moreBadge) {
    moreBadge.textContent = originalBadge.textContent;
    moreBadge.style.display = originalBadge.style.display;
  }
}
const observer = new MutationObserver(syncFilterBadge);
const originalBadge = document.getElementById('filterBadge');
if (originalBadge) {
  observer.observe(originalBadge, { attributes: true, childList: true });
}

/* Links & Legal Modals */
const navBadgeBtn = document.getElementById('navBadgeBtn');
if (navBadgeBtn) {
  navBadgeBtn.addEventListener('click', () => {
    openModal('linksOverlay');
  });
}
const linksClose = document.getElementById('linksClose');
if (linksClose) {
  linksClose.addEventListener('click', () => {
    closeModal('linksOverlay');
  });
}
const linksOverlay = document.getElementById('linksOverlay');
if (linksOverlay) {
  linksOverlay.addEventListener('click', e => { if(e.target.id==='linksOverlay') closeModal('linksOverlay'); });
}
