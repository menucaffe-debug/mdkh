/* ===========================================================================
 *  KH IL VOSTRO CAFFÈ — إعدادات النظام المشترك
 *  هذا هو الملف الوحيد الذي تعدل عند ربط قاعدة البيانات.
 *
 *  ⚠️ المفتاح هنا هو مفتاح `anon public` — مصمَّم للنشر في المتصفح وهو آمن.
 *     الحماية الحقيقية تأتي من سياسات Row Level Security في القاعدة.
 *
 *  أين تجده: Supabase → Project Settings → API
 * =========================================================================== */
window.KH_CONFIG = {
    SUPABASE_URL: '',            // مثال: https://abcdefghij.supabase.co
    SUPABASE_ANON_KEY: '',       // يبدأ بـ eyJhbGciOi...
    WHATSAPP: '218914041333',    // رقم المقهى على واتساب
    CURRENCY: 'د.ل'
};

/* --------------------------------------------------------------------------
 *  خريطة التصنيفات — مرآة لـ SC في index.html
 *  أضف صنفاً جديداً داخل تصنيف قائم، لأن صفحة المنيو ترتّب الأقسام بهذا
 *  الترتيب ولا تعرف تصنيفاً لم تُعرَّف هنا.
 * ------------------------------------------------------------------------ */
window.KH_CATEGORIES = {
    hotcoffee:     { ar: 'قهوة وشاي ساخن',  it: 'Caffè e Tè Caldo' },
    coldcoffee:    { ar: 'قهوة وشاي بارد',  it: 'Caffè e Tè Freddo' },
    juices:        { ar: 'العصائر',         it: 'Succi' },
    tropical:      { ar: 'تروبيكال',        it: 'Tropical' },
    smoothieshake: { ar: 'سموثي وميلك شيك', it: 'Frullati e Milkshake' },
    mojito:        { ar: 'الموخيتو',        it: 'Mojito' },
    frappe:        { ar: 'الفربي',          it: 'Frappé' },
    slush:         { ar: 'السلاش',          it: 'Slush' },
    breakfast:     { ar: 'إفطار صباحي',     it: 'Colazione' },
    eveningbox:    { ar: 'بوكس مسائي',     it: 'Box Serale' },
    dolci:         { ar: 'الحلويات',        it: 'Dolci' }
};

/* ترتيب الأقسام كما تظهر في صفحة المنيو */
window.KH_CATEGORY_ORDER = [
    'hotcoffee', 'coldcoffee', 'juices', 'tropical', 'smoothieshake', 'mojito',
    'frappe', 'slush', 'breakfast', 'eveningbox', 'dolci'
];
