// ═══════════════════════════════════════════════════════════════════
// LOCKET GOLD — CLOUDFLARE WORKER
// Bao gồm: Auth (Google), Balance, Recharge, QR Proxy, Webhook
// ═══════════════════════════════════════════════════════════════════

// ═══ CORS ═══
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
};

// ═══ HELPER ═══
function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            ...CORS_HEADERS
        }
    });
}

function errorResponse(message, status = 400) {
    return jsonResponse({ success: false, message }, status);
}

// ═══ DECODE JWT ═══
function decodeJWT(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(
            atob(base64).split('').map(c =>
                '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
            ).join('')
        );
        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════
// MAIN FETCH HANDLER
// ═══════════════════════════════════════════════════════════════════
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        // ═══ CORS Preflight ═══
        if (method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        try {
            // ═══════════════════════════════════════════════════════
            // ROUTE 1: GET /api/qr — Proxy ảnh QR từ vietqr.app
            // ═══════════════════════════════════════════════════════
            if (path === '/api/qr' && method === 'GET') {
                return await handleQR(url, env);
            }

            // ═══════════════════════════════════════════════════════
            // ROUTE 2: POST /api/recharge/create
            // ═══════════════════════════════════════════════════════
            if (path === '/api/recharge/create' && method === 'POST') {
                return await handleCreateRecharge(request, env);
            }

            // ═══════════════════════════════════════════════════════
            // ROUTE 3: GET /api/recharge/check
            // ═══════════════════════════════════════════════════════
            if (path === '/api/recharge/check' && method === 'GET') {
                return await handleCheckRecharge(url, env);
            }

            // ═══════════════════════════════════════════════════════
            // ROUTE 4: POST /api/recharge/cancel
            // ═══════════════════════════════════════════════════════
            if (path === '/api/recharge/cancel' && method === 'POST') {
                return await handleCancelRecharge(request, env);
            }

            // ═══════════════════════════════════════════════════════
            // ROUTE 5: POST /api/webhook/bank — Nhận từ Casso/Sepay
            // ═══════════════════════════════════════════════════════
            if (path === '/api/webhook/bank' && method === 'POST') {
                return await handleBankWebhook(request, env);
            }

            // ═══════════════════════════════════════════════════════
            // ROUTE 6: GET /api/balance — Lấy số dư
            // ═══════════════════════════════════════════════════════
            if (path === '/api/balance' && method === 'GET') {
                return await handleGetBalance(url, env);
            }

            // ═══════════════════════════════════════════════════════
            // ROUTE 7: POST /api/auth/google — Verify token (nếu có)
            // ═══════════════════════════════════════════════════════
            if (path === '/api/auth/google' && method === 'POST') {
                return await handleGoogleAuth(request, env);
            }

            // ═══ 404 ═══
            return errorResponse('Route not found: ' + path, 404);

        } catch (err) {
            console.error('❌ Server error:', err);
            return errorResponse('Lỗi server: ' + err.message, 500);
        }
    }
};

