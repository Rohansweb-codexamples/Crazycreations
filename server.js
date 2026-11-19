const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: isProduction ? { rejectUnauthorized: false } : false });
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(session({
  store: new PgSession({ pool, tableName: "user_sessions", createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || "development-only-change-this-secret",
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, secure: isProduction, sameSite: "lax", maxAge: 1000 * 60 * 60 * 8 }
}));

const statuses = ["Order placed", "Order confirmed", "Preparing", "Out for delivery", "Delivered", "Cancelled"];
const money = n => Number(Number(n).toFixed(2));

async function initialiseDatabase() {
  await pool.query("CREATE TABLE IF NOT EXISTS admins (id SERIAL PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS products (id SERIAL PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT 'Other',price NUMERIC(10,2) NOT NULL CHECK(price>=0),stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0),image_url TEXT NOT NULL DEFAULT '',active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS orders (id BIGSERIAL PRIMARY KEY,order_code TEXT UNIQUE NOT NULL,tracking_token TEXT UNIQUE NOT NULL,customer_name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL,address TEXT NOT NULL,delivery_notes TEXT NOT NULL DEFAULT '',subtotal NUMERIC(10,2) NOT NULL,delivery_fee NUMERIC(10,2) NOT NULL,total NUMERIC(10,2) NOT NULL,payment_method TEXT NOT NULL DEFAULT 'Pay on delivery',status TEXT NOT NULL DEFAULT 'Order placed',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS order_items (id BIGSERIAL PRIMARY KEY,order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,product_id INTEGER,product_title TEXT NOT NULL,unit_price NUMERIC(10,2) NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),line_total NUMERIC(10,2) NOT NULL)");
  await pool.query("CREATE TABLE IF NOT EXISTS store_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL)");
  await pool.query("INSERT INTO store_settings(key,value) VALUES('delivery_fee','2.50') ON CONFLICT(key) DO NOTHING");

  const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || "";
  if (adminEmail && adminPassword) {
    const hash = await bcrypt.hash(adminPassword, 12);
    await pool.query("INSERT INTO admins(email,password_hash) VALUES($1,$2) ON CONFLICT(email) DO NOTHING", [adminEmail, hash]);
  }
  const count = await pool.query("SELECT COUNT(*)::int AS count FROM products");
  if (count.rows[0].count === 0) {
    const samples = [
      ["Crazy Colour Kit","A bright starter bundle ready for your next creative project.","Creative Kits",8.99,12,"https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=900"],
      ["Make & Create Set","A handy collection of materials for making something brilliant.","Craft Supplies",5.5,20,"https://images.unsplash.com/photo-1452860606245-08befc0ff44b?w=900"],
      ["Mini Mystery Box","A surprise selection of fun creative bits and pieces.","Mystery Boxes",12,8,"https://images.unsplash.com/photo-1513201099705-a9746e1e201f?w=900"]
    ];
    for (const p of samples) await pool.query("INSERT INTO products(title,description,category,price,stock,image_url) VALUES($1,$2,$3,$4,$5,$6)", p);
  }
}
let databaseReady;
function ensureDatabase(){
  if(!databaseReady) databaseReady=initialiseDatabase();
  return databaseReady;
}
app.use(async(_req,res,next)=>{
  try{await ensureDatabase();next();}
  catch(err){console.error("Database initialisation failed:",err);res.status(503).json({error:"The shop database is unavailable. Please try again shortly."});}
});

function requireAdmin(req,res,next){ if(!req.session.adminId) return res.status(401).json({error:"Please sign in to the admin area."}); next(); }
function cleanText(value,max=500){ return String(value??"").trim().slice(0,max); }
function validEmail(value){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function publicProduct(row){ return {id:row.id,title:row.title,description:row.description,category:row.category,price:Number(row.price),stock:row.stock,imageUrl:row.image_url}; }

app.get("/api/health",async(_req,res)=>{try{await pool.query("SELECT 1");res.json({ok:true});}catch{res.status(503).json({ok:false});}});
app.get("/api/store",async(_req,res)=>{try{const [products,fee]=await Promise.all([pool.query("SELECT * FROM products WHERE active=TRUE ORDER BY created_at DESC"),pool.query("SELECT value FROM store_settings WHERE key='delivery_fee'")]);res.json({products:products.rows.map(publicProduct),deliveryFee:Number(fee.rows[0]?.value||0)});}catch(err){console.error(err);res.status(500).json({error:"The shop could not load. Please try again."});}});

app.post("/api/orders",async(req,res)=>{
  const name=cleanText(req.body.name,100),email=cleanText(req.body.email,180).toLowerCase(),phone=cleanText(req.body.phone,40),address=cleanText(req.body.address,700),notes=cleanText(req.body.notes,500),items=Array.isArray(req.body.items)?req.body.items:[];
  if(!name||!validEmail(email)||!phone||!address||!items.length||items.length>30)return res.status(400).json({error:"Please complete your name, valid email, phone, delivery address and basket."});
  const client=await pool.connect();
  try{
    await client.query("BEGIN");let subtotal=0;const lockedItems=[];
    for(const item of items){
      const id=Number(item.id),quantity=Math.floor(Number(item.quantity));
      if(!Number.isInteger(id)||!Number.isInteger(quantity)||quantity<1||quantity>50)throw new Error("Your basket contains an invalid item.");
      const found=await client.query("SELECT * FROM products WHERE id=$1 AND active=TRUE FOR UPDATE",[id]);
      if(!found.rowCount)throw new Error("A product in your basket is no longer available.");
      const product=found.rows[0];if(product.stock<quantity)throw new Error(product.title+" does not have enough stock.");
      const unitPrice=Number(product.price),lineTotal=money(unitPrice*quantity);subtotal+=lineTotal;lockedItems.push({product,quantity,unitPrice,lineTotal});
    }
    subtotal=money(subtotal);const setting=await client.query("SELECT value FROM store_settings WHERE key='delivery_fee'");
    const deliveryFee=money(Number(setting.rows[0]?.value||0)),total=money(subtotal+deliveryFee);
    const orderCode="CC-"+crypto.randomBytes(4).toString("hex").toUpperCase(),trackingToken=crypto.randomBytes(24).toString("hex");
    const inserted=await client.query("INSERT INTO orders(order_code,tracking_token,customer_name,email,phone,address,delivery_notes,subtotal,delivery_fee,total) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",[orderCode,trackingToken,name,email,phone,address,notes,subtotal,deliveryFee,total]);
    const orderId=inserted.rows[0].id;
    for(const item of lockedItems){
      await client.query("INSERT INTO order_items(order_id,product_id,product_title,unit_price,quantity,line_total) VALUES($1,$2,$3,$4,$5,$6)",[orderId,item.product.id,item.product.title,item.unitPrice,item.quantity,item.lineTotal]);
      await client.query("UPDATE products SET stock=stock-$1,updated_at=NOW() WHERE id=$2",[item.quantity,item.product.id]);
    }
    await client.query("COMMIT");res.status(201).json({orderCode,trackingToken,total,status:"Order placed"});
  }catch(err){await client.query("ROLLBACK");res.status(400).json({error:err.message||"We could not place your order."});}finally{client.release();}
});

app.post("/api/track",async(req,res)=>{
  const orderCode=cleanText(req.body.orderCode,30).toUpperCase(),email=cleanText(req.body.email,180).toLowerCase(),token=cleanText(req.body.trackingToken,100);
  try{
    const found=await pool.query("SELECT id,order_code,status,total,created_at,updated_at,tracking_token FROM orders WHERE order_code=$1 AND email=$2 AND ($3='' OR tracking_token=$3)",[orderCode,email,token]);
    if(!found.rowCount)return res.status(404).json({error:"We couldn't find that order. Check the order number and email address."});
    const order=found.rows[0],items=await pool.query("SELECT product_title,quantity,unit_price,line_total FROM order_items WHERE order_id=$1 ORDER BY id",[order.id]);
    res.json({orderCode:order.order_code,status:order.status,total:Number(order.total),createdAt:order.created_at,updatedAt:order.updated_at,trackingToken:order.tracking_token,items:items.rows.map(x=>({...x,unitPrice:Number(x.unit_price),lineTotal:Number(x.line_total)})),statuses});
  }catch(err){console.error(err);res.status(500).json({error:"Tracking is temporarily unavailable."});}
});

app.post("/api/admin/login",async(req,res)=>{
  const email=cleanText(req.body.email,180).toLowerCase(),password=String(req.body.password||"");
  try{
    const found=await pool.query("SELECT id,email,password_hash FROM admins WHERE email=$1",[email]);
    if(!found.rowCount||!(await bcrypt.compare(password,found.rows[0].password_hash)))return res.status(401).json({error:"Email or password is incorrect."});
    req.session.regenerate(err=>{if(err)return res.status(500).json({error:"Could not start your admin session."});req.session.adminId=found.rows[0].id;req.session.adminEmail=found.rows[0].email;res.json({ok:true,email:found.rows[0].email});});
  }catch(err){console.error(err);res.status(500).json({error:"Sign in is temporarily unavailable."});}
});
app.post("/api/admin/logout",requireAdmin,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/admin/me",requireAdmin,(req,res)=>res.json({email:req.session.adminEmail}));

app.get("/api/admin/products",requireAdmin,async(_req,res)=>{const r=await pool.query("SELECT * FROM products ORDER BY id DESC");res.json(r.rows.map(p=>({...publicProduct(p),active:p.active})));});
app.post("/api/admin/products",requireAdmin,async(req,res)=>{
  const p=req.body||{},title=cleanText(p.title,120),description=cleanText(p.description,1000),category=cleanText(p.category,60)||"Other",price=Number(p.price),stock=Math.floor(Number(p.stock)),imageUrl=cleanText(p.imageUrl,1000);
  if(!title||!Number.isFinite(price)||price<0||!Number.isInteger(stock)||stock<0)return res.status(400).json({error:"Enter a product name, valid price and stock quantity."});
  const r=await pool.query("INSERT INTO products(title,description,category,price,stock,image_url,active) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",[title,description,category,price,stock,imageUrl,p.active!==false]);res.status(201).json(publicProduct(r.rows[0]));
});
app.put("/api/admin/products/:id",requireAdmin,async(req,res)=>{
  const p=req.body||{},title=cleanText(p.title,120),description=cleanText(p.description,1000),category=cleanText(p.category,60)||"Other",price=Number(p.price),stock=Math.floor(Number(p.stock)),imageUrl=cleanText(p.imageUrl,1000);
  if(!title||!Number.isFinite(price)||price<0||!Number.isInteger(stock)||stock<0)return res.status(400).json({error:"Enter a product name, valid price and stock quantity."});
  const r=await pool.query("UPDATE products SET title=$1,description=$2,category=$3,price=$4,stock=$5,image_url=$6,active=$7,updated_at=NOW() WHERE id=$8 RETURNING *",[title,description,category,price,stock,imageUrl,p.active!==false,req.params.id]);
  if(!r.rowCount)return res.status(404).json({error:"Product not found."});res.json(publicProduct(r.rows[0]));
});
app.delete("/api/admin/products/:id",requireAdmin,async(req,res)=>{const r=await pool.query("UPDATE products SET active=FALSE,updated_at=NOW() WHERE id=$1 RETURNING id",[req.params.id]);if(!r.rowCount)return res.status(404).json({error:"Product not found."});res.json({ok:true});});

app.get("/api/admin/orders",requireAdmin,async(_req,res)=>{
  const orders=await pool.query("SELECT * FROM orders ORDER BY created_at DESC LIMIT 250"),result=[];
  for(const o of orders.rows){
    const items=await pool.query("SELECT product_title,quantity,unit_price,line_total FROM order_items WHERE order_id=$1 ORDER BY id",[o.id]);
    result.push({id:o.id,orderCode:o.order_code,customerName:o.customer_name,email:o.email,phone:o.phone,address:o.address,notes:o.delivery_notes,subtotal:Number(o.subtotal),deliveryFee:Number(o.delivery_fee),total:Number(o.total),status:o.status,createdAt:o.created_at,items:items.rows.map(i=>({...i,unitPrice:Number(i.unit_price),lineTotal:Number(i.line_total)}))});
  }res.json(result);
});
app.patch("/api/admin/orders/:id/status",requireAdmin,async(req,res)=>{
  const status=cleanText(req.body.status,40);if(!statuses.includes(status))return res.status(400).json({error:"Invalid order status."});
  const r=await pool.query("UPDATE orders SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING order_code,status",[status,req.params.id]);
  if(!r.rowCount)return res.status(404).json({error:"Order not found."});res.json({ok:true,...r.rows[0]});
});
app.get("/api/admin/settings",requireAdmin,async(_req,res)=>{const r=await pool.query("SELECT value FROM store_settings WHERE key='delivery_fee'");res.json({deliveryFee:Number(r.rows[0]?.value||0)});});
app.put("/api/admin/settings",requireAdmin,async(req,res)=>{
  const fee=Number(req.body.deliveryFee);if(!Number.isFinite(fee)||fee<0||fee>100)return res.status(400).json({error:"Enter a delivery fee between £0 and £100."});
  await pool.query("INSERT INTO store_settings(key,value) VALUES('delivery_fee',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",[fee.toFixed(2)]);res.json({deliveryFee:fee});
});

app.use(express.static(path.join(__dirname,"public")));
app.get("*",(_req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
const port=process.env.PORT||3000;
if(require.main===module){
  ensureDatabase().then(()=>app.listen(port,()=>console.log("CrazyCreations running on "+port)))
    .catch(err=>{console.error("Database startup failed:",err);process.exit(1);});
}
module.exports=app;
