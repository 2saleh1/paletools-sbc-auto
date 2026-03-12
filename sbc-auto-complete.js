// Paletools SBC Auto Completer + Pack Opener
// يكمل SBCs تلقائياً ويفتح البكجات مع إدارة اللاعبين المكررين

(function () {
    'use strict';

    // ========== الإعدادات ==========
    const CONFIG = {
        // وقت الانتظار بين العمليات (تم تقليله للسرعة)
        WAIT_TIME: 800,
        CLICK_DELAY: 150,

        // إدارة اللاعبين المكررين
        GOLD_DUPLICATES_TO_SBC_STORAGE: true,  // الذهبيين المكررين → SBC Storage
        BRONZE_SILVER_QUICK_SELL: true,        // البرونز والفضيين → Quick Sell

        // إيقاف تلقائي عند امتلاء SBC Storage
        STOP_ON_SBC_STORAGE_FULL: true,

        // عدد البكجات المراد فتحها بعد كل SBC (-1 = كل البكجات المتاحة)
        PACKS_PER_SBC: 1
    };

    // ========== المتغيرات ==========
    let isRunning = false;
    let sbcsCompleted = 0;
    let packsOpened = 0;
    let goldsSentToStorage = 0;
    let quickSells = 0;
    let currentSBC = null;
    let sbcList = [];

    // ========== الدوال المساعدة ==========
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    async function clickElement(selector, maxRetries = 5) {
        for (let i = 0; i < maxRetries; i++) {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
                if (element && element.offsetParent !== null) {
                    element.click();
                    console.log(`✅ Clicked: ${selector}`);
                    await wait(CONFIG.CLICK_DELAY);
                    return true;
                }
            }
            await wait(300);
        }
        console.log(`❌ Failed to click: ${selector}`);
        return false;
    }

    async function waitForElement(selector, timeout = 10000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            const element = document.querySelector(selector);
            if (element && element.offsetParent !== null) {
                return element;
            }
            await wait(200);
        }
        return null;
    }

    function findElementByText(text, tag = '*') {
        const elements = document.querySelectorAll(tag);
        for (const el of elements) {
            if (el.textContent.trim().includes(text)) {
                return el;
            }
        }
        return null;
    }

    // ========== التنقل إلى SBC ==========
    async function goToSBCSection() {
        log('📍 الانتقال إلى قسم SBC...');

        // Try different selectors for SBC navigation
        const sbcSelectors = [
            'button.ut-tab-bar-item.icon-sbc',
            'a[href*="sbc"]',
            'button[class*="sbc"]',
            '.ut-navigation-button-control:contains("SBC")',
            '.icon-sbc'
        ];

        for (const selector of sbcSelectors) {
            if (await clickElement(selector)) {
                await wait(CONFIG.WAIT_TIME);
                log('✅ تم الانتقال إلى SBC');
                return true;
            }
        }

        log('❌ فشل الوصول إلى قسم SBC');
        return false;
    }

    // ========== Get SBC List ==========
    async function getSBCList() {
        log('📋 Loading SBC list...');

        await wait(1500);

        // More precise selector - avoid buttons and non-SBC elements
        let sbcTiles = document.querySelectorAll('.ut-sbc-set-tile-view:not(.sbc-set--buttons)');
        if (sbcTiles.length === 0) {
            sbcTiles = document.querySelectorAll('.ut-sbc-set-tile:not([class*="button"])');
        }
        if (sbcTiles.length === 0) {
            sbcTiles = document.querySelectorAll('[class*="sbc-set-tile"]:not([class*="button"])');
        }

        log(`🔍 Found ${sbcTiles.length} SBC tiles`);

        sbcList = [];
        let extractionErrors = 0;

        sbcTiles.forEach((tile, index) => {
            let name = '';

            // Debug: Log the tile structure for first 3
            if (index < 3) {
                log(`\n--- Tile ${index + 1} ---`);
                log(`Classes: ${tile.className}`);
            }

            // STRATEGY 1: Look for title in common EA structure
            const titleEl = tile.querySelector('.title, .ut-sbc-set-tile-name, [class*="tile-name"]');
            if (titleEl) {
                // Get only first text node
                for (const node of titleEl.childNodes) {
                    if (node.nodeType === Node.TEXT_NODE) {
                        const nodeText = node.textContent.trim();
                        if (nodeText && nodeText.length > 2 && !nodeText.match(/^\d+\/\d+/)) {
                            name = nodeText;
                            if (index < 3) {
                                log(`  ✓ Found title: "${name}"`);
                            }
                            break;
                        }
                    }
                }

                // If no text node, use cleaned full text
                if (!name) {
                    const text = titleEl.textContent.trim();
                    const lines = text.split('\n').filter(l => l.trim() && !l.match(/^\d+\/\d+/));
                    if (lines.length > 0) {
                        name = lines[0].trim();
                        if (index < 3) {
                            log(`  ✓ Found title (cleaned): "${name}"`);
                        }
                    }
                }
            }

            // STRATEGY 2: Check data attributes
            if (!name) {
                const dataName = tile.getAttribute('data-name') ||
                    tile.getAttribute('data-title') ||
                    tile.getAttribute('aria-label');
                if (dataName && dataName.length > 2) {
                    name = dataName;
                    if (index < 3) {
                        log(`  ✓ Found from attribute: "${name}"`);
                    }
                }
            }

            // STRATEGY 3: Smart extraction from full text
            if (!name) {
                const fullText = tile.textContent.trim();
                const lines = fullText.split('\n')
                    .map(l => l.trim())
                    .filter(l => l.length > 2)
                    .filter(l => !l.match(/^\d+\/\d+/))
                    .filter(l => !l.match(/^(SBCs?|Challenges?|Complete|Expires?|Days?|Hours?|Minutes?|Repeatable)$/i));

                if (lines.length > 0) {
                    name = lines[0];
                    // Cut off at common description starts
                    const cutOffWords = [
                        'Earn ', 'Get ', 'Complete ', 'Build ', 'Submit ',
                        'Group Rewards', 'For You', 'Repeatable:', 'Expires',
                        'Non-Repeatable', 'Hours', 'Days', 'Minutes'
                    ];
                    for (const word of cutOffWords) {
                        const cutIndex = name.indexOf(word);
                        if (cutIndex > 5) { // Keep at least 5 chars
                            name = name.substring(0, cutIndex).trim();
                            break;
                        }
                    }
                    if (index < 3) {
                        log(`  ✓ Found from text: "${name}"`);
                    }
                }
            }

            // Clean up the name
            if (name) {
                name = name.replace(/\d+\/\d+\s*SBCs?/gi, '').trim();
                name = name.replace(/Repeatable:\s*/gi, '').trim();
                name = name.replace(/\s+/g, ' ').trim();
                name = name.split('\n')[0].trim();
            }

            // Fallback
            if (!name || name.length < 2) {
                name = `[Unknown-${index + 1}]`;
                extractionErrors++;
                if (index < 3) {
                    log(`  ✗ No valid name found`);
                }
            } else if (index < 3) {
                log(`  ✅ Final name: "${name}"`);
            }

            // Check if SBC is completed
            const tileText = tile.textContent.toLowerCase();
            const isRepeatable = tileText.includes('repeatable:');

            // If repeatable, always available regardless of completion count
            let isCompleted = false;
            if (!isRepeatable) {
                isCompleted = tile.classList.contains('completed') ||
                    tile.querySelector('.completed.icon') !== null ||
                    tile.querySelector('.checkmark') !== null ||
                    (tileText.includes('completed') && !tileText.includes('completed 0 times'));
            }

            if (index < 3) {
                log(`  Repeatable: ${isRepeatable}`);
                log(`  Completed: ${isCompleted}`);
            }

            if (!isCompleted) {
                sbcList.push({
                    element: tile,
                    name: name,
                    index: sbcList.length
                });
            }
        });

        log(`\n📊 Found ${sbcList.length} available SBCs`);

        // Show first 3 SBC names
        if (sbcList.length > 0) {
            if (extractionErrors > 0) {
                log(`⚠️ ${extractionErrors} SBCs with unknown names`);
            }
            log('\n📋 First 3 names:');
            sbcList.slice(0, 3).forEach((sbc, i) => {
                log(`  ${i + 1}. ${sbc.name}`);
            });
            if (sbcList.length > 3) {
                log(`  ... و ${sbcList.length - 3} أخرى`);
            }
        } else {
            log('⚠️ No SBCs found - make sure you\'re in SBC page');
        }

        return sbcList;
    }

    // ========== اختيار وفتح SBC ==========
    async function selectAndOpenSBC(sbcIndex) {
        log(`🎯 فتح SBC: ${sbcList[sbcIndex].name}...`);

        // Click on the SBC tile
        currentSBC = sbcList[sbcIndex];

        // Scroll to element so user can see it
        currentSBC.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await wait(500);

        // Highlight the element briefly
        currentSBC.element.style.outline = '3px solid #3b82f6';
        await wait(200);
        currentSBC.element.style.outline = '';

        const clickTarget = currentSBC.element;

        // Try multiple times with different click methods
        let sbcOpened = false;
        const maxAttempts = 5;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            log(`🖱️ محاولة ${attempt}/${maxAttempts} لفتح SBC...`);

            // Method 1: mousedown/mouseup
            clickTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            await wait(30);
            clickTarget.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            await wait(100);

            // Method 2: Regular click
            clickTarget.click();
            await wait(100);

            // Method 3: Click event dispatch
            clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            await wait(200);

            // Poll for SBC opening (check every 200ms, max 3 seconds)
            log('⏳ التحقق من فتح SBC...');
            let pollAttempts = 0;
            const maxPollAttempts = 15; // 15 * 200ms = 3 seconds
            
            while (pollAttempts < maxPollAttempts) {
                await wait(200);
                const check = document.querySelector('.ut-sbc-challenge-tile, .challenge-tile, .ut-squad-builder-container, .ut-squad-pitch-view');
                
                if (check) {
                    log(`✅ تم فتح SBC في المحاولة ${attempt}`);
                    sbcOpened = true;
                    break;
                }
                pollAttempts++;
            }

            if (sbcOpened) break;
            
            log(`⚠️ المحاولة ${attempt} فشلت - إعادة المحاولة...`);
            await wait(300);
        }

        if (!sbcOpened) {
            log('❌ فشل فتح SBC بعد 5 محاولات');
            return false;
        }

        // Click on first challenge if multiple challenges exist
        const challenges = document.querySelectorAll('.ut-sbc-challenge-tile, .challenge-tile');
        if (challenges.length > 0) {
            log(`🔍 تم العثور على ${challenges.length} تحدي`);
            // Find incomplete challenge
            for (const challenge of challenges) {
                const isComplete = challenge.querySelector('.completed, .checkmark');
                if (!isComplete) {
                    // Scroll to challenge
                    challenge.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    await wait(200);

                    // Highlight
                    challenge.style.outline = '3px solid #10b981';
                    await wait(150);
                    challenge.style.outline = '';

                    // Use multiple click methods
                    challenge.click();
                    await wait(50);
                    challenge.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    await wait(50);
                    challenge.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                    await wait(30);
                    challenge.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));

                    log('✅ تم فتح التحدي');
                    log('⏳ انتظار تحميل واجهة التحدي...');
                    await wait(300);
                    break;
                }
            }
        }

        // Final verification
        await wait(200);
        const finalCheck = document.querySelector('.ut-squad-builder-container, .ut-squad-pitch-view, .ut-sbc-squad-overview');
        if (finalCheck) {
            log('✅ تم فتح SBC بنجاح');
            return true;
        } else {
            log('❌ فشل فتح SBC');
            return false;
        }
    }

    // ========== استخدام Smart Build ==========
    async function usePaletoolsSmartBuild() {
        log('🤖 استخدام Smart Builder من Paletools...');

        await wait(1500); // Wait for Paletools to inject the button

        // FIRST: Click squad-edit-icon button to open squad options menu
        log('🔍 البحث عن زر قائمة خيارات التشكيلة...');
        const squadEditButton = document.querySelector('button.flat.squad-edit-icon');

        if (squadEditButton) {
            log('✅ تم العثور على زر قائمة التشكيلة');

            // Scroll to button
            squadEditButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await wait(200);
            
            // Highlight button
            squadEditButton.style.outline = '3px solid #3b82f6';
            await wait(150);
            squadEditButton.style.outline = '';
            
            // Click using multiple methods
            log('🖱️ فتح قائمة خيارات التشكيلة...');
            squadEditButton.click();
            await wait(50);
            squadEditButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            await wait(50);
            squadEditButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            await wait(30);
            squadEditButton.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));

            log('⏳ انتظار ظهور قائمة الخيارات...');
            await wait(300); // Small delay for animation
            log('✅ تم فتح قائمة الخيارات');
        } else {
            log('⚠️ لم يتم العثور على زر قائمة التشكيلة - قد تكون القائمة مفتوحة بالفعل');
        }

        // THEN: Search for Smart Builder button
        // Button details (from recording): BUTTON, class="btn-standard primary", text="Smart Builder", parent="smart-builder-container"
        log('🔍 البحث عن زر Smart Builder...');

        let button = null;

        // Method 1: Search by exact class and text (most reliable)
        const buttons = document.querySelectorAll('button.btn-standard.primary, button.btn-standard');
        for (const btn of buttons) {
            const text = btn.textContent.trim();
            if (text === 'Smart Builder' || text.includes('Smart Builder')) {
                button = btn;
                log('✅ Found Smart Builder via class "btn-standard primary"');
                break;
            }
        }

        // Method 2: Search within smart-builder-container
        if (!button) {
            const container = document.querySelector('.smart-builder-container');
            if (container) {
                button = container.querySelector('button');
                if (button && button.textContent.includes('Smart Builder')) {
                    log('✅ Found Smart Builder via parent ".smart-builder-container"');
                } else {
                    button = null;
                }
            }
        }

        // Method 3: Search by text content (fallback)
        if (!button) {
            button = findElementByText('Smart Builder', 'button') ||
                findElementByText('Smart Build', 'button') ||
                document.querySelector('button[class*="smart"]');
            if (button) {
                log('✅ Found Smart Builder via text search');
            }
        }

        if (button) {
            log('✅ تم العثور على زر Smart Builder');

            // Scroll to button
            button.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await wait(200);

            // Highlight button
            button.style.outline = '3px solid #f59e0b';
            await wait(150);
            button.style.outline = '';

            // Click using multiple methods (EA might not respond to regular click)
            log('🖱️ الضغط على زر Smart Builder...');

            // Method 1: Regular click
            button.click();
            await wait(50);

            // Method 2: MouseEvent dispatch (more reliable)
            button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            await wait(50);

            // Method 3: mousedown + mouseup
            button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            await wait(30);
            button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));

            log('⏳ انتظار اكتمال البناء (مراقبة مستمرة حتى 60ث)...');

            // Wait for Smart Builder to complete by checking for Submit button
            // Check every 500ms (faster detection) for up to 60 seconds
            let buildComplete = false;
            let checksCount = 0;
            const maxChecks = 120; // 120 checks * 500ms = 60 seconds

            for (let i = 0; i < maxChecks; i++) {
                await wait(500);
                checksCount++;

                // Check if Submit/Exchange button appeared (means build is complete)
                const submitSelectors = [
                    'button.btn-standard.call-to-action',
                    'button.call-to-action',
                    'button[class*="call-to-action"]',
                    'button[class*="submit"]',
                    '.ut-squad-pitch-view button.call-to-action',
                    '.ut-sbc-challenge-details button.call-to-action'
                ];

                let submitBtn = null;
                for (const selector of submitSelectors) {
                    submitBtn = document.querySelector(selector);
                    if (submitBtn && submitBtn.offsetParent !== null) {
                        // Verify it's not disabled
                        const isDisabled = submitBtn.disabled ||
                            submitBtn.classList.contains('disabled') ||
                            submitBtn.getAttribute('disabled') !== null;

                        if (!isDisabled) {
                            buildComplete = true;
                            const totalSeconds = Math.round(checksCount * 0.5);
                            log(`✅ تم اكتمال Smart Builder بعد ${totalSeconds} ثانية`);

                            // iOS: Click back button to return to main SBC view before Submit
                            log('🔍 البحث عن زر الرجوع (iOS)...');
                            const backButton = document.querySelector('button.ut-navigation-button-control');
                            if (backButton) {
                                log('✅ تم العثور على زر الرجوع');
                                backButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                await wait(200);
                                
                                // Highlight
                                backButton.style.outline = '3px solid #3b82f6';
                                await wait(150);
                                backButton.style.outline = '';
                                
                                // Click using multiple methods
                                log('🖱️ الضغط على زر الرجوع...');
                                backButton.click();
                                await wait(50);
                                backButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                                await wait(50);
                                backButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                                await wait(30);
                                backButton.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                                
                                log('⏳ انتظار عودة الصفحة...');
                                await wait(300); // Quick check
                                log('✅ تم الرجوع إلى عرض SBC الرئيسي');
                            } else {
                                log('⚠️ لم يتم العثور على زر الرجوع - قد يكون PC/Web');
                            }

                            // Now scroll to Submit button
                            submitBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            await wait(200);

                            break;
                        }
                    }
                }

                if (buildComplete) break;

                // Show progress every 5 seconds (10 checks)
                if (checksCount % 10 === 0) {
                    const elapsed = Math.round(checksCount * 0.5);
                    log(`⏳ لا يزال يبني... ${elapsed}/60ث`);
                }
            }

            if (!buildComplete) {
                log('⚠️ انتهى وقت الانتظار (60ث)');
                log('🔍 تحقق من حالة الصفحة...');

                // Debug: Check what's on the page
                const allButtons = document.querySelectorAll('button');
                log(`🔍 عدد الأزرار في الصفحة: ${allButtons.length}`);

                // Check for error messages
                const errorMsg = document.querySelector('.notification.error, .ut-notification--error');
                if (errorMsg) {
                    log(`❌ رسالة خطأ: ${errorMsg.textContent.trim()}`);
                }

                return false;
            }

            return true;
        }

        log('⚠️ لم يتم العثور على زر Smart Builder - تأكد أن Paletools شغال');
        return false;
    }

    // ========== تقديم SBC ==========
    async function submitSBC() {
        log('📤 إرسال SBC...');

        // Wait a moment for UI to be ready
        await wait(800);

        // Try to find Submit button with multiple strategies
        log('🔍 البحث عن زر Submit...');

        const submitSelectors = [
            'button.btn-standard.call-to-action',
            'button.call-to-action',
            'button[class*="call-to-action"]',
            'button[class*="submit"]',
            '.ut-squad-pitch-view button.call-to-action',
            '.ut-sbc-challenge-details button.call-to-action',
            '.ut-button-group button.call-to-action'
        ];

        let submitBtn = null;
        for (const selector of submitSelectors) {
            const btn = document.querySelector(selector);
            if (btn && btn.offsetParent !== null) {
                const isDisabled = btn.disabled ||
                    btn.classList.contains('disabled') ||
                    btn.getAttribute('disabled') !== null;

                if (!isDisabled) {
                    submitBtn = btn;
                    log(`✅ تم العثور على زر Submit: ${selector}`);
                    break;
                }
            }
        }

        // Fallback: Search by text
        if (!submitBtn) {
            submitBtn = findElementByText('Submit', 'button') ||
                findElementByText('Exchange', 'button') ||
                findElementByText('تقديم', 'button') ||
                findElementByText('إرسال', 'button');

            if (submitBtn && submitBtn.offsetParent !== null) {
                log('✅ تم العثور على زر Submit (عن طريق النص)');
            }
        }

        if (submitBtn && submitBtn.offsetParent !== null) {
            // Scroll to Submit button
            submitBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await wait(200);

            // Highlight
            submitBtn.style.outline = '3px solid #10b981';
            await wait(150);
            submitBtn.style.outline = '';

            // Click using multiple methods (EA might not respond to regular click)
            log('🖱️ الضغط على زر Submit...');
            submitBtn.click();
            await wait(50);
            submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            await wait(50);
            submitBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            await wait(30);
            submitBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));

            log('👆 تم الضغط على زر Submit');
            log('⏳ انتظار ظهور شاشة التأكيد...');
            await wait(300); // Quick check for confirm button

            // Confirm if needed
            const confirmButton = findElementByText('Confirm', 'button') ||
                findElementByText('Yes', 'button') ||
                findElementByText('تأكيد', 'button') ||
                document.querySelector('.ut-button-group button.call-to-action');

            if (confirmButton && confirmButton.offsetParent !== null) {
                log('📝 تأكيد الإرسال...');
                // Use multiple click methods for confirm too
                confirmButton.click();
                await wait(50);
                confirmButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                await wait(30);
                confirmButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                await wait(30);
                confirmButton.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                log('⏳ انتظار معالجة الطلب...');
                await wait(500); // Wait for server response
            }

            log('✅ تم تقديم SBC بنجاح');
            sbcsCompleted++;
            updateUI();
            return true;
        }

        // Debug info if button not found
        log('❌ فشل تقديم SBC - لم يتم العثور على زر Submit');
        log('🔍 معلومات Debug:');
        const allButtons = document.querySelectorAll('button');
        log(`  - عدد الأزرار: ${allButtons.length}`);

        // List visible buttons
        const visibleButtons = Array.from(allButtons)
            .filter(btn => btn.offsetParent !== null)
            .slice(0, 5);

        if (visibleButtons.length > 0) {
            log(`  - أول 5 أزرار مرئية:`);
            visibleButtons.forEach((btn, i) => {
                log(`    ${i + 1}. ${btn.className} - "${btn.textContent.trim().substring(0, 30)}"`);
            });
        }

        return false;
    }

    // ========== فتح المكافآت ==========
    async function claimRewards() {
        log('🎁 استلام المكافآت...');

        log('⏳ انتظار ظهور شاشة المكافآت...');
        await wait(500);

        // Search for Claim Rewards button (recorded data: BUTTON, class="btn-standard primary", text="Claim Rewards", parent=FOOTER)
        log('🔍 البحث عن زر Claim Rewards...');

        let claimButton = null;

        // Method 1: Search in footer for btn-standard primary
        const footer = document.querySelector('footer');
        if (footer) {
            const buttons = footer.querySelectorAll('button.btn-standard.primary, button.btn-standard');
            for (const btn of buttons) {
                if (btn.textContent.includes('Claim Rewards') || btn.textContent.includes('Claim')) {
                    claimButton = btn;
                    log('✅ Found Claim Rewards in footer');
                    break;
                }
            }
        }

        // Method 2: Search globally for Claim Rewards text
        if (!claimButton) {
            claimButton = findElementByText('Claim Rewards', 'button') ||
                findElementByText('Claim', 'button') ||
                findElementByText('Ok', 'button') ||
                findElementByText('OK', 'button');
            if (claimButton) {
                log('✅ Found Claim Rewards via text search');
            }
        }

        // Method 3: Try common reward button selectors
        if (!claimButton) {
            const selectors = [
                'button.ut-button',
                'button.btn-standard.primary',
                'button[class*="call-to-action"]',
                '.ut-navigation-button-control'
            ];

            for (const selector of selectors) {
                const btn = document.querySelector(selector);
                if (btn && (btn.textContent.includes('Claim') || btn.textContent.includes('Ok') || btn.textContent.includes('OK'))) {
                    claimButton = btn;
                    log(`✅ Found via selector: ${selector}`);
                    break;
                }
            }
        }

        if (claimButton) {
            log('✅ تم العثور على زر Claim Rewards');

            // Scroll to button
            claimButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await wait(200);

            // Highlight
            claimButton.style.outline = '3px solid #fbbf24';
            await wait(150);
            claimButton.style.outline = '';

            // Click using multiple methods
            log('🖱️ الضغط على زر Claim Rewards...');
            claimButton.click();
            await wait(50);
            claimButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            await wait(50);
            claimButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            await wait(30);
            claimButton.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));

            log('⏳ انتظار معالجة المكافآت...');
            await wait(500);

            // Try clicking through any additional screens (OK, Continue, etc.)
            for (let i = 0; i < 3; i++) {
                await wait(300);

                const okBtn = findElementByText('Ok', 'button') ||
                    findElementByText('OK', 'button') ||
                    findElementByText('Continue', 'button') ||
                    findElementByText('متابعة', 'button');

                if (okBtn) {
                    log('🖱️ الضغط على زر OK/Continue...');
                    okBtn.click();
                    await wait(50);
                    okBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                }

                // Click anywhere on screen to skip animations
                document.body.click();
            }

            log('✅ تم استلام المكافآت');
            return true;
        } else {
            log('⚠️ لم يتم العثور على زر Claim Rewards - قد تكون المكافآت already claimed');
            // Click body few times to skip any dialogs
            for (let i = 0; i < 3; i++) {
                document.body.click();
                await wait(300);
            }
            return true;
        }
    }

    // ========== فتح البكجات ==========
    async function openPacks(count = 1) {
        log(`📦 فتح ${count} بكج...`);

        // Navigate to store
        await goToStore();
        await wait(CONFIG.WAIT_TIME);

        for (let i = 0; i < count; i++) {
            const success = await openSinglePack();
            if (!success) break;

            await wait(CONFIG.WAIT_TIME);
        }

        log(`✅ تم فتح ${count} بكج`);
    }

    async function goToStore() {
        log('🏪 الانتقال إلى المتجر...');

        const storeSelectors = [
            'button.ut-tab-bar-item.icon-store',
            'a[href*="store"]',
            'button[class*="store"]',
            '.icon-store'
        ];

        for (const selector of storeSelectors) {
            if (await clickElement(selector)) {
                await wait(CONFIG.WAIT_TIME);
                return true;
            }
        }

        return false;
    }

    async function openSinglePack() {
        // Find first pack
        const pack = document.querySelector('.ut-pack-tile, .ut-tile-pack, .pack-item');
        if (!pack) {
            log('❌ لا توجد بكجات متاحة');
            return false;
        }

        pack.click();
        await wait(1000);

        // Open pack
        await clickElement('.btn-standard.call-to-action');
        await wait(CONFIG.WAIT_TIME);

        // Skip animation
        document.body.click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
        await wait(CONFIG.WAIT_TIME);

        // Handle duplicates
        await handleDuplicates();

        packsOpened++;
        updateUI();

        return true;
    }

    // ========== إدارة اللاعبين المكررين ==========
    async function handleDuplicates() {
        log('🔄 معالجة اللاعبين المكررين...');

        await wait(1500);

        // Get all duplicate items
        const items = document.querySelectorAll('.ut-item, .player-item, [class*="item"]');

        for (const item of items) {
            const isDuplicate = item.querySelector('.duplicate, [class*="duplicate"]');
            if (!isDuplicate) continue;

            // Check rarity
            const isGold = item.classList.contains('gold') ||
                item.classList.contains('rare') ||
                item.querySelector('.gold, .rare');

            const isBronzeOrSilver = item.classList.contains('bronze') ||
                item.classList.contains('silver') ||
                item.querySelector('.bronze, .silver');

            // Select the item
            item.click();
            await wait(300);

            if (isGold && CONFIG.GOLD_DUPLICATES_TO_SBC_STORAGE) {
                // Send gold duplicates to SBC Storage
                const success = await sendToSBCStorage();
                if (success) {
                    goldsSentToStorage++;
                    log('💛 تم إرسال لاعب ذهبي إلى SBC Storage');
                } else if (CONFIG.STOP_ON_SBC_STORAGE_FULL) {
                    log('⚠️ SBC Storage ممتلئ! إيقاف السكربت...');
                    stopScript();
                    return;
                }
            } else if (isBronzeOrSilver && CONFIG.BRONZE_SILVER_QUICK_SELL) {
                // Quick sell bronze/silver duplicates
                await quickSellItem();
                quickSells++;
                log('💰 تم بيع لاعب برونزي/فضي');
            }

            await wait(500);
        }

        // Send remaining items to club
        await clickElement('.store-all, .sendToClub');

        updateUI();
    }

    async function sendToSBCStorage() {
        // Right click or long press on item
        const selectedItem = document.querySelector('.selected, .ut-item--selected');
        if (!selectedItem) return false;

        // Try to open context menu
        selectedItem.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
        await wait(500);

        // Look for "Send to SBC Storage" option
        const sbcStorageBtn = findElementByText('SBC', 'button') ||
            findElementByText('Storage', 'button');

        if (sbcStorageBtn) {
            sbcStorageBtn.click();
            await wait(500);

            // Check if storage is full
            const fullMessage = findElementByText('full', 'div') ||
                findElementByText('maximum', 'div');

            if (fullMessage) {
                return false; // Storage full
            }

            return true;
        }

        // Alternative: Try keyboard shortcut
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
        await wait(500);

        return true;
    }

    async function quickSellItem() {
        // Look for quick sell button
        const quickSellSelectors = [
            'button:contains("Quick Sell")',
            'button[class*="quicksell"]',
            '.quick-sell-button'
        ];

        for (const selector of quickSellSelectors) {
            if (await clickElement(selector)) {
                // Confirm
                const confirmBtn = findElementByText('Confirm', 'button');
                if (confirmBtn) {
                    confirmBtn.click();
                    await wait(300);
                }
                return true;
            }
        }

        return false;
    }

    // ========== العملية الكاملة ==========
    async function completeSBCCycle(sbcIndex) {
        if (!isRunning) return;

        log(`\n🔄 بدء دورة SBC ${sbcsCompleted + 1}...\n`);

        // 1. Go to SBC section
        await goToSBCSection();

        // 2. Get SBC list if not loaded
        if (sbcList.length === 0) {
            await getSBCList();
        }

        // 3. Select and open SBC
        await selectAndOpenSBC(sbcIndex);

        // 4. Use Smart Build
        const buildSuccess = await usePaletoolsSmartBuild();
        if (!buildSuccess) {
            log('⚠️ Smart Builder لم يكتمل في الوقت المحدد');
            log('🔄 محاولة الإرسال على أي حال...');
            // Don't return false - try to submit anyway
        }

        // 5. Submit SBC
        const submitted = await submitSBC();
        if (!submitted) {
            log('❌ فشل تقديم SBC');
            return false;
        }

        // 6. Claim rewards
        await claimRewards();

        // 7. Open packs
        if (CONFIG.PACKS_PER_SBC > 0) {
            await openPacks(CONFIG.PACKS_PER_SBC);
        }

        log(`✅ تم إكمال دورة SBC بنجاح!\n`);
        return true;
    }

    // ========== البدء ==========
    async function startAutoSBC(sbcIndex = 0, cycles = 1) {
        if (isRunning) {
            log('⚠️ السكربت يعمل بالفعل!');
            return;
        }

        isRunning = true;
        log('🚀 بدء SBC Auto Completer...\n');
        updateUI();

        for (let i = 0; i < cycles; i++) {
            if (!isRunning) break;

            const success = await completeSBCCycle(sbcIndex);
            if (!success) {
                log('❌ حدث خطأ، إيقاف السكربت');
                break;
            }

            await wait(CONFIG.WAIT_TIME);
        }

        stopScript();
    }

    function stopScript() {
        isRunning = false;
        log('\n⏸️ تم إيقاف السكربت');
        updateUI();
    }

    // ========== واجهة المستخدم ==========
    function createUI() {
        if (document.getElementById('sbc-auto-ui')) return;

        const ui = document.createElement('div');
        ui.id = 'sbc-auto-ui';
        ui.innerHTML = `
            <style>
                #sbc-auto-ui {
                    position: fixed;
                    top: 10px;
                    left: 10px;
                    background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%);
                    border: 1px solid rgba(59, 130, 246, 0.3);
                    border-radius: 12px;
                    padding: 16px;
                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(96, 165, 250, 0.2);
                    z-index: 999999;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
                    color: #f8fafc;
                    min-width: 280px;
                    max-width: 320px;
                    max-height: 70vh;
                    overflow-y: auto;
                    backdrop-filter: blur(10px);
                    opacity: 0.95;
                    transition: opacity 0.3s;
                }
                
                #sbc-auto-ui:hover {
                    opacity: 1;
                }
                
                #sbc-auto-ui.minimized {
                    display: none;
                }
                
                #sbc-auto-ui h3 {
                    margin: 0 0 12px 0;
                    font-size: 16px;
                    font-weight: 700;
                    text-align: center;
                    background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    background-clip: text;
                    font-weight: bold;
                }
                
                #sbc-auto-ui .stats {
                    background: rgba(15, 23, 42, 0.6);
                    border: 1px solid rgba(59, 130, 246, 0.2);
                    border-radius: 8px;
                    padding: 10px;
                    margin-bottom: 10px;
                }
                
                #sbc-auto-ui .stat-item {
                    display: flex;
                    justify-content: space-between;
                    margin: 5px 0;
                    font-size: 11px;
                }
                
                #sbc-auto-ui .stat-item .label {
                    opacity: 0.9;
                }
                
                #sbc-auto-ui .stat-item .value {
                    font-weight: bold;
                    font-size: 12px;
                }
                
                #sbc-auto-ui .sbc-selector {
                    margin-bottom: 10px;
                }
                
                #sbc-auto-ui .sbc-selector label {
                    font-size: 11px;
                }
                
                #sbc-auto-ui select {
                    width: 100%;
                    padding: 8px;
                    border: 1px solid rgba(59, 130, 246, 0.3);
                    border-radius: 6px;
                    font-size: 12px;
                    background: rgba(15, 23, 42, 0.8);
                    color: #f8fafc;
                    margin-top: 5px;
                    cursor: pointer;
                    transition: all 0.3s;
                }
                
                #sbc-auto-ui select:hover {
                    border-color: rgba(59, 130, 246, 0.5);
                    background: rgba(15, 23, 42, 0.95);
                }
                
                #sbc-auto-ui select:focus {
                    outline: none;
                    border-color: #3b82f6;
                    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
                }
                
                #sbc-auto-ui input[type="number"] {
                    width: 100%;
                    padding: 8px;
                    border: 1px solid rgba(59, 130, 246, 0.3);
                    border-radius: 6px;
                    font-size: 12px;
                    background: rgba(15, 23, 42, 0.8);
                    color: #f8fafc;
                    margin-top: 5px;
                    transition: all 0.3s;
                }
                
                #sbc-auto-ui input[type="number"]:focus {
                    outline: none;
                    border-color: #3b82f6;
                    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
                }
                
                #sbc-auto-ui button {
                    width: 100%;
                    padding: 8px;
                    border: none;
                    border-radius: 6px;
                    font-size: 12px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.3s;
                    margin: 4px 0;
                    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
                }
                
                #sbc-auto-ui .btn-start {
                    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                    color: white;
                }
                
                #sbc-auto-ui .btn-start:hover {
                    background: linear-gradient(135deg, #059669 0%, #047857 100%);
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
                }
                
                #sbc-auto-ui .btn-stop {
                    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
                    color: white;
                }
                
                #sbc-auto-ui .btn-stop:hover {
                    background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
                }
                
                #sbc-auto-ui .btn-refresh {
                    background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
                    color: white;
                }
                
                #sbc-auto-ui .btn-refresh:hover {
                    background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
                }
                
                #sbc-auto-ui .btn-record {
                    background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
                    color: white;
                    font-size: 10px;
                }
                
                #sbc-auto-ui .btn-record:hover {
                    background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%);
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(139, 92, 246, 0.4);
                }
                
                #sbc-auto-ui .btn-record.active {
                    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                    animation: pulse 2s ease-in-out infinite;
                }
                
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.7; }
                }
                
                #sbc-auto-ui .btn-minimize {
                    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
                    color: white;
                }
                
                #sbc-auto-ui .btn-minimize:hover {
                    background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);
                }
                
                #sbc-auto-ui .btn-close {
                    background: rgba(71, 85, 105, 0.5);
                    color: #cbd5e1;
                    font-size: 11px;
                    padding: 6px;
                    border: 1px solid rgba(148, 163, 184, 0.2);
                }
                
                #sbc-auto-ui .btn-close:hover {
                    background: rgba(71, 85, 105, 0.8);
                    color: #f1f5f9;
                    transform: translateY(-1px);
                }
                
                #sbc-auto-ui .settings {
                    background: rgba(15, 23, 42, 0.6);
                    border: 1px solid rgba(59, 130, 246, 0.2);
                    border-radius: 8px;
                    padding: 10px;
                    margin-bottom: 10px;
                    font-size: 11px;
                }
                
                #sbc-auto-ui .setting-item {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin: 5px 0;
                }
                
                #sbc-auto-ui input[type="checkbox"] {
                    width: 16px;
                    height: 16px;
                }
                
                #sbc-auto-ui .log-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-top: 8px;
                    margin-bottom: 4px;
                }
                
                #sbc-auto-ui .log-title {
                    font-size: 10px;
                    font-weight: 600;
                    color: #94a3b8;
                }
                
                #sbc-auto-ui .btn-copy-log {
                    background: rgba(59, 130, 246, 0.2);
                    color: #60a5fa;
                    border: 1px solid rgba(59, 130, 246, 0.3);
                    padding: 4px 8px;
                    font-size: 10px;
                    font-size: 11px;
                    border-radius: 6px;
                    cursor: pointer;
                    transition: all 0.2s;
                    width: auto;
                    margin: 0;
                }
                
                #sbc-auto-ui .btn-copy-log:hover {
                    background: rgba(59, 130, 246, 0.3);
                    border-color: rgba(59, 130, 246, 0.5);
                    transform: translateY(0);
                    box-shadow: 0 2px 6px rgba(59, 130, 246, 0.3);
                }
                
                #sbc-auto-ui .log {
                    background: rgba(2, 6, 23, 0.8);
                    border: 1px solid rgba(59, 130, 246, 0.2);
                    border-radius: 6px;
                    padding: 8px;
                    max-height: 180px;
                    overflow-y: auto;
                    overflow-x: auto;
                    font-size: 9px;
                    font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
                    word-wrap: break-word;
                    white-space: pre-wrap;
                    direction: ltr;
                    text-align: left;
                }
                
                #sbc-auto-ui .log-entry {
                    margin: 2px 0;
                    padding: 2px 0;
                    border-bottom: 1px solid rgba(59, 130, 246, 0.1);
                    color: #cbd5e1;
                    word-break: break-word;
                    overflow-wrap: break-word;
                    line-height: 1.3;
                }
            </style>
            
            <h3>🎯 SBC Auto Completer</h3>
            
            <div class="stats">
                <div class="stat-item">
                    <span class="label">✅ SBCs مكتملة:</span>
                    <span class="value" id="sbcs-count">0</span>
                </div>
                <div class="stat-item">
                    <span class="label">📦 بكجات مفتوحة:</span>
                    <span class="value" id="packs-count">0</span>
                </div>
                <div class="stat-item">
                    <span class="label">💛 ذهبيين → Storage:</span>
                    <span class="value" id="golds-count">0</span>
                </div>
                <div class="stat-item">
                    <span class="label">💰 Quick Sells:</span>
                    <span class="value" id="sells-count">0</span>
                </div>
            </div>
            
            <div class="sbc-selector">
                <label>اختر SBC:</label>
                <select id="sbc-select">
                    <option value="-1">-- حمّل القائمة أولاً --</option>
                </select>
            </div>
            
            <div class="sbc-selector">
                <label>عدد التكرارات:</label>
                <input type="number" id="cycles-input" value="1" min="1" max="100">
            </div>
            
            <div class="settings">
                <div class="setting-item">
                    <span>ذهبيين → SBC Storage</span>
                    <input type="checkbox" id="gold-storage" checked>
                </div>
                <div class="setting-item">
                    <span>برونز/فضي → Quick Sell</span>
                    <input type="checkbox" id="bronze-silver-sell" checked>
                </div>
                <div class="setting-item">
                    <span>إيقاف عند امتلاء Storage</span>
                    <input type="checkbox" id="stop-full" checked>
                </div>
            </div>
            
            <button class="btn-refresh" id="refresh-btn">🔄 تحميل قائمة SBCs</button>
            <button class="btn-record" id="record-btn">🔍 وضع التسجيل: إيقاف</button>
            <button class="btn-start" id="start-btn">▶️ بدء التشغيل التلقائي</button>
            <button class="btn-stop" id="stop-btn" style="display:none">⏸️ إيقاف</button>
            <button class="btn-minimize" id="minimize-btn">➖ تصغير</button>
            <button class="btn-close" id="close-btn">✖️ إغلاق</button>
            
            <div class="log-header">
                <span class="log-title">📋 Console Log</span>
                <button class="btn-copy-log" id="copy-log-btn">📋 نسخ الكل</button>
            </div>
            <div class="log" id="log-container">
                <div class="log-entry">جاهز للبدء...</div>
            </div>
        `;

        document.body.appendChild(ui);

        // Event listeners
        document.getElementById('refresh-btn').addEventListener('click', async () => {
            // Check if we're in SBC section
            const inSBCSection = document.querySelector('.ut-sbc-set-tile, .sbc-set-tile, [class*="sbc-set"]');

            if (!inSBCSection) {
                alert('⚠️ تنبيه مهم\n\nيجب الدخول إلى صفحة SBC أولاً!\n\n1. اضغط على أيقونة SBC في القائمة\n2. ثم اضغط "تحميل قائمة SBCs"');
                log('⚠️ يجب الدخول إلى صفحة SBC أولاً');
                return;
            }

            log('🔄 جاري تحميل قائمة SBCs...');
            await wait(500);
            await getSBCList();

            const select = document.getElementById('sbc-select');
            select.innerHTML = '';

            if (sbcList.length === 0) {
                select.innerHTML = '<option value="-1">-- لا توجد SBCs متاحة --</option>';
                log('❌ لم يتم العثور على SBCs');
            } else {
                sbcList.forEach((sbc, index) => {
                    const option = document.createElement('option');
                    option.value = index;
                    option.textContent = sbc.name;
                    select.appendChild(option);
                });
                log(`✅ تم تحميل ${sbcList.length} SBC`);
            }
        });

        document.getElementById('start-btn').addEventListener('click', () => {
            const sbcIndex = parseInt(document.getElementById('sbc-select').value);
            const cycles = parseInt(document.getElementById('cycles-input').value);

            if (sbcIndex < 0) {
                alert('⚠️ اختر SBC من القائمة أولاً!');
                return;
            }

            // Update config from checkboxes
            CONFIG.GOLD_DUPLICATES_TO_SBC_STORAGE = document.getElementById('gold-storage').checked;
            CONFIG.BRONZE_SILVER_QUICK_SELL = document.getElementById('bronze-silver-sell').checked;
            CONFIG.STOP_ON_SBC_STORAGE_FULL = document.getElementById('stop-full').checked;

            document.getElementById('start-btn').style.display = 'none';
            document.getElementById('stop-btn').style.display = 'block';
            document.getElementById('refresh-btn').disabled = true;

            startAutoSBC(sbcIndex, cycles);
        });

        document.getElementById('stop-btn').addEventListener('click', () => {
            stopScript();
            document.getElementById('start-btn').style.display = 'block';
            document.getElementById('stop-btn').style.display = 'none';
            document.getElementById('refresh-btn').disabled = false;
        });

        document.getElementById('copy-log-btn').addEventListener('click', () => {
            const logContainer = document.getElementById('log-container');
            const logEntries = logContainer.querySelectorAll('.log-entry');
            const logText = Array.from(logEntries).map(entry => entry.textContent).join('\n');

            // Copy to clipboard
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(logText).then(() => {
                    const btn = document.getElementById('copy-log-btn');
                    const originalText = btn.textContent;
                    btn.textContent = '✅ تم النسخ!';
                    setTimeout(() => {
                        btn.textContent = originalText;
                    }, 2000);
                }).catch(() => {
                    alert('فشل النسخ. جرب يدوياً.');
                });
            } else {
                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                textArea.value = logText;
                textArea.style.position = 'fixed';
                textArea.style.left = '-999999px';
                document.body.appendChild(textArea);
                textArea.select();
                try {
                    document.execCommand('copy');
                    alert('✅ تم نسخ اللوق!');
                } catch (err) {
                    alert('فشل النسخ');
                }
                document.body.removeChild(textArea);
            }
        });

        // Record Mode - Click detector for debugging
        let recordMode = false;
        let clickListener = null;
        let mousedownListener = null;
        let hoverListener = null;
        let keyListener = null;

        document.getElementById('record-btn').addEventListener('click', () => {
            recordMode = !recordMode;
            const btn = document.getElementById('record-btn');

            if (recordMode) {
                // Activate record mode
                btn.textContent = '🔴 وضع التسجيل: تشغيل';
                btn.classList.add('active');
                log('═══════════════════════════');
                log('🔴 وضع التسجيل مفعّل');
                log('اضغط على أي عنصر في الصفحة');
                log('✅ Listener activated on entire page');
                log('═══════════════════════════');

                // Add click listener to capture ALL clicks (including EA Web App)
                clickListener = function (e) {
                    // Skip clicks on script UI to avoid spam
                    if (e.target.closest('#sbc-auto-ui') || e.target.id === 'sbc-reopen-btn') {
                        return;
                    }

                    const el = e.target;

                    // Log element details
                    log('═══════════════════════════');
                    log('🎯 Element clicked:');
                    log(`Tag: ${el.tagName}`);
                    log(`ID: ${el.id || '(no id)'}`);
                    log(`Class: ${el.className}`);
                    log(`Text: ${el.textContent.trim().substring(0, 50)}`);
                    log(`Title: ${el.title || '(no title)'}`);
                    log(`Role: ${el.getAttribute('role') || '(no role)'}`);

                    // Data attributes
                    const dataAttrs = Object.keys(el.dataset);
                    if (dataAttrs.length > 0) {
                        log(`Data attrs: ${dataAttrs.join(', ')}`);
                    } else {
                        log('Data attrs: (none)');
                    }

                    // Parent info
                    if (el.parentElement) {
                        log(`Parent tag: ${el.parentElement.tagName}`);
                        log(`Parent class: ${el.parentElement.className || '(no class)'}`);
                    }

                    // Check if in squad area
                    const inSquad = el.closest('.ut-squad-pitch-view, .ut-squad-builder-container, .ut-sbc-squad-overview');
                    log(`In squad area: ${inSquad ? 'YES ✅' : 'NO ❌'}`);

                    log('═══════════════════════════');
                };

                // Also track mousedown in case EA uses that instead of click
                mousedownListener = function (e) {
                    // Skip clicks on script UI
                    if (e.target.closest('#sbc-auto-ui') || e.target.id === 'sbc-reopen-btn') {
                        return;
                    }

                    const el = e.target;
                    log('💡 Mousedown on: ' + el.tagName + (el.className ? '.' + el.className.split(' ')[0] : ''));
                };

                // Add listeners with capture=true to catch ALL events
                // Use multiple phases to ensure we catch EA's events
                document.body.addEventListener('click', clickListener, true);
                document.body.addEventListener('click', clickListener, false);
                document.addEventListener('click', clickListener, true);
                document.addEventListener('click', clickListener, false);
                document.addEventListener('mousedown', mousedownListener, true);
                window.addEventListener('click', clickListener, true);

                // Alternative method: Hover + Keyboard to inspect element
                let currentHoverElement = null;
                hoverListener = function (e) {
                    if (e.target.closest('#sbc-auto-ui') || e.target.id === 'sbc-reopen-btn') {
                        return;
                    }
                    currentHoverElement = e.target;
                };

                keyListener = function (e) {
                    // Press 'i' key to inspect hovered element
                    if (e.key === 'i' || e.key === 'I') {
                        if (currentHoverElement) {
                            const el = currentHoverElement;
                            log('═══════════════════════════');
                            log('🔍 Element inspected (via hover+I):');
                            log(`Tag: ${el.tagName}`);
                            log(`ID: ${el.id || '(no id)'}`);
                            log(`Class: ${el.className}`);
                            log(`Text: ${el.textContent.trim().substring(0, 50)}`);
                            log(`Title: ${el.title || '(no title)'}`);
                            log(`Role: ${el.getAttribute('role') || '(no role)'}`);

                            const dataAttrs = Object.keys(el.dataset);
                            if (dataAttrs.length > 0) {
                                log(`Data attrs: ${dataAttrs.join(', ')}`);
                            } else {
                                log('Data attrs: (none)');
                            }

                            if (el.parentElement) {
                                log(`Parent tag: ${el.parentElement.tagName}`);
                                log(`Parent class: ${el.parentElement.className || '(no class)'}`);
                            }

                            const inSquad = el.closest('.ut-squad-pitch-view, .ut-squad-builder-container, .ut-sbc-squad-overview');
                            log(`In squad area: ${inSquad ? 'YES ✅' : 'NO ❌'}`);
                            log('═══════════════════════════');
                        }
                    }
                };

                document.addEventListener('mouseover', hoverListener, true);
                document.addEventListener('keydown', keyListener, true);

                // Add a test to verify listener works
                setTimeout(() => {
                    log('✅ Listeners attached successfully');
                    log('');
                    log('📋 طريقتان للتسجيل:');
                    log('1️⃣ اضغط مباشرة على الزر');
                    log('2️⃣ حوّم الماوس على الزر واضغط حرف I');
                    log('');
                    log('🧪 TEST: Click the yellow box below');

                    // Add test element
                    const testDiv = document.createElement('div');
                    testDiv.textContent = '🧪 TEST ELEMENT - Click me or hover+I';
                    testDiv.style.cssText = 'background: #fbbf24; color: #000; padding: 8px; margin: 5px 0; cursor: pointer; border-radius: 4px; font-weight: bold;';
                    testDiv.setAttribute('data-test', 'true');
                    document.getElementById('log-container').insertBefore(testDiv, document.getElementById('log-container').firstChild);
                }, 100);

            } else {
                // Deactivate record mode
                btn.textContent = '🔍 وضع التسجيل: إيقاف';
                btn.classList.remove('active');
                log('⚪ وضع التسجيل متوقف');

                // Remove all listeners
                if (clickListener) {
                    document.body.removeEventListener('click', clickListener, true);
                    document.body.removeEventListener('click', clickListener, false);
                    document.removeEventListener('click', clickListener, true);
                    document.removeEventListener('click', clickListener, false);
                    window.removeEventListener('click', clickListener, true);
                    clickListener = null;
                }
                if (mousedownListener) {
                    document.removeEventListener('mousedown', mousedownListener, true);
                    mousedownListener = null;
                }
                if (hoverListener) {
                    document.removeEventListener('mouseover', hoverListener, true);
                    hoverListener = null;
                }
                if (keyListener) {
                    document.removeEventListener('keydown', keyListener, true);
                    keyListener = null;
                }

                // Remove test element
                const testElement = document.querySelector('[data-test="true"]');
                if (testElement) {
                    testElement.remove();
                }
            }
        });

        document.getElementById('minimize-btn').addEventListener('click', () => {
            ui.classList.add('minimized');
            // Show reopen button
            if (!document.getElementById('sbc-reopen-btn')) {
                const reopenBtn = document.createElement('div');
                reopenBtn.id = 'sbc-reopen-btn';
                reopenBtn.innerHTML = '🎯';
                reopenBtn.style.cssText = `
                    position: fixed;
                    top: 20px;
                    left: 20px;
                    width: 45px;
                    height: 45px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 20px;
                    cursor: pointer;
                    box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
                    z-index: 999999;
                    transition: all 0.3s;
                `;
                reopenBtn.addEventListener('mouseenter', () => {
                    reopenBtn.style.transform = 'scale(1.1)';
                });
                reopenBtn.addEventListener('mouseleave', () => {
                    reopenBtn.style.transform = 'scale(1)';
                });
                reopenBtn.addEventListener('click', () => {
                    ui.classList.remove('minimized');
                    reopenBtn.remove();
                });
                document.body.appendChild(reopenBtn);
            }
        });

        document.getElementById('close-btn').addEventListener('click', () => {
            stopScript();
            ui.style.display = 'none';
            // Show reopen button
            if (!document.getElementById('sbc-reopen-btn')) {
                const reopenBtn = document.createElement('div');
                reopenBtn.id = 'sbc-reopen-btn';
                reopenBtn.innerHTML = '🎯';
                reopenBtn.style.cssText = `
                    position: fixed;
                    top: 20px;
                    left: 20px;
                    width: 50px;
                    height: 50px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 24px;
                    cursor: pointer;
                    box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
                    z-index: 999999;
                    transition: all 0.3s;
                `;
                reopenBtn.addEventListener('mouseenter', () => {
                    reopenBtn.style.transform = 'scale(1.1)';
                });
                reopenBtn.addEventListener('mouseleave', () => {
                    reopenBtn.style.transform = 'scale(1)';
                });
                reopenBtn.addEventListener('click', () => {
                    ui.style.display = 'block';
                    reopenBtn.remove();
                });
                document.body.appendChild(reopenBtn);
            }
        });
    }

    function updateUI() {
        document.getElementById('sbcs-count').textContent = sbcsCompleted;
        document.getElementById('packs-count').textContent = packsOpened;
        document.getElementById('golds-count').textContent = goldsSentToStorage;
        document.getElementById('sells-count').textContent = quickSells;
    }

    function log(message) {
        console.log(message);

        const logContainer = document.getElementById('log-container');
        if (logContainer) {
            const entry = document.createElement('div');
            entry.className = 'log-entry';
            entry.textContent = `${new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} ${message}`;
            logContainer.appendChild(entry);
            logContainer.scrollTop = logContainer.scrollHeight;

            // Keep only last 50 entries
            while (logContainer.children.length > 50) {
                logContainer.removeChild(logContainer.firstChild);
            }
        }
    }

    // ========== تهيئة ==========
    console.log('✅ Paletools SBC Auto Completer loaded!');
    createUI();
    log('✅ تم تحميل السكربت بنجاح');
    log('💡 اضغط "تحميل قائمة SBCs" للبدء');

})();
