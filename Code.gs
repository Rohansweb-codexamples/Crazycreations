const ADMIN_PIN = 'ChangeThisPIN123';

const HEADERS = {
  Products: ['ID', 'Name', 'Description', 'Price', 'Stock', 'Image', 'Active', 'On Sale', 'Sale Price'],
  Orders: ['Order ID', 'Date', 'Customer', 'Phone', 'Address', 'Items', 'Total', 'Payment', 'Status', 'Notes'],
  Settings: ['Key', 'Value']
};

// Run this ONCE to create the Google Sheets database.
function setupStore() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('STORE_SHEET_ID');
  let ss = id ? SpreadsheetApp.openById(id) :
    SpreadsheetApp.create('CrazyCreations Store Database');

  props.setProperty('STORE_SHEET_ID', ss.getId());

  Object.entries(HEADERS).forEach(([name, headers]) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(headers);
      sh.setFrozenRows(1);
    } else if (name === 'Products') {
      const existing = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      headers.forEach(h => { if (!existing.includes(h)) sh.getRange(1, sh.getLastColumn()+1).setValue(h); });
    }
  });

  const settings = ss.getSheetByName('Settings');
  if (settings.getLastRow() === 1) {
    settings.appendRow(['StoreName', 'CrazyCreations']);
    settings.appendRow(['Announcement', 'Welcome to CrazyCreations!']);
    settings.appendRow(['DeliveryMessage', 'Pay on delivery']);
  }

  Logger.log('DATABASE CREATED: ' + ss.getUrl());
  return ss.getUrl();
}

function db_() {
  const id = PropertiesService.getScriptProperties()
    .getProperty('STORE_SHEET_ID');

  if (!id) throw new Error('Database not created. Run setupStore first.');

  return SpreadsheetApp.openById(id);
}

// GitHub Pages communicates with this endpoint using JSONP.
function doGet(e) {
  let callback = e.parameter.callback || '';
  let result;

  try {
    const action = e.parameter.action;
    const payload = JSON.parse(e.parameter.payload || '{}');

    result = {
      ok: true,
      data: handleAction_(action, payload)
    };
  } catch (err) {
    result = {
      ok: false,
      error: err.message || 'Something went wrong.'
    };
  }

  const json = JSON.stringify(result);

  if (callback && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(callback)) {
    return ContentService
      .createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function handleAction_(action, p) {
  switch (action) {
    case 'public':
      return publicData_();
    case 'login':
      return login_(p.pin);
    case 'adminData':
      verifyAdmin_(p.token);
      return adminData_();
    case 'placeOrder':
      return placeOrder_(p);
    case 'saveProduct':
      verifyAdmin_(p.token);
      return saveProduct_(p);
    case 'uploadImageStart':
      verifyAdmin_(p.token);
      return uploadImageStart_(p);
    case 'uploadImageChunk':
      verifyAdmin_(p.token);
      return uploadImageChunk_(p);
    case 'uploadImageFinish':
      verifyAdmin_(p.token);
      return uploadImageFinish_(p);
    case 'deleteProduct':
      verifyAdmin_(p.token);
      return deleteProduct_(p.id);
    case 'updateOrder':
      verifyAdmin_(p.token);
      return updateOrder_(p.id, p.status);
    case 'saveSettings':
      verifyAdmin_(p.token);
      return saveSettings_(p.settings);
    default:
      throw new Error('Unknown action: ' + action);
  }
}

function objects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0];
  return values.slice(1)
    .filter(row => row.some(cell => cell !== ''))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        let value = row[i];
        if (value instanceof Date) value = value.toISOString();
        obj[h] = value;
      });
      return obj;
    });
}

function publicData_() {
  const ss = db_();
  const products = objects_(ss.getSheetByName('Products'))
    .filter(p => p.Name && p.Active !== false &&
      String(p.Active).toLowerCase() !== 'false');

  const settings = {};
  objects_(ss.getSheetByName('Settings')).forEach(r => {
    settings[r.Key] = r.Value;
  });

  return { products: products.map(p => ({...p, OnSale: p['On Sale'] === true || String(p['On Sale']).toLowerCase() === 'true', SalePrice: p['Sale Price']})), settings, topSellers: topSellers_(ss, products) };
}

function login_(pin) {
  if (String(pin) !== ADMIN_PIN) {
    throw new Error('Incorrect admin PIN.');
  }

  const token = Utilities.getUuid();
  CacheService.getScriptCache().put('admin_' + token, 'valid', 21600);
  return { token };
}

function verifyAdmin_(token) {
  if (!token ||
      CacheService.getScriptCache().get('admin_' + token) !== 'valid') {
    throw new Error('Admin session expired. Please sign in again.');
  }
}

