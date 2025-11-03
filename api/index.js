const axios = require('axios');
const qs = require('qs');
const QRCode = require('qrcode');
const pendingOrders = new Map();

const config = {
    atlanticApiKey: process.env.ATLANTIC_API_KEY || 'dviVP9oF3jnBESvJx3xMbiVwNAISQ13EWCHtASX2z1BnPgZSQ8AhFYQMkhOUGIfzILVAnVdfqUPG13oUASdt2CO567z4KUHSsvfd',
    pteroURL: process.env.PTERO_URL || 'https://api-pteroku.vercel.app',
    domain: process.env.PTERO_DOMAIN || 'http://panelprib.store-panell.my.id',
    plta: process.env.PLTA || 'ptla_gpw0WHvphZHG68ISb6XrMs1vN9GWmjNd3TcCWx5217W',
    pltc: process.env.PLTC || 'ptlc_qblwXK9lwSh58dHR7GlU76bf4XCHEc5prVsUVFQy3gD',
    botToken: process.env.BOT_TOKEN || '7504240304:AAFN7EWFS8lSn24yIw6Uz8skliPgfY6uAcY',
    adminId: process.env.ADMIN_ID || '7978512548'
};

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === 'POST' && pathname === '/api/create-order') {
      return await createOrder(req, res);
    } else if (req.method === 'GET' && pathname === '/api/check-payment') {
      return await checkPayment(req, res);
    } else if (req.method === 'GET' && pathname === '/') {
      return serveHTML(res);
    } else {
      res.status(404).json({ error: 'Not found' });
    }
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: error.message });
  }
};

