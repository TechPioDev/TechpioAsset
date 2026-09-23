/**
 * Hindi and Punjabi in the app (Phase 8, v2.84 / app 0.3.39).
 *
 * English is the source. Every other language is a partial overlay: a key it
 * does not carry falls back to English, so a screen is never half-empty and a
 * new English string is never a crash - it simply shows in English until it
 * is translated.
 *
 * What is translated: what an employee sees day to day - signing in, Home,
 * their equipment, raising a request, reporting a problem, confirming
 * receipt, and the sync screens. Administration, procurement, licences and
 * the other back-office screens stay in English for now, and are honest
 * about it rather than half-translated.
 *
 * Amounts are not translated: PioAssets shows rupees with Indian grouping
 * (formatInr) in every language, because that is how the money is written.
 */

export const LANGUAGES = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { code: 'pa', label: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
] as const;

export type Lang = (typeof LANGUAGES)[number]['code'];

export const EN = {
  // Common
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.save': 'Save',
  'common.send': 'Send',
  'common.retry': 'Try again',
  'common.search': 'Search',
  'common.seeAll': 'See all',
  'common.loading': 'Loading…',
  'common.optional': 'Optional',
  'common.notNow': 'Not now',
  'common.gotIt': 'Got it',
  'common.noConnection': 'No connection',

  // Sign in
  'login.welcome': 'Welcome back',
  'login.subtitle': 'Sign in to your PioAssets account to continue.',
  'login.unlock': 'Unlock with biometrics',
  'login.email': 'Work email',
  'login.password': 'Password',
  'login.forgot': 'Forgot password?',
  'login.signIn': 'Sign in',
  'login.audited': 'Sessions expire automatically and every action is audited.',

  // Tabs and menu
  'tab.home': 'Home',
  'tab.assets': 'Assets',
  'tab.requests': 'Requests',
  'tab.approvals': 'Awaiting me',
  'tab.scan': 'Scan',
  'tab.inventory': 'Count',
  'tab.menu': 'Menu',

  // Home
  'home.welcome': 'Welcome back,',
  'home.focus.employee': 'Your equipment and your requests',
  'home.focus.approver': 'Requests waiting for your decision',
  'home.myAssets': 'My assets',
  'home.noAssets': 'No assets yet',
  'home.noAssetsBody': 'Equipment issued to you will appear here.',
  'home.action.request': 'New request',
  'home.action.problem': 'Report a problem',
  'home.action.equipment': 'My equipment',
  'home.action.scan': 'Scan',

  // Confirm receipt
  'receipt.title': 'Confirm what you received',
  'receipt.oneItem': 'One item was handed to you. Only confirm what is with you now.',
  'receipt.manyItems': '{count} items were handed to you. Only confirm what is with you now.',
  'receipt.confirm': 'Confirm',
  'receipt.more': 'and {count} more in My equipment',
  'receipt.failed': 'Could not confirm. Check your connection and try again.',

  // My equipment
  'equipment.title': 'My equipment',
  'equipment.section': 'Equipment',
  'equipment.consumables': 'Consumables',
  'equipment.none': 'Nothing issued to you',
  'equipment.noneBody': 'Equipment assigned to you will appear here.',

  // Requests
  'requests.new': 'New request',
  'requests.what': 'What do you need?',
  'requests.whatHint': 'e.g. Laptop docking station',
  'requests.reason': 'Business reason',
  'requests.reasonHint': 'Why do you need it? (at least 10 characters)',
  'requests.submit': 'Submit request',
  'requests.yours': 'Your requests',
  'requests.none': 'No requests yet',
  'requests.noneBody': 'Requests you raise will appear here.',
  'requests.photosHelp': 'Photos of the fault or the item help approvers decide.',

  // Report a problem
  'problem.title': 'Report a problem',
  'problem.whichItem': 'Which item?',
  'problem.noItems': 'Nothing is issued to you, so this goes to IT as a general report.',
  'problem.whatIsWrong': 'What is wrong?',
  'problem.photoHelps': 'A photo shows IT the fault',
  'problem.anythingElse': 'Anything IT should know?',
  'problem.optional': 'Optional. You can send it as it is.',
  'problem.whatHappened': 'What happened? (optional)',
  'problem.send': 'Send to IT',
  'problem.pickFirst': 'Pick what is wrong first.',
  'problem.sent': 'Problem reported',
  'problem.sentBody': 'IT has it now. You can follow it, and reply, from the request.',

  // Sync (recorded with no signal)
  'sync.title': 'Waiting to sync',
  'sync.sendNow': 'Send now',
  'sync.sending': 'Sending…',
  'sync.waiting': 'Waiting to send',
  'sync.needsYou': 'Needs you',
  'sync.allSent': 'All sent',
  'sync.allSentBody': 'Nothing recorded offline is waiting.',
  'sync.discard': 'Discard',
  'sync.discardConfirm': 'Tap again to discard',
  'sync.openAsset': 'Open asset',
  'sync.bannerOne': '1 change waiting to send',
  'sync.bannerMany': '{count} changes waiting to send',
  'sync.bannerNeedsOne': '1 change needs you',
  'sync.bannerNeedsMany': '{count} changes need you',
  'sync.bannerHint': 'Recorded with no signal. Sent automatically when you are back online.',
  'sync.bannerNeedsHint': 'Someone else changed it first. Review.',
  'sync.review': 'Review',
  'sync.details': 'Details',

  // Asset statuses (what an employee sees on their own kit)
  'status.AVAILABLE': 'Available',
  'status.ASSIGNED': 'Assigned',
  'status.IN_USE': 'In use',
  'status.IN_STORAGE': 'In storage',
  'status.IN_TRANSIT': 'In transit',
  'status.UNDER_REPAIR': 'Under repair',
  'status.DAMAGED': 'Damaged',
  'status.LOST': 'Lost',
  'status.RETURNED': 'Returned',
  'status.RETIRED': 'Retired',

  // Language picker
  'language.title': 'Language',
  'language.subtitle': 'Saved on this phone. Amounts stay in rupees in every language.',
  'language.partial':
    'Hindi and Punjabi cover the screens you use day to day. Anything not yet translated stays in English.',
} as const;