function adminData_() {
  const ss = db_();
  const settings = {};

  objects_(ss.getSheetByName('Settings')).forEach(r => {
    settings[r.Key] = r.Value;
  });

  const products = objects_(ss.getSheetByName('Products')).map(p => ({
    id: String(p.ID),
    name: p.Name,
    description: p.Description,
    price: p.Price,
    stock: p.Stock,
    image: p.Image,
    active: p.Active !== false &&
      String(p.Active).toLowerCase() !== 'false',
    onSale: p['On Sale'] === true || String(p['On Sale']).toLowerCase() === 'true',
    salePrice: p['Sale Price']
  }));

  const orders = objects_(ss.getSheetByName('Orders')).reverse().map(o => ({
    id: String(o['Order ID']),
    date: o.Date,
    customer: o.Customer,
    phone: o.Phone,
    address: o.Address,
    items: parseOrderItems_(o.Items),
    total: o.Total,
    payment: o.Payment,
    status: o.Status,
    notes: o.Notes
  }));

  return { products, orders, settings, sheetUrl: ss.getUrl() };
}

function placeOrder_(p) {
  if (!p.customer || !p.phone || !p.address ||
      !Array.isArray(p.items) || !p.items.length) {
    throw new Error('Please complete all checkout details.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const ss = db_();
    const sheet = ss.getSheetByName('Products');
    const products = objects_(sheet);
    const quantities = {};

    p.items.forEach(item => {
      const id = String(item.id);
      const quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new Error('Invalid quantity.');
      }
      quantities[id] = (quantities[id] || 0) + quantity;
    });

    let total = 0;
    const orderItems = [];

    Object.keys(quantities).forEach(id => {
      const product = products.find(x => String(x.ID) === id);
      if (!product || String(product.Active).toLowerCase() === 'false') {
        throw new Error('A product is no longer available.');
      }

      const quantity = quantities[id];
      const stock = Number(product.Stock);
      const regularPrice = Number(product.Price);
      const isSale = product['On Sale'] === true || String(product['On Sale']).toLowerCase() === 'true';
      const salePrice = Number(product['Sale Price']);
      const price = isSale && Number.isFinite(salePrice) && salePrice > 0 ? salePrice : regularPrice;

      if (stock < quantity) throw new Error('Not enough stock for ' + product.Name);
      if (!Number.isFinite(price) || price < 0) throw new Error('Invalid product price.');

      total += price * quantity;
      orderItems.push({ id, name: product.Name, quantity, price });
    });

    // Deduct stock only after validating every item.
    orderItems.forEach(item => {
      const index = products.findIndex(x => String(x.ID) === item.id);
      sheet.getRange(index + 2, 5)
        .setValue(Number(products[index].Stock) - item.quantity);
    });

    const orderId = 'CC-' + Utilities.getUuid().substring(0, 8).toUpperCase();

    ss.getSheetByName('Orders').appendRow([
      orderId,
      new Date(),
      String(p.customer).trim(),
      String(p.phone).trim(),
      String(p.address).trim(),
      JSON.stringify(orderItems),
      total,
      'Pay on delivery',
      'New',
      String(p.notes || '').trim()
    ]);

    return { orderId, total };
  } finally {
    lock.releaseLock();
  }
}

function saveProduct_(p) {
  if (!p.name || !String(p.name).trim()) {
    throw new Error('Product name is required.');
  }

  const price = Number(p.price);
  const stock = Number(p.stock);
  const salePrice = p.salePrice === '' || p.salePrice == null ? 0 : Number(p.salePrice);
  if (p.onSale === true && (!Number.isFinite(salePrice) || salePrice <= 0 || salePrice >= price)) throw new Error('Sale price must be lower than the normal price.');

  if (!Number.isFinite(price) || price < 0 ||
      !Number.isInteger(stock) || stock < 0) {
    throw new Error('Enter a valid price and stock quantity.');
  }

  const sheet = db_().getSheetByName('Products');
  const products = objects_(sheet);
  const id = p.id || Utilities.getUuid().substring(0, 8);
  const index = products.findIndex(x => String(x.ID) === String(id));

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  ['On Sale', 'Sale Price'].forEach(h => { if (!headers.includes(h)) { sheet.getRange(1, sheet.getLastColumn()+1).setValue(h); headers.push(h); } });
  const image = p.imageUploadId ? CacheService.getScriptCache().get('ccup_image_'+p.imageUploadId) : String(p.image || '').trim();
  if (p.imageUploadId && !image) throw new Error('Image upload expired. Please choose the image again.');
  const map = {'ID':id,'Name':String(p.name).trim(),'Description':String(p.description || '').trim(),'Price':price,'Stock':stock,'Image':image,'Active':p.active !== false,'On Sale':p.onSale === true,'Sale Price':p.salePrice === '' || p.salePrice == null ? '' : Number(p.salePrice)};
  const row = headers.map(h => map[h] ?? '');
  if (index >= 0) sheet.getRange(index + 2, 1, 1, row.length).setValues([row]);
  else sheet.appendRow(row);

  return { success: true };
}