// ═══════════════════════════════════════════════════════════════════
// HANDLER 1: PROXY QR
// ═══════════════════════════════════════════════════════════════════
async function handleQR(url, env) {
    const amount = url.searchParams.get('amount') || '0';
    const content = url.searchParams.get('content') || '';

    if (!env.VIETQR_API_KEY) {
        return errorResponse('VIETQR_API_KEY chưa cấu hình. Chạy: wrangler secret put VIETQR_API_KEY', 500);
    }

    if (!amount || parseInt(amount) < 1000) {
        return errorResponse('Số tiền không hợp lệ');
    }

    // Build URL tới vietqr.app
    const qrParams = new URLSearchParams({
        bank: env.BANK_ID || 'ACB',
        acc: env.BANK_ACC || '7898211',
        template: 'compact',
        showinfo: 'true',
        fullacc: 'true',
        holder: env.BANK_HOLDER || 'TRAN NHAT PHUC',
        store: env.BANK_STORE || 'Hệ Thống Locket Gold',
        amount: amount,
        addInfo: content,
        apiKey: env.VIETQR_API_KEY // ← Key ẩn ở server
    });

    const baseUrl = env.VIETQR_BASE_URL || 'https://vietqr.app/img';
    const qrUrl = `${baseUrl}?${qrParams.toString()}`;

    console.log('🔗 Fetching QR:', qrUrl.replace(env.VIETQR_API_KEY, '***'));

    try {
        const res = await fetch(qrUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 LocketGold/1.0',
                'Accept': 'image/png,image/*,*/*'
            },
            cf: {
                cacheTtl: 300,
                cacheEverything: true
            }
        });

        if (!res.ok) {
            const errText = await res.text();
            console.error('VietQR error:', res.status, errText);
            return errorResponse('Không thể tạo QR: ' + res.status, 502);
        }

        const imageBuffer = await res.arrayBuffer();
        return new Response(imageBuffer, {
            status: 200,
            headers: {
                'Content-Type': res.headers.get('Content-Type') || 'image/png',
                'Cache-Control': 'public, max-age=300',
                'Access-Control-Allow-Origin': '*'
            }
        });

    } catch (err) {
        console.error('QR fetch error:', err);
        return errorResponse('Lỗi fetch QR: ' + err.message, 500);
    }
}

// ═══════════════════════════════════════════════════════════════════
// HANDLER 2: TẠO ĐƠN NẠP
// ═══════════════════════════════════════════════════════════════════
async function handleCreateRecharge(request, env) {
    try {
        const body = await request.json();
        const { email, username, amount, content, orderCode } = body;

        // Validate
        if (!email || !username || !amount || !orderCode) {
            return errorResponse('Thiếu thông tin bắt buộc');
        }

        const amountNum = parseInt(amount);
        if (amountNum < 10000 || amountNum > 500000000) {
            return errorResponse('Số tiền không hợp lệ (10K - 500M)');
        }

        // Tạo order object
        const order = {
            orderCode,
            email: email.toLowerCase(),
            username: username.toLowerCase(),
            amount: amountNum,
            content,
            status: 'pending',
            createdAt: Date.now(),
            expiresAt: Date.now() + 20 * 60 * 1000
        };

        // Lưu vào KV (TTL 20 phút)
        if (env.RECHARGE_KV) {
            await env.RECHARGE_KV.put(
                'order:' + orderCode,
                JSON.stringify(order), { expirationTtl: 1200 }
            );

            // Lưu index theo username để webhook tìm nhanh
            const indexKey = 'index:' + username.toLowerCase();
            let index = [];
            try {
                const raw = await env.RECHARGE_KV.get(indexKey);
                if (raw) index = JSON.parse(raw);
            } catch (e) {}

            index.unshift(orderCode);
            if (index.length > 20) index = index.slice(0, 20);

            await env.RECHARGE_KV.put(
                indexKey,
                JSON.stringify(index), { expirationTtl: 1800 }
            );

            console.log('✅ Đã tạo đơn:', orderCode, '-', amountNum, '-', username);
        }

        return jsonResponse({ success: true, orderCode });

    } catch (err) {
        console.error('Create recharge error:', err);
        return errorResponse('Lỗi server: ' + err.message, 500);
    }
}

