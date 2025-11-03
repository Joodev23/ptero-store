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

async function createOrder(req, res) {
    try {
        const { type, username, telegramId, price } = req.body;
        const orderId = `ORDER_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const payload = qs.stringify({
            api_key: config.atlanticApiKey,
            reff_id: orderId,
            nominal: price,
            type: 'ewallet',
            metode: 'qris'
        });

        const atlanticResponse = await axios.post(
            'https://atlantich2h.com/deposit/create',
            payload,
            { 
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 30000
            }
        );

        if (!atlanticResponse.data.status) {
            return res.json({ success: false, error: atlanticResponse.data.message });
        }

        const atlanticData = atlanticResponse.data.data;
        
        const qrBuffer = await QRCode.toBuffer(atlanticData.qr_string, {
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
            createdAt: Date.now()
        });

        cleanupExpiredOrders();

        res.json({
            success: true,
            orderId: orderId,
            qrUrl: qrUrl
        });

    } catch (error) {
        console.error('Create order error:', error);
        res.json({ success: false, error: error.message });
    }
}

async function checkPayment(req, res) {
    try {
        const { orderId } = req.query;
        const order = pendingOrders.get(orderId);

        if (!order) {
            return res.json({ success: false, error: 'Order tidak ditemukan' });
        }

        const payload = qs.stringify({
            api_key: config.atlanticApiKey,
            id: order.atlanticId
        });

        const statusResponse = await axios.post(
            'https://atlantich2h.com/deposit/status',
            payload,
            { 
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 15000
            }
        );

        if (statusResponse.data.status && statusResponse.data.data.status === 'success') {
            if (order.type === 'panel') {
                const panelData = {
                    username: order.username,
                    email: `${order.username}@${order.username}.com`,
                    ram: 0,  
                    disk: 0,
                    cpu: 0
                };

                const pteroResponse = await axios.post(`${config.pteroURL}/create`, panelData, {
                    params: {
                        domain: config.domain,
                        plta: config.plta,
                        pltc: config.pltc
                    },
                    timeout: 30000
                });

                if (pteroResponse.data.error) {
                    return res.json({ success: false, error: pteroResponse.data.error });
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
                        text: `🆕 Reseller Baru\n\nID: ${order.telegramId}\nOrder: ${orderId}\nHarga: Rp ${order.price.toLocaleString('id-ID')}\n\nAdd user ${order.telegramId} ke premium.`
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
                paid: false
            });
        }

    } catch (error) {
        console.error('Check payment error:', error);
        res.json({ success: false, error: error.message });
    }
}

function cleanupExpiredOrders() {
    const now = Date.now();
    for (const [orderId, order] of pendingOrders.entries()) {
        if (now - order.createdAt > 600000) { 
            pendingOrders.delete(orderId);
        }
    }
}

module.exports = {
    createOrder,
    checkPayment
};