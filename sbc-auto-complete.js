// Paletools SBC Auto Completer
// يكمل SBCs تلقائياً مع استلام المكافآت

(function () {
    'use strict';

    // ========== الإعدادات ==========
    const CONFIG = {
        // وقت الانتظار بين العمليات (تم تقليله للسرعة)
        WAIT_TIME: 800,
        CLICK_DELAY: 150
    };

    // ========== المتغيرات ==========
    let isRunning = false;
    let sbcsCompleted = 0;
    let currentSBC = null;
    let sbcList = [];
    let openedModeTargetName = '';

    // ========== الدوال المساعدة ==========
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    async function clickElement(selector, maxRetries = 5) {
        for (let i = 0; i < maxRetries; i++) {
            let elements = [];
            try {
                elements = document.querySelectorAll(selector);
            } catch (err) {
                console.log(`❌ Invalid selector: ${selector}`);
                return false;
            }

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

    function normalizeDigits(input) {
        if (input == null) return '';
        const arabicIndic = '٠١٢٣٤٥٦٧٨٩';
        const easternArabicIndic = '۰۱۲۳۴۵۶۷۸۹';
        return String(input)
            .split('')
            .map(ch => {
                const i1 = arabicIndic.indexOf(ch);
                if (i1 >= 0) return String(i1);
                const i2 = easternArabicIndic.indexOf(ch);
                if (i2 >= 0) return String(i2);
                return ch;
            })
            .join('');
    }

    function parseCyclesValue(rawValue) {
        const normalized = normalizeDigits(rawValue).trim();
        const parsed = Number.parseInt(normalized, 10);
        if (Number.isNaN(parsed) || parsed < 1) return 1;
        return Math.min(parsed, 100);
    }

    function normalizeSearchText(input) {
        return String(input || '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .replace(/[\u064B-\u065F]/g, '');
    }

    function isMeaningfulSBCName(name) {
        const n = normalizeSearchText(name);
        if (!n || n.length < 4) return false;

        const blocked = new Set([
            'sbc',
            'challenge',
            'challenges',
            'squad',
            'for you',
            'rewards',
            'reward',
            'submit',
            'exchange',
            'home'
        ]);

        if (blocked.has(n)) return false;
        if (/^(sbc|challenge|challenges)\s*\d*$/i.test(n)) return false;

        return true;
    }

    function resolveSBCIndexByName(targetName) {
        if (!targetName || !sbcList.length) return -1;

        const normalizedTarget = targetName.trim().toLowerCase();

        // Exact match first
        let index = sbcList.findIndex(sbc => sbc.name.trim().toLowerCase() === normalizedTarget);
        if (index >= 0) return index;

        // Do NOT fallback to partial matching to avoid opening wrong SBC.
        return -1;
    }

    function resolveSBCNameFromAliases(aliases) {
        if (!Array.isArray(aliases) || aliases.length === 0 || !sbcList.length) return null;

        const normalizedAliases = aliases.map(a => normalizeSearchText(a)).filter(Boolean);
        if (!normalizedAliases.length) return null;

        // Exact first
        for (const alias of normalizedAliases) {
            const exact = sbcList.find(sbc => normalizeSearchText(sbc.name) === alias);
            if (exact) return exact.name;
        }

        // Includes fallback
        for (const alias of normalizedAliases) {
            const includes = sbcList.find(sbc => normalizeSearchText(sbc.name).includes(alias));
            if (includes) return includes.name;
        }

        return null;
    }

    function getSbcTileNodes() {
        const selectors = [
            '.ut-sbc-set-tile-view:not(.sbc-set--buttons)',
            '.ut-sbc-set-tile:not([class*="button"])',
            '[class*="sbc-set-tile"]:not([class*="button"])'
        ];

        const all = [];
        selectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(node => {
                const className = (node.className || '').toString().toLowerCase();
                const isPlaceholder =
                    className.includes('skeleton') ||
                    className.includes('placeholder') ||
                    className.includes('loading') ||
                    className.includes('empty');

                if (node && node.offsetParent !== null && !node.closest('#sbc-auto-ui') && !isPlaceholder) {
                    all.push(node);
                }
            });
        });

        // De-duplicate by DOM reference
        return Array.from(new Set(all));
    }

    async function collectSbcTilesWithScroll() {
        const seedTiles = getSbcTileNodes();

        if (!seedTiles.length) {
            return [];
        }

        // Try to find the nearest scrollable container for SBC tiles
        let scrollContainer = seedTiles[0].closest('.ut-pinned-list, .ut-item-view, [class*="scroll"], [class*="list"], [class*="viewport"]');
        if (!scrollContainer || scrollContainer === document.body) {
            scrollContainer = document.scrollingElement || document.documentElement;
        }

        const isWindowScroll = scrollContainer === document.scrollingElement || scrollContainer === document.documentElement;
        const originalScrollTop = scrollContainer.scrollTop || 0;

        const seen = new Set();
        let stableRounds = 0;
        let previousCount = -1;

        for (let round = 0; round < 18; round++) {
            const nowTiles = getSbcTileNodes();
            nowTiles.forEach(tile => seen.add(tile));

            if (seen.size === previousCount) {
                stableRounds++;
            } else {
                stableRounds = 0;
                previousCount = seen.size;
            }

            if (stableRounds >= 3) {
                break;
            }

            const currentTop = scrollContainer.scrollTop || 0;
            const visibleHeight = isWindowScroll ? window.innerHeight : scrollContainer.clientHeight;
            const scrollHeight = isWindowScroll
                ? Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
                : scrollContainer.scrollHeight;
            const maxTop = Math.max(0, scrollHeight - visibleHeight);

            if (currentTop >= maxTop - 8) {
                break;
            }

            scrollContainer.scrollTop = Math.min(maxTop, currentTop + Math.max(visibleHeight * 0.9, 260));
            await wait(220);
        }

        // Return back to where user was
        scrollContainer.scrollTop = originalScrollTop;
        await wait(120);

        return Array.from(seen);
    }

    async function waitForRewardsToClose(timeout = 6000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            const rewardStillVisible = document.querySelector('.ut-pack-tile, .ut-tile-pack, .pack-item, .ut-reward-item, .ut-store-pack-details-view');
            const claimStillVisible = findElementByText('Claim Rewards', 'button') || findElementByText('Claim', 'button');

            const rewardVisible = rewardStillVisible && rewardStillVisible.offsetParent !== null;
            const claimVisible = claimStillVisible && claimStillVisible.offsetParent !== null;

            if (!rewardVisible && !claimVisible) {
                return true;
            }

            // Try skipping animations/screens while waiting
            document.body.click();
            await wait(150);
        }

        return false;
    }

    // ========== التنقل إلى SBC ==========
    async function goToSBCSection() {
        log('📍 الانتقال إلى قسم SBC...');

        // Try different selectors for SBC navigation
        const sbcSelectors = [
            'button.ut-tab-bar-item.icon-sbc',
            'a[href*="sbc"]',
            'button[class*="sbc"]',
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

        await wait(700);

        // Collect tiles from current viewport + lazy-loaded tiles via auto-scroll
        const sbcTiles = await collectSbcTilesWithScroll();

        log(`🔍 Found ${sbcTiles.length} SBC tiles (after full scan)`);

        sbcList = [];
        let extractionErrors = 0;

        sbcTiles.forEach((tile, index) => {
            let name = '';

            const cleanCandidateName = (value) => {
                if (!value) return '';
                return String(value)
                    .replace(/\s+/g, ' ')
                    .replace(/^\d+\s*of\s*\d+\s*/i, '')
                    .replace(/^for\s+you\s*/i, '')
                    .replace(/repeatable:\s*/gi, '')
                    .replace(/expires?\s*.*/gi, '')
                    .trim();
            };

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
                    tile.getAttribute('aria-label') ||
                    tile.getAttribute('title');
                if (dataName && dataName.length > 2) {
                    name = cleanCandidateName(dataName);
                    if (index < 3) {
                        log(`  ✓ Found from attribute: "${name}"`);
                    }
                }
            }

            // STRATEGY 2.5: Check child attributes (aria/title/data)
            if (!name) {
                const attrNode = tile.querySelector('[aria-label], [title], [data-name], [data-title]');
                if (attrNode) {
                    const attrName = attrNode.getAttribute('data-name') ||
                        attrNode.getAttribute('data-title') ||
                        attrNode.getAttribute('aria-label') ||
                        attrNode.getAttribute('title');

                    if (attrName && attrName.trim().length > 2) {
                        name = cleanCandidateName(attrName);
                        if (index < 3) {
                            log(`  ✓ Found from child-attr: "${name}"`);
                        }
                    }
                }
            }

            // STRATEGY 3: Smart extraction from full text
            if (!name) {
                const fullText = (tile.innerText || tile.textContent || '').trim();
                const lines = fullText.split('\n')
                    .map(l => l.trim())
                    .filter(l => l.length > 2)
                    .filter(l => !l.match(/^\d+\/\d+/))
                    .filter(l => !l.match(/^(SBCs?|Challenges?|Complete|Expires?|Days?|Hours?|Minutes?|Repeatable)$/i));

                if (lines.length > 0) {
                    name = cleanCandidateName(lines[0]);
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
                name = name.replace(/^for you$/i, '').trim();

                // Remove very noisy card-like texts that are not SBC names
                const noisy = /^\d{2,3}[A-Z]{2,}|^[A-Z]{2,3}\d{2,3}/.test(name.replace(/\s+/g, ''));
                if (noisy) {
                    name = '';
                }
            }

            // Fallback for unnamed entries: keep them in list with stable placeholder name
            if (!name || name.length < 2) {
                // Final fallback: try broader candidate from visible text lines
                const broadText = (tile.innerText || tile.textContent || '').split('\n')
                    .map(s => cleanCandidateName(s))
                    .filter(s => s.length >= 3)
                    .filter(s => !/^\d+\/\d+/.test(s))
                    .filter(s => !/^(repeatable|completed|expires|minutes|hours|days)$/i.test(s));

                if (broadText.length > 0) {
                    name = broadText[0];
                }

                if (!name || name.length < 2) {
                    name = `SBC ${index + 1}`;
                }
                extractionErrors++;
                if (index < 3) {
                    log(`  ⚠️ Name fallback used: "${name}"`);
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
                log(`⚠️ ${extractionErrors} تحدي بدون اسم واضح (تمت إضافتهم بأسماء بديلة)`);
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
        await wait(250);

        // Highlight the element briefly
        currentSBC.element.style.outline = '3px solid #3b82f6';
        await wait(200);
        currentSBC.element.style.outline = '';

        const clickTarget = currentSBC.element;

        // Try multiple times with different click methods
        let sbcOpened = false;
        const maxAttempts = 5;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (!isRunning) return false;
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
                if (!isRunning) return false;
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
                    await wait(200);
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

    function getVisibleSubmitButton() {
        const submitSelectors = [
            'button.btn-standard.call-to-action',
            'button.call-to-action',
            'button[class*="call-to-action"]',
            'button[class*="submit"]',
            '.ut-squad-pitch-view button.call-to-action',
            '.ut-sbc-challenge-details button.call-to-action',
            '.ut-button-group button.call-to-action'
        ];

        for (const selector of submitSelectors) {
            const btn = document.querySelector(selector);
            if (btn && btn.offsetParent !== null) {
                const isDisabled = btn.disabled ||
                    btn.classList.contains('disabled') ||
                    btn.getAttribute('disabled') !== null;
                if (!isDisabled) {
                    return btn;
                }
            }
        }

        const byText = findElementByText('Submit', 'button') ||
            findElementByText('Exchange', 'button') ||
            findElementByText('تقديم', 'button') ||
            findElementByText('إرسال', 'button');

        if (byText && byText.offsetParent !== null) {
            const isDisabled = byText.disabled ||
                byText.classList.contains('disabled') ||
                byText.getAttribute('disabled') !== null;
            if (!isDisabled) {
                return byText;
            }
        }

        return null;
    }

    async function recoverToSubmitScreen() {
        let submitBtn = getVisibleSubmitButton();
        if (submitBtn) return true;

        log('🔧 محاولة استعادة شاشة Submit...');

        // 1) Try reopening a challenge tile if visible
        const challengeTiles = Array.from(document.querySelectorAll('.ut-sbc-challenge-tile, .challenge-tile'))
            .filter(el => el && el.offsetParent !== null);

        if (challengeTiles.length > 0) {
            const target = challengeTiles.find(ch => !ch.querySelector('.completed, .checkmark')) || challengeTiles[0];
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await wait(120);
            target.click();
            await wait(50);
            target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

            for (let i = 0; i < 16; i++) {
                await wait(150);
                submitBtn = getVisibleSubmitButton();
                if (submitBtn) return true;
            }
        }

        // 2) Try back navigation one more time
        const backBtn = document.querySelector('button.ut-navigation-button-control, .ut-navigation-button-control, [class*="navigation-button"]');
        if (backBtn && backBtn.offsetParent !== null) {
            backBtn.click();
            await wait(100);
            backBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

            for (let i = 0; i < 16; i++) {
                await wait(150);
                submitBtn = getVisibleSubmitButton();
                if (submitBtn) return true;
            }
        }

        return false;
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

            // Wait for Smart Builder to complete by checking for Submit button OR back button (iOS)
            // Check every 500ms (faster detection) for up to 60 seconds
            let buildComplete = false;
            let checksCount = 0;
            const maxChecks = 120; // 120 checks * 500ms = 60 seconds

            for (let i = 0; i < maxChecks; i++) {
                await wait(500);
                checksCount++;

                // FIRST: Check if Submit/Exchange button appeared (PC/Web - means build is complete)
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
                            log(`✅ تم اكتمال Smart Builder بعد ${totalSeconds} ثانية (PC/Web)`);

                            // Now scroll to Submit button
                            submitBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            await wait(200);

                            break;
                        }
                    }
                }

                // SECOND: If Submit not found (iOS case), check if Smart Builder finished by looking at squad
                if (!buildComplete && checksCount >= 6) { // After 3 seconds, start checking for iOS
                    // Debug: Let's see what's happening
                    if (checksCount === 6) {
                        log('🔍 iOS Check: التحقق من اكتمال بناء التشكيلة...');
                    }

                    // Check if squad is built (look for player items on pitch - BROADER search)
                    const allSlots = document.querySelectorAll('.ut-squad-slot-pedestal');
                    const allItems = document.querySelectorAll('.ut-item-loaded, .player, .entityContainer, [class*="item"]');
                    const allButtons = document.querySelectorAll('button');

                    // Debug logging every 10 checks
                    if (checksCount % 10 === 0) {
                        log(`⚠️ iOS Check ${checksCount}: Slots=${allSlots.length}, Items=${allItems.length}, Buttons=${allButtons.length}`);
                    }

                    // Strategy: After 8 seconds (16 checks), assume Smart Builder finished and look for back button
                    // This is more reliable than trying to count players (different EA layouts)
                    if (checksCount >= 16) { // 16 * 0.5s = 8 seconds - Smart Builder should be done
                        const backButton = document.querySelector('button.ut-navigation-button-control') ||
                            document.querySelector('.ut-navigation-button-control') ||
                            document.querySelector('[class*="navigation-button"]');

                        if (backButton && backButton.offsetParent !== null) {
                            buildComplete = true;
                            const totalSeconds = Math.round(checksCount * 0.5);
                            log(`✅ تم اكتمال Smart Builder بعد ${totalSeconds} ثانية (iOS - timeout reached)`);

                            // iOS: Click back button to return to main SBC view before Submit
                            log('🔍 تم العثور على زر الرجوع (iOS)');
                            log(`   - Tag: ${backButton.tagName}`);
                            log(`   - Class: ${backButton.className}`);

                            // CRITICAL FIX: Hide script UI to prevent blocking the back button
                            const scriptUI = document.getElementById('sbc-auto-ui');
                            if (scriptUI) {
                                scriptUI.style.display = 'none';
                                log('⚠️ إخفاء واجهة السكربت مؤقتاً');
                            }

                            backButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            await wait(200);

                            // Raise z-index to ensure button is clickable
                            const originalZIndex = backButton.style.zIndex;
                            backButton.style.zIndex = '999999';
                            backButton.style.pointerEvents = 'auto';

                            // Highlight
                            backButton.style.outline = '5px solid #3b82f6';
                            await wait(150);
                            backButton.style.outline = '';

                            // Click using multiple methods with longer delays
                            log('🖱️ الضغط على زر الرجوع (محاولة 1)...');
                            backButton.click();
                            await wait(100);

                            log('🖱️ الضغط على زر الرجوع (محاولة 2)...');
                            backButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                            await wait(100);

                            log('🖱️ الضغط على زر الرجوع (محاولة 3)...');
                            backButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                            await wait(50);
                            backButton.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                            await wait(100);

                            log('🖱️ الضغط على زر الرجوع (محاولة 4)...');
                            backButton.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
                            await wait(50);
                            backButton.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true }));

                            // Restore z-index
                            backButton.style.zIndex = originalZIndex;

                            log('⏳ انتظار ظهور زر Submit بعد الرجوع...');

                            // Restore script UI
                            if (scriptUI) {
                                scriptUI.style.display = '';
                                log('✅ إعادة إظهار واجهة السكربت');
                            }

                            // Poll for Submit button appearance (instead of fixed wait)
                            let submitAppeared = false;
                            for (let j = 0; j < 20; j++) { // 20 * 150ms = 3 seconds max
                                await wait(150);
                                const testSubmit = getVisibleSubmitButton();
                                if (testSubmit && testSubmit.offsetParent !== null) {
                                    submitAppeared = true;
                                    log('✅ تم الرجوع إلى عرض SBC الرئيسي - ظهر زر Submit');

                                    // Scroll to Submit
                                    testSubmit.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    await wait(200);
                                    break;
                                }
                            }

                            if (!submitAppeared) {
                                const recovered = await recoverToSubmitScreen();
                                if (recovered) {
                                    log('✅ تم استعادة شاشة Submit بنجاح');
                                } else {
                                    log('❌ لم يظهر زر Submit بعد الرجوع وفشلت الاستعادة');
                                    return false;
                                }
                            }

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

        let submitBtn = getVisibleSubmitButton();
        if (submitBtn) {
            log('✅ تم العثور على زر Submit');
        }

        if (!submitBtn) {
            const recovered = await recoverToSubmitScreen();
            if (recovered) {
                submitBtn = getVisibleSubmitButton();
                if (submitBtn) {
                    log('✅ تم العثور على زر Submit بعد الاستعادة');
                }
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

        const clickSafe = async (el) => {
            if (!el || el.offsetParent === null) return;
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await wait(120);
            el.click();
            await wait(40);
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            await wait(30);
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            await wait(20);
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        };

        // Wait until reward UI is really visible to avoid clicking unrelated elements
        let rewardUIReady = false;
        for (let i = 0; i < 40; i++) { // 40 * 200ms = 8 seconds
            const rewardRoot = document.querySelector('.ut-pack-tile, .ut-tile-pack, .pack-item, .ut-reward-item, .ut-store-pack-details-view');
            const claimBtnVisible = findElementByText('Claim Rewards', 'button') || findElementByText('Claim', 'button');

            if ((rewardRoot && rewardRoot.offsetParent !== null) || (claimBtnVisible && claimBtnVisible.offsetParent !== null)) {
                rewardUIReady = true;
                break;
            }
            await wait(200);
        }

        if (!rewardUIReady) {
            log('❌ لم تظهر شاشة المكافآت بوضوح');
            return false;
        }

        // STEP 1: Click Claim Rewards first (most reliable entry point in EA flow)
        let claimButton = null;
        const rewardButtons = Array.from(document.querySelectorAll('button'))
            .filter(btn => btn && btn.offsetParent !== null && !btn.closest('#sbc-auto-ui'));

        for (const btn of rewardButtons) {
            const txt = (btn.textContent || '').trim().toLowerCase();
            if (
                txt.includes('claim rewards') ||
                txt === 'claim' ||
                txt.includes('collect') ||
                txt.includes('استلام') ||
                txt.includes('مطالبة')
            ) {
                claimButton = btn;
                break;
            }
        }

        if (claimButton) {
            log('✅ تم العثور على زر Claim Rewards');
            log('🖱️ الضغط على زر Claim Rewards...');
            await clickSafe(claimButton);
            await wait(600);
        }

        // STEP 2: If a reward pack tile appears, click it
        log('🔍 البحث عن جائزة البكج...');

        const packSelectors = [
            '.ut-pack-tile',
            '.ut-tile-pack',
            '.pack-item',
            '.ut-reward-item',
            '.ut-store-pack-details-view'
        ];

        let rewardPack = null;
        for (const selector of packSelectors) {
            const candidates = Array.from(document.querySelectorAll(selector))
                .filter(el => el && el.offsetParent !== null && !el.closest('#sbc-auto-ui') && !el.closest('.ut-squad-pitch-view'));

            // Prefer candidates that actually look like reward tiles
            const pack = candidates.find(el => {
                const text = (el.textContent || '').trim().toLowerCase();
                return text.length > 0 && text !== 'for you' && !text.includes('squad battles');
            }) || candidates[0];

            if (pack) {
                rewardPack = pack;
                log(`✅ تم العثور على جائزة البكج: ${selector}`);
                break;
            }
        }

        if (rewardPack) {
            // ========== قراءة اسم البكج وتسجيله ==========
            let packName = 'Unknown Pack';

            // Try to find pack name from various elements
            const nameElements = [
                rewardPack.querySelector('.ut-pack-name'),
                rewardPack.querySelector('.packName'),
                rewardPack.querySelector('h2'),
                rewardPack.querySelector('.title'),
                rewardPack.querySelector('[class*="name"]'),
                rewardPack.querySelector('[class*="title"]')
            ];

            for (const elem of nameElements) {
                if (elem && elem.textContent.trim()) {
                    packName = elem.textContent.trim();
                    break;
                }
            }

            // If no specific element found, try pack element text
            if (packName === 'Unknown Pack' && rewardPack.textContent) {
                const text = rewardPack.textContent.trim();
                if (text && text.length < 100) { // Reasonable pack name length
                    packName = text;
                }
            }

            if (packName.toLowerCase() === 'for you') {
                packName = 'Unknown Pack';
            }

            // Log pack info with SBC name
            log(`📦 جائزة SBC "${currentSBC?.name || 'Unknown'}": ${packName}`);

            log('🎁 الضغط على جائزة البكج...');

            // Highlight pack then click
            rewardPack.style.outline = '3px solid #fbbf24';
            await wait(150);
            rewardPack.style.outline = '';

            await clickSafe(rewardPack);

            log('✅ تم الضغط على البكج');
            await wait(1000); // Wait for pack to open

            // Skip pack opening animation (click anywhere or press space)
            log('⏩ تخطي أنيميشن البكج...');
            document.body.click();
            await wait(100);
            document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
            await wait(500);

            // Click through any OK/Continue buttons after pack
            for (let i = 0; i < 6; i++) {
                await wait(300);
                const okBtn = findElementByText('Ok', 'button') ||
                    findElementByText('OK', 'button') ||
                    findElementByText('Continue', 'button') ||
                    findElementByText('Next', 'button') ||
                    findElementByText('Done', 'button') ||
                    findElementByText('متابعة', 'button');

                if (okBtn) {
                    log('🖱️ الضغط على زر OK/Continue...');
                    await clickSafe(okBtn);
                }
                document.body.click();
            }

            const rewardsClosed = await waitForRewardsToClose();
            if (!rewardsClosed) {
                log('❌ لم يتم إغلاق شاشة المكافآت بعد الضغط على البكج');
                return false;
            }

            log('✅ تم استلام المكافآت');
            return true;
        }

        // STEP 3: if no pack tile, try final close/continue clicks then validate closure
        for (let i = 0; i < 6; i++) {
            await wait(250);
            const continueBtn = findElementByText('Continue', 'button') ||
                findElementByText('Next', 'button') ||
                findElementByText('Done', 'button') ||
                findElementByText('OK', 'button') ||
                findElementByText('Ok', 'button') ||
                findElementByText('متابعة', 'button');

            if (continueBtn && continueBtn.offsetParent !== null) {
                await clickSafe(continueBtn);
            }
            document.body.click();
        }

        const rewardsClosed = await waitForRewardsToClose();
        if (!rewardsClosed) {
            log('❌ لم يتم إغلاق شاشة المكافآت (Claim/Pack لم يكتمل)');
            return false;
        }

        log('✅ تم استلام المكافآت');
        return true;
    }

    function isSBCChallengeOpen() {
        return !!document.querySelector('.ut-squad-builder-container, .ut-squad-pitch-view, .ut-sbc-squad-overview');
    }

    function detectCurrentOpenedSBCName() {
        const selectors = [
            '.ut-sbc-challenge-details .title',
            '.ut-sbc-challenge-details h1',
            '.ut-sbc-challenge-details h2',
            '.ut-sbc-header-view .title',
            '.ut-sbc-challenge-title-view .title',
            '.ut-sbc-set-header-view .title',
            '.ut-sbc-set-header .title',
            '.ut-navigation-breadcrumb .title',
            '.ut-sbc-challenges .title',
            '.sbc-header .title'
        ];

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            const text = (el?.textContent || '').trim();
            if (text && text.length > 2 && !/^submit|exchange$/i.test(text) && isMeaningfulSBCName(text)) {
                return text;
            }
        }

        // Fallback: scan visible heading-like nodes and pick first clean candidate
        const headingCandidates = Array.from(document.querySelectorAll('h1, h2, h3, .title, [class*="header"]'))
            .filter(el => el && el.offsetParent !== null && !el.closest('#sbc-auto-ui'))
            .map(el => (el.textContent || '').trim())
            .filter(text => text.length >= 3)
            .filter(text => !/^submit|exchange|claim|rewards?$/i.test(text))
            .filter(text => !/^(squad|challenge|challenges)$/i.test(text));

        if (headingCandidates.length > 0) {
            const meaningful = headingCandidates.find(text => isMeaningfulSBCName(text));
            if (meaningful) {
                return meaningful;
            }
        }

        return currentSBC?.name || '';
    }

    async function completeOpenedChallengeCycle() {
        if (!isRunning) return false;

        log(`\n🔄 بدء دورة من التحدي المفتوح...\n`);

        if (!isSBCChallengeOpen()) {
            log('❌ لا يوجد تحدي SBC مفتوح حالياً');
            log('💡 افتح التحدي المطلوب أولاً ثم اضغط "بدء من التحدي المفتوح"');
            return false;
        }

        const selectedName = document.getElementById('sbc-select')?.value;
        const detectedName = detectCurrentOpenedSBCName();
        const selectedValid = selectedName && selectedName !== '__none__' && selectedName !== '-1' && isMeaningfulSBCName(selectedName);
        const fallbackName = selectedValid ? selectedName : openedModeTargetName;

        // In opened mode, always prioritize the challenge that is currently open on screen.
        const effectiveName = isMeaningfulSBCName(detectedName) ? detectedName : (fallbackName || 'SBC الحالي');
        currentSBC = { name: effectiveName };
        if (isMeaningfulSBCName(detectedName)) {
            log(`✅ تم التعرف على التحدي المفتوح: ${detectedName}`);
            if (selectedValid && normalizeSearchText(selectedName) !== normalizeSearchText(detectedName)) {
                log(`ℹ️ تم تجاهل اختيار القائمة واستخدام التحدي المفتوح: ${detectedName}`);
            }
        } else if (selectedValid) {
            log(`✅ استخدام الاسم المختار من القائمة: ${selectedName}`);
        } else if (openedModeTargetName) {
            log(`✅ استخدام الاسم المحفوظ من الدورة السابقة: ${openedModeTargetName}`);
        } else {
            log('⚠️ لم يتم التعرف على الاسم، سيتم التنفيذ على التحدي المفتوح الحالي');
        }

        if (isMeaningfulSBCName(effectiveName)) {
            openedModeTargetName = effectiveName;
        }

        const buildSuccess = await usePaletoolsSmartBuild();
        if (!buildSuccess) {
            log('⚠️ Smart Builder لم يكتمل في الوقت المحدد');
            log('🔄 محاولة الإرسال على أي حال...');
        }

        const submitted = await submitSBC();
        if (!submitted) {
            log('❌ فشل تقديم SBC');
            return false;
        }

        const claimed = await claimRewards();
        if (!claimed) {
            log('❌ فشل استلام المكافآت');
            return false;
        }

        log('✅ تم إكمال الدورة من التحدي المفتوح بنجاح');
        return true;
    }

    // ========== العملية الكاملة ==========
    async function completeSBCCycle(targetSBCName) {
        if (!isRunning) return;

        log(`\n🔄 بدء دورة SBC ${sbcsCompleted + 1}...\n`);

        // 1. Go to SBC section
        const inSBC = await goToSBCSection();
        if (!inSBC) {
            log('❌ فشل الانتقال إلى واجهة SBC');
            return false;
        }

        // 2. ALWAYS refresh SBC list each cycle to avoid stale DOM references
        await getSBCList();
        if (sbcList.length === 0) {
            log('❌ لا توجد SBCs متاحة حالياً');
            return false;
        }

        // 3. Resolve target by name on fresh list
        const resolvedIndex = resolveSBCIndexByName(targetSBCName);
        if (resolvedIndex < 0) {
            log(`❌ لم يتم العثور على SBC المطلوب: ${targetSBCName}`);
            log('💡 أعد تحميل قائمة SBCs واختر التحدي مرة أخرى');
            return false;
        }

        // 4. Select and open SBC
        const opened = await selectAndOpenSBC(resolvedIndex);
        if (!opened) {
            log('❌ فشل فتح SBC المختار');
            return false;
        }

        // 5. Use Smart Build
        const buildSuccess = await usePaletoolsSmartBuild();
        if (!buildSuccess) {
            log('⚠️ Smart Builder لم يكتمل في الوقت المحدد');
            log('🔄 محاولة الإرسال على أي حال...');
            // Don't return false - try to submit anyway
        }

        // 6. Submit SBC
        const submitted = await submitSBC();
        if (!submitted) {
            log('❌ فشل تقديم SBC');
            return false;
        }

        // 7. Claim rewards
        const claimed = await claimRewards();
        if (!claimed) {
            log('❌ فشل استلام المكافآت - لن ننتقل لتحدي آخر');
            return false;
        }

        log(`✅ تم إكمال دورة SBC بنجاح!\n`);
        return true;
    }

    // ========== البدء ==========
    async function findAndOpenSBCTileByName(targetName) {
        // البحث عن tile SBC في DOM من خلال البحث المباشر في نصوص العناصر الفعلية
        log(`🔍 البحث المباشر في DOM عن: ${targetName}`);

        const normalized = normalizeSearchText(targetName);

        // Helper function to search in visible tiles by direct DOM text content
        const searchInCurrentTiles = async () => {
            const allTiles = Array.from(document.querySelectorAll('.ut-sbc-set-tile-view'))
                .filter(tile => !tile.closest('#sbc-auto-ui'));

            log(`🔎 فحص ${allTiles.length} tile في الصفحة...`);

            for (const tile of allTiles) {
                const tileText = (tile.textContent || '').trim();
                const tileNormalized = normalizeSearchText(tileText);

                // ابحث عن الاسم الكامل أو أي جزء منه
                // المهم: ابحث في النص الفعلي من الـ DOM ولا تعتمد على الأسماء المحفوظة
                const hasExactMatch = tileNormalized.includes(normalized);
                const hasKeywordMatch = normalized.split(' ')
                    .filter(word => word.length > 3)
                    .every(word => tileNormalized.includes(word));
                
                if (hasExactMatch || hasKeywordMatch) {
                    log(`✅ وجدت: ${tileText.substring(0, 50)}...`);
                    
                    // Scroll into view and click
                    tile.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    await wait(300);
                    
                    // Try multiple times if first attempt doesn't open the challenge
                    for (let clickAttempt = 1; clickAttempt <= 3; clickAttempt++) {
                        // Try multiple click methods
                        log(`🖱️ محاولة الفتح ${clickAttempt}/3...`);
                        tile.click();
                        await wait(150);
                        tile.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                        await wait(50);
                        tile.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                        await wait(150);
                        tile.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                        
                        // Poll for the challenge to actually open (like goToSBCSection does)
                        log('⏳ انتظار فتح التحدي...');
                        let openAttempts = 0;
                        while (openAttempts < 15 && !isSBCChallengeOpen()) {
                            await wait(300);
                            openAttempts++;
                        }
                        
                        if (isSBCChallengeOpen()) {
                            log(`✅ تم فتح التحدي (محاولة ${clickAttempt}, بعد ${openAttempts * 300}ms)`);
                            return true;
                        } else if (clickAttempt < 3) {
                            log(`⚠️ محاولة ${clickAttempt} فشلت - إعادة المحاولة...`);
                            await wait(500);
                        }
                    }
                    
                    log(`❌ فشل فتح التحدي بعد 3 محاولات نقر`);
                    return false;
                }
            }
            return false;
        };

        // First attempt: search in current view
        if (await searchInCurrentTiles()) {
            return true;
        }

        // Second attempt: try scrolling and searching again (like getSBCList does)
        log('📜 محاولة البحث مع تمرير الصفحة...');
        const scrollContainer = document.querySelector('.ut-container-scroll, [class*="scroll"]') || document.documentElement;

        let prevHeight = 0;
        for (let attempt = 0; attempt < 8; attempt++) {
            scrollContainer.scrollTop = prevHeight + 1000;
            await wait(300);

            if (await searchInCurrentTiles()) {
                return true;
            }

            const newHeight = scrollContainer.scrollHeight;
            if (newHeight === prevHeight) {
                break; // صل إلى النهاية
            }
            prevHeight = newHeight;
        }

        log(`❌ لم أجد: ${targetName}`);
        return false;
    }

    async function startFromOpenedSBC(cycles = 1) {
        if (isRunning) {
            log('⚠️ السكربت يعمل بالفعل!');
            return;
        }

        const totalCycles = Number.isFinite(cycles) ? cycles : 1;
        openedModeTargetName = '';

        isRunning = true;
        log(`🚀 بدء من التحدي المفتوح... (التكرارات: ${totalCycles})\n`);
        updateUI();

        for (let i = 0; i < totalCycles; i++) {
            if (!isRunning) break;

            log(`🔁 دورة ${i + 1}/${totalCycles}`);

            let success = false;

            if (i === 0) {
                success = await completeOpenedChallengeCycle();
            } else {
                // Preferred path: if a challenge is already open, run directly again.
                if (isSBCChallengeOpen()) {
                    success = await completeOpenedChallengeCycle();
                } else {
                    // Fallback path: Try to find the tile and reopen it
                    const knownName = isMeaningfulSBCName(openedModeTargetName)
                        ? openedModeTargetName
                        : (isMeaningfulSBCName(currentSBC?.name) ? currentSBC.name : '');

                    if (!knownName) {
                        log('⚠️ لم أجد التحدي مفتوحاً ولا اسم واضح لإعادة الفتح تلقائياً');
                        log('💡 افتح نفس التحدي يدوياً ثم اضغط "بدء من التحدي المفتوح"');
                        break;
                    }

                    log(`✅ متابعة نفس التحدي المفتوح السابق: ${knownName}`);

                    // Go to SBC section
                    const inSBC = await goToSBCSection();
                    if (!inSBC) {
                        log('❌ فشل الانتقال إلى واجهة SBC');
                        break;
                    }

                    // Try direct DOM search FIRST (handles challenges with fallback names like "SBC 63")
                    log('🔍 محاولة البحث المباشر في DOM...');
                    const tileFound = await findAndOpenSBCTileByName(knownName);
                    if (tileFound) {
                        await wait(1200); // Wait for challenge page to load
                        success = await completeOpenedChallengeCycle();
                    } else {
                        // Fallback: Try list search if direct search fails
                        log('📋 محاولة البحث في القائمة المحملة...');
                        await getSBCList();
                        log(`📋 تم تحميل ${sbcList.length} SBC`);

                        const resolvedIndex = resolveSBCIndexByName(knownName);
                        if (resolvedIndex >= 0) {
                            log(`✅ وجدت في القائمة (index: ${resolvedIndex})`);
                            const opened = await selectAndOpenSBC(resolvedIndex);
                            if (opened) {
                                await wait(1000); // Wait for challenge to load
                                success = await completeOpenedChallengeCycle();
                            }
                        } else {
                            log('❌ فشل إيجاد التحدي في المحاولات');
                        }
                    }
                }
            }

            if (!success) {
                log('❌ فشلت الدورة الحالية - إيقاف السكربت');
                break;
            }

            await wait(CONFIG.WAIT_TIME);
        }

        stopScript();
    }

    async function startDailySBCs(cycles = 1) {
        if (isRunning) {
            log('⚠️ السكربت يعمل بالفعل!');
            return;
        }

        const totalCycles = Number.isFinite(cycles) ? cycles : 1;
        const dailyOrder = [
            {
                key: 'Daily Bronze Upgrade',
                aliases: ['Daily Bronze Upgrade', 'Bronze Upgrade', 'Daily Bronze']
            },
            {
                key: 'Daily Silver Upgrade',
                aliases: ['Daily Silver Upgrade', 'Silver Upgrade', 'Daily Silver']
            },
            {
                key: 'Daily Common Gold Upgrade',
                aliases: ['Daily Common Gold Upgrade', 'Common Gold Upgrade', 'Daily Gold Upgrade', 'Daily Common Gold']
            }
        ];

        isRunning = true;
        log(`🚀 بدء التحديات اليومية (Bronze -> Silver -> Gold) | التكرارات: ${totalCycles}`);
        updateUI();

        for (const daily of dailyOrder) {
            if (!isRunning) break;

            log(`📌 التحدي اليومي: ${daily.key}`);

            for (let i = 0; i < totalCycles; i++) {
                if (!isRunning) break;

                log(`🔁 ${daily.key} | دورة ${i + 1}/${totalCycles}`);

                // Refresh list and resolve best matching SBC name for current daily target
                const inSBC = await goToSBCSection();
                if (!inSBC) {
                    log('❌ فشل الانتقال إلى واجهة SBC');
                    isRunning = false;
                    break;
                }

                await getSBCList();
                const resolvedName = resolveSBCNameFromAliases(daily.aliases);
                if (!resolvedName) {
                    log(`❌ لم يتم العثور على ${daily.key} في القائمة`);
                    isRunning = false;
                    break;
                }

                const success = await completeSBCCycle(resolvedName);
                if (!success) {
                    log(`❌ فشل تنفيذ ${daily.key} - إيقاف السكربت`);
                    isRunning = false;
                    break;
                }

                await wait(CONFIG.WAIT_TIME);
            }
        }

        stopScript();
    }

    function stopScript() {
        const wasRunning = isRunning;
        isRunning = false;

        // Always restore UI controls
        const startBtn = document.getElementById('start-btn');
        const stopBtn = document.getElementById('stop-btn');
        const startDailyBtn = document.getElementById('start-daily-btn');

        if (startBtn) startBtn.style.display = 'block';
        if (stopBtn) stopBtn.style.display = 'none';
        if (startDailyBtn) startDailyBtn.disabled = false;

        if (wasRunning) {
            log('\n⏸️ تم إيقاف السكربت');
        }
        openedModeTargetName = '';
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
                    background: rgba(24, 28, 31, 0.96);
                    border: 1px solid rgba(119, 133, 140, 0.35);
                    border-radius: 10px;
                    padding: 12px;
                    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
                    z-index: 999999;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
                    color: #e6ecef;
                    min-width: 260px;
                    max-width: 300px;
                    max-height: 65vh;
                    overflow-y: auto;
                    backdrop-filter: blur(4px);
                    opacity: 0.98;
                    transition: opacity 0.2s;
                }
                
                #sbc-auto-ui:hover {
                    opacity: 1;
                }
                
                #sbc-auto-ui.minimized {
                    display: none;
                }
                
                #sbc-auto-ui h3 {
                    margin: 0 0 10px 0;
                    font-size: 14px;
                    font-weight: 700;
                    text-align: left;
                    color: #dff866;
                    letter-spacing: 0.2px;
                }
                
                #sbc-auto-ui .stats {
                    background: rgba(10, 12, 14, 0.6);
                    border: 1px solid rgba(119, 133, 140, 0.25);
                    border-radius: 8px;
                    padding: 8px;
                    margin-bottom: 8px;
                }
                
                #sbc-auto-ui .stat-item {
                    display: flex;
                    justify-content: space-between;
                    margin: 4px 0;
                    font-size: 10px;
                }
                
                #sbc-auto-ui .stat-item .label {
                    opacity: 0.9;
                }
                
                #sbc-auto-ui .stat-item .value {
                    font-weight: bold;
                    font-size: 11px;
                }
                
                #sbc-auto-ui .sbc-selector {
                    margin-bottom: 8px;
                }
                
                #sbc-auto-ui .sbc-selector label {
                    font-size: 10px;
                    color: #b7c3c9;
                }
                
                #sbc-auto-ui select {
                    width: 100%;
                    padding: 7px;
                    border: 1px solid rgba(119, 133, 140, 0.35);
                    border-radius: 6px;
                    font-size: 11px;
                    background: rgba(34, 40, 44, 0.9);
                    color: #e6ecef;
                    margin-top: 4px;
                    cursor: pointer;
                    transition: border-color 0.2s;
                }
                
                #sbc-auto-ui select:hover {
                    border-color: rgba(159, 255, 80, 0.5);
                    background: rgba(34, 40, 44, 0.9);
                }
                
                #sbc-auto-ui select:focus {
                    outline: none;
                    border-color: #9fff50;
                    box-shadow: 0 0 0 2px rgba(159, 255, 80, 0.18);
                }
                
                #sbc-auto-ui input[type="number"] {
                    width: 100%;
                    padding: 7px;
                    border: 1px solid rgba(119, 133, 140, 0.35);
                    border-radius: 6px;
                    font-size: 11px;
                    background: rgba(34, 40, 44, 0.9);
                    color: #e6ecef;
                    margin-top: 4px;
                    transition: border-color 0.2s;
                }

                #sbc-auto-ui input[type="text"] {
                    width: 100%;
                    padding: 7px;
                    border: 1px solid rgba(119, 133, 140, 0.35);
                    border-radius: 6px;
                    font-size: 11px;
                    background: rgba(34, 40, 44, 0.9);
                    color: #e6ecef;
                    margin-top: 4px;
                    transition: border-color 0.2s;
                }
                
                #sbc-auto-ui input[type="number"]:focus {
                    outline: none;
                    border-color: #9fff50;
                    box-shadow: 0 0 0 2px rgba(159, 255, 80, 0.18);
                }

                #sbc-auto-ui input[type="text"]:focus {
                    outline: none;
                    border-color: #9fff50;
                    box-shadow: 0 0 0 2px rgba(159, 255, 80, 0.18);
                }
                
                #sbc-auto-ui button {
                    width: 100%;
                    padding: 7px;
                    border: 1px solid rgba(119, 133, 140, 0.35);
                    border-radius: 6px;
                    font-size: 11px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: background-color 0.2s, border-color 0.2s;
                    margin: 3px 0;
                    box-shadow: none;
                }
                
                #sbc-auto-ui .btn-start {
                    background: #9fff50;
                    border-color: #9fff50;
                    color: #101416;
                }
                
                #sbc-auto-ui .btn-start:hover {
                    background: #8fe247;
                    border-color: #8fe247;
                }
                
                #sbc-auto-ui .btn-stop {
                    background: #c74f4f;
                    border-color: #c74f4f;
                    color: #f5f7f8;
                }
                
                #sbc-auto-ui .btn-stop:hover {
                    background: #b24747;
                    border-color: #b24747;
                }
                
                #sbc-auto-ui .btn-refresh {
                    background: rgba(62, 73, 80, 0.9);
                    color: #e6ecef;
                }
                
                #sbc-auto-ui .btn-refresh:hover {
                    background: rgba(74, 86, 94, 0.95);
                    border-color: rgba(159, 255, 80, 0.45);
                }
                
                #sbc-auto-ui .btn-minimize {
                    background: rgba(62, 73, 80, 0.9);
                    color: #e6ecef;
                }
                
                #sbc-auto-ui .btn-minimize:hover {
                    background: rgba(74, 86, 94, 0.95);
                }
                
                #sbc-auto-ui .btn-close {
                    background: rgba(44, 50, 54, 0.9);
                    color: #c9d4da;
                    font-size: 11px;
                    padding: 6px;
                    border: 1px solid rgba(119, 133, 140, 0.35);
                }
                
                #sbc-auto-ui .btn-close:hover {
                    background: rgba(58, 66, 72, 0.95);
                    color: #f1f5f9;
                }
                
                #sbc-auto-ui .log-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-top: 6px;
                    margin-bottom: 4px;
                }
                
                #sbc-auto-ui .log-title {
                    font-size: 9px;
                    font-weight: 600;
                    color: #9cadb5;
                }
                
                #sbc-auto-ui .btn-copy-log {
                    background: rgba(44, 50, 54, 0.9);
                    color: #c9d4da;
                    border: 1px solid rgba(119, 133, 140, 0.35);
                    padding: 4px 8px;
                    font-size: 10px;
                    border-radius: 6px;
                    cursor: pointer;
                    transition: all 0.2s;
                    width: auto;
                    margin: 0;
                }
                
                #sbc-auto-ui .btn-copy-log:hover {
                    background: rgba(58, 66, 72, 0.95);
                    border-color: rgba(159, 255, 80, 0.4);
                    transform: translateY(0);
                    box-shadow: none;
                }
                
                #sbc-auto-ui .log {
                    background: rgba(13, 16, 18, 0.95);
                    border: 1px solid rgba(119, 133, 140, 0.25);
                    border-radius: 6px;
                    padding: 7px;
                    max-height: 150px;
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
                    border-bottom: 1px solid rgba(119, 133, 140, 0.18);
                    color: #cfd8dd;
                    word-break: break-word;
                    overflow-wrap: break-word;
                    line-height: 1.3;
                }
            </style>
            
            <h3>SBC Auto Completer</h3>
            
            <div class="stats">
                <div class="stat-item">
                    <span class="label">SBCs مكتملة:</span>
                    <span class="value" id="sbcs-count">0</span>
                </div>
            </div>
            
            <div class="sbc-selector">
                <label>عدد التكرارات:</label>
                <input type="number" id="cycles-input" value="1" min="1" max="100">
            </div>
            
            <button class="btn-start" id="start-btn">بدء (من التحدي المفتوح)</button>
            <button class="btn-refresh" id="start-daily-btn">تشغيل اليوميات (Bronze -> Silver -> Gold)</button>
            <button class="btn-stop" id="stop-btn" style="display:none">إيقاف</button>
            <button class="btn-minimize" id="minimize-btn">تصغير</button>
            <button class="btn-close" id="close-btn">إغلاق</button>
            
            <div class="log-header">
                <span class="log-title">السجل</span>
                <button class="btn-copy-log" id="copy-log-btn">نسخ</button>
            </div>
            <div class="log" id="log-container">
                <div class="log-entry">جاهز للبدء...</div>
            </div>
        `;

        document.body.appendChild(ui);

        // Event listeners
        const renderSBCOptions = (filterText = '') => {
            const select = document.getElementById('sbc-select');
            select.innerHTML = '';

            const normalizedFilter = normalizeSearchText(filterText);
            const filtered = sbcList.filter(sbc => !normalizedFilter || normalizeSearchText(sbc.name).includes(normalizedFilter));

            if (filtered.length === 0) {
                select.innerHTML = '<option value="__none__">-- لا توجد نتائج --</option>';
                return;
            }

            filtered.forEach((sbc) => {
                const option = document.createElement('option');
                option.value = sbc.name;
                option.textContent = sbc.name;
                select.appendChild(option);
            });

            // Keep UX fast: auto-select first match when available
            if (filtered.length > 0) {
                select.selectedIndex = 0;
            }
        };



        document.getElementById('start-btn').addEventListener('click', () => {
            const cyclesRaw = document.getElementById('cycles-input').value;
            const cycles = parseCyclesValue(cyclesRaw);

            // Keep current opened challenge as primary target when available.
            const detectedOpenedName = detectCurrentOpenedSBCName();
            if (isMeaningfulSBCName(detectedOpenedName)) {
                currentSBC = { name: detectedOpenedName };
                openedModeTargetName = detectedOpenedName;
            }

            document.getElementById('start-btn').style.display = 'none';
            document.getElementById('stop-btn').style.display = 'block';
            document.getElementById('start-daily-btn').disabled = true;

            startFromOpenedSBC(cycles);
        });



        document.getElementById('start-daily-btn').addEventListener('click', () => {
            const cyclesRaw = document.getElementById('cycles-input').value;
            const cycles = parseCyclesValue(cyclesRaw);

            document.getElementById('start-btn').style.display = 'none';
            document.getElementById('stop-btn').style.display = 'block';
            document.getElementById('start-daily-btn').disabled = true;

            startDailySBCs(cycles);
        });

        document.getElementById('stop-btn').addEventListener('click', () => {
            stopScript();
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

        document.getElementById('minimize-btn').addEventListener('click', () => {
            ui.classList.add('minimized');
            // Show reopen button
            if (!document.getElementById('sbc-reopen-btn')) {
                const reopenBtn = document.createElement('div');
                reopenBtn.id = 'sbc-reopen-btn';
                reopenBtn.innerHTML = 'SBC';
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
                    font-size: 12px;
                    font-weight: 700;
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
                reopenBtn.innerHTML = 'SBC';
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
                    font-size: 12px;
                    font-weight: 700;
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
    }

    function log(message) {
        const cleanMessage = String(message).replace(/^[🚀🎯🎁⏳🔍✅❌⚠️📤🤖🖱️🔁📋📍⏸️👆📝⏩💡📦🏪🔄]+\s*/, '');
        console.log(cleanMessage);

        const logContainer = document.getElementById('log-container');
        if (logContainer) {
            const entry = document.createElement('div');
            entry.className = 'log-entry';
            entry.textContent = `${new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} ${cleanMessage}`;
            logContainer.appendChild(entry);
            logContainer.scrollTop = logContainer.scrollHeight;

            // Keep only last 50 entries
            while (logContainer.children.length > 50) {
                logContainer.removeChild(logContainer.firstChild);
            }
        }
    }

    // ========== تهيئة ==========
    createUI();
    log('جاهز');

})();
