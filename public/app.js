const $ = s => document.querySelector(s);
const money = n => "£" + Number(n || 0).toFixed(2);
const state = {products:[],cart:JSON.parse(localStorage.getItem("cc-cart")||"[]"),deliveryFee:0,category:"All",search:"",adminTab:"orders",editingProduct:null};
const statuses=["Order placed","Order confirmed","Preparing","Out for delivery","Delivered","Cancelled"];
const esc = v => String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const api=async(url,options={})=>{
 const response=await fetch(url,{credentials:"same-origin",headers:{"Content-Type":"application/json"},...options});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error||"Something went wrong. Please try again.");
 return data;
};
function saveCart(){localStorage.setItem("cc-cart",JSON.stringify(state.cart));renderCart();}
function countCart(){return state.cart.reduce((n,x)=>n+x.quantity,0);}
function subtotal(){return state.cart.reduce((n,x)=>n+x.price*x.quantity,0);}
function openDrawer(){$("#cartDrawer").classList.add("open");$("#drawerBackdrop").classList.add("open");}
function closeDrawer(){$("#cartDrawer").classList.remove("open");$("#drawerBackdrop").classList.remove("open");}
function openModal(id){$("#"+id).classList.add("open");}
function closeModal(id){$("#"+id).classList.remove("open");}
function showPage(id){
 ["trackPage","adminPage"].forEach(x=>$("#"+x).classList.add("hidden"));
 if(id)$("#"+id).classList.remove("hidden");
 document.querySelector("main").classList.toggle("hidden",!!id);
 document.querySelector("footer").classList.toggle("hidden",!!id);
 window.scrollTo(0,0);
}
function card(p){
 const image=p.imageUrl?'<img src="'+esc(p.imageUrl)+'" alt="'+esc(p.title)+'" loading="lazy" onerror="this.style.display=\\'none\\'">':'<div class="image-placeholder">C</div>';
 return '<article class="product-card"><div class="product-image">'+image+'<span class="product-category">'+esc(p.category)+'</span></div><div class="product-info"><h3>'+esc(p.title)+'</h3><p>'+esc(p.description)+'</p><div class="product-buy"><div><div class="product-price">'+money(p.price)+'</div><div class="stock-note">'+(p.stock>0?(p.stock<5?"Only "+p.stock+" left":"In stock"):"Out of stock")+'</div></div><button class="add-btn" data-add="'+p.id+'" '+(p.stock<1?"disabled":"")+'>'+(p.stock>0?"Add to basket":"Sold out")+'</button></div></div></article>';
}
async function loadStore(){
 try{const d=await api("/api/store");state.products=d.products;state.deliveryFee=d.deliveryFee;renderProducts();}
 catch(e){$("#productGrid").innerHTML='<div class="empty-state">'+esc(e.message)+'</div>';}
}
function renderProducts(){
 const cats=["All",...new Set(state.products.map(p=>p.category))];
 $("#categoryFilters").innerHTML=cats.map(c=>'<button class="filter '+(state.category===c?"active":"")+'" data-category="'+esc(c)+'">'+(c==="All"?"Everything":esc(c))+'</button>').join("");
 const q=state.search.toLowerCase();
 const list=state.products.filter(p=>(state.category==="All"||p.category===state.category)&&(p.title+" "+p.description+" "+p.category).toLowerCase().includes(q));
 $("#productGrid").innerHTML=list.length?list.map(card).join(""):'<div class="empty-state">No products found. Try another search.</div>';
}
function renderCart(){
 $("#cartCount").textContent=countCart();$("#cartSubtotal").textContent=money(subtotal());$("#checkoutOpen").disabled=!state.cart.length;
 $("#cartItems").innerHTML=state.cart.length?state.cart.map(x=>'<div class="cart-line"><img src="'+esc(x.imageUrl||"")+'" alt=""><div><h4>'+esc(x.title)+'</h4><small>'+money(x.price)+' each</small><div class="qty-controls"><button data-qty="'+x.id+'" data-change="-1">−</button><span>'+x.quantity+'</span><button data-qty="'+x.id+'" data-change="1">+</button></div></div><strong class="cart-line-total">'+money(x.price*x.quantity)+'</strong></div>').join(""):'<div class="empty-cart">Your basket is waiting for something brilliant.</div>';
 $("#deliveryHint").textContent="Delivery: "+money(state.deliveryFee)+" · Pay on delivery";
}
function addToCart(id){
 const p=state.products.find(x=>x.id===Number(id));if(!p)return;
 const item=state.cart.find(x=>x.id===p.id);
 if(item){if(item.quantity>=p.stock){alert("You've added all available stock.");return;}item.quantity++;}
 else state.cart.push({...p,quantity:1});
 saveCart();
}
function changeQty(id,change){
 const item=state.cart.find(x=>x.id===Number(id));if(!item)return;
 const p=state.products.find(x=>x.id===item.id);item.quantity+=change;
 if(item.quantity<1)state.cart=state.cart.filter(x=>x.id!==item.id);
 else if(p&&item.quantity>p.stock)item.quantity=p.stock;
 saveCart();
}
function openCheckout(){closeDrawer();$("#checkoutTotal").textContent=money(subtotal()+state.deliveryFee);$("#checkoutMessage").textContent="";openModal("checkoutModal");}
async function placeOrder(e){
 e.preventDefault();const button=$("#placeOrder");button.disabled=true;button.textContent="Placing order...";
 const form=Object.fromEntries(new FormData(e.currentTarget).entries());
 try{
  const result=await api("/api/orders",{method:"POST",body:JSON.stringify({...form,items:state.cart.map(x=>({id:x.id,quantity:x.quantity}))})});
  state.cart=[];saveCart();closeModal("checkoutModal");$("#successOrderCode").textContent=result.orderCode;
  $("#successTrack").dataset.code=result.orderCode;$("#successTrack").dataset.email=form.email;$("#successTrack").dataset.token=result.trackingToken;openModal("successModal");
 }catch(err){$("#checkoutMessage").textContent=err.message;}
 finally{button.disabled=false;button.innerHTML='Place my order <span>→</span>';}
}
async function trackOrder(e){
 if(e)e.preventDefault();
 const form=e?Object.fromEntries(new FormData(e.currentTarget).entries()):{orderCode:$("#successTrack").dataset.code,email:$("#successTrack").dataset.email,trackingToken:$("#successTrack").dataset.token};
 const target=$("#trackingResult");target.innerHTML="";
 try{
  const o=await api("/api/track",{method:"POST",body:JSON.stringify(form)});
  let steps=statuses.filter(s=>s!=="Cancelled").map((s,i)=>'<div class="tracking-step '+(statuses.indexOf(o.status)>=i?"done":"")+'">'+s+'</div>').join("");
  const items=o.items.map(x=>esc(x.product_title)+" × "+x.quantity+" — "+money(x.lineTotal)).join("<br>");
  target.innerHTML='<div class="tracking-card"><div class="tracking-head"><div><h3>'+esc(o.orderCode)+'</h3><span class="muted">Placed '+new Date(o.createdAt).toLocaleString()+'</span></div><span class="status-pill">'+esc(o.status)+'</span></div><div class="tracking-steps">'+steps+'</div>'+(o.status==="Cancelled"?'<p class="notice">This order has been cancelled. Please contact the shop if you need help.</p>':"")+'<div class="tracking-items">'+items+'<br><br><strong>Total: '+money(o.total)+'</strong></div></div>';
 }catch(err){target.innerHTML='<div class="notice">'+esc(err.message)+'</div>';}
}
function message(id,msg){const el=$(id);if(el)el.textContent=msg;}
async function adminLogin(e){
 e.preventDefault();const button=e.currentTarget.querySelector("button");button.disabled=true;
 try{const d=await api("/api/admin/login",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget).entries()))});$("#adminEmail").textContent=d.email;await showDashboard();}
 catch(err){message("#adminLoginMessage",err.message);}finally{button.disabled=false;}
}
async function checkAdmin(){try{const d=await api("/api/admin/me");$("#adminEmail").textContent=d.email;await showDashboard();}catch{}}
async function showDashboard(){$("#adminLogin").classList.add("hidden");$("#adminDashboard").classList.remove("hidden");await renderAdminTab();}
async function renderAdminTab(){
 const root=$("#adminContent");root.innerHTML='<div class="loading-state">Loading...</div>';
 try{
  if(state.adminTab==="orders"){
   const orders=await api("/api/admin/orders");
   root.innerHTML='<div class="admin-toolbar"><h2>Customer orders <span class="muted">('+orders.length+')</span></h2><button class="small-btn" id="refreshAdmin">Refresh</button></div>';
   root.innerHTML+=orders.length?orders.map(o=>{
    const itemText=o.items.map(i=>esc(i.product_title)+" × "+i.quantity+" ("+money(i.lineTotal)+")").join("<br>");
    return '<article class="admin-card"><div class="admin-order-top"><div><h3>'+esc(o.orderCode)+' · '+money(o.total)+'</h3><p>'+esc(o.customerName)+' · '+esc(o.email)+' · '+esc(o.phone)+'</p><p>'+new Date(o.createdAt).toLocaleString()+'</p></div><span class="status-pill">'+esc(o.status)+'</span></div><div class="admin-order-details"><div><strong>Delivery address</strong>'+esc(o.address)+(o.notes?"<br>Note: "+esc(o.notes):"")+'</div><div><strong>Order items</strong>'+itemText+'<br><br>Subtotal '+money(o.subtotal)+' · Delivery '+money(o.deliveryFee)+'</div></div><div class="admin-order-actions"><select data-status="'+o.id+'">'+statuses.map(s=>'<option '+(s===o.status?"selected":"")+'>'+s+'</option>').join("")+'</select><button class="small-btn" data-save-status="'+o.id+'">Update status</button></div></article>';
   }).join(""):'<div class="empty-state">No orders yet. New customer orders will appear here.</div>';
  }else if(state.adminTab==="products"){
   const products=await api("/api/admin/products");
   root.innerHTML='<div class="admin-toolbar"><h2>Products</h2><button class="small-btn" id="newProduct">+ Add product</button></div><div class="admin-products">'+products.map(p=>'<article class="admin-card admin-product"><img src="'+esc(p.imageUrl||"")+'" alt=""><div><h3>'+esc(p.title)+'</h3><p>'+money(p.price)+' · '+p.stock+' in stock · '+(p.active?"Visible":"Hidden")+'</p></div><button class="small-btn" data-edit-product="'+p.id+'">Edit</button></article>').join("")+'</div><div id="productEditor"></div>';
  }else{
   const d=await api("/api/admin/settings");
   root.innerHTML='<div class="admin-toolbar"><h2>Store settings</h2></div><div class="admin-card"><h3>Delivery fee</h3><p>Set the delivery fee added to every customer order.</p><div class="settings-row"><label>Delivery fee (£)<input id="deliveryFeeInput" type="number" min="0" max="100" step=".01" value="'+d.deliveryFee.toFixed(2)+'"></label><button class="small-btn" id="saveFee">Save fee</button></div><div class="form-message" id="feeMessage"></div></div><div class="admin-card"><h3>Payment method</h3><p>Pay on delivery is enabled. No online card payments are connected.</p></div>';
  }
 }catch(err){root.innerHTML='<div class="notice">'+esc(err.message)+'</div>';}
}
function productEditor(p){
 state.editingProduct=p?p.id:null;const root=$("#productEditor");
 root.innerHTML='<div class="admin-card"><h3>'+(p?"Edit product":"Add a product")+'</h3><form id="productForm" class="admin-form"><label>Product name<input name="title" required value="'+esc(p?p.title:"")+'"></label><label>Category<input name="category" value="'+esc(p?p.category:"Other")+'"></label><label>Price (£)<input name="price" type="number" min="0" step=".01" required value="'+(p?p.price:"")+'"></label><label>Stock quantity<input name="stock" type="number" min="0" step="1" required value="'+(p?p.stock:0)+'"></label><label class="wide">Description<textarea name="description" rows="2">'+esc(p?p.description:"")+'</textarea></label><label class="wide">Image URL<input name="imageUrl" type="url" value="'+esc(p?p.imageUrl:"")+'" placeholder="https://..."></label><label><span>Show in shop</span><input name="active" type="checkbox" '+(!p||p.active?"checked":"")+' style="width:auto;align-self:start"></label><div class="wide"><button class="small-btn" type="submit">Save product</button> <button class="outline-btn" type="button" id="cancelProduct">Cancel</button> '+(p?'<button class="text-btn" type="button" id="hideProduct">Remove from shop</button>':"")+'</div><div class="form-message wide" id="productMessage"></div></form></div>';
}
async function saveProduct(e){
 e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget).entries());d.active=e.currentTarget.elements.active.checked;d.price=Number(d.price);d.stock=Number(d.stock);
 try{await api(state.editingProduct?"/api/admin/products/"+state.editingProduct:"/api/admin/products",{method:state.editingProduct?"PUT":"POST",body:JSON.stringify(d)});await renderAdminTab();}
 catch(err){message("#productMessage",err.message);}
}
async function hideProduct(){if(!state.editingProduct||!confirm("Remove this product from the shop?"))return;try{await api("/api/admin/products/"+state.editingProduct,{method:"DELETE"});await renderAdminTab();}catch(err){message("#productMessage",err.message);}}
async function saveStatus(id){try{await api("/api/admin/orders/"+id+"/status",{method:"PATCH",body:JSON.stringify({status:$('[data-status="'+id+'"]').value})});await renderAdminTab();}catch(err){alert(err.message);}}
async function saveFee(){try{const d=await api("/api/admin/settings",{method:"PUT",body:JSON.stringify({deliveryFee:Number($("#deliveryFeeInput").value)})});message("#feeMessage","Delivery fee saved: "+money(d.deliveryFee));state.deliveryFee=d.deliveryFee;}catch(err){message("#feeMessage",err.message);}}

