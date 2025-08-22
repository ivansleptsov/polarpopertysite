// Polar Property front-end logic
// Fetch from Notion API and render property cards with client-side filtering

// ====== Config ======
// Now we use a backend proxy. Put NOTION_TOKEN and DATABASE_ID into ./env and run `npm start`.
const CONFIG = {
  apiBase: '',
};

// State
let allItems = [];
let filteredItems = [];
let currentPage = 1;
const pageSize = 6; // объектов на страницу

// Elements
const grid = document.getElementById('propertiesGrid');
const stateMsg = document.getElementById('stateMsg');
const filterDeal = document.getElementById('filterDeal');
const filterCategory = document.getElementById('filterCategory');
const categoryButtons = document.querySelectorAll('#categories button[data-deal]');
const paginationEl = document.getElementById('pagination');
const filterDistrict = document.getElementById('filterDistrict');
const searchDistrictSelect = document.getElementById('district');

// Helpers
function showState(message, isError = false) {
  if (!stateMsg) return;
  stateMsg.textContent = message;
  stateMsg.classList.remove('hidden');
  stateMsg.classList.toggle('text-red-700', isError);
}

function hideState() {
  stateMsg?.classList.add('hidden');
}

function normalizeCategory(category) {
  if (!category) return '';
  const cat = category.toLowerCase().trim();
  
  // Нормализация для категорий - точное соответствие вашим данным
  if (cat === 'сдан') return 'Сданные';
  if (cat === 'строится') return 'Строящиеся';
  
  return category;
}

// Откат: убираем сложную логику кандидатов, оставляем простое преобразование
function convertGoogleDriveUrl(url) {
  if (!url) return '';
  // Если уже usercontent
  if (url.includes('drive.usercontent.google.com/download')) {
    // Добавим &export=view если отсутствует (улучшает inline отображение)
    if (!/([&?])export=view/.test(url)) {
      url += (url.includes('?') ? '&' : '?') + 'export=view';
    }
    return url;
  }
  // Уже uc формат – попробуем заменить на usercontent (надежнее для inline)
  if (url.includes('drive.google.com/uc?')) {
    const m = url.match(/[?&]id=([^&]+)/);
    if (m) {
      return `https://drive.usercontent.google.com/download?id=${m[1]}&export=view`;
    }
    return url;
  }
  // file/d/FILE_ID
  let m = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (m) {
    const id = m[1];
    return `https://drive.usercontent.google.com/download?id=${id}&export=view`;
  }
  // open?id=FILE_ID
  m = url.match(/drive\.google\.com\/open\?id=([^&]+)/);
  if (m) {
    const id = m[1];
    return `https://drive.usercontent.google.com/download?id=${id}&export=view`;
  }
  return url;
}

function normalizeDealType(dealType) {
  if (!dealType) return '';
  const deal = dealType.toLowerCase().trim();
  
  // Нормализация для типов сделок
  if (deal.includes('продаж')) return 'Продажа';
  if (deal.includes('аренда') && deal.includes('долгосроч')) return 'Аренда долгосрочная';
  if (deal.includes('аренда') && deal.includes('краткосроч')) return 'Аренда краткосрочная';
  if (deal.includes('аренда')) return 'Аренда долгосрочная'; // по умолчанию
  
  return dealType;
}

