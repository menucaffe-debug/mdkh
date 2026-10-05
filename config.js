/* ===========================================================================
 *  KH IL VOSTRO CAFFÈ — إعدادات المنيو
 *  نسخة فرونت اند فقط: لا قاعدة بيانات ولا أي استدعاء خارجي للخادم.
 *  كل شيء (المنيو، السلة، الطلب) يعمل داخل المتصفح.
 * =========================================================================== */
window.KH_CONFIG = {
    /* رقم المقهى على واتساب: رمز الدولة + الرقم، بدون + وبدون مسافات */
    WHATSAPP: '218916666009',
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