document.addEventListener("click",e=>{
 const add=e.target.closest("[data-add]");if(add)addToCart(add.dataset.add);
 const qty=e.target.closest("[data-qty]");if(qty)changeQty(qty.dataset.qty,Number(qty.dataset.change));
 const cat=e.target.closest("[data-category]");if(cat){state.category=cat.dataset.category;renderProducts();}
 const tab=e.target.closest("[data-tab]");if(tab){state.adminTab=tab.dataset.tab;document.querySelectorAll(".admin-tabs button").forEach(b=>b.classList.toggle("active",b===tab));renderAdminTab();}
 const st=e.target.closest("[data-save-status]");if(st)saveStatus(st.dataset.saveStatus);
 const edit=e.target.closest("[data-edit-product]");if(edit)api("/api/admin/products").then(ps=>productEditor(ps.find(p=>p.id===Number(edit.dataset.editProduct))));
 const close=e.target.closest("[data-close]");if(close)closeModal(close.dataset.close);
});
$("#cartOpen").addEventListener("click",openDrawer);$("#cartClose").addEventListener("click",closeDrawer);$("#drawerBackdrop").addEventListener("click",closeDrawer);
$("#checkoutOpen").addEventListener("click",openCheckout);$("#checkoutForm").addEventListener("submit",placeOrder);
$("#checkoutModal").addEventListener("click",e=>{if(e.target.id==="checkoutModal")closeModal("checkoutModal");});
$("#successModal").addEventListener("click",e=>{if(e.target.id==="successModal")closeModal("successModal");});
$("#successDone").addEventListener("click",()=>closeModal("successModal"));
$("#successTrack").addEventListener("click",()=>{const f=$("#trackForm");f.elements.orderCode.value=$("#successTrack").dataset.code;f.elements.email.value=$("#successTrack").dataset.email;closeModal("successModal");showPage("trackPage");trackOrder();});
$("#copyOrder").addEventListener("click",()=>navigator.clipboard?.writeText($("#successOrderCode").textContent));
$("#searchInput").addEventListener("input",e=>{state.search=e.target.value;renderProducts();});
$("#searchFocus").addEventListener("click",()=>{$("#searchInput").focus();$("#shop").scrollIntoView({behavior:"smooth"});});
$("#mobileMenu").addEventListener("click",()=>document.querySelector(".topbar nav").classList.toggle("open"));
document.querySelectorAll(".topbar nav a").forEach(a=>a.addEventListener("click",()=>document.querySelector(".topbar nav").classList.remove("open")));
$("#trackForm").addEventListener("submit",trackOrder);$("#adminLoginForm").addEventListener("submit",adminLogin);
$("#adminLogout").addEventListener("click",async()=>{await api("/api/admin/logout",{method:"POST"});$("#adminDashboard").classList.add("hidden");$("#adminLogin").classList.remove("hidden");});
$("#adminContent").addEventListener("click",e=>{
 if(e.target.id==="newProduct")productEditor(null);
 if(e.target.id==="cancelProduct")$("#productEditor").innerHTML="";
 if(e.target.id==="hideProduct")hideProduct();
 if(e.target.id==="refreshAdmin")renderAdminTab();
 if(e.target.id==="saveFee")saveFee();
});
$("#adminContent").addEventListener("submit",e=>{if(e.target.id==="productForm")saveProduct(e);});
document.querySelectorAll(".topbar nav a").forEach(a=>a.addEventListener("click",e=>{if(a.getAttribute("href")==="/track"){e.preventDefault();showPage("trackPage");}}));
document.querySelectorAll(".brand").forEach(a=>a.addEventListener("click",e=>{e.preventDefault();showPage(null);history.pushState({},"","/");}));
window.addEventListener("popstate",()=>{if(location.pathname==="/track")showPage("trackPage");else if(location.pathname==="/admin")showPage("adminPage");else showPage(null);});
$("#year").textContent=new Date().getFullYear();
if(location.pathname==="/track")showPage("trackPage");
if(location.pathname==="/admin"){showPage("adminPage");checkAdmin();}
loadStore();renderCart();