function priceToNumber(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const n = Number(String(val).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}
// Added: hashCode helper (used to generate pseudo external IDs when absent)
function hashCode(str){
  let h = 0;
  if(!str) return h;
  for(let i=0; i<str.length; i++){
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0; // convert to 32bit int
  }
  return h;
}

// Строгая валидация и нормализация телефона
function validateAndNormalizePhone(input){
  let raw = (input||'').trim();
  if(!raw) return { ok:false, error:'Введите телефон' };
  // убрать разрешённые разделители
  raw = raw.replace(/[\s()\-]/g,'')
  // заменить 00 на +
  if(raw.startsWith('00')) raw = '+' + raw.slice(2);
  // если нет плюса – пытаемся угадать
  if(raw[0] !== '+'){
    if(/^[78]\d{10}$/.test(raw)) { // Россия 11 цифр, начинается с 7 или 8
      raw = '+7' + raw.slice(1);
    } else if(/^66\d{8,9}$/.test(raw)) { // Таиланд без плюса
      raw = '+'+raw;
    } else if(/^\d{7,15}$/.test(raw)) { // просто числа
      raw = '+'+raw;
    } else {
      return { ok:false, error:'Неверный формат телефона' };
    }
  }
  // Финальная проверка: только + и 7-15 цифр
  if(!/^\+\d{7,15}$/.test(raw)) return { ok:false, error:'Неверный телефон' };
  return { ok:true, value: raw };
}

function cardTemplate(item) {
  try {
    const { title, dealType, category, district, price, currency, url } = item; // imageUrl отключен
    const isRent = (dealType || '').toLowerCase().startsWith('аренда');
    const priceHuman = price ? `${isRent ? '' : 'от '}${new Intl.NumberFormat('ru-RU').format(price)} THB` : 'Цена по запросу';
    const defaultImg = 'images/hero.jpg';
    const safeImg = defaultImg;
    const showCategory = !isRent && !!category;

    // Единый темный стиль бейджей
    const topBadge = `
      <div class=\"absolute top-3 left-3 flex items-center gap-1 bg-slate-900/75 text-white px-2.5 py-1 rounded-md text-[11px] font-medium shadow\">
        <span class=\"leading-none\">${dealType || ''}</span>
        ${showCategory ? `<span class=\\"w-1 h-1 rounded-full bg-white/50\\"></span><span class=\\"leading-none\\">${category}</span>` : ''}
      </div>`;

    const districtBadge = district ? `<div class=\"absolute bottom-3 left-3 bg-slate-900/75 text-white px-2.5 py-1 rounded-md text-[11px] font-medium shadow\">${district}</div>` : '';

    return `
      <article class="group rounded-2xl border border-slate-100 overflow-hidden bg-white hover:shadow-card transition" data-property-id="${item.id}">
        <div class="relative h-48 overflow-hidden">
          <img src="${safeImg}" alt="${title}" class="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300" />
          ${topBadge}
          ${districtBadge}
        </div>
        <div class="p-4">
          <h3 class="font-medium line-clamp-1" title="${title}">${title}</h3>
          <div class="mt-1 text-primary-700 font-semibold">${priceHuman}</div>
          <button type="button" data-open-property="${item.id}" class="mt-3 inline-flex items-center gap-2 text-sm text-primary-700 hover:text-primary-800 focus:outline-none">Подробнее →</button>
        </div>
      </article>`;
  } catch (e) {
    console.error('Ошибка в cardTemplate для объекта:', item, e);
    return '<div>Ошибка при создании карточки</div>';
  }
}

function renderGrid(items) {
  console.log('renderGrid вызван с:', items.length, 'объектами');
  console.log('Элемент grid найден:', !!grid);
  console.log('ID элемента grid:', grid?.id);
  
  if (!grid) {
    console.error('Элемент grid не найден!');
    return;
  }
  
  if (!items.length) {
    console.log('Нет объектов для отображения');
    grid.innerHTML = '';
    showState('Ничего не найдено. Измените фильтры.');
    return;
  }
  
  console.log('Создаем HTML для', items.length, 'объектов');
  hideState();
  const html = items.map(cardTemplate).join('');
  console.log('HTML создан, длина:', html.length);
  grid.innerHTML = html;
  console.log('HTML установлен в grid');
}

function renderPagination() {
  if (!paginationEl) return;
  const total = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) { paginationEl.innerHTML = ''; return; }
  const makeBtn = (p, label = p, active = false, disabled = false) => `<button data-page="${p}" class="px-3 py-1.5 rounded-lg border ${active ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-slate-700 hover:border-primary-400'} text-sm disabled:opacity-40 disabled:pointer-events-none" ${disabled ? 'disabled' : ''}>${label}</button>`;
  let html = '';
  html += makeBtn(Math.max(1, currentPage - 1), '«', false, currentPage === 1);
  const windowSize = 5;
  let start = Math.max(1, currentPage - 2);
  let end = Math.min(totalPages, start + windowSize - 1);
  if (end - start < windowSize - 1) start = Math.max(1, end - windowSize + 1);
  if (start > 1) html += makeBtn(1, '1');
  if (start > 2) html += '<span class="px-2 text-slate-400">…</span>';
  for (let p = start; p <= end; p++) html += makeBtn(p, String(p), p === currentPage);
  if (end < totalPages - 1) html += '<span class="px-2 text-slate-400">…</span>';
  if (end < totalPages) html += makeBtn(totalPages, String(totalPages));
  html += makeBtn(Math.min(totalPages, currentPage + 1), '»', false, currentPage === totalPages);
  paginationEl.innerHTML = html;
}

function collectDistricts() {
  return Array.from(new Set(allItems.map(i => (i.district || '').trim()).filter(Boolean)));
}

function renderPage() {
  const start = (currentPage - 1) * pageSize;
  const pageItems = filteredItems.slice(start, start + pageSize);
  renderGrid(pageItems);
  renderPagination();
  const districts = collectDistricts().sort((a,b)=>a.localeCompare(b,'ru'));
  if (filterDistrict && filterDistrict.options.length <= 1) {
    const frag = document.createDocumentFragment();
    districts.forEach(d => { const opt = document.createElement('option'); opt.value = d; opt.textContent = `Район: ${d}`; frag.appendChild(opt); });
    filterDistrict.appendChild(frag);
  }
  if (searchDistrictSelect && searchDistrictSelect.options.length <= 1) {
    const frag2 = document.createDocumentFragment();
    districts.forEach(d => { const opt = document.createElement('option'); opt.value = d; opt.textContent = d; frag2.appendChild(opt); });
    searchDistrictSelect.appendChild(frag2);
  }
}