// ═══════════════════════════════════════════════════════════════════
// HANDLER 3: KIỂM TRA ĐƠN
// ═══════════════════════════════════════════════════════════════════
async function handleCheckRecharge(url, env) {
    const code = url.searchParams.get('code');
    const email = url.searchParams.get('email');

    if (!code || !email) {
        return errorResponse('Thiếu code hoặc email');
    }

    if (!env.RECHARGE_KV) {
        return jsonResponse({ success: true, status: 'pending' });
    }

    const raw = await env.RECHARGE_KV.get('order:' + code);
    if (!raw) {
        return jsonResponse({ success: true, status: 'expired' });
    }

    let order;
    try {
        order = JSON.parse(raw);
    } catch (e) {
        return jsonResponse({ success: true, status: 'expired' });
    }

    // Check email khớp
    if (order.email !== email.toLowerCase()) {
        return errorResponse('Email không khớp', 403);
    }

    // Check hết hạn
    if (Date.now() > order.expiresAt && order.status === 'pending') {
        order.status = 'expired';
        await env.RECHARGE_KV.put(
            'order:' + code,
            JSON.stringify(order), { expirationTtl: 300 }
        );
    }

    // Nếu paid → lấy balance hiện tại
    let balance = 0;
    if (order.status === 'paid') {
        const balRaw = await env.RECHARGE_KV.get('balance:' + email.toLowerCase());
        balance = balRaw ? parseInt(balRaw) : 0;
    }

    return jsonResponse({
        success: true,
        status: order.status,
        balance
    });
}

// ═══════════════════════════════════════════════════════════════════
// HANDLER 4: HỦY ĐƠN
// ═══════════════════════════════════════════════════════════════════
async function handleCancelRecharge(request, env) {
    try {
        const { orderCode, email } = await request.json();

        if (!orderCode || !email) {
            return errorResponse('Thiếu thông tin');
        }

        if (!env.RECHARGE_KV) {
            return jsonResponse({ success: true });
        }

        const raw = await env.RECHARGE_KV.get('order:' + orderCode);
        if (raw) {
            const order = JSON.parse(raw);
            if (order.email === email.toLowerCase() && order.status === 'pending') {
                order.status = 'cancelled';
                await env.RECHARGE_KV.put(
                    'order:' + orderCode,
                    JSON.stringify(order), { expirationTtl: 300 }
                );
                console.log('🚫 Đã hủy đơn:', orderCode);
            }
        }

        return jsonResponse({ success: true });

    } catch (err) {
        return errorResponse(err.message, 500);
    }
}

