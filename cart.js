/* ===========================================================================
 *  cart.js — سلّة الزبون وإتمام الطلب  (فرونت اند فقط)
 *
 *  • لا قاعدة بيانات ولا أي استدعاء لخادم: السلة تُحفظ في localStorage.
 *  • يجهّز رسالة واتساب منظّمة ويفتحها على رقم المقهى من config.js.
 *  • يطلب الموقع تلقائيًا أول مرة (Geolocation) ويربطه بخرائط جوجل،
 *    وإن رفض الزبون يبقى بإمكانه كتابة الموقف يدويًا.
 *  • يعرض معاينة كاملة للرسالة قبل الإرسال + زر نسخ،
 *    ويمنع ضياع السلة لو تعذّر فتح واتساب (زر تراجع).
 *
 *  لا يغيّر أي شيء في شكل المنيو — يضيف زرًا فقط إلى كل بطاقة لها سعر.
 * =========================================================================== */
(function () {
    'use strict';

    if (window.__khCartReady) return;
    window.__khCartReady = true;

    var C = window.KH_CONFIG || {};
    var CUR = C.CURRENCY || 'د.ل';
    var WA = C.WHATSAPP || '218916666009';
    var STORE = 'kh_cart_v1';

    var CART = load();
    var formOpen = false, busy = false, geoTried = false, lastCart = null, lastForm = null;

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

    /* ============================================================== الموقع */
    function mapUrl(c) {
        return 'https://www.google.com/maps?q=' + c.lat + ',' + c.lon;
    }
    function getGeo(cb) {
        if (!navigator.geolocation) return cb(null, 'unsupported');
        navigator.geolocation.getCurrentPosition(
            function (p) {
                cb({ lat: p.coords.latitude.toFixed(6), lon: p.coords.longitude.toFixed(6) }, null);
            },
            function (e) { cb(null, e && e.code === 1 ? 'denied' : 'error'); },
            { enableHighAccuracy: true, timeout: 9000, maximumAge: 60000 }
        );
    }
    function locValue() { var el = $('khLoc'); return el ? el.value.trim() : ''; }

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

                    '<label for="khLoc">الموقع / الموقف <span class="kh-opt">اختياري</span></label>' +
                    '<div class="kh-loc">' +
                      '<input id="khLoc" type="text" placeholder="مثال: أمام المسجد النور">' +
                      '<button type="button" id="khGeo" class="kh-geo">تحديد موقعي</button>' +
                    '</div>' +

                    '<label>طريقة الاستلام</label>' +
                    '<div class="kh-pay">' +
                      '<label><input type="radio" name="khFul" value="pickup" checked><span class="kh-pe">🏪</span><span>استلام من المقهى</span></label>' +
                      '<label><input type="radio" name="khFul" value="delivery"><span class="kh-pe">🚚</span><span>توصيل</span></label>' +
                    '</div>' +

                    '<label for="khNote">ملاحظة (اختياري)</label>' +
                    '<textarea id="khNote" placeholder="مثال: بدون سكر، تغليف هدية…"></textarea>' +

                    '<div class="kh-msg" id="khMsg"></div>' +
                  '</div>' +
                '</div>' +

                '<button class="kh-go" id="khGo" type="button">إتمام الطلب</button>' +
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
        $('khGo').addEventListener('click', submit);

        /* زر تحديد الموقع داخل النموذج */
        $('khGeo').addEventListener('click', function () {
            setMsg('جارٍ تحديد موقعك من الخرائط…', 'ok');
            getGeo(function (c, err) {
                if (c) {
                    $('khLoc').value = mapUrl(c);
                    setMsg('تم تحديد الموقع ✓', 'ok');
                } else {
                    setMsg(err === 'denied'
                        ? 'تم رفض إذن الموقع — اكتب الموقف يدويًا.'
                        : 'تعذّر تحديد الموقع — اكتب الموقف يدويًا.', 'err');
                }
            });
        });

        /* اختيار الحجم/التشكيلة في النافذة المنبثقة */
        $('khPickOpts').addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('.kh-opt-b') : null;
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

    /** اسم الصنف كما يظهر في الرسالة: بلا مسافات مكررة في الوسط ولا في الطرفين */
    function cleanName(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

    function addLine(item, label, unit) {
        var nm = cleanName(item.ar);
        var key = String(item.id) + '|' + (label || '');
        var found = null;
        for (var i = 0; i < CART.length; i++) {
            if (String(CART[i].id) + '|' + (CART[i].label || '') === key) { found = CART[i]; break; }
        }
        if (found) found.qty++;
        else CART.push({
            id: item.id, ar: nm, it: item.it || '', img: item.img || '',
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
            return '<button class="kh-opt-b" type="button" data-i="' + i + '">' +
                   '<span class="kh-on">' + esc(o.label) + '</span>' +
                   '<span class="kh-op">' + esc(o.text) + '</span></button>';
        }).join('');
        $('khPickOpts').innerHTML = html;

        ov.classList.add('on');
        pickEl.classList.add('on');
        var first = pickEl.querySelector('.kh-opt-b');
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
            return;
        }

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
        geoTried = false;
        form.classList.add('on');
        goBtn.textContent = 'إرسال الطلب عبر واتساب';
        $('khName').focus();
    }

    /* ============================================================= submit */
    function setMsg(text, kind) {
        msg.textContent = text || '';
        msg.className = 'kh-msg' + (text ? ' ' + (kind || 'err') + ' on' : '');
    }

    function formData() {
        return {
            name: ($('khName').value || '').trim(),
            phone: ($('khPhone').value || '').trim(),
            note: ($('khNote').value || '').trim(),
            ful: (document.querySelector('input[name="khFul"]:checked') || {}).value || 'pickup'
        };
    }

    function collect() {
        var d = formData();
        if (!d.name) { setMsg('اكتب اسمك من فضلك'); $('khName').focus(); return null; }
        var digits = d.phone.replace(/\D/g, '');
        if (digits.length < 9) { setMsg('رقم الهاتف غير صحيح'); $('khPhone').focus(); return null; }
        setMsg('');
        return d;
    }

    /* --------------------------------------------------- نص الرسالة الكامل */
    function buildMsg(d, loc) {
        var L = [];
        L.push('☕ طلب جديد — KH IL VOSTRO CAFFE');
        L.push('');
        L.push('👤 الاسم: ' + (d.name || '—'));
        L.push('📱 رقم الهاتف: ' + (d.phone || '—'));
        if (loc) L.push('📍 الموقع / الموقف: ' + loc);
        L.push((d.ful === 'delivery' ? '🚚' : '🏪') + ' طريقة الاستلام: '
             + (d.ful === 'delivery' ? 'توصيل' : 'استلام من المقهى'));
        L.push('');
        L.push('🛒 محتويات السلة:');
        CART.forEach(function (l, i) {
            L.push((i + 1) + '. ' + l.ar + (l.label ? ' — ' + l.label : '')
                 + ' (' + fmt(l.unit) + ') ×' + l.qty + ' = ' + fmt(l.unit * l.qty));
        });
        L.push('');
        L.push('💰 الإجمالي: ' + fmt(subtotal()));
        if (d.note) L.push('📝 ملاحظة: ' + d.note);
        return L.join('\n');
    }

    /* ------------------------------------------------------------- الإرسال */
    function submit() {
        if (busy || !CART.length) return;
        if (!formOpen) { openForm(); return; }

        var d = collect();
        if (!d) return;

        var loc = locValue();

        /* أول ضغطة بلا موقع → نطلب إذن الموقع. لو رُفض بقي النموذج مفتوحًا
           ورسالة خطأ واضحة، والضغط مرة أخرى يتجاوز الموقع. */
        if (!loc && !geoTried) {
            busy = true;
            setMsg('جارٍ تحديد موقعك من الخرائط…', 'ok');
            getGeo(function (c, err) {
                busy = false;
                geoTried = true;
                if (c) {
                    $('khLoc').value = mapUrl(c);
                    sendOrder(d, mapUrl(c));
                } else {
                    setMsg((err === 'denied' ? 'تم رفض إذن الموقع. ' : 'تعذّر تحديد الموقع. ')
                         + 'اكتب الموقع يدويًا أو اضغط «إرسال» مرة أخرى للتخطي.', 'err');
                }
            });
            return;
        }

        sendOrder(d, loc);
    }

    /**
     * نستخدم api.whatsapp.com مباشرة: رابط wa.me يفسد الرموز التعبيرية
     * أثناء إعادة التوجيه ويحوّلها إلى � (مُختبَر ومُثبَت).
     */
    function sendOrder(d, loc) {
        var url = 'https://api.whatsapp.com/send?phone=' + WA
                + '&text=' + encodeURIComponent(buildMsg(d, loc));
        var w = null;
        try { w = window.open(url, '_blank'); } catch (e) {}

        if (!w) {
            setMsg('حُجبت نافذة واتساب — انسخ الرسالة وأرسلها يدويًا. السلة محفوظة.', 'err');
            return false;
        }
        finish();
        return true;
    }

    /* تُستدعى فقط بعد فتح واتساب بنجاح — نحتفظ بلقطة للسلة والنموذج لزر التراجع */
    function finish() {
        lastCart = CART.slice();
        lastForm = { d: formData(), loc: locValue() };
        CART = []; save(); renderFab();
        formOpen = false; geoTried = false;
        form.classList.remove('on');
        $('khName').value = ''; $('khPhone').value = ''; $('khNote').value = ''; $('khLoc').value = '';
        renderCart();
        setTimeout(closeCart, 900);
        toastUndo('تم فتح واتساب ✓ أرسل الرسالة لإتمام الطلب', function () {
            CART = lastCart || [];
            var f = lastForm;
            lastCart = null; lastForm = null;
            save(); renderFab(); renderCart();
            if (f) {
                $('khName').value = f.d.name || '';
                $('khPhone').value = f.d.phone || '';
                $('khNote').value = f.d.note || '';
                $('khLoc').value = f.loc || '';
                var ful = document.querySelector('input[name="khFul"][value="' + (f.d.ful || 'pickup') + '"]');
                if (ful) ful.checked = true;
            }
            openForm();
            setMsg('استُعيدت السلة ✓', 'ok');
        });
    }

    /* ============================================================== toast */
    function toast(text) {
        toastEl.textContent = text;
        toastEl.classList.add('on');
        clearTimeout(toast._t);
        toast._t = setTimeout(function () { toastEl.classList.remove('on'); }, 2200);
    }

    function toastUndo(text, fn) {
        toastEl.textContent = text;
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'kh-undo';
        b.textContent = 'تراجع';
        b.addEventListener('click', function () {
            fn();
            toastEl.classList.remove('on');
        });
        toastEl.appendChild(b);
        toastEl.classList.add('on');
        clearTimeout(toast._t);
        toast._t = setTimeout(function () { toastEl.classList.remove('on'); lastCart = null; }, 8000);
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
    }

    boot();
})();