async function createOrder(req, res) {
    try {
        const { type, username, telegramId, price } = req.body;
        const orderId = `ORDER_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        console.log('Creating order:', { type, username, telegramId, price, orderId });

        const payload = qs.stringify({
            api_key: config.atlanticApiKey,
            reff_id: orderId,
            nominal: price,
            type: 'ewallet',
            metode: 'qris'
        });

        console.log('Atlantic payload:', payload);

        const atlanticResponse = await axios.post(
            'https://atlantich2h.com/deposit/create',
            payload,
            { 
                headers: { 
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 30000
            }
        );

        console.log('Atlantic response status:', atlanticResponse.status);
        console.log('Atlantic response data:', JSON.stringify(atlanticResponse.data, null, 2));

        if (!atlanticResponse.data.status) {
            return res.json({ 
                success: false, 
                error: atlanticResponse.data.message || 'Gagal buat QRIS',
                details: atlanticResponse.data
            });
        }

        const atlanticData = atlanticResponse.data.data;
        
        // Cek field yang tersedia untuk QR string
        let qrString = atlanticData.qr_string || atlanticData.qr_code || atlanticData.qr;
        
        if (!qrString) {
            console.log('No QR string found, available fields:', Object.keys(atlanticData));
            // Fallback: generate dari order ID
            qrString = orderId;
        }

        const qrBuffer = await QRCode.toBuffer(qrString, {
            type: 'png',
            width: 300,
            margin: 1
        });

        const qrBase64 = qrBuffer.toString('base64');
        const qrUrl = `data:image/png;base64,${qrBase64}`;

        pendingOrders.set(orderId, {
            type,
            username,
            telegramId,
            price,
            atlanticId: atlanticData.id,
            status: 'pending',
            createdAt: Date.now(),
            qrString: qrString
        });

        cleanupExpiredOrders();

        res.json({
            success: true,
            orderId: orderId,
            qrUrl: qrUrl,
            debug: {
                atlanticId: atlanticData.id,
                qrString: qrString.substring(0, 50) + '...'
            }
        });

    } catch (error) {
        console.error('Create order error:', error.response?.data || error.message);
        res.json({ 
            success: false, 
            error: error.response?.data?.message || error.message,
            details: error.response?.data
        });
    }
}

async function checkPayment(req, res) {
    try {
        const { orderId } = req.query;
        const order = pendingOrders.get(orderId);

        if (!order) {
            return res.json({ success: false, error: 'Order tidak ditemukan' });
        }

        console.log('Checking payment for order:', orderId);

        const payload = qs.stringify({
            api_key: config.atlanticApiKey,
            id: order.atlanticId
        });

        const statusResponse = await axios.post(
            'https://atlantich2h.com/deposit/status',
            payload,
            { 
                headers: { 
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 15000
            }
        );

        console.log('Payment check response:', JSON.stringify(statusResponse.data, null, 2));

        if (statusResponse.data.status && statusResponse.data.data.status === 'success') {
            if (order.type === 'panel') {
                const panelData = {
                    username: order.username,
                    email: `${order.username}@${order.username}.com`,
                    ram: 0,  
                    disk: 0,
                    cpu: 0
                };

                console.log('Creating panel with data:', panelData);

                const pteroResponse = await axios.post(`${config.pteroURL}/create`, panelData, {
                    params: {
                        domain: config.domain,
                        plta: config.plta,
                        pltc: config.pltc
                    },
                    timeout: 30000
                });

                console.log('Ptero response:', JSON.stringify(pteroResponse.data, null, 2));

                if (pteroResponse.data.error) {
                    return res.json({ 
                        success: false, 
                        error: pteroResponse.data.error,
                        pteroResponse: pteroResponse.data
                    });
                }

                const panelResult = pteroResponse.data;
                
                order.status = 'completed';
                pendingOrders.set(orderId, order);

                res.json({
                    success: true,
                    paid: true,
                    accountInfo: {
                        username: panelResult.username,
                        password: panelResult.password,
                        panelUrl: panelResult.panel_url || config.domain,
                        serverId: panelResult.server_id
                    }
                });

            } else if (order.type === 'reseller') {
                try {
                    await axios.post(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
                        chat_id: config.adminId,
                        text: `Reseller Baru\n\nID: ${order.telegramId}\nOrder: ${orderId}\nHarga: Rp ${order.price.toLocaleString('id-ID')}\n\nAdd user ${order.telegramId} ke premium.`
                    }, { timeout: 10000 });
                } catch (tgError) {
                    console.error('Telegram notification error:', tgError);
                }

                order.status = 'completed';
                pendingOrders.set(orderId, order);

                res.json({
                    success: true,
                    paid: true
                });
            }
        } else {
            res.json({
                success: true,
                paid: false,
                status: statusResponse.data.data?.status || 'pending'
            });
        }

    } catch (error) {
        console.error('Check payment error:', error.response?.data || error.message);
        res.json({ 
            success: false, 
            error: error.response?.data?.message || error.message,
            details: error.response?.data
        });
    }
}

function cleanupExpiredOrders() {
    const now = Date.now();
    for (const [orderId, order] of pendingOrders.entries()) {
        if (now - order.createdAt > 600000) { 
            console.log('Cleaning up expired order:', orderId);
            pendingOrders.delete(orderId);
        }
    }
}

// HTML tetap sama seperti sebelumnya...
function serveHTML(res) {
  const html = `
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pterodactyl Store</title>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600&display=swap" rel="stylesheet">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Poppins', sans-serif;
        }

        body {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }

        .container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            padding: 40px;
            max-width: 400px;
            width: 100%;
            text-align: center;
        }

        .logo {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            margin: 0 auto 20px;
            background: #667eea;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 24px;
            font-weight: 600;
        }

        .logo img {
            width: 100%;
            height: 100%;
            border-radius: 50%;
            object-fit: cover;
        }

        h1 {
            color: #333;
            margin-bottom: 10px;
            font-weight: 600;
        }

        .subtitle {
            color: #666;
            margin-bottom: 30px;
            font-size: 14px;
        }

        .package {
            background: #f8f9fa;
            border-radius: 15px;
            padding: 20px;
            margin-bottom: 20px;
            cursor: pointer;
            transition: all 0.3s ease;
            border: 2px solid transparent;
        }

        .package:hover {
            border-color: #667eea;
            transform: translateY(-2px);
        }

        .package.selected {
            border-color: #667eea;
            background: #f0f4ff;
        }

        .package h3 {
            color: #333;
            margin-bottom: 5px;
            font-weight: 500;
        }

        .package .price {
            color: #667eea;
            font-size: 18px;
            font-weight: 600;
        }

        .form {
            display: none;
            text-align: left;
        }

        .form.active {
            display: block;
        }

        .input-group {
            margin-bottom: 20px;
        }

        label {
            display: block;
            margin-bottom: 5px;
            color: #333;
            font-weight: 500;
        }

        input {
            width: 100%;
            padding: 12px 15px;
            border: 2px solid #e1e5e9;
            border-radius: 10px;
            font-size: 14px;
            transition: border-color 0.3s ease;
        }

        input:focus {
            outline: none;
            border-color: #667eea;
        }

        .btn {
            background: #667eea;
            color: white;
            border: none;
            padding: 12px 20px;
            border-radius: 10px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            width: 100%;
            transition: background 0.3s ease;
        }

        .btn:hover {
            background: #5a6fd8;
        }

        .btn:disabled {
            background: #ccc;
            cursor: not-allowed;
        }

        .qr-container {
            display: none;
            text-align: center;
        }

        .qr-container.active {
            display: block;
        }

        .qr-code {
            max-width: 200px;
            margin: 20px auto;
        }

        .qr-code img {
            width: 100%;
            border-radius: 10px;
        }

        .account-info {
            display: none;
            background: #f8f9fa;
            border-radius: 15px;
            padding: 20px;
            margin-top: 20px;
            text-align: left;
        }

        .account-info.active {
            display: block;
        }

        .info-item {
            margin-bottom: 10px;
        }

        .info-item strong {
            color: #333;
        }

        .loading {
            display: none;
            text-align: center;
            margin: 20px 0;
        }

        .loading.active {
            display: block;
        }

        .spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #667eea;
            border-radius: 50%;
            width: 30px;
            height: 30px;
            animation: spin 1s linear infinite;
            margin: 0 auto 10px;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .debug-info {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            border-radius: 10px;
            padding: 10px;
            margin-top: 10px;
            font-size: 12px;
            color: #856404;
            display: none;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">
            <img src="https://github.com/Joodev65.png" alt="Logo" onerror="this.style.display='none'; this.parentNode.innerHTML='PS';">
        </div>
        
        <h1>Pterodactyl Store</h1>
        <p class="subtitle">Panel Hosting Terbaik</p>

        <div id="packageSelection">
            <div class="package" data-type="panel" onclick="selectPackage('panel')">
                <h3>Panel Unlimited</h3>
                <p class="price">Rp 5.000</p>
                <p style="color: #666; font-size: 12px; margin-top: 5px;">Create panel dengan resource unlimited</p>
            </div>
            
            <div class="package" data-type="reseller" onclick="selectPackage('reseller')">
                <h3>Reseller Panel</h3>
                <p class="price">Rp 8.000</p>
                <p style="color: #666; font-size: 12px; margin-top: 5px;">Akses create panel unlimited</p>
            </div>
        </div>

        <div id="usernameForm" class="form">
            <div class="input-group">
                <label for="username">Username</label>
                <input type="text" id="username" placeholder="Masukkan username" required>
            </div>
            <button class="btn" onclick="processOrder()">Beli Sekarang</button>
        </div>

        <div id="resellerForm" class="form">
            <div class="input-group">
                <label for="telegramId">ID Telegram</label>
                <input type="number" id="telegramId" placeholder="Contoh: 123456789" required>
            </div>
            <button class="btn" onclick="processReseller()">Beli Reseller</button>
        </div>

        <div id="loading" class="loading">
            <div class="spinner"></div>
            <p>Memproses pembayaran...</p>
        </div>

        <div id="qrContainer" class="qr-container">
            <h3>Scan QR Code</h3>
            <p>Scan QR code berikut untuk pembayaran</p>
            <div class="qr-code" id="qrCode"></div>
            <p style="color: #666; font-size: 12px; margin-top: 10px;">Batas waktu: 10 menit</p>
            <button class="btn" onclick="checkPayment()" id="checkBtn">Cek Status Pembayaran</button>
            <div class="debug-info" id="debugInfo"></div>
        </div>

        <div id="accountInfo" class="account-info">
            <h3>Panel Berhasil Dibuat!</h3>
            <div class="info-item"><strong>Username:</strong> <span id="infoUsername"></span></div>
            <div class="info-item"><strong>Password:</strong> <span id="infoPassword"></span></div>
            <div class="info-item"><strong>Panel URL:</strong> <span id="infoUrl"></span></div>
            <div class="info-item"><strong>Server ID:</strong> <span id="infoServerId"></span></div>
            <button class="btn" onclick="location.reload()" style="margin-top: 15px;">Beli Lagi</button>
        </div>
    </div>

    <script>
        let selectedPackage = '';
        let currentOrderId = '';

        function selectPackage(type) {
            selectedPackage = type;
            
            document.querySelectorAll('.package').forEach(pkg => {
                pkg.classList.remove('selected');
            });
            
            event.currentTarget.classList.add('selected');
            
            document.getElementById('packageSelection').style.display = 'none';
            
            if (type === 'panel') {
                document.getElementById('usernameForm').classList.add('active');
            } else if (type === 'reseller') {
                document.getElementById('resellerForm').classList.add('active');
            }
        }

        async function processOrder() {
            const username = document.getElementById('username').value.trim();
            
            if (!username) {
                alert('Masukkan username terlebih dahulu');
                return;
            }

            if (username.length < 3) {
                alert('Username minimal 3 karakter');
                return;
            }

            document.getElementById('usernameForm').classList.remove('active');
            document.getElementById('loading').classList.add('active');

            try {
                const response = await fetch('/api/create-order', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        type: 'panel',
                        username: username,
                        price: 5000
                    })
                });

                const data = await response.json();

                if (data.success) {
                    currentOrderId = data.orderId;
                    showQRCode(data.qrUrl);
                    if (data.debug) {
                        document.getElementById('debugInfo').innerHTML = 'Order ID: ' + data.orderId + '<br>Atlantic ID: ' + data.debug.atlanticId;
                        document.getElementById('debugInfo').style.display = 'block';
                    }
                } else {
                    alert('Error: ' + data.error + (data.details ? '\n' + JSON.stringify(data.details) : ''));
                    location.reload();
                }
            } catch (error) {
                alert('Terjadi error: ' + error.message);
                location.reload();
            } finally {
                document.getElementById('loading').classList.remove('active');
            }
        }

        async function processReseller() {
            const telegramId = document.getElementById('telegramId').value.trim();
            
            if (!telegramId) {
                alert('Masukkan ID Telegram terlebih dahulu');
                return;
            }

            document.getElementById('resellerForm').classList.remove('active');
            document.getElementById('loading').classList.add('active');

            try {
                const response = await fetch('/api/create-order', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        type: 'reseller',
                        telegramId: telegramId,
                        price: 8000
                    })
                });

                const data = await response.json();

                if (data.success) {
                    currentOrderId = data.orderId;
                    showQRCode(data.qrUrl);
                    if (data.debug) {
                        document.getElementById('debugInfo').innerHTML = 'Order ID: ' + data.orderId + '<br>Atlantic ID: ' + data.debug.atlanticId;
                        document.getElementById('debugInfo').style.display = 'block';
                    }
                } else {
                    alert('Error: ' + data.error + (data.details ? '\n' + JSON.stringify(data.details) : ''));
                    location.reload();
                }
            } catch (error) {
                alert('Terjadi error: ' + error.message);
                location.reload();
            } finally {
                document.getElementById('loading').classList.remove('active');
            }
        }

        function showQRCode(qrUrl) {
            document.getElementById('qrCode').innerHTML = '<img src="' + qrUrl + '" alt="QR Code">';
            document.getElementById('qrContainer').classList.add('active');
        }

        async function checkPayment() {
            if (!currentOrderId) return;

            document.getElementById('checkBtn').disabled = true;
            document.getElementById('checkBtn').textContent = 'Mengecek...';

            try {
                const response = await fetch('/api/check-payment?orderId=' + currentOrderId);
                const data = await response.json();

                if (data.success) {
                    if (data.paid) {
                        if (selectedPackage === 'panel') {
                            showAccountInfo(data.accountInfo);
                        } else {
                            document.getElementById('qrContainer').classList.remove('active');
                            alert('Pembayaran berhasil! Akses reseller telah diaktifkan.');
                            location.reload();
                        }
                    } else {
                        alert('Pembayaran belum diterima. Status: ' + (data.status || 'pending'));
                    }
                } else {
                    alert('Error: ' + data.error + (data.details ? '\n' + JSON.stringify(data.details) : ''));
                }
            } catch (error) {
                alert('Terjadi error: ' + error.message);
            } finally {
                document.getElementById('checkBtn').disabled = false;
                document.getElementById('checkBtn').textContent = 'Cek Status Pembayaran';
            }
        }

        function showAccountInfo(accountInfo) {
            document.getElementById('qrContainer').classList.remove('active');
            document.getElementById('infoUsername').textContent = accountInfo.username;
            document.getElementById('infoPassword').textContent = accountInfo.password;
            document.getElementById('infoUrl').textContent = accountInfo.panelUrl;
            document.getElementById('infoServerId').textContent = accountInfo.serverId;
            document.getElementById('accountInfo').classList.add('active');
        }

        setInterval(() => {
            if (currentOrderId && document.getElementById('qrContainer').classList.contains('active')) {
                checkPayment();
            }
        }, 10000);
    </script>
</body>
</html>
  `;

  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(html);
}
