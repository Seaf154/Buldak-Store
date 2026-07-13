// Firebase configuration credentials
const firebaseConfig = {
    apiKey: "AIzaSyBWvTU55d_6ucg9_XzHObisuGxGQmWSaXQ",
    authDomain: "buldak-store.firebaseapp.com",
    projectId: "buldak-store",
    storageBucket: "buldak-store.firebasestorage.app",
    messagingSenderId: "364517042965",
    appId: "1:364517042965:web:c62752c49f6b8760d4171c"
};

// Initialize Firebase SDK
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();
const auth = firebase.auth && firebase.auth();

// Global state variables
let products = [];
let cart = [];
let orders = [];
let editProductId = null; 
let currentCategoryFilter = 'all'; 
let showingWishlistOnly = false;
let appliedPromoDiscount = 0; 
let activeProductForRating = null;
const managerWhatsAppNumber = "201206630864"; 

// Current User State
let currentUser = null;
let userWishlist = [];

// Initialize local cart ID for persistence
let cartId = localStorage.getItem('snacks_store_cart_id');
if (!cartId) {
    cartId = 'cart_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    try { localStorage.setItem('snacks_store_cart_id', cartId); } catch (e) {}
}

// --- Auth State Listener ---
if (auth) {
    auth.onAuthStateChanged(user => {
        currentUser = user;
        const authBtn = document.getElementById('auth-btn');
        const greeting = document.getElementById('user-greeting');
        
        if (user) {
            if (authBtn) {
                authBtn.innerText = "Logout";
                authBtn.onclick = () => auth.signOut();
            }
            if (greeting) {
                greeting.style.display = 'inline-block';
                greeting.innerText = `Hello, ${user.email.split('@')[0]}`;
            }
            fetchUserWishlist();
        } else {
            if (authBtn) {
                authBtn.innerText = "Login / Register";
                authBtn.onclick = openCustomerModal;
            }
            if (greeting) greeting.style.display = 'none';
            userWishlist = [];
            if (document.getElementById('client-products')) filterAndSearchProducts();
        }
    });
}

// --- Firestore Listeners ---

// Products Listener
db.collection('products').onSnapshot((snapshot) => {
    products = [];
    snapshot.forEach((doc) => {
        products.push({ firebaseId: doc.id, ...doc.data() });
    });
    
    const spinner = document.getElementById('loading-spinner');
    if (spinner) spinner.style.display = 'none';

    if (document.getElementById('client-products')) filterAndSearchProducts();
    if (document.getElementById('admin-products')) {
        displayAdminProducts();
        updateAdminDashboardStats();
    }
}, (error) => console.error("Error fetching products: ", error));

// Cart Listener
db.collection('carts').doc(cartId).onSnapshot((doc) => {
    cart = doc.exists ? (doc.data().items || []) : [];
    updateCartBadge();
    if (document.getElementById('cart-items-list')) displayCartPage();
});

// Orders Listener (Admin Only)
if (document.getElementById('admin-orders-list')) {
    db.collection('orders').orderBy('timestamp', 'desc').onSnapshot((snapshot) => {
        orders = [];
        snapshot.forEach((doc) => orders.push({ id: doc.id, ...doc.data() }));
        displayAdminOrders();
        updateAdminDashboardStats();
    });
}

// --- Customer Auth Logic ---
let isLoginMode = true;

function openCustomerModal() {
    isLoginMode = true;
    updateAuthModalUI();
    document.getElementById('customer-login-modal').style.display = 'block';
}

function switchAuthMode() {
    isLoginMode = !isLoginMode;
    updateAuthModalUI();
}

function updateAuthModalUI() {
    document.getElementById('auth-modal-title').innerText = isLoginMode ? "Customer Login" : "Create Account";
    document.getElementById('auth-action-btn').innerText = isLoginMode ? "Login" : "Register";
    document.querySelector('.auth-switch').innerHTML = isLoginMode ? "Don't have an account? <span onclick='switchAuthMode()'>Register here</span>" : "Already have an account? <span onclick='switchAuthMode()'>Login here</span>";
    document.getElementById('auth-error').innerText = "";
}

function handleCustomerAuth() {
    const email = document.getElementById('customer-email').value.trim();
    const password = document.getElementById('customer-password').value.trim();
    const errorMsg = document.getElementById('auth-error');

    if (!email || !password) {
        errorMsg.innerText = "Please fill all fields.";
        return;
    }

    const authPromise = isLoginMode 
        ? auth.signInWithEmailAndPassword(email, password)
        : auth.createUserWithEmailAndPassword(email, password);

    authPromise.then(() => {
        closeModal('customer-login-modal');
        showToast(isLoginMode ? "Logged in successfully!" : "Account created successfully!");
    }).catch(err => {
        errorMsg.innerText = err.message;
    });
}

