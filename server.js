require('dotenv').config({ path: './env' });
const express = require('express');
const fetch = global.fetch || ((...args) => import('node-fetch').then(({default: f}) => f(...args)));

const app = express();
const PORT = process.env.PORT || 3000;

// Static files
app.use(express.static(__dirname));

// Simple Notion proxy to hide token from browser
app.use(express.json());

// Helper: query Notion DB by id
async function queryNotionDB(databaseId, token, notionVersion) {
  const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': notionVersion,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ page_size: 100 })
  });
  if (!res.ok) {
    const t = await res.text();
    const err = new Error(`Notion API error ${res.status}: ${t}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

app.post('/api/notion/query', async (req, res) => {
  try {
    const token = process.env.NOTION_TOKEN;
    const notionVersion = '2022-06-28';

    // Support multiple env names for convenience
    const saleDB = process.env.SALE_DATABASE_ID || process.env.DATABASE_ID_SALE || '';
    const rentDB = process.env.RENT_DATABASE_ID || process.env.DATABASE_ID_RENT || '';
    const singleDB = process.env.DATABASE_ID || '';

    if (!token) {
      return res.status(500).json({ error: 'NOTION_TOKEN is not set' });
    }

    const scope = String((req.body && req.body.scope) || 'all').toLowerCase();

    // Determine which DBs to query
    let dbsToQuery = [];
    if (scope === 'sale' && saleDB) dbsToQuery = [saleDB];
    else if (scope === 'rent' && rentDB) dbsToQuery = [rentDB];
    else {
      // all
      if (saleDB) dbsToQuery.push(saleDB);
      if (rentDB) dbsToQuery.push(rentDB);
      if (dbsToQuery.length === 0 && singleDB) dbsToQuery = [singleDB];
    }

    if (dbsToQuery.length === 0) {
      return res.status(500).json({ error: 'No DATABASE_ID configured. Set SALE_DATABASE_ID and/or RENT_DATABASE_ID (or fallback DATABASE_ID).' });
    }

    const resultsArrays = await Promise.all(
      dbsToQuery.map((id) => queryNotionDB(id, token, notionVersion).catch((e) => ({ error: e.message, results: [] })))
    );

    // Merge results
    const merged = [];
    for (const r of resultsArrays) {
      if (r && Array.isArray(r.results)) merged.push(...r.results);
    }

    res.json({ object: 'list', results: merged, has_more: false });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Proxy error' });
  }
});

app.post('/api/notion/lead', async (req,res)=>{
  try {
    const token = process.env.NOTION_TOKEN;
    if(!token) return res.status(500).json({error:'NOTION_TOKEN is not set'});
    const notionVersion = '2022-06-28';
    const leadsDB = process.env.LEADS_DATABASE_ID || '246ae126878e80bbbfadcd61d1fc89c8';
    if(!leadsDB) return res.status(500).json({error:'LEADS_DATABASE_ID not configured'});
    const { name, phone, contactMethod, propertyTitle, dealType, propertyObjectId } = req.body||{};
    if(!name || !phone) return res.status(400).json({error:'name and phone required'});

    // Серверная нормализация и валидация телефона (доп защита)
    function normalizePhone(input){
      let raw = String(input||'').trim();
      if(!raw) return null;
      raw = raw.replace(/[\s()\-]/g,'');
      if(raw.startsWith('00')) raw = '+'+raw.slice(2);
      if(raw[0] !== '+'){
        if(/^[78]\d{10}$/.test(raw)) raw = '+7'+raw.slice(1); // РФ локально 11 цифр
        else if(/^0\d{9}$/.test(raw)) raw = '+66'+raw.slice(1); // TH локально 0 + 9 цифр
        else if(/^66\d{8,9}$/.test(raw)) raw = '+'+raw; // TH без плюса
        else if(/^\d{7,15}$/.test(raw)) raw = '+'+raw; // generic
        else return null;
      }
      // country-specific strict lengths
      if(/^\+7/.test(raw)){
        if(!/^\+7\d{10}$/.test(raw)) return null;
      } else if(/^\+66/.test(raw)){
        if(!/^\+66\d{8,9}$/.test(raw)) return null;
      } else {
        if(!/^\+\d{7,15}$/.test(raw)) return null;
      }
      return raw;
    }
    const phoneNormalized = normalizePhone(phone);
    if(!phoneNormalized) return res.status(400).json({error:'Invalid phone format'});

    // Fetch DB schema to discover actual property keys & types
    const dbMetaResp = await fetch(`https://api.notion.com/v1/databases/${leadsDB}`,{
      method:'GET',
      headers:{ 'Authorization':`Bearer ${token}`, 'Notion-Version': notionVersion, 'Content-Type':'application/json' }
    });
    if(!dbMetaResp.ok){
      const txt = await dbMetaResp.text();
      console.error('Failed to fetch leads DB meta', txt);
      return res.status(500).json({error:'Failed to fetch leads DB meta'});
    }
    const dbMeta = await dbMetaResp.json();
    const propertiesMeta = dbMeta.properties || {};
    // Build lowercase map
    const lowerMap = {}; // lower -> actualKey
    for(const key of Object.keys(propertiesMeta)) lowerMap[key.toLowerCase()] = key;

    function findKey(candidates){
      for(const c of candidates){ const k = lowerMap[c.toLowerCase()]; if(k) return k; }
      return null;
    }

    // Identify title property (must use existing title prop)
    let titleKey = null;
    for(const k of Object.keys(propertiesMeta)) if(propertiesMeta[k].type === 'title'){ titleKey = k; break; }
    // Desired logical fields and candidate names
    const keys = {
      userName: findKey(['пользователь','имя','client','клиент','name','название', titleKey||'']),
      propertyTitle: findKey(['объект','объект/проект','объект или проект','project','property','object']),
      propertyExtId: findKey(['id объекта','id обьекта','id объекта ','id обьекта ','id обекта','id','object id','external id','object external id','ид объекта','ид обьекта']),
      date: findKey(['дата','date','created date']),
      dealTypeKey: findKey(['тип сделки','вид сделки','deal type']),
      source: findKey(['источник','source']),
      phoneKey: findKey(['телефон','phone','номер','phone number']),
      contactMethodKey: findKey(['способ связи','contact method','contact','preferred contact'])
    };

    // Формируем дату в часовом поясе UTC+7 (Bangkok) независимо от локали сервера
    function buildUTCPlus7(){
      const nowUtc = Date.now(); // миллисекунды UTC
      const plus7 = new Date(nowUtc + 7*60*60*1000); // смещаем на +7 часов
      const pad = n => String(n).padStart(2,'0');
      // Используем getUTC* потому что мы уже вручную сместили время
      return `${plus7.getUTCFullYear()}-${pad(plus7.getUTCMonth()+1)}-${pad(plus7.getUTCDate())}`+
             `T${pad(plus7.getUTCHours())}:${pad(plus7.getUTCMinutes())}:${pad(plus7.getUTCSeconds())}+07:00`;
    }
    const dateTimeFull = buildUTCPlus7();

    const props = {};

    // Title (user name) mandatory
    if(titleKey){
      props[titleKey] = { title: [ { text: { content: String(name).slice(0,200) } } ] };
    } else if(keys.userName){
      props[keys.userName] = { title: [ { text: { content: String(name).slice(0,200) } } ] };
    }

    if(keys.propertyTitle && propertyTitle){
      const meta = propertiesMeta[keys.propertyTitle];
      if(meta.type === 'rich_text') props[keys.propertyTitle] = { rich_text: [ { text: { content: String(propertyTitle).slice(0,400) } } ] };
      else if(meta.type === 'title'){ // unlikely second title
        props[keys.propertyTitle] = { title: [ { text: { content: String(propertyTitle).slice(0,200) } } ] };
      }
    }

    if(keys.date){
      props[keys.date] = { date: { start: dateTimeFull } }; // с временем
    }

    if(keys.dealTypeKey && dealType){
      const meta = propertiesMeta[keys.dealTypeKey];
      if(meta.type === 'select') props[keys.dealTypeKey] = { select: { name: dealType } };
      else if(meta.type === 'rich_text') props[keys.dealTypeKey] = { rich_text: [ { text: { content: dealType } } ] };
    }

    if(keys.source){
      const meta = propertiesMeta[keys.source];
      const sourceVal = 'сайт';
      if(meta.type === 'select') props[keys.source] = { select: { name: sourceVal } };
      else if(meta.type === 'rich_text') props[keys.source] = { rich_text: [ { text: { content: sourceVal } } ] };
    }

    if(keys.phoneKey && phoneNormalized){
      const meta = propertiesMeta[keys.phoneKey];
      if(meta.type === 'phone_number') props[keys.phoneKey] = { phone_number: phoneNormalized };
      else if(meta.type === 'rich_text') props[keys.phoneKey] = { rich_text: [ { text: { content: phoneNormalized } } ] };
    }

    if(keys.contactMethodKey && contactMethod){
      const meta = propertiesMeta[keys.contactMethodKey];
      if(meta.type === 'select') props[keys.contactMethodKey] = { select: { name: contactMethod } };
      else if(meta.type === 'multi_select') props[keys.contactMethodKey] = { multi_select: [ { name: contactMethod } ] };
      else if(meta.type === 'rich_text') props[keys.contactMethodKey] = { rich_text: [ { text: { content: contactMethod } } ] };
    }

    // Ensure explicit 'способ связи' property also populated if present in schema
    if(contactMethod){
      const explicitKey = Object.keys(propertiesMeta).find(k=>k.toLowerCase()==='способ связи');
      if(explicitKey && !props[explicitKey]){
        const meta = propertiesMeta[explicitKey];
        if(meta.type === 'select') props[explicitKey] = { select: { name: contactMethod } };
        else if(meta.type === 'multi_select') props[explicitKey] = { multi_select: [ { name: contactMethod } ] };
        else if(meta.type === 'rich_text') props[explicitKey] = { rich_text: [ { text: { content: contactMethod } } ] };
        else if(meta.type === 'title') props[explicitKey] = { title: [ { text: { content: contactMethod } } ] }; // fallback
      }
    }

    if(keys.propertyExtId && propertyObjectId){
      const meta = propertiesMeta[keys.propertyExtId];
      if(meta){
        if(meta.type === 'rich_text') props[keys.propertyExtId] = { rich_text: [ { text: { content: propertyObjectId } } ] };
        else if(meta.type === 'select') props[keys.propertyExtId] = { select: { name: propertyObjectId } };
        else if(meta.type === 'multi_select') props[keys.propertyExtId] = { multi_select: [ { name: propertyObjectId } ] };
        else if(meta.type === 'title') props[keys.propertyExtId] = { title: [ { text: { content: propertyObjectId } } ] };
        else if(meta.type === 'number') { const num = Number(propertyObjectId.replace(/[^0-9.]/g,'')); if(!isNaN(num)) props[keys.propertyExtId] = { number: num }; }
      }
    } else if(propertyObjectId){
      // Fallback: if there is a rich text property we can reuse named similar to id объекта
      const fallbackKey = Object.keys(propertiesMeta).find(k => /id\s*объекта|id\s*обьекта/i.test(k));
      if(fallbackKey){
        const meta = propertiesMeta[fallbackKey];
        if(meta.type === 'rich_text') props[fallbackKey] = { rich_text: [ { text: { content: propertyObjectId } } ] };
      }
    }

    // Safety: ensure at least one property (title) exists
    if(!Object.keys(props).length){
      return res.status(500).json({error:'Could not map any properties to leads DB schema'});
    }

    const resp = await fetch('https://api.notion.com/v1/pages', {
      method:'POST',
      headers:{ 'Authorization': `Bearer ${token}`, 'Notion-Version': notionVersion, 'Content-Type':'application/json' },
      body: JSON.stringify({ parent:{ database_id: leadsDB }, properties: props })
    });

    const rawTxt = await resp.text();
    if(!resp.ok){
      console.error('Notion create lead error', resp.status, rawTxt);
      let errJson; try { errJson = JSON.parse(rawTxt); } catch(_) {}
      return res.status(resp.status).json({ error: errJson?.message || rawTxt });
    }
    let json; try { json = JSON.parse(rawTxt); } catch(_) { json = { id:'unknown' }; }
    res.json({ ok:true, id: json.id });
  } catch(e){ console.error(e); res.status(500).json({error:e.message||'lead error'}); }
});

