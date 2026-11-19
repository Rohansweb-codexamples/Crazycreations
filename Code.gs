const ADMIN_PIN = 'ChangeThisPIN123';

const HEADERS = {
  Products: ['ID', 'Name', 'Description', 'Price', 'Stock', 'Image', 'Active'],
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

  return { products, settings };
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
      String(p.Active).toLowerCase() !== 'false'
  }));

  const orders = objects_(ss.getSheetByName('Orders')).reverse().map(o => ({
    id: String(o['Order ID']),
    date: o.Date,
    customer: o.Customer,
    phone: o.Phone,
    address: o.Address,
    items: o.Items,
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
      const price = Number(product.Price);

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

  if (!Number.isFinite(price) || price < 0 ||
      !Number.isInteger(stock) || stock < 0) {
    throw new Error('Enter a valid price and stock quantity.');
  }

  const sheet = db_().getSheetByName('Products');
  const products = objects_(sheet);
  const id = p.id || Utilities.getUuid().substring(0, 8);
  const index = products.findIndex(x => String(x.ID) === String(id));

  const row = [
    id,
    String(p.name).trim(),
    String(p.description || '').trim(),
    price,
    stock,
    String(p.image || '').trim(),
    p.active !== false
  ];

  if (index >= 0) {
    sheet.getRange(index + 2, 1, 1, 7).setValues([row]);
  } else {
    sheet.appendRow(row);
  }

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