// --- Wishlist Logic ---
function fetchUserWishlist() {
    if (!currentUser) return;
    db.collection('users').doc(currentUser.uid).onSnapshot(doc => {
        if (doc.exists) {
            userWishlist = doc.data().wishlist || [];
        } else {
            userWishlist = [];
        }
        if (document.getElementById('client-products')) filterAndSearchProducts();
    });
}

function toggleWishlist(productId) {
    if (!currentUser) {
        alert("Please login to add items to your wishlist!");
        openCustomerModal();
        return;
    }

    const index = userWishlist.indexOf(productId);
    if (index > -1) {
        userWishlist.splice(index, 1);
        showToast("Removed from wishlist");
    } else {
        userWishlist.push(productId);
        showToast("Added to wishlist ❤️");
    }

    db.collection('users').doc(currentUser.uid).set({ wishlist: userWishlist }, { merge: true });
}

function toggleWishlistView() {
    showingWishlistOnly = !showingWishlistOnly;
    const btn = document.getElementById('wishlist-toggle-btn');
    btn.style.backgroundColor = showingWishlistOnly ? "#d9534f" : "var(--secondary-color)";
    filterAndSearchProducts();
}

// --- Admin Panel Logic (Products) ---

function addProduct() {
    const name = document.getElementById("product-name").value.trim();
    const price = document.getElementById("product-price").value;
    const discount = document.getElementById("product-discount").value;
    const category = document.getElementById("product-category").value;
    const fileInput = document.getElementById("product-image");
    const submitBtn = document.querySelector(".admin-form button");

    if (!name || !price) {
        alert("Please fill in all required fields.");
        return;
    }

    const dataToSave = {
        name: name,
        price: parseFloat(price),
        discount: parseFloat(discount) || 0,
        category: category,
        ratings: [] // Initialize empty ratings
    };

    if (fileInput.files && fileInput.files.length > 0) {
        submitBtn.disabled = true;
        submitBtn.innerText = "Processing Image...";

        const file = fileInput.files[0];
        const reader = new FileReader();

        reader.onload = function(event) {
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement("canvas");
                const maxDimension = 400; 
                let width = img.width, height = img.height;

                if (width > maxDimension) { height *= maxDimension / width; width = maxDimension; }
                canvas.width = width; canvas.height = height;
                
                const ctx = canvas.getContext("2d");
                ctx.imageSmoothingEnabled = true;
                ctx.drawImage(img, 0, 0, width, height);

                dataToSave.image = canvas.toDataURL("image/jpeg", 0.50);
                executeSave(dataToSave, submitBtn);
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    } else {
        if (editProductId) { executeSave(dataToSave, submitBtn); } 
        else { alert("Please select an image for the new product."); }
    }
}

function executeSave(data, submitBtn) {
    if (editProductId) {
        db.collection("products").doc(editProductId).update(data)
        .then(() => { alert("Product updated!"); resetAdminForm(submitBtn); })
        .catch(err => { alert("Error: " + err); submitBtn.disabled = false; });
    } else {
        data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        db.collection("products").add(data)
        .then(() => { alert("Product added!"); resetAdminForm(submitBtn); })
        .catch(err => { alert("Error: " + err); submitBtn.disabled = false; });
    }
}

function editProduct(productId) {
    const p = products.find(prod => prod.firebaseId === productId);
    if (!p) return;
    editProductId = productId;
    document.getElementById("product-name").value = p.name;
    document.getElementById("product-price").value = p.price;
    document.getElementById("product-discount").value = p.discount || 0;
    document.getElementById("product-category").value = p.category;
    document.querySelector(".admin-form button").innerText = "Update Product";
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetAdminForm(submitBtn) {
    editProductId = null;
    document.getElementById("product-name").value = "";
    document.getElementById("product-price").value = "";
    document.getElementById("product-discount").value = "";
    document.getElementById("product-image").value = "";
    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = "Save Product"; }
}

function deleteProduct(productId) {
    if (confirm("Are you sure you want to delete this product?")) {
        db.collection('products').doc(productId).delete();
    }
}

function displayAdminProducts() {
    const container = document.getElementById('admin-products');
    if (!container) return;
    container.innerHTML = products.map(p => `
        <div class="product-card">
            <img src="${p.image}" class="product-image" loading="lazy">
            <h3>${p.name}</h3>
            <p class="price">${p.price} EGP</p>
            <div style="display: flex; gap: 10px; justify-content: center; margin-top: 10px;">
                <button onclick="editProduct('${p.firebaseId}')" style="background-color: #f0ad4e; padding: 8px;">Edit</button>
                <button onclick="deleteProduct('${p.firebaseId}')" style="background-color: #d9534f; padding: 8px;">Delete</button>
            </div>
        </div>
    `).join('');
}

// --- Admin Panel Logic (Orders & Dashboard) ---

function displayAdminOrders() {
    const tbody = document.getElementById('admin-orders-list');
    if (!tbody) return;
    
    tbody.innerHTML = orders.map(order => `
        <tr>
            <td>${order.id.substring(0,8)}...</td>
            <td>${order.items.map(i => `${i.name} (x${i.quantity})`).join(', ')}</td>
            <td>${order.totalPrice} EGP</td>
            <td>
                <select onchange="updateOrderStatus('${order.id}', this.value)" class="status-select ${order.status.toLowerCase()}">
                    <option value="Pending" ${order.status === 'Pending' ? 'selected' : ''}>Pending</option>
                    <option value="Shipped" ${order.status === 'Shipped' ? 'selected' : ''}>Shipped</option>
                    <option value="Delivered" ${order.status === 'Delivered' ? 'selected' : ''}>Delivered</option>
                    <option value="Cancelled" ${order.status === 'Cancelled' ? 'selected' : ''}>Cancelled</option>
                </select>
            </td>
            <td><button onclick="deleteOrder('${order.id}')" class="delete-btn">Drop</button></td>
        </tr>
    `).join('');
}

function updateOrderStatus(orderId, newStatus) {
    db.collection('orders').doc(orderId).update({ status: newStatus })
    .then(() => showToast("Order status updated!"));
}

function deleteOrder(orderId) {
    if(confirm("Delete this order record forever?")) {
        db.collection('orders').doc(orderId).delete();
    }
}

let adminChart = null;
function updateAdminDashboardStats() {
    const totalOrdersEl = document.getElementById('stat-total-orders');
    const totalRevEl = document.getElementById('stat-total-revenue');
    const totalProdEl = document.getElementById('stat-total-products');
    
    if(!totalOrdersEl) return;

    totalOrdersEl.innerText = orders.length;
    totalProdEl.innerText = products.length;
    
    const revenue = orders.filter(o => o.status !== 'Cancelled').reduce((acc, curr) => acc + curr.totalPrice, 0);
    totalRevEl.innerText = revenue.toFixed(2) + " EGP";

    // Update Chart
    const ctx = document.getElementById('revenueChart');
    if(ctx) {
        // Group orders by status for the chart
        const statusCounts = { Pending: 0, Shipped: 0, Delivered: 0, Cancelled: 0 };
        orders.forEach(o => { if(statusCounts[o.status] !== undefined) statusCounts[o.status]++; });

        if(adminChart) adminChart.destroy();
        adminChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Pending', 'Shipped', 'Delivered', 'Cancelled'],
                datasets: [{
                    data: Object.values(statusCounts),
                    backgroundColor: ['#f0ad4e', '#5bc0de', '#5cb85c', '#d9534f'],
                    borderWidth: 1,
                    borderColor: '#1e1e1e'
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#fff' } } } }
        });
    }
}


// --- Client Logic (Search, Filter, Wishlist, Details) ---

function filterProducts(category) { 
    currentCategoryFilter = category;
    filterAndSearchProducts();
}

function filterAndSearchProducts() {
    const container = document.getElementById('client-products');
    if (!container) return;

    const searchInput = document.getElementById('search-input');
    const sortInput = document.getElementById('price-sort');
    
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
    const sortOrder = sortInput ? sortInput.value : 'default';

    let filtered = currentCategoryFilter === 'all' ? products : products.filter(p => p.category === currentCategoryFilter);
    
    if (showingWishlistOnly) {
        filtered = filtered.filter(p => userWishlist.includes(p.firebaseId));
    }

    if (searchTerm) {
        filtered = filtered.filter(p => p.name.toLowerCase().includes(searchTerm));
    }

    if (sortOrder === 'low') filtered.sort((a, b) => a.price - b.price);
    else if (sortOrder === 'high') filtered.sort((a, b) => b.price - a.price);

    container.innerHTML = filtered.map(p => {
        const isWished = userWishlist.includes(p.firebaseId);
        // Calculate average rating
        const avgRating = p.ratings && p.ratings.length > 0 ? (p.ratings.reduce((a,b)=>a+b,0) / p.ratings.length).toFixed(1) : 'New';
        
        return `
        <div class="product-card">
            <div class="wishlist-btn ${isWished ? 'active' : ''}" onclick="toggleWishlist('${p.firebaseId}')">❤️</div>
            <img src="${p.image}" class="product-image" loading="lazy" onclick="openProductDetails('${p.firebaseId}')" style="cursor: pointer;">
            <h3 onclick="openProductDetails('${p.firebaseId}')" style="cursor: pointer;">${p.name}</h3>
            <div style="color: #f1c40f; margin-bottom: 5px;">★ ${avgRating}</div>
            <p class="price">${p.price} EGP</p>
            <button onclick="addItemToCart('${p.firebaseId}')">Add to Cart</button>
        </div>
    `}).join('');
}

function openProductDetails(productId) {
    const p = products.find(prod => prod.firebaseId === productId);
    if (!p) return;
    
    activeProductForRating = productId;

    document.getElementById('detail-image').src = p.image;
    document.getElementById('detail-name').innerText = p.name;
    document.getElementById('detail-category').innerText = "Category: " + p.category;
    document.getElementById('detail-price').innerText = p.price + " EGP";
    
    // Display Rating
    const avgRating = p.ratings && p.ratings.length > 0 ? (p.ratings.reduce((a,b)=>a+b,0) / p.ratings.length).toFixed(1) : 'No ratings yet';
    document.getElementById('average-rating-display').innerText = `Average Rating: ${avgRating} / 5`;
    
    // Reset stars UI
    const stars = document.getElementById('detail-stars').children;
    for(let i=0; i<5; i++) stars[i].style.color = '#555';

    document.getElementById('detail-add-btn').onclick = function() {
        addItemToCart(p.firebaseId);
        closeModal('product-details-modal');
    };

    document.getElementById('product-details-modal').style.display = 'block';
}

function submitRating(ratingValue) {
    if(!activeProductForRating) return;
    const p = products.find(prod => prod.firebaseId === activeProductForRating);
    
    // Visual update
    const stars = document.getElementById('detail-stars').children;
    for(let i=0; i<5; i++) {
        stars[i].style.color = i < ratingValue ? '#f1c40f' : '#555';
    }

    // Save to Firestore
    const currentRatings = p.ratings || [];
    currentRatings.push(ratingValue);
    
    db.collection('products').doc(activeProductForRating).update({ ratings: currentRatings })
    .then(() => {
        document.getElementById('average-rating-display').innerText = "Thank you for rating!";
    });
}

// --- Cart & Checkout Logic ---

function updateCartBadge() {
    const badge = document.getElementById('cart-badge-count');
    if (badge) badge.innerText = cart.reduce((acc, item) => acc + item.quantity, 0);
}

function addItemToCart(productId) {
    const p = products.find(prod => prod.firebaseId === productId);
    const existing = cart.find(item => item.id === productId);
    
    if (existing) existing.quantity += 1;
    else cart.push({ id: p.firebaseId, name: p.name, price: p.price, image: p.image, quantity: 1 });

    db.collection('carts').doc(cartId).set({ items: cart }).then(() => showToast("Added to cart! 🛒"));
}

function changeItemQuantity(productId, modifier) {
    const item = cart.find(i => i.id === productId);
    if (!item) return;
    item.quantity += modifier;
    if (item.quantity <= 0) cart = cart.filter(i => i.id !== productId);
    db.collection('carts').doc(cartId).set({ items: cart });
}

function removeItemFromCart(id) {
    cart = cart.filter(item => item.id !== id);
    db.collection('carts').doc(cartId).set({ items: cart });
}

function applyPromoCode() {
    const input = document.getElementById('promo-input').value.trim().toUpperCase();
    const msg = document.getElementById('promo-message');
    
    if (input === 'BULDAK20') {
        appliedPromoDiscount = 0.20; // 20% off
        msg.innerText = "20% Discount Applied!";
        msg.style.color = "#80cbc4";
    } else {
        appliedPromoDiscount = 0;
        msg.innerText = "Invalid Promo Code.";
        msg.style.color = "#d9534f";
    }
    displayCartPage();
}

function displayCartPage() {
    const list = document.getElementById('cart-items-list');
    const totalEl = document.getElementById('cart-total-amount');
    if (!list) return;

    if (cart.length === 0) {
        list.innerHTML = '<p style="text-align: center; color: #7f8c8d; padding: 40px 0;">Cart is empty.</p>';
        totalEl.innerText = '0';
        return;
    }

    list.innerHTML = cart.map(item => `
        <div class="cart-item">
            <div class="cart-item-info">
                <img src="${item.image}" class="cart-item-img">
                <div>
                    <h3 style="margin: 0;">${item.name}</h3>
                    <p style="margin: 5px 0; color: #80cbc4;">${item.price} EGP</p>
                </div>
            </div>
            <div class="cart-controls">
                <button onclick="changeItemQuantity('${item.id}', -1)">-</button>
                <span>${item.quantity}</span>
                <button onclick="changeItemQuantity('${item.id}', 1)">+</button>
                <button class="delete-btn" onclick="removeItemFromCart('${item.id}')">X</button>
            </div>
        </div>
    `).join('');

    let subtotal = cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);
    let finalTotal = subtotal - (subtotal * appliedPromoDiscount);
    
    if (appliedPromoDiscount > 0) {
        totalEl.innerHTML = `<span style="text-decoration: line-through; color: #888; font-size: 0.7em;">${subtotal}</span> ${finalTotal.toFixed(2)}`;
    } else {
        totalEl.innerText = finalTotal.toFixed(2);
    }
}

