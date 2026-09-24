// public/js/auth.js
// ═══════════════════════════════════════════════════════════════════
// AUTH MODULE DÙNG CHUNG - Locket Gold
// Chèn script này vào TẤT CẢ các trang (trangchu, dich-vu-vip, etc.)
// 
// Cách dùng:
// 1. Lưu file này vào /js/auth.js
// 2. Thêm <script src="/js/auth.js"></script> vào trước </body> của mỗi trang
// 3. Sử dụng Auth.getUser(), Auth.isLoggedIn(), Auth.requireLogin() trong JS
// ═══════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════
    // CẤU HÌNH
    // ═══════════════════════════════════════════════════════════════
    const CONFIG = {
        USER_KEY: 'locket_user',
        ORDER_KEY: 'locket_order',
        COOKIE_NAME: 'locket_session',
        SESSION_DAYS: 30,
        API_BASE: '', // Để trống nếu cùng domain, hoặc điền URL Worker của bạn
        LOGIN_URL: '/google-auth.html',
        HOME_URL: '/trangchu.html',
        DEBUG: true // Bật/tắt log debug
    };

    // ═══════════════════════════════════════════════════════════════
    // HELPER: LOG
    // ═══════════════════════════════════════════════════════════════
    function log(...args) {
        if (CONFIG.DEBUG) console.log('🔐 [Auth]', ...args);
    }

    function warn(...args) {
        if (CONFIG.DEBUG) console.warn('⚠️ [Auth]', ...args);
    }

    function error(...args) {
        console.error('❌ [Auth]', ...args);
    }

    // ═══════════════════════════════════════════════════════════════
    // AUTH MODULE
    // ═══════════════════════════════════════════════════════════════
    const Auth = {

        // ─────────────────────────────────────────────────────────
        // LƯU USER SAU KHI ĐĂNG NHẬP
        // ─────────────────────────────────────────────────────────
        saveUser: function(user) {
            if (!user || !user.email) {
                error('saveUser: user không hợp lệ', user);
                return false;
            }

            const userData = {
                email: user.email,
                name: user.name || user.email.split('@')[0],
                picture: user.picture || '',
                googleId: user.googleId || user.sub || '',
                emailVerified: user.emailVerified || user.email_verified || false,
                loginAt: Date.now(),
                expiresAt: Date.now() + (CONFIG.SESSION_DAYS * 24 * 60 * 60 * 1000)
            };

            // Lưu vào localStorage (persistent - 30 ngày)
            try {
                localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(userData));
                log('Đã lưu vào localStorage');
            } catch (e) {
                error('localStorage error:', e);
            }

            // Lưu vào sessionStorage (backup cho tab hiện tại)
            try {
                sessionStorage.setItem(CONFIG.USER_KEY, JSON.stringify(userData));
                log('Đã lưu vào sessionStorage');
            } catch (e) {
                warn('sessionStorage error:', e);
            }

            // Lưu vào cookie (để server-side đọc được)
            try {
                const cookieValue = encodeURIComponent(JSON.stringify({
                    email: userData.email,
                    name: userData.name,
                    expiresAt: userData.expiresAt
                }));
                const maxAge = CONFIG.SESSION_DAYS * 24 * 60 * 60;
                document.cookie = `${CONFIG.COOKIE_NAME}=${cookieValue}; path=/; max-age=${maxAge}; SameSite=Lax`;
                log('Đã lưu vào cookie');
            } catch (e) {
                warn('Cookie error:', e);
            }

            log('✅ Đã lưu user:', userData.email);
            return true;
        },

        // ─────────────────────────────────────────────────────────
        // LẤY USER HIỆN TẠI
        // ─────────────────────────────────────────────────────────
        getUser: function() {
            // Thử localStorage trước (ưu tiên vì persistent)
            try {
                const raw = localStorage.getItem(CONFIG.USER_KEY);
                if (raw) {
                    const user = JSON.parse(raw);
                    // Kiểm tra hết hạn
                    if (user.expiresAt && Date.now() > user.expiresAt) {
                        warn('Session đã hết hạn, đăng xuất');
                        this.logout();
                        return null;
                    }
                    return user;
                }
            } catch (e) {
                error('localStorage parse error:', e);
            }

            // Fallback sessionStorage
            try {
                const raw = sessionStorage.getItem(CONFIG.USER_KEY);
                if (raw) {
                    const user = JSON.parse(raw);
                    if (user.expiresAt && Date.now() > user.expiresAt) {
                        this.logout();
                        return null;
                    }
                    // Migrate to localStorage nếu chưa có
                    try {
                        localStorage.setItem(CONFIG.USER_KEY, raw);
                    } catch (e) {}
                    return user;
                }
            } catch (e) {
                error('sessionStorage parse error:', e);
            }

            return null;
        },

        // ─────────────────────────────────────────────────────────
        // KIỂM TRA ĐÃ ĐĂNG NHẬP CHƯA
        // ─────────────────────────────────────────────────────────
        isLoggedIn: function() {
            return this.getUser() !== null;
        },

        // ─────────────────────────────────────────────────────────
        // ĐĂNG XUẤT
        // ─────────────────────────────────────────────────────────
        logout: function() {
            // Xóa localStorage
            try { localStorage.removeItem(CONFIG.USER_KEY); } catch (e) {}

            // Xóa sessionStorage
            try { sessionStorage.removeItem(CONFIG.USER_KEY); } catch (e) {}
            try { sessionStorage.removeItem(CONFIG.ORDER_KEY); } catch (e) {}

            // Xóa cookie
            try {
                document.cookie = `${CONFIG.COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
            } catch (e) {}

            log('👋 Đã đăng xuất');
        },

        // ─────────────────────────────────────────────────────────
        // YÊU CẦU ĐĂNG NHẬP - NẾU CHƯA THÌ REDIRECT
        // ─────────────────────────────────────────────────────────
        requireLogin: function(redirectUrl) {
            if (!this.isLoggedIn()) {
                const currentUrl = redirectUrl ||
                    (window.location.pathname + window.location.search);
                log('Chưa đăng nhập, chuyển đến:', CONFIG.LOGIN_URL);
                window.location.href = `${CONFIG.LOGIN_URL}?redirect=${encodeURIComponent(currentUrl)}`;
                return false;
            }
            return true;
        },

        // ─────────────────────────────────────────────────────────
        // CẬP NHẬT NAVBAR
        // ─────────────────────────────────────────────────────────
        updateNavbar: function() {
            const user = this.getUser();
            const loginBtn = document.getElementById('navLoginBtn');
            const userMenu = document.getElementById('navUserMenu');

            if (user) {
                // Đã đăng nhập
                if (loginBtn) loginBtn.style.display = 'none';
                if (userMenu) userMenu.classList.add('active');

                const displayName = user.name || user.email.split('@')[0];
                const avatar = user.picture ||
                    'https://ui-avatars.com/api/?name=' +
                    encodeURIComponent(displayName) +
                    '&background=7c3aed&color=fff&size=100';

                const navAvatar = document.getElementById('navUserAvatar');
                const navName = document.getElementById('navUserName');
                const menuName = document.getElementById('navMenuName');

                if (navAvatar) navAvatar.src = avatar;
                if (navName) navName.textContent = displayName;
                if (menuName) menuName.textContent = displayName;

                // Load số dư
                this.loadBalance(user.email);
            } else {
                // Chưa đăng nhập
                if (loginBtn) loginBtn.style.display = '';
                if (userMenu) userMenu.classList.remove('active');
            }
        },

        // ─────────────────────────────────────────────────────────
        // LOAD SỐ DƯ
        // ─────────────────────────────────────────────────────────
        loadBalance: async function(email) {
            if (!email) return;

            try {
                const res = await fetch(
                    `${CONFIG.API_BASE}/api/balance?email=${encodeURIComponent(email)}`, {
                        credentials: 'same-origin'
                    }
                );
                const data = await res.json();

                if (data.success) {
                    const balance = (data.balance || 0).toLocaleString('vi-VN') + 'đ';
                    const el = document.getElementById('navMenuBalance');
                    if (el) el.textContent = balance;
                    log('Số dư:', balance);
                }
            } catch (e) {
                warn('Load balance error:', e);
                // Fallback localStorage
                try {
                    const bal = parseInt(
                        localStorage.getItem('locket_balance_' + email) || '0'
                    );
                    const el = document.getElementById('navMenuBalance');
                    if (el) el.textContent = bal.toLocaleString('vi-VN') + 'đ';
                } catch (err) {}
            }
        },

        // ─────────────────────────────────────────────────────────
        // TOGGLE MENU USER
        // ─────────────────────────────────────────────────────────
        toggleUserMenu: function(e) {
            if (e) e.stopPropagation();
            const wrap = document.getElementById('navUserMenu');
            if (!wrap) return;

            const isOpen = wrap.classList.toggle('open');
            const btn = wrap.querySelector('.user-menu-btn');
            if (btn) btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        },

        // ─────────────────────────────────────────────────────────
        // ĐĂNG XUẤT (có confirm)
        // ─────────────────────────────────────────────────────────
        handleLogout: function() {
            if (!confirm('Bạn có chắc muốn đăng xuất?')) return;

            this.logout();

            // Disable Google auto select
            if (typeof google !== 'undefined' && google.accounts) {
                try {
                    google.accounts.id.disableAutoSelect();
                } catch (e) {}
            }

            window.location.href = CONFIG.HOME_URL;
        },

        // ─────────────────────────────────────────────────────────
        // LƯU ĐƠN HÀNG
        // ─────────────────────────────────────────────────────────
        saveOrder: function(order) {
            try {
                sessionStorage.setItem(CONFIG.ORDER_KEY, JSON.stringify(order));
                log('Đã lưu đơn hàng');
                return true;
            } catch (e) {
                error('Lỗi lưu đơn hàng:', e);
                return false;
            }
        },

        getOrder: function() {
            try {
                const raw = sessionStorage.getItem(CONFIG.ORDER_KEY);
                return raw ? JSON.parse(raw) : null;
            } catch (e) {
                return null;
            }
        },

        clearOrder: function() {
            try {
                sessionStorage.removeItem(CONFIG.ORDER_KEY);
            } catch (e) {}
        },

        // ─────────────────────────────────────────────────────────
        // LẤY REDIRECT URL TỪ QUERY STRING
        // ─────────────────────────────────────────────────────────
        getRedirectUrl: function(defaultUrl) {
            try {
                const params = new URLSearchParams(window.location.search);
                return params.get('redirect') || defaultUrl || CONFIG.HOME_URL;
            } catch (e) {
                return defaultUrl || CONFIG.HOME_URL;
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════
    // GLOBAL EVENT LISTENERS
    // ═══════════════════════════════════════════════════════════════

    // Click ngoài để đóng menu
    document.addEventListener('click', function(e) {
        const wrap = document.getElementById('navUserMenu');
        if (wrap && !wrap.contains(e.target)) {
            wrap.classList.remove('open');
        }
    });

    // ESC để đóng menu
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            const wrap = document.getElementById('navUserMenu');
            if (wrap) wrap.classList.remove('open');
        }
    });

    // ═══════════════════════════════════════════════════════════════
    // AUTO UPDATE NAVBAR KHI DOM READY
    // ═══════════════════════════════════════════════════════════════
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            Auth.updateNavbar();
        });
    } else {
        Auth.updateNavbar();
    }

    // ═══════════════════════════════════════════════════════════════
    // EXPORT RA GLOBAL
    // ═══════════════════════════════════════════════════════════════
    window.Auth = Auth;

    // Alias cho các hàm thường dùng
    window.toggleUserMenu = Auth.toggleUserMenu.bind(Auth);
    window.handleUserLogout = Auth.handleLogout.bind(Auth);
    window.loadBalance = Auth.loadBalance.bind(Auth);

    log('Module đã sẵn sàng');

})();