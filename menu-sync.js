/* ===========================================================================
 *  menu-sync.js — مزامنة المنيو من قاعدة البيانات
 *
 *  يقرأ أصناف قاعدة البيانات ويضعها فوق بيانات الصفحة الثابتة:
 *    • سعر صنف قائم  → يُحدّث من لوحة الإدارة  (يبدو متطابقاً تماماً ما لم
 *                       يتغيّر، لأن النص المعروض يُنسخ من القاعدة حرفياً)
 *    • صنف جديد       → يُضاف ويظهر في المنيو فوراً
 *    • صنف أخفاه      → يختفي من المنيو
 *
 *  ⚠️ لا يفعل شيئاً إطلاقاً إن لم تُضبط إعدادات القاعدة في config.js،
 *     وبذلك تبقى صفحة المنيو تماماً كما هي منشورة اليوم.
 *
 *  لا يُشغّل إلا بعد اكتمال رسم الصفحة الأولى حتى لا ترتجف.
 * =========================================================================== */
(function () {
    'use strict';

    var C = window.KH_CONFIG || {};

    /* شروط عدم التشغيل — الصفحة تبقى كما هي */
    if (!C.SUPABASE_URL || !C.SUPABASE_ANON_KEY) return;
    if (typeof ALL === 'undefined' || typeof SC === 'undefined') return;
    if (typeof renderGrid !== 'function') return;

    var CUR = C.CURRENCY || 'د.ل';
    var START_DELAY = 1500;   // انتظار قبل أول محاولة
    var RETRY_DELAY = 4000;   // إعادة المحاولة بعد فشل واحد

    /* ---------------------------------------------------------------- utils */
    function curCat() {
        try { return new URLSearchParams(location.search).get('cat') || 'all'; }
        catch (e) { return 'all'; }
    }

    /** نص السعر المعروض لخيار واحد (يُنسخ من القاعدة إن وُجد) */
    function optText(o) {
        if (o.price_text) return o.price_text;
        if (o.price != null && o.price !== '') return o.price + ' ' + CUR;
        return '';
    }

    /** إيجاد خيار في القاعدة مطابقاً لاسم خيار الصفحة، وإلا بالترتيب */
    function optAt(opts, label, i) {
        if (label) {
            for (var k = 0; k < opts.length; k++) {
                if ((opts[k].label || opts[k].name) === label) return opts[k];
            }
        }
        return opts[i] || null;
    }

    /* --------------------------------------------------------------- merge */
    /**
     * يطبّق صف القاعدة على صنف موجود في الصفحة.
     * يحافظ على شكل العرض الأصلي (prices / variants / price) ويغيّر النصوص فقط،
     * فلو لم يتغيّر السعر في اللوحة لا يتغيّر في الصفحة أي تغيير.
     */
    function mergeInto(t, row) {
        var changed = false, i, o, txt;

        if (row.options && row.options.length) {
            var lists = t.prices || t.variants;
            if (lists && lists.length === row.options.length) {
                for (i = 0; i < lists.length; i++) {
                    o = optAt(row.options, lists[i].label || lists[i].name, i);
                    if (!o) continue;
                    txt = optText(o);
                    if (lists[i].price !== txt) { lists[i].price = txt; changed = true; }
                }
            } else if (lists) {
                /* تغيّر عدد الخيارات — نعيد البناء بالشكل نفسه */
                var key = t.prices ? 'label' : 'name';
                var rebuilt = row.options.map(function (op) {
                    var e = {}; e[key] = op.label || op.name || ''; e.price = optText(op); return e;
                });
                if (t.prices) t.prices = rebuilt; else t.variants = rebuilt;
                changed = true;
            } else {
                /* الصنف كان بسعر مفرد (أو بوكس اختيار) وأضيفت له خيارات */
                delete t.price;
                delete t.customBox;
                t.prices = row.options.map(function (op) {
                    return { label: op.label || op.name || '', price: optText(op) };
                });
                changed = true;
            }
            if (t.price && row.options.length) { delete t.price; changed = true; }
        } else if (row.price_text) {
            /* بوكس الاختيار المخصص: الحقل price_text في القاعدة يحمل نص الملاحظة
               وليس سعراً. إن كان مطابقاً للملاحظة الأصلية فلا شيء تغيّر إطلاقاً. */
            if (t.customBox && row.price_text === (t.note || '')) {
                /* لا شيء */
            } else if (t.price !== row.price_text) {
                t.price = row.price_text;
                changed = true;
            }
        }
        return changed;
    }

    /** تحويل صف القاعدة إلى صنف جديد بالشكل الذي تعرفه الصفحة */
    function toNew(row) {
        var it = {
            id: row.id,
            ar: row.ar,
            it: row.it || '',
            cat: row.category,
            img: row.image || ''
        };
        if (row.sub) it.sub = row.sub;
        if (row.options && row.options.length) {
            it.prices = row.options.map(function (op) {
                return { label: op.label || op.name || '', price: optText(op) };
            });
        } else if (row.price_text) {
            it.price = row.price_text;
        }
        return it;
    }

    /* ------------------------------------------------------------- render */
    var rendering = false;
    function rerender() {
        if (rendering) return;
        /* لا نعيد الرسم أثناء حركة تبديل التصنيفات */
        if (typeof filtering !== 'undefined' && filtering) {
            setTimeout(rerender, 350);
            return;
        }
        rendering = true;
        try { renderGrid(curCat()); }
        catch (e) { if (window.console) console.warn('[menu-sync]', e); }
        rendering = false;
    }

    /* --------------------------------------------------------------- main */
    function loadLib(cb) {
        if (window.supabase && window.supabase.createClient) return cb();
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
        s.onload = function () { cb(); };
        s.onerror = function () { /* نبقى على البيانات الثابتة */ };
        document.head.appendChild(s);
    }

    async function sync(retry) {
        var sb;
        try {
            sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
        } catch (e) { return; }

        var res = await sb.from('menu_items')
            .select('id,ar,it,category,sub,price_text,options,image,active')
            .eq('active', true);

        if (res.error || !res.data) {
            /* فشل الشبكة/الجلسة → نبقى على المنيو الثابت ونعيد المحاولة مرّة */
            if (retry) setTimeout(function () { sync(false); }, RETRY_DELAY);
            return;
        }

        var rows = res.data;
        /* حماية: لا نحذف شيئاً إن لم تصل القائمة كاملة (استيراد ناقص أو فاشل) */
        var complete = rows.length >= Math.min(20, ALL.length * 0.5);

        var byId = {};
        rows.forEach(function (r) { byId[r.id] = r; });

        var changed = 0;

        /* 1) تحديث/إضافة */
        rows.forEach(function (r) {
            if (SC[r.category] === undefined) return;   // تصنيف غير معروف للصفحة

            var idx = -1;
            for (var i = 0; i < ALL.length; i++) { if (ALL[i].id === r.id) { idx = i; break; } }

            if (idx >= 0) {
                if (mergeInto(ALL[idx], r)) changed++;
            } else {
                ALL.push(toNew(r));
                changed++;
            }
        });

        /* 2) إخفاء الأصناف التي أبعدها المدير (فقط عند وصول القائمة كاملة) */
        if (complete) {
            for (var j = ALL.length - 1; j >= 0; j--) {
                if (byId[ALL[j].id] === undefined) { ALL.splice(j, 1); changed++; }
            }
        }

        if (changed > 0) rerender();
    }

    /* أول تشغيل بعد اكتمال رسم الصفحة */
    setTimeout(function () { loadLib(function () { sync(true); }); }, START_DELAY);
})();