app.post('/api/notion/consultation', async (req, res) => {
  try {
    const token = process.env.NOTION_TOKEN;
    if (!token) return res.status(500).json({ error: 'NOTION_TOKEN is not set' });
    const notionVersion = '2022-06-28';
    const consultationsDB = process.env.CONSULTATIONS_DATABASE_ID || process.env.CONSULT_DB_ID || process.env.CONSULTATION_DATABASE_ID;
    if (!consultationsDB) return res.status(500).json({ error: 'CONSULTATIONS_DATABASE_ID not configured' });

    const { name, phone } = req.body || {};
    if (!name || !phone) return res.status(400).json({ error: 'name and phone required' });

    function normalizePhone(input) {
      let raw = String(input || '').trim();
      if (!raw) return null;
      raw = raw.replace(/[\s()\-]/g, '');
      if (raw.startsWith('00')) raw = '+' + raw.slice(2);
      if (raw[0] !== '+') {
        if (/^[78]\d{10}$/.test(raw)) raw = '+7' + raw.slice(1); // RU
        else if (/^0\d{9}$/.test(raw)) raw = '+66' + raw.slice(1); // TH локально 0 + 9 цифр
        else if (/^66\d{8,9}$/.test(raw)) raw = '+' + raw; // TH без плюса
        else if (/^\d{7,15}$/.test(raw)) raw = '+' + raw; // generic
        else return null;
      }
      // country-specific strict lengths
      if (/^\+7/.test(raw)) {
        if (!/^\+7\d{10}$/.test(raw)) return null;
      } else if (/^\+66/.test(raw)) {
        if (!/^\+66\d{8,9}$/.test(raw)) return null;
      } else {
        if (!/^\+\d{7,15}$/.test(raw)) return null;
      }
      return raw;
    }
    const phoneNormalized = normalizePhone(phone);
    if (!phoneNormalized) return res.status(400).json({ error: 'Invalid phone format' });

    function buildUTCPlus7() {
      const nowUtc = Date.now();
      const plus7 = new Date(nowUtc + 7 * 60 * 60 * 1000);
      const pad = (n) => String(n).padStart(2, '0');
      return (
        `${plus7.getUTCFullYear()}-${pad(plus7.getUTCMonth() + 1)}-${pad(plus7.getUTCDate())}` +
        `T${pad(plus7.getUTCHours())}:${pad(plus7.getUTCMinutes())}:${pad(plus7.getUTCSeconds())}+07:00`
      );
    }
    const dateTimeFull = buildUTCPlus7();

    // Fetch DB meta
    const dbMetaResp = await fetch(`https://api.notion.com/v1/databases/${consultationsDB}` , {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': notionVersion,
        'Content-Type': 'application/json',
      },
    });
    if (!dbMetaResp.ok) {
      const txt = await dbMetaResp.text();
      console.error('Failed to fetch consultations DB meta', txt);
      return res.status(500).json({ error: 'Failed to fetch consultations DB meta' });
    }
    const dbMeta = await dbMetaResp.json();
    const propertiesMeta = dbMeta.properties || {};
    const lowerMap = {};
    for (const key of Object.keys(propertiesMeta)) lowerMap[key.toLowerCase()] = key;
    function findKey(candidates) {
      for (const c of candidates) {
        const k = lowerMap[c.toLowerCase()];
        if (k) return k;
      }
      return null;
    }

    // Determine keys
    let titleKey = null;
    for (const k of Object.keys(propertiesMeta)) if (propertiesMeta[k].type === 'title') { titleKey = k; break; }
    const nameKey = findKey(['имя', 'name', titleKey || '']);
    const phoneKey = findKey(['телефон', 'phone', 'номер', 'phone number']);
    const sourceKey = findKey(['источник', 'source']);
    const dateKey = findKey(['дата', 'date', 'created date']);

    const props = {};

    // Always set title to name
    if (titleKey) {
      props[titleKey] = { title: [{ text: { content: String(name).slice(0, 200) } }] };
    }
    // If there is a separate "Имя" prop and it's not the title prop
    if (nameKey && nameKey !== titleKey) {
      const meta = propertiesMeta[nameKey];
      if (meta.type === 'rich_text') props[nameKey] = { rich_text: [{ text: { content: String(name).slice(0, 400) } }] };
      else if (meta.type === 'title') props[nameKey] = { title: [{ text: { content: String(name).slice(0, 200) } }] };
    }

    if (phoneKey) {
      const meta = propertiesMeta[phoneKey];
      if (meta.type === 'phone_number') props[phoneKey] = { phone_number: phoneNormalized };
      else if (meta.type === 'rich_text') props[phoneKey] = { rich_text: [{ text: { content: phoneNormalized } }] };
    }

    if (sourceKey) {
      const meta = propertiesMeta[sourceKey];
      const sourceVal = 'сайт';
      if (meta.type === 'select') props[sourceKey] = { select: { name: sourceVal } };
      else if (meta.type === 'multi_select') props[sourceKey] = { multi_select: [{ name: sourceVal }] };
      else if (meta.type === 'rich_text') props[sourceKey] = { rich_text: [{ text: { content: sourceVal } }] };
      else if (meta.type === 'title' && !props[sourceKey]) props[sourceKey] = { title: [{ text: { content: sourceVal } }] };
    }

    if (dateKey) {
      const meta = propertiesMeta[dateKey];
      if (meta.type === 'date') props[dateKey] = { date: { start: dateTimeFull } };
      else if (meta.type === 'rich_text') props[dateKey] = { rich_text: [{ text: { content: dateTimeFull } }] };
    }

    // Safety: ensure at least title set
    if (!Object.keys(props).length && titleKey) {
      props[titleKey] = { title: [{ text: { content: String(name).slice(0, 200) } }] };
    }

    const resp = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': notionVersion,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ parent: { database_id: consultationsDB }, properties: props }),
    });

    const rawTxt = await resp.text();
    if (!resp.ok) {
      console.error('Notion create consultation error', resp.status, rawTxt);
      let errJson;
      try { errJson = JSON.parse(rawTxt); } catch (_) {}
      return res.status(resp.status).json({ error: errJson?.message || rawTxt });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'consultation error' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
