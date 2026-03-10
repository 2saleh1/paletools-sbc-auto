# Paletools SBC Auto Completer

أداة متطورة لأتمتة إكمال SBC وفتح الباكات وإدارة اللاعبين المكررين في EA FC Ultimate Team

---

## 🌐 الموقع المباشر

**https://2saleh1.github.io/paletools-sbc-auto/**

---

## دليل الاستخدام الكامل

**[📱 افتح دليل التثبيت التفاعلي](https://2saleh1.github.io/paletools-sbc-auto/)**

الدليل يحتوي على:
- تعليمات التثبيت التفاعلية (drag & drop bookmarklet)
- شرح كامل للمميزات
- خطوات الاستخدام التفصيلية
- جدول الإعدادات
- حلول المشاكل الشائعة

---

## المميزات الرئيسية

### إكمال SBCs تلقائياً
- اختيار SBC من قائمة متاحة
- استخدام Smart Build من Paletools لتعبئة التشكيلة
- تسليم واستلام الجوائز تلقائياً

### إدارة اللاعبين المكررين
- **الذهبيين**: إرسال إلى SBC Storage
- **البرونز والسلفر**: بيع سريع (Quick Sell)
- **إيقاف ذكي**: توقف تلقائي عند امتلاء Storage

### لوحة تحكم متقدمة
- إحصائيات حية (SBCs مكتملة، باكات مفتوحة)
- إعدادات قابلة للتخصيص
- سجل مباشر للعمليات

---

## التثبيت السريع

### طريقة 1: Bookmarklet (موصى به للجوال)

1. افتح **[الدليل التفاعلي](https://2saleh1.github.io/paletools-sbc-auto/)**
2. اسحب رابط "SBC Auto Completer" إلى شريط المفضلة
3. في EA FC Web App (بعد تشغيل Paletools)، اضغط على Bookmark

### طريقة 2: Console (للكمبيوتر)

1. افتح EA FC Web App
2. شغل Paletools أولاً
3. افتح Console (F12)
4. انسخ محتوى `sbc-auto-complete.js` والصقه في Console

---

## الاستخدام

1. شغل Paletools (مطلوب)
2. شغل السكربت (Bookmark أو Console)
3. اضغط "Load SBC List"
4. اختر SBC وحدد عدد الدورات
5. اضغط "Start"

**[للتفاصيل الكاملة، افتح الدليل التفاعلي](https://2saleh1.github.io/paletools-sbc-auto/)**

---

## الإعدادات

يمكن التعديل من ملف `sbc-auto-complete.js`:

```javascript
const CONFIG = {
    WAIT_TIME: 2000,                         // وقت الانتظار بين العمليات
    GOLD_DUPLICATES_TO_SBC_STORAGE: true,    // الذهبيين → Storage
    BRONZE_SILVER_QUICK_SELL: true,          // البرونز/السلفر → Quick Sell
    STOP_ON_SBC_STORAGE_FULL: true,          // إيقاف عند امتلاء Storage
    PACKS_PER_SBC: 1                         // عدد الباكات بعد كل SBC
};
```

---

## تحذيرات

- استخدم الأداة على مسؤوليتك الخاصة
- EA قد تعتبر هذا مخالفاً لشروط الاستخدام
- راقب السكربت دائماً ولا تتركه بدون مراقبة
- جرب على SBCs رخيصة أولاً
- السكربت يتطلب Paletools نشطاً

---

## الملفات

- **sbc-auto-complete.js** - السكربت الرئيسي
- **guide.html** - دليل تفاعلي كامل
- **README.md** - هذا الملف

---

**EA FC Ultimate Team Community Tool**