export type StringKey = keyof typeof EN;

/** Hindi. Reviewed by: pending the owner's check (Phase 8). */
export const HI: Partial<Record<StringKey, string>> = {
  'common.cancel': 'रद्द करें',
  'common.close': 'बंद करें',
  'common.save': 'सहेजें',
  'common.send': 'भेजें',
  'common.retry': 'फिर कोशिश करें',
  'common.search': 'खोजें',
  'common.seeAll': 'सब देखें',
  'common.loading': 'लोड हो रहा है…',
  'common.optional': 'वैकल्पिक',
  'common.notNow': 'अभी नहीं',
  'common.gotIt': 'ठीक है',
  'common.noConnection': 'कोई कनेक्शन नहीं',

  'login.welcome': 'फिर से स्वागत है',
  'login.subtitle': 'आगे बढ़ने के लिए अपने PioAssets खाते में साइन इन करें।',
  'login.unlock': 'बायोमेट्रिक से अनलॉक करें',
  'login.email': 'कार्यालय ईमेल',
  'login.password': 'पासवर्ड',
  'login.forgot': 'पासवर्ड भूल गए?',
  'login.signIn': 'साइन इन करें',
  'login.audited': 'सत्र अपने आप समाप्त होते हैं और हर कार्रवाई का रिकॉर्ड रखा जाता है।',

  'tab.home': 'होम',
  'tab.assets': 'संपत्तियाँ',
  'tab.requests': 'अनुरोध',
  'tab.approvals': 'मेरी प्रतीक्षा में',
  'tab.scan': 'स्कैन',
  'tab.inventory': 'गिनती',
  'tab.menu': 'मेन्यू',

  'home.welcome': 'फिर से स्वागत है,',
  'home.focus.employee': 'आपके उपकरण और आपके अनुरोध',
  'home.focus.approver': 'आपके निर्णय की प्रतीक्षा करते अनुरोध',
  'home.myAssets': 'मेरी संपत्तियाँ',
  'home.noAssets': 'अभी कोई संपत्ति नहीं',
  'home.noAssetsBody': 'आपको दिए गए उपकरण यहाँ दिखेंगे।',
  'home.action.request': 'नया अनुरोध',
  'home.action.problem': 'समस्या बताएं',
  'home.action.equipment': 'मेरे उपकरण',
  'home.action.scan': 'स्कैन',

  'receipt.title': 'जो मिला है उसकी पुष्टि करें',
  'receipt.oneItem': 'एक वस्तु आपको दी गई है। केवल वही पुष्टि करें जो अभी आपके पास है।',
  'receipt.manyItems': '{count} वस्तुएँ आपको दी गई हैं। केवल वही पुष्टि करें जो अभी आपके पास हैं।',
  'receipt.confirm': 'पुष्टि करें',
  'receipt.more': 'और {count} अधिक — मेरे उपकरण में',
  'receipt.failed': 'पुष्टि नहीं हो सकी। कनेक्शन जाँचें और फिर कोशिश करें।',

  'equipment.title': 'मेरे उपकरण',
  'equipment.section': 'उपकरण',
  'equipment.consumables': 'उपभोग्य वस्तुएँ',
  'equipment.none': 'आपको कुछ नहीं दिया गया है',
  'equipment.noneBody': 'आपको दिए गए उपकरण यहाँ दिखेंगे।',

  'requests.new': 'नया अनुरोध',
  'requests.what': 'आपको क्या चाहिए?',
  'requests.whatHint': 'जैसे लैपटॉप डॉकिंग स्टेशन',
  'requests.reason': 'कारण',
  'requests.reasonHint': 'यह क्यों चाहिए? (कम से कम 10 अक्षर)',
  'requests.submit': 'अनुरोध भेजें',
  'requests.yours': 'आपके अनुरोध',
  'requests.none': 'अभी कोई अनुरोध नहीं',
  'requests.noneBody': 'आपके भेजे गए अनुरोध यहाँ दिखेंगे।',
  'requests.photosHelp': 'खराबी या वस्तु की तस्वीरें निर्णय लेने में मदद करती हैं।',

  'problem.title': 'समस्या बताएं',
  'problem.whichItem': 'कौन सी वस्तु?',
  'problem.noItems': 'आपको कोई उपकरण नहीं दिया गया है, इसलिए यह IT को सामान्य रिपोर्ट के रूप में जाएगा।',
  'problem.whatIsWrong': 'क्या खराबी है?',
  'problem.photoHelps': 'तस्वीर से IT को खराबी दिखती है',
  'problem.anythingElse': 'IT को और क्या बताना चाहेंगे?',
  'problem.optional': 'वैकल्पिक। आप इसे ऐसे ही भेज सकते हैं।',
  'problem.whatHappened': 'क्या हुआ? (वैकल्पिक)',
  'problem.send': 'IT को भेजें',
  'problem.pickFirst': 'पहले चुनें कि क्या खराबी है।',
  'problem.sent': 'समस्या दर्ज हो गई',
  'problem.sentBody': 'IT के पास पहुँच गई है। आप अनुरोध में जाकर उत्तर दे सकते हैं।',

  'sync.title': 'भेजे जाने की प्रतीक्षा में',
  'sync.sendNow': 'अभी भेजें',
  'sync.sending': 'भेजा जा रहा है…',
  'sync.waiting': 'भेजने के लिए बाकी',
  'sync.needsYou': 'आपकी ज़रूरत है',
  'sync.allSent': 'सब भेज दिया गया',
  'sync.allSentBody': 'बिना नेटवर्क दर्ज किया कुछ भी बाकी नहीं है।',
  'sync.discard': 'हटाएँ',
  'sync.discardConfirm': 'हटाने के लिए फिर दबाएँ',
  'sync.openAsset': 'संपत्ति खोलें',
  'sync.bannerOne': '1 बदलाव भेजा जाना बाकी है',
  'sync.bannerMany': '{count} बदलाव भेजे जाने बाकी हैं',
  'sync.bannerNeedsOne': '1 बदलाव को आपकी ज़रूरत है',
  'sync.bannerNeedsMany': '{count} बदलावों को आपकी ज़रूरत है',
  'sync.bannerHint': 'बिना नेटवर्क दर्ज किया गया। नेटवर्क आते ही अपने आप भेज दिया जाएगा।',
  'sync.bannerNeedsHint': 'किसी और ने पहले बदल दिया था। देखें।',
  'sync.review': 'देखें',
  'sync.details': 'विवरण',

  'status.AVAILABLE': 'उपलब्ध',
  'status.ASSIGNED': 'सौंपी गई',
  'status.IN_USE': 'उपयोग में',
  'status.IN_STORAGE': 'भंडार में',
  'status.IN_TRANSIT': 'रास्ते में',
  'status.UNDER_REPAIR': 'मरम्मत में',
  'status.DAMAGED': 'क्षतिग्रस्त',
  'status.LOST': 'गुम',
  'status.RETURNED': 'वापस ली गई',
  'status.RETIRED': 'सेवा से हटाई गई',

  'language.title': 'भाषा',
  'language.subtitle': 'इस फ़ोन पर सहेजा जाता है। हर भाषा में रकम रुपये में ही रहती है।',
  'language.partial':
    'हिन्दी और पंजाबी रोज़ काम आने वाली स्क्रीन पर उपलब्ध हैं। जो अभी अनूदित नहीं है वह अंग्रेज़ी में रहेगा।',
};