// ═══════════════════════════════════════════════════════════════════
// HANDLER 5: WEBHOOK NGÂN HÀNG
// ═══════════════════════════════════════════════════════════════════
async function handleBankWebhook(request, env) {
    try {
        const body = await request.json();
        console.log('📥 Webhook:', JSON.stringify(body).slice(0, 500));

        let transactions = [];

        // ═══ Format Casso ═══
        if (body.data && Array.isArray(body.data)) {
            transactions = body.data.map(tx => ({
                description: tx.description || '',
                amount: parseInt(tx.amount || 0)
            }));
        }
        // ═══ Format Sepay ═══
        else if (body.content && (body.transferAmount || body.amount)) {
            transactions = [{
                description: body.content,
                amount: parseInt(body.transferAmount || body.amount)
            }];
        }
        // ═══ Format khác — thử parse trực tiếp ═══
        else if (body.description && body.amount) {
            transactions = [{
                description: body.description,
                amount: parseInt(body.amount)
            }];
        }

        if (transactions.length === 0) {
            return jsonResponse({ success: true, message: 'Không có giao dịch' });
        }

        let processedCount = 0;

        for (const tx of transactions) {
            const description = (tx.description || '').toUpperCase();
            const amount = tx.amount;

            // Regex tìm "NAP <username>"
            const match = description.match(/NAP[\s_]+([A-Z0-9]+)/);
            if (!match) {
                console.log('⏭️ Bỏ qua (không match):', description);
                continue;
            }

            const username = match[1].toLowerCase();
            console.log('🔍 Found NAP:', username, '| Amount:', amount);

            if (!env.RECHARGE_KV) continue;

            // Tìm đơn qua index
            const indexKey = 'index:' + username;
            const indexRaw = await env.RECHARGE_KV.get(indexKey);
            if (!indexRaw) {
                console.log('⏭️ Không có index cho user:', username);
                continue;
            }

            let orderCodes = [];
            try {
                orderCodes = JSON.parse(indexRaw);
            } catch (e) {
                continue;
            }

            // Duyệt từng order để tìm đơn pending khớp amount
            for (const code of orderCodes) {
                const raw = await env.RECHARGE_KV.get('order:' + code);
                if (!raw) continue;

                let order;
                try { order = JSON.parse(raw); } catch (e) { continue; }

                if (order.status !== 'pending') continue;
                if (order.username !== username) continue;
                if (order.amount !== amount) continue;

                // ✅ KHỚP → đánh dấu paid
                order.status = 'paid';
                order.paidAt = Date.now();

                await env.RECHARGE_KV.put(
                    'order:' + code,
                    JSON.stringify(order), { expirationTtl: 86400 }
                );

                // Cộng số dư
                const balKey = 'balance:' + order.email;
                const curBal = parseInt(await env.RECHARGE_KV.get(balKey) || '0');
                const newBal = curBal + amount;
                await env.RECHARGE_KV.put(balKey, newBal.toString());

                // Lưu lịch sử
                const histKey = 'history:' + order.email;
                let history = [];
                try {
                    const hRaw = await env.RECHARGE_KV.get(histKey);
                    if (hRaw) history = JSON.parse(hRaw);
                } catch (e) {}

                history.unshift({
                    orderCode: code,
                    amount,
                    method: 'bank',
                    methodName: 'Chuyển khoản ' + (env.BANK_NAME || 'ACB'),
                    time: Date.now()
                });
                if (history.length > 50) history = history.slice(0, 50);

                await env.RECHARGE_KV.put(
                    histKey,
                    JSON.stringify(history), { expirationTtl: 2592000 }
                );

                console.log('✅ Đã duyệt đơn:', code, '| Số dư mới:', newBal);
                processedCount++;
                break;
            }
        }

        return jsonResponse({ success: true, processed: processedCount });

    } catch (err) {
        console.error('❌ Webhook error:', err);
        return errorResponse(err.message, 500);
    }
}

// ═══════════════════════════════════════════════════════════════════
// HANDLER 6: LẤY SỐ DƯ
// ═══════════════════════════════════════════════════════════════════
async function handleGetBalance(url, env) {
    const email = url.searchParams.get('email');
    if (!email) return errorResponse('Thiếu email');

    if (!env.RECHARGE_KV) {
        return jsonResponse({ success: true, balance: 0 });
    }

    const raw = await env.RECHARGE_KV.get('balance:' + email.toLowerCase());
    const balance = raw ? parseInt(raw) : 0;

    // Lấy lịch sử luôn
    const histRaw = await env.RECHARGE_KV.get('history:' + email.toLowerCase());
    let history = [];
    try {
        if (histRaw) history = JSON.parse(histRaw);
    } catch (e) {}

    return jsonResponse({
        success: true,
        balance,
        history: history.slice(0, 20)
    });
}

// ═══════════════════════════════════════════════════════════════════
// HANDLER 7: VERIFY GOOGLE TOKEN
// ═══════════════════════════════════════════════════════════════════
async function handleGoogleAuth(request, env) {
    try {
        const body = await request.json();
        const { credential } = body;

        if (!credential) {
            return errorResponse('Thiếu credential');
        }

        const payload = decodeJWT(credential);
        if (!payload) {
            return errorResponse('Token không hợp lệ');
        }

        // Lưu user vào KV
        if (env.USERS_KV && payload.email) {
            await env.USERS_KV.put('user:' + payload.email.toLowerCase(), JSON.stringify({
                email: payload.email,
                name: payload.name,
                picture: payload.picture,
                googleId: payload.sub,
                lastLogin: Date.now()
            }));
        }

        return jsonResponse({
            success: true,
            user: {
                email: payload.email,
                name: payload.name,
                picture: payload.picture,
                googleId: payload.sub
            }
        });

    } catch (err) {
        return errorResponse(err.message, 500);
    }
}