function sendOrderViaWhatsApp() {
    if (cart.length === 0) return;
    
    let subtotal = cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);
    let finalTotal = subtotal - (subtotal * appliedPromoDiscount);

    // 1. Save Order to Firestore
    const orderData = {
        items: cart,
        totalPrice: finalTotal,
        status: "Pending",
        userId: currentUser ? currentUser.uid : "Guest",
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };

    db.collection("orders").add(orderData).then((docRef) => {
        // 2. Clear Cart
        db.collection('carts').doc(cartId).set({ items: [] });
        
        // 3. Open WhatsApp
        let orderDetails = `🛒 *New Order [ID: ${docRef.id.substring(0,6)}]* 🛒\n\n`;
        cart.forEach(item => { orderDetails += `• ${item.name} (x${item.quantity}) - ${item.price * item.quantity} EGP\n`; });
        if(appliedPromoDiscount > 0) orderDetails += `\n🎟️ Discount Applied: ${appliedPromoDiscount * 100}%`;
        orderDetails += `\n💰 *Total Amount:* ${finalTotal.toFixed(2)} EGP`;
        
        window.open(`https://wa.me/${managerWhatsAppNumber}?text=${encodeURIComponent(orderDetails)}`, '_blank');
    }).catch(err => console.error("Order creation failed", err));
}