function deleteProduct_(id) {
  const sheet = db_().getSheetByName('Products');
  const products = objects_(sheet);
  const index = products.findIndex(x => String(x.ID) === String(id));
  if (index < 0) throw new Error('Product not found.');
  sheet.deleteRow(index + 2);
  return { success: true };
}

function updateOrder_(id, status) {
  const allowed = [
    'New', 'Processing', 'Dispatched',
    'Out for delivery', 'Delivered', 'Cancelled'
  ];

  if (!allowed.includes(status)) throw new Error('Invalid delivery status.');

  const sheet = db_().getSheetByName('Orders');
  const orders = objects_(sheet);
  const index = orders.findIndex(x => String(x['Order ID']) === String(id));
  if (index < 0) throw new Error('Order not found.');

  sheet.getRange(index + 2, 9).setValue(status);
  return { success: true };
}

function saveSettings_(settings) {
  const sheet = db_().getSheetByName('Settings');
  const rows = objects_(sheet);

  Object.keys(settings || {}).forEach(key => {
    const index = rows.findIndex(x => String(x.Key) === key);
    if (index >= 0) {
      sheet.getRange(index + 2, 2).setValue(String(settings[key]));
    } else {
      sheet.appendRow([key, String(settings[key])]);
    }
  });

  return { success: true };
}

function parseOrderItems_(raw) {
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(String(raw || '[]')); } catch (e) { return []; }
}
function topSellers_(ss, products) {
  const totals = {};
  objects_(ss.getSheetByName('Orders')).forEach(order => {
    if (String(order.Status).toLowerCase() === 'cancelled') return;
    parseOrderItems_(order.Items).forEach(item => {
      const id=String(item.id||''); totals[id]=(totals[id]||0)+Number(item.quantity||0);
    });
  });
  return products.map(p=>({id:String(p.ID),name:p.Name,description:p.Description,price:p.Price,stock:p.Stock,image:p.Image,onSale:p['On Sale']===true||String(p['On Sale']).toLowerCase()==='true',salePrice:p['Sale Price'],sold:totals[String(p.ID)]||0}))
    .filter(p=>p.name && p.Active !== false && String(p.Active).toLowerCase() !== 'false').sort((a,b)=>b.sold-a.sold).slice(0,8);
}
function uploadImageStart_(p) {
  const id=Utilities.getUuid(), total=Number(p.totalChunks);
  if(!Number.isInteger(total)||total<1||total>30) throw new Error('Please use an image under 24 KB after compression.');
  CacheService.getScriptCache().put('ccup_meta_'+id,JSON.stringify({total,mime:String(p.mime||'image/jpeg')}),21600);
  return {uploadId:id};
}
function uploadImageChunk_(p) {
  const cache=CacheService.getScriptCache(), meta=cache.get('ccup_meta_'+String(p.uploadId||''));
  if(!meta) throw new Error('Image upload expired. Please try again.');
  const index=Number(p.index), total=JSON.parse(meta).total, data=String(p.data||'');
  if(!Number.isInteger(index)||index<0||index>=total||data.length>1300) throw new Error('Invalid image upload part.');
  cache.put('ccup_part_'+p.uploadId+'_'+index,data,21600);
  return {saved:true};
}
function uploadImageFinish_(p) {
  const cache=CacheService.getScriptCache(), id=String(p.uploadId||''), raw=cache.get('ccup_meta_'+id);
  if(!raw) throw new Error('Image upload expired. Please try again.');
  const meta=JSON.parse(raw), parts=[];
  for(let i=0;i<meta.total;i++){const part=cache.get('ccup_part_'+id+'_'+i);if(part===null)throw new Error('An image part is missing. Please upload again.');parts.push(part);}
  const dataUrl='data:'+meta.mime+';base64,'+parts.join('');
  if(dataUrl.length>49000) throw new Error('Please choose a smaller image.');
  cache.put('ccup_image_'+id,dataUrl,21600);
  for(let i=0;i<meta.total;i++)cache.remove('ccup_part_'+id+'_'+i);
  cache.remove('ccup_meta_'+id);
  return {imageUploadId:id};
}