/** Punjabi (Gurmukhi). Reviewed by: pending the owner's check (Phase 8). */
export const PA: Partial<Record<StringKey, string>> = {
  'common.cancel': 'ਰੱਦ ਕਰੋ',
  'common.close': 'ਬੰਦ ਕਰੋ',
  'common.save': 'ਸੰਭਾਲੋ',
  'common.send': 'ਭੇਜੋ',
  'common.retry': 'ਮੁੜ ਕੋਸ਼ਿਸ਼ ਕਰੋ',
  'common.search': 'ਖੋਜੋ',
  'common.seeAll': 'ਸਭ ਵੇਖੋ',
  'common.loading': 'ਲੋਡ ਹੋ ਰਿਹਾ ਹੈ…',
  'common.optional': 'ਚੋਣਵਾਂ',
  'common.notNow': 'ਹੁਣੇ ਨਹੀਂ',
  'common.gotIt': 'ਠੀਕ ਹੈ',
  'common.noConnection': 'ਕੋਈ ਕਨੈਕਸ਼ਨ ਨਹੀਂ',

  'login.welcome': 'ਮੁੜ ਜੀ ਆਇਆਂ ਨੂੰ',
  'login.subtitle': 'ਅੱਗੇ ਵਧਣ ਲਈ ਆਪਣੇ PioAssets ਖਾਤੇ ਵਿੱਚ ਸਾਈਨ ਇਨ ਕਰੋ।',
  'login.unlock': 'ਬਾਇਓਮੈਟ੍ਰਿਕ ਨਾਲ ਅਨਲੌਕ ਕਰੋ',
  'login.email': 'ਦਫ਼ਤਰੀ ਈਮੇਲ',
  'login.password': 'ਪਾਸਵਰਡ',
  'login.forgot': 'ਪਾਸਵਰਡ ਭੁੱਲ ਗਏ?',
  'login.signIn': 'ਸਾਈਨ ਇਨ ਕਰੋ',
  'login.audited': 'ਸੈਸ਼ਨ ਆਪਣੇ ਆਪ ਖ਼ਤਮ ਹੁੰਦੇ ਹਨ ਅਤੇ ਹਰ ਕਾਰਵਾਈ ਦਾ ਰਿਕਾਰਡ ਰੱਖਿਆ ਜਾਂਦਾ ਹੈ।',

  'tab.home': 'ਹੋਮ',
  'tab.assets': 'ਸੰਪਤੀਆਂ',
  'tab.requests': 'ਬੇਨਤੀਆਂ',
  'tab.approvals': 'ਮੇਰੀ ਉਡੀਕ ਵਿੱਚ',
  'tab.scan': 'ਸਕੈਨ',
  'tab.inventory': 'ਗਿਣਤੀ',
  'tab.menu': 'ਮੀਨੂ',

  'home.welcome': 'ਮੁੜ ਜੀ ਆਇਆਂ ਨੂੰ,',
  'home.focus.employee': 'ਤੁਹਾਡੇ ਉਪਕਰਨ ਅਤੇ ਤੁਹਾਡੀਆਂ ਬੇਨਤੀਆਂ',
  'home.focus.approver': 'ਤੁਹਾਡੇ ਫ਼ੈਸਲੇ ਦੀ ਉਡੀਕ ਕਰਦੀਆਂ ਬੇਨਤੀਆਂ',
  'home.myAssets': 'ਮੇਰੀਆਂ ਸੰਪਤੀਆਂ',
  'home.noAssets': 'ਹਾਲੇ ਕੋਈ ਸੰਪਤੀ ਨਹੀਂ',
  'home.noAssetsBody': 'ਤੁਹਾਨੂੰ ਦਿੱਤੇ ਉਪਕਰਨ ਇੱਥੇ ਦਿਖਣਗੇ।',
  'home.action.request': 'ਨਵੀਂ ਬੇਨਤੀ',
  'home.action.problem': 'ਸਮੱਸਿਆ ਦੱਸੋ',
  'home.action.equipment': 'ਮੇਰੇ ਉਪਕਰਨ',
  'home.action.scan': 'ਸਕੈਨ',

  'receipt.title': 'ਜੋ ਮਿਲਿਆ ਹੈ ਉਸ ਦੀ ਪੁਸ਼ਟੀ ਕਰੋ',
  'receipt.oneItem': 'ਇੱਕ ਚੀਜ਼ ਤੁਹਾਨੂੰ ਦਿੱਤੀ ਗਈ ਹੈ। ਸਿਰਫ਼ ਉਹੀ ਪੁਸ਼ਟੀ ਕਰੋ ਜੋ ਹੁਣ ਤੁਹਾਡੇ ਕੋਲ ਹੈ।',
  'receipt.manyItems': '{count} ਚੀਜ਼ਾਂ ਤੁਹਾਨੂੰ ਦਿੱਤੀਆਂ ਗਈਆਂ ਹਨ। ਸਿਰਫ਼ ਉਹੀ ਪੁਸ਼ਟੀ ਕਰੋ ਜੋ ਹੁਣ ਤੁਹਾਡੇ ਕੋਲ ਹਨ।',
  'receipt.confirm': 'ਪੁਸ਼ਟੀ ਕਰੋ',
  'receipt.more': 'ਅਤੇ {count} ਹੋਰ — ਮੇਰੇ ਉਪਕਰਨ ਵਿੱਚ',
  'receipt.failed': 'ਪੁਸ਼ਟੀ ਨਹੀਂ ਹੋ ਸਕੀ। ਕਨੈਕਸ਼ਨ ਵੇਖੋ ਅਤੇ ਮੁੜ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',

  'equipment.title': 'ਮੇਰੇ ਉਪਕਰਨ',
  'equipment.section': 'ਉਪਕਰਨ',
  'equipment.consumables': 'ਖਪਤ ਵਾਲੀਆਂ ਚੀਜ਼ਾਂ',
  'equipment.none': 'ਤੁਹਾਨੂੰ ਕੁਝ ਨਹੀਂ ਦਿੱਤਾ ਗਿਆ',
  'equipment.noneBody': 'ਤੁਹਾਨੂੰ ਦਿੱਤੇ ਉਪਕਰਨ ਇੱਥੇ ਦਿਖਣਗੇ।',

  'requests.new': 'ਨਵੀਂ ਬੇਨਤੀ',
  'requests.what': 'ਤੁਹਾਨੂੰ ਕੀ ਚਾਹੀਦਾ ਹੈ?',
  'requests.whatHint': 'ਜਿਵੇਂ ਲੈਪਟਾਪ ਡੌਕਿੰਗ ਸਟੇਸ਼ਨ',
  'requests.reason': 'ਕਾਰਨ',
  'requests.reasonHint': 'ਇਹ ਕਿਉਂ ਚਾਹੀਦਾ ਹੈ? (ਘੱਟੋ-ਘੱਟ 10 ਅੱਖਰ)',
  'requests.submit': 'ਬੇਨਤੀ ਭੇਜੋ',
  'requests.yours': 'ਤੁਹਾਡੀਆਂ ਬੇਨਤੀਆਂ',
  'requests.none': 'ਹਾਲੇ ਕੋਈ ਬੇਨਤੀ ਨਹੀਂ',
  'requests.noneBody': 'ਤੁਹਾਡੀਆਂ ਭੇਜੀਆਂ ਬੇਨਤੀਆਂ ਇੱਥੇ ਦਿਖਣਗੀਆਂ।',
  'requests.photosHelp': 'ਖ਼ਰਾਬੀ ਜਾਂ ਚੀਜ਼ ਦੀਆਂ ਤਸਵੀਰਾਂ ਫ਼ੈਸਲੇ ਵਿੱਚ ਮਦਦ ਕਰਦੀਆਂ ਹਨ।',

  'problem.title': 'ਸਮੱਸਿਆ ਦੱਸੋ',
  'problem.whichItem': 'ਕਿਹੜੀ ਚੀਜ਼?',
  'problem.noItems': 'ਤੁਹਾਨੂੰ ਕੋਈ ਉਪਕਰਨ ਨਹੀਂ ਦਿੱਤਾ ਗਿਆ, ਇਸ ਲਈ ਇਹ IT ਨੂੰ ਆਮ ਰਿਪੋਰਟ ਵਜੋਂ ਜਾਵੇਗੀ।',
  'problem.whatIsWrong': 'ਕੀ ਖ਼ਰਾਬੀ ਹੈ?',
  'problem.photoHelps': 'ਤਸਵੀਰ ਨਾਲ IT ਨੂੰ ਖ਼ਰਾਬੀ ਦਿਖਦੀ ਹੈ',
  'problem.anythingElse': 'IT ਨੂੰ ਹੋਰ ਕੀ ਦੱਸਣਾ ਚਾਹੋਗੇ?',
  'problem.optional': 'ਚੋਣਵਾਂ। ਤੁਸੀਂ ਇਸ ਨੂੰ ਇੰਝ ਹੀ ਭੇਜ ਸਕਦੇ ਹੋ।',
  'problem.whatHappened': 'ਕੀ ਹੋਇਆ? (ਚੋਣਵਾਂ)',
  'problem.send': 'IT ਨੂੰ ਭੇਜੋ',
  'problem.pickFirst': 'ਪਹਿਲਾਂ ਚੁਣੋ ਕਿ ਕੀ ਖ਼ਰਾਬੀ ਹੈ।',
  'problem.sent': 'ਸਮੱਸਿਆ ਦਰਜ ਹੋ ਗਈ',
  'problem.sentBody': 'IT ਕੋਲ ਪਹੁੰਚ ਗਈ ਹੈ। ਤੁਸੀਂ ਬੇਨਤੀ ਵਿੱਚ ਜਾ ਕੇ ਜਵਾਬ ਦੇ ਸਕਦੇ ਹੋ।',

  'sync.title': 'ਭੇਜੇ ਜਾਣ ਦੀ ਉਡੀਕ ਵਿੱਚ',
  'sync.sendNow': 'ਹੁਣੇ ਭੇਜੋ',
  'sync.sending': 'ਭੇਜਿਆ ਜਾ ਰਿਹਾ ਹੈ…',
  'sync.waiting': 'ਭੇਜਣ ਲਈ ਬਾਕੀ',
  'sync.needsYou': 'ਤੁਹਾਡੀ ਲੋੜ ਹੈ',
  'sync.allSent': 'ਸਭ ਭੇਜ ਦਿੱਤਾ',
  'sync.allSentBody': 'ਬਿਨਾਂ ਨੈੱਟਵਰਕ ਦਰਜ ਕੀਤਾ ਕੁਝ ਵੀ ਬਾਕੀ ਨਹੀਂ।',
  'sync.discard': 'ਹਟਾਓ',
  'sync.discardConfirm': 'ਹਟਾਉਣ ਲਈ ਮੁੜ ਦਬਾਓ',
  'sync.openAsset': 'ਸੰਪਤੀ ਖੋਲ੍ਹੋ',
  'sync.bannerOne': '1 ਤਬਦੀਲੀ ਭੇਜਣੀ ਬਾਕੀ ਹੈ',
  'sync.bannerMany': '{count} ਤਬਦੀਲੀਆਂ ਭੇਜਣੀਆਂ ਬਾਕੀ ਹਨ',
  'sync.bannerNeedsOne': '1 ਤਬਦੀਲੀ ਨੂੰ ਤੁਹਾਡੀ ਲੋੜ ਹੈ',
  'sync.bannerNeedsMany': '{count} ਤਬਦੀਲੀਆਂ ਨੂੰ ਤੁਹਾਡੀ ਲੋੜ ਹੈ',
  'sync.bannerHint': 'ਬਿਨਾਂ ਨੈੱਟਵਰਕ ਦਰਜ ਕੀਤਾ। ਨੈੱਟਵਰਕ ਆਉਂਦੇ ਹੀ ਆਪਣੇ ਆਪ ਭੇਜ ਦਿੱਤਾ ਜਾਵੇਗਾ।',
  'sync.bannerNeedsHint': 'ਕਿਸੇ ਹੋਰ ਨੇ ਪਹਿਲਾਂ ਬਦਲ ਦਿੱਤਾ ਸੀ। ਵੇਖੋ।',
  'sync.review': 'ਵੇਖੋ',
  'sync.details': 'ਵੇਰਵਾ',

  'status.AVAILABLE': 'ਉਪਲਬਧ',
  'status.ASSIGNED': 'ਸੌਂਪੀ ਗਈ',
  'status.IN_USE': 'ਵਰਤੋਂ ਵਿੱਚ',
  'status.IN_STORAGE': 'ਭੰਡਾਰ ਵਿੱਚ',
  'status.IN_TRANSIT': 'ਰਾਹ ਵਿੱਚ',
  'status.UNDER_REPAIR': 'ਮੁਰੰਮਤ ਵਿੱਚ',
  'status.DAMAGED': 'ਖ਼ਰਾਬ',
  'status.LOST': 'ਗੁੰਮ',
  'status.RETURNED': 'ਵਾਪਸ ਲਈ ਗਈ',
  'status.RETIRED': 'ਸੇਵਾ ਤੋਂ ਹਟਾਈ ਗਈ',

  'language.title': 'ਭਾਸ਼ਾ',
  'language.subtitle': 'ਇਸ ਫ਼ੋਨ ਉੱਤੇ ਸੰਭਾਲਿਆ ਜਾਂਦਾ ਹੈ। ਹਰ ਭਾਸ਼ਾ ਵਿੱਚ ਰਕਮ ਰੁਪਏ ਵਿੱਚ ਹੀ ਰਹਿੰਦੀ ਹੈ।',
  'language.partial':
    'ਪੰਜਾਬੀ ਅਤੇ ਹਿੰਦੀ ਰੋਜ਼ਮਰ੍ਹਾ ਵਰਤੋਂ ਵਾਲੀਆਂ ਸਕਰੀਨਾਂ ਲਈ ਹਨ। ਜੋ ਹਾਲੇ ਅਨੁਵਾਦ ਨਹੀਂ ਹੋਇਆ, ਉਹ ਅੰਗਰੇਜ਼ੀ ਵਿੱਚ ਰਹੇਗਾ।',
};

const TABLES: Record<Lang, Partial<Record<StringKey, string>>> = { en: EN, hi: HI, pa: PA };

/**
 * One string, in the chosen language, with `{name}` placeholders filled.
 * Falls back to English for anything a language has not translated yet.
 */
export function translate(
  lang: Lang,
  key: StringKey,
  vars: Record<string, string | number> = {},
): string {
  const text = TABLES[lang]?.[key] ?? EN[key];
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** How complete a language is, for the picker and for the owner's review. */
export function coverage(lang: Lang): { translated: number; total: number; percent: number } {
  const total = Object.keys(EN).length;
  const translated = lang === 'en' ? total : Object.keys(TABLES[lang] ?? {}).length;
  return { translated, total, percent: Math.round((translated / total) * 100) };
}