// --- Utils & Modals ---

function openAdminModal() { document.getElementById('admin-login-modal').style.display = 'block'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

function verifyAdminPassword() {
    if (document.getElementById('admin-password-input').value === "1012010") {
        sessionStorage.setItem("buldak_admin_auth", "secured");
        window.location.href = "admin.html";
    } else {
        alert("Wrong Password!");
    }
}

function showToast(msg) {
    const toast = document.getElementById("toast-message");
    if (toast) {
        toast.innerText = msg;
        toast.className = "toast show";
        setTimeout(() => { toast.className = toast.className.replace("show", ""); }, 3000);
    }
}

function togglePromoSection() {
    const container = document.getElementById('promo-input-container');
    const btn = document.getElementById('promo-toggle-btn');
    
    if (container.style.display === "none") {
        container.style.display = "block";
        btn.innerText = "Hide Promo Code";
    } else {
        container.style.display = "none";
        btn.innerText = "Have a Promo Code?";
    }
}

// --- Theme Toggle Logic (Dark/Light Mode) ---
function toggleTheme() {
    const body = document.body;
    body.classList.toggle('light-mode');
    
    // Save user preference to localStorage
    const isLight = body.classList.contains('light-mode');
    localStorage.setItem('buldak_theme', isLight ? 'light' : 'dark');
    
    updateThemeIcon(isLight);
}

function updateThemeIcon(isLight) {
    const themeBtns = document.querySelectorAll('.theme-toggle-btn');
    themeBtns.forEach(btn => {
        btn.innerText = isLight ? '🌙' : '☀️';
    });
}

// Apply the saved theme when the page loads
document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('buldak_theme');
    if (savedTheme === 'light') {
        document.body.classList.add('light-mode');
        updateThemeIcon(true);
    } else {
        updateThemeIcon(false);
    }
});