function applyFilters() {
  const deal = filterDeal?.value || '';
  const cat = filterCategory?.value || '';
  const dist = filterDistrict?.value || '';
  const distForm = searchDistrictSelect?.value || '';
  const useFormDist = !!distForm; // если выбрано в форме поиска
  const filtered = allItems.filter((x) => {
    const dealOk = !deal || (x.dealType || '').toLowerCase().includes(deal.toLowerCase());
    const catOk = !cat || (x.category || '').toLowerCase().includes(cat.toLowerCase());
    const distOkTop = !dist || (x.district || '').toLowerCase() === dist.toLowerCase();
    const distOkForm = !useFormDist || (x.district || '').toLowerCase() === distForm.toLowerCase();
    return dealOk && catOk && distOkTop && distOkForm;
  });
  filteredItems = filtered;
  currentPage = 1;
  renderPage();
}

// Notion API
async function fetchNotion(scope = 'all') {
  showState('Загрузка объектов...');
  console.log('Загружаем данные с scope:', scope);
  try {
    const res = await fetch(`${CONFIG.apiBase}/api/notion/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope })
    });
    if (!res.ok) {
      const t = await res.text();
      console.error('Ошибка ответа сервера:', t);
      throw new Error(`Proxy error ${res.status}: ${t}`);
    }
    const data = await res.json();
    console.log('Получены сырые данные:', data);
    const items = (data.results || []).map(parseNotionPage).filter(Boolean);
    console.log('Обработанные объекты:', items);
    hideState();
    return items;
  } catch (e) {
    console.error('Ошибка при загрузке:', e);
    showState('Ошибка загрузки. Проверьте, что запущен сервер Node.js (npm start) и заданы переменные в env.', true);
    return [];
  }
}

// Map Notion page to our item structure
function parseNotionPage(page) {
  // Adjust property names to match your Notion DB
  const props = page.properties || {};
  function getTitle(p) {
    const arr = p?.title || [];
    return arr.map(t => t.plain_text).join(' ').trim();
  }
  function getRichText(p) {
    const arr = p?.rich_text || [];
    return arr.map(t => t.plain_text).join(' ').trim();
  }
  function getNumberProp(p) {
    if (typeof p?.number === 'number') return p.number;
    const s = getRichText(p);
    return priceToNumber(s);
  }
  function getSelectOrText(p) {
    if (!p) return '';
    if (p.select?.name) return p.select.name.trim();
    if (Array.isArray(p.multi_select)) return p.multi_select.map(o => o.name).join(', ').trim();
    // форма как в ответе API: { type: 'multi_select', multi_select: [ {name:..}, ... ] }
    if (Array.isArray(p.multi_select?.multi_select)) return p.multi_select.multi_select.map(o => o.name).join(', ').trim();
    return getRichText(p);
  }

  // Title
  const title = getTitle(
    props['Название проекта'] ||
    props['Название'] ||
    props['Title'] ||
    props['Name']
  );

  // Deal type and category
  let dealType = (props['Тип сделки']?.select?.name) || getRichText(props['Тип сделки']) || '';
  let category = (props['Статус']?.select?.name) || getRichText(props['Статус']) || (props['Категория']?.select?.name) || getRichText(props['Категория']) || '';

  // Нормализуем значения
  const originalDealType = dealType;
  const originalCategory = category;
  dealType = normalizeDealType(dealType);
  category = normalizeCategory(category);

  // District / City (берём из select 'Район')
  const district = getSelectOrText(props['Район']) || getSelectOrText(props['район']) || getSelectOrText(props['Город']) || getSelectOrText(props['город']) || getSelectOrText(props['Локация']) || getSelectOrText(props['локация']);

  // Price (rent: Цена; sale: min of typology THB columns)
  const priceTextRaw = getRichText(props['Цена']);
  let price = getNumberProp(props['Цена']);
  let currency = '';
  if (!price && priceTextRaw) {
    price = priceToNumber(priceTextRaw);
  }
  if (!currency && priceTextRaw) {
    const s = priceTextRaw.toLowerCase();
    if (s.includes('thb') || s.includes('฿') || s.includes('бат')) currency = 'THB';
  }

  if (!price) {
    const saleKeys = ['Студия (THB)', '1BR (THB)', '2BR (THB)', '3BR (THB)', 'Пентхаус (THB)'];
    const values = saleKeys.map(k => getNumberProp(props[k])).filter(v => v && v > 0);
    if (values.length) {
      price = Math.min(...values);
      currency = 'THB';
    }
  }

  // Image: files, URL, or text URL
  let imageUrl = '';
  const files = props['Фото']?.files || props['Изображение']?.files || [];
  
  // Сначала проверяем URL поле (для Google Drive ссылок)
  const photoUrlProp = props['Фото']?.url || props['Изображение']?.url;
  if (photoUrlProp) {
    imageUrl = convertGoogleDriveUrl(photoUrlProp);
  }
  
  // Если нет URL, проверяем rich text
  if (!imageUrl) {
    const txt = getRichText(props['Фото'] || props['Изображение']);
    if (txt && /^https?:/i.test(txt)) {
      imageUrl = convertGoogleDriveUrl(txt);
    }
  }
  
  // В последнюю очередь проверяем файлы
  if (!imageUrl && files.length) {
    const f = files[0];
    const rawFileUrl = f.type === 'file' ? f.file.url : f.external?.url || '';
    
    // Преобразуем Google Drive URL из файлов
    if (rawFileUrl) {
      imageUrl = convertGoogleDriveUrl(rawFileUrl);
    }
  }

  // URL
  const url = props['Ссылка']?.url || props['URL']?.url || page.url;

  // Fallback category from 'Тип недвижимости' if empty
  if (!category) {
    category = (props['Тип недвижимости']?.select?.name) || getRichText(props['Тип недвижимости']) || '';
  }

  if (!title) return null;
  
  // Собираем все свойства в плоский объект для модалки
  const allProps = {};
  for (const [key, val] of Object.entries(props)) allProps[key] = formatNotionProp(val);
  const description = (props['Описание'] ? (props['Описание'].rich_text||[]).map(t=>t.plain_text).join(' ').trim() : '') || (props['Description'] ? (props['Description'].rich_text||[]).map(t=>t.plain_text).join(' ').trim() : '');
  const conditions = (props['Условия'] ? (props['Условия'].rich_text||[]).map(t=>t.plain_text).join(' ').trim() : '') || (props['Conditions'] ? (props['Conditions'].rich_text||[]).map(t=>t.plain_text).join(' ').trim() : '') || (props['Оплата'] ? (props['Оплата'].rich_text||[]).map(t=>t.plain_text).join(' ').trim() : '');
  const createdTime = page.created_time || '';
  // Detect external ID field (take ONLY existing value; do NOT generate)
  const idCandidates = ['id','ID','Id','№','No','Номер','Номер объекта','ID объекта','Id объекта','Id Объекта','ID обьекта','Id обьекта','Object ID','ObjectId','External ID','External Id'];
  let objectExternalId = '';
  for (const cand of idCandidates) {
    if (props[cand]) {
      objectExternalId = formatNotionProp(props[cand]);
      if (objectExternalId) { break; }
    }
  }
  if (!objectExternalId) {
    const lowerMap = Object.keys(props).reduce((acc,k)=>{ acc[k.toLowerCase()] = k; return acc; },{});
    for (const cand of idCandidates) {
      const lk = lowerMap[cand.toLowerCase()];
      if (lk) {
        objectExternalId = formatNotionProp(props[lk]);
        if (objectExternalId) { break; }
      }
    }
  }
  if (!objectExternalId) {
    console.debug('ID not found for page', title, 'props keys:', Object.keys(props));
  }
  if (objectExternalId) allProps['ID объекта (parsed)'] = objectExternalId;
  console.debug('Parsed extId for page', title, objectExternalId);
  return { id: page.id, extId: objectExternalId, title, dealType, category, district, price, currency, imageUrl, url, allProps, description, conditions, createdTime };
}

// Форматирование произвольного свойства Notion в строку
function formatNotionProp(prop){
  if(!prop) return '';
  switch(prop.type){
    case 'title': return (prop.title||[]).map(t=>t.plain_text).join(' ').trim();
    case 'rich_text': return (prop.rich_text||[]).map(t=>t.plain_text).join(' ').trim();
    case 'select': return prop.select?.name||'';
    case 'multi_select': return (prop.multi_select||[]).map(o=>o.name).join(', ');
    case 'number': return (prop.number ?? '').toString();
    case 'url': return prop.url||'';
    case 'email': return prop.email||'';
    case 'phone_number': return prop.phone_number||'';
    case 'date': return prop.date?.start || '';
    case 'files': return (prop.files||[]).map(f=> (f.name||'file')).join(', ');
    case 'people': return (prop.people||[]).map(p=>p.name||'user').join(', ');
    case 'checkbox': return prop.checkbox ? 'Да' : 'Нет';
    case 'unique_id': {
      const u = prop.unique_id; if(!u) return '';
      // Notion returns { prefix, number }
      const prefix = u.prefix || '';
      const num = (u.number != null) ? u.number : '';
      if(prefix && num!=='') return `${prefix}-${num}`;
      return `${prefix}${num}`.trim();
    }
    case 'created_time': return prop.created_time||'';
    case 'last_edited_time': return prop.last_edited_time||'';
    case 'formula': {
      const f = prop.formula; if(!f) return '';
      if(f.type==='string') return (f.string||'').trim();
      if(f.type==='number') return (f.number ?? '').toString();
      if(f.type==='boolean') return f.boolean ? 'Да' : 'Нет';
      if(f.type==='date') return f.date?.start || '';
      return '';
    }
    case 'rollup': {
      const r = prop.rollup; if(!r) return '';
      if(r.type==='number') return (r.number ?? '').toString();
      if(r.type==='date') return r.date?.start || '';
      if(r.type==='array') return r.array.map(a=>formatNotionProp(a)).filter(Boolean).join(', ');
      return '';
    }
    default: {
      if(prop[prop.type]?.plain_text) return prop[prop.type].plain_text;
      return '';
    }
  }
}
// Utility to pick first existing property value from map
function pickProp(all, keys){
  if(!all) return '';
  for(const k of keys){
    if(Object.prototype.hasOwnProperty.call(all,k) && all[k]) return all[k];
  }
  return '';
}

// ВОССТАНОВЛЕНО: экранирование HTML и закрытие модалки (удалились при рефакторинге)
function escapeHtml(str){
  return String(str||'').replace(/[&<>"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s]));
}
function closePropertyModal(){ ensureModalRefs(); if(!modal) return; modal.classList.add('hidden'); if(modalContent) modalContent.innerHTML=''; }

// Modal elements
let modal, modalContent;
function ensureModalRefs(){
  if(!modal) modal = document.getElementById('propertyModal');
  if(!modalContent) modalContent = document.getElementById('propertyModalContent');
}
function openPropertyModal(item){
  ensureModalRefs(); if(!modal || !modalContent) return;
  const dealTypeLower = (item.dealType||'').toLowerCase();
  const isRent = dealTypeLower.startsWith('аренда');
  const priceHuman = item.price ? `${isRent ? '' : 'от '}${new Intl.NumberFormat('ru-RU').format(item.price)} THB` : 'Цена по запросу';
  const status = item.category === 'Сданные' ? 'Сдан' : (item.category === 'Строящиеся' ? 'Строится' : '');
  const all = item.allProps || {};
  const dateFromColumn = pickProp(all,['Срок сдачи','срок сдачи','Срок сдачи (план)','Срок','Completion date','Completion']);
  // Common picks
  const propertyType = pickProp(all,['Тип недвижимости','Тип','Property type','Property Type']) || '';
  const rooms = pickProp(all,['Комнат','Количество комнат','Комнаты','Спален','Спальни','Bedrooms','Rooms']) || '';
  const bathrooms = pickProp(all,['Ванных комнат','Ванных','Санузлов','Санузлы','Bathrooms','Baths']) || '';
  const floorSingle = pickProp(all,['Этаж','Floor']) || '';
  const floorsTotal = pickProp(all,['Этажность','Этажей','Floors']) || '';
  const pool = pickProp(all,['Бассейн','Pool','Swimming pool']) || '';
  // Deposit formatting
  const depositRaw = pickProp(all,['Депозит','Залог','Deposit','Security deposit','Deposit (THB)','Залог (THB)']) || '';
  let depositFormatted = depositRaw;
  if(depositRaw){ const depNum = priceToNumber(depositRaw); if(depNum){ depositFormatted = `${new Intl.NumberFormat('ru-RU').format(depNum)} THB`; } }
  const details = {
    propertyType,
    rooms,
    bathrooms,
    pool,
    floorSingle,
    floorsTotal,
    floors: isRent ? '' : (floorsTotal || ''),
    units: isRent ? '' : (pickProp(all,['Количество квартир','Units','Квартир']) || ''),
    district: item.district || pickProp(all,['Район','Локация']) || '',
    developer: pickProp(all,['Застройщик','Developer']) || '',
    completion: pickProp(all,['Год сдачи','Completion','Сдача']) || '',
    dateAdded: dateFromColumn || '',
    deposit: depositFormatted
  };
  const saleKeys = [ ['Студия (THB)','Студия'], ['1BR (THB)','1BR'], ['2BR (THB)','2BR'], ['3BR (THB)','3BR'], ['Пентхаус (THB)','Пентхаус'] ];
  const layouts = !isRent ? saleKeys.map(([k,label])=>{ const raw = all[k]; if(!raw) return null; const num = priceToNumber(raw); let base = num? `${new Intl.NumberFormat('ru-RU').format(num)} THB` : raw; if(!/^от/i.test(base)) base = 'от '+base; return { type: label, price: base}; }).filter(Boolean) : [];
  const extraImgs = item.imageUrl ? [item.imageUrl] : [];
  const images = ['images/hero.jpg', ...extraImgs.filter(u=>u!=='images/hero.jpg')];
  const rent = isRent ? { price: priceHuman } : null; // deposit moved to left info
  const data = { title:item.title, price:priceHuman, status, images, details, layouts, description:item.description||'', conditions:item.conditions||'', isRent, rent, dealType:item.dealType||'', objectId: item.extId || '' };
  modalContent.innerHTML = buildPropertyModal(data);
  modal.classList.remove('hidden');
  requestAnimationFrame(()=>modalContent.classList.remove('opacity-0'));
  if(window.Swiper){ new Swiper(modalContent.querySelector('.mySwiper'), { loop: images.length>1, pagination:{el:'.swiper-pagination', clickable:true}, navigation:{nextEl:'.swiper-button-next', prevEl:'.swiper-button-prev'}, slidesPerView:1, spaceBetween:0 }); }
  const toggleBtn = modalContent.querySelector('#toggleDesc');
  const descBlock = modalContent.querySelector('#descBlock');
  toggleBtn?.addEventListener('click',()=>{ const collapsed = descBlock.classList.toggle('max-h-32'); if(!collapsed){ descBlock.style.maxHeight='none'; toggleBtn.textContent='Свернуть'; } else { descBlock.style.maxHeight='8rem'; toggleBtn.textContent='Развернуть'; } descBlock.querySelector('.fade-mask')?.classList.toggle('hidden'); });
  const shareBtn = modalContent.querySelector('#shareBtn');
  shareBtn?.addEventListener('click',async()=>{ const shareData = { title:data.title, text:`${data.title} – ${data.price}`, url: window.location.href }; try { if(navigator.share){ await navigator.share(shareData); } else { await navigator.clipboard.writeText(`${shareData.title} – ${shareData.price} ${shareData.url}`); shareBtn.innerHTML='Скопировано'; setTimeout(()=>shareBtn.innerHTML='<span>Поделиться</span>',1500);} } catch(e){} });
}
function buildPropertyModal(data){
  const statusColor = data.status === 'Сдан' ? 'bg-emerald-500' : (data.status === 'Строится' ? 'bg-amber-500' : 'bg-slate-500');
  const images = (data.images && data.images.length ? data.images : ['images/hero.jpg']);
  const gallery = `
    <div class="swiper mySwiper rounded-xl overflow-hidden">
      <div class="swiper-wrapper">
        ${images.map(src=>`<div class="swiper-slide"><img src="${src}" class="w-full h-72 sm:h-80 object-cover" alt="${data.title}" /></div>`).join('')}
      </div>
      <div class="swiper-pagination"></div>
      <div class="swiper-button-prev"></div>
      <div class="swiper-button-next"></div>
    </div>`;
  // Determine floor label for rent
  let rentFloorEntry = null;
  if(data.isRent){
    const pt = (data.details.propertyType||'').toLowerCase();
    const isCondoLike = /кондо|condo|апарт|apарт|квартира|apart|studio|flat/.test(pt);
    const floorLabel = isCondoLike ? 'Этаж' : 'Этажей';
    const floorValue = isCondoLike ? (data.details.floorSingle || data.details.floorsTotal) : (data.details.floorsTotal || data.details.floorSingle);
    if(floorValue) rentFloorEntry = {label: floorLabel, value: floorValue};
  }
  const leftDetailsRaw = data.isRent ? [
    {label:'Тип недвижимости', value:data.details.propertyType},
    {label:'Комнат', value:data.details.rooms},
    {label:'Ванных комнат', value:data.details.bathrooms},
    rentFloorEntry,
    {label:'Бассейн', value:data.details.pool},
    {label:'Район', value:data.details.district},
    {label:'Застройщик', value:data.details.developer},
    {label:'Год сдачи', value:data.details.completion},
    {label:'Дата ввода', value:data.details.dateAdded}
  ] : [
    {label:'Район', value:data.details.district},
    {label:'Застройщик', value:data.details.developer},
    {label:'Год сдачи', value:data.details.completion},
    {label:'Дата ввода', value:data.details.dateAdded},
    {label:'Этажность', value:data.details.floors},
    {label:'Квартир', value:data.details.units}
  ];
  const leftDetails = leftDetailsRaw.filter(x=>x && x.value).map(d=>`<li class="px-4 py-2 flex gap-2 text-sm"><span class="text-slate-500">${d.label}:</span><span class="font-medium text-slate-800">${escapeHtml(String(d.value))}</span></li>`).join('');
  const layoutsRows = !data.isRent ? data.layouts.map(l=>`<tr><td class="px-3 py-2 text-slate-600">${l.type}</td><td class="px-3 py-2 font-medium text-slate-800 whitespace-nowrap">${l.price}</td></tr>`).join('') : '';
  const rentRows = data.isRent ? [
    `<tr><td class=\"px-3 py-2 text-slate-600\">Аренда</td><td class=\"px-3 py-2 font-medium text-slate-800 whitespace-nowrap\">${data.price}</td></tr>`,
    data.details.deposit ? `<tr><td class=\"px-3 py-2 text-slate-600\">Депозит</td><td class=\"px-3 py-2 font-medium text-slate-800 whitespace-nowrap\">${escapeHtml(data.details.deposit)}</td></tr>` : ''
  ].join('') : '';
  const descriptionCollapsed = data.description ? `<div id=\"descBlock\" class=\"relative max-h-32 overflow-hidden transition-all\"><div class=\"text-sm leading-relaxed text-slate-700\">${escapeHtml(data.description).replace(/\n/g,'<br>')}</div><div class=\"fade-mask absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-white to-white/0 pointer-events-none\"></div></div><button id=\"toggleDesc\" class=\"mt-3 text-sm font-medium text-primary-600 hover:text-primary-700\">Развернуть</button>` : '';
  const conditionsBlock = data.conditions ? `<div class=\"mt-6\"><h4 class=\"text-sm font-semibold tracking-wide text-slate-500 uppercase\">Условия</h4><div class=\"mt-2 rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700\">${escapeHtml(data.conditions).replace(/\n/g,'<br>')}</div></div>` : '';
  return `
    <div class="p-6 sm:p-8">
      <div class="flex flex-col gap-4">
        <div class="flex items-start gap-4">
          <div class="flex-1">
            ${data.dealType ? `<div class=\"text-[11px] font-semibold tracking-wide uppercase text-primary-600 mb-1\">${escapeHtml(data.dealType)}</div>`:''}
            <h3 class="text-2xl font-semibold">${data.title}</h3>
            ${data.objectId ? `<div class=\"mt-1 text-sm text-slate-500\">ID: <span class=\"font-medium\">${escapeHtml(data.objectId)}</span></div>`:''}
          </div>
          <div class="flex flex-col items-end gap-1">
            <div class="text-2xl font-semibold text-slate-900">${data.price}</div>
            ${data.status?`<span class=\"inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium text-white ${statusColor}\">${data.status}</span>`:''}
          </div>
        </div>
        <div class="mt-2">${gallery}</div>
        <div class="mt-8 grid sm:grid-cols-2 gap-8">
          <div class="space-y-3">
            <h4 class="text-sm font-semibold tracking-wide text-slate-500 uppercase">${data.isRent ? 'Информация' : 'Основная информация'}</h4>
            <ul class="rounded-xl border border-slate-100 bg-white/60 divide-y divide-slate-100">${leftDetails || '<li class="px-4 py-3 text-sm text-slate-500">Нет данных</li>'}</ul>
          </div>
          <div class="space-y-3">
            <h4 class="text-sm font-semibold tracking-wide text-slate-500 uppercase">${data.isRent ? 'Стоимость' : 'Планировки и цены'}</h4>
            <div class="rounded-xl border border-slate-100 overflow-hidden">
              <table class="min-w-full text-sm"><tbody>${data.isRent ? (rentRows || '<tr><td class=\"px-4 py-3 text-slate-500\">Нет данных</td></tr>') : (layoutsRows || '<tr><td class=\"px-4 py-3 text-slate-500\">Нет данных</td></tr>')}</tbody></table>
            </div>
          </div>
        </div>
        <div class="mt-8">
          <h4 class="text-sm font-semibold tracking-wide text-slate-500 uppercase">Описание</h4>
          ${descriptionCollapsed || '<div class="mt-2 text-sm text-slate-500">Нет описания</div>'}
        </div>
        ${conditionsBlock}
        <div class="mt-10 flex flex-wrap gap-3">
          <button class="px-6 py-3 rounded-lg bg-teal-500 hover:bg-teal-600 text-white font-medium transition shadow" data-lead-open data-title="${escapeHtml(data.title)}" data-deal="${escapeHtml(data.dealType||'')}" data-objid="${escapeHtml(data.objectId||'')}" >Получить подробную информацию</button>
          <button id="shareBtn" class="px-4 py-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition inline-flex items-center gap-2"><span>Поделиться</span></button>
          <button class="ml-auto px-4 py-2 text-slate-500 hover:text-slate-700" data-modal-close>Закрыть</button>
        </div>
      </div>
    </div>`;
}

// Lead mini modal
let leadModalEl;
function ensureLeadModal(){
  if(!leadModalEl){
    leadModalEl = document.createElement('div');
    leadModalEl.id='leadModal';
    leadModalEl.className='fixed inset-0 z-[120] hidden';
    leadModalEl.innerHTML=`<div class="absolute inset-0 bg-slate-900/60" data-lead-close></div><div class="absolute inset-0 p-4 sm:p-6 overflow-y-auto"><div class="max-w-md mx-auto bg-white rounded-2xl p-6 shadow-xl relative"><button class="absolute top-3 right-3 text-slate-500 hover:text-slate-700" data-lead-close>✕</button><h3 class="text-xl font-semibold">Оставьте заявку</h3><p class="mt-1 text-sm text-slate-600">Мы перезвоним и отправим детали по объекту.</p><form id="leadForm" class="mt-4 space-y-4"><div><label class="block text-sm mb-1 text-slate-700">Имя</label><input name="name" required class="w-full rounded-lg border-slate-200 focus:border-primary-500 focus:ring-primary-500"/></div><div><label class="block text-sm mb-1 text-slate-700">Телефон</label><input name="phone" required class="w-full rounded-lg border-slate-200 focus:border-primary-500 focus:ring-primary-500"/></div><div><label class="block text-sm mb-1 text-slate-700">Способ связи</label><select name="method" class="w-full rounded-lg border-slate-200 focus:border-primary-500 focus:ring-primary-500"><option>Звонок</option><option>WhatsApp</option><option>Telegram</option></select></div><input type="hidden" name="propertyTitle"/><input type="hidden" name="dealType"/><input type="hidden" name="propertyObjectId"/><button class="w-full bg-primary-600 hover:bg-primary-700 text-white rounded-lg px-5 py-3 font-medium">Отправить</button><div id="leadStatus" class="text-sm mt-2"></div></form></div></div>`;
    document.body.appendChild(leadModalEl);
    leadModalEl.addEventListener('click', e=>{ if(e.target.matches('[data-lead-close]')) closeLeadModal(); });
  }
}
function openLeadModal(title, deal, objectId){ ensureLeadModal(); const form=leadModalEl.querySelector('#leadForm'); form.propertyTitle.value=title; form.dealType.value=deal||''; form.propertyObjectId.value=objectId||''; leadModalEl.classList.remove('hidden'); }
function closeLeadModal(){ leadModalEl?.classList.add('hidden'); }
// Handle open from property modal
window.addEventListener('click', e=>{ const btn=e.target.closest('[data-lead-open]'); if(btn){ openLeadModal(btn.dataset.title||'', btn.dataset.deal||'', btn.dataset.objid||''); }});
// Enhance lead form phone input behavior
window.addEventListener('input', e=>{
  if(e.target && e.target.name==='phone'){
    const el = e.target;
    // Allow digits, plus, spaces, (), - while typing
    el.value = el.value.replace(/[^0-9+()\-\s]/g,'');
  }
});
// Submit lead
window.addEventListener('submit', async e=>{
  if(e.target.id==='leadForm'){
    e.preventDefault();
    const f=e.target; const statusEl=f.querySelector('#leadStatus'); statusEl.textContent='Отправка...'; statusEl.className='text-sm mt-2';
    const phoneRaw = f.phone.value;
    const norm = validateAndNormalizePhone(phoneRaw);
    if(!norm.ok){
      statusEl.textContent = norm.error;
      statusEl.classList.add('text-red-600');
      f.phone.classList.add('border-red-500');
      return;
    }
    f.phone.classList.remove('border-red-500');
    f.phone.value = norm.value; // show normalized
    const payload={ name:f.name.value.trim(), phone:norm.value, contactMethod:f.method.value, propertyTitle:f.propertyTitle.value, dealType:f.dealType.value, propertyObjectId: f.propertyObjectId.value };
    try{
      const res= await fetch('/api/notion/lead',{method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
      const js=await res.json();
      if(!res.ok || !js.ok){ throw new Error(js.error||'Ошибка'); }
      statusEl.className='text-sm mt-2 text-emerald-600';
      statusEl.textContent='Ваша заявка отправлена.';
      // Убираем автозакрытие модалок
      // setTimeout(()=>{ closeLeadModal(); closePropertyModal(); window.location.hash='#home'; },1500);
    }catch(err){ statusEl.className='text-sm mt-2 text-red-600'; statusEl.textContent='Ошибка отправки. Попробуйте ещё раз.'; }
  }
});

// Mobile menu
const menuBtn = document.getElementById('menuBtn');
const mobileMenu = document.getElementById('mobileMenu');
menuBtn?.addEventListener('click', () => mobileMenu?.classList.toggle('hidden'));

// Language toggle demo (no i18n yet)
const langToggle = document.getElementById('langToggle');
langToggle?.addEventListener('click', () => alert('Смена языка (демо)'));

// Footer year
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

// Init
(async function init() {
  CONFIG.apiBase = '';
  console.log('Начинаем загрузку всех данных...');
  allItems = await fetchNotion('all');
  filteredItems = allItems.slice();
  console.log('Загружено объектов:', allItems.length);
  
  // Показываем все объекты без фильтров при загрузке
  if (allItems.length > 0) {
    console.log('Показываем все объекты без фильтров');
    
    // Сбрасываем фильтры
    if (filterDeal) filterDeal.value = '';
    if (filterCategory) filterCategory.value = '';
    
    renderPage();
  } else {
    console.log('Объекты не загружены - проверьте сервер и настройки');
  }

  // Hook search form to filters
  const searchForm = document.getElementById('searchForm');
  searchForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const deal = document.getElementById('dealType').value;
    const cat = document.getElementById('category').value;
    const distForm = searchDistrictSelect?.value || '';
    const min = Number(document.getElementById('priceMin').value || 0);
    const max = Number(document.getElementById('priceMax').value || 0);
    filteredItems = allItems.filter(x => {
      const dealOk = !deal || (x.dealType || '').toLowerCase().includes(deal.toLowerCase());
      const catOk = !cat || (x.category || '').toLowerCase().includes(cat.toLowerCase());
      const distOk = !distForm || (x.district || '').toLowerCase() === distForm.toLowerCase();
      const minOk = !min || (x.price || 0) >= min;
      const maxOk = !max || (x.price || 0) <= max;
      return dealOk && catOk && distOk && minOk && maxOk;
    });
    currentPage = 1;
    renderPage();
    document.getElementById('listings')?.scrollIntoView({ behavior: 'smooth' });
  });
  paginationEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-page]');
    if (!btn) return;
    const p = Number(btn.getAttribute('data-page'));
    if (!isNaN(p) && p > 0) { currentPage = p; renderPage(); window.scrollTo({ top: document.getElementById('listings').offsetTop - 80, behavior: 'smooth' }); }
  });
  
  // Добавляем обработчики фильтров (могли потеряться)
  filterDeal?.addEventListener('change', applyFilters);
  filterCategory?.addEventListener('change', applyFilters);
  filterDistrict?.addEventListener('change', applyFilters);
})();

// Global delegation to open property modal
window.addEventListener('click', (e)=>{
  const btn = e.target.closest('[data-open-property]');
  if(btn){
    const id = btn.getAttribute('data-open-property');
    const item = allItems.find(i=>i.id===id);
    if(item){
      e.preventDefault();
      openPropertyModal(item);
    }
  }
});
// Delegation for category cards
window.addEventListener('click',(e)=>{
  const catBtn = e.target.closest('#categories button[data-deal]');
  if(catBtn){
    const deal = catBtn.dataset.deal||'';
    const cat = catBtn.dataset.category||'';
    if(filterDeal) filterDeal.value = deal;
    if(filterCategory) filterCategory.value = cat; // может быть пусто
    // сбрасываем район
    if(filterDistrict) filterDistrict.value='';
    applyFilters();
    document.getElementById('listings')?.scrollIntoView({behavior:'smooth'});
  }
});
// Close property modal on overlay / buttons
window.addEventListener('click', (e)=>{
  if(e.target.matches('[data-modal-close]') || e.target.closest('[data-modal-close]')){
    closePropertyModal();
  }
});
