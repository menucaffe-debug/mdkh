/* ===========================================================================
 *  cart.js — سلّة الزبون وإتمام الطلب
 *
 *  يعمل بحالتين:
 *    • القاعدة مضبوطة في config.js  → يرسل الطلب عبر دالة place_order()
 *      (الأسعار تُقرأ من القاعدة في الخادم، فلا يمكن تزويرها من المتصفح)
 *    • القاعدة غير مضبوطة           → يجهّز رسالة واتساب منظّمة، وتعمل اليوم
 *
 *  لا يغيّر أي شيء في شكل المنيو — يضيف زرًا فقط إلى كل بطاقة لها سعر.
 * =========================================================================== */
(function () {
    'use strict';

    if (window.__khCartReady) return;
    window.__khCartReady = true;

    var C = window.KH_CONFIG || {};
    var CUR = C.CURRENCY || 'د.ل';
    var WA = C.WHATSAPP || '218914041333';
    var SB_URL = C.SUPABASE_URL || '';
    var SB_KEY = C.SUPABASE_ANON_KEY || '';
    var STORE = 'kh_cart_v1';

    var CART = load();
    var sbClient = null, formOpen = false, busy = false;

    /* ================================================================ utils */
    function $(id) { return document.getElementById(id); }
    function num(s) {
        if (s == null) return 0;
        if (typeof s === 'number') return s;
        var m = String(s).replace(/[^\d.]/g, '');
        if (!m) return 0;
        var n = parseFloat(m);
        return isFinite(n) ? n : 0;
    }
    function fmt(n) {
        var v = Math.round(n * 100) / 100;
        return (v % 1 === 0 ? v.toLocaleString('en') : v.toFixed(2).replace(/\.?0+$/, ''))
               + ' ' + CUR;
    }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function load() {
        try { var s = localStorage.getItem(STORE); return s ? JSON.parse(s) : []; }
        catch (e) { return []; }
    }
    function save() { try { localStorage.setItem(STORE, JSON.stringify(CART)); } catch (e) {} }

    /* =========================================================== supabase */
    function supabaseReady() { return !!(SB_URL && SB_KEY); }

    function loadSupabase(cb) {
        if (window.supabase && window.supabase.createClient) return cb();
        var have = document.querySelector('script[data-kh-sb]');
        if (have) {
            if (have.dataset.khReady === '1') return cb();
            have.addEventListener('load', cb);
            return;
        }
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
        s.setAttribute('data-kh-sb', '1');
        s.addEventListener('load', function () { s.dataset.khReady = '1'; cb(); });
        s.addEventListener('error', function () {});
        document.head.appendChild(s);
    }

    function client() {
        if (sbClient) return sbClient;
        if (!supabaseReady() || !window.supabase) return null;
        try { sbClient = window.supabase.createClient(SB_URL, SB_KEY); } catch (e) { sbClient = null; }
        return sbClient;
    }

    /* ============================================================ DOM build */
    var ov, cartEl, pickEl, toastEl, fab, body, form, msg, goBtn;

    function build() {
        var wrap = document.createElement('div');
        wrap.innerHTML =
            '<button class="kh-fab" id="khFab" type="button" aria-label="سلّة الطلب">' +
              '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7.2 14h9.45a2 2 0 0 0 1.94-1.52l1.5-6A1 1 0 0 0 19.11 5H6.21l-.44-2.16A1 1 0 0 0 4.79 2H2v2h1.87l2.7 12.63A2 2 0 0 0 8.55 18H7.2z"/></svg>' +
              '<span class="kh-count" id="khCount" style="display:none">0</span>' +
            '</button>' +

            '<div class="kh-ov" id="khOv"></div>' +

            '<aside class="kh-cart" id="khCart" role="dialog" aria-modal="true" aria-labelledby="khTitle" tabindex="-1">' +
              '<div class="kh-hd">' +
                '<h2 id="khTitle">سلّة الطلب</h2>' +
                '<button class="kh-x" id="khClose" type="button" aria-label="إغلاق">✕</button>' +
              '</div>' +
              '<div class="kh-body" id="khBody"></div>' +
              '<div class="kh-sum">' +
                '<div class="kh-row"><span id="khItemsLbl">عدد الأصناف</span><b id="khItems">0</b></div>' +
                '<div class="kh-total"><span>الإجمالي</span><span class="kh-amt" id="khTotal">0</span></div>' +

                '<div class="kh-form" id="khForm">' +
                  '<div class="kh-f">' +
                    '<div class="kh-two">' +
                      '<div><label for="khName">الاسم <span class="req">*</span></label>' +
                        '<input id="khName" type="text" autocomplete="name" placeholder="اسمك"></div>' +
                      '<div><label for="khPhone">رقم الهاتف <span class="req">*</span></label>' +
                        '<input id="khPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="09xxxxxxxx"></div>' +
                    '</div>' +
                    '<label>طريقة الدفع</label>' +
                    '<div class="kh-pay">' +
                      '<label><input type="radio" name="khPay" value="cash" checked><span class="kh-pe">💵</span><span>نقدي</span></label>' +
                      '<label><input type="radio" name="khPay" value="card"><span class="kh-pe">💳</span><span>بطاقة</span></label>' +
                      '<label><input type="radio" name="khPay" value="wallet"><span class="kh-pe">📱</span><span>محفظة</span></label>' +
                    '</div>' +
                    '<label for="khNote">ملاحظة (اختياري)</label>' +
                    '<textarea id="khNote" placeholder="مثال: بدون سكر، تغليف هدية…"></textarea>' +
                    '<div class="kh-msg" id="khMsg"></div>' +
                  '</div>' +
                '</div>' +

                '<button class="kh-go" id="khGo" type="button">إتمام الطلب</button>' +
                '<button class="kh-alt" id="khAlt" type="button">أو أرسل الطلب عبر واتساب</button>' +
              '</div>' +
            '</aside>' +

            '<div class="kh-pick" id="khPick" role="dialog" aria-modal="true" aria-labelledby="khPickTitle" tabindex="-1">' +
              '<h3 id="khPickTitle">اختر</h3>' +
              '<div class="kh-psub" id="khPickSub"></div>' +
              '<div id="khPickOpts"></div>' +
            '</div>' +

            '<div class="kh-toast" id="khToast" role="status" aria-live="polite"></div>';

        while (wrap.firstChild) document.body.appendChild(wrap.firstChild);

        fab = $('khFab'); ov = $('khOv'); cartEl = $('khCart'); pickEl = $('khPick');
        toastEl = $('khToast'); body = $('khBody');
        form = $('khForm'); msg = $('khMsg'); goBtn = $('khGo');

        $('khClose').addEventListener('click', closeCart);
        ov.addEventListener('click', function () { closePick(); closeCart(); });
        fab.addEventListener('click', openCart);
        $('khGo').addEventListener('click', function () {
            if (!formOpen) { openForm(); return; }
            submit(false);
        });
        $('khAlt').addEventListener('click', function () { submit(true); });

        /* اختيار الحجم/التشكيلة في النافذة المنبثقة */
        $('khPickOpts').addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('.kh-opt') : null;
            if (!b || !pickItem || !pickInfo) return;
            var item = pickItem;
            var o = pickInfo.options[Number(b.dataset.i)];
            if (!o) return;
            closePick();                 // يصفّر pickItem — التقطنا قبل الإغلاق
            addLine(item, o.label, o.n);
        });

        /* أزرار الكمية والحذف داخل السلة */
        body.addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('[data-a]') : null;
            if (!b) return;
            var line = b.closest('.kh-line');
            var i = line ? Number(line.dataset.i) : -1;
            var l = CART[i];
            if (!l) return;
            var a = b.dataset.a;
            if (a === 'inc') l.qty++;
            else if (a === 'dec') { l.qty--; if (l.qty < 1) CART.splice(i, 1); }
            else if (a === 'rm') CART.splice(i, 1);
            if (!CART.length) { formOpen = false; setMsg(''); }
            save(); renderFab(); renderCart();
        });

        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            if (pickEl.classList.contains('on')) closePick();
            else if (cartEl.classList.contains('on')) closeCart();
        });

        renderFab(); renderCart();
    }

    /* ========================================================= item helpers */
    function findItem(id, name) {
        if (typeof ALL === 'undefined') return null;
        for (var i = 0; i < ALL.length; i++) {
            if (String(ALL[i].id) === String(id) && (name == null || ALL[i].ar === name)) return ALL[i];
        }
        return null;
    }

    /** يعيد خيارات/سعر الصنف، أو null إن لم يكن له سعر (بوكس الاختيار) */
    function priceInfo(item) {
        var list = null;
        if (item.prices && item.prices.length) {
            list = item.prices.map(function (p) {
                return { label: p.label, text: p.price, n: num(p.price) };
            });
        } else if (item.variants && item.variants.length) {
            list = item.variants.map(function (v) {
                return { label: v.name, text: v.price, n: num(v.price) };
            });
        }
        if (list) {
            return { multi: true, options: list.filter(function (o) { return o.n > 0; }) };
        }
        if (item.price) {
            var n = num(item.price);
            if (n > 0) return { multi: false, n: n, text: item.price, options: null };
        }
        return null;
    }

    /* ============================================================ decorate */
    function decorate() {
        var cards = document.querySelectorAll('.card');
        Array.prototype.forEach.call(cards, function (card) {
            if (card.dataset.kh) return;
            card.dataset.kh = '1';
            var item = findItem(card.dataset.id, card.dataset.name);
            if (!item) return;
            var info = priceInfo(item);
            if (!info) return;   // بوكس الاختيار المخصص — لا سعر له

            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'kh-add';
            b.innerHTML = info.multi
                ? '<span class="kh-plus">＋</span> اختر الحجم'
                : '<span class="kh-plus">＋</span> أضف للسلة';
            b.setAttribute('aria-label', info.multi
                ? 'اختر الحجم وأضف ' + item.ar
                : 'أضف ' + item.ar + ' إلى السلة');
            b.addEventListener('click', function (e) {
                e.stopPropagation();
                addFlow(item, info);
            });

            var host = card.querySelector('.bdy') || card;
            host.appendChild(b);
        });
    }

    function wrapRender() {
        if (typeof renderGrid !== 'function' || renderGrid.__kh) return;
        var orig = renderGrid;
        var w = function () {
            var r = orig.apply(this, arguments);
            decorate();
            return r;
        };
        w.__kh = true;
        renderGrid = w;
    }

    /* ============================================================== add */
    function addFlow(item, info) {
        if (!info) return;
        if (!info.multi) { addLine(item, null, info.n); return; }
        openPick(item, info);
    }

    function addLine(item, label, unit) {
        var key = String(item.id) + '|' + (label || '');
        var found = null;
        for (var i = 0; i < CART.length; i++) {
            if (String(CART[i].id) + '|' + (CART[i].label || '') === key) { found = CART[i]; break; }
        }
        if (found) found.qty++;
        else CART.push({
            id: item.id, ar: item.ar, it: item.it || '', img: item.img || '',
            label: label || '', unit: unit, qty: 1
        });
        save(); renderFab(); renderCart();
        toast('أُضيف إلى السلة');
        if (fab) { fab.classList.remove('kh-pulse'); void fab.offsetWidth; fab.classList.add('kh-pulse'); }
    }

    /* =========================================================== picker */
    var pickItem = null, pickInfo = null;

    function openPick(item, info) {
        pickItem = item; pickInfo = info;
        $('khPickTitle').textContent = item.ar;
        $('khPickSub').textContent = item.it || 'اختر الحجم أو التشكيلة';
        var html = info.options.map(function (o, i) {
            return '<button class="kh-opt" type="button" data-i="' + i + '">' +
                   '<span class="kh-on">' + esc(o.label) + '</span>' +
                   '<span class="kh-op">' + esc(o.text) + '</span></button>';
        }).join('');
        $('khPickOpts').innerHTML = html;

        ov.classList.add('on');
        pickEl.classList.add('on');
        var first = pickEl.querySelector('.kh-opt');
        if (first) first.focus();
    }

    function closePick() {
        if (!pickEl.classList.contains('on')) return;
        pickEl.classList.remove('on');
        if (!cartEl.classList.contains('on')) ov.classList.remove('on');
        pickItem = null; pickInfo = null;
    }

    /* ============================================================== fab */
    function count() {
        return CART.reduce(function (s, l) { return s + l.qty; }, 0);
    }
    function subtotal() {
        return CART.reduce(function (s, l) { return s + l.qty * (l.unit || 0); }, 0);
    }
    function renderFab() {
        var n = count();
        $('khCount').textContent = n;
        $('khCount').style.display = n ? 'flex' : 'none';
        fab.classList.toggle('on', n > 0);
    }

    /* ============================================================= drawer */
    function openCart() {
        if (!CART.length) { toast('السلة فارغة'); return; }
        renderCart();
        if (toastEl) toastEl.classList.remove('on');   // لا يغطي الإجمالي
        ov.classList.add('on');
        cartEl.classList.add('on');
        $('khClose').focus();
    }
    function closeCart() {
        if (!cartEl.classList.contains('on')) return;
        cartEl.classList.remove('on');
        if (!pickEl.classList.contains('on')) ov.classList.remove('on');
        try { fab.focus(); } catch (e) {}
    }

    function renderCart() {
        if (!body) return;
        $('khItems').textContent = count();
        $('khTotal').textContent = fmt(subtotal());

        if (!CART.length) {
            body.innerHTML = '<div class="kh-empty"><span class="kh-emoji">🛒</span>' +
                             'السلة فارغة<br>أضف ما يعجبك من المنيو</div>';
            form.classList.remove('on'); formOpen = false;
            goBtn.textContent = 'إتمام الطلب';
            $('khAlt').style.display = 'none';
            return;
        }

        $('khAlt').style.display = '';
        body.innerHTML = CART.map(function (l, i) {
            return '<div class="kh-line" data-i="' + i + '">' +
                (l.img ? '<img src="' + esc(l.img) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">'
                       : '<div style="width:52px;height:52px;border-radius:11px;background:#EFE9DF;flex-shrink:0"></div>') +
                '<div class="kh-li">' +
                  '<div class="kh-nm">' + esc(l.ar) + '</div>' +
                  (l.label ? '<div class="kh-vt">' + esc(l.label) + '</div>' : '') +
                  '<div class="kh-pr">' + fmt(l.unit) + ' × ' + l.qty + ' = ' + fmt(l.unit * l.qty) + '</div>' +
                '</div>' +
                '<div class="kh-qty">' +
                  '<button type="button" data-a="dec" aria-label="إنقاص">−</button>' +
                  '<span>' + l.qty + '</span>' +
                  '<button type="button" data-a="inc" aria-label="زيادة">＋</button>' +
                '</div>' +
                '<button class="kh-rm" type="button" data-a="rm" aria-label="حذف">🗑</button>' +
            '</div>';
        }).join('');

        if (formOpen) form.classList.add('on');
    }

    function openForm() {
        if (!CART.length) return;
        formOpen = true;
        form.classList.add('on');
        goBtn.textContent = supabaseReady() ? 'تأكيد الطلب' : 'إرسال الطلب';
        $('khName').focus();
    }

    /* ============================================================= submit */
    function setMsg(text, kind) {
        msg.textContent = text || '';
        msg.className = 'kh-msg' + (text ? ' ' + (kind || 'err') + ' on' : '');
    }

    function collect() {
        var name = $('khName').value.trim();
        var phone = $('khPhone').value.trim();
        var note = $('khNote').value.trim();
        var pay = (document.querySelector('input[name="khPay"]:checked') || {}).value || 'cash';

        if (!name) { setMsg('اكتب اسمك من فضلك'); $('khName').focus(); return null; }
        var digits = phone.replace(/\D/g, '');
        if (digits.length < 9) { setMsg('رقم الهاتف غير صحيح'); $('khPhone').focus(); return null; }
        setMsg('');
        return { name: name, phone: phone, note: note, pay: pay };
    }

    async function submit(viaWhatsApp) {
        if (busy || !CART.length) return;
        if (!formOpen && !viaWhatsApp) { openForm(); return; }
        var d = collect();
        if (!d) { if (!formOpen) openForm(); return; }

        busy = true;
        var label = goBtn.textContent;
        goBtn.disabled = true;
        goBtn.innerHTML = '<span class="kh-spin"></span> جارٍ الإرسال…';

        var ok = false;
        try {
            if (!viaWhatsApp && supabaseReady()) {
                ok = await sendToDb(d);
            } else {
                ok = sendToWhatsApp(d);
            }
        } catch (e) {
            setMsg('تعذّر الإرسال: ' + (e && e.message ? e.message : e), 'err');
        }

        busy = false;
        goBtn.disabled = false;
        goBtn.textContent = label || 'تأكيد الطلب';
    }

    async function sendToDb(d) {
        var sb = client();
        if (!sb) { loadSupabase(function () {}); setMsg('تعذّر الاتصال بقاعدة البيانات — استخدم واتساب', 'err'); return false; }

        var items = CART.map(function (l) {
            return { id: l.id, qty: l.qty, variant: l.label || null };
        });

        var r = await sb.rpc('place_order', {
            p_name: d.name,
            p_phone: d.phone,
            p_items: items,
            p_note: d.note || null,
            p_source: 'online',
            p_payment: d.pay
        });

        if (r.error) { setMsg(r.error.message, 'err'); return false; }

        var res = r.data || {};
        if (res.ok === false) { setMsg(res.message || 'تعذّر إتمام الطلب', 'err'); return false; }

        setMsg('تم استلام طلبك' + (res.order_no ? ' — رقم الطلب #' + res.order_no : ''), 'ok');
        finish();
        return true;
    }

    function sendToWhatsApp(d) {
        var lines = ['مرحباً KH ☕', 'طلب جديد من المنيو:', ''];
        CART.forEach(function (l) {
            lines.push('• ' + l.qty + '× ' + l.ar + (l.label ? ' (' + l.label + ')' : '')
                       + ' — ' + fmt(l.unit * l.qty));
        });
        lines.push('');
        lines.push('الإجمالي: ' + fmt(subtotal()));
        lines.push('الاسم: ' + d.name);
        lines.push('الهاتف: ' + d.phone);
        lines.push('الدفع: ' + ({ cash: 'نقدي', card: 'بطاقة', wallet: 'محفظة' }[d.pay] || d.pay));
        if (d.note) lines.push('ملاحظة: ' + d.note);
        lines.push('من رابط المنيو: ' + location.origin + location.pathname);

        var url = 'https://wa.me/' + WA + '?text=' + encodeURIComponent(lines.join('\n'));
        window.open(url, '_blank', 'noopener');
        setMsg('تم فتح واتساب — أرسل الرسالة لإتمام الطلب', 'ok');
        finish();
        return true;
    }

    function finish() {
        CART = []; save(); renderFab();
        formOpen = false;
        form.classList.remove('on');
        $('khName').value = ''; $('khPhone').value = ''; $('khNote').value = '';
        renderCart();
        toast('شكراً لك ✓');
        setTimeout(closeCart, 1400);
    }

    /* ============================================================== toast */
    function toast(text) {
        toastEl.textContent = text;
        toastEl.classList.add('on');
        clearTimeout(toast._t);
        toast._t = setTimeout(function () { toastEl.classList.remove('on'); }, 2200);
    }

    /* =============================================================== init */
    function boot() {
        if (!document.body) return;
        build();
        wrapRender();
        decorate();
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () { wrapRender(); decorate(); });
        }
        /* دعم المتصفحات التي لا تعرف :has() في اختيار طريقة الدفع */
        Array.prototype.forEach.call(
            document.querySelectorAll('input[name="khPay"]'),
            function (r) {
                r.addEventListener('change', function () {
                    Array.prototype.forEach.call(
                        document.querySelectorAll('.kh-pay label'),
                        function (l) { l.classList.toggle('sel', l.querySelector('input').checked); }
                    );
                });
            }
        );
        if (supabaseReady()) loadSupabase(function () {});
    }

    boot();
})();
